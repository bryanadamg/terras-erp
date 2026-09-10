from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast, String, nulls_last, inspect as sa_inspect
from sqlalchemy.orm import selectinload, aliased
from typing import Optional
from datetime import datetime
import uuid

from app.db.session import get_async_db
from app.schemas import (
    PackingOrderCreate, PackingOrderUpdate, PackingOrderResponse, PackingOrderListResponse,
    PackingCompletionCreate, PackedUnitResponse, PackingCompletionLotPayload,
    PackingCompletionReject,
)
from app.models.packing import (
    PackingOrder, PackingOrderMaterial, PackingCompletion, PackingCompletionMaterial,
)
from app.models.batch import Batch
from app.models.item import Item
from app.models.location import Location
from app.models.attribute import AttributeValue
from app.models.sales import SalesOrder, SalesOrderLine
from app.models.stock_balance import StockBalance
from app.models.routing import WorkCenter
from app.models.uom import UOM, UOMFactor
from app.api.auth import get_current_user, require_permission
from app.models.auth import User
from app.services import (
    audit_service, kpi_service, stock_service, packing_service, so_fulfilment_service,
    reject_service, quarantine_service, numbering_service,
)
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow

router = APIRouter(prefix="/packing", tags=["packing"])


# --- helpers ---------------------------------------------------------------

def _load_options():
    return (
        selectinload(PackingOrder.sales_order),
        selectinload(PackingOrder.sales_order_line),
        selectinload(PackingOrder.item),
        selectinload(PackingOrder.attribute_values),
        selectinload(PackingOrder.materials).selectinload(PackingOrderMaterial.item),
        selectinload(PackingOrder.completions).selectinload(PackingCompletion.source_batch),
        selectinload(PackingOrder.completions).selectinload(PackingCompletion.work_center),
        selectinload(PackingOrder.work_center),
        selectinload(PackingOrder.completions)
        .selectinload(PackingCompletion.materials)
        .selectinload(PackingCompletionMaterial.item),
        # `qty_packed_alt` sums these, and it is the DELIVERED gate — without the
        # eager load the property silently reads an empty list in async and every
        # alt-unit order looks 0 packed. Never drop it from this tuple.
        selectinload(PackingOrder.cartons),
    )


async def _load(db: AsyncSession, po_id) -> Optional[PackingOrder]:
    # expire_on_commit=False keeps stale collections on an instance already in the
    # identity map; expire first so lines/completions repopulate post-commit.
    db.expire_all()
    result = await db.execute(
        select(PackingOrder).options(*_load_options()).filter(PackingOrder.id == po_id)
    )
    return result.scalars().first()


def _pu_response(b, bal, po_code=None, loc_name=None, variant=None) -> PackedUnitResponse:
    """Build one carton's response — the ONE place a PackedUnit is serialized.

    Three endpoints hand back cartons (the order detail, the carton list, the
    scanner lookup) and a carton's identity is assembled from three sources: the
    Batch row (number, package no, weight, size), its StockBalance row (qty,
    location, variant_key) and the resolved display names for that key. Three
    hand-rolled constructors is how a carton ended up labelled with its size in
    one screen and not in the next.
    """
    v = variant or {}
    return PackedUnitResponse(
        id=b.id,
        batch_number=b.batch_number,
        item_id=b.item_id,
        item_name=b.item.name if b.item else None,
        item_code=b.item.code if b.item else None,
        package_no=b.package_no,
        package_label=b.package_label,
        weight_kg=float(b.weight_kg) if b.weight_kg is not None else None,
        alt_qty=float(b.alt_qty) if b.alt_qty is not None else None,
        # Packaging + brutto. The name comes through the relationship (eager, see
        # models/batch.py) but the tare and gross are read off the carton's own
        # columns — the snapshot, not whatever the master says today.
        packaging_type_id=b.packaging_type_id,
        packaging_type_name=b.packaging_type.name if b.packaging_type else None,
        packaging_type_code=b.packaging_type.code if b.packaging_type else None,
        tare_kg=float(b.tare_kg) if b.tare_kg is not None else None,
        gross_weight_kg=float(b.gross_weight_kg) if b.gross_weight_kg is not None else None,
        qty=float(bal.qty) if bal else 0.0,
        location_id=bal.location_id if bal else None,
        location_name=loc_name,
        packing_order_id=b.packing_order_id,
        packing_order_code=po_code,
        packing_completion_id=b.packing_completion_id,
        packed_for_so_id=b.packed_for_so_id,
        quality_status=b.quality_status,
        created_at=b.created_at,
        # Shade/combo/attributes come from the carton's own stock key; size from
        # the Batch row it was stamped with at mint. See PackedUnitResponse.
        variant_key=(bal.variant_key if bal else None) or None,
        variant_attributes=v.get("variant_attributes") or None,
        color_id=v.get("color_id"),
        color_name=v.get("color_name"),
        color_code=v.get("color_code"),
        color_hex=v.get("color_hex"),
        bom_size_id=b.bom_size_id,
        bom_size_snapshot=b.bom_size_snapshot,
        size_label=stock_service._bom_size_label(b.bom_size_snapshot),
    )


