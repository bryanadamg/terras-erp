from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, delete as sa_delete
from sqlalchemy.orm import selectinload
from pathlib import Path
import shutil
from app.db.session import get_async_db
from app.schemas import PurchaseOrderCreate, PurchaseOrderResponse, PaginatedPurchaseOrderResponse, GoodsReceiptCreate, GoodsReceiptResponse
from app.models.purchase import PurchaseOrder, PurchaseOrderLine, purchase_order_line_values
from app.models.goods_receipt import GoodsReceipt, GoodsReceiptLine
from app.models.attribute import AttributeValue
from app.models.item import Item
from app.models.batch import Batch
from app.models.partner import Partner
from app.api.auth import get_current_user, require_permission
from app.models.auth import User
from app.services import stock_service, audit_service, kpi_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from typing import Optional
from datetime import datetime
import uuid

router = APIRouter(prefix="/purchase-orders", tags=["purchase"])


def _po_query():
    return (
        select(PurchaseOrder)
        .options(
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values),
            selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.item),
            selectinload(PurchaseOrder.receipts).selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.item),
            selectinload(PurchaseOrder.receipts).selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.batch),
        )
    )


def _populate_line_attrs(po):
    """Surface each line's variant value ids (the model only has the relationship).
    Without this the response defaults attribute_value_ids to [] and an edit
    round-trip would silently drop the line's variants."""
    if po:
        for line in po.lines:
            line.attribute_value_ids = [v.id for v in line.attribute_values]
    return po


@router.post("", response_model=PurchaseOrderResponse)
async def create_purchase_order(
    payload: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.create')),
):
    result = await db.execute(select(PurchaseOrder).filter(PurchaseOrder.po_number == payload.po_number))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="PO Number already exists")

    po = PurchaseOrder(
        po_number=payload.po_number,
        supplier_id=payload.supplier_id,
        target_location_id=payload.target_location_id,
        order_date=payload.order_date,
        ssn=payload.ssn,
        rate_mode=payload.rate_mode,
        kurs_pajak=payload.kurs_pajak,
        ktbi=payload.ktbi,
        code=payload.code,
        payment_term=payload.payment_term,
        category=payload.category,
        vat_percent=payload.vat_percent,
        discount=payload.discount,
        notes=payload.notes,
    )
    db.add(po)
    await db.flush()

    for line in payload.lines:
        db_line = PurchaseOrderLine(
            purchase_order_id=po.id,
            item_id=line.item_id,
            qty=line.qty,
            unit_price=line.unit_price,
            due_date=line.due_date,
        )
        if line.attribute_value_ids:
            attr_result = await db.execute(
                select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids))
            )
            db_line.attribute_values = attr_result.scalars().all()
        db.add(db_line)

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "CREATE", "purchase_order", str(po.id),
        details=f"Created PO {po.po_number}"
    )

    final = await db.execute(_po_query().filter(PurchaseOrder.id == po.id))
    return _populate_line_attrs(final.scalars().first())


