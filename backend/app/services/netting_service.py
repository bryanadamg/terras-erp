"""Explosion-time MRP netting (Option A).

When a Production Run or a nested MO is created, each sub-assembly's gross
requirement is netted against *net-free* available stock BEFORE its component
MO is created. Fully-covered components are skipped (and their own sub-tree is
NOT exploded); partially-covered components are resized to the shortfall.

    net_free(item, variant)
        = on_hand     -- StockBalance in the item's store (its putaway location and
                         everything under it), plant-wide when it has none
        + incoming    -- outstanding output of OTHER open MOs producing the item,
                         excluding COMMITTED output (see below)
        - required    -- outstanding component demand of OTHER open MOs

Committed-supply rule: a root MO (not a shared component, no parent) that is
linked to a sales order — directly via MO.sales_order_id or through its
Production Run — has its output promised to that order. It is NOT free supply
and never nets away a new, distinct order for the same item. Shared-component
and child MOs stay in supply (their output is balanced by the consuming MOs'
component demand), as do uncommitted root MOs (stock-builds / greige
stockpiling), whose output deliberately covers future demand.

"OTHER" excludes the unit being planned (the current Production Run, or the
current root MO) so a run never nets against its own freshly-created demand —
that demand IS the gross requirement we are netting.

The availability ledger is MUTABLE: every node that consumes free stock
decrements the running balance, so two sibling demands (or two consolidated
component keys) cannot both claim the same physical stock.

Scope notes (Tier 1):
- Production Run root finished goods ARE netted (same SKIP/RESIZE/MAKE rule as
  components), unless the PR's BOM entry sets force_create=True — used to
  deliberately keep producing an item that already carries stock (e.g. greige
  stockpiling). A single ad-hoc MO created via POST /manufacturing-orders is
  make-to-order and its root is still never netted; only its descendants are.
- Store scope: on-hand counts only inside the item's putaway location subtree
  (FG -> Finished Goods, greige -> Greige Store, beam -> WIP / GD Beam), so a
  remnant left at a production spot is treated as still in use, not as free
  stock that cancels a new order. An item with no putaway location nets
  plant-wide. Incoming/demand stay plant-wide — an MO's output lands in the store.
- Safety stock and BOM tolerance % are ignored (gross = qty x percentage / 100);
  this mirrors the qty an MO is actually sized at.
- net_free is a creation-time snapshot for COMPONENTS: no reservation row is
  written for them, so re-running planning after stock moves requires a re-net.
  Root finished goods netted for a SALES-ORDER-linked run are the exception —
  see the reserved term below.

Reserved term: a root FG requirement covered from stock produces no MO, so before
`stock_reservations` existed the coverage left no trace anywhere and the NEXT
sales order netted the same physical pile away again (both orders planned short).
`POST /production-runs` now writes a `StockReservation` for the covered qty, and
that qty is subtracted here exactly like MO component demand. It is tracked in a
separate `_reserved` bucket purely so the creation preview can tell the planner
"400 is on hand but promised to SO-00123" rather than blaming an MO.

A reservation counts only while its row is ACTIVE and its sales order is still
OPEN (`OPEN_SO_STATUSES`). Both conditions matter: the status filter means a
SENT/DELIVERED/CANCELLED order releases its hold even if the release write never
ran, so a stale row can never permanently strand stock.
"""
from __future__ import annotations
from collections import defaultdict
from typing import Optional

from sqlalchemy import select, func, cast, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.stock_balance import StockBalance
from app.models.location import Location
from app.models.manufacturing import ManufacturingOrder
from app.models.production_run import ProductionRun
from app.models.reservation import StockReservation
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.batch import Batch
from app.models.bom import BOM, BOMLine, BOMSize
from app.models.size import Size
from app.models.attribute import Attribute, AttributeValue
from app.models.color import Color
from app.models.item import Item
from app.services import reject_service
from app.services.stock_service import _generate_variant_key, join_size, size_measurement
from app.services.mrp_service import (
    _line_decoupled, _combo_attr_id, _line_combo_value_ids, _effective_combo, active_sub_bom,
)


def rejected_batch_keys():
    """Subquery of batch_keys whose lot is not good stock — QC-rejected (scrap or
    downgraded-but-usable) or disposed. Their stock is physically present
    (rejected) or being written off (disposed) but must never count as
    good/available. REJECT_USABLE is excluded here too: a downgraded lot may be
    picked deliberately, but it can't silently satisfy planned demand."""
    return select(cast(Batch.id, String)).where(Batch.quality_status.in_(reject_service.NON_GOOD_GRADES))

# Orders still open. DELIVERED = planned qty met but not closed; it contributes no
# remaining demand or supply (outstanding <= 0 short-circuits below) but is included
# so an order whose qty is later raised, or whose output is rejected, nets correctly.
ONGOING = ("PENDING", "IN_PROGRESS", "DELIVERED")

# Sales orders whose stock is still spoken for. SENT/DELIVERED are gone from the
# building and CANCELLED never leaves, so all three stop holding a reservation.
# Mirrors so_fulfilment_service._RECOMPUTABLE, which is the same "still open" set.
OPEN_SO_STATUSES = ("PENDING", "READY", "PARTIAL")


async def _sales_order_linked_prs(db: AsyncSession, mos) -> set[str]:
    """IDs (as str) of Production Runs that carry a sales_order_id, among the
    PRs referenced by ``mos``. Used to detect committed output on root MOs that
    only link to their sales order through the PR."""
    pr_ids = {mo.production_run_id for mo in mos if mo.production_run_id and not mo.sales_order_id}
    if not pr_ids:
        return set()
    rows = (await db.execute(
        select(ProductionRun.id).where(
            ProductionRun.id.in_(pr_ids),
            ProductionRun.sales_order_id.is_not(None),
        )
    )).all()
    return {str(i) for (i,) in rows}


def _output_committed(mo, so_linked_prs: set[str]) -> bool:
    """Committed-supply rule: a sales-order-linked root MO's output belongs to
    that order and is not free incoming supply. Shared-component and child MOs
    are never committed (their output is balanced by the consuming MOs'
    component demand); uncommitted roots are stock-builds whose output is
    deliberately free."""
    return (
        not mo.is_shared_component
        and mo.parent_mo_id is None
        and (mo.sales_order_id is not None or str(mo.production_run_id) in so_linked_prs)
    )


