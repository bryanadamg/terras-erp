from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, cast
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import joinedload, selectinload, aliased
from typing import Optional
from app.db.session import get_async_db
from app.models.work_order import WorkOrder
from app.models.manufacturing import ManufacturingOrder, MOCompletion
from app.models.routing import WorkCenter
from app.models.item import Item
from app.models.bom import BOMOperation
from app.models.location import Location
from app.models.batch import Batch, BeamMount
from app.models.stock_ledger import StockLedger
from app.models.stock_balance import StockBalance
from app.models.weaving import WeavingRun
from app.models.dyeing_setting import DyeRecipe, DyeingRun, dye_recipe_attribute_values
from app.schemas import (
    WorkOrderCreate, WorkOrderResponse, WORequiredMaterial, WOStagePayload, WOUnstagePayload,
    PutawayBinOption, PutawaySuggestionResponse,
    WorkOrderMarkPrintedBulk, BeamMountResponse, BeamMountCreate, BeamDismountPayload,
    BeamDismountResult, AvailableBeamRow, LoomBeamStatus, WOStagedLot,
)
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission, wo_scope_ok
from app.api.batches import (
    generate_batch_number, _resolve_batch_origins, _resolve_batch_variants,
)
from app.services import (
    audit_service, stock_service, beam_service, work_center_service, reject_service,
    weaving_service, numbering_service, staging_service, dyeing_run_service,
)
from app.core.ws_manager import manager
from datetime import datetime
import uuid


async def _find_matching_dye_recipe(db: AsyncSession, mo_attr_ids: set) -> Optional[DyeRecipe]:
    """Find active DyeRecipe whose attribute_values exactly match the given set."""
    count = len(mo_attr_ids)
    # Recipes containing ALL required attribute values
    has_all = (
        select(dye_recipe_attribute_values.c.dye_recipe_id)
        .where(dye_recipe_attribute_values.c.attribute_value_id.in_(mo_attr_ids))
        .group_by(dye_recipe_attribute_values.c.dye_recipe_id)
        .having(func.count() == count)
    )
    # Among those, only ones with no extra attribute values
    result = await db.execute(
        select(DyeRecipe)
        .where(DyeRecipe.id.in_(has_all))
        .where(DyeRecipe.is_active == True)
        .join(dye_recipe_attribute_values, DyeRecipe.id == dye_recipe_attribute_values.c.dye_recipe_id)
        .group_by(DyeRecipe.id)
        .having(func.count() == count)
    )
    return result.scalars().first()


async def _match_recipe_by_color(db: AsyncSession, color_id) -> Optional[DyeRecipe]:
    """Find the active DyeRecipe for a Color Library shade (modern color-type path)."""
    if not color_id:
        return None
    res = await db.execute(
        select(DyeRecipe)
        .where(DyeRecipe.color_id == color_id, DyeRecipe.is_active == True)
        .order_by(DyeRecipe.code)
    )
    return res.scalars().first()


async def _resolve_dye_recipe(db: AsyncSession, mo) -> DyeRecipe:
    """Resolve the active DyeRecipe for a DYEING WO on this MO.

    Color-type FGs carry a Color Library shade (`mo.color_id`) and match a recipe
    by `color_id`. Everything else falls back to the legacy exact attribute-value
    match. Raises 422 when neither resolves — the DYEING WO create is a hard gate.
    """
    if getattr(mo, "color_id", None):
        recipe = await _match_recipe_by_color(db, mo.color_id)
        if not recipe:
            raise HTTPException(status_code=422, detail="No active dyeing recipe found for this order's color")
        return recipe

    # Ordered against a shade still in lab dip: greige can run, but dyeing can't
    # start until the lab dip is approved (which auto-fills color_id) or a color is
    # confirmed on the MO. Point the operator at the real blocker.
    if getattr(mo, "labdip_variant_code", None):
        raise HTTPException(
            status_code=422,
            detail=f"Color still in lab dip ({mo.labdip_variant_code}) — approve the lab dip or set an approved color on the MO before creating the dyeing WO",
        )

    mo_attr_ids = {av.id for av in mo.attribute_values}
    if not mo_attr_ids:
        raise HTTPException(status_code=422, detail="MO has no color or attributes — cannot match a dyeing recipe")
    recipe = await _find_matching_dye_recipe(db, mo_attr_ids)
    if not recipe:
        raise HTTPException(status_code=422, detail="No active dyeing recipe found matching this MO's attribute combination")
    return recipe

router = APIRouter()

def _wo_options():
    return [joinedload(WorkOrder.work_center), selectinload(WorkOrder.completions)]

async def _wc_type(db: AsyncSession, work_center_id) -> str | None:
    """Fetch WorkCenter.center_type by id without relying on a lazy-loaded
    relationship (async sessions can't lazy-load — see CLAUDE.md gotcha)."""
    if not work_center_id:
        return None
    res = await db.execute(select(WorkCenter.center_type).filter(WorkCenter.id == work_center_id))
    return res.scalar()

async def next_wo_code(db: AsyncSession, mo: ManufacturingOrder) -> tuple[int, str]:
    """Allocate the next `{MO code}-WO-NN` off this MO's number range, as (n, code).

    Was `count(WOs on this MO) + 1`, which two operators dispatching the same MO at
    the same moment both read — and `work_orders.code` carries no unique constraint,
    so the duplicate landed silently and two Kartu Kerja went to the floor with the
    same number. The range row serializes the allocation instead."""
    async def _seed() -> int:
        return int((await db.execute(
            select(func.count()).select_from(WorkOrder)
            .where(WorkOrder.manufacturing_order_id == mo.id)
        )).scalar() or 0)

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(WorkOrder.id).filter(WorkOrder.code == code).limit(1)
        )).scalars().first() is not None

    return await numbering_service.allocate_code(
        db, f"WO:{mo.id}", lambda n: f"{mo.code}-WO-{n:02d}", seed=_seed, exists=_taken,
    )


def _require_wo_scope(current_user: User, center_type: str | None):
    if not wo_scope_ok(current_user, center_type):
        raise HTTPException(status_code=403, detail=f"Your role is not scoped to work center type '{center_type}'")


# The fields a WO edit can move. Audited as before -> after so a rewritten qty,
# work center or location is reconstructable from the log; the payload alone is not
# enough, because it names every field whether it changed or not and carries no
# previous value.
_WO_AUDITED_FIELDS = (
    "sequence", "name", "work_center_id", "bom_operation_id", "qty",
    "planned_duration_hours", "notes", "target_start_date", "target_end_date",
    "input_location_id", "output_location_id",
    "next_destination_location_id", "next_destination_work_center_id",
)


def _wo_snapshot(wo: WorkOrder) -> dict:
    """Plain-value copy of the audited fields — taken before mutating, and again
    after, so the two can be diffed. Values are stringified by audit_service."""
    return {f: getattr(wo, f, None) for f in _WO_AUDITED_FIELDS}


def _wo_diff(before: dict, after: dict) -> dict:
    """{field: [before, after]} for the fields that actually moved.

    `[old, new]` pairs match the convention already used elsewhere (see
    api/colors.py). Compared as strings because a Numeric column comes back as
    Decimal and a UUID column as UUID, so `4 != Decimal('4.0000')` would report a
    change that never happened.
    """
    out = {}
    for f in _WO_AUDITED_FIELDS:
        a, b = before.get(f), after.get(f)
        if (a is None) != (b is None) or (a is not None and str(a) != str(b)):
            out[f] = [a, b]
    return out

