import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.db.session import get_async_db
from app.models.category import Category
from app.models.auth import User
from app.schemas import CategoryCreate, CategoryResponse
from app.api.auth import get_current_user, require_permission
from app.services import audit_service, kpi_service

router = APIRouter()

# Reusable eager-load options: parent (2 levels) + children (2 levels).
# The Category model has join_depth=2 on parent and selectin on children.
# In async we must explicitly request these with selectinload/joinedload.
_LOAD_OPTS = [
    selectinload(Category.children).selectinload(Category.children),
    selectinload(Category.parent).selectinload(Category.parent),
]


async def _get_or_404(db: AsyncSession, category_id: uuid.UUID) -> Category:
    result = await db.execute(
        select(Category).where(Category.id == category_id).options(*_LOAD_OPTS)
    )
    cat = result.scalars().first()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return cat


@router.get("/categories", response_model=list[CategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_async_db),
    _=Depends(get_current_user),
):
    # Fetch all categories with full parent chain and children loaded.
    result = await db.execute(
        select(Category).options(*_LOAD_OPTS).order_by(Category.name)
    )
    all_cats = result.scalars().unique().all()

    # Build flat depth-first list starting from roots.
    roots = [c for c in all_cats if c.parent_id is None]
    flat: list[Category] = []

    def collect(cats: list) -> None:
        for c in sorted(cats, key=lambda x: x.name):
            flat.append(c)
            collect(c.children)

    collect(roots)
    return flat


@router.post("/categories", response_model=CategoryResponse, status_code=201)
async def create_category(
    data: CategoryCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('category.create')),
):
    if data.parent_id:
        parent = await _get_or_404(db, data.parent_id)
        if parent.level >= 3:
            raise HTTPException(status_code=400, detail="Maximum category depth of 3 exceeded")
    cat = Category(name=data.name, parent_id=data.parent_id)
    db.add(cat)
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "CREATE", "Category", str(cat.id), details=f"Created category {cat.name}")
    await kpi_service.invalidate_and_broadcast(db, {"type": "MASTER_DATA_UPDATE", "domain": "categories"})
    # Re-fetch with relationships loaded so level/path_names work.
    return await _get_or_404(db, cat.id)


@router.patch("/categories/{category_id}", response_model=CategoryResponse)
async def rename_category(
    category_id: uuid.UUID,
    data: CategoryCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('category.edit')),
):
    cat = await _get_or_404(db, category_id)
    if cat.is_system:
        raise HTTPException(status_code=403, detail="Cannot rename a system category")
    old_name = cat.name
    cat.name = data.name
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "Category", str(cat.id), details=f"Renamed category {old_name} -> {data.name}")
    await kpi_service.invalidate_and_broadcast(db, {"type": "MASTER_DATA_UPDATE", "domain": "categories"})
    return await _get_or_404(db, cat.id)


@router.delete("/categories/{category_id}", status_code=204)
async def delete_category(
    category_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('category.delete')),
):
    cat = await _get_or_404(db, category_id)
    if cat.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete a system category")
    if cat.children:
        raise HTTPException(status_code=400, detail="Cannot delete a category that has subcategories")
    cat_id, cat_name = cat.id, cat.name
    await db.delete(cat)
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "DELETE", "Category", str(cat_id), details=f"Deleted category {cat_name}")
    await kpi_service.invalidate_and_broadcast(db, {"type": "MASTER_DATA_UPDATE", "domain": "categories"})
