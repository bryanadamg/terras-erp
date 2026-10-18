"""Scanning an unsuggested carton books the carton's real qty.

The scan looked the carton up under an empty variant key, but cartons are minted
under their full key (shade / attributes) — a coloured carton read 0, its line was
dropped at dispatch (qty_picked > 0) and it never shipped.

Rows are committed through the sync session (async routes read another
connection); what the route writes lives in the client's savepoint.
"""
import uuid

import pytest


@pytest.fixture
def coloured_carton():
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch
    from app.models.color import Color
    from app.models.item import Item
    from app.models.location import Location
    from app.models.packing import PackingOrder
    from app.models.pick_list import PickList
    from app.models.sales import SalesOrder, SalesOrderLine
    from app.models.stock_balance import StockBalance

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    loc = Location(code=f"SCN-{tag}", name="FG", location_type="warehouse")
    item = Item(code=f"SCN-{tag}", name="Scan FG", uom="kg")
    color = Color(code=f"SCN-{tag}", name=f"SCN-{tag}")
    sess.add_all([loc, item, color])
    sess.flush()
    so = SalesOrder(po_number=f"SO-SCN-{tag}", customer_name="Scan Customer")
    po = PackingOrder(code=f"PCK-SCN-{tag}", item_id=item.id)
    sess.add_all([so, po])
    sess.flush()
    sol = SalesOrderLine(sales_order_id=so.id, item_id=item.id, qty=10)
    carton = Batch(batch_number=f"PU-SCN-{tag}", item_id=item.id, packing_order_id=po.id)
    pl = PickList(code=f"PL-SCN-{tag}", sales_order_id=so.id, status="DRAFT")
    sess.add_all([sol, carton, pl])
    sess.flush()
    sess.add(StockBalance(item_id=item.id, location_id=loc.id, variant_key=f"c:{color.id}",
                          batch_key=str(carton.id), qty=3))
    sess.commit()
    yield {"pl": str(pl.id), "code": carton.batch_number}

    sess.query(StockBalance).filter(StockBalance.item_id == item.id).delete(synchronize_session=False)
    sess.query(PickList).filter(PickList.id == pl.id).delete(synchronize_session=False)
    sess.query(Batch).filter(Batch.id == carton.id).delete(synchronize_session=False)
    sess.query(SalesOrderLine).filter(SalesOrderLine.id == sol.id).delete(synchronize_session=False)
    sess.query(PackingOrder).filter(PackingOrder.id == po.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.query(Color).filter(Color.id == color.id).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.query(Location).filter(Location.id == loc.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def test_unsuggested_coloured_carton_scans_with_its_qty(coloured_carton, client, auth_headers):
    r = client.post(f"/api/pick-lists/{coloured_carton['pl']}/scan",
                    json={"code": coloured_carton["code"]}, headers=auth_headers)
    assert r.status_code == 200, r.text
    (line,) = r.json()["lines"]
    assert line["qty_picked"] == 3
