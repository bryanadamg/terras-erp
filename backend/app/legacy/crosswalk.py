"""Crosswalks: the human-reviewed mapping from legacy codes onto what Terras already holds.

    cd backend && python3 -m app.legacy.crosswalk suggest <work_dir> <snapshot.json> [--since 2025-03] [--partner-since 2024-03]

`suggest` writes <work>/crosswalk/*.csv pre-filled wherever a match is certain
and blank wherever a person has to decide. It never overwrites a CSV that
already exists — re-running only adds the rows that are new (new bins, new
groups since the last dump), so review work is never lost. `load_crosswalks`
reads the reviewed files back. stdlib only.
"""
from __future__ import annotations

import csv
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field

LABDIP = "LABDIP"
SIZE_SUFFIX = re.compile(r"^(.*\S) (S|M|L|XL|XXL|XXXL|[2-5]XL|\d{2,3})$")
SIZE_ALIASES = {"XXL": "2XL", "XXXL": "3XL"}
_PARTNER_NOISE = re.compile(r"\b(PT|CV|UD|TBK)\b")


def read_table(work_dir: str, name: str) -> list[dict]:
    with open(os.path.join(work_dir, "tables", f"{name}.jsonl"), encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def read_json(work_dir: str, name: str):
    with open(os.path.join(work_dir, name), encoding="utf-8") as f:
        return json.load(f)


def is_recipe_edge(e: dict) -> bool:
    slot = e.get("set_nr") or ""
    return "Dyes" in slot or "Chem" in slot


def _key(s) -> str:
    return re.sub(r"[^0-9A-Z]", "", str(s or "").upper())


def partner_key(name: str) -> str:
    return _key(_PARTNER_NOISE.sub(" ", str(name or "").upper()))


def stocked_codes(li: list[dict]) -> set[str]:
    return {r["Li_artnr"] for r in li if (r.get("Li_stck") or 0) > 0}


def select_items(art: dict, li: list, set_rows: list, last_move: dict, since: str) -> set[str]:
    """Legacy item codes that become Terras items: stocked, or moved since `since`,
    plus the components of their BOMs and of every lab dip recipe. Lab dips
    themselves become colours, not items."""
    labdip = {k for k, a in art.items() if a.get("Art_gruppe") == LABDIP}
    active = stocked_codes(li) | {k for k, d in last_move.items() if d >= since}
    need = set(active)
    for e in set_rows:
        parent = e.get("set_artnr_h")
        if is_recipe_edge(e) or parent in active:
            need.add(e.get("set_artnr_u"))
    return {k for k in need if k in art} - labdip


def size_suffix(code: str):
    m = SIZE_SUFFIX.match(code or "")
    return (m.group(1), m.group(2)) if m else (code, None)


def category_paths(snapshot: dict) -> dict[str, str]:
    """Normalised category name -> 'Parent > Name' path (unique names only)."""
    seen: dict[str, list[str]] = defaultdict(list)
    for c in snapshot["categories"]:
        seen[_key(c["name"])].append(f'{c["parent"]} > {c["name"]}' if c["parent"] else c["name"])
    return {k: v[0] for k, v in seen.items() if len(v) == 1}


def _write_new_rows(path: str, header: list[str], rows: list[dict], key: tuple[str, ...]) -> None:
    existing: list[dict] = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            existing = list(csv.DictReader(f))
    have = {tuple(r[k] for k in key) for r in existing}
    added = [r for r in rows if tuple(str(r[k]) for k in key) not in have]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=header)
        w.writeheader()
        w.writerows(existing + added)
    print(f"  {os.path.basename(path)}: {len(existing)} kept, {len(added)} new")


