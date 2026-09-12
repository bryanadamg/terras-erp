from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, String
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime
import uuid

from app.db.session import get_async_db
from app.schemas import (
    PickListCreate, PickListUpdate, PickListResponse, PickListListResponse,
    PickListScanPayload, PickableOrderResponse, PickableOrderLine,
    PickListSuggestedLine, PickListSuggestedCarton, PickListCartonIdentity,
)
from app.models.pick_list import PickList, PickListLine
from app.models.batch import Batch
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.bom import BOMSize
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.models.auth import User
from app.services import (
    audit_service, kpi_service, stock_service, packing_service, so_fulfilment_service,
    numbering_service,
)
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow

router = APIRouter(prefix="/pick-lists", tags=["pick-lists"])


# --- helpers ---------------------------------------------------------------

def _load_options():
    # sales_order is loaded plain (no .lines) — _decorate() only reads po_number/
    # customer_name, both columns on SalesOrder itself. dispatch_pick_list is the
    # one place that needs sales_order.lines, and it already runs its own dedicated
    # query for it; loading it here on every list/detail fetch was two pure-waste
    # queries that scale with SO line count for zero benefit.
    # The SO line hop is for the Surat Jalan: the doc prints a WARNA column, and the
    # ordered shade lives on the SO line (color_id -> Color, plus the legacy variant
    # attribute values), never on the pick list line itself.
    return (
        selectinload(PickList.sales_order),
        selectinload(PickList.lines).selectinload(PickListLine.item),
        selectinload(PickList.lines).selectinload(PickListLine.batch),
        selectinload(PickList.lines).selectinload(PickListLine.sales_order_line).selectinload(SalesOrderLine.color),
        selectinload(PickList.lines).selectinload(PickListLine.sales_order_line).selectinload(SalesOrderLine.attribute_values),
        selectinload(PickList.shipment),
    )


async def _load(db: AsyncSession, pl_id) -> Optional[PickList]:
    # Session uses expire_on_commit=False, so an instance already in the identity
    # map keeps its previously-loaded (now stale) collections. Expire first so the
    # selectinload below repopulates lines with fresh post-commit rows.
    db.expire_all()
    result = await db.execute(
        select(PickList).options(*_load_options()).filter(PickList.id == pl_id)
    )
    return result.scalars().first()


def _decorate(pl: PickList) -> PickList:
    """Attach non-column display fields the response schema expects."""
    if pl.sales_order:
        pl.sales_order_code = pl.sales_order.po_number
        pl.customer_name = pl.sales_order.customer_name
        # The customer's own PO — the "NO PO" column of the Surat Jalan. Their
        # reference, not ours; po_number is the internal SO code.
        pl.customer_po_ref = pl.sales_order.customer_po_ref
    # Which loading-deck handover this pick list is on, if any. The page shows it
    # so a picker can see their work has moved on rather than gone missing.
    if pl.shipment:
        pl.shipment_code = pl.shipment.code
        pl.shipment_status = pl.shipment.status
    # Stable line order. The `lines` relationship carries no ORDER BY, so
    # Postgres hands back heap order — and confirming a carton UPDATEs
    # `picked_at`, which rewrites the row's tuple and moved it to the end of the
    # heap. Every carton the picker ticked jumped to the bottom of the table
    # under them. Sorted on the carton's own identity (never on `picked_at`), so
    # scanning can't reorder anything; bulk lines, which have no carton, sort
    # last within their SO line. In place via `list.sort` on purpose: rebinding
    # `pl.lines` would fire the delete-orphan cascade's collection events for a
    # pure display concern.
    if pl.lines:
        pl.lines.sort(key=lambda l: (
            str(l.sales_order_line_id),
            l.batch is None,
            l.batch.package_no if (l.batch and l.batch.package_no is not None) else 0,
            (l.batch.batch_number if l.batch else None) or "",
            str(l.id),
        ))
    for line in (pl.lines or []):
        sol = line.sales_order_line
        color = sol.color if sol else None
        line.color_name = color.name if color else None
        # Customers reference their own shade code on the delivery note when they
        # have one; ours is the fallback.
        line.color_code = (color.customer_color_code or color.code) if color else None
        line.attribute_value_ids = [v.id for v in (sol.attribute_values or [])] if sol else []
        # Size of the carton actually picked — stamped on the carton at packing
        # from the lot it was packed out of (packing_service.lot_size_identity).
        if line.batch is not None:
            line.bom_size_snapshot = line.batch.bom_size_snapshot
            line.size_label = stock_service._bom_size_label(line.batch.bom_size_snapshot)
            # Packaging + weights, snapshotted on the carton at pack time.
            pt = line.batch.packaging_type
            line.packaging_type_name = pt.name if pt else None
            line.net_weight_kg = (
                float(line.batch.weight_kg) if line.batch.weight_kg is not None else None
            )
            line.gross_weight_kg = (
                float(line.batch.gross_weight_kg) if line.batch.gross_weight_kg is not None else None
            )
    return pl


