"""The sales order list search finds an order by the MO / WO codes its MO-progress
cell shows: the root MO, its work-order steps, and components pegged at any depth."""
import uuid


def test_sales_order_search_matches_mo_wo_and_pegged_component_codes(client, auth_headers, async_db_session):
    from app.models.manufacturing import ManufacturingOrder, MODependency
    from app.models.work_order import WorkOrder
    from tests.test_dyeing_output_lot import _setup_dyeing_wo

    root_id, wo_id, _runs = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=0)
    tag = uuid.uuid4().hex[:6].upper()
    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-SOM-{tag}", "customer_name": "Acme", "order_date": "2026-02-04T00:00:00",
        "lines": [],
    }, headers=auth_headers).json()
    greige_code, beam_code = f"MO-GRG-{tag}", f"MO-BEAM-{tag}"

    async def _seed():
        root = await async_db_session.get(ManufacturingOrder, uuid.UUID(root_id))
        root.sales_order_id = uuid.UUID(so["id"])
        greige = ManufacturingOrder(code=greige_code, bom_id=root.bom_id, item_id=root.item_id, qty=1,
                                    is_shared_component=True)
        beam = ManufacturingOrder(code=beam_code, bom_id=root.bom_id, item_id=root.item_id, qty=1,
                                  is_shared_component=True)
        async_db_session.add_all([greige, beam])
        await async_db_session.flush()
        async_db_session.add_all([
            MODependency(dependent_mo_id=root.id, required_mo_id=greige.id, qty=1),
            MODependency(dependent_mo_id=greige.id, required_mo_id=beam.id, qty=1),
        ])
        wo = await async_db_session.get(WorkOrder, uuid.UUID(wo_id))
        await async_db_session.flush()
        return root.code, wo.code
    root_code, wo_code = client.portal.call(_seed)

    for term in (root_code, wo_code, greige_code, beam_code):
        res = client.get("/api/sales-orders", params={"search": term}, headers=auth_headers)
        assert res.status_code == 200, res.text
        assert [o["id"] for o in res.json()["items"]] == [so["id"]], term
