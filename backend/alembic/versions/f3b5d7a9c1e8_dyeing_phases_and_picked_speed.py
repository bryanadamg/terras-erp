"""dyeing: three timestamped phases + one picked rope speed

Two changes to how a dye batch is measured, both asked for by the floor:

1. THREE PHASES. A batch is colour-matched, then started, then completed, and each
   act is now stamped. `color_matching_at` joins the two timestamps that already
   existed, so the monitor can report the two gaps separately: matching -> start is
   PREP, start -> complete is the RUN. Only the second is the efficiency window — a
   batch that sat all morning waiting on a shade must not be scored as a slow
   machine, which is exactly what one merged elapsed figure did.

2. ONE PICKED SPEED. The rate was `rpm * yards_per_rev * lines`: three factors, two
   of which nobody at the vessel could verify, and a mistyped rpm read as a real
   measurement. It is now `yards_per_min * lines`, where the speed is PICKED off the
   `Dyeing Speed` system attribute (seeded in init_db) rather than typed. `lines`
   survives unchanged — a vessel really does run several ropes at once, and the
   speed is per rope.

   `target_efficiency_pct` goes with them: the floor asked for the number reported,
   not judged. There is no dye equivalent of the loom's contracted daily rate, so a
   50% default was a threshold nobody had ever set.

Backfill: `yards_per_min = rpm * work_centers.yards_per_rev` wherever both were
recorded — that product IS the per-rope speed, so existing runs keep their rate.
`color_matching_at` stays null on history: nobody pressed a button that did not
exist, and stamping `started_at` into it would invent a zero-minute prep for every
past batch.

Revision ID: f3b5d7a9c1e8
Revises: e4a6c8b0d2f5
"""
from alembic import op
import sqlalchemy as sa

revision = "f3b5d7a9c1e8"
down_revision = "e4a6c8b0d2f5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("dyeing_runs", sa.Column("color_matching_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("dyeing_runs", sa.Column("yards_per_min", sa.Numeric(10, 3), nullable=True))

    # The old three-factor rate, collapsed to the one factor that replaces it. The
    # vessel is reached through the WO, the same hop every dyeing aggregate makes.
    op.execute(
        """
        UPDATE dyeing_runs AS dr
           SET yards_per_min = dr.rpm * wc.yards_per_rev
          FROM work_orders AS wo
          JOIN work_centers AS wc ON wc.id = wo.work_center_id
         WHERE wo.id = dr.work_order_id
           AND dr.rpm IS NOT NULL
           AND wc.yards_per_rev IS NOT NULL
        """
    )

    op.drop_column("dyeing_runs", "target_efficiency_pct")
    op.drop_column("dyeing_runs", "rpm")
    op.drop_column("work_centers", "yards_per_rev")


def downgrade() -> None:
    op.add_column("work_centers", sa.Column("yards_per_rev", sa.Numeric(10, 4), nullable=True))
    op.add_column("dyeing_runs", sa.Column("rpm", sa.Numeric(10, 3), nullable=True))
    op.add_column(
        "dyeing_runs",
        sa.Column("target_efficiency_pct", sa.Numeric(6, 2), nullable=False, server_default="50"),
    )
    # The split back into rpm x reel geometry is not recoverable — the reel figure is
    # gone. Park the whole speed on rpm against a reel of 1 so the rate still reads.
    op.execute("UPDATE dyeing_runs SET rpm = yards_per_min WHERE yards_per_min IS NOT NULL")
    op.execute(
        """
        UPDATE work_centers SET yards_per_rev = 1
         WHERE id IN (
            SELECT DISTINCT wo.work_center_id
              FROM dyeing_runs dr JOIN work_orders wo ON wo.id = dr.work_order_id
             WHERE dr.yards_per_min IS NOT NULL AND wo.work_center_id IS NOT NULL
         )
        """
    )
    op.drop_column("dyeing_runs", "yards_per_min")
    op.drop_column("dyeing_runs", "color_matching_at")
