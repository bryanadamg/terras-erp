from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select, func, or_
from sqlalchemy.orm import selectinload, joinedload
from pathlib import Path
import shutil, os, re, uuid as _uuid
from app.db.session import get_async_db
from app.models.bom import BOM, BOMLine, BOMOperation, BOMSize, bom_values, bom_line_values
from app.models.size import Size
from app.models.item import Item
from app.models.location import Location
from app.models.routing import WorkCenter, Operation
from app.models.production_run import PRBomEntrySize
from app.schemas import BOMCreate, BOMUpdate, BOMResponse, BOMLookupResponse, BOMSummaryResponse, BOMSummaryPageResponse, BOMTreeResponse, SizeResponse, BOMAutomatorProfileCreate, BOMAutomatorProfileResponse, BOMCodeResolveRequest, BOMCodeResolveResponse, BOMItemLookupRequest, BOMItemLookupResponse, BOMItemLookupEntry
from app.models.auth import User, BOMAutomatorProfile
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.services import audit_service, work_center_service
from app.models.attribute import AttributeValue
from app.core.ws_manager import manager
from app.core.pagination import PageParams, PageWindow
from app.core.uploads import upload_ext, IMAGE_EXTS, DOCUMENT_EXTS

router = APIRouter()


async def _sync_beam_ends(db: AsyncSession, bom: BOM) -> None:
    """For beam BOMs, write bom.qty → item.ends (the warp-ends/utas count).

    A BOM is treated as a beam when its produced item is in the 'beam' category
    OR its work center (or that center's parent group) is of center_type BEAMING.
    The work-center path covers items created inline during BOM creation that have
    no category yet (e.g. auto-generated BOMs)."""
    is_beam = False
    if bom.work_center_id:
        wc = (await db.execute(select(WorkCenter).filter(WorkCenter.id == bom.work_center_id))).scalars().first()
        if wc:
            if (wc.center_type or '').upper() == 'BEAMING':
                is_beam = True
            else:
                # Walk the whole ancestor chain: with the optional GROUP tier the
                # BEAMING type node can be two hops up, not one.
                for anc in await work_center_service.ancestors(db, wc.id):
                    if (anc.center_type or '').upper() == 'BEAMING':
                        is_beam = True
                        break

    result = await db.execute(
        select(Item).options(joinedload(Item.category)).filter(Item.id == bom.item_id)
    )
    item = result.scalars().first()
    if not item:
        return
    if not is_beam and item.category and item.category.name.lower() == 'beam':
        is_beam = True
    if is_beam:
        item.ends = int(bom.qty)
        await db.commit()


async def _resolve_line_refs(db: AsyncSession, lines: list) -> tuple[dict, dict]:
    """Bulk-resolve material items (by code) and source locations (by code) for a
    set of BOM lines in one query each, returning code→row maps. Avoids the per-line
    N+1 that a 50-line BOM otherwise incurs on create/update."""
    codes = {l.item_code for l in lines if l.item_code}
    loc_codes = {l.source_location_code for l in lines if getattr(l, "source_location_code", None)}
    material_map: dict = {}
    if codes:
        rows = await db.execute(select(Item).filter(Item.code.in_(codes)))
        material_map = {m.code: m for m in rows.scalars().all()}
    location_map: dict = {}
    if loc_codes:
        rows = await db.execute(select(Location).filter(Location.code.in_(loc_codes)))
        location_map = {loc.code: loc for loc in rows.scalars().all()}
    return material_map, location_map


def _validate_line_percentages(lines: list) -> None:
    if not lines:
        return
    if any((l.percentage or 0) == 0 for l in lines):
        raise HTTPException(status_code=422, detail="All BOM lines must have a non-zero percentage.")
    total = sum(float(l.percentage or 0) for l in lines)
    if abs(total - 100.0) > 0.01:
        raise HTTPException(status_code=422, detail=f"BOM line percentages must sum to 100% (got {total:.2f}%).")


def _validate_steps_assigned(operations: list, lines: list) -> None:
    """L2 rule: when a BOM defines routing operations, every material line must be
    allocated to a step (bom_operation_sequence). Per-operation staging/consumption
    depends on it, so an unassigned line is blocked."""
    if not operations or not lines:
        return
    valid_seqs = {op.sequence for op in operations if (op.operation_id is not None or op.work_center_id is not None)}
    if not valid_seqs:
        return
    missing = [
        (l.item_code or "?") for l in lines
        if l.bom_operation_sequence is None or l.bom_operation_sequence not in valid_seqs
    ]
    if missing:
        raise HTTPException(
            status_code=422,
            detail=f"Every material must be assigned to a routing step when the BOM has operations. Unassigned: {', '.join(missing)}",
        )


