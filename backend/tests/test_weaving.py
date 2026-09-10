"""Loom-efficiency calculation: the pure calendar + metrics functions.

No DB — compute_run_metrics and the calendar primitives take their calendar and
their actual_kg from the caller, so the arithmetic the floor is judged on can be
pinned down directly.
"""
from datetime import date
from types import SimpleNamespace

from app.services import weaving_service


# Mon-Fri, the WorkCenter default.
WEEKDAYS = [0, 1, 2, 3, 4]


def _pause(paused_on: str, resumed_on: str = None):
    return SimpleNamespace(
        paused_on=date.fromisoformat(paused_on),
        resumed_on=date.fromisoformat(resumed_on) if resumed_on else None,
    )


def _run(start_date="2026-03-02", lines=2, rate=5, target_eff=50, end_date=None):
    return SimpleNamespace(
        lines=lines,
        rate_per_line_g_min=rate,
        target_efficiency_pct=target_eff,
        start_date=date.fromisoformat(start_date),
        end_date=date.fromisoformat(end_date) if end_date else None,
    )


# ── paused_working_days ──────────────────────────────────────────────────────

def test_closed_pause_excludes_up_to_the_day_before_resume():
    """Paused Wed, resumed Fri: Wed+Thu are lost, Fri is worked again."""
    pauses = [_pause("2026-03-04", "2026-03-06")]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 2


def test_pause_spanning_a_weekend_only_counts_working_days():
    """Paused Fri, resumed Tue: Fri + Mon are lost; Sat/Sun were never working days."""
    pauses = [_pause("2026-03-06", "2026-03-10")]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 2


def test_pause_and_resume_on_the_same_day_loses_nothing():
    pauses = [_pause("2026-03-04", "2026-03-04")]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 0


def test_open_pause_runs_to_the_window_end():
    """Still paused: everything from paused_on to today is excluded."""
    pauses = [_pause("2026-03-09")]
    # Mon 9th .. Fri 13th = 5 working days.
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 5


def test_pause_does_not_double_count_a_holiday():
    """A holiday inside the pause was already not a working day."""
    pauses = [_pause("2026-03-09", "2026-03-13")]  # Mon..Thu = 4 working days
    holidays = [date(2026, 3, 11)]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, holidays, date(2026, 3, 13)
    ) == 3


def test_multiple_pause_cycles_sum():
    pauses = [
        _pause("2026-03-04", "2026-03-06"),  # Wed+Thu = 2
        _pause("2026-03-09", "2026-03-10"),  # Mon     = 1
    ]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 3


def test_pause_is_clipped_to_the_window_end():
    """A pause opened after the run's window closed costs nothing."""
    pauses = [_pause("2026-03-16")]
    assert weaving_service.paused_working_days(
        pauses, WEEKDAYS, [], date(2026, 3, 13)
    ) == 0


def test_no_pauses_is_zero():
    assert weaving_service.paused_working_days([], WEEKDAYS, [], date(2026, 3, 13)) == 0


# ── compute_run_metrics with pauses ──────────────────────────────────────────

def test_elapsed_days_exclude_the_paused_window():
    """The whole point: a deprioritized WO stops accruing elapsed working days.

    Run starts Mon 2nd, today is Fri 13th → Mon 2nd..Thu 12th fully elapsed = 9
    working days (today itself never counts). Paused Mon 9th and never resumed →
    Mon 9th..Thu 12th are excluded, leaving 5.
    """
    run = _run(start_date="2026-03-02")
    metrics = weaving_service.compute_run_metrics(
        run, actual_kg=50.0, weekdays=WEEKDAYS, holidays=[], today=date(2026, 3, 13),
        pauses=[_pause("2026-03-09")],
    )
    assert metrics["elapsed_working_days"] == 5
    assert metrics["paused_working_days"] == 4
    # 2 lines * 5 g/min * 1440 min = 14.4 kg/day at 100%.
    assert metrics["theoretical_100_kg"] == 72.0
    assert metrics["efficiency_pct"] == 69.4  # 50 / 72
    assert metrics["is_paused"] is True


