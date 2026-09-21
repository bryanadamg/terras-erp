import logging
from pathlib import Path
from sqlalchemy import or_, text
from app.db.base import Base  # noqa: F401 — triggers all model registrations before individual imports
from app.models.category import Category
from app.models.auth import Permission, Role, User
from app.models.uom import UOM
from app.core.security import get_password_hash
from app.models.stock_ledger import StockLedger
from app.models.stock_balance import StockBalance
from app.models.attribute import AttributeValue
from app.services import stock_service

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def ensure_static_dirs():
    """Ensure required static directories exist."""
    try:
        for subdir in ("static/logos", "static/samples", "static/boms", "static/receipts", "static/lab_dips"):
            p = Path(subdir)
            if not p.exists():
                p.mkdir(parents=True, exist_ok=True)
                logger.info(f"Created directory: {p}")
    except Exception as e:
        logger.warning(f"Static directory creation skipped: {e}")


def seed_sizes(db):
    try:
        from app.models.size import Size
        if db.query(Size).count() == 0:
            sizes = [("S", 1), ("M", 2), ("L", 3), ("XL", 4), ("2XL", 5), ("3XL", 6), ("4XL", 7)]
            for name, order in sizes:
                db.add(Size(name=name, sort_order=order))
            db.commit()
            logger.info("Seeded sizes S–4XL")
    except Exception as e:
        logger.warning(f"Size seeding skipped: {e}")


def seed_packaging_types(db):
    """Seed the box master the pack screens pick from.

    Tares are left NULL, not guessed: the plant weighs its own empty boxes and a
    wrong default would print a wrong brutto on a delivery note without anyone
    noticing. The Custom row carries `is_custom`, which is what makes the pack
    form ask for a hand-weighed tare instead of reading one from here.

    Seeded once (skipped when the table has rows), so renaming or deleting a row
    later sticks.
    """
    try:
        from app.models.packaging_type import PackagingType
        if db.query(PackagingType).count() == 0:
            rows = [
                ("BOX-S", "Box S", 10, False),
                ("BOX-M", "Box M", 20, False),
                ("BOX-L", "Box L", 30, False),
                ("BOX-XL", "Box XL", 40, False),
                ("BAG", "Plastic Bag", 50, False),
                ("CUSTOM", "Custom Box", 90, True),
            ]
            for code, name, order, custom in rows:
                db.add(PackagingType(code=code, name=name, sort_order=order, is_custom=custom))
            db.commit()
            logger.info("Seeded packaging types (tare weights left blank for the plant to set)")
    except Exception as e:
        logger.warning(f"Packaging type seeding skipped: {e}")


def seed_qty_formula(db):
    """Seed the plant-wide production-quantity formula with the rule that used
    to be hardcoded in ProductionRunModal.tsx (S=0, M=(S+M)/2, L=(S+M)/2+L,
    everything else as ordered), so an existing install keeps behaving exactly
    as it did before the formula became configurable."""
    try:
        from app.models.qty_formula import QtyFormulaRule
        from app.services.qty_formula_service import DEFAULT_RULES
        if db.query(QtyFormulaRule).count() == 0:
            for name, expr in DEFAULT_RULES:
                db.add(QtyFormulaRule(size_name=name, expression=expr))
            db.commit()
            logger.info("Seeded default production quantity formula")
    except Exception as e:
        logger.warning(f"Quantity formula seeding skipped: {e}")


