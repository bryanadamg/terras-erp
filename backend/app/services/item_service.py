from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import joinedload, selectinload
from app.models.item import Item
from app.models.variant import Variant
from app.schemas import VariantCreate
from app.models.attribute import Attribute


def _source_opts():
    return [joinedload(Item.source_sample), joinedload(Item.source_color)]


async def create_item(
    db: AsyncSession,
    code: str,
    name: str,
    uom: str,
    category: str | None = None,
    source_sample_id: str | None = None,
    source_color_id: str | None = None,
    attribute_ids: list[str] = []
) -> Item:
    item = Item(
        code=code,
        name=name,
        uom=uom,
        category=category,
        source_sample_id=source_sample_id,
        source_color_id=source_color_id,
    )

    if attribute_ids:
        result = await db.execute(select(Attribute).filter(Attribute.id.in_(attribute_ids)))
        attrs = result.scalars().all()
        item.attributes = attrs

    db.add(item)
    await db.commit()

    result = await db.execute(
        select(Item)
        .options(selectinload(Item.attributes), *_source_opts())
        .filter(Item.id == item.id)
    )
    return result.scalars().first()


async def update_item(
    db: AsyncSession,
    item_id: str,
    data: dict
) -> Item | None:
    result = await db.execute(
        select(Item)
        .options(selectinload(Item.attributes), *_source_opts())
        .filter(Item.id == item_id)
    )
    item = result.scalars().first()
    if not item:
        return None

    attribute_ids = data.pop("attribute_ids", None)

    for key, value in data.items():
        if value is not None:
            setattr(item, key, value)

    if attribute_ids is not None:
        result = await db.execute(select(Attribute).filter(Attribute.id.in_(attribute_ids)))
        attrs = result.scalars().all()
        item.attributes = attrs

    await db.commit()

    result = await db.execute(
        select(Item)
        .options(selectinload(Item.attributes), *_source_opts())
        .filter(Item.id == item.id)
    )
    return result.scalars().first()


async def get_item_by_code(db: AsyncSession, code: str) -> Item | None:
    result = await db.execute(
        select(Item)
        .options(selectinload(Item.attributes), *_source_opts())
        .filter(Item.code == code)
    )
    return result.scalars().first()


async def get_items(db: AsyncSession, skip: int = 0, limit: int = 100, user=None, search: str = None, category: str = None) -> tuple[list[Item], int]:
    query = select(Item)

    if search:
        search_filter = f"%{search}%"
        query = query.filter(
            or_(
                Item.code.ilike(search_filter),
                Item.name.ilike(search_filter)
            )
        )

    if category:
        query = query.filter(Item.category == category)

    if user and user.allowed_categories:
        query = query.filter(Item.category.in_(user.allowed_categories))

    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    query = query.options(selectinload(Item.attributes), *_source_opts()).offset(skip).limit(limit)
    result = await db.execute(query)
    items = result.unique().scalars().all()

    return items, total
