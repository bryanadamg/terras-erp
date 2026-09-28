"""Dyeing vessel monitor: one row per dye batch, time-based output vs the WO's qty.

The loom monitor's sibling, and deliberately a separate router rather than a
branch inside `api/weaving.py`: a loom is measured in kg against a calendar of
working days, a dye batch against the clock the floor stamps by hand -- see the
header of `services/dyeing_monitor_service.py`.
"""
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func, or_, and_, case, literal, union_all
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.db.session import get_async_db
from app.models.attribute import AttributeValue
from app.models.auth import User
from app.models.dyeing_setting import DyeingRun
from app.models.item import Item
from app.models.manufacturing import ManufacturingOrder
from app.models.routing import WorkCenter
from app.models.work_order import WorkOrder
from app.api.auth import require_permission, require_any_permission
from app.core.pagination import PageParams, PageWindow
from app.schemas import DyeingRunMonitorUpdate
from app.services import audit_service, dyeing_monitor_service, mo_variant_service, work_center_service
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

# A dyeing WO closed without its bath ever being clocked: no run at all, or runs
# nobody pressed Start on. Listed greyed out so the table reads like the WO list
# (every dyeing WO of the window) instead of silently dropping them.
CLOCK_NO_RUN = "NO_RUN"

_CLOCK_ORDER = {svc.CLOCK_RUNNING: 0, svc.CLOCK_WAITING: 1, svc.CLOCK_DONE: 2, CLOCK_NO_RUN: 3}

_WO_LOADS = (
    joinedload(WorkOrder.work_center),
    joinedload(WorkOrder.manufacturing_order)
    .selectinload(ManufacturingOrder.attribute_values).joinedload(AttributeValue.attribute),
    joinedload(WorkOrder.manufacturing_order).selectinload(ManufacturingOrder.item),
)


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
        **_wo_fields(wo),
        "color_matching_at": run.color_matching_at,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        **svc.compute_run_metrics(run, target, mo.item if mo else None, now),
    }


def _wo_fields(wo: WorkOrder | None) -> dict:
    """The WO-list half of a row, shared by run rows and no-run rows."""
    mo = wo.manufacturing_order if wo else None
    wc = wo.work_center if wo else None
    return {
        "work_center_id": str(wc.id) if wc else None,
        "work_center_code": wc.code if wc else None,
        "work_center_name": wc.name if wc else None,
        "work_center_type": wc.center_type if wc else None,
        "work_order_id": str(wo.id) if wo else None,
        "wo_code": wo.code if wo else None,
        "wo_status": wo.status if wo else None,
        "wo_actual_end_date": wo.actual_end_date if wo else None,
        "mo_code": mo.code if mo else None,
        "item_code": mo.item_code if mo else None,
        "item_name": mo.item_name if mo else None,
        "item_uom": mo.item.uom if (mo and mo.item) else None,
        **mo_variant_service.variant_labels(mo),
    }


def _no_run_row(wo: WorkOrder) -> dict:
    return {
        "id": f"wo-{wo.id}",
        "run_number": None,
        **_wo_fields(wo),
        "color_matching_at": None,
        "started_at": None,
        "completed_at": None,
        "clock": CLOCK_NO_RUN,
        "lines": None,
        "yards_per_min": None,
        "rate_yd_per_min": None,
        "run_minutes": None,
        "time_yards": None,
        "time_qty": None,
        "target_qty": wo.qty,
        "progress_pct": None,
        "missing_rate_inputs": [],
        "missing_gy_factor": False,
    }


