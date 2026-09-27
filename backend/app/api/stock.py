from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from app.db.session import get_async_db, get_db
from app.services import stock_service, audit_service, kpi_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from app.schemas import StockLedgerResponse, StockBalanceResponse, PaginatedStockBalanceResponse, PaginatedStockLedgerResponse, StockEntryCreate, StockTransferCreate, StockBulkTransferCreate, BookingStockRow, BookingDemandMO, BookingSupplyMO, BookingReservedSO, PaginatedBookingStockResponse
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission, get_current_admin, category_scope_ok
from app.models.item import Item
from app.models.location import Location
from app.models.stock_balance import StockBalance
from app.models.audit import AuditLog
from app.models.work_order import WorkOrder
from app.models.goods_receipt import GoodsReceipt
from app.models.purchase import PurchaseOrder
from datetime import datetime
from typing import Optional
import asyncio as _asyncio
import time
import uuid as _uuid

# reference_types whose reference_id is a raw entity UUID (str(entity.id)) rather
# than a human-readable code — these need a resolved label for display.
_WO_REF_TYPES = {"Staging", "Leftover Beam", "Beam Merge", "Work Order"}

router = APIRouter()

# reference_type vocabulary is a handful of fixed strings stamped by services when
# they write ledger rows — it changes essentially never. Without caching, the ledger
# page ran an unconditional (unfiltered by date/location/etc) DISTINCT scan over the
# WHOLE stock_ledger table on every single load just to fill a filter dropdown; on a
# prod DB with real history that's a full-table scan for a value that hasn't changed
# since last request.
_ref_types_cache: dict = {"value": None, "at": 0.0}
_REF_TYPES_TTL_SECONDS = 300


async def _get_reference_types(db: AsyncSession) -> list[str]:
    now = time.monotonic()
    if _ref_types_cache["value"] is not None and now - _ref_types_cache["at"] < _REF_TYPES_TTL_SECONDS:
        return _ref_types_cache["value"]
    from app.models.stock_ledger import StockLedger
    result = sorted([
        rt for rt in (await db.execute(select(StockLedger.reference_type).distinct())).scalars().all() if rt
    ])
    _ref_types_cache["value"] = result
    _ref_types_cache["at"] = now
    return result

@router.get("/stock", response_model=PaginatedStockLedgerResponse)
async def get_stock_ledger(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None, description="Match item name/code or reference id"),
    location_id: Optional[str] = Query(None, description="Location id, or comma-separated ids (e.g. a warehouse plus its descendants)"),
    category_id: Optional[str] = Query(None, description="Item category id, or comma-separated ids (a category plus its descendants)"),
    reference_type: Optional[str] = Query(None),
    direction: Optional[str] = Query(None, description="'in' (qty >= 0) or 'out' (qty < 0)"),
    window: PageWindow = Depends(PageParams(default_size=100)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("stock_ledger.view", "stock_on_hand.view"))
):
    from app.models.stock_ledger import StockLedger
    from sqlalchemy import or_, case
    from sqlalchemy.orm import selectinload, joinedload

    # Build the shared filter set once so the page query, count, and aggregates
    # all describe the exact same slice of the ledger.
    conditions = []
    if start_date:
        conditions.append(StockLedger.created_at >= start_date)
    if end_date:
        conditions.append(StockLedger.created_at <= end_date)
    if location_id:
        loc_ids = [x for x in location_id.split(",") if x]
        conditions.append(StockLedger.location_id.in_(loc_ids) if len(loc_ids) > 1 else StockLedger.location_id == loc_ids[0])
    if category_id:
        cat_ids = [x for x in category_id.split(",") if x]
        if cat_ids:
            conditions.append(StockLedger.item_id.in_(
                select(Item.id).where(Item.category_id.in_(cat_ids))
            ))
    if reference_type:
        conditions.append(StockLedger.reference_type == reference_type)
    if direction == "in":
        conditions.append(StockLedger.qty_change >= 0)
    elif direction == "out":
        conditions.append(StockLedger.qty_change < 0)
    if search and search.strip():
        # Tokenised: every whitespace-separated token must match somewhere
        # (item name/code or reference). Typing "BEAM 1" has to find
        # "BEAM  150 - 90" even when the stored name carries a double space or a
        # non-breaking space — those render identically in HTML, so a literal
        # substring match silently returns nothing.
        for tok in search.split():
            term = f"%{tok}%"
            item_sub = select(Item.id).where(or_(Item.name.ilike(term), Item.code.ilike(term)))
            conditions.append(or_(StockLedger.reference_id.ilike(term), StockLedger.item_id.in_(item_sub)))

    total = (await db.execute(
        select(func.count(StockLedger.id)).where(*conditions)
    )).scalar() or 0

    # In / out totals over the WHOLE filtered set (the page-level sum would lie).
    agg = (await db.execute(
        select(
            func.coalesce(func.sum(case((StockLedger.qty_change > 0, StockLedger.qty_change), else_=0)), 0),
            func.coalesce(func.sum(case((StockLedger.qty_change < 0, StockLedger.qty_change), else_=0)), 0),
        ).where(*conditions)
    )).first()
    total_in = float(agg[0] or 0)
    total_out = float(agg[1] or 0)

    rows = (await db.execute(
        window.apply(
            select(StockLedger).where(*conditions)
            .options(selectinload(StockLedger.attribute_values), joinedload(StockLedger.batch))
            .order_by(StockLedger.created_at.desc())
        )
    )).scalars().all()

    # Resolve item + location display fields for just this page (small IN queries),
    # so the client renders straight from the response instead of cross-referencing
    # whatever happens to be loaded in its caches.
    item_ids = {r.item_id for r in rows}
    loc_ids = {r.location_id for r in rows}
    item_map = {}
    if item_ids:
        from app.models.category import Category
        for iid, nm, cd, uom, cat_id, cat_name in (await db.execute(
            select(Item.id, Item.name, Item.code, Item.uom, Item.category_id, Category.name)
            .outerjoin(Category, Category.id == Item.category_id)
            .where(Item.id.in_(item_ids))
        )).all():
            item_map[iid] = (nm, cd, uom, cat_id, cat_name)
    loc_map = {}
    if loc_ids:
        for lid, nm in (await db.execute(
            select(Location.id, Location.name).where(Location.id.in_(loc_ids))
        )).all():
            loc_map[lid] = nm

    # Some reference_types store the raw entity UUID (str(entity.id)) instead of a
    # human-readable code — resolve those to a friendly label so the ledger never
    # surfaces a bare UUID to the user.
    ref_label_map: dict[str, str] = {}
    wo_ref_ids = {r.reference_id for r in rows if r.reference_type in _WO_REF_TYPES and r.reference_id}
    if wo_ref_ids:
        wo_uuids = []
        for rid in wo_ref_ids:
            try:
                wo_uuids.append(_uuid.UUID(rid))
            except (ValueError, TypeError):
                pass
        if wo_uuids:
            for wid, code, name in (await db.execute(
                select(WorkOrder.id, WorkOrder.code, WorkOrder.name).where(WorkOrder.id.in_(wo_uuids))
            )).all():
                ref_label_map[str(wid)] = code or name

    gr_ref_ids = {r.reference_id for r in rows if r.reference_type == "Goods Receipt" and r.reference_id}
    if gr_ref_ids:
        gr_uuids = []
        for rid in gr_ref_ids:
            try:
                gr_uuids.append(_uuid.UUID(rid))
            except (ValueError, TypeError):
                pass
        if gr_uuids:
            for gid, po_number in (await db.execute(
                select(GoodsReceipt.id, PurchaseOrder.po_number)
                .join(PurchaseOrder, PurchaseOrder.id == GoodsReceipt.po_id)
                .where(GoodsReceipt.id.in_(gr_uuids))
            )).all():
                ref_label_map[str(gid)] = po_number

    items = []
    for r in rows:
        nm, cd, uom, cat_id, cat_name = item_map.get(r.item_id, ("", "", "", None, None))
        items.append({
            "id": r.id,
            "item_id": r.item_id,
            "item_name": nm or "",
            "item_code": cd or "",
            "item_uom": uom or "",
            "item_category_id": cat_id,
            "item_category_name": cat_name,
            "attribute_value_ids": [v.id for v in (r.attribute_values or [])],
            "location_id": r.location_id,
            "location_name": loc_map.get(r.location_id, "") or "",
            "qty_change": float(r.qty_change),
            "qty_cones_change": r.qty_cones_change,
            "qty_boxes_change": r.qty_boxes_change,
            "qty_drums_change": r.qty_drums_change,
            "reference_type": r.reference_type,
            "reference_id": r.reference_id,
            "reference_label": ref_label_map.get(r.reference_id),
            "batch_id": r.batch_id,
            "batch_number": r.batch.batch_number if r.batch else None,
            "vendor_lot": r.batch.vendor_lot if r.batch else None,
            "created_at": r.created_at,
        })

    reference_types = await _get_reference_types(db)

    return window.envelope(
        items,
        total,
        total_in=total_in,
        total_out=total_out,
        reference_types=reference_types,
    )

