from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import joinedload
from app.models.stock_ledger import StockLedger
from app.models.stock_balance import StockBalance
from app.models.attribute import AttributeValue
from fastapi import HTTPException

def _generate_variant_key(attribute_value_ids: list[str]) -> str:
    """Standardizes variant identification string."""
    return ",".join(sorted(str(uid) for uid in attribute_value_ids))

async def get_stock_balance(db: AsyncSession, item_id, location_id, attribute_value_ids: list[str] = [], batch_key: str = ""):
    """
    PRE-CALCULATED O(1) LOOKUP:
    Retrieves the exact balance from the summary table instead of summing the ledger.
    When batch_key is empty, returns the total across all batches for non-batch stock.
    """
    v_key = _generate_variant_key(attribute_value_ids)
    if batch_key:
        result = await db.execute(select(StockBalance).filter(
            StockBalance.item_id == item_id,
            StockBalance.location_id == location_id,
            StockBalance.variant_key == v_key,
            StockBalance.batch_key == batch_key
        ))
        balance = result.scalars().first()
        return float(balance.qty) if balance else 0.0
    else:
        # Sum all balances (batch and non-batch) for availability checks
        result = await db.execute(
            select(func.sum(StockBalance.qty)).filter(
                StockBalance.item_id == item_id,
                StockBalance.location_id == location_id,
                StockBalance.variant_key == v_key,
            )
        )
        total = result.scalar()
        return float(total) if total else 0.0

async def add_stock_entry(
    db: AsyncSession,
    item_id,
    location_id,
    qty_change,
    reference_type,
    reference_id,
    attribute_value_ids: list[str] = [],
    batch_id=None,
):
    batch_key = str(batch_id) if batch_id else ""

    # 1. Prevent Negative Stock (using pre-calculated balance)
    if qty_change < 0:
        current_balance = await get_stock_balance(db, item_id, location_id, attribute_value_ids, batch_key)
        if current_balance + qty_change < 0:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock. Current: {current_balance}, Required: {abs(qty_change)}"
            )

    # 2. Create the Ledger Entry
    entry = StockLedger(
        item_id=item_id,
        location_id=location_id,
        qty_change=qty_change,
        reference_type=reference_type,
        reference_id=reference_id,
        batch_id=batch_id,
    )

    if attribute_value_ids:
        result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(attribute_value_ids)))
        vals = result.scalars().all()
        entry.attribute_values = vals

    db.add(entry)

    # 3. ATOMIC SUMMARY UPDATE
    v_key = _generate_variant_key(attribute_value_ids)
    result = await db.execute(
        select(StockBalance)
        .filter(
            StockBalance.item_id == item_id,
            StockBalance.location_id == location_id,
            StockBalance.variant_key == v_key,
            StockBalance.batch_key == batch_key,
        )
        .with_for_update()
        .limit(1)
    )
    balance = result.scalars().first()

    if not balance:
        balance = StockBalance(
            item_id=item_id,
            location_id=location_id,
            variant_key=v_key,
            batch_key=batch_key,
            qty=qty_change
        )
        if attribute_value_ids:
            result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(attribute_value_ids)))
            vals = result.scalars().all()
            balance.attribute_values = vals
        db.add(balance)
    else:
        balance.qty = float(balance.qty) + float(qty_change)

    await db.commit()

async def get_stock_entries(db: AsyncSession, skip: int = 0, limit: int = 100) -> tuple[list[StockLedger], int]:
    # Count total
    count_result = await db.execute(select(func.count()).select_from(StockLedger))
    total = count_result.scalar()
    
    # Get items
    result = await db.execute(
        select(StockLedger)
        .order_by(StockLedger.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()
    return items, total

async def get_all_stock_balances(db: AsyncSession, user=None):
    from app.models.item import Item

    query = select(StockBalance)
    if user and user.allowed_categories:
        query = query.join(Item, StockBalance.item_id == Item.id).filter(Item.category.in_(user.allowed_categories))

    result = await db.execute(query.options(joinedload(StockBalance.attribute_values)))
    results = result.unique().scalars().all()

    return [
        {
            "item_id": r.item_id,
            "location_id": r.location_id,
            "attribute_value_ids": [v.id for v in r.attribute_values],
            "qty": float(r.qty),
            "batch_key": r.batch_key,
        }
        for r in results if r.qty != 0
    ]

async def get_batch_stock_balances(db: AsyncSession, requirements: list[dict]):
    results_map = {}
    if not requirements:
        return {}

    item_ids = set(req['item_id'] for req in requirements)
    result = await db.execute(select(StockBalance).filter(StockBalance.item_id.in_(item_ids)))
    balances = result.scalars().all()

    for b in balances:
        key = (str(b.item_id), str(b.location_id), b.variant_key)
        results_map[key] = float(b.qty)
            
    return results_map
