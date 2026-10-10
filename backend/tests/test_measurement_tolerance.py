"""Scale readings never match the book to the gram — inside the weighing tolerance
(company profile, default 2% of the lot / order qty) that gap is a measurement
variance, not unfinished work.

* Packing: a held lot weighed out a little light closes, its leftover book qty
  written off as a MEASURE_VAR ledger row; cartons a little heavier than the book
  pack, the excess booked in the same way. Past the tolerance both stay refused.
* WO: a step logged a little short of its target still auto-completes.

Box sizes are exact binary fractions so the box list sums to the lot qty exactly.
"""
import uuid

from tests.test_packing_lot_lock import lock_setup, _pack  # noqa: F401  (fixture)
from tests.test_dyeing_output_lot import _log, _setup_dyeing_wo


def _close(client, auth_headers, po):
    return client.put(f"/api/packing/{po['id']}", json={"status": "COMPLETED"}, headers=auth_headers)


def _variances(client, session, lot_id):
    from sqlalchemy import select
    from app.models.stock_ledger import StockLedger

    async def _read():
        rows = await session.execute(
            select(StockLedger.qty_change).filter(
                StockLedger.batch_id == uuid.UUID(lot_id),
                StockLedger.reference_type == "MEASURE_VAR",
            )
        )
        return [round(float(q), 4) for q in rows.scalars()]

    return client.portal.call(_read)


# --- packing: weighed light -------------------------------------------------

def test_a_weighing_gap_left_on_the_lot_does_not_block_closing(client, auth_headers, async_db_session, lock_setup):
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]
    # 30 kg lot, cartons weigh 29.5 kg: 0.5 kg left is inside 2% of 30 (0.6).
    assert _pack(client, auth_headers, po, lot["id"], 29.5, 7.375, box).status_code == 200

    res = _close(client, auth_headers, po)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "COMPLETED"
    assert _variances(client, async_db_session, lot["id"]) == [-0.5]


def test_real_cloth_left_on_the_lot_still_blocks_closing(client, auth_headers, lock_setup):
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]
    # 1 kg left is past 0.6 — that is cloth on the desk, not a scale gap.
    assert _pack(client, auth_headers, po, lot["id"], 29, 7.25, box).status_code == 200

    res = _close(client, auth_headers, po)
    assert res.status_code == 400, res.text
    assert "weighing tolerance" in res.json()["detail"]


# --- packing: weighed heavy -------------------------------------------------

def test_cartons_slightly_heavier_than_the_book_pack(client, auth_headers, async_db_session, lock_setup):
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]
    res = _pack(client, auth_headers, po, lot["id"], 30.5, 7.625, box)
    assert res.status_code == 200, res.text
    assert _variances(client, async_db_session, lot["id"]) == [0.5]
    # The excess was booked in and drawn back out, so the lot is empty and closes.
    assert _close(client, auth_headers, po).status_code == 200


def test_cartons_far_heavier_than_the_book_are_refused(client, auth_headers, lock_setup):
    po, lot, box = lock_setup["holder"], lock_setup["lot"], lock_setup["box"]
    res = _pack(client, auth_headers, po, lot["id"], 31, 7.75, box)
    assert res.status_code == 400, res.text
    assert "weighing tolerance" in res.json()["detail"]


# --- work orders ------------------------------------------------------------

def _wo_status(client, session, wo_id):
    from app.models.work_order import WorkOrder

    async def _read():
        wo = await session.get(WorkOrder, uuid.UUID(wo_id))
        await session.refresh(wo)
        return wo.status

    return client.portal.call(_read)


def test_a_wo_weighed_slightly_short_auto_completes(client, auth_headers, async_db_session):
    mo_id, wo_id, _ = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1, wo_qty=1.0)
    _log(client, auth_headers, mo_id, wo_id, 0.99)
    assert _wo_status(client, async_db_session, wo_id) == "COMPLETED"


def test_a_wo_short_past_the_tolerance_stays_open(client, auth_headers, async_db_session):
    mo_id, wo_id, _ = _setup_dyeing_wo(client, auth_headers, async_db_session, runs=1, wo_qty=1.0)
    _log(client, auth_headers, mo_id, wo_id, 0.97)
    assert _wo_status(client, async_db_session, wo_id) != "COMPLETED"
