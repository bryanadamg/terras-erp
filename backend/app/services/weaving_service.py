"""Work-center performance monitoring: loom-efficiency calc + production calendar.

Faithful to the client's formula:
  target_100_per_day_kg = (24*60 min) * rate_per_line_g_min * lines / 1000
  target_eff_per_day_kg  = target_100_per_day_kg * target_efficiency_pct/100
  theoretical_100_kg     = target_100_per_day_kg * elapsed_working_days
  efficiency_pct         = actual_kg / theoretical_100_kg * 100   (e.g. 50/129.6 = 38.5%)

A "working day" runs 24h (continuous 3-shift weaving). The production calendar
(working_weekdays + holidays, per machine) decides which calendar days count, and
WeavingRunPause intervals take back the days a parked run was not being woven.

Elapsed counts only days that have FULLY passed: the run's current day is excluded
while it is running, and its end_date is excluded once it is closed. Runs are
recorded at date grain with no machine clock behind them, so a run's real start and
end times inside those two days are unknown — charging them as whole days made a
loom on its first day read at half its true efficiency. Counting whole elapsed days
is the only honest scale the stored data supports. A run that starts and ends the
same date therefore reports no efficiency rather than a fabricated one; weaving
never does that in practice.
"""
from datetime import date, timedelta
from math import ceil
from typing import Optional

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manufacturing import MOCompletion
from app.models.weaving import WeavingRun, WeavingRunPause

MINUTES_PER_DAY = 24 * 60
_MAX_PROJECT_DAYS = 3650  # 10y guard against runaway walks

# An open run on a loom. PAUSED belongs here with RUNNING: the warp is up, the order
# is open and the run still owns its share of that MO's logged output — it is only
# parked while another WO on the same loom is prioritised. Filtering it out would free
# its WO to be started a second time and let the loom fall back to STAGED with its
# prep buttons re-armed under a mounted warp.
ACTIVE_RUN_STATUSES = ("RUNNING", "PAUSED")

# Order states whose arrival closes a loom run. Notably NOT `DELIVERED`: on an MO that
# means "planned qty met, order still open" (this codebase's SAP DLV vs TECO split),
# and a loom may legitimately keep weaving past the planned quantity.
CLOSING_WO_STATUSES = ("COMPLETED", "CANCELLED")


# ── Loom prep state machine ──────────────────────────────────────────────────
# What the floor does to a loom between "warp is up" and "start the run":
#   IDLE → STAGED → DRAW_IN → TUNING → RUNNING
# IDLE/STAGED/RUNNING are DERIVED (from mounted beams and the active run) and
# DRAW_IN/TUNING are the two manual button steps stored on WorkCenter.prep_status.
# Deriving the ends is what keeps the card honest: dismount the warp mid-prep and
# the loom drops straight back to IDLE with no stale "Tuning" left over.
LOOM_STATUS_IDLE = "IDLE"
LOOM_STATUS_STAGED = "STAGED"
LOOM_STATUS_DRAW_IN = "DRAW_IN"
LOOM_STATUS_TUNING = "TUNING"
LOOM_STATUS_RUNNING = "RUNNING"

# Manual steps only, in order. The step before DRAW_IN is the derived STAGED.
LOOM_PREP_STEPS = (LOOM_STATUS_DRAW_IN, LOOM_STATUS_TUNING)
# Predecessor each manual step may be advanced from.
_PREP_PREDECESSOR = {
    LOOM_STATUS_DRAW_IN: LOOM_STATUS_STAGED,
    LOOM_STATUS_TUNING: LOOM_STATUS_DRAW_IN,
}


def derive_loom_status(prep_status: Optional[str], mounted_pcs: int, beam_slots: int,
                       has_active_run: bool) -> str:
    """The single definition of what a loom card shows.

    A run beats everything (RUNNING). Otherwise the warp decides whether prep has
    even begun: below the machine's beam_slots target the loom is not staged, so a
    stored DRAW_IN/TUNING is ignored rather than trusted.
    """
    if has_active_run:
        return LOOM_STATUS_RUNNING
    staged = int(mounted_pcs or 0) >= max(1, int(beam_slots or 1))
    if not staged:
        return LOOM_STATUS_IDLE
    if prep_status in LOOM_PREP_STEPS:
        return prep_status
    return LOOM_STATUS_STAGED


