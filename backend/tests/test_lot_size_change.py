"""Changing a lot's size re-labels it in place: same item, same stock."""
import uuid

from app.db.session import engine as _engine
from sqlalchemy.orm import Session as _SASession
from app.models.location import Location


def test_change_lot_size_keeps_item_and_stock(client, auth_headers):
    sfx = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    with _engine.connect() as conn, _SASession(conn) as sess:
        loc = Location(code=f"LSC-{sfx}", name="lsc")
        sess.add(loc)
        sess.commit()
        loc_id = str(loc.id)
    item = client.post("/api/items", json={"code": f"LSC-{sfx}", "name": "Lsc", "uom": "kg", "lot_tracked": True},
                       headers=auth_headers).json()
    s1, s2 = client.get("/api/sizes", headers=auth_headers).json()[:2]
    lot = client.post("/api/batches", json={"item_id": item["id"], "size_id": s1["id"], "qty": 7, "location_id": loc_id},
                      headers=auth_headers).json()

    r = client.post(f"/api/batches/{lot['id']}/size", json={"size_id": s2["id"], "reason": "off range"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["bom_size_snapshot"]["size_name"] == s2["name"]
    assert (out["item_id"], out["remaining"]) == (item["id"], 7)

    same = client.post(f"/api/batches/{lot['id']}/size", json={"size_id": s2["id"]}, headers=auth_headers)
    assert same.status_code == 400