@router.post("/work-orders", response_model=WorkOrderResponse)
async def create_work_order(
    payload: WorkOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.create')),
):
    mo_result = await db.execute(
        select(ManufacturingOrder)
        .options(
            selectinload(ManufacturingOrder.attribute_values),
            selectinload(ManufacturingOrder.planned_components),
        )
        .filter(ManufacturingOrder.id == payload.manufacturing_order_id)
    )
    mo = mo_result.scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    wo_seq_num, wo_code = await next_wo_code(db, mo)

    # Load work center and check for DYEING gate
    wc = None
    planned_recipe_id = None
    if payload.work_center_id:
        wc_result = await db.execute(
            select(WorkCenter).filter(WorkCenter.id == payload.work_center_id)
        )
        wc = wc_result.scalars().first()
        _require_wo_scope(current_user, wc.center_type if wc else None)

        if wc and wc.center_type == "DYEING":
            matched_recipe = await _resolve_dye_recipe(db, mo)
            planned_recipe_id = matched_recipe.id

    # Auto-generate name from work center; fall back to code
    name = payload.name
    if not name:
        name = wc.name if wc else wo_code

    sequence = payload.sequence if payload.sequence and payload.sequence > 1 else wo_seq_num

    # Inherit locations from work center unless caller explicitly provided them.
    # "From the work center" means its effective value — a machine with no own
    # locations takes its GROUP's (then its TYPE's), so groups are configured once.
    input_location_id = payload.input_location_id
    output_location_id = payload.output_location_id
    if wc:
        wc_in, wc_out = await work_center_service.resolve_locations(db, wc.id)
        if input_location_id is None:
            input_location_id = wc_in
        if output_location_id is None:
            output_location_id = wc_out

    wo = WorkOrder(
        manufacturing_order_id=payload.manufacturing_order_id,
        sequence=sequence,
        code=wo_code,
        name=name,
        work_center_id=payload.work_center_id,
        bom_operation_id=payload.bom_operation_id,
        planned_recipe_id=planned_recipe_id,
        input_location_id=input_location_id,
        output_location_id=output_location_id,
        next_destination_location_id=payload.next_destination_location_id,
        next_destination_work_center_id=payload.next_destination_work_center_id,
        qty=payload.qty,
        planned_duration_hours=payload.planned_duration_hours,
        notes=payload.notes,
        target_start_date=payload.target_start_date,
        target_end_date=payload.target_end_date,
        status="PENDING",
    )
    db.add(wo)
    await db.flush()  # get wo.id before creating DyeingRun

    # Auto-seed pending DyeingRun so operator sees pre-filled recipe
    if planned_recipe_id:
        dye_run = DyeingRun(
            work_order_id=wo.id,
            recipe_id=planned_recipe_id,
            run_number=1,
            substrate_qty=wo.qty or 0,
            # No status: an unfilled bath on a fresh WO is PENDING, which is the
            # column default. Status is derived, not typed (dyeing_run_service) —
            # and the PLANNED bath below deliberately doesn't move it.
        )
        db.add(dye_run)
        await db.flush()
        # Plan the bath here so the Kartu Kerja printed off this WO carries weighed
        # grams. `payload.bath_volume_liters` is the planner's figure; blank falls
        # back to the recipe's liquor ratio x the load.
        await dyeing_run_service.seed_planned_bath(db, dye_run, payload.bath_volume_liters)

    # Auto-start MO on first WO creation if MO is still PENDING.
    # Stock is now checked at staging time (line-side issue), not here — creating a
    # WO no longer requires its components to already be on hand. Just flip the MO
    # to IN_PROGRESS so completions can be logged once materials are staged.
    mo_auto_started = mo.status == "PENDING"
    if mo_auto_started:
        mo.status = "IN_PROGRESS"
        mo.actual_start_date = datetime.utcnow()
        await db.commit()
        await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": "IN_PROGRESS", "code": mo.code})
    else:
        await db.commit()

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo.id)
    )
    wo = result.scalars().first()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE",
        entity_type="WorkOrder", entity_id=str(wo.id),
        details=f"Created Work Order '{wo.code}' on MO {mo.code}",
        # The created row, not the payload: this route derives fields the client
        # never sent — code and sequence off the MO's number range, both locations
        # resolved from the work center, planned_recipe_id from the DYEING gate — so
        # the payload alone doesn't say what was actually created.
        changes={**_wo_snapshot(wo), "code": wo.code, "planned_recipe_id": wo.planned_recipe_id},
    )
    if mo_auto_started:
        # Cutting the first WO starts the order. That is a status change nobody asked
        # for explicitly, so it needs its own row against the MO — the WO's CREATE
        # entry is not where anyone looks for "when did this MO start".
        await audit_service.log_activity(
            db, user_id=current_user.id, action="STATUS_CHANGE",
            entity_type="ManufacturingOrder", entity_id=str(mo.id),
            details=f"PENDING -> IN_PROGRESS (automatic, first work order {wo.code} created)",
            changes={"status": ["PENDING", "IN_PROGRESS"]},
        )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": str(wo.id), "status": "PENDING"})

    response = WorkOrderResponse.model_validate(wo)

    # Soft over-assignment check
    total_assigned_result = await db.execute(
        select(func.sum(WorkOrder.qty)).where(
            WorkOrder.manufacturing_order_id == wo.manufacturing_order_id,
            WorkOrder.qty.isnot(None),
        )
    )
    total_assigned = float(total_assigned_result.scalar() or 0)
    mo_qty = float(mo.qty) if mo.qty else 0.0
    if mo_qty > 0 and total_assigned > mo_qty:
        response.warning = "total_assigned_exceeds_mo_qty"
        response.total_assigned = total_assigned
        response.mo_qty = mo_qty

    return response

@router.put("/work-orders/{wo_id}", response_model=WorkOrderResponse)
async def update_work_order(
    wo_id: str,
    payload: WorkOrderCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.edit')),
):
    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    _require_wo_scope(current_user, wo.work_center.center_type if wo.work_center else None)
    if payload.work_center_id != wo.work_center_id:
        _require_wo_scope(current_user, await _wc_type(db, payload.work_center_id))

    if wo.status == "CANCELLED":
        raise HTTPException(status_code=400, detail="This work order is cancelled — reopen it before editing")

    # Once output has been logged the WO's shape is history, not a plan. Rewriting it
    # orphans what already moved: the completions were consumed out of THIS input
    # location, credited to THIS output location, and consumed the step pegged by
    # THIS bom_operation_id. Notes, name, dates and sequence stay editable.
    logged = float((await db.execute(
        select(func.sum(MOCompletion.qty_completed)).where(
            MOCompletion.work_order_id == wo.id,
            MOCompletion.rejected == False,  # noqa: E712
        )
    )).scalar() or 0)
    if logged > 0:
        frozen = []
        if payload.work_center_id != wo.work_center_id:
            frozen.append("work center")
        if payload.bom_operation_id != wo.bom_operation_id:
            frozen.append("routing step")
        if payload.input_location_id is not None or payload.output_location_id is not None:
            if payload.input_location_id != wo.input_location_id:
                frozen.append("input location")
            if payload.output_location_id != wo.output_location_id:
                frozen.append("output location")
        if frozen:
            raise HTTPException(
                status_code=400,
                detail=f"{float(logged):g} already logged on this work order — its "
                       f"{', '.join(frozen)} can no longer be changed. Cancel it and cut a new one instead.",
            )
    # Dropping the target below what is already logged would put the WO past 100%
    # and re-trip the auto-complete arithmetic in add_mo_completion.
    if payload.qty is not None and float(payload.qty) + 1e-9 < logged:
        raise HTTPException(
            status_code=400,
            detail=f"Qty cannot be below the {float(logged):g} already logged on this work order",
        )

    before = _wo_snapshot(wo)

    wo.sequence = payload.sequence
    if payload.name is not None:
        wo.name = payload.name
    wo.work_center_id = payload.work_center_id
    wo.bom_operation_id = payload.bom_operation_id
    wo.next_destination_location_id = payload.next_destination_location_id
    wo.next_destination_work_center_id = payload.next_destination_work_center_id
    wo.qty = payload.qty
    wo.planned_duration_hours = payload.planned_duration_hours
    wo.notes = payload.notes
    wo.target_start_date = payload.target_start_date
    wo.target_end_date = payload.target_end_date

    # Re-populate locations: explicit payload values win; fall back to new WC's defaults
    if payload.input_location_id is not None or payload.output_location_id is not None:
        wo.input_location_id = payload.input_location_id
        wo.output_location_id = payload.output_location_id
    elif payload.work_center_id:
        wc_result = await db.execute(select(WorkCenter).filter(WorkCenter.id == payload.work_center_id))
        wc_upd = wc_result.scalars().first()
        if wc_upd:
            wo.input_location_id, wo.output_location_id = await work_center_service.resolve_locations(db, wc_upd.id)
    else:
        wo.input_location_id = None
        wo.output_location_id = None

    await db.commit()

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()

    # Before -> after, not the payload. `changes=payload.model_dump()` recorded what
    # was SENT: every field, whether or not it moved, and with no previous value — so
    # a WO whose qty, work center or locations were rewritten could not be
    # reconstructed from the log, which is the one question asked of it.
    diff = _wo_diff(before, _wo_snapshot(wo))
    await audit_service.log_activity(
        db, user_id=current_user.id, action="UPDATE",
        entity_type="WorkOrder", entity_id=wo_id,
        details=(
            f"Updated Work Order '{wo.code or wo.name}': "
            + ", ".join(f"{f} {a} -> {b}" for f, (a, b) in diff.items())
        ) if diff else f"Updated Work Order '{wo.code or wo.name}' (no field changed)",
        changes=diff,
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": wo.status})

    response = WorkOrderResponse.model_validate(wo)

    # Soft over-assignment check
    total_assigned_result = await db.execute(
        select(func.sum(WorkOrder.qty)).where(
            WorkOrder.manufacturing_order_id == wo.manufacturing_order_id,
            WorkOrder.qty.isnot(None),
        )
    )
    total_assigned = float(total_assigned_result.scalar() or 0)

    mo_result = await db.execute(
        select(ManufacturingOrder).filter(ManufacturingOrder.id == wo.manufacturing_order_id)
    )
    mo = mo_result.scalars().first()
    mo_qty = float(mo.qty) if mo and mo.qty else 0.0

    if mo_qty > 0 and total_assigned > mo_qty:
        response.warning = "total_assigned_exceeds_mo_qty"
        response.total_assigned = total_assigned
        response.mo_qty = mo_qty

    return response

@router.put("/work-orders/{wo_id}/status", response_model=WorkOrderResponse)
async def update_work_order_status(
    wo_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    valid = {"PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"}
    if status not in valid:
        raise HTTPException(status_code=400, detail=f"Status must be one of {valid}")

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    _require_wo_scope(current_user, wo.work_center.center_type if wo.work_center else None)

    previous_status = wo.status
    wo.status = status
    if status == "IN_PROGRESS" and not wo.actual_start_date:
        wo.actual_start_date = datetime.utcnow()
    if status == "COMPLETED" and not wo.actual_end_date:
        wo.actual_end_date = datetime.utcnow()

    # Starting a WEAVING WO no longer touches the warp: beams are mounted on the
    # machine and stay lotted for their whole life there, shared by every WO that
    # runs on the loom. Nothing to merge — see services/beam_service.py.

    # A closed WO is not being woven any more, so its loom run closes with it —
    # otherwise the run keeps accruing elapsed working days against an order nobody
    # is working, which is exactly the distortion pausing exists to prevent.
    # DELIVERED is deliberately not a close (qty met, order still open).
    stopped = []
    if status in weaving_service.CLOSING_WO_STATUSES:
        stopped = await weaving_service.stop_runs(
            db, work_order_id=wo.id, username=current_user.username,
        )

    # A dye bath cannot outlive the WO it belongs to: closing the WO takes every
    # bath under it off the machine, cancelling it drops them, and reopening the WO
    # reopens the ones that were never closed on their own. The runs' statuses used
    # to be written independently of this, which is how a COMPLETED WO ended up with
    # a PENDING bath — see services/dyeing_run_service for the whole rule.
    dye_runs_synced = await dyeing_run_service.sync_wo_runs(db, wo.id, wo_status=status)

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "STATUS_CHANGE", "WorkOrder", wo_id,
        # Both sides, matching the MO equivalent (api/manufacturing's
        # update_manufacturing_order_status). Logging only the destination made a
        # reopen indistinguishable from a first start in the trail.
        details=f"{previous_status} -> {status}",
        changes={"status": [previous_status, status]},
    )
    await weaving_service.audit_and_broadcast_stops(
        db, current_user.id, stopped, f"work order {status.lower()}")
    for run, was, now in dye_runs_synced:
        await audit_service.log_activity(
            db, current_user.id, "STATUS_CHANGE", "DyeingRun", str(run.id),
            details=f"{was} -> {now} (automatic, work order {status.lower()})",
            changes={"status": [was, now]},
        )
    if dye_runs_synced:
        await manager.broadcast({"type": "DYEING_RUN_UPDATE", "wo_id": wo_id})
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": status})

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    return result.scalars().first()

@router.post("/work-orders/mark-printed-bulk")
async def mark_work_orders_printed_bulk(
    payload: WorkOrderMarkPrintedBulk,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.print_card')),
):
    """Stamp print time on many WOs at once (bulk Kartu Kerja print)."""
    if payload.kind not in ("card", "labels"):
        raise HTTPException(status_code=400, detail="kind must be 'card' or 'labels'")
    if not payload.ids:
        return {"updated": 0}
    result = await db.execute(select(WorkOrder).filter(WorkOrder.id.in_(payload.ids)))
    wos = result.scalars().all()
    # Same scope wall as the single-WO route: card_printed_at drives the `unprinted`
    # filter the floor dispatches off, so a weaving-scoped user must not be able to
    # mark dyeing cards printed just by batching the ids.
    types = {}
    if wos:
        rows = await db.execute(
            select(WorkCenter.id, WorkCenter.center_type)
            .filter(WorkCenter.id.in_({w.work_center_id for w in wos if w.work_center_id}))
        )
        types = {str(i): t for i, t in rows.all()}
    for wo in wos:
        _require_wo_scope(current_user, types.get(str(wo.work_center_id)))
    now = datetime.utcnow()
    for wo in wos:
        if payload.kind == "card":
            wo.card_printed_at = now
        else:
            wo.labels_printed_at = now
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "PRINT", "WorkOrder", ",".join(str(w.id) for w in wos)[:255],
        details=f"Bulk printed {'Kartu Kerja' if payload.kind == 'card' else 'bag labels'} ({len(wos)} WO)"
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "bulk": True})
    return {"updated": len(wos)}


