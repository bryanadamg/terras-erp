from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload, joinedload
from typing import Optional
from datetime import datetime, timezone
import uuid

from app.db.session import get_async_db
from app.models.dyeing_setting import (
    DyeRecipe, DyeRecipeLine, DyeingRun, DyeingRunChemical, SettingRun,
    DyeRecipeWashBath, DyeRecipeFinishing, dye_recipe_attribute_values,
)
from app.models.attribute import Attribute, AttributeValue
from app.models.color import Color
from app.models.work_order import WorkOrder as _WorkOrder
from app.models.manufacturing import (
    ManufacturingOrder as _MO, manufacturing_order_values as _mo_values, MOCompletion,
)
from app.models.batch import Batch
from app.models.work_order import WorkOrder
from app.models.routing import WorkCenter
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.services import audit_service, dyeing_dose_service, dyeing_run_service
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from app.schemas import (
    DyeRecipeCreate, DyeRecipeUpdate, DyeRecipeResponse, PaginatedDyeRecipeResponse,
    DyeRecipeWashBathCreate, DyeRecipeWashBathResponse,
    DyeRecipeFinishingCreate, DyeRecipeFinishingResponse,
    DyeingRunCreate, DyeingRunCompletePayload, DyeingRunResponse,
    DyeingRunStartPayload, DyeingRunBathUpdate, DyeingRunChemicalsUpdate, DyeDoseResponse,
    SettingRunCreate, SettingRunCompletePayload, SettingRunResponse,
)

router = APIRouter()


# ─── helpers ────────────────────────────────────────────────────────────────

def _recipe_opts():
    return [
        selectinload(DyeRecipe.lines).selectinload(DyeRecipeLine.item),
        selectinload(DyeRecipe.lines).selectinload(DyeRecipeLine.uom),
        selectinload(DyeRecipe.wash_baths),
        selectinload(DyeRecipe.finishing_steps),
        selectinload(DyeRecipe.attribute_values),
        joinedload(DyeRecipe.color).joinedload(Color.variant_attribute_value),
    ]


def _serialize_recipe(r: DyeRecipe) -> dict:
    lines = []
    for ln in r.lines:
        ld = {col.name: getattr(ln, col.name) for col in ln.__table__.columns}
        ld["item_name"] = ln.item.name if ln.item else None
        ld["uom_name"] = ln.uom.name if ln.uom else None
        lines.append(ld)
    rd = {col.name: getattr(r, col.name) for col in r.__table__.columns}
    rd["lines"] = lines
    rd["wash_baths"] = [
        {col.name: getattr(wb, col.name) for col in wb.__table__.columns}
        for wb in r.wash_baths
    ]
    rd["finishing_steps"] = [
        {col.name: getattr(fs, col.name) for col in fs.__table__.columns}
        for fs in r.finishing_steps
    ]
    rd["attribute_value_ids"] = [str(v.id) for v in r.attribute_values]
    rd["color_name"] = r.color.name if r.color else None
    rd["color_code"] = r.color.code if r.color else None
    rd["color_hex"] = r.color.hex if r.color else None
    rd["color_variant_label"] = r.color.variant_attribute_value.value if r.color and r.color.variant_attribute_value else None
    rd["color_variant_hex"] = r.color.variant_attribute_value.hex if r.color and r.color.variant_attribute_value else None
    return rd


def _dyeing_run_opts():
    return [
        selectinload(DyeingRun.chemicals).selectinload(DyeingRunChemical.item),
        selectinload(DyeingRun.chemicals).selectinload(DyeingRunChemical.uom),
        joinedload(DyeingRun.recipe),
        joinedload(DyeingRun.input_batch),
        joinedload(DyeingRun.output_batch),
    ]


def _setting_run_opts():
    return [
        joinedload(SettingRun.input_batch),
        joinedload(SettingRun.output_batch),
    ]


def _enrich_dyeing_run(run: DyeingRun) -> dict:
    d = {c.name: getattr(run, c.name) for c in run.__table__.columns}
    d["recipe_name"] = run.recipe.name if run.recipe else None
    d["input_batch_number"] = run.input_batch.batch_number if run.input_batch else None
    d["output_batch_number"] = run.output_batch.batch_number if run.output_batch else None
    # One answer to "which bath do I weigh against": the water actually filled once
    # it exists, the planner's figure until then. Resolved here so the dose sheet,
    # the scan terminal and the print portal cannot each fall back differently.
    d["effective_bath_liters"] = dyeing_dose_service.effective_bath(run)
    chems = []
    for c in run.chemicals:
        cd = {col.name: getattr(c, col.name) for col in c.__table__.columns}
        cd["item_name"] = c.item.name if c.item else None
        cd["uom_name"] = c.uom.name if c.uom else None
        chems.append(cd)
    d["chemicals"] = chems
    return d


def _enrich_setting_run(run: SettingRun) -> dict:
    d = {c.name: getattr(run, c.name) for c in run.__table__.columns}
    d["input_batch_number"] = run.input_batch.batch_number if run.input_batch else None
    d["output_batch_number"] = run.output_batch.batch_number if run.output_batch else None
    return d


