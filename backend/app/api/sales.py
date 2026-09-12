from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, nullslast, delete as sa_delete, update as sa_update
from sqlalchemy.orm import selectinload, joinedload
from sqlalchemy.exc import IntegrityError
from app.db.session import get_async_db
from app.schemas import (
    SalesOrderCreate, SalesOrderUpdate, SalesOrderResponse, PaginatedSalesOrderResponse,
    SOPRCoverageEntry, SOPRCoverageResponse,
    StockReservationResponse, SOReservationSummary,
)
from app.models.sales import SalesOrder, SalesOrderLine, sales_order_line_values
from app.models.attribute import Attribute, AttributeValue
from app.models.bom import BOMSize
from app.models.size import Size
from app.models.color import Color
from app.models.production_run import ProductionRun, PRBomEntry
from app.models.manufacturing import ManufacturingOrder
from app.models.work_order import WorkOrder
from app.models.batch import Batch
from app.models.stock_balance import StockBalance
from app.models.packing import PackingOrder
from app.models.reservation import StockReservation
from app.models.item import Item as ItemModel
from app.api.auth import get_current_user, require_permission, require_any_permission, user_has_permission
from app.models.auth import User
from app.services import audit_service, kpi_service, netting_service, so_fulfilment_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter(prefix="/sales-orders", tags=["sales"])


def _line_opts():
    """Eager-load options shared by every SO fetch that serializes lines."""
    return (
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values),
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.item),
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.color),
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.labdip_item),
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.bom_size).selectinload(BOMSize.size),
        selectinload(SalesOrder.lines).selectinload(SalesOrderLine.size),
    )


async def _populate_fulfilment(db: AsyncSession, orders: list) -> None:
    """Attach derived fulfilment numbers to every line of these orders.

    One batched aggregate for the whole set — see so_fulfilment_service. The
    fields must be declared on SalesOrderLineResponse or response_model drops
    them silently.
    """
    if not orders:
        return
    fulfilment = await so_fulfilment_service.fulfilment_map(db, [o.id for o in orders])
    for so in orders:
        for line in so.lines:
            f = fulfilment.get(str(line.id)) or {}
            line.qty_made = f.get("made", 0.0)
            line.qty_packed = f.get("packed", 0.0)
            line.qty_packed_available = f.get("packed_available", 0.0)
            line.qty_dispatched = f.get("dispatched", 0.0)
            # The denominator the four above are measured against, in their own
            # unit. `line.qty` is in yards and must never be the divisor — see
            # so_fulfilment_service.ordered_qty_in_stock_uom. None = undrawable.
            line.qty_ordered_base = f.get("ordered_base")
            line.base_uom = f.get("base_uom", "")
            # The same four in the line's alt selling unit — what the customer
            # ordered in, and what the fulfilment bar draws. Null when the line
            # has none; the bar then falls back to the base pair.
            line.qty_ordered_alt = f.get("ordered_alt")
            line.alt_uom = f.get("alt_uom", "")
            line.qty_made_alt = f.get("made_alt")
            line.qty_packed_alt = f.get("packed_alt")
            line.qty_packed_available_alt = f.get("packed_available_alt")
            line.qty_dispatched_alt = f.get("dispatched_alt")


async def _populate_mo_progress(db: AsyncSession, orders: list) -> None:
    """Attach work-order step progress of the MOs behind every line.

    List endpoint only — this is the one caller that needs the work-order join, so
    the recompute paths (every MO completion, packing, dispatch) don't pay for it.
    `mo_progress` must be declared on SalesOrderLineResponse or response_model
    drops it silently. Lines with no MO are left None, not zeroed: "not planned
    yet" and "planned but 0% done" are different answers on the shop floor.
    """
    if not orders:
        return
    progress = await so_fulfilment_service.mo_progress_map(db, [o.id for o in orders])
    for so in orders:
        for line in so.lines:
            line.mo_progress = progress.get(str(line.id))


