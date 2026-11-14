"""Load a legacy migration bundle into this Terras database — insert-only.

    docker compose exec -T api python -m app.legacy.load masters /tmp/bundle [--commit]
    docker compose exec -T api python -m app.legacy.load stock   /tmp/bundle [--commit]

Default is a dry run: every phase runs, the report is printed, everything is
rolled back. With --commit each phase commits on its own, so a failure only
rolls back the phase it happened in and the run can simply be repeated.

Never UPDATEs or DELETEs a row that existed before: a bundle row whose natural
key already exists is counted as `matched` (and `differs` when its fields don't
agree) and skipped. Broadcasts once per entity type after a committed phase,
and writes one audit row per phase.
"""
import hashlib
import json
import os
import sys
from collections import Counter
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.db.base  # noqa: F401  — registers every model first; a cold `-m` start hits a circular import otherwise
from app.models.attribute import Attribute, AttributeValue
from app.models.bom import BOM, BOMLine
from app.models.category import Category
from app.models.color import Color
from app.models.dyeing_setting import DyeRecipe
from app.models.item import Item
from app.models.location import Location
from app.models.partner import Partner
from app.models.size import Size
from app.services import audit_service, color_service, dye_recipe_service

PHASES = ["categories", "values", "locations", "partners", "items", "colors", "recipes", "boms"]
BROADCAST = {"items": "MASTER_DATA_UPDATE", "categories": "MASTER_DATA_UPDATE", "locations": "MASTER_DATA_UPDATE",
             "partners": "MASTER_DATA_UPDATE", "values": "MASTER_DATA_UPDATE", "colors": "COLOR_UPDATE",
             "recipes": "MASTER_DATA_UPDATE", "boms": "BOM_UPDATE"}


def _read(bundle_dir: str, name: str):
    with open(os.path.join(bundle_dir, f"{name}.json"), encoding="utf-8") as f:
        return json.load(f)


