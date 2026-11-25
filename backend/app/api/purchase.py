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
from app.models.location import Location
from app.models.category import Category
from app.services.xlsx_service import xlsx_response, zone_or_400, local_cell
from app.api.auth import get_current_user, require_permission
from app.models.auth import User
from app.services import stock_service, audit_service, kpi_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from typing import Optional
from datetime import datetime, date
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
        prices_include_vat=payload.prices_include_vat,
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
    await manager.broadcast({"type": "STOCK_UPDATE"})  # open PO lines count as Booking Stock incoming
    await audit_service.log_activity(
        db, current_user.id, "CREATE", "PurchaseOrder", str(po.id),
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
    po.prices_include_vat = payload.prices_include_vat
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
    await manager.broadcast({"type": "STOCK_UPDATE"})  # open PO lines count as Booking Stock incoming

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="PurchaseOrder",
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
    # Receiving warehouse: per-receipt choice wins, else fall back to the PO's target
    # location. A line may name its own warehouse, which beats both.
    recv_location_id = payload.location_id or po.target_location_id
    if not recv_location_id and any(not rl.location_id for rl in payload.lines):
        raise HTTPException(status_code=400, detail="Select a receiving warehouse for this receipt")
    line_loc_ids = {rl.location_id for rl in payload.lines if rl.location_id}
    if line_loc_ids:
        found = set((await db.execute(select(Location.id).filter(Location.id.in_(line_loc_ids)))).scalars().all())
        if found != line_loc_ids:
            raise HTTPException(status_code=404, detail="Receiving location not found")

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

        line_location_id = rl.location_id or recv_location_id
        gr_line = GoodsReceiptLine(
            receipt_id=gr.id,
            location_id=rl.location_id if rl.location_id and rl.location_id != recv_location_id else None,
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
            location_id=line_location_id,
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


@router.delete("/receipts/{receipt_id}")
async def void_goods_receipt(
    receipt_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('purchase_order.receive_goods')),
):
    """Undo a wrongly entered receipt: take its stock back out of every warehouse it
    went to, give the qty back to the PO lines, and drop the receipt so it can be
    received again correctly. The negative-stock guard refuses it once any of that
    stock has already been used or moved."""
    gr = (await db.execute(
        select(GoodsReceipt).options(selectinload(GoodsReceipt.lines)).filter(GoodsReceipt.id == receipt_id)
    )).scalars().first()
    if not gr:
        raise HTTPException(status_code=404, detail="Goods receipt not found")
    po = (await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values))
        .filter(PurchaseOrder.id == gr.po_id)
    )).scalars().first()
    line_map = {line.id: line for line in po.lines}

    for ln in gr.lines:
        po_line = line_map.get(ln.po_line_id)
        await stock_service.add_stock_entry(
            db,
            item_id=ln.item_id,
            location_id=ln.location_id or gr.location_id,
            attribute_value_ids=[str(v.id) for v in po_line.attribute_values] if po_line else [],
            qty_change=-float(ln.qty_received),
            reference_type="Receipt Void",
            reference_id=po.po_number,
            batch_id=ln.batch_id,
            cones_change=-(ln.qty_cones or 0),
            boxes_change=-(ln.qty_boxes or 0),
            drums_change=-(ln.qty_drums or 0),
        )
        if po_line:
            po_line.qty_received = max(0.0, float(po_line.qty_received or 0) - float(ln.qty_received))

    await db.delete(gr)
    if all(float(line.qty_received or 0) <= 0 for line in po.lines):
        po.status = "DRAFT"
    elif all(float(line.qty_received or 0) >= float(line.qty) for line in po.lines):
        po.status = "RECEIVED"
    else:
        po.status = "RECEIVING"

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="GoodsReceipt",
        entity_id=str(receipt_id),
        details=f"Voided goods receipt on PO {po.po_number}",
        changes={"lines": [{"item_id": str(ln.item_id), "qty": float(ln.qty_received)} for ln in gr.lines]},
        commit=False,
    )
    await db.commit()

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})
    return {"status": "success"}


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


# ── Purchase report: PO lines and goods received, flat and filterable ─────────

def _ids(csv: Optional[str]) -> list[uuid.UUID]:
    out = []
    for x in (csv or "").split(","):
        x = x.strip()
        if x:
            try:
                out.append(uuid.UUID(x))
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Bad id '{x}'")
    return out


def _day_end(d: Optional[date]) -> Optional[datetime]:
    return datetime.combine(d, datetime.max.time()) if d else None


async def _variant_names(db: AsyncSession, po_line_ids: set) -> dict:
    if not po_line_ids:
        return {}
    out: dict = {}
    for lid, val in (await db.execute(
        select(purchase_order_line_values.c.purchase_order_line_id, AttributeValue.value)
        .join(AttributeValue, AttributeValue.id == purchase_order_line_values.c.attribute_value_id)
        .where(purchase_order_line_values.c.purchase_order_line_id.in_(po_line_ids))
    )).all():
        out.setdefault(lid, []).append(val)
    return {k: ", ".join(sorted(v)) for k, v in out.items()}


