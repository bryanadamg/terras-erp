from sqlalchemy.ext.asyncio import AsyncSession
from app.models.audit import AuditLog
import json
import logging

logger = logging.getLogger(__name__)

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
    if changes:
        serializable_changes = json.loads(json.dumps(changes, default=str))

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
