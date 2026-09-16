"""Splitting a packed carton keeps both halves cartons.

An order for 10kg against boxes of 3+3+3+3 can only ship 9 or 12 while a carton
is atomic. The planner splits one box on the pick-list suggestion screen: 1kg
goes out, 2kg stays in the finished-goods store as its own box.

That goes through the same `/batches/{id}/split` the Lot page uses, so what these
cover is the carton-specific half of it — the child has to carry the packing
fields, or `packed_unit_filter()` rejects it and the goods vanish from every
carton picker (pick-list suggestion, packed-unit lookup) with no label to print.
"""
import uuid

import pytest


def _seed_locations(*codes):
    """Locations are created through the sync session; packing is async."""
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
    if standard is None:
        standard = client.post("/api/packaging-types", json={
            "code": "BOX-SPLIT", "name": "Split Test Box", "tare_kg": 0.5,
        }, headers=auth_headers).json()
    return standard


@pytest.fixture
def cartons(client, auth_headers):
    """Four 3kg cartons of one kg item, packed and sitting in SPL-OUT."""
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("SPL-SRC", "SPL-OUT")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"SPL-FG-{suffix}", "name": "Split FG", "uom": "kg",
    }, headers=auth_headers).json()
    client.post("/api/items/stock", json={
        "item_code": item["code"], "location_code": "SPL-SRC", "qty": 12,
        "reference_id": "INIT",
    }, headers=auth_headers)

    po = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 12, "pack_size": 3,
        "source_location_id": locs["SPL-SRC"], "output_location_id": locs["SPL-OUT"],
    }, headers=auth_headers)
    assert po.status_code == 200, po.text
    po = po.json()

    box = _box(client, auth_headers)
    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 12, "boxes": [3, 3, 3, 3], "box_weights": [3, 3, 3, 3],
        "box_packaging_type_ids": [box["id"]] * 4,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text

    units = client.get(
        f"/api/packing/packed-units?item_id={item['id']}", headers=auth_headers
    ).json()
    assert len(units) == 4, units
    return {"item": item, "po": po, "locs": locs, "box": box, "units": units}


def test_split_carton_yields_two_cartons(client, auth_headers, cartons):
    item, box = cartons["item"], cartons["box"]
    # Cartons come back newest-first; any one of them will do.
    target = cartons["units"][0]
    assert float(target["qty"]) == 3.0

    res = client.post(f"/api/batches/{target['id']}/split", json={
        "qty": 1, "reason": "trim to order",
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    child = res.json()

    # Sub-lot numbering is the Lot page's, so the QR still starts PU- and the
    # number says whose piece it is.
    assert child["batch_number"] == f"{target['batch_number']}-S1"
    # The carton-ness itself: without these the child fails packed_unit_filter().
    assert child["packing_order_id"] == cartons["po"]["id"]
    assert child["package_no"] and child["package_no"] != target["package_no"]

    # Both halves are pickable cartons, and only the split qty moved.
    units = {
        u["id"]: u for u in
        client.get(f"/api/packing/packed-units?item_id={item['id']}", headers=auth_headers).json()
    }
    assert len(units) == 5
    assert float(units[child["id"]]["qty"]) == 1.0
    assert float(units[target["id"]]["qty"]) == 2.0

    # Brutto follows net through the snapshotted tare on both boxes — a label and
    # a delivery note are printed off these.
    tare = float(box["tare_kg"] or 0)
    assert float(units[child["id"]]["gross_weight_kg"]) == pytest.approx(1 + tare)
    assert float(units[target["id"]]["gross_weight_kg"]) == pytest.approx(2 + tare)


def test_split_cannot_empty_the_carton(client, auth_headers, cartons):
    target = cartons["units"][0]
    res = client.post(f"/api/batches/{target['id']}/split", json={"qty": 3}, headers=auth_headers)
    assert res.status_code == 400, res.text
