"""The sales order list search also matches the code or name of an item on its lines."""
import uuid


def test_sales_order_search_matches_line_item(client, auth_headers):
    tag = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"SOS-{tag}", "name": f"Jacquard {tag}", "uom": "pcs", "category": "Product",
    }, headers=auth_headers).json()
    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-SOS-{tag}", "customer_name": "Acme", "order_date": "2026-02-04T00:00:00",
        "lines": [{"item_id": item["id"], "qty": 5, "due_date": "2026-03-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers).json()

    for term in (f"SOS-{tag}", f"jacquard {tag}"):
        ids = [o["id"] for o in client.get(f"/api/sales-orders?search={term}", headers=auth_headers).json()["items"]]
        assert ids == [so["id"]], term
