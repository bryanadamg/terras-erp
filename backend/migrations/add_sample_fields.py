# backend/migrations/add_sample_fields.py
"""
Migration: add new fields to sample_requests, create sample_colors table.
Run once: python -m migrations.add_sample_fields  (from backend/)
"""
import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg2://erp:erp@localhost:5432/erp"
)
engine = create_engine(DATABASE_URL)

with engine.begin() as conn:
    # Make base_item_id nullable (was required)
    conn.execute(text(
        "ALTER TABLE sample_requests ALTER COLUMN base_item_id DROP NOT NULL"
    ))

    stmts = [
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS request_date DATE NOT NULL DEFAULT CURRENT_DATE",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS project VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS customer_article_code VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS internal_article_code VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS width VARCHAR(64)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS main_material VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS middle_material VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS bottom_material VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS weft VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS warp VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS original_weight FLOAT",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS production_weight FLOAT",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS additional_info TEXT",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS quantity VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS sample_size VARCHAR(255)",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS estimated_completion_date DATE",
        "ALTER TABLE sample_requests ADD COLUMN IF NOT EXISTS completion_description TEXT",
        """
        CREATE TABLE IF NOT EXISTS sample_colors (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            sample_request_id UUID NOT NULL
                REFERENCES sample_requests(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            is_repeat BOOLEAN NOT NULL DEFAULT FALSE,
            "order" INTEGER NOT NULL DEFAULT 0
        )
        """,
    ]
    for stmt in stmts:
        conn.execute(text(stmt))

print("Migration completed successfully.")
