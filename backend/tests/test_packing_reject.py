"""Loose scrap logged at pack time — packing less than what was drawn.

A packer draws 30kg out of the source bin, boxes 24kg into cartons and finds the
remaining 6kg is stained offcuts. That 6kg still LEFT the source location, so it
cannot simply be omitted from the log or the bin reads 6kg heavier than the shelf.
It is recorded as `qty_rejected` on the completion and moved into the defect
store, and it must never reach `qty_packed` — the sales order is not one gram
closer to shippable for it.

Cartons that were minted and only then failed QC are a different event and stay
with the reject endpoint (`/completions/{id}/reject`), which grades the carton
Batch; these cover the log-time path, where there is no carton to grade.
"""
import uuid

import pytest


def _seed_locations(*codes):
    """Locations are created through the sync session; packing is async.

    Same pattern as test_manufacturing.py — /api/locations is a sync router, so
    inserting directly is what lets the async side see the row.
    """
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.location import Location as _Location
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        for code in codes:
            if not sess.query(_Location).filter_by(code=code).first():
                sess.add(_Location(code=code, name=code.replace("-", " ").title()))
        sess.commit()
    finally:
        sess.close()
        conn.close()


def _box(client, auth_headers):
    """A standard packaging type to pack into.

    Every carton must name one (`packing_service.assert_all_boxed`) — brutto is
    printed on the label and totalled on the delivery note, and a carton with no
    box has no tare to add. These tests are about scrap, not packaging, so they
    take the seeded Box S; a fresh test DB has it from `seed_packaging_types`.
    """
    types = client.get("/api/packaging-types", headers=auth_headers).json()
    standard = next((t for t in types if not t.get("is_custom")), None)
    if standard is None:
        standard = client.post("/api/packaging-types", json={
            "code": "BOX-TEST", "name": "Test Box", "tare_kg": 0.5,
        }, headers=auth_headers).json()
    return standard["id"]


def _location_ids(client, auth_headers):
    return {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}


def _balance(client, auth_headers, item_id, location_id):
    """On-hand for one item at one location, across every lot held there."""
    rows = client.get("/api/stock/balance", headers=auth_headers).json()
    return sum(
        float(b["qty"]) for b in rows
        if b["item_id"] == item_id and b.get("location_id") == location_id
    )


@pytest.fixture
def packing_setup(client, auth_headers):
    """A kg item with 30kg of bulk FG in the pack bin, and a defect store."""
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("PACK-SRC", "PACK-OUT", "PACK-REJ")
    locs = _location_ids(client, auth_headers)

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"PK-FG-{suffix}", "name": "Pack FG", "uom": "kg",
        "default_reject_location_id": locs["PACK-REJ"],
    }, headers=auth_headers).json()

    client.post("/api/items/stock", json={
        "item_code": item["code"], "location_code": "PACK-SRC", "qty": 30,
        "reference_id": "INIT",
    }, headers=auth_headers)

    po = client.post("/api/packing", json={
        "item_id": item["id"],
        "qty_target": 30,
        "pack_size": 6,
        "source_location_id": locs["PACK-SRC"],
        "output_location_id": locs["PACK-OUT"],
    }, headers=auth_headers)
    assert po.status_code == 200, po.text
    return {"item": item, "po": po.json(), "locs": locs}


def test_scrap_leaves_the_source_but_never_counts_as_packed(client, auth_headers, packing_setup):
    item, po, locs = packing_setup["item"], packing_setup["po"], packing_setup["locs"]

    # 24kg boxed into four 6kg cartons; 6kg of offcuts scrapped.
    box = _box(client, auth_headers)
    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 24,
        "boxes": [6, 6, 6, 6],
        "box_weights": [6, 6, 6, 6],
        "box_packaging_type_ids": [box] * 4,
        "qty_rejected": 6,
        "reject_reason": "stained offcuts",
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    fresh = res.json()

    # Good output only — the scrap is not progress toward the target.
    assert float(fresh["qty_packed"]) == 24.0
    assert int(fresh["package_count"]) == 4
    assert float(fresh["qty_rejected"]) == 6.0
    # No carton was minted for it, so nothing is counted as a rejected package.
    assert int(fresh["package_count_rejected"]) == 0

    comp = fresh["completions"][0]
    assert float(comp["qty"]) == 24.0
    assert float(comp["qty_rejected"]) == 6.0
    assert comp["reject_reason"] == "stained offcuts"
    # The log stays active: it produced four good cartons.
    assert comp["rejected"] is False

    # The whole 30kg left the source bin — cartons and scrap alike.
    assert _balance(client, auth_headers, item["id"], locs["PACK-SRC"]) == 0.0
    assert _balance(client, auth_headers, item["id"], locs["PACK-OUT"]) == 24.0
    assert _balance(client, auth_headers, item["id"], locs["PACK-REJ"]) == 6.0


