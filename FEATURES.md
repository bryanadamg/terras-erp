# Terras ERP — Features

What Terras ERP v1.0.0 does, module by module, in the order of the sidebar. For what changed in
each release, see [`CHANGELOG.md`](CHANGELOG.md).

## Sales

- **Sales Orders** — Lines record what was ordered (item, size, colour, combo, alt selling unit such as yards or gross) without naming a recipe; the planner picks the BOM on the Production Run. Base qty and alt count stay locked to the unit factor.
- **Fulfilment, derived** — SO status is computed from fulfilment, not typed: made, packed and shipped each show as a bar against the ordered qty, in the unit the order was written in. Only DELIVERED and CANCELLED can be set by hand.
- **Production progress per line** — Root MOs are pegged to SO lines; the table shows how far production has got, including pegged greige and beam orders, and links straight to the MO.
- **Allocate from stock** — Reserves on-hand finished goods (named packed cartons) to SO lines, so a later Production Run only plans the remainder and the cartons are held from other orders.
- **Short-close** — A partially shipped order can be closed with a reason. An order can't be closed before it reaches SENT.
- **Lineage** — SO → Production Run → MO → WO → warp beam, viewable from the order.
- **No Color Swatch flag** — Marks a line blocked on the customer's swatch.
- **Customers** — Partner directory with contact, phone and email, searchable and paged.
- **Printouts** — SO Confirmation and SO table report, with size, colour and customer PO reference.

### Sample Requests (PLM)

- Sample requests with a configurable category (a `Sample Category` attribute value, managed on the Attributes page), per-colour variants and submission rounds.
- Approve or reject each variant with a note and a photo; rejected variants can be reopened.
- Unread requests are marked, and can be filtered to unread only.
- **Sample Report** — every attempt per colour, for development tracking.
- Finished-good items trace back to the sample and sample colour that originated them.

## Procurement

- **Purchase Orders** — Branded PO printout with supplier address and signature blocks.
- **Goods receipt** — Receiving a PO records the supplier's lots and their delivery note (Surat Jalan number, date and PDF).
- **Suppliers** — Same partner directory as Customers.

## Inventory

- **Items** — Item master with categories (tree), UoMs, attributes and variants; CSV import runs in a panel while the list stays usable. Codes are proposed from a configurable code pattern, and a new item can be started from a sample request colour. Each item has an expandable event log of every change.
- **Attributes** — Value lists for variants and process steps. System attributes (Colors, Combo, Materials, Color Code, Wash Bath, Finishing Step, Sample Category) are seeded and protected.
- **Combo Library** and **Packaging Types** (boxes with tare weight) as master data.
- **Lots** — Lot-tracked items get auto-numbered `LOT-` lots at production; lots can also be created by hand with the same identity a produced lot carries (ends, size, combo, colour). A lot can be split or reassigned to another item, and its label reprinted. Lots are listed by type (from the producing work center), filterable by category and item.
- **Genealogy** — Trace any lot backward through every lot it consumed, including splits, QC rejects and leftover beams.
- **Stock On-Hand** — Every balance by item, location, colour, size and lot, with MO/WO columns, move and adjust actions, a kg total for the filtered rows and Excel export. Packed cartons show their alt-unit count.
- **Booking Stock** — Plant-wide availability: on-hand + incoming production − outstanding demand − reservations, by item, colour and size, with a built-in "how is this calculated" explainer (English/Indonesian).
- **Locations** — Warehouse > Zone > Bin tree. Each item can have a default putaway location; output putaway suggests a bin (configured → same item → empty → first).
- **Packaging counts** — Cones, boxes and drums tracked as tallies alongside the base qty.

Stock balances are materialized, so every lookup is a single row read; the ledger is the source of truth and the balances are rebuilt from it at every startup.

## Engineering

