import re
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload

from app.models.bom import BOM, BOMLine, BOMOperation, BOMSize
from app.models.item import Item
from app.models.attribute import Attribute, AttributeValue
from app.models.manufacturing import ManufacturingOrder, MODependency, MOPlannedComponent
from app.services import beam_service, numbering_service

# ManufacturingOrder.code is String(128). MO codes are composed (from a PR code and
# line, or from the item name), never sequential, so every minting site clamps
# against this rather than trusting the inputs to be short. Single source of truth:
# api/production_runs.py imports it from here.
MO_CODE_MAX_LEN = 128


def _line_decoupled(line, item_flag) -> bool:
    """Effective MRP decoupling policy for a BOM line: the per-line override wins
    (True/False), else inherit the item-master default. When true, explosion
    records demand but never auto-creates a sub-MO for the line's item."""
    line_flag = getattr(line, "is_decoupling_point", None)
    return bool(line_flag) if line_flag is not None else bool(item_flag)


async def _combo_attr_id(db: AsyncSession):
    """Id of the seeded Combo variant attribute (system_role='combo'), or None."""
    return (await db.execute(
        select(Attribute.id).filter(Attribute.system_role == "combo")
    )).scalar()


def _line_combo_value_ids(line, combo_attr_id) -> list[str]:
    """Combo attribute value(s) tagged on a BOM line, sorted. Combo assigned on the
    parent→component line in the BOM designer is the driver that pegs each combo
    variant of a component to its own consolidated MO (mirrors size split).
    Empty for color/plain lines (they carry no combo) → those still pool.

    Combo-agnosticism is a property of the BOM, never of the item: a greige item
    whose combo is woven in carries a combo value on the line and gets a per-combo
    recipe, while the same item under a color tree carries none and pools. Do not
    reintroduce an Item.variant_type gate here — that field is FG-only, so it made
    every sub-assembly combo-agnostic by construction."""
    if not combo_attr_id:
        return []
    return sorted(
        str(v.id) for v in getattr(line, "attribute_values", [])
        if v.attribute_id == combo_attr_id
    )


def _bom_combo_value_ids(bom, combo_attr_id) -> list[str]:
    """Combo attribute value(s) carried by a BOM itself, sorted."""
    if not combo_attr_id or bom is None:
        return []
    return sorted(
        str(v.id) for v in getattr(bom, "attribute_values", [])
        if v.attribute_id == combo_attr_id
    )


def _effective_combo(line_combo, sub_bom, combo_attr_id) -> list[str]:
    """The combo that actually varies a component — the line tag intersected with
    what the *resolved* sub-BOM carries.

    `active_sub_bom` falls back to the combo-less shared recipe when the component
    owns no per-combo BOM, and the BOM designer force-inherits the parent's combo
    onto every descendant line whether or not that item is combo-differentiated.
    Trusting the line tag alone therefore split a combo-agnostic component (e.g. a
    shared beam cover) into one MO per parent combo, each stamped with a combo its
    own recipe never had. Combo-agnosticism is a property of the BOM, never of the
    line or the item — so when the resolved recipe is combo-less, the component
    pools and carries no combo."""
    if not line_combo:
        return []
    return list(line_combo) if _bom_combo_value_ids(sub_bom, combo_attr_id) == list(line_combo) else []


async def active_sub_bom(
    db: AsyncSession, item_id, combo_value_ids=(), combo_attr_id=None,
    with_sizes: bool = False, with_item: bool = False,
):
    """The active BOM to explode for a component, picked by combo.

    An item may own several active BOMs — one per combo (greige woven in RED vs
    BLUE) plus, possibly, a combo-less one shared across every variant. Match the
    line's combo first; fall back to the combo-less recipe; last resort, any.
    Selecting on item_id alone would pick an arbitrary combo's recipe."""
    opts = [selectinload(BOM.attribute_values)]
    if with_sizes:
        opts.append(selectinload(BOM.sizes))
    if with_item:
        opts.append(joinedload(BOM.item))
    candidates = (await db.execute(
        select(BOM).options(*opts)
        .filter(BOM.item_id == item_id, BOM.active == True)  # noqa: E712
        .order_by(BOM.created_at.asc())
    )).unique().scalars().all()
    if not candidates:
        return None
    want = {str(x) for x in (combo_value_ids or [])}
    if combo_attr_id is None:
        combo_attr_id = await _combo_attr_id(db)

    def combo_of(bom) -> set:
        if not combo_attr_id:
            return set()
        return {str(v.id) for v in bom.attribute_values if v.attribute_id == combo_attr_id}

    if want:
        for bom in candidates:
            if combo_of(bom) == want:
                return bom
    for bom in candidates:
        if not combo_of(bom):
            return bom
    return candidates[0]


