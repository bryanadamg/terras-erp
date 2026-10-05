from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, cast, String, func, update, delete
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import date, datetime
from math import ceil
import uuid

from app.db.session import get_async_db
from app.models.weaving import WeavingRun, WeavingRunPause, WorkCenterHoliday
from app.models.routing import WorkCenter
from app.models.manufacturing import ManufacturingOrder
from app.models.work_order import WorkOrder
from app.models.batch import Batch, BeamMount
from app.models.stock_balance import StockBalance
from app.models.item import Item
from app.models.attribute import AttributeValue
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.schemas import (
    WeavingRunCreate, WeavingRunUpdate, WeavingRunResponse,
    WorkCenterHolidayCreate, WorkCenterHolidayResponse, WorkCenterCalendarUpdate,
    WorkCenterGroupCalendarUpdate, LoomPrepUpdate, WeavingRunPauseRequest,
)
from app.services import (
    audit_service, weaving_service, id_holidays, work_center_service, stock_service,
    beam_service, mo_variant_service,
)
from app.core.ws_manager import manager

router = APIRouter()

DEFAULT_WEEKDAYS = [0, 1, 2, 3, 4]

ACTIVE_RUN_STATUSES = weaving_service.ACTIVE_RUN_STATUSES


async def _load_calendar(db: AsyncSession, wc: WorkCenter):
    """Return (weekdays:list[int], holidays:list[date]) for a work center."""
    weekdays = wc.working_weekdays if wc.working_weekdays else DEFAULT_WEEKDAYS
    res = await db.execute(
        select(WorkCenterHoliday.holiday_date).where(WorkCenterHoliday.work_center_id == wc.id)
    )
    holidays = [r[0] for r in res.all()]
    return weekdays, holidays


async def _get_wc(db: AsyncSession, wc_id: str) -> WorkCenter:
    res = await db.execute(select(WorkCenter).where(WorkCenter.id == wc_id))
    wc = res.scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")
    return wc


async def _run_actual_kg(db: AsyncSession, run: WeavingRun) -> float:
    if run.actual_qty_override is not None:
        return float(run.actual_qty_override)
    return await weaving_service.sum_actual_kg(
        db, run.work_center_id, run.mo_id, run.start_date, run.end_date
    )


async def _pauses_by_run(db: AsyncSession, run_ids) -> dict:
    """Pause intervals keyed by run id, in one query for the whole grid."""
    ids = list(run_ids)
    if not ids:
        return {}
    res = await db.execute(
        select(WeavingRunPause)
        .where(WeavingRunPause.run_id.in_(ids))
        .order_by(WeavingRunPause.paused_on)
    )
    out: dict = {}
    for p in res.scalars().all():
        out.setdefault(p.run_id, []).append(p)
    return out


CLOSED_MO_STATUSES = ("COMPLETED", "CANCELLED")


