from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, inspect, case
from sqlalchemy.orm import selectinload, joinedload, attributes as sa_attributes
from collections import defaultdict
from app.db.session import get_async_db
from app.models.manufacturing import (
    ManufacturingOrder, MOCompletion, MOCompletionItem, MODependency, MOPlannedComponent,
    CLOSED_ORDER_STATUSES,
)
from app.models.work_order import WorkOrder as WorkOrderModel
from app.models.bom import BOM, BOMLine, BOMSize, BOMOperation
from app.models.routing import Operation as OperationModel, WorkCenter
from app.models.location import Location
from app.models.color import Color
from app.services import (
    stock_service, audit_service, kpi_service, beam_service, mrp_service,
    work_center_service, so_fulfilment_service, reject_service, weaving_service,
    staging_service, dyeing_run_service,
)
from app.services.netting_service import Availability, preview_mo
from app.schemas import (
    ManufacturingOrderCreate, ManufacturingOrderResponse,
    PaginatedManufacturingOrderResponse,
    MOCompleteWithBatchesPayload,
    BatchConsumptionInMO,
    MOCompletionCreate, MOCompletionResponse, MOCompletionItemCreate,
    MOCompletionReject,
    MOAttributeUpdate,
    MOColorUpdate,
    MOPutawayUpdate,
    MOToleranceUpdate,
    MOPreviewRequest, NettingPreviewNode,
    WorkOrderFlatPageResponse, WorkOrderFlatResponse,
    WorkOrderCompletionFlat, WorkOrderCompletionItemFlat,
)
from app.models.attribute import AttributeValue
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission, wo_scope_ok, user_has_permission
from app.models.item import Item
from app.models.stock_balance import StockBalance
from app.models.batch import Batch, BatchConsumption
from app.models.dyeing_setting import DyeingRun
from app.api.batches import generate_batch_number
from datetime import datetime
from typing import Optional
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
import uuid

router = APIRouter()

# Default output overdelivery allowance when neither the MO nor its BOM carries one
# (legacy rows created before the field existed).
DEFAULT_OVERDELIVERY_PCT = 10.0

# CLOSED_ORDER_STATUSES is imported from the model above. It replaced an
# `OPEN_MO_STATUSES` tuple that documented the rule here while all six gates were
# spelled out inline as `in ("COMPLETED","CANCELLED")` literals — so the constant was
# free to drift from the behaviour it described, and adding a status meant finding
# all six by hand.


def mo_overdelivery_pct(mo) -> float:
    """Effective overdelivery % for an MO: its own snapshot, else the BOM's default,
    else the system default. Kept in one place — three call sites read it."""
    if mo.overdelivery_tolerance_pct is not None:
        return float(mo.overdelivery_tolerance_pct)
    bom = getattr(mo, "bom", None)
    if bom is not None and getattr(bom, "overdelivery_tolerance_percentage", None) is not None:
        return float(bom.overdelivery_tolerance_percentage)
    return DEFAULT_OVERDELIVERY_PCT


def mo_max_loggable_qty(mo) -> float | None:
    """Highest cumulative good qty this MO may carry. None = no ceiling."""
    if mo.allow_unlimited_overdelivery:
        return None
    return float(mo.qty) * (1 + mo_overdelivery_pct(mo) / 100)


def get_mo_options():
    """Eager loads for ONE MO and its own relationships — the write paths' loader.

    Deliberately does NOT walk child_mos. The four routes that use it (status,
    completions, reject, complete-with-batches) mutate a single order and none of
    them read `mo.child_mos`; none returns this instance either — the two that
    respond with an MO re-load it through `load_mo_tree` after committing. It used
    to hand-unroll two levels of child BOM trees on top of this list, so logging one
    bag pulled the whole sub-assembly graph, with 20 of its 24 selectinload chains
    feeding nothing. Anything that needs a tree wants `load_mo_tree`, which is
    depth-unlimited; `populate_mo_ids` stubs an unloaded child_mos as [].
    """
    options = [
        selectinload(ManufacturingOrder.item),
        selectinload(ManufacturingOrder.attribute_values),
        selectinload(ManufacturingOrder.planned_components).selectinload(MOPlannedComponent.item),
        selectinload(ManufacturingOrder.work_orders),
        selectinload(ManufacturingOrder.sales_order),
        selectinload(ManufacturingOrder.required_dependencies),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.item),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.attribute_values),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.operations).joinedload(BOMOperation.operation),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.operations).joinedload(BOMOperation.work_center),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.customer),
        selectinload(ManufacturingOrder.bom).selectinload(BOM.work_center),
        selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
        selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
        selectinload(ManufacturingOrder.completions),
        # putaway bin + its parent zone (for the "Zone / Bin" display name)
        joinedload(ManufacturingOrder.planned_putaway_location).joinedload(Location.parent),
    ]
    return options

def populate_mo_ids(mo: ManufacturingOrder):
    """Recursively populate attribute_value_ids for MO and its children safely."""
    # Use inspection to avoid triggering lazy loads in async context
    insp = inspect(mo)

    # 1. Populate Attribute Values (if loaded)
    if "attribute_values" not in insp.unloaded:
        mo.attribute_value_ids = [v.id for v in mo.attribute_values]

    # 1b. Populate sales_order_code (if loaded)
    if "sales_order" not in insp.unloaded and mo.sales_order:
        mo.sales_order_code = mo.sales_order.po_number

    # 1c. Populate color spec (Color Library) — color is lazy=joined, always loaded
    if "color" not in insp.unloaded and mo.color:
        mo.color_code = mo.color.code
        mo.color_name = mo.color.name

    # 2. Populate BOM IDs (if loaded)
    if "bom" not in insp.unloaded and mo.bom:
        bom_insp = inspect(mo.bom)
        if "lines" not in bom_insp.unloaded:
            for bl in mo.bom.lines:
                bl_insp = inspect(bl)
                if "attribute_values" not in bl_insp.unloaded:
                    bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    # 3. Populate batch trace (if loaded)
    if "batch_consumptions" not in insp.unloaded:
        mo.batch_trace = [
            BatchConsumptionInMO(
                input_batch_id=c.input_batch_id,
                input_batch_number=c.input_batch.batch_number if c.input_batch else str(c.input_batch_id),
                output_batch_id=c.output_batch_id,
                output_batch_number=c.output_batch.batch_number if c.output_batch else None,
                qty_consumed=float(c.qty_consumed),
            )
            for c in mo.batch_consumptions
        ]
    else:
        mo.batch_trace = []

    # 3b. Populate completion totals (if loaded) — rejected entries don't count
    if "completions" not in insp.unloaded:
        mo.qty_completed_total = sum(float(c.qty_completed) for c in mo.completions if not c.rejected)
        # Scrap counts across ALL completions — a partial reject leaves its log active
        # with the rejected qty moved onto qty_rejected.
        mo.qty_rejected_total = sum(float(c.qty_rejected or 0) for c in mo.completions)
    else:
        mo.qty_completed_total = 0.0
        mo.qty_rejected_total = 0.0
        sa_attributes.set_committed_value(mo, "completions", [])

    # 3c. Stamp item identity onto the BOM-line snapshot (if loaded). Done here
    # rather than as model properties because most callers load planned_components
    # without its `item`, and a lazy hop in an async route raises MissingGreenlet.
    if "planned_components" not in insp.unloaded:
        for comp in mo.planned_components:
            if "item" not in inspect(comp).unloaded and comp.item:
                comp.item_code = comp.item.code
                comp.item_name = comp.item.name
    else:
        sa_attributes.set_committed_value(mo, "planned_components", [])

    # 4. Recurse into children (if loaded); stub unloaded child_mos as []
    if "child_mos" not in insp.unloaded:
        for child in mo.child_mos:
            populate_mo_ids(child)
    else:
        sa_attributes.set_committed_value(mo, "child_mos", [])

    # 5. Populate required_mo_ids from dependency pegging records (if loaded)
    if "required_dependencies" not in insp.unloaded:
        mo.required_mo_ids = [dep.required_mo_id for dep in mo.required_dependencies]
    else:
        mo.required_mo_ids = []
        sa_attributes.set_committed_value(mo, "required_dependencies", [])

async def load_mo_tree(db: AsyncSession, root_ids: list) -> dict:
    """
    Load a MO tree of arbitrary depth using a recursive CTE.
    Returns {mo.id: ManufacturingOrder} with child_mos fully populated at every level.
    """
    if not root_ids:
        return {}

    # Recursive CTE: walk from roots down to all descendants
    anchor = (
        select(ManufacturingOrder.id, ManufacturingOrder.parent_mo_id)
        .filter(ManufacturingOrder.id.in_(root_ids))
        .cte(name="mo_tree", recursive=True)
    )
    recursive_part = select(ManufacturingOrder.id, ManufacturingOrder.parent_mo_id).join(
        anchor, ManufacturingOrder.parent_mo_id == anchor.c.id
    )
    mo_cte = anchor.union_all(recursive_part)

    id_result = await db.execute(select(mo_cte.c.id))
    all_ids = [row[0] for row in id_result.fetchall()]

    if not all_ids:
        return {}

    # Load every MO in the tree with its own relationships (no child_mos eager-load)
    result = await db.execute(
        select(ManufacturingOrder)
        .options(
            selectinload(ManufacturingOrder.item),
            selectinload(ManufacturingOrder.attribute_values),
            # .item too: the snapshot is what the expanded MO panel renders, and the
            # client can't resolve a code off its own `items` array — that's only one
            # page of /items.
            selectinload(ManufacturingOrder.planned_components).selectinload(MOPlannedComponent.item),
            selectinload(ManufacturingOrder.sales_order),
            selectinload(ManufacturingOrder.required_dependencies),
            selectinload(ManufacturingOrder.work_orders).selectinload(WorkOrderModel.work_center),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.item),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.attribute_values),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.operations).joinedload(BOMOperation.operation),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.operations).joinedload(BOMOperation.work_center),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.item),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.sizes).selectinload(BOMSize.size),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.customer),
            selectinload(ManufacturingOrder.bom).selectinload(BOM.work_center),
            selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.input_batch),
            selectinload(ManufacturingOrder.batch_consumptions).selectinload(BatchConsumption.output_batch),
            selectinload(ManufacturingOrder.completions),
        )
        .filter(ManufacturingOrder.id.in_(all_ids))
    )
    mo_map = {mo.id: mo for mo in result.unique().scalars().all()}

    # Index children by parent
    children_by_parent: dict = defaultdict(list)
    for mo in mo_map.values():
        if mo.parent_mo_id is not None:
            children_by_parent[mo.parent_mo_id].append(mo)

    # Mark child_mos as committed on every node so Pydantic won't trigger a lazy-load
    for mo in mo_map.values():
        sa_attributes.set_committed_value(mo, "child_mos", children_by_parent.get(mo.id, []))

    # Reconstruct each WorkOrder.completions from the MO-level completions already
    # loaded, instead of a second selectinload that re-queries + re-hydrates the same
    # mo_completions rows (they carry both mo_id and work_order_id). Cuts one query and
    # halves completion-row hydration per tree — the heaviest growing cost on the Pi.
    # WorkOrder.qty_completed_total (a property summing self.completions) and the
    # frontend completion history both keep working off the committed value.
    for mo in mo_map.values():
        comps_by_wo: dict = defaultdict(list)
        for c in mo.completions:
            if c.work_order_id is not None:
                comps_by_wo[c.work_order_id].append(c)
        for wo in mo.work_orders:
            sa_attributes.set_committed_value(wo, "completions", comps_by_wo.get(wo.id, []))

    return mo_map


