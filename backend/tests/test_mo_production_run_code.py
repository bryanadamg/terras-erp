"""The SPK Produksi prints the production run's number, so the MO response carries it."""
import uuid


def test_mo_response_carries_its_production_run_code(client, auth_headers, async_db_session):
    from app.models.manufacturing import ManufacturingOrder
    from app.models.production_run import ProductionRun
    from tests.test_dyeing_output_lot import _setup_dyeing_wo

    mo_id, _wo_id, _runs = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=0)
    code = f"PR-SPK-{uuid.uuid4().hex[:6]}"

    async def _attach():
        pr = ProductionRun(code=code)
        async_db_session.add(pr)
        await async_db_session.flush()
        (await async_db_session.get(ManufacturingOrder, uuid.UUID(mo_id))).production_run_id = pr.id
        await async_db_session.flush()
    client.portal.call(_attach)

    res = client.get(f"/api/manufacturing-orders/{mo_id}", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert res.json()["production_run_code"] == code