@router.post("/stock", status_code=201)
async def create_stock_entry(
    payload: StockEntryCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('stock_on_hand.adjust'))
):
    item_result = await db.execute(select(Item).filter(Item.code == payload.item_code))
    item = item_result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item '{payload.item_code}' not found")

    if not category_scope_ok(current_user, item.category_id):
        raise HTTPException(status_code=403, detail="Not authorized for this category")

    loc_result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = loc_result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail=f"Location '{payload.location_code}' not found")

    attribute_value_ids = [str(uid) for uid in payload.attribute_value_ids]
    await stock_service.add_stock_entry(
        db=db,
        item_id=item.id,
        location_id=location.id,
        qty_change=payload.qty,
        reference_type=payload.reference_type,
        reference_id=payload.reference_id,
        attribute_value_ids=attribute_value_ids,
        batch_id=payload.batch_id,
        cones_change=payload.qty_cones or 0,
        boxes_change=payload.qty_boxes or 0,
        drums_change=payload.qty_drums or 0,
    )
    await db.commit()

    await audit_service.log_activity(
        db=db,
        user_id=current_user.id,
        action="create",
        entity_type="stock_entry",
        entity_id=str(item.id),
        changes={
            "item": payload.item_code,
            "location": payload.location_code,
            "qty": payload.qty,
            "reason": payload.reference_id,
            "batch_id": str(payload.batch_id) if payload.batch_id else None,
        },
    )

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": "Stock entry recorded"}