def next_loom_step(current: str) -> Optional[str]:
    """Manual step that may be taken from `current`, or None (nothing to click)."""
    for step, predecessor in _PREP_PREDECESSOR.items():
        if predecessor == current:
            return step
    return None


def prep_transition_error(target: Optional[str], current: str) -> Optional[str]:
    """Why `current → target` is not allowed, or None when it is.

    `target=None` is the reset (back to plain STAGED) and is allowed from either
    manual step, so a mis-click never traps a loom.
    """
    if target is None:
        if current in LOOM_PREP_STEPS:
            return None
        return f"Nothing to reset: loom is {current}"
    if target not in LOOM_PREP_STEPS:
        return f"Unknown loom step '{target}'"
    if current == LOOM_STATUS_RUNNING:
        return "Loom is running; stop the run first"
    if current == LOOM_STATUS_IDLE:
        return "No warp staged on this loom yet"
    expected = _PREP_PREDECESSOR[target]
    if current != expected:
        return f"{target} requires the loom to be {expected} (it is {current})"
    return None


# ── Calendar primitives ──────────────────────────────────────────────────────

def _is_working_day(d: date, weekdays: set, holidays: set) -> bool:
    return d.weekday() in weekdays and d not in holidays


def count_working_days(weekdays, holidays, start: date, end: date) -> int:
    """Count working days in [start, end] inclusive per this machine's calendar."""
    if not weekdays or end < start:
        return 0
    wd = set(weekdays)
    hol = set(holidays or [])
    n = 0
    d = start
    # Bound the loop; production runs never span >10y.
    for _ in range(_MAX_PROJECT_DAYS):
        if d > end:
            break
        if _is_working_day(d, wd, hol):
            n += 1
        d += timedelta(days=1)
    return n


def paused_working_days(pauses, weekdays, holidays, window_end: date) -> int:
    """Working days lost to pauses, per this machine's calendar.

    A loom carries several WOs at once and the floor reprioritises: push one order,
    park the others. A parked run must stop accruing elapsed working days, else its
    efficiency decays for days it was deliberately not being woven.

    Each interval excludes [paused_on, resumed_on - 1] — resuming on a day means that
    day is worked again. An open interval (resumed_on is None) runs to `window_end`.
    Days that were not working days anyway are never double-counted, since the same
    calendar filter does the counting.
    """
    total = 0
    for p in pauses or []:
        start = p.paused_on
        if start is None or start > window_end:
            continue
        end = (p.resumed_on - timedelta(days=1)) if p.resumed_on else window_end
        if end > window_end:
            end = window_end
        total += count_working_days(weekdays, holidays, start, end)
    return total


def is_paused(pauses) -> bool:
    """True while any interval is still open — the run is parked right now."""
    return any(p.resumed_on is None for p in (pauses or []))


def add_working_days(weekdays, holidays, start: date, n: int) -> Optional[date]:
    """Return the date of the n-th working day counting from `start` (inclusive).

    n<=0 returns `start`. Returns None if the calendar has no working weekdays.
    """
    wd = set(weekdays)
    if not wd:
        return None
    if n <= 0:
        return start
    hol = set(holidays or [])
    count = 0
    d = start
    for _ in range(_MAX_PROJECT_DAYS):
        if _is_working_day(d, wd, hol):
            count += 1
            if count >= n:
                return d
        d += timedelta(days=1)
    return None


def walk_to_target(machines: list, target: float, start_date: date, initial: float = 0.0) -> Optional[date]:
    """Walk the calendar day-by-day until cumulative output reaches `target`.

    `machines`: list of dicts {weekdays:set, holidays:set, daily_kg:float}.
    Each machine adds daily_kg on days its own calendar marks as working — so
    machines with different weekdays/holidays combine correctly (2-machine MO).
    Returns the calendar date the target is met, or None if no machine produces.
    """
    if target <= 0:
        return start_date
    cum = float(initial)
    if cum >= target:
        return start_date
    active = [m for m in machines if m.get("daily_kg", 0) > 0 and m.get("weekdays")]
    if not active:
        return None
    d = start_date
    for _ in range(_MAX_PROJECT_DAYS):
        day_out = sum(
            m["daily_kg"] for m in active
            if _is_working_day(d, set(m["weekdays"]), set(m.get("holidays") or []))
        )
        if day_out > 0:
            cum += day_out
            if cum >= target:
                return d
        d += timedelta(days=1)
    return None


