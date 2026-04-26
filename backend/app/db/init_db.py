import logging
import os
from pathlib import Path
from sqlalchemy import text
from app.db.session import engine
from app.db.base import Base

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def ensure_static_dirs():
    """Ensure required static directories exist."""
    try:
        # We use relative path 'static/logos' as the app usually runs from the backend root
        log_dir = Path("static/logos")
        if not log_dir.exists():
            log_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {log_dir}")
        samples_dir = Path("static/samples")
        if not samples_dir.exists():
            samples_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {samples_dir}")
        boms_dir = Path("static/boms")
        if not boms_dir.exists():
            boms_dir.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created directory: {boms_dir}")
    except Exception as e:
        logger.warning(f"Static directory creation skipped: {e}")

def run_migrations():
    """
    Run ad-hoc migrations to fix schema discrepancies.
    Using connection.commit() instead of raw SQL COMMIT to avoid transaction warnings.
    """
    try:
        with engine.connect() as conn:
            # ── Production Runs + Manufacturing Orders rename ──────────────────────────

            # 1. Create production_runs table (idempotent)
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS production_runs (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    code VARCHAR(64) UNIQUE NOT NULL,
                    bom_id UUID NOT NULL REFERENCES boms(id) ON DELETE RESTRICT,
                    sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
                    location_id UUID NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
                    source_location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                    notes TEXT,
                    target_start_date TIMESTAMP,
                    target_end_date TIMESTAMP,
                    actual_start_date TIMESTAMP,
                    actual_end_date TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            conn.commit()

            # 2. Rename work_orders → manufacturing_orders
            try:
                conn.execute(text("ALTER TABLE work_orders RENAME TO manufacturing_orders"))
                conn.commit()
                logger.info("Migration: Renamed work_orders → manufacturing_orders")
            except Exception:
                conn.rollback()

            # 3. Rename work_order_values junction → manufacturing_order_values
            try:
                conn.execute(text("ALTER TABLE work_order_values RENAME TO manufacturing_order_values"))
                conn.commit()
                logger.info("Migration: Renamed work_order_values → manufacturing_order_values")
            except Exception:
                conn.rollback()

            # 4. Rename work_order_id column inside the junction table
            try:
                conn.execute(text("ALTER TABLE manufacturing_order_values RENAME COLUMN work_order_id TO manufacturing_order_id"))
                conn.commit()
                logger.info("Migration: Renamed junction column work_order_id → manufacturing_order_id")
            except Exception:
                conn.rollback()

            # 5. Rename parent_wo_id → parent_mo_id on manufacturing_orders
            try:
                conn.execute(text("ALTER TABLE manufacturing_orders RENAME COLUMN parent_wo_id TO parent_mo_id"))
                conn.commit()
                logger.info("Migration: Renamed parent_wo_id → parent_mo_id")
            except Exception:
                conn.rollback()

            # 5b. Migrate old work_orders data → manufacturing_orders if rename failed (create_all beat us to it)
            try:
                # Old format has 'code' column; new operation-step format does not
                has_code = conn.execute(text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name='work_orders' AND column_name='code'"
                )).fetchone()
                if has_code:
                    mo_count = conn.execute(text("SELECT COUNT(*) FROM manufacturing_orders")).scalar()
                    if mo_count == 0:
                        conn.execute(text("""
                            INSERT INTO manufacturing_orders
                                (id, code, bom_id, item_id, location_id, source_location_id,
                                 sales_order_id, parent_mo_id, size_id, qty, status,
                                 target_start_date, target_end_date, actual_start_date, actual_end_date, created_at)
                            SELECT id, code, bom_id, item_id, location_id, source_location_id,
                                 sales_order_id, parent_wo_id, size_id, qty, status,
                                 target_start_date, target_end_date, actual_start_date, actual_end_date, created_at
                            FROM work_orders
                            ON CONFLICT (id) DO NOTHING
                        """))
                        conn.commit()
                        logger.info("Migration: Copied work_orders → manufacturing_orders")

                        # Migrate attribute value links
                        try:
                            conn.execute(text("""
                                INSERT INTO manufacturing_order_values (manufacturing_order_id, attribute_value_id)
                                SELECT work_order_id, attribute_value_id FROM work_order_values
                                ON CONFLICT DO NOTHING
                            """))
                            conn.commit()
                            logger.info("Migration: Copied work_order_values → manufacturing_order_values")
                        except Exception as e:
                            conn.rollback()
                            logger.warning(f"work_order_values copy failed: {e}")

                    # Drop old work_orders (CASCADE removes work_order_values FK too)
                    conn.execute(text("DROP TABLE IF EXISTS work_order_values CASCADE"))
                    conn.execute(text("DROP TABLE IF EXISTS work_orders CASCADE"))
                    conn.commit()
                    logger.info("Migration: Dropped old work_orders table; will recreate as operation-step schema")
            except Exception as e:
                conn.rollback()
                logger.warning(f"work_orders data migration failed: {e}")

            # 6. Create work_orders table (operation steps within a Manufacturing Order)
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS work_orders (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    manufacturing_order_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
                    sequence INTEGER NOT NULL DEFAULT 1,
                    name VARCHAR(128) NOT NULL,
                    work_center_id UUID REFERENCES work_centers(id) ON DELETE SET NULL,
                    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
                    planned_duration_hours FLOAT,
                    actual_duration_hours FLOAT,
                    notes TEXT,
                    target_start_date TIMESTAMP,
                    target_end_date TIMESTAMP,
                    actual_start_date TIMESTAMP,
                    actual_end_date TIMESTAMP,
                    created_at TIMESTAMP NOT NULL DEFAULT NOW()
                )
            """))
            conn.commit()

            # 1. Verification of missing columns in existing tables
            migrations = [
                ("items", "category", "VARCHAR(64)"),
                ("items", "source_sample_id", "UUID REFERENCES sample_requests(id) ON DELETE SET NULL"),
                ("items", "source_color_id", "UUID REFERENCES sample_colors(id) ON DELETE SET NULL"),
                ("items", "attribute_id", "UUID REFERENCES attributes(id)"),
                ("bom_lines", "source_location_id", "UUID REFERENCES locations(id)"),
                ("bom_lines", "is_percentage", "BOOLEAN DEFAULT FALSE"),
                ("bom_lines", "percentage", "NUMERIC(6,2) DEFAULT 0.0"),
                ("boms", "tolerance_percentage", "NUMERIC(5,2) DEFAULT 0.0"),
                ("purchase_orders", "target_location_id", "UUID REFERENCES locations(id)"),
                ("users", "hashed_password", "VARCHAR(255)"),
                ("users", "allowed_categories", "JSON"),
                ("sales_orders", "delivered_at", "TIMESTAMP WITHOUT TIME ZONE"),
                ("sales_orders", "customer_po_ref", "VARCHAR(64)"),
                ("sales_order_lines", "internal_confirmation_date", "TIMESTAMP WITHOUT TIME ZONE"),
                ("sales_order_lines", "ket_stock", "VARCHAR(255)"),
                ("sales_order_lines", "qty_kg", "NUMERIC(14,4)"),
                ("sales_order_lines", "qty2", "NUMERIC(14,4)"),
                ("sales_order_lines", "uom2", "VARCHAR(32)"),
                # sample_requests SPK fields
                ("sample_requests", "request_date", "DATE NOT NULL DEFAULT CURRENT_DATE"),
                ("sample_requests", "project", "VARCHAR(255)"),
                ("sample_requests", "customer_article_code", "VARCHAR(255)"),
                ("sample_requests", "internal_article_code", "VARCHAR(255)"),
                ("sample_requests", "width", "VARCHAR(64)"),
                ("sample_requests", "main_material", "VARCHAR(255)"),
                ("sample_requests", "middle_material", "VARCHAR(255)"),
                ("sample_requests", "bottom_material", "VARCHAR(255)"),
                ("sample_requests", "weft", "VARCHAR(255)"),
                ("sample_requests", "warp", "VARCHAR(255)"),
                ("sample_requests", "original_weight", "FLOAT"),
                ("sample_requests", "production_weight", "FLOAT"),
                ("sample_requests", "additional_info", "TEXT"),
                ("sample_requests", "quantity", "VARCHAR(255)"),
                ("sample_requests", "sample_size", "VARCHAR(255)"),
                ("sample_requests", "estimated_completion_date", "DATE"),
                ("sample_requests", "completion_description", "TEXT"),
                ("sample_requests", "customer_id", "UUID REFERENCES partners(id)"),
                ("sample_colors", "status", "VARCHAR(32) NOT NULL DEFAULT 'PENDING'"),
                ("items", "weight_per_unit", "FLOAT"),
                ("items", "weight_unit", "VARCHAR(16)"),
                ("sample_requests", "original_weight_unit", "VARCHAR(16)"),
                ("sample_requests", "production_weight_unit", "VARCHAR(16)"),
                ("users", "avatar_id", "VARCHAR(4)"),
                ("attributes", "is_system", "BOOLEAN NOT NULL DEFAULT FALSE"),
                ("sample_requests", "updated_at", "TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()"),
                ("sample_requests", "completion_image_url", "VARCHAR(512)"),
                ("sample_requests", "design_pdf_url", "VARCHAR(512)"),
                ("boms", "kerapatan_picks", "NUMERIC(10,2)"),
                ("boms", "kerapatan_unit", "VARCHAR(8)"),
                ("boms", "sisir_no", "INTEGER"),
                ("boms", "pemakaian_obat", "VARCHAR(255)"),
                ("boms", "pembuatan_sample_oleh", "VARCHAR(255)"),
                ("boms", "sample_photo_url", "VARCHAR(512)"),
                ("boms", "customer_id", "UUID REFERENCES partners(id) ON DELETE SET NULL"),
                ("boms", "mesin_lebar", "NUMERIC(8,2)"),
                ("boms", "mesin_panjang_tulisan", "NUMERIC(8,2)"),
                ("boms", "mesin_panjang_tarikan", "NUMERIC(8,2)"),
                ("boms", "mesin_panjang_tarikan_bandul_1kg", "NUMERIC(8,2)"),
                ("boms", "mesin_panjang_tarikan_bandul_9kg", "NUMERIC(8,2)"),
                ("boms", "celup_lebar", "NUMERIC(8,2)"),
                ("boms", "celup_panjang_tulisan", "NUMERIC(8,2)"),
                ("boms", "celup_panjang_tarikan", "NUMERIC(8,2)"),
                ("boms", "celup_panjang_tarikan_bandul_1kg", "NUMERIC(8,2)"),
                ("boms", "celup_panjang_tarikan_bandul_9kg", "NUMERIC(8,2)"),
                ("boms", "work_center_id", "UUID REFERENCES work_centers(id) ON DELETE SET NULL"),
                ("boms", "size_mode", "VARCHAR(8) NOT NULL DEFAULT 'sized'"),
                ("boms", "design_file_url", "VARCHAR(512)"),
                ("boms", "berat_bahan_mateng", "NUMERIC(10,4)"),
                ("boms", "berat_bahan_mentah_pelesan", "NUMERIC(10,4)"),
                ("bom_sizes", "label", "VARCHAR(128)"),
                ("manufacturing_orders", "production_run_id", "UUID REFERENCES production_runs(id) ON DELETE SET NULL"),
                ("manufacturing_orders", "bom_size_id", "UUID REFERENCES bom_sizes(id) ON DELETE SET NULL"),
            ]

            for table, col, col_type in migrations:
                try:
                    # Check if column exists
                    res = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{table}' AND column_name='{col}'"))
                    if not res.fetchone():
                        logger.info(f"Migration: Adding {col} to {table}")
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"))
                        conn.commit()
                except Exception as e:
                    logger.warning(f"Migration for {table}.{col} failed: {e}")

            # 1b. Verification of indexes for high-volume data
            index_migrations = [
                ("idx_items_category", "items", "category"),
                ("idx_bom_lines_item_id", "bom_lines", "item_id"),
                ("idx_audit_logs_entity_type", "audit_logs", "entity_type"),
                ("idx_audit_logs_entity_id", "audit_logs", "entity_id"),
                ("idx_audit_logs_timestamp", "audit_logs", "timestamp"),
                ("idx_sample_requests_so_id", "sample_requests", "sales_order_id"),
                ("idx_sample_requests_base_id", "sample_requests", "base_item_id"),
                ("idx_sample_requests_customer_id", "sample_requests", "customer_id"),
            ]

            for idx_name, table, col in index_migrations:
                try:
                    logger.info(f"Migration: Ensuring index {idx_name} on {table}({col})")
                    conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({col})"))
                    conn.commit()
                except Exception as e:
                    logger.warning(f"Index migration {idx_name} failed: {e}")

            # 1b2. Special structural migrations
            try:
                conn.execute(text("ALTER TABLE sample_requests ALTER COLUMN base_item_id DROP NOT NULL"))
                conn.commit()
            except Exception:
                pass

            try:
                conn.execute(text("ALTER TABLE bom_operations ALTER COLUMN operation_id DROP NOT NULL"))
                conn.commit()
            except Exception:
                pass

            try:
                conn.execute(text("ALTER TABLE bom_sizes ALTER COLUMN size_id DROP NOT NULL"))
                conn.commit()
            except Exception:
                pass

            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS sample_request_reads (
                        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        sample_request_id UUID NOT NULL REFERENCES sample_requests(id) ON DELETE CASCADE,
                        read_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
                        PRIMARY KEY (user_id, sample_request_id)
                    )
                """))
                conn.commit()
            except Exception as e:
                logger.warning(f"sample_request_reads table migration failed: {e}")

            try:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS sample_colors (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                        sample_request_id UUID NOT NULL
                            REFERENCES sample_requests(id) ON DELETE CASCADE,
                        name VARCHAR(255) NOT NULL,
                        is_repeat BOOLEAN NOT NULL DEFAULT FALSE,
                        "order" INTEGER NOT NULL DEFAULT 0
                    )
                """))
                conn.commit()
            except Exception as e:
                logger.warning(f"sample_colors table migration failed: {e}")

            # Repurpose items.source_sample_id FK: any old FK (possibly self-ref to items) → sample_requests
            try:
                # Find any FK on items.source_sample_id that does NOT reference sample_requests
                res = conn.execute(text("""
                    SELECT tc.constraint_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                        ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name
                    JOIN information_schema.referential_constraints rc
                        ON tc.constraint_name = rc.constraint_name
                    JOIN information_schema.table_constraints tc2
                        ON rc.unique_constraint_name = tc2.constraint_name
                    WHERE tc.table_name = 'items'
                      AND kcu.column_name = 'source_sample_id'
                      AND tc.constraint_type = 'FOREIGN KEY'
                      AND tc2.table_name != 'sample_requests'
                """))
                stale_constraints = [row[0] for row in res.fetchall()]
                if stale_constraints:
                    # Null out values that don't exist in sample_requests
                    conn.execute(text("""
                        UPDATE items SET source_sample_id = NULL
                        WHERE source_sample_id IS NOT NULL
                          AND source_sample_id NOT IN (SELECT id FROM sample_requests)
                    """))
                    conn.commit()
                    for constraint_name in stale_constraints:
                        conn.execute(text(f"ALTER TABLE items DROP CONSTRAINT IF EXISTS \"{constraint_name}\""))
                    conn.execute(text("""
                        ALTER TABLE items ADD CONSTRAINT fk_items_source_sample_id_sample_requests
                            FOREIGN KEY (source_sample_id) REFERENCES sample_requests(id) ON DELETE SET NULL
                    """))
                    conn.commit()
                    logger.info(f"Migration: Replaced stale source_sample_id FK(s) {stale_constraints} → sample_requests")
            except Exception as e:
                logger.warning(f"source_sample_id FK migration failed: {e}")

            # 1c. Advanced Search Optimization (Trigrams)
            try:
                logger.info("Migration: Enabling pg_trgm extension")
                conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
                conn.commit()
                
                # GIN indexes for fuzzy search on large text volumes
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_items_code_trgm ON items USING gin (code gin_trgm_ops)"))
                conn.execute(text("CREATE INDEX IF NOT EXISTS idx_items_name_trgm ON items USING gin (name gin_trgm_ops)"))
                conn.commit()
                logger.info("Migration: Created GIN trigram indexes for high-speed search")
            except Exception as e:
                logger.warning(f"Trigram index creation failed: {e}")

            # 2. Data Migration: Move single attribute_id/attribute_value_id to secondary tables if data exists
            # These are the many-to-many migrations
            move_data = [
                ("items", "attribute_id", "item_attributes", "item_id", "attribute_id"),
                ("stock_ledger", "attribute_value_id", "stock_ledger_values", "stock_ledger_id", "attribute_value_id"),
                ("boms", "attribute_value_id", "bom_values", "bom_id", "attribute_value_id"),
                ("bom_lines", "attribute_value_id", "bom_line_values", "bom_line_id", "attribute_value_id")
            ]

            for src_table, src_col, target_table, target_id_col, target_val_col in move_data:
                try:
                    # Check if src_col exists before attempting migration
                    res = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_name='{src_table}' AND column_name='{src_col}'"))
                    if res.fetchone():
                        conn.execute(text(f"""
                            INSERT INTO {target_table} ({target_id_col}, {target_val_col}) 
                            SELECT id, {src_col} FROM {src_table} 
                            WHERE {src_col} IS NOT NULL 
                            ON CONFLICT DO NOTHING
                        """))
                        conn.commit()
                        logger.info(f"Migration: Moved {src_col} data to {target_table}")
                except Exception as e:
                    pass

            # 3. Verify Routing Tables (WorkCenter, Operation)
            try:
                # Just a simple check to ensure they exist (create_all should have handled it)
                conn.execute(text("SELECT 1 FROM work_centers LIMIT 1"))
                conn.execute(text("SELECT 1 FROM operations LIMIT 1"))
                conn.execute(text("SELECT 1 FROM bom_operations LIMIT 1"))
                conn.execute(text("SELECT 1 FROM sales_orders LIMIT 1"))
                conn.execute(text("SELECT 1 FROM sample_requests LIMIT 1"))
                conn.execute(text("SELECT 1 FROM audit_logs LIMIT 1"))
                conn.execute(text("SELECT 1 FROM partners LIMIT 1"))
                conn.execute(text("SELECT 1 FROM purchase_orders LIMIT 1"))
                logger.info("Migration: Verified routing and partner tables")
            except Exception as e:
                pass

    except Exception as e:
        logger.error(f"Migration engine failed: {e}")

from app.models.category import Category
from app.models.auth import Permission, Role, User
from app.models.uom import UOM
from app.core.security import get_password_hash

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

def seed_colors_attribute(db):
    try:
        from app.models.attribute import Attribute
        existing = db.query(Attribute).filter(Attribute.name == "Colors").first()
        if not existing:
            db.add(Attribute(name="Colors", is_system=True))
            db.commit()
            logger.info("Seeded 'Colors' attribute")
        elif not existing.is_system:
            existing.is_system = True
            db.commit()
            logger.info("Marked existing 'Colors' attribute as system")
    except Exception as e:
        logger.warning(f"Colors attribute seeding skipped: {e}")

def seed_categories(db):
    try:
        if db.query(Category).count() == 0:
            defaults = ["Raw Material", "WIP", "Finished Goods", "Sample", "Consumable"]
            for name in defaults:
                db.add(Category(name=name))
            db.commit()
            logger.info("Seeded default categories")
    except Exception as e:
        logger.warning(f"Category seeding skipped: {e}")

def seed_uoms(db):
    try:
        if db.query(UOM).count() == 0:
            defaults = ["pcs", "kg", "m", "l", "box", "roll"]
            for name in defaults:
                db.add(UOM(name=name))
            db.commit()
            logger.info("Seeded default UOMs")
    except Exception as e:
        logger.warning(f"UOM seeding skipped: {e}")

def seed_rbac(db):
    try:
        # 1. Define Permissions
        perms_data = [
            ("inventory.manage", "Manage Items, Attributes, Categories"),
            ("inventory.delete", "Delete Inventory Data"),
            ("locations.manage", "Manage Locations"),
            ("manufacturing.manage", "Manage BOMs and Routing"),
            ("work_order.manage", "Create and Update Work Orders"),
            ("stock.entry", "Record Stock Movements"),
            ("reports.view", "View Reports"),
            ("admin.access", "Full System Access"),
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
            
        # 2. Define Roles
        roles_data = {
            "Administrator": ["admin.access", "inventory.manage", "inventory.delete", "locations.manage", "manufacturing.manage", "work_order.manage", "stock.entry", "reports.view"],
            "Store Manager": ["inventory.manage", "stock.entry", "reports.view"],
            "Production Manager": ["manufacturing.manage", "work_order.manage", "reports.view"],
            "Operator": ["work_order.manage"]
        }
        
        for role_name, perm_codes in roles_data.items():
            role = db.query(Role).filter(Role.name == role_name).first()
            if not role:
                role = Role(name=role_name)
                db.add(role)
                db.commit()
                db.refresh(role)
            
            # Assign permissions
            current_perms = role.permissions
            for code in perm_codes:
                if db_perms[code] not in current_perms:
                    role.permissions.append(db_perms[code])
            db.commit()

        # 3. Seed Users (Simulated)
        users_data = [
            ("admin", "System Admin", "Administrator"),
            ("store_mgr", "Budi Store", "Store Manager"),
            ("prod_mgr", "Siti Production", "Production Manager"),
            ("operator", "Joko Worker", "Operator"),
        ]

        for uname, fname, rname in users_data:
            user = db.query(User).filter(User.username == uname).first()
            if not user:
                role = db.query(Role).filter(Role.name == rname).first()
                user = User(
                    username=uname,
                    full_name=fname,
                    role_id=role.id,
                    hashed_password=get_password_hash("password") # Default password
                )
                db.add(user)
                db.commit()

        logger.info("Seeded RBAC (Roles, Permissions, Users)")

    except Exception as e:
        logger.error(f"RBAC seeding failed: {e}")

from app.models.stock_ledger import StockLedger
from app.models.stock_balance import StockBalance
from app.models.attribute import AttributeValue
from app.services import stock_service

def sync_stock_balances(db):
    """
    Synchronizes the pre-calculated stock_balances table with the existing stock_ledger.
    Forces string keys to ensure robust grouping.
    """
    try:
        logger.info("Synchronizing Stock Balances from Ledger...")
        
        # 1. Clear existing summary
        db.execute(text("TRUNCATE stock_balances, stock_balance_values CASCADE"))
        db.commit()

        # 2. Aggregate all ledger entries in memory
        entries = db.query(StockLedger).all()
        aggregated = {} # key: "item_id:loc_id:v_key" -> {qty, attr_ids, raw_item_id, raw_loc_id}

        for e in entries:
            attr_ids = [str(v.id) for v in e.attribute_values]
            v_key = stock_service._generate_variant_key(attr_ids)
            # Force to string to ensure dictionary key uniqueness works across different object instances
            s_key = f"{str(e.item_id)}:{str(e.location_id)}:{v_key}"

            if s_key not in aggregated:
                aggregated[s_key] = {
                    "qty": 0.0, 
                    "attr_ids": attr_ids,
                    "item_id": e.item_id,
                    "location_id": e.location_id,
                    "v_key": v_key
                }
            
            aggregated[s_key]["qty"] += float(e.qty_change)

        logger.info(f"Aggregated {len(entries)} ledger entries into {len(aggregated)} unique balance records.")

        # 3. Create balance records
        for s_key, data in aggregated.items():
            balance = StockBalance(
                item_id=data["item_id"],
                location_id=data["location_id"],
                variant_key=data["v_key"],
                qty=data["qty"]
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

def init_db() -> None:
    logger.info("Initializing Database...")
    # 0. Ensure static directories exist
    ensure_static_dirs()
    
    # 1. Create all tables (including association tables registered in base.py)
    Base.metadata.create_all(bind=engine)
    
    # 2. Run ad-hoc column migrations
    run_migrations()
    
    # 3. Seed and Sync data
    from app.db.session import SessionLocal
    db = SessionLocal()
    try:
        seed_categories(db)
        seed_uoms(db)
        seed_rbac(db)
        seed_colors_attribute(db)
        seed_sizes(db)
        sync_stock_balances(db) # Perform sync
    finally:
        db.close()
        
    logger.info("Database initialization complete.")

if __name__ == "__main__":
    init_db()