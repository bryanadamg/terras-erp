import pytest
import os
from pathlib import Path
from sqlalchemy.engine import make_url

# Tests must never touch the app's own database (`erp`) — force a dedicated
# `erp_test` database on the same server, derived from whatever DATABASE_URL
# the environment already provides (so this works unchanged in Docker and CI).
# Override with TEST_DB_NAME if a run needs a different base name.
_dev_url = make_url(
    os.environ.get("DATABASE_URL", "postgresql+psycopg2://erp:erp@localhost:5432/erp")
)
_TEST_DB_NAME = os.environ.get("TEST_DB_NAME", "erp_test")
# Under `pytest -n auto` (pytest-xdist), each worker is a separate process with
# its own copy of this module — xdist sets PYTEST_XDIST_WORKER (e.g. "gw0") in
# that process's environment before collection. One DB per worker, or two
# workers' DROP/CREATE DATABASE in `_test_database` below race each other's
# tables out from under whichever test is mid-run.
_XDIST_WORKER = os.environ.get("PYTEST_XDIST_WORKER")
if _XDIST_WORKER:
    _TEST_DB_NAME = f"{_TEST_DB_NAME}_{_XDIST_WORKER}"
# str(URL) masks the password as a literal "***" in SQLAlchemy 2.x — must render explicitly.
os.environ["DATABASE_URL"] = _dev_url.set(database=_TEST_DB_NAME).render_as_string(hide_password=False)

from fastapi.testclient import TestClient
from sqlalchemy import event as sa_event
from sqlalchemy.orm import Session
from app.main import app
from app.db.session import get_db, engine
from app.core.security import create_access_token
from app.models.auth import User
import uuid

# Every connection a test touches gets a lock timeout, so a lock wait fails the
# test that caused it instead of hanging the run. The fixture connection had one
# already; this covers the app's own pool, which is where a route's write can
# block on a row a test's open transaction is holding. Ten seconds is far longer
# than any statement here legitimately needs.
_TEST_LOCK_TIMEOUT_MS = 10_000


@sa_event.listens_for(engine, "connect")
def _set_test_lock_timeout(dbapi_conn, _record):
    if engine.dialect.name != "postgresql":
        return
    with dbapi_conn.cursor() as cur:
        cur.execute(f"SET lock_timeout = {_TEST_LOCK_TIMEOUT_MS}")
    # Committed, not left open: the statement runs inside psycopg2's implicit
    # transaction, and the pool rolls that back when the connection is returned —
    # which silently reverts the setting and was why a blocked DELETE sat for a
    # minute instead of failing after ten seconds.
    dbapi_conn.commit()


# Use the existing engine but wrap in a transaction that rolls back. Explicit
# join_transaction_mode="create_savepoint" (SQLAlchemy 2.0's documented
# external-transaction test pattern): every session.commit() from app code
# releases a SAVEPOINT and opens the next one automatically, so the single
# connection.begin() below is the only thing this fixture must roll back.
@pytest.fixture(scope="function")
def db_session(committed_admin):
    # Depends on the admin purely for ordering: the user must be committed before
    # this transaction opens, and must outlive it (see committed_admin).
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")

    yield session

    session.close()
    transaction.rollback()
    connection.close()

# TestClient(app) runs the real FastAPI lifespan (Redis connect + the booking-
# cache warm pass) on entry — session-scoped so that happens once for the
# whole run, not once per test. The client's `.portal` (its persistent anyio
# event loop) is reused across every test below; nothing keeps a per-test loop
# around anymore, so the async engine's connection pool is safe to keep too —
# see the dropped `dispose_async_engine_pool` in git history if that stops
# being true.
@pytest.fixture(scope="session")
def _app_client(_test_database):
    with TestClient(app, raise_server_exceptions=False) as c:
        yield c