def normalize_size_token(name: str | None) -> str:
    """Normalise a size identity to the token the netting ledger buckets on.

    Sizes are compared ACROSS BOMs (a lot made under the greige BOM must meet
    demand stated against the FG BOM's size row), so the token can't be a
    BOMSize id — those are per-BOM. It also can't be `Size.id`, because the only
    size identity a produced lot carries is the text in `Batch.bom_size_snapshot`.
    So: the Size master's name when there is one, else the free-mode label,
    case-folded. Empty string = no size identity (unsized BOM, raw material,
    pre-feature lot) and is treated as the generic pool — see `_eligible_tokens`.
    """
    return (name or "").strip().lower()


def token_from_snapshot(snapshot: dict | None) -> str:
    """Size token of a BOMSize snapshot dict (MO.bom_size_snapshot / Batch.bom_size_snapshot)."""
    if not snapshot:
        return ""
    name = snapshot.get("size_name") or (snapshot.get("size") or {}).get("name") or snapshot.get("label")
    return normalize_size_token(name)


class SizeResolver:
    """Turns the several places a size hides into one comparable token.

    Shared by every surface that nets stock — the MRP ledger (`Availability`),
    `/booking-stock` and the Production Run material requirements — because those
    three already re-implement the same net_free formula and MUST agree. A size
    bucket in one and not the others is how the PR preview ends up saying "make
    14.77 XL" while booking stock calls the same greige covered.
    """

    def __init__(self):
        self._size_names: dict[str, str] = {}             # Size.id -> Size.name
        self._item_size_tokens: dict[str, set[str]] = {}  # item -> tokens its active BOMs produce

    @classmethod
    async def create(cls, db: AsyncSession) -> "SizeResolver":
        self = cls()
        # Size master is seeded (S..4XL) and tiny — load it once so a BOMSize row
        # can be turned into a token without lazy-loading `BOMSize.size` inside an
        # async walk (MissingGreenlet).
        for sid, name in (await db.execute(select(Size.id, Size.name))).all():
            self._size_names[str(sid)] = name or ""
        return self

    def token_for_size_id(self, size_id, label=None) -> str:
        by_master = normalize_size_token(self._size_names.get(str(size_id))) if size_id else ""
        return by_master or normalize_size_token(label)

    def token_for_bom_size(self, bs) -> str:
        """Token for a BOMSize row. Only `size_id`/`label` are read, so the row
        does not need its `size` relationship loaded."""
        if bs is None:
            return ""
        return self.token_for_size_id(getattr(bs, "size_id", None), getattr(bs, "label", None))

    def label_for_token(self, tok: str) -> str | None:
        """Display casing for a token — the Size master's own name when it is one
        (so the UI reads "XL", not "xl"), else the token as stored."""
        if not tok:
            return None
        for name in self._size_names.values():
            if normalize_size_token(name) == tok:
                return name
        return tok

    async def load_items(self, db: AsyncSession, item_ids):
        """Which size tokens each item's active sized BOMs can actually produce.

        Needed to key COMPONENT demand: a planned component inherits its parent
        MO's size only when the component's own recipe is size-differentiated and
        carries that size — exactly the `_resolve_sub_size` rule the create path
        uses to decide whether to split component MOs per size. Without this the
        colour-variant greige case (unsized sub-BOM pooled across every parent
        size) would key demand as "XL" while its stock and its MO are unsized, and
        that demand would stop shielding its own stock."""
        item_ids = [i for i in item_ids if i and str(i) not in self._item_size_tokens]
        if not item_ids:
            return
        for i in item_ids:
            self._item_size_tokens[str(i)] = set()
        rows = (await db.execute(
            select(BOM.item_id, BOMSize.size_id, BOMSize.label)
            .join(BOMSize, BOMSize.bom_id == BOM.id)
            .where(BOM.active == True,  # noqa: E712
                   BOM.size_mode == "sized",
                   BOM.item_id.in_(item_ids))
        )).all()
        for item_id, sid, label in rows:
            tok = self.token_for_size_id(sid, label)
            if tok:
                self._item_size_tokens[str(item_id)].add(tok)

    def component_token(self, item_id, parent_token: str) -> str:
        """Size a component will be produced/stocked at, given its parent's size."""
        if not parent_token:
            return ""
        return parent_token if parent_token in self._item_size_tokens.get(str(item_id), set()) else ""


def eligible_tokens(buckets, want: str) -> list[str]:
    """Size buckets a demand stated at `want` may draw from, in draw order.

    A sized demand takes its own size first, then the generic "" pool (stock whose
    size was never recorded — that is not evidence of a *different* size). An
    unsized demand is size-agnostic by definition, so after the generic pool it may
    take any size rather than stranding stock it can legitimately use."""
    order = [want] if want else [""]
    if want:
        order.append("")
    else:
        order += sorted(t for t in buckets if t)
    seen, out = set(), []
    for t in order:
        if t not in seen:
            seen.add(t)
            out.append(t)
    return out


def allocate_onhand(buckets: dict[str, float], rows: list[tuple[str, float]]) -> list[float]:
    """Split one (item, variant) pile across the size rows that want it.

    The MRP ledger allocates by mutating as it explodes; the two REPORT surfaces
    have no explosion to ride on, so they need a deterministic pass that reaches
    the same answer — otherwise the same pile is shown in full on two size rows and
    the page promises the same stock twice.

    Draw order mirrors `eligible_tokens`: every row takes its own size first, then
    the sized rows share the generic "" pool biggest-need-first (ties broken by
    token so the page does not reshuffle between requests), then an unsized row
    mops up whatever sized stock is left, which it is allowed to use.

    `rows` is [(size_token, need)]; returns the qty allocated to each, in order.
    """
    left = {t: float(q) for t, q in buckets.items()}
    out = [0.0] * len(rows)
    for idx, (tok, _need) in enumerate(rows):
        take = max(0.0, left.get(tok, 0.0))
        out[idx] += take
        left[tok] = left.get(tok, 0.0) - take
    for idx in sorted((i for i, (tok, _n) in enumerate(rows) if tok),
                      key=lambda i: (-(rows[i][1] - out[i]), rows[i][0])):
        need = rows[idx][1] - out[idx]
        if need <= 0:
            continue
        take = min(max(0.0, left.get("", 0.0)), need)
        out[idx] += take
        left[""] = left.get("", 0.0) - take
    for idx, (tok, _need) in enumerate(rows):
        if tok:
            continue
        for other in sorted(t for t in left if t):
            need = rows[idx][1] - out[idx]
            if need <= 0:
                break
            take = min(max(0.0, left.get(other, 0.0)), need)
            out[idx] += take
            left[other] = left.get(other, 0.0) - take
    return out


