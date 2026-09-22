import asyncio
import threading
import logging
import os
import re
import subprocess
import shutil
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Generator, AsyncGenerator, Optional, List
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.engine import make_url
from fastapi.concurrency import run_in_threadpool
from app.schemas import DatabaseResponse, ConnectionProfile

logger = logging.getLogger(__name__)

# Matches filenames create_snapshot() produces (`snapshot_{label}_{YYYYmmdd}_{HHMMSS}.ext`)
# so the UI can tag scheduled vs. manual snapshots and retention can target only the
# ones the scheduler itself created. Anything that doesn't match (e.g. an uploaded
# file with an arbitrary name) is treated as "manual" — never auto-pruned.
_SNAPSHOT_NAME_RE = re.compile(r"^snapshot_(?P<label>.+)_(?P<ts>\d{8}_\d{6})\.\w+$")

# Uploaded images/PDFs (logos, sample photos, BOM design files, delivery notes) live on
# disk under static/ and are referenced from the DB only as `/static/...` URL strings.
# A dump alone therefore restores rows pointing at files that don't exist on the target
# host, so a snapshot bundles both: one .zip holding the dump plus the whole static tree
# at its original relative paths, which is what keeps those references resolvable.
_STATIC_DIR = Path("static")
_DUMP_NAMES = ("database.sql", "database.sqlite")


def _bundle_snapshot(dump_path: Path, arcname: str, zip_path: Path) -> int:
    """Packs the DB dump + static/ into one portable .zip. Returns the file count."""
    count = 0
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(dump_path, arcname)
        if _STATIC_DIR.is_dir():
            for f in _STATIC_DIR.rglob("*"):
                if f.is_file():
                    # Stored relative to static/'s parent, so the archive always reads
                    # `static/<...>` no matter how _STATIC_DIR itself is spelled.
                    zf.write(f, f.relative_to(_STATIC_DIR.parent).as_posix())
                    count += 1
    return count


