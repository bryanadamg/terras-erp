def test_work_order_lifecycle(client, auth_headers):
    # Setup Data
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)

    # /api/locations is sync, but items/BOMs/manufacturing-orders/work-orders
    # are async — insert the location directly so the async side can see it
    # (same pattern as test_nested_wo_serialization below).
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    _conn = _engine.connect()
    _sess = _SASession(_conn)
    try:
        if not _sess.query(_Location).filter_by(code="WH-MAIN").first():
            _sess.add(_Location(code="WH-MAIN", name="Main Warehouse"))
            _sess.commit()
    finally:
        _sess.close()
        _conn.close()

    fg = client.post("/api/items", json={"code": "WO-FG", "name": "WO Product", "uom": "pcs"}, headers=auth_headers).json()
    rm = client.post("/api/items", json={"code": "WO-RM", "name": "WO Material", "uom": "pcs"}, headers=auth_headers).json()

    # Stock RM
    client.post("/api/items/stock", json={
        "item_code": "WO-RM", "location_code": "WH-MAIN", "qty": 100, "reference_id": "INIT"
    }, headers=auth_headers)

    # BOM
    client.post("/api/boms", json={
        "code": "BOM-WO", "item_code": "WO-FG", "qty": 1,
        "lines": [{"item_code": "WO-RM", "qty": 10, "percentage": 100.0}]
    }, headers=auth_headers)

    bom = client.get("/api/boms", headers=auth_headers).json()[0]

    # WOs are floor units under a Manufacturing Order, not created directly
    # from a BOM (see CLAUDE.md's manufacturing hierarchy) — create the MO first.
    mo_res = client.post("/api/manufacturing-orders", json={
        "code": "MO-WO-001",
        "bom_id": bom["id"],
        "location_code": "WH-MAIN",
        "source_location_code": "WH-MAIN",
        "qty": 2.0,
    }, headers=auth_headers)
    assert mo_res.status_code == 200, mo_res.text
    mo_id = mo_res.json()["id"]

    wh_main_id = next(
        l for l in client.get("/api/locations", headers=auth_headers).json() if l["code"] == "WH-MAIN"
    )["id"]

    # No work center in this test, so input/output locations are set directly
    # (WO creation would otherwise leave them null with nothing to resolve them from).
    wo_res = client.post("/api/work-orders", json={
        "manufacturing_order_id": mo_id,
        "qty": 2.0,
        "input_location_id": wh_main_id,
        "output_location_id": wh_main_id,
    }, headers=auth_headers)
    assert wo_res.status_code == 200, wo_res.text
    wo_id = wo_res.json()["id"]

    # Start
    client.put(f"/api/work-orders/{wo_id}/status?status=IN_PROGRESS", headers=auth_headers)

    # Log the full qty as a completion (this is what deducts stock now — a
    # WO status change alone no longer does, see api/work_orders.py).
    completion_res = client.post(f"/api/manufacturing-orders/{mo_id}/completions", json={
        "qty_completed": 2.0,
        "work_order_id": wo_id,
    }, headers=auth_headers)
    assert completion_res.status_code == 200, completion_res.text

    client.put(f"/api/work-orders/{wo_id}/status?status=COMPLETED", headers=auth_headers)

    # Verify Stock Deduction. BOM consumption is percentage-based, not the
    # line's display `qty` (see CLAUDE.md's BOM section) — the single line is
    # 100% of output, so qty_completed (2.0) itself is what's consumed.
    # 100 - 2 = 98 remaining.
    balance = client.get("/api/stock/balance", headers=auth_headers).json()
    rm_stock = next(b for b in balance if b["item_id"] == rm["id"])
    assert float(rm_stock["qty"]) == 98.0

    # Delete Completed WO (Allowed now)
    del_res = client.delete(f"/api/work-orders/{wo_id}", headers=auth_headers)
    assert del_res.status_code == 200


