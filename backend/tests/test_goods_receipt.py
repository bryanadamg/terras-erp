"""Goods receipts: per-line receiving warehouse."""
import uuid

import pytest


@pytest.fixture
def real_refs():
    """Supplier + two locations committed to the real DB: partners/locations are
    sync routes, invisible to the async session the purchase routes run in."""
    from app.db.session import engine
    from sqlalchemy.orm import Session as SASession
    from app.models.partner import Partner
    from app.models.location import Location
    sfx = uuid.uuid4().hex[:6].upper()
    conn = engine.connect()
    sess = SASession(conn)
    sup = Partner(name=f"GR Sup {sfx}", type="SUPPLIER", active=True)
    locs = [Location(code=f"GR{i}-{sfx}", name=f"GR{i}-{sfx}") for i in range(2)]
    sess.add_all([sup, *locs])
    sess.commit()
    ids = (str(sup.id), [str(l.id) for l in locs], sfx)
    yield ids
    for obj in (*locs, sup):
        sess.delete(obj)
    sess.commit()
    sess.close()
    conn.close()


def _seed_po(client, h, refs, n_lines=2):
    sup_id, loc_ids, sfx = refs
    client.post("/api/uoms", json={"name": "kg"}, headers=h)
    items = []
    for i in range(n_lines):
        r = client.post("/api/items", json={"code": f"GRI{i}-{sfx}", "name": f"GR item {i}", "uom": "kg"}, headers=h)
        assert r.status_code in (200, 201), r.text
        items.append(r.json())
    po = client.post("/api/purchase-orders", json={
        "po_number": f"PO-GR-{sfx}", "supplier_id": sup_id, "target_location_id": loc_ids[0],
        "lines": [{"item_id": it["id"], "qty": 10, "unit_price": 1} for it in items],
    }, headers=h)
    assert po.status_code == 200, po.text
    return po.json(), loc_ids, items


def _on_hand(client, h, item_id):
    rows = client.get("/api/stock/balance", headers=h).json()
    return {r["location_id"]: float(r["qty"]) for r in rows if r["item_id"] == item_id}


def test_receipt_line_can_go_to_its_own_warehouse(real_refs, client, auth_headers):
    po, locs, items = _seed_po(client, auth_headers, real_refs)
    l0, l1 = po["lines"]
    r = client.post(f"/api/purchase-orders/{po['id']}/receipts", json={
        "location_id": locs[0],
        "lines": [
            {"po_line_id": l0["id"], "qty_received": 4},
            {"po_line_id": l1["id"], "qty_received": 6, "location_id": locs[1]},
        ],
    }, headers=auth_headers)
    assert r.status_code == 200, r.text
    by_line = {ln["po_line_id"]: ln for ln in r.json()["lines"]}
    assert by_line[l0["id"]]["location_id"] is None
    assert by_line[l1["id"]]["location_id"] == locs[1]
    assert _on_hand(client, auth_headers, items[0]["id"]) == {locs[0]: 4}
    assert _on_hand(client, auth_headers, items[1]["id"]) == {locs[1]: 6}
