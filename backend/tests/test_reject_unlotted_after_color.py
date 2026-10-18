"""Rejecting an unlotted completion moves it under the key it was booked under.

The reject rebuilt the key from the MO as it is NOW. Give the MO a shade after the
output was booked (Set Color / lab-dip backfill) and the reject addressed a
`c:<shade>` row that never existed — "Insufficient stock. Current: 0.0".
"""
import uuid


def test_reject_after_shade_set_moves_the_booked_output(client, auth_headers):
    from app.db.session import engine
    from sqlalchemy.orm import Session
    from app.models.location import Location

    t = uuid.uuid4().hex[:6].upper()
    conn = engine.connect()
    sess = Session(conn)
    try:
        sess.add(Location(code=f"RJ-LOC-{t}", name="RJ Loc"))
        sess.add(Location(code=f"RJ-BS-{t}", name="RJ Defect"))
        sess.commit()
    finally:
        sess.close()
        conn.close()

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    fg = client.post("/api/items", json={"code": f"RJ-FG-{t}", "name": "RJ FG", "uom": "kg"}, headers=auth_headers).json()
    client.post("/api/items", json={"code": f"RJ-RM-{t}", "name": "RJ RM", "uom": "kg"}, headers=auth_headers)
    client.post("/api/stock", json={"item_code": f"RJ-RM-{t}", "location_code": f"RJ-LOC-{t}", "qty": 10}, headers=auth_headers)
    color = client.post("/api/colors", json={"code": f"RJ-{t}", "name": f"RJ-{t}"}, headers=auth_headers).json()
    bom = client.post("/api/boms", json={
        "code": f"RJ-BOM-{t}", "item_code": fg["code"], "qty": 1,
        "lines": [{"item_code": f"RJ-RM-{t}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    assert bom.status_code == 200, bom.text
    bom = bom.json()
    mo = client.post("/api/manufacturing-orders", json={
        "code": f"RJ-MO-{t}", "bom_id": bom["id"], "location_code": f"RJ-LOC-{t}",
        "source_location_code": f"RJ-LOC-{t}", "qty": 5.0,
    }, headers=auth_headers).json()
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    wo = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo["id"], "qty": 5.0,
        "input_location_id": locs[f"RJ-LOC-{t}"], "output_location_id": locs[f"RJ-LOC-{t}"],
    }, headers=auth_headers).json()
    r = client.post(f"/api/manufacturing-orders/{mo['id']}/completions", json={
        "qty_completed": 2.0, "work_order_id": wo["id"],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    (comp,) = client.get(f"/api/manufacturing-orders/{mo['id']}", headers=auth_headers).json()["completions"]

    r = client.patch(f"/api/manufacturing-orders/{mo['id']}/color", json={"color_id": color["id"]}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post(f"/api/manufacturing-orders/{mo['id']}/completions/{comp['id']}/reject", json={
        "reason": "stain", "reject_location_id": locs[f"RJ-BS-{t}"],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    rows = {b["location_id"]: b["qty"] for b in client.get("/api/stock/balance", headers=auth_headers).json()
            if b["item_id"] == fg["id"]}
    assert rows == {locs[f"RJ-BS-{t}"]: 2.0}