@router.post("/work-orders/{wo_id}/mark-printed", response_model=WorkOrderResponse)
async def mark_work_order_printed(
    wo_id: str,
    kind: str = "card",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.print_card')),
):
    """Stamp print time on a WO. kind='card' (Kartu Kerja) or 'labels' (bag labels).
    Idempotent — reprints just overwrite with a newer timestamp."""
    if kind not in ("card", "labels"):
        raise HTTPException(status_code=400, detail="kind must be 'card' or 'labels'")
    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")

    now = datetime.utcnow()
    if kind == "card":
        wo.card_printed_at = now
    else:
        wo.labels_printed_at = now

    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "PRINT", "WorkOrder", wo_id,
        details=f"Printed {'Kartu Kerja' if kind == 'card' else 'bag labels'}"
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": wo.status})

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo_id)
    )
    return result.scalars().first()


@router.post("/work-orders/bulk", response_model=list[WorkOrderResponse])
async def create_work_orders_bulk(
    payloads: list[WorkOrderCreate],
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.create')),
):
    if not payloads:
        return []

    mo_id = payloads[0].manufacturing_order_id
    if any(p.manufacturing_order_id != mo_id for p in payloads):
        raise HTTPException(status_code=400, detail="All items must share the same manufacturing_order_id")

    mo_result = await db.execute(
        select(ManufacturingOrder)
        .options(
            selectinload(ManufacturingOrder.attribute_values),
            selectinload(ManufacturingOrder.planned_components),
        )
        .filter(ManufacturingOrder.id == mo_id)
    )
    mo = mo_result.scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    wc_ids = {p.work_center_id for p in payloads if p.work_center_id}
    wc_cache: dict = {}
    wc_loc_map = await work_center_service.location_map(db) if wc_ids else {}
    if wc_ids:
        wc_result = await db.execute(select(WorkCenter).filter(WorkCenter.id.in_(wc_ids)))
        for wc_row in wc_result.scalars().all():
            wc_cache[wc_row.id] = wc_row

    for wc_id in wc_ids:
        _require_wo_scope(current_user, wc_cache[wc_id].center_type if wc_id in wc_cache else None)

    created_wos = []
    for payload in payloads:
        seq_num, wo_code = await next_wo_code(db, mo)
        wc = wc_cache.get(payload.work_center_id) if payload.work_center_id else None

        planned_recipe_id = None
        if wc and wc.center_type == "DYEING":
            planned_recipe_id = (await _resolve_dye_recipe(db, mo)).id

        name = payload.name or (wc.name if wc else wo_code)
        sequence = payload.sequence if payload.sequence and payload.sequence > 1 else seq_num

        input_location_id = payload.input_location_id
        output_location_id = payload.output_location_id
        if wc:
            wc_in, wc_out = work_center_service.resolve_locations_from_map(wc_loc_map, wc.id)[:2]
            if input_location_id is None:
                input_location_id = wc_in
            if output_location_id is None:
                output_location_id = wc_out

        wo = WorkOrder(
            manufacturing_order_id=mo_id,
            sequence=sequence,
            code=wo_code,
            name=name,
            work_center_id=payload.work_center_id,
            bom_operation_id=payload.bom_operation_id,
            planned_recipe_id=planned_recipe_id,
            input_location_id=input_location_id,
            output_location_id=output_location_id,
            qty=payload.qty,
            ends=payload.ends,
            planned_duration_hours=payload.planned_duration_hours,
            notes=payload.notes,
            target_start_date=payload.target_start_date,
            target_end_date=payload.target_end_date,
            next_destination_work_center_id=payload.next_destination_work_center_id,
            next_destination_location_id=payload.next_destination_location_id,
            status="PENDING",
        )
        db.add(wo)
        await db.flush()

        if planned_recipe_id:
            dye_run = DyeingRun(
                work_order_id=wo.id,
                recipe_id=planned_recipe_id,
                run_number=1,
                substrate_qty=wo.qty or 0,
                # No status, same as the single-WO path above: derived, not typed.
            )
            db.add(dye_run)
            await db.flush()
            await dyeing_run_service.seed_planned_bath(db, dye_run, payload.bath_volume_liters)
        created_wos.append(wo)

    # Auto-start MO once if still PENDING. Stock is checked at staging time
    # (line-side issue), not at WO creation.
    mo_auto_started = mo.status == "PENDING"
    if mo_auto_started:
        mo.status = "IN_PROGRESS"
        mo.actual_start_date = datetime.utcnow()

    await db.commit()

    wo_ids = [wo.id for wo in created_wos]
    result = await db.execute(
        select(WorkOrder).options(*_wo_options())
        .filter(WorkOrder.id.in_(wo_ids))
        .order_by(WorkOrder.sequence)
    )
    wos = result.scalars().all()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE",
        entity_type="WorkOrder", entity_id=str(mo_id),
        details=f"Bulk created {len(wos)} Work Orders for MO '{mo.code}'",
        changes={"count": len(wos), "mo_id": str(mo_id)}
    )
    if mo_auto_started:
        # Same automatic start as the single-WO route — see the note there.
        await audit_service.log_activity(
            db, user_id=current_user.id, action="STATUS_CHANGE",
            entity_type="ManufacturingOrder", entity_id=str(mo.id),
            details=f"PENDING -> IN_PROGRESS (automatic, {len(wos)} work orders created)",
            changes={"status": ["PENDING", "IN_PROGRESS"]},
        )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "mo_id": str(mo_id), "bulk": True})
    if mo.status == "IN_PROGRESS":
        await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": str(mo.id), "status": "IN_PROGRESS", "code": mo.code})

    return list(wos)