class Run:
    def __init__(self, db: AsyncSession, bundle_dir: str):
        self.db, self.dir = db, bundle_dir
        self.report: dict[str, Counter] = {p: Counter(created=0, matched=0, differs=0, rejected=0) for p in PHASES}
        self.rejects: list[dict] = []

    def reject(self, phase: str, key: str, reason: str):
        self.report[phase]["rejected"] += 1
        self.rejects.append({"entity": phase, "key": key, "reason": reason})

    async def ids(self, model, key_col):
        rows = (await self.db.execute(select(getattr(model, key_col), model.id))).all()
        return {k: i for k, i in rows}

    # ---------------------------------------------------------------- phases
    async def categories(self):
        index = await self._category_index()
        for path in _read(self.dir, "categories"):
            parts = [p.strip() for p in path.split(">")]
            for depth in range(1, len(parts) + 1):
                key = " > ".join(parts[:depth])
                if key in index:
                    if depth == len(parts):
                        self.report["categories"]["matched"] += 1
                    continue
                cat = Category(name=parts[depth - 1], parent_id=index.get(" > ".join(parts[:depth - 1])))
                self.db.add(cat)
                await self.db.flush()
                index[key] = cat.id
                self.report["categories"]["created"] += 1

    async def _category_index(self) -> dict:
        rows = (await self.db.execute(select(Category.id, Category.name, Category.parent_id))).all()
        by_id = {i: (n, p) for i, n, p in rows}

        def path(i):
            names = []
            while i is not None and len(names) < 10:
                n, i = by_id[i]
                names.append(n)
            return " > ".join(reversed(names))
        return {path(i): i for i in by_id}

    async def values(self):
        v = _read(self.dir, "values")
        have = set((await self.db.execute(select(Size.name))).scalars())
        top = (await self.db.execute(select(func.max(Size.sort_order)))).scalar() or 0
        for name in v.get("sizes", []):
            if name in have:
                self.report["values"]["matched"] += 1
                continue
            top += 1
            self.db.add(Size(name=name, sort_order=top))
            self.report["values"]["created"] += 1
        for role, names in [("wash_bath", v.get("wash_baths", [])), ("finishing_step", v.get("finishing_steps", []))]:
            existing = await self._attr_values(role)
            attr_id = (await self.db.execute(select(Attribute.id).filter(Attribute.system_role == role))).scalar()
            for name in names:
                if name in existing:
                    self.report["values"]["matched"] += 1
                elif attr_id is None:
                    self.reject("values", name, f"no {role} attribute")
                else:
                    self.db.add(AttributeValue(attribute_id=attr_id, value=name))
                    self.report["values"]["created"] += 1
        await self.db.flush()

    async def _attr_values(self, role: str) -> dict:
        rows = (await self.db.execute(
            select(AttributeValue.value, AttributeValue.id).join(Attribute, Attribute.id == AttributeValue.attribute_id)
            .filter(Attribute.system_role == role))).all()
        return {v: i for v, i in rows}

    async def locations(self):
        locs = await self.ids(Location, "code")
        for b in _read(self.dir, "locations"):
            if b["code"] in locs:
                self.report["locations"]["matched"] += 1
            elif b["parent_code"] not in locs:
                self.reject("locations", b["code"], f"parent {b['parent_code']} not found")
            else:
                loc = Location(code=b["code"], name=b["name"], location_type="bin", parent_id=locs[b["parent_code"]])
                self.db.add(loc)
                await self.db.flush()
                locs[b["code"]] = loc.id
                self.report["locations"]["created"] += 1

    async def partners(self):
        have = {n.strip().upper() for n in (await self.db.execute(select(Partner.name))).scalars()}
        for p in _read(self.dir, "partners"):
            key = (p["name"] or "").strip().upper()
            if key in have:
                self.report["partners"]["matched"] += 1
            elif p["status"] == "MATCHED":
                self.reject("partners", p["name"], "matched partner no longer exists")
            else:
                self.db.add(Partner(name=p["name"].strip(), type=p["type"], address=p["address"], phone=p["phone"],
                                    fax=p["fax"], email=p["email"], contact_person=p["contact_person"], active=True))
                have.add(key)
                self.report["partners"]["created"] += 1
        await self.db.flush()

    async def items(self):
        cats = await self._category_index()
        have = {r.code: r for r in (await self.db.execute(select(Item.code, Item.name, Item.uom))).all()}
        for it in _read(self.dir, "items"):
            if it["code"] in have:
                h = have[it["code"]]
                self.report["items"]["matched"] += 1
                if (h.name, h.uom) != (it["name"], it["uom"]):
                    self.report["items"]["differs"] += 1
                continue
            if it["status"] == "MATCHED":
                self.reject("items", it["code"], "matched item no longer exists")
                continue
            if it["category"] not in cats:
                self.reject("items", it["code"], f"category {it['category']} not found")
                continue
            # Plain insert, same fields item_service.create_item sets for a non-combo item;
            # create_item commits, which would break the dry run and per-phase transactions.
            self.db.add(Item(code=it["code"], name=it["name"][:255], uom=it["uom"], category_id=cats[it["category"]],
                             lot_tracked=it["lot_tracked"], variant_type=it["variant_type"], active=True))
            self.report["items"]["created"] += 1
        await self.db.flush()

    async def colors(self):
        have = set((await self.db.execute(select(Color.code))).scalars())
        for c in _read(self.dir, "colors"):
            if c["code"] in have:
                self.report["colors"]["matched"] += 1
            elif c["status"] == "MATCHED":
                self.reject("colors", c["code"], "matched colour no longer exists")
            else:
                await color_service.create_color(self.db, code=c["code"], name=c["name"], status="active",
                                                 notes=f"legacy:{c['legacy_code']}")
                have.add(c["code"])
                self.report["colors"]["created"] += 1

    async def recipes(self):
        colors = await self.ids(Color, "code")
        items = await self.ids(Item, "code")
        codes = set((await self.db.execute(select(DyeRecipe.code))).scalars())
        done = {(c, n) for c, n in (await self.db.execute(select(DyeRecipe.color_id, DyeRecipe.notes))).all()}
        washes, finishes = await self._attr_values("wash_bath"), await self._attr_values("finishing_step")
        for r in _read(self.dir, "recipes"):
            color_id = colors.get(r["color_code"])
            if color_id is None:
                self.reject("recipes", r["color_code"], "colour not found")
                continue
            if (color_id, r["notes"]) in done:
                self.report["recipes"]["matched"] += 1
                continue
            missing = [l["item_code"] for l in r["lines"] if l["item_code"] not in items]
            if missing:
                self.reject("recipes", r["color_code"], f"items not found: {', '.join(missing)}")
                continue
            n = 1
            while f"DR-{r['color_code']}-{n:05d}" in codes:
                n += 1
            code = f"DR-{r['color_code']}-{n:05d}"
            codes.add(code)
            await dye_recipe_service.create_recipe(
                self.db, code=code, name=r["name"], color_standard=r["color_code"], color_id=color_id,
                notes=r["notes"], is_active=True,
                lines=[dict(item_id=items[l["item_code"]], qty_per_liter=l["qty_per_liter"],
                            chemical_type=l["chemical_type"], sort_order=l["sort_order"]) for l in r["lines"]],
                wash_baths=[dict(bath_number=w["bath_number"], attribute_value_id=washes.get(w["value"]),
                                 description=w["value"][:256]) for w in r["wash_baths"]],
                finishing_steps=[dict(sort_order=f["sort_order"], attribute_value_id=finishes.get(f["value"]),
                                      description=f["value"][:512]) for f in r["finishing"]],
            )
            done.add((color_id, r["notes"]))
            self.report["recipes"]["created"] += 1

    async def boms(self):
        from app.api.boms import _validate_line_percentages

        items = await self.ids(Item, "code")
        codes = set((await self.db.execute(select(BOM.code))).scalars())
        with_bom = set((await self.db.execute(select(BOM.item_id))).scalars())
        for b in _read(self.dir, "boms"):
            if b["code"] in codes or items.get(b["item_code"]) in with_bom:
                self.report["boms"]["matched"] += 1
                continue
            missing = [c for c in [b["item_code"]] + [l["item_code"] for l in b["lines"]] if c not in items]
            if missing:
                self.reject("boms", b["code"], f"items not found: {', '.join(missing)}")
                continue
            try:
                _validate_line_percentages([SimpleNamespace(percentage=l["percentage"]) for l in b["lines"]])
            except HTTPException as e:
                self.reject("boms", b["code"], str(e.detail))
                continue
            # Inactive draft (gate G3): PPIC activates a legacy BOM on first use, so it
            # can't steer MRP before someone has looked at it. Sizes stay on the lots:
            # a BOMSize needs a measurement the legacy data doesn't have.
            bom = BOM(code=b["code"], item_id=items[b["item_code"]], qty=b["qty"], size_mode=b["size_mode"],
                      active=False, description=f"Imported from legacy {b['legacy_parent']}"[:255])
            self.db.add(bom)
            await self.db.flush()
            self.db.add_all([BOMLine(bom_id=bom.id, item_id=items[l["item_code"]], qty=l["qty"],
                                     percentage=l["percentage"]) for l in b["lines"]])
            codes.add(b["code"])
            with_bom.add(bom.item_id)
            self.report["boms"]["created"] += 1
        await self.db.flush()


