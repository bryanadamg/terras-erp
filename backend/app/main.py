from pathlib import Path
from fastapi import FastAPI, Request, APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, ORJSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import text
import os
from contextlib import asynccontextmanager

import mimetypes
from fastapi.staticfiles import StaticFiles
from app.db.session import engine
from app.core.db_manager import db_manager
from app.db.base import Base
from app.api import items, locations, stock, attributes, boms, manufacturing, categories, routing, auth, uoms, sales, samples, audit, admin, dashboard, partners, purchase, settings, production_runs, work_orders, batches
from app.core.ws_manager import manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Redis for WebSockets
    await manager.initialize()
    yield
    # Shutdown: Close Redis connections
    await manager.stop()

app = FastAPI(
    title="Terras ERP", 
    default_response_class=ORJSONResponse,
    lifespan=lifespan
)

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
api_router.include_router(batches.router)

@api_router.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

@api_router.get("/health")
async def health():
    return {"status": "ok"}

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
    return ORJSONResponse({"status": "ready" if all_ok else "degraded", **checks}, status_code=status_code)

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