async def _decorate_all(db: AsyncSession, pls: list) -> list:
    """`_decorate` over a set of pick lists, plus the one piece of a line's
    identity that needs the database: what is physically in the picked carton.

    Shade and combo are not columns on a Batch — they live only in the carton's
    StockBalance row (`variant_key`), so unlike size and the weights they cannot
    be read off the already-loaded tree. Resolved here for every carton on every
    list in two queries, never one per line.

    The balance row is read with NO `qty > 0` filter on purpose: a dispatched
    carton's row sits at zero, and a shipped pick list still has to be able to
    say what colour went out.
    """
    from app.models.stock_balance import StockBalance
    lines = [l for pl in pls for l in (pl.lines or []) if l.batch_id]
    if lines:
        rows = (await db.execute(
            select(StockBalance.batch_key, StockBalance.variant_key)
            .filter(StockBalance.batch_key.in_([str(l.batch_id) for l in lines]))
        )).all()
        # A carton can hold rows at more than one location; they are the same box,
        # so any row with a key answers for it and an empty key never displaces one.
        key_by_batch: dict = {}
        for bk, vk in rows:
            if vk and not key_by_batch.get(bk):
                key_by_batch[bk] = vk
        variants = await stock_service.describe_variant_keys(db, set(key_by_batch.values()))
        for l in lines:
            vkey = key_by_batch.get(str(l.batch_id))
            v = variants.get(vkey) or {}
            b = l.batch
            l.carton_identity = PickListCartonIdentity(
                variant_key=vkey or None,
                variant_attributes=v.get("variant_attributes") or None,
                color_id=v.get("color_id"),
                color_name=v.get("color_name"),
                color_code=v.get("color_code"),
                color_hex=v.get("color_hex"),
                bom_size_id=b.bom_size_id if b is not None else None,
                bom_size_snapshot=b.bom_size_snapshot if b is not None else None,
                size_label=stock_service._bom_size_label(b.bom_size_snapshot) if b is not None else None,
            )
    for pl in pls:
        _decorate(pl)
    return pls


async def _next_code(db: AsyncSession) -> str:
    """Next `PL-NNNNN` off the pick-list number range.

    max(code)+1 raced two concurrent creates onto the same code. Seeded once from
    the highest existing number — legacy rows carry the old `PK-` prefix from when
    this table was packing_orders, so both are read or numbering would restart at 1
    and collide."""
    async def _seed() -> int:
        # func.max() on the code column is a STRING max, so a code not zero-padded
        # to the current width can outrank the real numeric max (e.g. "PL-003" >
        # "PL-00144" lexicographically). Parse every candidate, take the numeric max.
        codes = (await db.execute(select(PickList.code))).scalars().all()
        best = 0
        for c in codes:
            if c and c[:3] in ("PL-", "PK-"):
                try:
                    best = max(best, int(c.split("-", 1)[1]))
                except (ValueError, IndexError):
                    continue
        return best

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(PickList.id).filter(PickList.code == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, "PICK_LIST", lambda n: f"PL-{n:05d}", seed=_seed, exists=_taken,
    )
    return code


async def _remaining_by_so_line(db: AsyncSession, so: SalesOrder, exclude_pl_id=None) -> dict:
    """qty remaining to ship per SO line = ordered - already picked (non-cancelled).

    exclude_pl_id drops one pick list's own lines from the "picked" sum — used
    when editing a DRAFT so it doesn't count its own not-yet-saved allocation
    against itself.

    "Ordered" is the line qty restated in the item's stock UoM, since that is the
    unit `qty_picked` is in. Subtracting picked kilograms from ordered yards let a
    10 kg order suggest cartons until the store was empty — one live pick list
    had 40 000 picked against it.
    """
    query = (
        select(PickListLine.sales_order_line_id, func.coalesce(func.sum(PickListLine.qty_picked), 0))
        .join(PickList, PickListLine.pick_list_id == PickList.id)
        .filter(PickList.sales_order_id == so.id, PickList.status != "CANCELLED")
        .group_by(PickListLine.sales_order_line_id)
    )
    if exclude_pl_id:
        query = query.filter(PickList.id != exclude_pl_id)
    picked = await db.execute(query)
    picked_map = {str(sol_id): float(qty) for sol_id, qty in picked.all()}
    ordered_map = await so_fulfilment_service.ordered_base_map(
        db, [line.id for line in so.lines]
    )
    remaining = {}
    for line in so.lines:
        ordered = ordered_map.get(str(line.id))
        # No derivable ordered qty means no safe suggestion: seed nothing rather
        # than guess, so a missing item weight can't over-pick the store.
        remaining[str(line.id)] = (
            0.0 if ordered is None
            else max(0.0, ordered - picked_map.get(str(line.id), 0.0))
        )
    return remaining