async def onhand_size_rows(db: AsyncSession, item_ids, location_ids=None) -> dict:
    """(item_id, variant_key, size_token) -> good on-hand, plant-wide unless
    `location_ids` scopes it.

    The size of a physical pile is only ever recorded on its lot
    (`Batch.bom_size_snapshot`), so balances are joined out to their batch; a row
    with no lot lands in the generic "" bucket. QC-rejected / disposed lots are
    excluded through the same subquery the MRP netting uses."""
    out: dict[tuple, float] = defaultdict(float)
    if not item_ids:
        return out
    rows = (await db.execute(
        select(StockBalance.item_id, StockBalance.variant_key, StockBalance.qty,
               Batch.bom_size_snapshot)
        .outerjoin(Batch, cast(Batch.id, String) == StockBalance.batch_key)
        .where(
            StockBalance.item_id.in_(list(item_ids)),
            StockBalance.batch_key.not_in(rejected_batch_keys()),
            *([StockBalance.location_id.in_(list(location_ids))] if location_ids is not None else []),
        )
    )).all()
    for iid, vkey, qty, snapshot in rows:
        out[(str(iid), vkey or "", token_from_snapshot(snapshot))] += float(qty or 0)
    return out


class Availability:
    """Mutable net-free ledger consumed during BOM explosion.

    Build with the async factory ``await Availability.create(db, ...)`` BEFORE
    creating the MOs of the unit being planned, so their demand is not scanned.
    Then call ``await avail.consume(item, attrs, loc, gross, size_token=...)`` per
    component node; it returns the qty to actually MAKE (0.0 => fully covered,
    skip the node).

    SIZE AWARENESS: every bucket is keyed (item, variant, size_token). A size
    row is a physical difference — 67 cm greige cannot be cut for XL — and the
    create path already splits component MOs and stamps lots per size, so
    netting must not pool them back. The generic "" bucket (unsized BOM, raw
    material, or a lot minted before sizes were snapshotted) stays substitutable
    in both directions; see `_eligible_tokens`.
    """

    def __init__(self, db: AsyncSession, exclude_pr_id=None, exclude_mo_ids=None):
        self.db = db
        self.exclude_pr_id = str(exclude_pr_id) if exclude_pr_id else None
        self.exclude_mo_ids = {str(m) for m in (exclude_mo_ids or [])}
        # keys are (item, vkey, size_token) throughout
        self._demand: dict[tuple, float] = defaultdict(float)   # -> required
        self._supply: dict[tuple, float] = defaultdict(float)   # -> incoming
        self._reserved: dict[tuple, float] = defaultdict(float) # -> promised to open SOs
        # (item, vkey) -> {size_token: running free qty}; the ledger is per-bucket
        self._remaining: dict[tuple, dict[str, float]] = {}
        self._onhand: dict[tuple, dict[str, float]] = {}        # (item, vkey) -> {token: on-hand}
        self._store: dict[str, set | None] = {}                 # item -> store location subtree
        self.store_root: dict[str, object] = {}                 # item -> its putaway location id
        self._loc_children: dict | None = None
        self.sizes: SizeResolver = SizeResolver()               # shared with the report surfaces

    @classmethod
    async def create(cls, db: AsyncSession, exclude_pr_id=None, exclude_mo_ids=None) -> "Availability":
        self = cls(db, exclude_pr_id, exclude_mo_ids)
        self.sizes = await SizeResolver.create(db)
        await self._load_open_demand()
        await self._load_reservations()
        return self

    def token_for_bom_size(self, bs) -> str:
        """Delegates to the shared resolver — call sites pass BOMSize rows."""
        return self.sizes.token_for_bom_size(bs)

    _eligible_tokens = staticmethod(eligible_tokens)

    async def _load_open_demand(self):
        """Aggregate outstanding component demand + own-output supply from every
        open MO, EXCLUDING the unit being planned.

        Plant-level (location-agnostic) netting: supply and demand are keyed by
        (item, variant) only. Where the stock physically sits is irrelevant to the
        make-vs-stock decision — that is an execution/staging concern."""
        mos = (await self.db.execute(
            select(ManufacturingOrder)
            .where(ManufacturingOrder.status.in_(ONGOING))
            .options(
                selectinload(ManufacturingOrder.planned_components),
                selectinload(ManufacturingOrder.completions),
                selectinload(ManufacturingOrder.attribute_values),
            )
        )).unique().scalars().all()

        so_linked_prs = await _sales_order_linked_prs(self.db, mos)

        # One batched lookup for every component item on the board, so the size a
        # component will actually be produced at can be resolved without a query
        # (or a sub-BOM walk) per planned component.
        await self.sizes.load_items(self.db, {
            comp.item_id for mo in mos for comp in mo.planned_components
        })

        for mo in mos:
            if self.exclude_pr_id and str(mo.production_run_id) == self.exclude_pr_id:
                continue
            if str(mo.id) in self.exclude_mo_ids:
                continue
            completed = sum(float(c.qty_completed) for c in mo.completions if not c.rejected)
            outstanding = float(mo.qty) - completed
            if outstanding <= 0:
                continue

            # Size this MO is being made at — inherited by the components whose own
            # recipe is size-differentiated (mirrors the create path's size split).
            mo_token = token_from_snapshot(mo.bom_size_snapshot)

            # Demand: components this MO will still consume.
            for comp in mo.planned_components:
                if not comp.percentage and not comp.qty:
                    continue
                req = (outstanding * float(comp.percentage)) / 100 if comp.percentage else outstanding * float(comp.qty)
                vkey = _generate_variant_key([str(a) for a in (comp.attribute_value_ids or [])])
                comp_token = self.sizes.component_token(comp.item_id, mo_token)
                self._demand[(str(comp.item_id), vkey, comp_token)] += req

            # Supply: this MO's own outstanding output is a scheduled receipt —
            # unless it is COMMITTED to a sales order (committed-supply rule),
            # in which case it must not cover other, distinct demand.
            if _output_committed(mo, so_linked_prs):
                continue
            out_vkey = _generate_variant_key([str(v.id) for v in mo.attribute_values], getattr(mo, "color_id", None))
            self._supply[(str(mo.item_id), out_vkey, mo_token)] += outstanding

    async def _load_reservations(self):
        """Aggregate FG already promised to open sales orders.

        Excludes the unit being planned (`exclude_pr_id`) for the same reason
        `_load_open_demand` does: re-previewing or re-netting a run must not see
        its own reservations as somebody else's claim, which would shrink the
        free pool on every pass and make the plan drift.

        A row is only a claim while it is ACTIVE *and* its sales order is still
        open — the join is the safety net that stops an unreleased row from
        stranding stock forever.
        """
        rows = (await self.db.execute(
            select(
                StockReservation.item_id,
                StockReservation.variant_key,
                StockReservation.qty,
                StockReservation.qty_released,
                BOMSize.size_id,
                BOMSize.label,
                SalesOrderLine.size_id,
                SalesOrderLine.size_label,
            )
            .join(SalesOrder, SalesOrder.id == StockReservation.sales_order_id)
            .outerjoin(BOMSize, BOMSize.id == StockReservation.bom_size_id)
            # An SO-level allocation states its size on the line, not a BOMSize.
            .outerjoin(SalesOrderLine, SalesOrderLine.id == StockReservation.sales_order_line_id)
            .where(
                StockReservation.status == "ACTIVE",
                SalesOrder.status.in_(OPEN_SO_STATUSES),
                *(
                    [StockReservation.production_run_id.is_(None)
                     | (cast(StockReservation.production_run_id, String) != self.exclude_pr_id)]
                    if self.exclude_pr_id else []
                ),
            )
        )).all()
        for item_id, vkey, qty, released, sid, label, line_sid, line_label in rows:
            remaining = float(qty or 0) - float(released or 0)
            if remaining <= 0:
                continue
            tok = (self.sizes.token_for_size_id(sid, label)
                   or self.sizes.token_for_size_id(line_sid, line_label))
            self._reserved[(str(item_id), vkey or "", tok)] += remaining

    async def _store_scope(self, item_id: str) -> set | None:
        """The item's putaway location plus every location under it, or None
        (plant-wide) when the item master names no putaway location."""
        if item_id not in self._store:
            put = (await self.db.execute(
                select(Item.default_putaway_location_id).where(Item.id == item_id)
            )).scalar()
            if not put:
                self._store[item_id] = None
            else:
                self.store_root[item_id] = put
                if self._loc_children is None:
                    self._loc_children = defaultdict(list)
                    for lid, parent in (await self.db.execute(select(Location.id, Location.parent_id))).all():
                        if parent:
                            self._loc_children[parent].append(lid)
                scope, stack = set(), [put]
                while stack:
                    cur = stack.pop()
                    if cur not in scope:
                        scope.add(cur)
                        stack.extend(self._loc_children.get(cur, []))
                self._store[item_id] = scope
        return self._store[item_id]

    async def _on_hand_buckets(self, item_id: str, vkey: str) -> dict[str, float]:
        """On-hand of (item, variant) split by size token, inside the item's store
        (see `_store_scope`). Same query the report surfaces use."""
        cache_key = (item_id, vkey)
        if cache_key not in self._onhand:
            rows = await onhand_size_rows(self.db, [item_id], await self._store_scope(item_id))
            buckets: dict[str, float] = defaultdict(float)
            for (iid, vk, tok), qty in rows.items():
                if iid == item_id and vk == vkey:
                    buckets[tok] += qty
            self._onhand[cache_key] = dict(buckets)
        return self._onhand[cache_key]

    async def _on_hand(self, item_id: str, vkey: str, tok: str | None = None) -> float:
        """On-hand for one size bucket, or every bucket when `tok` is None."""
        buckets = await self._on_hand_buckets(item_id, vkey)
        if tok is None:
            return float(sum(buckets.values()))
        return float(buckets.get(tok, 0.0))

    async def _free_buckets(self, item_id: str, vkey: str) -> dict[str, float]:
        """net_free per size bucket = on_hand + incoming - required - reserved."""
        buckets = dict(await self._on_hand_buckets(item_id, vkey))
        for src in (self._supply, self._demand, self._reserved):
            for (i, v, tok) in src:
                if i == item_id and v == vkey:
                    buckets.setdefault(tok, 0.0)
        for tok in list(buckets):
            key = (item_id, vkey, tok)
            buckets[tok] = (
                buckets[tok]
                + self._supply.get(key, 0.0)
                - self._demand.get(key, 0.0)
                - self._reserved.get(key, 0.0)
            )
        return buckets

    async def _net_free(self, item_id: str, vkey: str, size_token: str = "") -> float:
        """net_free visible to a demand stated at `size_token` (all buckets it may
        draw from). Unbucketed callers pass "" and, being size-agnostic, see the
        whole pile — same number as before sizes were bucketed."""
        buckets = await self._free_buckets(item_id, vkey)
        return float(sum(buckets.get(t, 0.0)
                         for t in self._eligible_tokens(buckets, normalize_size_token(size_token))))

    def _draw(self, ledger: dict[str, float], want: str, gross: float) -> float:
        """Take `gross` out of the eligible buckets in draw order; returns covered."""
        need = gross
        for tok in self._eligible_tokens(ledger, want):
            free = ledger.get(tok, 0.0)
            if free <= 0:
                continue
            take = min(free, need)
            ledger[tok] = free - take
            need -= take
            if need <= 0:
                break
        return gross - need

    async def _ledger(self, item_s: str, vkey: str) -> dict[str, float]:
        key = (item_s, vkey)
        if key not in self._remaining:
            self._remaining[key] = await self._free_buckets(item_s, vkey)
        return self._remaining[key]

    async def consume_detailed(self, item_id, attribute_value_ids, location_id, gross_req: float,
                               color_id=None, size_token: str = ""):
        """Dry-run variant of consume() for the creation preview. ``location_id``
        is accepted for caller compatibility / display only — it is NOT part of the
        netting key (plant-level netting). ``size_token`` IS part of the key.

        Returns (net_qty, detail). ``detail`` carries the figures the UI shows:
        on_hand, incoming, required_other, net_free (original for the key),
        free_before (running balance before this node), covered — all restricted
        to the size buckets this node may draw from, so the preview never shows a
        planner on-hand it is not allowed to use. Decrements the ledger exactly
        like consume() so the preview matches what creation does.
        """
        empty = {"on_hand": 0.0, "incoming": 0.0, "required_other": 0.0,
                 "reserved_other": 0.0, "net_free": 0.0, "free_before": 0.0,
                 "covered": 0.0}
        if gross_req <= 0:
            return 0.0, empty
        if item_id is None:
            return gross_req, empty
        item_s = str(item_id)
        vkey = _generate_variant_key([str(a) for a in (attribute_value_ids or [])], color_id)
        want = normalize_size_token(size_token)
        ledger = await self._ledger(item_s, vkey)
        eligible = self._eligible_tokens(ledger, want)
        buckets = await self._on_hand_buckets(item_s, vkey)
        on_hand = sum(buckets.get(t, 0.0) for t in eligible)
        incoming = sum(self._supply.get((item_s, vkey, t), 0.0) for t in eligible)
        required = sum(self._demand.get((item_s, vkey, t), 0.0) for t in eligible)
        reserved = sum(self._reserved.get((item_s, vkey, t), 0.0) for t in eligible)
        free_before = sum(ledger.get(t, 0.0) for t in eligible)
        covered = self._draw(ledger, want, gross_req)
        return gross_req - covered, {
            "on_hand": on_hand, "incoming": incoming, "required_other": required,
            "reserved_other": reserved,
            "net_free": on_hand + incoming - required - reserved,
            "free_before": free_before, "covered": covered,
        }

    async def consume(self, item_id, attribute_value_ids, location_id, gross_req: float,
                      color_id=None, size_token: str = "") -> float:
        """Net ``gross_req`` against the running free-stock balance for this node.
        ``location_id`` is accepted for caller compatibility only — plant-level
        netting ignores it. ``size_token`` picks the size bucket (see the class
        docstring): a sized node never eats another size's stock.

        Returns the qty to actually MAKE: 0.0 means fully covered by stock (the
        caller should skip the MO and its sub-tree); a smaller-than-gross value
        means resize the MO to the shortfall. Decrements the ledger by whatever
        it covered so later nodes can't reuse the same stock.
        """
        if gross_req <= 0:
            return 0.0
        if item_id is None:
            return gross_req  # no scoped item -> cannot net, make full
        item_s = str(item_id)
        vkey = _generate_variant_key([str(a) for a in (attribute_value_ids or [])], color_id)
        ledger = await self._ledger(item_s, vkey)
        return gross_req - self._draw(ledger, normalize_size_token(size_token), gross_req)

    async def free_on_hand(self, item_id, attribute_value_ids, color_id=None,
                           size_token: str = "") -> tuple[float, float]:
        """(on_hand, free) for a demand at `size_token` — what may be allocated
        straight to an order. Unlike net_free, scheduled receipts (open MOs' output)
        don't count: they are not on the shelf yet. Every other claim does — open
        MOs' demand and every open order's reservation, the asking order's own
        included, so allocating twice can't double-reserve the same pile."""
        item_s = str(item_id)
        vkey = _generate_variant_key([str(a) for a in (attribute_value_ids or [])], color_id)
        buckets = await self._on_hand_buckets(item_s, vkey)
        tokens = set(buckets) | {
            t for src in (self._demand, self._reserved) for (i, v, t) in src if i == item_s and v == vkey
        }
        eligible = self._eligible_tokens(tokens, normalize_size_token(size_token))
        on_hand = sum(buckets.get(t, 0.0) for t in eligible)
        claimed = sum(self._demand.get((item_s, vkey, t), 0.0) + self._reserved.get((item_s, vkey, t), 0.0)
                      for t in eligible)
        return on_hand, max(0.0, on_hand - claimed)