@router.put("/{po_id}", response_model=PurchaseOrderResponse)
async def update_purchase_order(
    po_id: uuid.UUID,
    payload: PurchaseOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.edit')),
):
    result = await db.execute(
        select(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).filter(PurchaseOrder.id == po_id)
    )
    po = result.scalars().first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    # Once goods are received, lines are referenced by goods-receipt lines — editing
    # would orphan those records. Only a DRAFT PO (no receipts) can be edited.
    if po.status != "DRAFT":
        raise HTTPException(status_code=400, detail=f"Cannot edit PO with status '{po.status}' — only DRAFT orders can be edited")

    if payload.po_number != po.po_number:
        dup = await db.execute(select(PurchaseOrder).filter(PurchaseOrder.po_number == payload.po_number))
        if dup.scalars().first():
            raise HTTPException(status_code=400, detail=f"PO Number '{payload.po_number}' already exists")

    po.po_number = payload.po_number
    po.supplier_id = payload.supplier_id
    po.target_location_id = payload.target_location_id
    po.order_date = payload.order_date or po.order_date
    po.ssn = payload.ssn
    po.rate_mode = payload.rate_mode
    po.kurs_pajak = payload.kurs_pajak
    po.ktbi = payload.ktbi
    po.code = payload.code
    po.payment_term = payload.payment_term
    po.category = payload.category
    po.vat_percent = payload.vat_percent
    po.discount = payload.discount
    po.notes = payload.notes

    # Replace all lines (drop association rows first, then the lines themselves)
    line_ids_result = await db.execute(
        select(PurchaseOrderLine.id).where(PurchaseOrderLine.purchase_order_id == po_id)
    )
    line_ids = line_ids_result.scalars().all()
    if line_ids:
        await db.execute(sa_delete(purchase_order_line_values).where(
            purchase_order_line_values.c.purchase_order_line_id.in_(line_ids)
        ))
    await db.execute(sa_delete(PurchaseOrderLine).where(PurchaseOrderLine.purchase_order_id == po_id))
    await db.flush()

    for line in payload.lines:
        db_line = PurchaseOrderLine(
            purchase_order_id=po.id,
            item_id=line.item_id,
            qty=line.qty,
            unit_price=line.unit_price,
            due_date=line.due_date,
        )
        if line.attribute_value_ids:
            attr_result = await db.execute(
                select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids))
            )
            db_line.attribute_values = attr_result.scalars().all()
        db.add(db_line)

    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="purchase_order",
        entity_id=str(po.id),
        details=f"Updated PO {po.po_number}",
    )

    # `po` was loaded with its `lines` collection eager-loaded (line 102), then we
    # bulk-deleted + recreated those lines. With expire_on_commit=False the cached
    # `po.lines` collection survives the commit, and selectinload will NOT overwrite
    # an already-loaded collection — so the re-fetch below would return the stale
    # (deleted) line objects and lazy-load their `.attribute_values`, raising
    # MissingGreenlet in async context (HTTP 500). Expire first so the eager-loaded
    # re-fetch repopulates from the DB.
    db.expire_all()
    # Use the `po_id` path param, not `po.id` — expire_all() expired `po`, so reading
    # any attribute off it now would lazy-load (MissingGreenlet in async).
    final = await db.execute(_po_query().filter(PurchaseOrder.id == po_id))
    return _populate_line_attrs(final.scalars().first())