@router.get("/sizes", response_model=list[SizeResponse])
async def get_sizes(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view"))):
    result = await db.execute(select(Size).order_by(Size.sort_order))
    return result.scalars().all()

@router.post("/boms/lookup-by-items", response_model=BOMItemLookupResponse)
async def lookup_boms_by_items(
    payload: BOMItemLookupRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view")),
):
    """Existing BOMs per item code, regardless of pagination.

    The designer's `existingBOMs` prop is one page of /boms/summary filtered to root
    BOMs, so it can't see the BOM of an item that is a component elsewhere — exactly
    the shared sub-assemblies (beams, greige) whose recipe is reused across variants.

    ALL BOMs are returned for each item, oldest first — an item legitimately owns
    several (one per combo, plus possibly a combo-less one shared across every
    variant). The caller picks by variant; collapsing to one here would make a
    RED greige recipe get silently reused for BLUE.
    """
    codes = [c for c in payload.item_codes if c]
    if not codes:
        return BOMItemLookupResponse(matches=[])

    result = await db.execute(
        select(BOM)
        .join(Item, BOM.item_id == Item.id)
        .options(joinedload(BOM.item), selectinload(BOM.attribute_values))
        .where(Item.code.in_(codes))
        .order_by(BOM.created_at.asc())
    )
    return BOMItemLookupResponse(matches=[
        BOMItemLookupEntry(
            item_code=bom.item.code,
            bom_id=bom.id,
            bom_code=bom.code,
            attribute_value_ids=[v.id for v in bom.attribute_values],
        )
        for bom in result.unique().scalars().all()
        if bom.item and bom.item.code
    ])


_CODE_TAIL = re.compile(r"^(?P<base>.*?)(?P<sep>[-_/ ]?)(?P<counter>\d+)$")


@router.post("/boms/resolve-codes", response_model=BOMCodeResolveResponse)
async def resolve_bom_codes(
    payload: BOMCodeResolveRequest,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Return a free BOM code for each desired code.

    The BOM designer can only dedup against the page of BOMs it has loaded
    (`/boms/summary`, which is paginated and root-only by default), so any
    sub-BOM code it generates is invisible to it and collides on save. The
    server owns `bom.code` uniqueness, so it resolves the counters: a taken
    code has its trailing numeric segment incremented (same zero padding)
    until free. Codes already claimed earlier in the same batch are treated
    as taken, so a tree that repeats a code still gets distinct ones.
    """
    taken: set[str] = set()
    if payload.codes:
        # One query for every code sharing a base, not one per code.
        bases = set()
        for code in payload.codes:
            m = _CODE_TAIL.match(code or "")
            bases.add(m.group("base") if m else (code or ""))
        # autoescape: BOM codes may contain `_`/`%`, which are LIKE wildcards.
        conditions = [BOM.code.startswith(b, autoescape=True) for b in bases if b]
        if conditions:
            rows = await db.execute(select(BOM.code).where(or_(*conditions)))
            taken = {c for (c,) in rows.all()}

    resolved: dict[str, str] = {}
    for code in payload.codes:
        if code in resolved:
            continue
        candidate = code
        if candidate in taken:
            m = _CODE_TAIL.match(code or "")
            if m:
                base, sep, counter = m.group("base"), m.group("sep"), m.group("counter")
                width, n = len(counter), int(counter)
            else:
                base, sep, width, n = code, "-", 5, 0
            while candidate in taken:
                n += 1
                candidate = f"{base}{sep}{str(n).zfill(width)}"
        resolved[code] = candidate
        taken.add(candidate)
    return BOMCodeResolveResponse(resolved=resolved)


@router.post("/boms", response_model=BOMResponse)
async def create_bom(payload: BOMCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('bom.create'))):
    _validate_line_percentages(payload.lines)
    _validate_steps_assigned(payload.operations, payload.lines)

    # 1. Resolve Produced Item
    result = await db.execute(select(Item).filter(Item.code == payload.item_code))
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Produced item '{payload.item_code}' not found")
    
    # 2. Check if BOM code exists
    result = await db.execute(select(BOM).filter(BOM.code == payload.code))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="BOM Code already exists")

    # 3. Create BOM Header
    bom = BOM(
        code=payload.code,
        description=payload.description,
        item_id=item.id,
        qty=payload.qty,
        tolerance_percentage=payload.tolerance_percentage,
        overdelivery_tolerance_percentage=payload.overdelivery_tolerance_percentage,
        kerapatan_picks=payload.kerapatan_picks,
        kerapatan_unit=payload.kerapatan_unit,
        sisir_no=payload.sisir_no,
        pemakaian_obat=payload.pemakaian_obat,
        pembuatan_sample_oleh=payload.pembuatan_sample_oleh,
        customer_id=payload.customer_id,
        work_center_id=payload.work_center_id,
        size_mode=payload.size_mode,
        berat_bahan_mateng=payload.berat_bahan_mateng,
        berat_bahan_mentah_pelesan=payload.berat_bahan_mentah_pelesan,
        mesin_lebar=payload.mesin_lebar,
        mesin_panjang_tulisan=payload.mesin_panjang_tulisan,
        mesin_panjang_tarikan=payload.mesin_panjang_tarikan,
        mesin_panjang_tarikan_bandul_1kg=payload.mesin_panjang_tarikan_bandul_1kg,
        mesin_panjang_tarikan_bandul_9kg=payload.mesin_panjang_tarikan_bandul_9kg,
        celup_lebar=payload.celup_lebar,
        celup_panjang_tulisan=payload.celup_panjang_tulisan,
        celup_panjang_tarikan=payload.celup_panjang_tarikan,
        celup_panjang_tarikan_bandul_1kg=payload.celup_panjang_tarikan_bandul_1kg,
        celup_panjang_tarikan_bandul_9kg=payload.celup_panjang_tarikan_bandul_9kg,
    )
    
    if payload.attribute_value_ids:
        result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(payload.attribute_value_ids)))
        vals = result.scalars().all()
        bom.attribute_values = vals

    db.add(bom)
    await db.flush()

    # 4. Create BOM Sizes
    for size_entry in payload.sizes:
        if size_entry.target_measurement is None and size_entry.measurement_min is None and size_entry.measurement_max is None:
            continue
        bom_size = BOMSize(
            bom_id=bom.id,
            size_id=size_entry.size_id,
            label=size_entry.label,
            target_measurement=size_entry.target_measurement,
            measurement_min=size_entry.measurement_min,
            measurement_max=size_entry.measurement_max,
        )
        db.add(bom_size)

    # 5. Create BOM Operations first so lines can reference them by sequence
    seq_to_op_id: dict[int, any] = {}
    for op in payload.operations:
        if op.work_center_id is None and op.operation_id is None:
            continue
        bom_op = BOMOperation(
            bom_id=bom.id,
            operation_id=op.operation_id,
            work_center_id=op.work_center_id,
            sequence=op.sequence,
            time_minutes=op.time_minutes,
        )
        db.add(bom_op)
        seq_to_op_id[op.sequence] = bom_op

    await db.flush()

    # 6. Create BOM Lines
    # Bulk-resolve all material items + source locations up front (one query each)
    # instead of a SELECT per line — a 50-line BOM was 50+ sequential round-trips.
    material_map, location_map = await _resolve_line_refs(db, payload.lines)
    for line in payload.lines:
        material = material_map.get(line.item_code)
        if not material:
            raise HTTPException(status_code=404, detail=f"Material item '{line.item_code}' not found")

        resolved_op = seq_to_op_id.get(line.bom_operation_sequence) if line.bom_operation_sequence is not None else None
        bom_line = BOMLine(
            bom_id=bom.id,
            item_id=material.id,
            qty=line.qty,
            percentage=line.percentage,
            bom_operation_id=resolved_op.id if resolved_op else None,
            is_decoupling_point=line.is_decoupling_point,
        )

        if line.source_location_code:
            loc = location_map.get(line.source_location_code)
            if not loc:
                raise HTTPException(status_code=404, detail=f"Source Location '{line.source_location_code}' not found")
            bom_line.source_location_id = loc.id

        if line.attribute_value_ids:
            result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids)))
            vals = result.scalars().all()
            bom_line.attribute_values = vals

        db.add(bom_line)

    try:
        await db.commit()
    except IntegrityError:
        # Lost a race on bom.code between the check above and the commit.
        await db.rollback()
        raise HTTPException(status_code=400, detail=f"BOM Code '{payload.code}' already exists")

    # Re-fetch with FULL eager loading for serialization
    result = await db.execute(
        select(BOM)
        .options(
            joinedload(BOM.item),
            joinedload(BOM.customer),
            joinedload(BOM.work_center),
            selectinload(BOM.attribute_values),
            selectinload(BOM.lines).joinedload(BOMLine.item),
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(BOM.operations),
            selectinload(BOM.sizes).joinedload(BOMSize.size),
        )
        .filter(BOM.id == bom.id)
    )
    refresh_bom = result.scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="BOM",
        entity_id=str(refresh_bom.id),
        details=f"Created BOM {refresh_bom.code} for {item.code}",
        changes=audit_service.added(payload.model_dump())
    )

    await _sync_beam_ends(db, bom)

    await manager.broadcast({"type": "BOM_UPDATE", "action": "CREATE", "bom_id": str(refresh_bom.id), "code": refresh_bom.code})

    refresh_bom.attribute_value_ids = [v.id for v in refresh_bom.attribute_values]
    for bl in refresh_bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    return refresh_bom

@router.get("/boms", response_model=list[BOMResponse])
async def get_boms(skip: int = 0, limit: int | None = None, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view"))):
    """Full nested BOM list — consumed unpaginated by manufacturing/MES/sales/samples
    and the scanner, which need every active BOM in memory to resolve sub-BOM chains
    for MRP consolidation (you can't page through this: which page holds a given
    sub-BOM isn't known in advance). `limit` defaults to unbounded for that reason —
    the BOM page's own paginated list lives at /boms/summary instead."""
    query = select(BOM).options(
        joinedload(BOM.item),
        joinedload(BOM.customer),
        joinedload(BOM.work_center),
        selectinload(BOM.attribute_values),
        selectinload(BOM.lines).joinedload(BOMLine.item),
        selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(BOM.operations),
        selectinload(BOM.sizes).joinedload(BOMSize.size),
    )
    query = query.order_by(BOM.created_at.desc()).offset(skip)
    if limit is not None:
        query = query.limit(limit)

    result = await db.execute(query)
    items_list = result.unique().scalars().all()
    
    for item in items_list:
        item.attribute_value_ids = [v.id for v in item.attribute_values]
        for bl in item.lines:
            bl.attribute_value_ids = [v.id for v in bl.attribute_values]
    return items_list

@router.get("/boms/lookup", response_model=list[BOMLookupResponse])
async def get_boms_lookup(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission(
        "bom.view", "manufacturing_order.view", "production_run.view", "work_order.view",
        "sales_order.view", "sales_order.create_pr",
    )),
):
    """Slim BOM lookup: id/code/item/attrs/sizes only, no lines/operations.

    For consumers that .find()/.filter() BOMs by (item_id, attribute_value_ids)
    or need the size dropdown but never read routing/materials — e.g. the Sales
    Order line form's BOM auto-match. Full /boms (with lines+operations) stays
    the source for MRP sub-BOM chain-walking; don't repoint that here.
    """
    query = select(BOM).options(
        selectinload(BOM.attribute_values),
        selectinload(BOM.sizes).joinedload(BOMSize.size),
    )
    result = await db.execute(query.order_by(BOM.created_at.desc()))
    rows = result.scalars().all()
    for b in rows:
        b.attribute_value_ids = [v.id for v in b.attribute_values]
    return rows

@router.get("/boms/summary", response_model=BOMSummaryPageResponse)
async def get_boms_summary(
    search: str = Query(""),
    root_only: bool = Query(False),
    window: PageWindow = Depends(PageParams(default_size=50)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view")),
):
    """Paginated lightweight BOM list for the BOM page.

    Returns full headers + lines + sizes, but collapses `operations` to a count.
    Supports server-side search (code or item name) and root_only filtering.
    Other domains (manufacturing/MES/sales) still use `/boms`.
    """
    # Sub-BOMs: item_ids that appear as components in any BOM line
    sub_item_ids_sq = select(BOMLine.item_id).distinct().scalar_subquery()

    # Build WHERE conditions
    where = []
    if search:
        where.append(or_(
            BOM.code.ilike(f"%{search}%"),
            Item.name.ilike(f"%{search}%"),
        ))
    if root_only:
        where.append(BOM.item_id.not_in(sub_item_ids_sq))

    # Count (join Item only when search requires it)
    count_q = select(func.count(BOM.id))
    if search:
        count_q = count_q.join(Item, BOM.item_id == Item.id)
    if where:
        count_q = count_q.where(*where)
    total: int = (await db.execute(count_q)).scalar_one()

    # Data query
    query = select(BOM).options(
        joinedload(BOM.item),
        joinedload(BOM.customer),
        joinedload(BOM.work_center),
        selectinload(BOM.lines).joinedload(BOMLine.item),
        selectinload(BOM.sizes).joinedload(BOMSize.size),
    )
    if search:
        query = query.join(Item, BOM.item_id == Item.id)
    if where:
        query = query.where(*where)
    result = await db.execute(window.apply(query.order_by(BOM.created_at.desc())))
    boms = result.unique().scalars().all()

    if not boms:
        return window.envelope([], total)

    bom_ids = [b.id for b in boms]
    line_ids = [l.id for b in boms for l in b.lines]

    bom_attr_map: dict = {}
    rows = await db.execute(
        select(bom_values.c.bom_id, bom_values.c.attribute_value_id).where(bom_values.c.bom_id.in_(bom_ids))
    )
    for bid, vid in rows.all():
        bom_attr_map.setdefault(bid, []).append(vid)

    line_attr_map: dict = {}
    if line_ids:
        rows = await db.execute(
            select(bom_line_values.c.bom_line_id, bom_line_values.c.attribute_value_id).where(bom_line_values.c.bom_line_id.in_(line_ids))
        )
        for lid, vid in rows.all():
            line_attr_map.setdefault(lid, []).append(vid)

    op_counts: dict = {}
    rows = await db.execute(
        select(BOMOperation.bom_id, func.count(BOMOperation.id)).where(BOMOperation.bom_id.in_(bom_ids)).group_by(BOMOperation.bom_id)
    )
    for bid, cnt in rows.all():
        op_counts[bid] = cnt

    # Compute is_root: item_id not used as a component in any BOM line. Scope the
    # scan to just this page's produced items (was pulling EVERY component item_id
    # in the DB on every page request).
    page_item_ids = {b.item_id for b in boms}
    component_rows = await db.execute(
        select(BOMLine.item_id).distinct().where(BOMLine.item_id.in_(page_item_ids))
    )
    component_item_ids = {r[0] for r in component_rows.all()}

    for b in boms:
        b.attribute_value_ids = bom_attr_map.get(b.id, [])
        b.operation_count = op_counts.get(b.id, 0)
        b.is_root = b.item_id not in component_item_ids
        for bl in b.lines:
            bl.attribute_value_ids = line_attr_map.get(bl.id, [])

    return window.envelope(boms, total)

async def _load_bom_subtree(bom_id: str, db: AsyncSession, visited: set) -> any:
    if bom_id in visited:
        return None
    visited.add(bom_id)
    result = await db.execute(
        select(BOM).options(
            joinedload(BOM.item),
            joinedload(BOM.customer),
            joinedload(BOM.work_center),
            selectinload(BOM.attribute_values),
            selectinload(BOM.lines).joinedload(BOMLine.item),
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(BOM.operations),
            selectinload(BOM.sizes).joinedload(BOMSize.size),
        ).filter(BOM.id == bom_id)
    )
    bom = result.unique().scalars().first()
    if not bom:
        return None
    bom.attribute_value_ids = [v.id for v in bom.attribute_values]

    # Bulk-load ALL sub-BOM candidates for this node's lines in ONE query (grouped
    # by produced item_id), instead of a candidate SELECT per line. Was O(lines)
    # round-trips per node, recursively down the whole tree.
    line_item_ids = {bl.item_id for bl in bom.lines}
    candidates_by_item: dict = {}
    if line_item_ids:
        cand_result = await db.execute(
            select(BOM)
            .options(selectinload(BOM.attribute_values))
            .filter(BOM.item_id.in_(line_item_ids))
            .order_by(BOM.created_at.desc())
        )
        for cand in cand_result.scalars().all():
            candidates_by_item.setdefault(cand.item_id, []).append(cand)

    for bl in bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]
        sub_boms = candidates_by_item.get(bl.item_id, [])  # already newest-first
        matched = None
        if sub_boms:
            line_av_ids = set(str(v) for v in bl.attribute_value_ids)
            for candidate in sub_boms:
                cand_av_ids = set(str(v.id) for v in (candidate.attribute_values or []))
                if cand_av_ids == line_av_ids:
                    matched = candidate
                    break
            if not matched:
                matched = sub_boms[0]
        bl.sub_bom = await _load_bom_subtree(str(matched.id), db, visited) if matched else None
    return bom

@router.get("/boms/{bom_id}/tree", response_model=BOMTreeResponse)
async def get_bom_tree(bom_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view"))):
    bom = await _load_bom_subtree(bom_id, db, set())
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    return bom

@router.post("/boms/{bom_id}/sample-photo")
async def upload_bom_sample_photo(
    bom_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('bom.edit')),
):
    result = await db.execute(select(BOM).filter(BOM.id == bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    upload_dir = Path("static/boms")
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = upload_ext(file, IMAGE_EXTS, ".jpg")
    file_path = upload_dir / f"{bom_id}_sample{ext}"
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    bom.sample_photo_url = f"/static/boms/{bom_id}_sample{ext}"
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "BOM", bom_id, details=f"Uploaded sample photo for BOM {bom.code}")
    return {"sample_photo_url": bom.sample_photo_url}

@router.post("/boms/{bom_id}/design-file")
async def upload_bom_design_file(
    bom_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('bom.edit')),
):
    result = await db.execute(select(BOM).filter(BOM.id == bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    upload_dir = Path("static/boms")
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = upload_ext(file, DOCUMENT_EXTS, ".pdf")
    file_path = upload_dir / f"{bom_id}_design{ext}"
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    bom.design_file_url = f"/static/boms/{bom_id}_design{ext}"
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "BOM", bom_id, details=f"Uploaded design file for BOM {bom.code}")
    return {"design_file_url": bom.design_file_url}

def _bom_eager_options():
    return [
        joinedload(BOM.item),
        joinedload(BOM.customer),
        joinedload(BOM.work_center),
        selectinload(BOM.attribute_values),
        selectinload(BOM.lines).joinedload(BOMLine.item),
        selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(BOM.operations),
        selectinload(BOM.sizes).joinedload(BOMSize.size),
    ]


@router.put("/boms/{bom_id}", response_model=BOMResponse)
async def update_bom(
    bom_id: str,
    payload: BOMUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('bom.edit')),
):
    result = await db.execute(
        select(BOM).options(*_bom_eager_options()).filter(BOM.id == bom_id)
    )
    bom = result.unique().scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    # Capture before state for audit diff
    before_lines = [
        {"item_id": str(bl.item_id), "qty": float(bl.qty), "percentage": float(bl.percentage)}
        for bl in bom.lines
    ]

    # Update header fields
    scalar_fields = [
        "description", "qty", "tolerance_percentage", "overdelivery_tolerance_percentage",
        "active", "size_mode",
        "customer_id", "work_center_id", "kerapatan_picks", "kerapatan_unit", "sisir_no",
        "pemakaian_obat", "pembuatan_sample_oleh", "berat_bahan_mateng",
        "berat_bahan_mentah_pelesan", "mesin_lebar", "mesin_panjang_tulisan",
        "mesin_panjang_tarikan", "mesin_panjang_tarikan_bandul_1kg",
        "mesin_panjang_tarikan_bandul_9kg", "celup_lebar", "celup_panjang_tulisan",
        "celup_panjang_tarikan", "celup_panjang_tarikan_bandul_1kg",
        "celup_panjang_tarikan_bandul_9kg",
    ]
    for field in scalar_fields:
        val = getattr(payload, field, None)
        if val is not None:
            setattr(bom, field, val)

    # Replace BOM-header (variant) attribute values. `is not None` so an empty
    # list clears them; the frontend always sends the full current set.
    if payload.attribute_value_ids is not None:
        if payload.attribute_value_ids:
            av_result = await db.execute(
                select(AttributeValue).filter(AttributeValue.id.in_(payload.attribute_value_ids))
            )
            bom.attribute_values = av_result.scalars().all()
        else:
            bom.attribute_values = []

    # Replace operations first so lines can reference them by sequence
    seq_to_op_id: dict[int, any] = {}
    if payload.operations is not None:
        for op in list(bom.operations):
            await db.delete(op)
        await db.flush()
        for oc in payload.operations:
            if oc.work_center_id is None and oc.operation_id is None:
                continue
            new_op = BOMOperation(
                bom_id=bom.id,
                operation_id=oc.operation_id,
                work_center_id=oc.work_center_id,
                sequence=oc.sequence,
                time_minutes=oc.time_minutes,
            )
            db.add(new_op)
            seq_to_op_id[oc.sequence] = new_op
        await db.flush()

    # Replace lines if provided
    if payload.lines is not None:
        _validate_line_percentages(payload.lines)
        if payload.operations is not None:
            _validate_steps_assigned(payload.operations, payload.lines)
        for bl in list(bom.lines):
            await db.delete(bl)
        await db.flush()
        # Bulk-resolve materials + source locations (avoid per-line N+1)
        material_map, location_map = await _resolve_line_refs(db, payload.lines)
        for lc in payload.lines:
            material = material_map.get(lc.item_code)
            if not material:
                raise HTTPException(status_code=404, detail=f"Material item '{lc.item_code}' not found")
            resolved_op = seq_to_op_id.get(lc.bom_operation_sequence) if lc.bom_operation_sequence is not None else None
            bom_line = BOMLine(bom_id=bom.id, item_id=material.id, qty=lc.qty, percentage=lc.percentage, bom_operation_id=resolved_op.id if resolved_op else None, is_decoupling_point=lc.is_decoupling_point)
            if lc.source_location_code:
                loc = location_map.get(lc.source_location_code)
                if not loc:
                    raise HTTPException(status_code=404, detail=f"Source location '{lc.source_location_code}' not found")
                bom_line.source_location_id = loc.id
            if lc.attribute_value_ids:
                av_result = await db.execute(
                    select(AttributeValue).filter(AttributeValue.id.in_(lc.attribute_value_ids))
                )
                bom_line.attribute_values = av_result.scalars().all()
            db.add(bom_line)

    # Upsert sizes: update in-place to preserve IDs referenced by MOs/PRs/SOs
    if payload.sizes is not None:
        existing_by_key: dict = {}
        for sz in bom.sizes:
            key = str(sz.size_id) if sz.size_id else (sz.label or "")
            existing_by_key[key] = sz

        payload_keys: set = set()
        for sc in payload.sizes:
            if sc.target_measurement is None and sc.measurement_min is None and sc.measurement_max is None:
                continue
            key = str(sc.size_id) if sc.size_id else (sc.label or "")
            payload_keys.add(key)
            if key in existing_by_key:
                sz = existing_by_key[key]
                sz.target_measurement = sc.target_measurement
                sz.measurement_min = sc.measurement_min
                sz.measurement_max = sc.measurement_max
                sz.label = sc.label
            else:
                db.add(BOMSize(
                    bom_id=bom.id,
                    size_id=sc.size_id,
                    label=sc.label,
                    target_measurement=sc.target_measurement,
                    measurement_min=sc.measurement_min,
                    measurement_max=sc.measurement_max,
                ))

        for key, sz in existing_by_key.items():
            if key in payload_keys:
                continue
            # PRBomEntrySize has no cascade/SET NULL — skip delete if referenced
            ref_pr = await db.execute(select(PRBomEntrySize.id).filter(PRBomEntrySize.bom_size_id == sz.id).limit(1))
            if ref_pr.first():
                continue
            await db.delete(sz)

    await db.commit()

    # Re-fetch with full eager loading
    result = await db.execute(select(BOM).options(*_bom_eager_options()).filter(BOM.id == bom.id))
    updated_bom = result.unique().scalars().first()

    after_lines = [
        {"item_id": str(bl.item_id), "qty": float(bl.qty), "percentage": float(bl.percentage)}
        for bl in updated_bom.lines
    ]

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="BOM",
        entity_id=str(updated_bom.id),
        details=f"Updated BOM {updated_bom.code}",
        changes={"lines": [before_lines, after_lines]},
    )

    await _sync_beam_ends(db, updated_bom)

    await manager.broadcast({"type": "BOM_UPDATE", "action": "UPDATE", "bom_id": str(updated_bom.id), "code": updated_bom.code})

    updated_bom.attribute_value_ids = [v.id for v in updated_bom.attribute_values]
    for bl in updated_bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    return updated_bom


async def _collect_bom_tree(db: AsyncSession, root_id: _uuid.UUID):
    """DFS from root_id via BOMLine.item_id → BOM.item_id.
    Returns (all_ids incl. root, sub_ids deepest-first excl. root, children_map: parent_id -> [child_id])."""
    visited = {root_id}
    order: list[_uuid.UUID] = []
    children_map: dict = {}

    async def visit(node_id):
        item_ids_result = await db.execute(
            select(BOMLine.item_id).filter(BOMLine.bom_id == node_id)
        )
        item_ids = [r[0] for r in item_ids_result.all()]
        children_map[node_id] = []
        if not item_ids:
            return
        sub_boms_result = await db.execute(
            select(BOM.id).filter(BOM.item_id.in_(item_ids))
        )
        for (sub_id,) in sub_boms_result.all():
            if sub_id in visited:
                continue
            visited.add(sub_id)
            children_map[node_id].append(sub_id)
            await visit(sub_id)
            order.append(sub_id)

    await visit(root_id)
    return visited, order, children_map


async def _find_shared_sub_boms(db: AsyncSession, all_ids: set, sub_ids: list, children_map: dict) -> set:
    """Among sub_ids (candidates for cascade delete), find those still referenced by a BOMLine
    belonging to a BOM outside the delete tree (all_ids) — these must be preserved.
    Preservation propagates down: a preserved BOM still needs its own sub-BOMs."""
    if not sub_ids:
        return set()

    external_lines = await db.execute(
        select(BOMLine.item_id).filter(BOMLine.bom_id.notin_(all_ids)).distinct()
    )
    external_item_ids = {r[0] for r in external_lines.all()}

    cand_rows = await db.execute(select(BOM.id, BOM.item_id).filter(BOM.id.in_(sub_ids)))
    cand_item_map = {bid: iid for bid, iid in cand_rows.all()}

    preserved: set = {bid for bid in sub_ids if cand_item_map.get(bid) in external_item_ids}

    def propagate(node_id):
        for child in children_map.get(node_id, []):
            if child not in preserved:
                preserved.add(child)
                propagate(child)

    for bid in list(preserved):
        propagate(bid)

    return preserved


@router.delete("/boms/{bom_id}")
async def delete_bom(bom_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(require_permission('bom.delete'))):
    result = await db.execute(select(BOM).filter(BOM.id == bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    # Collect all descendant BOM IDs (deepest first), then append root
    all_ids, sub_ids, children_map = await _collect_bom_tree(db, bom.id)

    # Sub-BOMs still needed by a BOM outside this tree (shared, e.g. greige base) are preserved
    preserved = await _find_shared_sub_boms(db, all_ids, sub_ids, children_map)
    to_delete = [bid for bid in sub_ids if bid not in preserved] + [bom.id]  # children before parent

    deleted_sub_count = len(to_delete) - 1
    kept_count = len(preserved)
    details = f"Deleted BOM {bom.code} and {deleted_sub_count} sub-BOM(s)"
    if kept_count:
        details += f", kept {kept_count} shared sub-BOM(s)"
    deleted_code = bom.code

    try:
        for bid in to_delete:
            r = await db.execute(select(BOM).filter(BOM.id == bid))
            b = r.scalars().first()
            if b:
                await db.delete(b)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Cannot delete BOM tree because one or more BOMs are referenced by active Work Orders or Manufacturing Orders. Please complete or delete those first."
        )

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="BOM",
        entity_id=bom_id,
        details=details
    )

    await manager.broadcast({"type": "BOM_UPDATE", "action": "DELETE", "bom_id": bom_id, "code": deleted_code})

    message = f"BOM and {deleted_sub_count} sub-BOM(s) deleted"
    if kept_count:
        message += f" ({kept_count} shared sub-BOM(s) kept)"
    return {"status": "success", "message": message, "kept_shared": kept_count}


# --- BOM Automator Profiles ---

@router.get("/bom-automator-profiles", response_model=list[BOMAutomatorProfileResponse])
async def list_bom_automator_profiles(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("bom.view", "manufacturing_order.view", "production_run.view", "work_order.view")),
):
    # Ordered by name so "first profile" is a stable choice — the client falls back to
    # it as the default template when it has no remembered last-used profile.
    result = await db.execute(
        select(BOMAutomatorProfile)
        .where(BOMAutomatorProfile.user_id == current_user.id)
        .order_by(BOMAutomatorProfile.name)
    )
    return result.scalars().all()


@router.post("/bom-automator-profiles", response_model=BOMAutomatorProfileResponse, status_code=201)
async def create_bom_automator_profile(
    payload: BOMAutomatorProfileCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    profile = BOMAutomatorProfile(
        user_id=current_user.id,
        name=payload.name,
        levels=payload.levels,
        inherit_attributes=payload.inherit_attributes,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


@router.delete("/bom-automator-profiles/{profile_id}", status_code=204)
async def delete_bom_automator_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(BOMAutomatorProfile).where(
            BOMAutomatorProfile.id == profile_id,
            BOMAutomatorProfile.user_id == current_user.id,
        )
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    await db.delete(profile)
    await db.commit()