def suggest(work_dir: str, snapshot: dict, since: str, partner_since: str) -> None:
    out = os.path.join(work_dir, "crosswalk")
    os.makedirs(out, exist_ok=True)
    art = {a["Art_nr"]: a for a in read_table(work_dir, "ww_art")}
    groups = {g["Artg_nr"]: g for g in read_table(work_dir, "ww_artg")}
    li = read_table(work_dir, "ww_li")
    set_rows = read_table(work_dir, "ww_set")
    scope = select_items(art, li, set_rows, read_json(work_dir, "item_last_move.json"), since)

    # locations: one row per stocked legacy (warehouse, bin)
    stock = Counter()
    lots: dict[tuple, set] = defaultdict(set)
    for r in li:
        if (r.get("Li_stck") or 0) > 0:
            k = (r["Li_lagnr"], r.get("Li_lagfnr") or "")
            stock[k] += 1
            if (r.get("Li_sernr") or "").strip():
                lots[k].add((r["Li_artnr"], r["Li_sernr"]))
    locs = snapshot["locations"]
    rows = []
    for (wh, b), n in sorted(stock.items()):
        target = b if b in locs else wh if wh in locs else ""
        rows.append({"legacy_wh": wh, "legacy_bin": b, "stock_rows": n, "lots": len(lots[(wh, b)]),
                     "action": "MAP" if target else "", "terras_location_code": target, "new_bin_name": ""})
    _write_new_rows(os.path.join(out, "locations.csv"),
                    ["legacy_wh", "legacy_bin", "stock_rows", "lots", "action", "terras_location_code", "new_bin_name"],
                    rows, ("legacy_wh", "legacy_bin"))

    # categories
    paths = category_paths(snapshot)
    gcount = Counter(art[k].get("Art_gruppe") or "" for k in scope)
    rows = []
    for g, n in gcount.most_common():
        meta = groups.get(g, {})
        hit = paths.get(_key(g)) or paths.get(_key(meta.get("Artg_name")), "")
        rows.append({"legacy_group": g, "legacy_parent": meta.get("Artg_parent") or "", "item_count": n, "terras_category": hit})
    _write_new_rows(os.path.join(out, "categories.csv"),
                    ["legacy_group", "legacy_parent", "item_count", "terras_category"], rows, ("legacy_group",))

    # units
    uoms = {u.lower(): u for u in snapshot["uoms"]}
    ucount = Counter(art[k].get("Art_einheit") or "" for k in scope)
    _write_new_rows(os.path.join(out, "uoms.csv"), ["legacy_unit", "item_count", "terras_uom"],
                    [{"legacy_unit": u, "item_count": n, "terras_uom": uoms.get(u.lower(), "")} for u, n in ucount.most_common()],
                    ("legacy_unit",))

    # materials (Art_flds00)
    mats = {_key(m): m for m in snapshot["materials"]}
    mcount = Counter(art[k].get("Art_flds00") for k in scope if (art[k].get("Art_flds00") or "").strip())
    _write_new_rows(os.path.join(out, "materials.csv"), ["legacy_flds00", "item_count", "terras_material"],
                    [{"legacy_flds00": m, "item_count": n, "terras_material": mats.get(_key(m), "")} for m, n in mcount.most_common()],
                    ("legacy_flds00",))

    # sizes
    sizes = set(snapshot["sizes"])
    scount = Counter(s for s in (size_suffix(k)[1] for k in scope) if s)
    rows = []
    for s, n in scount.most_common():
        t = SIZE_ALIASES.get(s, s)
        letter = not s.isdigit()
        rows.append({"legacy_suffix": s, "item_count": n, "terras_size": t if (t in sizes or not letter) else "",
                     "collapse": "yes" if letter and t in sizes else ""})
    _write_new_rows(os.path.join(out, "sizes.csv"), ["legacy_suffix", "item_count", "terras_size", "collapse"],
                    rows, ("legacy_suffix",))

    # wash / finishing texts on lab dips that carry a recipe
    recipe_parents = {e["set_artnr_h"] for e in set_rows if is_recipe_edge(e)}
    kinds: dict[str, Counter] = defaultdict(Counter)
    for k in recipe_parents:
        a = art.get(k) or {}
        for i in range(11, 20):
            t = (a.get(f"Art_flds{i:02d}") or "").strip()
            if t:
                kinds[t]["WASH" if i <= 16 else "FINISH"] += 1
    washes = {_key(v): v for v in snapshot["wash_baths"]}
    finishes = {_key(v): v for v in snapshot["finishing_steps"]}
    rows = []
    for t, c in sorted(kinds.items(), key=lambda kv: -sum(kv[1].values())):
        kind = c.most_common(1)[0][0]
        hit = (washes if kind == "WASH" else finishes).get(_key(t), "")
        rows.append({"legacy_text": t, "kind": kind, "item_count": sum(c.values()), "terras_value": hit})
    _write_new_rows(os.path.join(out, "wash_finish.csv"), ["legacy_text", "kind", "item_count", "terras_value"],
                    rows, ("legacy_text",))

    # partners
    snap_partners = {partner_key(p): p for p in snapshot["partners"]}
    last_doc = read_json(work_dir, "partner_last_doc.json")
    suppliers = {a.get("Art_adrnr") for a in art.values() if a.get("Art_adrnr")}
    rows = []
    for d in read_table(work_dir, "ww_adr"):
        nr, name = d["Adr_nr"], (d.get("Adr_name") or "").strip()
        hit = snap_partners.get(partner_key(name), "")
        recent = last_doc.get(nr, "") >= partner_since
        rows.append({"adr_nr": nr, "legacy_name": name, "last_doc": last_doc.get(nr, ""),
                     "action": "MAP" if hit else "CREATE" if recent else "SKIP", "terras_partner": hit,
                     "type": "SUPPLIER" if nr in suppliers else "CUSTOMER"})
    _write_new_rows(os.path.join(out, "partners.csv"),
                    ["adr_nr", "legacy_name", "last_doc", "action", "terras_partner", "type"], rows, ("adr_nr",))

    # finished goods whose BOM names a lab dip: the colour lives in the item today
    rows = []
    for e in set_rows:
        p, c = e.get("set_artnr_h"), e.get("set_artnr_u")
        if p in scope and not is_recipe_edge(e) and (art.get(c) or {}).get("Art_gruppe") == LABDIP:
            name, colour = art[p].get("Art_name") or "", (art[c].get("Art_name") or "").strip()
            base = name.split(colour, 1)[0].strip() if colour and colour in name else ""
            rows.append({"legacy_code": p, "legacy_name": name, "labdip_child": c, "base_code": base, "colour_code": colour})
    _write_new_rows(os.path.join(out, "fg_colour.csv"),
                    ["legacy_code", "legacy_name", "labdip_child", "base_code", "colour_code"], rows, ("legacy_code",))