# ─────────────────────────────────────────────────────────────────────────────
# Dry-run creation preview
#
# These walkers MIRROR the create path (production_runs Pass 1/Pass 2 +
# manufacturing.create_mo_recursive) but only READ — they create no MOs. They
# reuse the same Availability ledger and the same gross/location resolution so
# the preview reflects exactly what creation will do (including the deep-level
# inherited-source behaviour and net-free). Keep them in sync with the create
# path if its netting/location logic changes.
# ─────────────────────────────────────────────────────────────────────────────

async def _apply_store(avail: "Availability", nodes: list[dict], loc_names: dict) -> None:
    """Net from = the store each node's on-hand was actually counted in (see
    `_store_scope`), not the planned source location netting never looks at."""
    for n in nodes:
        item_s = str(n["item_id"])
        await avail._store_scope(item_s)
        root = avail.store_root.get(item_s)
        if root:
            n["net_from_location_id"] = root
            n["net_from_location_name"] = loc_names.get(str(root), "")


async def _location_name_map(db: AsyncSession) -> dict:
    rows = (await db.execute(select(Location.id, Location.name, Location.code))).all()
    return {str(i): (n or c or "") for i, n, c in rows}


def _root_node(bom, qty: float, location, loc_names: dict, attr_ids=()) -> dict:
    item = bom.item
    return {
        "level": 0, "is_root": True,
        "item_id": item.id, "item_code": item.code, "item_name": item.name, "uom": item.uom or "",
        "net_from_location_id": location.id if location else None,
        "net_from_location_name": (loc_names.get(str(location.id), location.code or "") if location else ""),
        "gross_required": qty, "on_hand": 0.0, "incoming": 0.0, "required_other": 0.0,
        "reserved_other": 0.0,
        "net_free": 0.0, "net_qty": qty, "decision": "MAKE_ROOT",
        "chips": [], "_attr_ids": list(attr_ids or []),
    }


