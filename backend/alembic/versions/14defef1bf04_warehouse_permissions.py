"""warehouse permissions: retire sales.manage from packing, pick lists, shipments

Packing Orders and Pick Lists were still gated on the legacy `sales.manage`
blob, which is not seeded and has no row in the Settings permission grid, so no
admin could grant them. Shipments accepted it as an alternative to every
shipment.* code but verify. Routes now check packing_order.* / pick_list.* /
shipment.* only; this migration hands every holder of sales.manage (role OR
direct user grant) the codes it used to satisfy, so nobody loses access.
shipment.verify is deliberately not included — sales.manage never satisfied it.

Revision ID: 14defef1bf04
Revises: c3e7a9d1b5f2
"""
import uuid
from alembic import op
import sqlalchemy as sa

revision = '14defef1bf04'
down_revision = 'c3e7a9d1b5f2'
branch_labels = None
depends_on = None

NEW_PERMISSIONS = [
    ("packing_order.create", "Create Packing Orders"),
    ("packing_order.edit", "Edit/Close Packing Orders"),
    ("packing_order.delete", "Delete Packing Orders"),
    ("packing_order.log", "Log Packed Cartons"),
    ("packing_order.view", "View Packing Orders"),
    ("pick_list.create", "Create Pick Lists"),
    ("pick_list.edit", "Edit Pick Lists"),
    ("pick_list.delete", "Delete Pick Lists"),
    ("pick_list.scan", "Scan Cartons onto Pick Lists"),
    ("pick_list.view", "View Pick Lists"),
    ("shipment.view", "View Shipments"),
    ("shipment.create", "Stage Shipments"),
    ("shipment.edit", "Edit Shipments"),
    ("shipment.dispatch", "Dispatch Shipments"),
    ("shipment.delete", "Delete Shipments"),
]
GRANTED = [code for code, _ in NEW_PERMISSIONS]


def upgrade():
    conn = op.get_bind()
    for code, description in NEW_PERMISSIONS:
        conn.execute(
            sa.text("""
                INSERT INTO permissions (id, code, description)
                SELECT :id, :code, :description
                 WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)
            """),
            {"id": str(uuid.uuid4()), "code": code, "description": description},
        )
    for table, owner in (("role_permissions", "role_id"), ("user_permissions", "user_id")):
        conn.execute(
            sa.text(f"""
                INSERT INTO {table} ({owner}, permission_id)
                SELECT DISTINCT t.{owner}, np.id
                  FROM {table} t
                  JOIN permissions lp ON lp.id = t.permission_id AND lp.code = 'sales.manage'
                  JOIN permissions np ON np.code = ANY(:codes)
                ON CONFLICT DO NOTHING
            """),
            {"codes": GRANTED},
        )


def downgrade():
    # Grants are left in place: the old routes accepted sales.manage, so the extra
    # rows are inert, and deleting could strip grants an admin made after upgrade.
    pass
