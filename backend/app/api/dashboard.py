from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, aliased, selectinload
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.db.session import get_db, get_async_db
from app.services import kpi_service, so_fulfilment_service
from app.services.netting_service import OPEN_SO_STATUSES
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

    # --- Sales orders: readiness over every open SO ---
    # Same basis as /delivery-outlook and so_fulfilment_service.derive_status: a
    # line is covered by cartons dispatched + packed and still in stock, in the
    # item's stock UoM. Raw on-hand would count bulk nobody has packed yet.
    open_sos = (await db.execute(
        select(SalesOrder)
        .options(selectinload(SalesOrder.lines))
        .where(SalesOrder.status.in_(OPEN_SO_STATUSES))
    )).scalars().unique().all()
    open_so_count = len(open_sos)

    line_ids = [line.id for so in open_sos for line in so.lines]
    ordered_base = await so_fulfilment_service.ordered_base_map(db, line_ids)
    fulfilment = await so_fulfilment_service.fulfilment_map(db, [so.id for so in open_sos])

    ready_so_count = 0
    short_so_count = 0
    short_orders: list = []
    for so in open_sos:
        if not so.lines:
            continue
        short_lines = 0
        for line in so.lines:
            needed = ordered_base.get(str(line.id))
            got = fulfilment.get(str(line.id), {})
            covered = float(got.get("dispatched") or 0) + float(got.get("packed_available") or 0)
            # Unknown requirement counts as short: an unmeasurable line is not
            # evidence the order is ready to ship.
            if needed is None or covered < needed - so_fulfilment_service.EPS:
                short_lines += 1
        if short_lines == 0:
            ready_so_count += 1
        else:
            short_so_count += 1
            if len(short_orders) < 5:
                short_orders.append({
                    "code": so.po_number,
                    "short_lines": short_lines,
                    "total_lines": len(so.lines),
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


@router.get("/floor")
async def get_floor(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Live shape of the mill for the dashboard's pixel floor plan.

    `types`: every work-center TYPE that has machines, each machine flagged
    `running`. A machine runs when something is actually being worked on it: an
    IN_PROGRESS work order, a RUNNING loom run, an IN_PROGRESS dyeing/setting run
    (their machine is the WO's) or an IN_PROGRESS packing order.
    `stores`: top-level warehouses holding stock, rolled up from zones/bins,
    with the TYPEs whose output lands there (the frontend picks a sprite from it).
    Blocks are permission-gated like /summary; the route is open to all.
    """
    from app.models.routing import WorkCenter
    from app.models.work_order import WorkOrder
    from app.models.weaving import WeavingRun
    from app.models.dyeing_setting import DyeingRun, SettingRun
    from app.models.packing import PackingOrder

    out: dict = {"types": [], "stores": []}
    see_mfg = can(current_user, *MFG_PERMS)
    see_stock = can(current_user, *STOCK_PERMS)

    wcs = (await db.execute(select(
        WorkCenter.id, WorkCenter.code, WorkCenter.name, WorkCenter.center_type,
        WorkCenter.node_type, WorkCenter.parent_id, WorkCenter.output_location_id,
    ))).all()
    by_id = {w.id: w for w in wcs}

    def type_of(w):
        seen = set()
        while w is not None and (w.node_type or "").upper() != "TYPE" and w.id not in seen:
            seen.add(w.id)
            w = by_id.get(w.parent_id)
        return w if w is not None and (w.node_type or "").upper() == "TYPE" else None

    if see_mfg:
        running = set()
        for q in (
            select(WorkOrder.work_center_id).where(WorkOrder.status == "IN_PROGRESS"),
            select(WeavingRun.work_center_id).where(WeavingRun.status == "RUNNING"),
            select(WorkOrder.work_center_id).join(DyeingRun, DyeingRun.work_order_id == WorkOrder.id)
                .where(DyeingRun.status == "IN_PROGRESS"),
            select(WorkOrder.work_center_id).join(SettingRun, SettingRun.work_order_id == WorkOrder.id)
                .where(SettingRun.status == "IN_PROGRESS"),
            select(PackingOrder.work_center_id).where(PackingOrder.status == "IN_PROGRESS"),
        ):
            running.update(r for r in (await db.execute(q.distinct())).scalars() if r)

        types: dict = {}
        for w in sorted(wcs, key=lambda w: w.code):
            if (w.node_type or "").upper() != "MACHINE":
                continue
            t = type_of(w)
            if t is None:
                continue
            types.setdefault(t.id, {
                "id": str(t.id), "code": t.code, "name": t.name, "center_type": t.center_type, "machines": [],
            })["machines"].append({"id": str(w.id), "code": w.code, "running": w.id in running})
        out["types"] = sorted(types.values(), key=lambda t: t["code"])

    if see_stock:
        locs = {l.id: l for l in (await db.execute(
            select(Location.id, Location.name, Location.system_code, Location.parent_id, Location.is_quarantine)
        )).all()}

        def root_of(lid):
            seen = set()
            loc = locs.get(lid)
            while loc is not None and loc.parent_id in locs and loc.id not in seen:
                seen.add(loc.id)
                loc = locs[loc.parent_id]
            return loc

        stores: dict = {}
        rows = (await db.execute(
            select(StockBalance.location_id, Item.uom, func.count(), func.sum(StockBalance.qty))
            .join(Item, Item.id == StockBalance.item_id)
            .where(StockBalance.qty > 0)
            .group_by(StockBalance.location_id, Item.uom)
        )).all()
        for loc_id, uom, lines, qty in rows:
            root = root_of(loc_id)
            if root is None:
                continue
            s = stores.setdefault(root.id, {
                "id": str(root.id), "name": root.name, "system_code": root.system_code,
                "is_quarantine": root.is_quarantine, "lines": 0, "qty_by_uom": {}, "fed_by": [],
            })
            s["lines"] += lines
            s["qty_by_uom"][uom or ""] = s["qty_by_uom"].get(uom or "", 0.0) + float(qty or 0)
        for w in wcs:
            if (w.node_type or "").upper() == "TYPE" and w.output_location_id:
                root = root_of(w.output_location_id)
                if root is not None and root.id in stores:
                    stores[root.id]["fed_by"].append(w.center_type)
        out["stores"] = sorted(stores.values(), key=lambda s: -s["lines"])

    return out