# ─────────────────────────────────────────────────────────────────────────────
# Material staging (line-side issue)
#
# A WO consumes only the materials allocated to its routing step
# (planned_component.bom_operation_id == wo.bom_operation_id). Staging moves
# those materials from each one's source store -> the WO's input location, so
# netting (source store) and consumption (input loc) reference the same stock.
# ─────────────────────────────────────────────────────────────────────────────

async def _backfill_wo_locations(db: AsyncSession, wo: WorkOrder) -> None:
    """Fill a WO's blank locations from its work center's effective ones.

    WOs snapshot locations at creation, so a WO cut before its group had staging
    areas set (or before location inheritance existed) carries NULLs and would
    refuse to stage. Re-resolve here instead of forcing the floor to re-cut the WO.
    Caller commits — read paths just get the in-memory value."""
    if not wo.work_center_id or (wo.input_location_id and wo.output_location_id):
        return
    wc_in, wc_out = await work_center_service.resolve_locations(db, wo.work_center_id)
    if not wo.input_location_id and wc_in:
        wo.input_location_id = wc_in
    if not wo.output_location_id and wc_out:
        wo.output_location_id = wc_out


async def _load_wo_and_mo(db: AsyncSession, wo_id: str):
    res = await db.execute(select(WorkOrder).filter(WorkOrder.id == wo_id))
    wo = res.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    await _backfill_wo_locations(db, wo)
    mo_res = await db.execute(
        select(ManufacturingOrder)
        .options(selectinload(ManufacturingOrder.planned_components))
        .filter(ManufacturingOrder.id == wo.manufacturing_order_id)
    )
    mo = mo_res.scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")
    return wo, mo


async def _wo_staged_by_item(db: AsyncSession, wo: WorkOrder) -> dict[str, float]:
    """Qty currently staged to this WO's input location, per item.

    Sums ALL 'Staging' ledger rows tagged with this WO's id at that location, so a
    reversal (POST /work-orders/{id}/unstage) nets the original move back out.
    Filtering to positives here is what used to make the total disagree with
    `_wo_staged_lots` below, which has always netted — and it meant a status of
    STAGED could never fall back once material left the line.
    """
    if not wo.input_location_id:
        return {}
    rows = await db.execute(
        select(StockLedger.item_id, func.sum(StockLedger.qty_change))
        .where(
            StockLedger.reference_type == "Staging",
            StockLedger.reference_id == str(wo.id),
            StockLedger.location_id == wo.input_location_id,
        )
        .group_by(StockLedger.item_id)
    )
    return {str(i): max(0.0, float(s or 0)) for i, s in rows.all()}


async def _wo_staged_lots(db: AsyncSession, wo: WorkOrder) -> dict[str, list[WOStagedLot]]:
    """The lots behind each item's staged total, per item.

    A dyeing stager reading `staged = 10.00 kg` can't tell which greige lots are
    on the line — two GRG- lots off the same item differ only by size, combo and
    shade. Grouped off the same 'Staging' ledger rows the total comes from, with
    negatives netted out (e.g. a reversal), so the two agree for lot-tracked
    material; batch-less staging carries no lot and is simply absent. `on_line` is
    read live off the balance, so a lot already consumed reads 0 left while the
    staged total it contributed stays put.
    """
    if not wo.input_location_id:
        return {}
    rows = await db.execute(
        select(
            StockLedger.item_id,
            StockLedger.batch_id,
            func.sum(StockLedger.qty_change),
            func.max(StockLedger.created_at),
        )
        .where(
            StockLedger.reference_type == "Staging",
            StockLedger.reference_id == str(wo.id),
            StockLedger.location_id == wo.input_location_id,
            StockLedger.batch_id.isnot(None),
        )
        .group_by(StockLedger.item_id, StockLedger.batch_id)
    )
    agg = [(str(i), b, float(q or 0), at) for i, b, q, at in rows.all() if float(q or 0) > 1e-9]
    if not agg:
        return {}

    batch_ids = [b for _, b, _, _ in agg]
    bres = await db.execute(select(Batch).where(Batch.id.in_(batch_ids)))
    batches = list(bres.scalars().all())
    # Same identity resolvers the batch pickers use, so a staged lot is labelled
    # exactly like the same lot in the picker list below it.
    await _resolve_batch_origins(db, batches)
    await _resolve_batch_variants(db, batches)
    by_id = {str(b.id): b for b in batches}

    bal_res = await db.execute(
        select(StockBalance.batch_key, func.sum(StockBalance.qty)).where(
            StockBalance.location_id == wo.input_location_id,
            StockBalance.batch_key.in_([str(b) for b in batch_ids]),
        ).group_by(StockBalance.batch_key)
    )
    on_line = {k: float(v or 0) for k, v in bal_res.all()}

    out: dict[str, list[WOStagedLot]] = {}
    for item_id, batch_id, qty, at in agg:
        b = by_id.get(str(batch_id))
        out.setdefault(item_id, []).append(WOStagedLot(
            batch_id=batch_id,
            batch_number=getattr(b, "batch_number", None),
            qty=qty,
            on_line=on_line.get(str(batch_id), 0.0),
            staged_at=at,
            vendor_lot=getattr(b, "vendor_lot", None),
            bom_size_snapshot=getattr(b, "bom_size_snapshot", None),
            variant_attributes=getattr(b, "variant_attributes", None),
            color_code=getattr(b, "color_code", None),
            color_name=getattr(b, "color_name", None),
            color_hex=getattr(b, "color_hex", None),
            labdip_variant_code=getattr(b, "labdip_variant_code", None),
            wo_code=getattr(b, "wo_code", None),
            mo_code=getattr(b, "mo_code", None),
        ))
    for lots in out.values():
        lots.sort(key=lambda l: (l.staged_at or datetime.min, l.batch_number or ""))
    return out


async def _wo_step_components(db: AsyncSession, wo: WorkOrder, mo: ManufacturingOrder) -> list:
    """Planned components this WO should stage/consume.

    Detection is layered, most-specific first, so a WO always resolves its
    materials even when the BOM routing step isn't wired up perfectly:
      1. Exact routing step — material pegged to this WO's bom_operation_id.
      2. Work-center TYPE — material whose BOM operation runs on the same kind
         of work center as this WO (DYEING, SETTING, etc.). This mirrors how WO
         type is detected elsewhere and covers the common case where the WO
         wasn't handed the exact bom_operation_id but the work center matches.
      3. WEAVING beam special-case — beams are plant-level and usually untagged;
         a WEAVING WO consumes the MO's beam-category components directly.
      4. Step-agnostic materials — BOM lines pinned to no operation belong to
         any step, so surface them rather than leave the WO with nothing."""
    comps = list(mo.planned_components or [])
    if not comps:
        return []

    # 1) Exact routing-step match.
    if wo.bom_operation_id:
        exact = [
            c for c in comps
            if c.bom_operation_id and str(c.bom_operation_id) == str(wo.bom_operation_id)
        ]
        if exact:
            return exact

    if not wo.work_center_id:
        return []
    wc_type = (await _wc_type(db, wo.work_center_id)) or ""

    # 2) Work-center-type match (operation-agnostic detection).
    op_ids = [c.bom_operation_id for c in comps if c.bom_operation_id]
    if wc_type and op_ids:
        rows = await db.execute(
            select(BOMOperation.id, WorkCenter.center_type)
            .join(WorkCenter, BOMOperation.work_center_id == WorkCenter.id)
            .where(BOMOperation.id.in_(op_ids))
        )
        same_ops = {str(oid) for oid, ct in rows.all() if (ct or "") == wc_type}
        by_type = [c for c in comps if c.bom_operation_id and str(c.bom_operation_id) in same_ops]
        if by_type:
            return by_type

    # 3) WEAVING beam special-case.
    if wc_type.upper() in ("WEAVING", "TENUN"):
        ids = await beam_service.beam_item_ids(db, [c.item_id for c in comps])
        beams = [c for c in comps if str(c.item_id) in ids]
        if beams:
            return beams

    # 4) Step-agnostic materials (not pinned to any operation).
    return [c for c in comps if not c.bom_operation_id]


async def _suggest_beam_batch(db: AsyncSession, mo: ManufacturingOrder, item_id) -> uuid.UUID | None:
    """Beam is generic plant-level stock, not pegged to a producing MO (no
    MODependency link between a WEAVING MO and the BEAMING MOs that made its
    beam — see plant-level netting) and not pinned to a fixed location either.
    Suggest the oldest unconsumed batch of this item anywhere in the plant,
    FIFO, still fully overridable in the staging picker."""
    batch_res = await db.execute(
        select(Batch)
        .where(Batch.item_id == item_id, Batch.quality_status.notin_(reject_service.UNPICKABLE_GRADES))
        .order_by(Batch.created_at.asc())
    )
    candidates = batch_res.scalars().all()
    if not candidates:
        return None
    bal_q = (
        select(StockBalance.batch_key, func.sum(StockBalance.qty))
        .filter(StockBalance.batch_key.in_([str(b.id) for b in candidates]))
        .group_by(StockBalance.batch_key)
    )
    remaining = {k: float(v or 0) for k, v in (await db.execute(bal_q)).all()}
    for b in candidates:
        if remaining.get(str(b.id), 0.0) > 0:
            return b.id
    return None


