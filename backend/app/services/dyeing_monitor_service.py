"""Dyeing vessel performance monitoring: rate calc for a batch process.

Deliberately NOT shared with `weaving_service`. A loom runs continuously for days
and is measured in kg against a calendar of working days; a dye batch fits inside
one shift and is measured in yards against the clock. The two formulas look alike
and are not:

    weaving:  kg/day  = 1440 * rate_g_min * lines / 1000, over WORKING DAYS
    dyeing:   yd/min  = yards_per_min * lines,            over the RUN WINDOW

Both dyeing factors live on the DyeingRun and are chosen per load: `yards_per_min`
is how fast ONE rope is run (picked off the `Dyeing Speed` system attribute, not
typed), `lines` is how many ropes the vessel carries. Either missing yields None --
never 0, which would read as a vessel producing nothing rather than a batch nobody
has set a speed for.

The rate chain used to be `rpm * WorkCenter.yards_per_rev * lines`. Three factors,
two of which nobody at the vessel could check, so a mistyped rpm read as a real
measurement three hours later. One picked speed replaced them (f3b5d7a9c1e8).

There is no target. The floor asked for these numbers reported, not judged: a dye
vessel has no contracted daily rate the way a loom does, so a percentage threshold
was a bar nobody had ever set. `on_target` / `below_target` are gone with it.
"""
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manufacturing import MOCompletion
from app.services import packing_service

# A dye batch that is on the machine right now, i.e. its efficiency window is open.
ACTIVE_RUN_STATUSES = ("IN_PROGRESS",)

# Work centre types that are dyeing vessels. `CELUP` is the Indonesian name and is
# already treated as a synonym in work_queue_service and api/manufacturing.
DYEING_CENTER_TYPES = ("DYEING", "CELUP")

# -- Vessel state ------------------------------------------------------------
# A dye vessel has no equivalent of the loom's warp prep (STAGED/DRAW_IN/TUNING):
# there is nothing mounted to it that outlives a batch. So every state is DERIVED
# from the runs alone and nothing is stored on the work center.
MACHINE_STATUS_IDLE = "IDLE"
MACHINE_STATUS_LOADED = "LOADED"
MACHINE_STATUS_MATCHING = "MATCHING"
MACHINE_STATUS_RUNNING = "RUNNING"


def clock_running(started_at, completed_at) -> bool:
    """Is this vessel turning right now?

    Read off the two stamps the floor presses, never off `DyeingRun.status`. The
    monitor is a timer: the bath is configured ahead of the run in Dyeing Orders,
    which makes the run IN_PROGRESS the moment a volume exists — long before anyone
    starts the machine. Scoring that as "running" would open an efficiency window
    on a vessel nobody had switched on.
    """
    return started_at is not None and completed_at is None


def clock_matching(color_matching_at, started_at) -> bool:
    """Waiting on a shade: matched, not yet started."""
    return color_matching_at is not None and started_at is None


def clock_loaded(color_matching_at, started_at) -> bool:
    """Loaded and waiting — no stamp pressed on this batch at all."""
    return color_matching_at is None and started_at is None


def derive_machine_status(has_active_run: bool, has_matching_run: bool,
                          has_pending_run: bool) -> str:
    """The single definition of what a vessel card shows.

    Ordered by how far along the floor is, so a vessel running one batch while the
    next is being colour-matched reads RUNNING -- the machine's own state is the
    batch that is in it.
    """
    if has_active_run:
        return MACHINE_STATUS_RUNNING
    if has_matching_run:
        return MACHINE_STATUS_MATCHING
    if has_pending_run:
        return MACHINE_STATUS_LOADED
    return MACHINE_STATUS_IDLE


# -- Rate primitives ---------------------------------------------------------