- **BOM Designer** — Recursive, multi-level BOMs on a split-pane tree. Every line is a percentage of the node, and a node's lines must sum to 100%.
  - **Sized or free mode** — Sized BOMs carry a target measurement and min/max range per size (S–4XL); free mode uses custom labels. Sizes print everywhere as `L-72 (70-74)`.
  - **Variants without duplication** — Colour variants share one greige BOM; only the variant's colourant sits on its own BOM. Size variants consolidate shared sub-components.
  - **Two tolerances** — Wastage % inflates material requirements; Overdelivery % caps how far past an order's qty output may be logged.
  - **Weaving spec fields** — Picks density, reed, machine and post-dyeing width/length/stretch, greige and finished weight.
  - **Routing steps** — Operations and work centers in sequence, with materials assigned to the step that consumes them.
  - **BOM Automator** — Wizard that generates multi-level sibling items and BOMs, with saved profiles and attribute inheritance from finished good to WIP.
  - **Code patterns** — Configurable auto-generated codes, including variant values.
  - **Decoupling points** — A BOM can stop MRP explosion and pool supply on a standalone order.
- **Routing** — Work-center tree: Type > Group (optional) > Machine. Per-machine working weekdays and holidays, set one machine at a time or cascaded down from a group. Indonesian national holidays can be adopted in one click.

## Production

- **Production Runs** — The planning unit. One run holds several BOM entries (variants), each with per-size quantities from a configurable size formula. Creating a run makes one finished-goods MO per entry, then one shared component MO per unique sub-assembly across all of them, so greige for every colour is made once.
- **Material requirements** — Per-run requirements netted by item, colour and size against stock in each item's putaway location, plus a printable Material Pull Sheet.
- **Manufacturing Orders** — PENDING → IN_PROGRESS → DELIVERED → COMPLETED. DELIVERED means the qty was reached but the order stays open; only an explicit close stops logging. Over-logging is capped by the overdelivery tolerance (unlimited by default for warp beams). BOM lines are snapshotted at creation, so later BOM edits don't touch in-flight orders. Prints as the SPK Produksi.
- **Work Orders** — Routing steps cut by hand as dispatch decisions, printed as a Kartu Kerja with a QR code. Target vs actual start/end times. Material is staged per step by an explicit transfer to the work center (scan-to-stage for bag and beam labels), and can be returned. Fields freeze once output has been logged.
- **Logging output** — Each completion posts consumption (per-lot where lot-tracked), mints the output lot, and prints a bag or beam label with the components actually consumed. A weighing tolerance lets small scale-vs-book gaps through.
- **QC rejects** — A rejected completion marks its lot rejected, returns MO progress and reopens the order. Reject grades route output to the machine's defect store; usable rejects are tracked separately.
- **Work Queue** — Every open WO ranked by date or by readiness, with the material each one needs allocated from stock in queue order, by colour and size.
- **Warp beams** — Beams are lots born at BEAMING and mounted to a loom, not a WO: one warp feeds every WO that runs on that loom. Consumption draws FIFO across the loom's mounted beams. At dismount the remnant is weighed into its own `LFT-` lot, ready to mount on any loom.
- **Weaving Monitor** — Loom cards grouped by machine group, with efficiency (actual vs rated picks over working days), running WOs, pause/resume with reasons, prep status (staged → draw-in → tuning → running), beams tab and per-group calendars.
- **Dyeing Monitor** — Every dyeing WO in one paged table: phase history (colour matching, bath, complete), bath history, and actual time against the time the WO needs at its rope speed.
- **Production Output** — Output and reject % by machine and by packer, live, with Excel export.

## Dyeing & Setting

- **Dye recipes** — Chemical lines (per 100 kg or per litre), liquor ratio, wash-bath and finishing steps picked from attribute lists, linked to a Color Library shade. Printed as the Kartu Celup.
- **Dyeing WOs** — Creating one against a DYEING work center resolves the recipe from the order's colour (blocked if none matches) and opens a dyeing run.
- **Dyeing Orders** — The bath is configured on the run: volume, liquor ratio, ropes, speed (from a Tua/Sedang/Muda list), load and the chemicals weighed. Doses are computed from the bath actually filled. Orders sharing a shade can be set up in bulk as one bath; setting orders the same on one stenter.
- **Setting runs** — Heat-setting steps with input/output lot tracking and their own `SET-` output lots.
- **Color Library** — Pantone and C.I. colour master built for ~30k codes, with swatch grid and list views and fuzzy search. A colour can be linked straight to an item for shades matched outside the system.
- **Lab Dip Requests** — `LD-YYYY-#####` colour approval with submission rounds, in-place reject/reopen with a rejection log, and the approved recipe tied to production. Approved variants can be revoked while unused. Orders for a colour still in lab dip can be placed, with dyeing held until approval.
- **Yarn Lab Dips** and a **Lab Dip Report**.

