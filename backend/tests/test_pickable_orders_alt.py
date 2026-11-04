"""Pick readiness board: outstanding restated in the SO's selling unit.

Picked is the carton's counted `Batch.alt_qty`, never kilos / factor. The order
total only sums lines sharing one alt unit — Pcs + Pic never add.
"""
import uuid

import pytest


@pytest.fixture
def orders():
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch
    from app.models.item import Item
    from app.models.pick_list import PickList, PickListLine
    from app.models.sales import SalesOrder, SalesOrderLine

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    item = Item(code=f"FG-ALT-{tag}", name="Alt FG", uom="KG")
    sess.add(item)
    sess.flush()

    # One Pic line, 4 of 10 Pic already picked in a 40 kg carton.
    so = SalesOrder(po_number=f"SO-ALT-{tag}", customer_name="Alt Customer")
    # Same item ordered in Pic and Pcs — no single unit for the total.
    mixed = SalesOrder(po_number=f"SO-MIX-{tag}", customer_name="Alt Customer")
    sess.add_all([so, mixed])
    sess.flush()
    sol = SalesOrderLine(sales_order_id=so.id, item_id=item.id, qty=100, qty_kg=100, qty2=10, uom2="Pic")
    sess.add_all([
        sol,
        SalesOrderLine(sales_order_id=mixed.id, item_id=item.id, qty=50, qty_kg=50, qty2=5, uom2="Pic"),
        SalesOrderLine(sales_order_id=mixed.id, item_id=item.id, qty=50, qty_kg=50, qty2=20, uom2="Pcs"),
    ])
    batch = Batch(batch_number=f"PU-ALT-{tag}", item_id=item.id, alt_qty=4)
    sess.add(batch)
    sess.flush()
    pl = PickList(code=f"PL-ALT-{tag}", sales_order_id=so.id, status="DRAFT")
    sess.add(pl)
    sess.flush()
    sess.add(PickListLine(pick_list_id=pl.id, sales_order_line_id=sol.id, item_id=item.id,
                          qty_picked=40, batch_id=batch.id))
    sess.commit()
    yield {"so": so.po_number, "mixed": mixed.po_number}

    sess.query(PickListLine).filter(PickListLine.pick_list_id == pl.id).delete(synchronize_session=False)
    sess.query(PickList).filter(PickList.id == pl.id).delete(synchronize_session=False)
    sess.query(Batch).filter(Batch.id == batch.id).delete(synchronize_session=False)
    sess.query(SalesOrderLine).filter(SalesOrderLine.sales_order_id.in_([so.id, mixed.id])).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id.in_([so.id, mixed.id])).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def test_outstanding_in_selling_unit(client, auth_headers, orders):
    r = client.get("/api/pick-lists/pickable-orders", headers=auth_headers)
    assert r.status_code == 200, r.text
    rows = {o["po_number"]: o for o in r.json()}

    so = rows[orders["so"]]
    assert (so["qty_outstanding"], so["qty_outstanding_alt"], so["outstanding_alt_uom"]) == (60, 6, "Pic")
    assert [(l["qty_outstanding_alt"], l["alt_uom"]) for l in so["lines"]] == [(6, "Pic")]

    mixed = rows[orders["mixed"]]
    assert (mixed["qty_outstanding_alt"], mixed["outstanding_alt_uom"]) == (None, None)
    assert sorted((l["qty_outstanding_alt"], l["alt_uom"]) for l in mixed["lines"]) == [(5, "Pic"), (20, "Pcs")]