def _populate_line(line: SalesOrderLine) -> None:
    """Fill response-only fields on a SO line from its eager-loaded relations."""
    line.attribute_value_ids = [v.id for v in line.attribute_values]
    if line.item:
        line.item_name = line.item.name
        line.item_code = line.item.code
    if line.color:
        line.color_code = line.color.code
        line.color_name = line.color.name
        line.color_hex = line.color.hex
    # Pending shade: surface the linked lab dip item's current status (PENDING/
    # IN_PROGRESS/APPROVED/REJECTED). Shown until an approved color_id backfills.
    if line.labdip_item is not None:
        line.labdip_status = line.labdip_item.status
    # Display size: the generic pick first, the legacy BOMSize pointer only for
    # rows written before the decoupling. Never written back onto the line.
    line.size_display = (
        (line.size.name if line.size is not None else None)
        or line.size_label
        or (
            (line.bom_size.size_name or line.bom_size.label)
            if line.bom_size is not None else None
        )
    )


async def _populate_production_runs(db: AsyncSession, orders: list) -> None:
    """Attach the PR code chips (id + code) for each order in this page.

    One grouped query scoped to the page's SO ids. The SO list page previously got
    these by client-side `.filter()` over a *windowed* `/production-runs?limit=50`
    fetch, which silently dropped the chip (and the lineage button) for any SO whose
    PR fell outside the newest 50 PRs — the "lookup feed vs list window" trap. It
    also cost a 115 kB / 2.7 s request to render three fields. Scoping the query to
    the SO ids already on screen is both correct and free.

    `production_runs` must be declared on SalesOrderResponse or response_model drops
    it silently.
    """
    if not orders:
        return
    by_so: dict[str, list] = {}
    for pr_id, code, so_id in (
        await db.execute(
            select(ProductionRun.id, ProductionRun.code, ProductionRun.sales_order_id)
            .filter(ProductionRun.sales_order_id.in_([o.id for o in orders]))
            .order_by(ProductionRun.created_at)
        )
    ).all():
        by_so.setdefault(str(so_id), []).append({"id": pr_id, "code": code})
    for so in orders:
        so.production_runs = by_so.get(str(so.id), [])


async def _populate_reserved(db: AsyncSession, orders: list) -> None:
    """Attach `reserved_qty` — on-hand FG this order's PR took from stock.

    Needed on the list, not just behind a click: an order whose PR covered
    everything from stock has a PR chip and no MOs at all, which reads as a
    failed run unless the row can say "700 came from stock". One grouped query
    scoped to the page's SO ids, same shape as `_populate_production_runs`.

    Must be declared on SalesOrderResponse or response_model drops it silently.
    """
    if not orders:
        return
    totals: dict[str, float] = {}
    for so_id, qty, released in (
        await db.execute(
            select(
                StockReservation.sales_order_id,
                StockReservation.qty,
                StockReservation.qty_released,
            ).filter(
                StockReservation.sales_order_id.in_([o.id for o in orders]),
                StockReservation.status == "ACTIVE",
            )
        )
    ).all():
        held = float(qty or 0) - float(released or 0)
        if held > 0:
            totals[str(so_id)] = totals.get(str(so_id), 0.0) + held
    for so in orders:
        so.reserved_qty = totals.get(str(so.id), 0.0)


async def _populate_variant_attrs(db: AsyncSession, orders: list) -> None:
    """Attach variant_attributes (combo, and anything else riding attribute_values)
    to every line, same shape as Batch.variant_attributes (see api/batches.py) so
    a picker can label an SO line the same way it labels a lot. AttributeValue
    doesn't carry its parent Attribute's name/system_role without a join, hence
    one batched lookup for the whole page rather than a relationship walk.
    """
    value_ids = {v.id for so in orders for line in so.lines for v in line.attribute_values}
    if not value_ids:
        return
    rows = (await db.execute(
        select(AttributeValue.id, Attribute.name, Attribute.system_role, AttributeValue.value, AttributeValue.hex)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .filter(AttributeValue.id.in_(value_ids))
    )).all()
    by_id = {vid: {"name": name, "system_role": role, "value": value, "hex": hex_code}
             for vid, name, role, value, hex_code in rows}
    for so in orders:
        for line in so.lines:
            attrs = [by_id[v.id] for v in line.attribute_values if v.id in by_id]
            if attrs:
                line.variant_attributes = attrs

