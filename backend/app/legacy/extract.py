"""Slice the in-scope tables out of the legacy dump into JSON-lines files.

    cd backend && python3 -m app.legacy.extract <dump.sql> <work_dir>

Writes <work>/tables/<table>.jsonl for the master tables and the stock table,
ww_snr filtered to the lots ww_li names, and two activity indexes read from
tables that are otherwise not migrated: item_last_move.json (ww_we) and
partner_last_doc.json (ww_vg), both {key: "YYYY-MM"}. stdlib only.
"""
from __future__ import annotations

import json
import os
import sys

from app.legacy.dump_reader import index_tables, iter_rows

TABLES = ["ww_art", "ww_artg", "ww_adr", "ww_lag", "ww_lagf", "ww_li", "ww_set", "ww_mtxz"]


def _month(*vals) -> str:
    return max((str(v)[:7] for v in vals if v), default="")


def _last_by(rows, key: str, *date_cols: str) -> dict[str, str]:
    last: dict[str, str] = {}
    for r in rows:
        k, d = r.get(key), _month(*(r.get(c) for c in date_cols))
        if k and d and d > last.get(k, ""):
            last[k] = d
    return last


def extract(dump_path: str, work_dir: str) -> None:
    out = os.path.join(work_dir, "tables")
    os.makedirs(out, exist_ok=True)
    idx = index_tables(dump_path)

    def rows(table):
        if table not in idx:
            print(f"  {table}: not in dump, skipped", file=sys.stderr)
            return iter(())
        return iter_rows(dump_path, *idx[table])

    def write(table, it):
        n = 0
        with open(os.path.join(out, f"{table}.jsonl"), "w", encoding="utf-8") as f:
            for r in it:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
                n += 1
        print(f"  {table}: {n} rows")

    for t in TABLES:
        write(t, rows(t))

    with open(os.path.join(out, "ww_li.jsonl"), encoding="utf-8") as f:
        lots = {(r["Li_artnr"], r["Li_sernr"]) for r in map(json.loads, f) if (r.get("Li_sernr") or "").strip()}
    write("ww_snr", (r for r in rows("ww_snr") if (r.get("Snr_artnr"), r.get("Snr_sernr")) in lots))

    for name, table, key, cols in [
        ("item_last_move.json", "ww_we", "We_artnr", ("We_datum",)),
        ("partner_last_doc.json", "ww_vg", "Vg_adrnr", ("Vg_anl", "Vg_aend")),
    ]:
        last = _last_by(rows(table), key, *cols)
        with open(os.path.join(work_dir, name), "w", encoding="utf-8") as f:
            json.dump(last, f, ensure_ascii=False)
        print(f"  {name}: {len(last)} keys")


if __name__ == "__main__":
    extract(sys.argv[1], sys.argv[2])
