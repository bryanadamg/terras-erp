"""A range entered on a BOM size after its MO was cut reaches that MO's snapshot.

JC 81-0612/38 NS on prod: the L/XL ranges were typed onto the BOM after the MOs
existed, so every lot of those MOs read "L-72" instead of "L-72 (70-74)". Only
blank keys are filled — a target already snapshotted is never re-specced.
"""
import uuid


def test_bom_size_range_added_later_fills_mo_snapshot(client, auth_headers):
    tag = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    for code in (f"SZB-FG-{tag}", f"SZB-RM-{tag}"):
        client.post("/api/items", json={"code": code, "name": code, "uom": "kg"}, headers=auth_headers)
    size = client.get("/api/sizes", headers=auth_headers).json()[0]

    bom = client.post("/api/boms", json={
        "code": f"BOM-SZB-{tag}", "item_code": f"SZB-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"SZB-RM-{tag}", "qty": 1, "percentage": 100.0}],
        "sizes": [{"size_id": size["id"], "target_measurement": 72}],
    }, headers=auth_headers)
    assert bom.status_code == 200, bom.text
    bom = bom.json()

    mo = client.post("/api/manufacturing-orders", json={
        "code": f"MO-SZB-{tag}", "bom_id": bom["id"], "qty": 1,
        "bom_size_id": bom["sizes"][0]["id"],
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    mo = mo.json()
    snap = client.get(f"/api/manufacturing-orders/{mo['id']}", headers=auth_headers).json()["bom_size_snapshot"]
    assert snap["measurement_min"] is None

    r = client.put(f"/api/boms/{bom['id']}", json={
        "sizes": [{"size_id": size["id"], "target_measurement": 99, "measurement_min": 70, "measurement_max": 74}],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    snap = client.get(f"/api/manufacturing-orders/{mo['id']}", headers=auth_headers).json()["bom_size_snapshot"]
    assert (snap["measurement_min"], snap["measurement_max"]) == (70, 74)
    assert snap["target_measurement"] == 72  # set at MO creation — not re-specced
