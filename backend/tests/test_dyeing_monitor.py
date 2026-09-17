"""Dyeing vessel efficiency: the phase clocks, the rate chain, and the grid shape.

The arithmetic half needs no DB — compute_run_metrics takes its actuals and its
clock from the caller, so the numbers the floor is judged on can be pinned down
directly (same shape as test_weaving.py).
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import dyeing_monitor_service as svc
from app.services import dyeing_run_service
from app.services import packing_service


NOW = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)


def _item(uom="kg", weight_per_unit=200.0, weight_unit="g/y"):
    return SimpleNamespace(uom=uom, weight_per_unit=weight_per_unit, weight_unit=weight_unit)


def _run(yards_per_min=540, lines=2, started_min_ago=60, completed=None, substrate=500,
         matched_min_ago=None):
    return SimpleNamespace(
        yards_per_min=yards_per_min,
        lines=lines,
        substrate_qty=substrate,
        color_matching_at=NOW - timedelta(minutes=matched_min_ago) if matched_min_ago is not None else None,
        started_at=NOW - timedelta(minutes=started_min_ago) if started_min_ago is not None else None,
        completed_at=completed,
    )


# -- yards_per_minute --------------------------------------------------------

def test_rate_is_the_picked_speed_times_the_rope_count():
    assert svc.yards_per_minute(540, 2) == pytest.approx(1080.0)


@pytest.mark.parametrize("ypm, lines", [
    (None, 2),   # nobody picked a speed for this batch
    (540, 0),    # no rope count
    (0, 2),
])
def test_rate_is_none_when_either_factor_is_unset(ypm, lines):
    """None, never 0. A 0 would divide into a null efficiency for the wrong reason
    and read as a vessel producing nothing rather than one nobody has set up."""
    assert svc.yards_per_minute(ypm, lines) is None


# -- phase clocks ------------------------------------------------------------

def test_run_window_elapses_to_now_while_the_batch_is_on():
    assert svc.phase_minutes(_run(started_min_ago=90), NOW)["run_minutes"] == pytest.approx(90.0)


def test_finished_run_is_frozen_at_its_own_completion():
    """A completed batch must not keep accruing run time after it came off."""
    run = _run(started_min_ago=300, completed=NOW - timedelta(hours=3))
    assert svc.phase_minutes(run, NOW)["run_minutes"] == pytest.approx(120.0)


def test_unstarted_run_has_no_run_window():
    """None, not 0.0 — the batch has not been on the machine at all, which is a
    different fact from having been on it for no time."""
    assert svc.phase_minutes(_run(started_min_ago=None), NOW)["run_minutes"] is None


def test_prep_is_the_gap_between_matching_and_start():
    run = _run(matched_min_ago=180, started_min_ago=60)
    phases = svc.phase_minutes(run, NOW)
    assert phases["prep_minutes"] == pytest.approx(120.0)
    assert phases["run_minutes"] == pytest.approx(60.0)


def test_prep_runs_live_until_the_batch_starts():
    """The whole reason the phase is stamped: a vessel sitting on a shade since 8am
    has to show that wait growing, not a dash."""
    run = _run(matched_min_ago=200, started_min_ago=None)
    assert svc.phase_minutes(run, NOW)["prep_minutes"] == pytest.approx(200.0)


def test_prep_stops_growing_once_the_batch_is_running():
    """`now` must not leak into a closed gap — the prep figure is a fact after the
    start, and a live one would climb for the whole run."""
    run = _run(matched_min_ago=180, started_min_ago=60)
    later = svc.phase_minutes(run, NOW + timedelta(hours=4))
    assert later["prep_minutes"] == pytest.approx(120.0)


def test_unmatched_run_reports_no_prep_rather_than_zero():
    run = _run(matched_min_ago=None, started_min_ago=60)
    assert svc.phase_minutes(run, NOW)["prep_minutes"] is None


def test_total_spans_the_first_stamp_to_the_last():
    run = _run(matched_min_ago=180, started_min_ago=60, completed=NOW - timedelta(minutes=10))
    assert svc.phase_minutes(run, NOW)["total_minutes"] == pytest.approx(170.0)


def test_total_falls_back_to_the_run_when_matching_was_never_pressed():
    """Never shorter than the run inside it."""
    run = _run(matched_min_ago=None, started_min_ago=45)
    phases = svc.phase_minutes(run, NOW)
    assert phases["total_minutes"] == pytest.approx(phases["run_minutes"])


def test_naive_timestamps_are_treated_as_utc():
    """Postgres hands back naive datetimes; subtracting one from an aware `now`
    raises TypeError unless they are reconciled."""
    run = _run(started_min_ago=30)
    run.started_at = run.started_at.replace(tzinfo=None)
    assert svc.phase_minutes(run, NOW)["run_minutes"] == pytest.approx(30.0)


def test_query_bounds_are_naive_utc():
    """MOCompletion.created_at is TIMESTAMP WITHOUT TIME ZONE while
    DyeingRun.started_at is tz-aware. Binding an aware bound against the naive
    column makes asyncpg raise outright, which is how this was found — the bounds
    must be normalised to UTC and stripped."""
    aware = datetime(2026, 9, 6, 12, 0, tzinfo=timezone.utc)
    assert svc._naive_utc(aware) == datetime(2026, 9, 6, 12, 0)
    assert svc._naive_utc(aware).tzinfo is None


def test_query_bounds_normalise_a_non_utc_offset_before_stripping():
    """Stripping tzinfo without converting first would shift the window by the
    offset and silently pull in the previous batch's completions."""
    jakarta = timezone(timedelta(hours=7))
    assert svc._naive_utc(datetime(2026, 9, 6, 19, 0, tzinfo=jakarta)) == datetime(2026, 9, 6, 12, 0)


