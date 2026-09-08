from pathlib import Path
from fastapi import FastAPI, Request, APIRouter, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import HTMLResponse, ORJSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool
import asyncio
import os
import json
import time
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import mimetypes
from fastapi.staticfiles import StaticFiles

class _HealthCheckFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "/api/health" not in record.getMessage()

logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())

logger = logging.getLogger(__name__)

from app.db.session import engine
from app.core.db_manager import db_manager
from app.core.scheduler import backup_scheduler
from app.db.base import Base
from app.services import backup_schedule_service, event_log_service
from app.api import items, locations, stock, attributes, boms, manufacturing, categories, routing, auth, uoms, sales, samples, audit, admin, dashboard, partners, purchase, settings, production_runs, work_orders, batches, dyeing_setting, preferences, lab_dips, packing, pick_lists, shipments, colors, combos, packaging_types, weaving, print_templates, production_reports, quarantine, work_queue, dyeing_monitor
from app.core.ws_manager import manager, WS_CLOSE_TOKEN_EXPIRED
from app.core.ws_events import can_receive
from app.core.ws_metrics import metrics as ws_metrics
from app.api.auth import ws_connection_state, get_current_admin

# Keep in sync with /VERSION, frontend/package.json "version", and CHANGELOG.md on release.
APP_VERSION = "0.26.0"

# Process start time, a proxy for "last deployed/updated" — deploy is git pull +
# docker compose up --build, which always restarts this process.
_STARTED_AT = datetime.now(timezone.utc)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Redis for WebSockets
    await manager.initialize()
    # Warm the booking-netting cache off the request path (see warm_booking_cache).
    stock.warm_booking_cache()
    # Start the recurring-backup scheduler and (re)register its job from whatever
    # schedule is persisted in Postgres — the in-process AsyncIOScheduler has no
    # memory of "next run" across a redeploy, so this has to happen on every boot.
    backup_scheduler.start()
    try:
        session = db_manager.session_factory()
        try:
            schedule = backup_schedule_service.get_or_create_schedule(session)
            backup_scheduler.reschedule(schedule)
        finally:
            session.close()
    except Exception:
        logging.exception("Failed to initialize the scheduled backup job")
    # Drain any live events that never reached Redis — from a crash mid-publish or
    # a bus outage — and keep the delivery buffer trimmed.
    relay_task = asyncio.create_task(_event_relay_loop())
    yield
    # Shutdown: Close Redis connections
    relay_task.cancel()
    await manager.stop()
    backup_scheduler.shutdown()


# How often the relay looks for events stuck unpublished. Fast enough that a brief
# Redis blip is invisible to users, slow enough to be free when nothing is stuck
# (the partial index means the scan touches no rows in the normal case).
EVENT_RELAY_INTERVAL_SECONDS = 10
EVENT_PRUNE_INTERVAL_SECONDS = 30 * 60


async def _event_relay_loop():
    last_prune = 0.0
    while True:
        try:
            await asyncio.sleep(EVENT_RELAY_INTERVAL_SECONDS)
            await manager.relay_unpublished()
            now = asyncio.get_event_loop().time()
            if now - last_prune >= EVENT_PRUNE_INTERVAL_SECONDS:
                last_prune = now
                removed = await event_log_service.prune()
                if removed:
                    logger.info("Pruned %d expired live events", removed)
        except asyncio.CancelledError:
            raise
        except Exception:
            # A relay that dies takes recovery with it, so it never gets to.
            logger.exception("Live-event relay pass failed")