def test_nested_mo_serialization(client, auth_headers):
    """Regression test for the MissingGreenlet bug.

    Nesting now happens at the MO level (`create_nested` -> `child_mos`), not
    the WO level — `child_wos` no longer exists on WorkOrderResponse. Without
    the eager-load fix, GET /api/manufacturing-orders would 500 because an
    unloaded relationship on a nested MO triggered async lazy-load.
    """
    import uuid
    mo_code = f"NEST-MO-L0-{str(uuid.uuid4())[:8]}"

    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)

    # /api/locations is sync but manufacturing-orders is async — insert
    # directly so the async side can see it (same pattern as
    # test_work_order_lifecycle above).
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    _conn = _engine.connect()
    _sess = _SASession(_conn)
    try:
        if not _sess.query(_Location).filter_by(code="NEST-WH").first():
            _sess.add(_Location(code="NEST-WH", name="Nest Warehouse"))
            _sess.commit()
    finally:
        _sess.close()
        _conn.close()

    client.post("/api/items", json={"code": "NEST-RAW", "name": "Nest Raw Material", "uom": "pcs"}, headers=auth_headers)
    client.post("/api/items", json={"code": "NEST-SUB", "name": "Nest Sub-Assembly", "uom": "pcs"}, headers=auth_headers)
    client.post("/api/items", json={"code": "NEST-FIN", "name": "Nest Finished Good", "uom": "pcs"}, headers=auth_headers)

    client.post("/api/boms", json={
        "code": "BOM-NEST-SUB", "item_code": "NEST-SUB", "qty": 1,
        "lines": [{"item_code": "NEST-RAW", "qty": 2, "percentage": 100.0}]
    }, headers=auth_headers)
    client.post("/api/boms", json={
        "code": "BOM-NEST-FIN", "item_code": "NEST-FIN", "qty": 1,
        "lines": [{"item_code": "NEST-SUB", "qty": 1, "percentage": 100.0}]
    }, headers=auth_headers)

    client.post("/api/items/stock", json={
        "item_code": "NEST-RAW", "location_code": "NEST-WH", "qty": 100, "reference_id": "NEST-INIT"
    }, headers=auth_headers)

    boms = client.get("/api/boms", headers=auth_headers).json()
    bom_nest_fin = next((b for b in boms if b["code"] == "BOM-NEST-FIN"), None)
    assert bom_nest_fin is not None, "BOM-NEST-FIN not found"
    bom_nest_fin_id = bom_nest_fin["id"]

    # Create the root MO with create_nested=true (recursively creates one
    # child MO per sub-BOM level — see mrp_service.create_mo_recursive).
    mo_res = client.post("/api/manufacturing-orders", json={
        "code": mo_code,
        "bom_id": bom_nest_fin_id,
        "location_code": "NEST-WH",
        "source_location_code": "NEST-WH",
        "qty": 1.0,
        "create_nested": True,
    }, headers=auth_headers)
    assert mo_res.status_code == 200, mo_res.text

    # Critical assertion — GET /api/manufacturing-orders must not 500
    list_res = client.get("/api/manufacturing-orders", params={"all_levels": "true"}, headers=auth_headers)
    assert list_res.status_code == 200, (
        f"GET /api/manufacturing-orders returned {list_res.status_code}: {list_res.text}"
    )

    all_mos = list_res.json().get("items", [])
    nest_mo = next((m for m in all_mos if m.get("code") == mo_code), None)
    assert nest_mo is not None, f"{mo_code} not found in manufacturing order list"
    assert "child_mos" in nest_mo, f"{mo_code} is missing child_mos key"
    assert isinstance(nest_mo["child_mos"], list), "child_mos should be a list"
    assert len(nest_mo["child_mos"]) >= 1, "Nested MO creation should produce at least one child"
    for child in nest_mo["child_mos"]:
        assert "child_mos" in child, f"Child MO {child.get('code')} is missing child_mos key"
        assert isinstance(child["child_mos"], list), f"child_mos on child MO {child.get('code')} should be a list"

    _c2 = _engine.connect()
    _s2 = _SASession(_c2)
    try:
        _s2.query(_Location).filter(_Location.code == "NEST-WH").delete(synchronize_session=False)
        _s2.commit()
    except Exception:
        _s2.rollback()
    finally:
        _s2.close()
        _c2.close()