async def _loom_status(db: AsyncSession, wc: WorkCenter) -> str:
    """Derived prep state of one loom — same definition as the monitor grid."""
    has_run = bool((await db.execute(
        select(WeavingRun.id)
        .where(WeavingRun.work_center_id == wc.id,
               WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
        .limit(1)
    )).first())
    pcs = await beam_service.mounted_pcs(db, wc.id)
    return weaving_service.derive_loom_status(wc.prep_status, pcs, wc.beam_slots, has_run)


# Variant labels need the MO's attribute values *and* their attribute (for
# system_role). Used by both the monitor grid and the per-machine report.
MO_VARIANT_LOADS = (
    selectinload(WeavingRun.mo)
    .selectinload(ManufacturingOrder.attribute_values)
    .joinedload(AttributeValue.attribute)
)


@router.get("/work-centers/{wc_id}/candidate-mos")
async def work_center_candidate_mos(
    wc_id: str,
    include_all: bool = Query(False, description="Ignore the machine link and list every open MO"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("weaving_monitor.view", "work_order.view")),
):
    """Open MOs a run can be started against on this machine.

    A run is monitored per loom, so the picker must only offer the MOs actually
    dispatched there — i.e. MOs with a WorkOrder assigned to this work center.
    `include_all=true` is the deliberate escape hatch for a machine with no WO
    assigned yet (the frontend surfaces it as a link, not the default).
    """
    await _get_wc(db, wc_id)
    q = (
        select(ManufacturingOrder)
        .options(selectinload(ManufacturingOrder.item))
        .where(ManufacturingOrder.status.notin_(CLOSED_MO_STATUSES))
    )
    if not include_all:
        q = q.where(
            select(WorkOrder.id)
            .where(WorkOrder.manufacturing_order_id == ManufacturingOrder.id)
            .where(WorkOrder.work_center_id == wc_id)
            .exists()
        )
    q = q.order_by(ManufacturingOrder.created_at.desc()).limit(200)
    mos = (await db.execute(q)).scalars().all()
    return {
        "work_center_id": wc_id,
        "machine_linked": not include_all,
        "items": [
            {
                "id": str(mo.id),
                "code": mo.code,
                "item_code": mo.item_code,
                "item_name": mo.item_name,
                "qty": float(mo.qty or 0),
                "status": mo.status,
            }
            for mo in mos
        ],
    }


CLOSED_WO_STATUSES = ("COMPLETED", "CANCELLED")


@router.get("/work-centers/{wc_id}/candidate-wos")
async def work_center_candidate_wos(
    wc_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("weaving_monitor.view", "work_order.view")),
):
    """Open WOs dispatched to this machine — the natural unit to start a run on.

    A loom commonly weaves the same item for two combos at the same time; those are
    two WOs with two line counts and two promised end dates, so the picker offers
    WOs, not MOs. `target_end_date` rides along because it is the baseline the
    completion projection is warned against.
    """
    await _get_wc(db, wc_id)
    res = await db.execute(
        select(WorkOrder)
        .options(
            # item is required: MO.item_code/item_name are properties that read it,
            # and a lazy load inside an async route raises MissingGreenlet.
            selectinload(WorkOrder.manufacturing_order).selectinload(ManufacturingOrder.item),
            selectinload(WorkOrder.manufacturing_order)
            .selectinload(ManufacturingOrder.attribute_values)
            .joinedload(AttributeValue.attribute),
        )
        .where(WorkOrder.work_center_id == wc_id)
        .where(WorkOrder.status.notin_(CLOSED_WO_STATUSES))
        .order_by(WorkOrder.created_at.desc())
        .limit(200)
    )
    wos = res.scalars().all()

    running = {
        r[0] for r in (await db.execute(
            select(WeavingRun.work_order_id)
            .where(WeavingRun.work_center_id == wc_id)
            .where(WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
            .where(WeavingRun.work_order_id.is_not(None))
        )).all()
    }

    return {
        "work_center_id": wc_id,
        "items": [
            {
                "id": str(wo.id),
                "code": wo.code,
                "name": wo.name,
                "status": wo.status,
                "qty": float(wo.qty) if wo.qty is not None else None,
                "target_end_date": wo.target_end_date,
                "mo_id": str(wo.manufacturing_order_id),
                "mo_code": wo.manufacturing_order.code if wo.manufacturing_order else None,
                "item_code": wo.manufacturing_order.item_code if wo.manufacturing_order else None,
                "item_name": wo.manufacturing_order.item_name if wo.manufacturing_order else None,
                # Already running here: the picker greys it out instead of letting the
                # operator hit the duplicate guard on submit.
                "already_running": wo.id in running,
                **mo_variant_service.variant_labels(wo.manufacturing_order),
            }
            for wo in wos
        ],
    }


# ── Weaving runs ─────────────────────────────────────────────────────────────

@router.post("/weaving-runs", response_model=WeavingRunResponse)
async def create_weaving_run(
    payload: WeavingRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('weaving_monitor.start')),
):
    # A loom runs several WOs of the same item side by side (one per combo), each
    # with its own line count, so the run is keyed on the WO when one is given. The
    # MO is derived from it — never taken on trust from the caller.
    wo = None
    mo_id = payload.mo_id
    if payload.work_order_id:
        wo_res = await db.execute(select(WorkOrder).where(WorkOrder.id == payload.work_order_id))
        wo = wo_res.scalars().first()
        if not wo:
            raise HTTPException(status_code=404, detail="Work Order not found")
        if wo.work_center_id and str(wo.work_center_id) != str(payload.work_center_id):
            raise HTTPException(status_code=422, detail="Work Order is dispatched to another machine")
        if mo_id and str(mo_id) != str(wo.manufacturing_order_id):
            raise HTTPException(status_code=422, detail="Work Order does not belong to that manufacturing order")
        mo_id = wo.manufacturing_order_id
    if not mo_id:
        raise HTTPException(status_code=422, detail="Pass a work_order_id or an mo_id")

    wc = await _get_wc(db, str(payload.work_center_id))
    mo_res = await db.execute(select(ManufacturingOrder).where(ManufacturingOrder.id == mo_id))
    mo = mo_res.scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    # Parallel runs are the point, double-counting the same order is not: the same WO
    # (or, WO-less, the same MO) may only be active once on a machine, else two runs
    # would each claim the whole of that order's logged output. A PAUSED run counts —
    # the order is parked, not finished; resume it instead of starting a second one.
    dup_q = (
        select(WeavingRun.id)
        .where(WeavingRun.work_center_id == wc.id)
        .where(WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
    )
    if wo:
        dup_q = dup_q.where(WeavingRun.work_order_id == wo.id)
    else:
        dup_q = dup_q.where(WeavingRun.mo_id == mo_id, WeavingRun.work_order_id.is_(None))
    if (await db.execute(dup_q.limit(1))).first():
        raise HTTPException(
            status_code=400,
            detail=f"A run for {wo.code if wo else mo.code} is already active on {wc.code}",
        )

    # Start is the LAST step of the floor sequence: warp staged → Draw-in → Tuning →
    # Start. Gated only once prep has actually begun (the loom is staged), so a
    # machine whose warp is not tracked in the ERP still starts as before. A loom
    # already RUNNING reports RUNNING, so adding a second WO to it is never gated.
    prep = await _loom_status(db, wc)
    if prep in (weaving_service.LOOM_STATUS_STAGED, weaving_service.LOOM_STATUS_DRAW_IN):
        pending = "Draw-in" if prep == weaving_service.LOOM_STATUS_STAGED else "Tuning"
        raise HTTPException(
            status_code=422,
            detail=f"Loom is {prep}: complete {pending} before starting the run",
        )

    run = WeavingRun(
        work_center_id=payload.work_center_id,
        mo_id=mo_id,
        work_order_id=wo.id if wo else None,
        lines=payload.lines,
        rate_per_line_g_min=payload.rate_per_line_g_min,
        target_efficiency_pct=payload.target_efficiency_pct,
        start_date=payload.start_date,
        notes=payload.notes,
        status="RUNNING",
    )
    db.add(run)
    # The prep walk is spent once the run starts: clear it so that when this run
    # stops the loom reports its warp state again (STAGED / IDLE), not a stale
    # "Tuning" from the previous shift.
    wc.prep_status = None
    wc.prep_status_at = datetime.utcnow()
    wc.prep_status_by = current_user.username
    await db.commit()
    await db.refresh(run)

    await audit_service.log_activity(
        db, current_user.id, "CREATE", "WeavingRun", str(run.id),
        details=f"Start run {wo.code if wo else mo.code} on {wc.code} ({payload.lines} lines)",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "start", "work_center_id": str(wc.id)})
    return run


