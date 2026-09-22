"""The lab dip approval gate: which way a variant's status may move.

A lab dip is the colour-matching gate in front of production, so the two rules
that matter are about what CANNOT be undone and what can:

* APPROVED is terminal. The approval mints a Color into the library and ties it
  to production; re-opening it would leave that shade minted against a variant
  that is no longer approved.
* REJECTED rests but reopens — and only to IN_PROGRESS, for another round. Going
  straight from REJECTED to APPROVED would skip the re-dip the rejection asked for.
"""
import uuid

import pytest


@pytest.fixture
def lab_dip(client, auth_headers):
    """A request with one variant, seeded through the API it is tested through."""
    item = client.post(
        "/api/items",
        json={"code": f"LD-ITEM-{uuid.uuid4().hex[:6]}", "name": "Lab Dip Base", "uom": "KG"},
        headers=auth_headers,
    )
    assert item.status_code in (200, 201), item.text
    item_id = item.json()["id"]

    res = client.post(
        "/api/lab-dips",
        json={"kind": "FG", "items": [{"item_id": item_id, "order": 0}]},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    return res.json()


def _set_status(client, auth_headers, req, item_id, status, **params):
    query = "&".join(f"{k}={v}" for k, v in {"status": status, **params}.items())
    return client.put(
        f"/api/lab-dips/{req['id']}/items/{item_id}/status?{query}", headers=auth_headers
    )


def test_the_request_is_numbered_in_its_own_book(lab_dip):
    assert lab_dip["code"].startswith("LD-"), lab_dip["code"]
    # LD-YYYY-NNNNN, minted off a DB sequence so a deleted request never frees its
    # number for reuse.
    assert len(lab_dip["code"].split("-")[-1]) == 5
    assert len(lab_dip["items"]) == 1


def test_a_rejected_variant_reopens_only_to_in_progress(client, auth_headers, lab_dip):
    item_id = lab_dip["items"][0]["id"]

    res = _set_status(client, auth_headers, lab_dip, item_id, "REJECTED", reason="Too%20dark")
    assert res.status_code == 200, res.text

    # Straight to APPROVED would skip the re-dip the rejection asked for.
    res = _set_status(client, auth_headers, lab_dip, item_id, "APPROVED", set_value="1")
    assert res.status_code == 400, res.text
    assert "reopened to IN_PROGRESS" in res.json()["detail"]

    # And rejecting twice is not a transition either.
    assert _set_status(client, auth_headers, lab_dip, item_id, "REJECTED").status_code == 400

    res = _set_status(client, auth_headers, lab_dip, item_id, "IN_PROGRESS")
    assert res.status_code == 200, res.text


def test_approved_is_terminal(client, auth_headers, lab_dip):
    item_id = lab_dip["items"][0]["id"]

    res = _set_status(client, auth_headers, lab_dip, item_id, "APPROVED", set_value="1")
    assert res.status_code == 200, res.text

    for attempt in ("REJECTED", "IN_PROGRESS", "PENDING"):
        res = _set_status(client, auth_headers, lab_dip, item_id, attempt)
        assert res.status_code == 400, f"{attempt}: {res.text}"
        assert "locked" in res.json()["detail"]


def test_approving_requires_a_set_index(client, auth_headers, lab_dip):
    """The set index is half the minted colour code — approving without one would
    mint `LD-…-A-` and collide with the next variant approved the same way."""
    item_id = lab_dip["items"][0]["id"]

    res = _set_status(client, auth_headers, lab_dip, item_id, "APPROVED")
    assert res.status_code == 400, res.text
    assert "set index" in res.json()["detail"]


def test_an_unknown_status_is_refused(client, auth_headers, lab_dip):
    res = _set_status(client, auth_headers, lab_dip, lab_dip["items"][0]["id"], "SHIPPED")
    assert res.status_code == 400, res.text
