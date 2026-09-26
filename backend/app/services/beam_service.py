"""Warp-beam lifecycle: beams are loom resources, not work-order materials.

Industry shape (SAP production supply area, Oracle operation-pull supply
subinventory, textile MES beam gaiting): a warp beam is mounted on a machine,
and every order that runs on that machine draws from what is mounted. It is
never staged to a single order.

Lifecycle:

    in store  --mount_beam-->  MOUNTED on loom  --consume_from_mounts-->  ...
                                     |
                                     +--dismount_beam--> weighed, re-lotted (LFT-),
                                        back to store

`mount_beam` moves the beam batch into the loom's input location and opens a
`BeamMount` row keyed on the WORK CENTER. The beam stays lotted the whole time,
so:

  * readiness for any WO on that loom reads the loom's active mounts, not
    per-WO staging ledger tags — so WO size-S, then size-M, then size-L all see
    the same warp as available without re-staging (the bug this replaced);
  * weaving completions deduct kg FIFO across active mounts with no per-beam
    pick by the operator, and peg BatchConsumption straight to the real beam
    (better genealogy than the old MO-level NULL peg);
  * every dismount strips and WEIGHS the remnant off the beam:
    `dismount_beam(leftover_qty=...)` splits it into its own LFT- lot (parent
    beam retired at 0, scale-vs-system drift written off on the parent) so the
    physical roll on the rack always has a number the next loom can scan and
    mount — no unlotted warp is ever parked at a loom.

Replaces the previous merge-into-batch-less-pool model. `consume_from_mounts`
still falls back to the batch-less pool at the loom input location so beams
merged by the old code (pre-migration, already pooled) keep deducting.
"""

from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.models.work_order import WorkOrder
from app.models.routing import WorkCenter
from app.models.item import Item
from app.models.category import Category
from app.models.stock_balance import StockBalance
from app.models.batch import Batch, BatchConsumption, BeamMount
from app.services import stock_service, work_center_service, reject_service

WEAVING_TYPES = {"WEAVING", "TENUN"}


async def is_weaving_wo(db: AsyncSession, wo: WorkOrder) -> bool:
    if not wo.work_center_id:
        return False
    wc_type = (
        await db.execute(select(WorkCenter.center_type).where(WorkCenter.id == wo.work_center_id))
    ).scalar()
    return (wc_type or "").upper() in WEAVING_TYPES


async def beam_item_ids(db: AsyncSession, item_ids: list) -> set[str]:
    """Which of these items are warp beams. One definition, three call sites
    (staging, readiness, completion) used to each carry their own copy."""
    if not item_ids:
        return set()
    res = await db.execute(
        select(Item.id)
        .outerjoin(Category, Item.category_id == Category.id)
        .where(
            Item.id.in_(item_ids),
            or_(
                func.lower(Category.name) == "beam",
                Item.code.startswith("BEAM-"),
                Item.ends.isnot(None),
            ),
        )
    )
    return {str(r[0]) for r in res.all()}


def is_beam_item(item) -> bool:
    """`beam_item_ids` for an Item already loaded with its category — same
    three-way rule, for callers that have the row and no reason to re-query."""
    if item is None:
        return False
    return bool(
        (item.category and (item.category.name or "").lower() == "beam")
        or (item.code or "").startswith("BEAM-")
        or item.ends is not None
    )


async def _mount_remaining(db: AsyncSession, mount: BeamMount) -> float:
    """Live remaining kg of a mounted beam — its batch balance at the loom."""
    if not mount.location_id:
        return 0.0
    bal = (
        await db.execute(
            select(StockBalance.qty).where(
                StockBalance.item_id == mount.item_id,
                StockBalance.location_id == mount.location_id,
                StockBalance.variant_key == "",
                StockBalance.batch_key == str(mount.batch_id),
            )
        )
    ).scalar()
    return float(bal or 0)


async def active_mounts(
    db: AsyncSession, work_center_id, item_id=None
) -> list[tuple[BeamMount, float]]:
    """Open mounts on a loom, oldest first (FIFO consumption order), each with
    its live remaining kg. Depleted-but-not-yet-dismounted mounts are included
    at 0.0 — callers filter as needed."""
    if not work_center_id:
        return []
    q = (
        select(BeamMount)
        .options(joinedload(BeamMount.batch), joinedload(BeamMount.item))
        .where(BeamMount.work_center_id == work_center_id, BeamMount.dismounted_at.is_(None))
        .order_by(BeamMount.mounted_at.asc())
    )
    if item_id is not None:
        q = q.where(BeamMount.item_id == item_id)
    mounts = (await db.execute(q)).unique().scalars().all()
    return [(m, await _mount_remaining(db, m)) for m in mounts]


async def mounted_qty(db: AsyncSession, work_center_id, item_id) -> float:
    """Total warp kg available on the loom for this item."""
    return sum(q for _, q in await active_mounts(db, work_center_id, item_id))


async def mounted_pcs(db: AsyncSession, work_center_id, item_id=None) -> int:
    """Beam count on the loom — the number Bryan cares about ("4 lines = 4 pcs"),
    counting only mounts that still hold warp."""
    return sum(1 for _, q in await active_mounts(db, work_center_id, item_id) if q > 1e-9)