async def snapshot_bom_lines(db: AsyncSession, mo: ManufacturingOrder, bom: BOM):
    """Snapshot BOM lines into MOPlannedComponent rows at MO creation time."""
    for line in bom.lines:
        attr_ids = [str(v.id) for v in line.attribute_values]
        db.add(MOPlannedComponent(
            mo_id=mo.id,
            item_id=line.item_id,
            percentage=line.percentage,
            qty=line.qty,
            source_location_id=line.source_location_id,
            bom_line_id=line.id,
            bom_operation_id=line.bom_operation_id,
            attribute_value_ids=attr_ids,
        ))


async def bom_size_snapshot(db: AsyncSession, bom_size_id) -> Optional[dict]:
    """The BOM size spec an MO freezes at creation (see `stock_service.fill_size_snapshot_gaps`)."""
    bom_sz = (await db.execute(
        select(BOMSize).options(joinedload(BOMSize.size)).filter(BOMSize.id == bom_size_id)
    )).unique().scalars().first()
    if not bom_sz:
        return None
    f = lambda v: float(v) if v is not None else None
    return {
        "size_name": bom_sz.size.name if bom_sz.size else None,
        "label": bom_sz.label,
        "target_measurement": f(bom_sz.target_measurement),
        "measurement_min": f(bom_sz.measurement_min),
        "measurement_max": f(bom_sz.measurement_max),
    }


