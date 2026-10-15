"""A manual lot (no producing MO) in quarantine shows its own shade.

Its colour lives only in its balance key (`c:<color>`), and the page read the
group's colour off the MO alone — so the row said "Greige". Two manual lots of
different colours must also stay two rows, not merge into one "No MO" group.
"""
import uuid


def _seed_quarantine_location(code):
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        if not sess.query(_Location).filter_by(code=code).first():
            sess.add(_Location(code=code, name=code, is_quarantine=True))
        sess.commit()
    finally:
        sess.close()
        conn.close()


def test_manual_lot_color_in_quarantine(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_quarantine_location("QMAN-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"QMAN-{suffix}", "name": "QMan", "uom": "kg"}, headers=auth_headers).json()
    colors = [client.post("/api/colors", json={"code": f"QM{c}-{suffix}", "name": f"QM{c}-{suffix}"}, headers=auth_headers).json()
              for c in "AB"]
    for c in colors:
        r = client.post("/api/batches", json={
            "item_id": item["id"], "qty": 3, "location_id": locs["QMAN-LOC"], "color_id": c["id"],
        }, headers=auth_headers)
        assert r.status_code == 200, r.text

    r = client.get("/api/quarantine", params={"search": item["code"]}, headers=auth_headers)
    assert r.status_code == 200, r.text
    groups = r.json()["items"]
    assert sorted(g["color_code"] for g in groups) == sorted(c["code"] for c in colors)
    assert all(g["mo_id"] is None and g["lot_count"] == 1 for g in groups)
    by_code = {c["code"]: c["id"] for c in colors}
    assert all(g["color_id"] == by_code[g["color_code"]] for g in groups)
