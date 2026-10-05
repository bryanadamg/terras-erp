import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_async_db
from app.models.packaging_type import PackagingType
from app.models.batch import Batch
from app.models.auth import User
from app.api.auth import get_current_user, require_permission
from app.services import audit_service
from app.core.ws_manager import manager
from app.schemas import PackagingTypeCreate, PackagingTypeUpdate, PackagingTypeResponse

router = APIRouter()


@router.get("/packaging-types", response_model=list[PackagingTypeResponse])
async def list_packaging_types(
    include_inactive: bool = Query(False),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """The full list, unpaginated by design.

    This is a lookup feed, not a list window: every pack screen renders it as a
    picker and reads a tare back out of it by id, so a page of it would be a
    wrong answer rather than a short list (see the lookup-feed rule in
    CLAUDE.md). It is a handful of rows — boxes the plant physically stocks.
    """
    q = select(PackagingType)
    if not include_inactive:
        q = q.filter(PackagingType.active == True)  # noqa: E712
    q = q.order_by(PackagingType.sort_order, PackagingType.name)
    return (await db.execute(q)).scalars().all()


@router.post("/packaging-types", response_model=PackagingTypeResponse)
async def create_packaging_type(
    payload: PackagingTypeCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('packaging_type.create')),
):
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="Code is required")
    dupe = (await db.execute(
        select(PackagingType).filter(func.upper(PackagingType.code) == code)
    )).scalars().first()
    if dupe:
        raise HTTPException(status_code=400, detail=f"Packaging type {code} already exists")

    pt = PackagingType(
        code=code,
        name=(payload.name or "").strip() or code,
        # A custom box is weighed at pack time, so a tare typed here would be a
        # default nobody ever means — dropped rather than stored and ignored.
        tare_kg=None if payload.is_custom else payload.tare_kg,
        is_custom=bool(payload.is_custom),
        sort_order=payload.sort_order or 0,
        active=payload.active if payload.active is not None else True,
    )
    db.add(pt)
    await db.commit()
    await db.refresh(pt)

    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "PackagingType", str(pt.id),
        details=f"Created packaging type {pt.code}", changes=audit_service.added(payload.model_dump(mode="json")),
    )
    try:
        await manager.broadcast({"type": "PACKAGING_TYPE_UPDATE", "id": str(pt.id)})
    except Exception:
        pass
    return pt


@router.put("/packaging-types/{pt_id}", response_model=PackagingTypeResponse)
async def update_packaging_type(
    pt_id: uuid.UUID,
    payload: PackagingTypeUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('packaging_type.edit')),
):
    pt = (await db.execute(select(PackagingType).filter(PackagingType.id == pt_id))).scalars().first()
    if not pt:
        raise HTTPException(status_code=404, detail="Packaging type not found")

    data = payload.model_dump(exclude_unset=True)
    if "code" in data:
        code = (data["code"] or "").strip().upper()
        if not code:
            raise HTTPException(status_code=400, detail="Code is required")
        dupe = (await db.execute(
            select(PackagingType).filter(
                func.upper(PackagingType.code) == code, PackagingType.id != pt_id
            )
        )).scalars().first()
        if dupe:
            raise HTTPException(status_code=400, detail=f"Packaging type {code} already exists")
        data["code"] = code
    before = audit_service.fields_of(pt, data)
    for k, v in data.items():
        setattr(pt, k, v)
    if pt.is_custom:
        pt.tare_kg = None

    await db.commit()
    await db.refresh(pt)

    # Note this changes NOTHING already packed: every carton snapshots the tare it
    # was packed with (models/batch.py), so a corrected tare applies from here on
    # and never rewrites a printed label or a dispatched note's weight.
    await audit_service.log_activity(
        db, str(current_user.id), "UPDATE", "PackagingType", str(pt.id),
        details=f"Updated packaging type {pt.code}", changes=audit_service.diff(before, data),
    )
    try:
        await manager.broadcast({"type": "PACKAGING_TYPE_UPDATE", "id": str(pt.id)})
    except Exception:
        pass
    return pt


@router.delete("/packaging-types/{pt_id}")
async def delete_packaging_type(
    pt_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('packaging_type.archive')),
):
    """Hard delete only while unused; otherwise deactivate.

    A used type is still named on every carton it packed — the FK is SET NULL, so
    deleting it would blank the box name on labels and delivery notes already
    printed. Deactivating takes it out of the pickers and leaves history intact.
    """
    pt = (await db.execute(select(PackagingType).filter(PackagingType.id == pt_id))).scalars().first()
    if not pt:
        raise HTTPException(status_code=404, detail="Packaging type not found")

    used = (await db.execute(
        select(func.count()).select_from(Batch).filter(Batch.packaging_type_id == pt_id)
    )).scalar_one()

    if used > 0:
        pt.active = False
        action = "ARCHIVE"
        detail = f"Deactivated packaging type {pt.code} (used by {used} carton(s))"
    else:
        action = "DELETE"
        detail = f"Deleted packaging type {pt.code}"
        await db.delete(pt)
    await db.commit()

    await audit_service.log_activity(
        db, str(current_user.id), action, "PackagingType", str(pt_id), details=detail, changes={},
    )
    try:
        await manager.broadcast({"type": "PACKAGING_TYPE_UPDATE", "id": str(pt_id)})
    except Exception:
        pass
    return {"status": "ok", "action": action.lower()}
