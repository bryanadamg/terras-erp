"""Colour library writes shared by the colours router and the legacy loader."""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.attribute import Attribute, AttributeValue
from app.models.color import Color


async def create_color(db: AsyncSession, **fields) -> Color:
    """Insert a Color and mirror it onto the `Color Code` (labdip_color) attribute,
    so the LabDip colour dropdown keeps resolving it. Flushes; the caller commits."""
    color = Color(**fields)
    db.add(color)
    await db.flush()
    attr_id = (await db.execute(
        select(Attribute.id).filter(Attribute.system_role == "labdip_color")
    )).scalars().first()
    if attr_id is not None:
        av = AttributeValue(attribute_id=attr_id, value=fields["name"])
        db.add(av)
        await db.flush()
        color.attribute_value_id = av.id
    return color