@router.post("/{po_id}/receipts", response_model=GoodsReceiptResponse)
async def create_goods_receipt(
    po_id: uuid.UUID,
    payload: GoodsReceiptCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.receive_goods')),
):
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values))
        .filter(PurchaseOrder.id == po_id)
    )
    po = result.scalars().first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot receive a cancelled PO")
    # Receiving warehouse: per-receipt choice wins, else fall back to the PO's target location
    recv_location_id = payload.location_id or po.target_location_id
    if not recv_location_id:
        raise HTTPException(status_code=400, detail="Select a receiving warehouse for this receipt")

    line_map = {line.id: line for line in po.lines}

    gr = GoodsReceipt(
        po_id=po.id,
        location_id=recv_location_id,
        receipt_date=payload.receipt_date or datetime.utcnow(),
        notes=payload.notes,
        delivery_note_number=(payload.delivery_note_number or "").strip() or None,
        delivery_note_date=payload.delivery_note_date,
        created_by_id=current_user.id,
    )
    db.add(gr)
    await db.flush()

    # Lot enforcement: lot-tracked items must be received with a lot number
    line_item_ids = {line_map[rl.po_line_id].item_id for rl in payload.lines if rl.po_line_id in line_map}
    lt_res = await db.execute(select(Item.id).filter(Item.id.in_(line_item_ids), Item.lot_tracked == True))  # noqa: E712
    lot_tracked_ids = {str(i) for i in lt_res.scalars().all()}

    for rl in payload.lines:
        po_line = line_map.get(rl.po_line_id)
        if not po_line:
            raise HTTPException(status_code=400, detail=f"PO line {rl.po_line_id} not found on this PO")
        if rl.qty_received <= 0:
            raise HTTPException(status_code=400, detail="qty_received must be greater than 0")

        # Resolve lot: same supplier delivering the same vendor lot number for the same
        # item merges into the existing internal lot instead of minting a new one.
        batch_id = rl.batch_id
        vendor_lot = (rl.vendor_lot or "").strip() or None
        is_lot_tracked = str(po_line.item_id) in lot_tracked_ids
        if not batch_id and (vendor_lot or is_lot_tracked):
            if is_lot_tracked and not vendor_lot:
                raise HTTPException(status_code=400, detail="Item is lot-tracked — enter a supplier lot number for this receipt line")
            if vendor_lot and po.supplier_id:
                existing = await db.execute(
                    select(Batch)
                    .join(GoodsReceiptLine, GoodsReceiptLine.batch_id == Batch.id)
                    .join(GoodsReceipt, GoodsReceipt.id == GoodsReceiptLine.receipt_id)
                    .join(PurchaseOrder, PurchaseOrder.id == GoodsReceipt.po_id)
                    .filter(
                        Batch.item_id == po_line.item_id,
                        Batch.vendor_lot == vendor_lot,
                        Batch.quality_status == "GOOD",
                        PurchaseOrder.supplier_id == po.supplier_id,
                    )
                    .order_by(Batch.created_at.desc())
                    .limit(1)
                )
                matched_batch = existing.scalars().first()
                if matched_batch is not None:
                    batch_id = matched_batch.id
            if batch_id is None:
                internal_no = f"GR-{datetime.utcnow().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
                b = Batch(batch_number=internal_no, vendor_lot=vendor_lot, item_id=po_line.item_id, created_by=current_user.username)
                db.add(b)
                await db.flush()
                batch_id = b.id

        gr_line = GoodsReceiptLine(
            receipt_id=gr.id,
            po_line_id=po_line.id,
            item_id=po_line.item_id,
            qty_received=rl.qty_received,
            qty_boxes=rl.qty_boxes,
            qty_cones=rl.qty_cones,
            qty_drums=rl.qty_drums,
            batch_id=batch_id,
        )
        db.add(gr_line)

        await stock_service.add_stock_entry(
            db,
            item_id=po_line.item_id,
            location_id=recv_location_id,
            attribute_value_ids=[str(v.id) for v in po_line.attribute_values],
            qty_change=rl.qty_received,
            reference_type="Goods Receipt",
            reference_id=str(gr.id),
            batch_id=batch_id,
            cones_change=rl.qty_cones or 0,
            boxes_change=rl.qty_boxes or 0,
            drums_change=rl.qty_drums or 0,
        )

        po_line.qty_received = float(po_line.qty_received or 0) + rl.qty_received

    # Update PO status
    all_fulfilled = all(line.qty_received >= line.qty for line in po.lines)
    po.status = "RECEIVED" if all_fulfilled else "RECEIVING"

    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="GoodsReceipt",
        entity_id=str(gr.id),
        details=f"Goods receipt for PO {po.po_number}",
    )

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    final = await db.execute(
        select(GoodsReceipt)
        .options(
            selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.item),
            selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.batch),
        )
        .filter(GoodsReceipt.id == gr.id)
    )
    return final.scalars().first()


@router.post("/receipts/{receipt_id}/delivery-note", response_model=GoodsReceiptResponse)
async def upload_delivery_note(
    receipt_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.receive_goods')),
):
    """Attach a scanned supplier delivery note (Surat Jalan) PDF/image to a goods receipt."""
    result = await db.execute(select(GoodsReceipt).filter(GoodsReceipt.id == receipt_id))
    gr = result.scalars().first()
    if not gr:
        raise HTTPException(status_code=404, detail="Goods receipt not found")

    allowed = {".pdf", ".png", ".jpg", ".jpeg"}
    ext = Path(file.filename).suffix.lower() if file.filename else ".pdf"
    if ext not in allowed:
        raise HTTPException(status_code=400, detail="Delivery note must be a PDF or image (pdf/png/jpg)")

    upload_dir = Path("static/receipts")
    upload_dir.mkdir(parents=True, exist_ok=True)
    file_path = upload_dir / f"{receipt_id}_dn{ext}"
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    gr.delivery_note_url = f"/static/receipts/{receipt_id}_dn{ext}"
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="GoodsReceipt",
        entity_id=str(receipt_id),
        details=f"Attached delivery note {file.filename}",
    )

    final = await db.execute(
        select(GoodsReceipt)
        .options(
            selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.item),
            selectinload(GoodsReceipt.lines).selectinload(GoodsReceiptLine.batch),
        )
        .filter(GoodsReceipt.id == receipt_id)
    )
    return final.scalars().first()


