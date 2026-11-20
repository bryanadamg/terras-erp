"""Sales Orders "Export Excel": one row per order line, own grant."""
import io


def test_sales_order_export_needs_grant_and_returns_xlsx(user_factory, client, auth_headers):
    from openpyxl import load_workbook
    _, viewer = user_factory(["sales_order.view"], "so-viewer")
    assert client.get("/api/sales-orders/export", headers=viewer).status_code == 403
    r = client.get("/api/sales-orders/export", params={"tz": "Asia/Jakarta"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    assert ws["B1"].value == "SO Number" and ws["K1"].value == "Qty (Yd)"
