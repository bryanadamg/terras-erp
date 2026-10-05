import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.db.session import get_async_db
from app.models.color import Color
from app.models.attribute import Attribute, AttributeValue
from app.models.dyeing_setting import DyeRecipe
from app.models.lab_dip import LabDipRequest, LabDipLine, LabDipItem
from app.models.item import Item
from app.models.auth import User
from app.api.auth import get_current_user, require_permission
from app.services import audit_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from app.schemas import (
    ColorCreate, ColorUpdate, ColorResponse, ColorListResponse,
    AttributeValueCreate, AttributeValueUpdate, AttributeValueResponse,
)

router = APIRouter()


async def _color_code_attribute_id(db: AsyncSession) -> uuid.UUID | None:
    """Return the id of the seeded `Color Code` system attribute (system_role='labdip_color').
    This is the legacy color-code list the LabDip dropdown reads; mirroring keeps it
    working during the transition to the Color library. The variant `Colors` attribute
    (system_role='color') is deliberately left untouched to avoid polluting product
    variants / recipe-matching with reference-library codes."""
    result = await db.execute(
        select(Attribute.id).filter(Attribute.system_role == "labdip_color")
    )
    return result.scalars().first()


async def _recipe_counts(db: AsyncSession, color_ids: list[uuid.UUID]) -> dict:
    if not color_ids:
        return {}
    result = await db.execute(
        select(DyeRecipe.color_id, func.count(DyeRecipe.id))
        .filter(DyeRecipe.color_id.in_(color_ids))
        .group_by(DyeRecipe.color_id)
    )
    return {row[0]: row[1] for row in result.all()}


async def _lab_dip_provenance(db: AsyncSession, color_ids: list[uuid.UUID]) -> dict:
    """Map color_id → (request_id, request_code, item_name, item_code) of the LabDip it came
    from. Two paths: approval-minted (LabDipItem.approved_color_id) takes priority; manual
    "+ Color" spawns (Color.source_lab_dip_line_id → line → request) fill the rest. The
    approval-minted path also carries the FG item the shade was approved for."""
    if not color_ids:
        return {}
    prov: dict = {}
    # Fallback path first so the priority path overwrites it.
    line_rows = (await db.execute(
        select(Color.id, LabDipRequest.id, LabDipRequest.code)
        .join(LabDipLine, Color.source_lab_dip_line_id == LabDipLine.id)
        .join(LabDipRequest, LabDipLine.lab_dip_request_id == LabDipRequest.id)
        .filter(Color.id.in_(color_ids))
    )).all()
    for cid, rid, code in line_rows:
        prov[cid] = (rid, code, None, None)
    # Priority path: the variant approval that minted the shade.
    item_rows = (await db.execute(
        select(LabDipItem.approved_color_id, LabDipRequest.id, LabDipRequest.code, Item.name, Item.code)
        .join(LabDipRequest, LabDipItem.lab_dip_request_id == LabDipRequest.id)
        .join(Item, LabDipItem.item_id == Item.id)
        .filter(LabDipItem.approved_color_id.in_(color_ids))
    )).all()
    for cid, rid, code, item_name, item_code in item_rows:
        prov[cid] = (rid, code, item_name, item_code)
    return prov


def _serialize(c: Color, recipe_count: int = 0, provenance: tuple | None = None) -> dict:
    d = {col.name: getattr(c, col.name) for col in c.__table__.columns}
    d["customer_name"] = c.customer.name if c.customer else None
    d["variant_attribute_value_label"] = c.variant_attribute_value.value if c.variant_attribute_value else None
    d["recipe_count"] = recipe_count
    d["source_lab_dip_request_id"] = provenance[0] if provenance else None
    d["source_lab_dip_code"] = provenance[1] if provenance else None
    d["source_item_name"] = provenance[2] if provenance else None
    d["source_item_code"] = provenance[3] if provenance else None
    return d


