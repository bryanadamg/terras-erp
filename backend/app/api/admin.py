from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.core.db_manager import db_manager
from app.core.scheduler import backup_scheduler
from app.core.ws_manager import manager as ws_manager
from app.core.security import verify_password
from app.db.session import get_db
from app.schemas import DatabaseResponse, ConnectionProfile, WipeDatabaseRequest, BackupScheduleUpdate, BackupScheduleResponse
from app.api.auth import get_current_admin
from app.models.auth import User
from app.models.audit import AuditLog
from app.services import backup_schedule_service
from pathlib import Path
from urllib.parse import urlparse, urlunparse
import shutil
import time

router = APIRouter(prefix="/admin/database", tags=["admin"])


def _log_admin_action(user_id, action: str, details: str) -> None:
    """Best-effort audit log for destructive DB admin operations. Uses its own
    short-lived session (these routes have no injected db dependency) and never
    lets a logging failure block the actual admin action — e.g. right after a
    DB switch, the "current" session may point at a database with no audit_logs
    table yet."""
    try:
        session = db_manager.session_factory()
        try:
            session.add(AuditLog(user_id=user_id, action=action, entity_type="Database", entity_id="admin", details=details))
            session.commit()
        finally:
            session.close()
    except Exception:
        pass

@router.get("/status")
async def get_system_status(current_user: User = Depends(get_current_admin)):
    result = {
        "db": {"ok": False, "latency_ms": None},
        "redis": {"ok": False, "latency_ms": None},
        "db_size_bytes": None,
    }
    try:
        if db_manager.async_engine:
            start = time.perf_counter()
            async with db_manager.async_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
                size = await conn.execute(text("SELECT pg_database_size(current_database())"))
                result["db_size_bytes"] = size.scalar()
            result["db"]["ok"] = True
            result["db"]["latency_ms"] = round((time.perf_counter() - start) * 1000, 1)
    except Exception:
        pass
    try:
        start = time.perf_counter()
        if ws_manager.redis and await ws_manager.redis.ping():
            result["redis"]["ok"] = True
            result["redis"]["latency_ms"] = round((time.perf_counter() - start) * 1000, 1)
    except Exception:
        pass
    return result

@router.get("/current", response_model=DatabaseResponse)
def get_current_db(current_user: User = Depends(get_current_admin)):
    parsed = urlparse(db_manager.current_url)
    masked = parsed._replace(
        netloc=parsed.netloc.replace(f":{parsed.password}@", ":***@") if parsed.password else parsed.netloc
    )
    safe_url = urlunparse(masked)

    return DatabaseResponse(
        message="Current database info",
        status=True,
        data={"url": safe_url}
    )

@router.post("/switch", response_model=DatabaseResponse)
def switch_db(profile: ConnectionProfile, current_user: User = Depends(get_current_admin)):
    parsed = urlparse(profile.url)
    safe_target = urlunparse(parsed._replace(netloc=parsed.netloc.replace(f":{parsed.password}@", ":***@") if parsed.password else parsed.netloc))
    res = db_manager.initialize(profile.url)
    if not res.status:
        raise HTTPException(status_code=400, detail=res.message)

    _log_admin_action(current_user.id, "DB_SWITCH", f"Switched database to {safe_target}")
    return res

@router.get("/snapshots")
def list_snapshots(current_user: User = Depends(get_current_admin)):
    return db_manager.list_snapshots()

@router.post("/snapshots")
async def create_snapshot(current_user: User = Depends(get_current_admin)):
    result = await db_manager.create_snapshot()
    if result.status:
        _log_admin_action(current_user.id, "DB_SNAPSHOT", result.message)
    return result

@router.get("/snapshots/{filename}/download")
def download_snapshot(filename: str, current_user: User = Depends(get_current_admin)):
    path = db_manager.get_snapshot_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, filename=filename)

