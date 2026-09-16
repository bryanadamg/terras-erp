"""One definition of a dyeing run's status.

The run's status used to be written wherever a route felt like it, independently of
the work order the bath belongs to — 4 of 12 rows on the dev DB had a `COMPLETED` WO
and a `PENDING` run, so "is this bath finished" had two answers. It is derived here
and nowhere else now.

The column stays a stored cache rather than a property: the vessel grid filters on it
in SQL (`DyeingRun.status.in_(CARD_RUN_STATUSES)` in `api/dyeing_monitor.py`), which
a Python-side derivation cannot serve. `sync_wo_runs` rewrites it whenever either
side moves — a bath filled, a bath closed, or the WO's own status changing.

The rule, in order:

    CANCELLED       the WO is cancelled; nothing is running in that vessel.
    COMPLETED       the bath was closed (`completed_at`), OR the WO closed — finishing
                    a WO takes every bath under it off the machine.
    IN_PROGRESS     a bath has been recorded (`started_at`, or a volume).
    COLOR_MATCHING  the shade is being matched at the vessel (`color_matching_at`).
    PENDING         loaded and waiting.

Colour matching sits BELOW the bath in that order on purpose: it is the phase before
the machine runs, so the moment a bath is recorded the batch has left it. A run may
skip it entirely — nothing forces the button, and a batch that goes straight to
IN_PROGRESS simply reports no prep time.

A bath keeps its own close on purpose: a multi-bath WO finishes bath 1 while bath 2
is still running, and `completed_at` is granularity the WO cannot express. What is
gone is the reverse — a bath left open under a WO that is already finished. Reopening
a WO reopens only the baths that were never closed themselves.

`shade_result` is deliberately not part of this. QC is a separate act at a later
moment, and a FAIL must not reopen anything.
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.dyeing_setting import DyeingRun, DyeingRunChemical, DyeRecipe, DyeRecipeLine
from app.models.work_order import WorkOrder
from app.services import dyeing_dose_service

# The WO statuses that take every bath under them off the machine. DELIVERED is
# absent for the same reason it is absent from the MO close rules: qty met, order
# still open (see CLAUDE.md's DELIVERED-vs-COMPLETED split).
CLOSING_WO_STATUSES = ("COMPLETED",)


def derive_status(run: DyeingRun, wo_status: str | None) -> str:
    """The run's status, given its own record and its WO's status."""
    wo = (wo_status or "").upper()
    if wo == "CANCELLED":
        return "CANCELLED"
    if run.completed_at is not None or wo in CLOSING_WO_STATUSES:
        return "COMPLETED"
    if run.started_at is not None or run.volume_air_liters is not None:
        return "IN_PROGRESS"
    if run.color_matching_at is not None:
        return "COLOR_MATCHING"
    return "PENDING"


async def sync_wo_runs(
    db: AsyncSession,
    work_order_id,
    *,
    wo_status: str | None = None,
) -> list[tuple[DyeingRun, str, str]]:
    """Recompute every run on a WO. Returns the (run, was, now) it changed.

    Flushes nothing and commits nothing — the caller owns the transaction, so this
    can sit inside the WO status route and inside `add_mo_completion` alike. The
    changed list is what the caller audits: an automatic status move with no trail
    is exactly what made the original mismatch impossible to explain.

    Pass `wo_status` when the caller already holds the WO (and especially when it
    has just assigned a new status that is not committed yet — re-reading it here
    would come back with the same in-session value, but taking it explicitly keeps
    that non-obvious).
    """
    if wo_status is None:
        res = await db.execute(select(WorkOrder.status).filter(WorkOrder.id == work_order_id))
        wo_status = res.scalar()

    res = await db.execute(select(DyeingRun).filter(DyeingRun.work_order_id == work_order_id))
    changed: list[tuple[DyeingRun, str, str]] = []
    for run in res.scalars().all():
        now = derive_status(run, wo_status)
        if now != run.status:
            changed.append((run, run.status, now))
            run.status = now
    return changed


async def seed_planned_bath(db: AsyncSession, run: DyeingRun, typed_volume=None) -> float | None:
    """Plan `run`'s bath and freeze its dose sheet. Returns the planned litres.

    Called when a DYEING work order is cut, because that is the last moment before
    the Kartu Kerja is printed — and a card that reaches the vessel carrying g/L
    rates instead of grams is not an instruction, it is homework. `typed_volume` is
    the planner's own figure; blank falls back to the recipe's `liquor_ratio` times
    the load, so the usual case needs no input at all.

    Two things this deliberately does NOT do:
      - write `volume_air_liters`. That column is the water the floor actually
        filled, and `derive_status` reads it as "this vessel is running". The plan
        lives in `planned_volume_air_liters` and the run stays PENDING.
      - own the formula. Doses come from `dyeing_dose_service`, the same call the
        screen and the print portal make.

    The materialized `DyeingRunChemical.planned_qty` rows are the MOPlannedComponent
    pattern: what the operator was told to weigh must stay readable after somebody
    retunes the recipe. `PATCH /dyeing-runs/{id}/bath` re-prices the rows whose
    actual is still 0 once the real bath is known, so a plan is never a ceiling.
    """
    if not run.recipe_id:
        return None
    res = await db.execute(
        select(DyeRecipe)
        .options(
            # compute_doses reads line.item / line.uom; async can't lazy-load them.
            selectinload(DyeRecipe.lines).selectinload(DyeRecipeLine.item),
            selectinload(DyeRecipe.lines).selectinload(DyeRecipeLine.uom),
        )
        .filter(DyeRecipe.id == run.recipe_id)
    )
    recipe = res.scalars().first()
    if not recipe:
        return None

    volume, _ratio = dyeing_dose_service.solve_bath(
        run.substrate_qty, typed_volume, recipe.liquor_ratio,
    )
    if not volume or volume <= 0:
        # No planner figure and no recipe ratio: nothing to plan. The card falls back
        # to printing the rates with a "bath not set" note, exactly as before.
        return None
    run.planned_volume_air_liters = volume

    # Guarded on "no rows yet" so a re-plan never rewrites a sheet the floor has
    # already been weighing against.
    if not await _has_chemicals(db, run):
        for row in dyeing_dose_service.compute_doses(recipe, run.substrate_qty, volume):
            if row["dose"] is None:
                continue
            db.add(DyeingRunChemical(
                run_id=run.id, item_id=row["item_id"],
                planned_qty=row["dose"], actual_qty=0, uom_id=row["uom_id"],
            ))
    return volume


async def _has_chemicals(db: AsyncSession, run: DyeingRun) -> bool:
    """Whether the run already carries a dose sheet, without lazy-loading it (async
    sessions can't) and without assuming the run has been flushed."""
    if run.id is None:
        return False
    res = await db.execute(
        select(DyeingRunChemical.id).filter(DyeingRunChemical.run_id == run.id).limit(1)
    )
    return res.scalar() is not None