@router.patch("/weaving-runs/{run_id}", response_model=WeavingRunResponse)
async def update_weaving_run(
    run_id: str,
    payload: WeavingRunUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.edit')),
):
    res = await db.execute(select(WeavingRun).where(WeavingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Weaving run not found")

    data = payload.model_dump(exclude_unset=True)
    # PAUSED is not a plain column write — it owns a WeavingRunPause interval, and a
    # status set from here would leave that interval missing (or stuck open), silently
    # corrupting elapsed working days. Editing a paused run's lines/rate stays fine;
    # only crossing into or out of PAUSED has to go through the dedicated endpoints.
    new_status = str(data.get("status") or "").upper() or run.status
    if new_status != run.status and "PAUSED" in (new_status, run.status):
        raise HTTPException(
            status_code=422,
            detail="Use /pause and /resume to change a run's paused state",
        )
    for field, value in data.items():
        setattr(run, field, value)
    await db.commit()
    await db.refresh(run)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WeavingRun", str(run.id),
        details="Updated weaving run", changes=data,
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "update", "work_center_id": str(run.work_center_id)})
    return run


@router.post("/weaving-runs/{run_id}/pause", response_model=WeavingRunResponse)
async def pause_weaving_run(
    run_id: str,
    payload: WeavingRunPauseRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('weaving_monitor.stop')),
):
    """Park a run without closing it.

    A loom runs several WOs at once and the floor reprioritises — push one order, park
    the rest. From today the parked run stops accruing elapsed working days, so it
    holds the efficiency it earned on the loom instead of decaying for days nobody
    ever meant to weave it. Its projected completion date keeps sliding, which is the
    honest cost of the decision.
    """
    res = await db.execute(select(WeavingRun).where(WeavingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Weaving run not found")
    if run.status != "RUNNING":
        raise HTTPException(
            status_code=422, detail=f"Only a running run can be paused (it is {run.status})",
        )

    run.status = "PAUSED"
    db.add(WeavingRunPause(
        run_id=run.id,
        paused_on=date.today(),
        reason=(payload.reason or None),
        paused_by=current_user.username,
    ))
    await db.commit()
    await db.refresh(run)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WeavingRun", str(run.id),
        details=f"Paused weaving run{f': {payload.reason}' if payload.reason else ''}",
        changes={"status": "PAUSED", "reason": payload.reason},
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "pause", "work_center_id": str(run.work_center_id)})
    return run


@router.post("/weaving-runs/{run_id}/resume", response_model=WeavingRunResponse)
async def resume_weaving_run(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('weaving_monitor.stop')),
):
    """Put a parked run back on the loom. Today counts as woven again."""
    res = await db.execute(select(WeavingRun).where(WeavingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Weaving run not found")
    if run.status != "PAUSED":
        raise HTTPException(
            status_code=422, detail=f"Only a paused run can be resumed (it is {run.status})",
        )

    run.status = "RUNNING"
    pause = await weaving_service.open_pause(db, run.id)
    if pause:
        # Resuming today means today is worked again, so the interval closes on today
        # and paused_working_days excludes up to yesterday.
        pause.resumed_on = date.today()
        pause.resumed_by = current_user.username
    await db.commit()
    await db.refresh(run)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WeavingRun", str(run.id),
        details="Resumed weaving run", changes={"status": "RUNNING"},
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "resume", "work_center_id": str(run.work_center_id)})
    return run


@router.post("/weaving-runs/{run_id}/stop", response_model=WeavingRunResponse)
async def stop_weaving_run(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('weaving_monitor.stop')),
):
    res = await db.execute(select(WeavingRun).where(WeavingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Weaving run not found")
    await weaving_service.stop_run(db, run, username=current_user.username)
    await db.commit()
    await db.refresh(run)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WeavingRun", str(run.id), details="Stopped weaving run",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "stop", "work_center_id": str(run.work_center_id)})
    return run


@router.delete("/weaving-runs/{run_id}")
async def delete_weaving_run(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.edit')),
):
    res = await db.execute(select(WeavingRun).where(WeavingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Weaving run not found")
    wc_id = str(run.work_center_id)
    await db.delete(run)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "WeavingRun", run_id, details="Deleted weaving run",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "delete", "work_center_id": wc_id})
    return {"status": "success"}


# ── Loom prep steps (Draw-in / Tuning) ──────────────────────────────────────

@router.post("/work-centers/{wc_id}/loom-prep")
async def set_loom_prep(
    wc_id: str,
    payload: LoomPrepUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('weaving_monitor.start')),
):
    """Advance a loom through the manual prep steps: STAGED → DRAW_IN → TUNING.

    Only these two steps are stored; STAGED/IDLE/RUNNING are derived, so the
    transition is validated against the derived state, not against the column.
    `status: null` resets a loom back to STAGED after a mis-click.
    """
    wc = await _get_wc(db, wc_id)
    target = (payload.status or "").strip().upper() or None
    current = await _loom_status(db, wc)
    err = weaving_service.prep_transition_error(target, current)
    if err:
        raise HTTPException(status_code=422, detail=err)

    wc.prep_status = target
    wc.prep_status_at = datetime.utcnow()
    wc.prep_status_by = current_user.username
    await db.commit()

    new_status = await _loom_status(db, wc)
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WorkCenterLoomPrep", str(wc.id),
        details=f"Loom {wc.code}: {current} → {new_status}",
        changes={"prep_status": target},
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "prep", "work_center_id": str(wc.id)})
    return {
        "work_center_id": str(wc.id),
        "loom_status": new_status,
        "next_loom_step": weaving_service.next_loom_step(new_status),
        "prep_status": wc.prep_status,
        "prep_status_at": wc.prep_status_at,
        "prep_status_by": wc.prep_status_by,
    }


# ── Monitor grid (all weaving machines, at a glance) ────────────────────────

def _paused_since(pauses) -> Optional[date]:
    """Date the run was parked, for the card's "paused since" line."""
    return next((p.paused_on for p in (pauses or []) if p.resumed_on is None), None)


