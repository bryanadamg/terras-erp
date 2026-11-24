"""Which codes each list screen's search box must find.

The rule: a code a person can read off a row — its own code, its lines', its
child orders', the sales order / lot / colour it shows — finds that row through
the screen's own search. Scanned SPK barcodes, Work Queue links and "I have this
lot number in my hand" all land on a list search, so a gap here is a dead end on
the floor. Every one of these used to be found one client report at a time.

Each endpoint lists every identifier field its rows return (paths as
`identifier_paths` prints them) under `search` or `ignore`:

* tests/test_search_contract.py fails when a response model grows an identifier
  field nobody has placed — decide it there, at the moment it is added.
* tests/search_audit.py checks the `search` fields actually find their row,
  against a running stack with real data (local dev DB). Run it before a release.
"""
import re
import typing

# Field names that hold a code a person reads, types or scans.
IDENT = re.compile(r"(^code$|_code$|_number$|^po_number$|customer_po_ref$|vendor_lot$)")

# Never searchable, on any screen: places, packaging and what an order consumed
# are not what identifies the order — searching "WIP-GD-BEAM" or a yarn code would
# match half the list.
IGNORE_EVERYWHERE = {
    "location_code": "a place, not a document",
    "location.code": "a place, not a document",
    "location.system_code": "a place, not a document",
    "packaging_type_code": "packaging master data",
    "actual_items[].item_code": "material consumed by a completion",
    "planned_components[].item_code": "material the order consumes",
    "bom.lines[].item_code": "material the order consumes",
    "materials[].item_code": "auxiliary material, not the order's substrate",
    "input_batch_number": "lot consumed, not produced",
    "uom_code": "unit of measure",
}

_MO = [  # an MO row, wherever one is nested
    "code", "item_code", "color_code", "labdip_variant_code", "production_run_code", "sales_order_code",
    "bom.code", "bom.item_code", "work_orders[].code",
    "completions[].output_batch_number", "batch_trace[].output_batch_number",
    "child_mos[].code", "child_mos[].item_code", "child_mos[].color_code", "child_mos[].labdip_variant_code",
    "child_mos[].production_run_code", "child_mos[].sales_order_code", "child_mos[].work_orders[].code",
    "child_mos[].completions[].output_batch_number", "child_mos[].batch_trace[].output_batch_number",
    "child_mos[].bom.code", "child_mos[].bom.item_code",
]
_PICK_LIST = ["code", "customer_po_ref", "sales_order_code",
              "lines[].batch_number", "lines[].item_code", "lines[].color_code", "lines[].carton_identity.color_code"]