async def mount_beam(
    db: AsyncSession,
    batch_id,
    work_center_id,
    qty: float | None = None,
    source_wo_id=None,
    user: str | None = None,
) -> BeamMount:
    """Mount a beam on a loom: move it to the loom's input location and open a
    BeamMount. Idempotent per beam — a beam already mounted on this loom is
    returned as-is rather than double-moved. Caller commits."""
    batch = (await db.execute(select(Batch).where(Batch.id == batch_id))).scalars().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Beam not found")
    # A REJECT_USABLE beam is deliberately allowed back on the loom — that grade
    # exists because a rejected beam still weaves certain items. Only scrap-bound
    # (REJECTED) and written-off (DISPOSED) beams are refused.
    if str(batch.quality_status or "") in reject_service.UNPICKABLE_GRADES:
        raise HTTPException(status_code=400, detail=f"Beam {batch.batch_number} is {batch.quality_status.lower()}")

    wc = (await db.execute(select(WorkCenter).where(WorkCenter.id == work_center_id))).scalars().first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work center not found")
    # Effective supply area: the loom's own input location, else the one inherited
    # from its group / type — machines in a hall share one supply bin.
    loom_input_loc, _ = await work_center_service.resolve_locations(db, wc.id)
    if not loom_input_loc:
        raise HTTPException(
            status_code=422,
            detail=f"Machine '{wc.code or wc.name}' has no supply area — set an input location on it or on its group",
        )

    existing = (
        await db.execute(
            select(BeamMount).where(
                BeamMount.batch_id == batch_id, BeamMount.dismounted_at.is_(None)
            )
        )
    ).scalars().first()
    if existing:
        if str(existing.work_center_id) == str(work_center_id):
            return existing
        other = (
            await db.execute(select(WorkCenter.code).where(WorkCenter.id == existing.work_center_id))
        ).scalar()
        raise HTTPException(
            status_code=400,
            detail=f"Beam {batch.batch_number} is already mounted on {other or 'another machine'} — dismount it first",
        )

    # Where the beam physically is now. A beam is plant-level stock and not
    # pinned to a fixed store, so find it rather than assume a source.
    rows = (
        await db.execute(
            select(StockBalance.location_id, StockBalance.qty).where(
                StockBalance.item_id == batch.item_id,
                StockBalance.batch_key == str(batch_id),
                StockBalance.qty > 0,
            )
        )
    ).all()
    if not rows:
        raise HTTPException(
            status_code=400, detail=f"Beam {batch.batch_number} has no stock left to mount"
        )

    moved = 0.0
    want = float(qty) if qty and float(qty) > 0 else None
    for loc_id, bal in rows:
        if str(loc_id) == str(loom_input_loc):
            moved += float(bal)   # already at the loom
            continue
        take = float(bal) if want is None else min(float(bal), max(0.0, want - moved))
        if take <= 0:
            continue
        # Two-sided transfer, referenced to the WORK CENTER — not a WO. This is
        # the whole point: attribution follows the machine.
        await stock_service.add_stock_entry(
            db, item_id=batch.item_id, location_id=loc_id, qty_change=-take,
            reference_type="Beam Mount", reference_id=str(work_center_id),
            attribute_value_ids=[], batch_id=batch_id,
        )
        await stock_service.add_stock_entry(
            db, item_id=batch.item_id, location_id=loom_input_loc, qty_change=take,
            reference_type="Beam Mount", reference_id=str(work_center_id),
            attribute_value_ids=[], batch_id=batch_id,
        )
        moved += take

    mount = BeamMount(
        batch_id=batch_id,
        work_center_id=work_center_id,
        item_id=batch.item_id,
        location_id=loom_input_loc,
        qty_mounted=moved,
        source_wo_id=source_wo_id,
        mounted_by=user,
    )
    db.add(mount)
    await db.flush()
    return mount