def _run_card(run: WeavingRun, metrics: dict, projection: Optional[dict],
              pauses=None) -> dict:
    """One run as the grid and the modal both read it.

    The completion dates are flattened onto the card (not left inside `projection`)
    because the loom card shows the late warning without opening anything.
    """
    mo = run.mo
    wo = run.work_order
    proj = projection or {}
    paused_on = _paused_since(pauses)
    return {
        "id": str(run.id),
        "work_order_id": str(run.work_order_id) if run.work_order_id else None,
        "wo_code": wo.code if wo else proj.get("wo_code"),
        "mo_id": str(run.mo_id),
        "mo_code": mo.code if mo else None,
        "item_code": mo.item_code if mo else None,
        "item_name": mo.item_name if mo else None,
        "target_qty": float(mo.qty) if mo else None,
        "wo_qty": proj.get("wo_qty"),
        "status": run.status,
        "start_date": run.start_date,
        **mo_variant_service.variant_labels(mo),
        **{k: metrics[k] for k in (
            "efficiency_pct", "target_efficiency_pct", "on_target", "actual_kg",
            "theoretical_100_kg", "actual_daily_rate_kg", "elapsed_working_days", "lines",
            "paused_working_days", "is_paused",
        )},
        "paused_on": paused_on,
        # The three dates + the warning, straight on the card.
        "wo_target_end_date": proj.get("wo_target_end_date"),
        "target_completion_date": proj.get("target_completion_date"),
        "reality_completion_date": proj.get("reality_completion_date"),
        "baseline_date": proj.get("baseline_date"),
        "baseline_basis": proj.get("baseline_basis"),
        "is_late": bool(proj.get("is_late")),
        "days_late": proj.get("days_late", 0),
        "reality_unreachable": bool(proj.get("reality_unreachable")),
        "projection": projection,
    }


def _machine_payload(wc: WorkCenter, runs: list, actuals: dict, weekdays, holidays,
                     today: date, projections: dict, pauses_by_run: dict) -> dict:
    """A loom card. `active_runs` is a LIST — one loom commonly runs two combos at
    once — and `active_run` stays as the first of them for callers that only show one.
    """
    cards = []
    for run in runs:
        pauses = pauses_by_run.get(run.id, [])
        m = weaving_service.compute_run_metrics(
            run, actuals.get(run.id, 0.0), weekdays, holidays, today, pauses=pauses)
        cards.append(_run_card(run, m, projections.get(run.id), pauses))
    return {
        "id": str(wc.id), "code": wc.code, "name": wc.name, "center_type": wc.center_type,
        "active_runs": cards,
        "active_run": cards[0] if cards else None,
        "late_runs": sum(1 for c in cards if c["is_late"]),
        "paused_runs": sum(1 for c in cards if c["is_paused"]),
    }


