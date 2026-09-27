from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, and_
from sqlalchemy.orm import joinedload, selectinload
from app.db.session import get_async_db
from app.core.pagination import PageParams, PageWindow
from uuid import UUID
from app.models.production_run import ProductionRun
from app.models.manufacturing import ManufacturingOrder, MOCompletion, CLOSED_ORDER_STATUSES
from app.models.bom import BOM, BOMLine, BOMSize
from app.models.work_order import WorkOrder as WorkOrderModel
from app.models.location import Location
from app.models.batch import BatchConsumption, Batch
from app.schemas import (
    ProductionRunCreate, ProductionRunResponse,
    PaginatedProductionRunResponse, PaginatedProductionRunListResponse,
    ManufacturingOrderCreate,
    PRMaterialRequirementItem, PRMOContribution, BookingSupplyMO, PRProductionMO,
    ProductionRunPreviewRequest, NettingPreviewNode,
    PRMaterialStatusRequest, PRMaterialStatusItem, PRMaterialLot,
)
from app.models.production_run import PRBomEntry, PRBomEntrySize
from app.models.reservation import StockReservation
from app.models.item import Item
from app.models.stock_balance import StockBalance
from app.models.attribute import AttributeValue
from app.services import stock_service, mrp_service, beam_service
from app.services.netting_service import (
    Availability, preview_production_run,
    SizeResolver, allocate_onhand, onhand_size_rows, token_from_snapshot,
    normalize_size_token,
    _sales_order_linked_prs, _output_committed, rejected_batch_keys,
)
from app.services.stock_service import _generate_variant_key
from collections import defaultdict
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.services import audit_service
from app.core.ws_manager import manager
import uuid
from datetime import datetime

router = APIRouter()

# Quantities are shown to 2 decimals, so every qty verdict must be decided at that
# precision — not against a bare 0. Percentage scaling times a tolerance multiplier
# leaves float residue around 1e-13, which `> 0` happily calls a shortage: rows
# rendered as "SHORT 0.00", red for a gap of nothing. Compare against this instead.
_QTY_EPS = 0.005


from app.services.mrp_service import MO_CODE_MAX_LEN  # noqa: E402  (String(128) on MO.code)

_MO_CODE_UNIQ_RESERVE = 4     # room for the "-NNN" suffix _find_unique_mo_code appends
_MO_CODE_SIZE_MAX = 24        # 'free' size labels are String(128); cap their share


def _compose_mo_code(pr_code: str, *, index: str = "", size_label: str = "") -> str:
    """Compose a root MO code as `PR code[-line index][-size]`.

    Deliberately carries no recipe identity. The BOM used to be spelled into the
    code, which duplicated `MO.bom_id` as a string and pushed real codes past the
    column (a 3-recipe run over combo BOMs minted 78 chars and failed the whole
    create with StringDataRightTruncationError). Recipe, combo and colour are
    fields on the order and are what the UI reads; the code only has to identify
    *which line of which run* this order is, which is exactly what stays unique
    and stable. Free-mode size labels are user text (String(128)), so the size
    share is capped and the whole result clamped — belt and braces on top of the
    widened column, not the thing keeping it in range."""
    parts = [p for p in (pr_code, index, size_label[:_MO_CODE_SIZE_MAX]) if p]
    return "-".join(parts)[:MO_CODE_MAX_LEN - _MO_CODE_UNIQ_RESERVE]


async def _find_unique_mo_code(db: AsyncSession, candidate: str) -> str:
    """Return candidate if unused, otherwise append -02, -03, ... until unique."""
    candidate = candidate[:MO_CODE_MAX_LEN - _MO_CODE_UNIQ_RESERVE]
    existing = await db.execute(
        select(ManufacturingOrder.id).filter(ManufacturingOrder.code == candidate).limit(1)
    )
    if existing.scalars().first() is None:
        return candidate
    n = 2
    while True:
        suffix = f"-{n:02d}"
        new_candidate = candidate[:MO_CODE_MAX_LEN - len(suffix)] + suffix
        existing = await db.execute(
            select(ManufacturingOrder.id).filter(ManufacturingOrder.code == new_candidate).limit(1)
        )
        if existing.scalars().first() is None:
            return new_candidate
        n += 1



def _bom_load_options():
    return [
        joinedload(BOM.item),
        joinedload(BOM.customer),
        joinedload(BOM.work_center),
        selectinload(BOM.attribute_values),
        selectinload(BOM.lines).selectinload(BOMLine.item),
        selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(BOM.operations),
        selectinload(BOM.sizes).selectinload(BOMSize.size),
    ]

def _pr_load_options():
    mos = selectinload(ProductionRun.manufacturing_orders)
    entries = selectinload(ProductionRun.bom_entries)
    return [
        # Originating Sales Order (for lineage display)
        joinedload(ProductionRun.sales_order),
        # Legacy single-bom field (backward compat for old PRs)
        joinedload(ProductionRun.bom).options(*_bom_load_options()),
        # New multi-bom entries
        entries.joinedload(PRBomEntry.bom).options(*_bom_load_options()),
        entries.selectinload(PRBomEntry.sizes),
        mos.selectinload(ManufacturingOrder.item),
        mos.selectinload(ManufacturingOrder.attribute_values),
        mos.selectinload(ManufacturingOrder.child_mos),
        mos.selectinload(ManufacturingOrder.required_dependencies),
        mos.selectinload(ManufacturingOrder.completions),
        mos.selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
        mos.selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
        mos.selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.work_center),
        mos.selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.completions),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.item),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.attribute_values),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.customer),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.work_center),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.operations),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.sizes).selectinload(BOMSize.size),
        mos.selectinload(ManufacturingOrder.planned_components),
    ]