# Async routes get their own connection on the async engine (different driver,
# can't share a DBAPI connection with db_session's psycopg2 one) — but it needs
# the exact same SAVEPOINT treatment, or async writes commit for real and
# outlive the test. Opened and closed through the shared client's portal so it
# runs on the one loop every request uses (asyncpg connections are loop-bound).
#
# Exposed as its own fixture (not just wired straight into `client`) so a test
# that seeds data through a sync-domain endpoint (uoms, attributes, auth) and
# then exercises an async-domain one (items, boms, manufacturing, ...) can
# write the setup data directly on THIS session instead — the two domains sit
# on separate, non-committing connections, so data written through `client`'s
# sync half is invisible to its async half within the same test, same as it
# would be invisible to a second real request; that's correct isolation, not a
# bug, but it means cross-domain test setup can't go through the sync HTTP
# call and has to land here instead.
@pytest.fixture(scope="function")
def async_db_session(_app_client):
    from app.core.db_manager import db_manager
    from sqlalchemy.ext.asyncio import AsyncSession

    # Attach the async engine's lock-timeout listener before opening the first
    # async connection of the run. Idempotent (module-level flag), so this is
    # only real work on the very first test.
    _attach_async_lock_timeout()

    async def _open_async_txn():
        conn = await db_manager.async_engine.connect()
        await conn.begin()
        return conn, AsyncSession(
            bind=conn, join_transaction_mode="create_savepoint", expire_on_commit=False
        )

    async_conn, async_session = _app_client.portal.call(_open_async_txn)

    yield async_session

    async def _close_async_txn():
        await async_session.close()
        await async_conn.rollback()
        await async_conn.close()

    _app_client.portal.call(_close_async_txn)


@pytest.fixture(scope="function")
def client(_app_client, db_session, async_db_session):
    from app.db.session import get_async_db

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db

    async def override_get_async_db():
        yield async_db_session

    app.dependency_overrides[get_async_db] = override_get_async_db

    yield _app_client

    app.dependency_overrides.pop(get_db, None)
    app.dependency_overrides.pop(get_async_db, None)

@pytest.fixture(scope="session", autouse=True)
def _test_database():
    """Create a clean `erp_test` database, migrate it, and seed it — once per
    session. Runs before every other fixture (autouse + session scope), and
    `committed_admin` additionally depends on it directly so ordering holds
    even if pytest's autouse-before-explicit rule ever changes.

    Drop-then-create rather than reuse: a stale `erp_test` from an interrupted
    prior run must not leak rows into this one.
    """
    import psycopg2
    from psycopg2 import sql as pg_sql

    maint = _dev_url.set(database="postgres")
    conn = psycopg2.connect(
        host=maint.host, port=maint.port or 5432,
        user=maint.username, password=maint.password,
        dbname="postgres",
    )
    conn.autocommit = True
    try:
        with conn.cursor() as cur:
            cur.execute(
                pg_sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)")
                .format(pg_sql.Identifier(_TEST_DB_NAME))
            )
            cur.execute(
                pg_sql.SQL("CREATE DATABASE {}").format(pg_sql.Identifier(_TEST_DB_NAME))
            )
    finally:
        conn.close()

    # Build the schema the same way scripts/migrate.sh does for an empty DB,
    # then stamp head so later `alembic upgrade` calls in the same run are no-ops.
    from alembic.config import Config
    from alembic import command
    from app.db.bootstrap import bootstrap_schema

    bootstrap_schema(engine)

    alembic_ini = Path(__file__).resolve().parents[1] / "alembic.ini"
    alembic_cfg = Config(str(alembic_ini))
    alembic_cfg.set_main_option("script_location", str(alembic_ini.parent / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])
    command.stamp(alembic_cfg, "head")

    from app.db.init_db import init_db
    init_db()

    yield


@pytest.fixture(scope="function")
def committed_admin(_test_database):
    """One admin user, committed for real — function-scoped.

    Has to be a real commit, not written into `db_session`'s savepoint: sync
    and async routes read through two different driver connections (psycopg2
    vs asyncpg) that cannot see each other's uncommitted rows, so the one row
    both sides must agree exists has to be actually visible to both.

    Safe to delete per-test now that `client` gives async routes the same
    SAVEPOINT-and-rollback treatment as `db_session` — every row a test wrote
    that references this user (sync or async) is gone by the time this
    fixture's teardown runs (fixtures tear down in reverse dependency order:
    `client` → `db_session` → here), so the FK never blocks the DELETE. Before
    that fix this had to be session-scoped and swallow delete failures; see
    git history if that workaround needs to come back.
    """
    from app.db.session import engine as _eng
    from sqlalchemy.orm import Session as _SASession
    from app.models.auth import Role as _Role

    conn = _eng.connect()
    sess = _SASession(conn)
    admin_role = sess.query(_Role).filter(_Role.name == "Administrator").first()
    user = User(
        # Unique per run: `users.username` is unique, and a leftover row from an
        # earlier run must not collide.
        username=f"testadmin-{uuid.uuid4().hex[:8]}",
        full_name="Test Admin",
        hashed_password="hashed_secret",  # never logged in through the API
        # The seeded Administrator role carries `admin.access`, so every
        # permission-gated route is reachable. Without a role the user
        # authenticates and is then refused with 403.
        role_id=admin_role.id if admin_role else None,
    )
    sess.add(user)
    sess.commit()
    sess.refresh(user)
    user_id = user.id

    yield user

    sess.query(User).filter(User.id == user_id).delete(synchronize_session=False)
    sess.commit()
    sess.close()
    conn.close()


