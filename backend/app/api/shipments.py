"""Loading deck: stage picked goods, have a second person check them against the
printed Surat Jalan, then post goods issue.

This is the gate that used to be missing. Before it, `POST /pick-lists/{id}/dispatch`
took a pick list straight from PICKED to stock-out in one click by whoever was
editing it — the same person who picked it. Standard outbound practice separates
the three roles (pack / pick / load+check), and the checker's confirmation is the
only thing standing between a mis-picked pallet and a customer.

Flow: POST /shipments (stage) -> print Surat Jalan -> POST /{id}/verify (second
person) -> POST /{id}/dispatch (goods issue).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload
from typing import Optional
from datetime import datetime, timezone
import uuid

from app.db.session import get_async_db
from app.core.pagination import PageParams, PageWindow
from app.schemas import (
    ShipmentCreate, ShipmentUpdate, ShipmentVerifyPayload,
    ShipmentResponse, ShipmentListResponse, StageablePickListResponse,
    PickListCartonIdentity,
)
from app.models.shipment import Shipment
from app.models.pick_list import PickList, PickListLine
from app.models.sales import SalesOrder, SalesOrderLine
from app.api.auth import require_permission, require_any_permission, user_has_permission
from app.models.auth import User
from app.services import (
    audit_service, kpi_service, so_fulfilment_service, numbering_service, dispatch_service,
    stock_service,
)
from app.core.ws_manager import manager

router = APIRouter(prefix="/shipments", tags=["shipments"])

# A pick list is loadable only once the floor has finished with it.
STAGEABLE_PL_STATUS = "PICKED"
EDITABLE = ("DRAFT", "STAGED")


# --- helpers ---------------------------------------------------------------

def _naive(dt: Optional[datetime]) -> Optional[datetime]:
    """Coerce a client datetime to naive UTC.

    Every timestamp column here is `TIMESTAMP WITHOUT TIME ZONE` and the rest of
    the codebase writes `datetime.utcnow()`, so an offset-aware value from the
    browser (`new Date(...).toISOString()` -> `...Z`) makes asyncpg raise
    `DataError: can't subtract offset-naive and offset-aware datetimes` on insert.
    Normalise on the way in rather than trusting the client to send naive.
    """
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _load_options():
    # The Surat Jalan prints item + colour per line, and colour lives on the SO
    # line — same hop `api/pick_lists.py` makes, for the same reason.
    return (
        selectinload(Shipment.staged_by),
        selectinload(Shipment.verified_by),
        selectinload(Shipment.created_by),
        selectinload(Shipment.pick_lists).selectinload(PickList.sales_order),
        selectinload(Shipment.pick_lists).selectinload(PickList.lines).selectinload(PickListLine.item),
        selectinload(Shipment.pick_lists).selectinload(PickList.lines).selectinload(PickListLine.batch),
        selectinload(Shipment.pick_lists).selectinload(PickList.lines)
        .selectinload(PickListLine.sales_order_line).selectinload(SalesOrderLine.color),
        selectinload(Shipment.pick_lists).selectinload(PickList.lines)
        .selectinload(PickListLine.sales_order_line).selectinload(SalesOrderLine.attribute_values),
    )


async def _load(db: AsyncSession, shp_id) -> Optional[Shipment]:
    # expire_on_commit=False keeps stale collections in the identity map; membership
    # is rebuilt wholesale on edit, so expire before re-reading (same trap as
    # api/pick_lists.py and api/packing.py).
    db.expire_all()
    result = await db.execute(
        select(Shipment).options(*_load_options()).filter(Shipment.id == shp_id)
    )
    return result.scalars().first()


def _decorate_pick_list(pl: PickList) -> PickList:
    """Display fields the Surat Jalan needs, mirroring api/pick_lists._decorate."""
    if pl.sales_order:
        pl.sales_order_code = pl.sales_order.po_number
        pl.customer_po_ref = pl.sales_order.customer_po_ref
        pl.customer_name = pl.sales_order.customer_name
    cartons = 0
    total = 0.0
    for line in (pl.lines or []):
        sol = line.sales_order_line
        color = sol.color if sol else None
        line.color_name = color.name if color else None
        line.color_code = (color.customer_color_code or color.code) if color else None
        line.color_hex = color.hex if color else None
        line.attribute_value_ids = [v.id for v in (sol.attribute_values or [])] if sol else []
        total += float(line.qty_picked or 0)
        if line.batch is not None:
            # Size of the carton actually picked, stamped on it at packing.
            line.bom_size_snapshot = line.batch.bom_size_snapshot
            line.size_label = stock_service._bom_size_label(line.batch.bom_size_snapshot)
        if line.batch_id:
            cartons += 1
    pl.carton_count = cartons
    pl.total_qty = total
    return pl


async def _decorate_cartons(db: AsyncSession, shps: list[Shipment]) -> None:
    """Resolve what is physically IN each picked carton, for every line on every
    shipment passed, in two queries.

    Mirrors `api/pick_lists._decorate_all` — shade and combo are not columns on a
    Batch, they live only in the carton's StockBalance `variant_key`, so they
    cannot be read off the already-loaded tree. The deck check labels a carton
    exactly the way the pick list and the Kartu Packing do (`LotChips`), so the
    checker is matching the same chips they see everywhere else.

    No `qty > 0` filter: a dispatched carton's balance row sits at zero and a
    shipped shipment still has to be able to say what went out.
    """
    from app.models.stock_balance import StockBalance
    lines = [
        l for shp in shps for pl in (shp.pick_lists or [])
        for l in (pl.lines or []) if l.batch_id
    ]
    if not lines:
        return
    rows = (await db.execute(
        select(StockBalance.batch_key, StockBalance.variant_key)
        .filter(StockBalance.batch_key.in_([str(l.batch_id) for l in lines]))
    )).all()
    # A carton can hold rows at more than one location; they are the same box, so
    # any row with a key answers for it and an empty key never displaces one.
    key_by_batch: dict = {}
    for bk, vk in rows:
        if vk and not key_by_batch.get(bk):
            key_by_batch[bk] = vk
    variants = await stock_service.describe_variant_keys(db, set(key_by_batch.values()))
    for l in lines:
        vkey = key_by_batch.get(str(l.batch_id))
        v = variants.get(vkey) or {}
        b = l.batch
        l.carton_identity = PickListCartonIdentity(
            variant_key=vkey or None,
            variant_attributes=v.get("variant_attributes") or None,
            color_id=v.get("color_id"),
            color_name=v.get("color_name"),
            color_code=v.get("color_code"),
            color_hex=v.get("color_hex"),
            bom_size_id=b.bom_size_id if b is not None else None,
            bom_size_snapshot=b.bom_size_snapshot if b is not None else None,
            size_label=stock_service._bom_size_label(b.bom_size_snapshot) if b is not None else None,
        )


def _decorate(shp: Shipment) -> Shipment:
    # Written to *_name, never onto the relationship attributes — assigning a
    # string over a loaded User would dirty the instance and blow up the next flush.
    shp.staged_by_name = shp.staged_by.username if shp.staged_by else None
    shp.verified_by_name = shp.verified_by.username if shp.verified_by else None
    shp.created_by_name = shp.created_by.username if shp.created_by else None
    cartons = 0
    total = 0.0
    for pl in (shp.pick_lists or []):
        _decorate_pick_list(pl)
        cartons += pl.carton_count
        total += pl.total_qty
    shp.carton_count = cartons
    shp.total_qty = total
    return shp


async def _next_code(db: AsyncSession) -> str:
    async def _seed() -> int:
        last = (await db.execute(select(func.max(Shipment.code)))).scalar()
        if last and last.startswith("SHP-"):
            try:
                return int(last.split("-", 1)[1])
            except (ValueError, IndexError):
                return 0
        return 0

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(Shipment.id).filter(Shipment.code == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, "SHIPMENT", lambda n: f"SHP-{n:05d}", seed=_seed, exists=_taken,
    )
    return code


async def _next_delivery_note(db: AsyncSession, when: datetime) -> str:
    """Surat Jalan number in the client's paper format: `<seq> BIE<yymmdd>`.

    Their existing books run a plain running number, so the series is seeded from
    whatever the highest issued number is and the field stays editable — a house
    that resumes its old counter just types the first one and edits the series
    forward from there.
    """
    _, code = await numbering_service.allocate_code(
        db, "SURAT_JALAN", lambda n: f"{n:06d} BIE{when:%y%m%d}",
    )
    return code


async def _pick_list_rollup(db: AsyncSession, pl_ids: list[uuid.UUID]) -> dict:
    """(carton_count, total_qty, last_picked_at) per pick list, in one query."""
    if not pl_ids:
        return {}
    rows = (await db.execute(
        select(
            PickListLine.pick_list_id,
            func.count(PickListLine.batch_id),
            func.coalesce(func.sum(PickListLine.qty_picked), 0),
            func.max(PickListLine.picked_at),
        )
        .filter(PickListLine.pick_list_id.in_(pl_ids))
        .group_by(PickListLine.pick_list_id)
    )).all()
    return {str(pid): (int(c), float(q), at) for pid, c, q, at in rows}


async def _resolve_members(
    db: AsyncSession, pl_ids: list[uuid.UUID], shp: Optional[Shipment] = None
) -> list[PickList]:
    """Load and validate the pick lists being loaded onto a shipment.

    Every rule here is about not printing a delivery note that lies: only finished
    picks, only one customer per note, and never a pick list already promised to
    another truck.
    """
    if not pl_ids:
        raise HTTPException(status_code=400, detail="Select at least one pick list")

    result = await db.execute(
        select(PickList)
        .options(selectinload(PickList.sales_order), selectinload(PickList.lines))
        .filter(PickList.id.in_(pl_ids))
    )
    found = result.scalars().all()
    missing = set(str(i) for i in pl_ids) - {str(p.id) for p in found}
    if missing:
        raise HTTPException(status_code=404, detail=f"Pick list not found: {', '.join(sorted(missing))}")

    customers = set()
    for pl in found:
        if pl.status != STAGEABLE_PL_STATUS:
            raise HTTPException(
                status_code=400,
                detail=f"{pl.code} is {pl.status} — only {STAGEABLE_PL_STATUS} pick lists can be staged",
            )
        if not pl.qc_passed:
            raise HTTPException(status_code=400, detail=f"{pl.code} has not passed QC")
        if pl.shipment_id and (shp is None or pl.shipment_id != shp.id):
            raise HTTPException(status_code=400, detail=f"{pl.code} is already on another shipment")
        unconfirmed = [l for l in pl.lines if l.batch_id and not l.picked_at]
        if unconfirmed:
            raise HTTPException(
                status_code=400,
                detail=f"{pl.code}: {len(unconfirmed)} carton(s) not scanned by the picker",
            )
        customers.add((pl.sales_order.customer_name if pl.sales_order else None) or "")
    if len(customers) > 1:
        raise HTTPException(
            status_code=400,
            detail="One Surat Jalan addresses one customer — " + ", ".join(sorted(customers)),
        )
    return found


# --- endpoints -------------------------------------------------------------

@router.get("", response_model=ShipmentListResponse)
async def list_shipments(
    status: Optional[str] = None,
    search: Optional[str] = None,
    window: PageWindow = Depends(PageParams(default_size=20, max_size=200)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.view', 'sales.manage')),
):
    query = select(Shipment).options(*_load_options())
    count_q = select(func.count(Shipment.id))
    if status:
        query = query.filter(Shipment.status == status)
        count_q = count_q.filter(Shipment.status == status)
    if search:
        like = f"%{search.strip()}%"
        cond = or_(
            Shipment.code.ilike(like),
            Shipment.delivery_note_number.ilike(like),
            Shipment.customer_name.ilike(like),
            Shipment.vehicle_plate.ilike(like),
        )
        query = query.filter(cond)
        count_q = count_q.filter(cond)

    total = (await db.execute(count_q)).scalar() or 0
    query = window.apply(query.order_by(Shipment.created_at.desc()))
    rows = (await db.execute(query)).scalars().unique().all()
    await _decorate_cartons(db, list(rows))
    return window.envelope([_decorate(s) for s in rows], total)


@router.get("/stageable", response_model=list[StageablePickListResponse])
async def stageable_pick_lists(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.view', 'sales.manage')),
):
    """The loading-deck inbox: finished picks not yet on any shipment."""
    rows = (await db.execute(
        select(PickList)
        .options(selectinload(PickList.sales_order))
        .filter(PickList.status == STAGEABLE_PL_STATUS, PickList.shipment_id.is_(None))
        .order_by(PickList.created_at)
    )).scalars().unique().all()

    rollup = await _pick_list_rollup(db, [pl.id for pl in rows])
    out = []
    for pl in rows:
        cartons, qty, last_picked = rollup.get(str(pl.id), (0, 0.0, None))
        out.append({
            "id": pl.id,
            "code": pl.code,
            "sales_order_id": pl.sales_order_id,
            "sales_order_code": pl.sales_order.po_number if pl.sales_order else None,
            "customer_po_ref": pl.sales_order.customer_po_ref if pl.sales_order else None,
            "customer_name": pl.sales_order.customer_name if pl.sales_order else None,
            "qc_passed": pl.qc_passed,
            "carton_count": cartons,
            "total_qty": qty,
            "picked_at": last_picked,
        })
    return out


@router.get("/{shp_id}", response_model=ShipmentResponse)
async def get_shipment(
    shp_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.view', 'sales.manage')),
):
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.post("", response_model=ShipmentResponse)
async def create_shipment(
    payload: ShipmentCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.create', 'sales.manage')),
):
    """Stage picked goods on the loading deck and mint the Surat Jalan number."""
    members = await _resolve_members(db, payload.pick_list_ids)
    now = datetime.utcnow()
    delivery_date = _naive(payload.delivery_date) or now

    shp = Shipment(
        code=await _next_code(db),
        delivery_note_number=await _next_delivery_note(db, delivery_date),
        delivery_date=delivery_date,
        customer_name=(members[0].sales_order.customer_name if members[0].sales_order else None),
        carrier=payload.carrier,
        vehicle_plate=payload.vehicle_plate,
        driver=payload.driver,
        notes=payload.notes,
        status="STAGED",
        staged_at=now,
        staged_by_id=current_user.id,
        created_by_id=current_user.id,
    )
    db.add(shp)
    await db.flush()
    for pl in members:
        pl.shipment_id = shp.id
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CREATE", entity_type="Shipment",
        entity_id=str(shp.id),
        details=f"Staged shipment {shp.code} ({shp.delivery_note_number}) with {len(members)} pick list(s)",
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp.id)})
        await manager.broadcast({"type": "PICK_LIST_UPDATE"})
    except Exception:
        pass

    shp = await _load(db, shp.id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.put("/{shp_id}", response_model=ShipmentResponse)
async def update_shipment(
    shp_id: uuid.UUID,
    payload: ShipmentUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.edit', 'sales.manage')),
):
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status not in EDITABLE:
        # Editing after the check would invalidate the very thing that was checked.
        raise HTTPException(
            status_code=400,
            detail=f"Cannot edit a {shp.status} shipment — reopen it first" if shp.status == "VERIFIED"
            else f"Cannot edit a {shp.status} shipment",
        )

    # delivery_note_number is deliberately not in this list: the number is minted
    # once, at stage time, and nothing may overwrite it afterwards.
    for field in ("delivery_date", "carrier", "vehicle_plate", "driver", "notes"):
        val = getattr(payload, field)
        if val is not None:
            setattr(shp, field, _naive(val) if isinstance(val, datetime) else val)

    if payload.pick_list_ids is not None:
        members = await _resolve_members(db, payload.pick_list_ids, shp=shp) if payload.pick_list_ids else []
        keep = {str(pl.id) for pl in members}
        # Unload anything dropped — it returns to the stageable board, not the bin.
        for pl in list(shp.pick_lists):
            if str(pl.id) not in keep:
                pl.shipment_id = None
        for pl in members:
            pl.shipment_id = shp.id
        shp.customer_name = (members[0].sales_order.customer_name if members and members[0].sales_order else None)

    await db.commit()
    await audit_service.log_activity(
        db, user_id=current_user.id, action="UPDATE", entity_type="Shipment",
        entity_id=str(shp.id), details=f"Updated shipment {shp.code}",
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp_id)})
        await manager.broadcast({"type": "PICK_LIST_UPDATE"})
    except Exception:
        pass

    shp = await _load(db, shp_id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.post("/{shp_id}/verify", response_model=ShipmentResponse)
async def verify_shipment(
    shp_id: uuid.UUID,
    payload: ShipmentVerifyPayload,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('shipment.verify')),
):
    """The deck check: a second person counted the cartons against the printed
    Surat Jalan.

    `shipment.verify` is deliberately NOT satisfied by `sales.manage`. Every other
    endpoint here accepts the legacy blob code so existing planner roles keep
    working, but a control that anyone with sales.manage can satisfy is not a
    control. Same reason the staging user is blocked below: four eyes means two
    people, and the check exists precisely because the first pair already looked.
    Administrators (`admin.access`) are exempt from the staging-user block —
    they're trusted to self-verify when no second checker is available.
    """
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status != "STAGED":
        raise HTTPException(status_code=400, detail=f"Only a STAGED shipment can be verified (is {shp.status})")
    if not shp.pick_lists:
        raise HTTPException(status_code=400, detail="Nothing staged on this shipment")
    if (
        shp.staged_by_id
        and shp.staged_by_id == current_user.id
        and not user_has_permission(current_user, 'admin.access')
    ):
        raise HTTPException(
            status_code=400,
            detail="The person who staged this shipment cannot verify it — a second checker must confirm the load",
        )

    shp.status = "VERIFIED"
    shp.verified_at = datetime.utcnow()
    shp.verified_by_id = current_user.id
    shp.verification_notes = payload.notes
    shp.verified_with_discrepancy = bool(payload.with_discrepancy)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="VERIFY", entity_type="Shipment",
        entity_id=str(shp_id),
        details=f"Verified shipment {shp.code}"
                + (" with discrepancy" if payload.with_discrepancy else ""),
        changes={"notes": payload.notes} if payload.notes else None,
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp_id)})
    except Exception:
        pass

    shp = await _load(db, shp_id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.post("/{shp_id}/reopen", response_model=ShipmentResponse)
async def reopen_shipment(
    shp_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.edit', 'sales.manage')),
):
    """Undo a verification so the load can be corrected. Clears the check outright
    rather than keeping it — a stale tick on changed contents is worse than none."""
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status != "VERIFIED":
        raise HTTPException(status_code=400, detail=f"Only a VERIFIED shipment can be reopened (is {shp.status})")

    shp.status = "STAGED"
    shp.verified_at = None
    shp.verified_by_id = None
    shp.verification_notes = None
    shp.verified_with_discrepancy = False
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="REOPEN", entity_type="Shipment",
        entity_id=str(shp_id), details=f"Reopened shipment {shp.code} for correction",
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp_id)})
    except Exception:
        pass

    shp = await _load(db, shp_id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.post("/{shp_id}/dispatch", response_model=ShipmentResponse)
async def dispatch_shipment(
    shp_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.dispatch', 'sales.manage')),
):
    """Goods issue. Deducts finished-goods stock for every member pick list and
    flips their sales orders to SENT/PARTIAL."""
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status == "DISPATCHED":
        raise HTTPException(status_code=400, detail="Shipment already dispatched")
    if shp.status != "VERIFIED":
        raise HTTPException(
            status_code=400,
            detail="Shipment must be verified at the loading deck before dispatch",
        )

    pl_ids = [pl.id for pl in shp.pick_lists]
    if not pl_ids:
        raise HTTPException(status_code=400, detail="Nothing staged on this shipment")

    # Validate and pre-check every pick list before ANY of them moves stock — a
    # half-issued truck is not recoverable from the UI.
    loaded = []
    shortages: list[str] = []
    for pl_id in pl_ids:
        pl = await dispatch_service.load_for_issue(db, pl_id)
        lines = dispatch_service.assert_issuable(pl)
        shortages += await dispatch_service.check_availability(db, pl, lines)
        loaded.append((pl, lines))
    if shortages:
        raise HTTPException(status_code=400, detail="Insufficient stock — " + "; ".join(shortages))

    for pl, lines in loaded:
        await dispatch_service.issue_stock(db, pl, lines)

    # Draw down the stock this order had reserved against on-hand FG (netted away
    # at PR creation, so it never had an MO). Goods issue is the only point that
    # stock actually leaves, so releasing here — not at packing — is what keeps
    # on-hand and the reservation from being subtracted twice. Sessions are
    # expire_on_commit=False, so the instances issue_stock committed over are
    # still usable. Committed with everything else below.
    released_qty = 0.0
    for pl, lines in loaded:
        released_qty += await dispatch_service.release_reservations(db, pl, lines)

    # Stock writes commit internally, so everything below re-reads.
    now = datetime.utcnow()
    so_ids = set()
    for pl_id in pl_ids:
        pl = (await db.execute(select(PickList).filter(PickList.id == pl_id))).scalars().first()
        dispatch_service.mark_dispatched(pl, now)
        so_ids.add(pl.sales_order_id)
    shp = (await db.execute(select(Shipment).filter(Shipment.id == shp_id))).scalars().first()
    shp.status = "DISPATCHED"
    shp.dispatched_at = now
    if not shp.delivery_date:
        shp.delivery_date = now
    code = shp.code
    await db.commit()

    # Recompute SO fulfilment: SENT when every line fully shipped, PARTIAL when
    # some (but not all) shipped. Leaves terminal/edited states untouched.
    touched = False
    for so_id in so_ids:
        if await so_fulfilment_service.recompute_so_status(db, so_id):
            touched = True
    if touched:
        await db.commit()
        for so_id in so_ids:
            try:
                await manager.broadcast({"type": "SALES_ORDER_UPDATE", "id": str(so_id)})
            except Exception:
                pass

    await audit_service.log_activity(
        db, user_id=current_user.id, action="DISPATCH", entity_type="Shipment",
        entity_id=str(shp_id),
        details=(
            f"Dispatched shipment {code} ({len(pl_ids)} pick list(s))"
            + (f", released {released_qty:g} of reserved stock" if released_qty else "")
        ),
    )
    try:
        await kpi_service.invalidate_kpis_async(db)
        await manager.broadcast({"type": "KPI_UPDATE"})
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp_id)})
        await manager.broadcast({"type": "PICK_LIST_UPDATE"})
    except Exception:
        pass

    shp = await _load(db, shp_id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.post("/{shp_id}/cancel", response_model=ShipmentResponse)
async def cancel_shipment(
    shp_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.edit', 'sales.manage')),
):
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status == "DISPATCHED":
        raise HTTPException(status_code=400, detail="Cannot cancel a dispatched shipment")

    shp.status = "CANCELLED"
    for pl in list(shp.pick_lists):
        pl.shipment_id = None
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="CANCEL", entity_type="Shipment",
        entity_id=str(shp_id), details=f"Cancelled shipment {shp.code}; pick lists returned to the deck",
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE", "id": str(shp_id)})
        await manager.broadcast({"type": "PICK_LIST_UPDATE"})
    except Exception:
        pass

    shp = await _load(db, shp_id)
    await _decorate_cartons(db, [shp])
    return _decorate(shp)


@router.delete("/{shp_id}")
async def delete_shipment(
    shp_id: uuid.UUID,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission('shipment.delete', 'sales.manage')),
):
    shp = await _load(db, shp_id)
    if not shp:
        raise HTTPException(status_code=404, detail="Shipment not found")
    if shp.status == "DISPATCHED":
        raise HTTPException(status_code=400, detail="Cannot delete a dispatched shipment")

    code = shp.code
    for pl in list(shp.pick_lists):
        pl.shipment_id = None
    await db.flush()
    await db.delete(shp)
    await db.commit()

    await audit_service.log_activity(
        db, user_id=current_user.id, action="DELETE", entity_type="Shipment",
        entity_id=str(shp_id), details=f"Deleted shipment {code}",
    )
    try:
        await manager.broadcast({"type": "SHIPMENT_UPDATE"})
        await manager.broadcast({"type": "PICK_LIST_UPDATE"})
    except Exception:
        pass
    return {"ok": True, "deleted": code}