def test_production_run_attribute_value_propagation(client, auth_headers):
    """When attribute_value_ids is set on a PRBomEntry, root MO attribute_value_ids
    must match — not inherit the (empty) BOM attribute set."""
    import uuid as _uuid
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.item import Item as _Item
    from app.models.location import Location as _Location
    from app.models.attribute import Attribute as _Attribute, AttributeValue as _AttributeValue

    suffix = str(_uuid.uuid4())[:8]
    loc_code = f"ATVP-LOC-{suffix}"
    base_code = f"ATVP-BASE-{suffix}"
    sub_code = f"ATVP-SUB-{suffix}"
    attr_name = f"ATVP-Colors-{suffix}"

    _real_conn = _engine.connect()
    _real_sess = _SASession(_real_conn)
    color_val_id = None
    try:
        # Insert location, items, attribute, value directly into real DB
        # (async routes use get_async_db and cannot see the test's rollback session)
        if not _real_sess.query(_Location).filter_by(code=loc_code).first():
            _real_sess.add(_Location(code=loc_code, name="ATVP Test Loc"))
        if not _real_sess.query(_Item).filter_by(code=base_code).first():
            _real_sess.add(_Item(code=base_code, name="ATVP Base", uom="m"))
        if not _real_sess.query(_Item).filter_by(code=sub_code).first():
            _real_sess.add(_Item(code=sub_code, name="ATVP Sub", uom="m"))
        attr = _real_sess.query(_Attribute).filter_by(name=attr_name).first()
        if not attr:
            attr = _Attribute(name=attr_name, is_system=False)
            _real_sess.add(attr)
        _real_sess.flush()
        color_val = _AttributeValue(attribute_id=attr.id, value="Black-218")
        _real_sess.add(color_val)
        _real_sess.commit()
        _real_sess.refresh(color_val)
        color_val_id = str(color_val.id)
    finally:
        _real_sess.close()
        _real_conn.close()

    try:
        bom_res = client.post("/api/boms", json={
            "code": f"ATVP-BOM-{suffix}",
            "item_code": base_code,
            "qty": 1,
            "lines": [{"item_code": sub_code, "qty": 1, "percentage": 100.0}],
        }, headers=auth_headers)
        assert bom_res.status_code == 200, bom_res.text
        bom_id = bom_res.json()["id"]

        pr_res = client.post("/api/production-runs", json={
            "code": f"ATVP-PR-{suffix}",
            "bom_entries": [{
                "bom_id": bom_id,
                "total_qty": 100.0,
                "attribute_value_ids": [color_val_id],
            }],
            "location_code": loc_code,
        }, headers=auth_headers)
        assert pr_res.status_code == 200, pr_res.text

        pr = pr_res.json()
        root_mos = [mo for mo in pr["manufacturing_orders"] if not mo.get("is_shared_component")]
        assert len(root_mos) == 1

        mo_attr_ids = [str(v) for v in root_mos[0].get("attribute_value_ids", [])]
        assert color_val_id in mo_attr_ids, (
            f"Expected color_val_id {color_val_id} in MO attribute_value_ids, got {mo_attr_ids}"
        )

        # Cleanup PR
        client.delete(f"/api/production-runs/{pr['id']}", headers=auth_headers)
        if bom_id:
            client.delete(f"/api/boms/{bom_id}", headers=auth_headers)
    finally:
        # Cleanup real DB entities
        _c2 = _engine.connect()
        _s2 = _SASession(_c2)
        try:
            _s2.query(_AttributeValue).filter(_AttributeValue.id == color_val_id).delete(synchronize_session=False)
            _s2.query(_Attribute).filter(_Attribute.name == attr_name).delete(synchronize_session=False)
            _s2.query(_Item).filter(_Item.code.in_([base_code, sub_code])).delete(synchronize_session=False)
            _s2.query(_Location).filter(_Location.code == loc_code).delete(synchronize_session=False)
            _s2.commit()
        except Exception:
            _s2.rollback()
        finally:
            _s2.close()
            _c2.close()