async def _resolve_step_descriptions(db: AsyncSession, entries, role: str) -> dict:
    """Map attribute_value_id -> value text for wash bath / finishing step picks.

    Bak Cuci and Finishing steps are picked from the system attributes
    'Wash Bath' (role wash_bath) / 'Finishing Step' (role finishing_step); values
    are curated on the Attributes page. A value from another attribute is a 422.
    """
    ids = {e.attribute_value_id for e in (entries or []) if e.attribute_value_id}
    if not ids:
        return {}
    result = await db.execute(
        select(AttributeValue)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .filter(AttributeValue.id.in_(ids), Attribute.system_role == role)
    )
    found = {v.id: v.value for v in result.scalars().all()}
    missing = ids - set(found.keys())
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid {role} selection: {', '.join(str(m) for m in missing)}",
        )
    return found


def _assert_single_dose_basis(lines) -> None:
    """A recipe line is dosed EITHER per litre of bath OR per 100 kg of substrate.
    Filling both leaves the dose undefined, so reject it at save rather than let a
    call site pick one (which is exactly how the owf figure used to be dropped)."""
    bad = dyeing_dose_service.assert_single_basis(lines)
    if bad is not None:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Recipe line {bad} sets both a per-litre (g/L) and a per-100kg rate. "
                "Pick one basis: g/L for bath chemicals (dose follows bath volume), "
                "per-100kg for dyestuff (dose follows fabric weight)."
            ),
        )


async def _get_next_run_number(db: AsyncSession, model, work_order_id) -> int:
    result = await db.execute(
        select(model).filter(model.work_order_id == work_order_id)
    )
    existing = result.scalars().all()
    return len(existing) + 1


# ─── Dye Recipes ─────────────────────────────────────────────────────────────

@router.get("/dye-recipes", response_model=PaginatedDyeRecipeResponse)
async def list_dye_recipes(
    active_only: bool = Query(False),
    search: str | None = Query(None, description="Matches recipe code or name"),
    window: PageWindow = Depends(PageParams(default_size=50, max_size=500, allow_uncapped=True)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dye_recipe.view", "dye_order.view", "lab_dip_request.view", "work_order.view")),
):
    """Server-paginated recipe list.

    `size=0` returns the whole filtered set — that is the **lookup feed** the
    recipe *pickers* and id→name resolvers use (Dyeing Orders' run rows, the Lab
    Dip approved-recipe select). Those callers resolve a recipe by id out of the
    array they hold, so capping them to a page would silently fail to find any
    recipe that happens to be off page 1. Only the Dye Recipes list view takes a
    real page window.
    """
    q = select(DyeRecipe).options(*_recipe_opts())
    count_q = select(func.count(DyeRecipe.id))

    if active_only:
        q = q.filter(DyeRecipe.is_active == True)
        count_q = count_q.filter(DyeRecipe.is_active == True)
    if search:
        like = f"%{search}%"
        cond = or_(DyeRecipe.code.ilike(like), DyeRecipe.name.ilike(like))
        q = q.filter(cond)
        count_q = count_q.filter(cond)

    total = (await db.execute(count_q)).scalar_one()
    result = await db.execute(window.apply(q.order_by(DyeRecipe.code)))
    recipes = result.scalars().all()
    return window.envelope([_serialize_recipe(r) for r in recipes], total)


@router.post("/dye-recipes", response_model=DyeRecipeResponse)
async def create_dye_recipe(
    payload: DyeRecipeCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('dye_recipe.create')),
):
    existing = await db.execute(select(DyeRecipe).filter(DyeRecipe.code == payload.code))
    if existing.scalars().first():
        raise HTTPException(status_code=400, detail="Recipe code already exists")
    _assert_single_dose_basis(payload.lines)

    recipe = DyeRecipe(
        code=payload.code,
        name=payload.name,
        color_standard=payload.color_standard,
        color_id=payload.color_id,
        substrate_type=payload.substrate_type,
        liquor_ratio=payload.liquor_ratio,
        notes=payload.notes,
        is_active=payload.is_active,
    )
    db.add(recipe)
    await db.flush()

    for i, ln in enumerate(payload.lines):
        line = DyeRecipeLine(
            recipe_id=recipe.id,
            item_id=ln.item_id,
            qty_per_100kg=ln.qty_per_100kg,
            qty_per_liter=ln.qty_per_liter,
            uom_id=ln.uom_id,
            chemical_type=ln.chemical_type,
            sort_order=ln.sort_order if ln.sort_order else i,
        )
        db.add(line)

    bath_texts = await _resolve_step_descriptions(db, payload.wash_baths, "wash_bath")
    for wb in payload.wash_baths:
        db.add(DyeRecipeWashBath(
            recipe_id=recipe.id,
            bath_number=wb.bath_number,
            attribute_value_id=wb.attribute_value_id,
            description=bath_texts.get(wb.attribute_value_id, wb.description or ""),
        ))

    fin_texts = await _resolve_step_descriptions(db, payload.finishing_steps, "finishing_step")
    for i, fs in enumerate(payload.finishing_steps):
        db.add(DyeRecipeFinishing(
            recipe_id=recipe.id,
            attribute_value_id=fs.attribute_value_id,
            description=fin_texts.get(fs.attribute_value_id, fs.description or ""),
            sort_order=fs.sort_order if fs.sort_order else i,
        ))

    if payload.attribute_value_ids:
        await db.execute(
            dye_recipe_attribute_values.insert(),
            [{"dye_recipe_id": recipe.id, "attribute_value_id": str(v)} for v in payload.attribute_value_ids]
        )

    await db.commit()
    result = await db.execute(
        select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == recipe.id)
    )
    r = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "DyeRecipe", str(r.id),
        details=f"Created recipe {r.code}", changes={}
    )
    return _serialize_recipe(r)


