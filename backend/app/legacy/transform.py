"""Turn legacy rows into a bundle in Terras vocabulary.

    cd backend && python3 -m app.legacy.transform <work_dir> [--since 2025-03]

Pure functions over the extracted tables, the reviewed crosswalks and a Terras
master snapshot. Anything that cannot be translated goes to `rejects` with a
reason instead of being guessed. stdlib only.
"""
from __future__ import annotations

from collections import defaultdict

from app.legacy.crosswalk import Crosswalks, size_suffix


def reject(entity: str, key: str, reason: str) -> dict:
    return {"entity": entity, "key": key, "reason": reason}


def size_family(code: str, xw: Crosswalks):
    """(base code, Terras size) when the suffix is an approved size, else (code, None)."""
    base, suffix = size_suffix(code)
    size, collapse = xw.sizes.get(suffix or "", ("", False))
    return (base, size) if suffix and collapse and size else (code, None)


def base_of(code: str, xw: Crosswalks):
    """(base code, size, colour) a legacy item folds into."""
    if code in xw.fg_colour:
        base, colour = xw.fg_colour[code]
        return base, None, colour
    base, size = size_family(code, xw)
    return base, size, None


def build_items(codes, art: dict, xw: Crosswalks, snapshot: dict, lotted=frozenset()):
    groups: dict[str, list[str]] = defaultdict(list)
    for code in sorted(codes):
        groups[base_of(code, xw)[0]].append(code)
    size_order = {s: i for i, s in enumerate(snapshot["sizes"])}
    items, rejects = [], []
    for base, members in sorted(groups.items()):
        info = [base_of(m, xw) for m in members]
        sizes = sorted({s for _, s, _ in info if s}, key=lambda s: (size_order.get(s, 99), s))
        first = art[members[0]]
        flds00 = next((art[m].get("Art_flds00") for m in members if (art[m].get("Art_flds00") or "").strip()), None)
        item = {
            "code": base, "sizes": sizes, "legacy_codes": members,
            "lot_tracked": any(m in lotted for m in members),
            "variant_type": "color" if any(c for _, _, c in info) else None,
            "material": (xw.materials.get(flds00) or flds00) if flds00 else None,
        }
        if base in snapshot["items"]:
            s = snapshot["items"][base]
            items.append(dict(item, status="MATCHED", name=s["name"], uom=s["uom"], category=s["category"]))
            continue
        group, unit = first.get("Art_gruppe") or "", first.get("Art_einheit") or ""
        if not xw.categories.get(group):
            rejects += [reject("item", m, f"no category crosswalk for group {group}") for m in members]
            continue
        if not xw.uoms.get(unit):
            rejects += [reject("item", m, f"no uom crosswalk for unit {unit}") for m in members]
            continue
        if base in art:
            name = art[base].get("Art_name") or base
        elif sizes:
            name = size_suffix(first.get("Art_name") or base)[0]
        else:
            name = base
        items.append(dict(item, status="NEW", name=name, uom=xw.uoms[unit], category=xw.categories[group]))
    return items, rejects
