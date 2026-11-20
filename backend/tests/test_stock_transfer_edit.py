"""Stock transfers: an operator note on the ledger, and reversing a wrong move."""
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


def _on_hand(client, h, item_id):
    rows = client.get("/api/stock/balance", headers=h).json()
    return {r["location_id"]: float(r["qty"]) for r in rows if r["item_id"] == item_id and float(r["qty"])}


def test_reverse_transfer_puts_the_stock_back_once(real_refs, client, auth_headers):
    _, (a, b), _ = real_refs
    item = _seed_stock(client, auth_headers, a)
    client.post("/api/stock/transfer", json={
        "item_id": item["id"], "from_location_id": a, "to_location_id": b, "qty": 3,
    }, headers=auth_headers)
    assert _on_hand(client, auth_headers, item["id"]) == {a: 7, b: 3}
    group = _ledger(client, auth_headers, item)[0]["transfer_group_id"]
    assert group

    r = client.post(f"/api/stock/transfer/{group}/reverse", headers=auth_headers)
    assert r.status_code == 201, r.text
    assert _on_hand(client, auth_headers, item["id"]) == {a: 10}
    assert all(e["reversed"] for e in _ledger(client, auth_headers, item))
    assert client.post(f"/api/stock/transfer/{group}/reverse", headers=auth_headers).status_code == 400


def test_reverse_refused_when_moved_stock_was_used(real_refs, client, auth_headers):
    _, (a, b), _ = real_refs
    item = _seed_stock(client, auth_headers, a)
    client.post("/api/stock/transfer", json={
        "item_id": item["id"], "from_location_id": a, "to_location_id": b, "qty": 3,
    }, headers=auth_headers)
    group = _ledger(client, auth_headers, item)[0]["transfer_group_id"]
    client.post("/api/stock/transfer", json={
        "item_id": item["id"], "from_location_id": b, "to_location_id": a, "qty": 2,
    }, headers=auth_headers)
    assert client.post(f"/api/stock/transfer/{group}/reverse", headers=auth_headers).status_code == 400
