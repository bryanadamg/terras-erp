# Teras ERP

**Teras ERP** is a high-performance, enterprise-grade Enterprise Resource Planning system built for manufacturing and high-volume inventory operations. The stack is **FastAPI + PostgreSQL** on the backend and **Next.js 14 + React 18** on the frontend, purpose-engineered for factory-floor speed and data integrity.

---

## Key Modules

### Manufacturing & MES

- **Manufacturing Orders (MO):** Top-level production documents that capture what to produce, in what quantity, and by when. MOs can automatically generate child Work Orders for each sub-assembly level.
- **Work Orders (WO):** Execution-level documents under an MO. Each WO tracks a single production step or sub-assembly, with dual-track timestamps (target vs. actual start/end) for variance analysis.
- **Production Runs:** Schedule and group multiple Work Orders into batched runs. The production calendar shows run status with colour-coded indicators.
- **Shop Floor QR Terminal:** Mobile-first operator interface at `/scanner` for scanning physical work orders, updating WO status, and triggering material interlocks — all without a full desktop session.
- **Material Interlocks:** Work orders check component stock availability before allowing production to start. Completion auto-deducts BOM components and posts finished goods to inventory.

### BOM Designer

- **Recursive Multi-Level BOM:** Components can themselves have BOMs, enabling unlimited assembly tree depth. The designer renders the full tree with expand/collapse navigation.
- **BOM Automator:** Wizard that auto-generates child Manufacturing Orders for each BOM level in one click, based on a parent MO and its nested assembly structure.
- **Percentage-Based Quantities:** Component quantities can be expressed as percentages of the parent item's quantity. Validation enforces that percentages within each node level sum to 100%.
- **Tolerance Configuration:** Per-line wastage tolerances for recipes that allow acceptable over/under consumption.
- **Root-Only Filter:** Toggle the BOM view to show only top-level (root) BOMs, hiding intermediate sub-assemblies from the list.
- **Print at Any Level:** Print a formatted A4 BOM sheet for any node in the assembly tree, not just the top-level finished good.
- **Editable Inline:** Quantity and percentage fields are directly editable in the BOM designer without opening a separate modal.

### Inventory & Material Management

- **Materialized Stock Summary:** A dedicated `stock_balances` table provides O(1) stock lookups — no summing ledger rows on read. Balances are updated atomically on every transaction.
- **GIN Trigram Search:** PostgreSQL GIN trigram indexing enables fuzzy, sub-millisecond search across large item catalogs.
- **Attributes & Variants:** Define attribute axes (Colour, Size, Material, etc.) and generate variant combinations per item. Stock is tracked at the item + variant + location level via a sorted `variant_key`.
- **Units of Measure (UOM):** Custom conversion factors per UOM allow unit-to-base-unit calculations (e.g. Roll → metres, Pic → units).
- **Item Lifecycle History:** Every item has a chronological history pane showing JSON diffs of all field changes for total auditability.
- **Bulk Import:** Upload items in bulk via Excel through the Inventory UI.

### Supply Chain & Partners

- **Sales Orders:** Capture customer demand with line items that support variant/size selection and link to the producing BOM. Individual "Produce" buttons per SO line trigger MO creation.
- **Purchase Orders:** Supplier procurement with automated goods receipt — one-click "Receive" creates ledger entries and increments stock at the target location.
- **Partners:** Unified directory for both customers and suppliers, with contact details and order history.
- **PLM Sample Workflow:** Sample Masters define new products under development. Sample Requests are raised, tracked through approval stages (Requested → In Production → Ready → Approved/Rejected), and support attaching design files (images or Excel).
- **Print Templates:** A4-formatted, branded print templates for Sales Orders, Purchase Orders, Manufacturing Orders, BOM sheets, and Sample Requests — each with auto-resolved partner addresses and variant specifications.

### Intelligence & Real-Time Ops

- **Terras Smart Advisor:** Calculates real-time Production Yield and Delivery Readiness through recursive material coverage analysis. Surfaces items at reorder level, overdue work orders, and purchase orders past expected delivery.
- **Live KPI Dashboard:** Real-time grid showing active SKUs, low-stock alerts, open production orders, and sales pipeline. Data is pushed via WebSocket without page refresh.
- **WebSocket Event Bus:** Redis pub/sub broadcasts status changes and stock movements to all connected clients instantly (`/api/ws/events`).
- **Hover Prefetch:** Hovering a sidebar link triggers a background data prefetch for that module, producing near-zero-latency navigation.

---

## System Infrastructure

- **Themed Interface Engine:** Switch between Modern, Compact, and Classic (Windows XP) visual styles.
- **Hot-Swap Database Manager:** Change or test alternate database connections from the Admin UI without a server restart. Supports point-in-time snapshot management for Postgres and SQLite.
- **Multi-Language (i18n):** Full native support for English and Indonesian.
- **Enterprise Security:** OAuth2 + JWT authentication with granular Role-Based Access Control (RBAC). Per-user category restrictions limit item visibility across all modules.
- **Audit Logging:** Every create/update/delete writes an immutable audit log entry with before/after field values. Logs are append-only and browsable by user, date, and entity type.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| Backend | Python 3.11+, FastAPI, SQLAlchemy 2.0, PostgreSQL 15, Redis 7, `orjson`, GZip |
| Frontend | TypeScript, Next.js 14, React 18, Bootstrap 5, TanStack Query, `html5-qrcode` |
| Infrastructure | Docker & Docker Compose |

---

## Getting Started

### Prerequisites

A `.env` file at the repo root is required with the following variables:

```
POSTGRES_DB=
POSTGRES_USER=
POSTGRES_PASSWORD=
DATABASE_URL=
REDIS_URL=
NEXT_PUBLIC_API_BASE=
BACKEND_CORS_ORIGINS=
```

### Start the Stack

```bash
# Clone and configure
cp .env.example .env

# Start all services (api, db, redis, frontend)
docker compose up --build -d

# Initialize database schema and seed data (first run only)
docker compose exec api python -m app.db.init_db
```

### Local Development

```bash
# Backend (from /backend)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend (from /frontend)
npm run dev    # http://localhost:3000
```

### Tests

```bash
# Backend tests (requires live PostgreSQL)
docker compose exec api pytest

# Frontend E2E tests (requires frontend running on :3030)
cd frontend && npm run test:e2e
```

---

## License

MIT License — Copyright (c) 2026 Teras Systems.
