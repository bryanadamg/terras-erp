"""grant dye_order.view / setting_order.view to everyone who could already see those tabs

The Dyeing Orders and Setting Orders tabs opened for anyone holding
dye_recipe.view; each tab now opens on its own code. Every holder (role or
direct grant) of dye_recipe.view is handed both, so nobody's page changes until
an admin narrows it.

Revision ID: 82d4a1379bb0
Revises: 874c0829a062
"""
from alembic import op
import sqlalchemy as sa

revision = '82d4a1379bb0'
down_revision = '874c0829a062'
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    for table, owner in (("role_permissions", "role_id"), ("user_permissions", "user_id")):
        conn.execute(
            sa.text(f"""
                INSERT INTO {table} ({owner}, permission_id)
                SELECT DISTINCT t.{owner}, tp.id
                  FROM {table} t
                  JOIN permissions sp ON sp.id = t.permission_id AND sp.code = 'dye_recipe.view'
                  JOIN permissions tp ON tp.code IN ('dye_order.view', 'setting_order.view')
                ON CONFLICT DO NOTHING
            """)
        )


def downgrade():
    pass
