from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, aliased, selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db, get_async_db
from app.services import kpi_service, so_fulfilment_service
from app.api.auth import get_current_user, require_any_permission, user_has_permission
from app.models.auth import User
from app.models.stock_balance import StockBalance
from app.models.stock_ledger import StockLedger
from app.models.item import Item
from app.models.location import Location
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.manufacturing import ManufacturingOrder

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

# The dashboard is the one route open to every authenticated user (it is where
# login lands), so the permission check has to happen per BLOCK of the payload
# rather than on the route: without this, a role denied Sales and Stock still read
# plant-wide order and stock figures off the landing page. A block the caller
# can't see is not computed at all, so the query cost goes with it.
STOCK_PERMS = ("stock_on_hand.view", "stock_ledger.view", "booking_stock.view")
SALES_PERMS = ("sales_order.view", "sales_order.create_pr", "production_run.view")
MFG_PERMS = ("manufacturing_order.view", "work_order.view", "production_run.view")

# Which permissions open each cached KPI. A key absent from the map is reference
# data (item counts), open like GET /items itself.
KPI_PERMS: dict[str, tuple[str, ...]] = {
    "low_stock": STOCK_PERMS,
    "active_wo": MFG_PERMS,
    "pending_wo": MFG_PERMS,
    "open_sos": SALES_PERMS,
    "active_samples": ("sample_request.view",),
}


def can(user: User, *codes: str) -> bool:
    return any(user_has_permission(user, c) for c in codes)


def visible_kpis(user: User, kpis: dict) -> dict:
    return {k: v for k, v in kpis.items() if k not in KPI_PERMS or can(user, *KPI_PERMS[k])}

