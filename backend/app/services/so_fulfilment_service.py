"""Sales-order fulfilment aggregation, and the single owner of SO status.

Four numbers per SO line, all *derived* — nothing is stored on the line, so there
is no second source of truth to drift (`StockBalance` is the only sanctioned
materialization in this codebase):

    made              produced against the line (root MO completions, rejects out)
    packed            ever packed into cartons  (PackingCompletion.qty)
    packed_available  cartons still in stock    (PackedUnit StockBalance > 0)
    dispatched        shipped                   (DISPATCHED pick list lines)

`packed_available` is the READY driver: an order is shippable when every line has
cartons physically in stock, not merely when the loom finished.

Each of the four is reported TWICE: in the item's stock UoM, and in the line's own
alt selling unit (`SalesOrderLine.uom2` -- Pcs, Pic, Gross). The alt count is the
figure that is reported to the user: the customer ordered 2880 Pcs and is owed
2880 Pcs, whatever they weighed, so it is what the fulfilment bar draws and what
`derive_status` gates READY/SENT on. Kilos stay the unit stock actually moves in,
so both are carried rather than one replacing the other; a line with no alt unit
has None for all four and every consumer falls back to the base figures.

Alt counts are SUMMED FROM CARTONS (`Batch.alt_qty`) wherever cartons exist --
never divided out of the kilos. That is the same rule `packing_service` states for
`PackingOrder.qty_packed_alt`: `uom2_factor` is a planning estimate off the item's
g/y, the packer reweighs every box, and dividing the weight back by the factor
reports a piece count nobody counted. Only `made` (bulk FG, no cartons yet) and an
uncartonised bulk dispatch line are CONVERTED, through this line's own ordered
pair (`qty2` : `ordered_base`) rather than through the UOM master -- those two
figures are already locked to each other on the SO form, so no second conversion
chain is needed and none can drift from it.

`recompute_so_status` replaces the scattered `so.status = "READY"` writes that
used to live in api/manufacturing.py and api/pick_lists.py. Those flipped the
whole order the moment the *first* root MO delivered, so a multi-line SO read as
shippable while most of it was still in production.

Line -> production peg: neither `ManufacturingOrder` nor `PRBomEntry` carries a
`sales_order_line_id`, so `made` matches root MOs on (item, bom, size, color) —
size compared as the folded size NAME, because an SO line states a generic size
while the MO carries the chosen BOM's own BOMSize row — with nulls on the line
treated as wildcards. Lines on one SO differ by item, so
this resolves uniquely in practice; if two lines ever claim the same MO the qty
is split pro-rata rather than double-counted.
"""

from sqlalchemy import String, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from app.models.batch import Batch
from app.models.bom import BOMSize
from app.models.item import Item
from app.models.manufacturing import ManufacturingOrder, MOCompletion, MODependency
from app.models.packing import PackingCompletion, PackingOrder
from app.models.pick_list import PickList, PickListLine
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.size import Size
from app.models.stock_balance import StockBalance
from app.models.work_order import WorkOrder

EPS = 1e-6

# Statuses this module owns. SENT/DELIVERED/CANCELLED are terminal or manually
# set downstream and are never recomputed back into an earlier stage.
_RECOMPUTABLE = ("PENDING", "READY", "PARTIAL")

_ZERO = {
    "made": 0.0,
    "packed": 0.0,
    "packed_available": 0.0,
    "dispatched": 0.0,
    # Denominator for the four above, in their own unit. None = not derivable;
    # see `ordered_qty_in_stock_uom`.
    "ordered_base": None,
    "base_uom": "",
    # --- The same four in the line's alt selling unit ------------------------
    # None (not 0.0) means this line has no alt unit to count in at all, which is
    # a different answer from "nothing packed yet" and is what makes a consumer
    # fall back to the base figures rather than draw an empty bar. Seeded to 0.0
    # in `fulfilment_map` for every line that does carry one.
    "made_alt": None,
    "packed_alt": None,
    "packed_available_alt": None,
    "dispatched_alt": None,
    # What the customer ordered, in that unit: `SalesOrderLine.qty2` as it was
    # keyed. Never re-derived from `ordered_base` -- the SO form locks the two
    # together (`altCountForYd`/`deriveFromAlt`), so this IS the ordered figure.
    "ordered_alt": None,
    "alt_uom": "",
}


def _f(v) -> float:
    return float(v or 0)


# --- The denominator -------------------------------------------------------
#
# `SalesOrderLine.qty` is authored in YARDS: the SO form's only quantity field is
# labelled "Yard", and its Meter / Gross-Yd / Kg satellites all write back into
# `qty` as yards. Every number produced by `fulfilment_map` below is in the
# item's own stock UoM (`Item.uom`) instead — MO completions, StockBalance,
# packing completions and picked cartons all post in it.
#
# Most finished goods here are stocked in kg, so comparing the two directly
# divided kilograms by yards: an 11 kg dispatch against a 10 000 yd (= 10 kg)
# order read as 0.1% shipped, and the order could never reach READY or SENT.
# Everything that measures fulfilment against an ordered qty must go through
# `ordered_qty_in_stock_uom` — never `line.qty` raw.
#
# `SalesOrderLine.qty_kg` is the weight the SO form kept in lockstep with `qty`
# (via `Item.weight_per_unit`), and is what the customer's paperwork says, so it
# wins over re-deriving. Re-derivation is only the fallback for rows that predate
# the field or were imported without it.

