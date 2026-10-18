"""Logging actual usage of an unlotted component deducts it under its staged key.

Plain staging posts a component to the WO input under its BOM line's attributes;
the actual-usage path deducted the same item under an empty key, so it read 0
("Insufficient stock. Current: 0.0") — or drained an unrelated plain pool.
"""
import uuid


def test_actual_item_deducts_under_planned_component_attrs(client, auth_headers):
    from app.db.session import engine
    from sqlalchemy.orm import Session
    from app.models.attribute import Attribute, AttributeValue
    from app.models.location import Location

    t = uuid.uuid4().hex[:6].upper()
    conn = engine.connect()
    sess = Session(conn)
    try:
        sess.add(Location(code=f"AI-LOC-{t}", name="AI Loc"))
        attr = Attribute(name=f"AI-Attr-{t}", is_system=False)
        sess.add(attr)
        sess.flush()
        val = AttributeValue(attribute_id=attr.id, value="Black")
        sess.add(val)
        sess.commit()
        val_id = str(val.id)
    finally:
        sess.close()
        conn.close()

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"AI-FG-{t}", "name": "AI FG", "uom": "kg"}, headers=auth_headers)
    rm = client.post("/api/items", json={"code": f"AI-RM-{t}", "name": "AI RM", "uom": "kg"}, headers=auth_headers).json()
    r = client.post("/api/stock", json={"item_code": rm["code"], "location_code": f"AI-LOC-{t}", "qty": 10,
                                        "attribute_value_ids": [val_id]}, headers=auth_headers)
    assert r.status_code == 201, r.text

    bom = client.post("/api/boms", json={
        "code": f"AI-BOM-{t}", "item_code": f"AI-FG-{t}", "qty": 1,
        "lines": [{"item_code": rm["code"], "qty": 1, "percentage": 100.0, "attribute_value_ids": [val_id]}],
    }, headers=auth_headers).json()
    mo = client.post("/api/manufacturing-orders", json={
        "code": f"AI-MO-{t}", "bom_id": bom["id"], "location_code": f"AI-LOC-{t}",
        "source_location_code": f"AI-LOC-{t}", "qty": 2.0,
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    loc_id = next(l["id"] for l in client.get("/api/locations", headers=auth_headers).json() if l["code"] == f"AI-LOC-{t}")
    wo = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo.json()["id"], "qty": 2.0,
        "input_location_id": loc_id, "output_location_id": loc_id,
    }, headers=auth_headers)
    assert wo.status_code == 200, wo.text

    r = client.post(f"/api/manufacturing-orders/{mo.json()['id']}/completions", json={
        "qty_completed": 2.0, "work_order_id": wo.json()["id"],
        "actual_items": [{"item_id": rm["id"], "qty_used": 3.0}],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    rows = [b for b in client.get("/api/stock/balance", headers=auth_headers).json() if b["item_id"] == rm["id"]]
    assert [(b["attribute_value_ids"], b["qty"]) for b in rows] == [([val_id], 7.0)]
