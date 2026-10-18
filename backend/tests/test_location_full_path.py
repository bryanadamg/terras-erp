"""Location.full_path names all three levels without lazy IO.

Putaway labels were "{parent} / {name}", so a bin read "GD FINISH GOODS 1 / A1"
and lost its warehouse. They now use full_path, which needs the grandparent
eager-loaded — async routes would raise MissingGreenlet on a lazy load.
"""
import asyncio
import os
import uuid


def test_bin_full_path_has_all_levels():
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from app.db.session import SessionLocal
    from app.models.location import Location

    tag = uuid.uuid4().hex[:6]
    wh, zone, bin_ = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    db = SessionLocal()
    try:
        db.add(Location(id=wh, code=f"FP-{tag}", name="Finished Goods", location_type="warehouse"))
        db.flush()
        db.add(Location(id=zone, code=f"FP-{tag}-Z", name="GD FINISH GOODS 1", location_type="zone", parent_id=wh))
        db.flush()
        db.add(Location(id=bin_, code=f"FP-{tag}-B", name="A1", location_type="bin", parent_id=zone))
        db.commit()

        db.expunge_all()
        assert db.get(Location, bin_).full_path == "Finished Goods / GD FINISH GOODS 1 / A1"

        url = os.environ["DATABASE_URL"]
        if "+asyncpg" not in url:
            url = url.replace("postgresql+psycopg2://", "postgresql://").replace("postgresql://", "postgresql+asyncpg://", 1)

        async def run():
            engine = create_async_engine(url, poolclass=NullPool)
            try:
                async with async_sessionmaker(engine, expire_on_commit=False)() as adb:
                    loc = (await adb.execute(select(Location).where(Location.id == bin_))).unique().scalars().one()
                    return loc.full_path
            finally:
                await engine.dispose()

        assert asyncio.run(run()) == "Finished Goods / GD FINISH GOODS 1 / A1"
    finally:
        db.rollback()
        for lid in (bin_, zone, wh):
            db.query(Location).filter(Location.id == lid).delete()
        db.commit()
        db.close()
