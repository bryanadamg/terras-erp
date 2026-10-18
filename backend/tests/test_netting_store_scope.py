"""Netting counts on-hand only inside the item's store (its putaway location).

A remnant left at a production spot is still in use, not free stock — before,
netting summed every location plant-wide, so a few kg of leftover greige on the
loom floor resized (or skipped) the next run's component MO.

Async services open their own real-DB connection and cannot see an uncommitted
transaction, so rows are committed directly and torn down in a finally.
"""
import uuid as _uuid

import pytest

from tests.test_netting_sizes import _consume


@pytest.fixture
def store_and_floor():
    """Item stored in STORE (stock in its bin), plus a remnant at a production spot."""
    from app.db.session import SessionLocal
    from app.models.item import Item
    from app.models.location import Location
    from app.models.stock_balance import StockBalance

    tag = str(_uuid.uuid4())[:8]
    store, bin_, floor = _uuid.uuid4(), _uuid.uuid4(), _uuid.uuid4()
    with_store, plain = _uuid.uuid4(), _uuid.uuid4()
    db = SessionLocal()
    try:
        db.add(Location(id=store, code=f"NS-STORE-{tag}", name="Store", location_type="warehouse"))
        db.add(Location(id=floor, code=f"NS-FLOOR-{tag}", name="Floor", location_type="warehouse"))
        db.flush()
        db.add(Location(id=bin_, code=f"NS-BIN-{tag}", name="Bin", location_type="bin", parent_id=store))
        db.add(Item(id=with_store, code=f"NS-A-{tag}", name="Stored", uom="kg", default_putaway_location_id=store))
        db.add(Item(id=plain, code=f"NS-B-{tag}", name="Unstored", uom="kg"))
        db.flush()
        for item in (with_store, plain):
            db.add(StockBalance(item_id=item, location_id=bin_, variant_key="", batch_key="", qty=5))
            db.add(StockBalance(item_id=item, location_id=floor, variant_key="", batch_key="", qty=7))
        db.commit()
    finally:
        db.close()

    yield with_store, plain

    db = SessionLocal()
    try:
        db.query(StockBalance).filter(StockBalance.item_id.in_([with_store, plain])).delete()
        db.query(Item).filter(Item.id.in_([with_store, plain])).delete()
        db.query(Location).filter(Location.id == bin_).delete()
        db.query(Location).filter(Location.id.in_([store, floor])).delete()
        db.commit()
    finally:
        db.close()


def test_floor_remnant_is_not_free_stock(store_and_floor):
    stored, _ = store_and_floor
    net, detail = _consume(stored, 20.0)
    assert detail["on_hand"] == pytest.approx(5.0)   # the store's bin only, not the 7 on the floor
    assert net == pytest.approx(15.0)


def test_item_without_a_store_still_nets_plant_wide(store_and_floor):
    _, plain = store_and_floor
    _, detail = _consume(plain, 20.0)
    assert detail["on_hand"] == pytest.approx(12.0)


def test_preview_net_from_names_the_store(store_and_floor):
    """The preview's Net from column names the store the on-hand was counted in."""
    import asyncio
    import os

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.services.netting_service import Availability, _apply_store, _location_name_map

    stored, plain = store_and_floor
    url = os.environ["DATABASE_URL"]
    if "+asyncpg" not in url:
        url = url.replace("postgresql+psycopg2://", "postgresql://").replace("postgresql://", "postgresql+asyncpg://", 1)

    async def run():
        engine = create_async_engine(url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as db:
                avail = await Availability.create(db)
                nodes = [{"item_id": i, "net_from_location_id": None, "net_from_location_name": ""} for i in (stored, plain)]
                await _apply_store(avail, nodes, await _location_name_map(db))
                return nodes
        finally:
            await engine.dispose()

    with_store, without = asyncio.run(run())
    assert with_store["net_from_location_name"] == "Store"
    assert without["net_from_location_name"] == ""
