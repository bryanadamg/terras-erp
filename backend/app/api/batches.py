from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from app.db.session import get_async_db
from app.models.batch import Batch, BatchConsumption
from app.models.item import Item
from app.schemas import BatchCreate, BatchResponse, BatchTraceResponse, BatchConsumptionResponse
from app.api.auth import get_current_user
from app.models.auth import User
from app.services import audit_service
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/batches", tags=["batches"])


def _build_batch_number(date_str: str, counter: int) -> str:
    return f"BAT-{date_str}-{str(counter).zfill(4)}"


@router.post("", response_model=BatchResponse)
async def create_batch(
    payload: BatchCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    item_result = await db.execute(select(Item).filter(Item.id == payload.item_id))
    if not item_result.scalars().first():
        raise HTTPException(status_code=404, detail="Item not found")

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    prefix = f"BAT-{today}-"

    count_result = await db.execute(
        select(func.count()).select_from(Batch).filter(Batch.batch_number.like(f"{prefix}%"))
    )
    existing_count = count_result.scalar() or 0
    batch_number = _build_batch_number(today, existing_count + 1)

    # Ensure uniqueness in edge cases
    while True:
        check = await db.execute(select(Batch.id).filter(Batch.batch_number == batch_number).limit(1))
        if check.scalars().first() is None:
            break
        existing_count += 1
        batch_number = _build_batch_number(today, existing_count + 1)

    batch = Batch(
        batch_number=batch_number,
        item_id=payload.item_id,
        notes=payload.notes,
        created_by=current_user.username,
    )
    db.add(batch)
    await db.commit()
    await db.refresh(batch)

    await audit_service.log_activity(
        db, current_user.id, "CREATE", "Batch", str(batch.id),
        details=f"Created batch {batch_number} for item {payload.item_id}"
    )
    return batch


@router.get("", response_model=list[BatchResponse])
async def list_batches(
    item_id: uuid.UUID | None = Query(None),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Batch).order_by(Batch.created_at.desc())
    if item_id:
        query = query.filter(Batch.item_id == item_id)
    result = await db.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.get("/{batch_id}", response_model=BatchResponse)
async def get_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Batch).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.delete("/{batch_id}")
async def delete_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Batch).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    await db.delete(batch)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "Batch", str(batch_id),
        details=f"Deleted batch {batch.batch_number}"
    )
    return {"status": "success"}


@router.get("/{batch_id}/trace", response_model=BatchTraceResponse)
async def trace_batch_forward(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Forward traceability: raw material batch → finished goods batches produced with it."""
    batch_result = await db.execute(select(Batch).filter(Batch.id == batch_id))
    batch = batch_result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    consumptions_result = await db.execute(
        select(BatchConsumption).filter(BatchConsumption.input_batch_id == batch_id)
    )
    consumptions = consumptions_result.scalars().all()

    return BatchTraceResponse(
        batch=batch,
        consumptions=[BatchConsumptionResponse.model_validate(c) for c in consumptions],
    )