@router.post("/stock/transfer", status_code=201)
async def transfer_stock(
    payload: StockTransferCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('stock_on_hand.move')),
):
    if payload.qty <= 0:
        raise HTTPException(status_code=400, detail="qty must be positive")
    if payload.from_location_id == payload.to_location_id:
        raise HTTPException(status_code=400, detail="Source and destination locations must differ")

    item_result = await db.execute(select(Item).filter(Item.id == payload.item_id))
    item = item_result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not category_scope_ok(current_user, item.category_id):
        raise HTTPException(status_code=403, detail="Not authorized for this category")

    loc_result = await db.execute(
        select(Location).filter(Location.id.in_([payload.from_location_id, payload.to_location_id]))
    )
    locs = {loc.id: loc for loc in loc_result.scalars().all()}
    if len(locs) != 2:
        raise HTTPException(status_code=404, detail="Location not found")

    if item.lot_tracked and not payload.batch_id:
        raise HTTPException(status_code=400, detail=f"Item {item.code} is lot-tracked — select a lot/batch to transfer")

    attrs = [str(u) for u in payload.attribute_value_ids]
    ref = f"{locs[payload.from_location_id].code} -> {locs[payload.to_location_id].code}"

    c = payload.qty_cones or 0
    b = payload.qty_boxes or 0
    d = payload.qty_drums or 0

    # OUT first — per-batch negative stock guard blocks over-transfer
    await stock_service.add_stock_entry(
        db, item_id=item.id, location_id=payload.from_location_id,
        qty_change=-payload.qty, reference_type="Transfer", reference_id=ref,
        attribute_value_ids=attrs, batch_id=payload.batch_id,
        cones_change=-c, boxes_change=-b, drums_change=-d,
    )
    await stock_service.add_stock_entry(
        db, item_id=item.id, location_id=payload.to_location_id,
        qty_change=payload.qty, reference_type="Transfer", reference_id=ref,
        attribute_value_ids=attrs, batch_id=payload.batch_id,
        cones_change=c, boxes_change=b, drums_change=d,
    )
    await db.commit()

    await audit_service.log_activity(
        db=db,
        user_id=current_user.id,
        action="TRANSFER",
        entity_type="stock_entry",
        entity_id=str(item.id),
        changes={"item": item.code, "qty": payload.qty, "route": ref, "batch_id": str(payload.batch_id) if payload.batch_id else None},
    )

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": "Transfer recorded"}


@router.post("/stock/transfer/bulk", status_code=201)
async def transfer_stock_bulk(
    payload: StockBulkTransferCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('stock_on_hand.move')),
):
    """Move several on-hand rows to ONE destination in a single transaction.

    All-or-nothing: every line is validated up front and all ledger writes share
    one commit, so a negative-stock guard tripping on line 7 rolls back lines 1-6
    rather than leaving a half-done move on the floor.
    """
    if not payload.lines:
        raise HTTPException(status_code=400, detail="No lines to transfer")

    item_ids = {ln.item_id for ln in payload.lines}
    loc_ids = {ln.from_location_id for ln in payload.lines} | {payload.to_location_id}

    items_result = await db.execute(select(Item).filter(Item.id.in_(item_ids)))
    items = {it.id: it for it in items_result.scalars().all()}
    locs_result = await db.execute(select(Location).filter(Location.id.in_(loc_ids)))
    locs = {loc.id: loc for loc in locs_result.scalars().all()}
    if payload.to_location_id not in locs:
        raise HTTPException(status_code=404, detail="Destination location not found")

    # Validate everything before writing anything.
    for idx, ln in enumerate(payload.lines, start=1):
        item = items.get(ln.item_id)
        if not item:
            raise HTTPException(status_code=404, detail=f"Line {idx}: item not found")
        if ln.qty <= 0:
            raise HTTPException(status_code=400, detail=f"Line {idx} ({item.code}): qty must be positive")
        if ln.from_location_id not in locs:
            raise HTTPException(status_code=404, detail=f"Line {idx} ({item.code}): source location not found")
        if ln.from_location_id == payload.to_location_id:
            raise HTTPException(status_code=400, detail=f"Line {idx} ({item.code}): already at the destination location")
        if not category_scope_ok(current_user, item.category_id):
            raise HTTPException(status_code=403, detail=f"Line {idx} ({item.code}): not authorized for this category")
        if item.lot_tracked and not ln.batch_id:
            raise HTTPException(status_code=400, detail=f"Line {idx}: item {item.code} is lot-tracked — select a lot to transfer")

    dest_code = locs[payload.to_location_id].code
    for ln in payload.lines:
        item = items[ln.item_id]
        attrs = [str(u) for u in ln.attribute_value_ids]
        ref = f"{locs[ln.from_location_id].code} -> {dest_code}"
        c = ln.qty_cones or 0
        b = ln.qty_boxes or 0
        d = ln.qty_drums or 0
        # OUT first — per-batch negative stock guard blocks over-transfer
        await stock_service.add_stock_entry(
            db, item_id=item.id, location_id=ln.from_location_id,
            qty_change=-ln.qty, reference_type="Transfer", reference_id=ref,
            attribute_value_ids=attrs, batch_id=ln.batch_id,
            cones_change=-c, boxes_change=-b, drums_change=-d,
        )
        await stock_service.add_stock_entry(
            db, item_id=item.id, location_id=payload.to_location_id,
            qty_change=ln.qty, reference_type="Transfer", reference_id=ref,
            attribute_value_ids=attrs, batch_id=ln.batch_id,
            cones_change=c, boxes_change=b, drums_change=d,
        )
    await db.commit()

    await audit_service.log_activity(
        db=db,
        user_id=current_user.id,
        action="TRANSFER",
        entity_type="stock_entry",
        entity_id=str(payload.to_location_id),
        details=f"Combined move of {len(payload.lines)} stock rows to {dest_code}",
        changes={
            "destination": dest_code,
            "line_count": len(payload.lines),
            "lines": [
                {
                    "item": items[ln.item_id].code,
                    "from": locs[ln.from_location_id].code,
                    "qty": ln.qty,
                    "batch_id": str(ln.batch_id) if ln.batch_id else None,
                }
                for ln in payload.lines
            ],
        },
    )

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": f"Moved {len(payload.lines)} rows to {dest_code}", "moved": len(payload.lines)}


