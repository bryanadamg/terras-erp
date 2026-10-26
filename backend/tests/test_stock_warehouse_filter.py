"""The Stock On-Hand warehouse filter includes stock booked onto the warehouse itself.

The root was resolved as grandparent-or-parent only, so a row sitting straight
on the warehouse had no root and dropped out — filtering "Finished Goods" showed
its zone/bin stock but hid the lots on Finished Goods itself.
"""
import uuid


def _seed_tree(suffix):
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        wh = _Location(code=f"WHF-{suffix}", name=f"WHF-{suffix}", location_type="warehouse")
        sess.add(wh); sess.flush()
        zone = _Location(code=f"WHF-{suffix}-Z", name="Z", location_type="zone", parent_id=wh.id)
        sess.add(zone); sess.flush()
        sess.add(_Location(code=f"WHF-{suffix}-Z-B", name="B", location_type="bin", parent_id=zone.id))
        sess.commit()
        return str(wh.id)
    finally:
        sess.close()
        conn.close()


def test_warehouse_filter_includes_stock_on_the_warehouse(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    wh_id = _seed_tree(suffix)
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"WHF-{suffix}", "name": "Whf", "uom": "kg"}, headers=auth_headers).json()
    for code in (f"WHF-{suffix}", f"WHF-{suffix}-Z", f"WHF-{suffix}-Z-B"):
        r = client.post("/api/stock", json={"item_code": item["code"], "location_code": code, "qty": 1}, headers=auth_headers)
        assert r.status_code == 201, r.text

    r = client.get("/api/stock/balance/paginated", params={"warehouse_id": wh_id, "search": item["code"]}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len([b for b in r.json()["items"] if b["item_id"] == item["id"]]) == 3
    # Footer kg total follows the filter, not the page or the whole plant.
    assert r.json()["total_kg"] == 3
