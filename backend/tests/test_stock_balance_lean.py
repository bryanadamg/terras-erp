"""`/stock/balance?lean=true`: the plant-wide availability feed carries only what its
consumers read (item, location, qty, lot key, variant), not 25 display fields per row."""
import uuid


def _seed_location(code):
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.location import Location
    with Session(engine) as s:
        if not s.query(Location).filter_by(code=code).first():
            s.add(Location(code=code, name=code))
        s.commit()


def test_lean_feed_has_only_the_availability_fields(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_location("LEAN-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"LEAN-{suffix}", "name": "Lean", "uom": "kg", "lot_tracked": True},
                       headers=auth_headers).json()
    lot = client.post("/api/batches", json={"item_id": item["id"], "qty": 7.5, "location_id": locs["LEAN-LOC"]},
                      headers=auth_headers).json()

    full = [r for r in client.get(f"/api/stock/balance?item_ids={item['id']}", headers=auth_headers).json()]
    res = client.get(f"/api/stock/balance?lean=true&item_ids={item['id']}", headers=auth_headers)
    assert res.status_code == 200
    lean = res.json()
    assert lean == [{"item_id": item["id"], "location_id": locs["LEAN-LOC"], "qty": 7.5,
                     "batch_key": lot["id"], "attribute_value_ids": []}]
    assert [(r["item_id"], r["location_id"], r["qty"], r["batch_key"]) for r in full] == \
           [(r["item_id"], r["location_id"], r["qty"], r["batch_key"]) for r in lean]
