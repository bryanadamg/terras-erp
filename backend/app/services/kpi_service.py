from sqlalchemy.orm import Session
from sqlalchemy import func
from app.models.kpi import KPICache
from app.models.item import Item
from app.models.manufacturing import WorkOrder
from app.models.stock_balance import StockBalance
from app.models.sales import SalesOrder
from app.models.sample import SampleRequest
from datetime import datetime, timedelta, timezone

def get_kpi(db: Session, key: str, ttl_minutes: int = 10):
    """Retrieves a KPI from cache or returns None if expired."""
    cached = db.query(KPICache).filter(KPICache.key == key).first()
    if cached and (datetime.now(timezone.utc) - cached.updated_at) < timedelta(minutes=ttl_minutes):
        return cached.value
    return None

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

    # 4. Low Stock Items (Items where total qty across all locs < 10)
    # Optimized: Group by item_id in stock_balances and sum
    low_stock_query = db.query(StockBalance.item_id).group_by(StockBalance.item_id).having(func.sum(StockBalance.qty) < 10)
    low_stock_count = low_stock_query.count()
    update_kpi(db, "low_stock", float(low_stock_count))

    # 5. Active Samples
    active_samples = db.query(SampleRequest).filter(SampleRequest.status.in_(['DRAFT', 'IN_PRODUCTION', 'SENT'])).count()
    update_kpi(db, "active_samples", float(active_samples))

    # 6. Open Sales Orders (Incoming)
    open_sos = db.query(SalesOrder).filter(SalesOrder.status == "PENDING").count()
    update_kpi(db, "open_sos", float(open_sos))

    return True

def get_all_cached_kpis(db: Session):
    """Returns all cached KPIs, refreshing if cache is empty or older than 5 minutes."""
    kpis = db.query(KPICache).all()
    
    # Check if we need to refresh (any record older than 5 mins)
    needs_refresh = not kpis
    if kpis:
        oldest = min(k.updated_at for k in kpis)
        if (datetime.now(timezone.utc) - oldest) > timedelta(minutes=5):
            needs_refresh = True

    if needs_refresh:
        refresh_all_kpis(db)
        kpis = db.query(KPICache).all()
    
    return {k.key: k.value for k in kpis}
