"""Delivery-side ACL for live events: who may receive which broadcast.

`/api/ws/events` is one global fan-out — every `manager.broadcast(...)` reached
every open socket, so a picker's browser received (and toasted) manufacturing
order codes and statuses it has no permission to open. This module is the filter:
the socket is authenticated at connect (`api/auth.ws_connection_state`), its
effective permission codes are snapshotted onto the connection, and
`ws_manager._local_broadcast` drops any event that connection may not see.

Each entry is a UNION — hold ANY listed code and the event is delivered. That
mirrors the read-side GETs, which are gated with unions of the same granular
codes. Codes come from the seed list in `db/init_db.py`; the legacy blob
`sales.manage` appears wherever the matching page is still gated on it (Packing
Orders, Pick Lists, Dispatch).

The unions are wider than the page that owns the event, on purpose: a WO event
moves the MO board, a stock event moves the work queue. The rule for adding a
code is "this event changes something that role can already see", not "this role
owns the domain".

An empty tuple means "any authenticated user" — only for events whose payload
carries no business data.

Unknown event types are DENIED, never delivered. A new broadcast type is
invisible to every client until it is listed here, so the failure mode of
forgetting is a stale UI, not a leak. ADD THE TYPE HERE whenever you add a new
`manager.broadcast({"type": ...})`.
"""

ADMIN_CODE = "admin.access"

EVENT_PERMISSIONS: dict[str, tuple[str, ...]] = {
    # ── Manufacturing ────────────────────────────────────────────────────────
    # The MO board, the PR page, the WO list and the weaving monitor all refetch
    # off these (frontend LiveKind 'production'). reports.view is deliberately
    # ABSENT: a dashboard-only user's KPIs refresh from KPI_UPDATE below, so
    # they never need the MO code/status payload.
    "MANUFACTURING_ORDER_UPDATE": (
        "manufacturing_order.view",
        "production_run.view",
        "work_order.view",
        "weaving_monitor.view",
        "dyeing_monitor.view",
    ),
    "WORK_ORDER_UPDATE": (
        "work_order.view",
        "manufacturing_order.view",
        "weaving_monitor.view",
        "beam.view",
    ),
    "PRODUCTION_RUN_UPDATE": (
        "production_run.view",
        "manufacturing_order.view",
        "sales_order.view",
    ),
    "WEAVING_RUN_UPDATE": (
        "weaving_monitor.view",
        "work_order.view",
        "beam.view",
    ),
    # The dye vessel grid. Its numerator moves on MANUFACTURING_ORDER_UPDATE above
    # (a logged completion), so this one carries only the run's own lifecycle --
    # start, complete, and a corrected rpm/lines.
    "DYEING_RUN_UPDATE": (
        "dyeing_monitor.view",
        "work_order.view",
        "dye_order.view",
    ),
    # ── Stock ────────────────────────────────────────────────────────────────
    # Widest union in the map: 19 broadcast sites across production, packing and
    # dispatch land here, and the MO/PR pages re-pull stock balances off it too.
    "STOCK_UPDATE": (
        "stock_on_hand.view",
        "stock_ledger.view",
        "booking_stock.view",
        "lot.view",
        "quarantine.view",
        "work_order.view",
        "manufacturing_order.view",
        "production_run.view",
    ),
    "QUARANTINE_UPDATE": (
        "quarantine.view",
        "lot.view",
        "stock_on_hand.view",
    ),
    # ── Sales / outbound ─────────────────────────────────────────────────────
    "SALES_ORDER_UPDATE": ("sales_order.view", "sales.manage"),
    "PACKING_UPDATE": ("sales.manage", "sales_order.view", "shipment.view", "pick_list.scan"),
    "PICK_LIST_UPDATE": ("sales.manage", "pick_list.scan", "shipment.view", "sales_order.view"),
    "SHIPMENT_UPDATE": ("shipment.view", "sales.manage"),
    # ── Masters ──────────────────────────────────────────────────────────────
    "BOM_UPDATE": (
        "bom.view",
        "manufacturing_order.view",
        "production_run.view",
        "sales_order.view",
    ),
    "COLOR_UPDATE": (
        "color_code.view",
        "lab_dip_request.view",
        "dye_recipe.view",
        "item.view",
    ),
    "COMBO_UPDATE": ("combo_library.view", "item.view", "bom.view"),
    # The box master changed. `sales.manage` is on the list because the pack
    # screens (not just the master page) read it — their picker and the tare that
    # makes every carton's brutto come from these rows.
    "PACKAGING_TYPE_UPDATE": ("packaging_type.view", "sales.manage"),
    # ── Platform ─────────────────────────────────────────────────────────────
    "KPI_UPDATE": ("reports.view",),
    # A print layout changed. Carries no business data and every print modal in
    # the app reads templates, so this one is open to any authenticated user.
    "PRINT_TEMPLATE_UPDATE": (),
    # Master data changed: an attribute value, a unit, a location, a work
    # center/operation, a partner, an item, or a category. The payload is the domain name and
    # nothing else — no codes, no names — and these rows feed the dropdowns on
    # nearly every form, so it is open to any authenticated user.
    "MASTER_DATA_UPDATE": (),
}