async def _remaining_alt_by_so_line(db: AsyncSession, so: SalesOrder) -> dict:
    """The same "ordered - already picked" subtraction as `_remaining_by_so_line`,
    but counted in the line's own alt selling unit (`SalesOrderLine.uom2`).

    `{line_id: (remaining_alt, alt_uom)}`; absent for a line with no alt unit, so
    a consumer falls back to the base figure rather than drawing a bare 0.

    Ordered is `qty2` as it was keyed — never re-derived from the kilos, per
    so_fulfilment_service: the SO form locks the pair together. Picked is SUMMED
    FROM `Batch.alt_qty` (the count the packer actually put in the box) for the
    same reason — dividing picked kilograms by `uom2_factor` reports 11.8 Pcs out
    of a carton that holds 12. A carton packed with no alt count contributes
    nothing, which can only understate what is left, never over-pick it.
    """
    rows = (await db.execute(
        select(PickListLine.sales_order_line_id, func.coalesce(func.sum(Batch.alt_qty), 0))
        .join(PickList, PickListLine.pick_list_id == PickList.id)
        .join(Batch, PickListLine.batch_id == Batch.id)
        .filter(PickList.sales_order_id == so.id, PickList.status != "CANCELLED")
        .group_by(PickListLine.sales_order_line_id)
    )).all()
    picked_map = {str(sol_id): float(qty) for sol_id, qty in rows}
    out = {}
    for line in so.lines:
        uom2 = (line.uom2 or "").strip()
        if not uom2 or line.qty2 is None:
            continue
        out[str(line.id)] = (
            max(0.0, float(line.qty2) - picked_map.get(str(line.id), 0.0)),
            uom2,
        )
    return out


async def _packing_order_alt_uoms(db: AsyncSession, po_ids: list) -> dict:
    """`{packing_order_id: uom2}` — the unit each carton's `alt_qty` was counted
    in, in one query rather than a hop per box."""
    from app.models.packing import PackingOrder
    ids = {str(p) for p in po_ids if p}
    if not ids:
        return {}
    rows = (await db.execute(
        select(PackingOrder.id, PackingOrder.uom2).filter(PackingOrder.id.in_(ids))
    )).all()
    return {str(pid): (u or "").strip() for pid, u in rows}


def _line_variant_key(so_line: SalesOrderLine) -> str:
    """The stock variant key an SO line's own ordered identity folds down to.

    Same generator the balance rows use, so a line and the cartons packed for it
    resolve through one vocabulary — a second hand-rolled fold is how a colour
    token ends up rendered as an attribute (see stock_service.describe_variant_keys).
    """
    return stock_service._generate_variant_key(
        [str(v.id) for v in (so_line.attribute_values or [])], so_line.color_id
    )


def _ordered_identity(so_line: SalesOrderLine, variants: dict) -> dict:
    """Display identity of what an SO LINE ordered — shade/combo/other attributes
    off its variant key, size off its BOM size.

    Field names match a lot's (`LotChips` reads them), so the readiness board and
    the suggestion modal label an order line exactly the way every picker screen
    labels a carton. Two lines of the same item differing only by shade are
    otherwise indistinguishable on a board that lists orders, not lines.
    """
    v = variants.get(_line_variant_key(so_line)) or {}
    # Size as text. The generic pick the order actually carries comes first; the
    # legacy per-BOM pointer is the fallback for pre-decoupling lines.
    size = getattr(so_line, "bom_size", None)
    generic = getattr(so_line, "size", None)
    return dict(
        size_label=(
            (generic.name if generic is not None else None)
            or so_line.size_label
            or ((size.size_name or size.label) if size is not None else None)
        ),
        variant_attributes=v.get("variant_attributes") or None,
        color_id=v.get("color_id"),
        color_code=v.get("color_code"),
        color_name=v.get("color_name"),
        color_hex=v.get("color_hex"),
        labdip_variant_code=so_line.labdip_variant_code,
    )


async def _carton_stock_rows(db: AsyncSession, batch_ids: list) -> dict:
    """`{batch_id: StockBalance}` for a set of cartons — where each one is and
    what variant it holds, in ONE query.

    A carton's qty, location and shade all live on its balance row, so the
    per-carton `_unit_location` lookup that used to sit in the suggestion loop
    was both an N+1 and only half the identity.
    """
    from app.models.stock_balance import StockBalance
    if not batch_ids:
        return {}
    rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key.in_([str(b) for b in batch_ids]), StockBalance.qty > 0)
    )).scalars().all()
    return {r.batch_key: r for r in rows}


def _carton_identity(pu: Batch, bal, variants: dict) -> dict:
    """Display identity of what is physically IN a carton — shade/combo off its
    balance row's variant key, size off the Batch row it was stamped with at
    mint. Mirrors `_pu_response` in api/packing.py; same names, same sources."""
    v = variants.get(bal.variant_key if bal else None) or {}
    return dict(
        variant_key=(bal.variant_key if bal else None) or None,
        variant_attributes=v.get("variant_attributes") or None,
        color_id=v.get("color_id"),
        color_name=v.get("color_name"),
        color_code=v.get("color_code"),
        color_hex=v.get("color_hex"),
        bom_size_id=pu.bom_size_id,
        bom_size_snapshot=pu.bom_size_snapshot,
        size_label=stock_service._bom_size_label(pu.bom_size_snapshot),
    )