# Plant-wide putaway fallback ordering: real storage bins first, then childless
# zones, then childless warehouses (both are legal stock locations, just coarser).
_LOC_TYPE_RANK = {"bin": 0, "zone": 1, "warehouse": 2}


async def _descendant_leaves(db: AsyncSession, root_id) -> list[Location]:
    """Leaf locations (bins) under a root, walking the max-3-level hierarchy."""
    nodes: dict[str, Location] = {}
    level_ids = [root_id]
    for _ in range(2):  # warehouse -> zone -> bin
        res = await db.execute(
            select(Location).options(joinedload(Location.parent)).where(Location.parent_id.in_(level_ids))
        )
        children = res.scalars().all()
        if not children:
            break
        for c in children:
            nodes[str(c.id)] = c
        level_ids = [c.id for c in children]
    parent_ids = {str(c.parent_id) for c in nodes.values()}
    return [c for c in nodes.values() if str(c.id) not in parent_ids]


@router.get("/manufacturing-orders/{mo_id}/putaway-suggestion", response_model=PutawaySuggestionResponse)
async def get_mo_putaway_suggestion(
    mo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view", "beam.view")),
):
    """Putaway planning aid for the MO: candidate bins under the routing's final
    output area plus a suggested one. Priority: bin already assigned on the MO
    -> item master's default putaway bin -> bin already holding the output item
    (addition to stock) -> empty bin -> first bin by code. When nothing in that
    chain resolves an area, every leaf location plant-wide is offered instead
    (reason "all_locations") so the bin is always assignable. Advisory — planning
    picks and saves via PATCH .../putaway."""
    mo_res = await db.execute(select(ManufacturingOrder).filter(ManufacturingOrder.id == mo_id))
    mo = mo_res.scalars().first()
    if not mo:
        raise HTTPException(status_code=404, detail="Manufacturing Order not found")

    # Root area = MO's assigned bin's zone if set, else the item master's default
    # putaway bin, else the final routing step's work-center output location,
    # else the last WO's output location.
    root_id = mo.planned_putaway_location_id
    item_default_used = False
    if not root_id and mo.item_id:
        item_default_res = await db.execute(
            select(Item.default_putaway_location_id).filter(Item.id == mo.item_id)
        )
        root_id = item_default_res.scalar()
        item_default_used = root_id is not None
    if not root_id and mo.bom_id:
        # Walk the routing backwards and take the first step whose work center
        # resolves an output location — its own or one inherited from its group.
        op_res = await db.execute(
            select(BOMOperation.work_center_id)
            .where(BOMOperation.bom_id == mo.bom_id, BOMOperation.work_center_id.isnot(None))
            .order_by(BOMOperation.sequence.desc())
        )
        op_wc_ids = [r[0] for r in op_res.all()]
        if op_wc_ids:
            wc_loc_map = await work_center_service.location_map(db)
            for wc_id in op_wc_ids:
                out_id = work_center_service.resolve_locations_from_map(wc_loc_map, wc_id)[1]
                if out_id:
                    root_id = out_id
                    break
    if not root_id:
        wo_res = await db.execute(
            select(WorkOrder.output_location_id)
            .where(WorkOrder.manufacturing_order_id == mo.id, WorkOrder.output_location_id.isnot(None))
            .order_by(WorkOrder.sequence.desc())
            .limit(1)
        )
        root_id = wo_res.scalar()
    root = None
    if root_id:
        root_res = await db.execute(
            select(Location).options(joinedload(Location.parent)).where(Location.id == root_id)
        )
        root = root_res.scalars().first()

    configured_bin = None
    all_locations_fallback = False
    if root is None:
        # Nothing in the chain resolves — no bin assigned, no item default, the BOM
        # carries no routing operations, and no WO exists yet (the normal shape of a
        # PENDING MO straight out of a Production Run). Offering an empty list makes
        # putaway unassignable until someone creates a WO, which defeats the point of
        # planning the bin up front, so fall back to every leaf location. Real bins
        # rank above childless zones/warehouses so storage bins surface first.
        all_res = await db.execute(select(Location).options(joinedload(Location.parent)))
        leaves = [l for l in all_res.scalars().unique().all() if not l.has_children]
        if not leaves:
            return PutawaySuggestionResponse()
        all_locations_fallback = True
    else:
        leaves = await _descendant_leaves(db, root.id)
        if not leaves:
            # Output points straight at a leaf (bin, or childless zone/warehouse):
            # that explicit config stays the suggestion; siblings become overrides.
            configured_bin = root
            leaves = [root]
            if root.parent_id:
                sib_res = await db.execute(
                    select(Location).options(joinedload(Location.parent)).where(Location.parent_id == root.parent_id)
                )
                leaves += [s for s in sib_res.scalars().all()
                           if not s.has_children and str(s.id) != str(root.id)]

    bal_res = await db.execute(
        select(
            StockBalance.location_id,
            func.sum(StockBalance.qty),
            func.sum(case((StockBalance.item_id == mo.item_id, StockBalance.qty), else_=0)),
        )
        .where(StockBalance.location_id.in_([l.id for l in leaves]))
        .group_by(StockBalance.location_id)
    )
    totals = {str(lid): (float(t or 0), float(i or 0)) for lid, t, i in bal_res.all()}

    leaves.sort(key=lambda l: (
        _LOC_TYPE_RANK.get((l.location_type or "").lower(), 3) if all_locations_fallback else 0,
        l.code or l.name or "",
    ))
    configured_reason = "item_default" if item_default_used else "configured"
    suggested, reason = configured_bin, (configured_reason if configured_bin is not None else None)
    if suggested is None:
        same = [l for l in leaves if totals.get(str(l.id), (0.0, 0.0))[1] > 0]
        if same:
            suggested = max(same, key=lambda l: totals[str(l.id)][1])
            reason = "same_item"
    if suggested is None and all_locations_fallback:
        # No output area to reason about — leaves[0] is the first real bin by code.
        # Flagged so the UI can say the whole plant is listed, not a routing subtree.
        suggested, reason = leaves[0], "all_locations"
    if suggested is None:
        empty = next((l for l in leaves if totals.get(str(l.id), (0.0, 0.0))[0] <= 0), None)
        if empty is not None:
            suggested, reason = empty, "empty_bin"
    if suggested is None:
        suggested, reason = leaves[0], "first_bin"

    def _opt(l: Location) -> PutawayBinOption:
        t, i = totals.get(str(l.id), (0.0, 0.0))
        pn = l.parent_name
        return PutawayBinOption(
            id=l.id, code=l.code, name=l.name,
            full_path=f"{pn} / {l.name}" if pn else (l.name or l.code),
            total_on_hand=t, item_on_hand=i,
        )

    return PutawaySuggestionResponse(
        suggested_location_id=suggested.id,
        reason=reason,
        bins=[_opt(l) for l in leaves],
    )


