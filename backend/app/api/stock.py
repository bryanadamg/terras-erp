from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_async_db
from app.services import stock_service, audit_service
from app.schemas import StockLedgerResponse, StockBalanceResponse, PaginatedStockLedgerResponse, StockEntryCreate
from app.models.auth import User
from app.api.auth import get_current_user
from app.models.item import Item
from app.models.location import Location
from datetime import datetime
from typing import Optional

router = APIRouter()

@router.get("/stock", response_model=PaginatedStockLedgerResponse)
async def get_stock_ledger(
    skip: int = 0, 
    limit: int = 100, 
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    from app.models.stock_ledger import StockLedger
    query = select(StockLedger)
    
    if start_date:
        query = query.filter(StockLedger.created_at >= start_date)
    if end_date:
        query = query.filter(StockLedger.created_at <= end_date)
        
    if current_user.allowed_categories:
        query = query.join(Item, StockLedger.item_id == Item.id).filter(Item.category.in_(current_user.allowed_categories))
        
    # Count total
    count_result = await db.execute(select(func.count()).select_from(query.subquery()))
    total = count_result.scalar()
    
    # Get items
    result = await db.execute(
        query.order_by(StockLedger.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()
    
    return {
        "items": items,
        "total": total,
        "page": (skip // limit) + 1,
        "size": len(items)
    }

@router.post("/stock", status_code=201)
async def create_stock_entry(
    payload: StockEntryCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    item_result = await db.execute(select(Item).filter(Item.code == payload.item_code))
    item = item_result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Item '{payload.item_code}' not found")

    loc_result = await db.execute(select(Location).filter(Location.code == payload.location_code))
    location = loc_result.scalars().first()
    if not location:
        raise HTTPException(status_code=404, detail=f"Location '{payload.location_code}' not found")

    attribute_value_ids = [str(uid) for uid in payload.attribute_value_ids]
    await stock_service.add_stock_entry(
        db=db,
        item_id=item.id,
        location_id=location.id,
        qty_change=payload.qty,
        reference_type=payload.reference_type,
        reference_id=payload.reference_id,
        attribute_value_ids=attribute_value_ids,
    )

    await audit_service.log_activity(
        db=db,
        user_id=current_user.id,
        action="create",
        entity_type="stock_entry",
        entity_id=str(item.id),
        changes={"item": payload.item_code, "location": payload.location_code, "qty": payload.qty},
    )

    return {"status": "success", "message": "Stock entry recorded"}


@router.get("/stock/balance", response_model=list[StockBalanceResponse])
async def get_stock_balance_api(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    return await stock_service.get_all_stock_balances(db, user=current_user)
