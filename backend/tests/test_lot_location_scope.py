"""Role.allowed_locations scopes lot.* actions; a picked warehouse covers its bins."""
import uuid

from app.db.session import engine as _engine
from sqlalchemy.orm import Session as _SASession
from app.models.location import Location


def _seed_tree(suffix):
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        wh = Location(code=f"SCOPE-WH-{suffix}", name="wh")
        other = Location(code=f"SCOPE-OT-{suffix}", name="other")
        sess.add_all([wh, other])
        sess.flush()
        bin_ = Location(code=f"SCOPE-BIN-{suffix}", name="bin", parent_id=wh.id)
        sess.add(bin_)
        sess.commit()
        return str(wh.id), str(bin_.id), str(other.id)
    finally:
        sess.close()
        conn.close()


def test_lot_create_respects_location_scope(user_factory, client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    wh, bin_, other = _seed_tree(suffix)
    _, headers = user_factory(["lot.create"], "lot-scoped", allowed_locations=[wh])
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"SCOPE-{suffix}", "name": "Scope", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()

    ok = client.post("/api/batches", json={"item_id": item["id"], "qty": 5, "location_id": bin_}, headers=headers)
    assert ok.status_code == 200, ok.text

    denied = client.post("/api/batches", json={"item_id": item["id"], "qty": 5, "location_id": other}, headers=headers)
    assert denied.status_code == 403, denied.text