async def _wo_required_rows(db: AsyncSession, wo: WorkOrder, mo: ManufacturingOrder) -> list[WORequiredMaterial]:
    comps = await _wo_step_components(db, wo, mo)
    if not comps:
        return []
    staged_by_item = await _wo_staged_by_item(db, wo)
    staged_lots_by_item = await _wo_staged_lots(db, wo)

    item_ids = [c.item_id for c in comps]
    # Warp beams don't belong to a WO — they're mounted on the loom and shared by
    # every WO that runs there (size S, then M, then L, all off one warp). So for
    # beam items "staged" means "mounted on this machine", read from the loom's
    # open BeamMounts instead of this WO's staging ledger tags. Without this, the
    # second size WO sees staged=0 even though the warp is physically up.
    beam_ids: set[str] = set()
    beam_slots = 1
    if await beam_service.is_weaving_wo(db, wo):
        beam_ids = await beam_service.beam_item_ids(db, item_ids)
        if beam_ids:
            beam_slots = max(1, int((await db.execute(
                select(WorkCenter.beam_slots).where(WorkCenter.id == wo.work_center_id)
            )).scalar() or 1))
            for bid in beam_ids:
                staged_by_item[bid] = await beam_service.mounted_qty(
                    db, wo.work_center_id, uuid.UUID(bid)
                )

    items_res = await db.execute(select(Item).where(Item.id.in_(item_ids)))
    items = {str(it.id): it for it in items_res.scalars().all()}

    loc_ids = {(c.source_location_id or mo.source_location_id or mo.location_id) for c in comps}
    loc_ids = {l for l in loc_ids if l}
    loc_names: dict[str, str] = {}
    if loc_ids:
        lres = await db.execute(
            select(Location.id, Location.name, Location.code).where(Location.id.in_(loc_ids))
        )
        loc_names = {str(i): (n or c or "") for i, n, c in lres.all()}

    wo_qty = float(wo.qty or mo.qty or 0)
    rows: list[WORequiredMaterial] = []
    for c in comps:
        if c.percentage:
            req = (wo_qty * float(c.percentage)) / 100
        elif c.qty:
            req = wo_qty * float(c.qty)
        else:
            continue
        it = items.get(str(c.item_id))
        # Source resolution (industry chain): BOM-line override -> item-master
        # default issue location -> MO source (legacy fallback). The staging modal
        # can still override per row when none resolves.
        src = c.source_location_id or (it.default_source_location_id if it else None) or mo.source_location_id
        attrs = list(c.attribute_value_ids or [])
        on_hand = await stock_service.get_stock_balance(db, c.item_id, src, attrs) if src else 0.0
        staged = staged_by_item.get(str(c.item_id), 0.0)
        # "Needs a batch pick" = the item is lot_tracked OR it physically sits as
        # batch stock at the source (e.g. a beam — batch-tracked but lot_tracked=false).
        # Staging such an item without a batch would corrupt the batch_key="" balance.
        batch_required = bool(it and it.lot_tracked)
        if not batch_required:
            # Plant-wide check — a batch-tracked item (e.g. beam) may physically sit
            # somewhere other than the resolved default source (see _suggest_beam_batch).
            bcount = await db.execute(
                select(func.count()).select_from(StockBalance).where(
                    StockBalance.item_id == c.item_id,
                    StockBalance.batch_key != "",
                    StockBalance.qty > 0,
                )
            )
            batch_required = (bcount.scalar() or 0) > 0
        suggested_batch_id = await _suggest_beam_batch(db, mo, c.item_id) if batch_required else None
        # A batch-tracked material's real source is wherever its batch sits, not the
        # BOM/item default — once we have a suggestion, prefer its actual location.
        if suggested_batch_id:
            sb_res = await db.execute(
                select(StockBalance.location_id).where(
                    StockBalance.batch_key == str(suggested_batch_id), StockBalance.qty > 0
                ).limit(1)
            )
            sb_loc = sb_res.scalar()
            if sb_loc:
                src = sb_loc
                on_hand = await stock_service.get_stock_balance(db, c.item_id, src, attrs)
                if str(src) not in loc_names:
                    name_res = await db.execute(select(Location.name, Location.code).where(Location.id == src))
                    row = name_res.first()
                    if row:
                        loc_names[str(src)] = row[0] or row[1] or ""
        is_beam = str(c.item_id) in beam_ids
        rows.append(WORequiredMaterial(
            item_id=c.item_id,
            item_code=it.code if it else None,
            item_name=it.name if it else None,
            attribute_value_ids=[uuid.UUID(s) for s in attrs],
            uom=it.uom if it else None,
            required_qty=req,
            source_location_id=src,
            source_location_name=loc_names.get(str(src)),
            on_hand=float(on_hand),
            staged=staged,
            shortfall=max(0.0, req - staged),
            lot_tracked=batch_required,
            suggested_batch_id=suggested_batch_id,
            is_beam=is_beam,
            mounted_pcs=(
                await beam_service.mounted_pcs(db, wo.work_center_id, c.item_id) if is_beam else 0
            ),
            required_pcs=beam_slots if is_beam else 0,
            # Beams are loom-mounted, not staged to this WO — their identity comes
            # from the machine's open mounts, listed separately by the modal.
            staged_lots=[] if is_beam else staged_lots_by_item.get(str(c.item_id), []),
        ))
    return rows


def _staging_status(rows: list[WORequiredMaterial]) -> str:
    if not rows:
        return "NOT_STAGED"
    # Beams are counted in whole pieces against the loom's beam positions ("4
    # lines = 4 beams"), never in kg — a warp is either up or it isn't.
    def _ok(r: WORequiredMaterial) -> bool:
        if r.is_beam:
            return r.mounted_pcs >= max(1, r.required_pcs)
        return r.staged + 1e-9 >= r.required_qty

    def _touched(r: WORequiredMaterial) -> bool:
        return r.mounted_pcs > 0 if r.is_beam else r.staged > 0

    if not any(_touched(r) for r in rows):
        return "NOT_STAGED"
    return "STAGED" if all(_ok(r) for r in rows) else "PARTIAL"


@router.get("/work-orders/{wo_id}/required-materials", response_model=list[WORequiredMaterial])
async def get_wo_required_materials(
    wo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view", "beam.view")),
):
    wo, mo = await _load_wo_and_mo(db, wo_id)
    return await _wo_required_rows(db, wo, mo)


@router.post("/work-orders/{wo_id}/stage", response_model=WorkOrderResponse)
async def stage_wo_materials(
    wo_id: str,
    payload: WOStagePayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.stage')),
):
    wo, mo = await _load_wo_and_mo(db, wo_id)
    _require_wo_scope(current_user, await _wc_type(db, wo.work_center_id))
    if not wo.input_location_id:
        raise HTTPException(status_code=422, detail="Work Order has no input location — assign a machine with a supply area first")

    # Required map keyed by item — validates that a line belongs to this step and
    # supplies its default source/variant. NOT a cap: see the move_qty note below.
    required_rows = await _wo_required_rows(db, wo, mo)
    req_by_item = {str(r.item_id): r for r in required_rows}
    if not req_by_item:
        raise HTTPException(status_code=422, detail="This WO has no materials to stage (no step assigned, or step has no materials)")

    staged_any = False
    for line in payload.lines:
        qty = float(line.qty or 0)
        rr = req_by_item.get(str(line.item_id))
        if not rr:
            raise HTTPException(status_code=400, detail=f"Item {line.item_id} is not a material of this WO's step")

        # Warp beam: mount it on the MACHINE, not this WO. The whole physical beam
        # goes up (pcs, not kg — a partial warp makes no sense), it stays lotted,
        # and every WO that runs on the loom afterwards sees it. No shortfall cap.
        if rr.is_beam:
            if not line.batch_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Select which beam to mount for {rr.item_code or line.item_id}",
                )
            await beam_service.mount_beam(
                db, batch_id=line.batch_id, work_center_id=wo.work_center_id,
                qty=qty if qty > 0 else None, source_wo_id=wo.id,
                user=current_user.username,
            )
            staged_any = True
            continue

        if qty <= 0:
            continue
        # Move exactly what was picked — never clipped to the step's remaining
        # shortfall. A lot is one physical bag: staging 12.5 kg against a 12.4 kg
        # step used to move 12.4 and silently leave 0.1 kg of the SAME lot behind
        # in the store, which is not a state the floor can act on. The whole lot
        # goes on the line; the leftover is reassigned from there afterwards
        # (staging claims are latest-row-wins, see services/staging_service.py).
        # Over-staged qty is a readout, not an error — `_staging_status` only ever
        # asks whether staged >= required.
        move_qty = qty
        src = line.source_location_id or rr.source_location_id
        if not src:
            raise HTTPException(status_code=422, detail=f"No source location for {rr.item_code or line.item_id}")
        # Batch-tracked material (lot or beam) must be staged against a specific batch,
        # else the transfer hits the batch_key="" balance and corrupts batch stock.
        if rr.lot_tracked and not line.batch_id:
            raise HTTPException(
                status_code=400,
                detail=f"Select a lot/beam for {rr.item_code or line.item_id} — it is batch-tracked",
            )
        attrs = [str(a) for a in (line.attribute_value_ids or rr.attribute_value_ids or [])]
        # A lot's stock sits under whatever variant key it was produced with (a
        # greige lot off a BLUE/M MO keeps those attrs beside the batch), so both
        # sides of the transfer have to re-post under that same key. Reading it
        # back off the balance row is the only source of truth — the WO's own
        # required-material attrs are the demand, not what the lot was keyed under.
        move_color = None
        if line.batch_id:
            attrs, move_color = await stock_service.batch_variant(db, line.batch_id, src)

        # A lot already staged to another WO at this source is that WO's material —
        # taking it here is the same theft the consumption guard blocks, one step
        # earlier. Normally a no-op: claims live at input locations and staging
        # pulls from a store, so this only fires when the source IS someone's line.
        if line.batch_id:
            held = await staging_service.reserved_by_other(db, src, wo.id, [line.batch_id])
            if held:
                holder_codes = await staging_service.wo_codes(db, set(held.values()))
                holder = holder_codes.get(next(iter(held.values()))) or "another work order"
                raise HTTPException(
                    status_code=409,
                    detail=f"That lot is already staged to {holder} — it has to leave that "
                           f"work order's line before this one can take it",
                )

        # Two-sided transfer: out of source store, into the WO's input location.
        await stock_service.add_stock_entry(
            db, item_id=line.item_id, location_id=src, qty_change=-move_qty,
            reference_type="Staging", reference_id=str(wo.id),
            attribute_value_ids=attrs, color_id=move_color,
            batch_id=line.batch_id,
        )
        await stock_service.add_stock_entry(
            db, item_id=line.item_id, location_id=wo.input_location_id, qty_change=move_qty,
            reference_type="Staging", reference_id=str(wo.id),
            attribute_value_ids=attrs, color_id=move_color,
            batch_id=line.batch_id,
        )
        staged_any = True

    if not staged_any:
        raise HTTPException(status_code=400, detail="Nothing to stage")

    # Recompute and persist staging status.
    new_rows = await _wo_required_rows(db, wo, mo)
    wo.staging_status = _staging_status(new_rows)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="STAGE",
        entity_type="WorkOrder", entity_id=str(wo.id),
        details=f"Staged materials to WO '{wo.code}' (status {wo.staging_status})",
        changes={"lines": [{"item_id": str(l.item_id), "qty": l.qty} for l in payload.lines]},
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": str(wo.id), "status": wo.status})
    await manager.broadcast({"type": "STOCK_UPDATE"})

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo.id)
    )
    return result.scalars().first()