def seed_system_attributes(db):
    try:
        from app.models.attribute import Attribute, AttributeValue
        # (name, role, seed_values) — seed_values=None means no value seeding
        system_attrs = [
            ("Colors", "color", None),
            ("Combo", "combo", None),
            ("Materials", "material", ["Polyester", "Nylon", "Cotton", "Latex", "Spandex"]),
            ("Color Code", "labdip_color", None),
            # Dye recipe Bak Cuci / Finishing steps are picked from these (values are
            # curated on the Attributes page, harvested from legacy free text by
            # migration a5c7e9b1d3f4)
            ("Wash Bath", "wash_bath", None),
            ("Finishing Step", "finishing_step", None),
            # Sample request classification — the three defaults are what the client
            # asked for; more are added on the Attributes page like any other value.
            ("Sample Category", "sample_category", ["New Sample", "Re Sample", "Yardage"]),
            # Pre-packing QC disposition of a lot held in a quarantine location.
            # Open list — the client adds more values on the Attributes page. Only
            # QUARANTINE_PASS_VALUES (api/quarantine.py) releases a lot to packing.
            ("Quarantine Status", "quarantine_status", ["OK", "Bulk Sample", "Waiting Approval"]),
            # Rope speeds a dye vessel is run at, yards/min per rope. Picked on the
            # dyeing monitor and in the bath panel instead of typed, so the plant's
            # real speeds are a short curated list rather than a free number nobody
            # can check — the whole reason rpm x reel geometry was dropped
            # (f3b5d7a9c1e8). A value names the shade depth and carries its speed in
            # the same string, because that is what the floor picks by; the number is
            # parsed out of it (components/shared/dyeingSpeed.ts), so a bare "60" from
            # before the labels still works. The floor adds its own on the Attributes
            # page, and the rate endpoint accepts any positive value so an unlisted
            # speed is still recordable.
            ("Dyeing Speed", "dyeing_speed", ["Tua (3)", "Sedang (4)", "Muda (5)"]),
        ]
        for name, role, seed_values in system_attrs:
            existing = db.query(Attribute).filter(Attribute.name == name).first()
            if not existing:
                existing = Attribute(name=name, is_system=True, system_role=role)
                db.add(existing)
                db.commit()
                db.refresh(existing)
                logger.info(f"Seeded '{name}' system attribute (role={role})")
            else:
                changed = False
                if not existing.is_system:
                    existing.is_system = True
                    changed = True
                if existing.system_role != role:
                    existing.system_role = role
                    changed = True
                if changed:
                    db.commit()
                    logger.info(f"Updated '{name}' attribute: is_system=True, system_role={role}")
            # Seed default values only when the attribute has none yet
            if seed_values:
                have = db.query(AttributeValue).filter(AttributeValue.attribute_id == existing.id).count()
                if have == 0:
                    for v in seed_values:
                        db.add(AttributeValue(attribute_id=existing.id, value=v))
                    db.commit()
                    logger.info(f"Seeded {len(seed_values)} default values for '{name}'")
    except Exception as e:
        logger.warning(f"System attribute seeding skipped: {e}")


# Default avatar template for executive roles — a DiceBear recipe in the format
# `Role.default_avatar_id` takes (see frontend/app/components/shared/avatarRecipe.ts).
# Only the `code:value` pins are used and the seed ("ayu") is DISCARDED at render
# time, so each user still seeds from their own username.
#
# `ht:` and `ac:` are the load-bearing pins: hat and accessories carry every
# novelty variant in the pixel-art style, and turning them off is the whole reason
# this exists. The rest (hair, clothing, eyes, mouth, beard and the five colours)
# pin a plain business face, which means holders of these roles differ only in the
# one slot left on Auto — glasses. That is deliberate: uniformity is the point for
# a role that prints its name on a Surat Jalan.
EXECUTIVE_AVATAR_TEMPLATE = (
    "v1|ayu|ht:|hr:short17|cl:variant03|ey:variant01|mo:sad06|bd:variant03|ac:"
    "|sk:e0b687|hc:28150a|cc:03396c|hk:2e1e05|mc:c98276"
)

SYSTEM_CATEGORIES = {"Raw Material", "Finished Goods", "WIP", "Sample", "Chemical", "Dye"}

# (parent_name, child_name) — both marked is_system=True
SYSTEM_CHILD_CATEGORIES = [
    ("WIP", "Beam"),
]

def seed_categories(db):
    try:
        defaults = ["Raw Material", "WIP", "Finished Goods", "Sample", "Consumable", "Chemical", "Dye"]
        updated = 0
        created = 0
        for name in defaults:
            cat = db.query(Category).filter_by(name=name, parent_id=None).first()
            if cat:
                if name in SYSTEM_CATEGORIES and not cat.is_system:
                    cat.is_system = True
                    updated += 1
            else:
                db.add(Category(name=name, is_system=(name in SYSTEM_CATEGORIES)))
                created += 1
        if updated or created:
            db.commit()
        if created:
            logger.info(f"Seeded {created} missing default categories")
        if updated:
            logger.info(f"Backfilled is_system=True for {updated} system categories")

        # Seed system child categories
        for parent_name, child_name in SYSTEM_CHILD_CATEGORIES:
            parent = db.query(Category).filter_by(name=parent_name, parent_id=None).first()
            if not parent:
                continue
            child = db.query(Category).filter_by(name=child_name, parent_id=parent.id).first()
            if child:
                if not child.is_system:
                    child.is_system = True
                    db.commit()
                    logger.info(f"Backfilled is_system=True for child category '{child_name}'")
            else:
                db.add(Category(name=child_name, parent_id=parent.id, is_system=True))
                db.commit()
                logger.info(f"Seeded system child category '{parent_name} > {child_name}'")
    except Exception as e:
        logger.warning(f"Category seeding skipped: {e}")


