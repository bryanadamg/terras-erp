from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, inspect
from sqlalchemy.orm import selectinload, joinedload, attributes as sa_attributes
from collections import defaultdict
from app.db.session import get_async_db
from app.models.manufacturing import ManufacturingOrder, MOCompletion, MODependency
from app.models.work_order import WorkOrder as WorkOrderModel  # noqa: F401 — eager load
from app.models.bom import BOM, BOMLine, BOMSize
from app.models.location import Location
from app.models.sales import SalesOrder
from app.services import stock_service, audit_service
from app.schemas import (
    ManufacturingOrderCreate, ManufacturingOrderResponse,
    PaginatedManufacturingOrderResponse,
    MOCompleteWithBatchesPayload,
    BatchConsumptionInMO,
    MOCompletionCreate, MOCompletionResponse,
)
from app.models.auth import User
from app.api.auth import get_current_user
from app.models.item import Item
from app.models.batch import BatchConsumption
from datetime import datetime
from typing import Optional
from app.core.ws_manager import manager
import uuid
import re

router = APIRouter()

# Helper for consistent eager loading
def get_mo_options():
    # Base relationships for the main MO
    options = [
        selectinload(ManufacturingOrder.item),
        selectinload(ManufacturingOrder.attribute_values),
        selectinload(ManufacturingOrder.work_orders),
        selectinload(ManufacturingOrder.sales_order),
        selectinload(ManufacturingOrder.required_dependencies),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.item),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.attribute_values),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.operations),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.customer),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.work_center),
        selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
        selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
        selectinload(ManufacturingOrder.completions),
    ]

    # Sub-relationships for children (Level 1)
    child_rel = selectinload(ManufacturingOrder.child_mos)
    options.append(child_rel.selectinload(ManufacturingOrder.item))
    options.append(child_rel.selectinload(ManufacturingOrder.attribute_values))

    # Fully load BOM for children to avoid serialization errors
    child_bom = child_rel.selectinload(ManufacturingOrder.bom)
    options.append(child_bom.selectinload(BOM.item))
    options.append(child_bom.selectinload(BOM.attribute_values))
    options.append(child_bom.selectinload(BOM.operations))
    options.append(child_bom.selectinload(BOM.lines).selectinload(BOMLine.item))
    options.append(child_bom.selectinload(BOM.lines).selectinload(BOMLine.attribute_values))
    options.append(child_bom.selectinload(BOM.customer))
    options.append(child_bom.selectinload(BOM.work_center))

    # Support deeper levels if needed (Level 2)
    gchild_rel = child_rel.selectinload(ManufacturingOrder.child_mos)
    options.append(gchild_rel.selectinload(ManufacturingOrder.item))
    options.append(gchild_rel.selectinload(ManufacturingOrder.attribute_values))

    gchild_bom = gchild_rel.selectinload(ManufacturingOrder.bom)
    options.append(gchild_bom.selectinload(BOM.item))
    options.append(gchild_bom.selectinload(BOM.attribute_values))
    options.append(gchild_bom.selectinload(BOM.operations))
    options.append(gchild_bom.selectinload(BOM.lines).selectinload(BOMLine.item))
    options.append(gchild_bom.selectinload(BOM.lines).selectinload(BOMLine.attribute_values))
    options.append(gchild_bom.selectinload(BOM.customer))
    options.append(gchild_bom.selectinload(BOM.work_center))

    return options