@router.post("/work-orders/{wo_id}/unstage", response_model=WorkOrderResponse)
async def unstage_wo_materials(
    wo_id: str,
    payload: WOUnstagePayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.stage')),
):
    """Return staged material from the WO's input location to a store.

    The exact mirror of /stage, and written as a reversal of it: the ledger rows
    carry the same reference_type "Staging" and reference_id, so the negative at
    the input location nets the original move out of `staged` and the status falls
    back to PARTIAL/NOT_STAGED. Without this route material picked to the wrong
    line could only leave it by being consumed.

    Beams are refused on purpose: a warp is a loom resource pegged to the work
    center, not this WO's material, and it comes off through
    POST /beam-mounts/{id}/dismount (which handles the weighed remnant).
    """
    wo, mo = await _load_wo_and_mo(db, wo_id)
    _require_wo_scope(current_user, await _wc_type(db, wo.work_center_id))
    if not wo.input_location_id:
        raise HTTPException(status_code=422, detail="Work Order has no input location — nothing can be staged to it")

    required_rows = await _wo_required_rows(db, wo, mo)
    req_by_item = {str(r.item_id): r for r in required_rows}

    unstaged_any = False
    for line in payload.lines:
        qty = float(line.qty or 0)
        if qty <= 0:
            continue
        rr = req_by_item.get(str(line.item_id))
        if not rr:
            raise HTTPException(status_code=400, detail=f"Item {line.item_id} is not a material of this WO's step")
        if rr.is_beam:
            raise HTTPException(
                status_code=400,
                detail=f"{rr.item_code or line.item_id} is a warp beam — unmount it from the loom instead",
            )
        if rr.lot_tracked and not line.batch_id:
            raise HTTPException(
                status_code=400,
                detail=f"Select which lot of {rr.item_code or line.item_id} to return — it is batch-tracked",
            )
        dest = line.destination_location_id or rr.source_location_id
        if not dest:
            raise HTTPException(status_code=422, detail=f"No destination location for {rr.item_code or line.item_id}")

        # Same variant-key rule as staging: a lot's stock sits under the key it was
        # produced with, and both sides of the transfer must re-post under it.
        attrs = [str(a) for a in (line.attribute_value_ids or rr.attribute_value_ids or [])]
        move_color = None
        if line.batch_id:
            attrs, move_color = await stock_service.batch_variant(db, line.batch_id, wo.input_location_id)

        # Over-return is blocked by stock_service's own negative-balance guard —
        # it row-locks the balance before checking, so there's nothing to re-check here.
        await stock_service.add_stock_entry(
            db, item_id=line.item_id, location_id=wo.input_location_id, qty_change=-qty,
            reference_type="Staging", reference_id=str(wo.id),
            attribute_value_ids=attrs, color_id=move_color,
            batch_id=line.batch_id,
        )
        await stock_service.add_stock_entry(
            db, item_id=line.item_id, location_id=dest, qty_change=qty,
            reference_type="Staging", reference_id=str(wo.id),
            attribute_value_ids=attrs, color_id=move_color,
            batch_id=line.batch_id,
        )
        unstaged_any = True

    if not unstaged_any:
        raise HTTPException(status_code=400, detail="Nothing to unstage")

    new_rows = await _wo_required_rows(db, wo, mo)
    wo.staging_status = _staging_status(new_rows)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="UNSTAGE",
        entity_type="WorkOrder", entity_id=str(wo.id),
        details=f"Returned staged materials from WO '{wo.code}' (status {wo.staging_status})",
        changes={"lines": [{"item_id": str(l.item_id), "qty": l.qty} for l in payload.lines]},
    )
    await manager.broadcast({"type": "WORK_ORDER_UPDATE", "wo_id": str(wo.id), "status": wo.status})
    await manager.broadcast({"type": "STOCK_UPDATE"})

    result = await db.execute(
        select(WorkOrder).options(*_wo_options()).filter(WorkOrder.id == wo.id)
    )
    return result.scalars().first()


# ─────────────────────────────────────────────────────────────────────────────
# Beam mounts (loom-level warp)
#
# A warp beam is a machine resource: mounted on a loom, shared by every WO that
# runs there while it is up. These endpoints are keyed on the work center, never
# on a WO — that is the whole point of the model. See services/beam_service.py.
# ─────────────────────────────────────────────────────────────────────────────

def _mount_out(mount: BeamMount, remaining: float) -> BeamMountResponse:
    b, it, wc = mount.batch, mount.item, mount.work_center
    return BeamMountResponse(
        id=mount.id,
        batch_id=mount.batch_id,
        beam_number=b.batch_number if b else None,
        work_center_id=mount.work_center_id,
        work_center_code=(wc.code or wc.name) if wc else None,
        item_id=mount.item_id,
        item_code=it.code if it else None,
        item_name=it.name if it else None,
        location_id=mount.location_id,
        default_return_location_id=(it.default_source_location_id if it else None),
        ends=(b.ends if b and b.ends else (it.ends if it else None)),
        qty_mounted=float(mount.qty_mounted or 0),
        remaining=remaining,
        bom_size_snapshot=getattr(b, "bom_size_snapshot", None),
        variant_attributes=getattr(b, "variant_attributes", None),
        color_code=getattr(b, "color_code", None),
        color_name=getattr(b, "color_name", None),
        color_hex=getattr(b, "color_hex", None),
        labdip_variant_code=getattr(b, "labdip_variant_code", None),
        source_wo_id=mount.source_wo_id,
        mounted_at=mount.mounted_at,
        mounted_by=mount.mounted_by,
        dismounted_at=mount.dismounted_at,
        dismounted_by=mount.dismounted_by,
    )


async def _mounts_out(db: AsyncSession, pairs: list[tuple[BeamMount, float]]) -> list[BeamMountResponse]:
    """Mounts as API rows, with every beam's lot identity resolved in one pass.

    Through the same two resolvers every lot picker uses, so a beam on the loom is
    labelled exactly like the same beam in the picker that mounted it. Both are
    grouped queries over the whole list — no N+1 per mount.
    """
    batches = [m.batch for m, _ in pairs if m.batch is not None]
    if batches:
        await _resolve_batch_origins(db, batches)
        await _resolve_batch_variants(db, batches)
    return [_mount_out(m, q) for m, q in pairs]


@router.get("/work-centers/{wc_id}/beam-mounts", response_model=LoomBeamStatus)
async def get_loom_beam_status(
    wc_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view", "beam.view")),
):
    """What warp is up on this loom right now — feeds the weaving monitor card."""
    wc = (await db.execute(select(WorkCenter).where(WorkCenter.id == wc_id))).scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")
    mounts = await beam_service.active_mounts(db, wc.id)
    mounted_pcs = sum(1 for _, q in mounts if q > 1e-9)
    # Prep state rides along with the warp: the monitor modal reads both from this
    # one call, so its buttons and the loom card can't disagree about the state.
    has_run = bool((await db.execute(
        select(WeavingRun.id)
        .where(WeavingRun.work_center_id == wc.id,
               WeavingRun.status.in_(weaving_service.ACTIVE_RUN_STATUSES))
        .limit(1)
    )).first())
    loom_status = weaving_service.derive_loom_status(
        wc.prep_status, mounted_pcs, wc.beam_slots, has_run,
    )
    return LoomBeamStatus(
        work_center_id=wc.id,
        work_center_code=wc.code or wc.name,
        beam_slots=max(1, int(wc.beam_slots or 1)),
        mounted_pcs=mounted_pcs,
        total_remaining=sum(q for _, q in mounts),
        mounts=await _mounts_out(db, mounts),
        loom_status=loom_status,
        next_loom_step=weaving_service.next_loom_step(loom_status),
        prep_status=wc.prep_status,
        prep_status_at=wc.prep_status_at,
        prep_status_by=wc.prep_status_by,
    )


@router.post("/work-centers/{wc_id}/beam-mounts", response_model=BeamMountResponse)
async def mount_beam_on_loom(
    wc_id: str,
    payload: BeamMountCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.edit')),
):
    """Gait a beam onto a loom directly (no WO context needed)."""
    wc = (await db.execute(select(WorkCenter).where(WorkCenter.id == wc_id))).scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")
    _require_wo_scope(current_user, wc.center_type)

    mount = await beam_service.mount_beam(
        db, batch_id=payload.batch_id, work_center_id=wc.id, qty=payload.qty,
        source_wo_id=payload.source_wo_id, user=current_user.username,
    )
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="MOUNT", entity_type="BEAM_MOUNT",
        entity_id=str(mount.id),
        details=f"Mounted beam on machine '{wc.code or wc.name}'",
        changes={"batch_id": str(payload.batch_id), "work_center_id": str(wc.id)},
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    await manager.broadcast({"type": "WORK_ORDER_UPDATE"})

    for m, q in await beam_service.active_mounts(db, wc.id):
        if str(m.id) == str(mount.id):
            return (await _mounts_out(db, [(m, q)]))[0]
    return (await _mounts_out(db, [(mount, 0.0)]))[0]