def seed_uoms(db):
    try:
        system_uoms = {"kg", "yard"}
        if db.query(UOM).count() == 0:
            defaults = ["Pcs", "Cone", "Bal", "Box", "Set", "m", "l", "kg", "yard"]
            for name in defaults:
                db.add(UOM(name=name, is_system=(name in system_uoms)))
            db.commit()
            logger.info("Seeded default UOMs")
        else:
            # Ensure kg and yard exist and are marked system
            for name in system_uoms:
                existing = db.query(UOM).filter(UOM.name == name).first()
                if existing:
                    if not existing.is_system:
                        existing.is_system = True
                else:
                    db.add(UOM(name=name, is_system=True))
            db.commit()
    except Exception as e:
        logger.warning(f"UOM seeding skipped: {e}")


def backfill_combo_library(db):
    """Copy existing `Combo` variant AttributeValues into the combos master table and
    link each combo back to its source value. Idempotent — only inserts combos for
    values not already mirrored. Runs every startup so any value added outside the
    library (legacy path) is drawn into it. Combo values are large in count, so this
    library is their permanent home; the inline attribute list is the legacy source."""
    try:
        from app.models.attribute import Attribute, AttributeValue
        from app.models.combo import Combo

        attr = db.query(Attribute).filter(Attribute.system_role == "combo").first()
        if not attr:
            return
        values = db.query(AttributeValue).filter(AttributeValue.attribute_id == attr.id).all()
        if not values:
            return

        linked_ids = {c.attribute_value_id for c in db.query(Combo).all() if c.attribute_value_id}
        existing_codes = {c.code for c in db.query(Combo).all()}
        created = 0
        for av in values:
            if av.id in linked_ids:
                continue
            # Derive a stable unique code from the value label; disambiguate collisions.
            base = (av.value or "").strip() or f"COMBO-{str(av.id)[:8]}"
            code = base
            n = 1
            while code in existing_codes:
                n += 1
                code = f"{base}-{n}"
            existing_codes.add(code)
            db.add(Combo(code=code, name=av.value, status="active", attribute_value_id=av.id))
            created += 1
        if created:
            db.commit()
            logger.info(f"Backfilled {created} combo(s) into the Combo library")
    except Exception as e:
        db.rollback()
        logger.warning(f"Combo library backfill skipped: {e}")


def seed_operations(db):
    try:
        from app.models.routing import Operation
        system_ops = [
            {"code": "BEAMING",   "name": "Beaming",   "description": "Yarn beaming process"},
            {"code": "WARPING",   "name": "Warping",   "description": "Yarn warping onto beam"},
            {"code": "WEAVING",   "name": "Weaving",   "description": "Fabric weaving on loom"},
            {"code": "DYEING",    "name": "Dyeing",    "description": "Fabric dyeing process"},
            {"code": "SETTING",   "name": "Setting",   "description": "Heat setting after dyeing"},
            {"code": "FINISHING", "name": "Finishing", "description": "Final finishing and quality check"},
        ]
        for op_data in system_ops:
            existing = db.query(Operation).filter(Operation.code == op_data["code"]).first()
            if existing:
                existing.is_system = True
            else:
                db.add(Operation(**op_data, is_system=True))
        db.commit()
        logger.info("Seeded system operations")
    except Exception as e:
        logger.warning(f"Operation seeding skipped: {e}")


SYSTEM_WAREHOUSES = [
    {"code": "RM",       "name": "Raw Material Store",   "system_code": "RM"},
    {"code": "CHEM",     "name": "Chemical Store",        "system_code": "CHEM"},
    {"code": "WIP",      "name": "WIP Store",             "system_code": "WIP"},
    {"code": "FG",       "name": "Finished Goods Store",  "system_code": "FG"},
    {"code": "QC",       "name": "Quarantine",            "system_code": "QC"},
    {"code": "DISPATCH", "name": "Dispatch Staging",      "system_code": "DISPATCH"},
    {"code": "SPARE",    "name": "Spare Parts Store",     "system_code": "SPARE"},
    {"code": "GREIGE",   "name": "Greige Store",          "system_code": "GREIGE"},
    {"code": "MIX",      "name": "Mix Store",             "system_code": "MIX"},
]


def seed_system_locations(db):
    try:
        from app.models.location import Location
        created = 0
        for w in SYSTEM_WAREHOUSES:
            existing = db.query(Location).filter(Location.system_code == w["system_code"]).first()
            if existing:
                # The seeded QC store is a hold area out of the box; other stores are
                # left alone so an operator-set flag is never overwritten here.
                if w["system_code"] == "QC" and not existing.is_quarantine:
                    existing.is_quarantine = True
                    db.commit()
                continue
            # Adopt an existing row with the same code rather than creating a duplicate
            by_code = db.query(Location).filter(Location.code == w["code"]).first()
            if by_code:
                by_code.system_code = w["system_code"]
                by_code.location_type = 'warehouse'
                db.commit()
            else:
                db.add(Location(
                    code=w["code"],
                    name=w["name"],
                    location_type='warehouse',
                    system_code=w["system_code"],
                    parent_id=None,
                    is_quarantine=(w["system_code"] == "QC"),
                ))
                db.commit()
                created += 1
        if created:
            logger.info(f"Seeded {created} system warehouse locations")
    except Exception as e:
        logger.warning(f"System location seeding skipped: {e}")