def populate_mo_ids(mo: ManufacturingOrder):
    """Recursively populate attribute_value_ids for MO and its children safely."""
    # Use inspection to avoid triggering lazy loads in async context
    insp = inspect(mo)

    # 1. Populate Attribute Values (if loaded)
    if "attribute_values" not in insp.unloaded:
        mo.attribute_value_ids = [v.id for v in mo.attribute_values]

    # 1b. Populate sales_order_code (if loaded)
    if "sales_order" not in insp.unloaded and mo.sales_order:
        mo.sales_order_code = mo.sales_order.po_number

    # 2. Populate BOM IDs (if loaded)
    if "bom" not in insp.unloaded and mo.bom:
        bom_insp = inspect(mo.bom)
        if "lines" not in bom_insp.unloaded:
            for bl in mo.bom.lines:
                bl_insp = inspect(bl)
                if "attribute_values" not in bl_insp.unloaded:
                    bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    # 3. Populate batch trace (if loaded)
    if "batch_consumptions" not in insp.unloaded:
        mo.batch_trace = [
            BatchConsumptionInMO(
                input_batch_id=c.input_batch_id,
                input_batch_number=c.input_batch.batch_number if c.input_batch else str(c.input_batch_id),
                output_batch_id=c.output_batch_id,
                output_batch_number=c.output_batch.batch_number if c.output_batch else None,
                qty_consumed=float(c.qty_consumed),
            )
            for c in mo.batch_consumptions
        ]
    else:
        mo.batch_trace = []

    # 3b. Populate completion totals (if loaded)
    if "completions" not in insp.unloaded:
        mo.qty_completed_total = sum(float(c.qty_completed) for c in mo.completions)
    else:
        mo.qty_completed_total = 0.0
        sa_attributes.set_committed_value(mo, "completions", [])

    # 4. Recurse into children (if loaded); stub unloaded child_mos as []
    if "child_mos" not in insp.unloaded:
        for child in mo.child_mos:
            populate_mo_ids(child)
    else:
        sa_attributes.set_committed_value(mo, "child_mos", [])

    # 5. Populate required_mo_ids from dependency pegging records (if loaded)
    if "required_dependencies" not in insp.unloaded:
        mo.required_mo_ids = [dep.required_mo_id for dep in mo.required_dependencies]
    else:
        mo.required_mo_ids = []
        sa_attributes.set_committed_value(mo, "required_dependencies", [])

async def load_mo_tree(db: AsyncSession, root_ids: list) -> dict:
    """
    Load a MO tree of arbitrary depth using a recursive CTE.
    Returns {mo.id: ManufacturingOrder} with child_mos fully populated at every level.
    """
    if not root_ids:
        return {}

    # Recursive CTE: walk from roots down to all descendants
    anchor = (
        select(ManufacturingOrder.id, ManufacturingOrder.parent_mo_id)
        .filter(ManufacturingOrder.id.in_(root_ids))
        .cte(name="mo_tree", recursive=True)
    )
    recursive_part = select(ManufacturingOrder.id, ManufacturingOrder.parent_mo_id).join(
        anchor, ManufacturingOrder.parent_mo_id == anchor.c.id
    )
    mo_cte = anchor.union_all(recursive_part)

    id_result = await db.execute(select(mo_cte.c.id))
    all_ids = [row[0] for row in id_result.fetchall()]

    if not all_ids:
        return {}

    # Load every MO in the tree with its own relationships (no child_mos eager-load)
    result = await db.execute(
        select(ManufacturingOrder)
        .options(
            selectinload(ManufacturingOrder.item),
            selectinload(ManufacturingOrder.attribute_values),
            selectinload(ManufacturingOrder.sales_order),
            selectinload(ManufacturingOrder.required_dependencies),
            selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.work_center),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.item),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.attribute_values),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.operations),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.sizes).selectinload(BOMSize.size),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.customer),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.work_center),
            selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
            selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
            selectinload(ManufacturingOrder.completions),
        )
        .filter(ManufacturingOrder.id.in_(all_ids))
    )
    mo_map = {mo.id: mo for mo in result.unique().scalars().all()}

    # Index children by parent
    children_by_parent: dict = defaultdict(list)
    for mo in mo_map.values():
        if mo.parent_mo_id is not None:
            children_by_parent[mo.parent_mo_id].append(mo)

    # Mark child_mos as committed on every node so Pydantic won't trigger a lazy-load
    for mo in mo_map.values():
        sa_attributes.set_committed_value(mo, "child_mos", children_by_parent.get(mo.id, []))

    return mo_map


