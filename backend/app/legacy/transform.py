"""Turn legacy rows into a bundle in Terras vocabulary.

    cd backend && python3 -m app.legacy.transform <work_dir> [--since 2025-03]

Pure functions over the extracted tables, the reviewed crosswalks and a Terras
master snapshot. Anything that cannot be translated goes to `rejects` with a
reason instead of being guessed. stdlib only.
"""
from __future__ import annotations

import hashlib
import re
from collections import defaultdict

from app.legacy.crosswalk import LABDIP, Crosswalks, is_recipe_edge, size_suffix


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
        group, unit = (first.get("Art_gruppe") or "").strip(), (first.get("Art_einheit") or "").strip()
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


def _slug(name: str) -> str:
    return re.sub(r"\s+", "-", name.strip()).upper()


def build_locations(xw: Crosswalks, snapshot: dict):
    """(bins to create, {(legacy_wh, legacy_bin): Terras location code or None for SKIP})."""
    locs = snapshot["locations"]
    new: dict[str, dict] = {}
    mapping: dict[tuple, str | None] = {}
    for (wh, b), (action, target, new_name) in sorted(xw.locations.items()):
        where = f"{wh}/{b}" if b else wh
        if action == "SKIP":
            mapping[(wh, b)] = None
        elif action == "MAP":
            if target not in locs:
                raise ValueError(f"locations.csv {where}: MAP target {target!r} is not a Terras location")
            mapping[(wh, b)] = target
        elif action == "CREATE_BIN":
            if (locs.get(target) or {}).get("type") != "zone":
                raise ValueError(f"locations.csv {where}: CREATE_BIN parent {target!r} must be an existing zone")
            name = new_name or b or wh
            code = f"{target}-{_slug(name)}"
            if len(code) > 64:
                raise ValueError(f"locations.csv {where}: new bin code {code!r} is longer than 64 characters")
            new.setdefault(code, {"code": code, "name": name, "parent_code": target})
            mapping[(wh, b)] = code
        else:
            raise ValueError(f"locations.csv {where}: action must be MAP, CREATE_BIN or SKIP (got {action!r})")
    return list(new.values()), mapping


def build_partners(adr: list[dict], xw: Crosswalks) -> list[dict]:
    out = []
    for d in adr:
        action, terras, ptype = xw.partners.get(d["Adr_nr"], ("SKIP", "", ""))
        if action == "MAP":
            out.append({"name": terras, "status": "MATCHED", "legacy_code": d["Adr_nr"]})
        elif action == "CREATE":
            g = lambda k: (d.get(k) or "").strip() or None
            city = " ".join(filter(None, [g("Adr_plz"), g("Adr_ort")]))
            out.append({"name": g("Adr_name"), "status": "NEW", "legacy_code": d["Adr_nr"],
                        "type": ptype if ptype in ("CUSTOMER", "SUPPLIER") else "CUSTOMER",
                        "address": ", ".join(filter(None, [g("Adr_str"), city])) or None,
                        "phone": g("Adr_tel"), "fax": g("Adr_fax"), "email": g("Adr_email"),
                        "contact_person": g("Adr_parname")})
    return out


def _labdips(art: dict) -> dict[str, dict]:
    return {k: a for k, a in art.items() if a.get("Art_gruppe") == LABDIP}


def build_colors(art: dict, set_rows: list, snapshot: dict, xw: Crosswalks) -> list[dict]:
    """One colour per lab dip that carries a recipe or is the colour of a collapsed FG item."""
    with_recipe = {e["set_artnr_h"] for e in set_rows if is_recipe_edge(e)}
    fg_colours = {c for _, c in xw.fg_colour.values()}
    have = set(snapshot["colors"])
    out: dict[str, dict] = {}
    for k, a in sorted(_labdips(art).items()):
        code = (a.get("Art_name") or "").strip()
        if code and (k in with_recipe or code in fg_colours) and code not in out:
            out[code] = {"code": code, "name": code, "legacy_code": k, "status": "MATCHED" if code in have else "NEW"}
    return list(out.values())


def _slot(set_nr: str) -> int:
    m = re.match(r"\s*(\d+)", set_nr or "")
    return int(m.group(1)) if m else 99


def build_recipes(art: dict, set_rows: list, xw: Crosswalks):
    edges: dict[str, list[dict]] = defaultdict(list)
    for e in set_rows:
        if is_recipe_edge(e):
            edges[e["set_artnr_h"]].append(e)
    recipes, rejects = [], []
    for parent, lines in sorted(edges.items()):
        a = art.get(parent) or {}
        code = (a.get("Art_name") or "").strip()
        if a.get("Art_gruppe") != LABDIP or not code:
            rejects.append(reject("recipe", parent, "recipe parent is not a named lab dip"))
            continue
        out_lines = []
        for e in sorted(lines, key=lambda e: (_slot(e["set_nr"]), e["set_nr"])):
            child = e["set_artnr_u"]
            if child not in art:
                rejects.append(reject("recipe_line", f"{parent}/{child}", "component not in item master"))
            elif not (e.get("set_stck") or 0) > 0:
                rejects.append(reject("recipe_line", f"{parent}/{child}", "non-positive qty"))
            else:
                out_lines.append({"item_code": child, "qty_per_liter": e["set_stck"],
                                  "chemical_type": "DYE" if "Dyes" in e["set_nr"] else "OTHER",
                                  "sort_order": len(out_lines)})
        wash, finish = [], []
        for i in range(11, 20):
            text = (a.get(f"Art_flds{i:02d}") or "").strip()
            if not text:
                continue
            kind, value = xw.wash_finish.get(text, ("WASH" if i <= 16 else "FINISH", ""))
            if kind == "WASH":
                wash.append({"bath_number": len(wash) + 1, "value": value or text})
            else:
                finish.append({"sort_order": len(finish), "value": value or text})
        recipes.append({"color_code": code, "name": code, "notes": f"legacy:{parent}",
                        "lines": out_lines, "wash_baths": wash, "finishing": finish})
    return recipes, rejects