async def create_mo_recursive(
    db: AsyncSession,
    bom_id: uuid.UUID,
    qty: float,
    location_id: uuid.UUID,
    user_id: uuid.UUID,
    parent_mo_id: Optional[uuid.UUID] = None,
    source_location_id: Optional[uuid.UUID] = None,
    sales_order_id: Optional[uuid.UUID] = None,
    production_run_id: Optional[uuid.UUID] = None,
    target_start_date: Optional[datetime] = None,
    target_end_date: Optional[datetime] = None,
    bom_size_id: Optional[uuid.UUID] = None,
    create_children: bool = True,
    availability=None,
    extra_attr_value_ids: Optional[list] = None,
    combo_attr_id=None,
) -> ManufacturingOrder:
    """Recursively creates manufacturing orders for sub-assemblies.
    Pass create_children=False to create only the root MO (used in two-pass PR creation).

    When ``availability`` (a netting_service.Availability ledger) is supplied,
    each sub-assembly's gross requirement is netted against net-free stock before
    its MO is created: fully-covered children are skipped (no MO, no sub-tree),
    partially-covered children are resized to the shortfall. The root MO itself
    is never netted — only its children/descendants."""
    # 1. Fetch BOM with lines and operations
    result = await db.execute(
        select(BOM)
        .options(
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(BOM.attribute_values),
            selectinload(BOM.operations).joinedload(BOMOperation.work_center),
        )
        .filter(BOM.id == bom_id)
    )
    bom = result.scalars().first()
    if not bom:
        raise ValueError(f"BOM {bom_id} not found")

    if combo_attr_id is None:
        combo_attr_id = await _combo_attr_id(db)

    # 2. Generate a meaningful code based on the BOM's item name (MO-{ITEM_NAME}-001)
    item_result = await db.execute(select(Item).filter(Item.id == bom.item_id))
    item = item_result.scalars().first()
    raw_name = item.name if item else str(bom.item_id)[:8]
    safe_name = re.sub(r'[^A-Za-z0-9\-]', '-', raw_name).strip('-')
    # "MO-" + name + "-00000" must fit MO.code or the INSERT dies with
    # StringDataRightTruncation and takes the whole MRP explosion with it.
    base = f"MO-{safe_name[:MO_CODE_MAX_LEN - len('MO-') - len('-00000')]}"

    async def _seed() -> int:
        """Highest number already issued under this base, for installs whose codes
        predate the number range. Runs once per series, not per MO."""
        codes = (await db.execute(
            select(ManufacturingOrder.code).filter(ManufacturingOrder.code.like(f"{base}-%"))
        )).scalars().all()
        return max((int(m.group(1)) for m in (re.fullmatch(rf"{re.escape(base)}-(\d+)", c or "") for c in codes) if m), default=0)

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(ManufacturingOrder.id).filter(ManufacturingOrder.code == code).limit(1)
        )).scalars().first() is not None

    _, mo_code = await numbering_service.allocate_code(
        db, f"MO:{base}", lambda n: f"{base}-{n:05d}", seed=_seed, exists=_taken,
    )

    # 3. Create this MO (bom_size_id only applies to the root MO, not sub-assemblies)
    mo = ManufacturingOrder(
        code=mo_code,
        bom_id=bom.id,
        item_id=bom.item_id,
        location_id=location_id,
        # MO source defaults to the item-master default issue location when no
        # explicit source is passed (industry chain; staging can still override).
        source_location_id=source_location_id or (item.default_source_location_id if item else None),
        sales_order_id=sales_order_id,
        production_run_id=production_run_id,
        parent_mo_id=parent_mo_id,
        bom_size_id=bom_size_id if parent_mo_id is None else None,
        qty=qty,
        target_start_date=target_start_date,
        target_end_date=target_end_date,
        # Snapshot the BOM's output tolerance so later BOM edits can't retro-change
        # what an in-flight order is allowed to log. Beams are planned in pcs against
        # loom demand (kg per beam varies with the yarn) so they carry no kg ceiling.
        overdelivery_tolerance_pct=float(bom.overdelivery_tolerance_percentage or 0),
        allow_unlimited_overdelivery=bool(
            await beam_service.beam_item_ids(db, [bom.item_id])
        ),
        status="PENDING"
    )
    # Base variant = the BOM's own attribute values, plus any extra values passed
    # by the caller (the combo tag from the parent→component line — see Pass 2 and
    # the children loop below). Dedup so the variant_key stays deterministic.
    attr_vals = list(bom.attribute_values)
    if extra_attr_value_ids:
        have = {str(v.id) for v in attr_vals}
        want = [str(x) for x in extra_attr_value_ids if str(x) not in have]
        if want:
            extra_objs = (await db.execute(
                select(AttributeValue).filter(AttributeValue.id.in_(want))
            )).scalars().all()
            attr_vals = attr_vals + list(extra_objs)
    mo.attribute_values = attr_vals
    db.add(mo)
    await db.flush()

    # Snapshot BOM size spec at creation time
    if bom_size_id and parent_mo_id is None:
        mo.bom_size_snapshot = await bom_size_snapshot(db, bom_size_id)

    # Snapshot BOM lines at creation time so future BOM edits don't affect this MO
    await snapshot_bom_lines(db, mo, bom)

    # 4. Look for sub-BOMs in lines — only active BOMs, percentage-based qty
    if create_children:
        for line in bom.lines:
            if not line.percentage:
                continue  # 0% or null = not needed
            # Decoupling point (make-to-stock component): don't auto-create its MO
            # or explode its sub-tree. The parent's MOPlannedComponent snapshot
            # (above) already records the demand for netting/booking-stock; the
            # item is replenished independently on a pooled standalone MO.
            item_decouple = (await db.execute(
                select(Item.is_decoupling_point).filter(Item.id == line.item_id)
            )).scalar()
            if _line_decoupled(line, item_decouple):
                continue
            # Combo tagged on this line pegs/varies the component per combo
            # (mirrors size). Folded into the produced item's variant so its
            # netting supply key matches the combo-specific demand, and used to
            # pick the component's own per-combo recipe.
            line_combo = _line_combo_value_ids(line, combo_attr_id)
            sub_bom = await active_sub_bom(db, line.item_id, line_combo, combo_attr_id)
            # Drop the tag when the resolved recipe is combo-less (shared component).
            line_combo = _effective_combo(line_combo, sub_bom, combo_attr_id)

            if sub_bom:
                sub_qty = (qty * float(line.percentage)) / 100
                if availability is not None:
                    # Net this sub-assembly against net-free stock at the planned
                    # source location, using the produced item's own variant.
                    sub_attrs = sorted(set(
                        [str(v.id) for v in sub_bom.attribute_values] + line_combo
                    ))
                    sub_loc = source_location_id or location_id
                    sub_qty = await availability.consume(sub_bom.item_id, sub_attrs, sub_loc, sub_qty)
                    if sub_qty <= 0:
                        continue  # covered by stock -> skip MO and its sub-tree
                await create_mo_recursive(
                    db,
                    sub_bom.id,
                    sub_qty,
                    location_id,
                    user_id,
                    parent_mo_id=mo.id,
                    source_location_id=source_location_id,
                    sales_order_id=sales_order_id,
                    production_run_id=production_run_id,
                    target_start_date=target_start_date,
                    target_end_date=target_end_date,
                    availability=availability,
                    extra_attr_value_ids=line_combo,
                    combo_attr_id=combo_attr_id,
                )

    return mo


