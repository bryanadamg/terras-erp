from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, cast
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import selectinload, joinedload, aliased
from app.db.session import get_async_db
from app.models.batch import Batch, BatchConsumption, BeamMount
from app.models.manufacturing import MOCompletion
from app.models.item import Item
from app.models.stock_balance import StockBalance
from app.models.location import Location
from app.models.work_order import WorkOrder
from app.models.routing import WorkCenter
from app.models.manufacturing import ManufacturingOrder, manufacturing_order_values
from app.models.attribute import Attribute, AttributeValue
from app.models.color import Color
from app.models.production_run import ProductionRun
from app.models.sales import SalesOrder
from app.models.goods_receipt import GoodsReceipt, GoodsReceiptLine
from app.models.purchase import PurchaseOrder
from app.schemas import BatchCreate, BatchReject, BatchSplit, BatchDispose, BatchReassign, BatchResponse, BatchTraceResponse, BatchConsumptionResponse, BatchTraceBackNode, PaginatedBatchResponse
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.models.auth import User
from app.services import audit_service, kpi_service, stock_service, reject_service, numbering_service, quarantine_service, staging_service, work_center_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from datetime import datetime, timezone
import uuid

router = APIRouter(prefix="/batches", tags=["batches"])


async def _resolve_gr_origins(db: AsyncSession, batches: list[Batch]) -> None:
    """Populate po_id / po_number on GR-received batches (source_wo_id is None, batch_number starts GR-)."""
    gr_batches = [b for b in batches if not b.source_wo_id and b.batch_number.startswith("GR-")]
    if not gr_batches:
        return
    batch_ids = [b.id for b in gr_batches]
    rows = await db.execute(
        select(GoodsReceiptLine.batch_id, PurchaseOrder.id, PurchaseOrder.po_number)
        .join(GoodsReceipt, GoodsReceipt.id == GoodsReceiptLine.receipt_id)
        .join(PurchaseOrder, PurchaseOrder.id == GoodsReceipt.po_id)
        .filter(GoodsReceiptLine.batch_id.in_(batch_ids))
    )
    po_map: dict = {}
    for batch_id, po_id, po_number in rows.all():
        po_map[batch_id] = {"po_id": po_id, "po_number": po_number}
    for b in gr_batches:
        info = po_map.get(b.id)
        if info:
            for k, v in info.items():
                setattr(b, k, v)