# NOTE: WOs are NOT auto-generated from a BOM's routing steps. There was a
# `_create_wos_from_operations` helper here that did exactly that; its call site was
# removed in 1ff929b8 and it sat dead afterwards. Cutting a work order is a floor
# dispatch decision — a WO existing is what says "this step is released" — so
# creating one per BOMOperation up front would make every MO look released.


@router.post("/manufacturing-orders/preview", response_model=list[NettingPreviewNode])
async def preview_manufacturing_order(payload: MOPreviewRequest, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('manufacturing_order.create'))):
    """Dry-run: netting plan for a nested MO before creation (root always made,
    components netted against net-free stock). Creates nothing."""
    location = None
    if payload.location_code:
        result = await db.execute(select(Location).filter(Location.code == payload.location_code))
        location = result.scalars().first()
    source_location = None
    if payload.source_location_code:
        src = await db.execute(select(Location).filter(Location.code == payload.source_location_code))
        source_location = src.scalars().first()
    return await preview_mo(
        db, payload.bom_id, payload.qty, location, source_location, create_nested=payload.create_nested
    )


@router.post("/manufacturing-orders", response_model=ManufacturingOrderResponse)
async def create_manufacturing_order(payload: ManufacturingOrderCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('manufacturing_order.create'))):
    # 1. Validation
    result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    location = None
    if payload.location_code:
        result = await db.execute(select(Location).filter(Location.code == payload.location_code))
        location = result.scalars().first()
        if not location:
            raise HTTPException(status_code=404, detail="Location not found")

    source_location = None
    if payload.source_location_code:
        src_result = await db.execute(select(Location).filter(Location.code == payload.source_location_code))
        source_location = src_result.scalars().first()

    # ManufacturingOrder.code is unique, and /available-code only PROPOSES one — two
    # planners who opened the form together hold the same proposal. Check before
    # either branch: the nested path overwrote the root code without looking, so the
    # loser got a raw IntegrityError re-raised as a 500 below.
    if payload.code:
        clash = (await db.execute(
            select(ManufacturingOrder.id).filter(ManufacturingOrder.code == payload.code).limit(1)
        )).scalars().first()
        if clash:
            raise HTTPException(status_code=400, detail="Manufacturing Order Code already exists")

    # 2. Logic: Regular or Nested
    if payload.create_nested:
        try:
            # Build the net-free ledger BEFORE the root MO exists, so this MO's
            # own demand isn't scanned. Root is made full; children are netted.
            availability = await Availability.create(db)
            mo = await mrp_service.create_mo_recursive(
                db,
                payload.bom_id,
                payload.qty,
                location.id if location else None,
                current_user.id,
                source_location_id=source_location.id if source_location else None,
                sales_order_id=payload.sales_order_id,
                target_start_date=payload.target_start_date,
                target_end_date=payload.target_end_date,
                bom_size_id=payload.bom_size_id,
                availability=availability,
            )
            # Overwrite code if specified for root
            if payload.code:
                mo.code = payload.code
            await db.commit()
        except Exception as e:
            await db.rollback()
            raise HTTPException(status_code=500, detail=str(e))
    else:
        # Standard Single MO logic (code uniqueness already checked above)
        mo = ManufacturingOrder(
            code=payload.code,
            bom_id=bom.id,
            item_id=bom.item_id,
            location_id=location.id if location else None,
            source_location_id=(source_location.id if source_location else None),
            sales_order_id=payload.sales_order_id,
            bom_size_id=payload.bom_size_id,
            qty=payload.qty,
            target_start_date=payload.target_start_date,
            target_end_date=payload.target_end_date,
            # Snapshot the BOM's output tolerance (see mrp_service.create_mo_recursive);
            # beam MOs carry no kg ceiling.
            overdelivery_tolerance_pct=float(bom.overdelivery_tolerance_percentage or 0),
            allow_unlimited_overdelivery=bool(
                await beam_service.beam_item_ids(db, [bom.item_id])
            ),
            status="PENDING"
        )
        # Load attributes from BOM
        result = await db.execute(select(BOM).filter(BOM.id == payload.bom_id).options(selectinload(BOM.attribute_values)))
        bom_with_attrs = result.scalars().first()
        if bom_with_attrs:
            mo.attribute_values = bom_with_attrs.attribute_values

        db.add(mo)
        await db.flush()

        # Snapshot BOM lines at creation time
        bom_lines_result = await db.execute(
            select(BOM)
            .options(
                selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
                selectinload(BOM.operations).joinedload(BOMOperation.work_center),
            )
            .filter(BOM.id == payload.bom_id)
        )
        bom_for_snapshot = bom_lines_result.scalars().first()
        if bom_for_snapshot:
            await mrp_service.snapshot_bom_lines(db, mo, bom_for_snapshot)

        await db.commit()

    # 3. Re-fetch the full tree (unlimited depth) for response
    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)

    await audit_service.log_activity(db, current_user.id, "CREATE", "ManufacturingOrder", str(mo.id), f"Created {'Nested' if payload.create_nested else 'Single'} MO {mo.code}")

    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": mo.status, "code": mo.code})
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    populate_mo_ids(mo)
    return mo

@router.get("/manufacturing-orders/available-code")
async def get_available_mo_code(
    base: str = Query(..., description="Base code pattern, e.g. MO-ITEM"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("manufacturing_order.view", "production_run.view"))
):
    """Propose the next free `{base}-NNNNN`.

    A preview for the create form, so it deliberately reserves nothing — two
    planners opening the form at the same moment DO get the same code, and the
    second POST is rejected by the unique constraint with a 409 (see below).
    Reserving here instead would burn a number every time a form was cancelled.

    Was `counter = 1; while True:` with one SELECT per candidate, which walked
    every order already on that base — thousands of round trips on a live series,
    and an unbounded loop on the request thread. Codes are zero-padded to five
    digits, so the highest one lexicographically is the highest numerically: one
    query finds it, and the probe below only covers oddly-shaped legacy codes.
    """
    escaped = base.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    highest = (await db.execute(
        select(ManufacturingOrder.code)
        .filter(ManufacturingOrder.code.like(f"{escaped}-%", escape="\\"))
        .order_by(ManufacturingOrder.code.desc())
        .limit(1)
    )).scalar()

    counter = 1
    if highest:
        suffix = highest.rsplit("-", 1)[-1]
        if suffix.isdigit():
            counter = int(suffix) + 1

    for _ in range(50):
        candidate = f"{base}-{str(counter).zfill(5)}"
        taken = (await db.execute(
            select(ManufacturingOrder.id).filter(ManufacturingOrder.code == candidate).limit(1)
        )).scalars().first()
        if taken is None:
            return {"code": candidate}
        counter += 1
    raise HTTPException(
        status_code=409,
        detail=f"Could not find a free code for '{base}' — the series looks corrupted",
    )

@router.get("/manufacturing-orders", response_model=PaginatedManufacturingOrderResponse)
async def get_manufacturing_orders(
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    search: Optional[str] = Query(None),
    all_levels: bool = False,
    slim: bool = False,  # dashboard-only: skip load_mo_tree, return minimal fields
    # max_size is deliberately far above the usual 500: this route was uncapped and the
    # scanner still pulls the whole tree in one shot (`limit=9999&all_levels=true`) to
    # resolve a scanned WO, so a 500-row clamp would silently truncate it.
    window: PageWindow = Depends(PageParams(default_size=100, max_size=10000)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("manufacturing_order.view", "work_order.view", "production_run.view"))
):
    # Build a lightweight query for root MO IDs only (used for count + pagination)
    id_query = select(ManufacturingOrder.id)

    # Filter only root MOs by default — exclude shared component MOs (they appear under PR view)
    if not all_levels:
        id_query = id_query.filter(
            ManufacturingOrder.parent_mo_id == None,
            ManufacturingOrder.is_shared_component == False,
        )

    if start_date:
        id_query = id_query.filter(ManufacturingOrder.created_at >= start_date)
    if end_date:
        id_query = id_query.filter(ManufacturingOrder.created_at <= end_date)

    if search and search.strip():
        like = f"%{search.strip()}%"
        id_query = (
            id_query
            .outerjoin(Item, Item.id == ManufacturingOrder.item_id)
            .outerjoin(BOM, BOM.id == ManufacturingOrder.bom_id)
            .filter(or_(
                ManufacturingOrder.code.ilike(like),
                Item.name.ilike(like),
                Item.code.ilike(like),
                BOM.code.ilike(like),
            ))
        )

    count_result = await db.execute(select(func.count()).select_from(id_query.subquery()))
    total = count_result.scalar()

    root_id_result = await db.execute(
        window.apply(id_query.order_by(ManufacturingOrder.created_at.desc()))
    )
    root_ids = [row[0] for row in root_id_result.fetchall()]

    # Slim mode: single query, no tree load. Used by the dashboard WO monitoring table
    # which only needs id/code/status/item_id/qty/qty_completed_total/target_end_date.
    if slim:
        qty_completed_sub = (
            select(func.coalesce(func.sum(MOCompletion.qty_completed), 0))
            .where(MOCompletion.mo_id == ManufacturingOrder.id, MOCompletion.rejected == False)  # noqa: E712
            .correlate(ManufacturingOrder)
            .scalar_subquery()
        )
        # Scrap is summed over every completion (a partial reject stays active).
        qty_rejected_sub = (
            select(func.coalesce(func.sum(MOCompletion.qty_rejected), 0))
            .where(MOCompletion.mo_id == ManufacturingOrder.id)
            .correlate(ManufacturingOrder)
            .scalar_subquery()
        )
        slim_result = await db.execute(
            select(
                ManufacturingOrder.id,
                ManufacturingOrder.code,
                ManufacturingOrder.status,
                ManufacturingOrder.item_id,
                ManufacturingOrder.qty,
                ManufacturingOrder.target_end_date,
                qty_completed_sub.label("qty_completed_total"),
                qty_rejected_sub.label("qty_rejected_total"),
            )
            .where(ManufacturingOrder.id.in_(root_ids))
            .order_by(ManufacturingOrder.created_at.desc())
        )
        slim_items = [
            {
                "id": str(row.id),
                "code": row.code,
                "status": row.status,
                "item_id": str(row.item_id) if row.item_id else None,
                "qty": float(row.qty or 0),
                "qty_completed_total": float(row.qty_completed_total or 0),
                "qty_rejected_total": float(row.qty_rejected_total or 0),
                "target_end_date": row.target_end_date.isoformat() if row.target_end_date else None,
                # stub fields the frontend schema expects
                "work_orders": [], "child_mos": [], "completions": [], "planned_components": [],
                "attribute_values": [], "required_mo_ids": [], "batch_trace": [],
                "is_material_available": True, "bom_id": None, "bom": None,
                "item": None, "sales_order": None, "is_shared_component": False,
                "parent_mo_id": None,
            }
            for row in slim_result.all()
        ]
        return JSONResponse(window.envelope(slim_items, total))

    # Load the full tree (unlimited depth) for the paginated root MOs
    mo_map = await load_mo_tree(db, root_ids)
    items_list = [mo_map[rid] for rid in root_ids if rid in mo_map]

    # Plant-level material availability: sum on-hand across ALL locations per
    # (item, variant), matching the location-agnostic netting model.
    needed_item_ids = set()
    for item in items_list:
        populate_mo_ids(item)
        if item.status == "PENDING" and item.planned_components:
            for comp in item.planned_components:
                needed_item_ids.add(comp.item_id)

    onhand_map: dict[tuple, float] = {}
    if needed_item_ids:
        for iid, vk, q in (await db.execute(
            select(StockBalance.item_id, StockBalance.variant_key, func.sum(StockBalance.qty))
            .where(StockBalance.item_id.in_(needed_item_ids))
            .group_by(StockBalance.item_id, StockBalance.variant_key)
        )).all():
            onhand_map[(str(iid), vk or "")] = float(q or 0)

    for item in items_list:
        item.is_material_available = True
        if item.status == "PENDING" and item.planned_components:
            for comp in item.planned_components:
                if not comp.percentage:
                    continue
                req = (float(item.qty) * float(comp.percentage)) / 100
                tol = float(item.bom.tolerance_percentage or 0) if item.bom else 0
                if tol > 0: req *= (1 + (tol / 100))

                v_key = ",".join(sorted(comp.attribute_value_ids))
                if onhand_map.get((str(comp.item_id), v_key), 0) < req:
                    item.is_material_available = False
                    break

    return window.envelope(items_list, total)