app = FastAPI(
    title="Terras ERP",
    version=APP_VERSION,
    default_response_class=ORJSONResponse,
    lifespan=lifespan
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logging.error("422 Validation Error on %s %s: %s", request.method, request.url.path, exc.errors())
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

# Ensure .jpeg is recognized on minimal Linux images that lack a full mime.types db
mimetypes.add_type("image/jpeg", ".jpeg")

# Mount Static Files
static_path = Path("static")
static_path.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# --- Router Configuration ---
api_router = APIRouter()

api_router.include_router(items.router)
api_router.include_router(locations.router)
api_router.include_router(stock.router)
api_router.include_router(attributes.router)
api_router.include_router(boms.router)
api_router.include_router(manufacturing.router)
api_router.include_router(categories.router)
api_router.include_router(routing.router)
api_router.include_router(auth.router)
api_router.include_router(uoms.router)
api_router.include_router(sales.router)
api_router.include_router(samples.router)
api_router.include_router(audit.router)
api_router.include_router(admin.router)
api_router.include_router(dashboard.router)
api_router.include_router(partners.router)
api_router.include_router(purchase.router)
api_router.include_router(settings.router)
api_router.include_router(production_runs.router)
api_router.include_router(work_orders.router)
api_router.include_router(work_queue.router)
api_router.include_router(batches.router)
api_router.include_router(dyeing_setting.router)
api_router.include_router(lab_dips.router)
api_router.include_router(colors.router)
api_router.include_router(combos.router)
api_router.include_router(packaging_types.router)
api_router.include_router(packing.router)
api_router.include_router(quarantine.router)
api_router.include_router(pick_lists.router)
api_router.include_router(shipments.router)
api_router.include_router(weaving.router)
api_router.include_router(dyeing_monitor.router)
api_router.include_router(preferences.router)
api_router.include_router(print_templates.router)
api_router.include_router(production_reports.router)

# How long a socket may sit accepted-but-unauthenticated before it is dropped.
# Generous enough for a slow mobile link, short enough that an unauthenticated
# client can't park connections.
WS_AUTH_TIMEOUT_SECONDS = 10
# 1008 = policy violation: the token was missing, malformed, expired at connect,
# or belongs to a deactivated user. Terminal for this token — the client must not
# retry it in a loop, and signs the user out on it (see DataContext's onclose).
WS_CLOSE_UNAUTHORIZED = 1008
# 1011 = the server failed while handling the connection. Says nothing about the
# token, so the client retries on it rather than signing anyone out.
WS_CLOSE_INTERNAL_ERROR = 1011

@api_router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()

    # Authenticate BEFORE the socket joins the broadcast pool. The browser
    # WebSocket API can't set an Authorization header and a query-string token
    # would land in proxy and access logs, so the token arrives as the first
    # frame: {"type":"auth","token":"<jwt>"}. Until it does, this socket is in
    # no pool and receives nothing.
    token = None
    since = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=WS_AUTH_TIMEOUT_SECONDS)
        msg = json.loads(raw)
        if isinstance(msg, dict) and msg.get("type") == "auth":
            token = msg.get("token")
            # Optional resume cursor: the seq of the last event this client saw.
            # Carried on the auth frame rather than sent afterwards so the replay
            # can be queued BEFORE the connection joins the broadcast pool — a
            # separate round trip would let live events interleave with catch-up.
            if isinstance(msg.get("since"), int):
                since = msg["since"]
    except Exception:
        token = None

    # Sync session + lazy-loaded permission relationships, so off the event loop.
    # A failure INSIDE the lookup (DB down, connection blip) is not an auth failure
    # and must not close 1008 — the client signs the user out on that code, and a
    # transient query error is no reason to end someone's session. 1011 instead,
    # which the client treats as a normal retryable drop.
    try:
        state = await run_in_threadpool(ws_connection_state, token)
    except Exception:
        logger.exception("WebSocket auth lookup failed")
        ws_metrics.connections_errored += 1
        try:
            await websocket.close(code=WS_CLOSE_INTERNAL_ERROR)
        except Exception:
            pass
        return
    if state is None:
        ws_metrics.connections_rejected += 1
        try:
            await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        except Exception:
            pass
        return

    # Everything this endpoint sends goes through the connection's queue, not
    # straight down the socket: the manager's writer task owns the send side, and
    # a second concurrent sender can interleave frames on the same connection.
    def enqueue(message: dict) -> None:
        try:
            state.queue.put_nowait((time.monotonic(), message))
        except asyncio.QueueFull:
            pass

    enqueue({
        "type": "auth_ok",
        "username": state.username,
        "expires_at": state.expires_at.isoformat() if state.expires_at else None,
    })

    # Catch-up, queued before the connection joins the pool so replayed events
    # cannot arrive after the live ones that follow them. Topics aren't known yet
    # (the subscribe frame comes later), so the replay is filtered by permission
    # only — a one-off burst of slightly-too-much is the right trade against
    # withholding something the screen needed.
    if since is not None:
        ws_metrics.resumes_requested += 1
        missed, truncated = await event_log_service.events_since(since)
        ws_metrics.events_replayed += len(missed)
        if truncated:
            ws_metrics.resync_required += 1
            # Gap too wide or too old to reconstruct. Say so plainly; the client
            # falls back to refetching its current route.
            enqueue({"type": "resync_required"})
        else:
            for event in missed:
                if can_receive(str(event.get("type") or ""), state.perms):
                    enqueue(event)

    await manager.connect(websocket, state)

    try:
        while True:
            raw = await websocket.receive_text()
            # A live socket outlasting its token would keep receiving events the
            # user's HTTP requests are already being 401'd for. Checked here and
            # on the broadcast path, so an idle socket is closed by the next
            # event and a busy one by its next ping.
            if state.expires_at and state.expires_at <= datetime.now(timezone.utc):
                manager.disconnect(websocket)
                await websocket.close(code=WS_CLOSE_TOKEN_EXPIRED)
                return
            # App-level heartbeat: reply to client pings so the browser can detect
            # a dead/idle connection (native WS ping/pong isn't exposed to JS) and
            # so proxies don't drop an otherwise-silent long-lived socket.
            if raw:
                try:
                    msg = json.loads(raw)
                    if not isinstance(msg, dict):
                        continue
                    if msg.get("type") == "ping":
                        enqueue({"type": "pong"})
                    elif msg.get("type") == "subscribe":
                        # The client tells us what its current screen reads, and
                        # re-sends on navigation. Unknown names are kept rather
                        # than rejected: they match no event, so a newer client
                        # naming a topic this build doesn't have degrades to
                        # "that topic is quiet" instead of a dropped connection.
                        topics = msg.get("topics")
                        if isinstance(topics, list):
                            state.topics = {t for t in topics if isinstance(t, str)}
                except Exception:
                    pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@api_router.get("/health")