@router.get("/dye-recipes/match")
async def match_dye_recipe(
    work_order_id: str = Query(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dye_recipe.view", "dye_order.view", "lab_dip_request.view", "work_order.view")),
):
    """Return the best-matching DyeRecipe for a given Work Order, based on the MO's attribute values."""
    wo_result = await db.execute(
        select(_WorkOrder).filter(_WorkOrder.id == work_order_id)
    )
    wo = wo_result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")

    mo_result = await db.execute(
        select(_MO)
        .options(selectinload(_MO.attribute_values))
        .filter(_MO.id == wo.manufacturing_order_id)
    )
    mo = mo_result.scalars().first()

    # Modern path: color-type FG carries a Color Library shade — match by color_id.
    if mo and getattr(mo, "color_id", None):
        by_color = await db.execute(
            select(DyeRecipe).options(*_recipe_opts())
            .filter(DyeRecipe.color_id == mo.color_id, DyeRecipe.is_active == True)
            .order_by(DyeRecipe.code)
        )
        color_match = by_color.scalars().first()
        return {"match": _serialize_recipe(color_match)} if color_match else {"match": None}

    # Legacy path: best exact attribute-value subset match.
    mo_attr_ids = set(str(v.id) for v in mo.attribute_values) if mo else set()

    recipes_result = await db.execute(
        select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.is_active == True)
    )
    recipes = recipes_result.scalars().all()

    best: DyeRecipe | None = None
    best_count = -1
    for r in recipes:
        recipe_ids = set(str(v.id) for v in r.attribute_values)
        if not recipe_ids:
            continue
        if recipe_ids.issubset(mo_attr_ids) and len(recipe_ids) > best_count:
            best = r
            best_count = len(recipe_ids)

    if not best:
        return {"match": None}
    return {"match": _serialize_recipe(best)}


@router.put("/dye-recipes/{recipe_id}", response_model=DyeRecipeResponse)
async def update_dye_recipe(
    recipe_id: str,
    payload: DyeRecipeUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('dye_recipe.edit')),
):
    result = await db.execute(
        select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == recipe_id)
    )
    r = result.scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if payload.lines is not None:
        _assert_single_dose_basis(payload.lines)

    for field in ("code", "name", "color_standard", "color_id", "substrate_type", "liquor_ratio", "notes", "is_active"):
        val = getattr(payload, field)
        if val is not None:
            setattr(r, field, val)

    if payload.lines is not None:
        for ln in list(r.lines):
            await db.delete(ln)
        await db.flush()
        for i, ln in enumerate(payload.lines):
            line = DyeRecipeLine(
                recipe_id=r.id,
                item_id=ln.item_id,
                qty_per_100kg=ln.qty_per_100kg,
                qty_per_liter=ln.qty_per_liter,
                uom_id=ln.uom_id,
                chemical_type=ln.chemical_type,
                sort_order=ln.sort_order if ln.sort_order else i,
            )
            db.add(line)

    if payload.wash_baths is not None:
        bath_texts = await _resolve_step_descriptions(db, payload.wash_baths, "wash_bath")
        for wb in list(r.wash_baths):
            await db.delete(wb)
        await db.flush()
        for wb in payload.wash_baths:
            db.add(DyeRecipeWashBath(
                recipe_id=r.id,
                bath_number=wb.bath_number,
                attribute_value_id=wb.attribute_value_id,
                description=bath_texts.get(wb.attribute_value_id, wb.description or ""),
            ))

    if payload.finishing_steps is not None:
        fin_texts = await _resolve_step_descriptions(db, payload.finishing_steps, "finishing_step")
        for fs in list(r.finishing_steps):
            await db.delete(fs)
        await db.flush()
        for i, fs in enumerate(payload.finishing_steps):
            db.add(DyeRecipeFinishing(
                recipe_id=r.id,
                attribute_value_id=fs.attribute_value_id,
                description=fin_texts.get(fs.attribute_value_id, fs.description or ""),
                sort_order=fs.sort_order if fs.sort_order else i,
            ))

    if payload.attribute_value_ids is not None:
        av_result = await db.execute(
            select(AttributeValue).filter(AttributeValue.id.in_([str(v) for v in payload.attribute_value_ids]))
        )
        r.attribute_values = list(av_result.scalars().all())

    await db.commit()
    result = await db.execute(
        select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == recipe_id)
    )
    r = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "UPDATE", "DyeRecipe", str(r.id),
        details=f"Updated recipe {r.code}", changes={}
    )
    return _serialize_recipe(r)


@router.delete("/dye-recipes/{recipe_id}")
async def delete_dye_recipe(
    recipe_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('dye_recipe.delete')),
):
    result = await db.execute(select(DyeRecipe).filter(DyeRecipe.id == recipe_id))
    r = result.scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")
    r_code = r.code
    await db.delete(r)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "DELETE", "DyeRecipe", recipe_id,
        details=f"Deleted recipe {r_code}"
    )
    return {"status": "success"}