def seed_rbac(db):
    try:
        # One permission per resource.action row in the Permissions config
        # spreadsheet. Legacy broad codes (inventory.manage, sales.manage, etc.)
        # are intentionally NOT re-seeded here — the one-time Alembic migration
        # (2afd23590ae8) already granted every Role holding a legacy code the
        # matching superset of these granular codes, so nothing lost access.
        perms_data = [
            ("admin.access", "Full System Access"),
            ("reports.view", "View Reports"),
            # Sales Order
            ("sales_order.create", "Create Sales Orders"),
            ("sales_order.edit", "Edit Sales Orders"),
            ("sales_order.delete", "Delete Sales Orders"),
            ("sales_order.create_pr", "Create Production Run from Sales Order"),
            ("sales_order.print", "Print Sales Orders"),
            ("sales_order.view", "View Sales Orders"),
            ("sales_order.close", "Close Sales Orders"),
            # Customer
            ("customer.create", "Add Customers"),
            ("customer.edit", "Edit Customers"),
            ("customer.delete", "Delete Customers"),
            ("customer.view", "View Customers"),
            # Supplier
            ("supplier.create", "Add Suppliers"),
            ("supplier.edit", "Edit Suppliers"),
            ("supplier.delete", "Delete Suppliers"),
            ("supplier.view", "View Suppliers"),
            # Sample Request
            ("sample_request.create", "Create Sample Requests"),
            ("sample_request.edit", "Edit Sample Requests"),
            ("sample_request.delete", "Delete Sample Requests"),
            ("sample_request.update_status", "Update Sample Request Status"),
            ("sample_request.print", "Print Sample Requests"),
            ("sample_request.view", "View Sample Requests"),
            # Purchase Order
            ("purchase_order.create", "Create Purchase Orders"),
            ("purchase_order.edit", "Edit Purchase Orders"),
            ("purchase_order.delete", "Delete Purchase Orders"),
            ("purchase_order.receive_goods", "Receive Goods against Purchase Orders"),
            ("purchase_order.print", "Print Purchase Orders"),
            ("purchase_order.view", "View Purchase Orders"),
            ("purchase_order.close", "Close Purchase Orders"),
            # Item Inventory (scoped by Role.allowed_categories)
            ("item.create", "Create Items"),
            ("item.edit", "Edit Items"),
            ("item.delete", "Delete Items"),
            ("item.import", "Import Items"),
            ("item.view", "View Items"),
            # Attribute
            ("attribute.create", "Create Attributes"),
            ("attribute.edit", "Edit Attributes"),
            ("attribute.delete", "Delete Attributes"),
            ("attribute.view", "View Attributes"),
            # Categorie
            ("category.create", "Create Categories"),
            ("category.edit", "Edit Categories"),
            ("category.delete", "Delete Categories"),
            ("category.view", "View Categories"),
            # Unit Of Measure
            ("uom.create", "Create Units of Measure"),
            ("uom.edit", "Edit Units of Measure"),
            ("uom.delete", "Delete Units of Measure"),
            ("uom.view", "View Units of Measure"),
            # Combo Library
            ("combo_library.create", "Create Combos"),
            ("combo_library.edit", "Edit Combos"),
            ("combo_library.delete", "Delete Combos"),
            ("combo_library.view", "View Combo Library"),
            # Packaging Types — the box master (tare weights) the pack screens pick from
            ("packaging_type.create", "Create Packaging Types"),
            ("packaging_type.edit", "Edit Packaging Types"),
            ("packaging_type.archive", "Delete/Deactivate Packaging Types"),
            ("packaging_type.view", "View Packaging Types"),
            # Lot Management (scoped by Role.allowed_locations)
            ("lot.create", "Create Lots"),
            ("lot.split", "Split Lots"),
            ("lot.delete", "Delete Lots"),
            ("lot.qc_reject", "QC Reject Lots"),
            ("lot.view", "View Lots"),
            # Quarantine Packing — QC hold desk. set_status is the release decision
            # that lets a lot be packed, so it is deliberately separate from lot.*.
            ("quarantine.view", "View Quarantine Packing"),
            ("quarantine.set_status", "Set Quarantine Status"),
            # Pick List — floor half only. Everything else on the pick list router
            # (create/edit/dispatch/delete) stays on the legacy sales.manage blob;
            # this exists so a picker can confirm cartons without holding it.
            ("pick_list.scan", "Scan Cartons onto Pick Lists"),
            # Shipment — the loading deck. `shipment.verify` is the four-eyes gate
            # and is the ONE code here that sales.manage does not satisfy: a check
            # every planner can tick is not a check. Keep it on a separate role.
            ("shipment.view", "View Shipments"),
            ("shipment.create", "Stage Shipments"),
            ("shipment.edit", "Edit Shipments"),
            ("shipment.verify", "Verify Shipments at the Loading Deck"),
            ("shipment.dispatch", "Dispatch Shipments"),
            ("shipment.delete", "Delete Shipments"),
            # Stock In Hand (scoped by Role.allowed_categories)
            ("stock_on_hand.create", "Create Stock Entries"),
            ("stock_on_hand.adjust", "Adjust Stock On Hand"),
            ("stock_on_hand.move", "Move Stock On Hand"),
            ("stock_on_hand.view", "View Stock On Hand"),
            # Booking Stock
            ("booking_stock.view", "View Booking Stock"),
            # Location
            ("location.create", "Create Locations"),
            ("location.edit", "Edit Locations"),
            ("location.delete", "Delete Locations"),
            ("location.view", "View Locations"),
            # Bill of Material
            ("bom.create", "Create BOMs"),
            ("bom.edit", "Edit BOMs"),
            ("bom.delete", "Delete BOMs"),
            ("bom.view", "View BOMs"),
            # Routing and Ops
            ("routing.create", "Create Work Centers/Operations"),
            ("routing.edit", "Edit Work Centers/Operations"),
            ("routing.delete", "Delete Work Centers/Operations"),
            ("routing.view", "View Routing and Work Centers"),
            # Production Run
            ("production_run.create", "Create Production Runs"),
            ("production_run.edit", "Edit/Cancel Production Runs"),
            ("production_run.delete", "Delete Production Runs"),
            ("production_run.print", "Print Production Runs"),
            ("production_run.view", "View Production Runs"),
            # Manufacture Order
            ("manufacturing_order.create", "Create Manufacture Orders"),
            ("manufacturing_order.edit", "Edit Manufacture Orders"),
            ("manufacturing_order.delete", "Delete Manufacture Orders"),
            ("manufacturing_order.print", "Print Manufacture Orders"),
            ("manufacturing_order.view", "View Manufacture Orders"),
            ("manufacturing_order.close", "Close Manufacture Orders"),
            # Work Order (scoped by Role.allowed_work_center_types)
            ("work_order.create", "Create Work Orders"),
            ("work_order.log", "Log Work Order Production"),
            ("work_order.edit", "Edit Work Orders"),
            ("work_order.delete", "Delete Work Orders"),
            ("work_order.print_card", "Print Kartu Kerja"),
            ("work_order.print_label", "Print Work Order Labels"),
            ("work_order.view", "View Work Orders"),
            ("work_order.stage", "Stage Work Order Materials"),
            # Weaving Monitor
            ("weaving_monitor.start", "Start Weaving Runs"),
            ("weaving_monitor.stop", "Stop Weaving Runs"),
            ("weaving_monitor.view", "View Weaving Monitor"),
            # Dyeing Monitor. View only: a dye batch is started and completed from
            # the Dyeing Orders tab under work_order.log, so this grid adds no
            # lifecycle verbs of its own.
            ("dyeing_monitor.view", "View Dyeing Monitor"),
            # Calender
            ("calendar.edit", "Edit Work Center Calendars"),
            ("calendar.view", "View Work Center Calendars"),
            # Beam
            ("beam.unmount", "Unmount Beams"),
            ("beam.view", "View Beams"),
            # Dye Recipe
            ("dye_recipe.create", "Create Dye Recipes"),
            ("dye_recipe.edit", "Edit Dye Recipes"),
            ("dye_recipe.delete", "Delete Dye Recipes"),
            ("dye_recipe.print", "Print Dye Recipes"),
            ("dye_recipe.view", "View Dye Recipes"),
            # Dye Order / Setting Order (view-only floor status)
            ("dye_order.view", "View Dye Orders"),
            ("setting_order.view", "View Setting Orders"),
            # Color
            ("color_code.create", "Create Color Codes"),
            ("color_code.edit", "Edit Color Codes"),
            ("color_code.archive", "Archive Color Codes"),
            ("color_code.create_recipe", "Create Dyeing Recipe from Color Code"),
            ("color_code.view", "View Color Codes"),
            ("color_variant.create", "Create Color Variants"),
            ("color_variant.edit", "Edit Color Variants"),
            ("color_variant.delete", "Delete Color Variants"),
            # Lab Dip Request
            ("lab_dip_request.create", "Create Lab Dip Requests"),
            ("lab_dip_request.edit", "Edit Lab Dip Requests"),
            ("lab_dip_request.delete", "Delete Lab Dip Requests"),
            ("lab_dip_request.update_status", "Update Lab Dip Request Status"),
            ("lab_dip_request.print", "Print Lab Dip Requests"),
            ("lab_dip_request.view", "View Lab Dip Requests"),
            # Yarn Lab Dip
            ("yarn_lab_dip.view", "View Yarn Lab Dips"),
            # Platform
            ("stock_ledger.print", "Print Stock Ledger"),
            ("stock_ledger.view", "View Stock Ledger"),
            # Production Output report — its own grant rather than the broad
            # reports.view, so a role can be given the dashboard without the
            # shop-floor output/reject numbers. export is separate from view so
            # reading the report never implies taking the data off the system.
            ("production_output.view", "View Production Output Report"),
            ("production_output.export", "Export Production Output CSV"),
            ("audit_log.view", "View Audit Log"),
            ("print_layout.edit", "Edit Print Layouts"),
            ("system_admin.create", "Create System Admin Records"),
            ("system_admin.edit", "Edit System Admin Records"),
            ("system_admin.delete", "Delete System Admin Records"),
        ]

        db_perms = {}
        for code, desc in perms_data:
            perm = db.query(Permission).filter(Permission.code == code).first()
            if not perm:
                perm = Permission(code=code, description=desc)
                db.add(perm)
                db.commit()
                db.refresh(perm)
            db_perms[code] = perm

        roles_data = {
            # admin.access short-circuits every check — no need to also list every code.
            "Administrator": ["admin.access"],
            "Store Manager": [
                "item.create", "item.edit", "item.delete", "item.import", "item.view",
                "attribute.create", "attribute.edit", "attribute.delete", "attribute.view",
                "category.create", "category.edit", "category.delete", "category.view",
                "uom.create", "uom.edit", "uom.delete", "uom.view",
                "combo_library.create", "combo_library.edit", "combo_library.delete", "combo_library.view",
                "packaging_type.create", "packaging_type.edit", "packaging_type.archive", "packaging_type.view",
                "lot.create", "lot.split", "lot.delete", "lot.qc_reject", "lot.view",
                "quarantine.view", "quarantine.set_status",
                "stock_on_hand.create", "stock_on_hand.adjust", "stock_on_hand.move", "stock_on_hand.view",
                "booking_stock.view",
                "location.create", "location.edit", "location.delete", "location.view",
                "purchase_order.create", "purchase_order.edit", "purchase_order.delete",
                "purchase_order.receive_goods", "purchase_order.print", "purchase_order.view", "purchase_order.close",
                "supplier.create", "supplier.edit", "supplier.delete", "supplier.view",
                "stock_ledger.print", "stock_ledger.view",
                "reports.view",
                "production_output.view", "production_output.export",
            ],
            "Production Manager": [
                "bom.create", "bom.edit", "bom.delete", "bom.view",
                "routing.create", "routing.edit", "routing.delete", "routing.view",
                "production_run.create", "production_run.edit", "production_run.delete",
                "production_run.print", "production_run.view",
                "manufacturing_order.create", "manufacturing_order.edit", "manufacturing_order.delete",
                "manufacturing_order.print", "manufacturing_order.view", "manufacturing_order.close",
                "work_order.create", "work_order.log", "work_order.edit", "work_order.delete",
                "work_order.print_card", "work_order.print_label", "work_order.view", "work_order.stage",
                "weaving_monitor.start", "weaving_monitor.stop", "weaving_monitor.view",
                "dyeing_monitor.view",
                "calendar.edit", "calendar.view", "beam.unmount", "beam.view",
                "dye_recipe.create", "dye_recipe.edit", "dye_recipe.delete", "dye_recipe.print", "dye_recipe.view",
                "dye_order.view", "setting_order.view",
                "color_code.create", "color_code.edit", "color_code.archive", "color_code.create_recipe", "color_code.view",
                "color_variant.create", "color_variant.edit", "color_variant.delete",
                "lab_dip_request.create", "lab_dip_request.edit", "lab_dip_request.delete",
                "lab_dip_request.update_status", "lab_dip_request.print", "lab_dip_request.view",
                "yarn_lab_dip.view",
                "stock_ledger.view", "reports.view",
                "production_output.view", "production_output.export",
            ],
            # Floor operator: log/stage/view only — not the full Edit/Delete access
            # "work_order.manage" used to imply. Tighten via the Roles page if a
            # site actually wants operators editing/deleting WOs.
            "Operator": ["work_order.log", "work_order.view", "work_order.stage",
                         "weaving_monitor.view", "dyeing_monitor.view"],
            # QC desk: dispositions held stock on the Quarantine Packing page and
            # scraps bad lots. Read-only everywhere else — releasing to packing is
            # the only write this role owns.
            "QC Inspector": [
                "quarantine.view", "quarantine.set_status",
                "lot.qc_reject", "lot.view",
                "stock_on_hand.view", "manufacturing_order.view", "work_order.view",
                "item.view", "reports.view",
                "production_output.view",
            ],
        }

        for role_name, perm_codes in roles_data.items():
            role = db.query(Role).filter(Role.name == role_name).first()
            if not role:
                role = Role(name=role_name)
                db.add(role)
                db.commit()
                db.refresh(role)
            current_perms = role.permissions
            for code in perm_codes:
                if db_perms[code] not in current_perms:
                    role.permissions.append(db_perms[code])
            db.commit()

        # Executive avatar: the roles whose holders sign documents and sit in front
        # of customers should never be handed a novelty face by the username-seeded
        # fallback. Matches "Administrator" plus any "<something> Manager", so a
        # Warehouse Manager added later is covered without touching this list.
        #
        # Set-if-null, the same top-up semantics as the permission loop above: an
        # admin who picks a different template on the Roles page keeps it, but one
        # who clears it back to null gets the seed again on the next restart. To opt
        # a role out, give it an empty-pin template rather than clearing it.
        exec_roles = db.query(Role).filter(
            or_(Role.name == "Administrator", Role.name.ilike("% Manager"))
        ).all()
        for role in exec_roles:
            if not role.default_avatar_id:
                role.default_avatar_id = EXECUTIVE_AVATAR_TEMPLATE
        db.commit()

        # Only seed demo accounts on a truly empty user table (first boot).
        # Per-username existence checks would resurrect an account an admin
        # deliberately deleted in production on every subsequent restart.
        if db.query(User).count() == 0:
            users_data = [
                ("admin", "System Admin", "Administrator"),
                ("store_mgr", "Budi Store", "Store Manager"),
                ("prod_mgr", "Siti Production", "Production Manager"),
                ("operator", "Joko Worker", "Operator"),
            ]
            for uname, fname, rname in users_data:
                role = db.query(Role).filter(Role.name == rname).first()
                db.add(User(
                    username=uname,
                    full_name=fname,
                    role_id=role.id,
                    hashed_password=get_password_hash("password"),
                ))
            db.commit()

        logger.info("Seeded RBAC (Roles, Permissions, Users)")
    except Exception as e:
        logger.error(f"RBAC seeding failed: {e}")