async def _resolve_batch_origins(db: AsyncSession, batches: list[Batch]) -> None:
    """Populate origin lineage (mo / production run / sales order) on beam batches.

    A beam batch carries source_wo_id → WO → MO → (PR, SO). Shared-component MOs have
    sales_order_id=None, so the SO falls back to the MO's Production Run's sales_order_id.
    Also carries the MO's shade identity (Color Library colour, or the pending lab-dip
    variant code) so lot pickers can label what a physical lot actually is.
    """
    wo_ids = {b.source_wo_id for b in batches if b.source_wo_id}
    if not wo_ids:
        return
    mo_so = aliased(SalesOrder)   # SO linked directly on the MO
    pr_so = aliased(SalesOrder)   # SO linked on the MO's Production Run
    rows = await db.execute(
        select(
            WorkOrder.id,
            WorkOrder.code,
            ManufacturingOrder.id,
            ManufacturingOrder.code,
            ManufacturingOrder.production_run_id,
            ProductionRun.code,
            ManufacturingOrder.sales_order_id,
            mo_so.po_number,
            ProductionRun.sales_order_id,
            pr_so.po_number,
            Color.code,
            Color.name,
            Color.hex,
            ManufacturingOrder.labdip_variant_code,
        )
        .join(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
        .outerjoin(ProductionRun, ProductionRun.id == ManufacturingOrder.production_run_id)
        .outerjoin(mo_so, mo_so.id == ManufacturingOrder.sales_order_id)
        .outerjoin(pr_so, pr_so.id == ProductionRun.sales_order_id)
        .outerjoin(Color, Color.id == ManufacturingOrder.color_id)
        .filter(WorkOrder.id.in_(wo_ids))
    )
    origin: dict = {}
    for (wo_id, wo_code, mo_id, mo_code, pr_id, pr_code,
         mo_so_id, mo_so_code, pr_so_id, pr_so_code,
         color_code, color_name, color_hex, labdip_code) in rows.all():
        origin[wo_id] = {
            "wo_code": wo_code,
            "mo_id": mo_id,
            "mo_code": mo_code,
            "production_run_id": pr_id,
            "production_run_code": pr_code,
            "sales_order_id": mo_so_id or pr_so_id,
            "sales_order_code": mo_so_code or pr_so_code,
            "color_code": color_code,
            "color_name": color_name,
            "color_hex": color_hex,
            "labdip_variant_code": labdip_code,
        }
    for b in batches:
        info = origin.get(b.source_wo_id)
        if info:
            for k, v in info.items():
                setattr(b, k, v)


async def _resolve_batch_variants(db: AsyncSession, batches: list[Batch]) -> None:
    """Populate variant_attributes: the variant identity (Combo / Colors / Materials …)
    of the MO that produced each lot.

    A produced lot's size lives on the lot itself (bom_size_snapshot), but its
    combo/colour identity lives only on the source MO's attribute values — the
    stager picking greige for a dyeing WO needs both to tell two GRG- lots apart.
    One grouped query for every lot in the page; no N+1.

    Lots with no producing WO fall through to `_resolve_variants_from_stock_key`
    — a packed carton is the case that matters: it is minted by a packing order,
    never a WO, so this MO walk finds nothing for it and it would otherwise be
    the one lot in the system that displays with no identity at all.
    """
    wo_ids = {b.source_wo_id for b in batches if b.source_wo_id}
    if not wo_ids:
        await _resolve_variants_from_stock_key(db, batches)
        return
    rows = await db.execute(
        select(
            WorkOrder.id,
            Attribute.name,
            Attribute.system_role,
            AttributeValue.value,
            AttributeValue.hex,
        )
        .join(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
        .join(manufacturing_order_values, manufacturing_order_values.c.manufacturing_order_id == ManufacturingOrder.id)
        .join(AttributeValue, AttributeValue.id == manufacturing_order_values.c.attribute_value_id)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .filter(WorkOrder.id.in_(wo_ids))
        .order_by(Attribute.name, AttributeValue.value)
    )
    by_wo: dict = {}
    for wo_id, attr_name, role, value, hex_code in rows.all():
        by_wo.setdefault(wo_id, []).append({
            "name": attr_name, "system_role": role, "value": value, "hex": hex_code,
        })
    for b in batches:
        attrs = by_wo.get(b.source_wo_id)
        if attrs:
            b.variant_attributes = attrs
    await _resolve_variants_from_stock_key(db, batches)


async def _resolve_variants_from_stock_key(db: AsyncSession, batches: list[Batch]) -> None:
    """Identity for lots whose variant lives in their stock key, not on an MO.

    Packed cartons are the case this exists for. A carton's shade/combo/attributes
    are written into the `variant_key` of the StockBalance row that holds it (the
    same row that holds its qty), deliberately not copied onto the Batch row —
    so they are read back from the key here.

    Only fills what the MO walk above left empty: a produced lot's own MO is the
    better authority on its shade, and this must never overwrite it.
    """
    pending = [
        b for b in batches
        if not getattr(b, "variant_attributes", None) and getattr(b, "variant_key", None)
    ]
    if not pending:
        return
    described = await stock_service.describe_variant_keys(db, {b.variant_key for b in pending})
    for b in pending:
        info = described.get(b.variant_key)
        if not info:
            continue
        if info.get("variant_attributes"):
            b.variant_attributes = info["variant_attributes"]
        if not getattr(b, "color_code", None) and info.get("color_code"):
            b.color_code = info["color_code"]
            b.color_name = info.get("color_name")
            b.color_hex = info.get("color_hex")


async def _resolve_source_lots(db: AsyncSession, batches: list[Batch]) -> None:
    """Populate source_lots: the immediate upstream lots each batch was made from.

    One level back only. For a beam, its inputs (yarn) are pegged directly with
    output_batch_id = beam.id at BEAMING completion, so a single grouped query
    resolves every beam's raw-material/goods-receipt lot numbers — no N+1. This
    is what surfaces RM-lot provenance to the stager, who owns lot granularity
    when mounting beams onto a weaving WO.
    """
    made_ids = [b.id for b in batches if b.source_wo_id]
    if not made_ids:
        return
    rows = await db.execute(
        select(BatchConsumption.output_batch_id, Batch.batch_number)
        .join(Batch, Batch.id == BatchConsumption.input_batch_id)
        .filter(BatchConsumption.output_batch_id.in_(made_ids))
    )
    lot_map: dict = {}
    for out_id, number in rows.all():
        lot_map.setdefault(out_id, set()).add(number)
    for b in batches:
        if b.source_wo_id:
            b.source_lots = sorted(lot_map.get(b.id, set()))


def _build_batch_number(date_str: str, counter: int) -> str:
    return f"BAT-{date_str}-{str(counter).zfill(4)}"


async def generate_batch_number(db: AsyncSession, prefix: str = "BAT") -> str:
    """Next unique batch number for today: <prefix>-YYYYMMDD-NNNN.

    Allocated off a per-prefix-per-day number range. Counting today's rows and
    probing raced: two operators completing work orders in the same second both
    read the same count, and `batch_number` is unique — so the loser's whole
    completion (stock postings included) rolled back."""
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    full_prefix = f"{prefix}-{today}-"

    async def _seed() -> int:
        return int((await db.execute(
            select(func.count()).select_from(Batch).filter(Batch.batch_number.like(f"{full_prefix}%"))
        )).scalar() or 0)

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(Batch.id).filter(Batch.batch_number == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, f"BATCH:{full_prefix}", lambda n: f"{full_prefix}{n:04d}", seed=_seed, exists=_taken,
    )
    return code


# Batch.batch_number is String(64) and child lots suffix their parent (`-S1`, `-R2`),
# so a split of a split of a split can outgrow the column. Reserve room for the
# suffix and clamp the parent portion instead of trusting the nesting depth.
_LOT_NUMBER_MAX_LEN = 64
_LOT_SUFFIX_RESERVE = 6


async def _child_lot_number(db: AsyncSession, parent: Batch, kind: str) -> str:
    """Next `<parent>-S<n>` / `<parent>-R<n>` sub-lot number for a split or a partial
    QC reject.

    Counting the parent's existing children and adding one raced two splits of the
    same lot onto one number, and `batch_number` is unique — so one of the two split
    postings rolled back. One range per (parent, kind)."""
    stem = (parent.batch_number or "")[:_LOT_NUMBER_MAX_LEN - _LOT_SUFFIX_RESERVE]

    async def _seed() -> int:
        return int((await db.execute(
            select(func.count()).select_from(Batch).filter(Batch.batch_number.like(f"{stem}-{kind}%"))
        )).scalar() or 0)

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(Batch.id).filter(Batch.batch_number == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, f"LOT_CHILD:{kind}:{parent.id}", lambda n: f"{stem}-{kind}{n}", seed=_seed, exists=_taken,
    )
    return code


@router.post("", response_model=BatchResponse)
async def create_batch(
    payload: BatchCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.create')),
):
    item_result = await db.execute(select(Item).filter(Item.id == payload.item_id))
    item = item_result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    qty = float(payload.qty or 0)
    if qty < 0:
        raise HTTPException(status_code=400, detail="Opening qty cannot be negative")
    location = None
    if qty > 0:
        if not payload.location_id:
            raise HTTPException(status_code=400, detail="Select a location for the opening quantity")
        location = (await db.execute(
            select(Location).filter(Location.id == payload.location_id)
        )).scalars().first()
        if not location:
            raise HTTPException(status_code=404, detail="Location not found")

    batch_number = await generate_batch_number(db)

    batch = Batch(
        batch_number=batch_number,
        item_id=payload.item_id,
        notes=payload.notes,
        created_by=current_user.username,
    )
    db.add(batch)
    await db.flush()

    # Opening balance: one lotted stock entry at the chosen location, in the
    # no-variant bucket (a manual lot carries no variant identity of its own).
    if qty > 0:
        await stock_service.add_stock_entry(
            db, item_id=payload.item_id, location_id=payload.location_id, qty_change=qty,
            reference_type="Lot Opening", reference_id=batch_number, batch_id=batch.id,
        )

    await db.commit()
    # Reload with the item joined — _enrich_batches touches batch.item, which
    # would lazy-load (MissingGreenlet) on the freshly created instance.
    batch = (await db.execute(
        select(Batch).options(joinedload(Batch.item))
        .filter(Batch.id == batch.id).execution_options(populate_existing=True)
    )).scalars().first()

    await audit_service.log_activity(
        db, current_user.id, "CREATE", "Batch", str(batch.id),
        details=f"Created batch {batch_number} for item {payload.item_id}"
        + (f" with {qty:g} at {location.name}" if qty > 0 else "")
    )
    if qty > 0:
        await manager.broadcast({"type": "STOCK_UPDATE"})
    return (await _enrich_batches(db, [batch]))[0]


async def _enrich_batches(db: AsyncSession, batches: list[Batch], location_id: uuid.UUID | None = None, with_source_lots: bool = False) -> list[Batch]:
    """Attach remaining stock, current location, item code/name and origin lineage.

    A location filter means "lots actually present there" (lot/batch pickers for
    staging and completion pass location_id expecting only selectable options) —
    without this, batches with zero stock at that location still show up.
    """
    keys = [str(b.id) for b in batches]
    remaining_map: dict[str, float] = {}
    location_map: dict[str, tuple] = {}
    variant_map: dict[str, str] = {}
    if keys:
        bal_q = (
            select(StockBalance.batch_key, func.sum(StockBalance.qty))
            .filter(StockBalance.batch_key.in_(keys))
            .group_by(StockBalance.batch_key)
        )
        if location_id:
            bal_q = bal_q.filter(StockBalance.location_id == location_id)
        bal_res = await db.execute(bal_q)
        remaining_map = {k: float(v or 0) for k, v in bal_res.all()}

        # Current location — beam is a physical unit, always at most one location with qty > 0
        loc_q = (
            select(StockBalance.batch_key, StockBalance.location_id, Location.name,
                   StockBalance.variant_key)
            .join(Location, Location.id == StockBalance.location_id)
            .filter(StockBalance.batch_key.in_(keys), StockBalance.qty > 0)
        )
        if location_id:
            loc_q = loc_q.filter(StockBalance.location_id == location_id)
        loc_res = await db.execute(loc_q)
        rows_ = loc_res.all()
        location_map = {row[0]: (row[1], row[2]) for row in rows_}
        # The balance row's variant identity — a lot is one physical thing, so one
        # variant. Served so a picker can tell two same-item lots of different
        # colour apart (the colour is folded into variant_key as `c:<uuid>`).
        variant_map = {row[0]: (row[3] or "") for row in rows_}

    if location_id:
        batches = [b for b in batches if remaining_map.get(str(b.id), 0.0) > 0]

    # Location hierarchy (root-first: warehouse → zone → bin) for the current leaf.
    # Load the whole (small) location table once and walk parents in-memory —
    # touching Location.parent directly would trip async lazy-load (MissingGreenlet).
    loc_lookup: dict = {}
    if location_map:
        loc_rows = (await db.execute(select(Location.id, Location.name, Location.parent_id))).all()
        loc_lookup = {row[0]: (row[1], row[2]) for row in loc_rows}

    def _build_path(lid):
        chain, seen, cur = [], set(), lid
        while cur and cur not in seen:
            seen.add(cur)
            entry = loc_lookup.get(cur)
            if not entry:
                break
            name, parent = entry
            chain.append(name)
            cur = parent
        return list(reversed(chain)) or None

    # A lot is "held" only when it currently sits in a quarantine location AND its
    # disposition hasn't passed — a stale REJECTED-style status left over after a
    # transfer to a normal store must not block anything (see quarantine_service).
    quarantine_loc_ids = await quarantine_service.quarantine_location_ids(db) if location_map else set()

    # Which WO each lot was staged to. A staging claim is per (lot, location): with a
    # location filter that is the queried one, and without one it is wherever the lot
    # now sits — a lot moved back to a store is nobody's line stock any more. Honoured
    # by every consumption picker; see services/staging_service.py.
    reservation_map: dict[str, str] = {}
    reservation_codes: dict[str, str] = {}
    if batches:
        if location_id:
            reservation_map = await staging_service.batch_reservations(
                db, location_id, [b.id for b in batches]
            )
        else:
            reservation_map = await staging_service.reservations_at_current_location(
                db, {str(b.id): location_map.get(str(b.id), (None, None))[0] for b in batches}
            )
        reservation_codes = await staging_service.wo_codes(db, set(reservation_map.values()))

    # Which loom each beam is currently gaited on. A mounted beam is not free
    # stock: `mount_beam` refuses to double-mount it, so a scanner has to be able
    # to say "that warp is up on LOOM-07" at the scan rather than at submit —
    # exactly the reason `reserved_wo_code` above exists for bag lots.
    mount_map: dict[str, tuple] = {}
    if batches:
        mres = await db.execute(
            select(BeamMount.batch_id, BeamMount.work_center_id, WorkCenter.code, WorkCenter.name)
            .outerjoin(WorkCenter, WorkCenter.id == BeamMount.work_center_id)
            .where(BeamMount.batch_id.in_([b.id for b in batches]),
                   BeamMount.dismounted_at.is_(None))
        )
        mount_map = {str(bid): (wc_id, code or name) for bid, wc_id, code, name in mres.all()}

    for b in batches:
        b.remaining = remaining_map.get(str(b.id), 0.0)
        b.location_id, b.location_name = location_map.get(str(b.id), (None, None))
        b.variant_key = variant_map.get(str(b.id))
        b.location_path = _build_path(b.location_id) if b.location_id else None
        b.item_code = b.item.code if b.item else None
        b.item_name = b.item.name if b.item else None
        b.held = bool(b.location_id in quarantine_loc_ids) and not quarantine_service.is_pass(b.quarantine_status)
        holder = reservation_map.get(str(b.id))
        b.reserved_wo_id = uuid.UUID(holder) if holder else None
        b.reserved_wo_code = reservation_codes.get(holder) if holder else None
        b.mounted_wc_id, b.mounted_wc_code = mount_map.get(str(b.id), (None, None))
    await _resolve_gr_origins(db, list(batches))
    await _resolve_batch_origins(db, list(batches))
    await _resolve_batch_variants(db, list(batches))
    if with_source_lots:
        await _resolve_source_lots(db, list(batches))
    return batches


@router.get("", response_model=list[BatchResponse])
async def list_batches(
    item_id: uuid.UUID | None = Query(None),
    location_id: uuid.UUID | None = Query(None),
    variant_key: str | None = Query(
        None,
        description="Keep only lots whose stock variant satisfies this one (colour must match exactly, "
                    "stated attribute values must all be present). Used by the packing lot picker so a "
                    "hold bin holding two shades of the same FG offers only the order's own.",
    ),
    with_source_lots: bool = Query(False, description="Also resolve each batch's immediate upstream (RM) lots — used by the staging picker"),
    include_packed_units: bool = Query(False, description="Include packed cartons (PU-). Off by default: these pickers choose consumable lots, and a sealed carton is not one."),
    skip: int = 0,
    limit: int = 100,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    """Raw, uncapped-total lot list — used by lot/batch pickers (staging, WO
    completion, packing) that want "up to limit candidates for this item", not
    a paged table. See list_batches_paginated for the Lot Management page.

    Packed cartons are Batch rows too (see services/packing_service.py), so they
    are filtered out here unless asked for — otherwise every consumption picker
    would offer sealed finished-goods cartons as input material."""
    query = select(Batch).options(joinedload(Batch.item)).order_by(Batch.created_at.desc())
    if item_id:
        query = query.filter(Batch.item_id == item_id)
    if not include_packed_units:
        query = query.filter(Batch.packing_order_id.is_(None))
    result = await db.execute(query.offset(skip).limit(limit))
    batches = result.scalars().all()
    enriched = await _enrich_batches(db, batches, location_id, with_source_lots=with_source_lots)
    if variant_key:
        # Applied after enrichment: the variant lives on the StockBalance row, which
        # is what `_enrich_batches` resolved — the Batch row itself carries no variant.
        enriched = [
            b for b in enriched
            if stock_service.variant_matches(variant_key, getattr(b, "variant_key", "") or "")
        ]
    return enriched


@router.get("/paginated", response_model=PaginatedBatchResponse)
async def list_batches_paginated(
    item_id: uuid.UUID | None = Query(None),
    search: str | None = Query(None, description="Matches lot number, supplier lot, or item code/name"),
    status: str | None = Query(None, description="'active' (remaining > 0) or 'depleted' (0 remaining); None = all"),
    location_id: list[str] | None = Query(None, description="Filter to lots with current stock at any of these leaf location ids (caller expands warehouse/zone → descendants). Repeat the param or pass one comma-separated list."),
    category_id: str | None = Query(None, description="Item category id, or comma-separated ids (a category plus its descendants — caller expands the tree, same contract as /stock/balance/paginated)"),
    lot_type: str | None = Query(None, description="'GR' (goods-receipt/manual, no producing WO or packing order), 'PACK' (packed carton), or a WorkCenter TYPE's center_type (WEAVING, DYEING, BEAMING, SETTING, ...) — classifies a lot by the process that produced it"),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    """Server-paginated Lot Management list — page window from core/pagination.py,
    so the {items, total, page, size} envelope matches every other domain and the
    shared Pager component can drive it."""
    # location_id accepts both the repeated-param form and one comma-separated
    # value: the shared frontend list hook serializes each filter as a single
    # query param, so a multi-location filter arrives joined.
    loc_ids: list[uuid.UUID] = []
    for raw in (location_id or []):
        for part in str(raw).split(","):
            part = part.strip()
            if not part:
                continue
            try:
                loc_ids.append(uuid.UUID(part))
            except ValueError:
                raise HTTPException(status_code=422, detail=f"Invalid location id '{part}'")

    filters = []
    if item_id:
        filters.append(Batch.item_id == item_id)
    if loc_ids:
        # Lots whose current stock sits at any of the given leaf locations.
        # Cast the (text) batch_key to UUID inside the subquery and compare against
        # Batch.id directly — casting Batch.id to text instead would defeat the PK
        # index and force a seq scan on batches. batch_key != "" guarantees every
        # remaining value is a real lot uuid, so the cast never sees a bad value.
        loc_keys = (
            select(cast(StockBalance.batch_key, PG_UUID(as_uuid=True)))
            .filter(StockBalance.location_id.in_(loc_ids), StockBalance.qty > 0, StockBalance.batch_key != "")
            .group_by(StockBalance.batch_key)
        )
        filters.append(Batch.id.in_(loc_keys))
    if category_id:
        cat_ids = [x for x in category_id.split(",") if x]
        if cat_ids:
            filters.append(Batch.item_id.in_(select(Item.id).filter(Item.category_id.in_(cat_ids))))
    if lot_type == "GR":
        # Goods-receipt or manually-created lots: no producing WO, not a carton.
        filters.append(Batch.source_wo_id.is_(None))
        filters.append(Batch.packing_order_id.is_(None))
    elif lot_type == "PACK":
        filters.append(Batch.packing_order_id.isnot(None))
    elif lot_type:
        # A WorkCenter TYPE's center_type — resolve every WO whose work center
        # rolls up to it, via the TYPE-root CTE, same "in a subquery" shape as
        # every other filter here rather than joining the CTE into count/page.
        wc_type = work_center_service.type_of_cte()
        matching_wo_ids = (
            select(WorkOrder.id)
            .join(wc_type, wc_type.c.id == WorkOrder.work_center_id)
            .filter(wc_type.c.center_type == lot_type)
        )
        filters.append(Batch.source_wo_id.in_(matching_wo_ids))
    if status in ("active", "depleted"):
        # remaining = sum of StockBalance rows keyed by str(batch id). "active" =
        # any positive balance; "depleted" = no positive balance (summed <= 0 or
        # never had a balance row). batch_key is text, so cast Batch.id to match.
        # Exclude batch_key="" (the vast majority of rows — all non-lot-tracked
        # stock across the whole plant) up front, or this aggregate drags every
        # unrelated stock row in the system into one giant group just to answer
        # a question about the handful of real lots.
        # Cast batch_key → UUID in the subquery (not Batch.id → text in the outer
        # predicate) so the outer filter can use the Batch.id PK index instead of
        # seq-scanning every batch row. batch_key != "" both prunes the huge block
        # of non-lot stock rows and guarantees the cast only sees real lot uuids.
        active_keys = (
            select(cast(StockBalance.batch_key, PG_UUID(as_uuid=True)))
            .filter(StockBalance.batch_key != "")
            .group_by(StockBalance.batch_key)
            .having(func.sum(StockBalance.qty) > 0)
        )
        if status == "active":
            filters.append(Batch.id.in_(active_keys))
        else:
            filters.append(Batch.id.not_in(active_keys))
    if search:
        pattern = f"%{search.strip()}%"
        # Production-origin codes: a lot's WO / MO / PR / SO identity is derived
        # (source_wo_id → WO → MO → PR/SO), not stored on the row, so match them
        # through the same chain _resolve_batch_origins displays.
        s_mo_so = aliased(SalesOrder)
        s_pr_so = aliased(SalesOrder)
        origin_wo_ids = (
            select(WorkOrder.id)
            .join(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
            .outerjoin(ProductionRun, ProductionRun.id == ManufacturingOrder.production_run_id)
            .outerjoin(s_mo_so, s_mo_so.id == ManufacturingOrder.sales_order_id)
            .outerjoin(s_pr_so, s_pr_so.id == ProductionRun.sales_order_id)
            .filter(
                WorkOrder.code.ilike(pattern)
                | ManufacturingOrder.code.ilike(pattern)
                | ProductionRun.code.ilike(pattern)
                | s_mo_so.po_number.ilike(pattern)
                | s_pr_so.po_number.ilike(pattern)
            )
        )
        filters.append(
            Batch.id.in_(
                select(Batch.id)
                .join(Item, Item.id == Batch.item_id)
                .filter(
                    Batch.batch_number.ilike(pattern)
                    | Batch.vendor_lot.ilike(pattern)
                    | Item.code.ilike(pattern)
                    | Item.name.ilike(pattern)
                )
            )
            | Batch.source_wo_id.in_(origin_wo_ids)
        )

    count_query = select(func.count()).select_from(Batch)
    query = select(Batch).options(joinedload(Batch.item)).order_by(Batch.created_at.desc())
    for f in filters:
        count_query = count_query.filter(f)
        query = query.filter(f)

    total = (await db.execute(count_query)).scalar() or 0
    result = await db.execute(window.apply(query))
    batches = result.scalars().all()
    batches = await _enrich_batches(db, batches)
    return window.envelope(batches, total)


@router.get("/resolve", response_model=BatchResponse)
async def resolve_batch_by_number(
    number: str = Query(..., description="Exact lot/batch number (from a scanned bag QR)"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    """Resolve a scanned lot number to its enriched batch (remaining, current
    location, item, quality). Powers scan-to-stage — the bag label QR encodes
    the lot number. Exact match; 404 if unknown. Declared before /{batch_id} so
    'resolve' isn't parsed as a UUID path param."""
    result = await db.execute(
        select(Batch).options(joinedload(Batch.item)).filter(Batch.batch_number == number.strip())
    )
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail=f"Lot '{number}' not found")
    enriched = await _enrich_batches(db, [batch])
    return enriched[0]


@router.get("/{batch_id}", response_model=BatchResponse)
async def get_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    batch.item_code = batch.item.code if batch.item else None
    batch.item_name = batch.item.name if batch.item else None
    await _resolve_gr_origins(db, [batch])
    await _resolve_batch_origins(db, [batch])
    return batch


@router.delete("/{batch_id}")
async def delete_batch(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.delete')),
):
    result = await db.execute(select(Batch).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")

    await db.delete(batch)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "Batch", str(batch_id),
        details=f"Deleted batch {batch.batch_number}"
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    return {"status": "success"}


async def _batch_remaining(db: AsyncSession, batch_id) -> float:
    return float((await db.execute(
        select(func.sum(StockBalance.qty)).filter(StockBalance.batch_key == str(batch_id), StockBalance.qty > 0)
    )).scalar() or 0.0)


async def _move_batch_stock(db: AsyncSession, *, item_id, src_batch_id, dst_batch_id, qty: float, reference_type: str, reference_id: str) -> float:
    """Move up to ``qty`` of on-hand from one lot to another, preserving each
    source row's location and variant (variant ids recovered from the balance
    row's variant_key). Two-sided per row so the balance table stays consistent.
    Returns kg actually moved. Shared by QC reject (→ REJECTED sub-lot) and lot
    split (→ new GOOD sub-lot)."""
    rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key == str(src_batch_id), StockBalance.qty > 0)
        .order_by(StockBalance.qty.desc())
    )).scalars().all()
    to_move = float(qty)
    moved = 0.0
    for r in rows:
        if to_move <= 1e-9:
            break
        portion = min(float(r.qty), to_move)
        ids, cid = stock_service._parse_variant_key(r.variant_key)
        await stock_service.add_stock_entry(
            db, item_id=item_id, location_id=r.location_id, qty_change=-portion,
            reference_type=reference_type, reference_id=reference_id,
            attribute_value_ids=ids, color_id=cid, batch_id=src_batch_id,
        )
        await stock_service.add_stock_entry(
            db, item_id=item_id, location_id=r.location_id, qty_change=portion,
            reference_type=reference_type, reference_id=reference_id,
            attribute_value_ids=ids, color_id=cid, batch_id=dst_batch_id,
        )
        to_move -= portion
        moved += portion
    return moved


# Lot-scoped quarantine move — shared with the WO-completion and packing reject
# paths, so it lives in stock_service rather than here.
_relocate_batch_stock = stock_service.relocate_batch_stock


@router.post("/{batch_id}/split", response_model=BatchResponse)
async def split_batch(
    batch_id: uuid.UUID,
    payload: BatchSplit,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.split')),
):
    """Peel ``qty`` off a GOOD lot into a new GOOD sub-lot (``{orig}-S{n}``) at the
    same location/variant, leaving the original with the remainder. Both stay
    GOOD/active. The sub-lot copies ``source_wo_id`` so its production origin
    (e.g. the weaving WO) still traces. Used when only part of a physical bag is
    staged/consumed and the rest goes back to stock as its own trackable bag.

    Lineage is written the same two ways a leftover beam writes it
    (``beam_service.dismount``): ``parent_batch_id`` as the cheap "whose piece is
    this" answer, plus a ``BatchConsumption`` row (input = parent, output = sub) so
    ``/batches/{id}/trace-back`` walks a split child up into the parent's own
    inputs. Without the consumption row a split cut the genealogy chain: the sub-lot
    kept the parent's ``source_wo_id`` but nothing said what it was made from."""
    result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    if reject_service.is_reject_grade(batch.quality_status):
        raise HTTPException(status_code=400, detail="Cannot split a rejected lot")

    qty = float(payload.qty or 0)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Split qty must be positive")
    remaining = await _batch_remaining(db, batch.id)
    if qty >= remaining - 1e-9:
        raise HTTPException(status_code=400, detail=f"Split qty {qty:g} must be less than remaining {remaining:g}")

    reason = (payload.reason or "").strip() or None
    sub = Batch(
        batch_number=await _child_lot_number(db, batch, "S"),
        item_id=batch.item_id,
        quality_status="GOOD",
        source_wo_id=batch.source_wo_id,
        ends=batch.ends,
        bom_size_id=batch.bom_size_id,
        bom_size_snapshot=batch.bom_size_snapshot,
        parent_batch_id=batch.id,
        notes=(f"Split from {batch.batch_number}" + (f": {reason}" if reason else "")),
        created_by=current_user.username,
    )
    db.add(sub)
    await db.flush()

    moved = await _move_batch_stock(
        db, item_id=batch.item_id, src_batch_id=batch.id, dst_batch_id=sub.id,
        qty=qty, reference_type="Split", reference_id=sub.batch_number,
    )
    # Pegged to the kg that actually moved, not the requested qty — a source row
    # short of the ask leaves `moved` below `qty`, and genealogy must state what
    # the child is really made of. No order id: a split belongs to no MO or
    # packing order, same as the beam-leftover row.
    db.add(BatchConsumption(
        input_batch_id=batch.id,
        output_batch_id=sub.id,
        qty_consumed=moved,
    ))
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "SPLIT", "Batch", str(batch.id),
        details=f"Split {moved:g} off lot {batch.batch_number} → new lot {sub.batch_number}"
        + (f": {reason}" if reason else ""),
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})

    reloaded = (await db.execute(
        select(Batch).options(joinedload(Batch.item)).filter(Batch.id == sub.id)
    )).scalars().first()
    return (await _enrich_batches(db, [reloaded]))[0]


@router.post("/{batch_id}/reject", response_model=BatchResponse)
async def reject_batch(
    batch_id: uuid.UUID,
    payload: BatchReject,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.qc_reject')),
):
    """QC-reject a lot. The lot stays physically in stock but is flagged
    REJECTED — excluded from good-stock netting and consumption pickers. If
    the lot was born from a production completion, that completion stops
    counting toward MO/WO progress and the MO reopens if it had
    auto-completed; rework is a new WO created manually.

    The rejected stock is quarantined into a defect store so bad goods never sit
    on the good-stock shelf. The bin comes from ``location_id`` when given,
    otherwise it is resolved by ``reject_service``: the lot's producing work
    center's reject location (inherited down the TYPE → GROUP → MACHINE tree),
    then the item master's default. Only a lot with neither stays where it is.

    ``usable`` downgrades instead of scrapping (``REJECT_USABLE``): the lot is
    still quarantined and out of availability, but consumption pickers may take
    it — a rejected warp beam can be re-mounted for certain items."""
    result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    if reject_service.is_reject_grade(batch.quality_status):
        raise HTTPException(status_code=400, detail="Lot is already rejected")

    reason = (payload.reason or "").strip() or None
    grade = reject_service.normalize_grade(payload.usable)

    # Defect store: explicit pick, else routed from the lot's producing work center
    # (its WO's center) or the item master.
    src_wc_id = None
    if batch.source_wo_id:
        src_wc_id = (await db.execute(
            select(WorkOrder.work_center_id).filter(WorkOrder.id == batch.source_wo_id)
        )).scalar()
    defect_loc_id = await reject_service.resolve_reject_location(
        db, item_id=batch.item_id, work_center_id=src_wc_id, explicit=payload.location_id,
    )
    defect_loc = None
    if defect_loc_id:
        defect_loc = (await db.execute(
            select(Location).filter(Location.id == defect_loc_id)
        )).scalars().first()
        if not defect_loc and payload.location_id:
            raise HTTPException(status_code=404, detail="Defect store location not found")

    # Current on-hand across every balance row keyed to this lot.
    bal_rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key == str(batch.id), StockBalance.qty > 0)
        .order_by(StockBalance.qty.desc())
    )).scalars().all()
    remaining = sum(float(r.qty) for r in bal_rows)

    reject_qty = payload.qty
    if reject_qty is not None:
        if reject_qty <= 0:
            raise HTTPException(status_code=400, detail="Reject qty must be positive")
        if reject_qty > remaining + 1e-9:
            raise HTTPException(status_code=400, detail=f"Reject qty {reject_qty:g} exceeds remaining {remaining:g}")
    # Whole-lot reject when no qty given or it covers the entire remaining balance.
    partial = reject_qty is not None and reject_qty < remaining - 1e-9

    sub = None
    if partial:
        # Split: move reject_qty into a new REJECTED sub-lot (same item/location/
        # variant), leaving the original lot GOOD/active for the good remainder.
        sub = Batch(
            batch_number=await _child_lot_number(db, batch, "R"),
            item_id=batch.item_id,
            quality_status=grade,
            source_wo_id=batch.source_wo_id,
            bom_size_id=batch.bom_size_id,
            bom_size_snapshot=batch.bom_size_snapshot,
            parent_batch_id=batch.id,
            notes=(f"QC reject of {batch.batch_number}" + (f": {reason}" if reason else "")),
            created_by=current_user.username,
        )
        db.add(sub)
        await db.flush()
        moved = await _move_batch_stock(
            db, item_id=batch.item_id, src_batch_id=batch.id, dst_batch_id=sub.id,
            qty=float(reject_qty), reference_type="QC_REJECT", reference_id=sub.batch_number,
        )
        # Same lineage a split writes (see split_batch): parent_batch_id for the
        # cheap answer, a BatchConsumption row so trace-back walks the rejected
        # piece up into whatever the parent lot was made from. Pegged to the kg
        # that actually moved, and to no order — a QC reject is neither an MO nor
        # a packing order.
        db.add(BatchConsumption(
            input_batch_id=batch.id,
            output_batch_id=sub.id,
            qty_consumed=moved,
        ))
    else:
        batch.quality_status = grade

    # Quarantine: move the rejected lot's stock into the defect store. On a partial
    # reject only the split-off sub-lot moves — the GOOD remainder stays put.
    relocated = 0.0
    if defect_loc:
        relocated = await _relocate_batch_stock(
            db, item_id=batch.item_id, batch_id=(sub.id if sub else batch.id),
            location_id=defect_loc.id, reference_type="QC_REJECT",
            reference_id=(sub.batch_number if sub else batch.batch_number),
        )

    # Producing completion (if any): return the rejected qty to MO progress.
    comp = (await db.execute(
        select(MOCompletion).filter(
            MOCompletion.output_batch_id == batch.id,
            MOCompletion.rejected == False,  # noqa: E712
        )
    )).scalars().first()
    mo = None
    returned = 0.0
    reopened_from = None
    if comp:
        if partial:
            # Reduce the good qty this completion contributes; every MO/WO progress
            # sum is sum(qty_completed where not rejected), so trimming this value
            # rolls the rejected qty straight back into the shortfall.
            returned = min(float(reject_qty), float(comp.qty_completed))
            comp.qty_completed = float(comp.qty_completed) - returned
            # qty_completed just lost the scrapped qty — qty_rejected is the only
            # durable record of it (the -R sub-lot's stock disappears on dispose).
            comp.qty_rejected = float(comp.qty_rejected or 0) + returned
            comp.reject_reason = reason
            if float(comp.qty_completed) <= 1e-9:
                comp.rejected = True
                comp.rejected_at = datetime.utcnow()
                comp.rejected_by = current_user.username
        else:
            returned = float(comp.qty_completed)
            comp.rejected = True
            comp.qty_rejected = float(comp.qty_rejected or 0) + returned
            comp.reject_reason = reason
            comp.rejected_at = datetime.utcnow()
            comp.rejected_by = current_user.username
        await db.flush()

        mo = (await db.execute(
            select(ManufacturingOrder).filter(ManufacturingOrder.id == comp.mo_id)
        )).scalars().first()
        if mo:
            total_good = float((await db.execute(
                select(func.sum(MOCompletion.qty_completed))
                .filter(MOCompletion.mo_id == mo.id, MOCompletion.rejected == False)  # noqa: E712
            )).scalar() or 0)
            if mo.status in ("DELIVERED", "COMPLETED") and total_good < float(mo.qty):
                reopened_from = mo.status
                mo.status = "IN_PROGRESS"
                mo.actual_end_date = None

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "REJECT", "Batch", str(batch.id),
        details=(f"Rejected {reject_qty:g} of lot {batch.batch_number} → sub-lot {sub.batch_number}" if partial
                 else f"Rejected lot {batch.batch_number}")
        + (" [usable]" if payload.usable else "")
        + (f" ({returned:g} returned to {mo.code})" if comp and mo and returned else "")
        + (f" → moved {relocated:g} to {defect_loc.name}" if defect_loc and relocated else "")
        + (f": {reason}" if reason else ""),
    )
    if mo and reopened_from:
        # Its own row against the MO, not just a clause on the Batch's REJECT entry —
        # the MO's own history is where someone looks for why a closed order reopened.
        await audit_service.log_activity(
            db, current_user.id, "STATUS_CHANGE", "ManufacturingOrder", str(mo.id),
            details=f"{reopened_from} -> IN_PROGRESS (automatic, reopened by lot reject)",
            changes={"status": [reopened_from, "IN_PROGRESS"]},
        )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    if mo:
        # Progress, not just status: a lot-level reject moves the MO's good and
        # rejected totals, and a status-only event left every progress bar showing
        # the rejected qty as done. Imported here, not at module scope —
        # api.manufacturing already imports generate_batch_number from this file.
        from app.api.manufacturing import mo_progress_fields
        rejected_wo = None
        if comp and comp.work_order_id:
            rejected_wo = (await db.execute(
                select(WorkOrder).filter(WorkOrder.id == comp.work_order_id)
            )).scalars().first()
        await manager.broadcast({
            "type": "MANUFACTURING_ORDER_UPDATE",
            **(await mo_progress_fields(db, mo, rejected_wo)),
        })
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    batch.item_code = batch.item.code if batch.item else None
    batch.item_name = batch.item.name if batch.item else None
    return batch