def test_efficiency_is_frozen_while_paused():
    """Same run, same output, two different 'today's while paused: identical %.

    Without the pause the second reading would drop, punishing the WO for days it
    was deliberately not being woven.
    """
    run = _run(start_date="2026-03-02")
    pauses = [_pause("2026-03-09")]
    first = weaving_service.compute_run_metrics(
        run, 50.0, WEEKDAYS, [], date(2026, 3, 10), pauses=pauses)
    later = weaving_service.compute_run_metrics(
        run, 50.0, WEEKDAYS, [], date(2026, 3, 13), pauses=pauses)
    assert first["elapsed_working_days"] == later["elapsed_working_days"] == 5
    assert first["efficiency_pct"] == later["efficiency_pct"]


def test_unpaused_run_counts_only_fully_elapsed_days():
    """No pauses: Mon 2nd..Thu 12th = 9 days. Fri 13th is today, still in progress."""
    run = _run(start_date="2026-03-02")
    metrics = weaving_service.compute_run_metrics(
        run, 50.0, WEEKDAYS, [], date(2026, 3, 13))
    assert metrics["elapsed_working_days"] == 9
    assert metrics["paused_working_days"] == 0
    assert metrics["theoretical_100_kg"] == 129.6
    assert metrics["efficiency_pct"] == 38.6  # 50 / 129.6
    assert metrics["is_paused"] is False


def test_the_current_day_never_counts():
    """A run started yesterday has one elapsed day, not two.

    Runs are stored at date grain with no machine clock behind them, so today is an
    unknown fraction of a day. Charging it whole is what made a loom on its first
    day read at half its real efficiency.
    """
    run = _run(start_date="2026-03-11")  # Wed
    metrics = weaving_service.compute_run_metrics(
        run, 14.4, WEEKDAYS, [], date(2026, 3, 12))  # Thu
    assert metrics["elapsed_working_days"] == 1
    assert metrics["theoretical_100_kg"] == 14.4
    assert metrics["efficiency_pct"] == 100.0
    assert metrics["actual_daily_rate_kg"] == 14.4


def test_a_run_on_its_first_day_reports_no_efficiency():
    """Started today: nothing has elapsed, so there is no denominator to divide by.

    None, not 0% — the loom is not failing, it has not been measured yet.
    """
    run = _run(start_date="2026-03-11")
    metrics = weaving_service.compute_run_metrics(
        run, 5.0, WEEKDAYS, [], date(2026, 3, 11))
    assert metrics["elapsed_working_days"] == 0
    assert metrics["efficiency_pct"] is None
    assert metrics["actual_daily_rate_kg"] is None
    assert metrics["on_target"] is None


def test_a_closed_run_excludes_its_end_date():
    """Mon 2nd → stopped Fri 6th: the stopping day was cut short at an unknown hour,
    so it is excluded exactly like a running run's today. 4 days, not 5.

    Today moving on afterwards must not change a closed run's numbers.
    """
    run = _run(start_date="2026-03-02", end_date="2026-03-06")
    metrics = weaving_service.compute_run_metrics(
        run, 50.0, WEEKDAYS, [], date(2026, 3, 20))
    assert metrics["elapsed_working_days"] == 4
    assert metrics["theoretical_100_kg"] == 57.6


def test_fully_paused_run_reports_no_efficiency_rather_than_zero():
    """Paused on its own start date: no elapsed day has ever counted.

    efficiency must be None (unknown), not 0% — the same guard the pre-pause code
    used for a run started today.
    """
    run = _run(start_date="2026-03-02")
    metrics = weaving_service.compute_run_metrics(
        run, 0.0, WEEKDAYS, [], date(2026, 3, 13), pauses=[_pause("2026-03-02")])
    assert metrics["elapsed_working_days"] == 0
    assert metrics["efficiency_pct"] is None
    assert metrics["actual_daily_rate_kg"] is None
    assert metrics["on_target"] is None


