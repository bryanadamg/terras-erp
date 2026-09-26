from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func
from app.models.kpi import KPICache, KPIHistory
from app.models.item import Item
from app.models.manufacturing import ManufacturingOrder as WorkOrder
from app.models.stock_balance import StockBalance
from app.models.sales import SalesOrder
from app.models.sample import SampleRequest
from datetime import datetime, timedelta, timezone

def update_kpi(db: Session, key: str, value: float):
    cached = db.query(KPICache).filter(KPICache.key == key).first()
    if cached:
        cached.value = value
        cached.updated_at = datetime.now(timezone.utc)
    else:
        db.add(KPICache(key=key, value=value))
    db.commit()

def refresh_all_kpis(db: Session):
    """Calculates all KPIs and updates the cache."""
    # 1. Total Items (Global)
    total_items = db.query(Item).count()
    update_kpi(db, "total_items", float(total_items))

    # 2. Active Work Orders
    active_wo = db.query(WorkOrder).filter(WorkOrder.status == "IN_PROGRESS").count()
    update_kpi(db, "active_wo", float(active_wo))

    # 3. Pending Work Orders
    pending_wo = db.query(WorkOrder).filter(WorkOrder.status == "PENDING").count()
    update_kpi(db, "pending_wo", float(pending_wo))

    # 4. Low Stock Items (total qty across all locs below the item's reorder
    #    point). Per-item Item.min_stock_level; falls back to 10 when unset.
    low_stock_query = (
        db.query(StockBalance.item_id)
        .join(Item, Item.id == StockBalance.item_id)
        .group_by(StockBalance.item_id, Item.min_stock_level)
        .having(func.sum(StockBalance.qty) < func.coalesce(Item.min_stock_level, 10))
    )
    low_stock_count = low_stock_query.count()
    update_kpi(db, "low_stock", float(low_stock_count))

    # 5. Active Samples
    active_samples = db.query(SampleRequest).filter(SampleRequest.status.in_(['DRAFT', 'IN_PRODUCTION', 'SENT'])).count()
    update_kpi(db, "active_samples", float(active_samples))

    # 6. Open Sales Orders (Incoming)
    open_sos = db.query(SalesOrder).filter(SalesOrder.status == "PENDING").count()
    update_kpi(db, "open_sos", float(open_sos))

    _snapshot_kpi_history(db)
    return True


def _snapshot_kpi_history(db: Session):
    """Upsert today's value for every cached KPI — one row per key per day.
    Builds the daily time series behind the dashboard trend charts."""
    today = datetime.now(timezone.utc).date()
    for k in db.query(KPICache).all():
        existing = db.query(KPIHistory).filter(
            KPIHistory.key == k.key, KPIHistory.snapshot_date == today
        ).first()
        if existing:
            existing.value = k.value
        else:
            db.add(KPIHistory(key=k.key, value=k.value, snapshot_date=today))
    db.commit()


def get_kpi_history(db: Session, days: int = 30):
    """{key: [{"date": "YYYY-MM-DD", "value": float}, ...]} for the last N days, ascending."""
    cutoff = datetime.now(timezone.utc).date() - timedelta(days=days)
    rows = (
        db.query(KPIHistory)
        .filter(KPIHistory.snapshot_date >= cutoff)
        .order_by(KPIHistory.snapshot_date.asc())
        .all()
    )
    out: dict = {}
    for r in rows:
        out.setdefault(r.key, []).append({"date": r.snapshot_date.isoformat(), "value": r.value})
    return out

def get_all_cached_kpis(db: Session):
    """Returns all cached KPIs, refreshing if cache is empty or older than 5 minutes."""
    kpis = db.query(KPICache).all()
    
    # Check if we need to refresh (any record older than 5 mins)
    needs_refresh = not kpis
    if kpis:
        oldest = min(k.updated_at for k in kpis)
        if (datetime.now(timezone.utc) - oldest.replace(tzinfo=timezone.utc)) > timedelta(minutes=5):
            needs_refresh = True

    if needs_refresh:
        refresh_all_kpis(db)
        kpis = db.query(KPICache).all()

    return {k.key: k.value for k in kpis}


async def invalidate_kpis_async(db: AsyncSession):
    """Mark all cached KPIs stale so the next dashboard fetch recomputes them."""
    from sqlalchemy import update
    from datetime import datetime, timezone
    await db.execute(update(KPICache).values(updated_at=datetime(1970, 1, 1, tzinfo=timezone.utc)))
    await db.commit()
