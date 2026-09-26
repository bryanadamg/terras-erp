from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import joinedload, selectinload
from app.models.stock_ledger import StockLedger
from app.models.stock_balance import StockBalance
from app.models.attribute import AttributeValue
from app.models.item import Item
from fastapi import HTTPException

def _generate_variant_key(attribute_value_ids: list[str], color_id=None) -> str:
    """Standardizes variant identification string.

    Color-type finished goods carry no color attribute value — the shade lives in
    a separate `color_id`. To keep per-color FG stock in distinct balance rows,
    the color is folded in as a trailing ``c:<uuid>`` token (after the sorted
    attribute UUIDs, so it never collides with them and stays deterministic).
    """
    parts = sorted(str(uid) for uid in attribute_value_ids)
    if color_id:
        parts.append(f"c:{color_id}")
    return ",".join(parts)


def variant_matches(want_key: str, have_key: str) -> bool:
    """Does stock held under `have_key` satisfy a demand stated as `want_key`?

    Not string equality, deliberately. A packing order inherits its variant from
    an SO line, which can carry attribute values (material, a combo the floor
    never keyed stock under) that the produced lot's balance row does not — so an
    exact-key test would reject every real lot and leave the picker empty.

    The rule is: the colour must agree exactly (that is the distinction a hold
    desk actually turns on — two shades of one FG in one bin), and every
    attribute value the demand states must be present on the stock. An empty
    `want_key` states nothing and therefore matches anything.
    """
    if not want_key:
        return True
    want_attrs, want_color = _parse_variant_key(want_key)
    have_attrs, have_color = _parse_variant_key(have_key)
    if str(want_color or "") != str(have_color or ""):
        return False
    return set(str(a) for a in want_attrs) <= set(str(a) for a in have_attrs)


def _bom_size_label(snapshot: dict | None) -> str | None:
    """Human-readable label from a BOMSize snapshot dict (size_name/label/measurement)."""
    if not snapshot:
        return None
    parts = []
    size_name = snapshot.get("size_name") or (snapshot.get("size") or {}).get("name")
    if size_name:
        parts.append(size_name)
    if snapshot.get("label"):
        parts.append(snapshot["label"])
    if snapshot.get("target_measurement") is not None:
        meas = f"{float(snapshot['target_measurement'])}"
        if snapshot.get("measurement_min") is not None and snapshot.get("measurement_max") is not None:
            meas += f" ({float(snapshot['measurement_min'])}–{float(snapshot['measurement_max'])})"
        parts.append(meas + " cm")
    return " — ".join(parts) or None


def _parse_variant_key(variant_key: str):
    """Inverse of _generate_variant_key: split a stored key back into
    (attribute_value_ids, color_id). Used when re-posting stock derived from an
    existing balance row (e.g. batch/beam moves) so the color token survives."""
    import uuid as _uuid
    attr_ids: list = []
    color_id = None
    for tok in (variant_key or "").split(","):
        if not tok:
            continue
        if tok.startswith("c:"):
            color_id = tok[2:]
        else:
            attr_ids.append(_uuid.UUID(tok))
    return attr_ids, color_id

async def describe_variant_keys(db: AsyncSession, keys) -> dict:
    """Resolve stored `variant_key`s to the display identity of what they hold.

    The inverse of `_generate_variant_key` for humans: `{key: {variant_attributes,
    color_id, color_name, color_code, color_hex}}`, in the exact shape SO lines and
    lots already serve (`LotChips` on the frontend reads these field names), so a
    row identified only by its balance key labels itself like every other lot.

    Lives here rather than in a caller because the key's folding rules (sorted
    attribute UUIDs plus a trailing ``c:<uuid>`` colour token) are this module's,
    and a second hand-rolled parser is how a colour token ends up rendered as an
    attribute. One query per kind for the whole set — never per row.
    """
    from app.models.attribute import Attribute
    from app.models.color import Color

    parsed: dict = {}
    attr_ids: set = set()
    color_ids: set = set()
    for key in {k for k in keys if k}:
        ids, cid = _parse_variant_key(key)
        parsed[key] = (ids, cid)
        attr_ids.update(str(i) for i in ids)
        if cid:
            color_ids.add(str(cid))
    if not parsed:
        return {}

    attr_map: dict = {}
    if attr_ids:
        rows = (await db.execute(
            select(AttributeValue.id, Attribute.name, Attribute.system_role,
                   AttributeValue.value, AttributeValue.hex)
            .join(Attribute, Attribute.id == AttributeValue.attribute_id)
            .filter(AttributeValue.id.in_(attr_ids))
            .order_by(Attribute.name, AttributeValue.value)
        )).all()
        attr_map = {
            str(vid): {"name": name, "system_role": role, "value": value, "hex": hexv}
            for vid, name, role, value, hexv in rows
        }

    color_map: dict = {}
    if color_ids:
        rows = (await db.execute(
            select(Color.id, Color.code, Color.name, Color.hex, Color.customer_color_code)
            .filter(Color.id.in_(color_ids))
        )).all()
        color_map = {
            str(cid): {"color_id": cid, "color_code": cust or code, "color_name": name, "color_hex": hexv}
            for cid, code, name, hexv, cust in rows
        }

    out: dict = {}
    for key, (ids, cid) in parsed.items():
        info: dict = {
            "variant_attributes": [attr_map[str(i)] for i in ids if str(i) in attr_map],
            "color_id": None, "color_code": None, "color_name": None, "color_hex": None,
        }
        info.update(color_map.get(str(cid), {}) if cid else {})
        out[key] = info
    return out


