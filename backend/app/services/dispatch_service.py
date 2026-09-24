"""Goods issue for outbound pick lists.

Lifted out of `POST /pick-lists/{id}/dispatch` when the loading-deck gate was
added: the stock-out half is now driven from `api/shipments.py` (after a second
person has checked the cartons against the printed Surat Jalan), and the pick
list itself no longer dispatches. Keeping the deduction here rather than inlining
it in the shipment router means the pre-flight checks and the ledger writes stay
one unit — the shipment endpoint validates every member pick list before any of
them move stock.
"""
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.pick_list import PickList, PickListLine
from app.models.reservation import StockReservation
from app.models.sales import SalesOrder, SalesOrderLine
from app.services import stock_service
from app.services.stock_service import _generate_variant_key


async def load_for_issue(db: AsyncSession, pl_id: uuid.UUID) -> Optional[PickList]:
    """A pick list with everything goods issue needs: lines + the SO lines whose
    variant/colour decide which stock pool each line deducts from."""
    result = await db.execute(
        select(PickList)
        .options(
            selectinload(PickList.lines).selectinload(PickListLine.item),
            selectinload(PickList.sales_order)
            .selectinload(SalesOrder.lines).selectinload(SalesOrderLine.attribute_values),
        )
        .filter(PickList.id == pl_id)
    )
    return result.scalars().first()


def assert_issuable(pl: PickList) -> list[PickListLine]:
    """Everything that must hold before a pick list can leave the building.

    Raises HTTPException; returns the lines that will actually move stock. Split
    from the deduction so a shipment can validate all its pick lists up front and
    fail before any of them has written a ledger row.
    """
    if pl.status in ("DISPATCHED", "CANCELLED"):
        raise HTTPException(status_code=400, detail=f"Pick list {pl.code} already {pl.status}")
    if not pl.qc_passed:
        raise HTTPException(status_code=400, detail=f"QC must pass on {pl.code} before dispatch")

    pick_lines = [l for l in pl.lines if float(l.qty_picked or 0) > 0]
    if not pick_lines:
        raise HTTPException(status_code=400, detail=f"Nothing to dispatch on {pl.code} (no picked quantities)")

    unconfirmed = [l for l in pick_lines if l.batch_id and not l.picked_at]
    if unconfirmed:
        raise HTTPException(
            status_code=400,
            detail=f"{pl.code}: {len(unconfirmed)} carton(s) not yet scanned — confirm every carton before dispatch",
        )
    for l in pick_lines:
        if not (l.source_location_id or pl.source_location_id):
            raise HTTPException(status_code=400, detail=f"{pl.code}: no source location set for one or more lines")
    return pick_lines


def _variant_maps(pl: PickList) -> tuple[dict, dict]:
    sol_attrs = {str(sl.id): [str(v.id) for v in sl.attribute_values] for sl in pl.sales_order.lines}
    # Color-type FG stock is tagged with color_id (folded into variant_key), so
    # dispatch must net/deduct against the same color to hit the right pool.
    sol_colors = {str(sl.id): sl.color_id for sl in pl.sales_order.lines}
    return sol_attrs, sol_colors


async def check_availability(db: AsyncSession, pl: PickList, pick_lines: list[PickListLine]) -> list[str]:
    """Shortage messages for `pl`, empty when every line can be deducted."""
    sol_attrs, sol_colors = _variant_maps(pl)
    shortages: list[str] = []
    for l in pick_lines:
        src = l.source_location_id or pl.source_location_id
        attr_ids = sol_attrs.get(str(l.sales_order_line_id), [])
        color_id = sol_colors.get(str(l.sales_order_line_id))
        batch_key = str(l.batch_id) if l.batch_id else ""
        bal = await stock_service.get_stock_balance(db, l.item_id, src, attr_ids, batch_key, color_id=color_id)
        if bal + (-float(l.qty_picked)) < 0:
            shortages.append(f"{pl.code} / {(l.item.name if l.item else l.item_id)}: have {bal}, need {float(l.qty_picked)}")
    return shortages


async def issue_stock(db: AsyncSession, pl: PickList, pick_lines: list[PickListLine]) -> None:
    """Deduct finished goods. `add_stock_entry` only flushes — the caller commits
    once, so every line of every pick list on a shipment goes out in one
    transaction or none of it does."""
    sol_attrs, sol_colors = _variant_maps(pl)
    for l in pick_lines:
        src = l.source_location_id or pl.source_location_id
        await stock_service.add_stock_entry(
            db,
            item_id=l.item_id,
            location_id=src,
            qty_change=-float(l.qty_picked),
            reference_type="PICKING",
            reference_id=pl.code,
            attribute_value_ids=sol_attrs.get(str(l.sales_order_line_id), []),
            color_id=sol_colors.get(str(l.sales_order_line_id)),
            batch_id=l.batch_id,
        )


async def release_reservations(db: AsyncSession, pl: PickList, pick_lines: list[PickListLine]) -> float:
    """Draw down this SO's stock reservations by what just left the building.

    Goods issue is the ONLY point the reserved stock physically goes away —
    packing merely converts bulk into cartons of the same item, so on-hand is
    unchanged there. Releasing any earlier would double-count (stock still
    present AND no longer reserved); releasing never would double-count the other
    way once the order ships partially, because on-hand drops while the full
    reservation keeps standing.

    Matched on (sales order, item, variant_key) — the reservation's own grain.
    Drawn down oldest-first; a row is marked RELEASED once it is exhausted.
    Returns the total qty released, for the caller's audit line.
    """
    sol_attrs, sol_colors = _variant_maps(pl)

    shipped: dict[tuple, float] = {}
    for l in pick_lines:
        vkey = _generate_variant_key(
            sol_attrs.get(str(l.sales_order_line_id), []),
            sol_colors.get(str(l.sales_order_line_id)),
        )
        key = (str(l.item_id), vkey)
        shipped[key] = shipped.get(key, 0.0) + float(l.qty_picked or 0)
    if not shipped:
        return 0.0

    rows = (await db.execute(
        select(StockReservation)
        .where(
            StockReservation.sales_order_id == pl.sales_order_id,
            StockReservation.status == "ACTIVE",
        )
        .order_by(StockReservation.created_at)
    )).scalars().all()

    now = datetime.utcnow()
    total = 0.0
    for r in rows:
        remaining_ship = shipped.get((str(r.item_id), r.variant_key or ""), 0.0)
        if remaining_ship <= 0:
            continue
        held = float(r.qty or 0) - float(r.qty_released or 0)
        if held <= 0:
            r.status = "RELEASED"
            r.released_at = r.released_at or now
            continue
        take = min(held, remaining_ship)
        r.qty_released = float(r.qty_released or 0) + take
        shipped[(str(r.item_id), r.variant_key or "")] = remaining_ship - take
        total += take
        if float(r.qty or 0) - float(r.qty_released or 0) <= 1e-6:
            r.status = "RELEASED"
            r.released_at = now
    return total


def mark_dispatched(pl: PickList, when: datetime) -> None:
    pl.status = "DISPATCHED"
    pl.dispatched_at = when