@router.get("/weaving/monitor")
async def weaving_monitor(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("weaving_monitor.view", "work_order.view")),
):
    today = date.today()
    # Leaves only. `parent_id IS NOT NULL` used to identify a machine, but with the
    # optional GROUP tier a group also has a parent — node_type is the only reliable
    # discriminator.
    res = await db.execute(
        select(WorkCenter)
        .where(WorkCenter.center_type == "WEAVING")
        .where(func.upper(WorkCenter.node_type) == "MACHINE")
        .order_by(WorkCenter.code)
    )
    machines = res.scalars().all()
    if not machines:
        return {"machines": [], "total": 0, "running": 0, "groups": [], "avg_efficiency_pct": None}

    machine_ids = [wc.id for wc in machines]

    # Group each machine sits in (nearest GROUP ancestor). One query for the whole
    # non-machine tree, then walk up in memory — the tree is tiny.
    node_res = await db.execute(
        select(WorkCenter.id, WorkCenter.code, WorkCenter.name, WorkCenter.parent_id, WorkCenter.node_type)
        .where(func.upper(WorkCenter.node_type) != "MACHINE")
    )
    nodes = {r.id: r for r in node_res.all()}

    def group_for(wc: WorkCenter):
        seen = set()
        pid = wc.parent_id
        while pid is not None and pid not in seen:
            seen.add(pid)
            node = nodes.get(pid)
            if node is None:
                return None
            if (node.node_type or "").upper() == "GROUP":
                return node
            pid = node.parent_id
        return None

    # Batch holidays for every machine in one query instead of one query per
    # machine (_load_calendar was called per-wc in a loop before this).
    hol_res = await db.execute(
        select(WorkCenterHoliday.work_center_id, WorkCenterHoliday.holiday_date)
        .where(WorkCenterHoliday.work_center_id.in_(machine_ids))
    )
    holidays_by_wc: dict = {}
    for wc_id, hdate in hol_res.all():
        holidays_by_wc.setdefault(wc_id, []).append(hdate)

    # Batch the active runs per machine in one query instead of one query per machine.
    # ALL of them, not the newest: a loom weaving the same item for two combos has one
    # run per WO, and hiding the second made the grid under-report what the floor is
    # actually doing. PAUSED runs are included — parked, not gone (ACTIVE_RUN_STATUSES).
    run_res = await db.execute(
        select(WeavingRun)
        .options(
            selectinload(WeavingRun.mo).selectinload(ManufacturingOrder.item),
            selectinload(WeavingRun.work_order),
            MO_VARIANT_LOADS,
        )
        .where(WeavingRun.work_center_id.in_(machine_ids))
        .where(WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
        .order_by(WeavingRun.work_center_id, WeavingRun.created_at.desc())
    )
    runs_by_wc: dict = {}
    all_active_runs: list = []
    for run in run_res.scalars().all():
        runs_by_wc.setdefault(run.work_center_id, []).append(run)
        all_active_runs.append(run)

    # Actuals once per run, then reused by both the per-run metrics and the
    # projection rollup below.
    actuals = {run.id: await _run_actual_kg(db, run) for run in all_active_runs}
    pauses_by_run = await _pauses_by_run(db, [r.id for r in all_active_runs])
    projections = await _project_runs(db, all_active_runs, today, actuals)

    # Warp up on each loom. A beam is a machine resource shared by every WO that
    # runs there, so "what is mounted" is a property of the machine and belongs on
    # its card. Batched with the remaining-kg balance in one query — one round trip
    # for the whole grid, not one per loom.
    mount_res = await db.execute(
        # Beam ends: per-beam value wins, else the item default — same fallback as
        # _mount_out in api/work_orders.py, so the loom card and the WO screen never
        # disagree about how many ends are up.
        select(BeamMount, Batch.batch_number, func.coalesce(Batch.ends, Item.ends), StockBalance.qty)
        .join(Batch, BeamMount.batch_id == Batch.id)
        .join(Item, BeamMount.item_id == Item.id)
        .outerjoin(
            StockBalance,
            and_(
                StockBalance.item_id == BeamMount.item_id,
                StockBalance.location_id == BeamMount.location_id,
                StockBalance.variant_key == "",
                StockBalance.batch_key == cast(BeamMount.batch_id, String),
            ),
        )
        .where(BeamMount.work_center_id.in_(machine_ids), BeamMount.dismounted_at.is_(None))
        .order_by(BeamMount.work_center_id, BeamMount.mounted_at)
    )
    beams_by_wc: dict = {}
    for mount, beam_number, ends, qty in mount_res.all():
        beams_by_wc.setdefault(mount.work_center_id, []).append({
            "mount_id": str(mount.id),
            "batch_id": str(mount.batch_id),
            "beam_number": beam_number,
            "ends": ends,
            "remaining": float(qty or 0),
            "mounted_at": mount.mounted_at,
            "mounted_by": mount.mounted_by,
        })

    out = []
    for wc in machines:
        weekdays = wc.working_weekdays if wc.working_weekdays else DEFAULT_WEEKDAYS
        holidays = holidays_by_wc.get(wc.id, [])
        runs = runs_by_wc.get(wc.id, [])
        payload = _machine_payload(wc, runs, actuals, weekdays, holidays, today,
                                   projections, pauses_by_run)
        beams = beams_by_wc.get(wc.id, [])
        payload["beam_slots"] = max(1, int(wc.beam_slots or 1))
        payload["mounted_beams"] = beams
        payload["mounted_pcs"] = sum(1 for b in beams if b["remaining"] > 1e-9)
        payload["mounted_kg"] = sum(b["remaining"] for b in beams)
        # Card state: IDLE → STAGED (warp up) → DRAW_IN → TUNING → RUNNING. Derived
        # from the batched data already loaded above — no extra query per loom.
        payload["loom_status"] = weaving_service.derive_loom_status(
            wc.prep_status, payload["mounted_pcs"], payload["beam_slots"], bool(runs),
        )
        payload["next_loom_step"] = weaving_service.next_loom_step(payload["loom_status"])
        payload["prep_status"] = wc.prep_status
        payload["prep_status_at"] = wc.prep_status_at
        payload["prep_status_by"] = wc.prep_status_by
        grp = group_for(wc)
        payload["group_id"] = str(grp.id) if grp else None
        payload["group_code"] = grp.code if grp else None
        payload["group_name"] = grp.name if grp else None
        payload["working_weekdays"] = weekdays
        payload["holiday_count"] = len(holidays)
        out.append(payload)

    # Group index for the monitor's section headers + batch calendar action.
    groups: list[dict] = []
    seen_groups: set = set()
    for m in out:
        if m["group_id"] and m["group_id"] not in seen_groups:
            seen_groups.add(m["group_id"])
            groups.append({"id": m["group_id"], "code": m["group_code"], "name": m["group_name"]})
    groups.sort(key=lambda g: (g["code"] or ""))

    # "running" counts LOOMS actually weaving something, not runs — it sits next to
    # the machine total in the header. A loom whose every run is parked does NOT count
    # here even though its card still reads RUNNING: loom_status answers "is the warp
    # up and prep spent" (which gates the prep buttons), this answers "is cloth coming
    # off it". Runs, paused runs and late runs are counted separately.
    running = sum(1 for m in out if any(not c["is_paused"] for c in m["active_runs"]))
    run_cards = [c for m in out for c in m["active_runs"]]
    effs = [c["efficiency_pct"] for c in run_cards if c["efficiency_pct"] is not None]
    avg_eff = round(sum(effs) / len(effs), 1) if effs else None
    return {
        "machines": out, "total": len(out), "running": running, "groups": groups,
        "avg_efficiency_pct": avg_eff,
        "active_runs": len(run_cards),
        "late_runs": sum(1 for c in run_cards if c["is_late"]),
        "paused_runs": sum(1 for c in run_cards if c["is_paused"]),
    }


@router.get("/weaving/id-holidays")
async def id_national_holidays(
    year: int = Query(...),
    current_user: User = Depends(require_any_permission("calendar.view", "weaving_monitor.view")),
):
    return {"year": year, "holidays": id_holidays.holidays_for_year(year)}


# ── Performance report ───────────────────────────────────────────────────────

async def _run_payload(db: AsyncSession, run: WeavingRun, weekdays, holidays, today: date,
                       projection: Optional[dict] = None, pauses=None) -> dict:
    actual = await _run_actual_kg(db, run)
    metrics = weaving_service.compute_run_metrics(
        run, actual, weekdays, holidays, today, pauses=pauses)
    mo = run.mo
    wo = run.work_order
    proj = projection or {}
    return {
        "id": str(run.id),
        "work_center_id": str(run.work_center_id),
        "mo_id": str(run.mo_id),
        "mo_code": mo.code if mo else None,
        "item_code": mo.item_code if mo else None,
        "item_name": mo.item_name if mo else None,
        "target_qty": float(mo.qty) if mo else None,
        "work_order_id": str(run.work_order_id) if run.work_order_id else None,
        "wo_code": wo.code if wo else proj.get("wo_code"),
        "wo_qty": float(wo.qty) if (wo and wo.qty is not None) else proj.get("wo_qty"),
        "wo_target_end_date": proj.get("wo_target_end_date"),
        "target_completion_date": proj.get("target_completion_date"),
        "reality_completion_date": proj.get("reality_completion_date"),
        "baseline_date": proj.get("baseline_date"),
        "baseline_basis": proj.get("baseline_basis"),
        "is_late": bool(proj.get("is_late")),
        "days_late": proj.get("days_late", 0),
        "reality_unreachable": bool(proj.get("reality_unreachable")),
        "projection": projection,
        **mo_variant_service.variant_labels(mo),
        "start_date": run.start_date,
        "end_date": run.end_date,
        "status": run.status,
        "actual_qty_override": float(run.actual_qty_override) if run.actual_qty_override is not None else None,
        "notes": run.notes,
        "paused_on": _paused_since(pauses),
        # Full interval history: the modal answers "which days, and why" for a slip.
        "pause_history": [
            {
                "id": str(p.id), "paused_on": p.paused_on, "resumed_on": p.resumed_on,
                "reason": p.reason, "paused_by": p.paused_by, "resumed_by": p.resumed_by,
            }
            for p in (pauses or [])
        ],
        **metrics,
    }


@router.get("/work-centers/{wc_id}/performance")
async def work_center_performance(
    wc_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("weaving_monitor.view", "work_order.view")),
):
    wc = await _get_wc(db, wc_id)
    weekdays, holidays = await _load_calendar(db, wc)
    today = date.today()

    res = await db.execute(
        select(WeavingRun)
        .options(
            selectinload(WeavingRun.mo).selectinload(ManufacturingOrder.item),
            selectinload(WeavingRun.work_order),
            MO_VARIANT_LOADS,
        )
        .where(WeavingRun.work_center_id == wc.id)
        .order_by(WeavingRun.created_at.desc())
    )
    runs = res.scalars().all()

    # Every active run, not the newest one: a loom carries one run per WO. PAUSED ones
    # belong here — the modal is where they get resumed.
    active = [r for r in runs if r.status in ACTIVE_RUN_STATUSES]
    projections = await _project_runs(db, active, today)
    pauses_by_run = await _pauses_by_run(db, [r.id for r in runs])
    active_payloads = [
        await _run_payload(db, r, weekdays, holidays, today, projections.get(r.id),
                           pauses_by_run.get(r.id, []))
        for r in active
    ]
    active_ids = {r.id for r in active}

    history = [
        await _run_payload(db, r, weekdays, holidays, today,
                           pauses=pauses_by_run.get(r.id, []))
        for r in runs if r.id not in active_ids
    ]

    hol_rows_res = await db.execute(
        select(WorkCenterHoliday).where(WorkCenterHoliday.work_center_id == wc.id)
        .order_by(WorkCenterHoliday.holiday_date)
    )
    holiday_rows = hol_rows_res.scalars().all()

    return {
        "work_center": {
            "id": str(wc.id), "code": wc.code, "name": wc.name, "center_type": wc.center_type,
        },
        "calendar": {"working_weekdays": weekdays, "holidays": [
            WorkCenterHolidayResponse.model_validate(h) for h in holiday_rows
        ]},
        "active_run": active_payloads[0] if active_payloads else None,
        "active_runs": active_payloads,
        # Kept for callers that only ever read one projection; it is the first active
        # run's, and each entry of `active_runs` carries its own under `projection`.
        "mo_projection": active_payloads[0]["projection"] if active_payloads else None,
        "history": history,
    }