@router.get("/manufacturing-orders/{mo_id}", response_model=ManufacturingOrderResponse)
async def get_manufacturing_order(
    mo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("manufacturing_order.view", "work_order.view", "production_run.view")),
):
    mo_map = await load_mo_tree(db, [mo_id])
    # load_mo_tree returns the whole tree (requested MO + descendants) keyed by id in
    # arbitrary DB order — pick the REQUESTED mo, not list(keys)[0], which could be a
    # child MO whose .completions omit this WO's bags (broke per-bag label reprint).
    mo = next((m for m in mo_map.values() if str(m.id) == str(mo_id)), None)
    if mo is None:
        raise HTTPException(status_code=404, detail="Manufacturing order not found")
    populate_mo_ids(mo)
    return mo


MAX_MO_ANCESTOR_DEPTH = 12


async def resolve_root_mos(db: AsyncSession, mo_ids: list[str]) -> dict[str, list[tuple[str, str]]]:
    """Map each given MO id to its root MO(s) as (id, code), sorted by code.

    Two links go upward and both must be followed: a child MO hangs off its parent
    via `parent_mo_id`, but a consolidated component MO (`is_shared_component`) has
    `parent_mo_id=None` and is reachable from its roots ONLY through `MODependency`.
    Following pegging is why a component MO can resolve to more than one root — it is
    shared across the colour/size variants of a production run by design.
    """
    origins = {str(m) for m in mo_ids if m}
    if not origins:
        return {}

    roots: dict[str, set[str]] = {o: set() for o in origins}
    code_map: dict[str, str] = {}
    # node -> origins whose walk has already passed through it (cycle / re-visit guard)
    visited: dict[str, set[str]] = {}

    def push(target: dict[str, set[str]], node: str, origs: set[str]) -> None:
        already = visited.setdefault(node, set())
        fresh = origs - already
        if fresh:
            already |= fresh
            target.setdefault(node, set()).update(fresh)

    frontier: dict[str, set[str]] = {}
    for o in origins:
        push(frontier, o, {o})

    for _ in range(MAX_MO_ANCESTOR_DEPTH):
        if not frontier:
            break
        rows = (await db.execute(
            select(ManufacturingOrder.id, ManufacturingOrder.code, ManufacturingOrder.parent_mo_id)
            .where(ManufacturingOrder.id.in_(list(frontier.keys())))
        )).all()

        next_frontier: dict[str, set[str]] = {}
        parentless: dict[str, set[str]] = {}
        for mid, code, parent_id in rows:
            smid = str(mid)
            code_map[smid] = code
            origs = frontier.get(smid, set())
            if parent_id:
                push(next_frontier, str(parent_id), origs)
            else:
                parentless[smid] = origs

        if parentless:
            deps = (await db.execute(
                select(MODependency.required_mo_id, MODependency.dependent_mo_id)
                .where(MODependency.required_mo_id.in_(list(parentless.keys())))
            )).all()
            pegged: dict[str, list[str]] = {}
            for req, dep in deps:
                pegged.setdefault(str(req), []).append(str(dep))
            for smid, origs in parentless.items():
                ups = pegged.get(smid)
                if ups:
                    for u in ups:
                        push(next_frontier, u, origs)
                else:
                    # No parent and nothing depends on it — this IS a root.
                    for o in origs:
                        roots[o].add(smid)

        frontier = next_frontier

    return {
        o: sorted(((r, code_map.get(r, "")) for r in rs), key=lambda t: t[1])
        for o, rs in roots.items()
    }


@router.get("/work-orders", response_model=WorkOrderFlatPageResponse)
async def list_work_orders_flat(
    status: str = Query(""),
    work_center_id: str = Query(""),
    group_id: str = Query(""),
    center_type: str = Query(""),
    search: str = Query(""),
    component_item_id: str = Query(""),
    unprinted: bool = Query(False),
    order_by: str = Query(
        "",
        description="'color' groups the window by the MO's Color Library shade, then "
                    "by machine — what the Dyeing/Setting Orders tabs page through to "
                    "load one bath's worth of work orders together. Default is newest first.",
    ),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view")),
):
    from sqlalchemy import and_

    conditions = []
    if unprinted:
        # "Not fully printed" = the Kartu Kerja card was never printed, OR this is a
        # lot-producing WO that has weighed bags whose labels are unprinted / stale
        # (bags logged after the last label print). Mirrors the client badge logic.
        latest_bag = (
            select(func.max(MOCompletion.created_at))
            .where(MOCompletion.work_order_id == WorkOrderModel.id, MOCompletion.rejected == False)  # noqa: E712
            .correlate(WorkOrderModel)
            .scalar_subquery()
        )
        lot_wc_subq = select(WorkCenter.id).where(
            func.upper(WorkCenter.center_type).in_(["WEAVING", "TENUN", "DYEING", "CELUP", "BEAMING"])
        ).scalar_subquery()
        labels_missing = and_(
            WorkOrderModel.work_center_id.in_(lot_wc_subq),
            latest_bag.isnot(None),
            or_(
                WorkOrderModel.labels_printed_at.is_(None),
                WorkOrderModel.labels_printed_at < latest_bag,
            ),
        )
        conditions.append(or_(WorkOrderModel.card_printed_at.is_(None), labels_missing))
    if component_item_id:
        bom_ids_subq = select(BOMLine.bom_id).where(BOMLine.item_id == component_item_id).scalar_subquery()
        mo_ids_subq = select(ManufacturingOrder.id).where(ManufacturingOrder.bom_id.in_(bom_ids_subq)).scalar_subquery()
        conditions.append(WorkOrderModel.manufacturing_order_id.in_(mo_ids_subq))
    if status:
        conditions.append(WorkOrderModel.status == status)
    if work_center_id:
        conditions.append(WorkOrderModel.work_center_id == work_center_id)
    if group_id:
        # Whole subtree, not direct children — a TYPE node's machines can now sit one
        # more level down, behind a GROUP.
        conditions.append(WorkOrderModel.work_center_id.in_(
            work_center_service.subtree_ids_query(group_id)
        ))
    if center_type:
        ct = center_type.upper()
        alias_map = {
            "BEAMING": ["BEAMING"],
            "WEAVING": ["WEAVING", "TENUN"],
            "DYEING": ["DYEING", "CELUP"],
            "SETTING": ["SETTING"],
        }
        if ct == "OTHERS":
            # Complement of every tabbed type — keep in sync with alias_map above,
            # or a type gets counted on two tabs at once.
            named_subq = select(WorkCenter.id).where(
                func.upper(WorkCenter.center_type).in_([t for ts in alias_map.values() for t in ts])
            ).scalar_subquery()
            conditions.append(or_(
                WorkOrderModel.work_center_id.is_(None),
                WorkOrderModel.work_center_id.notin_(named_subq),
            ))
        else:
            types = alias_map.get(ct, [ct])
            wc_subq = select(WorkCenter.id).where(func.upper(WorkCenter.center_type).in_(types)).scalar_subquery()
            conditions.append(WorkOrderModel.work_center_id.in_(wc_subq))
    if search and search.strip():
        like = f"%{search.strip()}%"
        conditions.append(or_(
            WorkOrderModel.name.ilike(like),
            WorkOrderModel.code.ilike(like),
            ManufacturingOrder.code.ilike(like),
        ))

    base_join = select(WorkOrderModel).join(
        ManufacturingOrder, WorkOrderModel.manufacturing_order_id == ManufacturingOrder.id
    )
    count_stmt = select(func.count(WorkOrderModel.id)).join(
        ManufacturingOrder, WorkOrderModel.manufacturing_order_id == ManufacturingOrder.id
    )
    if conditions:
        cond = and_(*conditions)
        base_join = base_join.where(cond)
        count_stmt = count_stmt.where(cond)

    total = (await db.execute(count_stmt)).scalar() or 0

    data_stmt = (
        base_join
        .options(
            selectinload(WorkOrderModel.work_center),
            selectinload(WorkOrderModel.completions).selectinload(MOCompletion.actual_items),
            joinedload(WorkOrderModel.manufacturing_order).options(
                joinedload(ManufacturingOrder.item),
                joinedload(ManufacturingOrder.bom).selectinload(BOM.lines),
                selectinload(ManufacturingOrder.attribute_values).joinedload(AttributeValue.attribute),
            ),
        )
    )
    if order_by == "color":
        # Colour first, then machine: the two halves of "one bath". This has to be an
        # ORDER BY and not a client-side regroup, because the list is windowed — a
        # shade with 30 WOs would otherwise group as 25 on this page and 5 on the
        # next, and a bulk create would silently cover only what was loaded (the
        # sort-must-move-with-the-window trap in CLAUDE.md).
        #
        # NULLS LAST: greige and every unshaded order sink below the colours rather
        # than forming a phantom first group. `id` is the unique tiebreaker, without
        # which rows jump between pages.
        data_stmt = (
            data_stmt
            .outerjoin(Color, ManufacturingOrder.color_id == Color.id)
            .outerjoin(WorkCenter, WorkOrderModel.work_center_id == WorkCenter.id)
            .order_by(
                Color.code.is_(None), Color.code,
                WorkCenter.name.is_(None), WorkCenter.name,
                WorkOrderModel.created_at.desc(), WorkOrderModel.id,
            )
        )
    else:
        data_stmt = data_stmt.order_by(
            WorkOrderModel.created_at.desc(), WorkOrderModel.sequence
        )
    data_stmt = window.apply(data_stmt)

    wos = (await db.execute(data_stmt)).scalars().unique().all()

    # Root MO per WO — the top of the parent/pegging chain, so the floor can jump from
    # any step (including consolidated component MOs) to the order it ultimately feeds.
    root_map = await resolve_root_mos(db, [str(wo.manufacturing_order_id) for wo in wos])

    result = []
    for wo in wos:
        mo = wo.manufacturing_order
        wo_roots = root_map.get(str(wo.manufacturing_order_id), [])
        bom_line_item_ids = [str(ln.item_id) for ln in (mo.bom.lines if mo and mo.bom else [])]

        combo_label = None
        if mo:
            combo_val = next(
                (av for av in (mo.attribute_values or []) if av.attribute and av.attribute.system_role == "combo"),
                None,
            )
            combo_label = combo_val.value if combo_val else None

        color_label = None
        if mo:
            color_val = next(
                (av for av in (mo.attribute_values or []) if av.attribute and av.attribute.system_role == "color"),
                None,
            )
            color_label = color_val.value if color_val else None

        size_label = stock_service._bom_size_label(mo.bom_size_snapshot) if mo else None

        # MO.color is lazy="joined" so it rides along with the MO joinedload above.
        color = mo.color if mo else None

        completions_flat = []
        for c in sorted(wo.completions or [], key=lambda x: x.created_at or datetime.min, reverse=True):
            items_flat = [
                WorkOrderCompletionItemFlat(
                    item_id=str(ai.item_id),
                    item_code=ai.item.code if ai.item else None,
                    qty_used=float(ai.qty_used),
                )
                for ai in (c.actual_items or [])
            ]
            completions_flat.append(WorkOrderCompletionFlat(
                id=str(c.id),
                qty_completed=float(c.qty_completed),
                qty_cones=c.qty_cones,
                qty_boxes=c.qty_boxes,
                operator_name=c.operator_name,
                work_center_name=c.work_center.name if c.work_center else None,
                created_at=c.created_at,
                notes=c.notes,
                actual_items=items_flat,
                rejected=bool(c.rejected),
                qty_rejected=float(c.qty_rejected or 0),
                reject_reason=c.reject_reason,
                reject_location_name=c.reject_location.name if c.reject_location else None,
                output_batch_number=c.output_batch_number,
                output_batch_notes=c.output_batch_notes,
            ))

        result.append(WorkOrderFlatResponse(
            id=str(wo.id),
            code=wo.code,
            sequence=wo.sequence,
            name=wo.name,
            status=wo.status,
            qty=float(wo.qty) if wo.qty is not None else None,
            qty_completed_total=float(wo.qty_completed_total) if wo.qty_completed_total is not None else None,
            qty_rejected_total=float(wo.qty_rejected_total or 0),
            planned_duration_hours=wo.planned_duration_hours,
            actual_duration_hours=wo.actual_duration_hours,
            target_start_date=wo.target_start_date,
            target_end_date=wo.target_end_date,
            actual_start_date=wo.actual_start_date,
            actual_end_date=wo.actual_end_date,
            card_printed_at=wo.card_printed_at,
            labels_printed_at=wo.labels_printed_at,
            notes=wo.notes,
            created_at=wo.created_at,
            work_center_id=str(wo.work_center_id) if wo.work_center_id else None,
            work_center_name=wo.work_center.name if wo.work_center else None,
            work_center_type=wo.work_center.center_type if wo.work_center else None,
            input_location=wo.input_location,
            output_location=wo.output_location,
            next_destination_location_id=str(wo.next_destination_location_id) if wo.next_destination_location_id else None,
            next_destination_work_center_id=str(wo.next_destination_work_center_id) if wo.next_destination_work_center_id else None,
            next_destination_location_name=wo.next_destination_location_name,
            next_destination_work_center_name=wo.next_destination_work_center_name,
            ends=wo.ends,
            staging_status=wo.staging_status or "NOT_STAGED",
            bom_operation_id=str(wo.bom_operation_id) if wo.bom_operation_id else None,
            mo_id=str(mo.id),
            mo_code=mo.code,
            root_mo_id=wo_roots[0][0] if wo_roots else None,
            root_mo_code=wo_roots[0][1] if wo_roots else None,
            root_mo_count=len(wo_roots),
            root_mo_codes=[c for _, c in wo_roots],
            item_name=mo.item.name if mo and mo.item else "",
            item_id=str(mo.item_id) if mo else "",
            combo_label=combo_label,
            color_label=color_label,
            size_label=size_label,
            color_id=str(mo.color_id) if mo and mo.color_id else None,
            color_code=color.code if color else None,
            color_name=color.name if color else None,
            # Color Library's own hex first; the mirrored `Colors` variant-attribute
            # value (already resolved above for `color_label`) is a second source
            # for the same shade and is filled in more often — same fallback chain
            # `resolveColorHex` uses on the frontend for lotted batches.
            color_hex=(color.hex if color else None) or (color_val.hex if color_val else None),
            labdip_variant_code=mo.labdip_variant_code if mo else None,
            completions=completions_flat,
            bom_line_item_ids=bom_line_item_ids,
        ))

    return window.envelope(result, total)


