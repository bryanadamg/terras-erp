import csv
import io
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.item import Item
from app.models.uom import UOM
from app.models.category import Category
from app.services import audit_service

async def import_items_csv(db: AsyncSession, file_content: bytes, user_id=None):
    """
    Parses a CSV file and bulk creates items.
    Expected Header: Code, Name, UOM, Category

    Each row runs in its own SAVEPOINT so one bad row can't poison the rest of
    the batch, while a single commit at the end keeps the whole import durable
    in one transaction (a mid-import crash leaves nothing committed).
    """
    stream = io.StringIO(file_content.decode("utf-8"))
    reader = csv.DictReader(stream)

    results = {"success": 0, "errors": []}
    imported_codes = []

    for row_num, row in enumerate(reader, start=1):
        code = (row.get("Code") or "").strip()
        name = (row.get("Name") or "").strip()
        uom_name = (row.get("UOM") or "").strip()
        cat_name = (row.get("Category") or "").strip()

        if not code or not name or not uom_name:
            results["errors"].append(f"Row {row_num}: Missing required fields (Code, Name, UOM)")
            continue

        try:
            async with db.begin_nested():
                existing = await db.execute(select(Item.id).filter(Item.code == code))
                if existing.scalars().first():
                    raise ValueError(f"Item code '{code}' already exists")

                # Check/Create UOM — auto-create for import UX convenience.
                uom_result = await db.execute(select(UOM).filter(UOM.name == uom_name))
                uom = uom_result.scalars().first()
                if not uom:
                    uom = UOM(name=uom_name)
                    db.add(uom)
                    await db.flush()

                # Check/Create Category
                category = None
                if cat_name:
                    cat_result = await db.execute(select(Category).filter(Category.name == cat_name))
                    category = cat_result.scalars().first()
                    if not category:
                        category = Category(name=cat_name)
                        db.add(category)
                        await db.flush()

                item = Item(
                    code=code,
                    name=name,
                    uom=uom_name,
                    category_id=category.id if category else None,
                )
                db.add(item)
                await db.flush()

            results["success"] += 1
            imported_codes.append(code)
        except Exception as e:
            results["errors"].append(f"Row {row_num}: {e}")

    await db.commit()

    if user_id is not None and (results["success"] or results["errors"]):
        await audit_service.log_activity(
            db, user_id, "IMPORT", "Item", "bulk",
            details=(
                f"Imported {results['success']} item(s) via CSV"
                + (f", {len(results['errors'])} error(s)" if results["errors"] else "")
            ),
            changes=audit_service.added({"codes": imported_codes}) if imported_codes else None,
        )

    return results