def _pr_list_load_options():
    """Eager-load set for the Production Runs LIST view (serialized via
    ProductionRunListItem). Identical to _pr_load_options for the MO branch EXCEPT
    it omits the two heaviest, list-unused pieces: each MO's deep BOM sub-tree
    (bom.item/customer/work_center/lines/lines.item/lines.attribute_values/
    operations/sizes) and planned_components. The BOM/entry BOMs are loaded shallow
    (item only) — enough for the code/item_name/item_code the list renders — instead
    of the full nested tree. Everything the SO-page PR-dedup and the MO-page
    shared-component tree read (work_orders, completions, child_mos,
    required_dependencies, batch_consumptions, item, attribute_values, all scalars)
    is retained."""
    mos = selectinload(ProductionRun.manufacturing_orders)
    return [
        joinedload(ProductionRun.sales_order),
        # Legacy single-bom fallback + multi-bom entries — shallow (item only)
        joinedload(ProductionRun.bom).joinedload(BOM.item),
        selectinload(ProductionRun.bom_entries).joinedload(PRBomEntry.bom).joinedload(BOM.item),
        # MO branch: everything except the deep bom tree + planned_components
        mos.selectinload(ManufacturingOrder.item),
        mos.selectinload(ManufacturingOrder.attribute_values),
        mos.selectinload(ManufacturingOrder.child_mos),
        mos.selectinload(ManufacturingOrder.required_dependencies),
        mos.selectinload(ManufacturingOrder.completions),
        mos.selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
        mos.selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
        mos.selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.work_center),
        mos.selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.completions),
    ]


def _pr_material_req_load_options():
    """Minimal eager-load set for the /material-requirements endpoint. Called once
    per visible PR row on the Production Runs page, so it must stay lean. Loads ONLY
    what the requirements aggregation (mo.qty, mo.planned_components, mo.bom.tolerance,
    mo.attribute_values for the supply variant key) and _bom_traversal_order
    (mo.bom.operations, mo.required_dependencies, mo.is_shared_component, mo.bom_id)
    actually read — NOT the full nested MO tree that _pr_load_options pulls for the
    list view. Item + StockBalance are fetched separately in the endpoint, so no
    bom.lines / bom.item / batch_consumptions / bom_entries here.

    `completions` and `work_orders` are deliberately NOT eager-loaded: the endpoint
    reduces each to a single scalar (good logged qty / WO count) and reads them via
    `_mo_output_aggregates` instead. Those two tables only ever grow with floor
    activity, so hydrating every row made this panel slower every week for two
    numbers per MO."""
    mos = selectinload(ProductionRun.manufacturing_orders)
    return [
        mos.selectinload(ManufacturingOrder.planned_components),
        mos.selectinload(ManufacturingOrder.required_dependencies),
        mos.selectinload(ManufacturingOrder.attribute_values),
        mos.selectinload(ManufacturingOrder.bom).selectinload(BOM.operations),
    ]


async def _mo_output_aggregates(db: AsyncSession, mo_ids: list) -> tuple[dict, dict]:
    """(good logged qty, WO count) per MO id, as two GROUP BY passes.

    Exactly what `sum(c.qty_completed for c in mo.completions if not c.rejected)` and
    `len(mo.work_orders)` returned — `rejected.isnot(True)` keeps a NULL flag counted
    as good, matching the Python `not c.rejected` it replaces. MOs with no rows are
    simply absent from the maps; callers default them to 0."""
    if not mo_ids:
        return {}, {}
    produced: dict = {}
    for mid, qty in (await db.execute(
        select(MOCompletion.mo_id, func.sum(MOCompletion.qty_completed))
        .where(MOCompletion.mo_id.in_(mo_ids), MOCompletion.rejected.isnot(True))
        .group_by(MOCompletion.mo_id)
    )).all():
        produced[mid] = float(qty or 0)
    wo_counts: dict = {}
    for mid, n in (await db.execute(
        select(WorkOrderModel.manufacturing_order_id, func.count())
        .where(WorkOrderModel.manufacturing_order_id.in_(mo_ids))
        .group_by(WorkOrderModel.manufacturing_order_id)
    )).all():
        wo_counts[mid] = int(n or 0)
    return produced, wo_counts


def _post_process_pr(pr: ProductionRun):
    """Populate all calculated fields on every MO within a PR after eager loading."""
    from app.api.manufacturing import populate_mo_ids
    # Populate originating SO code (eager-loaded via _pr_load_options)
    pr.sales_order_code = pr.sales_order.po_number if pr.sales_order else None
    for mo in pr.manufacturing_orders:
        populate_mo_ids(mo)

@router.get("/production-runs/available-code")
async def get_available_pr_code(
    base: str = "PR",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("production_run.view", "manufacturing_order.view")),
):
    counter = 1
    while True:
        code = f"{base}-{counter:05d}"
        result = await db.execute(select(ProductionRun).filter(ProductionRun.code == code))
        if not result.scalars().first():
            return {"code": code}
        counter += 1

@router.get("/production-runs", response_model=PaginatedProductionRunListResponse)
async def list_production_runs(
    search: str | None = None,
    has_sales_order: bool | None = None,
    progress: str | None = None,
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("production_run.view", "manufacturing_order.view")),
):
    conditions = []
    if has_sales_order is True:
        conditions.append(ProductionRun.sales_order_id.isnot(None))
    elif has_sales_order is False:
        conditions.append(ProductionRun.sales_order_id.is_(None))

    if progress in ("complete", "incomplete"):
        # Mirrors the PR list's Progress column exactly: done = COMPLETED or
        # DELIVERED (delivered = qty met, order simply not closed yet), counted
        # over ALL of the run's MOs including shared component MOs. A run with no
        # MOs at all is 0% — never "complete".
        mo_base = select(ManufacturingOrder.id).where(
            ManufacturingOrder.production_run_id == ProductionRun.id
        )
        has_any_mo = mo_base.exists()
        has_open_mo = mo_base.where(
            ManufacturingOrder.status.notin_(("COMPLETED", "DELIVERED"))
        ).exists()
        if progress == "complete":
            conditions.append(and_(has_any_mo, ~has_open_mo))
        else:
            conditions.append(or_(~has_any_mo, has_open_mo))

    if search and search.strip():
        like = f"%{search.strip()}%"
        # Match by entry BOM code / item name / item code (multi-BOM path)
        entry_match = (
            select(PRBomEntry.id)
            .join(BOM, BOM.id == PRBomEntry.bom_id)
            .join(Item, Item.id == BOM.item_id)
            .where(
                PRBomEntry.pr_id == ProductionRun.id,
                or_(BOM.code.ilike(like), Item.name.ilike(like), Item.code.ilike(like)),
            )
            .exists()
        )
        # Match by directly-linked BOM (legacy single-BOM path)
        legacy_match = (
            select(BOM.id)
            .join(Item, Item.id == BOM.item_id)
            .where(
                BOM.id == ProductionRun.bom_id,
                or_(BOM.code.ilike(like), Item.name.ilike(like), Item.code.ilike(like)),
            )
            .exists()
        )
        conditions.append(or_(ProductionRun.code.ilike(like), entry_match, legacy_match))

    count_query = select(func.count()).select_from(ProductionRun)
    list_query = (
        select(ProductionRun)
        .options(*_pr_list_load_options())
        .order_by(ProductionRun.created_at.desc())
    )
    if conditions:
        count_query = count_query.where(*conditions)
        list_query = list_query.where(*conditions)
    count_result = await db.execute(count_query)
    total = count_result.scalar()
    result = await db.execute(window.apply(list_query))
    prs = result.unique().scalars().all()
    for pr in prs:
        _post_process_pr(pr)
    return window.envelope(prs, total)

