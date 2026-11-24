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
