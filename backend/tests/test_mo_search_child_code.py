"""Searching the MO list by a child MO's code (SPK Produksi scan, Work Queue link)
lands on the root it hangs under — via parent_mo_id or MODependency pegging."""
import uuid


def test_search_by_child_or_pegged_component_code_returns_root(client, auth_headers, async_db_session):
    from app.models.manufacturing import ManufacturingOrder, MODependency
    from tests.test_dyeing_output_lot import _setup_dyeing_wo

    root_id, _wo_id, _runs = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=0)
    tag = uuid.uuid4().hex[:6]
    child_code, shared_code = f"MO-CHILD-{tag}", f"MO-SHARED-{tag}"

    async def _seed():
        root = await async_db_session.get(ManufacturingOrder, uuid.UUID(root_id))
        child = ManufacturingOrder(code=child_code, bom_id=root.bom_id, item_id=root.item_id, qty=1,
                                   parent_mo_id=root.id)
        shared = ManufacturingOrder(code=shared_code, bom_id=root.bom_id, item_id=root.item_id, qty=1,
                                    is_shared_component=True)
        async_db_session.add_all([child, shared])
        await async_db_session.flush()
        async_db_session.add(MODependency(dependent_mo_id=child.id, required_mo_id=shared.id, qty=1))
        await async_db_session.flush()
    client.portal.call(_seed)

    for code in (child_code, shared_code):
        res = client.get(f"/api/manufacturing-orders?search={code}", headers=auth_headers)
        assert res.status_code == 200, res.text
        assert [m["id"] for m in res.json()["items"]] == [root_id], code


def test_shared_component_found_by_root_code_and_its_shade_finds_the_run(client, auth_headers, async_db_session):
    """A consolidated component MO has no parent_mo_id — only MODependency ties it to
    its root — yet its work order shows that root's code, and the run it belongs to
    shows its shade. Both lists must find it by those codes."""
    from app.models.manufacturing import ManufacturingOrder, MODependency
    from app.models.production_run import ProductionRun
    from app.models.work_order import WorkOrder
    from tests.test_dyeing_output_lot import _setup_dyeing_wo

    root_id, _wo_id, _runs = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=0)
    tag = uuid.uuid4().hex[:6]
    shade = f"LD-{tag}"

    async def _seed():
        root = await async_db_session.get(ManufacturingOrder, uuid.UUID(root_id))
        pr = ProductionRun(code=f"PR-SRCH-{tag}")
        async_db_session.add(pr)
        await async_db_session.flush()
        shared = ManufacturingOrder(code=f"MO-SHARED-{tag}", bom_id=root.bom_id, item_id=root.item_id, qty=1,
                                    is_shared_component=True, production_run_id=pr.id, labdip_variant_code=shade)
        async_db_session.add(shared)
        await async_db_session.flush()
        wo = WorkOrder(manufacturing_order_id=shared.id, name="Shared step", code=f"WO-SHARED-{tag}")
        async_db_session.add_all([wo, MODependency(dependent_mo_id=root.id, required_mo_id=shared.id, qty=1)])
        await async_db_session.flush()
        return root.code, str(pr.id), str(wo.id)
    root_code, pr_id, shared_wo_id = client.portal.call(_seed)

    res = client.get(f"/api/work-orders?search={root_code}&size=200", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert shared_wo_id in {w["id"] for w in res.json()["items"]}

    res = client.get(f"/api/production-runs?search={shade}", headers=auth_headers)
    assert res.status_code == 200, res.text
    assert [p["id"] for p in res.json()["items"]] == [pr_id]