@router.post("", response_model=SalesOrderResponse)
async def create_sales_order(payload: SalesOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('sales_order.create'))):
    try:
        # Check duplicate PO
        result = await db.execute(select(SalesOrder).filter(SalesOrder.po_number == payload.po_number))
        if result.scalars().first():
            raise HTTPException(status_code=400, detail=f"PO Number '{payload.po_number}' already exists")

        so = SalesOrder(
            po_number=payload.po_number,
            customer_po_ref=payload.customer_po_ref,
            customer_name=payload.customer_name,
            order_date=payload.order_date or datetime.utcnow()
        )
        db.add(so)
        await db.flush() # Get ID

        for line in payload.lines:
            db_line = SalesOrderLine(
                sales_order_id=so.id,
                item_id=line.item_id,
                qty=line.qty,
                due_date=line.due_date,
                internal_confirmation_date=line.internal_confirmation_date,
                ket_stock=line.ket_stock,
                qty_kg=line.qty_kg,
                qty2=line.qty2,
                uom2=line.uom2,
                uom2_factor=line.uom2_factor,
                bom_id=line.bom_id,
                bom_size_id=line.bom_size_id,
                size_id=line.size_id,
                size_label=line.size_label,
                color_id=line.color_id,
                labdip_variant_code=line.labdip_variant_code,
                labdip_item_id=line.labdip_item_id,
                no_color_swatch=line.no_color_swatch,
            )
            if line.attribute_value_ids:
                attr_result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids)))
                db_line.attribute_values = attr_result.scalars().all()
            db.add(db_line)

        await db.commit()
    except HTTPException:
        raise
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=400, detail="Database integrity error (duplicate reference or invalid ID)")
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))
    
    # Refresh with eager loading
    final_result = await db.execute(
        select(SalesOrder)
        .options(*_line_opts())
        .filter(SalesOrder.id == so.id)
    )
    so_refreshed = final_result.scalars().first()

    for line in so_refreshed.lines:
        _populate_line(line)
    await _populate_fulfilment(db, [so_refreshed])
    await _populate_variant_attrs(db, [so_refreshed])

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="SalesOrder",
        entity_id=str(so_refreshed.id),
        details=f"Created SO {so_refreshed.po_number}"
    )

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return so_refreshed

# Sortable columns the SO list header exposes, keyed by the client's column key.
# Sorting has to happen here, in the same statement as the window: the list is
# paginated, so ordering one page in the browser only rearranges the 50 rows the
# server already chose and page 1 keeps showing the wrong rows.
_SO_SORT_MAP = {
    "po": SalesOrder.po_number,
    "customer": SalesOrder.customer_name,
    "date": SalesOrder.order_date,
    "status": SalesOrder.status,
}


@router.get("", response_model=PaginatedSalesOrderResponse)
async def get_sales_orders(
    status: Optional[str] = None,
    search: Optional[str] = None,
    customer: Optional[str] = None,
    sort_by: Optional[str] = Query(None, description=" | ".join(_SO_SORT_MAP)),
    sort_dir: str = Query("asc", description="asc | desc"),
    window: PageWindow = Depends(PageParams()),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sales_order.view", "sales_order.create_pr", "production_run.view", "production_run.create")),
):
    query = select(SalesOrder).options(*_line_opts())
    count_query = select(func.count(SalesOrder.id))

    if status:
        # comma-separated so callers that only need packable orders (e.g. Packing's
        # SO picker) can scope to a few statuses instead of pulling every SO ever
        # placed, which otherwise fetches unbounded and grows with order history.
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        cond = SalesOrder.status.in_(statuses) if len(statuses) > 1 else SalesOrder.status == statuses[0]
        query = query.filter(cond)
        count_query = count_query.filter(cond)
    if search:
        like = f"%{search}%"
        cond = or_(SalesOrder.po_number.ilike(like), SalesOrder.customer_po_ref.ilike(like))
        query = query.filter(cond)
        count_query = count_query.filter(cond)
    if customer:
        cond = SalesOrder.customer_name.ilike(f"%{customer}%")
        query = query.filter(cond)
        count_query = count_query.filter(cond)

    total = (await db.execute(count_query)).scalar() or 0

    sort_col = _SO_SORT_MAP.get(sort_by or "")
    if sort_col is not None:
        descending = (sort_dir or "").lower().startswith("d")
        order = [nullslast(sort_col.desc() if descending else sort_col.asc())]
    else:
        order = [SalesOrder.created_at.desc()]
    # Deterministic tiebreak: without it OFFSET/LIMIT can repeat or skip rows between
    # pages whenever the sort key ties (every row of one status, same order date, …).
    order.append(SalesOrder.id.asc())

    # `size=0` (or legacy `limit=0`) means "no cap" — the table-print export needs
    # every row matching the active filter, not just the page on screen.
    result = await db.execute(window.apply(query.order_by(*order)))
    orders = result.scalars().all()

    for so in orders:
        for line in so.lines:
            _populate_line(line)
    await _populate_fulfilment(db, list(orders))
    await _populate_variant_attrs(db, list(orders))
    await _populate_production_runs(db, list(orders))
    await _populate_reserved(db, list(orders))
    await _populate_mo_progress(db, list(orders))

    # Unfiltered, all-time counts for the status-bar summary ("X total / Y
    # pending / Z delivered") — deliberately not scoped to the active filter,
    # same meaning as before pagination existed.
    status_rows = (await db.execute(
        select(SalesOrder.status, func.count(SalesOrder.id)).group_by(SalesOrder.status)
    )).all()
    status_counts = {s: c for s, c in status_rows}

    return window.envelope(orders, total, status_counts=status_counts)


