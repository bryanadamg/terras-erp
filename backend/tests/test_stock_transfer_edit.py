"""Stock transfers: an operator note that lands on the ledger."""
import uuid

from tests.test_goods_receipt import real_refs  # noqa: F401  (fixture)


def _seed_stock(client, h, loc_id, qty=10):
    sfx = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=h)
    item = client.post("/api/items", json={"code": f"TRN-{sfx}", "name": "Trn", "uom": "kg"}, headers=h).json()
    loc_code = next(l["code"] for l in client.get("/api/locations", headers=h).json() if l["id"] == loc_id)
    r = client.post("/api/stock", json={"item_code": item["code"], "location_code": loc_code, "qty": qty}, headers=h)
    assert r.status_code == 201, r.text
    return item


def _ledger(client, h, item):
    return client.get(f"/api/stock?search={item['code']}&reference_type=Transfer", headers=h).json()["items"]


def test_transfer_note_shows_on_both_ledger_legs(real_refs, client, auth_headers):
    _, (a, b), _ = real_refs
    item = _seed_stock(client, auth_headers, a)
    r = client.post("/api/stock/transfer", json={
        "item_id": item["id"], "from_location_id": a, "to_location_id": b, "qty": 3, "notes": " re-weigh ",
    }, headers=auth_headers)
    assert r.status_code == 201, r.text
    legs = _ledger(client, auth_headers, item)
    assert len(legs) == 2
    assert {e["notes"] for e in legs} == {"re-weigh"}
