"""Production output reports — good qty, QC reject qty, reject %.

Answers "what did each machine / work order produce between these two dates, and
how much of it was scrapped?" from the completion logs. Invariants:

* The machine a completion belongs to is the one **on the log**
  (`COALESCE(mo_completions.work_center_id, work_orders.work_center_id)`). A WO
  cut on a GROUP/TYPE is only pinned to a machine when the operator picks one in
  the log form, so reading the WO first pegged that output to the parent node.
  Blank picks are already backfilled from the WO at log time; the WO is only the
  fallback for old logs that predate that backfill.
* "Everything under this node" is resolved through the recursive CTE in
  `work_center_service`, never a one-hop `parent_id ==` filter: the GROUP tier is
  optional, so machines may hang one *or* two levels below a TYPE.
* Good qty sums only non-rejected logs; scrap sums `qty_rejected` over **every**
  log, because a partial reject leaves its log active with the scrapped qty moved
  onto that column. Read both through the `qty_good`/`qty_rej` expressions here.
* Packing is a **separate report**, not a grouping of the machine one: a
  PackingCompletion has no work center to peg to, so it can never appear in a
  query keyed on `COALESCE(...work_center_id)`. Same columns, different source.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.models.auth import User
from app.models.batch import Batch
from app.models.item import Item
from app.models.location import Location
from app.models.manufacturing import ManufacturingOrder, MOCompletion
from app.models.packing import PackingCompletion, PackingOrder
from app.models.routing import WorkCenter
from app.models.sales import SalesOrder
from app.models.work_order import WorkOrder
from app.api.auth import require_permission
from app.services import work_center_service
from app.services.xlsx_service import xlsx_response

router = APIRouter()


def _node_type(wc) -> str:
    """MACHINE/GROUP/TYPE. Pre-group rows have no node_type — for them the old
    two-level rule (has a parent => machine) is still the right answer."""
    return str(getattr(wc, "node_type", None) or ("MACHINE" if wc.parent_id else "TYPE")).upper()


def _f(v) -> float:
    return float(v or 0)


def _yield_pct(good: float, rejected: float) -> Optional[float]:
    total = good + rejected
    return round(good / total * 100, 2) if total > 0 else None


def _reject_pct(good: float, rejected: float) -> Optional[float]:
    """Scrap as a share of good output — the client's "% QC reject / Hasil", so the
    denominator is *hasil* (good), not total output: 10 rejected against 100 good
    reads 10%, not 9.09%. With nothing good but something rejected the ratio is
    undefined, so it reports 100 (everything produced was scrapped); None only when
    the row produced nothing at all."""
    if good > 0:
        return round(rejected / good * 100, 2)
    return 100.0 if rejected > 0 else None


def _iso(dt: Optional[datetime]) -> Optional[str]:
    return dt.isoformat() if dt else None


class _WCIndex:
    """work_centers is a small master table — load it once and walk it in memory
    instead of a query per tree level."""

    def __init__(self, rows: list[WorkCenter]):
        self.by_id = {str(r.id): r for r in rows}
        self.rows = rows

    def ancestors(self, wc_id: str) -> list[WorkCenter]:
        chain: list[WorkCenter] = []
        seen = {str(wc_id)}
        cur = self.by_id.get(str(wc_id))
        while cur is not None and cur.parent_id is not None and str(cur.parent_id) not in seen:
            seen.add(str(cur.parent_id))
            parent = self.by_id.get(str(cur.parent_id))
            if parent is None:
                break
            chain.append(parent)
            cur = parent
        return chain

    def group_of(self, wc_id: str) -> Optional[WorkCenter]:
        for a in self.ancestors(wc_id):
            if _node_type(a) == "GROUP":
                return a
        return None

    def type_of(self, wc_id: str) -> Optional[WorkCenter]:
        node = self.by_id.get(str(wc_id))
        if node is not None and _node_type(node) == "TYPE":
            return node
        for a in self.ancestors(wc_id):
            if _node_type(a) == "TYPE":
                return a
        return None

    def center_type(self, wc_id: str) -> str:
        """A machine may leave center_type blank and inherit it from the GROUP/TYPE."""
        node = self.by_id.get(str(wc_id))
        for n in ([node] if node else []) + self.ancestors(wc_id):
            t = str(getattr(n, "center_type", "") or "").upper()
            if t:
                return t
        return ""

    def machines_under(self, root_id: str) -> list[WorkCenter]:
        out: list[WorkCenter] = []
        seen: set[str] = set()

        def walk(pid: str):
            if pid in seen:
                return
            seen.add(pid)
            for wc in self.rows:
                if str(wc.parent_id or "") != pid:
                    continue
                if _node_type(wc) == "MACHINE":
                    out.append(wc)
                else:
                    walk(str(wc.id))

        root = self.by_id.get(str(root_id))
        if root is not None and _node_type(root) == "MACHINE":
            return [root]
        walk(str(root_id))
        return out


@router.get("/reports/machine-output")
async def machine_output_report(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    work_center_id: Optional[str] = Query(None, description="Exactly one machine"),
    group_id: Optional[str] = Query(None, description="Any container node — its whole subtree"),
    group_by: str = Query("machine", description="'machine' | 'group' | 'wo' (one row per work order)"),
    wo_status: Optional[str] = Query(None, description="Comma-separated WO statuses, e.g. COMPLETED"),
    include_idle: bool = Query(True, description="Keep in-scope machines that logged nothing"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("production_output.view")),
):
    """Production output logged against work orders — good qty, QC reject qty and
    reject % — rolled up per machine, per work-center group, or per work order.

    `group_by='wo'` is the per-WO result sheet the floor asks for: one row per work
    order with hasil / QC reject / reject %, filterable to finished orders with
    `wo_status=COMPLETED`. Every row (any grouping) also carries a `rejects` list —
    one entry per reject event, with reason, operator and the defect store the scrap
    was moved into.
    """
    mode = str(group_by or "machine").lower()
    by_group = mode == "group"
    by_wo = mode == "wo"
    wo_statuses = [s.strip().upper() for s in (wo_status or "").split(",") if s.strip()]

    # ── Scope ────────────────────────────────────────────────────────────────
    wc_rows = (await db.execute(select(WorkCenter))).scalars().all()
    idx = _WCIndex(list(wc_rows))

    # Bind as real UUIDs: the scoped column is a COALESCE of two UUID columns, so a
    # bare string would land as text and Postgres won't compare uuid = text.
    scope_ids: Optional[list[uuid.UUID]] = None
    if work_center_id:
        scope_ids = [uuid.UUID(str(work_center_id))]
    elif group_id:
        # Recursive CTE — the node's machines may sit behind an optional GROUP.
        sub = await work_center_service.descendant_ids(db, group_id)
        scope_ids = [uuid.UUID(str(group_id))] + [uuid.UUID(str(x)) for x in sub]

    # ── Completion aggregates, pegged to the log's machine ───────────────────
    eff_wc = func.coalesce(MOCompletion.work_center_id, WorkOrder.work_center_id)
    # Rejected logs don't count as output; scrap is summed over every log because a
    # partial reject stays active with the scrapped qty moved onto qty_rejected.
    qty_good = func.sum(case((MOCompletion.rejected == False, MOCompletion.qty_completed), else_=0))  # noqa: E712
    qty_rej = func.sum(func.coalesce(MOCompletion.qty_rejected, 0))

    conditions = [eff_wc.is_not(None)]
    if start_date:
        conditions.append(MOCompletion.created_at >= start_date)
    if end_date:
        conditions.append(MOCompletion.created_at <= end_date)
    if scope_ids is not None:
        conditions.append(eff_wc.in_(scope_ids))
    if wo_statuses:
        # Deliberately drops MO-level logs (no WO to have a status) — a WO-status
        # filter is a question about work orders.
        conditions.append(WorkOrder.status.in_(wo_statuses))

    def _base(stmt):
        return (
            stmt.join(ManufacturingOrder, MOCompletion.mo_id == ManufacturingOrder.id)
            .outerjoin(WorkOrder, MOCompletion.work_order_id == WorkOrder.id)
            .where(and_(*conditions))
        )

    item_rows = (await db.execute(_base(
        select(
            eff_wc.label("wc_id"),
            ManufacturingOrder.item_id.label("item_id"),
            qty_good.label("qty_good"),
            qty_rej.label("qty_rejected"),
            func.count(MOCompletion.id).label("logs"),
        )
    ).group_by(eff_wc, ManufacturingOrder.item_id))).all()

    wo_rows = (await db.execute(_base(
        select(
            eff_wc.label("wc_id"),
            WorkOrder.id.label("wo_id"),
            WorkOrder.code.label("wo_code"),
            WorkOrder.name.label("wo_name"),
            WorkOrder.status.label("wo_status"),
            WorkOrder.qty.label("wo_qty"),
            ManufacturingOrder.code.label("mo_code"),
            ManufacturingOrder.item_id.label("item_id"),
            qty_good.label("qty_good"),
            qty_rej.label("qty_rejected"),
            func.count(MOCompletion.id).label("logs"),
            func.min(MOCompletion.created_at).label("first_log"),
            func.max(MOCompletion.created_at).label("last_log"),
        )
    ).group_by(
        eff_wc, WorkOrder.id, WorkOrder.code, WorkOrder.name, WorkOrder.status,
        WorkOrder.qty, ManufacturingOrder.code, ManufacturingOrder.item_id,
    ))).all()

    # ── Reject events ────────────────────────────────────────────────────────
    # Every log that scrapped something, with why and where the scrap went. Only
    # rejects are listed (a plant logging cleanly returns none), so this is small
    # enough to ship inline with the rows instead of behind a second request.
    reject_rows = (await db.execute(_base(
        select(
            eff_wc.label("wc_id"),
            MOCompletion.id.label("completion_id"),
            MOCompletion.created_at.label("logged_at"),
            MOCompletion.qty_completed.label("qty_completed"),
            MOCompletion.qty_rejected.label("qty_rejected"),
            MOCompletion.rejected.label("whole"),
            MOCompletion.reject_reason.label("reason"),
            MOCompletion.rejected_at.label("rejected_at"),
            MOCompletion.rejected_by.label("rejected_by"),
            MOCompletion.operator_name.label("operator_name"),
            MOCompletion.reject_location_id.label("reject_location_id"),
            Location.name.label("reject_location_name"),
            Batch.batch_number.label("lot_number"),
            Batch.quality_status.label("lot_status"),
            WorkOrder.id.label("wo_id"),
            WorkOrder.code.label("wo_code"),
            ManufacturingOrder.code.label("mo_code"),
            ManufacturingOrder.item_id.label("item_id"),
        )
        # Anchor the FROM explicitly: this select's first column is the COALESCE, so
        # leaving the left side to inference would be at the mercy of join order.
        .select_from(MOCompletion)
        .outerjoin(Location, MOCompletion.reject_location_id == Location.id)
        .outerjoin(Batch, MOCompletion.output_batch_id == Batch.id)
    ).where(func.coalesce(MOCompletion.qty_rejected, 0) > 0)
        .order_by(MOCompletion.created_at.desc()))).all()

    # ── Item names ───────────────────────────────────────────────────────────
    item_ids = {str(r.item_id) for r in item_rows if r.item_id}
    items: dict[str, Item] = {}
    if item_ids:
        res = await db.execute(select(Item).where(Item.id.in_(list(item_ids))))
        items = {str(i.id): i for i in res.scalars().all()}

    def _item_meta(item_id) -> dict:
        it = items.get(str(item_id)) if item_id else None
        return {
            "item_id": str(item_id) if item_id else None,
            "item_code": it.code if it else None,
            "item_name": it.name if it else None,
            "uom": it.uom if it else None,
        }

    # ── Per-machine assembly ─────────────────────────────────────────────────
    machines: dict[str, dict] = {}

    def _machine_bucket(wc_id: str) -> dict:
        key = str(wc_id)
        if key in machines:
            return machines[key]
        wc = idx.by_id.get(key)
        grp = idx.group_of(key)
        typ = idx.type_of(key)
        machines[key] = {
            "work_center_id": key,
            "work_center_code": wc.code if wc else None,
            "work_center_name": wc.name if wc else "(deleted work center)",
            "node_type": _node_type(wc) if wc else "MACHINE",
            "center_type": idx.center_type(key),
            "group_id": str(grp.id) if grp else None,
            "group_name": grp.name if grp else None,
            "type_id": str(typ.id) if typ else None,
            "type_name": typ.name if typ else None,
            "qty_good": 0.0,
            "qty_rejected": 0.0,
            "logs": 0,
            "wo_count": 0,
            "first_log": None,
            "last_log": None,
            "items": [],
            "work_orders": [],
            "rejects": [],
        }
        return machines[key]

    if include_idle:
        in_scope = (
            idx.machines_under(scope_ids[0]) if scope_ids is not None
            else [wc for wc in idx.rows if _node_type(wc) == "MACHINE"]
        )
        for wc in in_scope:
            _machine_bucket(str(wc.id))

    for r in item_rows:
        m = _machine_bucket(str(r.wc_id))
        good, rej = _f(r.qty_good), _f(r.qty_rejected)
        m["qty_good"] += good
        m["qty_rejected"] += rej
        m["logs"] += int(r.logs or 0)
        m["items"].append({
            **_item_meta(r.item_id),
            "qty_good": good,
            "qty_rejected": rej,
            "logs": int(r.logs or 0),
        })

    for r in wo_rows:
        m = _machine_bucket(str(r.wc_id))
        m["wo_count"] += 1
        if r.first_log and (m["first_log"] is None or r.first_log < m["first_log"]):
            m["first_log"] = r.first_log
        if r.last_log and (m["last_log"] is None or r.last_log > m["last_log"]):
            m["last_log"] = r.last_log
        good, rej = _f(r.qty_good), _f(r.qty_rejected)
        m["work_orders"].append({
            "work_order_id": str(r.wo_id) if r.wo_id else None,
            "wo_code": r.wo_code,
            "wo_name": r.wo_name,
            "wo_status": r.wo_status,
            "wo_qty": _f(r.wo_qty) if r.wo_qty is not None else None,
            "mo_code": r.mo_code,
            **_item_meta(r.item_id),
            "qty_good": good,
            "qty_rejected": rej,
            "yield_pct": _yield_pct(good, rej),
            "reject_pct": _reject_pct(good, rej),
            "logs": int(r.logs or 0),
            "first_log": _iso(r.first_log),
            "last_log": _iso(r.last_log),
            "rejects": [],
        })

    # Reject events hang off both the machine and its WO row, so the same detail
    # reads correctly whichever grouping the user is looking at.
    for r in reject_rows:
        m = _machine_bucket(str(r.wc_id))
        event = {
            "completion_id": str(r.completion_id),
            "logged_at": _iso(r.logged_at),
            "qty_completed": _f(r.qty_completed),
            "qty_rejected": _f(r.qty_rejected),
            "whole_lot": bool(r.whole),
            "reason": r.reason,
            "rejected_at": _iso(r.rejected_at),
            "rejected_by": r.rejected_by,
            "operator_name": r.operator_name,
            "reject_location_id": str(r.reject_location_id) if r.reject_location_id else None,
            "reject_location_name": r.reject_location_name,
            "lot_number": r.lot_number,
            "lot_status": r.lot_status,
            "work_order_id": str(r.wo_id) if r.wo_id else None,
            "wo_code": r.wo_code,
            "mo_code": r.mo_code,
            **_item_meta(r.item_id),
        }
        m["rejects"].append(event)
        wo_key = str(r.wo_id) if r.wo_id else None
        for w in m["work_orders"]:
            if w["work_order_id"] == wo_key and w["mo_code"] == r.mo_code:
                w["rejects"].append(event)
                break

    for m in machines.values():
        m["items"].sort(key=lambda x: -x["qty_good"])
        m["work_orders"].sort(key=lambda x: (x["last_log"] or ""), reverse=True)
        m["yield_pct"] = _yield_pct(m["qty_good"], m["qty_rejected"])
        m["reject_pct"] = _reject_pct(m["qty_good"], m["qty_rejected"])
        m["first_log"] = _iso(m["first_log"])
        m["last_log"] = _iso(m["last_log"])
        for it in m["items"]:
            it["reject_pct"] = _reject_pct(it["qty_good"], it["qty_rejected"])

    machine_rows = sorted(machines.values(), key=lambda m: (-m["qty_good"], m["work_center_name"] or ""))

    # ── Optional roll-up into GROUP (falls back to the TYPE root) ────────────
    if by_group:
        groups: dict[str, dict] = {}
        for m in machine_rows:
            gid = m["group_id"] or m["type_id"] or m["work_center_id"]
            gname = m["group_name"] or m["type_name"] or m["work_center_name"]
            g = groups.get(gid)
            if g is None:
                g = groups[gid] = {
                    "work_center_id": gid,
                    "work_center_code": None,
                    "work_center_name": gname,
                    "node_type": "GROUP" if m["group_id"] else "TYPE",
                    "center_type": m["center_type"],
                    "group_id": None,
                    "group_name": None,
                    "type_id": m["type_id"],
                    "type_name": m["type_name"],
                    "qty_good": 0.0, "qty_rejected": 0.0, "logs": 0, "wo_count": 0,
                    "first_log": None, "last_log": None,
                    "machine_count": 0, "active_machine_count": 0,
                    "items": [], "work_orders": [], "machines": [], "rejects": [],
                }
                node = idx.by_id.get(gid)
                g["work_center_code"] = node.code if node else None
            g["qty_good"] += m["qty_good"]
            g["qty_rejected"] += m["qty_rejected"]
            g["logs"] += m["logs"]
            g["wo_count"] += m["wo_count"]
            g["machine_count"] += 1
            if m["logs"]:
                g["active_machine_count"] += 1
            for key in ("first_log", "last_log"):
                pick = min if key == "first_log" else max
                vals = [v for v in (g[key], m[key]) if v]
                g[key] = pick(vals) if vals else None
            g["work_orders"].extend(m["work_orders"])
            g["rejects"].extend(m["rejects"])
            g["machines"].append({
                "work_center_id": m["work_center_id"],
                "work_center_code": m["work_center_code"],
                "work_center_name": m["work_center_name"],
                "qty_good": m["qty_good"],
                "qty_rejected": m["qty_rejected"],
                "logs": m["logs"],
                "wo_count": m["wo_count"],
                "yield_pct": m["yield_pct"],
                "reject_pct": m["reject_pct"],
            })
            # Merge the per-item breakdown across the group's machines.
            for it in m["items"]:
                hit = next((x for x in g["items"] if x["item_id"] == it["item_id"]), None)
                if hit is None:
                    g["items"].append(dict(it))
                else:
                    hit["qty_good"] += it["qty_good"]
                    hit["qty_rejected"] += it["qty_rejected"]
                    hit["logs"] += it["logs"]

        for g in groups.values():
            g["items"].sort(key=lambda x: -x["qty_good"])
            g["work_orders"].sort(key=lambda x: (x["last_log"] or ""), reverse=True)
            g["machines"].sort(key=lambda x: -x["qty_good"])
            g["rejects"].sort(key=lambda x: (x["logged_at"] or ""), reverse=True)
            g["yield_pct"] = _yield_pct(g["qty_good"], g["qty_rejected"])
            g["reject_pct"] = _reject_pct(g["qty_good"], g["qty_rejected"])
        rows = sorted(groups.values(), key=lambda g: (-g["qty_good"], g["work_center_name"] or ""))
    # ── Or flatten to one row per work order ─────────────────────────────────
    # The per-WO result sheet: hasil / QC reject / reject % for each order, with the
    # machine it ran on carried across. A WO's rows are already unique per machine
    # (its work center) — the merge below only folds the several (WO, item) rows a
    # multi-item MO produces, and buckets MO-level logs (no WO) by their MO.
    elif by_wo:
        wos: dict[str, dict] = {}
        for m in machine_rows:
            for w in m["work_orders"]:
                key = w["work_order_id"] or f"mo:{m['work_center_id']}:{w['mo_code']}"
                hit = wos.get(key)
                if hit is None:
                    hit = wos[key] = {
                        **{k: v for k, v in w.items() if k not in ("rejects",)},
                        "work_center_id": m["work_center_id"],
                        "work_center_code": m["work_center_code"],
                        "work_center_name": m["work_center_name"],
                        "center_type": m["center_type"],
                        "group_id": m["group_id"],
                        "group_name": m["group_name"],
                        "type_id": m["type_id"],
                        "type_name": m["type_name"],
                        "rejects": list(w["rejects"]),
                    }
                    continue
                hit["qty_good"] += w["qty_good"]
                hit["qty_rejected"] += w["qty_rejected"]
                hit["logs"] += w["logs"]
                hit["rejects"].extend(w["rejects"])
                for k in ("first_log", "last_log"):
                    pick = min if k == "first_log" else max
                    vals = [v for v in (hit[k], w[k]) if v]
                    hit[k] = pick(vals) if vals else None
        for w in wos.values():
            w["yield_pct"] = _yield_pct(w["qty_good"], w["qty_rejected"])
            w["reject_pct"] = _reject_pct(w["qty_good"], w["qty_rejected"])
            w["rejects"].sort(key=lambda x: (x["logged_at"] or ""), reverse=True)
        rows = sorted(wos.values(), key=lambda w: (w["last_log"] or ""), reverse=True)
    else:
        rows = machine_rows

    totals = {
        "qty_good": sum(m["qty_good"] for m in machine_rows),
        "qty_rejected": sum(m["qty_rejected"] for m in machine_rows),
        "logs": sum(m["logs"] for m in machine_rows),
        "wo_count": sum(m["wo_count"] for m in machine_rows),
        "machine_count": len(machine_rows),
        "active_machine_count": sum(1 for m in machine_rows if m["logs"]),
        "reject_events": len(reject_rows),
    }
    totals["yield_pct"] = _yield_pct(totals["qty_good"], totals["qty_rejected"])
    totals["reject_pct"] = _reject_pct(totals["qty_good"], totals["qty_rejected"])

    return {
        "group_by": mode if mode in ("group", "wo") else "machine",
        "start_date": _iso(start_date),
        "end_date": _iso(end_date),
        "work_center_id": str(work_center_id) if work_center_id else None,
        "group_id": str(group_id) if group_id else None,
        "wo_status": wo_statuses,
        "rows": rows,
        "totals": totals,
    }


@router.get("/reports/packing-output")
async def packing_output_report(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    status: Optional[str] = Query(None, description="Comma-separated packing order statuses"),
    group_by: str = Query("order", description="order | operator"),
    operator_user_id: Optional[uuid.UUID] = Query(None, description="Narrow to one packer"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("production_output.view")),
):
    """Packing output and QC reject, per packing order or per packer.

    The packing counterpart of `/reports/machine-output`, kept separate because a
    `PackingCompletion` carries no work center — packing can never be a grouping of
    the machine report. Columns match it (`qty_good` / `qty_rejected` / `reject_pct`)
    so the same UI renders both, with carton counts alongside the base qty.

    `group_by=operator` re-grains the same events onto the person who logged them,
    which is what a per-head output figure is read off. It groups on
    `PackingCompletion.operator_user_id` — the authenticated account — and only
    falls back to the typed `operator` text for logs written before operators had
    their own accounts, because free text splits one packer across every spelling
    of their name. Each row carries a per-day breakdown, since output is read a
    day at a time.

    Date filters apply to the **pack events**, not the order header, so an order
    that ran across the window boundary reports only what it packed inside it.
    """
    statuses = [s.strip().upper() for s in (status or "").split(",") if s.strip()]

    conds = []
    if start_date:
        conds.append(PackingCompletion.completed_at >= start_date)
    if end_date:
        conds.append(PackingCompletion.completed_at <= end_date)
    if statuses:
        conds.append(PackingOrder.status.in_(statuses))
    if operator_user_id:
        conds.append(PackingCompletion.operator_user_id == operator_user_id)

    if (group_by or "").lower() == "operator":
        return await _packing_operator_report(db, conds, start_date, end_date, statuses)

    qty_good = func.sum(case((PackingCompletion.rejected == False, PackingCompletion.qty), else_=0))  # noqa: E712
    cartons_good = func.sum(case((PackingCompletion.rejected == False, PackingCompletion.package_count), else_=0))  # noqa: E712
    qty_rej = func.sum(func.coalesce(PackingCompletion.qty_rejected, 0))
    cartons_rej = func.sum(func.coalesce(PackingCompletion.package_count_rejected, 0))

    agg = (await db.execute(
        select(
            PackingOrder.id.label("po_id"),
            PackingOrder.code.label("po_code"),
            PackingOrder.status.label("po_status"),
            PackingOrder.qty_target.label("qty_target"),
            PackingOrder.package_label.label("package_label"),
            PackingOrder.item_id.label("item_id"),
            SalesOrder.po_number.label("so_code"),
            SalesOrder.customer_name.label("customer_name"),
            qty_good.label("qty_good"),
            qty_rej.label("qty_rejected"),
            cartons_good.label("cartons"),
            cartons_rej.label("cartons_rejected"),
            func.count(PackingCompletion.id).label("logs"),
            func.min(PackingCompletion.completed_at).label("first_log"),
            func.max(PackingCompletion.completed_at).label("last_log"),
        )
        .join(PackingCompletion, PackingCompletion.packing_order_id == PackingOrder.id)
        .outerjoin(SalesOrder, PackingOrder.sales_order_id == SalesOrder.id)
        .where(and_(*conds) if conds else True)
        .group_by(
            PackingOrder.id, PackingOrder.code, PackingOrder.status, PackingOrder.qty_target,
            PackingOrder.package_label, PackingOrder.item_id, SalesOrder.po_number,
            SalesOrder.customer_name,
        )
    )).all()

    reject_rows = (await db.execute(
        select(
            PackingOrder.id.label("po_id"),
            PackingCompletion.id.label("completion_id"),
            PackingCompletion.completed_at.label("logged_at"),
            PackingCompletion.qty.label("qty_completed"),
            PackingCompletion.qty_rejected.label("qty_rejected"),
            PackingCompletion.package_count_rejected.label("cartons_rejected"),
            PackingCompletion.rejected.label("whole"),
            PackingCompletion.reject_reason.label("reason"),
            PackingCompletion.rejected_at.label("rejected_at"),
            PackingCompletion.rejected_by.label("rejected_by"),
            PackingCompletion.operator.label("operator_name"),
            PackingCompletion.reject_location_id.label("reject_location_id"),
            Location.name.label("reject_location_name"),
        )
        .join(PackingOrder, PackingCompletion.packing_order_id == PackingOrder.id)
        .outerjoin(Location, PackingCompletion.reject_location_id == Location.id)
        .where(and_(*(conds + [func.coalesce(PackingCompletion.qty_rejected, 0) > 0])))
        .order_by(PackingCompletion.completed_at.desc())
    )).all()

    item_ids = {str(r.item_id) for r in agg if r.item_id}
    items: dict[str, Item] = {}
    if item_ids:
        res = await db.execute(select(Item).where(Item.id.in_(list(item_ids))))
        items = {str(i.id): i for i in res.scalars().all()}

    rejects_by_po: dict[str, list] = {}
    for r in reject_rows:
        rejects_by_po.setdefault(str(r.po_id), []).append({
            "completion_id": str(r.completion_id),
            "logged_at": _iso(r.logged_at),
            "qty_completed": _f(r.qty_completed),
            "qty_rejected": _f(r.qty_rejected),
            "cartons_rejected": int(r.cartons_rejected or 0),
            "whole_lot": bool(r.whole),
            "reason": r.reason,
            "rejected_at": _iso(r.rejected_at),
            "rejected_by": r.rejected_by,
            "operator_name": r.operator_name,
            "reject_location_id": str(r.reject_location_id) if r.reject_location_id else None,
            "reject_location_name": r.reject_location_name,
        })

    rows = []
    for r in agg:
        good, rej = _f(r.qty_good), _f(r.qty_rejected)
        it = items.get(str(r.item_id)) if r.item_id else None
        rows.append({
            "packing_order_id": str(r.po_id),
            "po_code": r.po_code,
            "po_status": r.po_status,
            "qty_target": _f(r.qty_target),
            "package_label": r.package_label,
            "sales_order_code": r.so_code,
            "customer_name": r.customer_name,
            "item_id": str(r.item_id) if r.item_id else None,
            "item_code": it.code if it else None,
            "item_name": it.name if it else None,
            "uom": it.uom if it else None,
            "qty_good": good,
            "qty_rejected": rej,
            "cartons": int(r.cartons or 0),
            "cartons_rejected": int(r.cartons_rejected or 0),
            "yield_pct": _yield_pct(good, rej),
            "reject_pct": _reject_pct(good, rej),
            "logs": int(r.logs or 0),
            "first_log": _iso(r.first_log),
            "last_log": _iso(r.last_log),
            "rejects": rejects_by_po.get(str(r.po_id), []),
        })
    rows.sort(key=lambda x: (x["last_log"] or ""), reverse=True)

    totals = {
        "qty_good": sum(x["qty_good"] for x in rows),
        "qty_rejected": sum(x["qty_rejected"] for x in rows),
        "cartons": sum(x["cartons"] for x in rows),
        "cartons_rejected": sum(x["cartons_rejected"] for x in rows),
        "logs": sum(x["logs"] for x in rows),
        "order_count": len(rows),
        "reject_events": len(reject_rows),
    }
    totals["yield_pct"] = _yield_pct(totals["qty_good"], totals["qty_rejected"])
    totals["reject_pct"] = _reject_pct(totals["qty_good"], totals["qty_rejected"])

    return {
        "group_by": "order",
        "start_date": _iso(start_date),
        "end_date": _iso(end_date),
        "status": statuses,
        "rows": rows,
        "totals": totals,
    }


async def _packing_operator_report(
    db: AsyncSession,
    conds: list,
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    statuses: list[str],
) -> dict:
    """Packing output re-grained onto the packer, for the per-head output figure.

    Aggregated in Python off one completion-grain query rather than four GROUP BY
    round trips: the same rows feed the header totals, the per-day breakdown, the
    per-item split and the reject log, and the window is a shift or a month of
    pack events, not the whole table.

    Identity is `operator_user_id`. A log with none (written before packers had
    their own accounts) falls back to its typed name under a `name:` key and is
    flagged `has_account=False`, so a supervisor sees which output is not
    attributable to a person and fixes it at the source, rather than having it
    silently folded into someone else's total.
    """
    rows_raw = (await db.execute(
        select(
            PackingCompletion.id.label("completion_id"),
            PackingCompletion.operator_user_id.label("user_id"),
            PackingCompletion.operator.label("operator_text"),
            User.username.label("username"),
            User.full_name.label("full_name"),
            PackingCompletion.completed_at.label("logged_at"),
            PackingCompletion.qty.label("qty"),
            PackingCompletion.package_count.label("cartons"),
            PackingCompletion.rejected.label("whole"),
            PackingCompletion.qty_rejected.label("qty_rejected"),
            PackingCompletion.package_count_rejected.label("cartons_rejected"),
            PackingCompletion.reject_reason.label("reason"),
            PackingCompletion.rejected_at.label("rejected_at"),
            PackingCompletion.rejected_by.label("rejected_by"),
            PackingCompletion.reject_location_id.label("reject_location_id"),
            Location.name.label("reject_location_name"),
            PackingOrder.id.label("po_id"),
            PackingOrder.code.label("po_code"),
            PackingOrder.status.label("po_status"),
            PackingOrder.package_label.label("package_label"),
            PackingOrder.item_id.label("item_id"),
            SalesOrder.po_number.label("so_code"),
            SalesOrder.customer_name.label("customer_name"),
        )
        .join(PackingOrder, PackingCompletion.packing_order_id == PackingOrder.id)
        .outerjoin(User, PackingCompletion.operator_user_id == User.id)
        .outerjoin(SalesOrder, PackingOrder.sales_order_id == SalesOrder.id)
        .outerjoin(Location, PackingCompletion.reject_location_id == Location.id)
        .where(and_(*conds) if conds else True)
        .order_by(PackingCompletion.completed_at.desc())
    )).all()

    item_ids = {str(r.item_id) for r in rows_raw if r.item_id}
    items: dict[str, Item] = {}
    if item_ids:
        res = await db.execute(select(Item).where(Item.id.in_(list(item_ids))))
        items = {str(i.id): i for i in res.scalars().all()}

    def _bucket(seed: dict) -> dict:
        return {"qty_good": 0.0, "qty_rejected": 0.0, "cartons": 0,
                "cartons_rejected": 0, "logs": 0, **seed}

    ops: dict[str, dict] = {}
    for r in rows_raw:
        if r.user_id:
            key = str(r.user_id)
            name = r.full_name or r.username or r.operator_text or "(unknown)"
        else:
            typed = (r.operator_text or "").strip()
            key = f"name:{typed.lower()}"
            name = typed or "(unattributed)"

        op_row = ops.get(key)
        if op_row is None:
            op_row = ops[key] = {
                "operator_key": key,
                "operator_user_id": str(r.user_id) if r.user_id else None,
                "operator_name": name,
                "username": r.username,
                # False = the log names a person the report cannot peg to an
                # account. Surfaced rather than hidden: that output is only as
                # trustworthy as what someone typed into a text box.
                "has_account": bool(r.user_id),
                "orders": {}, "items": {}, "days": {}, "rejects": [],
                "first_log": None, "last_log": None,
                **_bucket({}),
            }

        # Good qty counts only non-rejected logs; scrap sums `qty_rejected` over
        # every log, because a partial reject leaves its log active with the
        # scrapped qty moved onto that column. Same rule as the machine report.
        good = 0.0 if r.whole else _f(r.qty)
        good_cartons = 0 if r.whole else int(r.cartons or 0)
        rej = _f(r.qty_rejected)
        rej_cartons = int(r.cartons_rejected or 0)

        it = items.get(str(r.item_id)) if r.item_id else None
        stamp = _iso(r.logged_at)
        day = r.logged_at.date().isoformat() if r.logged_at else "-"

        for bucket, bkey, seed in (
            (op_row["items"], str(r.item_id) if r.item_id else "?", {
                "item_id": str(r.item_id) if r.item_id else None,
                "item_code": it.code if it else None,
                "item_name": it.name if it else None,
                "uom": it.uom if it else None,
            }),
            (op_row["orders"], str(r.po_id), {
                "packing_order_id": str(r.po_id),
                "po_code": r.po_code,
                "po_status": r.po_status,
                "package_label": r.package_label,
                "item_code": it.code if it else None,
                "item_name": it.name if it else None,
                "uom": it.uom if it else None,
                "sales_order_code": r.so_code,
                "customer_name": r.customer_name,
                "last_log": None,
            }),
            (op_row["days"], day, {"date": day, "last_log": None}),
        ):
            b = bucket.get(bkey)
            if b is None:
                b = bucket[bkey] = _bucket(dict(seed))
            b["qty_good"] += good
            b["qty_rejected"] += rej
            b["cartons"] += good_cartons
            b["cartons_rejected"] += rej_cartons
            b["logs"] += 1
            if "last_log" in b and stamp and (b["last_log"] or "") < stamp:
                b["last_log"] = stamp

        op_row["qty_good"] += good
        op_row["qty_rejected"] += rej
        op_row["cartons"] += good_cartons
        op_row["cartons_rejected"] += rej_cartons
        op_row["logs"] += 1
        if stamp:
            if op_row["first_log"] is None or stamp < op_row["first_log"]:
                op_row["first_log"] = stamp
            if op_row["last_log"] is None or stamp > op_row["last_log"]:
                op_row["last_log"] = stamp

        if rej > 0:
            op_row["rejects"].append({
                "completion_id": str(r.completion_id),
                "logged_at": stamp,
                "po_code": r.po_code,
                "qty_completed": _f(r.qty),
                "qty_rejected": rej,
                "cartons_rejected": rej_cartons,
                "whole_lot": bool(r.whole),
                "reason": r.reason,
                "rejected_at": _iso(r.rejected_at),
                "rejected_by": r.rejected_by,
                "operator_name": r.operator_text,
                "reject_location_id": str(r.reject_location_id) if r.reject_location_id else None,
                "reject_location_name": r.reject_location_name,
            })

    def _finish(bucket: dict) -> list:
        out = []
        for b in bucket.values():
            b["reject_pct"] = _reject_pct(b["qty_good"], b["qty_rejected"])
            b["yield_pct"] = _yield_pct(b["qty_good"], b["qty_rejected"])
            out.append(b)
        return out

    rows = []
    for op_row in ops.values():
        op_row["items"] = sorted(_finish(op_row["items"]), key=lambda x: -x["qty_good"])
        op_row["orders"] = sorted(_finish(op_row["orders"]), key=lambda x: (x["last_log"] or ""), reverse=True)
        # Ascending: a pay period is read oldest day first.
        op_row["days"] = sorted(_finish(op_row["days"]), key=lambda x: x["date"])
        op_row["order_count"] = len(op_row["orders"])
        # Days that actually produced, not days in the window — the denominator a
        # per-day rate is read against.
        op_row["days_active"] = len(op_row["days"])
        op_row["qty_per_day"] = (
            round(op_row["qty_good"] / op_row["days_active"], 3) if op_row["days_active"] else None
        )
        op_row["reject_pct"] = _reject_pct(op_row["qty_good"], op_row["qty_rejected"])
        op_row["yield_pct"] = _yield_pct(op_row["qty_good"], op_row["qty_rejected"])
        rows.append(op_row)
    rows.sort(key=lambda x: -x["qty_good"])

    totals = {
        "qty_good": sum(x["qty_good"] for x in rows),
        "qty_rejected": sum(x["qty_rejected"] for x in rows),
        "cartons": sum(x["cartons"] for x in rows),
        "cartons_rejected": sum(x["cartons_rejected"] for x in rows),
        "logs": sum(x["logs"] for x in rows),
        "operator_count": len(rows),
        "order_count": len({o["packing_order_id"] for x in rows for o in x["orders"]}),
        "reject_events": sum(len(x["rejects"]) for x in rows),
        "unattributed_count": sum(1 for x in rows if not x["has_account"]),
    }
    totals["yield_pct"] = _yield_pct(totals["qty_good"], totals["qty_rejected"])
    totals["reject_pct"] = _reject_pct(totals["qty_good"], totals["qty_rejected"])

    return {
        "group_by": "operator",
        "start_date": _iso(start_date),
        "end_date": _iso(end_date),
        "status": statuses,
        "rows": rows,
        "totals": totals,
    }


class ProductionOutputExport(BaseModel):
    sheet: str = Field(max_length=64)
    filename: str = Field(max_length=128)
    header: list[str]
    rows: list[list[str | float | int | None]]


@router.post("/reports/production-output/export")
async def export_production_output(
    payload: ProductionOutputExport,
    current_user: User = Depends(require_permission("production_output.export")),
):
    """The report grid as an .xlsx, laid out by the client's own column definitions.

    Each grouping (machine / group / WO / packing / operator) renders a
    different column set with client-side formatting; rebuilding those here would
    let the file drift from the screen. So the client posts exactly the rows it
    shows and this only renders them — gated on the export grant, same as before.
    """
    return xlsx_response(payload.sheet, payload.header, payload.rows, payload.filename)