async def create_consolidated_component_mos(
    db: AsyncSession,
    root_mos: list,
    location,
    source_location,
    sales_order_id,
    production_run_id,
    target_start_date,
    target_end_date,
    user_id,
    availability=None,
):
    """Pass 2 of PR creation: low-level-code style breadth-first MRP explosion.
    Processes one generation (level) of parent MOs at a time. At each level,
    aggregates component demand across ALL parent MOs from that level — regardless
    of which root/branch they came from — into ONE consolidated component MO per
    unique sub-assembly (keyed on item_id + sub_bom_id + size_key), pegs it to its
    parents via MODependency, then treats the new component MOs as the next
    generation and repeats. This is what lets a shared component (e.g. a greige
    base, or a further sub-component below it) net once across every branch that
    needs it, at every depth — not just at the first level below the roots.

    When ``availability`` is supplied, each consolidated demand is netted against
    net-free stock first: a component fully covered by stock gets no MO (and no
    further explosion); a partially-covered one is resized to the shortfall and
    its pegging qty is scaled down proportionally."""

    current_gen = list(root_mos)
    combo_attr_id = await _combo_attr_id(db)

    while current_gen:
        # Preload the BOMSize rows this generation's MOs carry, so each parent's
        # size identity can be mapped onto its sub-BOM's own size rows (matched by
        # shared Size master, else by label).
        bs_ids = {mo.bom_size_id for mo in current_gen if mo.bom_size_id}
        bs_by_id: dict = {}
        if bs_ids:
            rows = await db.execute(select(BOMSize).filter(BOMSize.id.in_(bs_ids)))
            bs_by_id = {bs.id: bs for bs in rows.scalars().all()}

        # Cache each distinct BOM used by this generation (mo.bom_id), with lines.
        bom_ids = {mo.bom_id for mo in current_gen}
        boms_by_id: dict = {}
        for bom_id in bom_ids:
            bom_result = await db.execute(
                select(BOM).options(
                    selectinload(BOM.lines).selectinload(BOMLine.attribute_values)
                ).filter(BOM.id == bom_id)
            )
            b = bom_result.scalars().first()
            if b:
                boms_by_id[bom_id] = b

        # Aggregate demand keyed on (item_id, sub_bom_id, size_key).
        #   size_key = None  -> pool across all parents (unsized/free sub-BOM, or
        #                       size unresolved) — the color-variant greige case.
        #   size_key = <sub-BOM's own BOMSize id> -> split: one component MO per
        #                       size, so a sized sub-assembly (L=68cm vs M=64cm) is
        #                       never merged across sizes.
        demand: dict[tuple, dict] = {}

        for mo in current_gen:
            bom = boms_by_id.get(mo.bom_id)
            if not bom:
                continue

            for line in bom.lines:
                if not line.percentage:
                    continue
                # Combo tagged on this line pegs each combo variant of a component
                # to its own consolidated MO (mirrors size_key) and selects that
                # component's per-combo recipe. Empty for color/plain lines → the
                # combo-less shared recipe, one pooled MO across every parent.
                line_combo = _line_combo_value_ids(line, combo_attr_id)
                sub_bom = await active_sub_bom(db, line.item_id, line_combo, combo_attr_id, with_sizes=True)
                if not sub_bom:
                    continue
                # A combo-less resolved recipe = combo-agnostic shared component:
                # strip the inherited line tag so it pools across every parent combo
                # instead of splitting into one stamped MO per branch.
                line_combo = _effective_combo(line_combo, sub_bom, combo_attr_id)

                # Source kept only as the component MO's default source (staging
                # cascade). Industry chain: BOM-line override -> item-master default ->
                # PR source (legacy). Plant-level netting consolidates by (item, sub_bom)
                # alone — location is not part of the key.
                item_row = (await db.execute(
                    select(Item.default_source_location_id, Item.is_decoupling_point)
                    .filter(Item.id == line.item_id)
                )).first()
                item_default_src = item_row.default_source_location_id if item_row else None

                # Decoupling point (make-to-stock component): skip consolidation +
                # MO creation for this line. Demand is still recorded on each parent
                # MO's MOPlannedComponent snapshot (netting/booking-stock see it); the
                # item is replenished independently on a pooled standalone MO.
                if _line_decoupled(line, item_row.is_decoupling_point if item_row else False):
                    continue

                src_loc_id = (
                    line.source_location_id
                    or item_default_src
                    or (source_location.id if source_location else None)
                )

                # Folded into the component's variant so its output supply key
                # matches the combo-specific demand.
                sub_attrs = sorted(set(
                    [str(v.id) for v in sub_bom.attribute_values] + line_combo
                ))
                # Only split when the sub-BOM is itself size-differentiated.
                sized = sub_bom.size_mode == 'sized'
                sub_by_size_id = {}
                sub_by_label = {}
                if sized:
                    sub_by_size_id = {s.size_id: s for s in sub_bom.sizes if s.size_id}
                    sub_by_label = {
                        (s.label or '').strip().lower(): s for s in sub_bom.sizes if s.label
                    }

                contrib_qty = (float(mo.qty) * float(line.percentage)) / 100

                # Resolve this parent's size onto a sub-BOM size row (sized only).
                sub_bs = None
                if sized:
                    parent_bs = bs_by_id.get(mo.bom_size_id)
                    if parent_bs is not None:
                        if parent_bs.size_id and parent_bs.size_id in sub_by_size_id:
                            sub_bs = sub_by_size_id[parent_bs.size_id]
                        elif parent_bs.label:
                            sub_bs = sub_by_label.get(parent_bs.label.strip().lower())
                size_key = str(sub_bs.id) if sub_bs is not None else None

                combo_key = tuple(line_combo)
                key = (str(line.item_id), str(sub_bom.id), size_key, combo_key)
                if key not in demand:
                    demand[key] = {
                        "sub_bom_id": sub_bom.id,
                        "item_id": line.item_id,
                        "sub_attrs": sub_attrs,
                        "combo_value_ids": line_combo,
                        "total_qty": 0.0,
                        "src_loc_id": src_loc_id,
                        "bom_size_id": sub_bs.id if sub_bs is not None else None,
                        # Size bucket for netting: stock of another size is not
                        # substitutable, so it must not net this demand away.
                        "bom_size_row": sub_bs,
                        "contributions": {},
                    }

                demand[key]["total_qty"] += contrib_qty
                demand[key]["contributions"][mo.id] = demand[key]["contributions"].get(mo.id, 0.0) + contrib_qty

        # Create one consolidated component MO per unique sub-assembly at this
        # level, write pegging records, and queue it as next generation's parent.
        next_gen = []
        for data in demand.values():
            total = data["total_qty"]
            if total <= 0:
                continue

            # Net consolidated demand against net-free stock at the planned source location.
            net_qty = total
            if availability is not None:
                net_qty = await availability.consume(
                    data["item_id"], data["sub_attrs"], data["src_loc_id"], total,
                    size_token=availability.token_for_bom_size(data["bom_size_row"]),
                )
            if net_qty <= 0:
                continue  # fully covered by stock -> no component MO, no pegging, no sub-tree

            component_mo = await create_mo_recursive(
                db,
                data["sub_bom_id"],
                net_qty,
                location.id if location else None,
                user_id,
                parent_mo_id=None,
                source_location_id=data["src_loc_id"],
                sales_order_id=None,
                production_run_id=production_run_id,
                target_start_date=target_start_date,
                target_end_date=target_end_date,
                bom_size_id=data["bom_size_id"],
                create_children=False,  # next level is exploded by this loop, not recursion
                availability=availability,
                extra_attr_value_ids=data["combo_value_ids"],
                combo_attr_id=combo_attr_id,
            )
            component_mo.is_shared_component = True
            await db.flush()

            # Scale pegging to what this MO actually supplies (remainder is pegged to stock).
            factor = net_qty / total
            for parent_mo_id, contrib_qty in data["contributions"].items():
                db.add(MODependency(
                    dependent_mo_id=parent_mo_id,
                    required_mo_id=component_mo.id,
                    qty=contrib_qty * factor,
                ))

            next_gen.append(component_mo)

        await db.flush()
        current_gen = next_gen
