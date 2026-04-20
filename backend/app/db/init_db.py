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
    except Exception as e:
        logger.warning(f"Static directory creation skipped: {e}")

def run_migrations():
    """
    Run ad-hoc migrations to fix schema discrepancies.
    Using connection.commit() instead of raw SQL COMMIT to avoid transaction warnings.
    """
    try:
        with engine.connect() as conn:
            # 1. Verification of missing columns in existing tables
            migrations = [
                ("items", "category", "VARCHAR(64)"),
                ("items", "source_sample_id", "UUID REFERENCES sample_requests(id) ON DELETE SET NULL"),
                ("items", "source_color_id", "UUID REFERENCES sample_colors(id) ON DELETE SET NULL"),
                ("items", "attribute_id", "UUID REFERENCES attributes(id)"),
                ("work_orders", "location_id", "UUID REFERENCES locations(id)"),
                ("work_orders", "source_location_id", "UUID REFERENCES locations(id)"),
                ("work_orders", "target_start_date", "TIMESTAMP WITHOUT TIME ZONE"),
                ("work_orders", "target_end_date", "TIMESTAMP WITHOUT TIME ZONE"),
                ("work_orders", "actual_start_date", "TIMESTAMP WITHOUT TIME ZONE"),
                ("work_orders", "actual_end_date", "TIMESTAMP WITHOUT TIME ZONE"),
                ("work_orders", "completed_at", "TIMESTAMP WITHOUT TIME ZONE"),
                ("work_orders", "sales_order_id", "UUID REFERENCES sales_orders(id)"),
                ("work_orders", "parent_wo_id", "UUID REFERENCES work_orders(id)"),
                ("bom_lines", "source_location_id", "UUID REFERENCES locations(id)"),
                ("bom_lines", "is_percentage", "BOOLEAN DEFAULT FALSE"),
                ("bom_lines", "percentage", "NUMERIC(6,2) DEFAULT 0.0"),
                ("boms", "tolerance_percentage", "NUMERIC(5,2) DEFAULT 0.0"),
                ("purchase_orders", "target_location_id", "UUID REFERENCES locations(id)"),
                ("users", "hashed_password", "VARCHAR(255)"),
                ("users", "allowed_categories", "JSON"),
                ("sales_orders", "delivered_at", "TIMESTAMP WITHOUT TIME ZONE"),
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
                ("idx_work_orders_item_id", "work_orders", "item_id"),
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

            # Repurpose items.source_sample_id FK: items(self) → sample_requests
            try:
                res = conn.execute(text("""
                    SELECT constraint_name FROM information_schema.table_constraints
                    WHERE table_name='items' AND constraint_name='items_source_sample_id_fkey'
                """))
                row = res.fetchone()
                if row:
                    # Null out stale values pointing to other items, then re-point FK
                    conn.execute(text("""
                        UPDATE items SET source_sample_id = NULL
                        WHERE source_sample_id IS NOT NULL
                          AND source_sample_id NOT IN (SELECT id FROM sample_requests)
                    """))
                    conn.execute(text("ALTER TABLE items DROP CONSTRAINT items_source_sample_id_fkey"))
                    conn.execute(text("""
                        ALTER TABLE items ADD CONSTRAINT items_source_sample_id_fkey
                            FOREIGN KEY (source_sample_id) REFERENCES sample_requests(id) ON DELETE SET NULL
                    """))
                    conn.commit()
                    logger.info("Migration: Repurposed items.source_sample_id FK → sample_requests")
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
                ("bom_lines", "attribute_value_id", "bom_line_values", "bom_line_id", "attribute_value_id"),
                ("work_orders", "attribute_value_id", "work_order_values", "work_order_id", "attribute_value_id")
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
            else:
                # Ensure password is set correctly (Reset for dev/demo)
                # In production, remove this else block
                user.hashed_password = get_password_hash("password")
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
        sync_stock_balances(db) # Perform sync
    finally:
        db.close()
        
    logger.info("Database initialization complete.")

if __name__ == "__main__":
    init_db()