def _bom_traversal_order(pr) -> dict[tuple, int]:
    """DFS from root MOs → component MOs via required_dependencies.
    Components within each MO are ordered by BOMOperation.sequence.
    Returns {(item_id_str, attr_key): rank} for top-down BOM ordering."""
    mo_map = {mo.id: mo for mo in pr.manufacturing_orders}

    op_seq: dict = {}
    for mo in pr.manufacturing_orders:
        if mo.bom and mo.bom.operations:
            op_seq[mo.bom_id] = {op.id: int(op.sequence) for op in mo.bom.operations}

    visited_keys: set = set()
    visited_mo_ids: set = set()
    order: list = []

    def visit_mo(mo):
        if mo.id in visited_mo_ids:
            return
        visited_mo_ids.add(mo.id)

        seq_map = op_seq.get(mo.bom_id, {})

        def comp_key(c):
            return seq_map.get(c.bom_operation_id, 9999) if c.bom_operation_id else 9999

        for comp in sorted(mo.planned_components, key=comp_key):
            attr_ids = sorted(str(a) for a in (comp.attribute_value_ids or []))
            key = (str(comp.item_id), ",".join(attr_ids))
            if key not in visited_keys:
                visited_keys.add(key)
                order.append(key)

        for dep in (mo.required_dependencies or []):
            child_mo = mo_map.get(dep.required_mo_id)
            if child_mo:
                visit_mo(child_mo)

    for mo in pr.manufacturing_orders:
        if not mo.is_shared_component:
            visit_mo(mo)
    # Safety net: catch MOs not reachable from roots
    for mo in pr.manufacturing_orders:
        visit_mo(mo)

    return {key: i for i, key in enumerate(order)}


