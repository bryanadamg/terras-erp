from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit import AuditLog
import json
import logging
from decimal import Decimal

logger = logging.getLogger(__name__)


# `changes` has ONE shape: {field: [old, new]}. An update lists only the fields that
# moved (`diff`); a create, or an event's context (a transfer's qty, a mount's beam),
# has nothing before it (`added`). The UI renders every value as old -> new, so a
# bare value or a {"from", "to"} dict shows up as malformed there.

def diff(before: dict, after: dict) -> dict:
    """{field: [old, new]} for the fields of `after` that actually moved.

    Numbers compare by value (a Numeric column is Decimal('4.0000'), the payload
    sent 4); everything else as strings (a UUID column vs the id string it was set
    from), so neither reports a change that never happened.
    """
    def same(a, b):
        if a is None or b is None:
            return a is b
        nums = (int, float, Decimal)
        if isinstance(a, nums) and isinstance(b, nums) and not isinstance(a, bool) and not isinstance(b, bool):
            return float(a) == float(b)
        return str(a) == str(b)

    return {f: [before.get(f), b] for f, b in after.items() if not same(before.get(f), b)}


def added(values: dict) -> dict:
    """{field: [None, value]} — values with nothing before them."""
    return {k: [None, v] for k, v in values.items()}


def fields_of(obj, fields) -> dict:
    """Plain-value copy of `fields` on `obj`, taken before mutating it for `diff`."""
    return {f: getattr(obj, f, None) for f in fields}


async def log_activity(
    db: AsyncSession,
    user_id: str | None,
    action: str,
    entity_type: str,
    entity_id: str,
    details: str = None,
    changes: dict = None,
    commit: bool = True,
):
    """
    Records an activity in the audit log.

    The row goes in under a SAVEPOINT, so a failed audit write unwinds only itself and
    never the caller's pending work. `commit=True` (the default) is for the usual
    audit-after-commit call site. Pass `commit=False` when auditing *before* the
    caller's own commit — otherwise this commit would flush the caller's half-done
    mutation, and the caller's later failure could no longer roll it back.
    """
    # Pre-process changes to handle UUIDs and other non-serializable types
    serializable_changes = None
    if changes:   # {} -> NULL: "nothing recorded" has one spelling
        serializable_changes = json.loads(json.dumps(changes, default=str))
        bad = [k for k, v in serializable_changes.items() if not (isinstance(v, list) and len(v) == 2)]
        if bad:
            logger.warning(f"Audit changes for {entity_type} not [old, new] pairs: {bad}")

    try:
        async with db.begin_nested():
            db.add(AuditLog(
                user_id=user_id,
                action=action,
                entity_type=entity_type,
                entity_id=str(entity_id),
                details=details,
                changes=serializable_changes
            ))
    except Exception as e:
        logger.error(f"Failed to create audit log: {e}")
        return

    if commit:
        try:
            await db.commit()
        except Exception as e:
            logger.error(f"Failed to commit audit log: {e}")
            await db.rollback()