def _component_node(sub_bom, level: int, loc_id, gross: float, net: float, detail: dict, loc_names: dict,
                    attr_ids=(), bom_size_id=None) -> dict:
    item = sub_bom.item
    if net <= 0:
        decision = "SKIP"
    elif net < gross:
        decision = "RESIZE"
    else:
        decision = "MAKE"
    return {
        "level": level, "is_root": False,
        "item_id": item.id, "item_code": item.code, "item_name": item.name, "uom": item.uom or "",
        "net_from_location_id": loc_id,
        "net_from_location_name": loc_names.get(str(loc_id), ""),
        "gross_required": gross,
        "on_hand": detail["on_hand"], "incoming": detail["incoming"],
        "required_other": detail["required_other"],
        "reserved_other": detail.get("reserved_other", 0.0), "net_free": detail["net_free"],
        "net_qty": net, "decision": decision,
        "chips": [], "_attr_ids": list(attr_ids or []),
        "_bom_size_id": str(bom_size_id) if bom_size_id else None,
    }


async def _info_detail(avail: "Availability", item_id, attribute_value_ids, color_id=None,
                       size_token: str = "") -> dict:
    """Read-only stock snapshot for a (item, variant, size) — used for FORCED root
    nodes, which bypass netting entirely and must not decrement the ledger."""
    vkey = _generate_variant_key([str(a) for a in (attribute_value_ids or [])], color_id)
    item_s = str(item_id)
    buckets = await avail._on_hand_buckets(item_s, vkey)
    # token universe includes supply/demand-only sizes, not just those on hand
    eligible = avail._eligible_tokens(await avail._free_buckets(item_s, vkey),
                                      normalize_size_token(size_token))
    on_hand = sum(buckets.get(t, 0.0) for t in eligible)
    incoming = sum(avail._supply.get((item_s, vkey, t), 0.0) for t in eligible)
    required = sum(avail._demand.get((item_s, vkey, t), 0.0) for t in eligible)
    reserved = sum(avail._reserved.get((item_s, vkey, t), 0.0) for t in eligible)
    return {"on_hand": on_hand, "incoming": incoming, "required_other": required,
            "reserved_other": reserved,
            "net_free": on_hand + incoming - required - reserved}