def batch_number_for(item_code: str, serial: str, taken: set, dup_serials: set) -> str:
    """The legacy serial when it is unique, else serial + legacy item code (Batch.batch_number is String(64))."""
    if serial not in taken and serial not in dup_serials:
        return serial
    candidate = f"{serial}-{item_code}"
    if len(candidate) <= 64:
        return candidate
    digest = hashlib.sha1(f"{item_code}|{serial}".encode()).hexdigest()[:8]
    return f"{serial[:64 - 9]}-{digest}"


def build_opening_stock(li: list, mapping: dict, items: list, xw: Crosswalks, snapshot: dict):
    item_of = {lc: it for it in items for lc in it["legacy_codes"]}
    owners: dict[str, set] = defaultdict(set)
    for r in li:
        if (r.get("Li_sernr") or "").strip():
            owners[r["Li_sernr"]].add(r["Li_artnr"])
    dup_serials = {s for s, arts in owners.items() if len(arts) > 1}
    taken = set(snapshot["batch_numbers"])
    rows, rejects = [], []
    for r in li:
        wh, b, art_nr, serial = r["Li_lagnr"], r.get("Li_lagfnr") or "", r["Li_artnr"], (r.get("Li_sernr") or "").strip()
        ref = f"{wh}|{b}|{art_nr}|{serial}"
        qty = r.get("Li_stck") or 0
        if qty <= 0:
            rejects.append(reject("stock", ref, "non-positive qty"))
            continue
        if (wh, b) not in mapping:
            rejects.append(reject("stock", ref, "no location crosswalk"))
            continue
        if mapping[(wh, b)] is None:
            rejects.append(reject("stock", ref, "store already live in Terras"))
            continue
        item = item_of.get(art_nr)
        if not item:
            rejects.append(reject("stock", ref, "item not migrated"))
            continue
        _, size, colour = base_of(art_nr, xw)
        rows.append({"ref": ref, "legacy_item": art_nr, "item_code": item["code"], "size": size, "color_code": colour,
                     "location_code": mapping[(wh, b)], "qty": qty, "uom": item["uom"],
                     "batch_number": batch_number_for(art_nr, serial, taken, dup_serials) if serial else None})
    return rows, rejects


def _percentages(lines: list[dict]) -> list[float]:
    """Legacy percentages when every line has one and they total ~100, else derived from qty.
    Rounded to 2 dp with the rounding remainder on the largest line, so the sum is exactly 100."""
    given = [l["pct"] for l in lines]
    if all(p > 0 for p in given) and abs(sum(given) - 100) <= 0.5:
        raw = given
    else:
        total = sum(l["qty"] for l in lines)
        raw = [l["qty"] / total * 100 for l in lines]
    scale = 100 / sum(raw)
    cents = [round(p * scale * 100) for p in raw]
    cents[cents.index(max(cents))] += 10000 - sum(cents)
    return [c / 100 for c in cents]