def yards_per_minute(yards_per_min: Optional[float], lines: Optional[int]) -> Optional[float]:
    """Theoretical vessel speed in yards/min, or None when a factor is unset.

    None rather than 0: a missing speed means "nobody has set this batch's rate",
    which the card must show as a dash. Returning 0 would make every downstream
    division silently produce a null efficiency for the wrong reason.
    """
    try:
        ypm = float(yards_per_min or 0)
        n = int(lines or 0)
    except (TypeError, ValueError):
        return None
    if ypm <= 0 or n <= 0:
        return None
    return ypm * n


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Naive timestamps read back from postgres are UTC; make the arithmetic safe."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _naive_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Drop the tzinfo, having normalised to UTC, for comparison against a
    TIMESTAMP WITHOUT TIME ZONE column.

    `DyeingRun.started_at` is `DateTime(timezone=True)` while `MOCompletion.created_at`
    is naive -- binding an aware bound against the naive column makes asyncpg raise
    "can't subtract offset-naive and offset-aware datetimes" rather than comparing
    wrongly, so this is a hard failure, not a silent one. Both sides are UTC.
    """
    aware = _aware(dt)
    return None if aware is None else aware.astimezone(timezone.utc).replace(tzinfo=None)


def _span_minutes(start: Optional[datetime], end: Optional[datetime],
                  now: Optional[datetime]) -> Optional[float]:
    """Wall-clock minutes between two stamps, running to `now` while `end` is open.

    None when the phase never began -- distinct from 0.0, which means it began and
    no time has passed. A card showing "--" for an unrecorded colour match and "0m"
    for one pressed a second ago is telling the truth twice; one number for both is
    telling it once, wrongly.

    Pass `now=None` for a span that must NOT run live -- the gap between two phases
    is only meaningful once the second one lands.

    No calendar and no pause intervals: a dye batch spans a single shift, so there
    is no overnight gap to subtract and nothing to park while another order is
    prioritised (the two things weaving_service exists to handle).
    """
    s = _aware(start)
    if s is None:
        return None
    e = _aware(end) or now
    if e is None:
        return None
    return max((e - s).total_seconds() / 60.0, 0.0)


def phase_minutes(run, now: datetime) -> dict:
    """How long each phase of one batch took, and how long the whole thing has.

    `prep_minutes` runs live only while the batch has not started: a vessel that has
    been waiting on a shade since 8am is exactly what the supervisor walks the floor
    to find, and it stops being a live number the moment the machine starts.

    `run_minutes` is the efficiency window and nothing else -- it opens at
    `started_at`, closes at `completed_at`, and is the only span the yard rate is
    ever divided by. A batch that sat all morning waiting on a colour must not be
    scored as a slow machine, which is what one merged elapsed figure did.
    """
    started = run.started_at
    matched = run.color_matching_at
    return {
        "color_matching_at": matched,
        "prep_minutes": _span_minutes(matched, started, None if started else now),
        "run_minutes": _span_minutes(started, run.completed_at, now),
        # First stamp to last. Falls back to the run window for a batch whose colour
        # match was never pressed, so the total is never shorter than the run inside it.
        "total_minutes": _span_minutes(matched or started, run.completed_at, now),
    }


def to_yards(qty: Optional[float], item) -> Optional[float]:
    """A logged production qty, in the item's stock UOM, restated in yards.

    Delegates to packing_service so the g/y rule has exactly one home -- including
    its refusal to convert `gsm`, which needs the fabric width.
    """
    if qty is None or item is None:
        return None
    return packing_service.to_yards(
        qty,
        getattr(item, "uom", None),
        getattr(item, "weight_per_unit", None),
        getattr(item, "weight_unit", None),
    )


# -- Actual output -----------------------------------------------------------

async def sum_actual_qty(db: AsyncSession, work_center_id, mo_id,
                         started_at: Optional[datetime],
                         completed_at: Optional[datetime],
                         now: datetime) -> float:
    """Logged production on this vessel, for this MO, inside the batch's RUN window.

    Deliberately the same window the efficiency divides by -- output logged before
    the machine was started belongs to the batch before this one, and counting it
    here would credit this run with someone else's yards.

    A DATETIME window, unlike the weaving monitor's date window: several batches run
    on one vessel in a single day, so bucketing by date would pool this run's output
    with the one before it.

    `work_center_id` is safe to filter on because `add_mo_completion` defaults it to
    the WO's machine (Alembic a4c6e8b0d2f5) -- the operator picker is an override,
    the WO is the dispatch record.
    """
    start = _naive_utc(started_at)
    if start is None:
        return 0.0
    end = _naive_utc(completed_at) or _naive_utc(now)
    q = (
        select(func.coalesce(func.sum(MOCompletion.qty_completed), 0))
        .where(MOCompletion.work_center_id == work_center_id)
        .where(MOCompletion.mo_id == mo_id)
        .where(MOCompletion.rejected == False)  # noqa: E712
        .where(MOCompletion.created_at >= start)
        .where(MOCompletion.created_at <= end)
    )
    return float((await db.execute(q)).scalar() or 0)


# -- Run metrics -------------------------------------------------------------

def _round(v: Optional[float], places: int) -> Optional[float]:
    return None if v is None else round(v, places)


def compute_run_metrics(run, actual_qty: float, item, now: datetime) -> dict:
    """Every displayed number for one dye batch. Pure -- caller supplies the actuals.

    `actual_yards` is None (not 0) when the item carries no g/y factor: the cloth
    was dyed, we simply cannot say how many yards it was. Efficiency follows it to
    None so the card shows a dash rather than accusing the vessel of producing
    nothing.
    """
    lines = int(run.lines or 0)
    ypm = float(run.yards_per_min) if run.yards_per_min is not None else None

    yd_min = yards_per_minute(ypm, lines)
    phases = phase_minutes(run, now)
    # The efficiency window, and only it. A batch still being colour-matched has no
    # run window, so it reports no rate -- as it should, nothing is turning yet.
    elapsed = phases["run_minutes"] or 0.0

    theoretical = (yd_min * elapsed) if yd_min is not None else None
    actual_yards = to_yards(actual_qty, item)
    planned_yards = to_yards(float(run.substrate_qty or 0), item)

    efficiency = None
    if theoretical is not None and theoretical > 0 and actual_yards is not None:
        efficiency = actual_yards / theoretical * 100.0
    actual_rate = (actual_yards / elapsed) if (actual_yards is not None and elapsed > 0) else None

    return {
        "lines": lines,
        "yards_per_min": ypm,
        "target_yd_per_min": _round(yd_min, 3),
        # The run window, under the name every card and the shared grid already read.
        "elapsed_minutes": round(elapsed, 1),
        "color_matching_at": phases["color_matching_at"],
        "prep_minutes": _round(phases["prep_minutes"], 1),
        "run_minutes": _round(phases["run_minutes"], 1),
        "total_minutes": _round(phases["total_minutes"], 1),
        "theoretical_yards": _round(theoretical, 1),
        "actual_qty": round(float(actual_qty or 0), 3),
        "actual_yards": _round(actual_yards, 1),
        "planned_yards": _round(planned_yards, 1),
        "actual_rate_yd_min": _round(actual_rate, 2),
        "efficiency_pct": _round(efficiency, 1),
        # Why there is no number, so the card can say which input is missing rather
        # than showing an unexplained dash.
        "missing_rate_inputs": (
            ([] if ypm else ["yards_per_min"]) + ([] if lines else ["lines"])
        ),
        "missing_gy_factor": actual_yards is None,
    }
