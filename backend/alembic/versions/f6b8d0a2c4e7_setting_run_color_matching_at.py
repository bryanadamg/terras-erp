"""setting runs: the colour-matching stamp the dyeing runs already got

`f3b5d7a9c1e8` gave a dye batch its three phase stamps, but added
`color_matching_at` to `dyeing_runs` only. `SettingRun` declares the same
column — the phase model is shared, a setting run is matched, started and
completed like any other — so every `select(SettingRun)` has been raising
`UndefinedColumnError` since the model landed: the Setting Orders tab, the
monitor, and each `/setting-runs` route.

Null on history for the same reason as the dyeing side: nobody pressed a
button that did not exist, and copying `started_at` in would invent a
zero-minute prep for every past run.

Revision ID: f6b8d0a2c4e7
Revises: d5f7b9c1e3a6
"""
from alembic import op
import sqlalchemy as sa

revision = "f6b8d0a2c4e7"
down_revision = "d5f7b9c1e3a6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("setting_runs", sa.Column("color_matching_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("setting_runs", "color_matching_at")