async def _suggest_cartons(db: AsyncSession, so: SalesOrder, source_location_id=None) -> list[PickListSuggestedLine]:
    """FIFO-suggest whole cartons covering every outstanding SO line, without
    writing anything. Shared by the `/suggest` preview (planner unchecks a
    carton before a pick list exists) and `_suggest_lines` (auto-fill fallback
    for a caller that posts no explicit line selection).

    Carton-only by design: a pick list is downstream of packing, so a line with
    nothing packed yet simply isn't suggested — it comes onto a later pick list
    once its cartons exist. (This replaced a bulk-qty fallback that let
    un-cartonised stock ship straight off a pick list, which put goods on a
    Surat Jalan that no physical box backed and left the carton genealogy with
    a hole.)
    """
    remaining = await _remaining_by_so_line(db, so)
    remaining_alt = await _remaining_alt_by_so_line(db, so)
    ordered_map = await so_fulfilment_service.ordered_base_map(db, [line.id for line in so.lines])
    taken = await packing_service.allocated_unit_ids(db)

    # Pass 1 — FIFO-pick the cartons for every outstanding line.
    picked: list[tuple[SalesOrderLine, float, list]] = []
    for so_line in so.lines:
        rem = remaining.get(str(so_line.id), 0.0)
        if rem <= 0:
            continue
        attr_ids = [str(v.id) for v in (so_line.attribute_values or [])]
        units = await packing_service.suggest_units_for_line(
            db, so_line.item_id, rem,
            location_id=source_location_id,
            attribute_value_ids=attr_ids,
            color_id=so_line.color_id,
            exclude_ids=taken,
        )
        for pu, _qty in units:
            taken.add(pu.id)
        picked.append((so_line, rem, units))

    # Pass 2 — resolve display identity for the whole suggestion at once: the
    # cartons' own (from their balance rows) and the lines' ordered one. Both
    # sides get chips because they can disagree, and the planner unchecking a
    # box is precisely who needs to see that.
    balances = await _carton_stock_rows(
        db, [pu.id for _l, _r, units in picked for pu, _q in units]
    )
    # A carton's alt count was counted in ITS packing order's unit, which is not
    # necessarily the unit this line is sold in (packed in Pcs, ordered in Gross).
    # Carry the box's own label rather than restating it in the line's — the two
    # are only summed together where they agree.
    carton_alt_uom = await _packing_order_alt_uoms(
        db, [pu.packing_order_id for _l, _r, units in picked for pu, _q in units]
    )
    keys = {bal.variant_key for bal in balances.values() if bal.variant_key}
    keys.update(k for k in (_line_variant_key(l) for l, _r, _u in picked) if k)
    variants = await stock_service.describe_variant_keys(db, keys)

    out: list[PickListSuggestedLine] = []
    for so_line, rem, units in picked:
        rem_alt, alt_uom = remaining_alt.get(str(so_line.id), (None, ""))
        cartons: list[PickListSuggestedCarton] = []
        for pu, qty in units:
            bal = balances.get(str(pu.id))
            cartons.append(PickListSuggestedCarton(
                batch_id=pu.id, batch_number=pu.batch_number,
                package_no=pu.package_no, qty=qty,
                # The packer's own count for this box, not qty/factor. Null on a
                # carton packed with no alt unit even when the line has one — the
                # modal then shows kilos alone for that row rather than a zero.
                alt_qty=float(pu.alt_qty) if pu.alt_qty is not None else None,
                alt_uom=carton_alt_uom.get(str(pu.packing_order_id)) or None,
                source_location_id=bal.location_id if bal else None,
                **_carton_identity(pu, bal, variants),
            ))
        it = so_line.item
        out.append(PickListSuggestedLine(
            sales_order_line_id=so_line.id,
            item_id=so_line.item_id,
            item_code=it.code if it else None,
            item_name=it.name if it else None,
            item_uom=it.uom if it else None,
            ordered_qty=ordered_map.get(str(so_line.id), 0.0),
            remaining_qty=rem,
            ordered_alt=float(so_line.qty2) if so_line.qty2 is not None else None,
            remaining_alt=rem_alt,
            alt_uom=alt_uom or None,
            cartons=cartons,
            **_ordered_identity(so_line, variants),
        ))
    return out


async def _suggest_lines(db: AsyncSession, pl: PickList, so: SalesOrder) -> list[PickListLine]:
    """Seed a pick list with every carton `_suggest_cartons` finds — the
    auto-fill fallback used when a caller (e.g. an older client) posts no
    explicit line selection."""
    groups = await _suggest_cartons(db, so, source_location_id=pl.source_location_id)
    lines: list[PickListLine] = []
    for g in groups:
        for c in g.cartons:
            lines.append(PickListLine(
                pick_list_id=pl.id,
                sales_order_line_id=g.sales_order_line_id,
                item_id=g.item_id,
                qty_picked=c.qty,
                source_location_id=c.source_location_id,
                batch_id=c.batch_id,
            ))
    return lines


