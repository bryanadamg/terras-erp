import uuid
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from asyncpg.exceptions import ForeignKeyViolationError
from app.db.session import get_async_db
from app.services import item_service, stock_service, import_service, audit_service
from app.schemas import ItemCreate, ItemResponse, StockEntryCreate, ItemUpdate, VariantCreate, PaginatedItemResponse
from app.models.location import Location
from app.models.category import Category
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, category_scope_ok
from sqlalchemy import select
from app.core.pagination import PageParams, PageWindow
from app.core.ws_manager import manager
from app.services import kpi_service

router = APIRouter()


@router.get("/items/lookup")
async def get_items_lookup(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    """Lightweight id/code/name/uom/lot_tracked/variant_type/attribute_ids/category list of ALL items.

    Declared BEFORE any dynamic GET /items/{item_id} route so 'lookup' is not
    captured as an item_id path param. Columns only — no eager loads, no pagination.

    `attribute_ids` comes from a second flat SELECT over the item_attributes
    association table (grouped in Python), not an ORM eager load — the BOM
    designer resolves its variant dropdowns (Colors/Combo) from this index, and
    the paginated /items page it used to read only covers the first 50 items.

    `category_path` is built the same way (flat SELECT over categories, walked in
    Python) rather than via Category.path_names, which needs the loaded `parent`
    chain. Consumers classify items by category for off-page rows — goods receipt
    decides whether a PO line gets a Cones or Drums input from it.
    """
    from app.models.item import Item, item_attributes
    result = await db.execute(
        select(Item.id, Item.code, Item.name, Item.uom, Item.lot_tracked, Item.ends,
               Item.variant_type, Item.category_id)
    )
    attr_rows = await db.execute(select(item_attributes.c.item_id, item_attributes.c.attribute_id))
    attrs_by_item: dict[str, list[str]] = {}
    for item_id, attribute_id in attr_rows.all():
        attrs_by_item.setdefault(str(item_id), []).append(str(attribute_id))

    cat_rows = await db.execute(select(Category.id, Category.name, Category.parent_id))
    cats = {str(c.id): (c.name, str(c.parent_id) if c.parent_id else None) for c in cat_rows.all()}
    path_cache: dict[str, list[str]] = {}

    def cat_path(cat_id: str | None) -> list[str]:
        if not cat_id or cat_id not in cats:
            return []
        if cat_id in path_cache:
            return path_cache[cat_id]
        names: list[str] = []
        cur, seen = cat_id, set()
        while cur and cur in cats and cur not in seen:  # seen guards a cyclic parent chain
            seen.add(cur)
            name, parent = cats[cur]
            names.append(name)
            cur = parent
        path = list(reversed(names))
        path_cache[cat_id] = path
        return path

    return [
        {
            "id": str(row.id), "name": row.name, "code": row.code, "uom": row.uom,
            "lot_tracked": row.lot_tracked, "ends": row.ends,
            "variant_type": row.variant_type,
            "attribute_ids": attrs_by_item.get(str(row.id), []),
            "category_id": str(row.category_id) if row.category_id else None,
            "category_path": cat_path(str(row.category_id) if row.category_id else None),
        }
        for row in result.all()
    ]


def _populate_source_info(item) -> None:
    item.attribute_ids = [a.id for a in item.attributes]
    item.source_sample_code = item.source_sample.code if item.source_sample else None
    item.source_color_name = item.source_color.name if item.source_color else None
    item.category_path = item.category.path_names if item.category else []
    item.packaging_factor_ids = [f.id for f in item.packaging_factors]


@router.post("/items", response_model=ItemResponse)
async def create_item_api(payload: ItemCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('item.create'))):
    db_item = await item_service.get_item_by_code(db, code=payload.code)
    if db_item:
        raise HTTPException(status_code=400, detail="Item already exists")

    if not category_scope_ok(current_user, payload.category_id):
        raise HTTPException(status_code=403, detail="Not authorized for this category")

    item = await item_service.create_item(
        db,
        code=payload.code,
        name=payload.name,
        uom=payload.uom,
        category_id=payload.category_id,
        source_sample_id=payload.source_sample_id,
        source_color_id=payload.source_color_id,
        attribute_ids=payload.attribute_ids,
        variant_type=payload.variant_type,
        weight_per_unit=payload.weight_per_unit,
        weight_unit=payload.weight_unit,
        packaging_factor_ids=[str(fid) for fid in payload.packaging_factor_ids],
        ends=payload.ends,
        lot_tracked=payload.lot_tracked,
        is_decoupling_point=payload.is_decoupling_point,
        min_stock_level=payload.min_stock_level,
        default_source_location_id=payload.default_source_location_id,
        default_putaway_location_id=payload.default_putaway_location_id,
        default_reject_location_id=payload.default_reject_location_id,
    )

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="Item",
        entity_id=str(item.id),
        details=f"Created item {item.code} ({item.name})",
        changes=payload.model_dump()
    )

    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    _populate_source_info(item)
    return item

