"""Legacy migration loader: insert-only, dry-run, idempotent."""
import json
import uuid

import pytest
from sqlalchemy import func, select


def _bundle(tmp_path, tag, **overrides):
    """A minimal bundle, every code tagged so tests never collide in the shared test DB."""
    t = tag
    data = {
        "categories": [f"LT{t} > Yarn"],
        "values": {"materials": [], "sizes": [f"Z{t}"], "wash_baths": [f"Cuci {t}"], "finishing_steps": [f"Soft {t}"]},
        "locations": [],
        "partners": [{"name": f"PT LEGACY {t}", "status": "NEW", "legacy_code": "K1", "type": "SUPPLIER",
                      "address": "Jl. 1", "phone": None, "fax": None, "email": None, "contact_person": None}],
        "items": [
            {"code": f"Y{t}", "name": "Yarn", "uom": "kg", "category": f"LT{t} > Yarn", "material": None,
             "lot_tracked": True, "variant_type": None, "sizes": [], "legacy_codes": [f"Y{t}"], "status": "NEW"},
            {"code": f"D{t}", "name": "Dye", "uom": "kg", "category": f"LT{t} > Yarn", "material": None,
             "lot_tracked": False, "variant_type": None, "sizes": [], "legacy_codes": [f"D{t}"], "status": "NEW"},
            {"code": f"F{t}", "name": "Tape", "uom": "yard", "category": f"LT{t} > Yarn", "material": None,
             "lot_tracked": True, "variant_type": "color", "sizes": [f"Z{t}"], "legacy_codes": [f"F{t} Z{t}"], "status": "NEW"},
        ],
        "colors": [{"code": f"C{t}", "name": f"C{t}", "legacy_code": "LD1", "status": "NEW"}],
        "recipes": [{"color_code": f"C{t}", "name": f"C{t}", "notes": "legacy:LD1",
                     "lines": [{"item_code": f"D{t}", "qty_per_liter": 0.22, "chemical_type": "DYE", "sort_order": 0}],
                     "wash_baths": [{"bath_number": 1, "value": f"Cuci {t}"}],
                     "finishing": [{"sort_order": 0, "value": f"Soft {t}"}]}],
        "boms": [{"code": f"LEG-F{t}", "item_code": f"F{t}", "qty": 1, "status": "NEW", "size_mode": "sized",
                  "sizes": [f"Z{t}"], "legacy_parent": f"F{t} Z{t}",
                  "lines": [{"item_code": f"Y{t}", "qty": 2, "percentage": 66.67},
                            {"item_code": f"D{t}", "qty": 1, "percentage": 33.33}]}],
        "opening_stock": [],
    }
    data.update(overrides)
    for name, value in data.items():
        (tmp_path / f"{name}.json").write_text(json.dumps(value))
    return str(tmp_path)


def _count(db, model, **eq):
    q = select(func.count()).select_from(model)
    for k, v in eq.items():
        q = q.filter(getattr(model, k) == v)
    return db.execute(q).scalar()


def test_dry_run_writes_nothing(client, async_db_session, db_session, tmp_path):
    from app.legacy.load import load_masters
    from app.models.item import Item
    tag = uuid.uuid4().hex[:6].upper()
    b = _bundle(tmp_path, tag)

    report = client.portal.call(lambda: load_masters(async_db_session, b, dry_run=True))
    assert report["items"]["created"] == 3 and report["boms"]["created"] == 1
    assert client.portal.call(lambda: _acount(async_db_session, Item, code=f"Y{tag}")) == 0


async def _acount(db, model, **eq):
    q = select(func.count()).select_from(model)
    for k, v in eq.items():
        q = q.filter(getattr(model, k) == v)
    return (await db.execute(q)).scalar()


def test_load_is_idempotent(client, async_db_session, tmp_path):
    from app.legacy.load import load_masters
    tag = uuid.uuid4().hex[:6].upper()
    b = _bundle(tmp_path, tag)
    r1 = client.portal.call(lambda: load_masters(async_db_session, b, dry_run=False))
    assert {k: c["created"] for k, c in r1.items()} == {
        "categories": 2, "values": 3, "locations": 0, "partners": 1, "items": 3, "colors": 1, "recipes": 1, "boms": 1}
    r2 = client.portal.call(lambda: load_masters(async_db_session, b, dry_run=False))
    assert sum(c["created"] for c in r2.values()) == 0
    assert r2["items"]["matched"] == 3 and r2["recipes"]["matched"] == 1 and r2["boms"]["matched"] == 1


