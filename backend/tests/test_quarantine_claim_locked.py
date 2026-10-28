"""An order that locked lots off the desk claims those lots and nothing else.

Its locked lots read wholly claimed; its open qty must not also FIFO-claim the
other released lots on top, or Pack greys out over stock nobody holds.
"""
import uuid

from tests.test_quarantine_manual_lot_color import _seed_quarantine_location


def test_locking_order_does_not_also_claim_free_lots(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_quarantine_location("QCLM-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"QCLM-{suffix}", "name": "QClm", "uom": "kg", "lot_tracked": True,
    }, headers=auth_headers).json()
    lots = []
    for _ in range(2):
        r = client.post("/api/batches", json={
            "item_id": item["id"], "qty": 5, "location_id": locs["QCLM-LOC"],
        }, headers=auth_headers)
        assert r.status_code == 200, r.text
        lots.append(r.json()["id"])

    ok = next(s for s in client.get("/api/quarantine/statuses", headers=auth_headers).json() if s["is_pass"])
    r = client.post("/api/quarantine/status", json={"batch_ids": lots, "status_value_id": ok["id"]}, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.post("/api/packing", json={
        "item_id": item["id"], "qty_target": 5,
        "source_location_id": locs["QCLM-LOC"], "output_location_id": locs["QCLM-LOC"],
        "locked_batch_ids": [lots[0]],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text

    r = client.get("/api/quarantine", params={"search": item["code"]}, headers=auth_headers)
    assert r.status_code == 200, r.text
    (group,) = r.json()["items"]
    claimed = {l["batch_id"]: l["claimed_qty"] for l in group["lots"]}
    assert claimed == {lots[0]: 5, lots[1]: 0}
    assert group["qty_claimed"] == 5