def _net_price(price, po_vat, incl) -> Optional[float]:
    """Unit price before VAT — the entered price unless the PO took VAT-inclusive prices."""
    if price is None:
        return None
    price = float(price)
    if incl and po_vat is not None:
        return round(price / (1 + float(po_vat) / 100), 2)
    return price


async def purchase_report_rows(
    db: AsyncSession, kind: str, date_from: Optional[date], date_to: Optional[date],
    supplier_id: Optional[uuid.UUID], search: Optional[str], status: Optional[str],
    location_id: Optional[str], category_id: Optional[str],
) -> list[dict]:
    if kind not in ("lines", "receipts"):
        raise HTTPException(status_code=404, detail="Unknown report")
    cats = _ids(category_id)
    term = f"%{search.strip()}%" if search and search.strip() else None

    if kind == "lines":
        q = (
            select(PurchaseOrderLine, PurchaseOrder, Partner.name, Item, Category.name)
            .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderLine.purchase_order_id)
            .join(Item, Item.id == PurchaseOrderLine.item_id)
            .outerjoin(Partner, Partner.id == PurchaseOrder.supplier_id)
            .outerjoin(Category, Category.id == Item.category_id)
        )
        if date_from:
            q = q.where(PurchaseOrder.order_date >= datetime.combine(date_from, datetime.min.time()))
        if date_to:
            q = q.where(PurchaseOrder.order_date <= _day_end(date_to))
        if status:
            q = q.where(PurchaseOrder.status.in_([x.strip() for x in status.split(",") if x.strip()]))
        rows = []
        if supplier_id:
            q = q.where(PurchaseOrder.supplier_id == supplier_id)
        if cats:
            q = q.where(Item.category_id.in_(cats))
        if term:
            q = q.where(or_(Item.code.ilike(term), Item.name.ilike(term), PurchaseOrder.po_number.ilike(term), Partner.name.ilike(term)))
        res = (await db.execute(q.order_by(PurchaseOrder.order_date.desc(), PurchaseOrder.po_number, Item.code))).all()
        variants = await _variant_names(db, {r[0].id for r in res})
        for line, po, sup, item, cat in res:
            price = float(line.unit_price) if line.unit_price is not None else None
            rows.append({
                "date": po.order_date, "po_number": po.po_number, "po_id": po.id, "status": po.status,
                "supplier": sup, "item_code": item.code, "item_name": item.name, "category": cat,
                "variant": variants.get(line.id), "uom": item.uom,
                "qty": float(line.qty), "qty_received": float(line.qty_received or 0),
                "unit_price": price,
                "unit_price_excl_vat": _net_price(price, po.vat_percent, po.prices_include_vat),
                "prices_include_vat": bool(po.prices_include_vat and po.vat_percent is not None),
                "amount": round(float(line.qty) * price, 2) if price is not None else None,
                "due_date": line.due_date,
            })
        return rows

    line_loc = func.coalesce(GoodsReceiptLine.location_id, GoodsReceipt.location_id)
    q = (
        select(GoodsReceiptLine, GoodsReceipt, PurchaseOrder, PurchaseOrderLine.unit_price, PurchaseOrderLine.id,
               Partner.name, Item, Category.name, Location.name, Batch.batch_number, Batch.vendor_lot)
        .join(GoodsReceipt, GoodsReceipt.id == GoodsReceiptLine.receipt_id)
        .join(PurchaseOrder, PurchaseOrder.id == GoodsReceipt.po_id)
        .join(PurchaseOrderLine, PurchaseOrderLine.id == GoodsReceiptLine.po_line_id)
        .join(Item, Item.id == GoodsReceiptLine.item_id)
        .outerjoin(Partner, Partner.id == PurchaseOrder.supplier_id)
        .outerjoin(Category, Category.id == Item.category_id)
        .outerjoin(Location, Location.id == line_loc)
        .outerjoin(Batch, Batch.id == GoodsReceiptLine.batch_id)
    )
    if date_from:
        q = q.where(GoodsReceipt.receipt_date >= datetime.combine(date_from, datetime.min.time()))
    if date_to:
        q = q.where(GoodsReceipt.receipt_date <= _day_end(date_to))
    if supplier_id:
        q = q.where(PurchaseOrder.supplier_id == supplier_id)
    locs = _ids(location_id)
    if locs:
        q = q.where(line_loc.in_(locs))
    if cats:
        q = q.where(Item.category_id.in_(cats))
    if term:
        q = q.where(or_(Item.code.ilike(term), Item.name.ilike(term), PurchaseOrder.po_number.ilike(term),
                        Partner.name.ilike(term), GoodsReceipt.delivery_note_number.ilike(term)))
    res = (await db.execute(q.order_by(GoodsReceipt.receipt_date.desc(), PurchaseOrder.po_number, Item.code))).all()
    variants = await _variant_names(db, {r[4] for r in res})
    rows = []
    for ln, gr, po, price, po_line_id, sup, item, cat, loc, lot, vlot in res:
        price = float(price) if price is not None else None
        rows.append({
            "date": gr.receipt_date, "po_number": po.po_number, "po_id": po.id, "supplier": sup,
            "delivery_note": gr.delivery_note_number, "item_code": item.code, "item_name": item.name,
            "category": cat, "variant": variants.get(po_line_id), "warehouse": loc, "uom": item.uom,
            "qty": float(ln.qty_received), "boxes": ln.qty_boxes, "cones": ln.qty_cones, "drums": ln.qty_drums,
            "lot": lot, "supplier_lot": vlot,
            "unit_price": price,
            "unit_price_excl_vat": _net_price(price, po.vat_percent, po.prices_include_vat),
            "amount": round(float(ln.qty_received) * price, 2) if price is not None else None,
            "notes": gr.notes,
        })
    return rows


