"""packing_order.log vs packing_order.edit on PUT /packing/{id}.

A packer (log only) saves the floor setup the pack screen asks for — sampled
weight, locations, machine — but closing or re-planning the order is edit.
"""
import uuid

from tests.test_packing_lot_lock import _seed_locations


def test_packer_can_save_setup_but_not_close(user_factory, client, auth_headers):
    _, packer = user_factory(["packing_order.log", "packing_order.view"], "packer")
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("PPM-SRC", "PPM-OUT")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"PPM-{suffix}", "name": "Ppm", "uom": "kg"},
                       headers=auth_headers).json()
    po = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 10,
        "source_location_id": locs["PPM-SRC"], "output_location_id": locs["PPM-OUT"],
    }, headers=auth_headers).json()

    # Creating is not the packer's right.
    r = client.post("/api/packing", json={"item_id": item["id"], "qty_target": 1}, headers=packer)
    assert r.status_code == 403, r.text

    r = client.put(f"/api/packing/{po['id']}", json={
        "source_location_id": locs["PPM-OUT"], "output_location_id": locs["PPM-SRC"],
    }, headers=packer)
    assert r.status_code == 200, r.text

    for body in ({"status": "CANCELLED"}, {"qty_target": 99}):
        r = client.put(f"/api/packing/{po['id']}", json=body, headers=packer)
        assert r.status_code == 403, (body, r.text)


def test_packing_and_pick_list_reads_need_a_warehouse_code(user_factory, client):
    _, outsider = user_factory(["item.view"], "outsider")
    _, picker = user_factory(["pick_list.scan"], "picker")
    for url in ("/api/packing", "/api/packing/packed-units", "/api/pick-lists",
                "/api/pick-lists/pickable-orders"):
        assert client.get(url, headers=outsider).status_code == 403, url
    # A picker reads lists and cartons (to resolve scans) but not the pick planner.
    assert client.get("/api/pick-lists", headers=picker).status_code == 200
    assert client.get("/api/packing/packed-units", headers=picker).status_code == 200
    assert client.get("/api/pick-lists/pickable-orders", headers=picker).status_code == 403