@router.put("/manufacturing-orders/{mo_id}/status")
async def update_manufacturing_order_status(mo_id: str, status: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('manufacturing_order.edit'))):
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    previous_status = mo.status
    valid_statuses = ["PENDING", "IN_PROGRESS", "DELIVERED", "COMPLETED", "CANCELLED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    if status == "COMPLETED" and not user_has_permission(current_user, 'manufacturing_order.close'):
        raise HTTPException(status_code=403, detail="Missing permission: manufacturing_order.close")

    if status == "IN_PROGRESS" and previous_status != "IN_PROGRESS":
        # No stock gate at start. Material availability is decided at PR/MO creation
        # (plant-level netting) and enforced physically at staging + completion
        # (negative-stock guard). Starting an MO never requires stock to be on hand.
        if previous_status in ("DELIVERED", "COMPLETED"):
            mo.actual_end_date = None      # reopened — it has no end date again
        else:
            mo.actual_start_date = datetime.utcnow()

    # DELIVERED (qty met) and COMPLETED (explicitly closed) both mean the plan is
    # fulfilled, so both stamp the end date and release the Sales Order. The
    # difference is only whether further logging is still allowed.
    if status in ("DELIVERED", "COMPLETED") and previous_status not in ("DELIVERED", "COMPLETED"):
        mo.actual_end_date = datetime.utcnow()

        # Stock movement is owned by WO completions — no bulk deduct/credit here.

    mo.status = status

    # Closing an MO does not cascade to its work orders in this codebase, so the loom
    # runs have to be closed from here too — by mo_id, which also catches runs started
    # against the MO directly with no WO. DELIVERED is not a close: the plan qty is met
    # but the order stays open and the loom may legitimately still be weaving.
    stopped_runs = []
    if status in weaving_service.CLOSING_WO_STATUSES:
        stopped_runs = await weaving_service.stop_runs(
            db, mo_id=mo.id, username=current_user.username,
        )

    # SO status is derived, never assigned here: finishing production does not make
    # an order shippable — packed cartons in stock do. so_fulfilment_service owns
    # every transition (see its module docstring).
    if mo.sales_order_id and mo.parent_mo_id is None:
        new_so_status = await so_fulfilment_service.recompute_so_status(db, mo.sales_order_id)
        if new_so_status:
            await audit_service.log_activity(
                db, current_user.id, "STATUS_CHANGE", "SalesOrder", str(mo.sales_order_id),
                f"{new_so_status} by root MO {mo.code}",
            )

    await db.commit()

    await audit_service.log_activity(db, current_user.id, "UPDATE_STATUS", "ManufacturingOrder", mo_id, f"{previous_status} -> {status}")
    await weaving_service.audit_and_broadcast_stops(
        db, current_user.id, stopped_runs, f"MO {status.lower()}")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": status, "code": mo.code})

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return {"status": "success", "message": f"Updated to {status}"}

@router.patch("/manufacturing-orders/{mo_id}/attributes", response_model=ManufacturingOrderResponse)
async def update_mo_attributes(
    mo_id: str,
    payload: MOAttributeUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.edit')),
):
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(selectinload(ManufacturingOrder.attribute_values))
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    if mo.status != "PENDING":
        raise HTTPException(status_code=400, detail="Attributes can only be edited on a PENDING Manufacturing Order")

    old_ids = [str(v.id) for v in mo.attribute_values]

    if payload.attribute_value_ids:
        attr_result = await db.execute(
            select(AttributeValue).filter(AttributeValue.id.in_([str(v) for v in payload.attribute_value_ids]))
        )
        new_values = attr_result.scalars().all()
    else:
        new_values = []

    mo.attribute_values = new_values
    await db.commit()

    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "ManufacturingOrder", str(mo.id),
        f"Updated attributes on MO {mo.code}: {old_ids} -> {[str(v) for v in payload.attribute_value_ids]}"
    )
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": mo.status, "code": mo.code})

    populate_mo_ids(mo)
    return mo

@router.patch("/manufacturing-orders/{mo_id}/color", response_model=ManufacturingOrderResponse)
async def update_mo_color(
    mo_id: str,
    payload: MOColorUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.edit')),
):
    """Set (or override) the color on a root MO. Used to confirm an approved Color
    Library shade for an order placed against a still-pending lab dip — this fills
    color_id and unblocks the DYEING WO gate. Auto-backfill on lab dip approval does
    the same automatically; this is the manual escape hatch."""
    result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id)
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")
    if mo.status not in ("PENDING", "IN_PROGRESS"):
        raise HTTPException(status_code=400, detail="Color can only be changed while the MO is PENDING or IN_PROGRESS")

    if payload.color_id is not None:
        exists = (await db.execute(select(Color.id).filter(Color.id == payload.color_id))).scalars().first()
        if not exists:
            raise HTTPException(status_code=404, detail="Color not found")

    old_color = str(mo.color_id) if mo.color_id else None
    mo.color_id = payload.color_id
    await db.commit()

    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "ManufacturingOrder", str(mo.id),
        f"Set color on MO {mo.code}: {old_color} -> {payload.color_id}"
    )
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": mo.status, "code": mo.code})

    populate_mo_ids(mo)
    return mo

@router.patch("/manufacturing-orders/{mo_id}/putaway", response_model=ManufacturingOrderResponse)
async def update_mo_putaway(
    mo_id: str,
    payload: MOPutawayUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.edit')),
):
    """Assign the planned putaway bin — planning/store decides where the output
    will be stored before production finishes. Completions book output stock to
    this location; the WO output location is only the fallback."""
    result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id)
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")
    if mo.status in CLOSED_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot set putaway on a {mo.status} MO")

    old_id = str(mo.planned_putaway_location_id) if mo.planned_putaway_location_id else None
    loc = None
    if payload.location_id:
        loc_res = await db.execute(select(Location).filter(Location.id == payload.location_id))
        loc = loc_res.scalars().first()
        if not loc:
            raise HTTPException(status_code=404, detail="Location not found")
    mo.planned_putaway_location_id = payload.location_id
    await db.commit()

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "ManufacturingOrder", str(mo.id),
        f"Putaway bin on MO {mo.code}: {old_id or 'none'} -> {loc.code if loc else 'none'}"
    )
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": mo.status, "code": mo.code})
    # expire_on_commit=False: the cached instance still holds the OLD (possibly
    # None) planned_putaway_location relationship — expire so the reload joins
    # fresh. Capture the pk first: reading mo.id after expire would trigger a
    # sync lazy refresh (MissingGreenlet).
    mo_pk = mo.id
    db.expire_all()

    mo_map = await load_mo_tree(db, [mo_pk])
    mo = mo_map.get(mo_pk)
    populate_mo_ids(mo)
    return mo


