"""The loading deck's four-eyes gate.

VERIFIED means a SECOND person counted the cartons against the printed Surat
Jalan. Two rules carry that, and neither is visible in the happy path:

* `shipment.verify` is the one permission in this domain that `sales.manage`
  does NOT satisfy — a control everyone already holds is not a control.
* the person who staged the load cannot verify it, admins excepted.

Pick lists are seeded straight through the sync session rather than packed and
picked through the API: what is under test is the gate, not the road to it.
Those rows are committed for real (async routes read a different connection and
cannot see an uncommitted savepoint), so each fixture cleans up after itself.
"""
import uuid

import pytest


def _sync_session():
    from app.db.session import engine
    from sqlalchemy.orm import Session

    conn = engine.connect()
    return Session(conn), conn


@pytest.fixture
def picker(user_factory):
    """Can stage a shipment, edit it, and verify one — but is not an admin."""
    return user_factory(["shipment.create", "shipment.edit", "shipment.verify"], "stager")


@pytest.fixture
def checker(user_factory):
    """The second pair of eyes."""
    return user_factory(["shipment.verify"], "checker")


@pytest.fixture
def planner(user_factory):
    """Holds the legacy blob code and nothing else — must NOT be able to verify."""
    return user_factory(["sales.manage"], "planner")


@pytest.fixture
def picked_list():
    """One PICKED, QC-passed pick list on a sales order — the deck's input."""
    from app.models.pick_list import PickList
    from app.models.sales import SalesOrder

    sess, conn = _sync_session()
    so = SalesOrder(po_number=f"SO-DECK-{uuid.uuid4().hex[:6]}", customer_name="Deck Customer")
    sess.add(so)
    sess.flush()
    pl = PickList(
        code=f"PL-DECK-{uuid.uuid4().hex[:6]}",
        sales_order_id=so.id,
        status="PICKED",
        qc_passed=True,
    )
    sess.add(pl)
    sess.commit()
    sess.refresh(pl)
    yield pl

    # The shipment rows the tests create live inside the client's SAVEPOINT and go
    # away with it; only what was committed here needs removing.
    sess.query(PickList).filter(PickList.id == pl.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def _stage(client, headers, pl):
    res = client.post("/api/shipments", json={"pick_list_ids": [str(pl.id)]}, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_sales_manage_cannot_verify(picked_list, picker, planner, client):
    """The whole point of the separate code: staging is a planner act, the count
    is not."""
    _, picker_headers = picker
    _, planner_headers = planner
    shp = _stage(client, picker_headers, picked_list)

    res = client.post(f"/api/shipments/{shp['id']}/verify", json={}, headers=planner_headers)
    assert res.status_code == 403, res.text


def test_the_stager_cannot_verify_their_own_load(picked_list, picker, client):
    user, headers = picker
    shp = _stage(client, headers, picked_list)

    res = client.post(f"/api/shipments/{shp['id']}/verify", json={}, headers=headers)
    assert res.status_code == 400, res.text
    assert "second checker" in res.json()["detail"]


def test_a_second_checker_verifies_and_reopen_clears_it(picked_list, picker, checker, client):
    _, picker_headers = picker
    checker_user, checker_headers = checker
    shp = _stage(client, picker_headers, picked_list)

    res = client.post(f"/api/shipments/{shp['id']}/verify", json={"notes": "42 cartons"}, headers=checker_headers)
    assert res.status_code == 200, res.text
    verified = res.json()
    assert verified["status"] == "VERIFIED"
    assert verified["verified_by_name"] == checker_user.username

    # Reopening changes the contents, so the old tick must not survive it.
    res = client.post(f"/api/shipments/{shp['id']}/reopen", json={}, headers=picker_headers)
    assert res.status_code == 200, res.text
    reopened = res.json()
    assert reopened["status"] == "STAGED"
    assert reopened["verified_by_name"] is None
    assert reopened["verified_at"] is None


def test_pick_lists_have_no_dispatch_route_of_their_own(picked_list, client, auth_headers):
    """A direct pick-list dispatch would make the deck gate bypassable in one
    HTTP call, so that route is deleted, not merely unused."""
    res = client.post(f"/api/pick-lists/{picked_list.id}/dispatch", json={}, headers=auth_headers)
    assert res.status_code in (404, 405), res.text
