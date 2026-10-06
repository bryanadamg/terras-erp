import pytest

def test_sales_order_crud(client, auth_headers):
    # Setup: Create an item
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": "SO-ITEM", "name": "SO Item", "uom": "pcs", "category": "Product"
    }, headers=auth_headers).json()

    # 1. Create Sales Order (Customer PO)
    so_payload = {
        "po_number": "PO-12345",
        "customer_name": "Acme Corp",
        "order_date": "2026-02-04T00:00:00",
        "lines": [
            {
                "item_id": item["id"],
                "qty": 50.0,
                "due_date": "2026-03-01T00:00:00",
                "attribute_value_ids": []
            }
        ]
    }
    res = client.post("/api/sales-orders", json=so_payload, headers=auth_headers)
    assert res.status_code == 200
    so = res.json()
    assert so["po_number"] == "PO-12345"
    assert len(so["lines"]) == 1

    # 2. Get List
    res_list = client.get("/api/sales-orders", headers=auth_headers)
    # Paginated envelope, not a bare list — iterating the response dict yields its
    # key strings, so `o["id"]` raised TypeError.
    orders = res_list.json()["items"]
    assert any(o["id"] == so["id"] for o in orders)

    # 3. Delete
    del_res = client.delete(f"/api/sales-orders/{so['id']}", headers=auth_headers)
    assert del_res.status_code == 200


def test_derived_statuses_cannot_be_forced(client, auth_headers):
    """Only DELIVERED/CANCELLED are set by hand; asking for any other status re-derives it."""
    import uuid
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"SOST-{uuid.uuid4().hex[:6]}", "name": "S", "uom": "pcs"},
                       headers=auth_headers).json()
    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-ST-{uuid.uuid4().hex[:6]}", "customer_name": "Acme",
        "order_date": "2026-02-04T00:00:00",
        "lines": [{"item_id": item["id"], "qty": 5.0, "due_date": "2026-03-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers).json()
    url = f"/api/sales-orders/{so['id']}/status"

    # Nothing packed or dispatched: SENT would skip the shipment's goods issue.
    r = client.put(f"{url}?status=SENT", headers=auth_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "PENDING"

    assert client.put(f"{url}?status=CANCELLED", headers=auth_headers).json()["status"] == "CANCELLED"
    # Re-deriving is how a cancelled order reopens.
    assert client.put(f"{url}?status=PENDING", headers=auth_headers).json()["status"] == "PENDING"