async def dismount_beam(
    db: AsyncSession,
    mount_id,
    leftover_qty: float,
    to_location_id=None,
    user: str | None = None,
    leftover_number: str | None = None,
    leftover_ends: int | None = None,
    leftover_notes: str | None = None,
) -> tuple[BeamMount, Batch | None, float]:
    """Close a mount. Returns (mount, leftover_batch|None, variance).

    Every dismount is a weigh-and-relot: the floor strips the warp off the beam
    and weighs it. The weighed kg become a NEW leftover lot (`parent_batch_id` =
    this beam) and the parent beam is retired at 0. Any difference between the
    scale and the system's remaining is written off against the parent first, so
    the leftover lot always equals what is physically on the rack — a beam is
    consumed by theoretical FIFO deduction, so drift is normal and belongs on the
    beam that produced it, not on the lot the next loom will weave. `weighed ==
    0` is meaningful ("nothing left") and just reconciles the beam to empty
    without minting a lot.

    Caller commits, and is responsible for allocating `leftover_number`.
    """
    mount = (
        await db.execute(
            select(BeamMount).options(joinedload(BeamMount.batch)).where(BeamMount.id == mount_id)
        )
    ).unique().scalars().first()
    if not mount:
        raise HTTPException(status_code=404, detail="Beam mount not found")
    if mount.dismounted_at:
        raise HTTPException(status_code=400, detail="Beam already dismounted")

    remaining = await _mount_remaining(db, mount)
    leftover: Batch | None = None

    weighed = float(leftover_qty)
    if weighed < 0:
        raise HTTPException(status_code=400, detail="Leftover qty cannot be negative")
    if not mount.location_id:
        raise HTTPException(status_code=422, detail="Mount has no location to move warp out of")
    if not leftover_number and weighed > 0:
        raise HTTPException(status_code=400, detail="Leftover lot number not allocated")

    # 1. Reconcile the parent beam to the scale before splitting anything off.
    variance = weighed - remaining
    if abs(variance) > 1e-9:
        await stock_service.add_stock_entry(
            db, item_id=mount.item_id, location_id=mount.location_id, qty_change=variance,
            reference_type="Beam Leftover Variance", reference_id=str(mount.work_center_id),
            attribute_value_ids=[], batch_id=mount.batch_id,
        )

    # 2. Split the weighed remnant into its own lot, at the return store when
    #    one was picked (a leftover normally leaves the loom).
    if weighed > 0:
        parent = mount.batch
        leftover = Batch(
            batch_number=leftover_number,
            item_id=mount.item_id,
            ends=leftover_ends if leftover_ends else (parent.ends if parent else None),
            # Production origin follows the parent beam: the leftover was woven
            # from the same warp, so it traces back to the same beaming WO.
            source_wo_id=(parent.source_wo_id if parent else None),
            parent_batch_id=mount.batch_id,
            notes=leftover_notes or f"Leftover from {(parent.batch_number if parent else 'beam')}",
            created_by=user,
        )
        db.add(leftover)
        await db.flush()

        dest = to_location_id or mount.location_id
        await stock_service.add_stock_entry(
            db, item_id=mount.item_id, location_id=mount.location_id, qty_change=-weighed,
            reference_type="Beam Leftover", reference_id=str(mount.work_center_id),
            attribute_value_ids=[], batch_id=mount.batch_id,
        )
        await stock_service.add_stock_entry(
            db, item_id=mount.item_id, location_id=dest, qty_change=weighed,
            reference_type="Beam Leftover", reference_id=str(mount.work_center_id),
            attribute_value_ids=[], batch_id=leftover.id,
        )
        # Genealogy through the same table every other lot uses.
        db.add(BatchConsumption(
            input_batch_id=mount.batch_id,
            output_batch_id=leftover.id,
            qty_consumed=weighed,
        ))

    mount.dismounted_at = datetime.utcnow()
    mount.dismounted_by = user
    return mount, leftover, variance


async def auto_dismount_depleted(db: AsyncSession, work_center_id) -> int:
    """Close mounts whose warp ran out, so the loom's mounted-pcs count reflects
    reality without an operator step. Caller commits."""
    closed = 0
    for mount, qty in await active_mounts(db, work_center_id):
        if qty > 1e-9:
            continue
        mount.dismounted_at = datetime.utcnow()
        mount.dismounted_by = "auto (depleted)"
        closed += 1
    return closed


async def consume_from_mounts(
    db: AsyncSession,
    wo: WorkOrder,
    item_id,
    qty: float,
    mo_id,
    output_batch_id=None,
    reference_id: str | None = None,
) -> float:
    """Deduct `qty` kg of warp for a weaving completion, FIFO across the loom's
    active mounts. No operator picks a beam — the loom decides. Each mount
    touched gets a BatchConsumption row pegged to the real beam and (when the
    completion produced one) to the output lot.

    Any shortfall left after the mounts are drained is deducted from the
    batch-less pool at the loom input location, which is where beams merged by
    the old pre-mount code live. Returns the qty taken from that pool.
    """
    if qty <= 0:
        return 0.0
    remaining_need = float(qty)
    ref = reference_id or (wo.code if wo and wo.code else str(getattr(wo, "id", "")))

    for mount, avail in await active_mounts(db, wo.work_center_id, item_id):
        if remaining_need <= 1e-9:
            break
        if avail <= 1e-9:
            continue
        take = min(avail, remaining_need)
        await stock_service.add_stock_entry(
            db, item_id=item_id, location_id=mount.location_id, qty_change=-take,
            reference_type="Manufacturing Order", reference_id=ref,
            attribute_value_ids=[], batch_id=mount.batch_id,
        )
        db.add(BatchConsumption(
            manufacturing_order_id=mo_id,
            input_batch_id=mount.batch_id,
            output_batch_id=output_batch_id,
            qty_consumed=take,
        ))
        remaining_need -= take

    if remaining_need > 1e-9 and wo.input_location_id:
        # Legacy pooled warp (or an over-run past what is mounted): deduct from
        # the batch-less balance, same as any untracked material.
        await stock_service.add_stock_entry(
            db, item_id=item_id, location_id=wo.input_location_id, qty_change=-remaining_need,
            reference_type="Manufacturing Order", reference_id=ref,
            attribute_value_ids=[], batch_id=None,
        )
        return remaining_need
    return 0.0