@router.get("/dye-recipes/{recipe_id}/doses", response_model=DyeDoseResponse)
async def get_dye_recipe_doses(
    recipe_id: str,
    substrate_qty: Optional[float] = Query(None, description="Substrate weight of this load, kg"),
    bath_volume_liters: Optional[float] = Query(None, description="Water volume of the bath, litres (volume air)"),
    liquor_ratio: Optional[float] = Query(None, description="Litres of water per kg of substrate — used to derive the volume when it isn't given"),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dye_recipe.view", "dye_order.view", "work_order.view")),
):
    """Weigh out a recipe against one bath: g/L rates x the bath volume, owf rates
    x the substrate weight.

    Server-side and shared so the run form's preview, the Complete Run dose sheet
    and (later) the recipe print view cannot drift apart — the same reason the size
    netting rule lives in netting_service. Pass `liquor_ratio` instead of
    `bath_volume_liters` and the volume is derived from the substrate weight.
    """
    result = await db.execute(
        select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == recipe_id)
    )
    r = result.scalars().first()
    if not r:
        raise HTTPException(status_code=404, detail="Recipe not found")

    volume, ratio = dyeing_dose_service.solve_bath(substrate_qty, bath_volume_liters, liquor_ratio)
    return {
        "recipe_id": r.id,
        "recipe_code": r.code,
        "recipe_name": r.name,
        "substrate_qty": substrate_qty,
        "bath_volume_liters": volume,
        "liquor_ratio": ratio,
        "lines": dyeing_dose_service.compute_doses(r, substrate_qty, volume),
    }


# ─── Dyeing Runs ─────────────────────────────────────────────────────────────

@router.get("/dyeing-runs", response_model=list[DyeingRunResponse])
async def list_dyeing_runs(
    work_order_id: Optional[str] = Query(None),
    work_order_ids: str = Query(
        "",
        description="Comma-separated WO ids — the baths of one page of dyeing work "
                    "orders in a single call. Bounded by the caller's page size.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("dye_order.view", "dye_recipe.view", "work_order.view")),
):
    """The baths, for one WO or for a page of them.

    `work_order_ids` exists because the supervisory list shows each WO's recipe,
    bath and shade on its own row: fetching those one WO at a time is 20 requests
    per page, and fetching every run in the plant to filter client-side grows
    without bound. The window is the caller's page, so the set stays small.
    """
    q = select(DyeingRun).options(*_dyeing_run_opts()).order_by(DyeingRun.created_at)
    if work_order_id:
        q = q.filter(DyeingRun.work_order_id == work_order_id)
    elif work_order_ids.strip():
        ids = [i for i in (x.strip() for x in work_order_ids.split(",")) if i]
        if not ids:
            return []
        q = q.filter(DyeingRun.work_order_id.in_(ids))
    result = await db.execute(q)
    return [_enrich_dyeing_run(r) for r in result.scalars().all()]


@router.post("/dyeing-runs", response_model=DyeingRunResponse)
async def create_dyeing_run(
    payload: DyeingRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    wo_result = await db.execute(select(WorkOrder).filter(WorkOrder.id == payload.work_order_id))
    wo = wo_result.scalars().first()
    if not wo:
        raise HTTPException(status_code=404, detail="Work Order not found")

    run_number = await _get_next_run_number(db, DyeingRun, payload.work_order_id)
    # Default the load from the WO, the same way WO creation's auto-run does. It stays
    # a per-run column because a multi-bath WO splits its load across runs — but the
    # common case is one bath for the whole WO, and a hand-typed copy of a number the
    # WO already holds is just something to drift.
    substrate_qty = payload.substrate_qty if payload.substrate_qty is not None else (wo.qty or 0)
    # Bath volume and liquor ratio are one fact twice — store the pair solved, so a
    # dose calculated from the volume can never disagree with the ratio on screen.
    bath_volume, bath_ratio = dyeing_dose_service.solve_bath(
        substrate_qty, payload.volume_air_liters, payload.liquor_ratio,
    )
    run = DyeingRun(
        work_order_id=payload.work_order_id,
        run_number=run_number,
        recipe_id=payload.recipe_id,
        substrate_qty=substrate_qty,
        input_batch_id=payload.input_batch_id,
        liquor_ratio=bath_ratio,
        temperature_c=payload.temperature_c,
        duration_min=payload.duration_min,
        operator_name=payload.operator_name,
        notes=payload.notes,
        volume_air_liters=bath_volume,
        machine_speed=payload.machine_speed,
        machine_pressure=payload.machine_pressure,
    )
    # Status is never typed, here or anywhere else — see services/dyeing_run_service.
    # A run cut with its bath volume already filled in is IN_PROGRESS from birth.
    run.status = dyeing_run_service.derive_status(run, wo.status)
    db.add(run)
    await db.commit()
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run.id)
    )
    run = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "DyeingRun", str(run.id),
        details=f"Created dyeing run #{run.run_number} for WO {run.work_order_id}", changes={}
    )
    return _enrich_dyeing_run(run)


