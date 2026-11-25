"""Check every list search against live rows: each `search` field in
search_contract.ENDPOINTS must find the row it came from. Read-only.

    python3 -I backend/tests/search_audit.py <token> [endpoint ...] [--base URL]

Token for the local dev stack: .claude/skills/before-after/scripts/mint_token.sh
Exit 1 on any MISS (search can't find it) or UNCLASSIFIED (a live identifier the
contract doesn't place — e.g. inside a dict-typed field the schema test can't see).
"""
import importlib.util
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

_spec = importlib.util.spec_from_file_location("search_contract", pathlib.Path(__file__).with_name("search_contract.py"))
sc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sc)

args = sys.argv[1:]
base = "http://localhost:8000"
if "--base" in args:
    i = args.index("--base")
    base = args[i + 1]
    del args[i:i + 2]
token, only = args[0], set(args[1:])
SAMPLES_PER_FIELD = 3


def get(path, params):
    req = urllib.request.Request(f"{base}{path}?{urllib.parse.urlencode(params)}",
                                 headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        return {"__error__": f"{e.code} {e.read()[:200]!r}"}


def rows_of(body):
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ("items", "rows"):
            if isinstance(body.get(k), list):
                return body[k]
    return []


def identity(row):
    for k in ("id", "work_order_id", "wo_id", "mo_id", "batch_key", "key"):
        if row.get(k):
            return f"{k}={row[k]}"
    return json.dumps(row, sort_keys=True, default=str)


def idents(node, path=""):
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else k
            if isinstance(v, str) and v.strip() and sc.IDENT.search(k):
                yield sc.normalize(p), v
            elif isinstance(v, (dict, list)):
                yield from idents(v, p)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from idents(v, f"{path}[{i}]")


failed = False
for name, (path, extra, _search, _ignore) in sc.ENDPOINTS.items():
    if only and name not in only:
        continue
    body = get(path, {**extra, "page": 1, "size": 30})
    if isinstance(body, dict) and "__error__" in body:
        print(f"{name}: ERROR {body['__error__']}")
        failed = True
        continue
    rows = rows_of(body)
    misses, unclassified, samples, checked = {}, {}, {}, 0
    for row in rows:
        rid = identity(row)
        for field, value in idents(row):
            kind = sc.classify(name, field)
            if kind == "ignore":
                continue
            if kind == "unclassified":
                unclassified.setdefault(field, value)
                continue
            seen = samples.setdefault(field, set())
            if value in seen or len(seen) >= SAMPLES_PER_FIELD:
                continue
            seen.add(value)
            checked += 1
            # A scanner types with Caps Lock and a trailing space as often as not.
            for term in (value, f" {value.lower()} "):
                found = rows_of(get(path, {**extra, "search": term, "page": 1, "size": 200}))
                if rid not in {identity(r) for r in found}:
                    misses.setdefault(field, []).append(repr(term))
                    break
    bad = bool(misses or unclassified)
    failed |= bad
    print(f"{'FAIL' if bad else 'ok  '} {name}: {len(rows)} rows, {checked} codes checked")
    for f, vals in sorted(misses.items()):
        print(f"       MISS {f}: {', '.join(vals[:2])}")
    for f, v in sorted(unclassified.items()):
        print(f"       UNCLASSIFIED {f}: {v!r}")
sys.exit(1 if failed else 0)
