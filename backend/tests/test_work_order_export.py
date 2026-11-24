"""Work Orders "Export Excel": every step matching the filters, own grant."""


def test_work_order_export_needs_grant_and_returns_xlsx(user_factory, client, auth_headers):
    import io
    from openpyxl import load_workbook
    _, viewer = user_factory(["work_order.view"], "wo-viewer")
    assert client.get("/api/work-orders/export", headers=viewer).status_code == 403
    r = client.get("/api/work-orders/export", params={"tz": "Asia/Jakarta", "center_type": "WEAVING"}, headers=auth_headers)
    assert r.status_code == 200, r.text
    ws = load_workbook(io.BytesIO(r.content)).active
    assert ws["A1"].value == "WO Code" and ws["K1"].value == "Status"


def test_work_queue_serves_the_whole_queue_for_export(client, auth_headers):
    r = client.get("/api/work-queue", params={"page": 1, "size": 0}, headers=auth_headers)
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == r.json()["total"]
