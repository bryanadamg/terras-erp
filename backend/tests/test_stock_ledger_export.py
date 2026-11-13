"""Stock Ledger "Export Excel": the whole filtered set, local times, own grant."""
import io
import uuid

from tests.test_stock_lot_spill import _seed_location


def test_ledger_export_is_the_filtered_set_in_local_time(user_factory, client, auth_headers):
    from openpyxl import load_workbook
    suffix = uuid.uuid4().hex[:6].upper()
    client.post("/api/uoms", json={"name": "kg"}, headers=auth_headers)
    _seed_location(f"LGX-{suffix}")
    item = client.post("/api/items", json={"code": f"LGX-{suffix}", "name": "Lgx", "uom": "kg"}, headers=auth_headers).json()
    for qty in (5, -2):
        r = client.post("/api/stock", json={"item_code": item["code"], "location_code": f"LGX-{suffix}", "qty": qty}, headers=auth_headers)
        assert r.status_code == 201, r.text

    _, viewer = user_factory(["stock_ledger.view"], "ledger-viewer")
    assert client.get("/api/stock/ledger/export", params={"search": item["code"]}, headers=viewer).status_code == 403

    page = client.get("/api/stock", params={"search": item["code"]}, headers=auth_headers).json()["items"]
    r = client.get("/api/stock/ledger/export", params={"search": item["code"], "tz": "Asia/Jakarta"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = list(load_workbook(io.BytesIO(r.content)).active.iter_rows(values_only=True))
    assert rows[0][:3] == ("Date", "Item Code", "Item Name")
    body = [row for row in rows[1:] if row and row[1] == item["code"]]
    assert sorted(row[12] for row in body) == [-2, 5]
    assert rows[-1] == ("Total In", 5, "Total Out", -2) + (None,) * (len(rows[-1]) - 4)

    # UTC+7: the file reads 7 hours ahead of the stored naive-UTC stamp.
    from datetime import datetime
    newest = page[0]
    row = next(r for r in body if r[12] == newest["qty_change"])
    assert abs((row[0] - datetime.fromisoformat(newest["created_at"])).total_seconds() - 7 * 3600) < 1

    assert client.get("/api/stock/ledger/export", params={"tz": "Mars/Base"}, headers=auth_headers).status_code == 400