@router.post("/{batch_id}/dispose", response_model=BatchResponse)
async def dispose_batch(
    batch_id: uuid.UUID,
    payload: BatchDispose | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.delete')),
):
    """Dispose/scrap a rejected lot: physically write off its remaining stock
    (posts every balance row OUT so the qty leaves stock-on-hand) and mark the
    lot DISPOSED. Only rejected lots can be disposed — reject first; a
    REJECT_USABLE lot may be disposed too, once it's clear nothing will re-use it.
    Mirrors the consumed-beam write-off. Irreversible."""
    result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    if not reject_service.is_reject_grade(batch.quality_status):
        raise HTTPException(status_code=400, detail="Only rejected lots can be disposed")

    reason = (payload.reason if payload else None) or None
    reason = reason.strip() or None if reason else None

    # Post out every balance row keyed to this lot (preserving each row's
    # location + variant), moving exactly the on-hand so it can't go negative.
    rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key == str(batch.id), StockBalance.qty > 0)
    )).scalars().all()
    disposed = 0.0
    for r in rows:
        portion = float(r.qty)
        ids, cid = stock_service._parse_variant_key(r.variant_key)
        await stock_service.add_stock_entry(
            db, item_id=batch.item_id, location_id=r.location_id, qty_change=-portion,
            reference_type="QC Dispose", reference_id=batch.batch_number,
            attribute_value_ids=ids, color_id=cid, batch_id=batch.id,
        )
        disposed += portion

    batch.quality_status = "DISPOSED"
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DISPOSE", "Batch", str(batch.id),
        details=f"Disposed rejected lot {batch.batch_number} ({disposed:g} written off)"
        + (f": {reason}" if reason else ""),
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    batch.item_code = batch.item.code if batch.item else None
    batch.item_name = batch.item.name if batch.item else None
    return batch


