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


@pytest.fixture
def pic_line_with_older_gross_cartons():
    """SO-2026-11-00001's shape: 6 Pic @ 36 yd ordered; two older Gross cartons
    alone cover its kilos, the three Pic cartons packed for it are newer."""
    from datetime import datetime
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch
    from app.models.item import Item
    from app.models.location import Location
    from app.models.packing import PackingOrder
    from app.models.sales import SalesOrder, SalesOrderLine
    from app.models.stock_balance import StockBalance

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    item = Item(code=f"FG-PIC-{tag}", name="Pic FG", uom="KG")
    loc = Location(code=f"FG-{tag}", name="FG")
    sess.add_all([item, loc])
    sess.flush()
    gross = PackingOrder(code=f"PCK-G-{tag}", item_id=item.id, uom2="Gross", uom2_factor=144, uom2_length_uom="yard")
    pic = PackingOrder(code=f"PCK-P-{tag}", item_id=item.id, uom2="Pic", uom2_factor=36, uom2_length_uom="yard")
    so = SalesOrder(po_number=f"SO-PIC-{tag}", customer_name="Pic Customer")
    sess.add_all([gross, pic, so])
    sess.flush()
    sess.add(SalesOrderLine(sales_order_id=so.id, item_id=item.id, qty=216, qty_kg=38.88,
                            qty2=6, uom2="Pic", uom2_factor=36))
    cartons = [(gross, 26.64, 1, datetime(2026, 10, 28)), (gross, 15, 0.08, datetime(2026, 10, 28, 0, 1))] + \
              [(pic, 13.32, 2, datetime(2026, 11, 4, 0, n)) for n in range(3)]
    batches = []
    for n, (po, kg, alt, at) in enumerate(cartons, 1):
        b = Batch(batch_number=f"PU-{tag}-{n}", item_id=item.id, packing_order_id=po.id,
                  package_no=n, alt_qty=alt, created_at=at)
        sess.add(b)
        sess.flush()
        sess.add(StockBalance(item_id=item.id, location_id=loc.id, variant_key="", batch_key=str(b.id), qty=kg))
        batches.append(b)
    sess.commit()
    yield {"so_id": str(so.id), "po_number": so.po_number, "pic": {str(b.id) for b in batches[2:]}}

    ids = [str(b.id) for b in batches]
    sess.query(StockBalance).filter(StockBalance.batch_key.in_(ids)).delete(synchronize_session=False)
    sess.query(Batch).filter(Batch.item_id == item.id).delete(synchronize_session=False)
    sess.query(SalesOrderLine).filter(SalesOrderLine.sales_order_id == so.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.query(PackingOrder).filter(PackingOrder.item_id == item.id).delete(synchronize_session=False)
    sess.query(Location).filter(Location.id == loc.id).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def test_cartons_in_the_lines_selling_unit_are_suggested_first(client, auth_headers, pic_line_with_older_gross_cartons):
    ids = pic_line_with_older_gross_cartons
    r = client.get(f"/api/pick-lists/suggest?sales_order_id={ids['so_id']}", headers=auth_headers)
    assert r.status_code == 200, r.text
    [line] = r.json()
    assert {c["batch_id"] for c in line["cartons"]} == ids["pic"]
    assert sum(c["alt_qty"] for c in line["cartons"]) == 6
    # Each row can say "2 Pic @ 36 Yd": the carton's own packing order's length per unit.
    assert {(c["alt_factor"], c["alt_factor_uom"]) for c in line["cartons"]} == {(36, "yard")}

    # The readiness board claims cartons in the same order, so it agrees.
    rb = client.get("/api/pick-lists/pickable-orders", headers=auth_headers)
    assert rb.status_code == 200, rb.text
    board = {o["po_number"]: o for o in rb.json()}
    assert board[ids["po_number"]]["cartons_ready"] == 3
