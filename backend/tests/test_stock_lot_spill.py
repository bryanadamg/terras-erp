"""A deduction that names no lot must not drive the unlotted balance row negative.

The negative-stock guard checks a lot-less deduction against the item's whole
on-hand at the location (lots included), but only the unlotted row was then
decremented — so consuming a lot-tracked item without a lot left that row at
e.g. -7.5 kg while the lots still showed their full qty. The shortfall now
comes off the lots, oldest first.
"""
import uuid


def _seed_location(code):
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        if not sess.query(_Location).filter_by(code=code).first():
            sess.add(_Location(code=code, name=code))
        sess.commit()
    finally:
        sess.close()
        conn.close()


def test_lotless_deduction_draws_from_lots_fifo(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_location("SPILL-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"SPILL-{suffix}", "name": "Spill", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()

    lots = []
    for qty in (6, 10):
        r = client.post("/api/batches", json={
            "item_id": item["id"], "qty": qty, "location_id": locs["SPILL-LOC"],
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        lots.append(r.json()["id"])

    r = client.post("/api/stock", json={
        "item_code": item["code"], "location_code": "SPILL-LOC", "qty": -8,
    }, headers=auth_headers)
    assert r.status_code == 201, r.text

    rows = [b for b in client.get("/api/stock/balance", headers=auth_headers).json()
            if b["item_id"] == item["id"] and b["location_id"] == locs["SPILL-LOC"]]
    by_key = {b["batch_key"]: b["qty"] for b in rows}
    assert by_key.get("", 0) >= 0
    assert by_key.get(lots[0], 0) == 0   # oldest lot drained first (zero rows are hidden)
    assert by_key[lots[1]] == 8      # remainder off the next lot
    assert sum(by_key.values()) == 8

    # Over-draw is still refused on the total.
    r = client.post("/api/stock", json={
        "item_code": item["code"], "location_code": "SPILL-LOC", "qty": -9,
    }, headers=auth_headers)
    assert r.status_code == 400