@router.get("", response_model=PaginatedPurchaseOrderResponse)
async def get_purchase_orders(
    status: Optional[str] = None,
    search: Optional[str] = None,
    supplier: Optional[str] = None,
    window: PageWindow = Depends(PageParams()),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("purchase_order.view")),
):
    query = _po_query()
    count_query = select(func.count(PurchaseOrder.id))

    if status:
        # comma-separated, same contract as /sales-orders — lets a caller scope to
        # a few statuses instead of pulling every PO ever raised.
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        cond = PurchaseOrder.status.in_(statuses) if len(statuses) > 1 else PurchaseOrder.status == statuses[0]
        query = query.filter(cond)
        count_query = count_query.filter(cond)
    if search:
        # Mirrors the view's old client-side match: PO number OR supplier name.
        # Done as an IN-subquery rather than a join so the eager-load options on
        # `query` and the plain count on `count_query` take the identical filter.
        like = f"%{search}%"
        cond = or_(
            PurchaseOrder.po_number.ilike(like),
            PurchaseOrder.supplier_id.in_(select(Partner.id).filter(Partner.name.ilike(like))),
        )
        query = query.filter(cond)
        count_query = count_query.filter(cond)
    if supplier:
        cond = PurchaseOrder.supplier_id.in_(select(Partner.id).filter(Partner.name.ilike(f"%{supplier}%")))
        query = query.filter(cond)
        count_query = count_query.filter(cond)

    total = (await db.execute(count_query)).scalar() or 0

    # `size=0` (or legacy `limit=0`) means "no cap" — for export/print callers that
    # need every row matching the active filter, not just the page on screen.
    result = await db.execute(window.apply(query.order_by(PurchaseOrder.created_at.desc())))
    pos = result.scalars().all()
    for po in pos:
        _populate_line_attrs(po)

    # Unfiltered, all-time counts for the status-filter chips and the classic
    # status bar ("X total / Y draft / Z received") — deliberately NOT scoped to
    # the active filter or page, same meaning as before pagination existed.
    status_rows = (await db.execute(
        select(PurchaseOrder.status, func.count(PurchaseOrder.id)).group_by(PurchaseOrder.status)
    )).all()
    status_counts = {s: c for s, c in status_rows}

    return window.envelope(pos, total, status_counts=status_counts)


@router.patch("/{po_id}/close", response_model=PurchaseOrderResponse)
async def close_purchase_order(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.close')),
):
    """Force-close a PO as RECEIVED even if quantities are short (partial/under-delivery)."""
    result = await db.execute(_po_query().filter(PurchaseOrder.id == po_id))
    po = result.scalars().first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")
    if po.status in ("RECEIVED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"PO already {po.status}")

    prev_status = po.status
    po.status = "RECEIVED"
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="purchase_order",
        entity_id=str(po.id),
        details=f"Closed PO {po.po_number} as RECEIVED (short/partial delivery)",
        changes={"status": [prev_status, "RECEIVED"]},
    )

    result = await db.execute(_po_query().filter(PurchaseOrder.id == po_id))
    return _populate_line_attrs(result.scalars().first())


@router.delete("/{po_id}")
async def delete_purchase_order(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.delete')),
):
    result = await db.execute(select(PurchaseOrder).filter(PurchaseOrder.id == po_id))
    po = result.scalars().first()
    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="purchase_order",
        entity_id=str(po.id),
        details=f"Deleted PO {po.po_number}",
    )
    await db.delete(po)
    await db.commit()
    return {"status": "success"}
