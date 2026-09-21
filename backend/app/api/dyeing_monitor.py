"""Dyeing vessel monitor: the grid of dye machines and what each is running.

The loom monitor's sibling, and deliberately a separate router rather than a
branch inside `api/weaving.py`: the two share their *card shape* (which is why the
frontend primitives are shared) and share none of their arithmetic. A loom is
measured in kg against a calendar of working days, a dye vessel in yards against
the clock -- see the header of `services/dyeing_monitor_service.py`.
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.db.session import get_async_db
from app.models.attribute import AttributeValue
from app.models.auth import User
from app.models.dyeing_setting import DyeingRun
from app.models.manufacturing import ManufacturingOrder
from app.models.routing import WorkCenter
from app.models.work_order import WorkOrder
from app.api.auth import require_permission, require_any_permission
from app.schemas import DyeingRunMonitorUpdate
from app.services import audit_service, dyeing_dose_service, dyeing_monitor_service, mo_variant_service
from app.core.ws_manager import manager

router = APIRouter()

DYEING_CENTER_TYPES = dyeing_monitor_service.DYEING_CENTER_TYPES
ACTIVE_RUN_STATUSES = dyeing_monitor_service.ACTIVE_RUN_STATUSES

# A run on a vessel card: running now, being colour-matched, or loaded and waiting.
# The two pre-run phases earn their place because "what is the vessel about to run,
# and what is it waiting on" is half of what a supervisor walks the floor to find
# out; neither reports a rate, and COLOR_MATCHING reports how long it has waited.
CARD_RUN_STATUSES = ACTIVE_RUN_STATUSES + ("COLOR_MATCHING", "PENDING")

# Whether a CARD's vessel is turning / waiting on a shade / merely loaded. The
# monitor is a timer, so all three read the stamps the floor pressed rather than the
# run's status — a bath configured in Dyeing Orders makes a run IN_PROGRESS before
# anyone switches the machine on (services/dyeing_monitor_service).
def _running(card: dict) -> bool:
    return dyeing_monitor_service.clock_running(card["started_at"], card["completed_at"])


def _matching(card: dict) -> bool:
    return dyeing_monitor_service.clock_matching(card["color_matching_at"], card["started_at"])


def _loaded(card: dict) -> bool:
    return dyeing_monitor_service.clock_loaded(card["color_matching_at"], card["started_at"])


# The MO behind a dye batch is reached through the WO -- DyeingRun has no mo_id of
# its own, and no machine of its own either: the vessel is `work_order.work_center_id`
# (a free-text `machine_name` column used to sit on the run and was dropped, unused).
_RUN_LOADS = (
    joinedload(DyeingRun.work_order).joinedload(WorkOrder.manufacturing_order)
    .selectinload(ManufacturingOrder.attribute_values).joinedload(AttributeValue.attribute),
    joinedload(DyeingRun.work_order).joinedload(WorkOrder.manufacturing_order)
    .selectinload(ManufacturingOrder.item),
    joinedload(DyeingRun.recipe),
)


def _run_card(run: DyeingRun, metrics: dict) -> dict:
    """One dye batch as the grid and the modal both read it.

    Field names deliberately match the weaving card where the meaning matches
    (`efficiency_pct`, `lines`) so the shared frontend primitives take either domain
    without a per-domain adapter. The target fields are NOT among them: a dye vessel
    has no contracted rate to be judged against, so the card reports and does not
    score (see services/dyeing_monitor_service.py).
    """
    wo = run.work_order
    mo = wo.manufacturing_order if wo else None
    return {
        "id": str(run.id),
        "run_number": run.run_number,
        "work_order_id": str(run.work_order_id) if run.work_order_id else None,
        "wo_code": wo.code if wo else None,
        "mo_id": str(mo.id) if mo else None,
        "mo_code": mo.code if mo else None,
        "item_code": mo.item_code if mo else None,
        "item_name": mo.item_name if mo else None,
        "item_uom": mo.item.uom if (mo and mo.item) else None,
        "target_qty": float(mo.qty) if mo else None,
        "substrate_qty": float(run.substrate_qty) if run.substrate_qty is not None else None,
        # The bath actually set up on this run, for the card to show. The Start
        # button posts nothing: it is a clock stamp, and the bath is configured in
        # Dyeing Orders (`planned_volume_air_liters` survives only on runs cut before
        # that move, hence `effective_bath`).
        "bath_liters": dyeing_dose_service.effective_bath(run),
        "recipe_code": run.recipe.code if run.recipe else None,
        # No colour/lot keys: they came off `DyeingRun.color_name` / `lot_number`,
        # dropped in a7c9e1b3d5f8 as never-populated duplicates of the MO's colour
        # attributes (already in `variant_labels` below) and the output Batch. No
        # frontend read either one.
        "status": run.status,
        # The three phase stamps the floor presses, in order. `color_matching_at`
        # rides in from `metrics` beside the gaps computed off it.
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "operator_name": run.operator_name,
        **mo_variant_service.variant_labels(mo),
        **metrics,
    }


def _machine_payload(wc: WorkCenter, cards: list) -> dict:
    """A vessel card. `active_runs` is a LIST for the same reason the loom's is --
    the shared grid primitive reads one shape, and a vessel with a queued next load
    shows both.
    """
    running = [c for c in cards if _running(c)]
    effs = [c["efficiency_pct"] for c in running if c["efficiency_pct"] is not None]
    return {
        "id": str(wc.id), "code": wc.code, "name": wc.name, "center_type": wc.center_type,
        "active_runs": cards,
        "active_run": cards[0] if cards else None,
        "loom_status": dyeing_monitor_service.derive_machine_status(
            bool(running),
            any(_matching(c) for c in cards),
            any(_loaded(c) for c in cards),
        ),
        "avg_efficiency_pct": round(sum(effs) / len(effs), 1) if effs else None,
        # No rate can be computed until a batch has a speed picked. It is a per-run
        # input now, not machine geometry, so the flag counts the runs that need one
        # rather than the vessel -- an idle machine needs nothing.
        "needs_setup": sum(1 for c in cards if c["missing_rate_inputs"]),
    }


@router.get("/dyeing/monitor")
async def dyeing_monitor(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dyeing_monitor.view", "work_order.view")),
):
    now = datetime.now(timezone.utc)

    # Leaves only, same discriminator rule as the loom grid: with the optional GROUP
    # tier a group also has a parent, so `parent_id IS NOT NULL` identifies nothing.
    res = await db.execute(
        select(WorkCenter)
        .where(func.upper(WorkCenter.center_type).in_(DYEING_CENTER_TYPES))
        .where(func.upper(WorkCenter.node_type) == "MACHINE")
        .order_by(WorkCenter.code)
    )
    machines = res.scalars().all()
    if not machines:
        return {"machines": [], "total": 0, "running": 0, "groups": [],
                "avg_efficiency_pct": None, "active_runs": 0, "matching": 0,
                "needs_setup": 0}

    machine_ids = [wc.id for wc in machines]

    # Container node each machine sits under. Unlike the loom grid this falls back
    # to the TYPE when there is no GROUP: dye vessels hang straight off their type
    # roots (CELUP BENANG vs CELUP CONTINUOUS), and those roots ARE the meaningful
    # banks -- a GROUP-only walk would tip yarn dyeing and continuous dyeing into
    # one undifferentiated "Ungrouped" pile.
    node_res = await db.execute(
        select(WorkCenter.id, WorkCenter.code, WorkCenter.name, WorkCenter.parent_id,
               WorkCenter.node_type)
        .where(func.upper(WorkCenter.node_type) != "MACHINE")
    )
    nodes = {r.id: r for r in node_res.all()}

    def group_for(wc: WorkCenter):
        seen, fallback, pid = set(), None, wc.parent_id
        while pid is not None and pid not in seen:
            seen.add(pid)
            node = nodes.get(pid)
            if node is None:
                break
            kind = (node.node_type or "").upper()
            if kind == "GROUP":
                return node
            if kind == "TYPE" and fallback is None:
                fallback = node
            pid = node.parent_id
        return fallback

    # Every card-worthy run on every vessel, in one query.
    run_res = await db.execute(
        select(DyeingRun)
        .options(*_RUN_LOADS)
        .join(WorkOrder, DyeingRun.work_order_id == WorkOrder.id)
        .where(WorkOrder.work_center_id.in_(machine_ids))
        # Status, OR an unclosed clock. A run reads COMPLETED the moment its WO
        # closes (dyeing_run_service), but the monitor is a timer the floor stops by
        # hand — dropping the card at WO close would take the Complete button away
        # before anyone pressed it, and leave the batch with a running clock forever.
        .where(or_(
            DyeingRun.status.in_(CARD_RUN_STATUSES),
            and_(DyeingRun.started_at.isnot(None), DyeingRun.completed_at.is_(None)),
        ))
        .order_by(WorkOrder.work_center_id, DyeingRun.created_at.desc())
    )
    runs_by_wc: dict = {}
    for run in run_res.unique().scalars().all():
        runs_by_wc.setdefault(run.work_order.work_center_id, []).append(run)

    out = []
    for wc in machines:
        cards = []
        for run in runs_by_wc.get(wc.id, []):
            mo = run.work_order.manufacturing_order if run.work_order else None
            actual = await dyeing_monitor_service.sum_actual_qty(
                db, wc.id, mo.id if mo else None,
                run.started_at, run.completed_at, now,
            ) if mo else 0.0
            metrics = dyeing_monitor_service.compute_run_metrics(
                run, actual, mo.item if mo else None, now,
            )
            cards.append(_run_card(run, metrics))
        payload = _machine_payload(wc, cards)
        grp = group_for(wc)
        payload["group_id"] = str(grp.id) if grp else None
        payload["group_code"] = grp.code if grp else None
        payload["group_name"] = grp.name if grp else None
        out.append(payload)

    groups: list[dict] = []
    seen_groups: set = set()
    for m in out:
        if m["group_id"] and m["group_id"] not in seen_groups:
            seen_groups.add(m["group_id"])
            groups.append({"id": m["group_id"], "code": m["group_code"], "name": m["group_name"]})
    groups.sort(key=lambda g: (g["code"] or ""))

    # "running" counts VESSELS with cloth in them, not runs -- it sits beside the
    # machine total in the header. A vessel merely LOADED does not count.
    running = sum(1 for m in out if m["loom_status"] == dyeing_monitor_service.MACHINE_STATUS_RUNNING)
    run_cards = [c for m in out for c in m["active_runs"] if _running(c)]
    effs = [c["efficiency_pct"] for c in run_cards if c["efficiency_pct"] is not None]
    return {
        "machines": out, "total": len(out), "running": running, "groups": groups,
        "avg_efficiency_pct": round(sum(effs) / len(effs), 1) if effs else None,
        "active_runs": len(run_cards),
        # Batches sitting on a shade rather than on the machine -- the one queue a
        # dye plant loses hours to that no production number reveals.
        "matching": sum(1 for m in out for c in m["active_runs"] if _matching(c)),
        # How many batches cannot report a rate until someone picks their speed.
        "needs_setup": sum(m["needs_setup"] for m in out),
    }


@router.patch("/dyeing-runs/{run_id}/rate")
async def update_dyeing_run_rate(
    run_id: str,
    payload: DyeingRunMonitorUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("work_order.log")),
):
    """Set the rate inputs the monitor needs for one batch (speed / rope count).

    Separate from the dyeing-run create and complete payloads on purpose: these are
    entered by whoever sets the machine up, at a different moment from the shade
    result, and a run already COMPLETED may still need its speed corrected for the
    record.

    `yards_per_min` is validated as a positive number, not against the `Dyeing Speed`
    attribute's values: that list is a picker convenience the floor curates, and a
    vessel run at a speed nobody has added to it yet must still be recordable.
    """
    res = await db.execute(select(DyeingRun).where(DyeingRun.id == run_id))
    run = res.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Dyeing run not found")

    changes: dict = {}
    if payload.yards_per_min is not None:
        if float(payload.yards_per_min) <= 0:
            raise HTTPException(status_code=422, detail="yards per minute must be greater than zero")
        changes["yards_per_min"] = (
            float(run.yards_per_min) if run.yards_per_min is not None else None,
            float(payload.yards_per_min),
        )
        run.yards_per_min = payload.yards_per_min
    if payload.lines is not None:
        if int(payload.lines) <= 0:
            raise HTTPException(status_code=422, detail="lines must be at least 1")
        changes["lines"] = (run.lines, int(payload.lines))
        run.lines = payload.lines

    if not changes:
        raise HTTPException(status_code=422, detail="Nothing to update")

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "DyeingRun", str(run_id),
        details="Updated dyeing monitor rate inputs",
        changes={k: {"from": v[0], "to": v[1]} for k, v in changes.items()},
    )
    # The grid is self-fetching; without this the card keeps its old rate until the
    # next manual refresh.
    await manager.broadcast({"type": "DYEING_RUN_UPDATE", "action": "rate", "run_id": str(run_id)})
    return {"id": str(run_id), "yards_per_min": run.yards_per_min, "lines": run.lines}