async def _ready_carton_index(db: AsyncSession) -> dict:
    """Every unallocated, in-stock carton keyed by (item_id, variant_key), FIFO.

    One query for the whole plant instead of per-SO-line lookups: the readiness
    board scores every open order at once, and a per-line query there is an N+1
    that grows with the order book.
    """
    from app.models.stock_balance import StockBalance
    taken = await packing_service.allocated_unit_ids(db)
    rows = (await db.execute(
        select(Batch, StockBalance)
        .join(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
        .filter(
            packing_service.packed_unit_filter(),
            Batch.quality_status == "GOOD",
            StockBalance.qty > 0,
        )
        .order_by(Batch.created_at.asc(), Batch.package_no.asc())
    )).all()

    index: dict = {}
    seen = set()
    for batch, bal in rows:
        # A carton is atomic; a stray second balance row must not double-count it.
        if batch.id in seen or batch.id in taken:
            continue
        seen.add(batch.id)
        index.setdefault((str(batch.item_id), bal.variant_key), []).append(float(bal.qty))
    return index


def _so_due_date(so: SalesOrder):
    """Earliest line due date — when the customer expects the order."""
    dues = [l.due_date for l in (so.lines or []) if l.due_date]
    return min(dues) if dues else None


async def _unit_location(db: AsyncSession, pu: Batch):
    """Where a carton physically is — the location of its (single) balance row."""
    from app.models.stock_balance import StockBalance
    result = await db.execute(
        select(StockBalance.location_id)
        .filter(StockBalance.batch_key == str(pu.id), StockBalance.qty > 0)
        .limit(1)
    )
    return result.scalar()


# --- routes ----------------------------------------------------------------

@router.get("", response_model=PickListListResponse)
async def list_pick_lists(
    status: Optional[str] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    window: PageWindow = Depends(PageParams(default_size=100)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    query = select(PickList).options(*_load_options())
    count_query = select(func.count(PickList.id))
    if status:
        query = query.filter(PickList.status == status)
        count_query = count_query.filter(PickList.status == status)
    if sales_order_id:
        query = query.filter(PickList.sales_order_id == sales_order_id)
        count_query = count_query.filter(PickList.sales_order_id == sales_order_id)

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(window.apply(query.order_by(PickList.created_at.desc())))
    orders = result.scalars().all()
    await _decorate_all(db, list(orders))
    return window.envelope(orders, total)


@router.get("/pickable-orders", response_model=list[PickableOrderResponse])
async def list_pickable_orders(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Open sales orders scored for picking: soonest delivery first, showing what
    is actually packed and waiting for each.

    Declared above `/{pl_id}` on purpose — FastAPI matches in declaration order,
    and "pickable-orders" would otherwise be parsed as a pick list UUID.

    Cartons are claimed by the most urgent order first. They are not reserved —
    any pick list may still take any carton — but scoring them in due-date order
    is the only reading that doesn't promise the same physical box to two orders
    at once on this board.
    """
    so_rows = (await db.execute(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values),
            # The board lists orders, but each row now names the items and the
            # shade/size behind them — those hops feed _ordered_identity.
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.item),
            # .size too: BOMSize.size_name is a property over that relationship,
            # so stopping at bom_size only moves the lazy load one hop deeper.
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.bom_size).selectinload(BOMSize.size),
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.size),
        )
        .filter(SalesOrder.status.in_(["PENDING", "READY", "PARTIAL"]))
    )).scalars().all()

    draft_so_ids = {
        str(r[0]) for r in (await db.execute(
            select(PickList.sales_order_id).filter(PickList.status.in_(["DRAFT", "PICKING", "PICKED"]))
        )).all() if r[0]
    }

    index = await _ready_carton_index(db)
    today = datetime.utcnow().date()

    # Whole-order fulfilment for the page in one batched pass — four grouped
    # aggregates for the entire board, not one query per order.
    fulfilment = await so_fulfilment_service.fulfilment_map(db, [s.id for s in so_rows])

    # One resolve of every ordered variant on the board — shade/combo chips are
    # per line, and a per-line lookup here would be an N+1 over the order book.
    variants = await stock_service.describe_variant_keys(
        db, {k for k in (_line_variant_key(l) for so in so_rows for l in so.lines) if k}
    )

    # Urgent first, undated orders last — an order with no due date is not more
    # urgent than every dated one, which is what plain ascending sort would say.
    ordered = sorted(so_rows, key=lambda s: (_so_due_date(s) is None, _so_due_date(s) or datetime.max))

    out: list[PickableOrderResponse] = []
    for so in ordered:
        remaining = await _remaining_by_so_line(db, so)
        qty_outstanding = 0.0
        qty_ready = 0.0
        cartons_ready = 0
        lines_outstanding = 0
        out_lines: list[PickableOrderLine] = []
        for line in so.lines:
            rem = remaining.get(str(line.id), 0.0)
            if rem <= 0:
                continue
            lines_outstanding += 1
            qty_outstanding += rem
            key = (str(line.item_id), _line_variant_key(line))
            pool = index.get(key)
            # Whole cartons only — the picker moves a physical box, so the last
            # one may overshoot the outstanding qty rather than be split.
            covered = 0.0
            line_cartons = 0
            while pool and covered < rem - 1e-6:
                covered += pool.pop(0)
                line_cartons += 1
            cartons_ready += line_cartons
            qty_ready += covered
            it = line.item
            out_lines.append(PickableOrderLine(
                sales_order_line_id=line.id,
                item_id=line.item_id,
                item_code=it.code if it else None,
                item_name=it.name if it else None,
                item_uom=it.uom if it else None,
                qty_outstanding=round(rem, 4),
                qty_ready=round(covered, 4),
                cartons_ready=line_cartons,
                **_ordered_identity(line, variants),
            ))

        if qty_outstanding <= 0:
            continue

        # Fulfilment spans the WHOLE order, so it rolls up every line — including
        # the ones already fully shipped, which is exactly what "overall" means
        # and what the outstanding-only loop above skips.
        f_ordered = f_made = f_packed = f_dispatched = 0.0
        unknown_base = 0
        base_uoms: set[str] = set()
        # The same roll-up in the alt selling unit, which is what the row draws.
        # `alt_ok` goes false the moment one line can't contribute — no alt unit,
        # a different alt unit from its neighbours, or a stage with no count — and
        # the row then falls back to the kilos. Partial is not an option: adding
        # four lines of Pcs and leaving the fifth out understates the order
        # silently, which is the failure `lines_unknown_base` exists to avoid.
        a_ordered = a_made = a_packed = a_dispatched = 0.0
        alt_uoms: set[str] = set()
        alt_ok = bool(so.lines)
        for line in so.lines:
            stat = fulfilment.get(str(line.id))
            if not stat:
                continue
            alt_ordered = stat.get("ordered_alt")
            alt_stages = [stat.get(k) for k in ("made_alt", "packed_alt", "dispatched_alt")]
            if alt_ordered is None or any(v is None for v in alt_stages):
                alt_ok = False
            else:
                a_ordered += float(alt_ordered)
                a_made, a_packed, a_dispatched = (
                    a_made + float(alt_stages[0]),
                    a_packed + float(alt_stages[1]),
                    a_dispatched + float(alt_stages[2]),
                )
                if stat.get("alt_uom"):
                    alt_uoms.add(stat["alt_uom"])
            base = stat.get("ordered_base")
            if base is None:
                unknown_base += 1
                continue
            f_ordered += float(base)
            f_made += stat.get("made", 0.0)
            f_packed += stat.get("packed", 0.0)
            f_dispatched += stat.get("dispatched", 0.0)
            if stat.get("base_uom"):
                base_uoms.add(stat["base_uom"])
        alt_ok = alt_ok and len(alt_uoms) == 1 and a_ordered > 0

        due = _so_due_date(so)
        out.append(PickableOrderResponse(
            id=so.id,
            po_number=so.po_number,
            customer_po_ref=so.customer_po_ref,
            customer_name=so.customer_name,
            status=so.status,
            due_date=due,
            days_to_due=(due.date() - today).days if due else None,
            line_count=len(so.lines or []),
            lines_outstanding=lines_outstanding,
            qty_outstanding=round(qty_outstanding, 4),
            qty_ready=round(qty_ready, 4),
            cartons_ready=cartons_ready,
            has_open_pick_list=str(so.id) in draft_so_ids,
            qty_ordered_base=round(f_ordered, 4),
            qty_made=round(f_made, 4),
            qty_packed=round(f_packed, 4),
            qty_dispatched=round(f_dispatched, 4),
            base_uom=next(iter(base_uoms)) if len(base_uoms) == 1 else None,
            qty_ordered_alt=round(a_ordered, 2) if alt_ok else None,
            qty_made_alt=round(a_made, 2) if alt_ok else None,
            qty_packed_alt=round(a_packed, 2) if alt_ok else None,
            qty_dispatched_alt=round(a_dispatched, 2) if alt_ok else None,
            alt_uom=next(iter(alt_uoms)) if alt_ok else None,
            lines_unknown_base=unknown_base,
            lines=out_lines,
        ))
    return out


@router.get("/suggest", response_model=list[PickListSuggestedLine])
async def suggest_pick_list_cartons(
    sales_order_id: uuid.UUID,
    source_location_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Preview of what creating a pick list for this order would auto-fill —
    lets the planner uncheck a carton (e.g. the only one available overshoots
    what's still owed, packed extra for tolerance/reject allowance) before a
    pick list, and its carton allocation, exists at all.

    Declared above `/{pl_id}` for the same routing reason as `/pickable-orders`.
    """
    so_result = await db.execute(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values),
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.item),
            # Ordered size — chipped next to the item so a multi-size order's
            # lines are told apart (see _ordered_identity).
            # .size too: BOMSize.size_name is a property over that relationship,
            # so stopping at bom_size only moves the lazy load one hop deeper.
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.bom_size).selectinload(BOMSize.size),
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.size),
        )
        .filter(SalesOrder.id == sales_order_id)
    )
    so = so_result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return await _suggest_cartons(db, so, source_location_id=source_location_id)