@router.get("/{so_id}/reservations", response_model=SOReservationSummary)
async def get_so_reservations(
    so_id: uuid.UUID,
    include_closed: bool = False,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sales_order.view", "production_run.view")),
):
    """On-hand finished goods this order's Production Run took from stock.

    The covered qty produces no MO, so without this list the SO page shows a PR
    that made nothing and no explanation of where the rest of the order went.
    `total_reserved` is what is still held; dispatched qty has already been drawn
    down by `dispatch_service.release_reservations`.
    """
    q = (
        # Size is joined as a column, not through BOMSize.size — that relationship
        # is lazy and this is an async route (MissingGreenlet on first access).
        select(StockReservation, ItemModel, ProductionRun.code, Color,
               BOMSize.label, Size.name)
        .join(ItemModel, ItemModel.id == StockReservation.item_id)
        .outerjoin(ProductionRun, ProductionRun.id == StockReservation.production_run_id)
        .outerjoin(Color, Color.id == StockReservation.color_id)
        .outerjoin(BOMSize, BOMSize.id == StockReservation.bom_size_id)
        .outerjoin(Size, Size.id == BOMSize.size_id)
        .filter(StockReservation.sales_order_id == so_id)
        .order_by(StockReservation.created_at)
    )
    if not include_closed:
        q = q.filter(StockReservation.status == "ACTIVE")

    rows = (await db.execute(q)).all()
    out: list[StockReservationResponse] = []
    total_reserved = 0.0
    total_released = 0.0
    for r, item, pr_code, color, size_label, size_name in rows:
        remaining = float(r.qty or 0) - float(r.qty_released or 0)
        if r.status == "ACTIVE":
            total_reserved += max(0.0, remaining)
        total_released += float(r.qty_released or 0)
        out.append(StockReservationResponse(
            id=r.id,
            sales_order_id=r.sales_order_id,
            production_run_id=r.production_run_id,
            production_run_code=pr_code,
            item_id=r.item_id,
            item_code=item.code if item else "",
            item_name=item.name if item else "",
            uom=item.uom if item else "",
            variant_key=r.variant_key or "",
            attribute_value_ids=[str(a) for a in (r.attribute_value_ids or [])],
            color_id=r.color_id,
            color_code=color.code if color else None,
            color_name=color.name if color else None,
            size_label=size_label or size_name,
            qty=float(r.qty or 0),
            qty_released=float(r.qty_released or 0),
            qty_remaining=max(0.0, remaining),
            status=r.status,
            created_at=r.created_at,
            released_at=r.released_at,
        ))
    return SOReservationSummary(
        reservations=out, total_reserved=total_reserved, total_released=total_released,
    )