def _root_netted_node(bom, gross: float, net: float, detail: dict, loc_id, loc_names: dict, forced: bool,
                      attr_ids=(), bom_size_id=None, color_id=None, labdip_code=None) -> dict:
    item = bom.item
    if forced:
        decision = "FORCED"
    elif net <= 0:
        decision = "SKIP"
    elif net < gross:
        decision = "RESIZE"
    else:
        decision = "MAKE"
    return {
        "level": 0, "is_root": True,
        "item_id": item.id, "item_code": item.code, "item_name": item.name, "uom": item.uom or "",
        "net_from_location_id": loc_id,
        "net_from_location_name": loc_names.get(str(loc_id), ""),
        "gross_required": gross,
        "on_hand": detail["on_hand"], "incoming": detail["incoming"],
        "required_other": detail["required_other"],
        "reserved_other": detail.get("reserved_other", 0.0), "net_free": detail["net_free"],
        "net_qty": net, "decision": decision,
        "chips": [], "_attr_ids": list(attr_ids or []),
        "_bom_size_id": str(bom_size_id) if bom_size_id else None,
        "_color_id": str(color_id) if color_id else None,
        "_labdip_code": labdip_code or None,
    }


# ── Row identity chips (size + color/combo) ──────────────────────────────────
# The preview lists one row per (BOM entry x size) and one per consolidated
# component key, so several rows can share an item name (same recipe, different
# size or shade). Chips carry that identity into the UI. Ids are collected on the
# nodes during the walk and resolved in ONE pass here, then the temp keys are
# dropped — response_model would silently strip them anyway, but leaving them
# would leak internals into the dict the create path never sees.
_CHIP_KIND_BY_ROLE = {"combo": "combo", "color": "color", "labdip_color": "color"}


async def _apply_chips(db: AsyncSession, nodes: list[dict]) -> None:
    attr_ids, size_ids, color_ids = set(), set(), set()
    for n in nodes:
        attr_ids.update(n.get("_attr_ids") or [])
        if n.get("_bom_size_id"):
            size_ids.add(n["_bom_size_id"])
        if n.get("_color_id"):
            color_ids.add(n["_color_id"])

    val_map: dict[str, dict] = {}
    if attr_ids:
        for vid, value, hexv, role, aname in (await db.execute(
            select(AttributeValue.id, AttributeValue.value, AttributeValue.hex,
                   Attribute.system_role, Attribute.name)
            .join(Attribute, Attribute.id == AttributeValue.attribute_id)
            .where(AttributeValue.id.in_(attr_ids))
        )).all():
            val_map[str(vid)] = {
                "kind": _CHIP_KIND_BY_ROLE.get(role or "", "attr"),
                "label": value or "", "hex": hexv, "group": aname or "",
            }

    size_map: dict[str, str] = {}
    if size_ids:
        for bs, sname in (await db.execute(
            select(BOMSize, Size.name)
            .outerjoin(Size, Size.id == BOMSize.size_id)
            .where(BOMSize.id.in_(size_ids))
        )).all():
            # "L-72 (70-74)" — the size with its BOM target and range, as every
            # size chip and the run's own qty inputs read it.
            size_map[str(bs.id)] = join_size(sname or bs.label, size_measurement(bs)) or ""

    color_map: dict[str, dict] = {}
    if color_ids:
        for cid, code, cname, hexv in (await db.execute(
            select(Color.id, Color.code, Color.name, Color.hex).where(Color.id.in_(color_ids))
        )).all():
            color_map[str(cid)] = {"label": code or cname or "", "hex": hexv,
                                   "group": cname or "Color"}

    for n in nodes:
        chips, seen = [], set()

        def add(kind: str, label: str, hexv=None, group=None):
            if not label or (kind, label) in seen:
                return
            seen.add((kind, label))
            chips.append({"kind": kind, "label": label, "hex": hexv, "group": group})

        add("size", size_map.get(n.pop("_bom_size_id", None) or "", ""), group="Size")
        col = color_map.get(n.pop("_color_id", None) or "")
        if col:
            add("color", col["label"], col["hex"], col["group"])
        add("color", n.pop("_labdip_code", None) or "", group="Pending shade")
        for vid in n.pop("_attr_ids", []) or []:
            v = val_map.get(str(vid))
            if v:
                add(v["kind"], v["label"], v["hex"], v["group"])
        n["chips"] = chips