@router.delete("/snapshots/{filename}")
def delete_snapshot(filename: str, current_user: User = Depends(get_current_admin)):
    path = db_manager.get_snapshot_path(filename)
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    path.unlink()
    _log_admin_action(current_user.id, "DB_SNAPSHOT_DELETE", f"Deleted snapshot {path.name}")
    return {"message": f"Snapshot {path.name} deleted", "status": True}

@router.post("/snapshots/upload")
async def upload_snapshot(file: UploadFile = File(...), current_user: User = Depends(get_current_admin)):
    safe_filename = Path(file.filename).name
    dest = db_manager.get_snapshot_path(safe_filename)
    with dest.open("wb") as buffer:
        await run_in_threadpool(shutil.copyfileobj, file.file, buffer)

    _log_admin_action(current_user.id, "DB_SNAPSHOT_UPLOAD", f"Uploaded snapshot {safe_filename}")
    return {"message": f"Snapshot {safe_filename} uploaded", "status": True}

@router.post("/snapshots/{filename}/restore")
async def restore_db(filename: str, current_user: User = Depends(get_current_admin)):
    result = await db_manager.restore_snapshot(filename)
    if result.status:
        _log_admin_action(current_user.id, "DB_RESTORE", f"Restored snapshot {filename}")
    return result

@router.post("/wipe", response_model=DatabaseResponse)
async def wipe_database(payload: WipeDatabaseRequest, current_user: User = Depends(get_current_admin)):
    if not verify_password(payload.password, current_user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect password")

    result = await db_manager.wipe_and_reset()
    if result.status:
        _log_admin_action(current_user.id, "DB_WIPE", f"Database wiped and reset to blank state by {current_user.username}")
    return result


def _schedule_response(schedule) -> BackupScheduleResponse:
    return BackupScheduleResponse(
        id=schedule.id,
        enabled=schedule.enabled,
        frequency=schedule.frequency,
        day_of_week=schedule.day_of_week,
        hour=schedule.hour,
        minute=schedule.minute,
        timezone=schedule.timezone,
        retain_count=schedule.retain_count,
        last_run_at=schedule.last_run_at,
        last_run_status=schedule.last_run_status,
        last_run_error=schedule.last_run_error,
        next_run_at=backup_scheduler.next_run_time(schedule),
    )


@router.get("/backup-schedule", response_model=BackupScheduleResponse)
def get_backup_schedule(db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    schedule = backup_schedule_service.get_or_create_schedule(db)
    return _schedule_response(schedule)


@router.put("/backup-schedule", response_model=BackupScheduleResponse)
def update_backup_schedule(payload: BackupScheduleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_admin)):
    if payload.frequency not in ("daily", "weekly"):
        raise HTTPException(status_code=400, detail="frequency must be 'daily' or 'weekly'")
    if payload.frequency == "weekly" and payload.day_of_week is None:
        raise HTTPException(status_code=400, detail="day_of_week is required for a weekly schedule")
    if not (0 <= payload.hour <= 23 and 0 <= payload.minute <= 59):
        raise HTTPException(status_code=400, detail="Invalid time of day")
    if payload.retain_count < 1:
        raise HTTPException(status_code=400, detail="retain_count must be at least 1")

    schedule = backup_schedule_service.get_or_create_schedule(db)
    schedule = backup_schedule_service.update_schedule(db, schedule, payload.model_dump(), current_user.id)
    _log_admin_action(current_user.id, "DB_BACKUP_SCHEDULE_UPDATE", f"Backup schedule updated: enabled={schedule.enabled}, frequency={schedule.frequency}, retain_count={schedule.retain_count}")
    return _schedule_response(schedule)


@router.post("/backup-schedule/run-now", response_model=DatabaseResponse)
async def run_backup_now(current_user: User = Depends(get_current_admin)):
    try:
        result = await backup_schedule_service.run_scheduled_backup()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup run failed: {e}")
    if result is None:
        raise HTTPException(status_code=404, detail="No backup schedule configured yet")
    return result