@router.post("/{so_id}/reservations/{reservation_id}/release", response_model=SOReservationSummary)
async def release_so_reservation(
    so_id: uuid.UUID,
    reservation_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("sales_order.edit")),
):
    """Hand a reservation back to the free pool without shipping it.

    The planner's escape hatch: an order put on hold, or stock the customer no
    longer wants held. Deliberately a status flip and not a delete — the row is
    the record of what the PR netted away, and deleting it would make the run's
    missing MO unexplainable after the fact.
    """
    r = (await db.execute(
        select(StockReservation).filter(
            StockReservation.id == reservation_id,
            StockReservation.sales_order_id == so_id,
        )
    )).scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Reservation not found")
    if r.status != "ACTIVE":
        raise HTTPException(status_code=400, detail=f"Reservation already {r.status}")

    r.status = "RELEASED"
    r.released_at = datetime.utcnow()
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="RELEASE",
        entity_type="StockReservation", entity_id=str(reservation_id),
        details=f"Released {float(r.qty or 0) - float(r.qty_released or 0):g} reserved from SO {so_id}",
    )
    await manager.broadcast({"type": "SALES_ORDER_UPDATE", "id": str(so_id)})
    return await get_so_reservations(so_id, False, db, current_user)


@router.get("/{so_id}/pr-coverage", response_model=SOPRCoverageResponse)
async def get_so_pr_coverage(
    so_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sales_order.view", "sales_order.create_pr", "production_run.view", "production_run.create")),
):
    """What this SO already has a Production Run for — the duplicate-PR guard.

    The SO list page's "Create Production Run" button needs to know which sizes and
    which (bom, attrs, color, labdip) entries are already covered. It used to derive
    that client-side from the *windowed* `/production-runs?limit=50` feed, which meant
    an SO whose PR had aged out of the newest 50 read as "not covered" and let the
    user create a second PR for work already planned. Two scoped queries here are
    both correct and far cheaper than shipping every PR's nested MO tree to the
    browser just to answer one click.
    """
    pr_ids = [
        r[0] for r in (
            await db.execute(select(ProductionRun.id).filter(ProductionRun.sales_order_id == so_id))
        ).all()
    ]
    if not pr_ids:
        return SOPRCoverageResponse(covered_size_ids=[], covered_size_tokens=[], covered_entries=[])

    # Sized coverage comes from the root MOs actually created (a PR entry can be
    # partially materialised), matching the client logic this replaces.
    size_rows = (
        await db.execute(
            select(ManufacturingOrder.bom_size_id, Size.name, BOMSize.label)
            .join(BOMSize, BOMSize.id == ManufacturingOrder.bom_size_id)
            .outerjoin(Size, Size.id == BOMSize.size_id)
            .filter(
                ManufacturingOrder.production_run_id.in_(pr_ids),
                ManufacturingOrder.bom_size_id.is_not(None),
            )
            .distinct()
        )
    ).all()
    size_ids = [str(r[0]) for r in size_rows]
    # An SO line no longer carries a BOMSize id, so the caller compares folded
    # size names. Same coverage, stated in the identity both sides can see.
    size_tokens = sorted({
        tok for tok in (
            netting_service.normalize_size_token(name or label)
            for _, name, label in size_rows
        ) if tok
    })

    entries = [
        SOPRCoverageEntry(
            bom_id=bom_id,
            attribute_value_ids=[str(v) for v in (attr_ids or [])],
            color_id=color_id,
            labdip_variant_code=labdip,
        )
        for bom_id, attr_ids, color_id, labdip in (
            await db.execute(
                select(
                    PRBomEntry.bom_id,
                    PRBomEntry.attribute_value_ids,
                    PRBomEntry.color_id,
                    PRBomEntry.labdip_variant_code,
                ).filter(PRBomEntry.pr_id.in_(pr_ids))
            )
        ).all()
    ]

    return SOPRCoverageResponse(
        covered_size_ids=size_ids, covered_size_tokens=size_tokens, covered_entries=entries
    )


