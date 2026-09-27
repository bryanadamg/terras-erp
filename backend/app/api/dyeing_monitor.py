"""Dyeing vessel monitor: one row per dye batch, time-based output vs the WO's qty.

The loom monitor's sibling, and deliberately a separate router rather than a
branch inside `api/weaving.py`: a loom is measured in kg against a calendar of
working days, a dye batch against the clock the floor stamps by hand -- see the
header of `services/dyeing_monitor_service.py`.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
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
from app.services import audit_service, dyeing_monitor_service, mo_variant_service
from app.core.ws_manager import manager

router = APIRouter()

svc = dyeing_monitor_service

# Runs still to be dyed. Status, not stamps, because a run nobody has started has
# no stamp to read; everything past that point is read off the clock.
_OPEN_STATUSES = ("PENDING", "COLOR_MATCHING", "IN_PROGRESS")

# The MO behind a dye batch is reached through the WO -- DyeingRun has no mo_id of
# its own, and no machine of its own either: the vessel is `work_order.work_center_id`.
_RUN_LOADS = (
    joinedload(DyeingRun.work_order).joinedload(WorkOrder.work_center),
    joinedload(DyeingRun.work_order).joinedload(WorkOrder.manufacturing_order)
    .selectinload(ManufacturingOrder.attribute_values).joinedload(AttributeValue.attribute),
    joinedload(DyeingRun.work_order).joinedload(WorkOrder.manufacturing_order)
    .selectinload(ManufacturingOrder.item),
)

_CLOCK_ORDER = {svc.CLOCK_RUNNING: 0, svc.CLOCK_WAITING: 1, svc.CLOCK_DONE: 2}


def _row(run: DyeingRun, now: datetime) -> dict:
    wo = run.work_order
    mo = wo.manufacturing_order if wo else None
    wc = wo.work_center if wo else None
    # The mass the WO was cut for. `substrate_qty` is seeded from it and only
    # stands in for a WO with no qty of its own.
    target = wo.qty if (wo and wo.qty) else run.substrate_qty
    return {
        "id": str(run.id),
        "run_number": run.run_number,
        "work_center_id": str(wc.id) if wc else None,
        "work_center_code": wc.code if wc else None,
        "work_center_name": wc.name if wc else None,
        "work_order_id": str(run.work_order_id) if run.work_order_id else None,
        "wo_code": wo.code if wo else None,
        "mo_code": mo.code if mo else None,
        "item_code": mo.item_code if mo else None,
        "item_name": mo.item_name if mo else None,
        "item_uom": mo.item.uom if (mo and mo.item) else None,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        **mo_variant_service.variant_labels(mo),
        **svc.compute_run_metrics(run, target, mo.item if mo else None, now),
    }


@router.get("/dyeing/monitor")
async def dyeing_monitor(
    days: int = Query(1, ge=0, le=31, description="Also list batches completed in the last N days"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dyeing_monitor.view", "work_order.view")),
):
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)
    # ponytail: not paginated -- open batches + a few days of finished ones is a
    # bounded set; move to PageParams if `days` ever grows past a month.
    res = await db.execute(
        select(DyeingRun)
        .options(*_RUN_LOADS)
        .join(WorkOrder, DyeingRun.work_order_id == WorkOrder.id)
        .join(WorkCenter, WorkOrder.work_center_id == WorkCenter.id)
        .where(func.upper(WorkCenter.center_type).in_(svc.DYEING_CENTER_TYPES))
        .where(DyeingRun.status != "CANCELLED")
        .where(or_(
            and_(DyeingRun.completed_at.is_(None), DyeingRun.status.in_(_OPEN_STATUSES)),
            # A run reads COMPLETED the moment its WO closes, but the clock is
            # stopped by hand -- keep it listed until somebody presses Complete.
            and_(DyeingRun.started_at.isnot(None), DyeingRun.completed_at.is_(None)),
            DyeingRun.completed_at >= since,
        ))
    )
    rows = [_row(r, now) for r in res.unique().scalars().all()]
    rows.sort(key=lambda r: (
        _CLOCK_ORDER[r["clock"]],
        # Finished batches newest first; the rest by vessel.
        -(r["completed_at"].timestamp()) if r["completed_at"] else 0,
        r["work_center_code"] or "",
    ))
    return {
        "runs": rows,
        "total": len(rows),
        "running": sum(1 for r in rows if r["clock"] == svc.CLOCK_RUNNING),
        # Batches that cannot report an output until someone picks their speed.
        "needs_setup": sum(1 for r in rows if r["missing_rate_inputs"] and r["clock"] != svc.CLOCK_DONE),
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
