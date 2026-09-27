"""Dyeing vessel monitor: the rate chain, time-based output vs the WO, and the list shape.

The arithmetic half needs no DB -- compute_run_metrics takes its target and its
clock from the caller (same shape as test_weaving.py).
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


def _run(yards_per_min=540, lines=2, started_min_ago=60, completed=None):
    return SimpleNamespace(
        yards_per_min=yards_per_min,
        lines=lines,
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


# -- run window --------------------------------------------------------------

def test_run_window_elapses_to_now_while_the_clock_is_open():
    r = _run(started_min_ago=90)
    assert svc.run_minutes(r.started_at, r.completed_at, NOW) == pytest.approx(90.0)


def test_finished_run_is_frozen_at_its_own_completion():
    r = _run(started_min_ago=300, completed=NOW - timedelta(hours=3))
    assert svc.run_minutes(r.started_at, r.completed_at, NOW) == pytest.approx(120.0)


def test_unstarted_run_has_no_window_rather_than_zero():
    assert svc.run_minutes(None, None, NOW) is None


def test_naive_timestamps_are_treated_as_utc():
    r = _run(started_min_ago=30)
    assert svc.run_minutes(r.started_at.replace(tzinfo=None), None, NOW) == pytest.approx(30.0)


@pytest.mark.parametrize("started, completed, expected", [
    (None, None, "PENDING"),
    (NOW, None, "IN_PROGRESS"),
    (NOW, NOW, "COMPLETED"),
])
def test_clock_state_reads_the_stamps(started, completed, expected):
    assert svc.clock_state(started, completed) == expected


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

def test_time_based_output_is_speed_times_window_times_gy():
    """60 min at 540 yd/min x 2 ropes = 64 800 yd. At 200 g/y that is 12 960 kg;
    against a 25 920 kg WO it is exactly half."""
    m = svc.compute_run_metrics(_run(), target_qty=25920.0, item=_item(), now=NOW)
    assert m["rate_yd_per_min"] == pytest.approx(1080.0)
    assert m["time_yards"] == pytest.approx(64800.0)
    assert m["time_qty"] == pytest.approx(12960.0)
    assert m["progress_pct"] == pytest.approx(50.0)


def test_yard_stocked_item_compares_yards_directly():
    m = svc.compute_run_metrics(_run(), 64800.0, _item(uom="yard", weight_per_unit=None, weight_unit=None), NOW)
    assert m["time_qty"] == pytest.approx(64800.0)
    assert m["progress_pct"] == pytest.approx(100.0)


def test_batch_without_a_picked_speed_reports_no_output_and_says_why():
    m = svc.compute_run_metrics(_run(yards_per_min=None), 25920.0, _item(), NOW)
    assert m["time_qty"] is None
    assert m["progress_pct"] is None
    assert "yards_per_min" in m["missing_rate_inputs"]


def test_missing_gy_factor_reports_no_output_and_says_why():
    m = svc.compute_run_metrics(_run(), 25920.0, _item(weight_unit="gsm"), NOW)
    assert m["time_qty"] is None
    assert m["missing_gy_factor"] is True


def test_unstarted_run_reports_no_progress_rather_than_zero():
    m = svc.compute_run_metrics(_run(started_min_ago=None), 25920.0, _item(), NOW)
    assert m["run_minutes"] is None
    assert m["progress_pct"] is None
    assert m["clock"] == "PENDING"


def test_no_wo_qty_reports_output_but_no_progress():
    m = svc.compute_run_metrics(_run(), None, _item(), NOW)
    assert m["time_qty"] == pytest.approx(12960.0)
    assert m["progress_pct"] is None


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


# -- endpoint ----------------------------------------------------------------

def test_monitor_returns_an_envelope_even_with_nothing_to_dye(client, auth_headers):
    res = client.get("/api/dyeing/monitor", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    for key in ("runs", "total", "running", "needs_setup"):
        assert key in body, f"{key} missing from the monitor envelope"


def test_work_center_no_longer_carries_reel_geometry(client, auth_headers):
    """`yards_per_rev` is gone. The route must not resurrect it as a stored field."""
    res = client.post("/api/work-centers", headers=auth_headers, json={
        "code": "T-CC03", "name": "Celup Continuous 03", "center_type": "DYEING",
        "node_type": "MACHINE",
    })
    assert res.status_code == 200, res.text
    assert "yards_per_rev" not in res.json()
