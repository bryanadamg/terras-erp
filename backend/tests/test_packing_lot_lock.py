"""A lot claimed off the Quarantine Packing desk belongs to the order that took it.

The Pack button on Quarantine Packing hands a specific pile of released lots to a
new packing order. `qty_target` is only what happened to be free at that moment —
the order is answerable for the PILE, not the number. So:

* no other packing order may draw from those lots while this one is open, and
* this one cannot be COMPLETED until they are gone from the source location,
  **even when draining them runs well past `qty_target`**.

Closing with stock still on a held lot would strand it: nothing else may draw from
a locked lot, and the lock only lifts when the order closes.
"""
import uuid

import pytest


def _seed_locations(*codes):
    """Locations go in through the sync session; packing is async (see test_packing_reject)."""
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        for code in codes:
            if not sess.query(_Location).filter_by(code=code).first():
                sess.add(_Location(code=code, name=code.replace("-", " ").title()))
        sess.commit()
    finally:
        sess.close()
        conn.close()


def _box(client, auth_headers):
    types = client.get("/api/packaging-types", headers=auth_headers).json()
    standard = next((t for t in types if not t.get("is_custom")), None)
    return standard["id"] if standard else client.post("/api/packaging-types", json={
        "code": "BOX-LOCK", "name": "Lock Box", "tare_kg": 0.5,
    }, headers=auth_headers).json()["id"]


def _pack(client, auth_headers, po, lot_id, qty, box_size, box_id):
    """Log one pack event off `lot_id`, split into equal boxes.

    A kg item is weighed once — the qty in the carton IS its net weight — so no
    separate `box_weights` is sent, exactly as the pack panel does it.
    """
    n = int(round(qty / box_size))
    return client.post(f"/api/packing/{po['id']}/complete", json={
        "lots": [{"batch_id": lot_id, "qty": qty}],
        "boxes": [box_size] * n,
        "box_packaging_type_ids": [box_id] * n,
    }, headers=auth_headers)


@pytest.fixture
def lock_setup(client, auth_headers):
    """One 30 kg lot on the desk, claimed by a 12 kg packing order.

    The target is deliberately less than the lot: that is the shape the rule is
    about — a deep link snapshots what was free, and the pile outlasts the number.
    """
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("LOCK-SRC", "LOCK-OUT")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"LOCK-FG-{suffix}", "name": "Lock FG", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()

    lot = client.post("/api/batches", json={
        "item_id": item["id"], "qty": 30, "location_id": locs["LOCK-SRC"],
    }, headers=auth_headers)
    assert lot.status_code == 200, lot.text
    lot = lot.json()

    def _order(qty_target, locked_batch_ids=()):
        res = client.post("/api/packing", json={
            "item_id": item["id"],
            "qty_target": qty_target,
            "source_location_id": locs["LOCK-SRC"],
            "output_location_id": locs["LOCK-OUT"],
            "locked_batch_ids": list(locked_batch_ids),
        }, headers=auth_headers)
        return res

    holder = _order(12, [lot["id"]])
    assert holder.status_code == 200, holder.text
    return {
        "item": item, "lot": lot, "locs": locs,
        "holder": holder.json(), "order": _order,
        "box": _box(client, auth_headers),
    }


# --- exclusivity ------------------------------------------------------------

def test_a_second_order_cannot_claim_a_held_lot(client, auth_headers, lock_setup):
    res = lock_setup["order"](10, [lock_setup["lot"]["id"]])
    assert res.status_code == 400, res.text
    assert lock_setup["holder"]["code"] in res.json()["detail"]


def test_the_lot_picker_hides_another_orders_lot(client, auth_headers, lock_setup):
    other = lock_setup["order"](10)
    assert other.status_code == 200, other.text
    other = other.json()
    item_id, lot_id = lock_setup["item"]["id"], lock_setup["lot"]["id"]

    mine = client.get(
        f"/api/batches?item_id={item_id}&for_packing_order_id={lock_setup['holder']['id']}",
        headers=auth_headers).json()
    assert lot_id in [b["id"] for b in mine]

    theirs = client.get(
        f"/api/batches?item_id={item_id}&for_packing_order_id={other['id']}",
        headers=auth_headers).json()
    assert lot_id not in [b["id"] for b in theirs]


def test_another_order_cannot_pack_out_of_a_held_lot(client, auth_headers, lock_setup):
    other = lock_setup["order"](10).json()
    res = _pack(client, auth_headers, other, lock_setup["lot"]["id"], 6, 6, lock_setup["box"])
    assert res.status_code == 400, res.text
    assert "held by" in res.json()["detail"]


# --- the closing gate -------------------------------------------------------

def test_the_order_cannot_close_until_its_lot_is_drained(client, auth_headers, lock_setup):
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]

    # Pack the whole 12 kg target. The order is fulfilled — and still holding 18 kg.
    res = _pack(client, auth_headers, po, lot["id"], 12, 6, box)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "DELIVERED"

    blocked = client.put(f"/api/packing/{po['id']}", json={"status": "COMPLETED"},
                         headers=auth_headers)
    assert blocked.status_code == 400, blocked.text
    assert lot["batch_number"] in blocked.json()["detail"]

    # Over-packing the remainder is the fix, not an error: the pile is the job.
    res = _pack(client, auth_headers, po, lot["id"], 18, 6, box)
    assert res.status_code == 200, res.text
    assert res.json()["qty_packed"] == 30.0

    closed = client.put(f"/api/packing/{po['id']}", json={"status": "COMPLETED"},
                        headers=auth_headers)
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "COMPLETED"


def test_closing_releases_the_lock(client, auth_headers, lock_setup):
    """A closed order holds nothing — the lock is a status join, never unwound."""
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]
    assert _pack(client, auth_headers, po, lot["id"], 30, 6, box).status_code == 200
    assert client.put(f"/api/packing/{po['id']}", json={"status": "COMPLETED"},
                      headers=auth_headers).status_code == 200

    # Same lot id, new order: the claim goes through now.
    again = lock_setup["order"](5, [lot["id"]])
    assert again.status_code == 200, again.text


def test_an_order_holding_no_lots_closes_freely(client, auth_headers, lock_setup):
    """The gate is about held lots only — a hand-made order is unaffected."""
    plain = lock_setup["order"](10).json()
    res = client.put(f"/api/packing/{plain['id']}", json={"status": "COMPLETED"},
                     headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "COMPLETED"