def build_boms(set_rows: list, items_by_legacy_code: dict, xw: Crosswalks, snapshot_bom_items: set, art: dict):
    """One Terras BOM per migrated base item, from the legacy plain-slot edges."""
    by_parent: dict[str, list[dict]] = defaultdict(list)
    for e in set_rows:
        if not is_recipe_edge(e):
            by_parent[e["set_artnr_h"]].append(e)
    rejects: list[dict] = []
    families: dict[str, list[tuple]] = defaultdict(list)    # base code -> [(size, legacy parent, lines)]
    for parent, edges in sorted(by_parent.items()):
        if parent not in art:
            rejects.append(reject("bom", parent, "parent not in item master"))
            continue
        if parent not in items_by_legacy_code:
            continue                                         # parent out of scope (inactive or itself rejected)
        lines: dict[str, dict] = {}
        bad = False
        for e in edges:
            slot, child = (e.get("set_nr") or "").strip(), e["set_artnr_u"]
            if slot:
                rejects.append(reject("bom_line", f"{parent}/{child}", f"alternative slot {slot}"))
            elif (art.get(child) or {}).get("Art_gruppe") == LABDIP:
                if parent not in xw.fg_colour:
                    rejects.append(reject("bom_line", f"{parent}/{child}", "colour edge without an fg_colour row"))
            elif child not in items_by_legacy_code:
                rejects.append(reject("bom", parent, f"component {child} not migrated"))
                bad = True
            else:
                code = items_by_legacy_code[child]["code"]
                line = lines.setdefault(code, {"item_code": code, "qty": 0.0, "pct": 0.0})
                line["qty"] += e.get("set_stck") or 0
                line["pct"] += e.get("set_stckproz") or 0
        if bad or not lines:
            continue
        base, size, _ = base_of(parent, xw)
        families[items_by_legacy_code[parent]["code"]].append((size, parent, list(lines.values())))

    boms = []
    for base, members in sorted(families.items()):
        members.sort(key=lambda m: (m[0] is None, m[1]))
        size0, parent0, lines = members[0]
        for _, parent, other in members[1:]:
            if {l["item_code"] for l in other} != {l["item_code"] for l in lines}:
                rejects.append(reject("bom", parent, "size-specific lines"))
        sizes = sorted({m[0] for m in members if m[0]})
        status = "MATCHED" if base in snapshot_bom_items else "NEW"
        if sum(l["qty"] for l in lines) <= 0 and not all(l["pct"] > 0 for l in lines):
            rejects.append(reject("bom", parent0, "zero quantity"))
            continue
        pcts = _percentages(lines)
        boms.append({"code": f"LEG-{base}", "item_code": base, "qty": 1, "status": status,
                     "size_mode": "sized" if sizes else "free", "sizes": sizes, "legacy_parent": parent0,
                     "lines": [{"item_code": l["item_code"], "qty": l["qty"], "percentage": p} for l, p in zip(lines, pcts)]})
    return boms, rejects


def run(work_dir: str, since: str) -> dict[str, int]:
    """Write <work>/bundle/*.json and rejects.csv; return counts per file."""
    import csv
    import json
    import os

    from app.legacy.crosswalk import category_paths, load_crosswalks, read_json, read_table, select_items

    art = {a["Art_nr"]: a for a in read_table(work_dir, "ww_art")}
    li, set_rows = read_table(work_dir, "ww_li"), read_table(work_dir, "ww_set")
    snapshot = read_json(work_dir, "snapshot.json")
    xw = load_crosswalks(work_dir)

    scope = select_items(art, li, set_rows, read_json(work_dir, "item_last_move.json"), since)
    lotted = {r["Li_artnr"] for r in li if (r.get("Li_sernr") or "").strip() and (r.get("Li_stck") or 0) > 0}
    items, rejects = build_items(scope, art, xw, snapshot, lotted=lotted)
    by_legacy = {lc: it for it in items for lc in it["legacy_codes"]}

    new_bins, mapping = build_locations(xw, snapshot)
    partners = build_partners(read_table(work_dir, "ww_adr"), xw)
    colors = build_colors(art, set_rows, snapshot, xw)
    recipes, r = build_recipes(art, set_rows, xw)
    rejects += r
    for rec in recipes:
        kept = [l for l in rec["lines"] if l["item_code"] in by_legacy]
        rejects += [reject("recipe_line", f'{rec["notes"][7:]}/{l["item_code"]}', "component not migrated")
                    for l in rec["lines"] if l["item_code"] not in by_legacy]
        rec["lines"] = [dict(l, item_code=by_legacy[l["item_code"]]["code"], sort_order=i) for i, l in enumerate(kept)]
    boms, r = build_boms(set_rows, by_legacy, xw, set(snapshot["bom_items"]), art)
    rejects += r
    stock, r = build_opening_stock(li, mapping, items, xw, snapshot)
    rejects += r

    known_paths = set(category_paths(snapshot).values())
    new_items = [i for i in items if i["status"] == "NEW"]
    categories = sorted({i["category"] for i in new_items} - known_paths)
    values = {
        "materials": sorted({i["material"] for i in new_items if i["material"]} - set(snapshot["materials"])),
        "sizes": sorted({s for i in items for s in i["sizes"]} - set(snapshot["sizes"])),
        "wash_baths": sorted({w["value"] for rc in recipes for w in rc["wash_baths"]} - set(snapshot["wash_baths"])),
        "finishing_steps": sorted({f["value"] for rc in recipes for f in rc["finishing"]} - set(snapshot["finishing_steps"])),
    }
    bundle = {"items": items, "categories": categories, "values": values, "locations": new_bins,
              "partners": partners, "colors": colors, "recipes": recipes, "boms": boms, "opening_stock": stock}
    out = os.path.join(work_dir, "bundle")
    os.makedirs(out, exist_ok=True)
    for name, data in bundle.items():
        with open(os.path.join(out, f"{name}.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=0)
    with open(os.path.join(out, "rejects.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["entity", "key", "reason"])
        w.writeheader()
        w.writerows(rejects)
    counts = {k: (sum(len(v) for v in d.values()) if isinstance(d, dict) else len(d)) for k, d in bundle.items()}
    counts["rejects"] = len(rejects)
    return counts


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("work_dir")
    ap.add_argument("--since", default="2025-03")
    a = ap.parse_args()
    for k, v in run(a.work_dir, a.since).items():
        print(f"  {k}: {v}")
