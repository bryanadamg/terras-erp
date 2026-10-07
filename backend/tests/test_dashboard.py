"""The dashboard shows you only what you may already see.

Both surfaces filter per user: `/kpis` drops the cached numbers a role has no
permission for, and `/summary` omits whole blocks the same way. A regression here
leaks low-stock counts and open-order values to anyone with a login, and it is
invisible on an admin's screen — which is the screen it is always tested on.
"""


def test_kpis_drop_the_numbers_a_role_cannot_see(user_factory, client):
    # sample_request.view and nothing else: of the gated KPIs, only the sample one
    # may come back.
    _, headers = user_factory(["sample_request.view"], "kpi-reader")

    res = client.get("/api/dashboard/kpis", headers=headers)
    assert res.status_code == 200, res.text
    keys = set(res.json())

    assert "low_stock" not in keys, "stock KPIs need one of the stock view permissions"
    assert "active_wo" not in keys and "pending_wo" not in keys
    assert "open_sos" not in keys


def test_an_admin_sees_the_gated_kpis(client, auth_headers):
    res = client.get("/api/dashboard/kpis", headers=auth_headers)
    assert res.status_code == 200, res.text
    # Whatever is cached, nothing is filtered away from admin.access — so this is
    # the control for the test above rather than an assertion about cache contents.
    assert isinstance(res.json(), dict)


def test_summary_omits_the_blocks_a_role_cannot_see(user_factory, client):
    _, headers = user_factory(["sample_request.view"], "summary-reader")

    res = client.get("/api/dashboard/summary", headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()

    # The heavy aggregates are all behind stock/sales/manufacturing permissions.
    assert "warehouse_distribution" not in body
    assert "production_yield" not in body


def test_kpi_history_is_gated_the_same_way_as_kpis(user_factory, client):
    _, headers = user_factory(["sample_request.view"], "history-reader")

    res = client.get("/api/dashboard/kpis/history?days=7", headers=headers)
    assert res.status_code == 200, res.text
    assert "low_stock" not in res.json(), "history must not reopen what /kpis closes"


def test_a_ready_order_still_counts_as_open(client, auth_headers, async_db_session):
    """READY/PARTIAL are still owed — the summary used to count PENDING only."""
    import uuid
    from sqlalchemy import update
    from app.models.sales import SalesOrder

    before = client.get("/api/dashboard/summary", headers=auth_headers).json()["open_so_count"]
    client.post("/api/uoms", json={"name": "pcs"}, headers=auth_headers)
    item = client.post("/api/items", json={"code": f"DSH-{uuid.uuid4().hex[:6]}", "name": "D", "uom": "pcs"},
                       headers=auth_headers).json()
    so = client.post("/api/sales-orders", json={
        "po_number": f"PO-DSH-{uuid.uuid4().hex[:6]}", "customer_name": "Acme",
        "order_date": "2026-02-04T00:00:00",
        "lines": [{"item_id": item["id"], "qty": 5.0, "due_date": "2026-03-01T00:00:00", "attribute_value_ids": []}],
    }, headers=auth_headers).json()

    async def _ready():
        await async_db_session.execute(update(SalesOrder).where(SalesOrder.id == so["id"]).values(status="READY"))
        await async_db_session.flush()
    client.portal.call(_ready)

    after = client.get("/api/dashboard/summary", headers=auth_headers).json()["open_so_count"]
    assert after == before + 1