async def batch_variant(db: AsyncSession, batch_id, location_id=None) -> tuple[list, str | None]:
    """The variant identity a lot's stock actually sits under, as
    ``(attribute_value_ids, color_id)`` ready to hand back to ``add_stock_entry``.

    A lot is NOT variant-less. A batched output (greige, dyed lot) is posted with
    its MO's attribute values alongside the batch, so per-color netting can still
    find it — only warp beams are keyed under an empty variant. So a later move of
    that lot (staging, consumption) must re-post under the SAME key: assuming an
    empty variant looks up a balance row that does not exist, and the negative-stock
    guard then reports "Insufficient stock. Current: 0.0" for a lot sitting in full
    view of the picker.

    Prefers the row at ``location_id`` and falls back to any row of the lot, so the
    identity survives a move into a location the lot has never been in.
    """
    base = select(StockBalance.variant_key).filter(StockBalance.batch_key == str(batch_id))
    if location_id is not None:
        key = (await db.execute(
            base.filter(StockBalance.location_id == location_id).order_by(StockBalance.qty.desc()).limit(1)
        )).scalar()
        if key is not None:
            return _parse_variant_key(key)
    key = (await db.execute(base.order_by(StockBalance.qty.desc()).limit(1))).scalar()
    return _parse_variant_key(key or "")


async def get_stock_balance(db: AsyncSession, item_id, location_id, attribute_value_ids: list[str] = [], batch_key: str = "", color_id=None):
    """
    PRE-CALCULATED O(1) LOOKUP:
    Retrieves the exact balance from the summary table instead of summing the ledger.
    When batch_key is empty, returns the total across all batches for non-batch stock.
    """
    v_key = _generate_variant_key(attribute_value_ids, color_id)
    if batch_key:
        result = await db.execute(select(StockBalance).filter(
            StockBalance.item_id == item_id,
            StockBalance.location_id == location_id,
            StockBalance.variant_key == v_key,
            StockBalance.batch_key == batch_key
        ))
        balance = result.scalars().first()
        return float(balance.qty) if balance else 0.0
    else:
        # Sum all balances (batch and non-batch) for availability checks
        result = await db.execute(
            select(func.sum(StockBalance.qty)).filter(
                StockBalance.item_id == item_id,
                StockBalance.location_id == location_id,
                StockBalance.variant_key == v_key,
            )
        )
        total = result.scalar()
        return float(total) if total else 0.0