async def _packed_units_for(db: AsyncSession, po_ids: list) -> dict:
    """Cartons minted by each packing order, with live qty from StockBalance.

    One query for the whole page rather than per order — the list endpoint shows
    carton counts, so an N+1 here would scale with page size.
    """
    if not po_ids:
        return {}
    result = await db.execute(
        select(Batch, StockBalance)
        .outerjoin(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
        .options(selectinload(Batch.item))
        .filter(Batch.packing_order_id.in_(po_ids))
        # qty desc so the carton's live balance row wins the per-batch dedupe below
        # over any zeroed leftover row from an earlier location.
        .order_by(Batch.package_no.asc(), nulls_last(StockBalance.qty.desc()))
    )
    rows = []
    seen = set()
    for batch, bal in result.all():
        # One row per carton: the outerjoin can match several balance rows for a
        # batch that has been moved, and the positive one sorts first.
        if batch.id in seen:
            continue
        seen.add(batch.id)
        rows.append((batch, bal))

    # One resolve for the whole page — a carton's shade/combo lives in its stock
    # key, and a per-carton lookup here would scale with page size.
    variants = await stock_service.describe_variant_keys(
        db, {bal.variant_key for _, bal in rows if bal and bal.variant_key}
    )

    out: dict = {}
    for batch, bal in rows:
        out.setdefault(str(batch.packing_order_id), []).append(
            _pu_response(batch, bal, variant=variants.get(bal.variant_key if bal else None))
        )
    return out


def _decorate(po: PackingOrder, units: list = None) -> PackingOrder:
    """Attach non-column display fields the response schema expects."""
    if po.sales_order:
        po.sales_order_code = po.sales_order.po_number
        po.customer_po_ref = po.sales_order.customer_po_ref
        po.customer_name = po.sales_order.customer_name
    # The alt unit is the order's OWN snapshot, taken from the SO line at create
    # time (and backfilled onto pre-existing orders by the migration that added
    # the columns). Deliberately not read through to the line here: assigning to
    # a real column while decorating a response is a silent write waiting for the
    # next commit in the request, and an SO edited mid-run must not re-scale
    # cartons already minted.
    if po.sales_order_line:
        po.ket_stock = po.sales_order_line.ket_stock
    # Resolved base-UOM qty per alt unit — served, not left to the client, so the
    # pack screens, the labels and this API agree on one conversion.
    po.uom2_base_factor = packing_service.order_base_per_alt(po)
    po.color_name = po.color.name if po.color else None
    po.color_code = po.color.code if po.color else None
    po.color_hex = po.color.hex if po.color else None
    po.attribute_value_ids = [v.id for v in (po.attribute_values or [])]
    # Same key StockBalance rows are written under, so the lot picker can match a
    # lot's shade against the order's without restating the folding rules.
    po.variant_key = stock_service._generate_variant_key(
        [str(v.id) for v in (po.attribute_values or [])], po.color_id
    )
    # qty_consumed on each planned material rolls up from what completions used.
    consumed: dict = {}
    for c in (po.completions or []):
        for m in (c.materials or []):
            consumed[str(m.item_id)] = consumed.get(str(m.item_id), 0.0) + float(m.qty or 0)
    for m in (po.materials or []):
        m.qty_consumed = consumed.get(str(m.item_id), 0.0)
    po.packed_units = units or []
    # `qty_packed_alt` is a model property (counted off `cartons`), not assigned
    # here — one definition, shared with the DELIVERED gate. It still has to be
    # declared on PackingOrderResponse or response_model drops it silently.
    return po


async def _next_code(db: AsyncSession) -> str:
    """Next `PCK-NNNNN` off the packing-order number range.

    max(code)+1 raced: two packers creating orders at once read the same maximum
    and minted the same code. The range row serializes the allocation; the seed
    below only runs once, to continue from codes that predate it."""
    async def _seed() -> int:
        # func.max() on the code column is a STRING max, so a code not zero-padded
        # to the current width can outrank the real numeric max (e.g. "PCK-003" >
        # "PCK-00144" lexicographically). Parse every candidate, take the numeric max.
        codes = (await db.execute(select(PackingOrder.code))).scalars().all()
        best = 0
        for c in codes:
            if c and c.startswith("PCK-"):
                try:
                    best = max(best, int(c.split("-", 1)[1]))
                except (ValueError, IndexError):
                    continue
        return best

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(PackingOrder.id).filter(PackingOrder.code == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, "PACKING_ORDER", lambda n: f"PCK-{n:05d}", seed=_seed, exists=_taken,
    )
    return code


async def _set_attributes(db: AsyncSession, po: PackingOrder, ids: list) -> None:
    if ids is None:
        return
    # Assigning to a relationship collection makes SQLAlchemy load the existing one
    # to diff old against new — a lazy load, which raises MissingGreenlet on an
    # async session. A just-flushed PackingOrder never has it loaded, so populate
    # it explicitly first. (Already-loaded instances from _load skip the refresh.)
    if "attribute_values" in sa_inspect(po).unloaded:
        await db.refresh(po, ["attribute_values"])
    if not ids:
        po.attribute_values = []
        return
    result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(ids)))
    po.attribute_values = list(result.scalars().all())


async def _resolve_length_uom(db: AsyncSession, uom_name: Optional[str], factor: Optional[float]) -> Optional[str]:
    """Which length unit a `1 <uom2> = <factor> ?` conversion is expressed in.

    Read off the UOM master's own factor rows (`Roll -> Yard = 50`). Resolved once
    here and stored on the order, because the alternative — recovering it at read
    time by matching the factor VALUE back against those rows, which is what the
    SO form does — falls back to yard whenever the match misses and turns a
    metre-based recipe into a 9% error. Ambiguous only if one UOM has two factor
    rows of the same value, in which case either answer is the same number.
    """
    if not uom_name or not factor:
        return None
    from_uom = aliased(UOM)
    to_uom = aliased(UOM)
    return (await db.execute(
        select(to_uom.name)
        .select_from(UOMFactor)
        .join(from_uom, from_uom.id == UOMFactor.from_uom_id)
        .join(to_uom, to_uom.id == UOMFactor.to_uom_id)
        .filter(
            func.lower(from_uom.name) == uom_name.strip().lower(),
            UOMFactor.value == factor,
        )
        .limit(1)
    )).scalars().first()


async def _apply_alt_unit(
    db: AsyncSession,
    po: PackingOrder,
    payload,
    so_line: Optional[SalesOrderLine] = None,
    item: Optional[Item] = None,
) -> None:
    """Set the order's alt selling unit, and restate `qty_target` from it.

    The alt unit follows the sales order: when the caller states none and the
    order packs against an SO line, the line's own `uom2`/`uom2_factor` are
    snapshotted (not read through live — an SO edited after packing started must
    not silently re-scale cartons already minted). A pack-to-stock order simply
    states its own.

    **The alt count IS the target** on an order that carries one. The customer
    ordered 2880 pieces and the packer boxes 2880 pieces, so that count is what
    the order is measured against (`packing_service.is_target_met` counts them);
    `qty_target` is only the same quantity restated in the item's stock UOM,
    estimated through the item's g/y so stock moves have a figure to work in. The
    weight that actually leaves stock is read off the scale at each pack event and
    deducted from the picked lot, so a base target stated beside a count is
    *discarded* rather than allowed to contradict it — a planner typing the piece
    count into the kg field is the common case, and both figures then read 50.
    Only an order with no alt count keeps a hand-entered base figure.
    """
    stated = payload.uom2 or payload.uom2_factor or payload.qty2
    if not stated and so_line is not None:
        po.uom2 = so_line.uom2
        po.uom2_factor = float(so_line.uom2_factor) if so_line.uom2_factor is not None else None
    else:
        if payload.uom2 is not None:
            po.uom2 = payload.uom2 or None
        if payload.uom2_factor is not None:
            po.uom2_factor = payload.uom2_factor
        if payload.qty2 is not None:
            po.qty2 = payload.qty2

    if payload.uom2_length_uom:
        po.uom2_length_uom = payload.uom2_length_uom
    elif po.uom2 and po.uom2_factor:
        po.uom2_length_uom = await _resolve_length_uom(db, po.uom2, po.uom2_factor)

    # The box size follows the same rule as the target: a stated count of pieces
    # per carton is what the floor packs to, `pack_size` its weight estimate.
    _sync_pack_size_to_alt(po, item)

    if float(po.qty2 or 0) > 0 and _sync_target_to_alt(po, item) is None:
        # No honest conversion (a gsm weight needs the fabric width, a counted
        # stock UOM has no length at all). A base target stated by hand is then
        # all there is to work stock in; with neither there is no figure at all,
        # and a 400 beats inventing one.
        if float(po.qty_target or 0) <= 0:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot convert {po.qty2} {po.uom2} into {getattr(item, 'uom', None) or 'the stock unit'} — "
                    "set a conversion factor on the unit, or a g/y or g/m weight on the item"
                ),
            )