_WEIGHT_UOMS = {"kg", "kgs", "kilo", "kilogram", "kilograms"}
_METER_UOMS = {"m", "meter", "meters", "metre", "metres"}

YARD_IN_METERS = 0.9144


def ordered_qty_in_stock_uom(
    qty,
    uom,
    qty_kg=None,
    weight_per_unit=None,
    weight_unit=None,
) -> float | None:
    """The ordered qty (yards) restated in `uom`, or None if it can't be known.

    None is deliberately neither 0 nor the raw yards: a kg-stocked item with no
    weight-per-yard on its master has no honest denominator. Falling back to the
    yards would resurrect the unit mismatch; falling back to 0 would divide by
    zero and read as instantly complete. Callers must treat None as "unknown",
    not as "satisfied".
    """
    ordered = _f(qty)
    # A degenerate zero-qty line stays trivially satisfied rather than becoming
    # an unsatisfiable None that pins its whole order out of SENT.
    if ordered <= 0:
        return 0.0

    u = (uom or "").strip().lower()

    if u in _WEIGHT_UOMS:
        if qty_kg is not None and _f(qty_kg) > 0:
            return _f(qty_kg)
        w = _f(weight_per_unit)
        if w <= 0:
            return None
        wu = (weight_unit or "").strip().lower()
        if wu == "g/y":
            return ordered * w / 1000.0
        if wu == "g/m":
            return ordered * YARD_IN_METERS * w / 1000.0
        return None

    if u in _METER_UOMS:
        return ordered * YARD_IN_METERS

    # Yards, pcs, litres, anything else: the qty is already in the stocking unit.
    # Piece- and volume-stocked lines are keyed straight into the yard field and
    # mean pieces/litres, so passing them through is correct, not a fallback.
    return ordered


# Carton quality states that never count as output, mirroring
# `PackingOrder.qty_packed`/`qty_packed_alt` and the pickability gate.
_REJECTED_CARTON = ("REJECTED", "REJECT_USABLE")


def _to_alt(base_qty, ordered_base, ordered_alt) -> float | None:
    """A base-UoM qty restated as an alt count, through this line's ordered pair.

    Deliberately NOT `base_qty / base_per_alt(uom2_factor, ...)`. The SO form keys
    `qty` (yards), `qty_kg` and `qty2` as one locked number, so `ordered_alt /
    ordered_base` is this line's own effective pieces-per-kg and cannot disagree
    with the denominator the bar is drawn against -- whereas re-running the UOM
    master's factor through the item's g/y is a second chain that can, and would
    make a 100%-made line read 97%.

    Only for figures no carton exists for (`made`, a bulk dispatch line). Anything
    packed is SUMMED from `Batch.alt_qty` instead -- see the module docstring.

    None when there is no pair to scale through; 0.0 in, 0.0 out, so an untouched
    line stays a real zero rather than an unknown.
    """
    qty = _f(base_qty)
    if qty == 0:
        return 0.0
    ob, oa = _f(ordered_base), _f(ordered_alt)
    if ob <= 0 or oa <= 0:
        return None
    return round(qty * oa / ob, 2)


async def ordered_base_map(db: AsyncSession, line_ids: list) -> dict:
    """{str(so_line_id): ordered qty in the item's stock UoM (or None)}.

    For callers that need only the denominator — pick-list remaining, dashboard
    readiness — without paying for the four fulfilment aggregates.
    """
    line_ids = [i for i in line_ids if i]
    if not line_ids:
        return {}
    rows = (
        await db.execute(
            select(
                SalesOrderLine.id,
                SalesOrderLine.qty,
                SalesOrderLine.qty_kg,
                Item.uom,
                Item.weight_per_unit,
                Item.weight_unit,
            )
            .join(Item, Item.id == SalesOrderLine.item_id)
            .filter(SalesOrderLine.id.in_(line_ids))
        )
    ).all()
    return {
        str(sol_id): ordered_qty_in_stock_uom(
            qty, uom, qty_kg=qty_kg, weight_per_unit=wpu, weight_unit=wu
        )
        for sol_id, qty, qty_kg, uom, wpu, wu in rows
    }


# --- Line -> production peg ------------------------------------------------
#
# Shared by `made` (fulfilment_map) and by `mo_progress_map`. Neither
# `ManufacturingOrder` nor `PRBomEntry` carries a `sales_order_line_id`, so a root
# MO is matched to its line on (so, item, bom, bom_size, color) with nulls on the
# *line* treated as wildcards. The two callers must peg identically: the SO table
# draws the MO-progress column immediately left of the fulfilment bar, and they
# would contradict each other if one decided an MO belonged to a different line.


