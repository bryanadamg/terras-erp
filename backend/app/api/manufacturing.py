from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, inspect
from sqlalchemy.orm import selectinload, joinedload, attributes as sa_attributes
from collections import defaultdict
from app.db.session import get_async_db
from app.models.manufacturing import WorkOrder
from app.models.bom import BOM, BOMLine
from app.models.location import Location
from app.models.sales import SalesOrder
from app.services import stock_service, audit_service
from app.schemas import WorkOrderCreate, WorkOrderResponse, PaginatedWorkOrderResponse
from app.models.auth import User
from app.api.auth import get_current_user
from app.models.item import Item
from datetime import datetime
from typing import Optional
from app.core.ws_manager import manager
import uuid
import re

router = APIRouter()

# Helper for consistent eager loading
def get_wo_options():
    # Base relationships for the main WO
    options = [
        selectinload(WorkOrder.item),
        selectinload(WorkOrder.attribute_values),
        selectinload(WorkOrder.bom).selectinload(BOM.item),
        selectinload(WorkOrder.bom).selectinload(BOM.attribute_values),
        selectinload(WorkOrder.bom).selectinload(BOM.operations),
        selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
        selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values)
    ]
    
    # Sub-relationships for children (Level 1)
    child_rel = selectinload(WorkOrder.child_wos)
    options.append(child_rel.selectinload(WorkOrder.item))
    options.append(child_rel.selectinload(WorkOrder.attribute_values))
    
    # Fully load BOM for children to avoid serialization errors
    child_bom = child_rel.selectinload(WorkOrder.bom)
    options.append(child_bom.selectinload(BOM.item))
    options.append(child_bom.selectinload(BOM.attribute_values))
    options.append(child_bom.selectinload(BOM.operations))
    options.append(child_bom.selectinload(BOM.lines).selectinload(BOMLine.item))
    options.append(child_bom.selectinload(BOM.lines).selectinload(BOMLine.attribute_values))
    
    # Support deeper levels if needed (Level 2)
    gchild_rel = child_rel.selectinload(WorkOrder.child_wos)
    options.append(gchild_rel.selectinload(WorkOrder.item))
    options.append(gchild_rel.selectinload(WorkOrder.attribute_values))
    
    gchild_bom = gchild_rel.selectinload(WorkOrder.bom)
    options.append(gchild_bom.selectinload(BOM.item))
    options.append(gchild_bom.selectinload(BOM.attribute_values))
    options.append(gchild_bom.selectinload(BOM.operations))
    options.append(gchild_bom.selectinload(BOM.lines).selectinload(BOMLine.item))
    options.append(gchild_bom.selectinload(BOM.lines).selectinload(BOMLine.attribute_values))
    
    return options

def populate_wo_ids(wo: WorkOrder):
    """Recursively populate attribute_value_ids for WO and its children safely."""
    # Use inspection to avoid triggering lazy loads in async context
    insp = inspect(wo)
    
    # 1. Populate Attribute Values (if loaded)
    if "attribute_values" not in insp.unloaded:
        wo.attribute_value_ids = [v.id for v in wo.attribute_values]
    
    # 2. Populate BOM IDs (if loaded)
    if "bom" not in insp.unloaded and wo.bom:
        bom_insp = inspect(wo.bom)
        if "lines" not in bom_insp.unloaded:
            for bl in wo.bom.lines:
                bl_insp = inspect(bl)
                if "attribute_values" not in bl_insp.unloaded:
                    bl.attribute_value_ids = [v.id for v in bl.attribute_values]
    
    # 3. Recurse into children (if loaded); stub unloaded child_wos as []
    if "child_wos" not in insp.unloaded:
        for child in wo.child_wos:
            populate_wo_ids(child)
    else:
        # Prevent Pydantic from triggering a lazy-load in async context
        sa_attributes.set_committed_value(wo, "child_wos", [])