async def add_stock_entry(
    db: AsyncSession,
    item_id,
    location_id,
    qty_change,
    reference_type,
    reference_id,
    attribute_value_ids: list[str] = [],
    batch_id=None,
    cones_change: int = 0,
    boxes_change: int = 0,
    drums_change: int = 0,
    color_id=None,
):
    batch_key = str(batch_id) if batch_id else ""
    cones_change = int(cones_change or 0)
    boxes_change = int(boxes_change or 0)
    drums_change = int(drums_change or 0)
    v_key = _generate_variant_key(attribute_value_ids, color_id)

    # 1. Lock the relevant balance row(s) FIRST, then apply the negative-stock guard
    # against the locked value. Locking before checking (rather than checking with an
    # unlocked read and locking only for the later update) closes the race where two
    # concurrent deductions both read a sufficient balance before either applies.
    #
    # Guard applies to base qty only — packaging counts are advisory tallies
    # (no UOM conversion) and may legitimately drift, so they never block.
    if qty_change < 0 and not batch_key:
        # Aggregate guard: a plain (non-batch) deduction is checked against the total
        # on-hand across all batch rows for this item/location/variant, but only the
        # batch_key="" row is actually updated below — lock every row in that set
        # before summing so the guard and the update share one consistent snapshot.
        locked_result = await db.execute(
            select(StockBalance)
            .filter(
                StockBalance.item_id == item_id,
                StockBalance.location_id == location_id,
                StockBalance.variant_key == v_key,
            )
            .with_for_update()
        )
        locked_rows = locked_result.scalars().all()
        current_balance = sum(float(r.qty) for r in locked_rows)
        if current_balance + qty_change < 0:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient stock. Current: {current_balance}, Required: {abs(qty_change)}"
            )
        balance = next((r for r in locked_rows if r.batch_key == ""), None)
    else:
        result = await db.execute(
            select(StockBalance)
            .filter(
                StockBalance.item_id == item_id,
                StockBalance.location_id == location_id,
                StockBalance.variant_key == v_key,
                StockBalance.batch_key == batch_key,
            )
            .with_for_update()
            .limit(1)
        )
        balance = result.scalars().first()
        if qty_change < 0:
            current_balance = float(balance.qty) if balance else 0.0
            if current_balance + qty_change < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Insufficient stock. Current: {current_balance}, Required: {abs(qty_change)}"
                )

    # 2. Create the Ledger Entry
    entry = StockLedger(
        item_id=item_id,
        location_id=location_id,
        qty_change=qty_change,
        reference_type=reference_type,
        reference_id=reference_id,
        batch_id=batch_id,
        color_id=color_id,
        qty_cones_change=cones_change or None,
        qty_boxes_change=boxes_change or None,
        qty_drums_change=drums_change or None,
    )

    if attribute_value_ids:
        result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(attribute_value_ids)))
        vals = result.scalars().all()
        entry.attribute_values = vals

    db.add(entry)

    # 3. ATOMIC SUMMARY UPDATE (balance row already locked above)
    if not balance:
        balance = StockBalance(
            item_id=item_id,
            location_id=location_id,
            variant_key=v_key,
            batch_key=batch_key,
            qty=qty_change,
            qty_cones=cones_change,
            qty_boxes=boxes_change,
            qty_drums=drums_change,
        )
        if attribute_value_ids:
            result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(attribute_value_ids)))
            vals = result.scalars().all()
            balance.attribute_values = vals
        db.add(balance)
    else:
        balance.qty = float(balance.qty) + float(qty_change)
        balance.qty_cones = int(balance.qty_cones or 0) + cones_change
        balance.qty_boxes = int(balance.qty_boxes or 0) + boxes_change
        balance.qty_drums = int(balance.qty_drums or 0) + drums_change

    # Flush (not commit): the session uses autoflush=False, so without this, a second
    # add_stock_entry call in the same request for a balance row this call just created
    # (e.g. two lines merging into the same new pool row) wouldn't see it via the
    # business-key SELECT above and would insert a duplicate StockBalance. Flushing
    # sends the INSERT/UPDATE within the open transaction — visible to the next call,
    # still rolled back together with everything else if the caller never commits.
    # Caller commits once at the end so multi-entry operations (transfers, WO
    # completions, staging, dispatch) apply atomically in one transaction.
    await db.flush()

async def relocate_batch_stock(db: AsyncSession, *, item_id, batch_id, location_id, reference_type: str, reference_id: str) -> float:
    """Move every on-hand row of one lot into ``location_id``, keeping the lot and
    its variant intact. Two-sided per source row (OUT at the old location, IN at
    the new one) so the balance table stays consistent — same shape as a stock
    transfer, but lot-scoped. Used to quarantine QC-rejected stock in a defect
    store (lot reject, WO-completion reject, packing reject). Returns qty moved.
    Caller commits."""
    rows = (await db.execute(
        select(StockBalance)
        .filter(StockBalance.batch_key == str(batch_id), StockBalance.qty > 0)
    )).scalars().all()
    moved = 0.0
    for r in rows:
        if str(r.location_id) == str(location_id):
            continue    # already in the defect store
        portion = float(r.qty)
        ids, cid = _parse_variant_key(r.variant_key)
        await add_stock_entry(
            db, item_id=item_id, location_id=r.location_id, qty_change=-portion,
            reference_type=reference_type, reference_id=reference_id,
            attribute_value_ids=ids, color_id=cid, batch_id=batch_id,
        )
        await add_stock_entry(
            db, item_id=item_id, location_id=location_id, qty_change=portion,
            reference_type=reference_type, reference_id=reference_id,
            attribute_value_ids=ids, color_id=cid, batch_id=batch_id,
        )
        moved += portion
    return moved