@router.get("/colors", response_model=ColorListResponse)
async def list_colors(
    search: str | None = Query(None),
    status: str | None = Query(None),
    customer_id: str | None = Query(None),
    variant_attribute_value_id: str | None = Query(None),
    item_search: str | None = Query(None),
    source: str | None = Query(None),
    include_meta: bool = Query(False),
    window: PageWindow = Depends(PageParams()),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    q = select(Color).options(joinedload(Color.customer), joinedload(Color.variant_attribute_value))
    count_q = select(func.count(Color.id))

    if search:
        like = f"%{search}%"
        cond = or_(
            Color.code.ilike(like),
            Color.name.ilike(like),
            Color.pantone_ref.ilike(like),
            Color.customer_color_code.ilike(like),
        )
        q = q.filter(cond)
        count_q = count_q.filter(cond)
    if status:
        q = q.filter(Color.status == status)
        count_q = count_q.filter(Color.status == status)
    if customer_id:
        q = q.filter(Color.customer_id == customer_id)
        count_q = count_q.filter(Color.customer_id == customer_id)
    if variant_attribute_value_id:
        q = q.filter(Color.variant_attribute_value_id == variant_attribute_value_id)
        count_q = count_q.filter(Color.variant_attribute_value_id == variant_attribute_value_id)
    if item_search:
        item_like = f"%{item_search}%"
        # "Item" is provenance-derived (the FG variant a shade was approved for via
        # LabDipItem.approved_color_id), not a direct FK on Color — see _lab_dip_provenance.
        matching_color_ids = select(LabDipItem.approved_color_id).join(
            Item, LabDipItem.item_id == Item.id
        ).filter(
            LabDipItem.approved_color_id.isnot(None),
            or_(Item.name.ilike(item_like), Item.code.ilike(item_like)),
        )
        q = q.filter(Color.id.in_(matching_color_ids))
        count_q = count_q.filter(Color.id.in_(matching_color_ids))
    if source:
        # Which lab dip book a shade came from. Like `item_search`, this is
        # provenance-derived rather than a column on Color, so it can never drift
        # from the lab dip data — the two paths mirror _lab_dip_provenance:
        # approval-minted (LabDipItem.approved_color_id) and manual "+ Color"
        # spawns (Color.source_lab_dip_line_id). MANUAL = neither path matches,
        # i.e. a shade entered straight into the library.
        src = source.upper()
        approved_ids = (
            select(LabDipItem.approved_color_id)
            .join(LabDipRequest, LabDipItem.lab_dip_request_id == LabDipRequest.id)
            .filter(LabDipItem.approved_color_id.isnot(None))
        )
        spawned_ids = (
            select(Color.id)
            .join(LabDipLine, Color.source_lab_dip_line_id == LabDipLine.id)
            .join(LabDipRequest, LabDipLine.lab_dip_request_id == LabDipRequest.id)
        )
        if src == "MANUAL":
            cond = Color.id.notin_(approved_ids) & Color.id.notin_(spawned_ids)
        elif src in ("FG", "YARN"):
            cond = Color.id.in_(approved_ids.filter(LabDipRequest.kind == src)) | Color.id.in_(
                spawned_ids.filter(LabDipRequest.kind == src)
            )
        else:
            raise HTTPException(status_code=400, detail="source must be FG, YARN or MANUAL")
        q = q.filter(cond)
        count_q = count_q.filter(cond)

    total = (await db.execute(count_q)).scalar_one()
    colors = (await db.execute(window.apply(q.order_by(Color.code)))).scalars().all()

    counts: dict = {}
    prov: dict = {}
    if include_meta:
        color_ids = [c.id for c in colors]
        counts = await _recipe_counts(db, color_ids)
        prov = await _lab_dip_provenance(db, color_ids)
    return window.envelope(
        [_serialize(c, counts.get(c.id, 0), prov.get(c.id)) for c in colors], total
    )



@router.post("/colors", response_model=ColorResponse)
async def create_color(
    payload: ColorCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_code.create')),
):
    existing = await db.execute(select(Color).filter(Color.code == payload.code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Color code already exists")

    color = Color(**payload.model_dump())
    db.add(color)
    await db.flush()

    # Option-A mirror: create + link a `Color Code` (labdip_color) AttributeValue so the
    # legacy LabDip color dropdown keeps resolving during the transition to the library.
    attr_id = await _color_code_attribute_id(db)
    if attr_id is not None:
        av = AttributeValue(attribute_id=attr_id, value=payload.name)
        db.add(av)
        await db.flush()
        color.attribute_value_id = av.id

    # Spawned from an approved LabDip dip line: back-link the dip to this new shade
    # (hides the "+ Color" button) and, if the request has an approved recipe with no
    # color yet, wire that recipe to this shade. Same transaction.
    if payload.source_lab_dip_line_id:
        dip = (await db.execute(
            select(LabDipLine).filter(LabDipLine.id == payload.source_lab_dip_line_id)
        )).scalars().first()
        if dip:
            dip.color_id = color.id
            req = (await db.execute(
                select(LabDipRequest).filter(LabDipRequest.id == dip.lab_dip_request_id)
            )).scalars().first()
            if req and req.approved_recipe_id:
                recipe = (await db.execute(
                    select(DyeRecipe).filter(DyeRecipe.id == req.approved_recipe_id)
                )).scalars().first()
                if recipe and recipe.color_id is None:
                    recipe.color_id = color.id

    await db.commit()
    result = await db.execute(
        select(Color).options(joinedload(Color.customer), joinedload(Color.variant_attribute_value)).filter(Color.id == color.id)
    )
    c = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "Color", str(c.id),
        details=f"Created color {c.code} - {c.name}", changes={}
    )
    await manager.broadcast({"type": "COLOR_UPDATE", "id": str(c.id)})
    return _serialize(c)


@router.put("/colors/{color_id}", response_model=ColorResponse)
async def update_color(
    color_id: str,
    payload: ColorUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_code.edit')),
):
    result = await db.execute(
        select(Color).options(joinedload(Color.attribute_value)).filter(Color.id == color_id)
    )
    c = result.scalars().first()
    if not c:
        raise HTTPException(status_code=404, detail="Color not found")

    if payload.code is not None and payload.code != c.code:
        dup = await db.execute(
            select(Color).filter(Color.code == payload.code, Color.id != color_id)
        )
        if dup.scalars().first():
            raise HTTPException(status_code=400, detail="Color code already exists")

    data = payload.model_dump(exclude_unset=True)
    before = audit_service.fields_of(c, data)
    for field, val in data.items():
        setattr(c, field, val)

    # Keep the mirrored AttributeValue label in sync with the color name.
    if "name" in data and c.attribute_value is not None:
        c.attribute_value.value = c.name

    await db.commit()
    result = await db.execute(
        select(Color).options(joinedload(Color.customer), joinedload(Color.variant_attribute_value)).filter(Color.id == color_id)
    )
    c = result.scalars().first()
    counts = await _recipe_counts(db, [c.id])
    await audit_service.log_activity(
        db, str(current_user.id), "UPDATE", "Color", str(c.id),
        details=f"Updated color {c.code}", changes=audit_service.diff(before, data)
    )
    await manager.broadcast({"type": "COLOR_UPDATE", "id": str(c.id)})
    return _serialize(c, counts.get(c.id, 0))


@router.delete("/colors/{color_id}")
async def delete_color(
    color_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_code.archive')),
):
    result = await db.execute(select(Color).filter(Color.id == color_id))
    c = result.scalars().first()
    if not c:
        raise HTTPException(status_code=404, detail="Color not found")

    # Hard delete only if no references exist; otherwise soft-archive.
    refs = 0
    for model, fk in ((DyeRecipe, DyeRecipe.color_id), (LabDipRequest, LabDipRequest.color_id), (LabDipLine, LabDipLine.color_id)):
        n = (await db.execute(select(func.count()).select_from(model).filter(fk == color_id))).scalar_one()
        refs += n

    if refs > 0:
        c.status = "archived"
        action, detail = "ARCHIVE", f"Archived color {c.code} (referenced by {refs} record(s))"
        await db.commit()
    else:
        action, detail = "DELETE", f"Deleted color {c.code}"
        await db.delete(c)
        await db.commit()

    await audit_service.log_activity(
        db, str(current_user.id), action, "Color", str(color_id), details=detail, changes={}
    )
    await manager.broadcast({"type": "COLOR_UPDATE", "id": str(color_id)})
    return {"status": "ok", "action": action.lower()}


# ─────────────────────────────────────────────────────────────────────────────
# Colors (variant) — values of the `Colors` system attribute (system_role='color')
#
# These exist so `color_variant.*` is a real grant. The Colors-variant tab used to
# post straight at `/attributes/{id}/values`, which is gated on `attribute.create`
# — so a role ticked Color Variant Create saw an enabled button and got
# "Missing permission: attribute.create" on submit, and the only way to unblock it
# was plant-wide attribute power (Materials, Combo, Wash Bath, every value list).
#
# Every write here is scoped to the `color` attribute by `_load_variant_value`, so
# the reverse leak doesn't open either: `color_variant.edit` cannot touch any other
# attribute's values. Aliasing `color_variant.*` onto the generic attribute
# endpoints would have been one line and exactly that leak.
# ─────────────────────────────────────────────────────────────────────────────

async def _color_variant_attribute_id(db: AsyncSession) -> uuid.UUID | None:
    """Id of the seeded `Colors` variant attribute (system_role='color') — the small
    curated product-color list that BOM gating, dye-recipe matching and stock
    variant_key read. NOT the ~30k `Color Code` library (system_role='labdip_color')."""
    result = await db.execute(
        select(Attribute.id).filter(Attribute.system_role == "color")
    )
    return result.scalars().first()


async def _load_variant_value(db: AsyncSession, value_id: str) -> AttributeValue:
    """Fetch one variant value, 404ing anything that is not a value of the `Colors`
    attribute. This is what keeps `color_variant.*` from being a generic
    attribute-value grant."""
    attr_id = await _color_variant_attribute_id(db)
    if attr_id is None:
        raise HTTPException(status_code=404, detail="Colors variant attribute not found")
    val = (await db.execute(
        select(AttributeValue).filter(
            AttributeValue.id == value_id,
            AttributeValue.attribute_id == attr_id,
        )
    )).scalars().first()
    if not val:
        raise HTTPException(status_code=404, detail="Color variant not found")
    return val


@router.post("/colors/variant-values", response_model=AttributeValueResponse)
async def create_color_variant(
    payload: AttributeValueCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_variant.create')),
):
    attr_id = await _color_variant_attribute_id(db)
    if attr_id is None:
        raise HTTPException(status_code=404, detail="Colors variant attribute not found")

    value = (payload.value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Color name is required")

    # Case-insensitive dup guard: variant_key matching is by label, so two rows
    # differing only in case are two variants the floor reads as one.
    dup = (await db.execute(
        select(AttributeValue).filter(
            AttributeValue.attribute_id == attr_id,
            func.lower(AttributeValue.value) == value.lower(),
        )
    )).scalars().first()
    if dup:
        raise HTTPException(status_code=400, detail=f"Color variant '{dup.value}' already exists")

    av = AttributeValue(attribute_id=attr_id, value=value, hex=payload.hex)
    db.add(av)
    await db.commit()
    await db.refresh(av)

    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "AttributeValue", str(av.id),
        details=f"Added color variant '{av.value}'", changes=audit_service.added({"value": av.value, "hex": av.hex})
    )
    return av


@router.put("/colors/variant-values/{value_id}", response_model=AttributeValueResponse)
async def update_color_variant(
    value_id: str,
    payload: AttributeValueUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_variant.edit')),
):
    val = await _load_variant_value(db, value_id)

    value = (payload.value or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="Color name is required")

    if value.lower() != val.value.lower():
        dup = (await db.execute(
            select(AttributeValue).filter(
                AttributeValue.attribute_id == val.attribute_id,
                AttributeValue.id != val.id,
                func.lower(AttributeValue.value) == value.lower(),
            )
        )).scalars().first()
        if dup:
            raise HTTPException(status_code=400, detail=f"Color variant '{dup.value}' already exists")

    old_value, old_hex = val.value, val.hex
    val.value = value
    val.hex = payload.hex
    await db.commit()
    await db.refresh(val)

    await audit_service.log_activity(
        db, str(current_user.id), "UPDATE", "AttributeValue", str(val.id),
        details=f"Renamed color variant '{old_value}' -> '{val.value}'",
        changes={"value": [old_value, val.value], "hex": [old_hex, val.hex]}
    )
    return val


@router.delete("/colors/variant-values/{value_id}")
async def delete_color_variant(
    value_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('color_variant.delete')),
):
    val = await _load_variant_value(db, value_id)
    label = val.value

    try:
        await db.delete(val)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete color variant '{label}': it is still used by existing items "
                   f"or transaction records (stock, orders, BOMs, etc). Remove those references first.",
        )

    await audit_service.log_activity(
        db, str(current_user.id), "DELETE", "AttributeValue", value_id,
        details=f"Deleted color variant '{label}'", changes={}
    )
    return {"status": "success", "message": "Color variant deleted"}