async def load_wo_tree(db: AsyncSession, root_ids: list) -> dict:
    """
    Load a WO tree of arbitrary depth using a recursive CTE.
    Returns {wo.id: WorkOrder} with child_wos fully populated at every level.
    """
    if not root_ids:
        return {}

    # Recursive CTE: walk from roots down to all descendants
    anchor = (
        select(WorkOrder.id, WorkOrder.parent_wo_id)
        .filter(WorkOrder.id.in_(root_ids))
        .cte(name="wo_tree", recursive=True)
    )
    recursive_part = select(WorkOrder.id, WorkOrder.parent_wo_id).join(
        anchor, WorkOrder.parent_wo_id == anchor.c.id
    )
    wo_cte = anchor.union_all(recursive_part)

    id_result = await db.execute(select(wo_cte.c.id))
    all_ids = [row[0] for row in id_result.fetchall()]

    if not all_ids:
        return {}

    # Load every WO in the tree with its own relationships (no child_wos eager-load)
    result = await db.execute(
        select(WorkOrder)
        .options(
            selectinload(WorkOrder.item),
            selectinload(WorkOrder.attribute_values),
            selectinload(WorkOrder.bom).selectinload(BOM.item),
            selectinload(WorkOrder.bom).selectinload(BOM.attribute_values),
            selectinload(WorkOrder.bom).selectinload(BOM.operations),
            selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
            selectinload(WorkOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        )
        .filter(WorkOrder.id.in_(all_ids))
    )
    wo_map = {wo.id: wo for wo in result.unique().scalars().all()}

    # Index children by parent
    children_by_parent: dict = defaultdict(list)
    for wo in wo_map.values():
        if wo.parent_wo_id is not None:
            children_by_parent[wo.parent_wo_id].append(wo)

    # Mark child_wos as committed on every node so Pydantic won't trigger a lazy-load
    for wo in wo_map.values():
        sa_attributes.set_committed_value(wo, "child_wos", children_by_parent.get(wo.id, []))

    return wo_map


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

    # 2. Generate a meaningful code based on the BOM's item name (WO-{ITEM_NAME}-001)
    item_result = await db.execute(select(Item).filter(Item.id == bom.item_id))
    item = item_result.scalars().first()
    raw_name = item.name if item else str(bom.item_id)[:8]
    safe_name = re.sub(r'[^A-Za-z0-9\-]', '-', raw_name).strip('-')
    base = f"WO-{safe_name}"
    counter = 1
    while True:
        candidate = f"{base}-{str(counter).zfill(5)}"
        existing = await db.execute(select(WorkOrder.id).filter(WorkOrder.code == candidate).limit(1))
        if existing.scalars().first() is None:
            wo_code = candidate
            break
        counter += 1

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
    
    # 3. Re-fetch the full tree (unlimited depth) for response
    wo_map = await load_wo_tree(db, [wo.id])
    wo = wo_map.get(wo.id)

    await audit_service.log_activity(db, current_user.id, "CREATE", "WorkOrder", str(wo.id), f"Created {'Nested' if payload.create_nested else 'Single'} WO {wo.code}")

    populate_wo_ids(wo)
    return wo

@router.get("/work-orders/available-code")
async def get_available_wo_code(
    base: str = Query(..., description="Base code pattern, e.g. WO-ITEM"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    counter = 1
    while True:
        candidate = f"{base}-{str(counter).zfill(5)}"
        result = await db.execute(select(WorkOrder.id).filter(WorkOrder.code == candidate).limit(1))
        if result.scalars().first() is None:
            return {"code": candidate}
        counter += 1

@router.get("/work-orders", response_model=PaginatedWorkOrderResponse)
async def get_work_orders(
    skip: int = 0, 
    limit: int = 100, 
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    all_levels: bool = False, # New flag to include children in the flat list if desired
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    # Build a lightweight query for root WO IDs only (used for count + pagination)
    id_query = select(WorkOrder.id)

    # Filter only root WOs by default to avoid clutter
    if not all_levels:
        id_query = id_query.filter(WorkOrder.parent_wo_id == None)

    if start_date:
        id_query = id_query.filter(WorkOrder.created_at >= start_date)
    if end_date:
        id_query = id_query.filter(WorkOrder.created_at <= end_date)

    if current_user.allowed_categories:
        id_query = id_query.join(Item, WorkOrder.item_id == Item.id).filter(Item.category.in_(current_user.allowed_categories))

    count_result = await db.execute(select(func.count()).select_from(id_query.subquery()))
    total = count_result.scalar()

    root_id_result = await db.execute(
        id_query.order_by(WorkOrder.created_at.desc()).offset(skip).limit(limit)
    )
    root_ids = [row[0] for row in root_id_result.fetchall()]

    # Load the full tree (unlimited depth) for the paginated root WOs
    wo_map = await load_wo_tree(db, root_ids)
    items_list = [wo_map[rid] for rid in root_ids if rid in wo_map]

    requirements = []
    for item in items_list:
        populate_wo_ids(item)

        if item.status == "PENDING" and item.bom:
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
        if item.status == "PENDING" and item.bom:
            for line in item.bom.lines:
                qty = float(line.qty)
                req = (float(item.qty) * qty) / 100 if line.is_percentage else float(item.qty) * qty
                tol = float(item.bom.tolerance_percentage or 0)
                if tol > 0: req *= (1 + (tol / 100))

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
        if wo.bom:
            for line in wo.bom.lines:
                qty = float(line.qty)
                req = (float(wo.qty) * qty) / 100 if line.is_percentage else float(wo.qty) * qty
                tol = float(wo.bom.tolerance_percentage or 0)
                if tol > 0: req *= (1 + (tol / 100))
                
                check_loc_id = line.source_location_id or wo.source_location_id or wo.location_id
                stock = await stock_service.get_stock_balance(db, line.item_id, check_loc_id, [v.id for v in line.attribute_values])
                if stock < req:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for component {line.item_id}")
        
        wo.actual_start_date = datetime.utcnow()

    if status == "COMPLETED" and previous_status != "COMPLETED":
        wo.actual_end_date = datetime.utcnow()
        
        if wo.bom:
            # 1. DEDUCT Raw Materials
            for line in wo.bom.lines:
                qty = float(line.qty)
                req = (float(wo.qty) * qty) / 100 if line.is_percentage else float(wo.qty) * qty
                tol = float(wo.bom.tolerance_percentage or 0)
                if tol > 0: req *= (1 + (tol / 100))
                
                deduct_loc_id = line.source_location_id or wo.source_location_id or wo.location_id
                await stock_service.add_stock_entry(
                    db, 
                    item_id=line.item_id, 
                    location_id=deduct_loc_id, 
                    qty_change=-req, 
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

        # 3. UPDATE Sales Order status if root WO
        if wo.sales_order_id and wo.parent_wo_id is None:
            res = await db.execute(select(SalesOrder).filter(SalesOrder.id == wo.sales_order_id))
            so = res.scalars().first()
            if so:
                so.status = "READY"
                await audit_service.log_activity(db, current_user.id, "STATUS_CHANGE", "SalesOrder", str(so.id), f"Ready by root WO {wo.code}")

    wo.status = status
    await db.commit()
    
    await audit_service.log_activity(db, current_user.id, "UPDATE_STATUS", "WorkOrder", wo_id, f"{previous_status} -> {status}")
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": status, "code": wo.code})
    
    return {"status": "success", "message": f"Updated to {status}"}

@router.delete("/work-orders/{wo_id}")
async def delete_work_order(wo_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(WorkOrder).filter(WorkOrder.id == wo_id))
    wo = result.scalars().first()
    if not wo: raise HTTPException(status_code=404, detail="Not found")
    wo_code = wo.code
    await db.delete(wo)
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "DELETE", "work_order", wo_id, details={"code": wo_code})
    return {"status": "success"}