@router.post("/{batch_id}/reassign", response_model=BatchResponse)
async def reassign_batch(
    batch_id: uuid.UUID,
    payload: BatchReassign,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lot.qc_reject')),
):
    """Recycle a rejected lot into a **different item** instead of disposing it.

    Reject is not always scrap: a beam rejected for one cloth is often perfectly
    good warp for a coarser one, and the floor re-cycles it rather than writing
    it off. This moves the rejected lot's stock (all of it, or ``qty``) onto a
    new GOOD lot under ``item_id`` — so the goods become normal, pickable,
    nettable stock for the new product — while the rejection itself stays on the
    record: the source lot keeps its reject grade, and the new lot carries both
    ``parent_batch_id`` and a ``BatchConsumption`` row, the same two-way lineage
    a split (``split_batch``) and a leftover beam (``beam_service.dismount``)
    write, so trace-back walks the recycled lot up into the rejected one.

    Deliberately not carried over to the new lot:
    * **variant ids** — attribute values (colour/combo) belong to the source
      item's variant space; the recycled goods land in the no-variant bucket,
      like a manually created lot.
    * **bom_size_snapshot** — size identity comes from the source item's BOM, and
      the ``""`` bucket is substitutable both ways in size-aware netting.
    ``ends`` and ``source_wo_id`` *do* carry: those are physical/origin facts
    about the same goods, and they keep the lot's production origin traceable.
    """
    result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    if not reject_service.is_reject_grade(batch.quality_status):
        raise HTTPException(status_code=400, detail="Only rejected lots can be reassigned to another item")
    if str(payload.item_id) == str(batch.item_id):
        raise HTTPException(status_code=400, detail="Pick a different item — the lot is already this item")

    target = (await db.execute(select(Item).filter(Item.id == payload.item_id))).scalars().first()
    if not target:
        raise HTTPException(status_code=404, detail="Item not found")

    dest_loc = None
    if payload.location_id:
        dest_loc = (await db.execute(
            select(Location).filter(Location.id == payload.location_id)
        )).scalars().first()
        if not dest_loc:
            raise HTTPException(status_code=404, detail="Location not found")

    remaining = await _batch_remaining(db, batch.id)
    if remaining <= 1e-9:
        raise HTTPException(status_code=400, detail="Lot has no remaining stock to reassign")
    qty = float(payload.qty) if payload.qty is not None else remaining
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Reassign qty must be positive")
    if qty > remaining + 1e-9:
        raise HTTPException(status_code=400, detail=f"Reassign qty {qty:g} exceeds remaining {remaining:g}")
    qty = min(qty, remaining)

    reason = (payload.reason or "").strip() or None
    new_lot = Batch(
        batch_number=await generate_batch_number(db, prefix="RCY"),
        item_id=target.id,
        quality_status=reject_service.GOOD,
        source_wo_id=batch.source_wo_id,
        ends=batch.ends,
        parent_batch_id=batch.id,
        notes=(f"Recycled from rejected lot {batch.batch_number}"
               + (f" ({batch.item.code})" if batch.item else "")
               + (f": {reason}" if reason else "")),
        created_by=current_user.username,
    )
    db.add(new_lot)
    await db.flush()

    # Cross-item move: the source rows are posted out under the OLD item (that's
    # where the balance sits) and posted in under the NEW one, per source row so
    # no row can go negative. Same-shape as _move_batch_stock, which can't be
    # reused because it posts both sides against one item_id.
    rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key == str(batch.id), StockBalance.qty > 0)
        .order_by(StockBalance.qty.desc())
    )).scalars().all()
    to_move = qty
    moved = 0.0
    for r in rows:
        if to_move <= 1e-9:
            break
        portion = min(float(r.qty), to_move)
        ids, cid = stock_service._parse_variant_key(r.variant_key)
        await stock_service.add_stock_entry(
            db, item_id=batch.item_id, location_id=r.location_id, qty_change=-portion,
            reference_type="Lot Reassign", reference_id=new_lot.batch_number,
            attribute_value_ids=ids, color_id=cid, batch_id=batch.id,
        )
        await stock_service.add_stock_entry(
            db, item_id=target.id, location_id=(dest_loc.id if dest_loc else r.location_id),
            qty_change=portion, reference_type="Lot Reassign", reference_id=new_lot.batch_number,
            batch_id=new_lot.id,
        )
        to_move -= portion
        moved += portion

    db.add(BatchConsumption(
        input_batch_id=batch.id,
        output_batch_id=new_lot.id,
        qty_consumed=moved,
    ))
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "REASSIGN", "Batch", str(batch.id),
        details=f"Reassigned {moved:g} of rejected lot {batch.batch_number}"
        + (f" ({batch.item.code})" if batch.item else "")
        + f" → new lot {new_lot.batch_number} ({target.code})"
        + (f" at {dest_loc.name}" if dest_loc else "")
        + (f": {reason}" if reason else ""),
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    reloaded = (await db.execute(
        select(Batch).options(joinedload(Batch.item)).filter(Batch.id == new_lot.id)
    )).scalars().first()
    return (await _enrich_batches(db, [reloaded]))[0]