# name: (GET path, extra query params, fields the search must find, {field: why not})
ENDPOINTS = {
    "items": ("/api/items", {}, ["code", "source_sample_code"], {}),
    "batches": ("/api/batches/paginated", {}, [
        "batch_number", "vendor_lot", "item_code", "color_code", "labdip_variant_code", "mo_code", "wo_code",
        "reserved_wo_code", "production_run_code", "sales_order_code", "po_number",
    ], {"mounted_wc_code": "the loom it sits on, a machine",
        "beam_components[].item_code": "yarn wound on the beam, consumed material"}),
    "boms": ("/api/boms/summary", {}, ["code", "item_code", "lines[].item_code"], {}),
    "colors": ("/api/colors", {}, ["code", "customer_color_code", "source_item_code", "source_lab_dip_code"], {}),
    "combos": ("/api/combos", {}, ["code"], {}),
    "dye_recipes": ("/api/dye-recipes", {}, ["code", "color_code"], {"wash_baths[].bath_number": "a step number"}),
    "lab_dips": ("/api/lab-dips", {}, [
        "code", "item_code", "variant_code", "locked_variant_code", "approved_color_code",
        "customer_article_code", "internal_article_code",
        "items[].item_code", "items[].variant_code", "items[].approved_color_code",
    ], {}),
    "samples": ("/api/samples", {}, ["code", "customer_article_code", "internal_article_code", "colors[].item_code"], {}),
    "sales_orders": ("/api/sales-orders", {}, [
        "po_number", "customer_po_ref", "lines[].item_code", "lines[].color_code", "lines[].labdip_variant_code",
        "production_runs[].code", "lines[].mo_progress.mo_code", "lines[].mo_progress.mos[].mo_code",
        "lines[].mo_progress.mos[].components[].mo_code", "lines[].mo_progress.mos[].steps[].code",
    ], {}),
    "production_runs": ("/api/production-runs", {}, [
        "code", "sales_order_code", "bom.code", "bom.item_code", "bom_entries[].bom.code",
        "bom_entries[].bom.item_code", "bom_entries[].labdip_variant_code",
        *[f"manufacturing_orders[].{f}" for f in _MO],
    ], {}),
    "manufacturing_orders": ("/api/manufacturing-orders", {}, _MO, {}),
    "work_orders": ("/api/work-orders", {}, [
        "code", "mo_code", "root_mo_code", "color_code", "labdip_variant_code", "completions[].output_batch_number",
    ], {}),
    "work_queue_dyeing": ("/api/work-queue", {"center_type": "DYEING"}, [
        "work_order_code", "mo_code", "item_code", "substrate_item_code", "color_code", "labdip_variant_code",
        "materials[].incoming_mo_code",
    ], {}),
    "work_queue_weaving": ("/api/work-queue", {"center_type": "WEAVING"}, [
        "work_order_code", "mo_code", "item_code", "substrate_item_code", "color_code", "labdip_variant_code",
        "materials[].incoming_mo_code",
    ], {}),
    "dyeing_monitor": ("/api/dyeing/monitor", {}, [
        "mo_code", "wo_code", "item_code", "color_code", "labdip_variant_code", "work_center_code",
    ], {}),
    "packing_orders": ("/api/packing", {}, [
        "code", "item_code", "color_code", "sales_order_code", "customer_po_ref",
        "packed_units[].batch_number", "packed_units[].item_code", "packed_units[].color_code",
        "packed_units[].packing_order_code", "completions[].source_batch_number",
    ], {}),
    "pick_lists": ("/api/pick-lists", {}, [*_PICK_LIST, "delivery_note_number", "shipment_code"], {}),
    "shipments": ("/api/shipments", {}, [
        "code", "delivery_note_number", *[f"pick_lists[].{f}" for f in _PICK_LIST],
    ], {}),
    "purchase_orders": ("/api/purchase-orders", {}, [
        "po_number", "code", "lines[].item_code", "receipts[].delivery_note_number",
        "receipts[].lines[].item_code", "receipts[].lines[].vendor_lot",
    ], {}),
    "purchase_report_lines": ("/api/purchase-orders/report/lines", {}, ["po_number", "item_code"], {}),
    "purchase_report_receipts": ("/api/purchase-orders/report/receipts", {}, [
        "po_number", "item_code", "delivery_note_number", "vendor_lot",
    ], {}),
    "stock_ledger": ("/api/stock", {}, [
        "item_code", "batch_number", "vendor_lot", "color_code", "labdip_variant_code",
    ], {}),
    "stock_on_hand": ("/api/stock/balance/paginated", {}, [
        "item_code", "batch_number", "vendor_lot", "color_code", "labdip_variant_code", "mo_code", "wo_code",
    ], {}),
    "booking_stock": ("/api/stock/availability", {}, [
        "item_code", "demand_mos[].mo_code", "supply_mos[].mo_code", "reserved_sos[].so_number",
        "supply_pos[].po_number",
    ], {}),
    "quarantine": ("/api/quarantine", {}, [
        "item_code", "color_code", "labdip_variant_code", "mo_code", "production_run_code", "sales_order_code",
        "lots[].batch_number", "lots[].item_code", "lots[].color_code", "lots[].labdip_variant_code",
        "lots[].wo_code", "lots[].claimed_by_order_code",
    ], {}),
    "partners": ("/api/partners", {}, [], {}),
}


def classify(name: str, path: str) -> str:
    """'search', 'ignore' or 'unclassified' for one row-relative identifier path."""
    _, _, search, ignore = ENDPOINTS[name]
    if path in search:
        return "search"
    if _ignored(path, ignore):
        return "ignore"
    return "unclassified"


def _ignored(path: str, ignore: dict) -> bool:
    keys = {**IGNORE_EVERYWHERE, **ignore}
    return any(path == k or path.endswith("." + k) or path.endswith("_" + k) for k in keys)


def normalize(path: str) -> str:
    """lines[3].item_code -> lines[].item_code; child_mos[].child_mos[] -> child_mos[]."""
    path = re.sub(r"\[\d+\]", "[]", path)
    segs = path.split(".")
    out = []
    for s in segs:
        if not out or out[-1] != s or not s.endswith("[]"):
            out.append(s)
    return ".".join(out)


def identifier_paths(model, prefix="", stack=()) -> set[str]:
    """Every identifier field reachable from a Pydantic row model."""
    from pydantic import BaseModel
    found = set()
    if model in stack:
        return found
    for name, field in model.model_fields.items():
        ann, is_list = field.annotation, False
        for _ in range(4):  # unwrap Optional / list / Union
            args = [a for a in typing.get_args(ann) if a is not type(None)]
            origin = typing.get_origin(ann)
            if origin in (list, typing.List, set, tuple):
                is_list, ann = True, args[0] if args else ann
            elif origin is typing.Union or (origin is not None and str(origin) == "types.UnionType"):
                models = [a for a in args if isinstance(a, type) and issubclass(a, BaseModel)]
                ann = models[0] if models else (args[0] if args else ann)
            else:
                break
        path = f"{prefix}{name}{'[]' if is_list else ''}"
        if isinstance(ann, type) and issubclass(ann, BaseModel):
            found |= identifier_paths(ann, path + ".", stack + (model,))
        elif IDENT.search(name):
            found.add(normalize(path))
    return found