def _sync_pack_size_to_alt(po: PackingOrder, item=None) -> Optional[float]:
    """`pack_size` restated from `pack_size_alt` — the box size in pieces.

    Same relationship as `qty_target` to `qty2`, one level down: the carton holds
    a stated number of pieces and `pack_size` is only what those weigh in theory.
    Kept in sync so every screen that still reads the base figure (the Kartu
    Packing's "Isi per koli", the legacy mobile seed) shows the right estimate
    instead of a stale one.
    """
    if float(po.pack_size_alt or 0) <= 0:
        return None
    derived = packing_service.alt_to_base(
        float(po.pack_size_alt), packing_service.order_base_per_alt(po, item))
    if derived is None or derived <= 0:
        return None
    po.pack_size = derived
    return derived


def _sync_target_to_alt(po: PackingOrder, item=None) -> Optional[float]:
    """Restate `qty_target` from the order's own alt count, returning the figure.

    None means there was nothing to restate from — no alt count, or a conversion
    the item's weight spec can't resolve — and `qty_target` is left untouched.
    The alt count always wins where it resolves; see `_apply_alt_unit`.
    """
    if float(po.qty2 or 0) <= 0:
        return None
    base_factor = packing_service.order_base_per_alt(po, item)
    derived = packing_service.alt_to_base(float(po.qty2), base_factor)
    if derived is None or derived <= 0:
        return None
    po.qty_target = derived
    return derived


# Weight units a length can be turned into a weight from. `gsm` / `g/m²` need the
# fabric width, so they are refused here rather than silently producing a figure
# wrong by that width — the same refusal `packing_service.base_per_alt` makes.
SAMPLE_WEIGHT_UNITS = ("g/y", "g/m")


def _clean_basis(value: str | None) -> str:
    """'WEIGHED' or 'COUNTED' — anything else is the counted default.

    Rejecting an unknown string would fail a create over a typo in a field most
    callers never send; the fallback is the behaviour every order had before the
    column existed.
    """
    return "WEIGHED" if (value or "").strip().upper() == "WEIGHED" else "COUNTED"


def _apply_sample_weight(po: PackingOrder, payload) -> None:
    """Set the order's own sampled unit weight from a create/update payload.

    Both halves move together: clearing the figure clears the unit, so an order
    can never carry a unit with nothing to apply it to. A blank figure means
    "not sampled" and the item master's estimate takes over again.
    """
    if getattr(payload, "sample_weight_per_unit", None) is None and             getattr(payload, "sample_weight_unit", None) is None:
        return
    per_unit = payload.sample_weight_per_unit
    unit = (payload.sample_weight_unit or "").strip().lower() or None
    if per_unit is not None and float(per_unit) > 0:
        if unit not in SAMPLE_WEIGHT_UNITS:
            raise HTTPException(
                status_code=400,
                detail=f"Sampled weight unit must be one of {', '.join(SAMPLE_WEIGHT_UNITS)}",
            )
        po.sample_weight_per_unit = float(per_unit)
        po.sample_weight_unit = unit
    else:
        po.sample_weight_per_unit = None
        po.sample_weight_unit = None


async def _assert_work_center(db: AsyncSession, wc_id) -> None:
    """A named machine must exist. Deliberately not restricted to `node_type ==
    MACHINE`: a packing order may be dispatched to a GROUP/TYPE row before the
    planner knows which machine runs it, exactly as a WO can be."""
    if not wc_id:
        return
    wc = (await db.execute(select(WorkCenter).filter(WorkCenter.id == wc_id))).scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")


# --- packed units (cartons) ------------------------------------------------
# Declared before /{po_id} so "packed-units" is never swallowed as an order id.

