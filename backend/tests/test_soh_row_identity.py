"""Stock On-Hand rows name a no-MO lot's shade and attributes from its own key.

The grid's shade came only from the producing MO, and rows carried no attribute
detail — a manual lot or packed carton showed no shade, and the Colors variant
(NAVY) beside a shade code could never be named.
"""
import uuid

from tests.test_stock_lot_spill import _seed_location


def test_manual_lot_row_carries_shade_and_attributes(client, auth_headers):
    from app.db.session import engine
    from sqlalchemy.orm import Session
    from app.models.attribute import Attribute, AttributeValue

    t = uuid.uuid4().hex[:6].upper()
    conn = engine.connect()
    sess = Session(conn)
    try:
        attr = Attribute(name=f"SOH-Attr-{t}", is_system=False)
        sess.add(attr)
        sess.flush()
        val = AttributeValue(attribute_id=attr.id, value="NAVY")
        sess.add(val)
        sess.commit()
        val_id = str(val.id)
    finally:
        sess.close()
        conn.close()

    _seed_location("SOH-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"SOH-{t}", "name": "Soh", "uom": "kg"}, headers=auth_headers).json()
    color = client.post("/api/colors", json={"code": f"SOH-{t}", "name": f"SOH-{t}"}, headers=auth_headers).json()
    r = client.post("/api/stock", json={"item_code": item["code"], "location_code": "SOH-LOC", "qty": 5,
                                        "color_id": color["id"], "attribute_value_ids": [val_id]}, headers=auth_headers)
    assert r.status_code == 201, r.text

    (row,) = client.get("/api/stock/balance/paginated", params={"search": item["code"]}, headers=auth_headers).json()["items"]
    assert row["color_code"] == color["code"]
    assert [a["value"] for a in row["variant_attributes"]] == ["NAVY"]