# ── /stock/balance is the UNBOUNDED LOOKUP FEED — do NOT paginate it ──────────
# DataContext loads this whole list once and every consumer treats it as a *lookup
# table*, not a list: manufacturing material availability
# (frontend/app/components/manufacturing/useManufacturingHelpers.ts filters and
# iterates the full array), the desktop/mobile dashboards, the QR scanner view and
# the section home cards. Slicing it to a page would not truncate a list — it would
# silently return WRONG availability numbers for every item that fell off the page.
# Same reasoning as GET /partners/lookup, which exists for exactly this: the
# dropdowns and name resolution need every row, so the lookup feed stays whole
# while the list view pages against the windowed route.
#
# The Stock On-Hand *grid* uses GET /stock/balance/paginated below (mirroring the
# /items vs /items/lookup split). New list views go there; leave this one whole.
@router.get("/stock/balance", response_model=list[StockBalanceResponse])
async def get_stock_balance_api(
    item_ids: Optional[str] = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("stock_on_hand.view", "lot.view", "work_order.view", "booking_stock.view", "quarantine.view")),
):
    # item_ids (comma-separated) scopes the plant-wide balance table to a handful
    # of items — pages that only need availability for a specific item set (e.g.
    # Packing) should pass this instead of pulling every balance row in the plant.
    ids = None
    if item_ids:
        import uuid as _uuid
        ids = []
        for raw in item_ids.split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                ids.append(_uuid.UUID(raw))
            except ValueError:
                continue
    return await stock_service.get_all_stock_balances(db, user=current_user, item_ids=ids)


# Sort keys accepted by /stock/balance/paginated — they are the Stock On-Hand grid's
# sortable column keys, kept 1:1 with the header cells so the client can pass its own
# key straight through.
_SOH_SORT_KEYS = ("item", "itemCategory", "location", "warehouse", "batch", "mo", "wo", "qty", "packaging", "notes")