@router.get("/packed-units", response_model=list[PackedUnitResponse])
async def list_packed_units(
    item_id: Optional[uuid.UUID] = None,
    location_id: Optional[uuid.UUID] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    in_stock_only: bool = True,
    limit: int = Query(200, le=1000),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    query = (
        select(Batch, StockBalance, PackingOrder.code)
        .outerjoin(StockBalance, StockBalance.batch_key == cast(Batch.id, String))
        .outerjoin(PackingOrder, PackingOrder.id == Batch.packing_order_id)
        .options(selectinload(Batch.item))
        .filter(packing_service.packed_unit_filter())
        .order_by(Batch.created_at.desc())
        .limit(limit)
    )
    if item_id:
        query = query.filter(Batch.item_id == item_id)
    if sales_order_id:
        query = query.filter(Batch.packed_for_so_id == sales_order_id)
    if location_id:
        query = query.filter(StockBalance.location_id == location_id)
    if in_stock_only:
        query = query.filter(StockBalance.qty > 0)

    rows = (await db.execute(query)).all()
    # Same per-carton dedupe as _packed_units_for — the balance outerjoin can match
    # more than one row for a batch that has been moved between locations.
    seen = set()
    rows = [r for r in rows if not (r[0].id in seen or seen.add(r[0].id))]
    loc_ids = {bal.location_id for _, bal, _ in rows if bal and bal.location_id}
    loc_names: dict = {}
    if loc_ids:
        locs = await db.execute(select(Location.id, Location.name).filter(Location.id.in_(loc_ids)))
        loc_names = {lid: name for lid, name in locs.all()}

    variants = await stock_service.describe_variant_keys(
        db, {bal.variant_key for _, bal, _ in rows if bal and bal.variant_key}
    )

    return [
        _pu_response(
            b, bal, po_code=po_code,
            loc_name=loc_names.get(bal.location_id) if bal else None,
            variant=variants.get(bal.variant_key if bal else None),
        )
        for b, bal, po_code in rows
    ]


@router.get("/packed-units/resolve", response_model=PackedUnitResponse)
async def resolve_packed_unit(
    code: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Scanner lookup: PU-YYYYMMDD-NNNN -> the carton it names."""
    result = await db.execute(
        select(Batch).options(selectinload(Batch.item)).filter(Batch.batch_number == code.strip())
    )
    b = result.scalars().first()
    if not b:
        raise HTTPException(status_code=404, detail=f"No carton found for '{code}'")
    if not packing_service.is_packed_unit(b):
        raise HTTPException(status_code=400, detail=f"{code} is a lot, not a packed carton")

    bal_result = await db.execute(
        select(StockBalance).filter(StockBalance.batch_key == str(b.id), StockBalance.qty > 0).limit(1)
    )
    bal = bal_result.scalars().first()
    po_code = None
    if b.packing_order_id:
        po_code = (await db.execute(
            select(PackingOrder.code).filter(PackingOrder.id == b.packing_order_id)
        )).scalar()
    loc_name = None
    if bal:
        loc_name = (await db.execute(
            select(Location.name).filter(Location.id == bal.location_id)
        )).scalar()

    variants = await stock_service.describe_variant_keys(
        db, [bal.variant_key] if bal and bal.variant_key else []
    )

    return _pu_response(
        b, bal, po_code=po_code, loc_name=loc_name,
        variant=variants.get(bal.variant_key if bal else None),
    )


# --- packing orders --------------------------------------------------------

@router.get("", response_model=PackingOrderListResponse)
async def list_packing_orders(
    status: Optional[str] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    item_id: Optional[uuid.UUID] = None,
    window: PageWindow = Depends(PageParams(default_size=100)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    query = select(PackingOrder).options(*_load_options())
    count_query = select(func.count(PackingOrder.id))
    if status:
        query = query.filter(PackingOrder.status == status)
        count_query = count_query.filter(PackingOrder.status == status)
    if sales_order_id:
        query = query.filter(PackingOrder.sales_order_id == sales_order_id)
        count_query = count_query.filter(PackingOrder.sales_order_id == sales_order_id)
    if item_id:
        query = query.filter(PackingOrder.item_id == item_id)
        count_query = count_query.filter(PackingOrder.item_id == item_id)

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(window.apply(query.order_by(PackingOrder.created_at.desc())))
    orders = list(result.scalars().all())
    units = await _packed_units_for(db, [o.id for o in orders])
    for po in orders:
        _decorate(po, units.get(str(po.id), []))
    return window.envelope(orders, total)


@router.get("/{po_id}", response_model=PackingOrderResponse)
async def get_packing_order(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    po = await _load(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    units = await _packed_units_for(db, [po.id])
    return _decorate(po, units.get(str(po.id), []))


@router.post("", response_model=PackingOrderResponse)
async def create_packing_order(
    payload: PackingOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    item = (await db.execute(select(Item).filter(Item.id == payload.item_id))).scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if payload.sales_order_id:
        so = (await db.execute(
            select(SalesOrder).filter(SalesOrder.id == payload.sales_order_id)
        )).scalars().first()
        if not so:
            raise HTTPException(status_code=404, detail="Sales order not found")
    await _assert_work_center(db, payload.work_center_id)

    # Loaded once: the line supplies the variant identity, the alt selling unit
    # this order counts in, and — when the caller states no quantity at all — the
    # ordered qty itself. Loaded BEFORE the zero-qty gate for that last reason.
    so_line = None
    if payload.sales_order_line_id:
        so_line = (await db.execute(
            select(SalesOrderLine)
            .options(selectinload(SalesOrderLine.attribute_values))
            .filter(SalesOrderLine.id == payload.sales_order_line_id)
        )).scalars().first()
    if (float(payload.qty_target or 0) <= 0 and float(payload.qty2 or 0) <= 0
            and so_line is None):
        raise HTTPException(status_code=400, detail="Target quantity must be greater than zero")

    code = await _next_code(db)
    po = PackingOrder(
        code=code,
        sales_order_id=payload.sales_order_id,
        sales_order_line_id=payload.sales_order_line_id,
        item_id=payload.item_id,
        color_id=payload.color_id,
        qty_target=payload.qty_target,
        pack_size=payload.pack_size,
        pack_size_alt=payload.pack_size_alt,
        package_label=payload.package_label or "Carton",
        pack_basis=_clean_basis(payload.pack_basis),
        source_location_id=payload.source_location_id,
        output_location_id=payload.output_location_id,
        work_center_id=payload.work_center_id,
        status="PENDING",
        target_start_date=payload.target_start_date,
        target_end_date=payload.target_end_date,
        notes=payload.notes,
        created_by_id=current_user.id,
    )
    # The operator's sampled g/y, BEFORE the alt unit is applied: every figure
    # `_apply_alt_unit` derives (the kg target, the box-size estimate) converts
    # through it, so setting it afterwards would leave both computed against the
    # item's estimate.
    _apply_sample_weight(po, payload)
    # Alt selling unit + (when the caller sent only an alt count) the base target.
    # Before the flush so `qty_target` is never written as 0 and then corrected.
    await _apply_alt_unit(db, po, payload, so_line=so_line, item=item)
    # Last resort: the ordered qty of the line being packed. Restated into the
    # item's stock UOM rather than taken raw — `SalesOrderLine.qty` is in yards.
    if float(po.qty_target or 0) <= 0 and so_line is not None:
        po.qty_target = so_fulfilment_service.ordered_qty_in_stock_uom(
            so_line.qty, item.uom,
            qty_kg=so_line.qty_kg,
            weight_per_unit=item.weight_per_unit,
            weight_unit=item.weight_unit,
        )
    if float(po.qty_target or 0) <= 0:
        raise HTTPException(status_code=400, detail="Target quantity must be greater than zero")

    db.add(po)
    await db.flush()

    # Variant identity: inherit from the SO line when packing to order and the
    # caller did not state it. The carton's stock key must match the bulk FG it
    # is packed from, so guessing wrong here would mint cartons into an empty
    # variant pool while the real stock sits untouched.
    attr_ids = list(payload.attribute_value_ids)
    if so_line is not None and not attr_ids:
        attr_ids = [v.id for v in (so_line.attribute_values or [])]
        if not po.color_id:
            po.color_id = so_line.color_id
    await _set_attributes(db, po, attr_ids)

    for m in payload.materials:
        db.add(PackingOrderMaterial(
            packing_order_id=po.id,
            item_id=m.item_id,
            qty_planned=m.qty_planned,
            location_id=m.location_id,
            notes=m.notes,
        ))

    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE", entity_type="PackingOrder",
        entity_id=str(po.id), details=f"Created packing order {code} for {item.code}",
    )
    try:
        await manager.broadcast({"type": "PACKING_UPDATE", "id": str(po.id)})
        # A new open order claims this (item, source location) for Quarantine
        # Packing's lock — same "changes what's packable" reasoning as a
        # quarantine disposition, so it rides the same 'stock' WS kind.
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass

    po = await _load(db, po.id)
    return _decorate(po)


@router.put("/{po_id}", response_model=PackingOrderResponse)
async def update_packing_order(
    po_id: uuid.UUID,
    payload: PackingOrderUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    po = await _load(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    if po.status in ("COMPLETED", "CANCELLED") and payload.status not in ("IN_PROGRESS", "PENDING"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {po.status} packing order")

    await _assert_work_center(db, payload.work_center_id)

    if payload.pack_basis is not None:
        po.pack_basis = _clean_basis(payload.pack_basis)

    for field in ("qty_target", "sales_order_id", "sales_order_line_id", "color_id",
                  "pack_size", "pack_size_alt", "package_label",
                  "source_location_id", "output_location_id",
                  "work_center_id", "status", "target_start_date", "target_end_date", "notes"):
        val = getattr(payload, field)
        if val is not None:
            setattr(po, field, val)

    # Re-sampling changes what a piece weighs, so it is applied before anything
    # derived from it is restated below.
    sampled_before = (po.sample_weight_per_unit, po.sample_weight_unit)
    _apply_sample_weight(po, payload)
    resampled = (po.sample_weight_per_unit, po.sample_weight_unit) != sampled_before

    # Alt unit edits re-resolve the length unit and restate the base target off
    # the count. No SO line is passed: an edit states what it means rather than
    # silently re-snapshotting a line that may have moved on since the order was
    # created.
    if any(getattr(payload, f) is not None
           for f in ("qty2", "uom2", "uom2_factor", "uom2_length_uom")):
        await _apply_alt_unit(db, po, payload, item=po.item)
    elif resampled:
        # A new basis with no other alt edit: the kg target and the box-size
        # estimate are both restatements of counts the order already carries, so
        # they follow the new figure. Nothing already packed moves — a carton's
        # weight is a scale reading and its count is what the packer counted.
        _sync_target_to_alt(po, po.item)
        _sync_pack_size_to_alt(po, po.item)
    elif payload.qty_target is not None or payload.pack_size_alt is not None:
        # A base target restated on its own is only an estimate of the count the
        # order already carries, so it is re-derived rather than kept — otherwise
        # the edit path is the way to leave the two contradicting each other. An
        # order with no alt count keeps whatever was sent. Same for the box size:
        # a new count of pieces per carton restates its weight.
        if payload.qty_target is not None:
            _sync_target_to_alt(po, po.item)
        if payload.pack_size_alt is not None:
            _sync_pack_size_to_alt(po, po.item)

    if payload.status == "COMPLETED" and not po.actual_end_date:
        po.actual_end_date = datetime.utcnow()

    # Editing the target moves the fulfilled line, so DELIVERED has to follow it
    # both ways: raise the target past what is packed and the order owes work
    # again (and quarantine's claim, which is the open quantity, comes back with
    # it); lower it back and it is fulfilled again. Never touches COMPLETED or
    # CANCELLED — those are the user's explicit closure, not a function of qty —
    # and never overrides a status the caller stated itself.
    if payload.status is None:
        met = packing_service.is_target_met(po)
        if po.status == "DELIVERED" and not met:
            po.status = "IN_PROGRESS"
            po.actual_end_date = None
        elif po.status in ("PENDING", "IN_PROGRESS") and met:
            po.status = "DELIVERED"
            po.actual_end_date = po.actual_end_date or datetime.utcnow()

    if payload.attribute_value_ids is not None:
        await _set_attributes(db, po, payload.attribute_value_ids)

    if payload.materials is not None:
        for old in list(po.materials):
            await db.delete(old)
        await db.flush()
        for m in payload.materials:
            db.add(PackingOrderMaterial(
                packing_order_id=po.id,
                item_id=m.item_id,
                qty_planned=m.qty_planned,
                location_id=m.location_id,
                notes=m.notes,
            ))

    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="UPDATE", entity_type="PackingOrder",
        entity_id=str(po.id), details=f"Updated packing order {po.code}",
    )
    try:
        await manager.broadcast({"type": "PACKING_UPDATE", "id": str(po.id)})
        # Status/qty/location edits (cancelling included) change whether this
        # order still claims its (item, source location) — see the create path.
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass

    po = await _load(db, po_id)
    units = await _packed_units_for(db, [po.id])
    return _decorate(po, units.get(str(po.id), []))


@router.post("/{po_id}/complete", response_model=PackingOrderResponse)
async def add_packing_completion(
    po_id: uuid.UUID,
    payload: PackingCompletionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    """Log one pack event: consume bulk FG + packaging, mint cartons.

    Two shapes of payload:

    * ``lots`` — the normal path. One source lot per entry, exactly like a WO
      staging line. **One `PackingCompletion` row is written per lot**, so each
      keeps a truthful `source_batch_id` and its own carton range, and each lot's
      variant is read off its own `StockBalance` row instead of the order stating
      a variant that might disagree with the stock.
    * ``qty`` + optional ``source_batch_id`` — the single-event path, used by the
      mobile packing scanner and non-lot-tracked FG. The variant then comes from
      the order, or is derived from the un-lotted stock at the source location.

    Either shape may carry `qty_rejected` — loose material drawn off the source
    that never became a carton (offcuts, stained ends). It is consumed on top of
    the carton qty, moved into the defect store on its own lot, and counted into
    `qty_rejected` rather than `qty`, so `qty_packed` only ever means good
    output. A draw that yielded nothing good (`qty` 0, `qty_rejected` > 0) is
    written as a rejected completion. Cartons that were minted and only then
    failed QC go through the reject endpoint below instead.

    Note this never auto-closes the order when the target is reached — same rule
    as manufacturing orders, where closure is a deliberate act so a deliberately
    over-packed run is not blocked. `actual_end_date` is stamped on reaching
    target; the user closes the order explicitly.
    """
    po = await _load(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    if po.status in ("COMPLETED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Cannot log against a {po.status} packing order")
    if not po.source_location_id or not po.output_location_id:
        raise HTTPException(
            status_code=400,
            detail="Packing order needs both a source and an output location before packing",
        )

    await _assert_work_center(db, payload.work_center_id)

    lots = list(payload.lots or [])
    if lots:
        # A lot may be drawn purely to be scrapped (qty 0, qty_rejected > 0) —
        # the honest record when a whole draw failed QC — so the floor is the
        # lot's total draw, not its carton qty.
        if any(float(l.qty or 0) + float(l.qty_rejected or 0) <= 0 for l in lots):
            raise HTTPException(status_code=400, detail="Every selected lot needs a quantity greater than zero")
    else:
        if float(payload.qty or 0) <= 0 and float(payload.qty_rejected or 0) <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be greater than zero")
        if float(payload.qty or 0) > 0 and int(payload.package_count or 0) <= 0:
            raise HTTPException(status_code=400, detail="Package count must be at least 1")
        # Fold the single-event path into the same loop so there is one code path
        # minting cartons; batch_id stays None for non-lot-tracked FG.
        lots = [PackingCompletionLotPayload(
            batch_id=payload.source_batch_id,
            qty=payload.qty,
            package_count=payload.package_count,
            qty_rejected=payload.qty_rejected,
        )] if payload.source_batch_id else [None]

    # QC hold gate. Packing pulls straight out of the quarantine location, so the
    # release check belongs here rather than on a transfer. Checked up front for
    # the whole submission — a partial pack that stops halfway through the lot
    # list would leave cartons minted against a held batch. No-op when the source
    # is a normal store.
    try:
        await quarantine_service.assert_lots_released(
            db,
            source_location_id=po.source_location_id,
            item_id=po.item_id,
            batch_ids=[(l.batch_id if l else None) for l in lots],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    def _box_size(stated_count: Optional[int], qty: float) -> float:
        """Resolve the fixed box size driving this lot's carton split.

        A payload-level `box_size` (the bulk-log path) wins; a legacy explicit
        `package_count` reconstructs the exact box size it implies, so older
        callers (the mobile scanner, which still states a carton count) keep
        their existing behavior unchanged. Otherwise falls back to the order's
        own `pack_size`.
        """
        if payload.box_size:
            return float(payload.box_size)
        if stated_count:
            return qty / max(1, int(stated_count))
        return float(po.pack_size or 0)

    def _box_size_alt(stated_count: Optional[int]) -> float:
        """The box size in PIECES, when this event has one to split by.

        Same precedence as `_box_size` one level up: what the caller stated for
        this event beats the order's stored default. A caller that stated a base
        `box_size` or an explicit carton count for this event means it, so the
        order's stored count does not then override them — but nothing else does,
        which makes the count the default split on an alt-unit order.
        """
        if payload.box_size_alt:
            return float(payload.box_size_alt)
        if payload.box_size or stated_count:
            return 0.0
        return float(po.pack_size_alt or 0)

    lot_qtys = [float(lot.qty) if lot else float(payload.qty) for lot in lots]
    # Loose scrap per lot: material that left the source location but never
    # became a carton. Deliberately kept out of `lot_qtys` — those feed
    # `allocate_boxes_to_lots`, which asserts the box list sums to the qty being
    # boxed, and scrap is by definition not in a box.
    lot_rejects = [
        float((lot.qty_rejected if lot else payload.qty_rejected) or 0) for lot in lots
    ]
    reject_reason = (payload.reject_reason or "").strip() or None
    reject_loc = await reject_service.resolve_reject_location(
        db, item_id=po.item_id, explicit=payload.reject_location_id,
    ) if any(r > 0 for r in lot_rejects) else None

    # An explicit, user-edited box list spans the whole event (every lot
    # combined) and wins over box_size entirely — a box that doesn't fit in
    # one lot's draw splits across the lot boundary rather than being
    # rejected, since the packer edited the list without regard to lot lines.
    per_lot_cartons: Optional[list[list[tuple[float, Optional[float]]]]] = None
    if payload.boxes:
        # Per-lot sizes so the allocator can refuse a box that would straddle two
        # of them. Packing several sizes in one event is fine; a single box that
        # physically holds two is not — its label could not name a size.
        lot_size_rows = await packing_service.lot_sizes(
            db, [(l.batch_id if l else None) for l in lots]
        )
        try:
            per_lot_cartons = packing_service.allocate_boxes_to_lots(
                lot_qtys,
                [float(b) for b in payload.boxes],
                weights=list(payload.box_weights) if payload.box_weights else None,
                alt_qtys=list(payload.box_alt_qtys) if payload.box_alt_qtys else None,
                packaging_type_ids=list(payload.box_packaging_type_ids) if payload.box_packaging_type_ids else None,
                tares=list(payload.box_tares) if payload.box_tares else None,
                lot_sizes=lot_size_rows,
                package_label=po.package_label or "Box",
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

    # One conversion for the whole event: base-UOM qty per alt selling unit.
    alt_base_factor = packing_service.order_base_per_alt(po)

    completions: list[PackingCompletion] = []
    all_mats: list[PackingCompletionMaterial] = []
    box_breakdown: list[float] = []
    # Only populated on the explicit-box-list path: box_index -> pieces drawn
    # from each lot that fed it. A box never splits at a lot seam on the
    # box-size path (that split only ever happens inside one lot), so this
    # stays empty and the per-lot mint below runs unchanged for it.
    box_groups: dict[int, list[dict]] = {}
    for idx, lot in enumerate(lots):
        lot_qty = lot_qtys[idx]
        lot_reject = lot_rejects[idx]
        batch_id = lot.batch_id if lot else None
        if lot_qty <= 0:
            # Reject-only draw: nothing is boxed. Guarded here because
            # `split_qty(0, size)` still yields one zero-qty carton, which would
            # mint an empty label.
            carton_qtys = []
        elif per_lot_cartons is not None:
            carton_qtys = per_lot_cartons[idx]
        else:
            # No explicit box list — the split is derived from the box size, and
            # no scale reading came with it, so `assert_all_weighed` below turns
            # this into a 400. Kept as a path only so the error names the cartons.
            stated_count = lot.package_count if lot else payload.package_count
            # Pieces first on an alt-unit order: the carton is counted, and the
            # kilos it works out to are what the scale then argues with. Falls
            # through to the base split when there is no count to split by.
            carton_qtys = packing_service.cartons_from_alt_split(
                lot_qty, _box_size_alt(stated_count), alt_base_factor,
            ) or [
                packing_service.Carton(q)
                for q in packing_service.split_qty(lot_qty, _box_size(stated_count, lot_qty))
            ]

        # A kg-based item measures its cartons once: the qty in the box is its net
        # weight, so the packer is never asked for it twice and the two label
        # lines can never disagree.
        carton_qtys = packing_service.derive_weights_from_qty(
            carton_qtys, po.item.uom if po.item else None,
        )

        # Every carton on an alt-unit order prints a count, so one is derived for
        # any box the packer didn't state one for (the box-size path never does).
        carton_qtys = packing_service.fill_alt_qtys(carton_qtys, alt_base_factor)

        # Logging happens after the boxes are packed and weighed: a carton with no
        # net weight prints a label with a blank N.W. line, so it is refused here
        # rather than silently minted. The packaging gate sits beside it for the
        # same reason — brutto is printed too, and a box with no type has no tare.
        try:
            packing_service.assert_all_weighed(carton_qtys, po.package_label)
            packing_service.assert_all_boxed(carton_qtys, po.package_label)
            # Master tare for a standard box, the packer's weighing for a custom
            # one. Resolved before the mint so the figure written on the carton
            # is the one that was in force at pack time.
            carton_qtys = await packing_service.resolve_carton_tares(
                db, carton_qtys, po.package_label,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            if batch_id:
                attr_ids, color_id, available = await packing_service.resolve_lot_variant(db, po, batch_id)
            else:
                attr_ids, color_id = await packing_service.resolve_bulk_variant(db, po)
                available = await stock_service.get_stock_balance(
                    db, po.item_id, po.source_location_id, attr_ids, "", color_id=color_id,
                )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        # Scrap comes out of the same draw, so it has to be covered by the same
        # balance — a lot with 30kg cannot yield 28kg of cartons plus 5kg of
        # offcuts.
        needed = lot_qty + lot_reject
        if available + 1e-6 < needed:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock at source — have {available}, need {needed}",
            )

        completion = PackingCompletion(
            packing_order_id=po.id,
            qty=lot_qty,
            # Overwritten by mint_packed_units below, once the real split is known.
            package_count=0,
            source_batch_id=batch_id,
            # Falls back to the order's machine rather than staying null: every
            # per-machine aggregate reads this column, and a picker the packer
            # skipped must not erase where the work actually happened. Same fix
            # MOCompletion needed for the weaving monitor.
            work_center_id=payload.work_center_id or po.work_center_id,
            # Identity is the authenticated account, never the typed box: the
            # per-operator output report groups on this column, and free text
            # splits one packer across every spelling of their name. The text
            # stays as the display snapshot the packer may override.
            operator_user_id=current_user.id,
            operator=payload.operator or current_user.username,
            notes=payload.notes,
            completed_at=datetime.utcnow(),
            # Loose scrap off this draw. `qty` stays the GOOD qty, so qty_packed
            # and the SO fulfilment recompute never count material that went to
            # the defect store. `package_count_rejected` stays 0 — nothing was
            # boxed, so there is no carton to count.
            qty_rejected=lot_reject,
            reject_reason=reject_reason if lot_reject > 0 else None,
            reject_location_id=reject_loc if lot_reject > 0 else None,
            rejected_at=datetime.utcnow() if lot_reject > 0 else None,
            rejected_by=current_user.username if lot_reject > 0 else None,
            # A draw that yielded nothing good is a rejected event outright, the
            # same way a whole-event QC reject is — it must not sit in the log as
            # an active completion with zero output.
            rejected=lot_qty <= 0 and lot_reject > 0,
        )
        db.add(completion)
        await db.flush()
        completions.append(completion)

        # Packaging materials: explicit lines (first lot only — they describe the
        # whole submission), else the plan pro-rated by this lot's qty.
        if payload.materials is not None:
            mats = [
                PackingCompletionMaterial(
                    completion_id=completion.id,
                    item_id=m.item_id,
                    qty=m.qty,
                    location_id=m.location_id,
                    batch_id=m.batch_id,
                )
                for m in payload.materials
            ] if idx == 0 else []
        else:
            ratio = lot_qty / float(po.qty_target or lot_qty or 1)
            mats = [
                PackingCompletionMaterial(
                    completion_id=completion.id,
                    item_id=m.item_id,
                    qty=round(float(m.qty_planned or 0) * ratio, 4),
                    location_id=m.location_id,
                )
                for m in (po.materials or [])
                if float(m.qty_planned or 0) > 0
            ]
        for m in mats:
            db.add(m)
        await db.flush()
        all_mats.extend(mats)

        if per_lot_cartons is not None:
            # Explicit box list: debit this lot's stock now, piece by piece,
            # but defer minting — a box that straddled a lot seam has pieces
            # in more than one lot's carton_qtys and must become ONE carton,
            # not one per contributing lot. Assembled after the loop.
            completion.package_count = 0
            str_attr_ids = [str(a) for a in attr_ids]
            for piece in carton_qtys:
                await stock_service.add_stock_entry(
                    db, item_id=po.item_id, location_id=po.source_location_id,
                    qty_change=-float(piece.qty), reference_type="PACKING",
                    reference_id=po.code, attribute_value_ids=str_attr_ids,
                    color_id=color_id, batch_id=batch_id,
                )
                box_groups.setdefault(piece.box_index, []).append({
                    "qty": piece.qty, "weight_kg": piece.weight_kg, "alt_qty": piece.alt_qty,
                    "packaging_type_id": piece.packaging_type_id, "tare_kg": piece.tare_kg,
                    "source_batch_id": batch_id, "completion": completion,
                    "attr_ids": str_attr_ids, "color_id": color_id,
                })
        else:
            try:
                units = await packing_service.mint_packed_units(
                    db, po, completion,
                    carton_qtys=carton_qtys,
                    attribute_value_ids=[str(a) for a in attr_ids],
                    color_id=color_id,
                    username=completion.operator,
                    source_batch_id=batch_id,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            box_breakdown.extend(carton_qty for _, carton_qty in units)

        # Scrap leaves the source bin for the defect store on the lot it was
        # drawn from — it is still that lot's material, just no longer sellable.
        # The batch is NOT re-graded: the rest of it is untouched good stock, so
        # it is the defect LOCATION that marks this qty as scrap. (A whole-lot
        # reject goes through the QC endpoint, which does grade the batch.)
        if lot_reject > 0:
            await reject_service.move_unlotted_reject(
                db,
                item_id=po.item_id,
                qty=lot_reject,
                from_location_id=po.source_location_id,
                to_location_id=reject_loc,
                reference_id=po.code,
                reference_type="PACKING_REJECT",
                attribute_value_ids=[str(a) for a in attr_ids],
                color_id=color_id,
                batch_id=batch_id,
            )

    # Mint one carton per original box entry, in the order the packer typed
    # them — merging back whatever a lot seam split apart. The pieces list is
    # ordered by lot, so the LAST piece is the lot that closed the box out;
    # that lot's completion gets credited with it (`package_count`), and the
    # box's stock/label identity (operator, variant) comes from there too.
    for box_idx in sorted(box_groups.keys()):
        pieces = box_groups[box_idx]
        closing = pieces[-1]["completion"]
        closing.package_count += 1
        try:
            pu, total_qty = await packing_service.mint_merged_packed_unit(
                db, po, closing, pieces,
                attribute_value_ids=[str(a) for a in pieces[-1]["attr_ids"]],
                color_id=pieces[-1]["color_id"],
                username=closing.operator,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        box_breakdown.append(total_qty)

    try:
        await packing_service.consume_packaging_materials(db, po, all_mats)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    total_qty = sum(float(c.qty) for c in completions)
    total_cartons = sum(int(c.package_count) for c in completions)
    total_rejected = sum(float(c.qty_rejected or 0) for c in completions)

    po = await _load(db, po_id)
    if po.status == "PENDING":
        po.status = "IN_PROGRESS"
        po.actual_start_date = po.actual_start_date or datetime.utcnow()
    if packing_service.is_target_met(po) and not po.actual_end_date:
        po.actual_end_date = datetime.utcnow()
    # Fulfilled but still open — the MO's DELIVERED/COMPLETED split (SAP DLV vs
    # TECO). Logging stays allowed (only COMPLETED/CANCELLED stop it); what this
    # buys is that the order's *open* quantity is now zero, so quarantine stops
    # treating it as a claim on the hold bin's stock. Never auto-closes.
    if po.status in ("PENDING", "IN_PROGRESS") and packing_service.is_target_met(po):
        po.status = "DELIVERED"
    await db.commit()

    # Cartons now sit in stock against the SO line, which is what makes the order
    # shippable — re-derive the SO status (PENDING -> READY when every line is
    # covered). Packing to stock has no sales_order_id and is a no-op here.
    if po.sales_order_id:
        if await so_fulfilment_service.recompute_so_status(db, po.sales_order_id):
            await db.commit()
            await manager.broadcast({"type": "SALES_ORDER_UPDATE", "id": str(po.sales_order_id)})

    # Read the name back off the DB rather than the just-committed completion
    # rows: `_load` expires the identity map, so touching a relationship on one
    # of them would lazy-load inside an async session.
    machine_id = payload.work_center_id or po.work_center_id
    machine_name = (await db.execute(
        select(WorkCenter.name).filter(WorkCenter.id == machine_id)
    )).scalars().first() if machine_id else None
    reject_loc_name = await reject_service.location_name(db, reject_loc) if total_rejected > 0 else None
    lot_note = f" from {len(completions)} lots" if len(completions) > 1 else ""
    breakdown = packing_service.describe_box_breakdown(box_breakdown)
    breakdown_note = f" ({breakdown})" if len(set(round(q, 4) for q in box_breakdown)) > 1 else ""
    await audit_service.log_activity(
        db, user_id=current_user.id, action="PACK", entity_type="PackingOrder",
        entity_id=str(po_id),
        details=(
            f"Packed {total_qty} into {total_cartons} {po.package_label.lower()}(s)"
            f"{breakdown_note}{lot_note} on {po.code}"
            + (f" @ {machine_name}" if machine_name else "")
            + (f"; rejected {total_rejected:g}" if total_rejected > 0 else "")
            + (f" → {reject_loc_name}" if total_rejected > 0 and reject_loc_name else "")
            + (f": {reject_reason}" if total_rejected > 0 and reject_reason else "")
        ),
    )
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "PACKING_UPDATE", "id": str(po_id)})
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass

    po = await _load(db, po_id)
    units = await _packed_units_for(db, [po.id])
    return _decorate(po, units.get(str(po.id), []))


@router.post("/{po_id}/completions/{completion_id}/reject", response_model=PackingOrderResponse)
async def reject_packing_completion(
    po_id: uuid.UUID,
    completion_id: uuid.UUID,
    payload: PackingCompletionReject,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    """QC-reject cartons produced by one pack event — the packing-side mirror of
    the WO completion reject.

    Each rejected carton (a `Batch` row) is flagged and its stock is moved into the
    defect store resolved by `reject_service` (payload override → the FG item's
    `default_reject_location_id`; packing has no work center to route through). The
    rejected qty leaves `qty_packed` and lands on `qty_rejected`, so an order that
    had reached target reopens — closure stays a deliberate act.

    Reject the whole event by omitting `packed_unit_ids`; name cartons to reject
    only those (partial), which keeps the log active for its good cartons.
    """
    po = await _load(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    comp = next((c for c in (po.completions or []) if str(c.id) == str(completion_id)), None)
    if not comp:
        raise HTTPException(status_code=404, detail="Completion not found on this packing order")
    if comp.rejected:
        raise HTTPException(status_code=400, detail="Completion is already rejected")

    # Cartons minted by this event that are still good.
    units = (await db.execute(
        select(Batch).filter(Batch.packing_completion_id == comp.id)
    )).scalars().all()
    good_units = [b for b in units if not reject_service.is_reject_grade(b.quality_status)
                  and b.quality_status != reject_service.DISPOSED]
    if payload.packed_unit_ids:
        wanted = {str(x) for x in payload.packed_unit_ids}
        targets = [b for b in good_units if str(b.id) in wanted]
        missing = wanted - {str(b.id) for b in targets}
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"{len(missing)} carton(s) are not good cartons of this pack event",
            )
    else:
        targets = good_units
    whole = len(targets) >= len(good_units)

    grade = reject_service.normalize_grade(payload.usable)
    reject_loc = await reject_service.resolve_reject_location(
        db, item_id=po.item_id, explicit=payload.reject_location_id,
    )

    # Carton qty is never stored on the Batch — it lives in the StockBalance row
    # keyed by the carton, so the rejected qty is read from there before moving it.
    qty_rejected = 0.0
    for b in targets:
        on_hand = float((await db.execute(
            select(func.coalesce(func.sum(StockBalance.qty), 0))
            .filter(StockBalance.batch_key == str(b.id))
        )).scalar() or 0)
        b.quality_status = grade
        qty_rejected += on_hand
        await reject_service.quarantine_lot(
            db, item_id=b.item_id, batch_id=b.id,
            location_id=reject_loc, reference_id=b.batch_number,
        )
    # An already-dispatched/consumed carton has no stock left; fall back to the
    # logged qty pro-rated per carton so the scrap record is never zero.
    if qty_rejected <= 1e-9 and targets:
        per_carton = float(comp.qty or 0) / max(1, int(comp.package_count or len(targets)))
        qty_rejected = per_carton * len(targets)

    comp.qty_rejected = float(comp.qty_rejected or 0) + qty_rejected
    comp.package_count_rejected = int(comp.package_count_rejected or 0) + len(targets)
    comp.reject_reason = (payload.reason or "").strip() or None
    comp.rejected_at = datetime.utcnow()
    comp.rejected_by = current_user.username
    comp.reject_location_id = reject_loc
    if whole:
        # Whole event: drops out of qty_packed entirely (mirrors MOCompletion).
        comp.rejected = True
    else:
        # Partial: the log stays active for its good cartons, so trim qty the same
        # way the lot-level partial reject trims a WO completion.
        comp.qty = max(0.0, float(comp.qty or 0) - qty_rejected)
        comp.package_count = max(0, int(comp.package_count or 0) - len(targets))
    await db.flush()

    # Reopen: packed progress just dropped, so an order that had hit target is no
    # longer fulfilled. Never auto-closes on qty, never auto-closes off it either.
    po = await _load(db, po_id)
    if po.actual_end_date and not packing_service.is_target_met(po):
        po.actual_end_date = None
        if po.status in ("DELIVERED", "COMPLETED"):
            po.status = "IN_PROGRESS"
    await db.commit()

    if po.sales_order_id:
        if await so_fulfilment_service.recompute_so_status(db, po.sales_order_id):
            await db.commit()
            await manager.broadcast({"type": "SALES_ORDER_UPDATE", "id": str(po.sales_order_id)})

    loc_name = await reject_service.location_name(db, reject_loc)
    await audit_service.log_activity(
        db, user_id=current_user.id, action="REJECT", entity_type="PackingOrder",
        entity_id=str(po_id),
        details=f"QC rejected {len(targets)} {po.package_label.lower()}(s) ({qty_rejected:g}) on {po.code}"
        + (" [usable]" if payload.usable else "")
        + (f" → {loc_name}" if loc_name else "")
        + (f": {comp.reject_reason}" if comp.reject_reason else ""),
    )
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "PACKING_UPDATE", "id": str(po_id)})
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass

    po = await _load(db, po_id)
    units = await _packed_units_for(db, [po.id])
    return _decorate(po, units.get(str(po.id), []))


@router.post("/{po_id}/card-printed", response_model=PackingOrderResponse)
async def mark_card_printed(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    po = await _load(db, po_id)
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    po.card_printed_at = datetime.utcnow()
    await db.commit()
    po = await _load(db, po_id)
    return _decorate(po)


@router.delete("/{po_id}")
async def delete_packing_order(
    po_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sales.manage')),
):
    result = await db.execute(
        select(PackingOrder).options(selectinload(PackingOrder.completions)).filter(PackingOrder.id == po_id)
    )
    po = result.scalars().first()
    if not po:
        raise HTTPException(status_code=404, detail="Packing order not found")
    if po.completions:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a packing order that has packed cartons — cancel it instead",
        )

    code = po.code
    await db.delete(po)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE", entity_type="PackingOrder",
        entity_id=str(po_id), details=f"Deleted packing order {code}",
    )
    try:
        await manager.broadcast({"type": "PACKING_UPDATE", "id": str(po_id)})
        # Frees this order's (item, source location) claim — the whole reason
        # Quarantine Packing's lot lock exists is to reverse the moment this
        # happens, so it needs to reach the same 'stock' WS kind that page reads.
        await manager.broadcast({"type": "STOCK_UPDATE"})
    except Exception:
        pass
    return {"ok": True}