def _root_mo_filter() -> tuple:
    """The MOs that count as "produced for this SO line".

    Root only (`parent_mo_id IS NULL`): sub-assembly and shared-component MOs are
    reached through their root, and counting them would peg the same output twice.
    """
    return (
        ManufacturingOrder.parent_mo_id.is_(None),
        ManufacturingOrder.is_shared_component == False,  # noqa: E712 - SQL boolean
        ManufacturingOrder.status != "CANCELLED",
    )


async def _line_rows(db: AsyncSession, so_ids: list) -> list:
    """Every line of these SOs, with the Item columns the denominator needs.

    Positional indices are load-bearing: 1..5 for `_mo_claimants`, 6..10 for
    `ordered_qty_in_stock_uom`, 11..12 for the size token (`_size_tokenizer`),
    13..14 for the alt selling unit. One query for the whole page, never per order.
    """
    return (
        await db.execute(
            select(
                SalesOrderLine.id,
                SalesOrderLine.sales_order_id,
                SalesOrderLine.item_id,
                SalesOrderLine.bom_id,
                SalesOrderLine.bom_size_id,
                SalesOrderLine.color_id,
                SalesOrderLine.qty,
                SalesOrderLine.qty_kg,
                Item.uom,
                Item.weight_per_unit,
                Item.weight_unit,
                SalesOrderLine.size_id,
                SalesOrderLine.size_label,
                SalesOrderLine.qty2,
                SalesOrderLine.uom2,
            )
            .join(Item, Item.id == SalesOrderLine.item_id)
            .filter(SalesOrderLine.sales_order_id.in_(so_ids))
        )
    ).all()


def _fold(name) -> str:
    """Folded size name — the identity both an SO line and an MO can state."""
    return (name or "").strip().lower()


async def _size_tokenizer(db: AsyncSession, line_rows: list, mo_size_ids: list):
    """`(line_token, bom_size_token)` resolvers for one peg pass.

    A sales-order line states its size generically (Size master row, or a
    free-mode label) because the recipe is picked later, at the Production Run; an
    MO carries the chosen BOM's own `BOMSize` row. Neither id can be compared to
    the other, so both sides are folded to the size NAME — the same identity
    netting keys on. Two lookups for the whole page.
    """
    bs_ids = {r[4] for r in line_rows if r[4]} | {i for i in mo_size_ids if i}
    bom_sizes: dict = {}
    if bs_ids:
        bom_sizes = {
            r[0]: (r[1], r[2])
            for r in (
                await db.execute(
                    select(BOMSize.id, BOMSize.size_id, BOMSize.label).filter(BOMSize.id.in_(bs_ids))
                )
            ).all()
        }
    size_ids = {r[11] for r in line_rows if r[11]} | {sid for sid, _ in bom_sizes.values() if sid}
    names: dict = {}
    if size_ids:
        names = {
            r[0]: r[1]
            for r in (await db.execute(select(Size.id, Size.name).filter(Size.id.in_(size_ids)))).all()
        }

    def bom_size_token(bom_size_id) -> str:
        if not bom_size_id:
            return ""
        size_id, label = bom_sizes.get(bom_size_id, (None, None))
        return _fold(names.get(size_id)) or _fold(label)

    def line_token(r) -> str:
        return _fold(names.get(r[11])) or _fold(r[12]) or bom_size_token(r[4])

    return line_token, bom_size_token


def _size_matches(r, line_token, mo_size_id, mo_size_token) -> bool:
    """Does this line's size claim the MO's?

    Three cases, in order. A line still carrying the legacy per-BOM pointer
    compares by id, exactly as before: that id names a size AND the BOM it belongs
    to, and one order can hold the same item at the same size against two recipes
    — folding those to "m" would make each MO claim both lines. It is also the
    only identity a measurement-only free size (157 cm, no name) has at all.
    A line that states its size generically compares on the folded NAME, since it
    has no BOMSize id and the MO carries the chosen BOM's own row. Anything else
    named no size and stays a wildcard.
    """
    if r[4] is not None:
        return r[4] == mo_size_id
    token = line_token(r)
    if token:
        return token == mo_size_token
    return True


def _mo_claimants(line_rows: list, line_token, mo_so_id, mo_item, mo_bom, mo_size_id, mo_size_token, mo_color) -> list:
    """The `_line_rows` rows a root MO could belong to.

    A null on the line is a wildcard: legacy rows predate bom_id/color_id on the
    SO line, and a line that named no size claims any. Lines on one SO differ by
    item, so this resolves uniquely in practice.
    """
    return [
        r
        for r in line_rows
        if r[1] == mo_so_id
        and r[2] == mo_item
        and (r[3] is None or r[3] == mo_bom)
        and _size_matches(r, line_token, mo_size_id, mo_size_token)
        and (r[5] is None or r[5] == mo_color)
    ]


