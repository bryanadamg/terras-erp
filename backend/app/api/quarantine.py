"""Quarantine Packing — the QC hold desk between production output and packing.

Everything sitting in a quarantine location (see services/quarantine_service.py)
shows here, grouped by the MO that produced it. QC dispositions each **lot**;
the MO row is a rollup, so a partially-passed batch releases its good lots
without waiting on the rest. Only a lot dispositioned OK may be packed — the
gate itself lives in api/packing.py via `assert_lots_released`.

The status list is a system attribute, not an enum: the client adds values on
the Attributes page. Only the *passing* value is fixed in code, because it is a
gate rather than a label.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, cast, String
from sqlalchemy.orm import aliased, selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.models.attribute import Attribute, AttributeValue
from app.models.auth import User
from app.models.batch import Batch
from app.models.item import Item
from app.models.location import Location
from app.models.manufacturing import ManufacturingOrder, manufacturing_order_values
from app.models.packing import PackingOrder, PackingCompletion
from app.models.production_run import ProductionRun
from app.models.sales import SalesOrder
from app.models.color import Color
from app.models.stock_balance import StockBalance
from app.models.work_order import WorkOrder
from app.api.auth import get_current_user, require_permission
from app.api.batches import _resolve_batch_variants
from app.schemas import (
    QuarantineGroupResponse, QuarantineListResponse, QuarantineLotResponse,
    QuarantineStatusOption, QuarantineStatusUpdate,
)
from app.services import audit_service, quarantine_service, stock_service, packing_service
from app.core.pagination import PageParams, PageWindow
from app.core.ws_manager import manager

router = APIRouter(prefix="/quarantine", tags=["quarantine"])

# Hard ceiling on lot rows scanned per request. Quarantine is a transient hold
# area — thousands of held lots means something upstream is wrong, not that the
# page should page through them. `truncated` on the response says so out loud
# rather than silently showing a partial picture as if it were everything.
MAX_LOT_ROWS = 4000

UNASSIGNED = "unassigned"


def _rollup(statuses: list[Optional[str]]) -> str:
    """One label for an MO row from its lots' dispositions.

    NONE (no lot dispositioned), MIXED (they disagree), or the shared status.
    Deliberately not a stored field — the lot is the source of truth.
    """
    distinct = {(s or "").strip().upper() or "NONE" for s in statuses}
    if not distinct:
        return "NONE"
    if len(distinct) == 1:
        return distinct.pop()
    return "MIXED"


@router.get("/statuses", response_model=list[QuarantineStatusOption])
async def list_quarantine_statuses(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("quarantine.view")),
):
    """Dispositions QC may set. `is_pass` marks the one that releases to packing."""
    values = await quarantine_service.status_values(db)
    return [
        QuarantineStatusOption(
            id=v.id, value=v.value, is_pass=quarantine_service.is_pass(v.value)
        )
        for v in values
    ]


@router.get("", response_model=QuarantineListResponse)
async def list_quarantine_stock(
    search: Optional[str] = Query(None, description="Matches MO / lot / item / SO code"),
    status: Optional[str] = Query(None, description="Filter to groups whose rollup equals this (e.g. OK, MIXED, NONE)"),
    include_packed: bool = Query(
        False,
        description="Also list lots already packed out of a quarantine location (read-only history, zero on hand)",
    ),
    window: PageWindow = Depends(PageParams(default_size=25, max_size=200)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('quarantine.view')),
):
    """Stock held in quarantine, grouped by the MO that produced it.

    Grouping is derived, not stored: a lot carries `source_wo_id`, and the WO
    carries the MO — the same chain `_resolve_batch_origins` walks for lineage.
    Stock with no lot (or a lot not born on a WO) has no MO and lands in one
    "No MO" group so nothing held is invisible.

    Pagination is over *groups*, applied after grouping, because an MO's lots
    must never be split across pages — the whole point of the row is its rollup.

    The page is driven off live `StockBalance`, so a lot fully drawn by packing
    leaves it entirely — its balance at the hold bin is zero. `include_packed`
    adds those lots back as read-only history rows (qty on hand 0, `qty_packed`
    set) without touching the held totals, which stay a picture of what is
    physically still on the desk.
    """
    loc_ids = await quarantine_service.quarantine_location_ids(db)
    if not loc_ids:
        return window.envelope([], 0, truncated=False)

    # Balance rows -> lot + item + location in one pass. batch_key is text, so the
    # join casts Batch.id rather than the key (keeps the batches PK index usable).
    rows = (await db.execute(
        select(StockBalance, Batch, Item, Location)
        .join(Item, Item.id == StockBalance.item_id)
        .join(Location, Location.id == StockBalance.location_id)
        .outerjoin(Batch, cast(Batch.id, String) == StockBalance.batch_key)
        .filter(StockBalance.location_id.in_(loc_ids), StockBalance.qty > 0)
        .order_by(StockBalance.qty.desc())
        .limit(MAX_LOT_ROWS + 1)
    )).all()
    truncated = len(rows) > MAX_LOT_ROWS
    rows = rows[:MAX_LOT_ROWS]

    # Lots with nothing left on hand because packing drew them out of the hold
    # area. Scoped by the *packing order's* source location rather than the lot's
    # current balance — the lot may now be sitting anywhere (or be fully packed
    # into cartons), so the order is the only durable record that it was held.
    history: list = []
    if include_packed:
        on_hand_ids = {b.id for (_, b, _, _) in rows if b is not None}
        # Aggregate in a subquery over plain columns, then join the entities on
        # top of it. Grouping with `Item` in the SELECT cannot work: the mapper
        # pulls its category chain in as joined eager loads, and those columns
        # are neither grouped nor aggregated.
        agg = (
            select(
                PackingCompletion.source_batch_id.label("batch_id"),
                PackingOrder.source_location_id.label("location_id"),
                func.sum(PackingCompletion.qty).label("qty_packed"),
                func.max(PackingCompletion.completed_at).label("last_packed_at"),
            )
            .join(PackingOrder, PackingOrder.id == PackingCompletion.packing_order_id)
            .filter(
                PackingOrder.source_location_id.in_(loc_ids),
                PackingCompletion.source_batch_id.is_not(None),
            )
            .group_by(PackingCompletion.source_batch_id, PackingOrder.source_location_id)
            .order_by(func.max(PackingCompletion.completed_at).desc())
            .limit(MAX_LOT_ROWS + 1)
            .subquery()
        )
        hrows = (await db.execute(
            select(Batch, Item, Location, agg.c.qty_packed, agg.c.last_packed_at)
            .select_from(agg)
            .join(Batch, Batch.id == agg.c.batch_id)
            .join(Item, Item.id == Batch.item_id)
            .join(Location, Location.id == agg.c.location_id)
            .order_by(agg.c.last_packed_at.desc())
        )).all()
        if len(hrows) > MAX_LOT_ROWS:
            truncated = True
            hrows = hrows[:MAX_LOT_ROWS]
        history = [h for h in hrows if h[0].id not in on_hand_ids]

    if not rows and not history:
        return window.envelope([], 0, truncated=False)

    # Lot -> MO origin, one query for the page (same chain as batch lineage).
    mo_so = aliased(SalesOrder)
    pr_so = aliased(SalesOrder)
    wo_ids = {b.source_wo_id for (_, b, _, _) in rows if b is not None and b.source_wo_id}
    wo_ids |= {b.source_wo_id for (b, _, _, _, _) in history if b.source_wo_id}
    origin: dict = {}
    if wo_ids:
        for (wo_id, wo_code, mo_id, mo_code, mo_status, mo_qty, pr_code,
             mo_so_id, mo_so_code, pr_so_id, pr_so_code,
             color_id, color_code, color_name, color_hex, labdip_code, bom_size_id,
             bom_size_snapshot) in (await db.execute(
            select(
                WorkOrder.id, WorkOrder.code,
                ManufacturingOrder.id, ManufacturingOrder.code,
                ManufacturingOrder.status, ManufacturingOrder.qty,
                ProductionRun.code,
                ManufacturingOrder.sales_order_id, mo_so.po_number,
                ProductionRun.sales_order_id, pr_so.po_number,
                ManufacturingOrder.color_id, Color.code, Color.name, Color.hex,
                ManufacturingOrder.labdip_variant_code,
                ManufacturingOrder.bom_size_id,
                ManufacturingOrder.bom_size_snapshot,
            )
            .join(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
            .outerjoin(ProductionRun, ProductionRun.id == ManufacturingOrder.production_run_id)
            .outerjoin(mo_so, mo_so.id == ManufacturingOrder.sales_order_id)
            .outerjoin(pr_so, pr_so.id == ProductionRun.sales_order_id)
            .outerjoin(Color, Color.id == ManufacturingOrder.color_id)
            .filter(WorkOrder.id.in_(wo_ids))
        )).all():
            origin[wo_id] = {
                "wo_code": wo_code,
                "mo_id": mo_id, "mo_code": mo_code, "mo_status": mo_status,
                "mo_qty": float(mo_qty or 0), "production_run_code": pr_code,
                "sales_order_id": mo_so_id or pr_so_id,
                "sales_order_code": mo_so_code or pr_so_code,
                "color_id": color_id,
                "color_code": color_code, "color_name": color_name, "color_hex": color_hex,
                "labdip_variant_code": labdip_code,
                # The MO's own sized-BOM pick — lets the packing form auto-match this
                # group's stock to the one order line ordered in the same size.
                "bom_size_id": bom_size_id,
                # ...and that size as text, which is what the match actually runs
                # on: an SO line states its size through the Size master, so it
                # shares no id with a BOMSize row. Name only (no measurement) —
                # it is compared against the line's `size_display`.
                "size_label": (
                    (bom_size_snapshot or {}).get("size_name")
                    or (bom_size_snapshot or {}).get("label")
                ),
            }

        # Combo is an attribute value on the MO (color-type FG uses color_id
        # instead — see Item.variant_type), so it needs its own grouped lookup,
        # the same shape as `_resolve_batch_variants`. One value expected per MO.
        mo_ids = {info["mo_id"] for info in origin.values() if info["mo_id"]}
        if mo_ids:
            combo_rows = (await db.execute(
                select(manufacturing_order_values.c.manufacturing_order_id, AttributeValue.id)
                .join(AttributeValue, AttributeValue.id == manufacturing_order_values.c.attribute_value_id)
                .join(Attribute, Attribute.id == AttributeValue.attribute_id)
                .filter(
                    manufacturing_order_values.c.manufacturing_order_id.in_(mo_ids),
                    Attribute.system_role == "combo",
                )
            )).all()
            combo_by_mo = {mo_id: value_id for mo_id, value_id in combo_rows}
            for info in origin.values():
                info["combo_value_id"] = combo_by_mo.get(info["mo_id"])

    # Lots already drawn by packing — their disposition is locked (frozen once
    # cartons exist against it), so the page renders them read-only.
    on_hand_batch_ids = [b.id for (_, b, _, _) in rows if b is not None]
    packed_qty = await quarantine_service.packed_batch_qty(db, on_hand_batch_ids)

    # Lots LOCKED to an open packing order (`Batch.locked_packing_order_id`) —
    # claimed off this desk and not FIFO-allocatable at all. The order that took
    # them owns the whole pile and cannot close until it is drained, so they are
    # reported wholly claimed rather than claimed-to-the-order's-open-qty. That
    # is what keeps a second order from being planned over the same physical lot;
    # the create endpoint refuses it outright either way.
    locked_codes: dict = dict((await db.execute(
        select(Batch.id, PackingOrder.code)
        .join(PackingOrder, PackingOrder.id == Batch.locked_packing_order_id)
        .filter(
            Batch.id.in_(on_hand_batch_ids),
            PackingOrder.status.notin_(packing_service.CLOSED_STATUSES),
        )
    )).all()) if on_hand_batch_ids else {}

    # An open packing order plans to draw this (item, source location, variant).
    # What it claims is its **open quantity** — `qty_target - qty_packed` — not the
    # pool it points at. A claim is an allocation, the way a reservation is in any
    # WMS: a 2 kg order against an 8 kg hold bin claims 2 kg and leaves 6 kg free
    # for the next order. The earlier boolean form ("an open order exists, so all
    # of it is spoken for") meant a fulfilled-but-not-yet-closed order locked the
    # whole bin forever — packing orders never auto-close, so nothing ever released
    # it, and the Pack button greyed out with released stock still on the desk.
    #
    # Allocation is FIFO over the lots (oldest first, the order packing's own lot
    # picker draws in) with orders taken oldest first, so the answer is stable
    # between requests and matches what packing would actually consume.
    #
    # The **variant** is part of the match, not just (item, location): two MOs of
    # the same FG in different shades land in the same hold bin, and matching on
    # the pair alone let one colour's packing order claim the other colour's stock.
    # The order's key is built the same way the StockBalance row's is
    # (`_generate_variant_key`), so `bal.variant_key` compares directly. An order
    # that declares no variant at all can draw anything there, so it matches all.
    claims: dict = {}
    on_hand_item_ids = {item.id for (_, _, item, _) in rows}
    on_hand_loc_ids = {loc.id for (_, _, _, loc) in rows}
    if on_hand_item_ids and on_hand_loc_ids:
        open_orders: list[tuple] = []
        for po in (await db.execute(
            select(PackingOrder)
            .options(
                selectinload(PackingOrder.attribute_values),
                # `qty_packed` rolls up the completions, so they have to be eager
                # loaded: a lazy load here would raise MissingGreenlet.
                selectinload(PackingOrder.completions),
                # Same for `cartons`, which `packing_service.open_qty` counts to
                # decide whether an alt-unit order still owes anything.
                selectinload(PackingOrder.cartons),
                selectinload(PackingOrder.item),
            )
            .filter(
                # DELIVERED is listed even though its open qty is zero by
                # definition — an order whose target is later raised is claimable
                # again, and the qty test below is the real filter either way.
                PackingOrder.status.in_(("PENDING", "IN_PROGRESS", "DELIVERED")),
                PackingOrder.item_id.in_(on_hand_item_ids),
                PackingOrder.source_location_id.in_(on_hand_loc_ids),
            )
            .order_by(PackingOrder.created_at)
        )).scalars().all():
            # Still in kg — stock is claimed by weight however the order is counted.
            # Only the "owes nothing" decision moves to the counting unit: an order
            # for 2880 Pcs that boxed all of them off lighter-than-estimated cloth is
            # done, and a raw qty_target - qty_packed subtraction would leave it
            # claiming the hold bin forever. See packing_service.is_target_met.
            open_qty = packing_service.open_qty(po)
            if open_qty <= 1e-6:
                continue
            open_orders.append((
                po.item_id, po.source_location_id, po.code, open_qty,
                stock_service._generate_variant_key(
                    [str(v.id) for v in (po.attribute_values or [])], po.color_id
                ),
            ))

        if open_orders:
            # Only released, unpacked, lotted stock can be claimed — the same rows
            # a packing completion's lot picker would be offered.
            claimable = sorted(
                [
                    (bal, batch, item, loc) for bal, batch, item, loc in rows
                    if batch is not None
                    and batch.id not in packed_qty
                    and batch.id not in locked_codes
                    and quarantine_service.is_pass(batch.quarantine_status)
                    and float(bal.qty or 0) > 0
                ],
                key=lambda r: (r[1].created_at or datetime.max, r[1].batch_number or ""),
            )
            free = {bal.id: float(bal.qty or 0) for bal, _, _, _ in claimable}
            for o_item, o_loc, o_code, o_open, o_vk in open_orders:
                for bal, batch, item, loc in claimable:
                    if o_open <= 1e-6:
                        break
                    if item.id != o_item or loc.id != o_loc:
                        continue
                    if not stock_service.variant_matches(o_vk, bal.variant_key or ""):
                        continue
                    left = free.get(bal.id, 0.0)
                    if left <= 1e-6:
                        continue
                    take = min(left, o_open)
                    free[bal.id] = left - take
                    o_open -= take
                    # First claimant names the lot. A lot split across two orders
                    # is rare and the code is a label, not the gate — the gate is
                    # the qty, which accumulates.
                    prev_qty, prev_code = claims.get(bal.id, (0.0, o_code))
                    claims[bal.id] = (prev_qty + take, prev_code)

    def _claim(bal, batch) -> tuple:
        """(claimed qty, claiming order code) for one balance row; (0, None) if free.

        A locked lot short-circuits the FIFO allocation: all of it is spoken for,
        whatever its owner's open quantity has shrunk to.
        """
        if batch is not None and batch.id in locked_codes:
            return round(float(bal.qty or 0), 4), locked_codes[batch.id]
        qty, code = claims.get(bal.id, (0.0, None))
        return round(qty, 4), code

    # Combo/other variant attributes of the producing MO, resolved onto each
    # batch (setattr, same as the lot pickers) — the group row already carries
    # color/labdip from `origin`, but combo has no home there, and a lot's own
    # size (`bom_size_snapshot`) isn't surfaced anywhere on this page at all.
    all_batches = [b for (_, b, _, _) in rows if b is not None] + [b for (b, _, _, _, _) in history]
    await _resolve_batch_variants(db, all_batches)

    groups: dict[str, QuarantineGroupResponse] = {}

    def _group(batch, item) -> QuarantineGroupResponse:
        info = origin.get(batch.source_wo_id) if batch is not None else None
        # An MO can produce more than one item (component MOs), and the same item
        # can arrive from different MOs — key on both so a row is always one
        # (order, product) pair the way the packing order downstream is.
        key = f"{info['mo_id'] if info else UNASSIGNED}:{item.id}"
        grp = groups.get(key)
        if grp is None:
            grp = QuarantineGroupResponse(
                key=key,
                mo_id=info["mo_id"] if info else None,
                mo_code=info["mo_code"] if info else None,
                mo_status=info["mo_status"] if info else None,
                mo_qty=info["mo_qty"] if info else None,
                production_run_code=info["production_run_code"] if info else None,
                sales_order_id=info["sales_order_id"] if info else None,
                sales_order_code=info["sales_order_code"] if info else None,
                color_id=info["color_id"] if info else None,
                color_code=info["color_code"] if info else None,
                color_name=info["color_name"] if info else None,
                color_hex=info["color_hex"] if info else None,
                labdip_variant_code=info["labdip_variant_code"] if info else None,
                combo_value_id=info["combo_value_id"] if info else None,
                bom_size_id=info["bom_size_id"] if info else None,
                size_label=info["size_label"] if info else None,
                item_id=item.id, item_code=item.code, item_name=item.name, uom=item.uom,
                qty_total=0.0, qty_released=0.0, qty_claimed=0.0, lot_count=0,
                rollup_status="NONE", status_counts={}, lots=[],
            )
            groups[key] = grp
        return grp

    for bal, batch, item, loc in rows:
        grp = _group(batch, item)
        qty = float(bal.qty or 0)
        released = quarantine_service.is_pass(batch.quarantine_status) if batch is not None else False
        claimed_qty, claimed_code = _claim(bal, batch)
        wo_code = origin.get(batch.source_wo_id, {}).get("wo_code") if batch is not None else None
        grp.qty_total += qty
        if released:
            grp.qty_released += qty
        grp.qty_claimed += claimed_qty
        grp.lot_count += 1
        label = ((batch.quarantine_status if batch is not None else None) or "").strip().upper() or "NONE"
        grp.status_counts[label] = grp.status_counts.get(label, 0) + 1
        grp.lots.append(QuarantineLotResponse(
            batch_id=batch.id if batch is not None else None,
            batch_number=batch.batch_number if batch is not None else None,
            item_id=item.id, item_code=item.code, item_name=item.name, uom=item.uom,
            qty=qty,
            qty_packed=packed_qty.get(batch.id) if batch is not None else None,
            location_id=loc.id, location_name=loc.name,
            variant_key=bal.variant_key or "",
            quality_status=batch.quality_status if batch is not None else None,
            quarantine_status=batch.quarantine_status if batch is not None else None,
            quarantine_status_id=batch.quarantine_status_id if batch is not None else None,
            quarantine_status_at=batch.quarantine_status_at if batch is not None else None,
            quarantine_status_by=batch.quarantine_status_by if batch is not None else None,
            quarantine_notes=batch.quarantine_notes if batch is not None else None,
            released=released,
            packed=batch is not None and batch.id in packed_qty,
            created_at=batch.created_at if batch is not None else None,
            bom_size_snapshot=batch.bom_size_snapshot if batch is not None else None,
            variant_attributes=getattr(batch, "variant_attributes", None) if batch is not None else None,
            color_code=grp.color_code, color_name=grp.color_name, color_hex=grp.color_hex,
            labdip_variant_code=grp.labdip_variant_code,
            claimed_qty=claimed_qty,
            claimed_by_order_code=claimed_code,
            wo_code=wo_code,
        ))

    # History rows deliberately touch neither the qty totals nor `lot_count`:
    # those columns answer "what is still on the desk", and a packed lot is not.
    # They land in `lots` and in `packed_lot_count` only.
    for batch, item, loc, qty_packed, last_packed_at in history:
        grp = _group(batch, item)
        grp.packed_lot_count += 1
        wo_code = origin.get(batch.source_wo_id, {}).get("wo_code")
        grp.lots.append(QuarantineLotResponse(
            batch_id=batch.id, batch_number=batch.batch_number,
            item_id=item.id, item_code=item.code, item_name=item.name, uom=item.uom,
            qty=0.0,
            qty_packed=float(qty_packed or 0),
            last_packed_at=last_packed_at,
            location_id=loc.id, location_name=loc.name,
            variant_key="",
            quality_status=batch.quality_status,
            quarantine_status=batch.quarantine_status,
            quarantine_status_id=batch.quarantine_status_id,
            quarantine_status_at=batch.quarantine_status_at,
            quarantine_status_by=batch.quarantine_status_by,
            quarantine_notes=batch.quarantine_notes,
            released=quarantine_service.is_pass(batch.quarantine_status),
            packed=True,
            created_at=batch.created_at,
            bom_size_snapshot=batch.bom_size_snapshot,
            variant_attributes=getattr(batch, "variant_attributes", None),
            color_code=grp.color_code, color_name=grp.color_name, color_hex=grp.color_hex,
            labdip_variant_code=grp.labdip_variant_code,
            wo_code=wo_code,
        ))

    items = list(groups.values())
    for grp in items:
        # Rollup over the lots still on hand only — a packed lot's status is
        # history, and letting it vote would report a fully-packed MO as "OK, go
        # pack it". A group with nothing left on hand rolls up as PACKED.
        open_lots = [l for l in grp.lots if not l.packed or l.qty > 0]
        grp.rollup_status = _rollup([l.quarantine_status for l in open_lots]) if open_lots else "PACKED"
        grp.lots.sort(key=lambda l: (l.batch_number or "~"))

    if search:
        needle = search.strip().lower()
        items = [
            g for g in items
            if needle in (g.mo_code or "").lower()
            or needle in (g.sales_order_code or "").lower()
            or needle in (g.production_run_code or "").lower()
            or needle in (g.item_code or "").lower()
            or needle in (g.item_name or "").lower()
            or any(needle in (l.batch_number or "").lower() for l in g.lots)
        ]
    if status:
        wanted = status.strip().upper()
        items = [g for g in items if g.rollup_status == wanted]

    # Undispositioned first — the desk's job is the queue, not the archive — and
    # fully-packed groups last, since they are the archive.
    order = {"NONE": 0, "MIXED": 1, "PACKED": 3}
    items.sort(key=lambda g: (order.get(g.rollup_status, 2), g.mo_code or "~", g.item_code or ""))

    total = len(items)
    # The window is applied to the in-memory group list rather than through
    # `window.apply()`: grouping happens in Python (an MO's lots must never split
    # across pages), so there is no SQL statement left to hang OFFSET/LIMIT on.
    start = window.offset
    page_items = items[start:] if window.uncapped else items[start:start + window.size]
    return window.envelope(page_items, total, truncated=truncated)


@router.post("/status", response_model=list[QuarantineLotResponse])
async def set_quarantine_status(
    payload: QuarantineStatusUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('quarantine.set_status')),
):
    """Set (or clear) the disposition on one or more lots.

    Takes a lot list rather than an MO so the same call serves both the per-lot
    control and the "apply to the whole MO" button — the client sends the
    group's lot ids for the second. `status_value_id: null` clears back to
    undispositioned, which re-holds the lots.
    """
    batch_ids = [b for b in (payload.batch_ids or []) if b]
    if not batch_ids:
        raise HTTPException(status_code=400, detail="Select at least one lot")

    value = None
    if payload.status_value_id:
        try:
            value = await quarantine_service.resolve_status_value(db, payload.status_value_id)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e))

    batches = (await db.execute(select(Batch).filter(Batch.id.in_(batch_ids)))).scalars().all()
    if not batches:
        raise HTTPException(status_code=404, detail="No matching lots")
    missing = set(str(b) for b in batch_ids) - {str(b.id) for b in batches}
    if missing:
        raise HTTPException(status_code=404, detail=f"Unknown lot(s): {', '.join(sorted(missing))}")

    # A lot that has already been packed is frozen — releasing it is what let the
    # cartons be minted, so the decision is no longer QC's to revise. Checked for
    # the whole submission so the "apply to the MO" button can't half-apply.
    try:
        await quarantine_service.assert_not_packed(db, batches)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    stamped = datetime.utcnow()
    for b in batches:
        # Re-confirming a disposition it already has is a no-op on the *record* of
        # it. `quarantine_status_at` is when QC decided, not when someone last
        # clicked — rewriting it on an unchanged value both falsified the audit
        # trail and (because the UI bands lots by decided-day) made the row the
        # user just clicked jump out of its band into today's.
        changed = b.quarantine_status_id != (value.id if value else None)
        b.quarantine_status_id = value.id if value else None
        # Snapshot the text: a later rename or delete of the attribute value must
        # not rewrite what QC actually decided about a physical lot.
        b.quarantine_status = value.value if value else None
        if changed:
            b.quarantine_status_at = stamped if value else None
            b.quarantine_status_by = current_user.username if value else None
        if payload.notes is not None:
            b.quarantine_notes = payload.notes or None
    await db.commit()

    label = value.value if value else "cleared"
    await audit_service.log_activity(
        db, user_id=current_user.id, action="UPDATE_STATUS", entity_type="Batch",
        entity_id=str(batches[0].id),
        details=f"Quarantine status set to {label} on {len(batches)} lot(s): "
                + ", ".join(b.batch_number for b in batches[:10])
                + ("…" if len(batches) > 10 else ""),
    )
    try:
        await manager.broadcast({"type": "QUARANTINE_UPDATE"})
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass

    # Remaining qty per lot so the caller can refresh a row without a full reload.
    remaining = dict((await db.execute(
        select(StockBalance.batch_key, func.sum(StockBalance.qty))
        .filter(StockBalance.batch_key.in_([str(b.id) for b in batches]))
        .group_by(StockBalance.batch_key)
    )).all())
    return [
        QuarantineLotResponse(
            batch_id=b.id, batch_number=b.batch_number,
            item_id=b.item_id, item_code=None, item_name=None, uom=None,
            qty=float(remaining.get(str(b.id)) or 0),
            location_id=None, location_name=None, variant_key="",
            quality_status=b.quality_status,
            quarantine_status=b.quarantine_status,
            quarantine_status_id=b.quarantine_status_id,
            quarantine_status_at=b.quarantine_status_at,
            quarantine_status_by=b.quarantine_status_by,
            quarantine_notes=b.quarantine_notes,
            released=quarantine_service.is_pass(b.quarantine_status),
            created_at=b.created_at,
        )
        for b in batches
    ]
