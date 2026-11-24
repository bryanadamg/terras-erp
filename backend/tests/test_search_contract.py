"""Every code a list row returns is placed in tests/search_contract.py — searchable,
or ignored with a reason. A new code on a screen must decide this up front instead
of waiting for the client to find the dead end (see search_contract's docstring)."""
import pytest
from fastapi.routing import APIRoute

from tests import search_contract as sc


def _route(path):
    from app.main import app
    return next((r for r in app.routes if isinstance(r, APIRoute) and r.path == path and "GET" in r.methods), None)


@pytest.mark.parametrize("name", sorted(sc.ENDPOINTS))
def test_every_row_identifier_is_placed(name):
    path = sc.ENDPOINTS[name][0]
    if path.endswith("/report/lines") or path.endswith("/report/receipts"):
        path = path.rsplit("/", 1)[0] + "/{kind}"
    route = _route(path)
    assert route is not None, f"{name}: no GET route {path} — update search_contract.ENDPOINTS"
    assert "search" in {p.name for p in route.dependant.query_params}, f"{name}: {path} has no search param"
    if route.response_model is None:
        pytest.skip(f"{path} has no response_model; search_audit.py covers it from live rows")
    rows = {p[len("items[]."):] for p in sc.identifier_paths(route.response_model) if p.startswith("items[].")}
    unplaced = sorted(p for p in rows if sc.classify(name, p) == "unclassified")
    assert not unplaced, (
        f"{name} rows return identifier fields nobody has placed: {unplaced}. Add each to its "
        f"`search` list in tests/search_contract.py (and make the endpoint's search match it) "
        f"or to its ignore dict with the reason."
    )