# ── Stopping runs ────────────────────────────────────────────────────────────

async def open_pause(db: AsyncSession, run_id):
    """The run's un-resumed pause interval, if it is parked right now."""
    res = await db.execute(
        select(WeavingRunPause)
        .where(WeavingRunPause.run_id == run_id, WeavingRunPause.resumed_on.is_(None))
        .order_by(WeavingRunPause.paused_on.desc())
    )
    return res.scalars().first()


async def stop_run(db: AsyncSession, run, username: Optional[str] = None) -> None:
    """Close one run: DONE, stamp end_date, and close any open pause interval.

    The pause part is why this is a function and not two lines at each call site — a
    parked run stopped with its interval left open would report as paused forever in
    the history table. The caller commits.

    Nothing here touches the work center: prep_status was already cleared when the run
    started, so a stopped loom re-derives its warp state (STAGED / IDLE) on its own.
    """
    was_paused = run.status == "PAUSED"
    run.status = "DONE"
    if not run.end_date:
        run.end_date = date.today()
    if was_paused:
        pause = await open_pause(db, run.id)
        if pause:
            pause.resumed_on = run.end_date
            pause.resumed_by = username


async def stop_runs(db: AsyncSession, work_order_id=None, mo_id=None,
                    username: Optional[str] = None) -> list:
    """Close every ACTIVE run of a work order (or of an MO) and return them.

    The automatic counterpart to the Stop button: a WO that is completed, cancelled or
    deleted is no longer being woven, and a run left RUNNING would keep accruing
    elapsed working days against an order nobody is working — the same distortion
    pausing exists to prevent, arrived at by neglect instead of choice.

    Pass `mo_id` for the MO-level closes: closing an MO does not cascade to its work
    orders in this codebase, and it also catches WO-less runs (a loom started against
    an MO directly), which a work_order_id filter would miss.
    """
    if work_order_id is None and mo_id is None:
        raise ValueError("stop_runs needs a work_order_id or an mo_id")
    q = select(WeavingRun).where(WeavingRun.status.in_(ACTIVE_RUN_STATUSES))
    if work_order_id is not None:
        q = q.where(WeavingRun.work_order_id == work_order_id)
    else:
        q = q.where(WeavingRun.mo_id == mo_id)
    runs = list((await db.execute(q)).scalars().all())
    for run in runs:
        await stop_run(db, run, username=username)
    return runs


async def audit_and_broadcast_stops(db: AsyncSession, user_id, runs: list, reason: str) -> None:
    """Log + push the runs an automatic close stopped. Call AFTER db.commit().

    Same entity_type and event shape as the manual Stop button, so the monitor's live
    refresh and the audit trail don't care which one closed the run. Imports are local:
    audit_service and the WS manager sit above this module in the import graph.
    """
    if not runs:
        return
    from app.services import audit_service
    from app.core.ws_manager import manager

    for run in runs:
        await audit_service.log_activity(
            db, user_id, "UPDATE", "weaving_run", str(run.id),
            details=f"Auto-stopped: {reason}",
        )
    for wc_id in {str(r.work_center_id) for r in runs}:
        await manager.broadcast({"type": "WEAVING_RUN_UPDATE", "action": "stop", "work_center_id": wc_id})


# ── Actual output ────────────────────────────────────────────────────────────

async def sum_actual_kg(db: AsyncSession, work_center_id, mo_id, start_date: date, end_date: Optional[date]) -> float:
    """Sum logged MOCompletion qty on this machine, for this MO, within the run window."""
    q = (
        select(func.coalesce(func.sum(MOCompletion.qty_completed), 0))
        .where(MOCompletion.work_center_id == work_center_id)
        .where(MOCompletion.mo_id == mo_id)
        .where(MOCompletion.rejected == False)  # noqa: E712
        .where(MOCompletion.created_at >= start_date)
    )
    if end_date:
        q = q.where(MOCompletion.created_at < end_date + timedelta(days=1))
    result = await db.execute(q)
    return float(result.scalar() or 0)


