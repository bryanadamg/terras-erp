"""The live-event contract: every broadcast type must be registered, and vice versa.

`core/ws_events.can_receive` DENIES any event type it doesn't know, so a new
`manager.broadcast({"type": "X"})` that nobody adds to EVENT_PERMISSIONS reaches
no client at all — no error, no log, just a screen that quietly stops updating.
Broadcasts are hand-placed at ~117 call sites, so that omission is a matter of
time. This test makes it a red build instead.

It reads the source rather than importing and calling anything: the call sites
are spread across 20 routers and only fire on real mutations, so static analysis
is the only way to see all of them at once.
"""
import ast
import pathlib

import app
from app.core.ws_events import EVENT_PERMISSIONS

APP_DIR = pathlib.Path(app.__file__).parent


def _broadcast_calls():
    """Every broadcast call in the app package: `*.broadcast(...)` and the sync
    bridge `broadcast_sync(...)` the master-data routers use.

    Returns (types, dynamic) where `types` maps an event type string to the call
    sites that emit it, and `dynamic` lists sites whose payload this test could
    not read statically — those are reported rather than passed over, since an
    unreadable payload is exactly where an unregistered type would hide.
    """
    types: dict[str, list[str]] = {}
    dynamic: list[str] = []

    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        # The helper's own `manager.broadcast(event)` forwards its callers'
        # payloads, which are read at the call sites below instead.
        forwarding = {
            id(call)
            for fn in ast.walk(tree)
            if isinstance(fn, ast.AsyncFunctionDef) and fn.name == FORWARDER
            for call in ast.walk(fn)
            if isinstance(call, ast.Call)
        }
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or id(node) in forwarding:
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if isinstance(func, ast.Attribute) and name == "broadcast":
                payloads = node.args[:1]
            # `broadcast_sync(...)` is a plain name, not an attribute: the sync
            # master-data routers cannot await the manager, and their events are
            # just as undeliverable if the type goes unregistered.
            elif isinstance(func, ast.Name) and name == "broadcast_sync":
                payloads = node.args[:1]
            # kpi_service.invalidate_and_broadcast(db, *events)
            elif name == FORWARDER:
                payloads = node.args[1:]
            else:
                continue
            where = f"{path.relative_to(APP_DIR.parent)}:{node.lineno}"
            # A bare broadcast() has nothing to read; a forwarder call with no
            # events only invalidates KPIs, which is fine.
            if not payloads and name != FORWARDER:
                dynamic.append(where)
            for payload in payloads:
                _record(payload, where, types, dynamic)

    return types, dynamic


FORWARDER = "invalidate_and_broadcast"


def _record(payload, where, types, dynamic):
    """File one payload under its constant "type", or as unreadable."""
    if isinstance(payload, ast.Dict):
        for key, value in zip(payload.keys, payload.values):
            if isinstance(key, ast.Constant) and key.value == "type":
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    types.setdefault(value.value, []).append(where)
                    return
                break
    dynamic.append(where)


def test_every_broadcast_type_is_registered():
    """A broadcast type missing from EVENT_PERMISSIONS is undeliverable."""
    types, _ = _broadcast_calls()
    unregistered = {t: sites for t, sites in types.items() if t not in EVENT_PERMISSIONS}
    assert not unregistered, (
        "These event types are broadcast but not in EVENT_PERMISSIONS, so "
        "can_receive() drops them for every user:\n"
        + "\n".join(f"  {t}  <- {', '.join(sites)}" for t, sites in sorted(unregistered.items()))
    )


def test_registry_has_no_dead_entries():
    """A registered type nobody broadcasts is a typo or a leftover."""
    types, _ = _broadcast_calls()
    dead = sorted(set(EVENT_PERMISSIONS) - set(types))
    assert not dead, (
        "These types are in EVENT_PERMISSIONS but broadcast nowhere — a rename "
        "that missed the registry, or a stale entry:\n  " + "\n  ".join(dead)
    )


def test_every_broadcast_payload_is_statically_readable():
    """Guards the two tests above: they can only check payloads they can read."""
    _, dynamic = _broadcast_calls()
    assert not dynamic, (
        "These broadcast call sites don't pass a dict literal with a constant "
        '"type", so the registry checks above cannot see them. Use a literal:\n  '
        + "\n  ".join(dynamic)
    )


def test_every_registered_event_has_a_topic():
    """An event with no topic entry falls back to 'system', which every client
    subscribes to — so it would be delivered to every screen regardless of what
    that screen reads. Fine as a fallback, wrong as an accident."""
    from app.core.ws_events import EVENT_TOPICS

    missing = sorted(set(EVENT_PERMISSIONS) - set(EVENT_TOPICS))
    assert not missing, f"Registered events with no topic: {missing}"

    stray = sorted(set(EVENT_TOPICS) - set(EVENT_PERMISSIONS))
    assert not stray, f"Topics for events that aren't registered: {stray}"


def test_permission_unions_reference_real_codes():
    """Every code in the map must exist in the seeded permission catalog.

    A typo'd code is silently unsatisfiable — the event would be delivered to
    nobody but admins, which reads as "live updates are broken for this domain".
    """
    from app.db.init_db import init_db  # noqa: F401  (imports the seed module)
    import inspect

    from app.db import init_db as init_db_module

    source = inspect.getsource(init_db_module)
    seeded = set()
    for node in ast.walk(ast.parse(source)):
        # perms_data rows are ("code", "description") tuples.
        if isinstance(node, ast.Tuple) and len(node.elts) == 2:
            first = node.elts[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str) and "." in first.value:
                seeded.add(first.value)

    # Legacy blobs are deliberately not re-seeded (see init_db's comment); they
    # live in the DB from before the granular taxonomy, so exempt them here.
    from app.core.ws_events import LEGACY_IMPLIES

    used = {code for codes in EVENT_PERMISSIONS.values() for code in codes}
    used |= {code for codes in LEGACY_IMPLIES.values() for code in codes}
    unknown = sorted(used - seeded - set(LEGACY_IMPLIES))
    assert not unknown, f"Permission codes referenced by ws_events but never seeded: {unknown}"
