"""Moving coloured FG stock must keep its `c:<color>` variant token.

The balance row's variant_key carries the shade, but the transfer rebuilt the
key from attribute_value_ids alone — so the OUT side addressed a row that
didn't exist and failed "Insufficient stock. Current: 0.0".
"""
import uuid

from tests.test_stock_lot_spill import _seed_location


def test_transfer_keeps_color_variant(client, auth_headers):
    suffix = uuid.uuid4().hex[:6].upper()
    _seed_location("CLR-SRC")
    _seed_location("CLR-DST")
    locs = {l["code"]: l["id"] for l in client.get("/api/locations", headers=auth_headers).json()}
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"CLR-{suffix}", "name": "Clr", "uom": "kg"}, headers=auth_headers).json()
    color = client.post("/api/colors", json={"code": f"CLR-{suffix}", "name": "Navy"}, headers=auth_headers).json()

    r = client.post("/api/stock", json={
        "item_code": item["code"], "location_code": "CLR-SRC", "qty": 5, "color_id": color["id"],
    }, headers=auth_headers)
    assert r.status_code == 201, r.text

    def rows():
        return [b for b in client.get("/api/stock/balance", headers=auth_headers).json() if b["item_id"] == item["id"]]

    (src,) = rows()
    assert src["color_id"] == color["id"]

    # Single move, sending back exactly what the balance row gave us.
    r = client.post("/api/stock/transfer", json={
        "item_id": item["id"], "from_location_id": src["location_id"], "to_location_id": locs["CLR-DST"],
        "qty": 2, "attribute_value_ids": src["attribute_value_ids"], "color_id": src["color_id"],
    }, headers=auth_headers)
    assert r.status_code == 201, r.text

    # Combined move of the rest.
    r = client.post("/api/stock/transfer/bulk", json={"to_location_id": locs["CLR-DST"], "lines": [{
        "item_id": item["id"], "from_location_id": src["location_id"], "qty": 3,
        "attribute_value_ids": src["attribute_value_ids"], "color_id": src["color_id"],
    }]}, headers=auth_headers)
    assert r.status_code == 201, r.text

    (dst,) = rows()
    assert dst["location_id"] == locs["CLR-DST"] and dst["qty"] == 5 and dst["color_id"] == color["id"]

    # Adjust to zero hits the same key — it failed "Current: 0.0" too.
    r = client.post("/api/stock", json={
        "item_code": item["code"], "location_code": "CLR-DST", "qty": -dst["qty"],
        "attribute_value_ids": dst["attribute_value_ids"], "color_id": dst["color_id"],
        "reference_type": "adjustment", "reference_id": "count",
    }, headers=auth_headers)
    assert r.status_code == 201, r.text
    assert rows() == []