@router.get("/kpis")
def get_dashboard_kpis(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # You can choose to refresh if data is old, or just return cache
    return visible_kpis(current_user, kpi_service.get_all_cached_kpis(db))

@router.get("/kpis/history")
def get_kpi_history(days: int = 30, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Daily KPI time series for trend charts: {key: [{date, value}, ...]}."""
    return visible_kpis(current_user, kpi_service.get_kpi_history(db, days=days))


@router.get("/summary")
async def get_dashboard_summary(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Server-side computation of the dashboard's heavy aggregates.

    Replaces the previous frontend approach of shipping the entire stock-balance
    table and all sales orders to the browser. Uses SQL aggregation throughout.
    """
    see_stock = can(current_user, *STOCK_PERMS)
    see_sales = can(current_user, *SALES_PERMS)
    see_mfg = can(current_user, *MFG_PERMS)
    out: dict = {}

    # --- Warehouse distribution: sum qty per location (qty > 0 only), grouped by
    #     the location's parent warehouse (spots roll up to their warehouse) ---
    Warehouse = aliased(Location)
    wd_result = await db.execute(
        select(
            StockBalance.location_id,
            Location.name,
            Location.parent_id,
            Warehouse.name.label("warehouse_name"),
            func.sum(StockBalance.qty).label("total_qty"),
        )
        .join(Location, Location.id == StockBalance.location_id)
        .outerjoin(Warehouse, Warehouse.id == Location.parent_id)
        .group_by(StockBalance.location_id, Location.name, Location.parent_id, Warehouse.name)
        .having(func.sum(StockBalance.qty) > 0)
        .order_by(func.sum(StockBalance.qty).desc())
    )
    warehouse_distribution = [
        {
            "location_id": str(row.location_id),
            "location_name": row.name,
            # keys kept for the dashboard's grouped display; now carry the parent warehouse
            "location_category_id": str(row.parent_id) if row.parent_id else None,
            "location_category_name": row.warehouse_name or "No Warehouse",
            "total_qty": float(row.total_qty or 0),
        }
        for row in wd_result.all()
    ]

    # --- Low stock items: items WITH a StockBalance row whose summed qty is
    #     below the item's reorder point (Item.min_stock_level, default 10).
    #     Ordered most-deficient first. ---
    ls_result = await db.execute(
        select(
            StockBalance.item_id,
            Item.name,
            Item.code,
            func.coalesce(Item.min_stock_level, 10).label("min_level"),
            func.sum(StockBalance.qty).label("total_qty"),
        )
        .join(Item, Item.id == StockBalance.item_id)
        .group_by(StockBalance.item_id, Item.name, Item.code, Item.min_stock_level)
        .having(func.sum(StockBalance.qty) < func.coalesce(Item.min_stock_level, 10))
        .order_by((func.sum(StockBalance.qty) - func.coalesce(Item.min_stock_level, 10)).asc())
        .limit(10)
    )
    low_stock_items = [
        {
            "item_id": str(row.item_id),
            "item_name": row.name,
            "item_code": row.code,
            "min_level": float(row.min_level or 0),
            "total_qty": float(row.total_qty or 0),
        }
        for row in ls_result.all()
    ]

    # --- Recent movements: last 5 ledger rows, resolve item + location names ---
    rm_result = await db.execute(
        select(
            StockLedger.item_id,
            StockLedger.qty_change,
            StockLedger.created_at,
            Item.name.label("item_name"),
            Location.name.label("location_name"),
        )
        .outerjoin(Item, Item.id == StockLedger.item_id)
        .outerjoin(Location, Location.id == StockLedger.location_id)
        .order_by(StockLedger.created_at.desc())
        .limit(5)
    )
    recent_movements = [
        {
            "item_id": str(row.item_id),
            "item_name": row.item_name or str(row.item_id),
            "location_name": row.location_name or "",
            "qty_change": float(row.qty_change or 0),
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }
        for row in rm_result.all()
    ]

    # --- Sales orders: readiness/shortage analysis over open (PENDING) SOs ---
    open_so_result = await db.execute(
        select(SalesOrder)
        .where(SalesOrder.status == "PENDING")
    )
    open_sos = open_so_result.scalars().all()
    open_so_count = len(open_sos)

    # Lines for all open SOs (one query)
    so_ids = [so.id for so in open_sos]
    lines_by_so: dict = {}
    needed_item_ids: set = set()
    if so_ids:
        lines_result = await db.execute(
            select(SalesOrderLine).where(SalesOrderLine.sales_order_id.in_(so_ids))
        )
        for line in lines_result.scalars().all():
            lines_by_so.setdefault(line.sales_order_id, []).append(line)
            needed_item_ids.add(line.item_id)

    # Available stock per item across all locations/variants (one aggregated query)
    avail_by_item: dict = {}
    if needed_item_ids:
        avail_result = await db.execute(
            select(StockBalance.item_id, func.sum(StockBalance.qty))
            .where(StockBalance.item_id.in_(needed_item_ids))
            .group_by(StockBalance.item_id)
        )
        avail_by_item = {row[0]: float(row[1] or 0) for row in avail_result.all()}

    # Ordered qty in each item's stock UoM — `StockBalance.qty` is in that unit
    # while `line.qty` is in yards, so comparing them raw made every kg-stocked
    # line read as short. See so_fulfilment_service.ordered_qty_in_stock_uom.
    ordered_base = await so_fulfilment_service.ordered_base_map(
        db, [line.id for lines in lines_by_so.values() for line in lines]
    )

    ready_so_count = 0
    short_so_count = 0
    short_orders: list = []
    for so in open_sos:
        lines = lines_by_so.get(so.id, [])
        if not lines:
            continue
        short_lines = 0
        for line in lines:
            available = avail_by_item.get(line.item_id, 0.0)
            needed = ordered_base.get(str(line.id))
            # Unknown requirement counts as short: an unmeasurable line is not
            # evidence the order is ready to ship.
            if needed is None or available < needed:
                short_lines += 1
        if short_lines == 0:
            ready_so_count += 1
        else:
            short_so_count += 1
            if len(short_orders) < 5:
                short_orders.append({
                    "code": so.po_number,
                    "short_lines": short_lines,
                    "total_lines": len(lines),
                })

    delivery_readiness = (ready_so_count / open_so_count * 100) if open_so_count > 0 else 100.0

    # --- Production yield: over ManufacturingOrder (same model as active_wo/pending_wo) ---
    py_result = await db.execute(
        select(ManufacturingOrder.status, ManufacturingOrder.qty)
        .where(ManufacturingOrder.status.in_(["COMPLETED", "DELIVERED", "IN_PROGRESS"]))
    )
    completed_qty = 0.0
    total_started_qty = 0.0
    for row in py_result.all():
        q = float(row.qty or 0)
        total_started_qty += q
        # DELIVERED = planned qty met (order simply not closed yet) — counts as yield.
        if row.status in ("COMPLETED", "DELIVERED"):
            completed_qty += q
    production_yield = (completed_qty / total_started_qty * 100) if total_started_qty > 0 else 100.0

    if see_stock:
        out.update({
            "warehouse_distribution": warehouse_distribution,
            "low_stock_items": low_stock_items,
            "recent_movements": recent_movements,
        })
    if see_sales:
        out.update({
            "open_so_count": open_so_count,
            "ready_so_count": ready_so_count,
            "short_so_count": short_so_count,
            "delivery_readiness": float(delivery_readiness),
            "short_orders": short_orders,
        })
    if see_mfg:
        out["production_yield"] = float(production_yield)
    return out


# Open = still owed to the customer. SENT/DELIVERED have left, CANCELLED never ships.
OPEN_SO_STATUSES = ("PENDING", "READY", "PARTIAL")


@router.get("/delivery-outlook")
async def get_delivery_outlook(
    limit: int = 8,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission(*SALES_PERMS)),
):
    """Open sales orders by the date they are owed, with how much of each is
    actually shippable — the dashboard's top panel.

    Progress is `dispatched + packed_available`, i.e. cartons that have left plus
    cartons still sitting in stock, which is the same quantity
    `so_fulfilment_service.derive_status` gates READY on. `made` (bulk produced but
    not packed) is tracked separately so an order can read "in production" without
    claiming to be shippable.

    ponytail: walks every open order per request, like /summary's sales block
    above it. Both are fine at a few hundred open orders; if that grows, fold the
    per-line roll-up into a materialized column rather than paging this.
    """
    orders = (await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.lines))
        .where(SalesOrder.status.in_(OPEN_SO_STATUSES))
    )).scalars().unique().all()

    line_ids = [line.id for so in orders for line in so.lines]
    ordered_base = await so_fulfilment_service.ordered_base_map(db, line_ids)
    fulfilment = await so_fulfilment_service.fulfilment_map(db, [so.id for so in orders])
    today = datetime.utcnow().date()

    rows = []
    for so in orders:
        ordered = shippable = produced = 0.0
        short_lines = 0
        due = None
        for line in so.lines:
            need = ordered_base.get(str(line.id)) or 0.0
            got = fulfilment.get(str(line.id), {})
            ready_qty = float(got.get("dispatched") or 0) + float(got.get("packed_available") or 0)
            made_qty = float(got.get("made") or 0)
            ordered += need
            shippable += min(ready_qty, need) if need else ready_qty
            produced += min(made_qty, need) if need else made_qty
            if need and made_qty < need:
                short_lines += 1
            if line.due_date and (due is None or line.due_date < due):
                due = line.due_date

        pct = (shippable / ordered * 100) if ordered else 0.0
        late = bool(due and due.date() < today and pct < 100)
        rows.append({
            "id": str(so.id),
            "code": so.po_number,
            "customer": so.customer_name,
            "status": so.status,
            "due_date": due.isoformat() if due else None,
            "late": late,
            "ordered_qty": ordered,
            "shippable_qty": shippable,
            "produced_pct": (produced / ordered * 100) if ordered else 0.0,
            "pct": pct,
            "line_count": len(so.lines),
            "short_lines": short_lines,
        })

    # Worst first: late, then soonest owed, then least covered. A null due date
    # sorts last — it is not a deadline, so it can't be the most urgent row.
    rows.sort(key=lambda r: (
        not r["late"],
        r["due_date"] or "9999-12-31",
        r["pct"],
    ))

    return {
        "rows": rows[:limit],
        "open_count": len(rows),
        "late_count": sum(1 for r in rows if r["late"]),
        "ready_count": sum(1 for r in rows if r["pct"] >= 100),
        "at_risk_count": sum(1 for r in rows if r["short_lines"] > 0),
    }
