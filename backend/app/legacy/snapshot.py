"""Read-only snapshot of a Terras instance's master data, for crosswalk suggestions.

    docker compose exec -T api python -m app.legacy.snapshot > snapshot.json

Plain SELECTs only; safe to run against bie-prod.
"""
import json
import sys

from sqlalchemy import text
from sqlalchemy.orm import Session


def _rows(db: Session, sql: str):
    return db.execute(text(sql)).all()


def _attr_values(db: Session, role: str) -> list[str]:
    return [r[0] for r in _rows(db, f"""
        SELECT v.value FROM attribute_values v JOIN attributes a ON a.id = v.attribute_id
        WHERE a.system_role = '{role}' ORDER BY v.value""")]


def build_snapshot(db: Session) -> dict:
    return {
        "items": {code: {"name": name, "uom": uom, "category": cat or ""} for code, name, uom, cat in _rows(db, """
            SELECT i.code, i.name, i.uom, c.name FROM items i LEFT JOIN categories c ON c.id = i.category_id""")},
        "categories": [{"name": n, "parent": p or ""} for n, p in _rows(db, """
            SELECT c.name, p.name FROM categories c LEFT JOIN categories p ON p.id = c.parent_id ORDER BY 2 NULLS FIRST, 1""")],
        "locations": {code: {"name": name, "type": typ, "parent": parent or ""} for code, name, typ, parent in _rows(db, """
            SELECT l.code, l.name, l.location_type, p.code FROM locations l LEFT JOIN locations p ON p.id = l.parent_id""")},
        "partners": [r[0] for r in _rows(db, "SELECT name FROM partners ORDER BY name")],
        "colors": [r[0] for r in _rows(db, "SELECT code FROM colors ORDER BY code")],
        "materials": _attr_values(db, "material"),
        "sizes": [r[0] for r in _rows(db, "SELECT name FROM sizes ORDER BY sort_order, name")],
        "wash_baths": _attr_values(db, "wash_bath"),
        "finishing_steps": _attr_values(db, "finishing_step"),
        "batch_numbers": [r[0] for r in _rows(db, "SELECT batch_number FROM batches")],
        "uoms": [r[0] for r in _rows(db, "SELECT name FROM uoms ORDER BY name")],
        "bom_items": sorted({r[0] for r in _rows(db, "SELECT i.code FROM boms b JOIN items i ON i.id = b.item_id")}),
    }


if __name__ == "__main__":
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        json.dump(build_snapshot(db), sys.stdout, ensure_ascii=False)