async def get_all_stock_balances(db: AsyncSession, user=None, item_ids: list | None = None):
    query = select(StockBalance)
    if item_ids:
        query = query.filter(StockBalance.item_id.in_(item_ids))

    # item/location are to-one (joinedload = single JOIN, no row multiplication).
    # attribute_values is a collection — joinedload would multiply rows by value count
    # and force a Python-side .unique() dedup. selectinload fetches them in one extra
    # IN query instead, avoiding the cartesian blow-up. Cheaper CPU/RAM on the ARM host.
    result = await db.execute(query.options(
        selectinload(StockBalance.attribute_values),
        joinedload(StockBalance.item).joinedload(Item.category),
        joinedload(StockBalance.location),
    ))
    results = result.scalars().all()

    # batch_key is a plain string (str(batch_id) or ""), not a FK — resolve labels
    # in one extra query instead of making the frontend page through /batches to
    # build its own map (that list is capped and drops older lots/beams from it).
    batch_ids = {r.batch_key for r in results if r.batch_key}
    batch_number_map: dict[str, str] = {}
    batch_size_label_map: dict[str, str] = {}
    # vendor_lot is only ever written when a lot is minted/matched at goods receipt
    # (api/purchase.py), so its presence alone identifies a supplier-received lot.
    batch_vendor_lot_map: dict[str, str] = {}
    # QC status rides along: a REJECTED lot stays physically in its location (only
    # dispose writes it off), so on-hand MUST surface the flag or the table shows
    # unusable stock as if it were good.
    batch_quality_map: dict[str, str] = {}
    # Operator note captured when the lot was produced (WO completion) — carried here
    # so on-hand shows the same remark as the bag label and the Lot table.
    batch_notes_map: dict[str, str] = {}
    # A beam lot's own ends overrides the item spec at birth (WorkOrder.ends) — same
    # fallback chain as work_orders.py's beam WO helpers.
    batch_ends_map: dict[str, int] = {}
    # Production origin: a lot minted by a WO completion carries source_wo_id, which
    # resolves WO -> MO. Goods-receipt (GR-) lots have no source WO and stay blank.
    batch_origin_map: dict[str, dict] = {}
    if batch_ids:
        import uuid as _uuid
        from app.models.batch import Batch
        valid_ids = []
        for bid in batch_ids:
            try:
                valid_ids.append(_uuid.UUID(bid))
            except ValueError:
                continue
        if valid_ids:
            batch_rows = await db.execute(
                select(
                    Batch.id, Batch.batch_number, Batch.bom_size_snapshot,
                    Batch.vendor_lot, Batch.quality_status, Batch.notes,
                    Batch.source_wo_id, Batch.ends,
                ).filter(Batch.id.in_(valid_ids))
            )
            wo_by_batch: dict = {}
            for bid, bnum, snapshot, vlot, qstatus, bnotes, src_wo, bends in batch_rows.all():
                batch_number_map[str(bid)] = bnum
                label = _bom_size_label(snapshot)
                if label:
                    batch_size_label_map[str(bid)] = label
                if vlot:
                    batch_vendor_lot_map[str(bid)] = vlot
                if qstatus and qstatus != "GOOD":
                    batch_quality_map[str(bid)] = qstatus
                if bnotes and bnotes.strip():
                    batch_notes_map[str(bid)] = bnotes.strip()
                if bends:
                    batch_ends_map[str(bid)] = bends
                if src_wo:
                    wo_by_batch[str(bid)] = src_wo

            # One grouped WO -> MO -> Color lookup for the whole page; no N+1. Color
            # is the MO's shade (Color Library, via MO.color_id) — same resolution
            # /batches/paginated uses (_resolve_batch_origins).
            if wo_by_batch:
                from app.models.work_order import WorkOrder
                from app.models.manufacturing import ManufacturingOrder, manufacturing_order_values
                from app.models.color import Color
                from app.models.attribute import Attribute, AttributeValue
                # A shade's hex can live in the Color Library row or, when that's
                # blank, the mirrored `Colors` variant attribute value the MO
                # carries — same fallback chain _resolve_batch_variants resolves
                # for /batches/paginated. Scalar subquery, not a join, so a colour
                # pick doesn't multiply rows via the MO<->attribute-value M2M.
                attr_color_hex = (
                    select(AttributeValue.hex)
                    .select_from(manufacturing_order_values)
                    .join(AttributeValue, AttributeValue.id == manufacturing_order_values.c.attribute_value_id)
                    .join(Attribute, Attribute.id == AttributeValue.attribute_id)
                    .where(
                        manufacturing_order_values.c.manufacturing_order_id == ManufacturingOrder.id,
                        Attribute.system_role == "color",
                    )
                    .limit(1)
                    .correlate(ManufacturingOrder)
                    .scalar_subquery()
                )
                mo_rows = await db.execute(
                    select(
                        WorkOrder.id, WorkOrder.code, ManufacturingOrder.id, ManufacturingOrder.code,
                        ManufacturingOrder.labdip_variant_code, Color.code, Color.name,
                        func.coalesce(Color.hex, attr_color_hex),
                    )
                    .join(ManufacturingOrder, ManufacturingOrder.id == WorkOrder.manufacturing_order_id)
                    .outerjoin(Color, Color.id == ManufacturingOrder.color_id)
                    .filter(WorkOrder.id.in_(set(wo_by_batch.values())))
                )
                by_wo = {
                    wo_id: {
                        "wo_code": wo_code, "mo_id": mo_id, "mo_code": mo_code,
                        "color_code": color_code, "color_name": color_name, "color_hex": color_hex,
                        "labdip_variant_code": labdip_code,
                    }
                    for wo_id, wo_code, mo_id, mo_code, labdip_code, color_code, color_name, color_hex in mo_rows.all()
                }
                for bid_str, wo_id in wo_by_batch.items():
                    info = by_wo.get(wo_id)
                    if info:
                        batch_origin_map[bid_str] = info

    return [
        {
            "item_id": r.item_id,
            "item_name": r.item.name if r.item else str(r.item_id),
            "item_code": r.item.code if r.item else str(r.item_id),
            "item_uom": r.item.uom if r.item else "",
            "item_ends": (batch_ends_map.get(r.batch_key) if r.batch_key else None) or (r.item.ends if r.item else None),
            "item_category_id": (r.item.category_id if r.item else None),
            "item_category_name": (r.item.category.name if r.item and r.item.category else None),
            "location_id": r.location_id,
            "location_name": r.location.name if r.location else str(r.location_id),
            "attribute_value_ids": [v.id for v in r.attribute_values],
            "qty": float(r.qty),
            "qty_cones": int(r.qty_cones or 0),
            "qty_boxes": int(r.qty_boxes or 0),
            "qty_drums": int(r.qty_drums or 0),
            "batch_key": r.batch_key,
            "batch_number": batch_number_map.get(r.batch_key) if r.batch_key else None,
            "vendor_lot": batch_vendor_lot_map.get(r.batch_key) if r.batch_key else None,
            "size_label": batch_size_label_map.get(r.batch_key) if r.batch_key else None,
            "batch_notes": batch_notes_map.get(r.batch_key) if r.batch_key else None,
            # GOOD unless the lot carries a QC flag; non-lotted rows are always GOOD.
            "quality_status": (batch_quality_map.get(r.batch_key, "GOOD") if r.batch_key else "GOOD"),
            "mo_id": (batch_origin_map.get(r.batch_key) or {}).get("mo_id") if r.batch_key else None,
            "mo_code": (batch_origin_map.get(r.batch_key) or {}).get("mo_code") if r.batch_key else None,
            "wo_code": (batch_origin_map.get(r.batch_key) or {}).get("wo_code") if r.batch_key else None,
            "color_code": (batch_origin_map.get(r.batch_key) or {}).get("color_code") if r.batch_key else None,
            "color_name": (batch_origin_map.get(r.batch_key) or {}).get("color_name") if r.batch_key else None,
            "color_hex": (batch_origin_map.get(r.batch_key) or {}).get("color_hex") if r.batch_key else None,
            "labdip_variant_code": (batch_origin_map.get(r.batch_key) or {}).get("labdip_variant_code") if r.batch_key else None,
        }
        for r in results
        if r.qty != 0 or r.qty_cones or r.qty_boxes or r.qty_drums
    ]
