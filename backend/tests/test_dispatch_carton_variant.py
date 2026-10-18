"""Dispatch deducts a carton under the carton's own stock key, not its SO line's.

A carton is keyed by what was packed. When that differs from the SO line — packed
to stock with a shade, or the line's shade backfilled later — rebuilding the key
from the line addressed a row that doesn't exist: "have 0.0", dispatch blocked.

Async services open their own real-DB connection and cannot see an uncommitted
transaction, so rows are committed directly and torn down in a finally.
"""
import asyncio
import os
import uuid
from types import SimpleNamespace


def test_carton_with_shade_dispatches_against_colourless_line():
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.db.session import SessionLocal
    from app.models.batch import Batch
    from app.models.color import Color
    from app.models.item import Item
    from app.models.location import Location
    from app.models.stock_balance import StockBalance
    from app.models.stock_ledger import StockLedger
    from app.services import dispatch_service

    tag = uuid.uuid4().hex[:6]
    item_id, loc_id, color_id, carton_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db = SessionLocal()
    try:
        db.add(Location(id=loc_id, code=f"DSP-{tag}", name="FG", location_type="warehouse"))
        db.add(Item(id=item_id, code=f"DSP-{tag}", name="Dsp", uom="kg"))
        db.add(Color(id=color_id, code=f"DSP-{tag}", name=f"DSP-{tag}"))
        db.flush()
        db.add(Batch(id=carton_id, item_id=item_id, batch_number=f"PU-DSP-{tag}"))
        db.flush()
        db.add(StockBalance(item_id=item_id, location_id=loc_id, variant_key=f"c:{color_id}",
                            batch_key=str(carton_id), qty=4))
        db.commit()

        # SO line states no shade; the carton was packed under one.
        sol_id = uuid.uuid4()
        pl = SimpleNamespace(code=f"PL-{tag}", source_location_id=loc_id,
                             sales_order=SimpleNamespace(lines=[SimpleNamespace(id=sol_id, attribute_values=[], color_id=None)]))
        line = SimpleNamespace(item_id=item_id, item=None, batch_id=carton_id, qty_picked=4,
                               source_location_id=None, sales_order_line_id=sol_id)

        url = os.environ["DATABASE_URL"]
        if "+asyncpg" not in url:
            url = url.replace("postgresql+psycopg2://", "postgresql://").replace("postgresql://", "postgresql+asyncpg://", 1)

        async def run():
            engine = create_async_engine(url, poolclass=NullPool)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False)() as adb:
                    shortages = await dispatch_service.check_availability(adb, pl, [line])
                    await dispatch_service.issue_stock(adb, pl, [line])
                    left = (await adb.execute(select(StockBalance.qty).where(
                        StockBalance.batch_key == str(carton_id)))).scalar()
                    await adb.rollback()
                    return shortages, float(left)
            finally:
                await engine.dispose()

        shortages, left = asyncio.run(run())
        assert shortages == []
        assert left == 0
    finally:
        db.rollback()
        db.query(StockLedger).filter(StockLedger.item_id == item_id).delete()
        db.query(StockBalance).filter(StockBalance.item_id == item_id).delete()
        db.query(Batch).filter(Batch.id == carton_id).delete()
        db.query(Color).filter(Color.id == color_id).delete()
        db.query(Item).filter(Item.id == item_id).delete()
        db.query(Location).filter(Location.id == loc_id).delete()
        db.commit()
        db.close()