@router.get("/stock/balance/paginated", response_model=PaginatedStockBalanceResponse)
async def get_stock_balance_paginated(
    search: Optional[str] = Query(None, description="Matches item name/code, item category, location, warehouse, lot number, supplier lot, lot notes, MO/WO code"),
    location_id: Optional[str] = Query(None, description="Location id — matches that location plus any bin directly under it"),
    warehouse_id: Optional[str] = Query(None, description="Root-warehouse id above the row's location; '__uncat__' = location with no warehouse above it"),
    category_id: Optional[str] = Query(None, description="Item category id, or comma-separated ids (a category plus its descendants)"),
    mo_code: Optional[str] = Query(None, description="Exact MO code — set by clicking a row's MO chip"),
    wo_code: Optional[str] = Query(None, description="Exact WO code — set by clicking a row's WO chip"),
    hide_rejected: bool = Query(False, description="Drop rows whose lot is QC-flagged (quality_status != GOOD)"),
    sort_by: Optional[str] = Query(None, description=" | ".join(_SOH_SORT_KEYS)),
    sort_dir: str = Query("asc", description="asc | desc"),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("stock_on_hand.view", "lot.view", "work_order.view", "booking_stock.view", "quarantine.view")),
):
    """Server-paginated stock-balance rows for the Stock On-Hand grid.

    Same row shape as /stock/balance (see StockBalanceResponse) but filtered,
    sorted and windowed in SQL instead of in the browser. The filters mirror the
    grid's controls exactly; the aggregates in the envelope are computed over the
    whole filtered set because the footer summary reads them.

    This is the LIST endpoint. /stock/balance stays the unbounded lookup feed —
    see the note above it.
    """
    from sqlalchemy import or_, and_, case, cast, String as SAString, nullslast
    from sqlalchemy.orm import aliased, selectinload
    from app.models.category import Category
    from app.models.batch import Batch
    from app.models.manufacturing import ManufacturingOrder, manufacturing_order_values
    from app.models.color import Color
    from app.models.attribute import Attribute, AttributeValue
    from app.services.stock_service import _bom_size_label

    # A shade's hex can live in the Color Library row (Color.hex) or, when that's
    # blank, the mirrored `Colors` variant attribute value the MO carries
    # (AttributeValue.hex) — same fallback chain resolveColorHex uses on the
    # frontend and _resolve_batch_variants resolves for /batches/paginated.
    # Scalar subquery (not a join) so a color pick doesn't multiply balance rows
    # the way joining the MO<->attribute-value M2M directly would.
    attr_color_hex = (
        select(AttributeValue.hex)
        .select_from(manufacturing_order_values)
        .join(AttributeValue, AttributeValue.id == manufacturing_order_values.c.attribute_value_id)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .where(
            manufacturing_order_values.c.manufacturing_order_id == ManufacturingOrder.id,
            Attribute.system_role == "color",
        )
        .limit(1)
        .correlate(ManufacturingOrder)
        .scalar_subquery()
    )

    # Location + its parent + its grandparent: the hierarchy is warehouse > zone > bin,
    # so the root warehouse of a row is the grandparent for a bin and the parent for a
    # zone — exactly what the client's getWarehouseId/getWarehouseName walk up to.
    LocL = aliased(Location)
    LocP = aliased(Location)
    LocG = aliased(Location)
    wh_id_expr = func.coalesce(LocG.id, LocP.id)
    wh_name_expr = func.coalesce(LocG.name, LocP.name)

    # An all-zero balance row is not stock; get_all_stock_balances drops it in Python
    # and this must drop the same rows or the two endpoints disagree on `total`.
    nonzero = or_(
        StockBalance.qty != 0,
        func.coalesce(StockBalance.qty_cones, 0) != 0,
        func.coalesce(StockBalance.qty_boxes, 0) != 0,
        func.coalesce(StockBalance.qty_drums, 0) != 0,
    )
    # A lot is "rejected" only when it carries a non-GOOD QC flag; non-lotted rows and
    # unflagged lots are GOOD (matches the service's quality_status default).
    rejected_expr = and_(
        StockBalance.batch_key != "",
        Batch.quality_status.is_not(None),
        Batch.quality_status != "GOOD",
    )

    conditions = [nonzero]
    if location_id:
        # The grid's location picker offers zones and bins; picking a zone also shows
        # the bins under it (client: location_id === filter || parent is the filter).
        conditions.append(or_(StockBalance.location_id == location_id, LocL.parent_id == location_id))
    if warehouse_id:
        if warehouse_id == "__uncat__":
            conditions.append(wh_id_expr.is_(None))
        else:
            conditions.append(wh_id_expr == warehouse_id)
    if category_id:
        # Comma-separated descendant-inclusive id set, same contract as /stock — the
        # client already owns the category tree and expands the selection.
        cat_ids = [x for x in category_id.split(",") if x]
        if cat_ids:
            conditions.append(Item.category_id.in_(cat_ids))
    if mo_code:
        conditions.append(ManufacturingOrder.code == mo_code)
    if wo_code:
        conditions.append(WorkOrder.code == wo_code)
    if hide_rejected:
        conditions.append(~rejected_expr)
    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append(or_(
            Item.name.ilike(term),
            Item.code.ilike(term),
            Category.name.ilike(term),
            LocL.name.ilike(term),
            wh_name_expr.ilike(term),
            Batch.batch_number.ilike(term),
            Batch.vendor_lot.ilike(term),
            Batch.notes.ilike(term),
            # The grid shows batch_number when it resolves and falls back to the raw
            # key otherwise, so the key is only searchable on that fallback — matching
            # it always would make bare uuids match on any hex letter/digit typed.
            and_(StockBalance.batch_key != "", Batch.batch_number.is_(None), StockBalance.batch_key.ilike(term)),
            ManufacturingOrder.code.ilike(term),
            WorkOrder.code.ilike(term),
        ))

    def joined(stmt):
        """The one join graph shared by the page query, the count and the aggregates,
        so all three describe the exact same slice."""
        return (
            stmt.select_from(StockBalance)
            .join(Item, Item.id == StockBalance.item_id)
            .outerjoin(Category, Category.id == Item.category_id)
            .outerjoin(LocL, LocL.id == StockBalance.location_id)
            .outerjoin(LocP, LocP.id == LocL.parent_id)
            .outerjoin(LocG, LocG.id == LocP.parent_id)
            # batch_key is a plain string column, not a FK — cast the Batch PK to text
            # rather than the key to uuid, which would blow up on any non-uuid value.
            .outerjoin(Batch, cast(Batch.id, SAString) == StockBalance.batch_key)
            .outerjoin(WorkOrder, WorkOrder.id == Batch.source_wo_id)
            .outerjoin(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
            .outerjoin(Color, Color.id == ManufacturingOrder.color_id)
            .where(*conditions)
        )

    # Count + every footer aggregate in one pass over the filtered set. Computing these
    # from the page would report page-only numbers.
    agg = (await db.execute(joined(select(
        func.count(StockBalance.id),
        func.coalesce(func.sum(case((StockBalance.qty < 0, 1), else_=0)), 0),
        func.coalesce(func.sum(case((rejected_expr, 1), else_=0)), 0),
        func.coalesce(func.sum(case((rejected_expr, StockBalance.qty), else_=0)), 0),
    )))).first()
    total = int(agg[0] or 0)
    negative_count = int(agg[1] or 0)
    rejected_count = int(agg[2] or 0)
    rejected_qty = float(agg[3] or 0)

    # Unfiltered row count — the footer's "Total: N SKUs", which used to be the length
    # of the whole client-side array.
    total_rows = int((await db.execute(select(func.count(StockBalance.id)).where(nonzero))).scalar() or 0)

    # Lot label the grid sorts on: batch_number when resolvable, else the raw key,
    # NULL for non-lotted rows (which the client's sorter parks last either way).
    batch_label_expr = case(
        (StockBalance.batch_key != "", func.coalesce(Batch.batch_number, StockBalance.batch_key)),
        else_=None,
    )
    # Packaging sorts on the same total the grid shows: independent tallies, absolute.
    pkg_expr = (
        func.abs(func.coalesce(StockBalance.qty_cones, 0))
        + func.abs(func.coalesce(StockBalance.qty_boxes, 0))
        + func.abs(func.coalesce(StockBalance.qty_drums, 0))
    )
    sort_map = {
        "item": Item.name,
        "itemCategory": Category.name,
        "location": LocL.name,
        "warehouse": wh_name_expr,
        "batch": batch_label_expr,
        "mo": ManufacturingOrder.code,
        "wo": WorkOrder.code,
        "qty": StockBalance.qty,
        "packaging": pkg_expr,
        "notes": Batch.notes,
    }
    sort_col = sort_map.get(sort_by or "")
    descending = (sort_dir or "").lower().startswith("d")
    if sort_col is not None:
        order = [nullslast(sort_col.desc() if descending else sort_col.asc())]
    else:
        order = [Item.name.asc(), LocL.name.asc()]
    # Deterministic tiebreak: without it OFFSET/LIMIT can repeat or skip rows between
    # pages whenever the sort key ties.
    order.append(StockBalance.id.asc())

    rows = (await db.execute(
        window.apply(
            joined(select(
                StockBalance,
                Item.name, Item.code, Item.uom, Item.ends, Item.category_id, Category.name,
                LocL.name,
                Batch.batch_number, Batch.vendor_lot, Batch.quality_status, Batch.notes,
                Batch.bom_size_snapshot, Batch.ends,
                ManufacturingOrder.id, ManufacturingOrder.code, WorkOrder.code,
                ManufacturingOrder.labdip_variant_code, Color.code, Color.name,
                func.coalesce(Color.hex, attr_color_hex),
            ))
            .options(selectinload(StockBalance.attribute_values))
            .order_by(*order)
        )
    )).all()

    items = []
    for (bal, i_name, i_code, i_uom, i_ends, i_cat_id, cat_name, loc_name,
         b_number, b_vendor_lot, b_quality, b_notes, b_snapshot, b_ends,
         mo_id, mo_code, wo_code,
         mo_labdip_code, color_code, color_name, color_hex) in rows:
        lotted = bool(bal.batch_key)
        notes = (b_notes or "").strip() if lotted else ""
        items.append({
            "item_id": bal.item_id,
            "item_name": i_name or str(bal.item_id),
            "item_code": i_code or str(bal.item_id),
            "item_uom": i_uom or "",
            # A specific lot's ends overrides the item spec at beam birth (see
            # WorkOrder.ends) — same fallback chain as work_orders.py's beam WO helpers.
            "item_ends": b_ends if lotted and b_ends else i_ends,
            "item_category_id": i_cat_id,
            "item_category_name": cat_name,
            "location_id": bal.location_id,
            "location_name": loc_name or str(bal.location_id),
            "attribute_value_ids": [v.id for v in bal.attribute_values],
            "qty": float(bal.qty),
            "qty_cones": int(bal.qty_cones or 0),
            "qty_boxes": int(bal.qty_boxes or 0),
            "qty_drums": int(bal.qty_drums or 0),
            "batch_key": bal.batch_key,
            "batch_number": b_number if lotted else None,
            "vendor_lot": (b_vendor_lot or None) if lotted else None,
            "size_label": _bom_size_label(b_snapshot) if lotted else None,
            "batch_notes": notes or None,
            "quality_status": b_quality if (lotted and b_quality and b_quality != "GOOD") else "GOOD",
            "mo_id": mo_id if lotted else None,
            "mo_code": mo_code if lotted else None,
            "wo_code": wo_code if lotted else None,
            # Shade identity of the MO that produced this lot (Color Library, via
            # source_wo -> MO.color_id) — same resolution /batches/paginated uses
            # (_resolve_batch_origins), so a lot's shade chip agrees everywhere.
            "color_code": color_code if lotted else None,
            "color_name": color_name if lotted else None,
            "color_hex": color_hex if lotted else None,
            "labdip_variant_code": mo_labdip_code if lotted else None,
        })

    return window.envelope(
        items,
        total,
        negative_count=negative_count,
        rejected_count=rejected_count,
        rejected_qty=rejected_qty,
        total_rows=total_rows,
    )


# The netting pass below walks every ONGOING MO plant-wide and is independent of
# location_id/search/page/size (those only trim the already-computed row set) — so
# the expensive part is cached briefly and dropped whenever something that could
# change it broadcasts, instead of recomputed on every page load/refresh. Each
# process/worker holds its own cache and independently receives every broadcast
# (local or via Redis), so invalidation stays correct across multiple workers.
# Booking-stock netting is expensive (loads every open MO with 4 eager relations
# + a plant-wide on-hand aggregate). It changes on stock, MO, WO and PR mutations —
# all common in an active plant — so nulling the cache on every such event left it
# cold on nearly every page load. Instead we serve stale-while-revalidate: an
# invalidating event marks the rows stale but keeps serving them; the next request
# returns the stale rows immediately and kicks off a single background recompute so
# the following request is fresh. Booking stock is an advisory planning view, so a
# few-seconds-stale netting number between a mutation and the background refresh is
# an acceptable trade for never blocking a load on the full recompute.
_booking_cache: dict = {"rows": None, "at": 0.0, "stale": True, "refreshing": False}
_BOOKING_TTL_SECONDS = 60
_BOOKING_INVALIDATING_TYPES = {"STOCK_UPDATE", "MANUFACTURING_ORDER_UPDATE", "WORK_ORDER_UPDATE", "PRODUCTION_RUN_UPDATE"}

# Keep strong refs to in-flight background tasks so the event loop doesn't GC them
# mid-run (documented asyncio.create_task footgun).
_booking_bg_tasks: set = set()


def _invalidate_booking_cache(message: dict):
    if message.get("type") in _BOOKING_INVALIDATING_TYPES:
        _booking_cache["stale"] = True


manager.register_invalidation_hook(_invalidate_booking_cache)


async def booking_rows_cached() -> list:
    """Booking-stock rows, served from the same cache the /stock/availability
    endpoint uses (cold-compute, then stale-while-revalidate).

    Public so other views can net against plant-wide demand without duplicating
    _compute_booking_rows — the PR material panel does exactly that, and any second
    copy of this netting would drift from the Booking Stock page it must agree with.
    """
    now = time.monotonic()
    if _booking_cache["rows"] is None:
        return await _recompute_booking_cache()
    if _booking_cache["stale"] or now - _booking_cache["at"] >= _BOOKING_TTL_SECONDS:
        _spawn_booking_refresh()
    return _booking_cache["rows"]


async def _recompute_booking_cache() -> list:
    """Recompute booking rows on a fresh session and store them. Returns the rows."""
    from app.core.db_manager import db_manager
    async for session in db_manager.get_async_session():
        rows = await _compute_booking_rows(session)
        _booking_cache["rows"] = rows
        _booking_cache["at"] = time.monotonic()
        _booking_cache["stale"] = False
        return rows
    return []


async def _refresh_booking_cache_bg():
    """Background stale-while-revalidate refresh; at most one runs at a time."""
    if _booking_cache["refreshing"]:
        return
    _booking_cache["refreshing"] = True
    try:
        await _recompute_booking_cache()
    except Exception:
        # A failed background refresh must not crash anything — the stale rows keep
        # serving and the next invalidation/expiry will retry.
        pass
    finally:
        _booking_cache["refreshing"] = False


def _spawn_booking_refresh():
    task = _asyncio.create_task(_refresh_booking_cache_bg())
    _booking_bg_tasks.add(task)
    task.add_done_callback(_booking_bg_tasks.discard)


def warm_booking_cache() -> None:
    """Compute the first set of booking rows in the background at startup.

    Cold, the cache has no rows to serve stale, so `booking_rows_cached()` runs the
    whole plant-wide netting pass INLINE and the unlucky first caller waits it out —
    the first PR material panel expanded after a deploy, or the first /booking-stock
    load. Warming it costs the same one pass, just off the request path. Purely a
    head start: if it fails the cache stays cold and the next request behaves exactly
    as it does today."""
    _spawn_booking_refresh()


async def _compute_booking_rows(db: AsyncSession) -> list:
    """Booking-stock / material-availability netting.

    For every component demanded by an ONGOING manufacturing order (PENDING or
    IN_PROGRESS), nets physical on-hand against outstanding demand and against
    incoming scheduled receipts (the outstanding output of in-flight production
    MOs that produce the item):

        net_free = on_hand + incoming - required

    Committed-supply rule: a sales-order-linked root MO's outstanding output is
    promised to that order and is EXCLUDED from incoming — it never covers
    other demand. Shared-component/child MOs and uncommitted stock-build roots
    stay in supply.

    Demand is OUTSTANDING-based: a component is scaled by the MO's remaining
    output (MO.qty - completed), so already-produced quantity stops counting.

    Reserved: on-hand promised to an open sales order by `stock_reservations`
    (written when a PR's root FG netting covered part of an order from stock) is
    subtracted too, and seeds a row of its own even for an item no MO demands —
    otherwise this screen would call reserved FG free while PR netting refuses to
    plan against it, and the two would disagree about the same pile.

    Plant-level (location-agnostic) but SIZE-AWARE netting: rows are keyed by
    (item, variant, size token) and on-hand is summed across ALL stock locations.
    A size is a physical difference — 67 cm greige is not XL stock — and the MRP
    ledger buckets the same way, so a sized component shows one row per size here
    too. The generic "" bucket (unsized BOM, raw material, pre-feature lot) is
    shared: `netting_service.allocate_onhand` hands it to the sizes that need it
    rather than showing the same pile in full on every row.
    """
    from collections import defaultdict
    from uuid import UUID
    from sqlalchemy.orm import selectinload, joinedload
    from app.models.manufacturing import ManufacturingOrder
    from app.models.reservation import StockReservation
    from app.models.sales import SalesOrder
    from app.models.bom import BOMSize
    from app.services.netting_service import (
        _sales_order_linked_prs, _output_committed, OPEN_SO_STATUSES,
        SizeResolver, allocate_onhand, onhand_size_rows, token_from_snapshot,
    )

    ONGOING = ("PENDING", "IN_PROGRESS", "DELIVERED")   # see netting_service.ONGOING
    mo_rows = (await db.execute(
        select(ManufacturingOrder)
        .where(ManufacturingOrder.status.in_(ONGOING))
        .options(
            selectinload(ManufacturingOrder.planned_components),
            selectinload(ManufacturingOrder.completions),
            selectinload(ManufacturingOrder.attribute_values),
            joinedload(ManufacturingOrder.bom),
        )
    )).unique().scalars().all()

    so_linked_prs = await _sales_order_linked_prs(db, mo_rows)

    # Size identity, resolved the same way the MRP ledger resolves it (one shared
    # helper on purpose — a private copy is exactly how these two surfaces drift).
    sizes = await SizeResolver.create(db)
    await sizes.load_items(db, {c.item_id for mo in mo_rows for c in mo.planned_components})

    # demand + supply keyed by (item_id, attr_key, size_token) — no location.
    demand: dict[tuple, dict] = defaultdict(lambda: {"total_required": 0.0, "contributions": []})
    supply: dict[tuple, dict] = defaultdict(lambda: {"total_incoming": 0.0, "contributions": []})

    for mo in mo_rows:
        completed = sum(float(c.qty_completed) for c in mo.completions if not c.rejected)
        outstanding = float(mo.qty) - completed
        if outstanding <= 0:
            continue  # nothing left to make → no remaining demand, no incoming

        tol = float(mo.bom.tolerance_percentage or 0) if mo.bom else 0.0
        # Size this MO is made at; a component inherits it only when the
        # component's own recipe is size-differentiated (SizeResolver decides).
        mo_token = token_from_snapshot(mo.bom_size_snapshot)

        # ── Demand: components this MO will still consume ──
        for comp in mo.planned_components:
            if not comp.percentage and not comp.qty:
                continue
            req = (outstanding * float(comp.percentage)) / 100 if comp.percentage else outstanding * float(comp.qty)
            if tol > 0:
                req *= (1 + tol / 100)
            attr_ids = sorted(str(a) for a in (comp.attribute_value_ids or []))
            comp_token = sizes.component_token(comp.item_id, mo_token)
            key = (str(comp.item_id), ",".join(attr_ids), comp_token)
            d = demand[key]
            d["item_id"] = comp.item_id
            d["attr_ids"] = attr_ids
            d["total_required"] += req
            d["contributions"].append(BookingDemandMO(
                mo_id=mo.id, mo_code=mo.code, mo_qty=float(mo.qty), required_qty=req,
            ))

        # ── Supply: this MO's own outstanding output is a scheduled receipt,
        # unless committed to a sales order (committed-supply rule) ──
        if _output_committed(mo, so_linked_prs):
            continue
        # Fold the FG shade into the supply key so it matches the color-tagged
        # on-hand variant_key rows (per-color netting).
        from app.services.stock_service import _generate_variant_key
        out_key = _generate_variant_key([str(v.id) for v in mo.attribute_values], getattr(mo, "color_id", None))
        skey = (str(mo.item_id), out_key, mo_token)
        s = supply[skey]
        s["total_incoming"] += outstanding
        s["contributions"].append(BookingSupplyMO(
            mo_id=mo.id, mo_code=mo.code, mo_qty=float(mo.qty), incoming_qty=outstanding,
        ))

    # ── Reserved: on-hand held for open sales orders ──
    # Seeds its own demand key when no MO demands the item, so reserved finished
    # goods are visible here rather than silently reducing a row that never shows.
    reserved: dict[tuple, float] = defaultdict(float)
    reserved_sos: dict[tuple, list] = defaultdict(list)
    res_rows = (await db.execute(
        select(
            StockReservation.item_id, StockReservation.variant_key,
            StockReservation.attribute_value_ids,
            StockReservation.qty, StockReservation.qty_released,
            StockReservation.sales_order_id, SalesOrder.po_number,
            BOMSize.size_id, BOMSize.label,
        )
        .join(SalesOrder, SalesOrder.id == StockReservation.sales_order_id)
        .outerjoin(BOMSize, BOMSize.id == StockReservation.bom_size_id)
        .where(
            StockReservation.status == "ACTIVE",
            SalesOrder.status.in_(OPEN_SO_STATUSES),
        )
    )).all()
    for iid, vkey, attr_ids, qty, released, so_id, po_number, size_id, size_label in res_rows:
        held = float(qty or 0) - float(released or 0)
        if held <= 0:
            continue
        key = (str(iid), vkey or "", sizes.token_for_size_id(size_id, size_label))
        reserved[key] += held
        reserved_sos[key].append(BookingReservedSO(
            sales_order_id=so_id, so_number=po_number or "", reserved_qty=held,
        ))
        if key not in demand:
            d = demand[key]
            d["item_id"] = iid
            # variant_key folds a color in as a trailing `c:<uuid>` token, which is
            # not an attribute value id — take the stored display list instead of
            # splitting the key, or the row renders a bogus chip.
            d["attr_ids"] = [str(a) for a in (attr_ids or [])]

    if not demand:
        return []

    # Display lookups: item code/name/uom.
    item_ids = {v["item_id"] for v in demand.values()}
    item_map = {i.id: i for i in (await db.execute(
        select(Item).filter(Item.id.in_(item_ids))
    )).scalars().all()}

    # Plant-wide on-hand per (item, variant, size), summed across ALL locations;
    # QC-rejected lot stock is physically present but never good/available.
    onhand_map = await onhand_size_rows(db, item_ids)

    # The generic "" pile is shared by every size of an (item, variant), so it is
    # handed out once — biggest need first — instead of being shown in full on each
    # row. Without this, two size rows each claim the same unsized stock and the
    # page promises it twice. Unallocated surplus in "" is deliberately not shown:
    # it belongs to no row's demand.
    onhand_row: dict[tuple, float] = {}
    by_variant: dict[tuple, list] = defaultdict(list)
    for key, data in demand.items():
        by_variant[(key[0], key[1])].append(key)
    for (item_id_str, attr_key), keys in by_variant.items():
        buckets = {
            tok: q for (iid, vk, tok), q in onhand_map.items()
            if iid == item_id_str and vk == attr_key
        }
        allocated = allocate_onhand(
            buckets, [(k[2], demand[k]["total_required"] + reserved.get(k, 0.0)) for k in keys]
        )
        for k, qty in zip(keys, allocated):
            onhand_row[k] = qty

    rows: list[BookingStockRow] = []
    for key, data in demand.items():
        item_id_str, attr_key, size_tok = key
        item = item_map.get(data["item_id"])
        on_hand = onhand_row.get(key, 0.0)
        sup = supply.get(key)
        incoming = sup["total_incoming"] if sup else 0.0
        required = data["total_required"]
        res_qty = reserved.get(key, 0.0)
        rows.append(BookingStockRow(
            item_id=data["item_id"],
            item_code=item.code if item else str(data["item_id"]),
            item_name=item.name if item else str(data["item_id"]),
            uom=item.uom if item else "",
            attribute_value_ids=[UUID(a) for a in data["attr_ids"]],
            size_label=sizes.label_for_token(size_tok),
            location_id=None,
            location_name="Plant-wide",
            qty_on_hand=on_hand,
            qty_required=required,
            qty_incoming=incoming,
            qty_reserved=res_qty,
            qty_net_free=on_hand + incoming - required - res_qty,
            demand_mos=data["contributions"],
            supply_mos=sup["contributions"] if sup else [],
            reserved_sos=reserved_sos.get(key, []),
        ))

    return rows


@router.get("/stock/availability", response_model=PaginatedBookingStockResponse)
async def get_stock_availability(
    location_id: Optional[str] = Query(None, description="Restrict to a single location"),
    search: Optional[str] = Query(None, description="Matches item code or name"),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("booking_stock.view", "stock_on_hand.view", "production_run.view")),
):
    """Booking-stock / material-availability view. See _compute_booking_rows for the
    netting logic. The ``location_id`` query param is retained for API compatibility
    but no longer scopes the result (netting is plant-wide/location-agnostic)."""
    now = time.monotonic()
    if _booking_cache["rows"] is None:
        # Cold cache (first load / after restart): must compute synchronously.
        rows = await _recompute_booking_cache()
    else:
        rows = _booking_cache["rows"]
        # Serve the (possibly stale) cached rows now; if they are stale or past TTL,
        # kick off a single background recompute so the next request is fresh.
        if _booking_cache["stale"] or now - _booking_cache["at"] >= _BOOKING_TTL_SECONDS:
            _spawn_booking_refresh()

    if search:
        term = search.strip().lower()
        rows = [r for r in rows if term in r.item_code.lower() or term in r.item_name.lower()]
    else:
        rows = list(rows)  # copy before sorting — never mutate the cached list in place

    # Shortfalls first (most actionable), then by item code.
    rows.sort(key=lambda r: (r.qty_net_free >= 0, r.item_code, r.size_label or ""))
    total = len(rows)
    # The page window is applied to an in-memory list here, not a select, so this
    # slices by hand instead of window.apply(). Uncapped (size=0) pins offset to 0,
    # so an open-ended slice is the whole set.
    end = None if window.limit is None else window.offset + window.limit
    return window.envelope(rows[window.offset:end], total)


@router.post("/stock/balances/rebuild")
def rebuild_stock_balances(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    """Recompute the materialized StockBalance table from the StockLedger.

    StockBalance is only rebuilt at startup; if the ledger and the summary drift
    (long-running service, out-of-band ledger writes), this lets an operator
    resync on demand without a restart. Sync endpoint — sync_stock_balances
    takes a sync Session.
    """
    from app.db.init_db import sync_stock_balances
    sync_stock_balances(db)
    db.add(AuditLog(user_id=current_user.id, action="REBUILD", entity_type="StockBalance", entity_id="all", details="Rebuilt stock balances from ledger"))
    db.commit()
    return {"status": "success", "message": "Stock balances rebuilt from ledger"}
