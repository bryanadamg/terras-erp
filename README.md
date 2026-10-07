<p align="center">
  <img src="frontend/public/icons/icon-512.png" alt="Terras ERP logo" width="96" height="96" />
</p>

# Terras ERP

**Terras ERP** is a manufacturing and inventory ERP built for textile factories — warping, weaving, dyeing, and finishing lines where lot traceability and shop-floor speed matter as much as the paperwork. It runs the full loop from sales order to production planning, shop-floor execution, dyeing/setting recipes, and dispatch, with every stock movement and QC decision logged for audit.

The stack is **FastAPI + PostgreSQL** on the backend and **Next.js + React** on the frontend.

---

## What it does

- **Plan and schedule production** — Sales Orders drive Production Runs, which explode into Manufacturing Orders and Work Orders through a recursive, multi-level BOM. Shared components across colour and size variants are automatically consolidated instead of duplicated.
- **Run the shop floor** — Operators dispatch and complete Work Orders from a mobile QR-scanner terminal. Completions post material consumption and finished-goods output automatically, including auto-numbered lots and warp beams.
- **Track every lot** — Stock is lot- and variant-aware end to end, with a materialized balance table for instant lookups and a full backward genealogy trace from any finished lot back to raw fibre.
- **Manage dyeing and setting** — A reusable dye-recipe library, lab-dip colour approval workflow, and per-run execution records (actual chemicals used, shade results, shrinkage, GSM) with printable job cards matching the factory's paper forms.
- **Enforce quality holds** — Reject grading and quarantine locations keep bad or unreleased material out of production and out of packing, without blocking the good material sitting next to it.
- **Pack, pick, and ship** — Finished goods are packed into cartons, pulled onto pick lists against sales orders, and dispatched through a four-eyes staging/verification gate before stock actually leaves the building.
- **See what's happening in real time** — A live KPI dashboard and WebSocket event bus push stock and order changes to every connected screen without a refresh.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL, Redis |
| Frontend | TypeScript, Next.js, React, Bootstrap, TanStack Query |
| Desktop | Electron (Windows) |
| Infrastructure | Docker & Docker Compose |

The interface ships with three visual themes (Modern, Compact, and a Windows-XP-styled Classic mode), full English/Indonesian localization, and role-based access control down to individual permission codes.

---

## Getting Started

### Prerequisites

A `.env` file at the repo root with:

```
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
DATABASE_URL=
REDIS_URL=
NEXT_PUBLIC_API_BASE=
BACKEND_CORS_ORIGINS=
SECRET_KEY=
```

### Run it

```bash
# Start all services (api, db, redis, frontend)
docker compose up --build -d
```

On first boot the API container runs database migrations and seeds reference data (UOMs, categories, system attributes, RBAC roles) automatically.

### Local development

```bash
# Backend (from /backend)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (from /frontend)
npm run dev    # http://localhost:3000
```

### Tests

```bash
docker compose exec api pytest        # backend
cd frontend && npx tsc --noEmit && npm run lint   # frontend type-check + lint
```

---

## License

MIT License — Copyright (c) 2026 Bryan Adam G.