async def _finish_phase(run: Run, phase: str, dry_run: bool):
    if dry_run:
        return
    counts = dict(run.report[phase])
    if counts["created"]:
        await audit_service.log_activity(run.db, None, "LEGACY_IMPORT", phase, "bulk",
                                         details=f"Legacy migration: {phase}", changes=counts, commit=False)
    await run.db.commit()
    if counts["created"]:
        try:
            from app.core.ws_manager import manager
            await manager.broadcast({"type": BROADCAST[phase], "data": {"source": "legacy_import", "entity": phase}})
        except Exception:
            pass  # best-effort: never fail a committed phase on a broadcast


async def load_masters(db: AsyncSession, bundle_dir: str, *, dry_run: bool, rejects: list | None = None) -> dict[str, Counter]:
    """Run every master phase; returns {phase: Counter(created, matched, differs, rejected)}.
    Reject details are appended to `rejects` when a list is passed."""
    run = Run(db, bundle_dir)
    if rejects is not None:
        run.rejects = rejects
    try:
        for phase in PHASES:
            await getattr(run, phase)()
            await _finish_phase(run, phase, dry_run)
    finally:
        if dry_run:
            await db.rollback()
    return run.report


LEGACY_REF = "LEGACY_OPENING"


def _ref_id(ref: str) -> str:
    """stock_ledger.reference_id is String(64); a longer legacy key is stored as its digest."""
    return ref if len(ref) <= 64 else "sha1:" + hashlib.sha1(ref.encode()).hexdigest()