async def create_mo_recursive(
    db: AsyncSession,
    bom_id: uuid.UUID,
    qty: float,
    location_id: uuid.UUID,
    user_id: uuid.UUID,
    parent_mo_id: Optional[uuid.UUID] = None,
    source_location_id: Optional[uuid.UUID] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    production_run_id: Optional[uuid.UUID] = None,
    target_start_date: Optional[datetime] = None,
    target_end_date: Optional[datetime] = None,
    bom_size_id: Optional[uuid.UUID] = None,
    create_children: bool = True,
) -> ManufacturingOrder:
    """Recursively creates manufacturing orders for sub-assemblies.
    Pass create_children=False to create only the root MO (used in two-pass PR creation)."""
    # 1. Fetch BOM with lines
    result = await db.execute(
        select(BOM)
        .options(selectinload(BOM.lines), selectinload(BOM.attribute_values))
        .filter(BOM.id == bom_id)
    )
    bom = result.scalars().first()
    if not bom:
        raise ValueError(f"BOM {bom_id} not found")

    # 2. Generate a meaningful code based on the BOM's item name (MO-{ITEM_NAME}-001)
    item_result = await db.execute(select(Item).filter(Item.id == bom.item_id))
    item = item_result.scalars().first()
    raw_name = item.name if item else str(bom.item_id)[:8]
    safe_name = re.sub(r'[^A-Za-z0-9\-]', '-', raw_name).strip('-')
    base = f"MO-{safe_name}"
    counter = 1
    while True:
        candidate = f"{base}-{str(counter).zfill(5)}"
        existing = await db.execute(select(ManufacturingOrder.id).filter(ManufacturingOrder.code == candidate).limit(1))
        if existing.scalars().first() is None:
            mo_code = candidate
            break
        counter += 1

    # 3. Create this MO (bom_size_id only applies to the root MO, not sub-assemblies)
    mo = ManufacturingOrder(
        code=mo_code,
        bom_id=bom.id,
        item_id=bom.item_id,
        location_id=location_id,
        source_location_id=source_location_id or location_id,
        sales_order_id=sales_order_id,
        production_run_id=production_run_id,
        parent_mo_id=parent_mo_id,
        bom_size_id=bom_size_id if parent_mo_id is None else None,
        qty=qty,
        target_start_date=target_start_date,
        target_end_date=target_end_date,
        status="PENDING"
    )
    mo.attribute_values = list(bom.attribute_values)
    db.add(mo)
    await db.flush()

    # 4. Look for sub-BOMs in lines — only active BOMs, percentage-based qty
    if create_children:
        for line in bom.lines:
            if not line.percentage:
                continue  # 0% or null = not needed
            sub_bom_result = await db.execute(
                select(BOM).filter(BOM.item_id == line.item_id, BOM.active == True).limit(1)
            )
            sub_bom = sub_bom_result.scalars().first()

            if sub_bom:
                sub_qty = (qty * float(line.percentage)) / 100
                await create_mo_recursive(
                    db,
                    sub_bom.id,
                    sub_qty,
                    location_id,
                    user_id,
                    parent_mo_id=mo.id,
                    source_location_id=source_location_id,
                    sales_order_id=sales_order_id,
                    production_run_id=production_run_id,
                    target_start_date=target_start_date,
                    target_end_date=target_end_date,
                )

    return mo