@router.patch("/dyeing-runs/{run_id}/bath", response_model=DyeingRunResponse)
async def update_dyeing_run_bath(
    run_id: str,
    payload: DyeingRunBathUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    """Record the bath the operator actually filled.

    Separate from run creation because the volume is only known once the machine is
    loaded — planning cuts the run, the floor fills the bath. Every g/L dose is
    calculated from this number, so it is editable while the run is open (a bath
    topped up mid-cycle moves every chemical) and frozen once COMPLETED, where the
    recorded chemicals are already the history of what went in.
    """
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Dyeing run not found")
    # Gated on the bath's OWN close, not on the derived status: a WO closing marks
    # its baths COMPLETED (dyeing_run_service), and a bath nobody ever recorded is
    # still back-fillable after that. Once the bath itself was closed, the recorded
    # chemicals are history and the volume they were weighed from must not move.
    if run.completed_at is not None:
        raise HTTPException(status_code=400, detail="Run is completed — its bath is history, not a plan")
    if payload.volume_air_liters is None and payload.liquor_ratio is None and payload.substrate_qty is None:
        raise HTTPException(status_code=422, detail="Send a bath volume, a liquor ratio or a substrate qty")
    for v in (payload.volume_air_liters, payload.liquor_ratio, payload.substrate_qty):
        if v is not None and v <= 0:
            raise HTTPException(status_code=422, detail="Bath volume, liquor ratio and substrate qty must be positive")

    before = {
        "substrate_qty": run.substrate_qty,
        "volume_air_liters": run.volume_air_liters,
        "liquor_ratio": run.liquor_ratio,
        "status": run.status,
    }
    if payload.substrate_qty is not None:
        run.substrate_qty = payload.substrate_qty
    # Whichever of the pair the operator sent wins; the other is re-derived from it
    # against the (possibly just updated) substrate weight.
    volume, ratio = dyeing_dose_service.solve_bath(
        run.substrate_qty,
        payload.volume_air_liters if payload.volume_air_liters is not None else (
            None if payload.liquor_ratio is not None else run.volume_air_liters
        ),
        payload.liquor_ratio if payload.liquor_ratio is not None else run.liquor_ratio,
    )
    run.volume_air_liters = volume
    run.liquor_ratio = ratio

    # The stored dose sheet follows the bath: a topped-up bath means every g/L
    # chemical is re-weighed. Rows with an actual already recorded are left alone —
    # that chemical is in the vessel, and rewriting its plan would erase the variance.
    if run.recipe_id and run.chemicals:
        rec_res = await db.execute(
            select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == run.recipe_id)
        )
        recipe = rec_res.scalars().first()
        if recipe:
            doses = {
                str(row["item_id"]): row["dose"]
                for row in dyeing_dose_service.compute_doses(recipe, run.substrate_qty, volume)
                if row["dose"] is not None
            }
            for chem in run.chemicals:
                if float(chem.actual_qty or 0) > 0:
                    continue
                new_dose = doses.get(str(chem.item_id))
                if new_dose is not None:
                    chem.planned_qty = new_dose
    # A bath back-filled onto a run that never saw a Start is under way by
    # definition — the vessel is full. Derived, never typed.
    await dyeing_run_service.sync_wo_runs(db, run.work_order_id)
    await db.commit()

    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    after = {
        "substrate_qty": run.substrate_qty,
        "volume_air_liters": run.volume_air_liters,
        "liquor_ratio": run.liquor_ratio,
        "status": run.status,
    }
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "DyeingRun", run_id,
        details=f"Bath set to {run.volume_air_liters} L on run #{run.run_number}",
        changes={k: [before[k], after[k]] for k in after if str(before[k]) != str(after[k])},
    )
    await manager.broadcast({"type": "DYEING_RUN_UPDATE", "wo_id": str(run.work_order_id)})
    return _enrich_dyeing_run(run)