@router.patch("/manufacturing-orders/{mo_id}/tolerance", response_model=ManufacturingOrderResponse)
async def update_mo_tolerance(
    mo_id: str,
    payload: MOToleranceUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.edit')),
):
    """Per-order overdelivery override. Planning raises this when a run is
    deliberately over-issued (spare beams against bad yarn) rather than editing the
    BOM, which would loosen every future order of that article."""
    result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id)
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")
    if mo.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="Cannot set tolerance on a CANCELLED MO")

    if payload.overdelivery_tolerance_pct is not None and payload.overdelivery_tolerance_pct < 0:
        raise HTTPException(status_code=400, detail="Tolerance cannot be negative")

    mo_pk = mo.id
    before = f"{mo.overdelivery_tolerance_pct}% / unlimited={mo.allow_unlimited_overdelivery}"
    if payload.overdelivery_tolerance_pct is not None:
        mo.overdelivery_tolerance_pct = payload.overdelivery_tolerance_pct
    if payload.allow_unlimited_overdelivery is not None:
        mo.allow_unlimited_overdelivery = payload.allow_unlimited_overdelivery
    await db.commit()

    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "ManufacturingOrder", str(mo_id),
        f"Overdelivery tolerance on MO {mo.code}: {before} -> "
        f"{mo.overdelivery_tolerance_pct}% / unlimited={mo.allow_unlimited_overdelivery}",
    )
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo_id), "status": mo.status, "code": mo.code})

    mo_map = await load_mo_tree(db, [mo_pk])
    mo = mo_map.get(mo_pk)
    populate_mo_ids(mo)
    return mo


@router.post("/manufacturing-orders/{mo_id}/mark-printed", response_model=ManufacturingOrderResponse)
async def mark_mo_printed(
    mo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.print')),
):
    """Stamps card_printed_at when SPK Produksi (MO print) is printed from the ERP."""
    result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id)
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    mo_pk = mo.id
    mo.card_printed_at = datetime.utcnow()
    await db.commit()

    await audit_service.log_activity(
        db, current_user.id, "PRINT", "ManufacturingOrder", str(mo_id),
        f"Printed SPK Produksi for MO {mo.code}",
    )
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo_id)})

    mo_map = await load_mo_tree(db, [mo_pk])
    mo = mo_map.get(mo_pk)
    populate_mo_ids(mo)
    return mo