@router.post("/manufacturing-orders", response_model=ManufacturingOrderResponse)
async def create_manufacturing_order(payload: ManufacturingOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    # 1. Validation
    result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    source_location = None
    if payload.source_location_code:
        src_result = await db.execute(select(Location).filter(Location.code == payload.source_location_code))
        source_location = src_result.scalars().first()

    # 2. Logic: Regular or Nested
    if payload.create_nested:
        try:
            mo = await create_mo_recursive(
                db,
                payload.bom_id,
                payload.qty,
                location.id,
                current_user.id,
                source_location_id=source_location.id if source_location else None,
                sales_order_id=payload.sales_order_id,
                target_start_date=payload.target_start_date,
                target_end_date=payload.target_end_date,
                bom_size_id=payload.bom_size_id,
            )
            # Overwrite code if specified for root
            if payload.code:
                mo.code = payload.code
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Standard Single MO logic
        result = await db.execute(select(ManufacturingOrder).filter(ManufacturingOrder.code == payload.code))
        if result.scalars().first():
            raise HTTPException(status_code=400, detail="Manufacturing Order Code already exists")

        mo = ManufacturingOrder(
            code=payload.code,
            bom_id=bom.id,
            item_id=bom.item_id,
            location_id=location.id,
            source_location_id=location.id,
            sales_order_id=payload.sales_order_id,
            bom_size_id=payload.bom_size_id,
            qty=payload.qty,
            target_start_date=payload.target_start_date,
            target_end_date=payload.target_end_date,
            status="PENDING"
        )
        # Load attributes from BOM
        result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id).options(selectinload(BOM.attribute_values)))
        bom_with_attrs = result.scalars().first()
        if bom_with_attrs:
            mo.attribute_values = bom_with_attrs.attribute_values

        db.add(mo)
        await db.commit()

    # 3. Re-fetch the full tree (unlimited depth) for response
    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)

    await audit_service.log_activity(db, current_user.id, "CREATE", "ManufacturingOrder", str(mo.id), f"Created {'Nested' if payload.create_nested else 'Single'} MO {mo.code}")

    populate_mo_ids(mo)
    return mo

