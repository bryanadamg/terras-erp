from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.db.session import get_async_db
from app.schemas import PurchaseOrderCreate, PurchaseOrderResponse, POReceiveWithBatchesPayload
from app.models.purchase import PurchaseOrder, PurchaseOrderLine
from app.models.attribute import AttributeValue
from app.api.auth import get_current_user
from app.models.auth import User
from app.services import stock_service, audit_service
import uuid

router = APIRouter(prefix="/purchase-orders", tags=["purchase"])

@router.post("", response_model=PurchaseOrderResponse)
async def create_purchase_order(payload: PurchaseOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    # Check duplicate PO number
    result = await db.execute(select(PurchaseOrder).filter(PurchaseOrder.po_number == payload.po_number))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="PO Number already exists")

    po = PurchaseOrder(
        po_number=payload.po_number,
        supplier_id=payload.supplier_id,
        target_location_id=payload.target_location_id,
        order_date=payload.order_date
    )
    db.add(po)
    await db.flush()  # Get po.id without committing — lines added below in same transaction

    for line in payload.lines:
        db_line = PurchaseOrderLine(
            purchase_order_id=po.id,
            item_id=line.item_id,
            qty=line.qty,
            unit_price=line.unit_price,
            due_date=line.due_date
        )
        if line.attribute_value_ids:
            # Load attributes
            attr_result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids)))
            db_line.attribute_values = attr_result.scalars().all()
            
        db.add(db_line)
    
    await db.commit()
    
    # Refresh with eager loading
    final_result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values))
        .filter(PurchaseOrder.id == po.id)
    )
    return final_result.scalars().first()

@router.put("/{po_id}/receive", response_model=PurchaseOrderResponse)
async def receive_purchase_order(
    po_id: uuid.UUID,
    payload: POReceiveWithBatchesPayload = POReceiveWithBatchesPayload(),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values))
        .filter(PurchaseOrder.id == po_id)
    )
    po = result.scalars().first()

    if not po:
        raise HTTPException(status_code=404, detail="PO not found")

    if po.status == "RECEIVED":
        raise HTTPException(status_code=400, detail="PO already received")

    if not po.target_location_id:
        raise HTTPException(status_code=400, detail="Target location not set for this PO")

    batch_lookup = {str(a.line_id): a.batch_id for a in payload.batch_assignments}

    for line in po.lines:
        batch_id = batch_lookup.get(str(line.id))
        await stock_service.add_stock_entry(
            db,
            item_id=line.item_id,
            location_id=po.target_location_id,
            attribute_value_ids=[str(v.id) for v in line.attribute_values],
            qty_change=line.qty,
            reference_type="Purchase Order",
            reference_id=po.po_number,
            batch_id=batch_id,
        )

    po.status = "RECEIVED"
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="STATUS_CHANGE",
        entity_type="PurchaseOrder",
        entity_id=str(po.id),
        details=f"Received PO {po.po_number} and added items to stock."
    )

    return po

@router.get("", response_model=list[PurchaseOrderResponse])
async def get_purchase_orders(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(PurchaseOrder)
        .options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.attribute_values))
        .order_by(PurchaseOrder.created_at.desc())
    )
    return result.scalars().all()

@router.delete("/{po_id}")
async def delete_purchase_order(po_id: uuid.UUID, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
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
        details=f"Deleted PO {po.po_number}"
    )
    await db.delete(po)
    await db.commit()
    return {"status": "success"}
