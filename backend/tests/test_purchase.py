import uuid


def test_purchase_order_crud(client, auth_headers):
    """
    PO creation and all prerequisites (partner, location, item) use async routes
    that go through get_async_db — invisible to the rollback-fixture session.
    We therefore insert partner, location, and item directly into the real DB
    so the async route can find them via FK lookups.
    """
    from app.db.session import engine
    from sqlalchemy.orm import Session as SASession
    from app.models.partner import Partner
    from app.models.location import Location
    from app.models.item import Item

    unique_suffix = uuid.uuid4().hex[:8]
    po_number = f"PO-TEST-{unique_suffix}"

    real_conn = engine.connect()
    real_session = SASession(real_conn)

    po_id = None
    supplier = None
    location = None
    item = None

    try:
        # 1. Insert supplier, location, and item directly into real DB
        supplier = Partner(name=f"PO-Supplier-{unique_suffix}", type="supplier", active=True)
        location = Location(code=f"PO-WH-{unique_suffix}", name=f"PO WH {unique_suffix}")
        item = Item(code=f"PO-ITEM-{unique_suffix}", name="PO Test Item", uom="pcs")
        real_session.add_all([supplier, location, item])
        real_session.commit()
        for obj in (supplier, location, item):
            real_session.refresh(obj)

        supplier_id = str(supplier.id)
        location_id = str(location.id)
        item_id = str(item.id)

        # 2. Create purchase order (async route — can now resolve FK references)
        resp = client.post(
            "/api/purchase-orders",
            json={
                "po_number": po_number,
                "supplier_id": supplier_id,
                "target_location_id": location_id,
                "order_date": "2026-03-16T00:00:00",
                "prices_include_vat": True,
                "lines": [
                    {
                        "item_id": item_id,
                        "qty": 10.0,
                        "unit_price": 5.0,
                        "due_date": "2026-04-01T00:00:00",
                        "attribute_value_ids": [],
                    }
                ],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        po_data = resp.json()
        assert "id" in po_data
        assert po_data["po_number"] == po_number
        assert po_data["prices_include_vat"] is True
        assert "status" in po_data
        assert len(po_data["lines"]) >= 1
        po_id = po_data["id"]

        # 3. GET /api/purchase-orders — our PO should appear
        resp = client.get("/api/purchase-orders", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        # Paginated envelope, not a bare list — iterating the response dict yields
        # its key strings, so `po["po_number"]` raised TypeError.
        po_numbers = [po["po_number"] for po in resp.json()["items"]]
        assert po_number in po_numbers

        # 4. DELETE the purchase order
        resp = client.delete(f"/api/purchase-orders/{po_id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        po_id = None

    finally:
        # Delete PO if not already deleted (async route — real DB)
        if po_id is not None:
            try:
                client.delete(f"/api/purchase-orders/{po_id}", headers=auth_headers)
            except Exception:
                pass

        # Delete supplier, location, item from real DB
        try:
            if item:
                real_session.query(Item).filter(Item.id == item.id).delete(
                    synchronize_session=False
                )
            if supplier:
                real_session.query(Partner).filter(Partner.id == supplier.id).delete(
                    synchronize_session=False
                )
            if location:
                real_session.query(Location).filter(Location.id == location.id).delete(
                    synchronize_session=False
                )
            real_session.commit()
        except Exception:
            real_session.rollback()
        finally:
            real_session.close()
            real_conn.close()
