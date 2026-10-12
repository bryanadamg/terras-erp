"""Staging reservations — a staged lot belongs to the WO it was staged to.

Two WOs cut from the same BOM at different sizes (`…-002-M-WO-01` and
`…-002-L-WO-01`) run on the same machine, so they share one input location, and
the substrate they consume is the same item. The consumption picker offered every
lot with stock at that location, which meant the L WO's operator could pick — and
did pick — the two greige bags the M WO's stager had put on the line: 10 kg of
another order's substrate consumed, while the M WO's staging panel still listed
them as staged with "0.0 left".

Staging is therefore not only a stock move, it is a **claim**. A lot is reserved
to the WO whose latest positive `Staging` ledger row moved it into a location.

Read off the ledger rather than stored on the batch, for three reasons:
  * no release step is needed — consuming or moving the lot drops its balance to
    0 and every picker stops offering it anyway;
  * the claim is already in the data, it just had no reader (`_wo_staged_lots` in
    api/work_orders.py reads the same rows for the staged-total readout);
  * it is retroactive, so lots staged before this existed are protected too.

Claims are exclusive by nature — a lot is one physical bag — so a second WO
staging the same lot takes the claim over (latest row wins). A claim also dies with
its WO: staging moves whole lots, never a clipped qty, so a run normally ends with
surplus of its last lot on the line, and a COMPLETED/CANCELLED holder must not
strand it — the next WO stages it straight off that location.

Warp beams are deliberately outside all of this: warp mounts on the *machine*,
not on a WO (see services/beam_service.py), so a beam batch carries no `Staging`
rows and can never be claimed here.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Iterable

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock_balance import StockBalance
from app.models.stock_ledger import StockLedger
from app.models.work_order import WorkOrder


def _as_uuid(value) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        return None


async def _claims(
    db: AsyncSession,
    location_id=None,
    batch_ids: Iterable | None = None,
) -> dict[tuple[str, str], tuple[datetime, str]]:
    """`{(batch id, location id): (staged at, work order id)}` — live staging claims.

    Only nets-positive rows count: a reversed staging (equal negative row) frees the
    lot again. Latest row wins per (lot, location), so a re-stage to another WO hands
    the lot over.
    """
    query = (
        select(
            StockLedger.batch_id,
            StockLedger.location_id,
            StockLedger.reference_id,
            func.sum(StockLedger.qty_change),
            func.max(StockLedger.created_at),
        )
        .where(
            StockLedger.reference_type == "Staging",
            StockLedger.batch_id.isnot(None),
        )
        .group_by(StockLedger.batch_id, StockLedger.location_id, StockLedger.reference_id)
    )
    loc = _as_uuid(location_id)
    if loc:
        query = query.where(StockLedger.location_id == loc)
    if batch_ids is not None:
        ids = [b for b in (_as_uuid(x) for x in batch_ids) if b]
        if not ids:
            return {}
        query = query.where(StockLedger.batch_id.in_(ids))

    rows = await db.execute(query)
    best: dict[tuple[str, str], tuple[datetime, str]] = {}
    for batch_id, loc_id, ref, net, at in rows.all():
        if float(net or 0) <= 1e-9:
            continue
        # reference_id is a free-text column; a Staging row always writes str(wo.id),
        # but anything that isn't a WO id can't name a holder, so it can't claim.
        if not _as_uuid(ref):
            continue
        key = (str(batch_id), str(loc_id))
        stamp = at or datetime.min
        prev = best.get(key)
        if prev is None or stamp > prev[0]:
            best[key] = (stamp, str(ref))
    if not best:
        return best

    # A claim is only live while the lot is still physically on that line. Staging
    # rows are never reversed on consumption (the staged total deliberately keeps
    # counting consumed loads — see api/work_orders.py `_wo_staged_lots`), so
    # without this a lot that WO-A burned through, and that later comes back into
    # the same location, would stay locked to WO-A forever.
    live = await db.execute(
        select(StockBalance.batch_key, StockBalance.location_id, func.sum(StockBalance.qty))
        .where(
            StockBalance.batch_key.in_({b for b, _ in best}),
            StockBalance.location_id.in_({_as_uuid(l) for _, l in best}),
        )
        .group_by(StockBalance.batch_key, StockBalance.location_id)
    )
    on_hand = {(k, str(loc)) for k, loc, qty in live.all() if float(qty or 0) > 1e-9}
    best = {key: value for key, value in best.items() if key in on_hand}
    if not best:
        return best

    # A closed WO holds nothing. Staging moves whole lots (api/work_orders.py never
    # clips a picked qty), so a run routinely ends with surplus of its last lot still
    # on the line — that remnant is the next order's material, and a claim by a
    # COMPLETED/CANCELLED WO would strand it there with no way to hand it over.
    holders = {h for _at, h in best.values()}
    closed = await db.execute(
        select(WorkOrder.id).where(
            WorkOrder.id.in_({_as_uuid(h) for h in holders if _as_uuid(h)}),
            WorkOrder.status.in_(("COMPLETED", "CANCELLED")),
        )
    )
    dead = {str(i) for (i,) in closed.all()}
    return {key: value for key, value in best.items() if value[1] not in dead}


async def batch_reservations(
    db: AsyncSession,
    location_id,
    batch_ids: Iterable | None = None,
) -> dict[str, str]:
    """`{batch id: work order id}` — who each staged lot at this location belongs to.

    `batch_ids` narrows the scan to the lots a picker is about to show; pass None to
    map the whole location.
    """
    if not _as_uuid(location_id):
        return {}
    claims = await _claims(db, location_id, batch_ids)
    return {batch_id: holder for (batch_id, _loc), (_at, holder) in claims.items()}


async def reservations_at_current_location(
    db: AsyncSession,
    batch_locations: dict[str, object],
) -> dict[str, str]:
    """`{batch id: work order id}` for lots claimed **where they now sit**.

    For callers that resolve one scanned lot without knowing a location up front
    (`GET /batches/resolve`). A claim only binds while the lot is still on that WO's
    line: a lot staged to a WO and later moved back to a store is free again, and
    matching against the lot's current location is what expresses that.
    """
    wanted = {b: str(loc) for b, loc in batch_locations.items() if loc}
    if not wanted:
        return {}
    claims = await _claims(db, None, list(wanted.keys()))
    return {
        batch_id: holder
        for (batch_id, loc), (_at, holder) in claims.items()
        if wanted.get(batch_id) == loc
    }


async def reserved_by_other(
    db: AsyncSession,
    location_id,
    wo_id,
    batch_ids: Iterable | None = None,
) -> dict[str, str]:
    """`{batch id: holder WO id}` for lots at this location claimed by a *different* WO.

    Empty means every lot asked about is either this WO's own or unclaimed — both
    of which are fine to consume.
    """
    mine = str(_as_uuid(wo_id) or "")
    return {
        batch_id: holder
        for batch_id, holder in (await batch_reservations(db, location_id, batch_ids)).items()
        if holder != mine
    }


async def wo_codes(db: AsyncSession, wo_ids: Iterable) -> dict[str, str]:
    """`{work order id: code}` — so a blocked pick can name the WO holding the lot."""
    ids = [w for w in (_as_uuid(x) for x in wo_ids) if w]
    if not ids:
        return {}
    rows = await db.execute(select(WorkOrder.id, WorkOrder.code).where(WorkOrder.id.in_(ids)))
    return {str(i): c for i, c in rows.all()}


# Steps whose staged lots ARE the step's load: greige in, the same fabric out, in the
# same kg. Weaving is not one -- its staged rows are warp beams (warp only, often
# two per WO), nothing like the greige it outputs.
STAGED_LOAD_CENTER_TYPES = ("DYEING", "CELUP", "SETTING")


def largest_staged(net_by_item: dict) -> float | None:
    """The substrate staged to a WO, from its net lot-staged qty per item.

    The substrate is the largest staged item -- the same call work_queue_service
    makes off requirements, since a dye bath's chemicals are dosed per 100 kg of it.
    In practice only greige lots are staged; this keeps a lot-tracked chemical, if one
    ever is, from being added to the fabric. None when nothing is left staged (e.g.
    fully reversed), so the caller falls back to the WO qty.
    """
    best = max((float(q or 0) for q in net_by_item.values()), default=0.0)
    return best if best > 1e-9 else None


async def staged_loads(db: AsyncSession, wos: Iterable[WorkOrder]) -> dict[str, float]:
    """`{wo id: staged substrate qty}` for the WOs that have lots staged.

    Netted 'Staging' ledger rows at each WO's input location -- the same rows the
    WO's staging panel totals (api/work_orders.py `_wo_staged_lots`), so a lot
    consumed by the step still counts toward the load it was.
    """
    input_loc = {str(w.id): w.input_location_id for w in wos if w.input_location_id}
    if not input_loc:
        return {}
    rows = await db.execute(
        select(StockLedger.reference_id, StockLedger.location_id, StockLedger.item_id, func.sum(StockLedger.qty_change))
        .where(
            StockLedger.reference_type == "Staging",
            StockLedger.reference_id.in_(list(input_loc)),
            StockLedger.batch_id.isnot(None),
        )
        .group_by(StockLedger.reference_id, StockLedger.location_id, StockLedger.item_id)
    )
    per_wo: dict[str, dict] = {}
    for wo_id, loc_id, item_id, net in rows.all():
        if loc_id == input_loc[wo_id]:
            per_wo.setdefault(wo_id, {})[item_id] = net
    loads = {wo_id: largest_staged(items) for wo_id, items in per_wo.items()}
    return {k: v for k, v in loads.items() if v is not None}
