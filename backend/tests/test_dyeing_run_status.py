"""A dye bath's status is derived from its WO, in one place.

The two used to be written independently: 4 of 12 rows on the dev DB had a
COMPLETED work order and a PENDING run, so "is this bath finished" had two answers.
`services/dyeing_run_service` owns the rule now (see its module docstring), and the
column is only ever a cache of it.

The DB half reuses `test_dyeing_output_lot`'s setup — same fixture shape (a dyeing WO
with bath records and no output lot), and duplicating it would let the two drift.
"""
import uuid

from types import SimpleNamespace

import pytest

from app.services import dyeing_run_service as svc
from tests.test_dyeing_output_lot import _log, _setup_dyeing_wo


def _run(started_at=None, completed_at=None, volume=None, color_matching_at=None):
    return SimpleNamespace(started_at=started_at, completed_at=completed_at,
                           volume_air_liters=volume, color_matching_at=color_matching_at)


NOW = "2026-09-07T00:00:00Z"   # any truthy timestamp; the rule only tests presence


# -- the rule ----------------------------------------------------------------

@pytest.mark.parametrize("wo_status", ["PENDING", "IN_PROGRESS", "COMPLETED", None])
def test_a_cancelled_wo_cancels_its_baths_whatever_they_hold(wo_status):
    """CANCELLED wins over every other signal — nothing is running in that vessel."""
    assert svc.derive_status(_run(started_at=NOW, completed_at=NOW), "CANCELLED") == "CANCELLED"


def test_a_closed_bath_is_completed_while_its_wo_runs_on():
    """A multi-bath WO finishes bath 1 with bath 2 still in the vessel; `completed_at`
    is granularity the WO cannot express, so it stays the bath's own close."""
    assert svc.derive_status(_run(started_at=NOW, completed_at=NOW), "IN_PROGRESS") == "COMPLETED"


def test_a_closed_wo_closes_a_bath_nobody_closed():
    """The mismatch this replaced: finishing the WO takes every bath off the machine."""
    assert svc.derive_status(_run(started_at=NOW), "COMPLETED") == "COMPLETED"
    assert svc.derive_status(_run(), "COMPLETED") == "COMPLETED"


def test_a_recorded_bath_is_in_progress():
    assert svc.derive_status(_run(started_at=NOW), "IN_PROGRESS") == "IN_PROGRESS"
    # A volume back-filled without a Start counts: the vessel is full.
    assert svc.derive_status(_run(volume=950), "IN_PROGRESS") == "IN_PROGRESS"


def test_a_bath_with_nothing_recorded_is_pending():
    assert svc.derive_status(_run(), "IN_PROGRESS") == "PENDING"
    assert svc.derive_status(_run(), "PENDING") == "PENDING"


def test_colour_matching_sits_between_pending_and_the_bath():
    """The phase before the machine runs. A recorded bath takes the batch straight
    past it — matching is over the moment the vessel is filled."""
    assert svc.derive_status(_run(color_matching_at=NOW), "IN_PROGRESS") == "COLOR_MATCHING"
    assert svc.derive_status(_run(color_matching_at=NOW, volume=950), "IN_PROGRESS") == "IN_PROGRESS"
    assert svc.derive_status(_run(color_matching_at=NOW, started_at=NOW), "IN_PROGRESS") == "IN_PROGRESS"


def test_shade_result_is_not_part_of_the_status():
    """QC is a separate act at a later moment and a FAIL must not reopen anything —
    so a shade is not in the signature at all."""
    import inspect
    assert "shade" not in str(inspect.signature(svc.derive_status))


# -- the wiring --------------------------------------------------------------

def _status(client, session, run_id):
    from app.models.dyeing_setting import DyeingRun

    async def _read():
        run = await session.get(DyeingRun, uuid.UUID(run_id))
        await session.refresh(run)
        return run.status

    return client.portal.call(_read)


def test_closing_the_wo_closes_its_open_baths(client, auth_headers, async_db_session):
    _mo_id, wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=2)
    assert _status(client, async_db_session, run_ids[0]) == "PENDING"

    res = client.put(f"/api/work-orders/{wo_id}/status?status=COMPLETED", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert _status(client, async_db_session, run_ids[0]) == "COMPLETED"
    assert _status(client, async_db_session, run_ids[1]) == "COMPLETED"


def test_cancelling_the_wo_cancels_its_baths(client, auth_headers, async_db_session):
    _mo_id, wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1)

    client.put(f"/api/work-orders/{wo_id}/status?status=CANCELLED", headers=auth_headers)
    assert _status(client, async_db_session, run_ids[0]) == "CANCELLED"


def test_reopening_the_wo_reopens_only_the_baths_never_closed(client, auth_headers, async_db_session):
    mo_id, wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=2)
    closed, open_bath = run_ids[0], run_ids[1]

    # Close bath 1 on its own (records the shade), leave bath 2 untouched.
    _log(client, auth_headers, mo_id, wo_id, 1.0)
    res = client.post(f"/api/dyeing-runs/{closed}/complete", json={
        "shade_result": "PASS", "chemicals": [],
    }, headers=auth_headers)
    assert res.status_code == 200, res.text

    client.put(f"/api/work-orders/{wo_id}/status?status=COMPLETED", headers=auth_headers)
    assert _status(client, async_db_session, open_bath) == "COMPLETED"

    client.put(f"/api/work-orders/{wo_id}/status?status=IN_PROGRESS", headers=auth_headers)
    # The bath that was closed on the floor stays closed; the other reopens.
    assert _status(client, async_db_session, closed) == "COMPLETED"
    assert _status(client, async_db_session, open_bath) == "PENDING"


def test_filling_the_bath_starts_the_run(client, auth_headers, async_db_session):
    _mo_id, _wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1)

    res = client.post(f"/api/dyeing-runs/{run_ids[0]}/start", json={
        "volume_air_liters": 950,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "IN_PROGRESS"
    assert _status(client, async_db_session, run_ids[0]) == "IN_PROGRESS"


def test_hitting_the_wo_target_closes_the_bath(client, auth_headers, async_db_session):
    """The WO auto-completes at target inside add_mo_completion; its baths follow in
    the same transaction rather than being left open for someone to notice."""
    mo_id, wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1, wo_qty=1.0)

    _log(client, auth_headers, mo_id, wo_id, 1.0)
    assert _status(client, async_db_session, run_ids[0]) == "COMPLETED"


def test_the_shade_is_still_recordable_after_the_wo_closed(client, auth_headers, async_db_session):
    """QC happens after the floor is done. The run reads COMPLETED because its WO is,
    but the bath itself was never closed, so the shade entry must still land."""
    mo_id, wo_id, run_ids = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1, wo_qty=1.0)
    _log(client, auth_headers, mo_id, wo_id, 1.0)
    assert _status(client, async_db_session, run_ids[0]) == "COMPLETED"

    res = client.post(f"/api/dyeing-runs/{run_ids[0]}/complete", json={
        "shade_result": "FAIL", "shade_notes": "too blue", "chemicals": [],
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["shade_result"] == "FAIL"
    assert body["completed_at"] is not None

    # And it is closed for good now — a second entry is refused on the bath's own close.
    again = client.post(f"/api/dyeing-runs/{run_ids[0]}/complete", json={
        "shade_result": "PASS", "chemicals": [],
    }, headers=auth_headers)
    assert again.status_code == 400, again.text
