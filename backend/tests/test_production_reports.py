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