def backfill_mo_planned_components(db):
    """One-time backfill for MOs created before the BOM snapshot feature.
    Idempotent — skips MOs that already have planned_component rows."""
    try:
        db.execute(text("""
            INSERT INTO mo_planned_components
                (id, mo_id, item_id, percentage, qty, source_location_id, bom_line_id, attribute_value_ids)
            SELECT
                gen_random_uuid(),
                mo.id,
                bl.item_id,
                bl.percentage,
                bl.qty,
                bl.source_location_id,
                bl.id,
                COALESCE(
                    (SELECT jsonb_agg(blv.attribute_value_id::text ORDER BY blv.attribute_value_id::text)
                     FROM bom_line_values blv WHERE blv.bom_line_id = bl.id),
                    '[]'::jsonb
                )
            FROM manufacturing_orders mo
            JOIN bom_lines bl ON bl.bom_id = mo.bom_id
            WHERE mo.bom_id IS NOT NULL
              AND mo.id NOT IN (SELECT DISTINCT mo_id FROM mo_planned_components)
        """))
        db.commit()
        logger.info("mo_planned_components backfill check complete")
    except Exception as e:
        db.rollback()
        logger.warning(f"mo_planned_components backfill failed: {e}")


def sync_stock_balances(db):
    """Rebuild stock_balances from stock_ledger. Runs on every startup."""
    try:
        logger.info("Synchronizing Stock Balances from Ledger...")
        db.execute(text("TRUNCATE stock_balances, stock_balance_values CASCADE"))
        db.commit()

        entries = db.query(StockLedger).all()
        aggregated = {}

        for e in entries:
            attr_ids = [str(v.id) for v in e.attribute_values]
            color_id = getattr(e, "color_id", None)
            v_key = stock_service._generate_variant_key(attr_ids, color_id)
            b_key = str(e.batch_id) if e.batch_id else ""
            s_key = f"{str(e.item_id)}:{str(e.location_id)}:{v_key}:{b_key}"

            if s_key not in aggregated:
                aggregated[s_key] = {
                    "qty": 0.0,
                    "cones": 0,
                    "boxes": 0,
                    "drums": 0,
                    "attr_ids": attr_ids,
                    "item_id": e.item_id,
                    "location_id": e.location_id,
                    "v_key": v_key,
                    "b_key": b_key,
                }
            aggregated[s_key]["qty"] += float(e.qty_change)
            aggregated[s_key]["cones"] += int(e.qty_cones_change or 0)
            aggregated[s_key]["boxes"] += int(e.qty_boxes_change or 0)
            aggregated[s_key]["drums"] += int(e.qty_drums_change or 0)

        logger.info(f"Aggregated {len(entries)} ledger entries into {len(aggregated)} unique balance records.")

        for s_key, data in aggregated.items():
            balance = StockBalance(
                item_id=data["item_id"],
                location_id=data["location_id"],
                variant_key=data["v_key"],
                batch_key=data["b_key"],
                qty=data["qty"],
                qty_cones=data["cones"],
                qty_boxes=data["boxes"],
                qty_drums=data["drums"],
            )
            if data["attr_ids"]:
                vals = db.query(AttributeValue).filter(AttributeValue.id.in_(data["attr_ids"])).all()
                balance.attribute_values = vals
            db.add(balance)

        db.commit()
        logger.info("Stock synchronization successfully committed.")
    except Exception as e:
        logger.error(f"Stock synchronization failed: {e}")
        db.rollback()