async def load_opening_stock(db: AsyncSession, bundle_dir: str, *, dry_run: bool, rejects: list | None = None) -> dict:
    """Post each legacy balance row as LEGACY_OPENING stock on its own legacy lot.

    Re-runnable: what is posted is the difference between the bundle quantity and
    everything already posted under the same legacy key, so a later dump posts
    only deltas. A batch number that belongs to a lot Terras made itself is never
    reused — that row is rejected instead."""
    from app.models.batch import Batch
    from app.models.stock_ledger import StockLedger
    from app.services import stock_service

    rejects = rejects if rejects is not None else []
    report = {"stock": Counter(posted=0, unchanged=0, batches_created=0, rejected=0)}
    c = report["stock"]

    def bad(key, reason):
        c["rejected"] += 1
        rejects.append({"entity": "stock", "key": key, "reason": reason})

    items = {code: (i, lt) for code, i, lt in (await db.execute(select(Item.code, Item.id, Item.lot_tracked))).all()}
    locs = {code: i for code, i in (await db.execute(select(Location.code, Location.id))).all()}
    colors = {code: i for code, i in (await db.execute(select(Color.code, Color.id))).all()}
    batches = {b.batch_number: b for b in (await db.execute(select(Batch))).scalars()}
    posted = {ref: float(q) for ref, q in (await db.execute(
        select(StockLedger.reference_id, func.sum(StockLedger.qty_change))
        .filter(StockLedger.reference_type == LEGACY_REF).group_by(StockLedger.reference_id))).all()}
    try:
        for row in _read(bundle_dir, "opening_stock"):
            ref = row["ref"]
            if row["item_code"] not in items:
                bad(ref, f"item {row['item_code']} not found")
                continue
            if row["location_code"] not in locs:
                bad(ref, f"location {row['location_code']} not found")
                continue
            if row.get("color_code") and row["color_code"] not in colors:
                bad(ref, f"colour {row['color_code']} not found")
                continue
            item_id = items[row["item_code"]][0]
            batch_id = None
            if row.get("batch_number"):
                b = batches.get(row["batch_number"])
                if b is not None and (b.created_by != "legacy-migration" or b.item_id != item_id):
                    bad(ref, f"batch number {row['batch_number']} belongs to another lot")
                    continue
                if b is None:
                    b = Batch(batch_number=row["batch_number"], item_id=item_id, created_by="legacy-migration",
                              notes=f"legacy:{row['legacy_item']}",
                              bom_size_snapshot={"size_name": row["size"]} if row.get("size") else None)
                    db.add(b)
                    await db.flush()
                    batches[b.batch_number] = b
                    c["batches_created"] += 1
                batch_id = b.id
            rid = _ref_id(ref)
            delta = float(row["qty"]) - posted.get(rid, 0.0)
            if abs(delta) < 1e-6:
                c["unchanged"] += 1
                continue
            try:
                async with db.begin_nested():
                    await stock_service.add_stock_entry(
                        db, item_id, locs[row["location_code"]], delta, LEGACY_REF, rid,
                        batch_id=batch_id, color_id=colors.get(row.get("color_code")) if row.get("color_code") else None)
            except HTTPException as e:
                bad(ref, f"stock service refused: {e.detail}")
                continue
            posted[rid] = posted.get(rid, 0.0) + delta
            c["posted"] += 1
        if not dry_run:
            if c["posted"] or c["batches_created"]:
                await audit_service.log_activity(db, None, "LEGACY_IMPORT", "stock", "bulk",
                                                 details="Legacy migration: opening stock", changes=dict(c), commit=False)
            await db.commit()
            try:
                from app.core.ws_manager import manager
                await manager.broadcast({"type": "STOCK_UPDATE", "data": {"source": "legacy_import"}})
            except Exception:
                pass
    finally:
        if dry_run:
            await db.rollback()
    return report


def _print(report: dict, rejects: list):
    for k, v in report.items():
        print(f"  {k:12} " + "  ".join(f"{n}={v[n]}" for n in v))
    for r in rejects[:50]:
        print(f"  REJECT {r['entity']}: {r['key']} — {r['reason']}")
    if len(rejects) > 50:
        print(f"  ... {len(rejects) - 50} more rejects")


if __name__ == "__main__":
    import argparse
    import asyncio

    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["masters", "stock"])
    ap.add_argument("bundle_dir")
    ap.add_argument("--commit", action="store_true")
    a = ap.parse_args()

    async def main():
        from app.db.session import SessionLocal  # noqa: F401  (initialises db_manager)
        from app.core.db_manager import db_manager
        async with db_manager.async_session_factory() as db:
            fn = load_masters if a.what == "masters" else load_opening_stock
            rejects: list = []
            report = await fn(db, a.bundle_dir, dry_run=not a.commit, rejects=rejects)
        print("COMMITTED" if a.commit else "DRY RUN (rolled back)")
        _print(report, rejects)

    asyncio.run(main())
