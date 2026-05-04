from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from typing import Optional
from app.db.session import get_async_db
from app.models.work_order import WorkOrder
from app.models.manufacturing import ManufacturingOrder
from app.schemas import WorkOrderCreate, WorkOrderResponse
from app.models.auth import User
from app.api.auth import get_current_user
from app.services import audit_service
from app.core.ws_manager import manager
from datetime import datetime

router = APIRouter()

def _wo_options():
    return [joinedload(WorkOrder.work_center)]

@router.get("/work-orders", response_model=list[WorkOrderResponse])
async def list_work_orders(
    manufacturing_order_id: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 9999,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    q = select(WorkOrder).options(*_wo_options()).order_by(WorkOrder.sequence)
    if manufacturing_order_id:
        q = q.filter(WorkOrder.manufacturing_order_id == manufacturing_order_id)
    result = await db.execute(q.offset(skip).limit(limit))
    return result.scalars().all()

@router.post("/work-orders", response_model=WorkOrderResponse)
async def create_work_order(
    payload: WorkOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    mo_result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == payload.manufacturing_order_id)
    )
    if not mo_result.scalars().first():
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    wo = WorkOrder(
        manufacturing_order_id=payload.manufacturing_order_id,
        sequence=payload.sequence,
        name=payload.name,
        work_center_id=payload.work_center_id,
        qty=payload.qty,
        planned_duration_hours=payload.planned_duration_hours,
        notes=payload.notes,
        target_start_date=payload.target_start_date,
        target_end_date=payload.target_end_date,
        status="PENDING",
    )
    db.add(wo)
    await db.commit()

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo.id)
    )
    wo = result.scalars().first()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE",
        entity_type="WORK_ORDER", entity_id=str(wo.id),
        details=f"Created Work Order '{wo.name}'",
        changes=payload.model_dump()
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": str(wo.id), "status": "PENDING"})
    return wo

@router.put("/work-orders/{wo_id}", response_model=WorkOrderResponse)
async def update_work_order(
    wo_id: str,
    payload: WorkOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")

    wo.sequence = payload.sequence
    wo.name = payload.name
    wo.work_center_id = payload.work_center_id
    wo.qty = payload.qty
    wo.planned_duration_hours = payload.planned_duration_hours
    wo.notes = payload.notes
    wo.target_start_date = payload.target_start_date
    wo.target_end_date = payload.target_end_date

    await db.commit()

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    return result.scalars().first()

@router.put("/work-orders/{wo_id}/status", response_model=WorkOrderResponse)
async def update_work_order_status(
    wo_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    valid = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")

    wo.status = status
    if status == "IN_PROGRESS" and not wo.actual_start_date:
        wo.actual_start_date = datetime.utcnow()
    if status == "COMPLETED" and not wo.actual_end_date:
        wo.actual_end_date = datetime.utcnow()

    await db.commit()
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": status})

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    return result.scalars().first()

@router.delete("/work-orders/{wo_id}")
async def delete_work_order(
    wo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(WorkOrder).filter(WorkOrder.id == wo_id))
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    name = wo.name
    await db.delete(wo)
    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE",
        entity_type="WORK_ORDER", entity_id=wo_id,
        details=f"Deleted Work Order '{name}'"
    )
    return {"status": "success"}