# -- to_yards ----------------------------------------------------------------

def test_kg_converts_to_yards_through_the_item_gy_factor():
    # 200 g/y: 100 kg = 100_000 g = 500 yards.
    assert svc.to_yards(100.0, _item()) == pytest.approx(500.0)


def test_yard_stocked_item_needs_no_conversion():
    assert svc.to_yards(500.0, _item(uom="yard", weight_per_unit=None, weight_unit=None)) == pytest.approx(500.0)


def test_metre_stocked_item_converts_to_yards():
    assert svc.to_yards(100.0, _item(uom="m", weight_per_unit=None, weight_unit=None)) == pytest.approx(109.361, rel=1e-4)


def test_gsm_item_yields_no_yards():
    """gsm needs the fabric width. Same refusal packing_service.base_per_alt makes —
    a figure wrong by the width is worse than no figure."""
    assert svc.to_yards(100.0, _item(weight_unit="gsm")) is None


def test_to_yards_is_the_inverse_of_base_per_alt():
    """The two conversions must agree, or a packing order and a dye card would
    describe the same cloth as two different lengths."""
    kg_per_yard = packing_service.base_per_alt(1, "yard", "kg", weight_per_unit=200.0, weight_unit="g/y")
    assert packing_service.to_yards(kg_per_yard * 500, "kg", 200.0, "g/y") == pytest.approx(500.0)


# -- compute_run_metrics -----------------------------------------------------

def test_efficiency_is_actual_yards_over_the_theoretical_walk():
    """60 min at 1080 yd/min = 64 800 theoretical yards. 200 g/y means the 6480 kg
    logged is 32 400 yards — exactly half, so 50%."""
    m = svc.compute_run_metrics(_run(), actual_qty=6480.0, item=_item(), now=NOW)
    assert m["target_yd_per_min"] == pytest.approx(1080.0)
    assert m["theoretical_yards"] == pytest.approx(64800.0)
    assert m["actual_yards"] == pytest.approx(32400.0)
    assert m["efficiency_pct"] == pytest.approx(50.0)


def test_efficiency_ignores_the_time_spent_colour_matching():
    """The point of splitting the phases. Four hours on a shade then one hour of
    dyeing must score the same as a batch that never waited — it is a colour
    problem, not a slow vessel."""
    waited = svc.compute_run_metrics(
        _run(matched_min_ago=300, started_min_ago=60), 6480.0, _item(), NOW)
    straight = svc.compute_run_metrics(
        _run(matched_min_ago=61, started_min_ago=60), 6480.0, _item(), NOW)
    assert waited["efficiency_pct"] == pytest.approx(straight["efficiency_pct"])
    assert waited["prep_minutes"] == pytest.approx(240.0)


def test_nothing_is_scored_against_a_target():
    """The floor asked for these reported, not judged. A stray target key would put
    a pass/fail colour back on a card that has no bar to clear."""
    m = svc.compute_run_metrics(_run(), 6480.0, _item(), NOW)
    assert "on_target" not in m
    assert "target_efficiency_pct" not in m


def test_batch_without_a_picked_speed_reports_no_efficiency_and_says_why():
    """It must show a dash, not a zero, and the card has to name the missing input."""
    m = svc.compute_run_metrics(_run(yards_per_min=None), actual_qty=6480.0, item=_item(), now=NOW)
    assert m["efficiency_pct"] is None
    assert m["theoretical_yards"] is None
    assert "yards_per_min" in m["missing_rate_inputs"]


def test_missing_gy_factor_reports_no_efficiency_and_says_why():
    m = svc.compute_run_metrics(_run(), 6480.0, _item(weight_unit="gsm"), NOW)
    assert m["actual_yards"] is None
    assert m["efficiency_pct"] is None
    assert m["missing_gy_factor"] is True


def test_unstarted_run_has_no_efficiency_rather_than_zero():
    """A PENDING or COLOR_MATCHING batch has no run window. Dividing by a 0
    denominator must not surface as 0% — nothing is turning yet."""
    m = svc.compute_run_metrics(_run(started_min_ago=None, matched_min_ago=30), 0.0, _item(), NOW)
    assert m["elapsed_minutes"] == 0.0
    assert m["theoretical_yards"] == 0.0
    assert m["efficiency_pct"] is None