# ── Run metrics ──────────────────────────────────────────────────────────────

def target_100_per_day_kg(rate_per_line_g_min: float, lines: int) -> float:
    return MINUTES_PER_DAY * float(rate_per_line_g_min) * int(lines) / 1000.0


def lateness(projected: Optional[date], wo_target: Optional[date], plan_target: Optional[date],
             unreachable: bool = False) -> dict:
    """Compare the reality-rate projection against the date the order promised.

    Two baselines, in priority order:
      * `wo_target` — WO.target_end_date, the date entered when the WO was created.
        This is the promise; it is what the floor is judged against.
      * `plan_target` — the date the run's own target rate would have hit, used only
        when the WO carries no target date, so the warning still has something to
        compare with.
    A projection later than the baseline is the signal the client asked for: add a
    machine, or add working days.

    `unreachable` covers the worst case, which has no date at all: the loom has been
    running for at least one working day and produced nothing (or too little to ever
    reach the target), so the walk never lands. That must read as LATE — reporting a
    dead loom as on schedule because there is no projected date to compare is exactly
    backwards. `days_late` stays 0 there because "how late" is undefined.
    """
    baseline = wo_target or plan_target
    basis = "WO" if wo_target else ("PLAN" if plan_target else None)
    if projected is None:
        late = bool(unreachable and baseline is not None)
        return {
            "baseline_date": baseline, "baseline_basis": basis,
            "is_late": late, "days_late": 0, "reality_unreachable": bool(unreachable),
        }
    if baseline is None:
        return {"baseline_date": None, "baseline_basis": None, "is_late": False,
                "days_late": 0, "reality_unreachable": False}
    days = (projected - baseline).days
    return {
        "baseline_date": baseline,
        "baseline_basis": basis,
        "is_late": days > 0,
        "days_late": days if days > 0 else 0,
        "reality_unreachable": False,
    }


def compute_run_metrics(run, actual_kg: float, weekdays, holidays, today: date,
                        pauses=None) -> dict:
    """All displayed numbers for one run. Pure — caller supplies actual_kg + calendar.

    `pauses` are the run's WeavingRunPause intervals; the days they cover are removed
    from `elapsed_working_days`, so a parked WO holds the efficiency it earned while
    it was actually on the loom.
    """
    lines = int(run.lines or 0)
    rate = float(run.rate_per_line_g_min or 0)
    eff_target = float(run.target_efficiency_pct or 0)

    t100_day = target_100_per_day_kg(rate, lines)
    t_eff_day = t100_day * eff_target / 100.0

    window_end = run.end_date if run.end_date else today
    if window_end > today:
        window_end = today
    # Exclusive of window_end: that day is in progress (a running run) or was cut
    # short (the day the run was stopped), and nothing records when inside it either
    # happened. Count only the days that fully elapsed. See the module docstring.
    window_end -= timedelta(days=1)
    elapsed = count_working_days(weekdays, holidays, run.start_date, window_end)
    paused = paused_working_days(pauses, weekdays, holidays, window_end)
    # Never below zero: a pause opened before the run's start_date would otherwise
    # subtract days the run never had.
    elapsed = max(0, elapsed - paused)

    theoretical_100 = t100_day * elapsed
    efficiency_pct = (actual_kg / theoretical_100 * 100.0) if theoretical_100 > 0 else None
    actual_daily_rate = (actual_kg / elapsed) if elapsed > 0 else None

    return {
        "lines": lines,
        "rate_per_line_g_min": rate,
        "target_efficiency_pct": eff_target,
        "target_100_per_day_kg": round(t100_day, 3),
        "target_eff_per_day_kg": round(t_eff_day, 3),
        "elapsed_working_days": elapsed,
        "paused_working_days": paused,
        "is_paused": is_paused(pauses),
        "theoretical_100_kg": round(theoretical_100, 3),
        "actual_kg": round(actual_kg, 3),
        "efficiency_pct": round(efficiency_pct, 1) if efficiency_pct is not None else None,
        "actual_daily_rate_kg": round(actual_daily_rate, 3) if actual_daily_rate is not None else None,
        "on_target": (efficiency_pct >= eff_target) if efficiency_pct is not None else None,
    }