def backfill_item_variant_type(db):
    """One-time backfill: infer Item.variant_type from legacy attribute bindings.

    Items that had the Combo variant attribute bound become 'combo'; those with
    the Colors variant attribute become 'color'. Combo wins if both were present.
    Only touches rows where variant_type is still NULL, so it's idempotent and
    never overrides a value set through the new item form.
    """
    try:
        from sqlalchemy import text
        from app.models.attribute import Attribute
        combo = db.query(Attribute).filter(Attribute.system_role == "combo").first()
        color = db.query(Attribute).filter(Attribute.system_role == "color").first()
        updated = 0
        if combo:
            updated += db.execute(text(
                "UPDATE items SET variant_type='combo' WHERE variant_type IS NULL "
                "AND id IN (SELECT item_id FROM item_attributes WHERE attribute_id = :aid)"
            ), {"aid": str(combo.id)}).rowcount
        if color:
            updated += db.execute(text(
                "UPDATE items SET variant_type='color' WHERE variant_type IS NULL "
                "AND id IN (SELECT item_id FROM item_attributes WHERE attribute_id = :aid)"
            ), {"aid": str(color.id)}).rowcount
        if updated:
            db.commit()
            logger.info(f"Backfilled variant_type on {updated} items")
    except Exception as e:
        db.rollback()
        logger.warning(f"Item variant_type backfill skipped: {e}")