def test_scrap_only_event_is_logged_as_rejected(client, auth_headers, packing_setup):
    """A draw that yielded nothing good is still a real event — it moved stock."""
    item, po, locs = packing_setup["item"], packing_setup["po"], packing_setup["locs"]

    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 0,
        "qty_rejected": 10,
        "reject_reason": "wet",
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    fresh = res.json()

    assert float(fresh["qty_packed"]) == 0.0
    assert float(fresh["qty_rejected"]) == 10.0
    assert fresh["packed_units"] == []
    # Nothing good came out, so the log is a rejected one outright rather than an
    # active completion with zero output.
    assert fresh["completions"][0]["rejected"] is True

    assert _balance(client, auth_headers, item["id"], locs["PACK-SRC"]) == 20.0
    assert _balance(client, auth_headers, item["id"], locs["PACK-REJ"]) == 10.0


def test_scrap_must_be_covered_by_the_same_draw(client, auth_headers, packing_setup):
    """28kg of cartons plus 5kg of offcuts is 33kg out of a 30kg bin."""
    po = packing_setup["po"]

    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 28,
        "boxes": [6, 6, 6, 6, 4],
        "box_weights": [6, 6, 6, 6, 4],
        "box_packaging_type_ids": [_box(client, auth_headers)] * 5,
        "qty_rejected": 5,
    }, headers=auth_headers)
    assert res.status_code == 400
    assert "Insufficient stock" in res.json()["detail"]


def test_an_empty_log_is_still_refused(client, auth_headers, packing_setup):
    """Dropping "Qty to Pack" must not make a no-op log postable."""
    po = packing_setup["po"]
    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 0, "qty_rejected": 0,
    }, headers=auth_headers)
    assert res.status_code == 400


def test_scrap_without_a_defect_store_writes_off_rather_than_500s(client, auth_headers):
    """No `default_reject_location_id` configured — the qty still has to leave."""
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("PACK-SRC", "PACK-OUT")
    locs = _location_ids(client, auth_headers)

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"PK-NB-{suffix}", "name": "Pack FG no bin", "uom": "kg",
    }, headers=auth_headers).json()
    client.post("/api/items/stock", json={
        "item_code": item["code"], "location_code": "PACK-SRC", "qty": 10,
        "reference_id": "INIT",
    }, headers=auth_headers)
    po = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 10, "pack_size": 4,
        "source_location_id": locs["PACK-SRC"],
        "output_location_id": locs["PACK-OUT"],
    }, headers=auth_headers).json()

    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 8, "boxes": [4, 4], "box_weights": [4, 4],
        "box_packaging_type_ids": [_box(client, auth_headers)] * 2,
        "qty_rejected": 2,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert float(res.json()["qty_rejected"]) == 2.0
    # Written off one-sided: it is gone from the good bin either way.
    assert _balance(client, auth_headers, item["id"], locs["PACK-SRC"]) == 0.0


def test_scrap_goes_to_the_packing_machines_defect_store(client, auth_headers):
    """No item default, but the machine's parent names a defect store — that wins.

    Packing resolved only explicit → item default, so a reject on a festoning
    machine whose group carries the store was written off one-sided instead.
    """
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("PACK-SRC", "PACK-OUT", "PACK-GRP-REJ")
    locs = _location_ids(client, auth_headers)

    # /api/work-centers is a sync router; seeded directly so the async packing
    # side can see it (same reason as `_seed_locations`).
    from app.db.session import engine as _engine
    from sqlalchemy.orm import Session as _SASession
    from app.models.routing import WorkCenter as _WC
    conn = _engine.connect()
    sess = _SASession(conn)
    try:
        parent = _WC(code=f"FST-{suffix}", name="Festoning", center_type="PACKING",
                     node_type="TYPE", reject_location_id=locs["PACK-GRP-REJ"])
        sess.add(parent)
        sess.flush()
        machine = _WC(code=f"FST-{suffix}-01", name="Festoning 01", center_type="PACKING",
                      node_type="MACHINE", parent_id=parent.id)
        sess.add(machine)
        sess.commit()
        machine_id = str(machine.id)
    finally:
        sess.close()
        conn.close()

    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"PK-WC-{suffix}", "name": "Pack FG wc bin", "uom": "kg",
    }, headers=auth_headers).json()
    client.post("/api/items/stock", json={
        "item_code": item["code"], "location_code": "PACK-SRC", "qty": 10,
        "reference_id": "INIT",
    }, headers=auth_headers)
    po = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 10, "pack_size": 4,
        "source_location_id": locs["PACK-SRC"],
        "output_location_id": locs["PACK-OUT"],
        "work_center_id": machine_id,
    }, headers=auth_headers).json()

    res = client.post(f"/api/packing/{po['id']}/complete", json={
        "qty": 8, "boxes": [4, 4], "box_weights": [4, 4],
        "box_packaging_type_ids": [_box(client, auth_headers)] * 2,
        "qty_rejected": 2,
    }, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert _balance(client, auth_headers, item["id"], locs["PACK-SRC"]) == 0.0
    assert _balance(client, auth_headers, item["id"], locs["PACK-GRP-REJ"]) == 2.0