@router.get("/manufacturing-orders/available-code")
async def get_available_mo_code(
    base: str = Query(..., description="Base code pattern, e.g. MO-ITEM"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    counter = 1
    while True:
        candidate = f"{base}-{str(counter).zfill(5)}"
        result = await db.execute(select(ManufacturingOrder.id).filter(ManufacturingOrder.code == candidate).limit(1))
        if result.scalars().first() is None:
            return {"code": candidate}
        counter += 1

@router.get("/manufacturing-orders", response_model=PaginatedManufacturingOrderResponse)
async def get_manufacturing_orders(
    skip: int = 0,
    limit: int = 100,
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    all_levels: bool = False, # New flag to include children in the flat list if desired
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    # Build a lightweight query for root MO IDs only (used for count + pagination)
    id_query = select(ManufacturingOrder.id)

    # Filter only root MOs by default — exclude shared component MOs (they appear under PR view)
    if not all_levels:
        id_query = id_query.filter(
            ManufacturingOrder.parent_mo_id == None,
            ManufacturingOrder.is_shared_component == False,
        )

    if start_date:
        id_query = id_query.filter(ManufacturingOrder.created_at >= start_date)
    if end_date:
        id_query = id_query.filter(ManufacturingOrder.created_at <= end_date)

    if current_user.allowed_categories:
        id_query = id_query.join(Item, ManufacturingOrder.item_id == Item.id).filter(Item.category.in_(current_user.allowed_categories))

    count_result = await db.execute(select(func.count()).select_from(id_query.subquery()))
    total = count_result.scalar()

    root_id_result = await db.execute(
        id_query.order_by(ManufacturingOrder.created_at.desc()).offset(skip).limit(limit)
    )
    root_ids = [row[0] for row in root_id_result.fetchall()]

    # Load the full tree (unlimited depth) for the paginated root MOs
    mo_map = await load_mo_tree(db, root_ids)
    items_list = [mo_map[rid] for rid in root_ids if rid in mo_map]

    requirements = []
    for item in items_list:
        populate_mo_ids(item)

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
                if not line.percentage:
                    continue
                req = (float(item.qty) * float(line.percentage)) / 100
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

@router.put("/manufacturing-orders/{mo_id}/status")
async def update_manufacturing_order_status(mo_id: str, status: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    previous_status = mo.status
    valid_statuses = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    if status in ("IN_PROGRESS", "COMPLETED") and previous_status not in ("IN_PROGRESS", "COMPLETED"):
        # Check traditional child MOs (single-parent, created via create_mo_recursive)
        incomplete_children = [c for c in mo.child_mos if c.status != "COMPLETED"]
        if incomplete_children:
            codes = ", ".join(c.code for c in incomplete_children)
            raise HTTPException(status_code=400, detail=f"Child MOs must be completed first: {codes}")

        # Check shared component MOs linked via mo_dependencies
        dep_ids_result = await db.execute(
            select(MODependency.required_mo_id).filter(MODependency.dependent_mo_id == mo.id)
        )
        required_dep_ids = [row[0] for row in dep_ids_result.fetchall()]
        if required_dep_ids:
            incomplete_dep_result = await db.execute(
                select(ManufacturingOrder.code)
                .filter(ManufacturingOrder.id.in_(required_dep_ids), ManufacturingOrder.status != "COMPLETED")
            )
            incomplete_dep_codes = [row[0] for row in incomplete_dep_result.fetchall()]
            if incomplete_dep_codes:
                raise HTTPException(status_code=400, detail=f"Required component MOs must be completed first: {', '.join(incomplete_dep_codes)}")

    if status == "IN_PROGRESS" and previous_status != "IN_PROGRESS":
        if mo.bom:
            for line in mo.bom.lines:
                if not line.percentage:
                    continue
                req = (float(mo.qty) * float(line.percentage)) / 100
                tol = float(mo.bom.tolerance_percentage or 0)
                if tol > 0: req *= (1 + (tol / 100))

                check_loc_id = line.source_location_id or mo.source_location_id or mo.location_id
                stock = await stock_service.get_stock_balance(db, line.item_id, check_loc_id, [v.id for v in line.attribute_values])
                if stock < req:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for component {line.item_id}")

        mo.actual_start_date = datetime.utcnow()

    if status == "COMPLETED" and previous_status != "COMPLETED":
        mo.actual_end_date = datetime.utcnow()

        # How much was already covered by incremental completion entries?
        completed_result = await db.execute(
            select(func.sum(MOCompletion.qty_completed)).filter(MOCompletion.mo_id == mo.id)
        )
        already_completed = float(completed_result.scalar() or 0)
        remaining_qty = max(0.0, float(mo.qty) - already_completed)

        if remaining_qty > 0 and mo.bom:
            # 1. DEDUCT Raw Materials for remaining (uncovered) qty
            for line in mo.bom.lines:
                if not line.percentage:
                    continue
                req = (remaining_qty * float(line.percentage)) / 100
                deduct_loc_id = line.source_location_id or mo.source_location_id or mo.location_id
                await stock_service.add_stock_entry(
                    db,
                    item_id=line.item_id,
                    location_id=deduct_loc_id,
                    qty_change=-req,
                    reference_type="Manufacturing Order",
                    reference_id=mo.code,
                    attribute_value_ids=[v.id for v in line.attribute_values]
                )

            # 2. ADD remaining Finished Goods
            await stock_service.add_stock_entry(
                db,
                item_id=mo.item_id,
                location_id=mo.location_id,
                qty_change=remaining_qty,
                reference_type="Manufacturing Order",
                reference_id=mo.code,
                attribute_value_ids=[v.id for v in mo.attribute_values]
            )

        # 3. UPDATE Sales Order status if root MO
        if mo.sales_order_id and mo.parent_mo_id is None:
            res = await db.execute(select(SalesOrder).filter(SalesOrder.id == mo.sales_order_id))
            so = res.scalars().first()
            if so:
                so.status = "READY"
                await audit_service.log_activity(db, current_user.id, "STATUS_CHANGE", "SalesOrder", str(so.id), f"Ready by root MO {mo.code}")

    mo.status = status
    await db.commit()

    await audit_service.log_activity(db, current_user.id, "UPDATE_STATUS", "ManufacturingOrder", mo_id, f"{previous_status} -> {status}")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": status, "code": mo.code})

    return {"status": "success", "message": f"Updated to {status}"}

@router.post("/manufacturing-orders/{mo_id}/completions", response_model=ManufacturingOrderResponse)
async def add_mo_completion(
    mo_id: str,
    payload: MOCompletionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    if mo.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Cannot log completion on a {mo.status} MO")

    if payload.qty_completed <= 0:
        raise HTTPException(status_code=400, detail="qty_completed must be positive")

    # Check traditional child MOs
    incomplete_children = [c for c in mo.child_mos if c.status != "COMPLETED"]
    if incomplete_children:
        codes = ", ".join(c.code for c in incomplete_children)
        raise HTTPException(status_code=400, detail=f"Child MOs must be completed first: {codes}")

    # Check shared component MOs linked via mo_dependencies
    dep_ids_result = await db.execute(
        select(MODependency.required_mo_id).filter(MODependency.dependent_mo_id == mo.id)
    )
    required_dep_ids = [row[0] for row in dep_ids_result.fetchall()]
    if required_dep_ids:
        incomplete_dep_result = await db.execute(
            select(ManufacturingOrder.code)
            .filter(ManufacturingOrder.id.in_(required_dep_ids), ManufacturingOrder.status != "COMPLETED")
        )
        incomplete_dep_codes = [row[0] for row in incomplete_dep_result.fetchall()]
        if incomplete_dep_codes:
            raise HTTPException(status_code=400, detail=f"Required component MOs must be completed first: {', '.join(incomplete_dep_codes)}")

    # Auto-start if PENDING — pre-check stock before committing
    if mo.status == "PENDING":
        if mo.bom:
            for line in mo.bom.lines:
                if not line.percentage:
                    continue
                req = (float(mo.qty) * float(line.percentage)) / 100
                tol = float(mo.bom.tolerance_percentage or 0)
                if tol > 0:
                    req *= (1 + (tol / 100))
                check_loc_id = line.source_location_id or mo.source_location_id or mo.location_id
                stock = await stock_service.get_stock_balance(db, line.item_id, check_loc_id, [v.id for v in line.attribute_values])
                if stock < req:
                    raise HTTPException(status_code=400, detail=f"Insufficient stock for component {line.item_id}")
        mo.status = "IN_PROGRESS"
        mo.actual_start_date = datetime.utcnow()

    # Create completion record
    completion = MOCompletion(
        mo_id=mo.id,
        qty_completed=payload.qty_completed,
        operator_name=payload.operator_name,
        notes=payload.notes,
    )
    db.add(completion)
    await db.flush()

    # Proportional raw material deduction for this entry
    if mo.bom:
        for line in mo.bom.lines:
            if not line.percentage:
                continue
            req = (float(payload.qty_completed) * float(line.percentage)) / 100
            deduct_loc_id = line.source_location_id or mo.source_location_id or mo.location_id
            await stock_service.add_stock_entry(
                db,
                item_id=line.item_id,
                location_id=deduct_loc_id,
                qty_change=-req,
                reference_type="Manufacturing Order",
                reference_id=mo.code,
                attribute_value_ids=[v.id for v in line.attribute_values],
            )

    # Credit proportional finished goods
    await stock_service.add_stock_entry(
        db,
        item_id=mo.item_id,
        location_id=mo.location_id,
        qty_change=float(payload.qty_completed),
        reference_type="Manufacturing Order",
        reference_id=mo.code,
        attribute_value_ids=[v.id for v in mo.attribute_values],
    )

    # Sum all completions to check for auto-complete
    total_result = await db.execute(
        select(func.sum(MOCompletion.qty_completed)).filter(MOCompletion.mo_id == mo.id)
    )
    total_completed = float(total_result.scalar() or 0)

    if total_completed >= float(mo.qty):
        mo.status = "COMPLETED"
        mo.actual_end_date = datetime.utcnow()
        if mo.sales_order_id and mo.parent_mo_id is None:
            res = await db.execute(select(SalesOrder).filter(SalesOrder.id == mo.sales_order_id))
            so = res.scalars().first()
            if so:
                so.status = "READY"
                await audit_service.log_activity(db, current_user.id, "STATUS_CHANGE", "SalesOrder", str(so.id), f"Ready by root MO {mo.code}")

    await db.commit()
    await audit_service.log_activity(db, current_user.id, "COMPLETION", "ManufacturingOrder", mo_id, f"Logged {payload.qty_completed} completed (total {total_completed}/{mo.qty})")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": mo.status, "code": mo.code})

    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)
    populate_mo_ids(mo)
    return mo


@router.post("/manufacturing-orders/{mo_id}/complete-with-batches")
async def complete_manufacturing_order_with_batches(
    mo_id: str,
    payload: MOCompleteWithBatchesPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    from app.models.batch import BatchConsumption

    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    if mo.status == "COMPLETED":
        raise HTTPException(status_code=400, detail="Already completed")

    # Build lookup: (item_id, sorted attr ids) -> batch_id + qty from payload
    batch_map: dict[tuple, uuid.UUID] = {}
    for mb in payload.material_batches:
        key = (str(mb.bom_line_item_id), ",".join(sorted(str(v) for v in mb.attribute_value_ids)))
        batch_map[key] = (mb.batch_id, mb.qty)

    if mo.bom:
        for line in mo.bom.lines:
            if not line.percentage:
                continue
            req = (float(mo.qty) * float(line.percentage)) / 100
            tol = float(mo.bom.tolerance_percentage or 0)
            if tol > 0:
                req *= (1 + (tol / 100))

            deduct_loc_id = line.source_location_id or mo.source_location_id or mo.location_id
            attr_ids = [v.id for v in line.attribute_values]
            key = (str(line.item_id), ",".join(sorted(str(v) for v in attr_ids)))
            batch_id, _ = batch_map.get(key, (None, req))

            await stock_service.add_stock_entry(
                db,
                item_id=line.item_id,
                location_id=deduct_loc_id,
                qty_change=-req,
                reference_type="Manufacturing Order",
                reference_id=mo.code,
                attribute_value_ids=attr_ids,
                batch_id=batch_id,
            )

            # Record traceability if both batches known
            if batch_id and payload.output_batch_id:
                consumption = BatchConsumption(
                    manufacturing_order_id=mo.id,
                    input_batch_id=batch_id,
                    output_batch_id=payload.output_batch_id,
                    qty_consumed=req,
                )
                db.add(consumption)

    # Add finished goods with output batch
    await stock_service.add_stock_entry(
        db,
        item_id=mo.item_id,
        location_id=mo.location_id,
        qty_change=mo.qty,
        reference_type="Manufacturing Order",
        reference_id=mo.code,
        attribute_value_ids=[v.id for v in mo.attribute_values],
        batch_id=payload.output_batch_id,
    )

    mo.status = "COMPLETED"
    mo.actual_end_date = datetime.utcnow()

    if mo.sales_order_id and mo.parent_mo_id is None:
        res = await db.execute(select(SalesOrder).filter(SalesOrder.id == mo.sales_order_id))
        so = res.scalars().first()
        if so:
            so.status = "READY"

    await db.commit()
    await audit_service.log_activity(db, current_user.id, "COMPLETE", "ManufacturingOrder", mo_id, f"Completed with batch tracking")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": "COMPLETED", "code": mo.code})

    return {"status": "success", "message": "Completed with batch tracking"}


@router.delete("/manufacturing-orders/{mo_id}")
async def delete_manufacturing_order(mo_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id))
    mo = result.scalars().first()
    if not mo: raise HTTPException(status_code=404, detail="Not found")
    mo_code = mo.code
    await db.delete(mo)
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "DELETE", "manufacturing_order", mo_id, details={"code": mo_code})
    return {"status": "success"}