def _unpack_snapshot(zip_path: Path, dest: Path, on_file=None) -> Optional[Path]:
    """Extracts a bundled snapshot: the dump into `dest`, static files back into static/.
    Merge, never mirror — a local file the bundle doesn't carry is left alone, since an
    orphaned file is harmless while a deleted one breaks a row that still points at it.
    Returns the extracted dump path, or None if the zip carries no dump.
    `on_file(done, total)` is called per extracted static file so the caller can report
    real progress rather than guessing at one."""
    dump = None
    with zipfile.ZipFile(zip_path) as zf:
        total = sum(1 for i in zf.infolist() if not i.is_dir())
        done = 0
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename
            parts = Path(name).parts
            if not parts or ".." in parts or Path(name).is_absolute():
                continue  # zip-slip guard: never write outside the intended roots
            if name in _DUMP_NAMES:
                zf.extract(info, dest)
                dump = dest / name
            elif parts[0] == _STATIC_DIR.name:
                target = _STATIC_DIR.parent / Path(*parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, target.open("wb") as out:
                    shutil.copyfileobj(src, out)
            done += 1
            if on_file:
                on_file(done, total)
    return dump

def _label_for_filename(name: str) -> str:
    match = _SNAPSHOT_NAME_RE.match(name)
    return match.group("label") if match else "manual"

def _created_at_for(path: Path) -> datetime:
    """When the snapshot was taken. NOT st_ctime — that is the inode change time on
    Linux, so copying the snapshots dir into a fresh container stamps every file with
    the same rebuild timestamp. The filename carries the real wall clock; fall back to
    mtime for uploaded files with arbitrary names."""
    match = _SNAPSHOT_NAME_RE.match(path.name)
    if match:
        try:
            return datetime.strptime(match.group("ts"), "%Y%m%d_%H%M%S")
        except ValueError:
            pass
    return datetime.fromtimestamp(path.stat().st_mtime)

class DatabaseManager:
    def __init__(self):
        self._init_lock = threading.Lock()
        self._engine = None
        self._async_engine = None
        self._session_factory = None
        self._async_session_factory = None
        self._current_url = None
        self._profiles_path = Path("database_profiles.json")
        self._snapshots_dir = Path("snapshots")
        self._snapshots_dir.mkdir(exist_ok=True)
        # Restore runs as a background task and reports through here rather than holding
        # the HTTP request open: the psql load outlives a proxy's idle timeout, and a
        # client polling for phases needs answers while the schema is dropped — which is
        # exactly when nothing can be read out of the database itself.
        self._restore_state: dict = {"status": "idle"}

    @property
    def restore_state(self) -> dict:
        return dict(self._restore_state)

    def _set_restore_phase(self, phase: str, pct: int, **extra) -> None:
        self._restore_state.update({"status": "running", "phase": phase, "pct": pct, **extra})

    async def create_snapshot(self, label: str = "manual") -> DatabaseResponse:
        """Creates a snapshot of the current database plus every uploaded file, as one
        portable .zip (dump + static/ tree) that restores whole on any other instance."""
        if not self._current_url:
            return DatabaseResponse(message="No database connection", status=False)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"snapshot_{label}_{timestamp}"
        zip_path = self._snapshots_dir / f"{filename}.zip"

        try:
            with tempfile.TemporaryDirectory() as tmp:
                if "postgresql" in self._current_url:
                    url = make_url(self._current_url)

                    env = os.environ.copy()
                    if url.password:
                        env["PGPASSWORD"] = url.password

                    # Dump to a temp dir, not into snapshots/ — a half-written .sql sitting
                    # next to the finished bundles would show up in the snapshot list.
                    dump_path = Path(tmp) / "database.sql"

                    cmd = [
                        "pg_dump",
                        "-h", url.host or "localhost",
                        "-p", str(url.port or 5432),
                        "-U", url.username or "postgres",
                        "-f", str(dump_path),
                        url.database
                    ]
                    proc = await asyncio.create_subprocess_exec(
                        *cmd,
                        env=env,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, stderr = await proc.communicate()
                    if proc.returncode != 0:
                        raise Exception(f"pg_dump failed: {stderr.decode()}")
                    kind = "Postgres"

                elif "sqlite" in self._current_url:
                    db_path = self._current_url.replace("sqlite:///", "")
                    dump_path = Path(tmp) / "database.sqlite"
                    await run_in_threadpool(shutil.copy2, db_path, dump_path)
                    kind = "SQLite"

                else:
                    return DatabaseResponse(message="Unsupported database provider for snapshots", status=False)

                file_count = await run_in_threadpool(_bundle_snapshot, dump_path, dump_path.name, zip_path)

            return DatabaseResponse(
                message=f"{kind} snapshot created: {filename} ({file_count} uploaded file(s) included)",
                status=True,
                data={"filename": zip_path.name, "static_files": file_count},
            )
        except Exception as e:
            logger.error(f"Snapshot failed: {e}")
            zip_path.unlink(missing_ok=True)
            return DatabaseResponse(message=f"Snapshot failed: {str(e)}", status=False)

    def list_snapshots(self) -> List[dict]:
        """Lists all available snapshots."""
        files = []
        for f in self._snapshots_dir.glob("*"):
            stats = f.stat()
            files.append({
                "name": f.name,
                "size": stats.st_size,
                "created_at": _created_at_for(f).isoformat(),
                "label": _label_for_filename(f.name),
            })
        return sorted(files, key=lambda x: x["created_at"], reverse=True)

    def prune_old_scheduled_snapshots(self, retain_count: int) -> int:
        """Deletes the oldest scheduler-created snapshots beyond `retain_count`.
        Manual and uploaded snapshots are never touched. Returns the number deleted."""
        scheduled = [f for f in self.list_snapshots() if f["label"] == "scheduled"]
        deleted = 0
        for f in scheduled[retain_count:]:
            try:
                self.get_snapshot_path(f["name"]).unlink(missing_ok=True)
                deleted += 1
            except Exception as e:
                logger.error(f"Failed to prune snapshot {f['name']}: {e}")
        return deleted

    def get_snapshot_path(self, filename: str) -> Path:
        """Returns the absolute path to a snapshot file, guarding against path traversal."""
        safe_name = Path(filename).name  # strips all parent directory components
        return self._snapshots_dir / safe_name

    async def _terminate_other_connections(self, url, env: dict) -> None:
        """Force-close every other backend on this database before running DDL that needs
        exclusive locks (schema drop, ALTER ... OWNER TO). Necessary because the very request
        calling restore/wipe holds its own open auth session (get_current_user lazy-loads
        role.permissions via the sync get_db dependency, which FastAPI keeps open for the
        whole request) — without this, DDL on `permissions`/`role_permissions` deadlocks
        against its own caller's transaction and hangs forever."""
        cmd = [
            "psql",
            "-h", url.host or "localhost",
            "-p", str(url.port or 5432),
            "-U", url.username or "postgres",
            "-d", url.database,
            "-v", "ON_ERROR_STOP=1",
            "-c", "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid();",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        await proc.communicate()

    async def restore_snapshot(self, filename: str) -> DatabaseResponse:
        """Restores the current database from a snapshot."""
        if not self._current_url:
            return DatabaseResponse(message="No active database connection", status=False)

        safe_name = Path(filename).name
        filepath = self._snapshots_dir / safe_name
        if not filepath.exists():
            return DatabaseResponse(message="Snapshot file not found", status=False)

        tmpdir = None
        restored_files = 0
        started = datetime.now()
        self._restore_state = {"status": "running", "phase": "Reading snapshot", "pct": 2,
                               "filename": safe_name, "started_at": started.isoformat()}
        try:
            # .zip = bundle (dump + uploaded files). Bare .sql/.sqlite still restore as
            # before, so snapshots taken before bundling — and hand-made pg_dumps — keep
            # working; they simply carry no files.
            if filepath.suffix.lower() == ".zip":
                tmpdir = tempfile.TemporaryDirectory()

                def _progress(done: int, total: int) -> None:
                    # 5..35% spans the unpack; the share is real (files done / files in
                    # the bundle), only the band it maps onto is fixed.
                    self._set_restore_phase("Restoring uploaded files", 5 + int(30 * done / max(total, 1)),
                                            files_done=done, files_total=total)

                dump = await run_in_threadpool(_unpack_snapshot, filepath, Path(tmpdir.name), _progress)
                if dump is None:
                    raise Exception("Bundle contains no database dump")
                restored_files = self._restore_state.get("files_total", 1) - 1  # minus the dump entry
                filepath = dump

            if self._engine:
                self._engine.dispose()

            if "postgresql" in self._current_url:
                url = make_url(self._current_url)

                env = os.environ.copy()
                if url.password:
                    env["PGPASSWORD"] = url.password

                self._set_restore_phase("Closing open connections", 40)
                await self._terminate_other_connections(url, env)
                self._set_restore_phase("Resetting schema", 45)

                # pg_dump snapshots are taken without --clean, so restoring onto a
                # non-empty schema (the normal case) fails almost every CREATE TABLE /
                # COPY with "already exists" / "duplicate key" — psql swallows these
                # (no ON_ERROR_STOP) and still exits 0, so the restore silently no-ops.
                # Drop and recreate the schema first so the dump lands on a clean slate.
                drop_cmd = [
                    "psql",
                    "-h", url.host or "localhost",
                    "-p", str(url.port or 5432),
                    "-U", url.username or "postgres",
                    "-d", url.database,
                    "-v", "ON_ERROR_STOP=1",
                    "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;",
                ]
                drop_proc = await asyncio.create_subprocess_exec(
                    *drop_cmd, env=env,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                _, drop_stderr = await drop_proc.communicate()
                if drop_proc.returncode != 0:
                    raise Exception(f"schema reset before restore failed: {drop_stderr.decode()}")

                self._set_restore_phase("Loading database dump", 55)
                cmd = [
                    "psql",
                    "-h", url.host or "localhost",
                    "-p", str(url.port or 5432),
                    "-U", url.username or "postgres",
                    "-d", url.database,
                    "-f", str(filepath)
                ]
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    raise Exception(f"pg_restore failed: {stderr.decode()}")

            elif "sqlite" in self._current_url:
                db_path = self._current_url.replace("sqlite:///", "")
                # Threadpool like every other copy here: a restore is a whole
                # database file, and copying it on the loop stalls every other
                # request for the duration.
                await run_in_threadpool(shutil.copy2, filepath, db_path)

            self._set_restore_phase("Reconnecting", 95)
            res = self.initialize(self._current_url)
            if res.status and restored_files:
                res.message = f"Database restored, with {restored_files} uploaded file(s)"
            self._restore_state = {
                "status": "done" if res.status else "error",
                "phase": "Finished" if res.status else "Failed",
                "pct": 100, "filename": safe_name, "message": res.message,
                "files_restored": restored_files,
                "started_at": started.isoformat(),
                "elapsed_seconds": round((datetime.now() - started).total_seconds(), 1),
            }
            return res
        except Exception as e:
            logger.error(f"Restore failed: {e}")
            self._restore_state = {
                "status": "error", "phase": "Failed", "pct": 100, "filename": safe_name,
                "message": f"Restore failed: {str(e)}",
                "started_at": started.isoformat(),
                "elapsed_seconds": round((datetime.now() - started).total_seconds(), 1),
            }
            return DatabaseResponse(message=f"Restore failed: {str(e)}", status=False)
        finally:
            if tmpdir:
                tmpdir.cleanup()

    async def wipe_and_reset(self) -> DatabaseResponse:
        """Irreversibly drops every table/row in the current database, then rebuilds
        it from scratch (Alembic migrations + init_db seeding). Used to blow away
        stale local data before importing a snapshot from another environment."""
        if not self._current_url:
            return DatabaseResponse(message="No active database connection", status=False)

        try:
            if self._engine:
                self._engine.dispose()
            if self._async_engine:
                await self._async_engine.dispose()

            if "postgresql" in self._current_url:
                url = make_url(self._current_url)
                env = os.environ.copy()
                if url.password:
                    env["PGPASSWORD"] = url.password

                await self._terminate_other_connections(url, env)

                drop_cmd = [
                    "psql",
                    "-h", url.host or "localhost",
                    "-p", str(url.port or 5432),
                    "-U", url.username or "postgres",
                    "-d", url.database,
                    "-v", "ON_ERROR_STOP=1",
                    "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
                ]
                proc = await asyncio.create_subprocess_exec(
                    *drop_cmd, env=env,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    raise Exception(f"schema drop failed: {stderr.decode()}")

                mig_env = env.copy()
                mig_env["DATABASE_URL"] = self._current_url
                mig_proc = await asyncio.create_subprocess_exec(
                    "alembic", "upgrade", "head", env=mig_env,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await mig_proc.communicate()
                if mig_proc.returncode != 0:
                    raise Exception(f"migration replay failed: {stderr.decode()}")

            elif "sqlite" in self._current_url:
                db_path = self._current_url.replace("sqlite:///", "")
                if os.path.exists(db_path):
                    os.remove(db_path)

                mig_proc = await asyncio.create_subprocess_exec(
                    "alembic", "upgrade", "head",
                    env={**os.environ, "DATABASE_URL": self._current_url},
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await mig_proc.communicate()
                if mig_proc.returncode != 0:
                    raise Exception(f"migration replay failed: {stderr.decode()}")
            else:
                return DatabaseResponse(message="Unsupported database provider for wipe", status=False)

            init_res = self.initialize(self._current_url)
            if not init_res.status:
                return init_res

            from app.db.init_db import init_db
            await run_in_threadpool(init_db)

            return DatabaseResponse(message="Database wiped and reset to a blank, freshly-seeded state", status=True)
        except Exception as e:
            logger.error(f"Wipe failed: {e}")
            return DatabaseResponse(message=f"Wipe failed: {str(e)}", status=False)

    def initialize(self, database_url: str) -> DatabaseResponse:
        """
        Initializes both sync and async database engines.
        """
        with self._init_lock:
            try:
                # 1. Sync Engine
                if self._engine:
                    self._engine.dispose()

                self._current_url = database_url
                connect_args = {"check_same_thread": False} if "sqlite" in database_url else {}
                
                self._engine = create_engine(
                    database_url,
                    pool_pre_ping=False, # Disabled to prevent shared-state Greenlet errors
                    pool_size=20,
                    max_overflow=10,
                    pool_recycle=3600,
                    connect_args=connect_args
                )
                
                self._session_factory = sessionmaker(
                    autocommit=False,
                    autoflush=False,
                    bind=self._engine
                )

                # 2. Async Engine (only for PostgreSQL)
                if "postgresql" in database_url:
                    async_url = database_url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
                    self._async_engine = create_async_engine(
                        async_url,
                        pool_pre_ping=False, # Disabled to prevent asyncpg do_ping Greenlet errors
                        pool_size=20,
                        max_overflow=10,
                        pool_recycle=3600
                    )
                    self._async_session_factory = async_sessionmaker(
                        autocommit=False,
                        autoflush=False,
                        expire_on_commit=False, # Critical for Pydantic serialization
                        bind=self._async_engine,
                        class_=AsyncSession
                    )

                return DatabaseResponse(message="Database initialized successfully", status=True)
            except Exception as e:
                logger.error(f"Database initialization failed: {e}")
                return DatabaseResponse(message=str(e), status=False)

    def get_session(self) -> Generator[Session, None, None]:
        if not self._session_factory:
            raise RuntimeError("DatabaseManager not initialized.")
        
        db = self._session_factory()
        try:
            yield db
        finally:
            try:
                db.close()
            except Exception:
                # Connection may have been force-terminated server-side (e.g. by
                # restore_snapshot/wipe_and_reset's _terminate_other_connections) —
                # nothing to clean up in that case.
                pass

    async def get_async_session(self) -> AsyncGenerator[AsyncSession, None]:
        if not self._async_session_factory:
            raise RuntimeError("Async DatabaseManager not initialized.")

        async with self._async_session_factory() as session:
            try:
                yield session
            finally:
                try:
                    await session.close()
                except Exception:
                    pass

    @property
    def engine(self):
        return self._engine

    @property
    def async_engine(self):
        return self._async_engine

    @property
    def session_factory(self):
        return self._session_factory

    @property
    def async_session_factory(self):
        """For background work that owns its own session rather than taking one
        from a request (the event-log relay). Request handlers keep using the
        `get_async_db` dependency."""
        return self._async_session_factory

    @property
    def current_url(self):
        return self._current_url

# Global instance
db_manager = DatabaseManager()