@router.get("/resolve", response_model=PickListResponse)
async def resolve_pick_list(
    code: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Scanner lookup: PL-NNNNN -> the pick list it names.

    Declared above `/{pl_id}` for the same reason as `/pickable-orders` — the
    path would otherwise be parsed as a pick list UUID.

    Case-insensitive because the floor types codes by hand when a label is
    scuffed. Legacy `PK-` rows resolve too: they are the same table.
    """
    wanted = (code or "").strip()
    if not wanted:
        raise HTTPException(status_code=404, detail="No code given")
    result = await db.execute(
        select(PickList).options(*_load_options()).filter(func.upper(PickList.code) == wanted.upper())
    )
    pl = result.scalars().first()
    if not pl:
        raise HTTPException(status_code=404, detail=f"No pick list found for '{wanted}'")
    return (await _decorate_all(db, [pl]))[0]


@router.get("/{pl_id}", response_model=PickListResponse)
async def get_pick_list(
    pl_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    pl = await _load(db, pl_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Pick list not found")
    return (await _decorate_all(db, [pl]))[0]


@router.get("/{pl_id}/remaining")
async def get_remaining_for_pick_list(
    pl_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Per-SO-line qty still available to allocate to this DRAFT, excluding its own
    lines. Lets the editor compute remaining/over-pick without loading every pick
    list in the system to sum qty_picked client-side."""
    pl_result = await db.execute(select(PickList).filter(PickList.id == pl_id))
    pl = pl_result.scalars().first()
    if not pl:
        raise HTTPException(status_code=404, detail="Pick list not found")
    so_result = await db.execute(
        select(SalesOrder).options(selectinload(SalesOrder.lines)).filter(SalesOrder.id == pl.sales_order_id)
    )
    so = so_result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    return await _remaining_by_so_line(db, so, exclude_pl_id=pl_id)


@router.post("", response_model=PickListResponse)
async def create_pick_list(
    payload: PickListCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    so_result = await db.execute(
        select(SalesOrder)
        .options(
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values),
            selectinload(SalesOrder.lines).selectinload(SalesOrderLine.item),
        )
        .filter(SalesOrder.id == payload.sales_order_id)
    )
    so = so_result.scalars().first()
    if not so:
        raise HTTPException(status_code=404, detail="Sales order not found")
    # Allow picking partially-produced orders: ship whatever finished stock exists
    # now, even before the whole order target is met. Stock availability (enforced
    # at dispatch) is the real guard, not SO completion status.
    if so.status in ("SENT", "DELIVERED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Cannot pick a {so.status} order")

    # Packing comes first: a pick list picks cartons, so there is nothing to pick
    # until a packing order has minted some. Checked before the pick list row is
    # written so an order with nothing packed never leaves an empty DRAFT behind.
    remaining_now = await _remaining_by_so_line(db, so)
    taken_now = await packing_service.allocated_unit_ids(db)
    has_cartons = False
    for so_line in so.lines:
        if remaining_now.get(str(so_line.id), 0.0) <= 0:
            continue
        units = await packing_service.available_packed_units(
            db, so_line.item_id,
            location_id=payload.source_location_id,
            attribute_value_ids=[str(v.id) for v in (so_line.attribute_values or [])],
            color_id=so_line.color_id,
            exclude_ids=taken_now,
            # No limit=1: available_packed_units applies the SQL limit before
            # filtering exclude_ids, so a low limit full of already-allocated
            # cartons would read as "nothing packed".
        )
        if units:
            has_cartons = True
            break
    if not has_cartons:
        raise HTTPException(
            status_code=400,
            detail=(
                "Nothing packed for this order yet — create a packing order and log "
                "cartons against it before picking."
            ),
        )

    code = await _next_code(db)
    pl = PickList(
        code=code,
        sales_order_id=so.id,
        source_location_id=payload.source_location_id,
        status="DRAFT",
        created_by_id=current_user.id,
    )
    db.add(pl)
    await db.flush()

    if payload.lines:
        for l in payload.lines:
            db.add(PickListLine(
                pick_list_id=pl.id,
                sales_order_line_id=l.sales_order_line_id,
                item_id=l.item_id,
                qty_picked=l.qty_picked,
                source_location_id=l.source_location_id,
                batch_id=l.batch_id,
            ))
    else:
        for line in await _suggest_lines(db, pl, so):
            db.add(line)

    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE", entity_type="PickList",
        entity_id=str(pl.id), details=f"Created pick list {code} for SO {so.po_number}",
    )
    try:
        await manager.broadcast({"type": "PICK_LIST_UPDATE", "id": str(pl.id)})
    except Exception:
        pass

    pl = await _load(db, pl.id)
    return (await _decorate_all(db, [pl]))[0]