@router.post("/dyeing-runs/{run_id}/start", response_model=DyeingRunResponse)
async def start_dyeing_run(
    run_id: str,
    payload: DyeingRunStartPayload | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    """Start the run = fill the bath.

    The bath volume is taken here rather than at completion because this is the
    moment it physically exists, and the dose sheet weighed from it has to be in the
    operator's hand *before* the chemicals go in. The doses are materialized as
    `DyeingRunChemical.planned_qty` in the same transaction, snapshotting them
    against later recipe edits the way MOPlannedComponent does for BOM lines — what
    the operator was told to weigh must stay readable after someone retunes the
    recipe.
    """
    payload = payload or DyeingRunStartPayload()
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Dyeing run not found")
    # Gated on the facts rather than the derived status: `COMPLETED` on a run can
    # now mean "its WO closed" as well as "this bath was closed", and only the
    # latter is a reason to refuse. Same pair the IN_PROGRESS rule reads.
    if run.completed_at is not None:
        raise HTTPException(status_code=400, detail="Run is already completed")
    if run.started_at is not None or run.volume_air_liters is not None:
        raise HTTPException(status_code=400, detail="Run is already started — correct its bath instead")

    for v in (payload.volume_air_liters, payload.liquor_ratio, payload.substrate_qty):
        if v is not None and v <= 0:
            raise HTTPException(status_code=422, detail="Bath volume, liquor ratio and substrate qty must be positive")
    if payload.substrate_qty is not None:
        run.substrate_qty = payload.substrate_qty
    volume, ratio = dyeing_dose_service.solve_bath(
        run.substrate_qty,
        payload.volume_air_liters if payload.volume_air_liters is not None else (
            None if payload.liquor_ratio is not None else run.volume_air_liters
        ),
        payload.liquor_ratio if payload.liquor_ratio is not None else run.liquor_ratio,
    )
    if not volume:
        # Starting a bath nobody can dose is not a real start — the g/L half of every
        # recipe is unweighable without this number.
        raise HTTPException(
            status_code=422,
            detail="Enter the bath volume (or a liquor ratio and substrate qty) before starting — the chemical doses are calculated from it",
        )
    run.volume_air_liters = volume
    run.liquor_ratio = ratio
    run.started_at = datetime.now(timezone.utc)
    # `started_at` is the fact; the status follows from it. Derived through the
    # service (which reads the WO's own status), never assigned here — see
    # services/dyeing_run_service.
    status_before = run.status
    await dyeing_run_service.sync_wo_runs(db, run.work_order_id)

    # Materialize the dose sheet — or re-price the one WO creation already planned.
    # A dyeing WO is cut with a planned bath and a frozen sheet
    # (dyeing_run_service.seed_planned_bath) so its Kartu Kerja can print grams; the
    # actual bath the floor just filled is rarely the planned litre-for-litre, and
    # every g/L row has to follow it. Rows with an actual already recorded are left
    # alone: that chemical is in the vessel, and rewriting its plan erases the
    # variance.
    dosed = 0
    if run.recipe_id:
        rec_res = await db.execute(
            select(DyeRecipe).options(*_recipe_opts()).filter(DyeRecipe.id == run.recipe_id)
        )
        recipe = rec_res.scalars().first()
        if recipe and not run.chemicals:
            for row in dyeing_dose_service.compute_doses(recipe, run.substrate_qty, volume):
                if row["dose"] is None:
                    continue  # line carries no rate — nothing to weigh
                db.add(DyeingRunChemical(
                    run_id=run.id,
                    item_id=row["item_id"],
                    planned_qty=row["dose"],
                    # Filled in at completion with what actually went in; planned vs
                    # actual is the only dosing variance signal there is.
                    actual_qty=0,
                    uom_id=row["uom_id"],
                ))
                dosed += 1
        elif recipe:
            doses = {
                str(row["item_id"]): row["dose"]
                for row in dyeing_dose_service.compute_doses(recipe, run.substrate_qty, volume)
                if row["dose"] is not None
            }
            for chem in run.chemicals:
                if float(chem.actual_qty or 0) > 0:
                    continue
                new_dose = doses.get(str(chem.item_id))
                if new_dose is not None and float(chem.planned_qty or 0) != float(new_dose):
                    chem.planned_qty = new_dose
                    dosed += 1
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "STATUS_CHANGE", "DyeingRun", run_id,
        details=(
            f"Started dyeing run {run.run_number} — bath {volume} L"
            + (f", {dosed} chemical doses calculated" if dosed else "")
        ),
        changes={"status": [status_before, run.status], "volume_air_liters": [None, volume]},
    )
    await manager.broadcast({"type": "DYEING_RUN_UPDATE", "wo_id": str(run.work_order_id)})
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    return _enrich_dyeing_run(result.scalars().first())


@router.patch("/dyeing-runs/{run_id}/chemicals", response_model=DyeingRunResponse)
async def update_dyeing_run_chemicals(
    run_id: str,
    payload: DyeingRunChemicalsUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    """Record what actually went into the vessel.

    This is the operator's act, at the machine, alongside the WO's output log — not
    QC's. It used to be reachable only through `/complete`, so the only way to write
    an actual was to close the bath, which is why closing a bath was the floor's job
    and the shade gate had a production form bolted onto it.

    Upsert by item, so a second entry (a chemical topped up mid-cycle) adds to the
    sheet rather than replacing it, and an item's snapshotted `planned_qty` survives
    unless the caller sends a new one. Omitted items are untouched: this cannot clear
    the sheet — `/complete` with an explicit list is the only thing that replaces it.
    """
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Dyeing run not found")
    # The bath's own close, as everywhere else in this file: a closed bath's
    # chemicals are history. A WO-closed run is still open for this.
    if run.completed_at is not None:
        raise HTTPException(status_code=400, detail="Run is completed — its chemicals are history")
    if not payload.chemicals:
        raise HTTPException(status_code=422, detail="Send at least one chemical row")
    for chem in payload.chemicals:
        if chem.actual_qty < 0 or (chem.planned_qty is not None and chem.planned_qty < 0):
            raise HTTPException(status_code=422, detail="Chemical quantities cannot be negative")

    by_item = {str(c.item_id): c for c in run.chemicals}
    added, updated = 0, 0
    for chem in payload.chemicals:
        existing = by_item.get(str(chem.item_id))
        if existing:
            existing.actual_qty = chem.actual_qty
            if chem.planned_qty is not None:
                existing.planned_qty = chem.planned_qty
            if chem.uom_id is not None:
                existing.uom_id = chem.uom_id
            updated += 1
        else:
            db.add(DyeingRunChemical(
                run_id=run.id,
                item_id=chem.item_id,
                # An off-recipe chemical the operator added has no snapshotted plan;
                # 0 planned against a real actual is the variance, and is correct.
                planned_qty=chem.planned_qty if chem.planned_qty is not None else 0,
                actual_qty=chem.actual_qty,
                uom_id=chem.uom_id,
            ))
            added += 1
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "UPDATE", "DyeingRun", run_id,
        details=(
            f"Recorded chemical actuals on run #{run.run_number}"
            + (f" — {updated} updated" if updated else "")
            + (f", {added} added off-recipe" if added else "")
        ),
        changes={},
    )
    await manager.broadcast({"type": "DYEING_RUN_UPDATE", "wo_id": str(run.work_order_id)})
    # expire_on_commit=False: rows were added, so the cached `chemicals` collection
    # would come back without them (same trap as complete_dyeing_run below).
    db.expire_all()
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    return _enrich_dyeing_run(result.scalars().first())