# Event type -> topic. Topics are the axis a CLIENT filters on, and they are
# deliberately the frontend's own `LiveKind` names plus 'system': the client
# already routes every event into one of those buckets to decide what to refetch,
# so a second vocabulary here would just be a mapping to get wrong. Permission
# filtering (above) says what a user MAY see; topics say what their current
# screen NEEDS. Both must pass.
#
# 'system' is for events every screen wants regardless of route (a print layout
# changed); clients subscribe to it unconditionally.
EVENT_TOPICS: dict[str, str] = {
    "MANUFACTURING_ORDER_UPDATE": "production",
    "WORK_ORDER_UPDATE": "production",
    "PRODUCTION_RUN_UPDATE": "production",
    "WEAVING_RUN_UPDATE": "weaving",
    "DYEING_RUN_UPDATE": "dyeing",
    "STOCK_UPDATE": "stock",
    "QUARANTINE_UPDATE": "stock",
    "SALES_ORDER_UPDATE": "sales",
    "PACKING_UPDATE": "sales",
    "PICK_LIST_UPDATE": "sales",
    "SHIPMENT_UPDATE": "sales",
    "BOM_UPDATE": "bom",
    "COLOR_UPDATE": "bom",
    "COMBO_UPDATE": "bom",
    # 'sales' rather than 'bom': the screens that must re-read a changed tare are
    # the packing ones.
    "PACKAGING_TYPE_UPDATE": "sales",
    "KPI_UPDATE": "kpi",
    "PRINT_TEMPLATE_UPDATE": "system",
    # 'system': master data is read by every screen, not by one route.
    "MASTER_DATA_UPDATE": "system",
}

TOPICS: frozenset[str] = frozenset(EVENT_TOPICS.values())


def wants_topic(event_type: str, topics: set[str] | None) -> bool:
    """True if a connection subscribed to `topics` still wants `event_type`.

    `topics is None` means the client has not sent a subscribe frame — deliver
    everything. That is the fail-safe direction and the pre-subscription default:
    a client that never learns to subscribe keeps working exactly as before, and
    a client that subscribes late doesn't miss the window in between.
    """
    if topics is None:
        return True
    return EVENT_TOPICS.get(event_type, "system") in topics


# The registry of every event type this backend may broadcast. Being absent from
# EVENT_PERMISSIONS is not a "default allow" — can_receive() denies it — so this
# set IS the list of deliverable events, and tests/test_ws_event_registry.py
# asserts it matches the broadcast call sites in both directions.
EVENT_TYPES: frozenset[str] = frozenset(EVENT_PERMISSIONS)


# Legacy broad code -> the view codes it used to imply. Alembic 2afd23590ae8
# granted these supersets to every ROLE holding a legacy code, but it did not
# touch user_permissions, so a DIRECT grant of e.g. work_order.manage never got
# its granular equivalents. Such a user is already 403'd by the granular route
# checks, so this is belt-and-braces rather than the fix for that — but without
# it they would ALSO go silently dark on live updates, which is the harder
# failure to diagnose. Only the view-side codes are listed: nothing here decides
# whether an action is allowed, only whether an event is delivered.
LEGACY_IMPLIES: dict[str, tuple[str, ...]] = {
    "work_order.manage": (
        "work_order.view", "manufacturing_order.view", "production_run.view",
        "weaving_monitor.view", "beam.view",
    ),
    "manufacturing.manage": ("bom.view", "routing.view"),
    "inventory.manage": ("item.view", "combo_library.view", "lot.view", "stock_on_hand.view"),
    "stock.entry": ("stock_on_hand.view",),
    "locations.manage": ("location.view",),
    "dyeing.manage": ("dye_recipe.view", "color_code.view", "lab_dip_request.view"),
    "sales.manage": ("sales_order.view", "customer.view", "sample_request.view"),
    "purchasing.manage": ("purchase_order.view", "supplier.view"),
}


def expand_permissions(codes: set[str]) -> set[str]:
    """Add the granular view codes implied by any legacy broad code held."""
    expanded = set(codes)
    for legacy, implied in LEGACY_IMPLIES.items():
        if legacy in codes:
            expanded.update(implied)
    return expanded


def can_receive(event_type: str, perms: set[str]) -> bool:
    """True if a connection holding `perms` may be sent `event_type`.

    `admin.access` short-circuits everything, matching `auth.user_has_permission`.
    """
    if ADMIN_CODE in perms:
        return True
    required = EVENT_PERMISSIONS.get(event_type)
    if required is None:
        return False
    if not required:
        return True
    return any(code in perms for code in required)