@router.put("/{pl_id}", response_model=PickListResponse)
async def update_pick_list(
    pl_id: uuid.UUID,
    payload: PickListUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    pl = await _load(db, pl_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Pick list not found")
    if pl.status in ("DISPATCHED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {pl.status} pick list")
    # Once loaded onto a shipment the contents are what a checker is counting
    # against a printed note — take it off the shipment first.
    if pl.shipment_id:
        raise HTTPException(
            status_code=400,
            detail=f"Pick list is staged on shipment {pl.shipment.code if pl.shipment else ''} — unload it there first",
        )

    # Scalar header fields. Surat Jalan fields are absent by design: they live on
    # the Shipment now (see models/shipment.py).
    for field in ("source_location_id", "status", "notes"):
        val = getattr(payload, field)
        if val is not None:
            setattr(pl, field, val)

    if payload.qc_passed is not None:
        pl.qc_passed = payload.qc_passed
        if payload.qc_passed:
            pl.qc_at = datetime.utcnow()
            pl.qc_inspector = payload.qc_inspector
        else:
            pl.qc_at = None
            pl.qc_inspector = None
    elif payload.qc_inspector is not None:
        pl.qc_inspector = payload.qc_inspector

    # Rebuild lines. Scan confirmations are carried across the rebuild by carton:
    # the editor saves before dispatching, and dropping picked_at here would make
    # dispatch reject every carton the floor had already scanned.
    if payload.lines is not None:
        confirmed = {
            str(old.batch_id): (old.picked_at, old.picked_by)
            for old in pl.lines if old.batch_id and old.picked_at
        }
        for old in list(pl.lines):
            await db.delete(old)
        await db.flush()
        for l in payload.lines:
            picked_at, picked_by = confirmed.get(str(l.batch_id), (None, None)) if l.batch_id else (None, None)
            db.add(PickListLine(
                pick_list_id=pl.id,
                sales_order_line_id=l.sales_order_line_id,
                item_id=l.item_id,
                qty_picked=l.qty_picked,
                source_location_id=l.source_location_id,
                batch_id=l.batch_id,
                picked_at=picked_at,
                picked_by=picked_by,
            ))

    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="UPDATE", entity_type="PickList",
        entity_id=str(pl.id), details=f"Updated pick list {pl.code}",
    )

    pl = await _load(db, pl_id)
    return (await _decorate_all(db, [pl]))[0]


@router.post("/{pl_id}/scan", response_model=PickListResponse)
async def scan_pick_list_unit(
    pl_id: uuid.UUID,
    payload: PickListScanPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('pick_list.scan', 'sales.manage')),
):
    """Picker scanned a carton QR.

    Confirms the matching suggested line when one exists; otherwise appends the
    carton to the first SO line that ordered the same item. The scan is what
    turns a *suggested* pick into a *confirmed* one — a plan the floor never
    confirmed must not dispatch.

    The narrow `pick_list.scan` code exists because this is the one pick-list
    action a floor picker performs. Gating it on `sales.manage` like the rest of
    the router would hand every picker create, edit, dispatch and delete on the
    whole sales module. `sales.manage` still passes so existing roles keep working.
    """
    pl = await _load(db, pl_id)
    if not pl:
        raise HTTPException(status_code=404, detail="Pick list not found")
    if pl.status in ("DISPATCHED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Pick list already {pl.status}")

    code = (payload.code or "").strip()
    pu_result = await db.execute(select(Batch).filter(Batch.batch_number == code))
    pu = pu_result.scalars().first()
    if not pu:
        raise HTTPException(status_code=404, detail=f"No lot or carton found for '{code}'")
    if not packing_service.is_packed_unit(pu):
        raise HTTPException(status_code=400, detail=f"{code} is not a packed carton")
    if pu.quality_status != "GOOD":
        raise HTTPException(status_code=400, detail=f"Carton {code} is {pu.quality_status}")

    picked_by = payload.picked_by or current_user.username
    line = next((l for l in pl.lines if l.batch_id == pu.id), None)

    if line is None:
        # Not suggested — claim it for an SO line ordering this item, if the
        # carton is not already committed to another live pick list.
        taken = await packing_service.allocated_unit_ids(db)
        if pu.id in taken:
            raise HTTPException(status_code=400, detail=f"Carton {code} is already on another pick list")
        so_result = await db.execute(
            select(SalesOrder).options(selectinload(SalesOrder.lines)).filter(SalesOrder.id == pl.sales_order_id)
        )
        so = so_result.scalars().first()
        target = next((sl for sl in (so.lines if so else []) if sl.item_id == pu.item_id), None)
        if not target:
            raise HTTPException(status_code=400, detail=f"Carton {code} is not an item on this sales order")
        loc = await _unit_location(db, pu)
        qty = 0.0
        if loc:
            qty = await stock_service.get_stock_balance(db, pu.item_id, loc, [], str(pu.id))
        line = PickListLine(
            pick_list_id=pl.id,
            sales_order_line_id=target.id,
            item_id=pu.item_id,
            qty_picked=qty,
            source_location_id=loc,
            batch_id=pu.id,
        )
        db.add(line)

    line.picked_at = datetime.utcnow()
    line.picked_by = picked_by
    if pl.status == "DRAFT":
        pl.status = "PICKING"
    await db.flush()

    # All cartons confirmed -> ready for QC / dispatch. Re-read the lines rather
    # than using pl.lines: a line appended above sets pick_list_id directly, which
    # does not back-populate the already-loaded collection, so the stale copy
    # would miss it and flip the list to PICKED one carton early.
    remaining = await db.execute(
        select(func.count(PickListLine.id)).filter(
            PickListLine.pick_list_id == pl.id,
            PickListLine.batch_id.isnot(None),
            PickListLine.picked_at.is_(None),
        )
    )
    if (remaining.scalar() or 0) == 0:
        pl.status = "PICKED"

    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="PICK", entity_type="PickList",
        entity_id=str(pl_id), details=f"Scanned carton {code} onto pick list {pl.code}",
    )

    pl = await _load(db, pl_id)
    return (await _decorate_all(db, [pl]))[0]


# NOTE: `POST /pick-lists/{id}/dispatch` was removed when the loading-deck gate
# was added. A pick list is an internal instruction and ends at PICKED; goods
# issue now runs from `POST /shipments/{id}/dispatch`, after a second person has
# checked the load against the printed Surat Jalan. Leaving a direct route open
# here would have left the four-eyes control bypassable by one HTTP call. The
# stock-out logic itself lives in `services/dispatch_service.py`.


@router.delete("/{pl_id}")
async def delete_pick_list(
    pl_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    result = await db.execute(select(PickList).filter(PickList.id == pl_id))
    pl = result.scalars().first()
    if not pl:
        raise HTTPException(status_code=404, detail="Pick list not found")
    if pl.status == "DISPATCHED":
        raise HTTPException(status_code=400, detail="Cannot delete a dispatched pick list")

    code = pl.code
    await db.delete(pl)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE", entity_type="PickList",
        entity_id=str(pl_id), details=f"Deleted pick list {code}",
    )
    return {"ok": True}