@router.get("/{so_id}", response_model=SalesOrderResponse)
async def get_sales_order(
    so_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sales_order.view", "sales_order.create_pr", "production_run.view", "production_run.create")),
):
    result = await db.execute(
        select(SalesOrder).options(*_line_opts()).filter(SalesOrder.id == so_id)
    )
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    for line in so.lines:
        _populate_line(line)
    await _populate_fulfilment(db, [so])
    await _populate_variant_attrs(db, [so])
    return so

@router.put("/{so_id}", response_model=SalesOrderResponse)
async def update_sales_order(so_id: uuid.UUID, payload: SalesOrderUpdate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('sales_order.edit'))):
    result = await db.execute(select(SalesOrder).filter(SalesOrder.id == so_id))
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")

    if so.status not in ["PENDING", "READY"]:
        raise HTTPException(status_code=400, detail=f"Cannot edit SO with status '{so.status}'")

    if payload.po_number != so.po_number:
        dup = await db.execute(select(SalesOrder).filter(SalesOrder.po_number == payload.po_number))
        if dup.scalars().first():
            raise HTTPException(status_code=400, detail=f"PO Number '{payload.po_number}' already exists")

    so.po_number = payload.po_number
    so.customer_po_ref = payload.customer_po_ref
    so.customer_name = payload.customer_name
    so.order_date = payload.order_date or so.order_date
    so.notes = payload.notes

    line_ids_result = await db.execute(
        select(SalesOrderLine.id).where(SalesOrderLine.sales_order_id == so_id)
    )
    line_ids = line_ids_result.scalars().all()

    # An edit rebuilds every line from scratch, and `packing_orders.sales_order_line_id`
    # is ON DELETE SET NULL — so a plain edit would quietly orphan the packing links
    # that decide whether this order is READY. Snapshot the links plus each old line's
    # variant identity here, then re-point them onto the equivalent new line below.
    old_identity = {}
    pack_refs = []
    if line_ids:
        old_identity = {
            str(r[0]): (r[1], r[2], r[3], r[4], r[5], r[6])
            for r in (
                await db.execute(
                    select(
                        SalesOrderLine.id, SalesOrderLine.item_id, SalesOrderLine.bom_id,
                        SalesOrderLine.bom_size_id, SalesOrderLine.size_id,
                        SalesOrderLine.size_label, SalesOrderLine.color_id,
                    ).where(SalesOrderLine.sales_order_id == so_id)
                )
            ).all()
        }
        pack_refs = (
            await db.execute(
                select(PackingOrder.id, PackingOrder.sales_order_line_id)
                .where(PackingOrder.sales_order_line_id.in_(line_ids))
            )
        ).all()

        await db.execute(sa_delete(sales_order_line_values).where(
            sales_order_line_values.c.sales_order_line_id.in_(line_ids)
        ))
    await db.execute(sa_delete(SalesOrderLine).where(SalesOrderLine.sales_order_id == so_id))
    await db.flush()

    new_lines = []
    for line in payload.lines:
        db_line = SalesOrderLine(
            sales_order_id=so.id,
            item_id=line.item_id,
            qty=line.qty,
            due_date=line.due_date,
            internal_confirmation_date=line.internal_confirmation_date,
            ket_stock=line.ket_stock,
            qty_kg=line.qty_kg,
            qty2=line.qty2,
            uom2=line.uom2,
            uom2_factor=line.uom2_factor,
            bom_id=line.bom_id,
            bom_size_id=line.bom_size_id,
            size_id=line.size_id,
            size_label=line.size_label,
            color_id=line.color_id,
            labdip_variant_code=line.labdip_variant_code,
            labdip_item_id=line.labdip_item_id,
            no_color_swatch=line.no_color_swatch,
        )
        if line.attribute_value_ids:
            attr_result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids)))
            db_line.attribute_values = attr_result.scalars().all()
        db.add(db_line)
        new_lines.append(db_line)

    if pack_refs:
        await db.flush()  # ids are assigned on INSERT, not on construction
        new_by_identity = {}
        for l in new_lines:
            new_by_identity.setdefault(
                (l.item_id, l.bom_id, l.bom_size_id, l.size_id, l.size_label, l.color_id), l.id
            )
        for po_id, old_line_id in pack_refs:
            new_id = new_by_identity.get(old_identity.get(str(old_line_id)))
            if new_id:
                await db.execute(
                    sa_update(PackingOrder)
                    .where(PackingOrder.id == po_id)
                    .values(sales_order_line_id=new_id)
                )

    await db.commit()

    # Line qtys may have moved past (or back under) what is packed.
    if await so_fulfilment_service.recompute_so_status(db, so_id):
        await db.commit()

    final_result = await db.execute(
        select(SalesOrder)
        .options(*_line_opts())
        .filter(SalesOrder.id == so.id)
    )
    so_refreshed = final_result.scalars().first()

    for line in so_refreshed.lines:
        _populate_line(line)
    await _populate_fulfilment(db, [so_refreshed])
    await _populate_variant_attrs(db, [so_refreshed])

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="SalesOrder",
        entity_id=str(so.id),
        details=f"Updated SO {so_refreshed.po_number}"
    )

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return so_refreshed

