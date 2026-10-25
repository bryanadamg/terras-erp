"""`GET /packing?search=` matches the list's columns (code, item, SO, customer)."""
import uuid

import pytest


@pytest.fixture
def packing_order():
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.item import Item
    from app.models.packing import PackingOrder
    from app.models.sales import SalesOrder

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    item = Item(code=f"FG-SRCH-{tag}", name=f"Search Fabric {tag}", uom="KG")
    so = SalesOrder(po_number=f"SO-PSRCH-{tag}", customer_name=f"Pack Cust {tag}")
    sess.add_all([item, so])
    sess.flush()
    po = PackingOrder(code=f"PCK-S{tag}", item_id=item.id, sales_order_id=so.id, qty_target=10)
    sess.add(po)
    sess.commit()
    yield {"tag": tag, "po": str(po.id)}

    sess.query(PackingOrder).filter(PackingOrder.id == po.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


@pytest.mark.parametrize("q", ["PCK-S{tag}", "fg-srch-{tag}", "Search Fabric {tag}", "SO-PSRCH-{tag}", "Pack Cust {tag}"])
def test_search_matches(client, auth_headers, packing_order, q):
    res = client.get("/api/packing", params={"search": q.format(tag=packing_order["tag"])}, headers=auth_headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert [r["id"] for r in body["items"]] == [packing_order["po"]]


def test_search_no_match(client, auth_headers, packing_order):
    res = client.get("/api/packing", params={"search": f"nope-{packing_order['tag']}"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["total"] == 0
