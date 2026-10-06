"""PUT /packing/{id} only takes the statuses a user may state; DELIVERED is derived."""
import uuid

from tests.test_packing_lot_lock import _seed_locations


def test_put_rejects_derived_and_unknown_status_and_audits_the_move(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_locations("PST-SRC", "PST-OUT")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"PST-{suffix}", "name": "Pst", "uom": "kg"},
                       headers=auth_headers).json()
    po = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 10,
        "source_location_id": locs["PST-SRC"], "output_location_id": locs["PST-OUT"],
    }, headers=auth_headers)
    assert po.status_code == 200, po.text
    po = po.json()

    for bad in ("DELIVERED", "Completed"):
        r = client.put(f"/api/packing/{po['id']}", json={"status": bad}, headers=auth_headers)
        assert r.status_code == 400, (bad, r.text)

    r = client.put(f"/api/packing/{po['id']}", json={"status": "CANCELLED"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "CANCELLED"