@router.post("/dyeing-runs/{run_id}/complete", response_model=DyeingRunResponse)
async def complete_dyeing_run(
    run_id: str,
    payload: DyeingRunCompletePayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Dyeing run not found")
    # The bath's own close, again — a WO closed before anyone recorded the shade
    # marks its runs COMPLETED, and QC is a separate act at a later moment (that is
    # the whole reason shade_result is not folded into the status). Refusing on the
    # derived status here would make the shade unrecordable on a finished WO.
    if run.completed_at is not None:
        raise HTTPException(status_code=400, detail="Run already completed")

    # Output lot — ONE per physical dye lot. This route used to mint its own Batch
    # from a typed number while add_mo_completion separately minted the `DYE-` lot,
    # so every dyed batch existed twice, unlinked. The WO completion is the only
    # minter now (it is what credits the output to stock); the run adopts that lot,
    # either here if the output was already logged, or later when it is —
    # add_mo_completion claims the earliest unlinked run on the WO.
    #
    # Several bags off one bath: `output_batch_id` holds the FIRST lot only. The rest
    # trace through `BatchConsumption` + `Batch.source_wo_id`, exactly as multiple
    # bags per weaving WO already do; a join table would duplicate that lineage.
    if not run.output_batch_id:
        lot_res = await db.execute(
            select(MOCompletion.output_batch_id)
            .filter(
                MOCompletion.work_order_id == run.work_order_id,
                MOCompletion.output_batch_id.isnot(None),
                MOCompletion.rejected == False,  # noqa: E712
            )
            .order_by(MOCompletion.created_at)
            .limit(1)
        )
        run.output_batch_id = lot_res.scalar()
    # Legacy callers may still name a lot. Accept it only if it already exists —
    # minting here is what produced the duplicates.
    if not run.output_batch_id and (payload.output_batch_number or "").strip():
        wanted = payload.output_batch_number.strip()
        b_res = await db.execute(select(Batch).filter(Batch.batch_number == wanted))
        named = b_res.scalars().first()
        if not named:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Lot '{wanted}' does not exist. The dyed lot is created when the work "
                    "order's output is logged — log the completion on the work order, and "
                    "this run picks the lot up automatically."
                ),
            )
        run.output_batch_id = named.id

    run.shade_result = payload.shade_result
    run.shade_notes = payload.shade_notes
    run.completed_at = datetime.now(timezone.utc)
    if not run.started_at:
        run.started_at = run.completed_at
    # `completed_at` is the fact that closes the bath — the status follows from it
    # (dyeing_run_service), so this route no longer writes COMPLETED by hand.
    status_before = run.status
    await dyeing_run_service.sync_wo_runs(db, run.work_order_id)

    # Replace the whole dose sheet — but only when a list was actually sent. The
    # shade-result close sends none: actuals come in from the work order flow
    # (PATCH /chemicals) now, and wiping them on a QC entry would delete the only
    # record of what went into the vessel. `[]` is still an explicit clear.
    if payload.chemicals is not None:
        for old_chem in list(run.chemicals):
            await db.delete(old_chem)
        await db.flush()

        for chem in payload.chemicals:
            c = DyeingRunChemical(
                run_id=run.id,
                item_id=chem.item_id,
                planned_qty=chem.planned_qty,
                actual_qty=chem.actual_qty,
                uom_id=chem.uom_id,
            )
            db.add(c)

    await db.commit()
    # expire_on_commit=False, so the re-fetch below would hand back this session's
    # cached instance: the chemicals just deleted/recreated, and an `output_batch`
    # relationship still cached as None from before the lot was adopted above.
    db.expire_all()
    result = await db.execute(
        select(DyeingRun).options(*_dyeing_run_opts()).filter(DyeingRun.id == run_id)
    )
    run = result.scalars().first()
    lot_no = run.output_batch.batch_number if run.output_batch else None
    await audit_service.log_activity(
        db, str(current_user.id), "COMPLETE", "DyeingRun", str(run.id),
        details=(
            f"Completed dyeing run #{run.run_number}, shade={payload.shade_result}"
            + (f", lot {lot_no}" if lot_no else ", no output lot yet (log the WO output)")
        ),
        changes={"status": [status_before, run.status]},
    )
    await manager.broadcast({"type": "DYEING_RUN_UPDATE", "wo_id": str(run.work_order_id)})
    return _enrich_dyeing_run(run)


# ─── Setting Runs ─────────────────────────────────────────────────────────────

