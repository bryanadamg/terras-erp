"""Alt counts work for ANY alt unit, not just the one a carton happens to share
with its line: a carton's count is restated in the sales order line's unit
(same unit as counted, different units through their length) or, when nothing
bridges them, the figure is dropped so screens fall back to base qty."""
import uuid

import pytest

from app.services.packing_service import alt_in_line_unit

PIC36 = ("Pic", 36, "yard")


@pytest.mark.parametrize("alt, carton, line, want", [
    (2, PIC36, PIC36, 2),                                   # same unit
    (2, (" pic ", 36, "Yard"), PIC36, 2),                    # case / spacing
    (1, ("Gross", 144, "yard"), PIC36, 4),                   # 1 Gross @ 144 yd = 4 Pic @ 36 yd
    (36, ("yard", None, None), PIC36, 1),                    # unit that is itself a length
    (1, ("Pic", 32.9184, "meter"), PIC36, 1),                # same length, quoted in metres
    (3, ("Pic", 30, "yard"), PIC36, 2.5),                    # same name, shorter piece
    (3, ("Gross", None, None), ("Gross", 144, "yard"), 3),  # bare hand-made "Gross" lot
    (1, PIC36, ("yard", None, None), 36),                    # line sold in yards
    (1, ("Box", 10, "kg"), PIC36, None),                     # weight unit: no bridge
    (5, ("Pcs", None, None), PIC36, None),                   # count with no length: no bridge
    (None, PIC36, PIC36, None),                              # carton never counted
    (4, ("", None, None), PIC36, 4),                         # count with no unit recorded: the line's
])
def test_alt_in_line_unit(alt, carton, line, want):
    got = alt_in_line_unit(alt, carton, line)
    assert got == want if want is None else got == pytest.approx(want)


@pytest.fixture
def pic_line():
    """A 6 Pic @ 36 yd line with one Gross @ 144 yd carton (1 Gross = 4 Pic)
    on a DISPATCHED pick list, and a second order whose line also got a
    Box = 10 kg carton, which no length can restate."""
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch
    from app.models.item import Item
    from app.models.packing import PackingOrder
    from app.models.pick_list import PickList, PickListLine
    from app.models.sales import SalesOrder, SalesOrderLine

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]
    item = Item(code=f"FG-ANY-{tag}", name="Any FG", uom="KG")
    sess.add(item)
    sess.flush()
    gross = PackingOrder(code=f"PCK-AG-{tag}", item_id=item.id, uom2="Gross", uom2_factor=144, uom2_length_uom="yard")
    box = PackingOrder(code=f"PCK-AB-{tag}", item_id=item.id, uom2="Box", uom2_factor=10, uom2_length_uom="kg")
    so = SalesOrder(po_number=f"SO-ANY-{tag}", customer_name="Any")
    so2 = SalesOrder(po_number=f"SO-ANY2-{tag}", customer_name="Any")
    sess.add_all([gross, box, so, so2])
    sess.flush()
    line = SalesOrderLine(sales_order_id=so.id, item_id=item.id, qty=216, qty_kg=38.88, qty2=6, uom2="Pic", uom2_factor=36)
    line2 = SalesOrderLine(sales_order_id=so2.id, item_id=item.id, qty=216, qty_kg=38.88, qty2=6, uom2="Pic", uom2_factor=36)
    sess.add_all([line, line2])
    g = Batch(batch_number=f"PU-AG-{tag}", item_id=item.id, packing_order_id=gross.id, alt_qty=1)
    b = Batch(batch_number=f"PU-AB-{tag}", item_id=item.id, packing_order_id=box.id, alt_qty=1)
    sess.add_all([g, b])
    sess.flush()
    shipped = PickList(code=f"PL-AG-{tag}", sales_order_id=so.id, status="DISPATCHED")
    draft = PickList(code=f"PL-AB-{tag}", sales_order_id=so2.id, status="DRAFT")
    sess.add_all([shipped, draft])
    sess.flush()
    sess.add_all([
        PickListLine(pick_list_id=shipped.id, sales_order_line_id=line.id, item_id=item.id, qty_picked=26.64, batch_id=g.id),
        PickListLine(pick_list_id=draft.id, sales_order_line_id=line2.id, item_id=item.id, qty_picked=10, batch_id=b.id),
    ])
    sess.commit()
    yield {"so": str(so.id), "so2": str(so2.id), "po": so.po_number, "po2": so2.po_number}

    sess.query(PickListLine).filter(PickListLine.pick_list_id.in_([shipped.id, draft.id])).delete(synchronize_session=False)
    sess.query(PickList).filter(PickList.id.in_([shipped.id, draft.id])).delete(synchronize_session=False)
    sess.query(Batch).filter(Batch.item_id == item.id).delete(synchronize_session=False)
    sess.query(SalesOrderLine).filter(SalesOrderLine.sales_order_id.in_([so.id, so2.id])).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id.in_([so.id, so2.id])).delete(synchronize_session=False)
    sess.query(PackingOrder).filter(PackingOrder.item_id == item.id).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def test_shipped_gross_carton_counts_as_pic(client, auth_headers, pic_line):
    so = client.get(f"/api/sales-orders/{pic_line['so']}", headers=auth_headers).json()
    [line] = so["lines"]
    assert line["qty_dispatched_alt"] == 4  # not "1"

    pl = client.get(f"/api/pick-lists?sales_order_id={pic_line['so']}", headers=auth_headers).json()["items"][0]
    [pll] = pl["lines"]
    assert (pll["alt_qty"], pll["alt_uom"], pll["alt_qty_line"]) == (1, "Gross", 4)


def test_unbridgeable_carton_falls_back_to_base(client, auth_headers, pic_line):
    board = {o["po_number"]: o for o in client.get("/api/pick-lists/pickable-orders", headers=auth_headers).json()}
    # 1 Box = 10 kg can't be stated in Pic: no Pic figure rather than "5 Pic left".
    row = board[pic_line["po2"]]
    assert row["qty_outstanding_alt"] is None
    assert row["lines"][0]["qty_outstanding_alt"] is None
    assert row["qty_outstanding"] == pytest.approx(28.88)
