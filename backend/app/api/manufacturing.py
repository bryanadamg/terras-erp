from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload, joinedload
from app.db.session import get_async_db
from app.models.manufacturing import WorkOrder
from app.models.bom import BOM, BOMLine
from app.models.location import Location
from app.services import stock_service, audit_service
from app.schemas import WorkOrderCreate, WorkOrderResponse, PaginatedWorkOrderResponse
from app.models.auth import User
from app.api.auth import get_current_user
from app.models.item import Item
from datetime import datetime
from typing import Optional
from app.core.ws_manager import manager
import uuid

router = APIRouter()

# Helper for consistent eager loading
def get_wo_options():
    return [
        selectinload(WorkOrder.item),
        selectinload(WorkOrder.attribute_values),
        selectinload(WorkOrder.bom).selectinload(BOM.item),
        selectinload(WorkOrder.bom).selectinload(BOM.attribute_values),
        selectinload(WorkOrder.bom).selectinload(BOM.operations),
        selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
        selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values)
    ]

async def create_wo_recursive(
    db: AsyncSession,
    bom_id: uuid.UUID,
    qty: float,
    location_id: uuid.UUID,
    user_id: uuid.UUID,
    parent_wo_id: Optional[uuid.UUID] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    target_start_date: Optional[datetime] = None,
    target_end_date: Optional[datetime] = None
) -> WorkOrder:
    """Recursively creates work orders for sub-assemblies."""
    # 1. Fetch BOM with lines
    result = await db.execute(
        select(BOM)
        .options(selectinload(BOM.lines), selectinload(BOM.attribute_values))
        .filter(BOM.id == bom_id)
    )
    bom = result.scalars().first()
    if not bom:
        raise ValueError(f"BOM {bom_id} not found")

    # 2. Generate unique code
    timestamp = datetime.now().strftime("%y%m%d%H%M%S")
    unique_suffix = str(uuid.uuid4())[:4].upper()
    wo_code = f"WO-{timestamp}-{unique_suffix}"

    # 3. Create this WO
    wo = WorkOrder(
        code=wo_code,
        bom_id=bom.id,
        item_id=bom.item_id,
        location_id=location_id,
        source_location_id=location_id,
        sales_order_id=sales_order_id,
        parent_wo_id=parent_wo_id,
        qty=qty,
        target_start_date=target_start_date,
        target_end_date=target_end_date,
        status="PENDING"
    )
    wo.attribute_values = bom.attribute_values
    db.add(wo)
    await db.flush() # Get ID without committing

    # 4. Look for sub-BOMs in lines
    for line in bom.lines:
        # Check if this material has its own BOM
        sub_bom_result = await db.execute(
            select(BOM).filter(BOM.item_id == line.item_id).limit(1)
        )
        sub_bom = sub_bom_result.scalars().first()
        
        if sub_bom:
            # Scale quantity
            sub_qty = qty * float(line.qty)
            if line.is_percentage:
                sub_qty = (qty * float(line.qty)) / 100
            
            # Recursive call
            await create_wo_recursive(
                db, 
                sub_bom.id, 
                sub_qty, 
                location_id, 
                user_id, 
                parent_wo_id=wo.id,
                sales_order_id=sales_order_id,
                target_start_date=target_start_date,
                target_end_date=target_end_date
            )

    return wo

@router.post("/work-orders", response_model=WorkOrderResponse)
async def create_work_order(payload: WorkOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    # 1. Validation
    result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    # 2. Logic: Regular or Nested
    if payload.create_nested:
        try:
            wo = await create_wo_recursive(
                db,
                payload.bom_id,
                payload.qty,
                location.id,
                current_user.id,
                sales_order_id=payload.sales_order_id,
                target_start_date=payload.target_start_date,
                target_end_date=payload.target_end_date
            )
            # Overwrite code if specified for root
            if payload.code:
                wo.code = payload.code
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Standard Single WO logic
        result = await db.execute(select(WorkOrder).filter(WorkOrder.code == payload.code))
        if result.scalars().first():
            raise HTTPException(status_code=400, detail="Work Order Code already exists")

        wo = WorkOrder(
            code=payload.code,
            bom_id=bom.id,
            item_id=bom.item_id,
            location_id=location.id,
            source_location_id=location.id,
            sales_order_id=payload.sales_order_id,
            qty=payload.qty,
            target_start_date=payload.target_start_date,
            target_end_date=payload.target_end_date,
            status="PENDING"
        )
        # Load attributes from BOM
        result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id).options(selectinload(BOM.attribute_values)))
        bom_with_attrs = result.scalars().first()
        if bom_with_attrs:
            wo.attribute_values = bom_with_attrs.attribute_values

        db.add(wo)
        await db.commit()
    
    # 3. Re-fetch fully loaded for response
    result = await db.execute(
        select(WorkOrder)
        .options(*get_wo_options())
        .filter(WorkOrder.id == wo.id)
    )
    wo = result.unique().scalars().first()
    
    await audit_service.log_activity(db, current_user.id, "CREATE", "WorkOrder", str(wo.id), f"Created {'Nested' if payload.create_nested else 'Single'} WO {wo.code}")
    
    # Populate IDs
    wo.attribute_value_ids = [v.id for v in wo.attribute_values]
    for bl in wo.bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    return wo