@router.get("/report/{kind}")
async def purchase_report(
    kind: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    supplier_id: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    location_id: Optional[str] = None,
    category_id: Optional[str] = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("purchase_order.view")),
):
    """`lines` = every PO line (what was ordered, at what price); `receipts` = every
    goods-receipt line (what came in, when, into which warehouse)."""
    rows = await purchase_report_rows(db, kind, date_from, date_to, supplier_id, search, status, location_id, category_id)
    return {"items": rows, "total": len(rows), "amount": round(sum(r["amount"] or 0 for r in rows), 2)}


@router.get("/report/{kind}/export")
async def export_purchase_report(
    kind: str,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    supplier_id: Optional[uuid.UUID] = None,
    search: Optional[str] = None,
    status: Optional[str] = None,
    location_id: Optional[str] = None,
    category_id: Optional[str] = None,
    tz: str = "Asia/Jakarta",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("purchase_order.export")),
):
    zone = zone_or_400(tz)
    rows = await purchase_report_rows(db, kind, date_from, date_to, supplier_id, search, status, location_id, category_id)
    total = round(sum(r["amount"] or 0 for r in rows), 2)
    if kind == "lines":
        header = ["Order Date", "PO Number", "Status", "Supplier", "Item Code", "Item Name", "Category", "Variant",
                  "Qty Ordered", "Qty Received", "UOM", "Unit Price", "Unit Price excl. VAT", "Amount", "Expected By"]
        body = ([local_cell(r["date"], zone), r["po_number"], r["status"], r["supplier"], r["item_code"], r["item_name"],
                 r["category"], r["variant"], r["qty"], r["qty_received"], r["uom"], r["unit_price"],
                 r["unit_price_excl_vat"], r["amount"], r["due_date"]] for r in rows)
        return xlsx_response("PO Lines", header, body, "purchase-order-lines", footer=["Total"] + [None] * 12 + [total])
    header = ["Receipt Date", "PO Number", "Supplier", "Delivery Note", "Item Code", "Item Name", "Category", "Variant",
              "Warehouse", "Qty", "UOM", "Boxes", "Cones", "Drums", "Lot", "Supplier Lot",
              "Unit Price", "Unit Price excl. VAT", "Amount", "Notes"]
    body = ([local_cell(r["date"], zone), r["po_number"], r["supplier"], r["delivery_note"], r["item_code"], r["item_name"],
             r["category"], r["variant"], r["warehouse"], r["qty"], r["uom"], r["boxes"], r["cones"], r["drums"],
             r["lot"], r["supplier_lot"], r["unit_price"], r["unit_price_excl_vat"], r["amount"], r["notes"]] for r in rows)
    return xlsx_response("Goods Received", header, body, "goods-received", footer=["Total"] + [None] * 17 + [total])


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
        # PO number / printed code / supplier, plus any code on its lines and
        # receipts (item, supplier surat jalan no., vendor lot). IN-subqueries
        # rather than joins so the eager-load options on `query` and the plain
        # count on `count_query` take the identical filter. Receipt lines always
        # carry their PO line's item, so the PO-line item match covers both.
        like = f"%{search}%"
        cond = or_(
            PurchaseOrder.po_number.ilike(like),
            PurchaseOrder.code.ilike(like),
            PurchaseOrder.supplier_id.in_(select(Partner.id).filter(Partner.name.ilike(like))),
            PurchaseOrder.id.in_(
                select(PurchaseOrderLine.purchase_order_id)
                .join(Item, Item.id == PurchaseOrderLine.item_id)
                .filter(Item.code.ilike(like))
            ),
            PurchaseOrder.id.in_(select(GoodsReceipt.po_id).filter(GoodsReceipt.delivery_note_number.ilike(like))),
            PurchaseOrder.id.in_(
                select(GoodsReceipt.po_id)
                .join(GoodsReceiptLine, GoodsReceiptLine.receipt_id == GoodsReceipt.id)
                .join(Batch, Batch.id == GoodsReceiptLine.batch_id)
                .filter(Batch.vendor_lot.ilike(like))
            ),
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
    await manager.broadcast({"type": "STOCK_UPDATE"})  # open PO lines count as Booking Stock incoming

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="PurchaseOrder",
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
        entity_type="PurchaseOrder",
        entity_id=str(po.id),
        details=f"Deleted PO {po.po_number}",
        commit=False,
    )
    await db.delete(po)
    await db.commit()
    await manager.broadcast({"type": "STOCK_UPDATE"})  # open PO lines count as Booking Stock incoming
    return {"status": "success"}
