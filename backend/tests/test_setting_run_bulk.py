"""One stenter setup, several work orders.

The setting side of the same convenience as the dye side: a shade's orders are set
on one machine at one width, overfeed and temperature, and typing that into a form
per order is the data entry this replaces. No bath, so no group id — cloth goes
through a stenter one piece after another, sharing a setup rather than a vessel.
"""
import uuid


def _setup(client, auth_headers, session, *, wo_qty=100.0):
    """A SETTING work order and the context to cut a second one beside it."""
    from app.models.location import Location
    from app.models.routing import WorkCenter

    tag = str(uuid.uuid4())[:8]
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)

    loc = Location(code=f"WH-SB-{tag}", name="Setting Store")
    wc = WorkCenter(code=f"SET-SB-{tag}", name="Stenter SB", center_type="SETTING", node_type="MACHINE")

    async def _seed():
        session.add_all([loc, wc])
        await session.flush()
        return str(loc.id), str(wc.id)

    loc_id, wc_id = client.portal.call(_seed)

    client.post("/api/items", json={"code": f"SB-FG-{tag}", "name": "Set Fabric", "uom": "kg"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"SB-RM-{tag}", "name": "Dyed Fabric", "uom": "kg"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-SB-{tag}", "item_code": f"SB-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"SB-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-SB-{tag}")

    mo = client.post("/api/manufacturing-orders", json={
        "code": f"MO-SB-{tag}", "bom_id": bom["id"], "qty": wo_qty,
        "location_code": f"WH-SB-{tag}", "source_location_code": f"WH-SB-{tag}",
    }, headers=auth_headers)
    assert mo.status_code == 200, mo.text
    mo_id = mo.json()["id"]

    ctx = {"mo_id": mo_id, "wc_id": wc_id, "loc_id": loc_id}
    return _wo(client, auth_headers, ctx, wo_qty), ctx


def _wo(client, auth_headers, ctx, qty):
    res = client.post("/api/work-orders", json={
        "manufacturing_order_id": ctx["mo_id"], "qty": qty,
        "work_center_id": ctx["wc_id"],
        "input_location_id": ctx["loc_id"], "output_location_id": ctx["loc_id"],
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    return res.json()["id"]


def test_one_setup_covers_several_work_orders(client, auth_headers, async_db_session):
    """Two orders, one stenter, one set of settings — typed once."""
    wo_a, ctx = _setup(client, auth_headers, async_db_session)
    wo_b = _wo(client, auth_headers, ctx, qty=60.0)

    res = client.post("/api/setting-runs/bulk", json={
        "work_order_ids": [wo_a, wo_b],
        "width_cm": 160, "overfeed_pct": 4.5, "temperature_c": 180, "speed_mpm": 25,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    rows = res.json()

    assert len(rows) == 2
    assert {str(r["work_order_id"]) for r in rows} == {str(wo_a), str(wo_b)}
    assert all(float(r["width_cm"]) == 160.0 for r in rows)
    assert all(float(r["overfeed_pct"]) == 4.5 for r in rows)
    # A setting WO is not cut with a run, so these are created here — and the load
    # stays each order's own.
    by_wo = {str(r["work_order_id"]): r for r in rows}
    assert float(by_wo[str(wo_a)]["substrate_qty"]) == 100.0
    assert float(by_wo[str(wo_b)]["substrate_qty"]) == 60.0
    assert all(r["status"] == "PENDING" for r in rows)


def test_a_setup_is_one_machine(client, auth_headers, async_db_session):
    wo_a, _ctx = _setup(client, auth_headers, async_db_session)
    wo_other, _ctx_other = _setup(client, auth_headers, async_db_session)

    res = client.post("/api/setting-runs/bulk", json={
        "work_order_ids": [wo_a, wo_other], "width_cm": 160,
    }, headers=auth_headers)
    assert res.status_code == 422, res.text
    assert "machine" in res.json()["detail"]


def test_rerunning_configures_the_open_run_rather_than_piling_up(client, auth_headers, async_db_session):
    """Correcting the setup must not leave two runs on one order."""
    wo_a, ctx = _setup(client, auth_headers, async_db_session)
    wo_b = _wo(client, auth_headers, ctx, qty=60.0)
    client.post("/api/setting-runs/bulk", json={
        "work_order_ids": [wo_a, wo_b], "width_cm": 160,
    }, headers=auth_headers)

    again = client.post("/api/setting-runs/bulk", json={
        "work_order_ids": [wo_a, wo_b], "width_cm": 155,
    }, headers=auth_headers)
    assert again.status_code == 200, again.text
    assert all(float(r["width_cm"]) == 155.0 for r in again.json())

    runs = client.get(f"/api/setting-runs?work_order_id={wo_a}", headers=auth_headers).json()
    assert len(runs) == 1