@pytest.fixture(scope="function")
def test_user(committed_admin):
    return committed_admin


@pytest.fixture(scope="function")
def user_factory():
    """Make committed non-admin users whose role holds EXACTLY the given codes.

    For testing permission gates: `committed_admin` holds `admin.access` and so
    passes every one of them. Rows are committed for real, same reason as
    `committed_admin` — async routes read a different connection.

    ORDER MATTERS: list this fixture BEFORE `client` in the test signature.
    Teardown runs in reverse setup order, and these rows can only be deleted once
    the client's transaction has rolled back off them; otherwise the DELETE waits
    on a row lock until the statement timeout.
    """
    from app.db.session import engine as _eng
    from sqlalchemy.orm import Session as _SASession
    from app.models.auth import Permission as _Permission, Role as _Role

    conn = _eng.connect()
    sess = _SASession(conn)
    made: list[tuple] = []

    def _make(codes: list[str], label: str = "user"):
        role = _Role(name=f"role-{label}-{uuid.uuid4().hex[:6]}")
        perms = []
        for code in codes:
            perm = sess.query(_Permission).filter(_Permission.code == code).first()
            if not perm:
                # Legacy blob codes (`sales.manage`) still exist in live databases
                # but seed_rbac deliberately stops re-creating them, so a
                # from-scratch test database has no row to hold.
                perm = _Permission(code=code, description=f"test {code}")
                sess.add(perm)
                sess.flush()
            perms.append(perm)
        role.permissions = perms
        sess.add(role)
        sess.flush()
        user = User(
            username=f"{label}-{uuid.uuid4().hex[:6]}",
            full_name=label,
            hashed_password="hashed_secret",
            role_id=role.id,
        )
        sess.add(user)
        sess.commit()
        sess.refresh(user)
        made.append((user.id, role.id))
        return user, {"Authorization": f"Bearer {create_access_token(subject=user.id)}"}

    yield _make

    for user_id, role_id in made:
        sess.query(User).filter(User.id == user_id).delete(synchronize_session=False)
        role = sess.query(_Role).filter(_Role.id == role_id).first()
        if role:
            role.permissions = []   # the association rows hold the role down
            sess.flush()
            sess.delete(role)
    sess.commit()
    sess.close()
    conn.close()


@pytest.fixture(scope="function")
def auth_headers(test_user):
    token = create_access_token(subject=test_user.id)
    return {"Authorization": f"Bearer {token}"}

_async_timeout_attached = False


def _attach_async_lock_timeout() -> None:
    """Same lock timeout for the async engine, which every async route uses.

    Attached here rather than at import: `db_manager` builds that engine lazily,
    so there is nothing to listen on until the first async route has run.
    """
    global _async_timeout_attached
    if _async_timeout_attached:
        return
    from app.core.db_manager import db_manager
    if db_manager.async_engine is None:
        return
    sync_engine = db_manager.async_engine.sync_engine
    if sync_engine.dialect.name != "postgresql":
        _async_timeout_attached = True
        return

    @sa_event.listens_for(sync_engine, "connect")
    def _set_async_lock_timeout(dbapi_conn, _record):  # pragma: no cover - driver hook
        dbapi_conn.await_(
            dbapi_conn.driver_connection.execute(
                f"SET lock_timeout = {_TEST_LOCK_TIMEOUT_MS}"
            )
        )

    _async_timeout_attached = True