async def fulfilment_map(db: AsyncSession, so_ids: list) -> dict:
    """{str(so_line_id): {made, packed, packed_available, dispatched}} for these SOs.

    Four grouped aggregates for the whole set — no per-order or per-line queries,
    so this stays flat when called for a full page of sales orders.
    """
    so_ids = [i for i in so_ids if i]
    if not so_ids:
        return {}

    line_rows = await _line_rows(db, so_ids)
    if not line_rows:
        return {}

    line_ids = [r[0] for r in line_rows]
    out = {str(r[0]): dict(_ZERO) for r in line_rows}
    for r in line_rows:
        out[str(r[0])]["ordered_base"] = ordered_qty_in_stock_uom(
            r[6], r[8], qty_kg=r[7], weight_per_unit=r[9], weight_unit=r[10]
        )
        out[str(r[0])]["base_uom"] = (r[8] or "").strip()
        # A line counts in its alt unit only when it states BOTH the unit and the
        # count. A unit with no count is the free-text case ("600 yard" typed into
        # uom2 with no factor) -- there is no denominator there, so the line stays
        # on the base figures instead of drawing a bar against nothing.
        alt_uom = (r[14] or "").strip()
        ordered_alt = _f(r[13])
        if alt_uom and ordered_alt > 0:
            out[str(r[0])]["alt_uom"] = alt_uom
            out[str(r[0])]["ordered_alt"] = ordered_alt
            for k in ("made_alt", "packed_alt", "packed_available_alt", "dispatched_alt"):
                out[str(r[0])][k] = 0.0

    # --- dispatched: only a DISPATCHED pick list has posted stock OUT ---
    #
    # Three sums, not one. A pick list line is (SO line, carton), so the shipped
    # piece count is the cartons' own `alt_qty` added up -- but a bulk line ships
    # uncartonised (`batch_id` null, free qty) and has no count to add. Those are
    # measured separately and converted below, so a mixed order neither loses the
    # bulk qty nor restates the counted cartons through an estimate.
    _has_alt = Batch.alt_qty.isnot(None)
    for sol_id, qty, carton_alt, carton_base in (
        await db.execute(
            select(
                PickListLine.sales_order_line_id,
                func.coalesce(func.sum(PickListLine.qty_picked), 0),
                func.coalesce(func.sum(Batch.alt_qty), 0),
                func.coalesce(
                    func.sum(case((_has_alt, PickListLine.qty_picked), else_=0)), 0
                ),
            )
            .join(PickList, PickListLine.pick_list_id == PickList.id)
            .outerjoin(Batch, Batch.id == PickListLine.batch_id)
            .filter(
                PickList.sales_order_id.in_(so_ids),
                PickList.status == "DISPATCHED",
            )
            .group_by(PickListLine.sales_order_line_id)
        )
    ).all():
        key = str(sol_id)
        if key not in out:
            continue
        out[key]["dispatched"] = _f(qty)
        if out[key]["dispatched_alt"] is None:
            continue
        bulk = _to_alt(
            _f(qty) - _f(carton_base), out[key]["ordered_base"], out[key]["ordered_alt"]
        )
        out[key]["dispatched_alt"] = round(_f(carton_alt) + _f(bulk), 2)

    # --- packed: every carton ever minted against the line ---
    for sol_id, qty in (
        await db.execute(
            select(
                PackingOrder.sales_order_line_id,
                func.coalesce(func.sum(PackingCompletion.qty), 0),
            )
            .join(PackingCompletion, PackingCompletion.packing_order_id == PackingOrder.id)
            .filter(PackingOrder.sales_order_line_id.in_(line_ids))
            .group_by(PackingOrder.sales_order_line_id)
        )
    ).all():
        if str(sol_id) in out:
            out[str(sol_id)]["packed"] = _f(qty)

    # The same thing counted in pieces. A separate pass off the cartons rather
    # than a second sum on the completion rows: `PackingCompletion` records the kg
    # that left stock, and the piece count lives one level down on each carton it
    # minted. Rejected cartons drop out here exactly as rejected completions drop
    # out of `qty_packed` -- scrap was not packed.
    for sol_id, alt in (
        await db.execute(
            select(
                PackingOrder.sales_order_line_id,
                func.coalesce(func.sum(Batch.alt_qty), 0),
            )
            .select_from(PackingOrder)
            .join(Batch, Batch.packing_order_id == PackingOrder.id)
            .filter(
                PackingOrder.sales_order_line_id.in_(line_ids),
                Batch.quality_status.notin_(_REJECTED_CARTON),
            )
            .group_by(PackingOrder.sales_order_line_id)
        )
    ).all():
        if str(sol_id) in out and out[str(sol_id)]["packed_alt"] is not None:
            out[str(sol_id)]["packed_alt"] = round(_f(alt), 2)

    # --- packed_available: cartons still holding stock. Carton qty lives only in
    # the StockBalance row keyed by the batch, never on the Batch itself.
    # `quality_status == "GOOD"` mirrors the same gate pick_lists.py uses to decide
    # what's pickable (readiness board query, carton-scan endpoint) — a rejected or
    # disposed carton still has StockBalance.qty > 0 sitting in the defect store,
    # but it can never be picked, so it must not count toward READY either.
    for sol_id, qty, alt in (
        await db.execute(
            select(
                PackingOrder.sales_order_line_id,
                func.coalesce(func.sum(StockBalance.qty), 0),
                # The piece count of those same cartons, in the one pass -- the
                # join is identical, so a second query would only be a second
                # chance for the two to disagree about which cartons are in stock.
                func.coalesce(func.sum(Batch.alt_qty), 0),
            )
            .select_from(PackingOrder)
            .join(Batch, Batch.packing_order_id == PackingOrder.id)
            .join(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
            .filter(
                PackingOrder.sales_order_line_id.in_(line_ids),
                Batch.quality_status == "GOOD",
                StockBalance.qty > 0,
            )
            .group_by(PackingOrder.sales_order_line_id)
        )
    ).all():
        if str(sol_id) in out:
            out[str(sol_id)]["packed_available"] = _f(qty)
            if out[str(sol_id)]["packed_available_alt"] is not None:
                out[str(sol_id)]["packed_available_alt"] = round(_f(alt), 2)

    # --- made: root MO completions, matched to lines on the variant tuple ---
    mo_rows = (
        await db.execute(
            select(
                ManufacturingOrder.sales_order_id,
                ManufacturingOrder.item_id,
                ManufacturingOrder.bom_id,
                ManufacturingOrder.bom_size_id,
                ManufacturingOrder.color_id,
                func.coalesce(func.sum(MOCompletion.qty_completed), 0),
            )
            .outerjoin(
                MOCompletion,
                (MOCompletion.mo_id == ManufacturingOrder.id)
                & (MOCompletion.rejected == False),  # noqa: E712 - SQL boolean
            )
            .filter(
                ManufacturingOrder.sales_order_id.in_(so_ids),
                *_root_mo_filter(),
            )
            .group_by(
                ManufacturingOrder.sales_order_id,
                ManufacturingOrder.item_id,
                ManufacturingOrder.bom_id,
                ManufacturingOrder.bom_size_id,
                ManufacturingOrder.color_id,
            )
        )
    ).all()

    line_token, bom_size_token = await _size_tokenizer(
        db, line_rows, [r[3] for r in mo_rows]
    )

    for mo_so_id, mo_item, mo_bom, mo_size, mo_color, produced in mo_rows:
        produced = _f(produced)
        if produced <= 0:
            continue
        claimants = _mo_claimants(
            line_rows, line_token, mo_so_id, mo_item, mo_bom, mo_size, bom_size_token(mo_size), mo_color
        )
        if not claimants:
            continue
        if len(claimants) == 1:
            out[str(claimants[0][0])]["made"] += produced
            continue
        # Ambiguous (two lines, same item + recipe + size + shade). Split by
        # ordered qty so the totals still reconcile against the SO.
        total = sum(_f(r[6]) for r in claimants)
        if total <= 0:
            share = produced / len(claimants)
            for r in claimants:
                out[str(r[0])]["made"] += share
        else:
            for r in claimants:
                out[str(r[0])]["made"] += produced * (_f(r[6]) / total)

    # `made` is bulk finished goods -- it has not been cut into pieces yet, so
    # there is no counted figure to sum and this is the one stage that must be
    # converted. Done last, after the pro-rata split above has settled, so an
    # ambiguous peg converts the share the line actually got.
    for r in line_rows:
        stat = out[str(r[0])]
        if stat["made_alt"] is None:
            continue
        stat["made_alt"] = _to_alt(stat["made"], stat["ordered_base"], stat["ordered_alt"])

    return out


# --- MO progress (the SO table's "how much has been produced?" column) -----
#
# Deliberately NOT folded into `fulfilment_map`: that runs on every MO completion,
# packing completion and shipment dispatch via `recompute_so_status`, and none of
# those need the work-order join. Only the SO list endpoint calls this.

_WO_DONE = "COMPLETED"
_WO_RUNNING = "IN_PROGRESS"
# An MO with no work orders at all can only be read off its own status; DELIVERED
# means the planned qty was met and the order merely isn't closed yet.
_MO_DONE = ("COMPLETED", "DELIVERED")


def _stage_label(wo) -> str | None:
    """What to call the step a WO represents, shortest useful name first.

    `center_type` is the shop-floor word for the step (WEAVING, DYEING), so it
    wins — except GENERAL, which is the model default and says nothing, so those
    fall through to the machine's own name.
    """
    if wo is None:
        return None
    wc = wo.work_center
    if wc is not None:
        ct = (wc.center_type or "").strip()
        if ct and ct != "GENERAL":
            return ct
        if wc.name:
            return wc.name
    return wo.name


def _mo_progress_node(mo, made: float = 0.0) -> dict:
    """One root MO's own output: **quantity produced**, not steps completed.

    `output_pct` (and `pct`, until `_fold_components` rewrites it) is
    `made / mo.qty` — the qty-at-completion measure Oracle/NetSuite/Epicor use as
    the primary reading, and the only defensible one here. Counting work orders
    was non-monotonic: WOs are manual floor dispatch decisions, so the denominator
    is authored after the fact, and adding a third WO to an MO with two completed
    ones dropped the bar from 100% to 67%. `WorkOrder.qty` is nullable too, so
    weighting the count by WO qty could not rescue it either. Weighting by
    `BOMOperation.time_minutes` (proper earned-value) is the upgrade to make once
    routings are maintained; they are not populated today.

    Capped at 100 because `mo.qty` is a target, not a ceiling (see
    `overdelivery_tolerance_pct`) — the uncapped figure stays readable from
    `made` / `mo_qty`, which the SO table prints beside the bar.

    Steps are still counted, but only to *locate* the order: `current_stage` is the
    running WO, or the next one waiting if nothing is running, which is the answer
    to "where is this right now?". They no longer drive the percentage.
    """
    wos = sorted(
        (w for w in (mo.work_orders or []) if w.status != "CANCELLED"),
        key=lambda w: (w.sequence if w.sequence is not None else 0),
    )
    done = sum(1 for w in wos if w.status == _WO_DONE)
    total = len(wos)
    planned = _f(mo.qty)
    made = _f(made)
    if planned > 0:
        pct = min(100, round(made / planned * 100))
    else:
        # No planned qty to divide by — the order's own status is all there is.
        pct = 100 if mo.status in _MO_DONE else 0
    current = next((w for w in wos if w.status == _WO_RUNNING), None) or next(
        (w for w in wos if w.status not in (_WO_DONE, _WO_RUNNING)), None
    )
    return {
        "mo_id": str(mo.id),
        "mo_code": mo.code,
        "mo_status": mo.status,
        "mo_qty": planned,
        "made": made,
        "output_pct": pct,
        "pct": pct,
        "steps_done": done,
        "steps_total": total,
        "components": [],
        "components_done": 0,
        "components_total": 0,
        "current_stage": _stage_label(current),
        "current_stage_running": bool(current is not None and current.status == _WO_RUNNING),
        "steps": [
            {
                "code": w.code,
                "name": w.name,
                "stage": _stage_label(w),
                "status": w.status,
                "sequence": w.sequence,
            }
            for w in wos
        ],
    }


def _fold_components(node: dict, comps: list) -> dict:
    """Fold pegged component output into the order's headline percentage.

    `comps` is every MO this root depends on at any depth (from
    `_component_coverage`), each carrying the qty THIS order needs of it and the
    qty produced so far. Without this the column read 0% for an order whose warp
    beams and greige were half woven, because all of that output lands on shared
    component MOs and only the finished-goods MO was being measured.

    Weighted **per BOM level, not per order**: a fabric whose greige needs four
    warp beams would otherwise let the beams carry 4/6 of the bar purely because
    there are four of them. Each level contributes an equal share and the orders
    inside a level split it, so the reading is "how far through this item's
    manufacturing stages is it", which is what the floor means by the question.

    Coverage is capped per order, which is what makes a *shared* component safe to
    read here: a beam MO planned for 269 kg against twenty orders is fully covered
    for an order needing 4 kg once 4 kg exist. Quantities cannot be shared without
    double-counting (which is why the qty label still shows finished-goods output
    only, and why `_root_mo_filter` excludes components from `made`) but progress
    fractions can — an upstream lot being ready is genuine progress for every
    order waiting on it. The corollary is that this is a READINESS reading, not an
    allocation: the same 4 kg may also be counted for another order. Allocating it
    properly needs the whole demand set (netting_service's job), which this
    per-page query deliberately does not load.
    """
    node["components"] = comps
    node["components_total"] = len(comps)
    node["components_done"] = sum(1 for c in comps if c["pct"] >= 100)
    if not comps:
        return node
    by_level: dict = {0: [node["output_pct"] / 100]}
    for c in comps:
        by_level.setdefault(c["level"], []).append(c["pct"] / 100)
    levels = [sum(v) / len(v) for _, v in sorted(by_level.items())]
    node["pct"] = min(100, round(sum(levels) / len(levels) * 100))
    return node


def _aggregate_mo_progress(nodes: list) -> dict:
    """Roll several MOs pegged to the same line into one cell.

    Quantities pool across the MOs answering one line: several root MOs for the
    same line are batches of the same demand, so `Σ made / Σ mo.qty` is the line's
    finished-goods output. The headline `pct` (which includes component progress)
    is pooled by planned qty instead, since the levels behind each root MO are not
    commensurable — averaging the rollups is the only honest combination.

    Caveat on an *ambiguous* peg (two lines matching the same item + recipe + size
    + shade): the node is reported to every claimant unsplit, so `made` here
    over-states that line. The SO table therefore draws its qty label from
    `qty_made`, which `fulfilment_map` splits pro-rata; these figures are the
    tooltip's per-order detail. Don't make that label read them.
    """
    steps_total = sum(n["steps_total"] for n in nodes)
    steps_done = sum(n["steps_done"] for n in nodes)
    planned = sum(n["mo_qty"] for n in nodes)
    made = sum(n["made"] for n in nodes)
    if planned > 0:
        output_pct = min(100, round(made / planned * 100))
        pct = min(100, round(sum(n["pct"] * n["mo_qty"] for n in nodes) / planned))
    else:
        # Every pegged MO is qty-less: average their status-derived reading.
        output_pct = round(sum(n["output_pct"] for n in nodes) / len(nodes))
        pct = round(sum(n["pct"] for n in nodes) / len(nodes))
    lead = next((n for n in nodes if n["current_stage_running"]), None) or next(
        (n for n in nodes if n["current_stage"]), None
    )
    return {
        "mo_count": len(nodes),
        "mo_code": (lead or nodes[0])["mo_code"],
        "mo_qty": planned,
        "made": made,
        "output_pct": output_pct,
        "pct": pct,
        "steps_done": steps_done,
        "steps_total": steps_total,
        "components_done": sum(n["components_done"] for n in nodes),
        "components_total": sum(n["components_total"] for n in nodes),
        "current_stage": lead["current_stage"] if lead else None,
        "current_stage_running": bool(lead and lead["current_stage_running"]),
        "mos": nodes,
    }


_MAX_PEG_DEPTH = 8


async def _dependency_edges(db: AsyncSession, root_ids: list) -> tuple[dict, set]:
    """Walk `mo_dependencies` down from these root MOs. -> (edges, component ids)

    `MODependency` is a chain, not a flat root->component list: the dependent side
    is a root MO *or* a shared component one level up (a root needs greige, the
    greige needs warp beams). One query per level rather than a recursive CTE —
    the tree is 2-3 levels deep in practice and this stays portable SQLAlchemy
    core. `_MAX_PEG_DEPTH` is a cycle guard, not a modelling limit.
    """
    edges: dict = {}
    seen = set(root_ids)
    components: set = set()
    frontier = list(root_ids)
    for _ in range(_MAX_PEG_DEPTH):
        if not frontier:
            break
        rows = (
            await db.execute(
                select(
                    MODependency.dependent_mo_id,
                    MODependency.required_mo_id,
                    MODependency.qty,
                ).filter(MODependency.dependent_mo_id.in_(frontier))
            )
        ).all()
        frontier = []
        for dep_id, req_id, qty in rows:
            edges.setdefault(dep_id, []).append((req_id, _f(qty)))
            components.add(req_id)
            if req_id not in seen:
                seen.add(req_id)
                frontier.append(req_id)
    return edges, components


def _component_coverage(root_id, edges: dict, info: dict, made: dict) -> list:
    """Every component this root MO needs, with how much of ITS share exists.

    `share` is the fraction of the dependent MO's plan this order accounts for, so
    a two-level need scales correctly: the root needs `qty` of the greige, and the
    greige's own beam requirement is scaled by the slice of that greige MO this
    order occupies. Without the scaling a 269 kg shared beam would be measured
    against its whole plan and read 12% for an order needing 4 kg of it.
    """
    out: list = []
    stack = [(root_id, 1.0, 1)]
    guard = {root_id}
    while stack:
        mo_id, share, level = stack.pop()
        for req_id, qty in edges.get(mo_id, []):
            row = info.get(req_id)
            if row is None or req_id in guard:
                continue
            guard.add(req_id)
            need = qty * share
            produced = made.get(req_id, 0.0)
            out.append({
                "mo_id": str(req_id),
                "mo_code": row["code"],
                "mo_status": row["status"],
                "level": level,
                "need": need,
                "made": produced,
                "pct": 100 if need <= 0 else min(100, round(produced / need * 100)),
            })
            planned = row["qty"]
            stack.append((req_id, (need / planned) if planned > 0 else 0.0, level + 1))
    return sorted(out, key=lambda c: (c["level"], c["mo_code"]))


async def mo_progress_map(db: AsyncSession, so_ids: list) -> dict:
    """{str(so_line_id): production output} — omitted for lines with no MO.

    Four query groups for the whole page (lines, root MOs with their WOs, the
    dependency levels, then one completion sum over every MO involved), pegged
    with `_mo_claimants` so this and the `made` number beside it always agree on
    which line an MO belongs to. An ambiguous MO (two lines, same item + recipe +
    size + shade) is reported against every claimant unsplit — see
    `_aggregate_mo_progress` on why the qty label must not read that figure.
    """
    so_ids = [i for i in so_ids if i]
    if not so_ids:
        return {}

    line_rows = await _line_rows(db, so_ids)
    if not line_rows:
        return {}

    mos = (
        (
            await db.execute(
                select(ManufacturingOrder)
                .options(
                    selectinload(ManufacturingOrder.work_orders).joinedload(
                        WorkOrder.work_center
                    )
                )
                .filter(
                    ManufacturingOrder.sales_order_id.in_(so_ids),
                    *_root_mo_filter(),
                )
                .order_by(ManufacturingOrder.created_at)
            )
        )
        .scalars()
        .unique()
        .all()
    )
    if not mos:
        return {}

    root_ids = [m.id for m in mos]
    edges, component_ids = await _dependency_edges(db, root_ids)
    info: dict = {}
    if component_ids:
        for cid, code, status, qty in (
            await db.execute(
                select(
                    ManufacturingOrder.id,
                    ManufacturingOrder.code,
                    ManufacturingOrder.status,
                    ManufacturingOrder.qty,
                ).filter(ManufacturingOrder.id.in_(component_ids))
            )
        ).all():
            info[cid] = {"code": code, "status": status, "qty": _f(qty)}

    # Produced qty per MO — roots and components in one pass. Rejected completions
    # are excluded (the QC reject flow returns that qty to the order), matching how
    # `fulfilment_map` counts `made`, so the two never disagree.
    made_by_mo = {
        mo_id: _f(qty)
        for mo_id, qty in (
            await db.execute(
                select(
                    MOCompletion.mo_id,
                    func.coalesce(func.sum(MOCompletion.qty_completed), 0),
                )
                .filter(
                    MOCompletion.mo_id.in_(root_ids + list(component_ids)),
                    MOCompletion.rejected == False,  # noqa: E712 - SQL boolean
                )
                .group_by(MOCompletion.mo_id)
            )
        ).all()
    }

    line_token, bom_size_token = await _size_tokenizer(
        db, line_rows, [m.bom_size_id for m in mos]
    )

    by_line: dict = {}
    for mo in mos:
        claimants = _mo_claimants(
            line_rows,
            line_token,
            mo.sales_order_id,
            mo.item_id,
            mo.bom_id,
            mo.bom_size_id,
            bom_size_token(mo.bom_size_id),
            mo.color_id,
        )
        if not claimants:
            continue
        node = _fold_components(
            _mo_progress_node(mo, made_by_mo.get(mo.id, 0.0)),
            _component_coverage(mo.id, edges, info, made_by_mo),
        )
        for r in claimants:
            by_line.setdefault(str(r[0]), []).append(node)

    return {line_id: _aggregate_mo_progress(nodes) for line_id, nodes in by_line.items()}


def derive_status(lines: list, fulfilment: dict) -> str:
    """Status implied by the fulfilment numbers. Pure — no DB, no mutation.

    Order matters: a partially dispatched order reports PARTIAL even though its
    remaining cartons no longer satisfy the READY test (dispatch removed them
    from stock).

    The threshold is `ordered_base`, not `line.qty` — the four numbers are in the
    item's stock UoM while `qty` is in yards. A line whose denominator can't be
    derived is never counted as met: a stuck PENDING is recoverable by filling in
    the item's weight, a false SENT is a shipment nobody chases.

    A line that counts in an alt unit is judged THERE instead. Same reasoning as
    `packing_service.is_target_met`, one tier up: an order for 2880 Pcs is owed
    2880 pieces whatever they weigh, and judged in kg against a target derived
    from the item's g/y, a physically complete shipment of elastic cloth never
    reached SENT — the cartons are reweighed and the cloth does not hold its
    estimate. The base test stays the fallback, so a line with no alt unit (or one
    whose cartons carry no count) is never judged less correctly than before.
    """
    if not lines:
        return "PENDING"

    def stat(line) -> dict:
        return fulfilment.get(str(line.id), _ZERO)

    def met(line, key: str) -> bool:
        st = stat(line)
        target, got = st["ordered_alt"], st[f"{key}_alt"]
        if target is None or got is None:
            target, got = st["ordered_base"], st[key]
        return target is not None and got is not None and got >= float(target) - EPS

    if all(met(l, "dispatched") for l in lines):
        return "SENT"
    if any(stat(l)["dispatched"] > EPS for l in lines):
        return "PARTIAL"
    if all(met(l, "packed_available") for l in lines):
        return "READY"
    return "PENDING"


async def recompute_so_status(db: AsyncSession, so_id) -> str | None:
    """Re-derive one SO's status. Returns the new status, or None if unchanged.

    Does not commit — the calling endpoint owns the transaction.
    """
    if not so_id:
        return None
    so = (
        await db.execute(
            select(SalesOrder)
            .options(selectinload(SalesOrder.lines))
            .filter(SalesOrder.id == so_id)
        )
    ).scalars().first()
    if not so or so.status not in _RECOMPUTABLE:
        return None

    new_status = derive_status(so.lines, await fulfilment_map(db, [so.id]))
    if new_status == so.status:
        return None
    so.status = new_status
    return new_status


async def recompute_all(db: AsyncSession) -> int:
    """Startup repair pass: re-derive every recomputable SO. Returns rows changed.

    Mirrors `sync_stock_balances()` — the derivation is cheap and idempotent, and
    running it on boot keeps rows written under the old "first MO delivered wins"
    rule from lingering as false READY.
    """
    so_ids = [
        r[0]
        for r in (
            await db.execute(
                select(SalesOrder.id).filter(SalesOrder.status.in_(_RECOMPUTABLE))
            )
        ).all()
    ]
    if not so_ids:
        return 0

    fulfilment = await fulfilment_map(db, so_ids)
    orders = (
        await db.execute(
            select(SalesOrder)
            .options(selectinload(SalesOrder.lines))
            .filter(SalesOrder.id.in_(so_ids))
        )
    ).scalars().all()

    changed = 0
    for so in orders:
        new_status = derive_status(so.lines, fulfilment)
        if new_status != so.status:
            so.status = new_status
            changed += 1
    if changed:
        await db.commit()
    return changed