@router.post("/manufacturing-orders/{mo_id}/completions", response_model=ManufacturingOrderResponse)
async def add_mo_completion(
    mo_id: str,
    payload: MOCompletionCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    # DELIVERED is deliberately absent: the planned qty being met does not close the
    # order. Only an explicit close (COMPLETED) or CANCELLED stops logging.
    if mo.status in CLOSED_ORDER_STATUSES:
        raise HTTPException(status_code=400, detail=f"Cannot log completion on a {mo.status} MO")

    if payload.qty_completed <= 0:
        raise HTTPException(status_code=400, detail="qty_completed must be positive")

    # Overdelivery gate: the order qty is a target, not a ceiling. Logging past it is
    # allowed up to the tolerance snapshotted on the MO (unlimited for beams).
    max_loggable = mo_max_loggable_qty(mo)
    if max_loggable is not None:
        already = sum(float(c.qty_completed) for c in mo.completions if not c.rejected)
        if already + float(payload.qty_completed) > max_loggable + 1e-9:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Overdelivery limit reached: logging {float(payload.qty_completed):g} would bring the total to "
                    f"{already + float(payload.qty_completed):g}, past the allowed "
                    f"{max_loggable:g} ({float(mo.qty):g} + {mo_overdelivery_pct(mo):g}%). "
                    "Raise the tolerance on this MO to log more."
                ),
            )

    # Validate WO if provided
    wo = None
    wo_machine_assigned = None
    if payload.work_order_id:
        wo = next((w for w in mo.work_orders if str(w.id) == str(payload.work_order_id)), None)
        if not wo:
            raise HTTPException(status_code=400, detail="Work order does not belong to this MO")
        if wo.status in CLOSED_ORDER_STATUSES:
            raise HTTPException(status_code=400, detail=f"Cannot log on a {wo.status} work order")
        if wo.work_center_id:
            wc_type_res = await db.execute(
                select(WorkCenter.center_type).filter(WorkCenter.id == wo.work_center_id)
            )
            if not wo_scope_ok(current_user, wc_type_res.scalar()):
                raise HTTPException(status_code=403, detail="Your role is not scoped to this work order's work center type")

        # WOs created without a machine have no input/output location, so
        # completions would silently skip stock movement. Force the operator
        # to pick a machine here and persist its locations onto the WO.
        if (not wo.input_location_id or not wo.output_location_id) and wo.work_center_id:
            # WO already has a machine: its locations may just be a stale NULL from
            # before the group carried them. Re-resolve before asking the operator.
            wo_in, wo_out = await work_center_service.resolve_locations(db, wo.work_center_id)
            wo.input_location_id = wo.input_location_id or wo_in
            wo.output_location_id = wo.output_location_id or wo_out
        if not wo.input_location_id or not wo.output_location_id:
            if not payload.work_center_id:
                raise HTTPException(
                    status_code=400,
                    detail="This work order has no input/output location — select a Machine below to assign one before logging.",
                )
            wc_result = await db.execute(select(WorkCenter).filter(WorkCenter.id == payload.work_center_id))
            wc = wc_result.scalars().first()
            if not wc:
                raise HTTPException(status_code=404, detail="Work center not found")
            # Effective locations: the machine's own, else its group's / type's.
            wc_in, wc_out = await work_center_service.resolve_locations(db, wc.id)
            if not wc_in or not wc_out:
                raise HTTPException(
                    status_code=400,
                    detail=f"Machine '{wc.name}' has no input/output location — set it on the machine or on its group first.",
                )
            wo.work_center_id = wc.id
            wo.input_location_id = wc_in
            wo.output_location_id = wc_out
            wo_machine_assigned = wc.name

    if mo.status == "PENDING":
        raise HTTPException(status_code=400, detail="MO must be started before logging completions")

    # --- Beam handling ---
    # Beam birth: an MO producing a Beam-category item registers each completion
    # as a physical beam batch. Batch stock rows always use variant_key="" — the
    # batch itself is the identity, so attrs are intentionally not stamped.
    wo_input_loc = wo.input_location_id if wo else None
    # Putaway priority: explicit payload override (API-level) -> planned putaway
    # bin assigned on the MO by planning/store -> WO output location fallback.
    wo_output_loc = mo.planned_putaway_location_id or (wo.output_location_id if wo else None)
    if payload.output_location_id:
        loc_chk = await db.execute(select(Location.id).filter(Location.id == payload.output_location_id))
        if not loc_chk.scalar():
            raise HTTPException(status_code=404, detail="Output location not found")
        wo_output_loc = payload.output_location_id

    wo_wc_type = None
    if wo and wo.work_center_id:
        wc_type_res2 = await db.execute(
            select(WorkCenter.center_type).filter(WorkCenter.id == wo.work_center_id)
        )
        wo_wc_type = (wc_type_res2.scalar() or "").upper()

    is_beam_output = beam_service.is_beam_item(mo.item)
    # Beaming WOs can live on the produced item's MO (Plan Beaming flow) —
    # a completion on a BEAMING-type work center is also a beam birth.
    if not is_beam_output and wo_wc_type == "BEAMING":
        is_beam_output = True
    # Legacy beam lineage: warp merged into the batch-less pool by the pre-mount
    # code pegged to the MO with output_batch_id=None until a lot existed to claim
    # it. Mounted beams no longer peg that way (they peg straight to the beam and
    # the output lot — see beam_service.consume_from_mounts), but old rows still
    # need a lot to attach to, or their lineage is orphaned for good.
    pending_beam_pegs = [c for c in mo.batch_consumptions if c.output_batch_id is None]

    # Output lot: beams always get one; other items get one when lot_tracked,
    # or when this completion needs to claim/attach beam-consumption lineage.
    # The batch row is the identity/traceability record — created even when the WO
    # has no output location; stock booking below still requires the location.
    needs_output_lot = (
        is_beam_output
        or bool(mo.item and mo.item.lot_tracked)
        or bool(pending_beam_pegs)
        # Greige (weaving), dyed (dyeing) and set (setting) output are always
        # traceable lots, even when the item itself isn't flagged lot_tracked. For
        # weaving this is also what gives mounted-beam consumption an output lot to
        # peg to; for dyeing and setting it is what the staged input lots peg to —
        # without it every BatchConsumption row from a bag-fed step lands with
        # output_batch_id=None and the lineage of the fabric that came out dangles.
        or wo_wc_type in ("WEAVING", "DYEING", "CELUP", "SETTING")
    )
    output_batch = None
    if needs_output_lot:
        # Snapshot the operator's own note BEFORE the machine-generated suffixes below
        # get appended to payload.notes. This is what travels onto the physical lot
        # (bag label, Lot table, stock on-hand) — the "[Greige GRG-…]" / "not booked"
        # bracket text is bookkeeping for the completion entry, not lot identity.
        operator_notes = (payload.notes or "").strip() or None
        # Prefix communicates what the lot physically is at a glance (greige vs.
        # dyed vs. generic) — lineage itself is tracked via source_wo_id regardless.
        if is_beam_output:
            label, lot_prefix = "Beam", "BM"
        elif wo_wc_type == "WEAVING":
            label, lot_prefix = "Greige", "GRG"
        elif wo_wc_type in ("DYEING", "CELUP"):
            label, lot_prefix = "Dyed Lot", "DYE"
        elif wo_wc_type == "SETTING":
            label, lot_prefix = "Set Lot", "SET"
        else:
            label, lot_prefix = "Lot", "LOT"
        lot_no = (payload.beam_number or "").strip()
        if lot_no:
            dup = await db.execute(select(Batch.id).filter(Batch.batch_number == lot_no).limit(1))
            if dup.scalars().first():
                raise HTTPException(status_code=400, detail=f"{label} number '{lot_no}' already exists")
        else:
            lot_no = await generate_batch_number(db, prefix=lot_prefix)
            # surface the generated number to the operator via completion notes
            payload.notes = f"{payload.notes} [{label} {lot_no}]" if payload.notes else f"{label} {lot_no}"
        if not wo_output_loc:
            warn = f"{label} {lot_no} not booked to stock: work order has no output location"
            payload.notes = f"{payload.notes} [{warn}]" if payload.notes else f"[{warn}]"
        # Beam ends: per-WO planned ends (utas) override the item default
        beam_ends = None
        if is_beam_output:
            beam_ends = (wo.ends if wo and wo.ends else None) or (mo.item.ends if mo.item else None)
        output_batch = Batch(
            batch_number=lot_no,
            item_id=mo.item_id,
            ends=beam_ends,
            source_wo_id=wo.id if wo else None,
            # Operator's completion note rides onto the lot itself so it shows on the
            # bag label, the Lot table and stock on-hand — not just in the MO's log.
            notes=operator_notes,
            # Stamp the MO's size onto the produced lot (e.g. sized greige GRG- lot).
            bom_size_id=mo.bom_size_id,
            bom_size_snapshot=mo.bom_size_snapshot,
            created_by=current_user.username,
        )
        db.add(output_batch)
        await db.flush()
        # Beam-merge consumptions stay pegged at MO level (output_batch_id NULL)
        # on purpose — one beam merges into a kg pool that MULTIPLE output lots
        # draw from, so the consumption is not owned by any single lot. Claiming
        # the dangling pegs to THIS lot orphans every sibling lot's lineage:
        # trace-back resolves beams via source_wo_id → MO → NULL-pegged rows, and
        # those rows must stay NULL for all sibling lots on this WO to find them.

    # Input lots: selected batches matched to material lines by item
    input_batch_ids = list(payload.consumed_batches)
    if payload.beam_batch_id:
        input_batch_ids.append(payload.beam_batch_id)
    batch_by_item: dict[str, Batch] = {}
    if input_batch_ids:
        res = await db.execute(select(Batch).filter(Batch.id.in_(input_batch_ids)))
        found = res.scalars().all()
        if len(found) != len({str(b) for b in input_batch_ids}):
            raise HTTPException(status_code=404, detail="One or more selected lots not found")
        for b in found:
            batch_by_item[str(b.item_id)] = b
    consumed_by_batch: dict[str, float] = {}

    # Multi-lot consumption (dyeing greige substrate): the operator scanned in
    # many staged lots and this log draws an explicit qty from each. These
    # override the BOM% deduction for their items. A lot gives up only what the
    # run used — the remainder stays on it at the input location for the next
    # log, so partial draws are normal, not an error.
    lots_by_item: dict[str, list[tuple[Batch, float]]] = {}
    if payload.consumed_lots:
        lot_ids = [cl.batch_id for cl in payload.consumed_lots]
        lres = await db.execute(select(Batch).filter(Batch.id.in_(lot_ids)))
        lot_map = {str(b.id): b for b in lres.scalars().all()}
        if len(lot_map) != len({str(i) for i in lot_ids}):
            raise HTTPException(status_code=404, detail="One or more consumed lots not found")
        for cl in payload.consumed_lots:
            if float(cl.qty) <= 0:
                continue
            b = lot_map[str(cl.batch_id)]
            lots_by_item.setdefault(str(b.item_id), []).append((b, float(cl.qty)))
    lot_item_ids = set(lots_by_item.keys())

    # A staged lot belongs to the WO it was staged to. Two sizes of one BOM run on
    # the same machine, so they share an input location AND the same substrate
    # item — without this the other size's operator can pick a bag off this line
    # and consume another order's material (see services/staging_service.py).
    # Enforced here rather than only in the picker: the mobile scanner, the desktop
    # modal and a raw API call all land on this route.
    if wo and wo_input_loc:
        picked: dict[str, Batch] = {str(b.id): b for b in batch_by_item.values()}
        for lots in lots_by_item.values():
            for b, _qty in lots:
                picked[str(b.id)] = b
        if picked:
            clash = await staging_service.reserved_by_other(
                db, wo_input_loc, wo.id, list(picked.keys())
            )
            if clash:
                holder_codes = await staging_service.wo_codes(db, set(clash.values()))
                detail = "; ".join(
                    f"{getattr(picked.get(bid), 'batch_number', None) or bid} is staged to "
                    f"{holder_codes.get(holder) or 'another work order'}"
                    for bid, holder in clash.items()
                )
                raise HTTPException(
                    status_code=409,
                    detail=f"{detail}. A staged lot is reserved for the work order it was "
                           f"staged to — stage this WO's own lots instead.",
                )

    # Per-operation consumption: a WO only consumes the materials allocated to its
    # routing step (planned_component.bom_operation_id == wo.bom_operation_id).
    # If the WO has no step (legacy BOM with no operations), fall back to the whole
    # recipe so older data keeps working.
    if wo and wo.bom_operation_id:
        step_comps = [
            c for c in mo.planned_components
            if c.bom_operation_id and str(c.bom_operation_id) == str(wo.bom_operation_id)
        ]
        # Step assigned on the WO but no BOM line pegged to it (routing not fully
        # wired): consume the whole recipe rather than nothing. Mirrors the
        # work-center-type/step-agnostic fallback used at staging so materials
        # staged for this WO are actually recognized here.
        if not step_comps:
            step_comps = list(mo.planned_components)
    else:
        step_comps = list(mo.planned_components)

    # Lot enforcement: every deducted lot-tracked material must have a batch selected
    if wo_input_loc:
        if payload.actual_items:
            deducted_ids = {str(ai.item_id) for ai in payload.actual_items if float(ai.qty_used) > 0}
        else:
            deducted_ids = {str(c.item_id) for c in step_comps if c.percentage}
        # Items supplied via explicit multi-lot consumption satisfy the requirement.
        missing = [i for i in deducted_ids if i not in batch_by_item and i not in lot_item_ids]
        if missing:
            lt_res = await db.execute(
                select(Item.code).filter(Item.id.in_(missing), Item.lot_tracked == True)  # noqa: E712
            )
            lt_codes = list(lt_res.scalars().all())
            # Weaving beams are exempt from the lot-pick requirement: warp is drawn
            # FIFO from whatever is mounted on the loom, so the operator never picks
            # a beam and the UI offers no picker. Without this the check would fire
            # and block every weaving log.
            if lt_codes and wo_wc_type in ("WEAVING", "TENUN"):
                beam_ids = await beam_service.beam_item_ids(db, missing)
                if beam_ids:
                    beam_res = await db.execute(
                        select(Item.code).filter(Item.id.in_([uuid.UUID(i) for i in beam_ids]))
                    )
                    beam_codes = set(beam_res.scalars().all())
                    lt_codes = [c for c in lt_codes if c not in beam_codes]
            if lt_codes:
                raise HTTPException(
                    status_code=400,
                    detail=f"Lot-tracked materials require a lot/batch selection: {', '.join(lt_codes)}",
                )

    # Create completion record
    completion = MOCompletion(
        mo_id=mo.id,
        qty_completed=payload.qty_completed,
        qty_cones=payload.qty_cones,
        qty_boxes=payload.qty_boxes,
        operator_name=payload.operator_name,
        notes=payload.notes,
        # Fall back to the WO's machine when the operator left the (optional) Work
        # Center picker blank. The log physically happened on the machine the WO is
        # dispatched to, and anything that reports production per machine — the
        # weaving monitor's actual_kg above all (`weaving_service.sum_actual_kg`
        # filters on work_center_id) — silently counted 0 for every such row.
        work_center_id=payload.work_center_id or (wo.work_center_id if wo else None),
        work_order_id=payload.work_order_id,
        output_batch_id=output_batch.id if output_batch else None,
        output_location_id=wo_output_loc,
    )
    db.add(completion)
    await db.flush()

    # A dyeing WO's bath record adopts the lot this completion just minted, instead
    # of minting a second one of its own (complete_dyeing_run used to, so every dyed
    # batch existed twice, unlinked). Claim the earliest run on the WO that has no
    # lot yet: run 1 takes the first bag, run 2 the second on a multi-bath WO.
    # Several bags off ONE bath keep only the first here — the rest trace through
    # BatchConsumption + Batch.source_wo_id, as multiple bags per weaving WO already do.
    dye_run_claimed = None
    if output_batch and wo and wo_wc_type in ("DYEING", "CELUP"):
        run_res = await db.execute(
            select(DyeingRun)
            .filter(
                DyeingRun.work_order_id == wo.id,
                DyeingRun.output_batch_id.is_(None),
            )
            .order_by(DyeingRun.run_number)
            .limit(1)
        )
        dye_run = run_res.scalars().first()
        if dye_run:
            dye_run.output_batch_id = output_batch.id
            dye_run_claimed = dye_run

    # Auto-advance WO to IN_PROGRESS on first log. Weaving runs are NOT started
    # here — the monitor run is opened manually on the /weaving-monitor page so
    # the operator sets lines/rate/target before the window starts counting.
    # Every automatic transition below is recorded as its own STATUS_CHANGE row after
    # the commit. They used to be folded into this route's COMPLETION detail string,
    # so the trail could answer "who changed this status" for every MANUAL change and
    # nothing at all for the automatic ones — including the one question actually
    # asked of it, "when did this MO become DELIVERED".
    auto_transitions: list[tuple[str, str, str, str]] = []   # (entity_type, id, from, to)
    if wo and wo.status == "PENDING":
        auto_transitions.append(("WorkOrder", str(wo.id), wo.status, "IN_PROGRESS"))
        wo.status = "IN_PROGRESS"
        wo.actual_start_date = datetime.utcnow()

    # Save actual items used (substitutes)
    for ai in payload.actual_items:
        db.add(MOCompletionItem(
            completion_id=completion.id,
            item_id=ai.item_id,
            qty_used=ai.qty_used,
        ))

    # Warp beams are drawn FIFO from whatever is mounted on the loom rather than
    # deducted like ordinary material: the operator picks no beam, and the beam
    # stays lotted so BatchConsumption pegs to the real physical warp. Identify
    # them up front so both deduction paths below can hand them off.
    mount_item_ids: set[str] = set()
    if wo and wo_wc_type in ("WEAVING", "TENUN") and wo.work_center_id:
        mount_item_ids = await beam_service.beam_item_ids(
            db, [c.item_id for c in step_comps]
        )

    # Stock movement driven by WO locations only — no MO-level fallback
    if wo_input_loc:
        # Explicit multi-lot consumption first (dyeing greige): deduct each lot at
        # its own qty from the input location; these items are then skipped below.
        for item_id, lots in lots_by_item.items():
            for b, qty in lots:
                # A batched output keeps its MO's variant attrs beside the batch
                # (see the output post below), so a lot's stock does NOT sit under
                # an empty variant key — re-post under whatever it is actually
                # keyed as, or the deduction misses the row and 400s on a lot the
                # floor can see. Beams are the empty-variant exception and resolve
                # to [] here on their own.
                l_attrs, l_color = await stock_service.batch_variant(db, b.id, wo_input_loc)
                await stock_service.add_stock_entry(
                    db,
                    item_id=uuid.UUID(item_id),
                    location_id=wo_input_loc,
                    qty_change=-qty,
                    reference_type="Manufacturing Order",
                    reference_id=mo.code,
                    attribute_value_ids=l_attrs,
                    color_id=l_color,
                    batch_id=b.id,
                )
                consumed_by_batch[str(b.id)] = consumed_by_batch.get(str(b.id), 0.0) + qty
        if payload.actual_items:
            for ai in payload.actual_items:
                if str(ai.item_id) in lot_item_ids:
                    continue  # already consumed via explicit lots
                if str(ai.item_id) in mount_item_ids:
                    await beam_service.consume_from_mounts(
                        db, wo, ai.item_id, float(ai.qty_used), mo.id,
                        output_batch_id=output_batch.id if output_batch else None,
                        reference_id=mo.code,
                    )
                    continue
                in_batch = batch_by_item.get(str(ai.item_id))
                b_attrs, b_color = (
                    await stock_service.batch_variant(db, in_batch.id, wo_input_loc)
                    if in_batch else ([], None)
                )
                await stock_service.add_stock_entry(
                    db,
                    item_id=ai.item_id,
                    location_id=wo_input_loc,
                    qty_change=-float(ai.qty_used),
                    reference_type="Manufacturing Order",
                    reference_id=mo.code,
                    attribute_value_ids=b_attrs,
                    color_id=b_color,
                    batch_id=in_batch.id if in_batch else None,
                )
                if in_batch:
                    consumed_by_batch[str(in_batch.id)] = consumed_by_batch.get(str(in_batch.id), 0.0) + float(ai.qty_used)
        elif step_comps:
            for comp in step_comps:
                if not comp.percentage:
                    continue
                if str(comp.item_id) in lot_item_ids:
                    continue  # supplied by explicit lots, not BOM% deduction
                req = (float(payload.qty_completed) * float(comp.percentage)) / 100
                if str(comp.item_id) in mount_item_ids:
                    # Warp: FIFO across the loom's mounted beams (falls back to the
                    # batch-less pool for warp merged by the old pre-mount code).
                    await beam_service.consume_from_mounts(
                        db, wo, comp.item_id, req, mo.id,
                        output_batch_id=output_batch.id if output_batch else None,
                        reference_id=mo.code,
                    )
                    continue
                deduct_loc_id = comp.source_location_id or wo_input_loc
                in_batch = batch_by_item.get(str(comp.item_id))
                # A lot is not variant-less: re-post it under the key its balance
                # row actually holds, not an assumed empty one.
                c_attrs, c_color = (
                    await stock_service.batch_variant(db, in_batch.id, deduct_loc_id)
                    if in_batch else ([uuid.UUID(s) for s in comp.attribute_value_ids], None)
                )
                await stock_service.add_stock_entry(
                    db,
                    item_id=comp.item_id,
                    location_id=deduct_loc_id,
                    qty_change=-req,
                    reference_type="Manufacturing Order",
                    reference_id=mo.code,
                    attribute_value_ids=c_attrs,
                    color_id=c_color,
                    batch_id=in_batch.id if in_batch else None,
                )
                if in_batch:
                    consumed_by_batch[str(in_batch.id)] = consumed_by_batch.get(str(in_batch.id), 0.0) + req

    # Warp that ran out is off the loom as a matter of physics — close the mount so
    # the machine's mounted-pcs count stays honest without an operator step.
    if mount_item_ids and wo and wo.work_center_id:
        await beam_service.auto_dismount_depleted(db, wo.work_center_id)

    unused = [b.batch_number for b in batch_by_item.values() if str(b.id) not in consumed_by_batch]
    if unused:
        raise HTTPException(
            status_code=400,
            detail=f"Selected lots not consumed — check WO input location and material lines: {', '.join(unused)}",
        )
    for bid, qty in consumed_by_batch.items():
        db.add(BatchConsumption(
            manufacturing_order_id=mo.id,
            input_batch_id=uuid.UUID(bid),
            output_batch_id=output_batch.id if output_batch else None,
            qty_consumed=qty,
        ))

    if wo_output_loc:
        await stock_service.add_stock_entry(
            db,
            item_id=mo.item_id,
            location_id=wo_output_loc,
            qty_change=float(payload.qty_completed),
            reference_type="Manufacturing Order",
            reference_id=mo.code,
            # Beam batch rows carry no variant attrs — the batch is the identity.
            # Other batched outputs (greige, dyed lots) keep their variant attrs
            # alongside the batch so per-color netting still finds them.
            attribute_value_ids=[] if is_beam_output else [v.id for v in mo.attribute_values],
            color_id=None if is_beam_output else mo.color_id,
            batch_id=output_batch.id if output_batch else None,
            cones_change=int(payload.qty_cones or 0),
            boxes_change=int(payload.qty_boxes or 0),
        )

    # Sum all non-rejected completions to check for auto-complete
    total_result = await db.execute(
        select(func.sum(MOCompletion.qty_completed))
        .filter(MOCompletion.mo_id == mo.id, MOCompletion.rejected == False)  # noqa: E712
    )
    total_completed = float(total_result.scalar() or 0)

    # Planned qty met -> DELIVERED, NOT COMPLETED. The order stays open so the floor
    # can keep logging (spare beams, extra bags) until someone closes it explicitly.
    if total_completed >= float(mo.qty) and mo.status not in ("DELIVERED", "COMPLETED"):
        auto_transitions.append(("ManufacturingOrder", str(mo.id), mo.status, "DELIVERED"))
        mo.status = "DELIVERED"
        mo.actual_end_date = datetime.utcnow()
        # No SO status write here — delivering production is not the same as being
        # ready to ship. so_fulfilment_service derives that from packed cartons.
        if mo.sales_order_id and mo.parent_mo_id is None:
            new_so_status = await so_fulfilment_service.recompute_so_status(db, mo.sales_order_id)
            if new_so_status:
                await audit_service.log_activity(
                    db, current_user.id, "STATUS_CHANGE", "SalesOrder", str(mo.sales_order_id),
                    f"{new_so_status} by root MO {mo.code}",
                )

    # Auto-complete WO if cumulative logged qty reaches WO target
    stopped_runs = []
    if wo and wo.qty:
        wo_total_result = await db.execute(
            select(func.sum(MOCompletion.qty_completed))
            .filter(
                MOCompletion.mo_id == mo.id,
                MOCompletion.work_order_id == wo.id,
                MOCompletion.rejected == False,  # noqa: E712
            )
        )
        wo_total = float(wo_total_result.scalar() or 0)
        if wo_total >= float(wo.qty) and wo.status != "COMPLETED":
            auto_transitions.append(("WorkOrder", str(wo.id), wo.status, "COMPLETED"))
            wo.status = "COMPLETED"
            wo.actual_end_date = datetime.utcnow()
            # The loom that just finished this WO stops with it, so the monitor card
            # clears instead of accruing days against a finished order.
            stopped_runs = await weaving_service.stop_runs(
                db, work_order_id=wo.id, username=current_user.username,
            )

    # The WO's status may have moved twice above (PENDING -> IN_PROGRESS on the first
    # log, -> COMPLETED at target), and a dye bath's status follows its WO — a bath
    # left PENDING under a finished WO is the mismatch dyeing_run_service exists to
    # prevent. Audited through auto_transitions below like every other automatic move.
    if wo and wo_wc_type in ("DYEING", "CELUP"):
        for run, was, now in await dyeing_run_service.sync_wo_runs(
            db, wo.id, wo_status=wo.status
        ):
            auto_transitions.append(("DyeingRun", str(run.id), was, now))

    await db.commit()
    completion_log_detail = f"Logged {payload.qty_completed} completed (total {total_completed}/{mo.qty})"
    if wo_machine_assigned:
        completion_log_detail += f" | Machine '{wo_machine_assigned}' assigned to WO {wo.code or wo.name}"
    await audit_service.log_activity(db, current_user.id, "COMPLETION", "ManufacturingOrder", mo_id, completion_log_detail)
    for entity_type, entity_id, was, now in auto_transitions:
        await audit_service.log_activity(
            db, current_user.id, "STATUS_CHANGE", entity_type, entity_id,
            details=f"{was} -> {now} (automatic, on production log)",
            changes={"status": [was, now]},
        )
    if dye_run_claimed and output_batch:
        await audit_service.log_activity(
            db, current_user.id, "UPDATE", "DyeingRun", str(dye_run_claimed.id),
            details=(
                f"Output lot {output_batch.batch_number} linked from the production log "
                f"on WO {wo.code or wo.name}"
            ),
            changes={"output_batch_id": [None, str(output_batch.id)]},
        )
    await weaving_service.audit_and_broadcast_stops(
        db, current_user.id, stopped_runs, "work order completed (target qty reached)")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", **(await mo_progress_fields(db, mo, wo))})
    # This route is the single largest stock mover in the system — it deducts every
    # consumed component, credits the output, mints Batch rows and moves packaging
    # tallies. Those screens live on the `stock` topic, which no MO event reaches.
    await manager.broadcast({"type": "STOCK_UPDATE"})
    # The WO itself changed too: status may have advanced (PENDING -> IN_PROGRESS, or
    # -> COMPLETED at target) and a first log can pin its machine and both locations.
    # mo_progress_fields carries those numbers for MO watchers, but a WO-only board
    # is on no MO event.
    if wo:
        await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": str(wo.id), "status": wo.status})

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)
    populate_mo_ids(mo)
    return mo