@router.get("/production-runs/{pr_id}/material-requirements", response_model=list[PRMaterialRequirementItem])
async def get_production_run_material_requirements(
    pr_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("production_run.view", "manufacturing_order.view")),
):
    result = await db.execute(
        select(ProductionRun).options(*_pr_material_req_load_options()).filter(ProductionRun.id == pr_id)
    )
    pr = result.unique().scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")

    # Aggregate requirements plant-wide: key = (item_id, attr_key, size_token).
    # Location is not part of the key (location-agnostic netting) but SIZE is — a
    # 67 cm M roll is not XL stock, and the MRP ledger + /booking-stock bucket the
    # same way, so all three surfaces have to agree.
    #
    # Demand is OUTSTANDING-based, mirroring _compute_booking_rows in api/stock.py:
    # a component is scaled by its MO's REMAINING output (qty - good completions),
    # not by the full order qty. Without this, requirement stays frozen at the full
    # order while on-hand drains as the run consumes it, so every made-in-house
    # component drifts into a phantom shortfall that grows with progress (a beam
    # fully built AND fully consumed as planned would read as short by its own
    # requirement). Material already issued to this PR must stop counting as needed.
    # gross_required is kept alongside as the un-netted reference figure.
    agg: dict[tuple, dict] = defaultdict(lambda: {
        "total_required": 0.0, "gross_required": 0.0, "mo_contributions": [],
    })
    # Incoming: the outstanding output of this PR's own MOs that produce a demanded
    # item (the component/greige/beam MOs). Scoped to this PR on purpose — a
    # cross-PR sweep would credit supply another PR's demand is already claiming;
    # /booking-stock is the plant-wide demand-vs-supply view.
    supply: dict[tuple, dict] = defaultdict(lambda: {"total_incoming": 0.0, "contributions": []})
    # Production progress: good logged output of this PR's MOs, keyed the same way as
    # supply. Lets the PR panel show "requirement vs what has actually been made" per
    # component, so the whole run can be monitored without opening each MO.
    production: dict[tuple, dict] = defaultdict(lambda: {"qty_produced": 0.0, "wo_count": 0, "mos": []})

    so_linked_prs = await _sales_order_linked_prs(db, pr.manufacturing_orders)
    produced_by_mo, wo_count_by_mo = await _mo_output_aggregates(
        db, [mo.id for mo in pr.manufacturing_orders]
    )
    # Same resolver the MRP ledger and booking stock use — a private copy of the
    # "which size will this component be" rule is how these surfaces drift apart.
    sizes = await SizeResolver.create(db)
    await sizes.load_items(
        db, {c.item_id for mo in pr.manufacturing_orders for c in mo.planned_components}
    )

    for mo in pr.manufacturing_orders:
        produced = produced_by_mo.get(mo.id, 0.0)
        # Closed orders make no more output and consume no more material.
        if mo.status in CLOSED_ORDER_STATUSES:
            outstanding = 0.0
        else:
            outstanding = max(0.0, float(mo.qty) - produced)

        tol = float(mo.bom.tolerance_percentage or 0) if mo.bom else 0

        out_key = _generate_variant_key(
            [str(v.id) for v in (mo.attribute_values or [])], getattr(mo, "color_id", None)
        )
        mo_token = token_from_snapshot(mo.bom_size_snapshot)
        # WOs are created MANUALLY (an MO existing never means work has begun), so a
        # producing MO with no WO yet is a dispatch action, not a floor delay. Counted
        # here so the row can say NO WO instead of a misleading IN PROGRESS.
        wo_count = wo_count_by_mo.get(mo.id, 0)
        p = production[(str(mo.item_id), out_key, mo_token)]
        p["qty_produced"] += produced
        p["wo_count"] += wo_count
        p["mos"].append(PRProductionMO(
            mo_id=mo.id, mo_code=mo.code, mo_qty=float(mo.qty), qty_produced=produced,
            wo_count=wo_count,
            status=("NOT_STARTED" if produced <= _QTY_EPS
                    else ("OK" if produced >= float(mo.qty) - _QTY_EPS else "SHORT")),
        ))

        for comp in mo.planned_components:
            if not comp.percentage and not comp.qty:
                continue

            def _scale(basis: float) -> float:
                r = (basis * float(comp.percentage)) / 100 if comp.percentage else basis * float(comp.qty)
                return r * (1 + tol / 100) if tol > 0 else r

            gross = _scale(float(mo.qty))
            req = _scale(outstanding)

            attr_ids = sorted(comp.attribute_value_ids)
            attr_key = ",".join(attr_ids)
            comp_token = sizes.component_token(comp.item_id, mo_token)
            key = (str(comp.item_id), attr_key, comp_token)

            agg[key]["item_id"] = comp.item_id
            agg[key]["attr_ids"] = attr_ids
            agg[key]["size_token"] = comp_token
            agg[key]["total_required"] += req
            agg[key]["gross_required"] += gross
            agg[key]["mo_contributions"].append(PRMOContribution(
                mo_id=mo.id,
                mo_code=mo.code,
                mo_qty=float(mo.qty),
                required_qty=req,
                gross_required_qty=gross,
                mo_outstanding_qty=outstanding,
            ))

        # Committed-supply rule (same as booking stock): an SO-linked root MO's
        # output is promised to that order and is not free supply. Component MOs
        # always supply — their output is exactly what the demand above consumes.
        if outstanding <= 0 or _output_committed(mo, so_linked_prs):
            continue
        s = supply[(str(mo.item_id), out_key, mo_token)]
        s["total_incoming"] += outstanding
        s["contributions"].append(BookingSupplyMO(
            mo_id=mo.id, mo_code=mo.code, mo_qty=float(mo.qty), incoming_qty=outstanding,
        ))

    if not agg:
        return []

    # Batch-fetch items
    item_ids = {v["item_id"] for v in agg.values()}
    item_result = await db.execute(select(Item).filter(Item.id.in_(item_ids)))
    item_map = {i.id: i for i in item_result.scalars().all()}

    # Plant-wide on-hand: sum StockBalance across ALL locations per (item, variant_key).
    # QC-rejected / disposed lot stock is physically present but never good stock.
    onhand_rows = await onhand_size_rows(db, item_ids)
    onhand_map: dict[tuple, float] = defaultdict(float)        # (item, vkey) -> {tok: qty}
    onhand_buckets: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    onhand_by_item: dict[str, float] = defaultdict(float)
    onhand_item_buckets: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    for (iid, vk, tok), q in onhand_rows.items():
        onhand_map[(iid, vk)] += q
        onhand_buckets[(iid, vk)][tok] += q
        onhand_by_item[iid] += q
        onhand_item_buckets[iid][tok] += q

    # Lots behind the on-hand figure. A Dyeing PIC checking "can I dye this run?"
    # picks a physical roll, not a number, and one 40 kg total can be four lots in
    # four bins. Batch-less (non-lotted) stock simply contributes no rows.
    # Two steps on purpose. Joining Batch as `cast(Batch.id, String) = batch_key`
    # casts away the PK index, so Postgres hashes the whole batches table on every
    # expand — a cost that grows with lot history for a column that is only a
    # display label. Group the balances first (indexed), then look the numbers up by
    # primary key. Same grouping (item, batch, location name) and same fallback to
    # the raw key when a batch row is missing, so the rows and quantities are
    # unchanged.
    lots_by_item: dict[tuple, list] = defaultdict(list)
    lot_rows = (await db.execute(
        select(StockBalance.item_id, StockBalance.batch_key, func.sum(StockBalance.qty),
               Location.name)
        .outerjoin(Location, Location.id == StockBalance.location_id)
        .where(
            StockBalance.item_id.in_(item_ids),
            StockBalance.qty > 0,
            StockBalance.batch_key != "",
            StockBalance.batch_key.not_in(rejected_batch_keys()),
        )
        .group_by(StockBalance.item_id, StockBalance.batch_key, Location.name)
    )).all()
    batch_uuids = set()
    for _, bkey, _, _ in lot_rows:
        try:
            batch_uuids.add(UUID(bkey))
        except (ValueError, AttributeError, TypeError):
            continue  # non-UUID key: the old cast-join matched nothing either
    batch_numbers: dict[str, str] = {}
    batch_tokens: dict[str, str] = {}
    if batch_uuids:
        for bid, bnum, snap in (await db.execute(
            select(Batch.id, Batch.batch_number, Batch.bom_size_snapshot)
            .where(Batch.id.in_(batch_uuids))
        )).all():
            batch_numbers[str(bid)] = bnum
            batch_tokens[str(bid)] = token_from_snapshot(snap)
    # Keyed by (item, size token): a row that nets only XL must not list the M
    # lots as if the PIC could pull them.
    for iid, bkey, qty, loc_name in lot_rows:
        lots_by_item[(str(iid), batch_tokens.get(bkey, ""))].append(PRMaterialLot(
            batch_id=bkey, batch_number=batch_numbers.get(bkey) or bkey,
            qty=float(qty or 0), location_name=loc_name,
        ))

    # Plant-wide demand from OTHER orders, so "Available" cannot promise the same
    # greige to two runs. Read off the shared Booking Stock cache rather than a
    # second netting pass — a private copy of this maths would drift from the
    # /booking-stock page it has to agree with.
    from app.api.stock import booking_rows_cached
    own_mo_ids = {str(m.id) for m in pr.manufacturing_orders}
    claimed_elsewhere: dict[tuple, float] = {}
    for brow in await booking_rows_cached():
        own = sum(float(d.required_qty) for d in (brow.demand_mos or [])
                  if str(d.mo_id) in own_mo_ids)
        key = (str(brow.item_id), ",".join(sorted(str(a) for a in brow.attribute_value_ids)),
               normalize_size_token(brow.size_label))
        claimed_elsewhere[key] = max(0.0, float(brow.qty_required) - own)

    # The generic "" pile is shared across an item's size rows, so hand it out once
    # (biggest need first) instead of showing it in full on each — see
    # netting_service.allocate_onhand. Batch-identity items match by item alone.
    allocated_available: dict[tuple, float] = {}
    groups: dict[tuple, list] = defaultdict(list)
    for key in agg:
        item = item_map.get(agg[key]["item_id"])
        is_bi = bool(item and (item.lot_tracked or beam_service.is_beam_item(item)))
        groups[(key[0], "" if is_bi else key[1], is_bi)].append(key)
    for (item_id_str, vk, is_bi), keys in groups.items():
        buckets = onhand_item_buckets[item_id_str] if is_bi else onhand_buckets[(item_id_str, vk)]
        allocated = allocate_onhand(
            dict(buckets), [(k[2], agg[k]["total_required"]) for k in keys]
        )
        for k, qty in zip(keys, allocated):
            allocated_available[k] = qty

    results = []
    for key, data in agg.items():
        item_id_str, attr_key, size_tok = key
        item = item_map.get(data["item_id"])
        # Batch/lot-identity items (beams, lot-tracked items) never stamp variant
        # attrs on their stock rows (variant_key is always "" — the batch itself is
        # the identity), so match plant-wide on-hand by item only, not by variant.
        is_batch_identity = bool(item and (item.lot_tracked or beam_service.is_beam_item(item)))
        v_key = ",".join(sorted(data["attr_ids"]))
        available = allocated_available.get(key, 0.0)
        # What is left of that on-hand once every OTHER open order's outstanding
        # demand is honoured. This is the number a PIC should act on: "Available"
        # alone says 500 kg to three runs that each need 400.
        others = claimed_elsewhere.get((item_id_str, v_key, size_tok), 0.0)
        if is_batch_identity and not others:
            others = claimed_elsewhere.get((item_id_str, "", size_tok), 0.0)
        free = max(0.0, available - others)
        sup = supply.get((item_id_str, v_key, size_tok))
        incoming = sup["total_incoming"] if sup else 0.0
        total = data["total_required"]
        # Production progress vs the FIXED (full-order) requirement — the figure the
        # floor plans against. Only meaningful when this PR actually makes the item;
        # a purchased/stocked component has no producing MO and stays at 0.
        prod = production.get((item_id_str, v_key, size_tok))
        produced = prod["qty_produced"] if prod else 0.0
        prod_short = max(0.0, data["gross_required"] - produced) if prod else 0.0

        # One verdict per row. Material shortage outranks production progress: a red
        # status must mean "someone has to act", never "a healthy run isn't finished
        # yet" — otherwise every in-flight component reads as an alarm and the
        # column stops carrying information. Nothing logged yet is NOT "in progress":
        # it splits into NO_WO (no work order opened — a dispatch decision) vs
        # NOT_STARTED (WO opened, floor hasn't logged). Every test uses _QTY_EPS.
        mat_short = max(0.0, total - available - incoming)
        if mat_short > _QTY_EPS:
            status = "SHORT"
        elif not prod:
            status = "SUPPLIED"       # bought / drawn from stock, and covered
        elif prod_short <= _QTY_EPS:
            status = "DONE"
        elif produced > _QTY_EPS:
            status = "IN_PROGRESS"
        else:
            status = "NOT_STARTED" if prod["wo_count"] > 0 else "NO_WO"
        # Snap sub-precision residue to a clean zero so no consumer re-derives a
        # phantom gap from the raw floats.
        if mat_short <= _QTY_EPS:
            mat_short = 0.0
        if prod_short <= _QTY_EPS:
            prod_short = 0.0

        results.append(PRMaterialRequirementItem(
            item_id=data["item_id"],
            item_code=item.code if item else str(data["item_id"]),
            item_name=item.name if item else str(data["item_id"]),
            uom=item.uom if item else "",
            ends=item.ends if item else None,
            attribute_value_ids=[UUID(a) for a in data["attr_ids"]],
            size_label=sizes.label_for_token(size_tok),
            qty_claimed_elsewhere=others,
            qty_free=free,
            # Biggest lots first, batch number breaking ties: without the tiebreak the
            # cut at 12 falls between equal-qty lots in whatever order the rows came
            # back, so the same item could list a different dozen after a restart.
            lots=sorted(lots_by_item.get((item_id_str, size_tok), []),
                        key=lambda l: (-l.qty, l.batch_number))[:12],
            location_id=item.default_source_location_id if item else None,
            total_required=total,
            gross_required=data["gross_required"],
            qty_available=available,
            qty_incoming=incoming,
            shortfall=mat_short,
            qty_produced=produced,
            production_shortfall=prod_short,
            status=status,
            mo_contributions=data["mo_contributions"],
            supply_mos=sup["contributions"] if sup else [],
            production_mos=prod["mos"] if prod else [],
        ))

    bom_order = _bom_traversal_order(pr)
    results.sort(key=lambda r: (
        bom_order.get(
            (str(r.item_id), ",".join(sorted(str(a) for a in r.attribute_value_ids))),
            9999,
        ),
        r.item_code,
        r.size_label or "",
    ))
    return results


