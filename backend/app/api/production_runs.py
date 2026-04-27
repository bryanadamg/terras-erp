from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload, selectinload
from app.db.session import get_async_db
from app.models.production_run import ProductionRun
from app.models.manufacturing import ManufacturingOrder
from app.models.bom import BOM, BOMLine
from app.models.location import Location
from app.schemas import (
    ProductionRunCreate, ProductionRunResponse,
    PaginatedProductionRunResponse, ManufacturingOrderCreate
)
from app.models.auth import User
from app.api.auth import get_current_user
from app.services import audit_service
from app.core.ws_manager import manager
import uuid
from datetime import datetime

router = APIRouter()

def _pr_load_options():
    return [
        joinedload(ProductionRun.bom).options(
            joinedload(BOM.item),
            joinedload(BOM.customer),
            joinedload(BOM.work_center),
        ),
        selectinload(ProductionRun.manufacturing_orders).options(
            joinedload(ManufacturingOrder.item),
            selectinload(ManufacturingOrder.attribute_values),
        ),
    ]

@router.get("/production-runs/available-code")
async def get_available_pr_code(
    base: str = "PR",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    counter = 1
    while True:
        code = f"{base}-{counter:05d}"
        result = await db.execute(select(ProductionRun).filter(ProductionRun.code == code))
        if not result.scalars().first():
            return {"code": code}
        counter += 1

@router.get("/production-runs", response_model=PaginatedProductionRunResponse)
async def list_production_runs(
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    count_result = await db.execute(select(func.count()).select_from(ProductionRun))
    total = count_result.scalar()
    result = await db.execute(
        select(ProductionRun)
        .options(*_pr_load_options())
        .order_by(ProductionRun.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    prs = result.unique().scalars().all()
    page = (skip // limit) + 1
    return {"items": prs, "total": total, "page": page, "size": limit}

@router.get("/production-runs/{pr_id}", response_model=ProductionRunResponse)
async def get_production_run(
    pr_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr_id)
    )
    pr = result.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")
    return pr

@router.post("/production-runs", response_model=ProductionRunResponse)
async def create_production_run(
    payload: ProductionRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    # Validate BOM
    bom_result = await db.execute(
        select(BOM).options(
            joinedload(BOM.item),
            selectinload(BOM.attribute_values),
        ).filter(BOM.id == payload.bom_id)
    )
    bom = bom_result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    # Validate location
    loc_result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = loc_result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail=f"Location '{payload.location_code}' not found")

    source_location = None
    if payload.source_location_code:
        src_result = await db.execute(
            select(Location).filter(Location.code == payload.source_location_code)
        )
        source_location = src_result.scalars().first()

    # Check code uniqueness
    existing = await db.execute(select(ProductionRun).filter(ProductionRun.code == payload.code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Production Run code already exists")

    pr = ProductionRun(
        code=payload.code,
        bom_id=bom.id,
        sales_order_id=payload.sales_order_id,
        location_id=location.id,
        source_location_id=source_location.id if source_location else None,
        status="PENDING",
        notes=payload.notes,
        target_start_date=payload.target_start_date,
        target_end_date=payload.target_end_date,
    )
    db.add(pr)
    await db.flush()

    # Create one MO per size entry
    from app.models.bom import BOMSize
    for i, size_entry in enumerate(payload.sizes):
        if size_entry.qty <= 0:
            continue

        size_result = await db.execute(
            select(BOMSize).filter(
                BOMSize.id == size_entry.bom_size_id,
                BOMSize.bom_id == bom.id
            )
        )
        bom_size = size_result.scalars().first()
        if not bom_size:
            raise HTTPException(status_code=404, detail="BOM size entry not found")

        size_label = bom_size.label or f"S{i+1}"
        mo_code = f"{payload.code}-{size_label.upper()}"

        mo = ManufacturingOrder(
            code=mo_code,
            bom_id=bom.id,
            item_id=bom.item_id,
            location_id=location.id,
            source_location_id=source_location.id if source_location else None,
            sales_order_id=payload.sales_order_id,
            qty=size_entry.qty,
            status="PENDING",
            target_start_date=payload.target_start_date,
            target_end_date=payload.target_end_date,
            production_run_id=pr.id,
            bom_size_id=size_entry.bom_size_id,
        )
        mo.attribute_values = list(bom.attribute_values)
        db.add(mo)

    await db.commit()

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr.id)
    )
    pr = result.unique().scalars().first()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE",
        entity_type="PRODUCTION_RUN", entity_id=str(pr.id),
        details=f"Created Production Run {pr.code} with {len(payload.sizes)} MOs",
        changes=payload.model_dump()
    )
    await manager.broadcast({"type": "PRODUCTION_RUN_UPDATE", "pr_id": str(pr.id), "status": "PENDING"})
    return pr

@router.put("/production-runs/{pr_id}/status", response_model=ProductionRunResponse)
async def update_production_run_status(
    pr_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    valid = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr_id)
    )
    pr = result.unique().scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")

    pr.status = status
    if status == "IN_PROGRESS" and not pr.actual_start_date:
        pr.actual_start_date = datetime.utcnow()
    if status == "COMPLETED" and not pr.actual_end_date:
        pr.actual_end_date = datetime.utcnow()

    await db.commit()
    await manager.broadcast({"type": "PRODUCTION_RUN_UPDATE", "pr_id": pr_id, "status": status})

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr_id)
    )
    return result.unique().scalars().first()

@router.delete("/production-runs/{pr_id}")
async def delete_production_run(
    pr_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(ProductionRun).filter(ProductionRun.id == pr_id))
    pr = result.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")
    code = pr.code
    await db.delete(pr)
    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE",
        entity_type="PRODUCTION_RUN", entity_id=pr_id,
        details=f"Deleted Production Run {code}"
    )
    return {"status": "success"}
