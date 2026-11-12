"""grant calendar.view / beam.view to everyone who could already see the loom tabs

The loom monitor's Calendar and Beams tabs opened for anyone who could open the
monitor (weaving_monitor.view); they now open on calendar.view and beam.view.
Every holder (role or direct grant) of weaving_monitor.view is handed both, so
nobody's monitor changes until an admin narrows it.

Revision ID: 97a3e64cfd40
Revises: 82d4a1379bb0
"""
from alembic import op
import sqlalchemy as sa

revision = '97a3e64cfd40'
down_revision = '82d4a1379bb0'
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
                  JOIN permissions sp ON sp.id = t.permission_id AND sp.code = 'weaving_monitor.view'
                  JOIN permissions tp ON tp.code IN ('calendar.view', 'beam.view')
                ON CONFLICT DO NOTHING
            """)
        )


def downgrade():
    pass
