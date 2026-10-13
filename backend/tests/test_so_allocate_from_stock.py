"""SO-level "Allocate from stock": pin named packed cartons to an order line.

Pins the rules that make it safe: only unclaimed cartons packed to stock are
offered, a pinned carton is invisible to other orders' allocation and pick
lists, the last carton may overshoot what's needed but one more may not, and a
line covered by its pinned cartons reads READY without a packing order.
"""
import uuid


def _seed(client, auth_headers, async_db_session, carton_qtys, packed_for_so=None):
    """An item with one packed carton per qty, packed to stock unless `packed_for_so`."""
    from app.models.batch import Batch
    from app.models.location import Location
    from app.models.packing import PackingOrder
    from app.models.stock_balance import StockBalance

    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={
        "code": f"ALLOC-{uuid.uuid4().hex[:6]}", "name": "Alloc FG", "uom": "pcs",
    }, headers=auth_headers).json()
    ids = []

    async def seed():
        loc = Location(code=f"ALLOC-{uuid.uuid4().hex[:6]}", name="Alloc loc")
        po = PackingOrder(code=f"PCK-{uuid.uuid4().hex[:6]}", item_id=item["id"], sales_order_id=packed_for_so)
        async_db_session.add_all([loc, po])
        await async_db_session.flush()
        for n, qty in enumerate(carton_qtys, 1):
            b = Batch(batch_number=f"PU-{uuid.uuid4().hex[:8]}", item_id=item["id"],
                      packing_order_id=po.id, package_no=n)
            async_db_session.add(b)
            await async_db_session.flush()
            async_db_session.add(StockBalance(
                item_id=item["id"], location_id=loc.id, variant_key="", batch_key=str(b.id), qty=qty,
            ))
            ids.append(str(b.id))
        await async_db_session.commit()

    client.portal.call(seed)
    return item, ids


def _so(client, auth_headers, item, qty):
    return client.post("/api/sales-orders", json={
        "po_number": f"PO-AL-{uuid.uuid4().hex[:6]}", "customer_name": "Acme",
        "order_date": "2026-02-04T00:00:00",
        "lines": [{"item_id": item["id"], "qty": qty, "due_date": "2026-03-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers).json()


def _allocate(client, auth_headers, so, batch_ids):
    return client.post(f"/api/sales-orders/{so['id']}/allocate", json={
        "lines": [{"sales_order_line_id": so["lines"][0]["id"], "batch_ids": batch_ids}],
    }, headers=auth_headers)


def _offered(client, auth_headers, so):
    [a] = client.get(f"/api/sales-orders/{so['id']}/allocation", headers=auth_headers).json()
    return a


def test_pinned_carton_is_claimed_until_released(client, auth_headers, async_db_session):
    item, (a, b) = _seed(client, auth_headers, async_db_session, [20, 20])
    so = _so(client, auth_headers, item, 30)

    line = _offered(client, auth_headers, so)
    assert line["needed"] == 30 and {c["batch_id"] for c in line["cartons"]} == {a, b}

    r = _allocate(client, auth_headers, so, [a])
    assert r.status_code == 200, r.text
    [line] = r.json()
    assert (line["allocated"], line["needed"]) == (20, 10)
    assert [c["batch_id"] for c in line["allocated_cartons"]] == [a]
    assert [c["batch_id"] for c in line["cartons"]] == [b]

    # Another order neither sees it to allocate nor can put it on a pick list.
    other = _so(client, auth_headers, item, 10)
    assert [c["batch_id"] for c in _offered(client, auth_headers, other)["cartons"]] == [b]
    assert _allocate(client, auth_headers, other, [a]).status_code == 409
    r = client.post("/api/pick-lists", json={"sales_order_id": other["id"], "lines": [{
        "sales_order_line_id": other["lines"][0]["id"], "item_id": item["id"], "qty_picked": 20, "batch_id": a,
    }]}, headers=auth_headers)
    assert r.status_code == 400 and "Allocated to another order" in r.json()["detail"]

    # The carton number rides the reservation, and releasing frees the box.
    [res] = client.get(f"/api/sales-orders/{so['id']}/reservations", headers=auth_headers).json()["reservations"]
    assert res["batch_id"] == a and res["batch_number"]
    client.post(f"/api/sales-orders/{so['id']}/reservations/{res['id']}/release", headers=auth_headers)
    assert {c["batch_id"] for c in _offered(client, auth_headers, other)["cartons"]} == {a, b}


def test_last_carton_may_overshoot_but_one_more_may_not(client, auth_headers, async_db_session):
    item, (a, b) = _seed(client, auth_headers, async_db_session, [20, 20])
    so = _so(client, auth_headers, item, 15)
    r = _allocate(client, auth_headers, so, [a, b])
    assert r.status_code == 400 and "still needed" in r.json()["detail"]
    assert _allocate(client, auth_headers, so, [a]).status_code == 200


def test_cartons_packed_for_an_open_order_are_not_offered(client, auth_headers, async_db_session):
    owner = _so(client, auth_headers, client.post("/api/items", json={
        "code": f"OWN-{uuid.uuid4().hex[:6]}", "name": "x", "uom": "pcs"}, headers=auth_headers).json(), 1)
    item, _ = _seed(client, auth_headers, async_db_session, [20], packed_for_so=owner["id"])
    so = _so(client, auth_headers, item, 20)
    assert _offered(client, auth_headers, so)["cartons"] == []


def test_order_covered_by_pinned_cartons_is_ready(client, auth_headers, async_db_session):
    item, (a, b) = _seed(client, auth_headers, async_db_session, [25, 25])
    so = _so(client, auth_headers, item, 50)
    assert so["status"] == "PENDING"

    assert _allocate(client, auth_headers, so, [a, b]).status_code == 200

    got = client.get(f"/api/sales-orders/{so['id']}", headers=auth_headers).json()
    assert got["lines"][0]["qty_packed_available"] == 50
    assert got["lines"][0]["qty_allocated"] == 50
    assert got["status"] == "READY"
