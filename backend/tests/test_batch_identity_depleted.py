"""A manual lot keeps its shade on Lot Management after it is used up.

A lot with no producing MO carries its identity only in its balance key, and the
key was read from rows with qty > 0 — so a drained manual lot lost its colour
(and bare Batch rows from other callers never had a key to read at all).
"""
import uuid

from tests.test_stock_lot_spill import _seed_location


def test_depleted_manual_lot_keeps_its_colour(client, auth_headers):
    t = uuid.uuid4().hex[:6].upper()
    _seed_location("DPL-LOC")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"DPL-{t}", "name": "Dpl", "uom": "kg"}, headers=auth_headers).json()
    color = client.post("/api/colors", json={"code": f"DPL-{t}", "name": f"DPL-{t}"}, headers=auth_headers).json()
    lot = client.post("/api/batches", json={"item_id": item["id"], "qty": 4, "location_id": locs["DPL-LOC"],
                                           "color_id": color["id"]}, headers=auth_headers).json()
    r = client.post("/api/stock", json={"item_code": item["code"], "location_code": "DPL-LOC", "qty": -4,
                                        "batch_id": lot["id"], "color_id": color["id"]}, headers=auth_headers)
    assert r.status_code == 201, r.text

    rows = client.get("/api/batches/paginated", params={"search": lot["batch_number"]}, headers=auth_headers).json()["items"]
    (row,) = [b for b in rows if b["id"] == lot["id"]]
    assert row["color_code"] == color["code"]