@router.get("/{batch_id}/trace", response_model=BatchTraceResponse)
async def trace_batch_forward(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    """Forward traceability: raw material batch → finished goods batches produced with it."""
    batch_result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = batch_result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")
    batch.item_code = batch.item.code if batch.item else None
    batch.item_name = batch.item.name if batch.item else None

    consumptions_result = await db.execute(
        select(BatchConsumption).filter(BatchConsumption.input_batch_id == batch_id)
    )
    consumptions = consumptions_result.scalars().all()

    # Resolve MO codes and output batch numbers
    mo_ids = [c.manufacturing_order_id for c in consumptions]
    out_batch_ids = [c.output_batch_id for c in consumptions if c.output_batch_id]

    mo_code_map: dict = {}
    if mo_ids:
        mo_rows = await db.execute(
            select(ManufacturingOrder.id, ManufacturingOrder.code)
            .filter(ManufacturingOrder.id.in_(mo_ids))
        )
        mo_code_map = {str(r[0]): r[1] for r in mo_rows.all()}

    out_batch_map: dict = {}
    if out_batch_ids:
        out_rows = await db.execute(
            select(Batch.id, Batch.batch_number)
            .filter(Batch.id.in_(out_batch_ids))
        )
        out_batch_map = {str(r[0]): r[1] for r in out_rows.all()}

    enriched = []
    for c in consumptions:
        resp = BatchConsumptionResponse.model_validate(c)
        resp.mo_code = mo_code_map.get(str(c.manufacturing_order_id))
        if c.output_batch_id:
            resp.output_batch_number = out_batch_map.get(str(c.output_batch_id))
        enriched.append(resp)

    return BatchTraceResponse(
        batch=BatchResponse.model_validate(batch),
        consumptions=enriched,
    )


@router.get("/{batch_id}/trace-back", response_model=BatchTraceBackNode)
async def trace_batch_backward(
    batch_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lot.view", "work_order.view", "stock_on_hand.view", "beam.view", "quarantine.view")),
):
    """Backward genealogy: finished batch → input batches it was made from, recursively."""
    from app.models.manufacturing import ManufacturingOrder

    batch_result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == batch_id))
    batch = batch_result.scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Lot not found")

    async def build_node(b: Batch, depth: int, visited: set) -> dict:
        b.item_code = b.item.code if b.item else None
        b.item_name = b.item.name if b.item else None
        node = {"batch": BatchResponse.model_validate(b), "inputs": []}
        if depth >= 8:
            return node
        cons_result = await db.execute(
            select(BatchConsumption).filter(BatchConsumption.output_batch_id == b.id)
        )
        cons_rows = list(cons_result.scalars().all())
        # Beam-merge consumptions are pegged at MO level (output_batch_id NULL)
        # because beams are consumed at weaving WO start, before any output lot
        # exists — attach them here via this batch's producing WO's MO.
        if b.source_wo_id:
            mo_id = (
                await db.execute(
                    select(WorkOrder.manufacturing_order_id).where(WorkOrder.id == b.source_wo_id)
                )
            ).scalar()
            if mo_id:
                extra = await db.execute(
                    select(BatchConsumption).filter(
                        BatchConsumption.manufacturing_order_id == mo_id,
                        BatchConsumption.output_batch_id.is_(None),
                    )
                )
                cons_rows += list(extra.scalars().all())
        for c in cons_rows:
            key = str(c.input_batch_id)
            if key in visited:
                continue
            visited.add(key)
            in_result = await db.execute(select(Batch).options(joinedload(Batch.item)).filter(Batch.id == c.input_batch_id))
            in_batch = in_result.scalars().first()
            if not in_batch:
                continue
            child = await build_node(in_batch, depth + 1, visited)
            child["qty_consumed"] = float(c.qty_consumed)
            child["manufacturing_order_id"] = c.manufacturing_order_id
            mo_so = aliased(SalesOrder)
            pr_so = aliased(SalesOrder)
            mo_result = await db.execute(
                select(ManufacturingOrder.code, mo_so.po_number, pr_so.po_number)
                .outerjoin(ProductionRun, ProductionRun.id == ManufacturingOrder.production_run_id)
                .outerjoin(mo_so, mo_so.id == ManufacturingOrder.sales_order_id)
                .outerjoin(pr_so, pr_so.id == ProductionRun.sales_order_id)
                .filter(ManufacturingOrder.id == c.manufacturing_order_id)
            )
            mo_row = mo_result.first()
            if mo_row:
                child["mo_code"] = mo_row[0]
                child["sales_order_code"] = mo_row[1] or mo_row[2]
            node["inputs"].append(child)
        return node

    return await build_node(batch, 0, {str(batch.id)})