@router.get("/items", response_model=PaginatedItemResponse)
async def get_items_api(
    search: str | None = None,
    category_id: uuid.UUID | None = None,
    finished_goods: bool = False,
    raw_materials: bool = False,
    purchasable: bool = False,
    # max_size well above the primitive's 500 default: this endpoint was previously
    # uncapped, and DyeRecipeTab pulls its chemical picker in one shot with
    # `?limit=2000`. A 500 clamp would silently drop items from that picker rather
    # than paginate it — truncation here is a correctness bug, not a page-size tweak.
    window: PageWindow = Depends(PageParams(default_size=100, max_size=2000)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    # `finished_goods=true` / `raw_materials=true` scope the search to that seeded system
    # category's subtree server-side, so large catalogs stay a typeahead instead of a
    # client-side fetch-all. An explicit category_id always wins over either flag.
    scope_name = "Finished Goods" if finished_goods else ("Raw Material" if raw_materials else None)
    if scope_name and category_id is None:
        scoped = await db.execute(
            select(Category).filter(Category.name == scope_name).order_by(Category.parent_id.nulls_first())
        )
        scope_cat = scoped.scalars().first()
        if scope_cat is None:
            return window.envelope([], 0)
        category_id = scope_cat.id

    category_ids = None
    if purchasable and category_id is None:
        # PO lines can be Raw Material, Chemical, or Dye — three sibling root
        # categories, so this unions all three rather than picking one subtree.
        scoped = await db.execute(
            select(Category).filter(Category.name.in_(["Raw Material", "Chemical", "Dye"]))
        )
        scope_cats = scoped.scalars().all()
        if not scope_cats:
            return window.envelope([], 0)
        category_ids = [c.id for c in scope_cats]

    items, total = await item_service.get_items(db, skip=window.offset, limit=window.limit, user=current_user, search=search, category_id=category_id, category_ids=category_ids)
    for item in items:
        _populate_source_info(item)

    return window.envelope(items, total)

@router.put("/items/{item_id}", response_model=ItemResponse)
async def update_item_api(item_id: str, payload: ItemUpdate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('item.edit'))):
    from app.models.item import Item as _Item
    existing = (await db.execute(select(_Item.category_id).filter(_Item.id == item_id))).first()
    if existing and not category_scope_ok(current_user, existing[0]):
        raise HTTPException(status_code=403, detail="Not authorized for this category")

    item = await item_service.update_item(db, item_id, payload.model_dump(exclude_unset=True))
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    _populate_source_info(item)

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="Item",
        entity_id=item_id,
        details=f"Updated item {item.code}",
        changes=payload.model_dump(exclude_unset=True)
    )
    
    return item

@router.post("/items/stock")
async def add_stock_api(payload: StockEntryCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('stock_on_hand.create'))):
    # Resolve Item
    item = await item_service.get_item_by_code(db, payload.item_code)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    # Resolve Location
    result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")

    # Validate Attribute Values if provided
    if payload.attribute_value_ids:
        from app.models.attribute import AttributeValue
        valid_attr_ids = [a.id for a in item.attributes]
        
        for val_id in payload.attribute_value_ids:
            result = await db.execute(select(AttributeValue).filter(AttributeValue.id == val_id))
            val = result.scalars().first()
            if not val or val.attribute_id not in valid_attr_ids:
                 raise HTTPException(status_code=400, detail=f"Invalid attribute value {val_id} for this item")

    await stock_service.add_stock_entry(
        db,
        item_id=item.id,
        location_id=location.id,
        attribute_value_ids=[str(vid) for vid in payload.attribute_value_ids],
        qty_change=payload.qty,
        reference_type="manual",
        reference_id="manual_entry",
        cones_change=payload.qty_cones or 0,
        boxes_change=payload.qty_boxes or 0,
        drums_change=payload.qty_drums or 0,
    )
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="StockEntry",
        entity_id=item.code, 
        details=f"Manual stock adjustment: {payload.qty} for {item.code} at {location.name}",
        changes=payload.model_dump()
    )

    await manager.broadcast({"type": "STOCK_UPDATE"})
    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": "Stock recorded"}

@router.post("/items/import")
async def import_items(file: UploadFile = File(...), db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('item.import'))):
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a CSV.")
    
    content = await file.read()
    results = await import_service.import_items_csv(db, content, user_id=current_user.id)
    
    if results["errors"]:
        return {"status": "partial_success", "imported": results["success"], "errors": results["errors"]}
    
    return {"status": "success", "imported": results["success"]}

@router.delete("/items/{item_id}")
async def delete_item(item_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('item.delete'))):
    from app.models.item import Item
    result = await db.execute(select(Item).filter(Item.id == item_id))
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not category_scope_ok(current_user, item.category_id):
        raise HTTPException(status_code=403, detail="Not authorized for this category")

    item_code = item.code
    item_name = item.name
    details = f"Deleted item {item_code} ({item_name})"

    try:
        await db.delete(item)
        await db.commit()
    except (IntegrityError, ForeignKeyViolationError):
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete item {item_code} because it is still referenced by a BOM or other record."
        )
    
    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="Item",
        entity_id=item_id,
        details=details
    )

    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": "Item deleted"}