def test_production_run_no_attrs_inherits_bom(client, auth_headers):
    """When attribute_value_ids is empty on PRBomEntry, root MO has no attrs."""
    import uuid as _uuid
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.item import Item as _Item
    from app.models.location import Location as _Location

    suffix = str(_uuid.uuid4())[:8]
    loc_code = f"NAIB-LOC-{suffix}"
    base_code = f"NAIB-BASE-{suffix}"
    sub_code = f"NAIB-SUB-{suffix}"

    _real_conn = _engine.connect()
    _real_sess = _SASession(_real_conn)
    try:
        if not _real_sess.query(_Location).filter_by(code=loc_code).first():
            _real_sess.add(_Location(code=loc_code, name="NAIB Test Loc"))
        if not _real_sess.query(_Item).filter_by(code=base_code).first():
            _real_sess.add(_Item(code=base_code, name="NAIB Base", uom="m"))
        if not _real_sess.query(_Item).filter_by(code=sub_code).first():
            _real_sess.add(_Item(code=sub_code, name="NAIB Sub", uom="m"))
        _real_sess.commit()
    finally:
        _real_sess.close()
        _real_conn.close()

    bom_id = None
    pr_id = None
    try:
        bom_res = client.post("/api/boms", json={
            "code": f"NAIB-BOM-{suffix}",
            "item_code": base_code,
            "qty": 1,
            "lines": [{"item_code": sub_code, "qty": 1, "percentage": 100.0}],
        }, headers=auth_headers)
        assert bom_res.status_code == 200, bom_res.text
        bom_id = bom_res.json()["id"]

        pr_res = client.post("/api/production-runs", json={
            "code": f"NAIB-PR-{suffix}",
            "bom_entries": [{"bom_id": bom_id, "total_qty": 50.0}],
            "location_code": loc_code,
        }, headers=auth_headers)
        assert pr_res.status_code == 200, pr_res.text
        pr_id = pr_res.json()["id"]

        pr = pr_res.json()
        root_mos = [mo for mo in pr["manufacturing_orders"] if not mo.get("is_shared_component")]
        assert len(root_mos) == 1
        assert root_mos[0].get("attribute_value_ids", []) == []
    finally:
        if pr_id:
            client.delete(f"/api/production-runs/{pr_id}", headers=auth_headers)
        if bom_id:
            client.delete(f"/api/boms/{bom_id}", headers=auth_headers)
        _c2 = _engine.connect()
        _s2 = _SASession(_c2)
        try:
            _s2.query(_Item).filter(_Item.code.in_([base_code, sub_code])).delete(synchronize_session=False)
            _s2.query(_Location).filter(_Location.code == loc_code).delete(synchronize_session=False)
            _s2.commit()
        except Exception:
            _s2.rollback()
        finally:
            _s2.close()
            _c2.close()


def test_reopening_a_closed_mo_needs_the_close_permission(user_factory, client, auth_headers):
    import uuid
    tag = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"RO-FG-{tag}", "name": "FG", "uom": "pcs"}, headers=auth_headers)
    client.post("/api/items", json={"code": f"RO-RM-{tag}", "name": "RM", "uom": "pcs"}, headers=auth_headers)
    client.post("/api/boms", json={
        "code": f"BOM-RO-{tag}", "item_code": f"RO-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"RO-RM-{tag}", "qty": 1, "percentage": 100.0}],
    }, headers=auth_headers)
    bom = next(b for b in client.get("/api/boms", headers=auth_headers).json() if b["code"] == f"BOM-RO-{tag}")
    mo = client.post("/api/manufacturing-orders", json={"code": f"MO-RO-{tag}", "bom_id": bom["id"], "qty": 1.0},
                     headers=auth_headers)
    assert mo.status_code == 200, mo.text
    url = f"/api/manufacturing-orders/{mo.json()['id']}/status"
    assert client.put(f"{url}?status=COMPLETED", headers=auth_headers).status_code == 200

    _, editor = user_factory(["manufacturing_order.edit"], "mo-editor")
    assert client.put(f"{url}?status=IN_PROGRESS", headers=editor).status_code == 403
    assert client.put(f"{url}?status=IN_PROGRESS", headers=auth_headers).status_code == 200