async def _close_reservations(db: AsyncSession, so_id, new_status: str) -> int:
    """Mark this SO's ACTIVE stock reservations RELEASED/CANCELLED. Returns the count."""
    rows = (await db.execute(
        select(StockReservation).filter(
            StockReservation.sales_order_id == so_id,
            StockReservation.status == "ACTIVE",
        )
    )).scalars().all()
    now = datetime.utcnow()
    for r in rows:
        r.status = new_status
        r.released_at = now
    return len(rows)


@router.put("/{so_id}/status", response_model=SalesOrderResponse)
async def update_sales_order_status(so_id: uuid.UUID, status: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('sales_order.edit'))):
    result = await db.execute(
        select(SalesOrder)
        .options(*_line_opts())
        .filter(SalesOrder.id == so_id)
    )
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")

    prev_status = so.status
    valid_statuses = ["PENDING", "READY", "PARTIAL", "SENT", "DELIVERED", "CANCELLED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    if status == "DELIVERED" and not user_has_permission(current_user, 'sales_order.close'):
        raise HTTPException(status_code=403, detail="Missing permission: sales_order.close")

    so.status = status
    if status == "DELIVERED":
        so.delivered_at = datetime.utcnow()

    # An order that has left the open set no longer holds on-hand FG. Netting
    # already filters reservations by open SO status, so this is bookkeeping, not
    # correctness — it stops rows sitting ACTIVE forever and keeps the SO's own
    # reservation panel honest. CANCELLED is a cancel, the rest are a release.
    if status not in netting_service.OPEN_SO_STATUSES:
        await _close_reservations(
            db, so.id,
            "CANCELLED" if status == "CANCELLED" else "RELEASED",
        )

    await db.commit()

    for line in so.lines:
        _populate_line(line)
    await _populate_fulfilment(db, [so])
    await _populate_variant_attrs(db, [so])

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="STATUS_CHANGE",
        entity_type="SalesOrder",
        entity_id=str(so.id),
        details=f"Status: {prev_status} -> {status}"
    )

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return so

@router.delete("/{so_id}")
async def delete_sales_order(so_id: uuid.UUID, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('sales_order.delete'))):
    result = await db.execute(select(SalesOrder).filter(SalesOrder.id == so_id))
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")

    mo_count = (await db.execute(
        select(func.count()).select_from(ManufacturingOrder).filter(ManufacturingOrder.sales_order_id == so_id)
    )).scalar()
    if mo_count:
        raise HTTPException(status_code=400, detail=f"Cannot delete SO: {mo_count} manufacturing order(s) still reference it")

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="sales_order",
        entity_id=str(so.id),
        details=f"Deleted SO {so.po_number}"
    )
    await db.delete(so)
    await db.commit()

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return {"status": "success"}