@dataclass
class Crosswalks:
    locations: dict = field(default_factory=dict)    # (wh, bin) -> (action, terras_code, new_bin_name)
    categories: dict = field(default_factory=dict)   # group -> "Parent > Name" path ('' = unmapped)
    uoms: dict = field(default_factory=dict)         # legacy unit -> terras uom
    materials: dict = field(default_factory=dict)    # flds00 -> terras material ('' = create as-is)
    sizes: dict = field(default_factory=dict)        # suffix -> (terras size, collapse?)
    wash_finish: dict = field(default_factory=dict)  # text -> (WASH|FINISH, terras value ('' = create as-is))
    partners: dict = field(default_factory=dict)     # adr_nr -> (action, terras name, type)
    fg_colour: dict = field(default_factory=dict)    # legacy code -> (base code, colour code); only reviewed rows


def load_crosswalks(work_dir: str) -> Crosswalks:
    def rows(name):
        with open(os.path.join(work_dir, "crosswalk", name), encoding="utf-8") as f:
            return [{k: (v or "").strip() for k, v in r.items()} for r in csv.DictReader(f)]

    return Crosswalks(
        locations={(r["legacy_wh"], r["legacy_bin"]): (r["action"].upper(), r["terras_location_code"], r["new_bin_name"])
                   for r in rows("locations.csv")},
        categories={r["legacy_group"]: r["terras_category"] for r in rows("categories.csv")},
        uoms={r["legacy_unit"]: r["terras_uom"] for r in rows("uoms.csv")},
        materials={r["legacy_flds00"]: r["terras_material"] for r in rows("materials.csv")},
        sizes={r["legacy_suffix"]: (r["terras_size"], r["collapse"].lower() == "yes") for r in rows("sizes.csv")},
        wash_finish={r["legacy_text"]: (r["kind"].upper(), r["terras_value"]) for r in rows("wash_finish.csv")},
        partners={r["adr_nr"]: (r["action"].upper(), r["terras_partner"], r["type"].upper()) for r in rows("partners.csv")},
        fg_colour={r["legacy_code"]: (r["base_code"], r["colour_code"]) for r in rows("fg_colour.csv")
                   if r["base_code"] and r["colour_code"]},
    )


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["suggest"])
    ap.add_argument("work_dir")
    ap.add_argument("snapshot")
    ap.add_argument("--since", default="2025-03")
    ap.add_argument("--partner-since", default="2024-03")
    a = ap.parse_args()
    with open(a.snapshot, encoding="utf-8") as f:
        suggest(a.work_dir, json.load(f), a.since, a.partner_since)
