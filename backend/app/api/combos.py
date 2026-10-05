import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_

from app.db.session import get_async_db
from app.models.combo import Combo
from app.models.attribute import Attribute, AttributeValue
from app.models.bom import bom_values, bom_line_values
from app.models.sales import sales_order_line_values
from app.models.manufacturing import manufacturing_order_values
from app.models.sample import sample_attribute_values
from app.models.auth import User
from app.api.auth import get_current_user, require_permission
from app.services import audit_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from app.schemas import ComboCreate, ComboUpdate, ComboResponse, ComboListResponse

router = APIRouter()

# Association tables whose attribute_value_id column pins a Combo value in use.
# A combo whose mirrored AttributeValue appears in any of these cannot be hard-deleted.
_VALUE_TABLES = [bom_values, bom_line_values, sales_order_line_values,
                 manufacturing_order_values, sample_attribute_values]


async def _combo_attribute_id(db: AsyncSession) -> uuid.UUID | None:
    """Return the id of the seeded `Combo` variant attribute (system_role='combo').
    Combo gates BOM selection through this attribute, so the library mirrors each combo
    to one of its AttributeValues (unlike the Color library, which uses a separate
    reference attribute). Never edit/rename this attribute directly."""
    result = await db.execute(
        select(Attribute.id).filter(Attribute.system_role == "combo")
    )
    return result.scalars().first()


async def _usage_count(db: AsyncSession, attribute_value_id: uuid.UUID | None) -> int:
    if attribute_value_id is None:
        return 0
    total = 0
    for tbl in _VALUE_TABLES:
        n = (await db.execute(
            select(func.count()).select_from(tbl)
            .filter(tbl.c.attribute_value_id == attribute_value_id)
        )).scalar_one()
        total += n
    return total


async def _usage_counts(db: AsyncSession, attribute_value_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    """Batched form of _usage_count for a page of combos — 5 grouped queries total
    instead of 5 per row. list_combos was awaiting _usage_count per row (N+1: page
    size 50 = 250 sequential round trips), which is fine against a handful of combos
    but not against the thousands the library is meant to hold."""
    counts: dict[uuid.UUID, int] = {av_id: 0 for av_id in attribute_value_ids}
    if not attribute_value_ids:
        return counts
    for tbl in _VALUE_TABLES:
        rows = await db.execute(
            select(tbl.c.attribute_value_id, func.count())
            .where(tbl.c.attribute_value_id.in_(attribute_value_ids))
            .group_by(tbl.c.attribute_value_id)
        )
        for av_id, n in rows.all():
            counts[av_id] = counts.get(av_id, 0) + n
    return counts


def _serialize(c: Combo, usage_count: int = 0) -> dict:
    d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    d["usage_count"] = usage_count
    return d


@router.get("/combos", response_model=ComboListResponse)
async def list_combos(
    search: str | None = Query(None),
    status: str | None = Query(None),
    window: PageWindow = Depends(PageParams()),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Combo)
    count_q = select(func.count(Combo.id))

    if search:
        like = f"%{search}%"
        cond = or_(Combo.code.ilike(like), Combo.name.ilike(like), Combo.description.ilike(like))
        q = q.filter(cond)
        count_q = count_q.filter(cond)
    if status:
        q = q.filter(Combo.status == status)
        count_q = count_q.filter(Combo.status == status)

    total = (await db.execute(count_q)).scalar_one()
    combos = (await db.execute(window.apply(q.order_by(Combo.code)))).scalars().all()

    av_ids = [c.attribute_value_id for c in combos if c.attribute_value_id is not None]
    usage_map = await _usage_counts(db, av_ids)

    return window.envelope(
        [_serialize(c, usage_map.get(c.attribute_value_id, 0)) for c in combos], total
    )


@router.post("/combos", response_model=ComboResponse)
async def create_combo(
    payload: ComboCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('combo_library.create')),
):
    existing = await db.execute(select(Combo).filter(Combo.code == payload.code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Combo code already exists")

    combo = Combo(**payload.model_dump())
    db.add(combo)
    await db.flush()

    # Mirror: create + link a value of the `Combo` variant attribute so BOM/SO/sample
    # gating keeps resolving. The value label is the combo name.
    attr_id = await _combo_attribute_id(db)
    if attr_id is not None:
        av = AttributeValue(attribute_id=attr_id, value=payload.name)
        db.add(av)
        await db.flush()
        combo.attribute_value_id = av.id

    await db.commit()
    result = await db.execute(select(Combo).filter(Combo.id == combo.id))
    c = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "Combo", str(c.id),
        details=f"Created combo {c.code} - {c.name}", changes={}
    )
    await manager.broadcast({"type": "COMBO_UPDATE", "id": str(c.id)})
    return _serialize(c)


@router.put("/combos/{combo_id}", response_model=ComboResponse)
async def update_combo(
    combo_id: str,
    payload: ComboUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('combo_library.edit')),
):
    result = await db.execute(select(Combo).filter(Combo.id == combo_id))
    c = result.scalars().first()
    if not c:
        raise HTTPException(status_code=404, detail="Combo not found")

    if payload.code is not None and payload.code != c.code:
        dup = await db.execute(
            select(Combo).filter(Combo.code == payload.code, Combo.id != combo_id)
        )
        if dup.scalars().first():
            raise HTTPException(status_code=400, detail="Combo code already exists")

    data = payload.model_dump(exclude_unset=True)
    before = audit_service.fields_of(c, data)
    for field, val in data.items():
        setattr(c, field, val)

    # Keep the mirrored AttributeValue label in sync with the combo name.
    if "name" in data and c.attribute_value_id is not None:
        av = (await db.execute(
            select(AttributeValue).filter(AttributeValue.id == c.attribute_value_id)
        )).scalars().first()
        if av is not None:
            av.value = c.name

    await db.commit()
    result = await db.execute(select(Combo).filter(Combo.id == combo_id))
    c = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "UPDATE", "Combo", str(c.id),
        details=f"Updated combo {c.code}", changes=audit_service.diff(before, data)
    )
    await manager.broadcast({"type": "COMBO_UPDATE", "id": str(c.id)})
    return _serialize(c, await _usage_count(db, c.attribute_value_id))


@router.delete("/combos/{combo_id}")
async def delete_combo(
    combo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('combo_library.delete')),
):
    result = await db.execute(select(Combo).filter(Combo.id == combo_id))
    c = result.scalars().first()
    if not c:
        raise HTTPException(status_code=404, detail="Combo not found")

    # Hard delete (combo + its mirrored value) only if unused; else soft-archive so
    # in-flight BOMs/SOs/MOs that gate on the value keep resolving.
    refs = await _usage_count(db, c.attribute_value_id)
    av_id = c.attribute_value_id

    if refs > 0:
        c.status = "archived"
        action, detail = "ARCHIVE", f"Archived combo {c.code} (referenced by {refs} record(s))"
        await db.commit()
    else:
        action, detail = "DELETE", f"Deleted combo {c.code}"
        await db.delete(c)
        if av_id is not None:
            av = (await db.execute(
                select(AttributeValue).filter(AttributeValue.id == av_id)
            )).scalars().first()
            if av is not None:
                await db.delete(av)
        await db.commit()

    await audit_service.log_activity(
        db, str(current_user.id), action, "Combo", str(combo_id), details=detail, changes={}
    )
    await manager.broadcast({"type": "COMBO_UPDATE", "id": str(combo_id)})
    return {"status": "ok", "action": action.lower()}