async def health():
    return {"status": "ok", "version": APP_VERSION, "started_at": _STARTED_AT.isoformat()}

@api_router.get("/health/ready")
async def health_readiness():
    checks = {"db": "fail", "redis": "fail"}
    # DB probe
    try:
        if db_manager.async_engine:
            async with db_manager.async_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
                checks["db"] = "ok"
    except Exception:
        pass
    # Redis probe
    try:
        if manager.redis and await manager.redis.ping():
            checks["redis"] = "ok"
    except Exception:
        pass

    all_ok = all(v == "ok" for v in checks.values())
    status_code = 200 if all_ok else 503
    return ORJSONResponse({
        "status": "ready" if all_ok else "degraded",
        **checks,
        # Not a health signal — zero is normal out of hours. It is here because a
        # probe response is the one place an operator always looks.
        "websocket_connections": len(manager.active_connections),
    }, status_code=status_code)


@api_router.get("/health/events")
async def event_bus_stats(current_user=Depends(get_current_admin)):
    """Live-event bus counters — see core/ws_metrics.py.

    Authenticated, unlike its neighbours in this namespace: the other /health
    routes are probes that must answer before anyone logs in, while this one
    reports on internal traffic and is read by the Settings status panel.
    """
    return {
        **ws_metrics.snapshot(len(manager.active_connections)),
        "unpublished_backlog": await event_log_service.unpublished_count(),
    }

app.include_router(api_router, prefix="/api")
# ----------------------------

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

origins = os.getenv("BACKEND_CORS_ORIGINS", "http://localhost:3000,http://localhost:3030").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Compress large JSON/list responses over the wire. Pure transport optimization —
# no API contract change. Responses below minimum_size are sent uncompressed.
# compresslevel=6 (not the default 9): near-identical ratio at much lower CPU cost,
# which matters on the low-power ARM backend host.
app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=6)

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "app_name": "Terras ERP",
            "version": "0.1.0"
        }
    )
