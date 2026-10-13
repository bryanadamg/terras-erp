"""SO-level "Allocate from stock": reserve on-hand FG to an order line, no PR.

Pins the rules that make it safe: you can't allocate more than is free or more
than the line still needs, an allocation is a claim other orders' allocations
(and PR netting) see, and a line covered by cartons packed to stock reads READY.
"""
import uuid


def _seed(client, auth_headers, async_db_session, stock_qty, carton=False):
    from app.models.batch import Batch
    from app.models.location import Location
    from app.models.packing import PackingOrder
    from app.models.stock_balance import StockBalance

    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"ALLOC-{uuid.uuid4().hex[:6]}", "name": "Alloc FG", "uom": "pcs",
    }, headers=auth_headers).json()

    async def seed():
        loc = Location(code=f"ALLOC-{uuid.uuid4().hex[:6]}", name="Alloc loc")
        async_db_session.add(loc)
        await async_db_session.flush()
        batch_key = ""
        if carton:
            # A carton packed to stock: packing order with no SO tag.
            po = PackingOrder(code=f"PCK-{uuid.uuid4().hex[:6]}", item_id=item["id"])
            async_db_session.add(po)
            await async_db_session.flush()
            b = Batch(batch_number=f"PU-{uuid.uuid4().hex[:8]}", item_id=item["id"], packing_order_id=po.id)
            async_db_session.add(b)
            await async_db_session.flush()
            batch_key = str(b.id)
        async_db_session.add(StockBalance(
            item_id=item["id"], location_id=loc.id, variant_key="", batch_key=batch_key, qty=stock_qty,
        ))
        await async_db_session.commit()

    client.portal.call(seed)
    return item


def _so(client, auth_headers, item, qty):
    return client.post("/api/sales-orders", json={
        "po_number": f"PO-AL-{uuid.uuid4().hex[:6]}", "customer_name": "Acme",
        "order_date": "2026-02-04T00:00:00",
        "lines": [{"item_id": item["id"], "qty": qty, "due_date": "2026-03-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers).json()


def test_allocate_caps_at_free_and_needed_and_blocks_other_orders(client, auth_headers, async_db_session):
    item = _seed(client, auth_headers, async_db_session, stock_qty=30)
    so = _so(client, auth_headers, item, 50)
    line_id = so["lines"][0]["id"]
    url = f"/api/sales-orders/{so['id']}"

    [a] = client.get(f"{url}/allocation", headers=auth_headers).json()
    assert (a["needed"], a["free"], a["suggested"]) == (50, 30, 30)

    r = client.post(f"{url}/allocate", json={"lines": [{"sales_order_line_id": line_id, "qty": 40}]}, headers=auth_headers)
    assert r.status_code == 400 and "free in stock" in r.json()["detail"]

    r = client.post(f"{url}/allocate", json={"lines": [{"sales_order_line_id": line_id, "qty": 30}]}, headers=auth_headers)
    assert r.status_code == 200, r.text
    [a] = r.json()
    assert (a["allocated"], a["needed"], a["free"]) == (30, 20, 0)

    # The line carries it, so the SO page can subtract it when seeding a PR.
    got = client.get(url, headers=auth_headers).json()
    assert got["lines"][0]["qty_allocated"] == 30

    # A second order for the same item sees nothing left.
    other = _so(client, auth_headers, item, 10)
    [b] = client.get(f"/api/sales-orders/{other['id']}/allocation", headers=auth_headers).json()
    assert b["free"] == 0

    # Releasing hands it back.
    [res] = client.get(f"{url}/reservations", headers=auth_headers).json()["reservations"]
    assert res["sales_order_line_id"] == line_id and res["production_run_id"] is None
    client.post(f"{url}/reservations/{res['id']}/release", headers=auth_headers)
    [b] = client.get(f"/api/sales-orders/{other['id']}/allocation", headers=auth_headers).json()
    assert b["free"] == 30


def test_allocation_over_packed_stock_cartons_makes_the_order_ready(client, auth_headers, async_db_session):
    item = _seed(client, auth_headers, async_db_session, stock_qty=50, carton=True)
    so = _so(client, auth_headers, item, 50)
    assert so["status"] == "PENDING"

    r = client.post(f"/api/sales-orders/{so['id']}/allocate",
                    json={"lines": [{"sales_order_line_id": so["lines"][0]["id"], "qty": 50}]},
                    headers=auth_headers)
    assert r.status_code == 200, r.text

    got = client.get(f"/api/sales-orders/{so['id']}", headers=auth_headers).json()
    assert got["lines"][0]["qty_packed_available"] == 50
    assert got["status"] == "READY"