def test_zero_output_on_a_running_vessel_is_zero_percent_not_none():
    """The opposite case, and the distinction the whole None-vs-0 rule exists for:
    a set-up machine that has been running an hour and logged nothing IS at 0%."""
    m = svc.compute_run_metrics(_run(), 0.0, _item(), NOW)
    assert m["efficiency_pct"] == pytest.approx(0.0)


# -- derive_status (the run's own phase) -------------------------------------

def _status_run(**kw):
    base = dict(completed_at=None, started_at=None, volume_air_liters=None, color_matching_at=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_colour_matching_is_derived_from_its_stamp():
    assert dyeing_run_service.derive_status(
        _status_run(color_matching_at=NOW), "IN_PROGRESS") == "COLOR_MATCHING"


def test_a_filled_bath_beats_the_colour_match():
    """Matching is the phase BEFORE the machine runs, so a recorded bath means the
    batch has left it."""
    assert dyeing_run_service.derive_status(
        _status_run(color_matching_at=NOW, volume_air_liters=900), "IN_PROGRESS") == "IN_PROGRESS"


def test_a_closed_wo_still_closes_a_matched_bath():
    assert dyeing_run_service.derive_status(
        _status_run(color_matching_at=NOW), "COMPLETED") == "COMPLETED"


def test_untouched_run_is_pending():
    assert dyeing_run_service.derive_status(_status_run(), "PENDING") == "PENDING"


# -- derive_machine_status ---------------------------------------------------

@pytest.mark.parametrize("active, matching, pending, expected", [
    (True, True, True, "RUNNING"),     # a run beats everything queued behind it
    (True, False, False, "RUNNING"),
    (False, True, True, "MATCHING"),   # somebody is working on it
    (False, True, False, "MATCHING"),
    (False, False, True, "LOADED"),    # nobody has touched it
    (False, False, False, "IDLE"),
])
def test_machine_status_is_derived_from_the_runs_alone(active, matching, pending, expected):
    assert svc.derive_machine_status(active, matching, pending) == expected


# -- endpoint ----------------------------------------------------------------

def test_monitor_returns_an_envelope_even_with_no_dyeing_machines(client, auth_headers):
    res = client.get("/api/dyeing/monitor", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    for key in ("machines", "total", "running", "groups", "avg_efficiency_pct",
                "active_runs", "matching", "needs_setup"):
        assert key in body, f"{key} missing from the monitor envelope"


def _seed_vessels(client, async_db_session):
    """Put a TYPE root and two vessels under it on the ASYNC connection.

    `POST /work-centers` is a sync route and `GET /dyeing/monitor` is async; the two
    sit on separate non-committing connections in this harness, so anything seeded
    over the sync HTTP call is invisible to the async route (see the conftest note
    on `async_db_session`). Cross-domain setup has to land here instead.
    """
    from app.models.routing import WorkCenter

    root = WorkCenter(code="T-CELUP", name="Celup Continuous", center_type="DYEING",
                      node_type="TYPE")
    one = WorkCenter(code="T-CC01", name="Celup Continuous 01", center_type="DYEING",
                     node_type="MACHINE")
    two = WorkCenter(code="T-CC02", name="Celup Continuous 02", center_type="DYEING",
                     node_type="MACHINE")

    async def _seed():
        async_db_session.add(root)
        await async_db_session.flush()
        one.parent_id = root.id
        two.parent_id = root.id
        async_db_session.add_all([one, two])
        await async_db_session.flush()

    client.portal.call(_seed)


def test_monitor_lists_dyeing_machines_under_their_type_root(client, auth_headers, async_db_session):
    """Vessels hang straight off their TYPE root, so the grid must fall back to the
    TYPE for grouping — a GROUP-only walk tips every vessel into one Ungrouped pile."""
    _seed_vessels(client, async_db_session)

    body = client.get("/api/dyeing/monitor", headers=auth_headers).json()
    row = next(m for m in body["machines"] if m["code"] == "T-CC01")
    assert row["loom_status"] == "IDLE"
    assert row["group_code"] == "T-CELUP"
    # TYPE rows are containers, never cards.
    assert all(m["code"] != "T-CELUP" for m in body["machines"])
    assert {"id", "code", "name"} <= set(body["groups"][0])


def test_an_idle_vessel_needs_no_setup(client, auth_headers, async_db_session):
    """The speed is a per-BATCH input now, not machine geometry, so a vessel with
    nothing in it is not missing anything — the old flag was on the work center."""
    _seed_vessels(client, async_db_session)

    body = client.get("/api/dyeing/monitor", headers=auth_headers).json()
    row = next(m for m in body["machines"] if m["code"] == "T-CC02")
    assert row["needs_setup"] == 0


def test_work_center_no_longer_carries_reel_geometry(client, auth_headers):
    """`yards_per_rev` is gone. The route must not resurrect it as a stored field —
    an ignored input that silently disappears is worse than a rejected one."""
    res = client.post("/api/work-centers", headers=auth_headers, json={
        "code": "T-CC03", "name": "Celup Continuous 03", "center_type": "DYEING",
        "node_type": "MACHINE",
    })
    assert res.status_code == 200, res.text
    assert "yards_per_rev" not in res.json()
