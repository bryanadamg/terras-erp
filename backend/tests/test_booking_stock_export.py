"""Booking Stock: category filter and Excel export over the cached netting rows."""
import io
import uuid

import pytest


@pytest.fixture
def booking_rows(client, auth_headers, monkeypatch):
    from app.api import stock as stock_api
    # A STOCK_UPDATE from a parallel xdist worker (via Redis) marks the cache stale and the
    # background refresh would swap these pinned rows for real-DB rows mid-test.
    monkeypatch.setattr(stock_api, "_spawn_booking_refresh", lambda: None)
    from app.schemas import BookingStockRow
    sfx = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    cats = [client.post("/api/categories", json={"name": f"BK{i}-{sfx}"}, headers=auth_headers).json() for i in range(2)]
    items = [client.post("/api/items", json={"code": f"BK{i}-{sfx}", "name": f"Bk {i}", "uom": "kg", "category_id": c["id"]},
                         headers=auth_headers).json() for i, c in enumerate(cats)]
    rows = [BookingStockRow(item_id=it["id"], item_code=it["code"], item_name=it["name"], uom="kg", attribute_value_ids=[],
                            qty_on_hand=5, qty_required=8, qty_incoming=0, qty_net_free=-3, demand_mos=[], supply_mos=[])
            for it in items]
    saved = dict(stock_api._booking_cache)
    stock_api._booking_cache.update(rows=rows, stale=False, at=float("inf"))
    yield cats, items, sfx
    stock_api._booking_cache.clear()
    stock_api._booking_cache.update(saved)


def test_booking_stock_filters_by_category_and_exports(booking_rows, client, auth_headers):
    from openpyxl import load_workbook
    cats, items, sfx = booking_rows
    r = client.get("/api/stock/availability", params={"category_id": cats[1]["id"]}, headers=auth_headers).json()
    assert [(x["item_code"], x["category_name"]) for x in r["items"]] == [(items[1]["code"], cats[1]["name"])]

    x = client.get("/api/stock/availability/export", params={"search": sfx}, headers=auth_headers)
    assert x.status_code == 200, x.text
    ws = load_workbook(io.BytesIO(x.content)).active
    assert ws["A1"].value == "Item Code"
    assert sorted(ws.cell(row=i, column=1).value for i in (2, 3)) == sorted(it["code"] for it in items)
