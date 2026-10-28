"""The sales order list shows the SHP- codes that carried it — dispatched ones only.

Rows are committed through a real connection (the async list route can't see an
uncommitted savepoint), so the fixture cleans up after itself.
"""
import uuid


def test_so_list_shows_dispatched_shipment_codes(client, auth_headers):
    from app.db.session import engine
    from sqlalchemy.orm import Session
    from app.models.pick_list import PickList
    from app.models.sales import SalesOrder
    from app.models.shipment import Shipment

    tag = uuid.uuid4().hex[:6]
    conn = engine.connect()
    sess = Session(conn)
    so = SalesOrder(po_number=f"SO-SHP-{tag}", customer_name="Ship Customer")
    sent = Shipment(code=f"SHP-T{tag}", status="DISPATCHED")
    draft = Shipment(code=f"SHP-D{tag}", status="DRAFT")
    sess.add_all([so, sent, draft])
    sess.flush()
    # Two pick lists on the same shipment must still show its code once.
    pls = [
        PickList(code=f"PL-SHP-{tag}-{i}", sales_order_id=so.id, status=st, shipment_id=shp.id)
        for i, (st, shp) in enumerate([("DISPATCHED", sent), ("DISPATCHED", sent), ("PICKED", draft)])
    ]
    sess.add_all(pls)
    sess.commit()
    try:
        res = client.get(f"/api/sales-orders?search=SO-SHP-{tag}", headers=auth_headers)
        assert res.status_code == 200, res.text
        row = next(o for o in res.json()["items"] if o["id"] == str(so.id))
        assert row["shipments"] == [f"SHP-T{tag}"]
    finally:
        sess.query(PickList).filter(PickList.id.in_([p.id for p in pls])).delete(synchronize_session=False)
        sess.query(Shipment).filter(Shipment.id.in_([sent.id, draft.id])).delete(synchronize_session=False)
        sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
        sess.commit()
        sess.close()
        conn.close()