async def _project_runs(db: AsyncSession, runs: list, today: date, actual_by_run: Optional[dict] = None) -> dict:
    """Completion projection for each of `runs`, keyed by run id.

    Three dates, which is the whole ask: the WO's promised end date (entered when the
    WO was created), the date the run's TARGET rate would land on, and the date the
    rate actually being achieved lands on. Comparing the last against the first is
    what tells a planner to add a machine or add working days — see
    weaving_service.lateness.

    An MO can be woven on several looms at once, so a run's projection combines every
    active run of the same MO. Everything that walk needs is loaded in batch; doing
    it per run with its own queries is what made the old `_project_mo` an N+1.

    A PAUSED run still projects, at the rate it achieved before it was parked. The
    reality walk starts from today, so its completion date slides a day for every day
    it stays parked — which is the honest cost of deprioritising it, and exactly the
    signal a planner needs. Freezing its date instead would hide the slip.
    """
    runs = [r for r in runs if r is not None]
    if not runs:
        return {}

    mo_ids = {r.mo_id for r in runs}

    # Sibling runs of the same MOs (possibly on other looms), unioned with the runs
    # asked about so a caller may pass a run that is no longer RUNNING.
    sib_res = await db.execute(
        select(WeavingRun).where(WeavingRun.mo_id.in_(mo_ids))
        .where(WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
    )
    all_runs = {r.id: r for r in sib_res.scalars().all()}
    for r in runs:
        all_runs.setdefault(r.id, r)

    # Pause intervals for every run in the rollup, batched — the per-run metrics below
    # need them or a parked run's achieved rate would be diluted by its parked days.
    pauses_by_run = await _pauses_by_run(db, all_runs.keys())

    wc_ids = {r.work_center_id for r in all_runs.values()}
    wcs = {
        wc.id: wc for wc in (await db.execute(
            select(WorkCenter).where(WorkCenter.id.in_(wc_ids))
        )).scalars().all()
    }
    hol_by_wc: dict = {}
    for wc_id, hd in (await db.execute(
        select(WorkCenterHoliday.work_center_id, WorkCenterHoliday.holiday_date)
        .where(WorkCenterHoliday.work_center_id.in_(wc_ids))
    )).all():
        hol_by_wc.setdefault(wc_id, []).append(hd)

    mos = {
        mo.id: mo for mo in (await db.execute(
            # item eager-loaded: MO.item_code is a property that reads it.
            select(ManufacturingOrder)
            .options(selectinload(ManufacturingOrder.item))
            .where(ManufacturingOrder.id.in_(mo_ids))
        )).scalars().all()
    }

    wo_ids = {r.work_order_id for r in runs if r.work_order_id}
    wos = {
        wo.id: wo for wo in (await db.execute(
            select(WorkOrder).where(WorkOrder.id.in_(wo_ids))
        )).scalars().all()
    } if wo_ids else {}

    # Per-run metrics first (actuals reuse the caller's cache when it already has
    # them — the monitor grid computes actual_kg for every card anyway).
    cache = dict(actual_by_run or {})
    metrics: dict = {}
    for run in all_runs.values():
        wc = wcs.get(run.work_center_id)
        weekdays = (wc.working_weekdays if wc and wc.working_weekdays else DEFAULT_WEEKDAYS)
        holidays = hol_by_wc.get(run.work_center_id, [])
        actual = cache.get(run.id)
        if actual is None:
            actual = await _run_actual_kg(db, run)
            cache[run.id] = actual
        metrics[run.id] = (weaving_service.compute_run_metrics(
            run, actual, weekdays, holidays, today, pauses=pauses_by_run.get(run.id, [])),
            weekdays, holidays, wc)

    # Roll the per-run numbers up per MO once, then hand the same rollup to every run
    # of that MO — two runs of one MO must never report different completion dates.
    by_mo: dict = {}
    for run in all_runs.values():
        m, weekdays, holidays, wc = metrics[run.id]
        agg = by_mo.setdefault(run.mo_id, {
            "target_daily": 0.0, "actual": 0.0, "earliest": None, "elapsed": 0,
            "target_machines": [], "reality_machines": [], "machines_meta": [],
        })
        agg["target_daily"] += m["target_eff_per_day_kg"]
        agg["actual"] += m["actual_kg"]
        agg["elapsed"] = max(agg["elapsed"], m["elapsed_working_days"])
        if agg["earliest"] is None or run.start_date < agg["earliest"]:
            agg["earliest"] = run.start_date
        agg["target_machines"].append({"weekdays": weekdays, "holidays": holidays, "daily_kg": m["target_eff_per_day_kg"]})
        agg["reality_machines"].append({"weekdays": weekdays, "holidays": holidays, "daily_kg": m["actual_daily_rate_kg"] or 0})
        agg["machines_meta"].append({
            "work_center_code": wc.code if wc else None,
            "work_center_name": wc.name if wc else None,
            "lines": m["lines"],
        })

    mo_projection: dict = {}
    for mo_id, agg in by_mo.items():
        mo = mos.get(mo_id)
        target_qty = float(mo.qty) if mo else 0.0
        target_completion = (
            weaving_service.walk_to_target(agg["target_machines"], target_qty, agg["earliest"])
            if agg["earliest"] else None
        )
        reality_completion = weaving_service.walk_to_target(
            agg["reality_machines"], target_qty, today, initial=agg["actual"]
        )
        # No date because nothing is coming off the loom: the walk only returns None
        # when every machine's achieved rate is 0. After a full working day of that,
        # the order is not "unknown", it is not going to make it.
        unreachable = (
            reality_completion is None and agg["elapsed"] > 0 and target_qty > agg["actual"]
        )
        mo_projection[mo_id] = {
            "mo_code": mo.code if mo else None,
            "item_code": mo.item_code if mo else None,
            "target_qty": target_qty,
            "total_actual_kg": round(agg["actual"], 3),
            "total_target_daily_kg": round(agg["target_daily"], 3),
            "target_working_days": ceil(target_qty / agg["target_daily"]) if agg["target_daily"] > 0 else None,
            "target_completion_date": target_completion,
            "reality_completion_date": reality_completion,
            "reality_unreachable": unreachable,
            "machines": agg["machines_meta"],
        }

    out: dict = {}
    for run in runs:
        base = mo_projection.get(run.mo_id)
        if not base:
            continue
        wo = wos.get(run.work_order_id) if run.work_order_id else None
        wo_target = wo.target_end_date.date() if (wo and wo.target_end_date) else None
        out[run.id] = {
            **base,
            "wo_id": str(wo.id) if wo else None,
            "wo_code": wo.code if wo else None,
            "wo_qty": float(wo.qty) if (wo and wo.qty is not None) else None,
            "wo_target_end_date": wo_target,
            **weaving_service.lateness(
                base["reality_completion_date"], wo_target, base["target_completion_date"],
                unreachable=base["reality_unreachable"],
            ),
        }
    return out


# ── Production calendar ──────────────────────────────────────────────────────

@router.get("/work-centers/{wc_id}/calendar")
async def get_calendar(
    wc_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("calendar.view", "weaving_monitor.view", "routing.view")),
):
    wc = await _get_wc(db, wc_id)
    weekdays, _ = await _load_calendar(db, wc)
    res = await db.execute(
        select(WorkCenterHoliday).where(WorkCenterHoliday.work_center_id == wc.id)
        .order_by(WorkCenterHoliday.holiday_date)
    )
    holidays = res.scalars().all()
    return {
        "work_center_id": str(wc.id),
        "working_weekdays": weekdays,
        "holidays": [WorkCenterHolidayResponse.model_validate(h) for h in holidays],
    }