@router.post("/manufacturing-orders/{mo_id}/completions/{completion_id}/reject", response_model=ManufacturingOrderResponse)
async def reject_mo_completion(
    mo_id: str,
    completion_id: str,
    payload: MOCompletionReject,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.edit')),
):
    """QC reject of a produced lot. The completion stops counting toward MO/WO
    progress (MO reopens if it had auto-completed) and the output lot is marked
    REJECTED (or REJECT_USABLE when `usable` is set — a rejected beam that can
    still be re-mounted), so it drops out of good-stock netting.

    The scrap is also physically quarantined: it moves out of the bin it was
    booked to and into the defect store resolved by `reject_service`
    (payload override → work center's reject location, inherited down the WC tree
    → item master default). With nothing configured anywhere the stock stays put
    for a lotted reject and is written off for an un-lotted one, which is the
    pre-routing behaviour.

    Rework is a NEW work order created manually for the shortfall; this endpoint
    does not touch the original WO."""
    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    comp = next((c for c in mo.completions if str(c.id) == str(completion_id)), None)
    if not comp:
        raise HTTPException(status_code=404, detail="Completion not found on this MO")
    if comp.rejected:
        raise HTTPException(status_code=400, detail="Completion is already rejected")

    if comp.work_order_id:
        wc_type_res = await db.execute(
            select(WorkCenter.center_type)
            .join(WorkOrderModel, WorkOrderModel.work_center_id == WorkCenter.id)
            .filter(WorkOrderModel.id == comp.work_order_id)
        )
        if not wo_scope_ok(current_user, wc_type_res.scalar()):
            raise HTTPException(status_code=403, detail="Your role is not scoped to this work order's work center type")

    # Resolve the output lot: linked at creation, or named explicitly for
    # legacy completions that predate the output_batch_id link.
    batch = None
    batch_id = payload.output_batch_id or comp.output_batch_id
    if batch_id:
        b_res = await db.execute(select(Batch).filter(Batch.id == batch_id))
        batch = b_res.scalars().first()
        if payload.output_batch_id and not batch:
            raise HTTPException(status_code=404, detail="Output lot not found")

    comp.rejected = True
    comp.reject_reason = (payload.reason or "").strip() or None
    comp.rejected_at = datetime.utcnow()
    comp.rejected_by = current_user.username
    # Durable scrap record for MO yield — qty_completed stays as logged on a whole
    # reject, but only qty_rejected survives if the lot is later disposed.
    comp.qty_rejected = float(comp.qty_rejected or 0) + float(comp.qty_completed)

    wo = next((w for w in mo.work_orders if str(w.id) == str(comp.work_order_id)), None)
    # Defect store: the WO's work center owns the routing (BEAMING → beam-reject
    # store, WEAVING → greige BS), with the operator's own completion work center
    # as the fallback for MO-level logs.
    reject_loc = await reject_service.resolve_reject_location(
        db,
        item_id=mo.item_id,
        work_center_id=(wo.work_center_id if wo else None) or comp.work_center_id,
        explicit=payload.reject_location_id,
    )
    relocated = 0.0

    if batch:
        # Lot stays lotted, flagged, and moves to the defect store. REJECT_USABLE
        # keeps it pickable (a rejected beam still runs on some items).
        batch.quality_status = reject_service.normalize_grade(payload.usable)
        if not comp.output_batch_id:
            comp.output_batch_id = batch.id
        relocated = await reject_service.quarantine_lot(
            db, item_id=mo.item_id, batch_id=batch.id,
            location_id=reject_loc, reference_id=batch.batch_number,
        )
    else:
        # Un-lotted output can't be flagged — transfer it out of the location it
        # was actually booked to (putaway bin recorded on the completion; WO
        # output location for legacy rows) into the defect store, so it stops
        # counting as good stock but is still visible as reject on-hand.
        out_loc = comp.output_location_id or (wo.output_location_id if wo else None)
        moved = await reject_service.move_unlotted_reject(
            db,
            item_id=mo.item_id,
            qty=float(comp.qty_completed),
            from_location_id=out_loc,
            to_location_id=reject_loc,
            reference_id=mo.code,
            attribute_value_ids=[v.id for v in mo.attribute_values],
            color_id=mo.color_id,
        )
        relocated = float(comp.qty_completed) if moved else 0.0
        if not moved:
            reject_loc = None    # written off, not quarantined — don't claim a bin
    comp.reject_location_id = reject_loc if relocated else None

    # Progress returns to the MO: reopen if the reject drops it below target.
    # Flush first — sessions run autoflush=False, so without this the aggregate
    # below still counts the completion just flagged and a DELIVERED MO at 100%
    # never reopens (the reject looks like it did nothing).
    await db.flush()
    total_result = await db.execute(
        select(func.sum(MOCompletion.qty_completed))
        .filter(MOCompletion.mo_id == mo.id, MOCompletion.rejected == False)  # noqa: E712
    )
    total_good = float(total_result.scalar() or 0)
    reopened_from = None
    if mo.status in ("DELIVERED", "COMPLETED") and total_good < float(mo.qty):
        reopened_from = mo.status
        mo.status = "IN_PROGRESS"
        mo.actual_end_date = None

    await db.commit()
    reject_loc_name = await reject_service.location_name(db, comp.reject_location_id)
    await audit_service.log_activity(
        db, current_user.id, "REJECT", "ManufacturingOrder", mo_id,
        f"Rejected completion of {float(comp.qty_completed):g}"
        + (f" (lot {batch.batch_number})" if batch else "")
        + (" [usable]" if payload.usable else "")
        + (f" → moved {relocated:g} to {reject_loc_name}" if reject_loc_name and relocated else "")
        + (f": {comp.reject_reason}" if comp.reject_reason else "")
        + f" — good total {total_good:g}/{mo.qty}",
    )
    if reopened_from:
        # Its own row, like every manual transition: a reject that reopens a closed
        # order is a status change someone will come looking for.
        await audit_service.log_activity(
            db, current_user.id, "STATUS_CHANGE", "ManufacturingOrder", mo_id,
            details=f"{reopened_from} -> IN_PROGRESS (automatic, reopened by reject)",
            changes={"status": [reopened_from, "IN_PROGRESS"]},
        )
    # Loaded by id rather than through comp.work_order: the relationship isn't in
    # this route's eager-load set, and a lazy hop would raise MissingGreenlet.
    rejected_wo = None
    if comp.work_order_id:
        rejected_wo = (await db.execute(
            select(WorkOrderModel).filter(WorkOrderModel.id == comp.work_order_id)
        )).scalars().first()
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", **(await mo_progress_fields(db, mo, rejected_wo))})
    await manager.broadcast({"type": "STOCK_UPDATE"})
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    mo_map = await load_mo_tree(db, [mo.id])
    mo = mo_map.get(mo.id)
    populate_mo_ids(mo)
    return mo


