"""Work-center dispatch queue — "what can I start next?" for a shop-floor PIC.

This is the operation-level dispatch list every MRP-II system ships (SAP COOIS /
CO24 missing-parts, Oracle Dispatch List, Odoo work-center kanban): the WOs of ONE
work-center type, in scheduled order, each stamped with a material-readiness
verdict. A Dyeing PIC opens it and sees which orders have greige behind them; they
never read a Production Run again.

Two rules make the verdict honest, and both are easy to get wrong:

1. **Allocation, not raw on-hand.** A column showing "greige on hand: 500 kg" makes
   three orders that each need 400 kg all look ready. The pool is therefore a
   MUTABLE ledger consumed in priority order (same shape as
   ``netting_service.Availability``): the first order claims its 400, the rest see
   what is actually left. Colour variants sharing one greige base (Item-B) is
   exactly the case that breaks without this.

2. **Staged stock is still in the pool.** Staging is a two-sided transfer, so
   material moved to a WO's input location is still counted by a plant-wide
   StockBalance sum. Every WO's staged qty is therefore deducted from the pool
   BEFORE anyone allocates (pass 0), or a staged order double-counts its own
   material and the next order in line reads ready when it is not.

Requirement maths deliberately mirror ``api/work_orders._wo_required_rows``
(same percentage/qty formula, no BOM input tolerance applied). If the two diverge,
the queue says READY and the staging modal says SHORT for the same order.

Only the step's SUBSTRATE gates the verdict — the greige for dyeing, the yarn for
warping. Auxiliary chemicals are reported alongside but never turn a row red: a
0.2 kg missing softener must not block a 500 kg dye lot. There is no chemical flag
on Item, so the substrate is the largest requirement of the step, which holds for
every textile routing here (dye chemicals are dosed per 100 kg of substrate).
Weaving is the exception: warp beams are loom resources counted in whole pieces
against ``WorkCenter.beam_slots``, never in kg, so a weaving row is gated by mounts.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select, func, or_, and_, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.work_order import WorkOrder
from app.models.manufacturing import (
    ManufacturingOrder, MOPlannedComponent, MOCompletion, MODependency,
)
from app.models.routing import WorkCenter
from app.models.bom import BOMOperation
from app.models.stock_balance import StockBalance
from app.models.stock_ledger import StockLedger
from app.models.batch import BeamMount
from app.services import beam_service, netting_service
from app.services.stock_service import _generate_variant_key

EPS = 1e-6

# Open-order statuses that still consume material. DELIVERED is excluded: its qty
# is met, so it is not queued work.
QUEUE_STATUSES = ("PENDING", "IN_PROGRESS")

# Same alias map the WO list filter uses — Indonesian center names coexist with
# the English ones on real installs.
CENTER_TYPE_ALIASES: dict[str, list[str]] = {
    "BEAMING": ["BEAMING"],
    "WARPING": ["WARPING"],
    "WEAVING": ["WEAVING", "TENUN"],
    "DYEING": ["DYEING", "CELUP"],
    "SETTING": ["SETTING"],
    "FINISHING": ["FINISHING"],
}

VERDICT_RUNNING = "RUNNING"
VERDICT_STAGED = "STAGED"
VERDICT_READY = "READY"
VERDICT_PARTIAL = "PARTIAL"
VERDICT_WAITING_UPSTREAM = "WAITING_UPSTREAM"
# NOTE: there is deliberately no WAITING_PRIOR verdict. Routing-sequence gating was
# removed from the completion route in 75a5ef58 — the API accepts a log on any open
# WO regardless of earlier steps — so the queue must not report a WO as blocked by
# its predecessor. It told the floor "you cannot run this yet" while the scanner
# happily took the log.
VERDICT_SHORT = "SHORT"
VERDICT_NO_MATERIALS = "NO_MATERIALS"
# The order exists and its material may well be ready, but nobody has cut a work
# order for it, so no operator can start it and it appears on no floor list. On a
# WO-grain queue these orders are simply invisible — which is the failure this
# closes: greige lands, the ticket is never written, the order sits.
VERDICT_NOT_RELEASED = "NOT_RELEASED"

# Sort weight for the queue: the actionable rows float to the top of their date
# band, blocked ones sink. Within a weight, scheduled date decides.
_VERDICT_WEIGHT = {
    VERDICT_RUNNING: 0,
    VERDICT_STAGED: 1,
    VERDICT_READY: 2,
    VERDICT_PARTIAL: 3,
    VERDICT_WAITING_UPSTREAM: 4,
    VERDICT_SHORT: 5,
    VERDICT_NO_MATERIALS: 7,
    # Below the dispatched work: a released order that is ready outranks an order
    # that still needs a ticket written, even when both have material.
    VERDICT_NOT_RELEASED: 8,
}

_FAR_FUTURE = datetime(9999, 12, 31)

# Where a row's priority date came from, most authoritative first. Reported per row
# so the PIC can tell a real plan date from a stand-in: `created` means nobody ever
# scheduled the order and the queue is falling back to order-entry sequence (FIFO).
DATE_SOURCES = ("wo_start", "wo_end", "mo_start", "mo_end", "so_due", "created")


def center_type_ids_query(center_type: str):
    """Work-center ids of a center type (all aliases). Subquery, so it composes
    into the WO filter without a second round trip."""
    types = CENTER_TYPE_ALIASES.get(center_type.upper(), [center_type.upper()])
    return select(WorkCenter.id).where(
        func.upper(WorkCenter.center_type).in_(types)
    ).scalar_subquery()


async def _load_work_orders(db: AsyncSession, center_type: str, work_center_id: str) -> list[WorkOrder]:
    conds = [WorkOrder.status.in_(QUEUE_STATUSES)]
    if work_center_id:
        conds.append(WorkOrder.work_center_id == work_center_id)
    elif center_type:
        conds.append(WorkOrder.work_center_id.in_(center_type_ids_query(center_type)))

    stmt = (
        select(WorkOrder)
        .where(and_(*conds))
        .options(
            joinedload(WorkOrder.work_center),
            joinedload(WorkOrder.manufacturing_order).joinedload(ManufacturingOrder.item),
            joinedload(WorkOrder.manufacturing_order).selectinload(
                ManufacturingOrder.planned_components
            ).joinedload(MOPlannedComponent.item),
            joinedload(WorkOrder.manufacturing_order).joinedload(ManufacturingOrder.color),
        )
    )
    return list((await db.execute(stmt)).unique().scalars().all())


async def _op_center_types(db: AsyncSession, op_ids: list) -> dict[str, str]:
    """bom_operation_id -> center_type of the work center that step runs on.
    Bulk version of the per-WO lookup in ``_wo_step_components`` step 2."""
    if not op_ids:
        return {}
    rows = await db.execute(
        select(BOMOperation.id, WorkCenter.center_type)
        .join(WorkCenter, BOMOperation.work_center_id == WorkCenter.id)
        .where(BOMOperation.id.in_(list(op_ids)))
    )
    return {str(oid): (ct or "") for oid, ct in rows.all()}


def _step_components(wo: WorkOrder, mo: ManufacturingOrder, wc_type: str,
                     op_types: dict[str, str], beam_ids: set[str]) -> list[MOPlannedComponent]:
    """Which planned components this WO's step consumes. Same layered detection as
    ``api/work_orders._wo_step_components`` (exact op -> same center type -> weaving
    beams -> untagged lines), rewritten against pre-fetched maps so a 200-row queue
    does not fire four queries per row."""
    comps = list(mo.planned_components or [])
    if not comps:
        return []

    if wo.bom_operation_id:
        exact = [c for c in comps
                 if c.bom_operation_id and str(c.bom_operation_id) == str(wo.bom_operation_id)]
        if exact:
            return exact

    if not wo.work_center_id:
        return []

    if wc_type:
        by_type = [c for c in comps
                   if c.bom_operation_id and op_types.get(str(c.bom_operation_id)) == wc_type]
        if by_type:
            return by_type

    if wc_type.upper() in beam_service.WEAVING_TYPES:
        beams = [c for c in comps if str(c.item_id) in beam_ids]
        if beams:
            return beams

    return [c for c in comps if not c.bom_operation_id]


def _required_qty(wo: Optional[WorkOrder], mo: ManufacturingOrder, c: MOPlannedComponent) -> float:
    """Requirement for this WO's run size. Mirrors _wo_required_rows exactly —
    percentage-of-output first, else qty-per-unit. No BOM input tolerance: the
    staging screen does not apply it either, and a queue that promises more than
    staging demands would read READY on an order staging then refuses."""
    wo_qty = float((wo.qty if wo is not None else None) or mo.qty or 0)
    if c.percentage:
        return (wo_qty * float(c.percentage)) / 100
    if c.qty:
        return wo_qty * float(c.qty)
    return 0.0


async def _staged_by_wo(db: AsyncSession, wos: list[WorkOrder]) -> dict[tuple[str, str], float]:
    """(wo_id, item_id) -> qty currently staged to that WO's input location.
    One grouped query for the whole queue; the per-WO helper in api/work_orders
    runs one query per WO. Signed sum, so an unstage reversal nets back out —
    keep this in step with _wo_staged_by_item there."""
    wo_ids = [str(w.id) for w in wos if w.input_location_id]
    if not wo_ids:
        return {}
    rows = await db.execute(
        select(StockLedger.reference_id, StockLedger.item_id, StockLedger.location_id,
               func.sum(StockLedger.qty_change))
        .where(
            StockLedger.reference_type == "Staging",
            StockLedger.reference_id.in_(wo_ids),
        )
        .group_by(StockLedger.reference_id, StockLedger.item_id, StockLedger.location_id)
    )
    input_loc = {str(w.id): str(w.input_location_id) for w in wos if w.input_location_id}
    out: dict[tuple[str, str], float] = {}
    for ref, item_id, loc_id, qty in rows.all():
        # Staging rows are written to the WO input location; a WO re-pointed at a
        # different input since then must not count stock left at the old one.
        if input_loc.get(str(ref)) != str(loc_id):
            continue
        out[(str(ref), str(item_id))] = out.get((str(ref), str(item_id)), 0.0) + float(qty or 0)
    return {k: max(0.0, v) for k, v in out.items()}


async def _on_hand_pool(db: AsyncSession, item_ids: set[str]) -> dict[tuple[str, str], float]:
    """(item_id, variant_key) -> good on-hand, summed plant-wide.

    Location-agnostic by design (single plant, see CLAUDE.md netting notes) and
    QC-rejected / disposed lots are excluded through the same subquery the MRP
    netting uses, so a rejected greige lot never makes an order look ready."""
    if not item_ids:
        return {}
    rows = await db.execute(
        select(StockBalance.item_id, StockBalance.variant_key, func.sum(StockBalance.qty))
        .where(
            StockBalance.item_id.in_([uuid.UUID(i) for i in item_ids]),
            StockBalance.qty > 0,
            or_(
                StockBalance.batch_key == "",
                StockBalance.batch_key.notin_(netting_service.rejected_batch_keys()),
            ),
        )
        .group_by(StockBalance.item_id, StockBalance.variant_key)
    )
    return {(str(i), v or ""): float(q or 0) for i, v, q in rows.all()}


async def _mo_logged_qty(db: AsyncSession, mo_ids: list) -> dict[str, float]:
    """MO -> good qty logged so far (rejected completions excluded)."""
    if not mo_ids:
        return {}
    rows = await db.execute(
        select(MOCompletion.mo_id, func.sum(MOCompletion.qty_completed))
        .where(MOCompletion.mo_id.in_(list(mo_ids)), MOCompletion.rejected == False)  # noqa: E712
        .group_by(MOCompletion.mo_id)
    )
    return {str(m): float(q or 0) for m, q in rows.all()}


async def _pegged_supply(db: AsyncSession, mo_ids: list) -> dict[tuple[str, str], dict]:
    """(dependent_mo_id, produced_item_id) -> {qty, mo_code, eta}.

    The MRP pegging table already records which component MO each order waits on,
    so "waiting upstream" is answered exactly — this order waits on MO-0399, due
    Thursday — instead of guessing from a plant-wide incoming total."""
    if not mo_ids:
        return {}
    rows = await db.execute(
        select(MODependency.dependent_mo_id, ManufacturingOrder)
        .join(ManufacturingOrder, MODependency.required_mo_id == ManufacturingOrder.id)
        .where(
            MODependency.dependent_mo_id.in_(list(mo_ids)),
            ManufacturingOrder.status.in_(netting_service.ONGOING),
        )
    )
    pairs = rows.all()
    if not pairs:
        return {}
    logged = await _mo_logged_qty(db, [m.id for _, m in pairs])

    out: dict[tuple[str, str], dict] = {}
    for dep_id, req_mo in pairs:
        outstanding = max(0.0, float(req_mo.qty or 0) - logged.get(str(req_mo.id), 0.0))
        if outstanding <= EPS:
            continue
        key = (str(dep_id), str(req_mo.item_id))
        cur = out.setdefault(key, {"qty": 0.0, "mo_code": req_mo.code, "eta": req_mo.target_end_date})
        cur["qty"] += outstanding
        # Report the LAST arrival — the order is only unblocked once every pegged
        # supplier has landed, so the earliest ETA would be an optimistic lie.
        if req_mo.target_end_date and (not cur["eta"] or req_mo.target_end_date > cur["eta"]):
            cur["eta"] = req_mo.target_end_date
    return out


async def _so_due_dates(db: AsyncSession, mos: list) -> dict[str, datetime]:
    """mo_id -> earliest customer due date behind that order.

    The due date lives on SalesOrderLine, not the header, and an MO reaches its SO
    either directly or through its Production Run — so both paths are resolved and
    the earliest line date wins (the order is late the moment its first line is)."""
    from app.models.sales import SalesOrderLine
    from app.models.production_run import ProductionRun

    pr_ids = {m.production_run_id for m in mos if m.production_run_id and not m.sales_order_id}
    pr_to_so: dict[str, uuid.UUID] = {}
    if pr_ids:
        rows = await db.execute(
            select(ProductionRun.id, ProductionRun.sales_order_id)
            .where(ProductionRun.id.in_(list(pr_ids)), ProductionRun.sales_order_id.is_not(None))
        )
        pr_to_so = {str(p): s for p, s in rows.all()}

    mo_to_so: dict[str, uuid.UUID] = {}
    for m in mos:
        so = m.sales_order_id or pr_to_so.get(str(m.production_run_id))
        if so:
            mo_to_so[str(m.id)] = so
    if not mo_to_so:
        return {}

    rows = await db.execute(
        select(SalesOrderLine.sales_order_id, func.min(SalesOrderLine.due_date))
        .where(
            SalesOrderLine.sales_order_id.in_(set(mo_to_so.values())),
            SalesOrderLine.due_date.is_not(None),
        )
        .group_by(SalesOrderLine.sales_order_id)
    )
    by_so = {str(s): d for s, d in rows.all()}
    return {mo_id: by_so[str(so)] for mo_id, so in mo_to_so.items() if str(so) in by_so}


def _priority_date(wo: Optional[WorkOrder], mo: ManufacturingOrder,
                   so_due: dict[str, datetime]) -> tuple[datetime, str]:
    """The date this row is queued on, and where it came from.

    Falls back down the planning chain rather than dropping undated rows to the
    bottom: on real data most work orders carry no target date, and a queue that
    parks 100+ of them in one undifferentiated tail is not a schedule. The last
    resort is the order's creation time — FIFO by order entry, which is at least a
    defensible rule, unlike alphabetical-by-code."""
    if wo is not None and wo.target_start_date:
        return wo.target_start_date, "wo_start"
    if wo is not None and wo.target_end_date:
        return wo.target_end_date, "wo_end"
    if mo.target_start_date:
        return mo.target_start_date, "mo_start"
    if mo.target_end_date:
        return mo.target_end_date, "mo_end"
    due = so_due.get(str(mo.id))
    if due:
        return due, "so_due"
    return mo.created_at or _FAR_FUTURE, "created"


async def _load_unreleased_mos(db: AsyncSession) -> list[ManufacturingOrder]:
    """Open MOs that have no work order at all.

    These are invisible to a WO-grain queue, which is the hole this closes: on real
    data most open production has not been dispatched yet, so a Dyeing PIC watching
    only work orders never learns that an order is sitting there with its greige
    ready and nobody has cut the ticket."""
    no_wo = ~select(WorkOrder.id).where(
        WorkOrder.manufacturing_order_id == ManufacturingOrder.id
    ).exists()
    stmt = (
        select(ManufacturingOrder)
        .where(ManufacturingOrder.status.in_(QUEUE_STATUSES), no_wo)
        .options(
            joinedload(ManufacturingOrder.item),
            joinedload(ManufacturingOrder.color),
            selectinload(ManufacturingOrder.planned_components).joinedload(MOPlannedComponent.item),
        )
    )
    return list((await db.execute(stmt)).unique().scalars().all())


async def _bom_center_types(db: AsyncSession, mos: list) -> tuple[dict[str, str], dict[str, str]]:
    """(routing map, header map), both bom_id -> center type.

    Two independent places record where a BOM is made, and they are not the same
    thing:

    - ``BOMOperation`` — the full routing, one row per step. The precise answer to
      "which operation comes next". Unpopulated on this install (zero rows).
    - ``BOM.work_center_id`` — a single work centre set on the BOM header when the
      recipe is created. Populated on 190 of 344 BOMs here, so in practice this is
      the signal that actually works, and it is a recorded decision rather than an
      inference from the item.

    Routing wins where both exist; the header carries everything else."""
    bom_ids = {m.bom_id for m in mos if m.bom_id}
    if not bom_ids:
        return {}, {}

    routing: dict[str, str] = {}
    rows = await db.execute(
        select(BOMOperation.bom_id, BOMOperation.sequence, WorkCenter.center_type)
        .join(WorkCenter, BOMOperation.work_center_id == WorkCenter.id)
        .where(BOMOperation.bom_id.in_(list(bom_ids)))
        .order_by(BOMOperation.bom_id, BOMOperation.sequence)
    )
    for bom_id, _seq, ct in rows.all():
        routing.setdefault(str(bom_id), (ct or "").upper())

    from app.models.bom import BOM
    hdr_rows = await db.execute(
        select(BOM.id, WorkCenter.center_type)
        .join(WorkCenter, BOM.work_center_id == WorkCenter.id)
        .where(BOM.id.in_(list(bom_ids)))
    )
    header = {str(b): (ct or "").upper() for b, ct in hdr_rows.all()}
    return routing, header


def _release_hint(mo: ManufacturingOrder, routing: dict[str, str], header: dict[str, str],
                  beam_ids: set[str]) -> tuple[str, str]:
    """(center type this unreleased order needs, how we know). Best evidence first:

    - ``routing`` — the BOM's own routing steps (BOMOperation). A per-step fact.
    - ``bom``     — the work centre assigned on the BOM header at creation. A
      recorded decision, and the one that is actually populated here.
    - ``colour``  — ``MO.color_id`` is set, so a shade was deliberately assigned to
      this order and it must pass through dyeing.
    - ``beam``    — the output is a warp beam by ``beam_service``'s definition.

    ``Item.variant_type == 'color'`` is deliberately NOT used, though it looks
    tempting: on this install it is set on greige and beam items as well as finished
    goods (ITM-21 GRIGE, BEAM A ITM-21), so it would drop warping and weaving orders
    into the dyeing queue. A PIC tab that is wrong is worse than one that is short.

    ``unknown`` means we genuinely cannot say. Those rows appear ONLY in the
    unfiltered queue, never inside a work centre's tab — the queue does not guess
    which floor an order belongs to."""
    ct = routing.get(str(mo.bom_id))
    if ct:
        return ct, "routing"
    ct = header.get(str(mo.bom_id))
    if ct:
        return ct, "bom"
    if mo.color_id:
        return "DYEING", "colour"
    if mo.item and str(mo.item.id) in beam_ids:
        return "BEAMING", "beam"
    return "", "unknown"


async def _beam_readiness(db: AsyncSession, wcs: set, item_ids: set) -> dict[tuple[str, str], tuple[int, float]]:
    """(work_center_id, item_id) -> (mounted pcs, mounted kg) for open mounts.

    One query over the loom's live balances instead of beam_service.active_mounts
    per WO — the queue can hold every loom in the plant."""
    if not wcs or not item_ids:
        return {}
    rows = await db.execute(
        select(BeamMount.work_center_id, BeamMount.item_id, BeamMount.batch_id, StockBalance.qty)
        .outerjoin(
            StockBalance,
            and_(
                StockBalance.item_id == BeamMount.item_id,
                StockBalance.location_id == BeamMount.location_id,
                StockBalance.variant_key == "",
                StockBalance.batch_key == cast(BeamMount.batch_id, String),
            ),
        )
        .where(
            BeamMount.work_center_id.in_(list(wcs)),
            BeamMount.item_id.in_(list(item_ids)),
            BeamMount.dismounted_at.is_(None),
        )
    )
    out: dict[tuple[str, str], tuple[int, float]] = {}
    for wc_id, item_id, _batch, qty in rows.all():
        remaining = float(qty or 0)
        pcs, kg = out.get((str(wc_id), str(item_id)), (0, 0.0))
        # A depleted-but-not-yet-dismounted beam holds a slot but no warp.
        out[(str(wc_id), str(item_id))] = (pcs + (1 if remaining > EPS else 0), kg + remaining)
    return out


async def build_queue(
    db: AsyncSession,
    center_type: str = "",
    work_center_id: str = "",
    search: str = "",
    sort: str = "date",
    include_unreleased: bool = True,
    now: Optional[datetime] = None,
) -> tuple[list[dict], list[dict]]:
    """(dispatch rows, gating-material summary). Plain dicts, serialized upstream."""
    now = now or datetime.utcnow()
    wos = await _load_work_orders(db, center_type, work_center_id)
    # Orders nobody has dispatched yet. Skipped when the caller narrowed to one
    # machine: unreleased work is not assigned to a machine, so it cannot honestly
    # answer a per-machine question.
    unreleased = [] if (work_center_id or not include_unreleased) else await _load_unreleased_mos(db)
    if not wos and not unreleased:
        return [], []

    # --- bulk prefetch -----------------------------------------------------
    wc_types = {
        str(w.work_center_id): (w.work_center.center_type or "")
        for w in wos if w.work_center_id and w.work_center
    }
    all_mos = [w.manufacturing_order for w in wos] + unreleased
    all_comps = [c for m in all_mos for c in (m.planned_components or [])]
    op_types = await _op_center_types(db, {c.bom_operation_id for c in all_comps if c.bom_operation_id})
    beam_ids = await beam_service.beam_item_ids(
        db, [c.item_id for c in all_comps] + [m.item_id for m in unreleased]
    )

    routing, bom_header = await _bom_center_types(db, unreleased)
    if unreleased and center_type:
        want = set(CENTER_TYPE_ALIASES.get(center_type.upper(), [center_type.upper()]))
        unreleased = [m for m in unreleased if _release_hint(m, routing, bom_header, beam_ids)[0] in want]
        all_mos = [w.manufacturing_order for w in wos] + unreleased

    staged = await _staged_by_wo(db, wos)
    pegged = await _pegged_supply(db, [m.id for m in all_mos])
    so_due = await _so_due_dates(db, all_mos)

    # --- resolve each WO's step materials ----------------------------------
    resolved: list[dict] = []
    for w in wos:
        mo = w.manufacturing_order
        wc_type = wc_types.get(str(w.work_center_id), "")
        comps = _step_components(w, mo, wc_type, op_types, beam_ids)
        mats = []
        for c in comps:
            req = _required_qty(w, mo, c)
            if req <= 0:
                continue
            mats.append({
                "comp": c,
                "required": req,
                "variant_key": _generate_variant_key(list(c.attribute_value_ids or [])),
                "is_beam": str(c.item_id) in beam_ids,
                "staged": staged.get((str(w.id), str(c.item_id)), 0.0),
            })
        pdate, psource = _priority_date(w, mo, so_due)
        resolved.append({
            "wo": w, "mo": mo, "wc_type": wc_type, "mats": mats,
            "priority_date": pdate, "date_source": psource,
            "released": True, "hint_source": "",
        })

    # Unreleased orders enter the SAME list, so they compete for stock in date order
    # alongside dispatched work. Leaving them out would let a released order read
    # READY against greige an earlier, undispatched order is already entitled to.
    for mo in unreleased:
        hint_ct, hint_src = _release_hint(mo, routing, bom_header, beam_ids)
        mats = []
        # No routing step to filter by, so the whole BOM snapshot is the requirement.
        for c in (mo.planned_components or []):
            req = _required_qty(None, mo, c)
            if req <= 0:
                continue
            mats.append({
                "comp": c,
                "required": req,
                "variant_key": _generate_variant_key(list(c.attribute_value_ids or [])),
                "is_beam": str(c.item_id) in beam_ids,
                "staged": 0.0,   # nothing can be staged without a WO to stage it to
            })
        pdate, psource = _priority_date(None, mo, so_due)
        resolved.append({
            "wo": None, "mo": mo, "wc_type": hint_ct, "mats": mats,
            "priority_date": pdate, "date_source": psource,
            "released": False, "hint_source": hint_src,
        })

    beam_state = await _beam_readiness(
        db,
        {r["wo"].work_center_id for r in resolved if r["wo"] is not None and r["wo"].work_center_id},
        {m["comp"].item_id for r in resolved for m in r["mats"] if m["is_beam"]},
    )
    pool = await _on_hand_pool(
        db, {str(m["comp"].item_id) for r in resolved for m in r["mats"] if not m["is_beam"]}
    )

    # --- pass 0: staged stock is already physically claimed ----------------
    # It still sits in a StockBalance row (staging is a transfer, not an issue), so
    # leaving it in the pool would let the NEXT order allocate material that is
    # already on someone else's line.
    for r in resolved:
        for m in r["mats"]:
            if m["is_beam"] or m["staged"] <= EPS:
                continue
            key = (str(m["comp"].item_id), m["variant_key"])
            pool[key] = max(0.0, pool.get(key, 0.0) - m["staged"])

    # --- pass 1: allocate in scheduled order -------------------------------
    # This order decides who gets scarce stock, so it is ALWAYS by date — the
    # display sort below may differ, but stock is never allocated by readiness
    # (that would be circular: ready because it allocated, allocated because ready).
    resolved.sort(key=lambda r: (
        r["priority_date"] or _FAR_FUTURE,
        int((r["wo"].sequence if r["wo"] is not None else 0) or 0),
        (r["wo"].code if r["wo"] is not None else r["mo"].code) or "",
    ))

    # Beam readiness has to be known BEFORE the substrate is picked: a loom fed by
    # two warps (BEAM A + BEAM B) is gated by whichever one is missing, not by
    # whichever one is bigger.
    for r in resolved:
        for m in r["mats"]:
            if m["is_beam"]:
                wc_id = r["wo"].work_center_id if r["wo"] is not None else None
                m["mounted_pcs"] = beam_state.get(
                    (str(wc_id), str(m["comp"].item_id)), (0, 0.0)
                )[0] if wc_id else 0

    rows: list[dict] = []
    for r in resolved:
        w, mo, mats = r["wo"], r["mo"], r["mats"]
        released = r["released"]
        # An unreleased order has no work centre, so it has no beam slots and no
        # staging; everything WO-shaped below reads through these guards.
        wc = w.work_center if w is not None else None
        slots = max(1, int((wc.beam_slots if wc else 1) or 1))
        wc_id = w.work_center_id if w is not None else None
        substrate = _pick_substrate(mats)
        materials_out = []
        allocated_map: dict[str, float] = {}

        for m in mats:
            c = m["comp"]
            gates = substrate is not None and m is substrate
            if m["is_beam"]:
                pcs, kg = beam_state.get((str(wc_id), str(c.item_id)), (0, 0.0)) if wc_id else (0, 0.0)
                materials_out.append({
                    "item_id": c.item_id,
                    "item_code": c.item.code if c.item else None,
                    "item_name": c.item.name if c.item else None,
                    "uom": c.item.uom if c.item else None,
                    "required_qty": m["required"], "staged_qty": 0.0,
                    "on_hand_qty": kg, "allocated_qty": kg, "shortfall_qty": 0.0,
                    "is_beam": True, "is_substrate": gates,
                    "mounted_pcs": pcs,
                    "required_pcs": slots,
                    "incoming_qty": 0.0, "incoming_mo_code": None, "incoming_eta": None,
                })
                continue

            key = (str(c.item_id), m["variant_key"])
            need = max(0.0, m["required"] - m["staged"])
            available = pool.get(key, 0.0)
            got = min(available, need)
            pool[key] = available - got
            allocated_map[str(c.item_id)] = got
            peg = pegged.get((str(mo.id), str(c.item_id))) or {}
            materials_out.append({
                "item_id": c.item_id,
                "item_code": c.item.code if c.item else None,
                "item_name": c.item.name if c.item else None,
                "uom": c.item.uom if c.item else None,
                "required_qty": m["required"],
                "staged_qty": m["staged"],
                # on_hand is what was free when THIS row's turn came, not the raw
                # plant total — that is the whole point of the running ledger.
                "on_hand_qty": available,
                "allocated_qty": got,
                "shortfall_qty": max(0.0, need - got),
                "is_beam": False, "is_substrate": gates,
                "mounted_pcs": 0, "required_pcs": 0,
                "incoming_qty": float(peg.get("qty") or 0),
                "incoming_mo_code": peg.get("mo_code"),
                "incoming_eta": peg.get("eta"),
            })

        if released:
            verdict, detail = _verdict(w, substrate, materials_out)
        else:
            verdict, detail = _unreleased_verdict(substrate, materials_out, r["hint_source"])
        chem_short = [
            m for m in materials_out
            if not m["is_substrate"] and not m["is_beam"] and m["shortfall_qty"] > EPS
        ]
        rows.append({
            "work_order_id": w.id if w is not None else None,
            "work_order_code": w.code if w is not None else None,
            "work_order_name": w.name if w is not None else None,
            "status": w.status if w is not None else mo.status,
            "sequence": w.sequence if w is not None else None,
            "staging_status": (w.staging_status or "NOT_STAGED") if w is not None else "NOT_STAGED",
            "is_released": released,
            # How the centre type was decided for an unreleased row: routing (a fact
            # from the BOM) vs colour/beam (inferred from the order's own output) vs
            # unknown. Blank on released rows — their work centre is not a guess.
            "release_hint_source": r["hint_source"],
            "work_center_id": wc_id,
            "work_center_name": wc.name if wc else None,
            "work_center_type": r["wc_type"],
            "mo_id": mo.id,
            "mo_code": mo.code,
            "item_code": mo.item.code if mo.item else None,
            "item_name": mo.item.name if mo.item else None,
            "color_name": mo.color.name if mo.color else None,
            "qty": float((w.qty if w is not None else None) or mo.qty or 0),
            "target_start_date": (w.target_start_date if w is not None else None) or mo.target_start_date,
            "priority_date": r["priority_date"],
            "date_source": r["date_source"],
            # Only a real planned date can be late. `created` is a stand-in for a
            # missing schedule, so flagging it overdue would paint the whole queue red.
            "is_overdue": bool(
                r["date_source"] != "created"
                and r["priority_date"] and r["priority_date"] < now
                and (w.status if w is not None else mo.status) != "IN_PROGRESS"
            ),
            "verdict": verdict,
            "verdict_detail": detail,
            "substrate_item_code": (substrate and substrate["comp"].item and substrate["comp"].item.code) or None,
            # Beam rows report kg like every other substrate: the run's warp
            # requirement against the kg left on the mounted beams. Readiness still
            # gates on pieces inside _verdict (a warp is up or it isn't), but the
            # slot count is not surfaced — it answers a question nobody asked.
            "substrate_is_beam": bool(substrate and substrate["is_beam"]),
            "substrate_uom": (
                (substrate["comp"].item.uom if substrate["comp"].item else None)
                if substrate else None
            ),
            "substrate_required_qty": float(substrate["required"]) if substrate else 0.0,
            "substrate_available_qty": (
                float(beam_state.get((str(wc_id), str(substrate["comp"].item_id)), (0, 0.0))[1])
                if substrate and substrate["is_beam"] and wc_id
                else (allocated_map.get(str(substrate["comp"].item_id), 0.0) + substrate["staged"]
                      if substrate and not substrate["is_beam"] else 0.0)
            ),
            "chemical_shortfall_count": len(chem_short),
            "materials": materials_out,
        })

    if search:
        term = search.strip().lower()
        rows = [
            r for r in rows
            if term in (r["work_order_code"] or "").lower()
            or term in (r["mo_code"] or "").lower()
            or term in (r["item_code"] or "").lower()
            or term in (r["item_name"] or "").lower()
            or term in (r["color_name"] or "").lower()
        ]

    # Built from the SAME allocation walk the rows came from, so the panel and the
    # list can never disagree about how much greige is left.
    summary = await _gating_material_summary(db, rows, pool)

    # Default is date order — a schedule the PIC can read against the calendar, with
    # readiness carried as the chip and the filter. Sorting by readiness first would
    # sink an order that is due tomorrow and short below one that is ready and due
    # next month, which is precisely the thing the PIC must be told about.
    if sort == "readiness":
        rows.sort(key=lambda r: (
            _VERDICT_WEIGHT.get(r["verdict"], 9),
            r["priority_date"] or _FAR_FUTURE,
            r["work_order_code"] or r["mo_code"] or "",
        ))
    else:
        rows.sort(key=lambda r: (
            r["priority_date"] or _FAR_FUTURE,
            _VERDICT_WEIGHT.get(r["verdict"], 9),
            r["work_order_code"] or r["mo_code"] or "",
        ))
    return rows, summary


def _pick_substrate(mats: list[dict]) -> Optional[dict]:
    """The material that gates the step.

    Beams win outright — a loom without warp cannot run whatever else is staged —
    and among several beams the gate is the LEAST mounted one, not the largest: a
    loom fed by BEAM A and BEAM B is not ready until both warps are up. For
    everything else the gate is the largest requirement, which is the substrate in
    every routing here (dye chemicals are dosed per 100 kg of it and come out an
    order of magnitude smaller)."""
    if not mats:
        return None
    beams = [m for m in mats if m["is_beam"]]
    if beams:
        return min(beams, key=lambda m: (m.get("mounted_pcs", 0), -m["required"]))
    return max(mats, key=lambda m: m["required"])


async def _gating_material_summary(db: AsyncSession, rows: list[dict],
                                   pool: dict[tuple[str, str], float]) -> list[dict]:
    """Stock-side view of the same queue: per gating material, what is on hand, what
    the queue has claimed, what is left, and which lots it sits in.

    This is the question a Dyeing PIC actually asks — "which greige can I dye?" —
    and it is not answerable from the order list alone, because most open orders
    carry no work order and some carry no schedule. Numbers come out of the SAME
    allocation walk the rows did, so the panel can never contradict the list.
    """
    agg: dict[str, dict] = {}
    for r in rows:
        for m in r["materials"]:
            if not m["is_substrate"] or m["is_beam"]:
                continue
            item_id = str(m["item_id"])
            a = agg.setdefault(item_id, {
                "item_id": m["item_id"], "item_code": m["item_code"], "item_name": m["item_name"],
                "uom": m.get("uom"),
                "required_total": 0.0, "allocated_total": 0.0, "staged_total": 0.0,
                "shortfall_total": 0.0, "orders_waiting": 0, "orders_total": 0,
                "free_qty": 0.0, "lots": [],
            })
            a["required_total"] += m["required_qty"]
            a["allocated_total"] += m["allocated_qty"]
            a["staged_total"] += m["staged_qty"]
            a["shortfall_total"] += m["shortfall_qty"]
            a["orders_total"] += 1
            if m["shortfall_qty"] > EPS:
                a["orders_waiting"] += 1
    if not agg:
        return []

    # What the walk left unclaimed, across every variant of the item.
    for (item_id, _vkey), qty in pool.items():
        if item_id in agg:
            agg[item_id]["free_qty"] += max(0.0, qty)

    # Lots behind the free stock — the PIC picks a physical roll, not a number.
    from app.models.batch import Batch
    from app.models.location import Location
    lot_rows = await db.execute(
        select(StockBalance.item_id, StockBalance.batch_key, func.sum(StockBalance.qty),
               Batch.batch_number, Location.name)
        .outerjoin(Batch, cast(Batch.id, String) == StockBalance.batch_key)
        .outerjoin(Location, Location.id == StockBalance.location_id)
        .where(
            StockBalance.item_id.in_([uuid.UUID(i) for i in agg]),
            StockBalance.qty > 0,
            StockBalance.batch_key != "",
            StockBalance.batch_key.notin_(netting_service.rejected_batch_keys()),
        )
        .group_by(StockBalance.item_id, StockBalance.batch_key, Batch.batch_number, Location.name)
        .order_by(Batch.batch_number)
    )
    for item_id, batch_key, qty, batch_number, loc_name in lot_rows.all():
        a = agg.get(str(item_id))
        if a is not None:
            a["lots"].append({
                "batch_id": batch_key,
                "batch_number": batch_number or batch_key,
                "qty": float(qty or 0),
                "location_name": loc_name,
            })

    # Real balance, not allocated + staged + free. Those three do not add up to it:
    # `staged_total` is a historical sum of Staging ledger rows and deliberately
    # keeps counting material that has since been consumed (same semantics as
    # api/work_orders._wo_staged_by_item), so deriving on-hand from it overstates
    # the shelf. The panel must show what is physically there.
    real_rows = await db.execute(
        select(StockBalance.item_id, func.sum(StockBalance.qty))
        .where(
            StockBalance.item_id.in_([uuid.UUID(i) for i in agg]),
            StockBalance.qty > 0,
            or_(
                StockBalance.batch_key == "",
                StockBalance.batch_key.notin_(netting_service.rejected_batch_keys()),
            ),
        )
        .group_by(StockBalance.item_id)
    )
    real = {str(i): float(q or 0) for i, q in real_rows.all()}

    out = list(agg.values())
    for a in out:
        a["on_hand_qty"] = real.get(str(a["item_id"]), 0.0)
        a["lot_count"] = len(a["lots"])
        # Longest lot lists are noise on a floor screen; the total stays exact.
        a["lots"] = sorted(a["lots"], key=lambda l: -l["qty"])[:12]
    # Shortest supply first — that is what needs a decision.
    out.sort(key=lambda a: (-a["shortfall_total"], a["item_code"] or ""))
    return out


def _unreleased_verdict(substrate: Optional[dict], materials: list[dict],
                        hint_source: str) -> tuple[str, Optional[str]]:
    """Verdict for an order with no work order yet.

    The verdict itself is always NOT_RELEASED — that is the action needed — but the
    detail line carries the material answer, because "no work order, greige ready"
    and "no work order, greige short 120" call for very different responses from the
    planner."""
    if not substrate:
        return VERDICT_NOT_RELEASED, "No work order - no materials on the order"
    row = next((m for m in materials if m["is_substrate"]), None)
    if row is None:
        return VERDICT_NOT_RELEASED, "No work order"

    if row["is_beam"]:
        mat = "beam mounted" if row["mounted_pcs"] > 0 else "no beam mounted"
    elif row["shortfall_qty"] <= EPS:
        mat = "material ready"
    elif row["allocated_qty"] > EPS:
        mat = f"only {row['allocated_qty']:.1f} of {row['required_qty']:.1f} available"
    elif row["incoming_qty"] > EPS:
        mat = f"waiting on {row['incoming_mo_code'] or 'upstream order'}"
    else:
        mat = f"short {row['shortfall_qty']:.1f}"

    # An inferred work centre is flagged so nobody treats a guess as a routing fact.
    guess = " (centre inferred)" if hint_source in ("colour", "beam") else ""
    return VERDICT_NOT_RELEASED, f"No work order - {mat}{guess}"


def _verdict(wo: WorkOrder, substrate: Optional[dict], materials: list[dict]) -> tuple[str, Optional[str]]:
    if wo.status == "IN_PROGRESS":
        return VERDICT_RUNNING, None
    if not substrate:
        return VERDICT_NO_MATERIALS, "No materials resolved for this step"

    row = next((m for m in materials if m["is_substrate"]), None)
    if row is None:
        return VERDICT_NO_MATERIALS, None

    if row["is_beam"]:
        # beam_slots still decides READY vs PARTIAL — it is the only honest measure
        # of a warped loom — but the number itself stays out of the detail line.
        need_pcs = max(1, int(row["required_pcs"] or 1))
        if row["mounted_pcs"] >= need_pcs:
            return VERDICT_STAGED, "warp mounted"
        if row["mounted_pcs"] > 0:
            return VERDICT_PARTIAL, "warp partly mounted"
        return VERDICT_SHORT, "no warp mounted"

    need = row["required_qty"] - row["staged_qty"]
    if need <= EPS:
        return VERDICT_STAGED, None
    if row["shortfall_qty"] <= EPS:
        return VERDICT_READY, None
    if row["allocated_qty"] > EPS:
        return VERDICT_PARTIAL, f"{row['allocated_qty']:.1f} of {need:.1f} available"
    if row["incoming_qty"] > EPS:
        eta = row["incoming_eta"]
        when = f" due {eta.strftime('%d %b')}" if eta else ""
        return VERDICT_WAITING_UPSTREAM, f"{row['incoming_mo_code'] or 'upstream order'}{when}"
    return VERDICT_SHORT, f"short {row['shortfall_qty']:.1f}"