@router.get("/setting-runs", response_model=list[SettingRunResponse])
async def list_setting_runs(
    work_order_id: Optional[str] = Query(None),
    work_order_ids: str = Query(
        "",
        description="Comma-separated WO ids — the runs of one page of setting work "
                    "orders in a single call. Bounded by the caller's page size.",
    ),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("setting_order.view", "dye_recipe.view", "work_order.view")),
):
    """The runs, for one WO or for a page of them.

    `work_order_ids` mirrors the dyeing side: the supervisory list shows each WO's
    machine, setting parameters and measured output on its own row, and fetching
    those one WO at a time is a request per row.
    """
    q = select(SettingRun).options(*_setting_run_opts()).order_by(SettingRun.created_at)
    if work_order_id:
        q = q.filter(SettingRun.work_order_id == work_order_id)
    elif work_order_ids.strip():
        ids = [i for i in (x.strip() for x in work_order_ids.split(",")) if i]
        if not ids:
            return []
        q = q.filter(SettingRun.work_order_id.in_(ids))
    result = await db.execute(q)
    return [_enrich_setting_run(r) for r in result.scalars().all()]


@router.post("/setting-runs", response_model=SettingRunResponse)
async def create_setting_run(
    payload: SettingRunCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    wo_result = await db.execute(select(WorkOrder).filter(WorkOrder.id == payload.work_order_id))
    if not wo_result.scalars().first():
        raise HTTPException(status_code=404, detail="Work Order not found")

    run_number = await _get_next_run_number(db, SettingRun, payload.work_order_id)
    run = SettingRun(
        work_order_id=payload.work_order_id,
        run_number=run_number,
        substrate_qty=payload.substrate_qty,
        input_batch_id=payload.input_batch_id,
        machine_name=payload.machine_name,
        temperature_c=payload.temperature_c,
        speed_mpm=payload.speed_mpm,
        width_cm=payload.width_cm,
        overfeed_pct=payload.overfeed_pct,
        operator_name=payload.operator_name,
        notes=payload.notes,
        status="PENDING",
    )
    db.add(run)
    await db.commit()
    result = await db.execute(
        select(SettingRun).options(*_setting_run_opts()).filter(SettingRun.id == run.id)
    )
    run = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "CREATE", "SettingRun", str(run.id),
        details=f"Created setting run #{run.run_number} for WO {run.work_order_id}", changes={}
    )
    return _enrich_setting_run(run)


@router.post("/setting-runs/{run_id}/start", response_model=SettingRunResponse)
async def start_setting_run(
    run_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    result = await db.execute(
        select(SettingRun).options(*_setting_run_opts()).filter(SettingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Setting run not found")
    if run.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Run is already {run.status}")
    run.status = "IN_PROGRESS"
    run.started_at = datetime.now(timezone.utc)
    await db.commit()
    await audit_service.log_activity(
        db, current_user.id, "STATUS_CHANGE", "SettingRun", run_id,
        details=f"Started setting run {run.run_number}"
    )
    result = await db.execute(
        select(SettingRun).options(*_setting_run_opts()).filter(SettingRun.id == run_id)
    )
    return _enrich_setting_run(result.scalars().first())


@router.post("/setting-runs/{run_id}/complete", response_model=SettingRunResponse)
async def complete_setting_run(
    run_id: str,
    payload: SettingRunCompletePayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('work_order.log')),
):
    result = await db.execute(
        select(SettingRun).options(*_setting_run_opts()).filter(SettingRun.id == run_id)
    )
    run = result.scalars().first()
    if not run:
        raise HTTPException(status_code=404, detail="Setting run not found")
    if run.status == "COMPLETED":
        raise HTTPException(status_code=400, detail="Run already completed")

    # Create output batch
    batch_check = await db.execute(
        select(Batch).filter(Batch.batch_number == payload.output_batch_number)
    )
    out_batch = batch_check.scalars().first()
    if not out_batch:
        wo_result = await db.execute(
            select(WorkOrder).filter(WorkOrder.id == run.work_order_id)
        )
        wo = wo_result.scalars().first()
        from app.models.manufacturing import ManufacturingOrder
        mo_result = await db.execute(
            select(ManufacturingOrder).filter(ManufacturingOrder.id == wo.manufacturing_order_id)
        )
        mo = mo_result.scalars().first()
        out_batch = Batch(
            batch_number=payload.output_batch_number,
            item_id=mo.item_id if mo else wo.manufacturing_order_id,
            created_by=str(current_user.id),
        )
        db.add(out_batch)
        await db.flush()

    run.output_batch_id = out_batch.id
    run.status = "COMPLETED"
    run.actual_width_cm = payload.actual_width_cm
    run.actual_gsm = payload.actual_gsm
    run.actual_shrinkage_pct = payload.actual_shrinkage_pct
    run.completed_at = datetime.now(timezone.utc)
    if not run.started_at:
        run.started_at = run.completed_at

    await db.commit()
    result = await db.execute(
        select(SettingRun).options(*_setting_run_opts()).filter(SettingRun.id == run_id)
    )
    run = result.scalars().first()
    await audit_service.log_activity(
        db, str(current_user.id), "COMPLETE", "SettingRun", str(run.id),
        details=f"Completed setting run #{run.run_number}", changes={}
    )
    return _enrich_setting_run(run)
