"""Editing a pick list must not un-scan what the floor already scanned.

`PUT /pick-lists/{id}` rebuilds the lines wholesale — the editor sends the whole
list, not a patch. The picker, meanwhile, has been scanning cartons onto the same
document. If the rebuild dropped `picked_at`, a planner tweaking one quantity
before dispatch would silently un-confirm every carton already on the truck, and
dispatch would then refuse the lot.

The pick list and its cartons are seeded straight through the sync session: what
is under test is the rebuild, not the packing line that fills a carton.
"""
import uuid
from datetime import datetime

import pytest


@pytest.fixture
def picked_line():
    """A PICKED pick list with one scanned carton line."""
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch
    from app.models.item import Item
    from app.models.pick_list import PickList, PickListLine
    from app.models.sales import SalesOrder, SalesOrderLine

    conn = engine.connect()
    sess = Session(conn)
    tag = uuid.uuid4().hex[:6]

    item = Item(code=f"FG-EDIT-{tag}", name="Edit Test FG", uom="KG")
    sess.add(item)
    sess.flush()
    so = SalesOrder(po_number=f"SO-EDIT-{tag}", customer_name="Edit Customer")
    sess.add(so)
    sess.flush()
    sol = SalesOrderLine(sales_order_id=so.id, item_id=item.id, qty=100)
    sess.add(sol)
    batch = Batch(batch_number=f"PU-EDIT-{tag}", item_id=item.id)
    sess.add(batch)
    sess.flush()
    pl = PickList(code=f"PL-EDIT-{tag}", sales_order_id=so.id, status="PICKED", qc_passed=True)
    sess.add(pl)
    sess.flush()
    scanned_at = datetime(2026, 9, 1, 8, 30)
    line = PickListLine(
        pick_list_id=pl.id,
        sales_order_line_id=sol.id,
        item_id=item.id,
        qty_picked=10,
        batch_id=batch.id,
        picked_at=scanned_at,
        picked_by="floor-picker",
    )
    sess.add(line)
    sess.commit()
    ids = {
        "pl": str(pl.id), "so_line": str(sol.id), "item": str(item.id),
        "batch": str(batch.id), "picked_at": scanned_at,
    }
    yield ids

    sess.query(PickListLine).filter(PickListLine.pick_list_id == pl.id).delete(synchronize_session=False)
    sess.query(PickList).filter(PickList.id == pl.id).delete(synchronize_session=False)
    sess.query(Batch).filter(Batch.id == batch.id).delete(synchronize_session=False)
    sess.query(SalesOrderLine).filter(SalesOrderLine.id == sol.id).delete(synchronize_session=False)
    sess.query(SalesOrder).filter(SalesOrder.id == so.id).delete(synchronize_session=False)
    sess.query(Item).filter(Item.id == item.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def _save(client, auth_headers, ids, qty):
    return client.put(
        f"/api/pick-lists/{ids['pl']}",
        json={"lines": [{
            "sales_order_line_id": ids["so_line"],
            "item_id": ids["item"],
            "qty_picked": qty,
            "batch_id": ids["batch"],
        }]},
        headers=auth_headers,
    )


def test_a_rebuild_carries_the_scan_confirmation_across(picked_line, client, auth_headers):
    res = _save(client, auth_headers, picked_line, qty=12)
    assert res.status_code == 200, res.text

    lines = res.json()["lines"]
    assert len(lines) == 1
    assert float(lines[0]["qty_picked"]) == 12, "the edit itself must still apply"
    assert lines[0]["picked_at"], "the carton was already scanned — the rebuild must not un-scan it"
    assert lines[0]["picked_by"] == "floor-picker"


@pytest.fixture
def spare_carton(picked_line):
    """A second carton, torn down after the client's transaction lets go of it."""
    from sqlalchemy.orm import Session
    from app.db.session import engine
    from app.models.batch import Batch

    conn = engine.connect()
    sess = Session(conn)
    batch = Batch(batch_number=f"PU-EDIT2-{uuid.uuid4().hex[:6]}", item_id=uuid.UUID(picked_line["item"]))
    sess.add(batch)
    sess.commit()
    yield str(batch.id)

    sess.query(Batch).filter(Batch.id == batch.id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


def test_a_carton_the_picker_never_scanned_stays_unconfirmed(
    picked_line, spare_carton, client, auth_headers
):
    """The carry-across is keyed on the carton, not blanket-applied to every line."""
    res = client.put(
        f"/api/pick-lists/{picked_line['pl']}",
        json={"lines": [
            {"sales_order_line_id": picked_line["so_line"], "item_id": picked_line["item"],
             "qty_picked": 10, "batch_id": picked_line["batch"]},
            {"sales_order_line_id": picked_line["so_line"], "item_id": picked_line["item"],
             "qty_picked": 5, "batch_id": spare_carton},
        ]},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    by_batch = {l["batch_id"]: l for l in res.json()["lines"]}
    assert by_batch[picked_line["batch"]]["picked_at"]
    assert by_batch[spare_carton]["picked_at"] is None, "a newly added carton has not been scanned"


def test_a_staged_pick_list_is_locked_against_editing(picked_line, client, auth_headers):
    """Contents a checker is counting against a printed note cannot move under them."""
    staged = client.post(
        "/api/shipments", json={"pick_list_ids": [picked_line["pl"]]}, headers=auth_headers
    )
    assert staged.status_code == 200, staged.text

    res = _save(client, auth_headers, picked_line, qty=99)
    assert res.status_code == 400, res.text
    assert "unload it" in res.json()["detail"]


@pytest.mark.parametrize("status", ["DISPATCHED", "CANCELLED", "FOO"])
def test_put_cannot_set_a_status_it_does_not_own(status, picked_line, client, auth_headers):
    """DISPATCHED via PUT would skip the shipment's four-eyes verify and goods issue."""
    res = client.put(f"/api/pick-lists/{picked_line['pl']}", json={"status": status}, headers=auth_headers)
    assert res.status_code == 400, res.text
