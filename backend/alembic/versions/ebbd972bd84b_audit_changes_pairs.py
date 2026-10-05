"""audit_logs.changes to {field: [old, new]} where the old shape is unambiguous

The call sites now all write [old, new] pairs. Rows written before that are
rewritten only where the old shape says unambiguously what was old and what was
new: {} (-> NULL), status + previous_status, {"from", "to"} dicts, and
lines_before / lines_after. Bare snapshot values (old create payloads, update
payloads with no before side) are left alone — wrapping them would invent an
"old" nobody recorded; the UI renders a bare value as-is.

Revision ID: ebbd972bd84b
Revises: 9a848367f6e3
Create Date: 2026-10-05
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'ebbd972bd84b'
down_revision: Union[str, None] = '9a848367f6e3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _convert(c: dict) -> dict:
    out = dict(c)
    if "previous_status" in out:
        out["status"] = [out.pop("previous_status"), out.get("status")]
        if "approved_color_code" in out:
            out["approved_color_code"] = [None, out["approved_color_code"]]
    if "lines_before" in out or "lines_after" in out:
        out["lines"] = [out.pop("lines_before", None), out.pop("lines_after", None)]
    for k, v in list(out.items()):
        if isinstance(v, dict) and set(v) == {"from", "to"}:
            out[k] = [v["from"], v["to"]]
    return out


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE audit_logs SET changes = NULL WHERE changes = '{}'::jsonb"))
    rows = bind.execute(sa.text(
        "SELECT id, changes FROM audit_logs WHERE changes ? 'previous_status' "
        "OR changes ? 'lines_before' OR changes::text LIKE '%\"from\"%'"
    )).fetchall()
    for rid, changes in rows:
        new = _convert(changes)
        if new != changes:
            bind.execute(
                sa.text("UPDATE audit_logs SET changes = CAST(:c AS jsonb) WHERE id = :id"),
                {"c": json.dumps(new), "id": rid},
            )


def downgrade() -> None:
    # One-way: the old shapes carried nothing the pairs lose.
    pass