@router.put("/work-centers/{wc_id}/calendar")
async def update_calendar(
    wc_id: str,
    payload: WorkCenterCalendarUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('calendar.edit')),
):
    wc = await _get_wc(db, wc_id)
    wc.working_weekdays = sorted(set(int(d) for d in payload.working_weekdays if 0 <= int(d) <= 6))
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WorkCenterCalendar", str(wc.id),
        details="Updated working weekdays", changes={"working_weekdays": wc.working_weekdays},
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "calendar", "work_center_id": str(wc.id)})
    return {"work_center_id": str(wc.id), "working_weekdays": wc.working_weekdays}


@router.get("/work-center-groups/{group_id}/calendar")
async def get_group_calendar(
    group_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("calendar.view", "weaving_monitor.view", "routing.view")),
):
    """Calendar held on a TYPE/GROUP node + the machines a batch apply would hit."""
    grp = await _get_wc(db, group_id)
    if (grp.node_type or "MACHINE").upper() == "MACHINE":
        raise HTTPException(status_code=422, detail="Not a work center group")
    machine_ids = await work_center_service.descendant_ids(db, grp.id, machines_only=True)
    weekdays, _ = await _load_calendar(db, grp)
    hol_res = await db.execute(
        select(WorkCenterHoliday).where(WorkCenterHoliday.work_center_id == grp.id)
        .order_by(WorkCenterHoliday.holiday_date)
    )
    machines = []
    if machine_ids:
        m_res = await db.execute(
            select(WorkCenter).where(WorkCenter.id.in_(machine_ids)).order_by(WorkCenter.code)
        )
        machines = [{"id": str(m.id), "code": m.code, "name": m.name} for m in m_res.scalars().all()]
    return {
        "group_id": str(grp.id),
        "code": grp.code,
        "name": grp.name,
        "node_type": grp.node_type,
        "working_weekdays": weekdays,
        "holidays": [WorkCenterHolidayResponse.model_validate(h) for h in hol_res.scalars().all()],
        "machines": machines,
    }