def recompute_sales_order_statuses():
    """Repair pass for derived SO status, in the spirit of sync_stock_balances().

    SO status used to be written directly ("READY" as soon as the first root MO
    delivered). It is now derived from packed cartons in stock by
    so_fulfilment_service, so rows written under the old rule can sit at a READY
    they no longer satisfy. Re-deriving on boot keeps the list honest instead of
    leaving stale values to flip at some unrelated later event.

    Runs in its own event loop: init_db is a sync script executed as a separate
    process before uvicorn, so there is no loop to clash with, and reusing the
    async service avoids a second copy of the derivation rules.
    """
    try:
        import asyncio
        from app.core.db_manager import db_manager
        from app.services import so_fulfilment_service

        async def _run():
            async for session in db_manager.get_async_session():
                return await so_fulfilment_service.recompute_all(session)
            return 0

        changed = asyncio.run(_run()) or 0
        if changed:
            logger.info(f"Recomputed fulfilment status on {changed} sales orders")
    except Exception as e:
        logger.warning(f"Sales order status recompute skipped: {e}")


def init_db() -> None:
    logger.info("Initializing Database...")
    ensure_static_dirs()

    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        seed_categories(db)
        seed_uoms(db)
        seed_operations(db)
        seed_rbac(db)
        seed_system_attributes(db)
        backfill_item_variant_type(db)
        backfill_combo_library(db)
        seed_sizes(db)
        seed_qty_formula(db)
        seed_packaging_types(db)
        seed_system_locations(db)
        backfill_mo_planned_components(db)
        sync_stock_balances(db)
    finally:
        db.close()

    # After stock balances are rebuilt — packed-carton availability reads them.
    recompute_sales_order_statuses()

    logger.info("Database initialization complete.")


if __name__ == "__main__":
    init_db()