@router.post("/manufacturing-orders/{mo_id}/complete-with-batches")
async def complete_manufacturing_order_with_batches(
    mo_id: str,
    payload: MOCompleteWithBatchesPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('manufacturing_order.close')),
):
    from app.models.batch import BatchConsumption

    result = await db.execute(
        select(ManufacturingOrder)
        .filter(ManufacturingOrder.id == mo_id)
        .options(*get_mo_options())
    )
    mo = result.unique().scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    if mo.status == "COMPLETED":
        raise HTTPException(status_code=400, detail="Already closed")

    # Build lookup: (item_id, sorted attr ids) -> batch_id + qty from payload
    batch_map: dict[tuple, uuid.UUID] = {}
    for mb in payload.material_batches:
        key = (str(mb.bom_line_item_id), ",".join(sorted(str(v) for v in mb.attribute_value_ids)))
        batch_map[key] = (mb.batch_id, mb.qty)

    if mo.planned_components:
        for comp in mo.planned_components:
            if not comp.percentage:
                continue
            req = (float(mo.qty) * float(comp.percentage)) / 100
            tol = float(mo.bom.tolerance_percentage or 0) if mo.bom else 0
            if tol > 0:
                req *= (1 + (tol / 100))

            deduct_loc_id = comp.source_location_id or mo.source_location_id
            if not deduct_loc_id:
                continue
            attr_ids = [uuid.UUID(s) for s in comp.attribute_value_ids]
            key = (str(comp.item_id), ",".join(sorted(str(v) for v in attr_ids)))
            batch_id, _ = batch_map.get(key, (None, req))

            await stock_service.add_stock_entry(
                db,
                item_id=comp.item_id,
                location_id=deduct_loc_id,
                qty_change=-req,
                reference_type="Manufacturing Order",
                reference_id=mo.code,
                attribute_value_ids=attr_ids,
                batch_id=batch_id,
            )

            # Record traceability if both batches known
            if batch_id and payload.output_batch_id:
                consumption = BatchConsumption(
                    manufacturing_order_id=mo.id,
                    input_batch_id=batch_id,
                    output_batch_id=payload.output_batch_id,
                    qty_consumed=req,
                )
                db.add(consumption)

    # FG credit requires a WO with output_location_id — this endpoint has no WO reference,
    # so stock movement is handled by WO completions via the standard completion path.

    mo.status = "COMPLETED"
    mo.actual_end_date = datetime.utcnow()

    # Closing the MO closes its loom runs — see update_manufacturing_order_status.
    stopped_runs = await weaving_service.stop_runs(
        db, mo_id=mo.id, username=current_user.username,
    )

    if mo.sales_order_id and mo.parent_mo_id is None:
        await so_fulfilment_service.recompute_so_status(db, mo.sales_order_id)

    await db.commit()
    await audit_service.log_activity(db, current_user.id, "COMPLETE", "ManufacturingOrder", mo_id, f"Completed with batch tracking")
    await weaving_service.audit_and_broadcast_stops(
        db, current_user.id, stopped_runs, "MO completed")
    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": "COMPLETED", "code": mo.code})
    # Deducts every planned component at MO level, so the stock screens have to hear it.
    await manager.broadcast({"type": "STOCK_UPDATE"})

    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return {"status": "success", "message": "Completed with batch tracking"}


async def mo_progress_fields(db: AsyncSession, mo, wo=None) -> dict:
    """The PROGRESS half of a MANUFACTURING_ORDER_UPDATE payload — not just a status.

    The board reads `qty_completed_total` / `qty_rejected_total` off the MO (and the
    same pair off each WO), so a status-only event forced the client to re-pull the
    whole MO tree just to move a progress bar — 800ms of debounce plus a heavy
    request per logged bag. Sending the three numbers that actually changed lets the
    row update on arrival; the debounced refetch still follows and remains the source
    of truth for everything else.

    Totals are re-summed here rather than passed in: the callers each have a
    different subset of them in hand, and getting a progress bar subtly wrong is
    worse than two cheap aggregates.

    Returns the fields WITHOUT "type" — callers spread it into a dict literal that
    names the event themselves. That keeps the event type greppable at the call
    site and readable by tests/test_ws_event_registry.py, which can only audit
    payloads it can see statically.
    """
    totals = (await db.execute(
        select(
            func.coalesce(func.sum(
                case((MOCompletion.rejected == False, MOCompletion.qty_completed), else_=0)  # noqa: E712
            ), 0),
            func.coalesce(func.sum(MOCompletion.qty_rejected), 0),
        ).filter(MOCompletion.mo_id == mo.id)
    )).first()

    payload = {
        "mo_id": str(mo.id),
        "status": mo.status,
        "code": mo.code,
        "qty": float(mo.qty or 0),
        "qty_completed_total": float(totals[0] or 0),
        "qty_rejected_total": float(totals[1] or 0),
    }

    if wo is not None:
        wo_totals = (await db.execute(
            select(
                func.coalesce(func.sum(
                    case((MOCompletion.rejected == False, MOCompletion.qty_completed), else_=0)  # noqa: E712
                ), 0),
                func.coalesce(func.sum(MOCompletion.qty_rejected), 0),
            ).filter(MOCompletion.mo_id == mo.id, MOCompletion.work_order_id == wo.id)
        )).first()
        payload.update({
            "wo_id": str(wo.id),
            "wo_status": wo.status,
            "wo_qty_completed_total": float(wo_totals[0] or 0),
            "wo_qty_rejected_total": float(wo_totals[1] or 0),
        })

    return payload


async def _collect_mo_delete_set(db: AsyncSession, root_id: uuid.UUID) -> set:
    """Collect the full set of MO ids to delete when deleting `root_id`:
    - the parent->child subtree (via parent_mo_id), recursively
    - any consolidated/shared component MOs pegged via MODependency, but ONLY
      when every MO that still depends on them is already inside the delete set
      (i.e. no surviving sibling root still needs them).
    Iterates to a fixpoint so nested components are handled."""
    delete_set: set = set()
    # 1. parent->child subtree via BFS
    frontier = [root_id]
    while frontier:
        current = frontier.pop()
        if current in delete_set:
            continue
        delete_set.add(current)
        rows = await db.execute(
            select(ManufacturingOrder.id).filter(ManufacturingOrder.parent_mo_id == current)
        )
        frontier.extend(rows.scalars().all())

    # 2. pull in exclusively-owned pegged component MOs, to a fixpoint
    changed = True
    while changed:
        changed = False
        # component MOs required by anything already in the delete set
        dep_rows = await db.execute(
            select(MODependency.required_mo_id).filter(
                MODependency.dependent_mo_id.in_(delete_set)
            )
        )
        candidates = {c for c in dep_rows.scalars().all() if c not in delete_set}
        for comp_id in candidates:
            # who still depends on this component?
            dependents = await db.execute(
                select(MODependency.dependent_mo_id).filter(
                    MODependency.required_mo_id == comp_id
                )
            )
            dependent_ids = set(dependents.scalars().all())
            # exclusively owned by the delete set -> safe to delete (pull in its
            # own subtree too via the outer loop)
            if dependent_ids.issubset(delete_set):
                # add component + its parent->child subtree
                sub_frontier = [comp_id]
                while sub_frontier:
                    cur = sub_frontier.pop()
                    if cur in delete_set:
                        continue
                    delete_set.add(cur)
                    changed = True
                    kids = await db.execute(
                        select(ManufacturingOrder.id).filter(ManufacturingOrder.parent_mo_id == cur)
                    )
                    sub_frontier.extend(kids.scalars().all())
    return delete_set


@router.delete("/manufacturing-orders/{mo_id}")
async def delete_manufacturing_order(mo_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('manufacturing_order.delete'))):
    result = await db.execute(select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id))
    mo = result.scalars().first()
    if not mo: raise HTTPException(status_code=404, detail="Not found")
    mo_code = mo.code

    delete_ids = await _collect_mo_delete_set(db, mo.id)
    # Load full objects so ORM cascades (work_orders, completions, planned_components,
    # MODependency rows) fire; delete children before parents to satisfy the
    # parent_mo_id FK (no DB-level ON DELETE CASCADE on the self-reference).
    objs_result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id.in_(delete_ids))
    )
    objs = {o.id: o for o in objs_result.scalars().all()}

    # topological order: deepest (leaf) first via parent chain depth
    def _depth(oid):
        d, cur = 0, objs.get(oid)
        seen = set()
        while cur is not None and cur.parent_mo_id in objs and cur.parent_mo_id not in seen:
            seen.add(cur.id)
            d += 1
            cur = objs.get(cur.parent_mo_id)
        return d
    for oid in sorted(objs.keys(), key=_depth, reverse=True):
        await db.delete(objs[oid])

    await db.commit()
    deleted_count = len(delete_ids)
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "ManufacturingOrder", mo_id,
        details=f"Deleted MO {mo_code} and {deleted_count - 1} descendant/component MO(s)"
    )

    await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id, "status": "DELETED", "code": mo_code})
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
    except Exception:
        pass

    return {"status": "success"}