def test_closing_statuses_exclude_delivered():
    """DELIVERED means "plan qty met, order still open" — the loom may still be weaving.

    Only an explicit close stops a run. Pinned because folding DELIVERED in here would
    silently stop runs on every MO that hits its planned quantity.
    """
    assert "COMPLETED" in weaving_service.CLOSING_WO_STATUSES
    assert "CANCELLED" in weaving_service.CLOSING_WO_STATUSES
    assert "DELIVERED" not in weaving_service.CLOSING_WO_STATUSES
    assert "IN_PROGRESS" not in weaving_service.CLOSING_WO_STATUSES


def test_stop_run_closes_the_open_pause_interval():
    """Stopping a parked run must close its interval, or it reports paused forever."""
    import asyncio
    from types import SimpleNamespace as NS

    run = NS(status="PAUSED", end_date=None, id="r1")
    pause = _pause("2026-03-09")

    async def fake_open_pause(db, run_id):
        return pause

    real = weaving_service.open_pause
    weaving_service.open_pause = fake_open_pause
    try:
        asyncio.run(weaving_service.stop_run(None, run, username="tester"))
    finally:
        weaving_service.open_pause = real

    assert run.status == "DONE"
    assert run.end_date == date.today()
    assert pause.resumed_on == run.end_date
    assert pause.resumed_by == "tester"


def test_stop_run_leaves_an_unpaused_run_alone_apart_from_closing_it():
    import asyncio
    from types import SimpleNamespace as NS

    run = NS(status="RUNNING", end_date=None, id="r2")
    asyncio.run(weaving_service.stop_run(None, run, username="tester"))
    assert run.status == "DONE" and run.end_date == date.today()


def test_stop_run_keeps_an_existing_end_date():
    """A run already stamped with an end date keeps it — don't rewrite history."""
    import asyncio
    from types import SimpleNamespace as NS

    run = NS(status="RUNNING", end_date=date(2026, 3, 10), id="r3")
    asyncio.run(weaving_service.stop_run(None, run, username="tester"))
    assert run.end_date == date(2026, 3, 10)


def test_stop_runs_requires_a_target():
    import asyncio
    import pytest

    with pytest.raises(ValueError):
        asyncio.run(weaving_service.stop_runs(None, username="tester"))


def test_at_most_one_open_pause_per_run(db_session):
    """The DB, not just the API, refuses a second open pause on one run.

    The endpoint checks run.status before inserting, which is check-then-write: two
    operators hitting Pause on the same card would both pass the check. The partial
    unique index is what actually stops the run losing its days twice.
    """
    import uuid as _uuid
    import pytest
    from sqlalchemy.exc import IntegrityError
    from app.models.weaving import WeavingRun, WeavingRunPause
    from app.models.routing import WorkCenter
    from app.models.manufacturing import ManufacturingOrder

    wc = db_session.query(WorkCenter).first()
    mo = db_session.query(ManufacturingOrder).first()
    if not wc or not mo:
        pytest.skip("needs a seeded work center + manufacturing order")

    run = WeavingRun(
        work_center_id=wc.id, mo_id=mo.id, lines=2, rate_per_line_g_min=5,
        target_efficiency_pct=50, start_date=date(2026, 3, 2), status="PAUSED",
    )
    db_session.add(run)
    db_session.flush()

    db_session.add(WeavingRunPause(run_id=run.id, paused_on=date(2026, 3, 9)))
    db_session.flush()

    # Second OPEN pause on the same run — must be rejected.
    db_session.add(WeavingRunPause(run_id=run.id, paused_on=date(2026, 3, 10)))
    with pytest.raises(IntegrityError):
        db_session.flush()
    db_session.rollback()


def test_resumed_run_accrues_again():
    """Paused Mon 9th, resumed Wed 11th: only Mon+Tue lost out of the 9 elapsed."""
    run = _run(start_date="2026-03-02")
    metrics = weaving_service.compute_run_metrics(
        run, 50.0, WEEKDAYS, [], date(2026, 3, 13),
        pauses=[_pause("2026-03-09", "2026-03-11")],
    )
    assert metrics["elapsed_working_days"] == 7
    assert metrics["paused_working_days"] == 2
    assert metrics["is_paused"] is False