@router.get("/dyeing/monitor")
async def dyeing_monitor(
    clock: str | None = Query(None, description="PENDING | IN_PROGRESS | COMPLETED | NO_RUN"),
    search: str | None = Query(None),
    work_center_id: UUID | None = Query(None, description="A vessel, or a GROUP/TYPE node for every vessel under it"),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dyeing_monitor.view", "work_order.view")),
):
    """One page of dye batches, plus the dyeing WOs closed without one (NO_RUN).

    Both kinds page together, so they are one UNION of (kind, id, sort keys) and the
    page's objects are loaded afterwards. Paged in SQL rather than in Python because
    every finished batch stays listed, so the set grows without bound.
    """
    now = datetime.now(timezone.utc)

    # The search and the machine filter reach both halves the same way, and apply
    # before the chip counts so the counts describe what the filter shows.
    # Resolved to ids once: the subtree CTE inlined into both UNION halves would be
    # two CTEs of the same name, which the compiler refuses.
    wc_ids = (
        [work_center_id, *await work_center_service.descendant_ids(db, work_center_id)]
        if work_center_id else None
    )

    def _searched(q):
        if wc_ids:
            q = q.where(WorkOrder.work_center_id.in_(wc_ids))
        if not search or not search.strip():
            return q
        like = f"%{search.strip()}%"
        return q.where(or_(
            WorkCenter.code.ilike(like), WorkCenter.name.ilike(like), WorkOrder.code.ilike(like),
            ManufacturingOrder.code.ilike(like), Item.code.ilike(like), Item.name.ilike(like),
        ))

    run_q = _searched(
        select(
            literal("run").label("kind"),
            DyeingRun.id.label("id"),
            # _CLOCK_ORDER, read off the stamps exactly as svc.clock_state does.
            case(
                (DyeingRun.started_at.is_(None), _CLOCK_ORDER[svc.CLOCK_WAITING]),
                (DyeingRun.completed_at.is_(None), _CLOCK_ORDER[svc.CLOCK_RUNNING]),
                else_=_CLOCK_ORDER[svc.CLOCK_DONE],
            ).label("clock_ord"),
            DyeingRun.completed_at.label("done_at"),
            WorkCenter.code.label("wc_code"),
            # Batches that cannot report an output until someone picks their speed.
            and_(
                DyeingRun.completed_at.is_(None),
                or_(func.coalesce(DyeingRun.yards_per_min, 0) <= 0, func.coalesce(DyeingRun.lines, 0) <= 0),
            ).label("needs_setup"),
        )
        .join(WorkOrder, DyeingRun.work_order_id == WorkOrder.id)
        .join(WorkCenter, WorkOrder.work_center_id == WorkCenter.id)
        .outerjoin(ManufacturingOrder, WorkOrder.manufacturing_order_id == ManufacturingOrder.id)
        .outerjoin(Item, ManufacturingOrder.item_id == Item.id)
        .where(func.upper(WorkCenter.center_type).in_(svc.DYEING_CENTER_TYPES))
        .where(DyeingRun.status != "CANCELLED")
        .where(or_(
            and_(DyeingRun.completed_at.is_(None), DyeingRun.status.in_(_OPEN_STATUSES)),
            # A run reads COMPLETED the moment its WO closes, but the clock is
            # stopped by hand -- keep it listed until somebody presses Complete.
            and_(DyeingRun.started_at.isnot(None), DyeingRun.completed_at.is_(None)),
            DyeingRun.completed_at.isnot(None),
        ))
    )

    # Dyeing WOs closed whose bath was never clocked: no started run, and no run
    # still listed as open above.
    has_listed_run = (
        select(DyeingRun.id)
        .where(DyeingRun.work_order_id == WorkOrder.id, DyeingRun.status != "CANCELLED")
        .where(or_(
            DyeingRun.started_at.isnot(None),
            and_(DyeingRun.completed_at.is_(None), DyeingRun.status.in_(_OPEN_STATUSES)),
        ))
        .exists()
    )
    wo_q = _searched(
        select(
            literal("wo").label("kind"),
            WorkOrder.id.label("id"),
            literal(_CLOCK_ORDER[CLOCK_NO_RUN]).label("clock_ord"),
            func.timezone("UTC", WorkOrder.actual_end_date).label("done_at"),
            WorkCenter.code.label("wc_code"),
            literal(False).label("needs_setup"),
        )
        .join(WorkCenter, WorkOrder.work_center_id == WorkCenter.id)
        .outerjoin(ManufacturingOrder, WorkOrder.manufacturing_order_id == ManufacturingOrder.id)
        .outerjoin(Item, ManufacturingOrder.item_id == Item.id)
        .where(func.upper(WorkCenter.center_type).in_(svc.DYEING_CENTER_TYPES))
        .where(WorkOrder.status == "COMPLETED")
        .where(~has_listed_run)
    )

    base = union_all(run_q, wo_q).subquery()

    # Whole-set aggregates for the filter chips, before the clock filter narrows it.
    agg = await db.execute(
        select(base.c.clock_ord, func.count(), func.count().filter(base.c.needs_setup))
        .group_by(base.c.clock_ord)
    )
    by_ord = {o: (n, ns) for o, n, ns in agg.all()}
    counts = {clk: by_ord.get(o, (0, 0))[0] for clk, o in _CLOCK_ORDER.items()}
    needs_setup = sum(ns for _, ns in by_ord.values())

    page_q = select(base.c.kind, base.c.id)
    total = sum(counts.values())
    if clock in _CLOCK_ORDER:
        page_q = page_q.where(base.c.clock_ord == _CLOCK_ORDER[clock])
        total = counts[clock]
    page_q = page_q.order_by(
        base.c.clock_ord,
        # Finished batches newest first; the rest by vessel.
        base.c.done_at.desc().nulls_last(),
        base.c.wc_code,
        base.c.id,
    )
    keys = [(k, i) for k, i in (await db.execute(window.apply(page_q))).all()]

    run_ids = [i for k, i in keys if k == "run"]
    wo_ids = [i for k, i in keys if k == "wo"]
    by_key: dict = {}
    if run_ids:
        res = await db.execute(select(DyeingRun).options(*_RUN_LOADS).where(DyeingRun.id.in_(run_ids)))
        by_key.update({("run", r.id): _row(r, now) for r in res.unique().scalars().all()})
    if wo_ids:
        res = await db.execute(select(WorkOrder).options(*_WO_LOADS).where(WorkOrder.id.in_(wo_ids)))
        by_key.update({("wo", w.id): _no_run_row(w) for w in res.unique().scalars().all()})

    items = [by_key[k] for k in keys if k in by_key]
    return window.envelope(items, total, counts=counts, needs_setup=needs_setup)


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