async def _active_sub_bom(db: AsyncSession, item_id, combo_value_ids=(), combo_attr_id=None):
    """Combo-aware component recipe pick — must be the SAME rule as MO creation
    (`mrp_service.active_sub_bom`) or the preview explodes a different tree than
    the run it is previewing."""
    return await active_sub_bom(db, item_id, combo_value_ids, combo_attr_id,
                                with_item=True, with_sizes=True)


def _resolve_sub_size(sub_bom, parent_bs):
    """Map a parent's size row onto the sub-BOM's own size row — matched by shared
    Size master, else by label. Mirrors create_consolidated_component_mos: only a
    sub-BOM that is itself size-differentiated splits per size; an unsized/free one
    pools across every parent size (the color-variant greige case)."""
    if parent_bs is None or getattr(sub_bom, "size_mode", None) != "sized":
        return None
    if parent_bs.size_id:
        for s in sub_bom.sizes:
            if s.size_id and s.size_id == parent_bs.size_id:
                return s
    if parent_bs.label:
        want = parent_bs.label.strip().lower()
        for s in sub_bom.sizes:
            if s.label and s.label.strip().lower() == want:
                return s
    return None


async def preview_production_run(db, bom_entries, location, source_location, exclude_pr_id=None) -> list[dict]:
    """Dry-run of create_production_run: netted roots (unless force_create) +
    consolidated, netted components + deeper netted sub-tree. Returns a flat
    node list."""
    avail = await Availability.create(db, exclude_pr_id=exclude_pr_id)
    loc_names = await _location_name_map(db)
    nodes: list[dict] = []

    # Root size rows up front: their token is the netting bucket for the finished
    # goods, and is what each branch's components inherit.
    entry_size_ids = {
        str(getattr(s, "bom_size_id", None))
        for e in bom_entries for s in (getattr(e, "sizes", None) or [])
        if getattr(s, "bom_size_id", None)
    }
    bom_sizes: dict = {}
    if entry_size_ids:
        bom_sizes = {
            str(bs.id): bs for bs in (await db.execute(
                select(BOMSize).filter(BOMSize.id.in_(entry_size_ids))
            )).scalars().all()
        }

    # Pass 1: root finished goods — netted against stock same as a component,
    # unless the entry's force_create bypasses it (stockpile override).
    root_loc = source_location.id if source_location else (location.id if location else None)
    # (bom, net_qty, bom_size_id) per surviving root — the size id is threaded down
    # because a sized sub-assembly splits per size in the create path.
    root_gen: list[tuple] = []
    for entry in bom_entries:
        bom = (await db.execute(
            select(BOM).options(joinedload(BOM.item), selectinload(BOM.attribute_values))
            .filter(BOM.id == entry.bom_id)
        )).unique().scalars().first()
        if not bom:
            continue
        # (bom_size_id, qty). The size identity is both a netting bucket and the
        # split point for component *rows*, exactly where the create path splits
        # component MOs.
        gross_specs: list[tuple] = []
        if getattr(entry, "sizes", None):
            gross_specs = [(getattr(s, "bom_size_id", None), float(s.qty))
                           for s in entry.sizes if s.qty and s.qty > 0]
        elif entry.total_qty and entry.total_qty > 0:
            gross_specs = [(None, float(entry.total_qty))]
        if not gross_specs:
            continue

        force = bool(getattr(entry, "force_create", False))
        entry_attr_ids = getattr(entry, "attribute_value_ids", None)
        entry_color_id = getattr(entry, "color_id", None)
        root_attrs = (
            [str(v) for v in entry_attr_ids] if entry_attr_ids
            else [str(v.id) for v in bom.attribute_values]
        )

        for bom_size_id, gross in gross_specs:
            tok = avail.token_for_bom_size(bom_sizes.get(str(bom_size_id))) if bom_size_id else ""
            if force:
                detail = await _info_detail(avail, bom.item_id, root_attrs, entry_color_id, size_token=tok)
                net = gross
            else:
                net, detail = await avail.consume_detailed(bom.item_id, root_attrs, root_loc, gross,
                                                           color_id=entry_color_id, size_token=tok)
            nodes.append(_root_netted_node(
                bom, gross, net, detail, root_loc, loc_names, force,
                attr_ids=root_attrs, bom_size_id=bom_size_id, color_id=entry_color_id,
                labdip_code=getattr(entry, "labdip_variant_code", None),
            ))
            if net > 0:
                root_gen.append((bom, net, bom_size_id))

    # Pass 2+: consolidate component demand level-by-level (breadth-first),
    # mirroring the multi-level pooling the create path now does — a shared
    # component's total demand across every branch is netted once, at every
    # depth, not just directly below the roots.
    current_gen = root_gen
    combo_attr_id = await _combo_attr_id(db)
    level = 1
    while current_gen:
        # Parent size rows for this generation, so each parent's size identity can be
        # mapped onto its sub-BOM's own size rows (same preload the create path does).
        bs_ids = {sid for _, _, sid in current_gen if sid}
        bs_by_id: dict = {}
        if bs_ids:
            bs_by_id = {
                str(bs.id): bs for bs in (await db.execute(
                    select(BOMSize).filter(BOMSize.id.in_(bs_ids))
                )).scalars().all()
            }
        demand: dict[tuple, dict] = {}
        for bom, qty, parent_size_id in current_gen:
            bom_lines = (await db.execute(
                select(BOM).options(
                    selectinload(BOM.lines).selectinload(BOMLine.attribute_values)
                ).filter(BOM.id == bom.id)
            )).scalars().first()
            if not bom_lines:
                continue
            for line in bom_lines.lines:
                if not line.percentage:
                    continue
                # Combo tagged on the line splits pegging per combo (mirrors size),
                # folds into the netting variant, and selects the component's own
                # per-combo recipe. Plant-level netting otherwise consolidates by
                # (item, sub_bom) — location not part of the key.
                line_combo = _line_combo_value_ids(line, combo_attr_id)
                sub_bom = await _active_sub_bom(db, line.item_id, line_combo, combo_attr_id)
                if not sub_bom:
                    continue
                # Combo-less resolved recipe = combo-agnostic shared component: drop
                # the inherited line tag so the preview keys the same way the create
                # path does (mrp_service._effective_combo) and pools across branches.
                line_combo = _effective_combo(line_combo, sub_bom, combo_attr_id)
                item_row = (await db.execute(
                    select(Item.default_source_location_id, Item.is_decoupling_point)
                    .filter(Item.id == line.item_id)
                )).first()
                # Same source chain as the create path: BOM-line override -> item-master
                # default -> PR source. Display only (netting is plant-level).
                src = (
                    line.source_location_id
                    or (item_row.default_source_location_id if item_row else None)
                    or (source_location.id if source_location else (location.id if location else None))
                )
                comp_attrs = sorted(set(
                    [str(v.id) for v in sub_bom.attribute_values] + line_combo
                ))
                # Size split: a size-differentiated sub-BOM gets one row per size, so
                # the preview shows the same rows the create path creates MOs for.
                sub_bs = _resolve_sub_size(sub_bom, bs_by_id.get(str(parent_size_id)) if parent_size_id else None)
                size_key = str(sub_bs.id) if sub_bs is not None else None
                key = (str(line.item_id), str(sub_bom.id), size_key, tuple(line_combo))
                if key not in demand:
                    demand[key] = {"sub_bom": sub_bom, "src": src, "total": 0.0,
                                   "attrs": comp_attrs,
                                   "bom_size_id": sub_bs.id if sub_bs is not None else None,
                                   "size_token": avail.token_for_bom_size(sub_bs),
                                   "decoupled": _line_decoupled(
                                       line, item_row.is_decoupling_point if item_row else False)}
                demand[key]["total"] += (qty * float(line.percentage)) / 100

        next_gen = []
        for data in demand.values():
            total = data["total"]
            if total <= 0:
                continue
            # Decoupling point: mirror the create path — record the demand node for
            # visibility but create no MO and don't explode the sub-tree. Read-only
            # stock snapshot (no ledger decrement) since nothing is made here.
            if data["decoupled"]:
                detail = await _info_detail(avail, data["sub_bom"].item_id, data["attrs"],
                                            size_token=data["size_token"])
                node = _component_node(data["sub_bom"], level, data["src"], total, 0.0, detail, loc_names,
                                       attr_ids=data["attrs"], bom_size_id=data["bom_size_id"])
                node["decision"] = "DECOUPLED"
                nodes.append(node)
                continue
            net, detail = await avail.consume_detailed(data["sub_bom"].item_id, data["attrs"], data["src"], total,
                                                       size_token=data["size_token"])
            nodes.append(_component_node(data["sub_bom"], level, data["src"], total, net, detail, loc_names,
                                         attr_ids=data["attrs"], bom_size_id=data["bom_size_id"]))
            if net > 0:
                next_gen.append((data["sub_bom"], net, data["bom_size_id"]))
        current_gen = next_gen
        level += 1

    await _apply_store(avail, nodes, loc_names)
    await _apply_chips(db, nodes)
    return nodes