def test_existing_item_is_never_modified(client, async_db_session, tmp_path):
    from app.legacy.load import load_masters
    from app.models.item import Item
    tag = uuid.uuid4().hex[:6].upper()

    async def seed():
        async_db_session.add(Item(code=f"Y{tag}", name="Prod name", uom="kg"))
        await async_db_session.flush()
    client.portal.call(seed)

    report = client.portal.call(lambda: load_masters(async_db_session, _bundle(tmp_path, tag), dry_run=False))
    assert report["items"]["matched"] == 1 and report["items"]["differs"] == 1 and report["items"]["created"] == 2

    async def name():
        return (await async_db_session.execute(select(Item.name).filter(Item.code == f"Y{tag}"))).scalar()
    assert client.portal.call(name) == "Prod name"


def test_recipe_wash_baths_link_attribute_values(client, async_db_session, tmp_path):
    from sqlalchemy.orm import selectinload
    from app.legacy.load import load_masters
    from app.models.color import Color
    from app.models.dyeing_setting import DyeRecipe
    tag = uuid.uuid4().hex[:6].upper()
    client.portal.call(lambda: load_masters(async_db_session, _bundle(tmp_path, tag), dry_run=False))

    async def fetch():
        r = (await async_db_session.execute(
            select(DyeRecipe).options(selectinload(DyeRecipe.lines), selectinload(DyeRecipe.wash_baths),
                                      selectinload(DyeRecipe.finishing_steps))
            .join(Color, Color.id == DyeRecipe.color_id).filter(Color.code == f"C{tag}"))).scalars().one()
        c = (await async_db_session.execute(select(Color).filter(Color.code == f"C{tag}"))).scalars().one()
        return r, c
    r, c = client.portal.call(fetch)
    assert r.code == f"DR-C{tag}-00001" and r.notes == "legacy:LD1"
    assert [(float(l.qty_per_liter), l.chemical_type) for l in r.lines] == [(0.22, "DYE")]
    assert [(w.bath_number, w.description) for w in r.wash_baths] == [(1, f"Cuci {tag}")]
    assert all(w.attribute_value_id for w in r.wash_baths) and all(f.attribute_value_id for f in r.finishing_steps)
    assert c.attribute_value_id is not None            # mirrored to the Color Code attribute like the UI does


def test_bom_is_created_inactive_with_its_lines(client, async_db_session, tmp_path):
    from sqlalchemy.orm import selectinload
    from app.legacy.load import load_masters
    from app.models.bom import BOM
    tag = uuid.uuid4().hex[:6].upper()
    client.portal.call(lambda: load_masters(async_db_session, _bundle(tmp_path, tag), dry_run=False))

    async def fetch():
        return (await async_db_session.execute(
            select(BOM).options(selectinload(BOM.lines)).filter(BOM.code == f"LEG-F{tag}"))).scalars().one()
    bom = client.portal.call(fetch)
    assert bom.active is False and bom.size_mode == "sized"
    assert sorted(float(l.percentage) for l in bom.lines) == [33.33, 66.67]


def test_invalid_bom_is_rejected_not_half_written(client, async_db_session, tmp_path):
    from app.legacy.load import load_masters
    from app.models.bom import BOM
    tag = uuid.uuid4().hex[:6].upper()
    bad = [{"code": f"LEG-F{tag}", "item_code": f"F{tag}", "qty": 1, "status": "NEW", "size_mode": "free", "sizes": [],
            "legacy_parent": "x", "lines": [{"item_code": f"Y{tag}", "qty": 1, "percentage": 50.0}]}]
    report = client.portal.call(lambda: load_masters(async_db_session, _bundle(tmp_path, tag, boms=bad), dry_run=False))
    assert report["boms"]["rejected"] == 1 and report["boms"]["created"] == 0
    assert client.portal.call(lambda: _acount(async_db_session, BOM, code=f"LEG-F{tag}")) == 0
