"""Production output is its own permission, not part of `reports.view`.

Per-machine and per-packer output is a performance figure about named people, so
it was split out of the general reports permission deliberately. A role holding
`reports.view` seeing it again is the regression this guards — and it is silent,
because the person who checks is usually an admin who passes either way.

The report bodies are asserted on shape, not on numbers: the arithmetic
(`reject_pct` and the per-WO grain) has its own coverage in the packing and
manufacturing suites, and an empty window is the honest fixture here.
"""
import pytest

ENDPOINTS = ("/api/reports/machine-output", "/api/reports/packing-output")


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_reports_view_alone_does_not_open_production_output(user_factory, client, endpoint):
    _, headers = user_factory(["reports.view"], "reporter")

    res = client.get(endpoint, headers=headers)
    assert res.status_code == 403, res.text


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_production_output_view_opens_it(user_factory, client, endpoint):
    _, headers = user_factory(["production_output.view"], "floor-manager")

    res = client.get(endpoint, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body["rows"], list)
    assert "totals" in body


def test_machine_output_echoes_the_grouping_it_applied(client, auth_headers):
    """The UI renders a different table per grouping, so it reads the mode back
    off the response rather than trusting what it asked for."""
    for asked, expected in (("wo", "wo"), ("group", "group"), ("machine", "machine"), ("nonsense", "machine")):
        res = client.get(f"/api/reports/machine-output?group_by={asked}", headers=auth_headers)
        assert res.status_code == 200, res.text
        assert res.json()["group_by"] == expected


def test_wo_status_filter_is_parsed_as_a_list(client, auth_headers):
    res = client.get(
        "/api/reports/machine-output?group_by=wo&wo_status=completed,%20in_progress",
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["wo_status"] == ["COMPLETED", "IN_PROGRESS"]


def test_log_pegs_to_the_machine_picked_on_it_not_the_wos_group(client, auth_headers, async_db_session):
    """A WO cut on a GROUP gets its machine only from the log form. Reading the WO
    first filed that output under the group, so the picked loom read 0."""
    import uuid
    from app.models.manufacturing import ManufacturingOrder, MOCompletion
    from app.models.routing import WorkCenter
    from app.models.work_order import WorkOrder

    tag = str(uuid.uuid4())[:8]
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"PR-FG-{tag}", "name": "Greige", "uom": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"PR-RM-{tag}", "name": "Yarn", "uom": "kg"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-PR-{tag}", "item_code": f"PR-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"PR-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-PR-{tag}")

    async def _seed():
        group = WorkCenter(code=f"GRP-{tag}", name="Loom bank", center_type="WEAVING", node_type="GROUP")
        async_db_session.add(group)
        await async_db_session.flush()
        loom = WorkCenter(code=f"LM-{tag}", name="Loom 7", node_type="MACHINE", parent_id=group.id)
        mo = ManufacturingOrder(code=f"MO-PR-{tag}", bom_id=uuid.UUID(bom["id"]), item_id=uuid.UUID(bom["item_id"]), qty=10)
        async_db_session.add_all([loom, mo])
        await async_db_session.flush()
        wo = WorkOrder(manufacturing_order_id=mo.id, name="Weave", work_center_id=group.id, qty=10)
        async_db_session.add(wo)
        await async_db_session.flush()
        async_db_session.add(MOCompletion(mo_id=mo.id, work_order_id=wo.id, work_center_id=loom.id, qty_completed=4))
        await async_db_session.flush()
        return str(loom.id), str(group.id)

    loom_id, group_id = client.portal.call(_seed)

    rows = client.get(f"/api/reports/machine-output?group_id={group_id}", headers=auth_headers).json()["rows"]
    by_wc = {r["work_center_id"]: r for r in rows}
    assert by_wc[loom_id]["qty_good"] == 4
    assert group_id not in by_wc


def test_excel_export_needs_the_export_grant_and_keeps_formulas_as_text(user_factory, client):
    import io
    from openpyxl import load_workbook

    body = {
        "sheet": "Production Output", "filename": 'machine-output"\r\nX: y',
        "header": ["Machine", "Output"], "rows": [["=HYPERLINK(\"http://x\")", 4.5]],
    }
    _, viewer = user_factory(["production_output.view"], "viewer")
    assert client.post("/api/reports/production-output/export", json=body, headers=viewer).status_code == 403

    _, exporter = user_factory(["production_output.export"], "exporter")
    res = client.post("/api/reports/production-output/export", json=body, headers=exporter)
    assert res.status_code == 200, res.text
    assert "\r" not in res.headers["content-disposition"] and '"X' not in res.headers["content-disposition"]
    ws = load_workbook(io.BytesIO(res.content)).active
    assert [c.value for c in ws[1]] == ["Machine", "Output"]
    assert ws["A2"].data_type == "s" and ws["B2"].value == 4.5


def test_per_packer_output_is_restated_in_yards_through_the_orders_g_y(client, auth_headers, async_db_session):
    """Packers are paid per yard, so the per-packer report restates kg output in
    yards — the order's sampled g/y wins over the item's, and an item with no
    length conversion reads null (a dash), not 0."""
    import uuid
    from app.models.item import Item
    from app.models.packing import PackingCompletion, PackingOrder

    tag = str(uuid.uuid4())[:8]
    op = f"packer-{tag}"

    async def _seed():
        cloth = Item(code=f"PY-{tag}", name="Cloth", uom="kg", weight_per_unit=100, weight_unit="g/y")
        sampled = Item(code=f"PS-{tag}", name="Sampled", uom="kg", weight_per_unit=100, weight_unit="g/y")
        plain = Item(code=f"PP-{tag}", name="Buttons", uom="pcs")
        async_db_session.add_all([cloth, sampled, plain])
        await async_db_session.flush()
        orders = [
            PackingOrder(code=f"PA-{tag}", item_id=cloth.id, qty_target=10),
            # Sampled at 200 g/y: 2 kg is 10 yd, not the item's 20.
            PackingOrder(code=f"PB-{tag}", item_id=sampled.id, qty_target=10,
                         sample_weight_per_unit=200, sample_weight_unit="g/y"),
            PackingOrder(code=f"PC-{tag}", item_id=plain.id, qty_target=10),
        ]
        async_db_session.add_all(orders)
        await async_db_session.flush()
        async_db_session.add_all([
            PackingCompletion(packing_order_id=orders[0].id, qty=1, package_count=1, operator=op),  # 10 yd
            PackingCompletion(packing_order_id=orders[1].id, qty=2, package_count=1, operator=op),  # 10 yd
            PackingCompletion(packing_order_id=orders[2].id, qty=5, package_count=1, operator=op),  # no yards
            # A wholly rejected log counts no good yards.
            PackingCompletion(packing_order_id=orders[0].id, qty=3, package_count=1, operator=op, rejected=True),
        ])
        await async_db_session.flush()

    client.portal.call(_seed)

    res = client.get("/api/reports/packing-output?group_by=operator", headers=auth_headers)
    assert res.status_code == 200, res.text
    row = next(r for r in res.json()["rows"] if r["operator_name"] == op)
    assert row["yards_good"] == 20
    assert row["yards_per_day"] == 20
    by_item = {i["item_code"]: i for i in row["items"]}
    assert by_item[f"PY-{tag}"]["yards_good"] == 10
    assert by_item[f"PS-{tag}"]["yards_good"] == 10
    assert by_item[f"PP-{tag}"]["yards_good"] is None
