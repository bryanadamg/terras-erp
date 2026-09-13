import asyncio
import threading
import logging
import os
import re
import subprocess
import shutil
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
    _instance = None
    _init_lock = threading.Lock()

    def __init__(self):
        self._engine = None
        self._async_engine = None
        self._session_factory = None
        self._async_session_factory = None
        self._current_url = None
        self._profiles_path = Path("database_profiles.json")
        self._snapshots_dir = Path("snapshots")
        self._snapshots_dir.mkdir(exist_ok=True)

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    async def create_snapshot(self, label: str = "manual") -> DatabaseResponse:
        """Creates a snapshot of the current database."""
        if not self._current_url:
            return DatabaseResponse(message="No database connection", status=False)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"snapshot_{label}_{timestamp}"

        try:
            if "postgresql" in self._current_url:
                url = make_url(self._current_url)

                env = os.environ.copy()
                if url.password:
                    env["PGPASSWORD"] = url.password

                filepath = self._snapshots_dir / f"{filename}.sql"

                cmd = [
                    "pg_dump",
                    "-h", url.host or "localhost",
                    "-p", str(url.port or 5432),
                    "-U", url.username or "postgres",
                    "-f", str(filepath),
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
                return DatabaseResponse(message=f"Postgres snapshot created: {filename}", status=True, data={"filename": f"{filename}.sql"})

            elif "sqlite" in self._current_url:
                db_path = self._current_url.replace("sqlite:///", "")
                filepath = self._snapshots_dir / f"{filename}.sqlite"
                shutil.copy2(db_path, filepath)
                return DatabaseResponse(message=f"SQLite snapshot created: {filename}", status=True, data={"filename": f"{filename}.sqlite"})

            return DatabaseResponse(message="Unsupported database provider for snapshots", status=False)
        except Exception as e:
            logger.error(f"Snapshot failed: {e}")
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

        try:
            if self._engine:
                self._engine.dispose()

            if "postgresql" in self._current_url:
                url = make_url(self._current_url)

                env = os.environ.copy()
                if url.password:
                    env["PGPASSWORD"] = url.password

                await self._terminate_other_connections(url, env)

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
                shutil.copy2(filepath, db_path)

            return self.initialize(self._current_url)
        except Exception as e:
            logger.error(f"Restore failed: {e}")
            return DatabaseResponse(message=f"Restore failed: {str(e)}", status=False)

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

    def switch_database(self, new_url: str) -> DatabaseResponse:
        return self.initialize(new_url)

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
db_manager = DatabaseManager.get_instance()
