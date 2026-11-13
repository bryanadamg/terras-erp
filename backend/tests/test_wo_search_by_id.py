"""A work order card's QR holds the WO id; scanning it into the WO search finds that WO."""
import uuid


def test_work_order_search_matches_scanned_id(client, auth_headers, async_db_session):
    from app.models.location import Location

    tag = str(uuid.uuid4())[:8]
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    loc = Location(code=f"WH-SCAN-{tag}", name="Scan Store")

    async def _seed():
        async_db_session.add(loc)
        await async_db_session.flush()
        return str(loc.id)

    loc_id = client.portal.call(_seed)
    client.post("/api/items", json={"code": f"SC-FG-{tag}", "name": "Scan FG", "uom": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"SC-RM-{tag}", "name": "Scan RM", "uom": "kg"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-SC-{tag}", "item_code": f"SC-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"SC-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-SC-{tag}")
    mo = client.post("/api/manufacturing-orders", json={
        "code": f"MO-SC-{tag}", "bom_id": bom["id"],
        "location_code": f"WH-SCAN-{tag}", "source_location_code": f"WH-SCAN-{tag}", "qty": 1,
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    wo = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo.json()["id"], "qty": 1,
        "input_location_id": loc_id, "output_location_id": loc_id,
    }, headers=auth_headers)
    assert wo.status_code == 200, wo.text
    wo_id = wo.json()["id"]

    res = client.get("/api/work-orders", params={"search": wo_id}, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert [r["id"] for r in res.json()["items"]] == [wo_id]