@router.get("/work-orders", response_model=PaginatedWorkOrderResponse)
async def get_work_orders(
    skip: int = 0, 
    limit: int = 100, 
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    query = select(WorkOrder)
    
    if start_date:
        query = query.filter(WorkOrder.created_at >= start_date)
    if end_date:
        query = query.filter(WorkOrder.created_at <= end_date)
        
    if current_user.allowed_categories:
        query = query.join(Item, WorkOrder.item_id == Item.id).filter(Item.category.in_(current_user.allowed_categories))
        
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar()
    
    result = await db.execute(
        query.options(*get_wo_options())
        .order_by(WorkOrder.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items_list = result.unique().scalars().all()

    requirements = []
    for item in items_list:
        item.attribute_value_ids = [v.id for v in item.attribute_values]
        for bl in item.bom.lines:
            bl.attribute_value_ids = [v.id for v in bl.attribute_values]

        if item.status == "PENDING":
            for line in item.bom.lines:
                check_loc_id = line.source_location_id or item.source_location_id or item.location_id
                requirements.append({
                    "item_id": line.item_id,
                    "location_id": check_loc_id,
                    "attribute_value_ids": [str(v.id) for v in line.attribute_values]
                })
    
    balances_map = await stock_service.get_batch_stock_balances(db, requirements) if requirements else {}

    for item in items_list:
        item.is_material_available = True
        if item.status == "PENDING":
            for line in item.bom.lines:
                # Math logic
                qty = float(line.qty)
                req = (float(item.qty) * qty) / 100 if line.is_percentage else float(item.qty) * qty
                check_loc_id = line.source_location_id or item.source_location_id or item.location_id
                v_key = ",".join(sorted([str(v.id) for v in line.attribute_values]))
                key = (str(line.item_id), str(check_loc_id), v_key)
                if balances_map.get(key, 0) < req:
                    item.is_material_available = False
                    break
                    
    return {
        "items": items_list,
        "total": total,
        "page": (skip // limit) + 1,
        "size": len(items_list)
    }

@router.put("/work-orders/{wo_id}/status")
async def update_work_order_status(wo_id: str, status: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(WorkOrder)
        .filter(WorkOrder.id == wo_id)
        .options(*get_wo_options())
    )
    wo = result.unique().scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    
    previous_status = wo.status
    valid_statuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    if status == "IN_PROGRESS" and previous_status != "IN_PROGRESS":
        # Ensure stock availability before starting
        for line in wo.bom.lines:
            required_qty = float(line.qty)
            if line.is_percentage:
                required_qty = (float(wo.qty) * required_qty) / 100
            else:
                required_qty = float(wo.qty) * required_qty
            
            tolerance = float(wo.bom.tolerance_percentage or 0)
            if tolerance > 0:
                required_qty = required_qty * (1 + (tolerance / 100))
            
            check_location_id = line.source_location_id or wo.source_location_id or wo.location_id
            current_stock = await stock_service.get_stock_balance(db, line.item_id, check_location_id, [v.id for v in line.attribute_values])
            
            if current_stock < required_qty:
                raise HTTPException(status_code=400, detail=f"Insufficient stock for {line.item_id}")
        
        wo.actual_start_date = datetime.utcnow()

    if status == "COMPLETED" and previous_status != "COMPLETED":
        wo.actual_end_date = datetime.utcnow()
        
        # 1. DEDUCT Raw Materials
        for line in wo.bom.lines:
            qty_to_deduct = float(line.qty)
            if line.is_percentage:
                qty_to_deduct = (float(wo.qty) * qty_to_deduct) / 100
            else:
                qty_to_deduct = float(wo.qty) * qty_to_deduct
            
            tolerance = float(wo.bom.tolerance_percentage or 0)
            if tolerance > 0:
                qty_to_deduct = qty_to_deduct * (1 + (tolerance / 100))
            
            deduct_location_id = line.source_location_id or wo.source_location_id or wo.location_id
            await stock_service.add_stock_entry(
                db, 
                item_id=line.item_id, 
                location_id=deduct_location_id, 
                qty_change=-qty_to_deduct, 
                reference_type="Work Order", 
                reference_id=wo.code, 
                attribute_value_ids=[v.id for v in line.attribute_values]
            )
        
        # 2. ADD Finished Goods
        await stock_service.add_stock_entry(
            db, 
            item_id=wo.item_id, 
            location_id=wo.location_id, 
            qty_change=wo.qty, 
            reference_type="Work Order", 
            reference_id=wo.code, 
            attribute_value_ids=[v.id for v in wo.attribute_values]
        )

    wo.status = status
    await db.commit()
    
    await audit_service.log_activity(db, current_user.id, "UPDATE_STATUS", "WorkOrder", wo_id, f"Status: {previous_status} -> {status}")
    
    await manager.broadcast({
        "type": "WORK_ORDER_UPDATE",
        "wo_id": wo_id,
        "status": status,
        "code": wo.code,
        "actual_start_date": wo.actual_start_date.isoformat() if wo.actual_start_date else None,
        "actual_end_date": wo.actual_end_date.isoformat() if wo.actual_end_date else None
    })
    return {"status": "success", "message": f"Updated to {status}"}

@router.delete("/work-orders/{wo_id}")
async def delete_work_order(wo_id: str, db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(select(WorkOrder).filter(WorkOrder.id == wo_id))
    wo = result.scalars().first()
    if not wo: raise HTTPException(status_code=404, detail="Not found")
    await db.delete(wo)
    await db.commit()
    return {"status": "success"}
