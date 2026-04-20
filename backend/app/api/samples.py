from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from app.db.session import get_async_db
from app.models.sample import SampleRequest, SampleColor
from app.schemas import SampleRequestCreate, SampleRequestResponse, SampleColorResponse
from app.models.auth import User
from app.api.auth import get_current_user
from app.services import audit_service
from datetime import datetime, date

router = APIRouter()


@router.post("/samples", response_model=SampleRequestResponse)
async def create_sample_request(
    payload: SampleRequestCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    count_result = await db.execute(select(func.count()).select_from(SampleRequest))
    count = count_result.scalar_one()
    code = f"SMP-{datetime.now().year}-{str(count + 1).zfill(5)}"

    req_date = date.fromisoformat(payload.request_date) if payload.request_date else date.today()
    est_date = date.fromisoformat(payload.estimated_completion_date) if payload.estimated_completion_date else None

    sample = SampleRequest(
        code=code,
        customer_id=payload.customer_id,
        request_date=req_date,
        project=payload.project,
        customer_article_code=payload.customer_article_code,
        internal_article_code=payload.internal_article_code,
        width=payload.width,
        main_material=payload.main_material,
        middle_material=payload.middle_material,
        bottom_material=payload.bottom_material,
        weft=payload.weft,
        warp=payload.warp,
        original_weight=payload.original_weight,
        production_weight=payload.production_weight,
        additional_info=payload.additional_info,
        quantity=payload.quantity,
        sample_size=payload.sample_size,
        estimated_completion_date=est_date,
        completion_description=payload.completion_description,
        notes=payload.notes,
        status="DRAFT",
    )
    db.add(sample)
    await db.flush()

    for i, color_data in enumerate(payload.colors):
        if color_data.name.strip():
            db.add(SampleColor(
                sample_request_id=sample.id,
                name=color_data.name.strip(),
                is_repeat=color_data.is_repeat,
                order=i,
            ))

    await db.commit()

    result = await db.execute(
        select(SampleRequest)
        .options(joinedload(SampleRequest.colors))
        .filter(SampleRequest.id == sample.id)
    )
    sample = result.unique().scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="SampleRequest",
        entity_id=str(sample.id),
        details=f"Created Sample Request {sample.code}",
        changes={"code": sample.code, "customer_article_code": sample.customer_article_code},
    )

    return sample


@router.get("/samples", response_model=list[SampleRequestResponse])
async def get_samples(
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SampleRequest)
        .options(joinedload(SampleRequest.colors))
        .order_by(SampleRequest.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.unique().scalars().all()


@router.put("/samples/{sample_id}/status")
async def update_sample_status(
    sample_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    valid_statuses = ["DRAFT", "IN_PRODUCTION", "SENT", "PENDING_APPROVAL", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    previous_status = sample.status
    sample.status = status
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_STATUS",
        entity_type="SampleRequest",
        entity_id=sample_id,
        details=f"Updated Sample {sample.code} status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )
    return {"status": "success", "message": f"Sample updated to {status}"}


@router.put("/samples/{sample_id}/colors/{color_id}/status", response_model=SampleColorResponse)
async def update_color_status(
    sample_id: str,
    color_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(SampleColor).filter(SampleColor.id == color_id, SampleColor.sample_request_id == sample_id)
    )
    color = result.scalars().first()
    if not color:
        raise HTTPException(status_code=404, detail="Color not found")

    valid_statuses = ["PENDING", "IN_PRODUCTION", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    previous_status = color.status
    color.status = status
    await db.commit()

    result = await db.execute(select(SampleColor).filter(SampleColor.id == color_id))
    color = result.scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_COLOR_STATUS",
        entity_type="SampleColor",
        entity_id=color_id,
        details=f"Updated color '{color.name}' status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )
    return color


@router.delete("/samples/{sample_id}")
async def delete_sample(
    sample_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    details = f"Deleted Sample {sample.code}"
    await db.delete(sample)
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="SampleRequest",
        entity_id=sample_id,
        details=details,
    )
    return {"status": "success", "message": "Sample deleted"}
