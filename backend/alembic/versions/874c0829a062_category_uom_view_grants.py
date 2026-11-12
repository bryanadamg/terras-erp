"""grant category.view / uom.view to everyone who could already see those tabs

category.view and uom.view existed but gated nothing: the Categories and Units
tabs opened for anyone holding attribute.view. Each tab now opens on its own
code, so every holder (role or direct grant) of attribute.view, or of any
category.* / uom.* action, is handed the matching view code here — the switch
changes what an admin CAN restrict, not what anyone currently sees.

Revision ID: 874c0829a062
Revises: 14defef1bf04
"""
from alembic import op
import sqlalchemy as sa

revision = '874c0829a062'
down_revision = '14defef1bf04'
branch_labels = None
depends_on = None

GRANTS = {
    "category.view": ["attribute.view", "category.create", "category.edit", "category.delete"],
    "uom.view": ["attribute.view", "uom.create", "uom.edit", "uom.delete"],
}


def upgrade():
    conn = op.get_bind()
    for table, owner in (("role_permissions", "role_id"), ("user_permissions", "user_id")):
        for target, sources in GRANTS.items():
            conn.execute(
                sa.text(f"""
                    INSERT INTO {table} ({owner}, permission_id)
                    SELECT DISTINCT t.{owner}, tp.id
                      FROM {table} t
                      JOIN permissions sp ON sp.id = t.permission_id AND sp.code = ANY(:sources)
                      JOIN permissions tp ON tp.code = :target
                    ON CONFLICT DO NOTHING
                """),
                {"sources": sources, "target": target},
            )


def downgrade():
    pass