@router.post("/production-runs/material-status", response_model=list[PRMaterialStatusItem])
async def get_production_runs_material_status(
    payload: PRMaterialStatusRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Lightweight per-PR material summary (component counts + how many are short)
    for the Production Runs LIST 'Materials' column. Replaces the old per-row
    /material-requirements fan-out (one heavy call per visible row) with ONE batched
    call: components netted in a single pass, on-hand summed in a single StockBalance
    query. Netting math MUST stay in sync with get_production_run_material_requirements
    above — same required/tolerance formula, same plant-wide on-hand match — so the
    column counts match the expand-row detail exactly."""
    if not payload.pr_ids:
        return []

    result = await db.execute(
        select(ProductionRun)
        .options(
            selectinload(ProductionRun.manufacturing_orders).selectinload(ManufacturingOrder.planned_components),
            # completions are reduced to one scalar per MO — aggregated below instead
            # of hydrated (this call covers a whole page of PRs, so it is the worst
            # place in the app to load a growing log table row by row).
            selectinload(ProductionRun.manufacturing_orders).selectinload(ManufacturingOrder.attribute_values),
            selectinload(ProductionRun.manufacturing_orders).selectinload(ManufacturingOrder.bom),
        )
        .filter(ProductionRun.id.in_([str(i) for i in payload.pr_ids]))
    )
    prs = result.unique().scalars().all()

    # Per-PR aggregate: key = (item_id, attr_key, size_token) -> total_required
    # (mirrors the single-PR endpoint's `agg`, including OUTSTANDING-based demand,
    # the size bucket and the PR's own incoming supply). Collect all item_ids for
    # one batched on-hand query.
    per_pr_agg: dict[str, dict[tuple, float]] = {}
    per_pr_supply: dict[str, dict[tuple, float]] = {}
    all_item_ids: set = set()
    all_mos = [mo for pr in prs for mo in pr.manufacturing_orders]
    so_linked_prs = await _sales_order_linked_prs(db, all_mos)
    # Same aggregate the detail endpoint uses, so both sides keep computing
    # outstanding off an identical "good logged qty" figure.
    produced_by_mo, _ = await _mo_output_aggregates(db, [mo.id for mo in all_mos])
    sizes = await SizeResolver.create(db)
    await sizes.load_items(db, {c.item_id for mo in all_mos for c in mo.planned_components})
    for pr in prs:
        agg: dict[tuple, float] = defaultdict(float)
        sup: dict[tuple, float] = defaultdict(float)
        for mo in pr.manufacturing_orders:
            if mo.status in CLOSED_ORDER_STATUSES:
                outstanding = 0.0
            else:
                completed = produced_by_mo.get(mo.id, 0.0)
                outstanding = max(0.0, float(mo.qty) - completed)
            tol = float(mo.bom.tolerance_percentage or 0) if mo.bom else 0
            mo_token = token_from_snapshot(mo.bom_size_snapshot)
            for comp in mo.planned_components:
                if not comp.percentage and not comp.qty:
                    continue
                req = (outstanding * float(comp.percentage)) / 100 if comp.percentage else outstanding * float(comp.qty)
                if tol > 0:
                    req *= (1 + tol / 100)
                attr_key = ",".join(sorted(comp.attribute_value_ids))
                agg[(str(comp.item_id), attr_key, sizes.component_token(comp.item_id, mo_token))] += req
                all_item_ids.add(comp.item_id)
            if outstanding > 0 and not _output_committed(mo, so_linked_prs):
                out_key = _generate_variant_key(
                    [str(v.id) for v in (mo.attribute_values or [])], getattr(mo, "color_id", None)
                )
                sup[(str(mo.item_id), out_key, mo_token)] += outstanding
        per_pr_agg[str(pr.id)] = agg
        per_pr_supply[str(pr.id)] = sup

    # Plant-wide on-hand, one query for every item across every requested PR.
    onhand_buckets: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    onhand_item_buckets: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    item_map: dict[str, Item] = {}
    if all_item_ids:
        for (iid, vk, tok), q in (await onhand_size_rows(db, all_item_ids)).items():
            onhand_buckets[(iid, vk)][tok] += q
            onhand_item_buckets[iid][tok] += q
        item_result = await db.execute(select(Item).filter(Item.id.in_(all_item_ids)))
        item_map = {str(i.id): i for i in item_result.scalars().all()}

    out: list[PRMaterialStatusItem] = []
    for pr_id, agg in per_pr_agg.items():
        short = suff = 0
        sup = per_pr_supply.get(pr_id, {})
        # Same shared-pool allocation as the detail endpoint, per PR, so the column
        # badge cannot count a component sufficient that the panel calls short.
        groups: dict[tuple, list] = defaultdict(list)
        for key in agg:
            item = item_map.get(key[0])
            is_bi = bool(item and (item.lot_tracked or beam_service.is_beam_item(item)))
            groups[(key[0], "" if is_bi else key[1], is_bi)].append(key)
        avail_by_key: dict[tuple, float] = {}
        for (item_id_str, vk, is_bi), keys in groups.items():
            buckets = onhand_item_buckets[item_id_str] if is_bi else onhand_buckets[(item_id_str, vk)]
            for k, qty in zip(keys, allocate_onhand(dict(buckets), [(k[2], agg[k]) for k in keys])):
                avail_by_key[k] = qty
        for key, total in agg.items():
            # Same epsilon as the detail endpoint — otherwise float residue counts a
            # zero-gap component as short and the column badge contradicts the panel.
            if total - avail_by_key.get(key, 0.0) - sup.get(key, 0.0) > _QTY_EPS:
                short += 1
            else:
                suff += 1
        out.append(PRMaterialStatusItem(
            pr_id=UUID(pr_id), total_count=short + suff,
            shortfall_count=short, sufficient_count=suff,
        ))
    return out


@router.post("/production-runs/preview", response_model=list[NettingPreviewNode])
async def preview_production_run_plan(
    payload: ProductionRunPreviewRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('production_run.create')),
):
    """Dry-run: shows the netting plan (per component: net-from location, gross,
    net-free, net qty, decision) for a PR before it is created. Creates nothing."""
    if not payload.bom_entries:
        return []
    location = None
    if payload.location_code:
        loc_result = await db.execute(select(Location).filter(Location.code == payload.location_code))
        location = loc_result.scalars().first()
    source_location = None
    if payload.source_location_code:
        src_result = await db.execute(select(Location).filter(Location.code == payload.source_location_code))
        source_location = src_result.scalars().first()
    return await preview_production_run(
        db, payload.bom_entries, location, source_location, exclude_pr_id=payload.exclude_pr_id
    )


@router.post("/production-runs", response_model=ProductionRunResponse)
async def create_production_run(
    payload: ProductionRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('production_run.create')),
):
    if not payload.bom_entries:
        raise HTTPException(status_code=400, detail="At least one BOM entry is required")

    # Locations are optional. Output follows the WO output location; source follows
    # the item-master default / BOM-line override (resolved at staging).
    location = None
    if payload.location_code:
        loc_result = await db.execute(select(Location).filter(Location.code == payload.location_code))
        location = loc_result.scalars().first()
        if not location:
            raise HTTPException(status_code=404, detail=f"Location '{payload.location_code}' not found")

    source_location = None
    if payload.source_location_code:
        src_result = await db.execute(select(Location).filter(Location.code == payload.source_location_code))
        source_location = src_result.scalars().first()

    # Validate code uniqueness
    existing = await db.execute(select(ProductionRun).filter(ProductionRun.code == payload.code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Production Run code already exists")

    pr = ProductionRun(
        code=payload.code,
        bom_id=None,
        sales_order_id=payload.sales_order_id,
        location_id=location.id if location else None,
        source_location_id=source_location.id if source_location else None,
        status="PENDING",
        notes=payload.notes,
        target_start_date=payload.target_start_date,
        target_end_date=payload.target_end_date,
    )
    db.add(pr)
    await db.flush()

    # ── Pass 1: For each BOM entry, create root MO(s) ─────────────────────────
    # Net-free ledger excludes this PR's own root MOs (their demand IS the gross
    # we net); built up-front so root netting (this pass) and component netting
    # (Pass 2) share one running ledger and can't double-claim the same stock.
    availability = await Availability.create(db, exclude_pr_id=pr.id)
    bom_ro_pairs: list[tuple] = []  # [(bom, [root_mos])]
    total_root_mo_count = 0

    # Coverage taken from stock is promised to this run's sales order. Without a
    # row here the covered qty produces no MO and therefore leaves NO trace, so
    # the next order's netting sees the same physical pile as free and plans
    # short too — the whole point of the reservation table.
    #
    # Only for SO-linked runs: a stock-build PR (no sales_order_id) nets exactly
    # as before, because its coverage is not promised to anybody. And only for
    # ROOT finished goods — a netted-away component belongs to no single order,
    # and its consuming MO already carries the demand that shields it.
    reservations: list[StockReservation] = []

    def _reserve(covered: float, bom, root_attrs, bom_entry, pr_entry, bom_size_id=None):
        if not payload.sales_order_id or covered <= 0:
            return
        reservations.append(StockReservation(
            sales_order_id=payload.sales_order_id,
            production_run_id=pr.id,
            pr_bom_entry_id=pr_entry.id,
            item_id=bom.item_id,
            # Same key the netting read and the same key StockBalance stores, so
            # the row joins on-hand directly. Deriving it any other way here is
            # how the reserved qty would silently miss its own stock.
            variant_key=_generate_variant_key(root_attrs, bom_entry.color_id),
            attribute_value_ids=[str(a) for a in root_attrs],
            color_id=bom_entry.color_id,
            bom_size_id=bom_size_id,
            qty=covered,
            created_by_id=current_user.id,
        ))

    for entry_idx, bom_entry in enumerate(payload.bom_entries):
        bom_result = await db.execute(
            select(BOM).options(joinedload(BOM.item), selectinload(BOM.attribute_values))
            .filter(BOM.id == bom_entry.bom_id)
        )
        bom = bom_result.scalars().first()
        if not bom:
            raise HTTPException(status_code=404, detail=f"BOM {bom_entry.bom_id} not found")

        pr_entry = PRBomEntry(
            pr_id=pr.id,
            bom_id=bom.id,
            total_qty=bom_entry.total_qty,
            attribute_value_ids=[str(v) for v in (bom_entry.attribute_value_ids or [])],
            color_id=bom_entry.color_id,
            labdip_variant_code=bom_entry.labdip_variant_code,
            force_create=bom_entry.force_create,
        )
        db.add(pr_entry)
        await db.flush()

        entry_root_mos: list[ManufacturingOrder] = []

        # Variant the produced root will actually carry (entry override wins,
        # same precedence applied post-creation below) — this is the netting key.
        root_attrs = (
            [str(v) for v in bom_entry.attribute_value_ids]
            if bom_entry.attribute_value_ids
            else [str(v.id) for v in bom.attribute_values]
        )
        root_net_loc = source_location.id if source_location else (location.id if location else None)

        if bom_entry.sizes:
            for size_entry in bom_entry.sizes:
                if size_entry.qty <= 0:
                    continue
                size_result = await db.execute(
                    select(BOMSize).options(joinedload(BOMSize.size))
                    .filter(BOMSize.id == size_entry.bom_size_id, BOMSize.bom_id == bom.id)
                )
                bom_size = size_result.scalars().first()
                if not bom_size:
                    raise HTTPException(status_code=404, detail=f"BOM size {size_entry.bom_size_id} not found in BOM {bom.id}")

                db.add(PRBomEntrySize(pr_bom_entry_id=pr_entry.id, bom_size_id=bom_size.id, qty=size_entry.qty))

                gross = float(size_entry.qty)
                if bom_entry.force_create:
                    net_qty = gross
                else:
                    net_qty, net_detail = await availability.consume_detailed(
                        bom.item_id, root_attrs, root_net_loc, gross, color_id=bom_entry.color_id,
                        # Sized FG nets only against its own size's stock — a
                        # 67 cm M roll is not XL inventory.
                        size_token=availability.token_for_bom_size(bom_size),
                    )
                    _reserve(net_detail.get("covered", 0.0), bom, root_attrs, bom_entry,
                             pr_entry, bom_size_id=size_entry.bom_size_id)
                if net_qty <= 0:
                    continue  # fully covered by stock -> no root MO for this size line

                size_label = bom_size.label or (bom_size.size.name if bom_size.size else f"S{total_root_mo_count+1}")
                root_mo = await mrp_service.create_mo_recursive(
                    db, bom.id, net_qty, (location.id if location else None), current_user.id,
                    source_location_id=source_location.id if source_location else None,
                    sales_order_id=payload.sales_order_id,
                    production_run_id=pr.id,
                    target_start_date=payload.target_start_date,
                    target_end_date=payload.target_end_date,
                    bom_size_id=size_entry.bom_size_id,
                    create_children=False,
                )
                base_code = _compose_mo_code(
                    payload.code,
                    # single-recipe runs keep the older `{PR}-{SIZE}` shape; the line
                    # index only earns its place when several recipes share a run
                    index=f"{entry_idx+1:03d}" if len(payload.bom_entries) > 1 else "",
                    size_label=size_label.upper(),
                )
                root_mo.code = await _find_unique_mo_code(db, base_code)
                root_mo.color_id = bom_entry.color_id
                root_mo.labdip_variant_code = bom_entry.labdip_variant_code
                entry_root_mos.append(root_mo)
                total_root_mo_count += 1
                await db.flush()

        elif bom_entry.total_qty and bom_entry.total_qty > 0:
            gross = float(bom_entry.total_qty)
            if bom_entry.force_create:
                net_qty = gross
            else:
                net_qty, net_detail = await availability.consume_detailed(
                    bom.item_id, root_attrs, root_net_loc, gross, color_id=bom_entry.color_id
                )
                _reserve(net_detail.get("covered", 0.0), bom, root_attrs, bom_entry, pr_entry)
            if net_qty > 0:
                root_mo = await mrp_service.create_mo_recursive(
                    db, bom.id, net_qty, (location.id if location else None), current_user.id,
                    source_location_id=source_location.id if source_location else None,
                    sales_order_id=payload.sales_order_id,
                    production_run_id=pr.id,
                    target_start_date=payload.target_start_date,
                    target_end_date=payload.target_end_date,
                    create_children=False,
                )
                base_code = _compose_mo_code(payload.code, index=f"{entry_idx+1:03d}")
                root_mo.code = await _find_unique_mo_code(db, base_code)
                root_mo.color_id = bom_entry.color_id
                root_mo.labdip_variant_code = bom_entry.labdip_variant_code
                entry_root_mos.append(root_mo)
                total_root_mo_count += 1
                await db.flush()
            # net_qty <= 0 -> fully covered by stock, no root MO for this entry

        if bom_entry.attribute_value_ids:
            attr_result = await db.execute(
                select(AttributeValue).filter(
                    AttributeValue.id.in_([str(v) for v in bom_entry.attribute_value_ids])
                )
            )
            attr_objs = attr_result.scalars().all()
            for mo in entry_root_mos:
                mo.attribute_values = list(attr_objs)
            await db.flush()

        if entry_root_mos:
            bom_ro_pairs.append((bom, entry_root_mos))

    for r in reservations:
        db.add(r)
    if reservations:
        await db.flush()

    # ── Pass 2: Aggregate demand across ALL BOM entries, create consolidated shared MOs ──
    # Reuses the same `availability` ledger Pass 1 netted roots against, so a
    # component can't claim stock a root already consumed (or vice versa).
    if bom_ro_pairs:
        all_root_mos = [mo for _, root_mos in bom_ro_pairs for mo in root_mos]
        await mrp_service.create_consolidated_component_mos(
            db, all_root_mos, location, source_location,
            payload.sales_order_id, pr.id,
            payload.target_start_date, payload.target_end_date,
            current_user.id,
            availability=availability,
        )

    await db.commit()

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr.id)
    )
    pr = result.unique().scalars().first()
    _post_process_pr(pr)

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE",
        entity_type="PRODUCTION_RUN", entity_id=str(pr.id),
        details=f"Created Production Run {pr.code} with {len(payload.bom_entries)} BOM entries, {total_root_mo_count} root MOs",
        changes=payload.model_dump()
    )
    await manager.broadcast({"type": "PRODUCTION_RUN_UPDATE", "pr_id": str(pr.id), "status": "PENDING"})
    return pr

@router.put("/production-runs/{pr_id}/status", response_model=ProductionRunResponse)
async def update_production_run_status(
    pr_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('production_run.edit')),
):
    valid = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr_id)
    )
    pr = result.unique().scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")

    pr.status = status
    if status == "IN_PROGRESS" and not pr.actual_start_date:
        pr.actual_start_date = datetime.utcnow()
    if status == "COMPLETED" and not pr.actual_end_date:
        pr.actual_end_date = datetime.utcnow()

    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="STATUS_CHANGE",
        entity_type="PRODUCTION_RUN", entity_id=pr_id,
        details=f"Status -> {status}"
    )
    await manager.broadcast({"type": "PRODUCTION_RUN_UPDATE", "pr_id": pr_id, "status": status})

    result = await db.execute(
        select(ProductionRun).options(*_pr_load_options()).filter(ProductionRun.id == pr_id)
    )
    pr = result.unique().scalars().first()
    _post_process_pr(pr)
    return pr

@router.delete("/production-runs/{pr_id}")
async def delete_production_run(
    pr_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('production_run.delete')),
):
    result = await db.execute(select(ProductionRun).filter(ProductionRun.id == pr_id))
    pr = result.scalars().first()
    if not pr:
        raise HTTPException(status_code=404, detail="Production Run not found")
    code = pr.code

    # Delete every MO belonging to this PR (roots + children + consolidated
    # shared-component MOs all carry production_run_id=pr.id). Delete children
    # before parents to satisfy the parent_mo_id FK (no DB-level cascade on the
    # self-reference); ORM cascades then remove WOs, completions, planned
    # components, and MODependency rows.
    mo_result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.production_run_id == pr.id)
    )
    mos = {o.id: o for o in mo_result.scalars().all()}

    def _depth(oid):
        d, cur = 0, mos.get(oid)
        seen = set()
        while cur is not None and cur.parent_mo_id in mos and cur.parent_mo_id not in seen:
            seen.add(cur.id)
            d += 1
            cur = mos.get(cur.parent_mo_id)
        return d
    for oid in sorted(mos.keys(), key=_depth, reverse=True):
        await db.delete(mos[oid])
    mo_count = len(mos)

    await db.delete(pr)
    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE",
        entity_type="PRODUCTION_RUN", entity_id=pr_id,
        details=f"Deleted Production Run {code} and {mo_count} associated MO(s)"
    )
    await manager.broadcast({"type": "PRODUCTION_RUN_UPDATE", "pr_id": pr_id, "status": "DELETED"})
    if mo_count:
        await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "status": "DELETED"})
    return {"status": "success"}
