"""Pick Cartons on a line whose BOM carries several sizes.

SO-2026-11-00003 on prod: the suggest endpoint read each BOM size's name to
measure the line, the Size rows weren't loaded, and the lazy load 500'd on the
async session — the modal showed "Nothing packed" with two cartons allocated.
"""
import uuid


def test_suggest_survives_a_multi_size_bom(client, auth_headers, async_db_session):
    tag = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    for code in (f"SGB-FG-{tag}", f"SGB-RM-{tag}"):
        client.post("/api/items", json={"code": code, "name": code, "uom": "kg"}, headers=auth_headers)
    sizes = client.get("/api/sizes", headers=auth_headers).json()
    assert len(sizes) >= 2, "needs two seeded sizes"
    other, ordered = sizes[0], sizes[1]

    bom = client.post("/api/boms", json={
        "code": f"BOM-SGB-{tag}", "item_code": f"SGB-FG-{tag}", "qty": 1,
        "lines": [{"item_code": f"SGB-RM-{tag}", "qty": 1, "percentage": 100.0}],
        "sizes": [{"size_id": other["id"], "target_measurement": 77},
                  {"size_id": ordered["id"], "target_measurement": 72}],
    }, headers=auth_headers)
    assert bom.status_code == 200, bom.text
    bom = bom.json()

    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-SGB-{tag}", "customer_name": "Sized BOM",
        "order_date": "2026-11-18T00:00:00",
        "lines": [{"item_id": bom["item_id"], "qty": 10, "qty_kg": 10, "bom_id": bom["id"], "size_id": ordered["id"],
                   "due_date": "2026-12-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers)
    assert so.status_code == 200, so.text

    # Tests share one session across requests, so the Size rows the setup loaded
    # would still be in its identity map; a real request starts cold.
    async def cold():
        async_db_session.expunge_all()
    client.portal.call(cold)

    r = client.get(f"/api/pick-lists/suggest?sales_order_id={so.json()['id']}", headers=auth_headers)
    assert r.status_code == 200, r.text