async def _preview_children(db, avail, bom_id, parent_net, source_location_id, location_id, level, nodes, loc_names):
    """Mirror of create_mo_recursive's child loop (read-only), for a single
    ad-hoc MO's own sub-tree — no cross-branch pooling applies here since
    there is only one branch."""
    bom = (await db.execute(
        select(BOM).options(
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values)
        ).filter(BOM.id == bom_id)
    )).scalars().first()
    if not bom:
        return
    combo_attr_id = await _combo_attr_id(db)
    for line in bom.lines:
        if not line.percentage:
            continue
        # Combo on the line folds into the produced variant and picks the
        # component's per-combo recipe (mirrors create path).
        line_combo = _line_combo_value_ids(line, combo_attr_id)
        sub_bom = await _active_sub_bom(db, line.item_id, line_combo, combo_attr_id)
        if not sub_bom:
            continue
        line_combo = _effective_combo(line_combo, sub_bom, combo_attr_id)
        gross = (parent_net * float(line.percentage)) / 100
        # Nested-MO children inherit the MO's own source (create_mo_recursive passes
        # source_location_id straight down — no line/item override there).
        sub_loc = source_location_id or location_id
        item_flag = (await db.execute(
            select(Item.is_decoupling_point).filter(Item.id == line.item_id)
        )).scalar()
        attrs = sorted(set([str(v.id) for v in sub_bom.attribute_values] + line_combo))
        # Decoupling point: show the demand node, create nothing, don't recurse.
        if _line_decoupled(line, item_flag):
            detail = await _info_detail(avail, sub_bom.item_id, attrs)
            node = _component_node(sub_bom, level, sub_loc, gross, 0.0, detail, loc_names, attr_ids=attrs)
            node["decision"] = "DECOUPLED"
            nodes.append(node)
            continue
        net, detail = await avail.consume_detailed(sub_bom.item_id, attrs, sub_loc, gross)
        nodes.append(_component_node(sub_bom, level, sub_loc, gross, net, detail, loc_names, attr_ids=attrs))
        if net > 0:
            await _preview_children(db, avail, sub_bom.id, net, source_location_id, location_id, level + 1, nodes, loc_names)


async def preview_mo(db, bom_id, qty, location, source_location, create_nested=True, exclude_mo_ids=None) -> list[dict]:
    """Dry-run of a nested MO creation: root (always made) + netted sub-tree."""
    avail = await Availability.create(db, exclude_mo_ids=exclude_mo_ids)
    loc_names = await _location_name_map(db)
    bom = (await db.execute(
        select(BOM).options(joinedload(BOM.item), selectinload(BOM.attribute_values))
        .filter(BOM.id == bom_id)
    )).unique().scalars().first()
    if not bom:
        return []
    nodes = [_root_node(bom, float(qty), location, loc_names,
                        attr_ids=[str(v.id) for v in bom.attribute_values])]
    if create_nested:
        loc_id = location.id if location else None
        src = source_location.id if source_location else loc_id
        await _preview_children(db, avail, bom_id, float(qty), src, loc_id, 1, nodes, loc_names)
    await _apply_store(avail, nodes, loc_names)
    await _apply_chips(db, nodes)
    return nodes