## Warehouse

- **Quarantine Packing** — Released and held lots awaiting packing, with the producing WO and SO. A lot can be locked to one packing order, which must drain it before closing.
- **Packing Orders** (`PCK-`) — Pack finished goods into cartons, to an SO line or to stock. Target in pieces or by weight only; per-carton packaging type with tare and gross weight snapshotted; packing machine and packer recorded; loose rejects logged at pack time. One carton holds one size. Each carton is a traceable `PU-` unit with an A6 label (QR + barcode). Cartons can be split down to what an order owes.
- **Pick Lists** (`PL-`) — Suggested cartons per SO line (held cartons first), picked by scanning, with a QC gate. A To Pick board shows readiness per order.
- **Dispatch** (`SHP-`) — A shipment groups one customer's pick lists and carries the Surat Jalan (delivery note with carton breakdown and gross weight). STAGED → VERIFIED → DISPATCHED: a second person verifies the load by scanning cartons, and stock leaves only at dispatch.

## Shop floor (mobile)

- **One scanner for everything** — `/scanner` (QUICK SCAN in the sidebar, Scan tab on phones) reads any code and opens the right screen: a WO's QR opens output logging, `PCK-` opens packing, `PL-`/`PU-` opens picking.
- Mobile views for dashboard, MOs and stock.
- Phone cameras need HTTPS; the optional Caddy service serves the app over LAN HTTPS with a local CA.

## Reports & dashboard

- **Dashboard** — Delivery outlook first (what is owed, when, and how much can ship), then KPI tiles, delivery readiness, production yield, a production deadlines calendar, recent movements and warehouse distribution. Each block is shown only to roles that can see its data.
- **Stock Ledger** — Every movement with lot and variant chips, sortable server-side, printable.
- **Excel export** on Stock On-Hand and Production Output.

## Administration

- **Users and roles** — Role-based permissions down to individual action codes, plus role scopes by location, work-center type and item category. Admin-only account creation; a fresh install has only `admin`. Accounts lock for 15 minutes after 10 failed sign-ins.
- **Audit Logs** — Every create, update, delete and status change, with old → new values, filterable by entity and viewable per record.
- **Print Layouts** — Every printed document (SPK, Kartu Kerja, Kartu Celup, Kartu Packing, labels, pick list, Surat Jalan, SO, PO, pull sheet, stock ledger) comes from an editable banded template, opened from the layouts page or straight from a print preview.
- **Database & backups** — Snapshots (database dump plus uploaded files), scheduled backups with retention, download/upload, and restore with live progress.
- **Settings** — Company profile and logo, display timezone, production qty formula, interface scale, language.
- **Feedback** — In-app button that files a report (with up to 3 screenshots) as a GitHub issue; reports are queued and retried when GitHub or the network is unavailable.

## Platform

- **Live updates** — Every mutation is broadcast over Redis to a WebSocket feed. Each screen subscribes only to the topics it reads, events are filtered by the user's permissions, and a reconnecting client replays what it missed. A badge shows when live updates are off.
- **Paginated everything** — Server-side paging, search and sort on every long list, with full-set fetch for print and export.
- **Interface** — Windows-XP-styled Classic theme on the shared terras-ui component library, adjustable interface scale, English and Indonesian, page-shaped loading skeletons, and a crash panel that keeps the sidebar working.
- **Security** — JWT auth, PBKDF2 password hashing, permission-checked API and WebSocket, upload allow-list, required `SECRET_KEY`.
- **Stack** — FastAPI, SQLAlchemy 2.0, PostgreSQL, Redis, Alembic; Next.js 14 and React 18; Docker Compose. CI runs backend tests, a migration upgrade check, and frontend type-check, lint and build before every deploy.
