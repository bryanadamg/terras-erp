"""Dyeing vessel monitor: what the clock says a batch produced vs what its WO asked for.

Deliberately NOT shared with `weaving_service`. A loom runs continuously for days
and is measured in kg against a calendar of working days; a dye batch fits inside
one shift and is measured against the clock the floor stamps by hand:

    time-based output = yards_per_min * lines * run_minutes    (yards)
                      -> restated in the item's stock UOM through its g/y factor
    progress_pct      = time-based output / WO qty * 100

Both rate factors live on the DyeingRun and are chosen per load: `yards_per_min`
is how fast ONE rope is run (picked off the `Dyeing Speed` system attribute, not
typed), `lines` is how many ropes the vessel carries. `run_minutes` is the window
between the monitor's Start and Complete stamps. Any factor missing yields None --
never 0, which would read as a vessel producing nothing rather than a batch nobody
has set a speed for.

The comparison is against the WO's assigned qty, not logged completions: the
question the floor asks is "did the machine run long enough, fast enough, for the
mass it was given", and a completion logged a minute after Complete must not make a
full batch read short.
"""
from datetime import datetime, timezone
from typing import Optional

from app.services import packing_service

# Work centre types that are dyeing vessels. `CELUP` is the Indonesian name and is
# already treated as a synonym in work_queue_service and api/manufacturing.
DYEING_CENTER_TYPES = ("DYEING", "CELUP")

# The monitor's own clock state, read off the stamps and never off
# `DyeingRun.status`: a bath configured in Dyeing Orders makes a run IN_PROGRESS
# before anyone switches the machine on, and a run reads COMPLETED the moment its
# WO closes while the clock may still be running. Values are STATUS_FAMILY keys.
CLOCK_WAITING = "PENDING"
CLOCK_RUNNING = "IN_PROGRESS"
CLOCK_DONE = "COMPLETED"


def clock_state(started_at, completed_at) -> str:
    if started_at is None:
        return CLOCK_WAITING
    return CLOCK_RUNNING if completed_at is None else CLOCK_DONE


def yards_per_minute(yards_per_min: Optional[float], lines: Optional[int]) -> Optional[float]:
    """Vessel speed in yards/min, or None when a factor is unset."""
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


def run_minutes(started_at, completed_at, now: datetime) -> Optional[float]:
    """Start-to-Complete in wall-clock minutes, running to `now` while open.

    None when the clock was never started -- distinct from 0.0, started a second ago.
    """
    s = _aware(started_at)
    if s is None:
        return None
    e = _aware(completed_at) or now
    return max((e - s).total_seconds() / 60.0, 0.0)


def to_yards(qty: Optional[float], item) -> Optional[float]:
    """A qty in the item's stock UOM restated in yards. Delegates to packing_service
    so the g/y rule has exactly one home -- including its refusal to convert `gsm`,
    which needs the fabric width."""
    if qty is None or item is None:
        return None
    return packing_service.to_yards(
        qty,
        getattr(item, "uom", None),
        getattr(item, "weight_per_unit", None),
        getattr(item, "weight_unit", None),
    )


def _round(v: Optional[float], places: int) -> Optional[float]:
    return None if v is None else round(v, places)


def compute_run_metrics(run, target_qty: Optional[float], item, now: datetime) -> dict:
    """Every displayed number for one dye batch. Pure -- caller supplies the target."""
    lines = int(run.lines or 0)
    ypm = float(run.yards_per_min) if run.yards_per_min is not None else None
    yd_min = yards_per_minute(ypm, lines)
    minutes = run_minutes(run.started_at, run.completed_at, now)

    time_yards = yd_min * minutes if (yd_min is not None and minutes is not None) else None
    # Yards one stock unit buys (1000/g-per-yard for a kg item, 1 for a yard item),
    # so the division below is `yards * g/y / 1000` without a second copy of the rule.
    yards_per_unit = to_yards(1.0, item)
    time_qty = (time_yards / yards_per_unit) if (time_yards is not None and yards_per_unit) else None

    target = float(target_qty) if target_qty else None
    progress = (time_qty / target * 100.0) if (time_qty is not None and target) else None

    return {
        "clock": clock_state(run.started_at, run.completed_at),
        "lines": lines,
        "yards_per_min": ypm,
        "rate_yd_per_min": _round(yd_min, 3),
        "run_minutes": _round(minutes, 1),
        "time_yards": _round(time_yards, 1),
        "time_qty": _round(time_qty, 3),
        "target_qty": target,
        "progress_pct": _round(progress, 1),
        # Why there is no number, so the row can name the missing input rather than
        # showing an unexplained dash.
        "missing_rate_inputs": (
            ([] if ypm else ["yards_per_min"]) + ([] if lines else ["lines"])
        ),
        "missing_gy_factor": yards_per_unit is None,
    }