@router.post("/beam-mounts/{mount_id}/dismount", response_model=BeamDismountResult)
async def dismount_beam_from_loom(
    mount_id: str,
    payload: BeamDismountPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('beam.unmount')),
):
    """Take a beam off the loom.

    Every dismount is a weigh-and-relot: the floor strips and weighs the remnant,
    it becomes its own leftover lot (LFT-) that any loom can mount later, the
    parent beam is retired at 0, and scale-vs-system drift is written off on the
    parent."""
    weighed = payload.leftover_qty
    leftover_number: str | None = None
    if float(weighed) > 0:
        leftover_number = (payload.leftover_beam_number or "").strip()
        if leftover_number:
            dup = await db.execute(
                select(Batch.id).filter(Batch.batch_number == leftover_number).limit(1)
            )
            if dup.scalars().first():
                raise HTTPException(
                    status_code=400, detail=f"Lot number '{leftover_number}' already exists"
                )
        else:
            leftover_number = await generate_batch_number(db, prefix="LFT")

    mount, leftover, variance = await beam_service.dismount_beam(
        db, mount_id, leftover_qty=weighed, to_location_id=payload.to_location_id,
        user=current_user.username, leftover_number=leftover_number,
        leftover_ends=payload.leftover_ends, leftover_notes=payload.leftover_notes,
    )
    leftover_id = leftover.id if leftover else None
    leftover_code = leftover.batch_number if leftover else None
    remaining = 0.0
    await db.commit()

    res = await db.execute(
        select(BeamMount)
        .options(joinedload(BeamMount.batch), joinedload(BeamMount.item))
        .where(BeamMount.id == mount.id)
    )
    fresh = res.unique().scalars().first()
    if fresh and fresh.location_id:
        bal = (await db.execute(
            select(StockBalance.qty).where(
                StockBalance.item_id == fresh.item_id,
                StockBalance.location_id == (payload.to_location_id or fresh.location_id),
                StockBalance.variant_key == "",
                StockBalance.batch_key == str(fresh.batch_id),
            )
        )).scalar()
        remaining = float(bal or 0)

    detail = f"Dismounted beam (remnant {remaining:g})"
    if leftover_code:
        detail = (
            f"Dismounted beam — leftover lot {leftover_code} "
            f"({float(weighed):g}), variance {variance:+g}"
        )
    await audit_service.log_activity(
        db, user_id=current_user.id, action="DISMOUNT", entity_type="BEAM_MOUNT",
        entity_id=str(mount.id),
        details=detail,
        changes={
            "to_location_id": str(payload.to_location_id) if payload.to_location_id else None,
            "leftover_batch_id": str(leftover_id) if leftover_id else None,
            "leftover_qty": float(weighed) if weighed is not None else None,
            "leftover_variance": variance,
        },
    )
    await manager.broadcast({"type": "STOCK_UPDATE"})
    await manager.broadcast({"type": "WORK_ORDER_UPDATE"})
    row = (await _mounts_out(db, [(fresh or mount, remaining)]))[0]
    return BeamDismountResult(
        **row.model_dump(),
        leftover_batch_id=leftover_id,
        leftover_beam_number=leftover_code,
        leftover_qty=float(weighed) if weighed is not None else None,
        leftover_variance=variance,
    )


@router.get("/work-centers/{wc_id}/available-beams", response_model=list[AvailableBeamRow])
async def list_available_beams(
    wc_id: str,
    search: str | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view", "beam.view")),
):
    """Beam lots free to mount on this loom — including leftovers stripped off
    earlier warps, which is the whole point of re-lotting them.

    Machine-scoped by permission only, not by item: a loom takes whatever warp
    the planner puts up, and the monitor's Mount picker has no order context to
    narrow it with. Free = has stock somewhere and is not currently mounted."""
    wc = (await db.execute(select(WorkCenter).where(WorkCenter.id == wc_id))).scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")

    mounted = select(BeamMount.batch_id).where(BeamMount.dismounted_at.is_(None))
    parent = aliased(Batch)
    # Cast batch_key → UUID inside the subquery (never Batch.id → text outside it):
    # that keeps the join on the batches PK index, and `batch_key != ''` both prunes
    # every non-lot stock row in the plant and guarantees the cast sees real uuids.
    bal = (
        select(
            cast(StockBalance.batch_key, PG_UUID(as_uuid=True)).label("bid"),
            StockBalance.qty.label("qty"),
            StockBalance.location_id.label("location_id"),
        )
        .where(StockBalance.qty > 0, StockBalance.batch_key != "")
        .subquery()
    )
    q = (
        select(Batch, bal.c.qty, bal.c.location_id, Location.code, parent.batch_number)
        .join(bal, bal.c.bid == Batch.id)
        .join(Item, Item.id == Batch.item_id)
        .outerjoin(Location, Location.id == bal.c.location_id)
        .outerjoin(parent, parent.id == Batch.parent_batch_id)
        .where(
            Batch.packing_order_id.is_(None),
            Batch.id.not_in(mounted),
            Batch.quality_status.not_in(reject_service.UNPICKABLE_GRADES),
        )
        .order_by(Batch.created_at.desc())
        .limit(max(1, min(int(limit or 100), 500)))
    )
    if search:
        pattern = f"%{search.strip()}%"
        q = q.where(
            Batch.batch_number.ilike(pattern)
            | Item.code.ilike(pattern)
            | Item.name.ilike(pattern)
        )
    rows = (await db.execute(q)).all()

    # One definition of "is this item a warp beam", shared with staging/readiness.
    beam_ids = await beam_service.beam_item_ids(db, [b.item_id for b, *_ in rows])
    items = {
        str(i.id): i for i in (await db.execute(
            select(Item).where(Item.id.in_([b.item_id for b, *_ in rows]))
        )).scalars().all()
    } if rows else {}

    out: list[AvailableBeamRow] = []
    for batch, qty, loc_id, loc_code, parent_number in rows:
        if str(batch.item_id) not in beam_ids:
            continue
        it = items.get(str(batch.item_id))
        out.append(AvailableBeamRow(
            batch_id=batch.id,
            beam_number=batch.batch_number,
            item_id=batch.item_id,
            item_code=it.code if it else None,
            item_name=it.name if it else None,
            ends=batch.ends if batch.ends else (it.ends if it else None),
            remaining=float(qty or 0),
            location_id=loc_id,
            location_code=loc_code,
            is_leftover=batch.parent_batch_id is not None,
            parent_beam_number=parent_number,
            quality_status=batch.quality_status or "GOOD",
            created_at=batch.created_at,
        ))
    return out


@router.get("/work-orders/{wo_id}/beam-mounts", response_model=LoomBeamStatus)
async def get_wo_beam_status(
    wo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view", "beam.view")),
):
    """Beam readiness for a WO = the readiness of the machine it runs on."""
    wo = (await db.execute(select(WorkOrder).where(WorkOrder.id == wo_id))).scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    if not wo.work_center_id:
        return LoomBeamStatus(work_center_id=uuid.UUID(int=0))
    return await get_loom_beam_status(str(wo.work_center_id), db, current_user)


@router.delete("/work-orders/{wo_id}")
async def delete_work_order(
    wo_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.delete')),
):
    result = await db.execute(select(WorkOrder).filter(WorkOrder.id == wo_id))
    wo = result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")
    _require_wo_scope(current_user, await _wc_type(db, wo.work_center_id))
    label = wo.code or wo.name
    # Read before the delete — the instance is gone by broadcast time.
    mo_id = wo.manufacturing_order_id
    # WeavingRun.work_order_id is ON DELETE SET NULL, so a run would survive the delete
    # orphaned at MO grain and keep accruing days against a WO that no longer exists.
    # Close it here, while the link is still there to find it by.
    stopped = await weaving_service.stop_runs(
        db, work_order_id=wo.id, username=current_user.username,
    )
    await db.delete(wo)
    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE",
        entity_type="WorkOrder", entity_id=wo_id,
        details=f"Deleted Work Order '{label}'"
    )
    # Safe after commit: the session runs expire_on_commit=False, so the stopped runs
    # still hold their loaded ids (a lazy refresh here would raise MissingGreenlet).
    await weaving_service.audit_and_broadcast_stops(
        db, current_user.id, stopped, f"work order '{label}' deleted")
    # The only WO mutation route that used to broadcast nothing, so a deleted WO
    # stayed on every other client's board — and inside the MO panel — until someone
    # refetched by hand. mo_id rides along so the parent MO's row re-pulls its WO list.
    await manager.broadcast({
        "type": "WORK_ORDER_UPDATE", "wo_id": wo_id, "status": "DELETED",
        "mo_id": str(mo_id) if mo_id else None,
    })
    return {"status": "success"}
