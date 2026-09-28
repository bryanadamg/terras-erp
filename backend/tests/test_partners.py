import pytest


def test_partner_crud(client, auth_headers):
    customer_id = None
    supplier_id = None

    # 1. Create customer
    resp = client.post(
        "/api/partners",
        json={"name": "Test Customer PTEST", "type": "customer"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    customer = resp.json()
    assert "id" in customer
    assert customer["name"] == "Test Customer PTEST"
    assert customer["type"] == "customer"
    customer_id = customer["id"]

    # 2. Create supplier
    resp = client.post(
        "/api/partners",
        json={"name": "Test Supplier PTEST", "type": "supplier"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    supplier = resp.json()
    assert "id" in supplier
    supplier_id = supplier["id"]

    # 3. List all partners — both should appear (paginated envelope: unwrap "items")
    resp = client.get("/api/partners", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    partners = resp.json()["items"]
    names = [p["name"] for p in partners]
    assert "Test Customer PTEST" in names
    assert "Test Supplier PTEST" in names

    # 4. Filter by type=customer — customer appears, supplier does not
    resp = client.get("/api/partners?type=customer", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    filtered = resp.json()["items"]
    filtered_names = [p["name"] for p in filtered]
    assert "Test Customer PTEST" in filtered_names
    assert "Test Supplier PTEST" not in filtered_names

    # 4b. Lookup returns every partner as a bare list (no window, no envelope)
    resp = client.get("/api/partners/lookup", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    lookup = resp.json()
    assert isinstance(lookup, list)
    lookup_names = [p["name"] for p in lookup]
    assert "Test Customer PTEST" in lookup_names
    assert "Test Supplier PTEST" in lookup_names
    # Print modals read these off the shared index — they must survive the slim payload.
    for key in ("id", "name", "type", "active", "address", "contact_person", "phone", "fax", "email"):
        assert key in lookup[0], key

    # 4c. Update re-sends every field; only the changed one is applied
    resp = client.put(
        f"/api/partners/{customer_id}",
        json={"name": "Test Customer PTEST", "phone": "021 555", "active": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["phone"] == "021 555"

    # 5. Delete both
    resp = client.delete(f"/api/partners/{customer_id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text

    resp = client.delete(f"/api/partners/{supplier_id}", headers=auth_headers)
    assert resp.status_code == 200, resp.text
