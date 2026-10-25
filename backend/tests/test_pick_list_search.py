"""`GET /pick-lists?search=` matches the register's columns (code, SO, customer)."""
import uuid

import pytest


@pytest.fixture
def pick_list():
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.pick_list import PickList
    from app.models.sales import SalesOrder

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    so = SalesOrder(po_number=f"SO-SRCH-{tag}", customer_name=f"Searchable Cust {tag}")
    sess.add(so)
    sess.flush()
    pl = PickList(code=f"PL-SRCH-{tag}", sales_order_id=so.id, status="DRAFT")
    sess.add(pl)
    sess.commit()
    yield {"tag": tag, "pl": str(pl.id)}

    sess.query(PickList).filter(PickList.id == pl.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


@pytest.mark.parametrize("q", ["PL-SRCH-{tag}", "so-srch-{tag}", "Searchable Cust {tag}"])
def test_search_matches(client, auth_headers, pick_list, q):
    res = client.get("/api/pick-lists", params={"search": q.format(tag=pick_list["tag"])}, headers=auth_headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert [r["id"] for r in body["items"]] == [pick_list["pl"]]


def test_search_no_match(client, auth_headers, pick_list):
    res = client.get("/api/pick-lists", params={"search": f"nope-{pick_list['tag']}"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["total"] == 0
