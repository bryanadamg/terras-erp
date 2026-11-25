"""Work Orders "Export Excel": every step matching the filters, own grant."""


def test_work_order_export_needs_grant_and_returns_xlsx(user_factory, client, auth_headers):
    import io
    from openpyxl import load_workbook
    _, viewer = user_factory(["work_order.view"], "wo-viewer")
    assert client.get("/api/work-orders/export", headers=viewer).status_code == 403
    r = client.get("/api/work-orders/export", params={"tz": "Asia/Jakarta", "center_type": "WEAVING"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    assert ws["A1"].value == "WO Code" and ws["F1"].value == "Material" and ws["L1"].value == "Status"


def test_work_queue_serves_the_whole_queue_for_export(client, auth_headers):
    r = client.get("/api/work-queue", params={"page": 1, "size": 0}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == r.json()["total"]


def test_work_order_export_lists_bom_material(client, auth_headers, async_db_session):
    """The Material column names what the step's MO consumes per its BOM (e.g. a
    Beaming step's yarn)."""
    import io
    import uuid
    from openpyxl import load_workbook
    from app.models.location import Location

    tag = str(uuid.uuid4())[:8]
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    loc = Location(code=f"WH-EXP-{tag}", name="Export Store")

    async def _seed():
        async_db_session.add(loc)
        await async_db_session.flush()
        return str(loc.id)
    loc_id = client.portal.call(_seed)
    client.post("/api/items", json={"code": f"EX-FG-{tag}", "name": f"Beam {tag}", "uom": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"EX-RM-{tag}", "name": f"Yarn {tag}", "uom": "kg"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-EX-{tag}", "item_code": f"EX-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"EX-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-EX-{tag}")
    mo = client.post("/api/manufacturing-orders", json={
        "code": f"MO-EX-{tag}", "bom_id": bom["id"],
        "location_code": f"WH-EXP-{tag}", "source_location_code": f"WH-EXP-{tag}", "qty": 1,
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    wo = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo.json()["id"], "qty": 1,
        "input_location_id": loc_id, "output_location_id": loc_id,
    }, headers=auth_headers)
    assert wo.status_code == 200, wo.text

    r = client.get("/api/work-orders/export", params={"search": f"MO-EX-{tag}"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    assert [row[5] for row in ws.iter_rows(min_row=2, values_only=True)] == [f"Yarn {tag}"]