@router.put("/work-center-groups/{group_id}/calendar")
async def update_group_calendar(
    group_id: str,
    payload: WorkCenterGroupCalendarUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('calendar.edit')),
):
    """Batch-set the production calendar for a whole group of machines.

    Cascade-copy (see WorkCenterGroupCalendarUpdate): the group node stores the
    values so the form reopens with them, and every descendant MACHINE gets the same
    weekdays — and, when holidays are supplied, the same holiday set. One
    transaction, so machines never end up half-applied.
    """
    grp = await _get_wc(db, group_id)
    if (grp.node_type or "MACHINE").upper() == "MACHINE":
        raise HTTPException(status_code=422, detail="Not a work center group")

    weekdays = sorted(set(int(d) for d in payload.working_weekdays if 0 <= int(d) <= 6))
    machine_ids = await work_center_service.descendant_ids(db, grp.id, machines_only=True)
    target_ids = [grp.id, *machine_ids]

    await db.execute(
        update(WorkCenter).where(WorkCenter.id.in_(target_ids)).values(working_weekdays=weekdays)
    )

    holidays_written = 0
    if payload.holidays is not None or payload.import_national_year:
        merged: dict = {h.holiday_date: h.note for h in (payload.holidays or [])}
        if payload.import_national_year:
            for h in id_holidays.holidays_for_year(payload.import_national_year):
                merged.setdefault(date.fromisoformat(h["date"]), h["name"])
        # Replace wholesale: the group is the source of truth for the batch, so a
        # date removed in the form must disappear from every machine too.
        await db.execute(
            delete(WorkCenterHoliday).where(WorkCenterHoliday.work_center_id.in_(target_ids))
        )
        for wc_id in target_ids:
            for hd, note in merged.items():
                db.add(WorkCenterHoliday(work_center_id=wc_id, holiday_date=hd, note=note))
                holidays_written += 1

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "WorkCenterCalendar", str(grp.id),
        details=f"Batch calendar on {grp.code} → {len(machine_ids)} machines",
        changes={"working_weekdays": weekdays, "machines": len(machine_ids)},
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "calendar", "work_center_id": str(grp.id)})
    return {
        "group_id": str(grp.id),
        "working_weekdays": weekdays,
        "machines_updated": len(machine_ids),
        "holidays_written": holidays_written,
    }


@router.post("/work-centers/{wc_id}/holidays", response_model=WorkCenterHolidayResponse)
async def add_holiday(
    wc_id: str,
    payload: WorkCenterHolidayCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('calendar.edit')),
):
    wc = await _get_wc(db, wc_id)
    existing = await db.execute(
        select(WorkCenterHoliday)
        .where(WorkCenterHoliday.work_center_id == wc.id)
        .where(WorkCenterHoliday.holiday_date == payload.holiday_date)
    )
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Holiday already set for this date")
    hol = WorkCenterHoliday(work_center_id=wc.id, holiday_date=payload.holiday_date, note=payload.note)
    db.add(hol)
    await db.commit()
    await db.refresh(hol)
    await audit_service.log_activity(
        db, current_user.id, "CREATE", "WorkCenterHoliday", str(hol.id),
        details=f"Holiday {payload.holiday_date} on {wc.code}",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "calendar", "work_center_id": str(wc.id)})
    return hol


@router.post("/work-centers/{wc_id}/holidays/import-national")
async def import_national_holidays(
    wc_id: str,
    year: int = Query(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('calendar.edit')),
):
    wc = await _get_wc(db, wc_id)
    existing = await db.execute(
        select(WorkCenterHoliday.holiday_date).where(WorkCenterHoliday.work_center_id == wc.id)
    )
    have = {r[0] for r in existing.all()}
    added = 0
    for h in id_holidays.holidays_for_year(year):
        hd = date.fromisoformat(h["date"])
        if hd in have:
            continue
        db.add(WorkCenterHoliday(work_center_id=wc.id, holiday_date=hd, note=h["name"]))
        have.add(hd)
        added += 1
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "CREATE", "WorkCenterHoliday", str(wc.id),
        details=f"Imported {added} national holidays ({year}) for {wc.code}",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "calendar", "work_center_id": str(wc.id)})
    return {"added": added}


@router.delete("/work-center-holidays/{holiday_id}")
async def delete_holiday(
    holiday_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('calendar.edit')),
):
    res = await db.execute(select(WorkCenterHoliday).where(WorkCenterHoliday.id == holiday_id))
    hol = res.scalars().first()
    if not hol:
        raise HTTPException(status_code=404, detail="Holiday not found")
    wc_id = str(hol.work_center_id)
    await db.delete(hol)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "WorkCenterHoliday", holiday_id, details="Deleted holiday",
    )
    await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "calendar", "work_center_id": wc_id})
    return {"status": "success"}