@router.get("/{so_id}/lineage")
async def get_sales_order_lineage(
    so_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sales_order.view", "sales_order.create_pr", "production_run.view", "production_run.create")),
):
    """Full production lineage for a Sales Order: SO → Production Runs → MOs → WOs → beams.

    Shows everything produced for this SO so users can see how every MO, WO and beam
    ties back to the order that started it. Shared component MOs (consolidated greige/base)
    are nested under the root MO that depends on them, with the dependency qty."""
    so_result = await db.execute(select(SalesOrder).filter(SalesOrder.id == so_id))
    so = so_result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")

    pr_result = await db.execute(
        select(ProductionRun)
        .filter(ProductionRun.sales_order_id == so_id)
        .order_by(ProductionRun.created_at)
    )
    prs = pr_result.scalars().all()
    pr_ids = [pr.id for pr in prs]

    # Load every MO under those PRs with the data needed to build the tree
    mos_by_pr: dict = {}
    all_mos: list = []
    if pr_ids:
        mos_result = await db.execute(
            select(ManufacturingOrder)
            .options(
                selectinload(ManufacturingOrder.item),
                selectinload(ManufacturingOrder.work_orders).joinedload(WorkOrder.work_center),
                selectinload(ManufacturingOrder.required_dependencies),
            )
            .filter(ManufacturingOrder.production_run_id.in_(pr_ids))
        )
        for mo in mos_result.scalars().unique().all():
            mos_by_pr.setdefault(mo.production_run_id, []).append(mo)
            all_mos.append(mo)

    # Beams produced by any WO under this SO: source_wo_id → beam Batch
    all_wo_ids = [wo.id for mo in all_mos for wo in mo.work_orders]
    beams_by_wo: dict = {}
    if all_wo_ids:
        batch_rows = await db.execute(
            select(Batch).options(joinedload(Batch.item)).filter(Batch.source_wo_id.in_(all_wo_ids))
        )
        batches = batch_rows.scalars().all()
        keys = [str(b.id) for b in batches]
        remaining_map: dict = {}
        if keys:
            bal = await db.execute(
                select(StockBalance.batch_key, func.sum(StockBalance.qty))
                .filter(StockBalance.batch_key.in_(keys))
                .group_by(StockBalance.batch_key)
            )
            remaining_map = {k: float(v or 0) for k, v in bal.all()}
        for b in batches:
            beams_by_wo.setdefault(b.source_wo_id, []).append({
                "id": str(b.id),
                "batch_number": b.batch_number,
                "item_code": b.item.code if b.item else None,
                "ends": b.ends,
                "remaining": remaining_map.get(str(b.id), 0.0),
            })

    def wo_node(wo) -> dict:
        return {
            "id": str(wo.id),
            "code": wo.code,
            "name": wo.name,
            "sequence": wo.sequence,
            "work_center_name": wo.work_center.name if wo.work_center else None,
            "status": wo.status,
            "qty": float(wo.qty) if wo.qty is not None else None,
            "beams": beams_by_wo.get(wo.id, []),
        }

    def mo_node(mo, dep_qty=None) -> dict:
        return {
            "id": str(mo.id),
            "code": mo.code,
            "item_code": mo.item.code if mo.item else None,
            "item_name": mo.item.name if mo.item else None,
            "qty": float(mo.qty),
            "status": mo.status,
            "is_shared_component": mo.is_shared_component,
            "dep_qty": dep_qty,
            "work_orders": [wo_node(w) for w in sorted(mo.work_orders, key=lambda x: x.sequence)],
            "component_mos": [],
        }

    production_runs = []
    for pr in prs:
        pr_mos = mos_by_pr.get(pr.id, [])
        comp_map = {mo.id: mo for mo in pr_mos if mo.is_shared_component}
        roots = [mo for mo in pr_mos if not mo.is_shared_component]
        root_nodes = []
        pegged: set = set()
        for r in roots:
            rn = mo_node(r)
            for dep in r.required_dependencies:
                comp = comp_map.get(dep.required_mo_id)
                if comp:
                    pegged.add(dep.required_mo_id)
                    rn["component_mos"].append(mo_node(comp, dep_qty=float(dep.qty)))
            root_nodes.append(rn)
        # Components not pegged to any root (defensive — should be rare)
        unpegged = [mo_node(c) for cid, c in comp_map.items() if cid not in pegged]
        production_runs.append({
            "id": str(pr.id),
            "code": pr.code,
            "status": pr.status,
            "manufacturing_orders": root_nodes,
            "unpegged_components": unpegged,
        })

    return {
        "sales_order": {
            "id": str(so.id),
            "po_number": so.po_number,
            "customer_name": so.customer_name,
            "status": so.status,
        },
        "production_runs": production_runs,
    }
