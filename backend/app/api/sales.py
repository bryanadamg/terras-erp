from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.exc import IntegrityError
from app.db.session import get_async_db
from app.schemas import SalesOrderCreate, SalesOrderResponse
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.attribute import AttributeValue
from app.api.auth import get_current_user
from app.models.auth import User
from app.services import audit_service
from datetime import datetime
import uuid

router = APIRouter(prefix="/sales-orders", tags=["sales"])

@router.post("", response_model=SalesOrderResponse)
async def create_sales_order(payload: SalesOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
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
                bom_size_id=line.bom_size_id,
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
        .options(selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values))
        .filter(SalesOrder.id == so.id)
    )
    so_refreshed = final_result.scalars().first()
    
    # Manually populate attribute_value_ids for the response
    for line in so_refreshed.lines:
        line.attribute_value_ids = [v.id for v in line.attribute_values]
        
    return so_refreshed

@router.get("", response_model=list[SalesOrderResponse])
async def get_sales_orders(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values))
        .order_by(SalesOrder.created_at.desc())
    )
    orders = result.scalars().all()
    
    # Manually populate attribute_value_ids for the response
    for so in orders:
        for line in so.lines:
            line.attribute_value_ids = [v.id for v in line.attribute_values]
            
    return orders

@router.put("/{so_id}/status", response_model=SalesOrderResponse)
async def update_sales_order_status(so_id: uuid.UUID, status: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values))
        .filter(SalesOrder.id == so_id)
    )
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")
    
    prev_status = so.status
    valid_statuses = ["PENDING", "READY", "SENT", "DELIVERED", "CANCELLED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    so.status = status
    if status == "DELIVERED":
        so.delivered_at = datetime.utcnow()
    
    await db.commit()
    
    # Populate attribute_value_ids
    for line in so.lines:
        line.attribute_value_ids = [v.id for v in line.attribute_values]
    
    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="STATUS_CHANGE",
        entity_type="SalesOrder",
        entity_id=str(so.id),
        details=f"Status: {prev_status} -> {status}"
    )
    
    return so

@router.delete("/{so_id}")
async def delete_sales_order(so_id: uuid.UUID, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(SalesOrder).filter(SalesOrder.id == so_id))
    so = result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="SO not found")
    
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
    return {"status": "success"}
