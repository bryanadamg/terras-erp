from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, or_, and_, case
from sqlalchemy.orm import joinedload, selectinload
from app.db.session import get_async_db
from app.models.sample import SampleRequest, SampleColor, SampleRequestRead, SampleColorEvent
from app.models.item import Item as ItemModel
from app.models.partner import Partner
from app.models.attribute import Attribute, AttributeValue
from app.schemas import (
    SampleRequestCreate, SampleRequestUpdate, SampleRequestResponse, SampleColorResponse,
    PaginatedSampleRequestResponse, SampleColorStats, SampleColorEventResponse,
    SampleDevelopmentReport, SampleReportTotals, SampleReportVariantRow, SampleReportGroupRow,
)
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.services import audit_service, kpi_service, numbering_service
from app.core.pagination import PageParams, PageWindow
from datetime import datetime, date, time, timedelta
from pathlib import Path
import shutil, os, uuid

router = APIRouter()


# The request category is a value of the `Sample Category` system attribute so users
# can add their own; these three are only the seeded defaults. The keys are what the
# pre-attribute column stored — kept as an alias map so old links/clients still filter.
SAMPLE_CATEGORY_ROLE = "sample_category"
LEGACY_CATEGORY_LABELS = {
    "NEW_SAMPLE": "New Sample",
    "RE_SAMPLE": "Re Sample",
    "YARDAGE": "Yardage",
}
DEFAULT_CATEGORY_LABEL = "New Sample"


async def _resolve_sample_category(
    db: AsyncSession, value_id, category_text: str | None
) -> tuple[object | None, str]:
    """Return (attribute_value_id, display snapshot) for a request's category pick.

    Categories are values of the `Sample Category` system attribute (role
    sample_category), curated on the Attributes page. A value belonging to any
    other attribute is a 422. When only text arrives (legacy client, or the old
    enum key) it is matched back to a value; unmatched text is kept as a bare
    snapshot rather than rejected, so an import can't lose the classification.
    """
    if value_id:
        row = (await db.execute(
            select(AttributeValue)
            .join(Attribute, Attribute.id == AttributeValue.attribute_id)
            .filter(AttributeValue.id == value_id, Attribute.system_role == SAMPLE_CATEGORY_ROLE)
        )).scalars().first()
        if not row:
            raise HTTPException(status_code=422, detail=f"Invalid sample category selection: {value_id}")
        return row.id, row.value

    label = (category_text or "").strip()
    label = LEGACY_CATEGORY_LABELS.get(label, label) or DEFAULT_CATEGORY_LABEL
    match = (await db.execute(
        select(AttributeValue)
        .join(Attribute, Attribute.id == AttributeValue.attribute_id)
        .filter(Attribute.system_role == SAMPLE_CATEGORY_ROLE, func.lower(AttributeValue.value) == label.lower())
    )).scalars().first()
    if match:
        return match.id, match.value
    return None, label[:64]


def _enrich_creator(samples: list) -> None:
    for sample in samples:
        creator = sample.created_by
        sample.created_by_name = creator.full_name if creator else None
        sample.created_by_role = creator.role.name if creator and creator.role else None


async def _enrich_colors_with_items(db: AsyncSession, samples: list) -> None:
    all_color_ids = [c.id for s in samples for c in (s.colors or [])]
    if not all_color_ids:
        return
    item_rows = await db.execute(
        select(ItemModel.source_color_id, ItemModel.id, ItemModel.code)
        .where(ItemModel.source_color_id.in_(all_color_ids))
    )
    color_item_map = {row[0]: (row[1], row[2]) for row in item_rows.all()}
    for sample in samples:
        for color in (sample.colors or []):
            item_info = color_item_map.get(color.id)
            color.item_id = item_info[0] if item_info else None
            color.item_code = item_info[1] if item_info else None


@router.post("/samples", response_model=SampleRequestResponse)
async def create_sample_request(
    payload: SampleRequestCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.create')),
):
    # Per-year book off a number range. count(*)+1 raced two concurrent creates onto
    # one code, and counted deleted rows out of existence — so deleting any request
    # made the next create reuse a number that a live row already held.
    year = datetime.now().year

    async def _seed() -> int:
        # func.max() on the code column is a STRING max — "SMP-2026-003" sorts
        # above "SMP-2026-00144" because '3' > '1' at the first differing digit,
        # so any code not zero-padded to the current width poisons the seed with
        # a number far below the real max. Parse every candidate and take the
        # numeric max in Python instead.
        codes = (await db.execute(
            select(SampleRequest.code).filter(SampleRequest.code.like(f"SMP-{year}-%"))
        )).scalars().all()
        best = 0
        for c in codes:
            try:
                best = max(best, int(c.rsplit("-", 1)[1]))
            except (ValueError, IndexError):
                continue
        return best

    async def _taken(code: str) -> bool:
        return (await db.execute(
            select(SampleRequest.id).filter(SampleRequest.code == code).limit(1)
        )).scalars().first() is not None

    _, code = await numbering_service.allocate_code(
        db, f"SAMPLE_REQUEST:{year}", lambda n: f"SMP-{year}-{n:05d}", seed=_seed, exists=_taken,
    )

    req_date = date.fromisoformat(payload.request_date) if payload.request_date else date.today()
    est_date = date.fromisoformat(payload.estimated_completion_date) if payload.estimated_completion_date else None
    now = datetime.utcnow()
    cat_value_id, cat_label = await _resolve_sample_category(db, payload.category_value_id, payload.category)

    sample = SampleRequest(
        code=code,
        customer_id=payload.customer_id,
        request_date=req_date,
        project=payload.project,
        customer_article_code=payload.customer_article_code,
        internal_article_code=payload.internal_article_code,
        width=payload.width,
        variant_type=payload.variant_type,
        category=cat_label,
        category_value_id=cat_value_id,
        main_material=payload.main_material,
        middle_material=payload.middle_material,
        bottom_material=payload.bottom_material,
        weft=payload.weft,
        warp=payload.warp,
        original_weight=payload.original_weight,
        production_weight=payload.production_weight,
        additional_info=payload.additional_info,
        quantity=payload.quantity,
        sample_size=payload.sample_size,
        estimated_completion_date=est_date,
        completion_description=payload.completion_description,
        notes=payload.notes,
        status="DRAFT",
        updated_at=now,
        created_by_id=current_user.id,
    )
    db.add(sample)
    await db.flush()
    await _mark_read(db, current_user.id, sample.id, now)

    for i, color_data in enumerate(payload.colors):
        if color_data.name.strip():
            db.add(SampleColor(
                sample_request_id=sample.id,
                name=color_data.name.strip(),
                is_repeat=color_data.is_repeat,
                order=i,
            ))

    await db.commit()

    result = await db.execute(
        select(SampleRequest)
        .options(joinedload(SampleRequest.colors), joinedload(SampleRequest.created_by).joinedload(User.role))
        .filter(SampleRequest.id == sample.id)
    )
    sample = result.unique().scalars().first()
    _enrich_creator([sample])

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="SampleRequest",
        entity_id=str(sample.id),
        details=f"Created Sample Request {sample.code}",
        changes={"code": sample.code, "customer_article_code": sample.customer_article_code},
    )

    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    await _enrich_colors_with_items(db, [sample])
    sample.is_unread = False
    return sample


async def _mark_read(db: AsyncSession, user_id, sample_id, now: datetime | None = None) -> None:
    """Stamp the actor's own read receipt. Every edit bumps updated_at, which is what
    re-lights the row for everyone — but the person who made the edit has, by
    definition, read it. Without this their own change comes back to them as unread
    and the dot stops meaning anything."""
    sid = sample_id if isinstance(sample_id, uuid.UUID) else uuid.UUID(str(sample_id))
    now = now or datetime.utcnow()
    result = await db.execute(
        select(SampleRequestRead).filter(
            SampleRequestRead.user_id == user_id,
            SampleRequestRead.sample_request_id == sid,
        )
    )
    record = result.scalars().first()
    if record:
        record.read_at = now
    else:
        db.add(SampleRequestRead(user_id=user_id, sample_request_id=sid, read_at=now))


def _sample_conditions(
    search: str | None,
    status: str | None,
    category: str | None,
    created_from: str | None,
    created_to: str | None,
    category_value_id: str | None = None,
) -> list:
    """WHERE clauses shared by the page query, the total/unread counts and the
    color tallies — every number the samples page shows must be computed over
    the same filtered set, so they are built once here."""
    conds = []
    if search:
        like = f"%{search.strip().lower()}%"
        conds.append(or_(
            func.lower(SampleRequest.code).like(like),
            func.lower(SampleRequest.project).like(like),
            func.lower(SampleRequest.customer_article_code).like(like),
        ))
    if status and status != "ALL":
        conds.append(SampleRequest.status == status)
    # The UI filters by attribute value id (a renamed category keeps matching its rows);
    # ?category= is the legacy text/enum-key path kept for old deep links.
    if category_value_id and category_value_id != "ALL":
        conds.append(SampleRequest.category_value_id == category_value_id)
    elif category and category != "ALL":
        label = LEGACY_CATEGORY_LABELS.get(category, category)
        conds.append(func.coalesce(SampleRequest.category, DEFAULT_CATEGORY_LABEL) == label)
    # Date inputs emit yyyy-mm-dd; created_at is a timestamp, so the upper bound
    # is exclusive-next-midnight to keep the range inclusive on both ends.
    if created_from:
        conds.append(SampleRequest.created_at >= datetime.combine(date.fromisoformat(created_from), time.min))
    if created_to:
        conds.append(SampleRequest.created_at < datetime.combine(date.fromisoformat(created_to) + timedelta(days=1), time.min))
    return conds


@router.get("/samples", response_model=PaginatedSampleRequestResponse)
async def get_samples(
    search: str | None = None,
    status: str | None = None,
    category: str | None = None,
    category_value_id: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    focus_id: str | None = None,
    unread: bool = False,
    window: PageWindow = Depends(PageParams(default_size=50, max_size=200)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("sample_request.view")),
):
    conds = _sample_conditions(search, status, category, created_from, created_to, category_value_id)

    # "Never read" and "read before the last edit" are the same state, so both the
    # ?unread= filter and the badge count below read it off this one subquery.
    read_at_sq = (
        select(SampleRequestRead.read_at)
        .where(
            SampleRequestRead.user_id == current_user.id,
            SampleRequestRead.sample_request_id == SampleRequest.id,
        )
        .scalar_subquery()
    )
    is_unread_clause = or_(
        read_at_sq.is_(None),
        read_at_sq < func.coalesce(SampleRequest.updated_at, SampleRequest.created_at),
    )
    # Filtering narrows every number on the page — total, the pager and the colour
    # tallies all run off `conds`, so it goes in there rather than on the page query.
    if unread:
        conds.append(is_unread_clause)

    total = await db.scalar(select(func.count()).select_from(SampleRequest).where(*conds)) or 0

    # ORDER BY is (created_at DESC, id DESC) everywhere: created_at alone is not
    # unique, and an unstable order makes rows jump between pages.
    order_cols = (SampleRequest.created_at.desc(), SampleRequest.id.desc())

    # ?focus_id= (a ?highlight= deep link) must land on whatever page holds that
    # row under the current filters — compute its rank instead of scanning.
    if focus_id:
        target = (await db.execute(
            select(SampleRequest.created_at, SampleRequest.id)
            .where(SampleRequest.id == focus_id, *conds)
        )).first()
        if target:
            rank = await db.scalar(
                select(func.count()).select_from(SampleRequest).where(
                    *conds,
                    or_(
                        SampleRequest.created_at > target[0],
                        and_(SampleRequest.created_at == target[0], SampleRequest.id > target[1]),
                    ),
                )
            ) or 0
            # Snap the window onto whichever page currently holds that row.
            window = window.at_offset(rank)

    id_rows = await db.execute(
        window.apply(select(SampleRequest.id).where(*conds).order_by(*order_cols))
    )
    ids = [r[0] for r in id_rows.all()]

    samples: list = []
    if ids:
        result = await db.execute(
            select(SampleRequest)
            .options(selectinload(SampleRequest.colors), joinedload(SampleRequest.created_by).joinedload(User.role))
            .where(SampleRequest.id.in_(ids))
        )
        by_id = {s.id: s for s in result.unique().scalars().all()}
        samples = [by_id[i] for i in ids if i in by_id]

    _enrich_creator(samples)
    await _enrich_colors_with_items(db, samples)

    reads: dict = {}
    if ids:
        reads_result = await db.execute(
            select(SampleRequestRead.sample_request_id, SampleRequestRead.read_at).where(
                SampleRequestRead.user_id == current_user.id,
                SampleRequestRead.sample_request_id.in_(ids),
            )
        )
        reads = {str(r[0]): r[1] for r in reads_result.all()}

    for sample in samples:
        read_at = reads.get(str(sample.id))
        sample_updated_at = sample.updated_at or sample.created_at
        sample.is_unread = read_at is None or read_at < sample_updated_at

    # Unread badge counts the whole filtered set, not the page.
    unread_total = await db.scalar(
        select(func.count()).select_from(SampleRequest).where(*conds, is_unread_clause)
    ) or 0

    stat_rows = await db.execute(
        select(SampleColor.status, func.count())
        .select_from(SampleColor)
        .join(SampleRequest, SampleColor.sample_request_id == SampleRequest.id)
        .where(*conds)
        .group_by(SampleColor.status)
    )
    color_stats = SampleColorStats()
    for st, cnt in stat_rows.all():
        color_stats.total += cnt
        key = st or "PENDING"
        if hasattr(color_stats, key):
            setattr(color_stats, key, getattr(color_stats, key) + cnt)

    return window.envelope(samples, total, unread=unread_total, color_stats=color_stats)


@router.get("/samples/codes", response_model=list[str])
async def get_sample_codes(
    prefix: str = "",
    limit: int = 2000,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("sample_request.view", "item.view")),
):
    """Codes matching a prefix, for client-side next-free-code suggestion.
    The list is paginated now, so the create form can no longer test candidate
    codes against the in-memory page."""
    q = select(SampleRequest.code)
    if prefix:
        escaped = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        q = q.where(SampleRequest.code.like(f"{escaped}%", escape="\\"))
    rows = await db.execute(q.order_by(SampleRequest.code).limit(max(1, min(limit, 10000))))
    return [r[0] for r in rows.all()]


@router.get("/samples/report", response_model=SampleDevelopmentReport)
async def get_sample_development_report(
    date_from: str | None = None,
    date_to: str | None = None,
    customer_id: str | None = None,
    category_value_id: str | None = None,
    group_by: str = "customer",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("sample_request.view")),
):
    """Sample development activity over a date range, at attempt grain.

    Answers the client's question directly: in this window, how many variants did
    we touch, how many times did we run the sample process, how many times was a
    variant rejected, how many times approved. Counts are event rows
    (`sample_color_events`), NOT current statuses — a variant rejected twice before
    approval contributes 2 rejects, 1 approval and 3 processes, and it lands in
    whichever window each attempt happened in. The range is on the event's own
    timestamp; SampleRequest.updated_at is unusable here because any edit bumps it.
    """
    if group_by not in ("customer", "category", "month"):
        raise HTTPException(status_code=400, detail="group_by must be customer, category or month")

    conds = []
    if date_from:
        conds.append(SampleColorEvent.created_at >= datetime.combine(date.fromisoformat(date_from), time.min))
    if date_to:
        # Inclusive upper bound: date inputs are yyyy-mm-dd against a timestamp column.
        conds.append(SampleColorEvent.created_at < datetime.combine(date.fromisoformat(date_to) + timedelta(days=1), time.min))
    if customer_id:
        conds.append(SampleRequest.customer_id == customer_id)
    if category_value_id and category_value_id != "ALL":
        conds.append(SampleRequest.category_value_id == category_value_id)

    def _c(event: str):
        """Count of one event kind inside the grouped set (0, never NULL)."""
        return func.coalesce(func.sum(case((SampleColorEvent.event == event, 1), else_=0)), 0)

    processes_expr = _c("IN_PRODUCTION")
    sent_expr = _c("SENT")
    approvals_expr = _c("APPROVED")
    rejects_expr = _c("REJECTED")

    totals_row = (await db.execute(
        select(
            func.count(func.distinct(SampleColorEvent.sample_color_id)),
            func.count(func.distinct(SampleColorEvent.sample_request_id)),
            processes_expr, sent_expr, approvals_expr, rejects_expr,
        ).select_from(SampleColorEvent)
        .join(SampleRequest, SampleRequest.id == SampleColorEvent.sample_request_id)
        .where(*conds)
    )).first()

    variants, requests, processes, sent, approvals, rejects = (
        totals_row if totals_row else (0, 0, 0, 0, 0, 0)
    )
    decided = (approvals or 0) + (rejects or 0)
    totals = SampleReportTotals(
        variants=variants or 0,
        requests=requests or 0,
        processes=processes or 0,
        sent=sent or 0,
        approvals=approvals or 0,
        rejects=rejects or 0,
        # Share of decided attempts that passed — reject rate is its complement.
        approval_rate=round((approvals or 0) * 100.0 / decided, 1) if decided else 0.0,
        # Process runs per variant touched: >1 means remakes are the norm.
        avg_processes_per_variant=round((processes or 0) / variants, 2) if variants else 0.0,
    )

    # Variant grain: one row per sample variant that saw activity in the window.
    row_result = await db.execute(
        select(
            SampleColor.id,
            SampleColor.name,
            SampleColor.is_repeat,
            SampleColor.status,
            SampleRequest.id,
            SampleRequest.code,
            SampleRequest.project,
            SampleRequest.customer_article_code,
            SampleRequest.category,
            Partner.name,
            processes_expr, sent_expr, approvals_expr, rejects_expr,
            func.max(SampleColorEvent.created_at),
        )
        .select_from(SampleColorEvent)
        .join(SampleColor, SampleColor.id == SampleColorEvent.sample_color_id)
        .join(SampleRequest, SampleRequest.id == SampleColorEvent.sample_request_id)
        .join(Partner, Partner.id == SampleRequest.customer_id, isouter=True)
        .where(*conds)
        .group_by(
            SampleColor.id, SampleColor.name, SampleColor.is_repeat, SampleColor.status,
            SampleRequest.id, SampleRequest.code, SampleRequest.project,
            SampleRequest.customer_article_code, SampleRequest.category, Partner.name,
        )
        .order_by(func.max(SampleColorEvent.created_at).desc())
    )
    rows = [
        SampleReportVariantRow(
            color_id=r[0], variant_name=r[1], is_repeat=r[2], status=r[3],
            sample_id=r[4], sample_code=r[5], project=r[6],
            customer_article_code=r[7], category=r[8], customer_name=r[9],
            processes=r[10] or 0, sent=r[11] or 0, approvals=r[12] or 0, rejects=r[13] or 0,
            last_event_at=r[14],
        )
        for r in row_result.all()
    ]

    # One aggregate tier so the report reads without client-side rollups.
    if group_by == "customer":
        label_col = func.coalesce(Partner.name, "(No customer)")
    elif group_by == "category":
        label_col = func.coalesce(SampleRequest.category, DEFAULT_CATEGORY_LABEL)
    else:
        label_col = func.to_char(SampleColorEvent.created_at, "YYYY-MM")

    group_result = await db.execute(
        select(
            label_col,
            func.count(func.distinct(SampleColorEvent.sample_color_id)),
            processes_expr, sent_expr, approvals_expr, rejects_expr,
        )
        .select_from(SampleColorEvent)
        .join(SampleRequest, SampleRequest.id == SampleColorEvent.sample_request_id)
        .join(Partner, Partner.id == SampleRequest.customer_id, isouter=True)
        .where(*conds)
        .group_by(label_col)
        .order_by(label_col)
    )
    groups = []
    for g in group_result.all():
        g_decided = (g[4] or 0) + (g[5] or 0)
        groups.append(SampleReportGroupRow(
            label=g[0] or "—",
            variants=g[1] or 0,
            processes=g[2] or 0,
            sent=g[3] or 0,
            approvals=g[4] or 0,
            rejects=g[5] or 0,
            approval_rate=round((g[4] or 0) * 100.0 / g_decided, 1) if g_decided else 0.0,
        ))

    return SampleDevelopmentReport(
        date_from=date_from,
        date_to=date_to,
        group_by=group_by,
        totals=totals,
        rows=rows,
        groups=groups,
    )


@router.get("/samples/{sample_id}/colors/{color_id}/events", response_model=list[SampleColorEventResponse])
async def get_color_events(
    sample_id: str,
    color_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("sample_request.view")),
):
    """Full attempt history for one variant — drives the "rejected 2x" drill-down."""
    rows = await db.execute(
        select(SampleColorEvent, User.full_name)
        .join(User, User.id == SampleColorEvent.created_by_id, isouter=True)
        .join(SampleColor, SampleColor.id == SampleColorEvent.sample_color_id)
        .where(
            SampleColorEvent.sample_color_id == color_id,
            SampleColor.sample_request_id == sample_id,
        )
        .order_by(SampleColorEvent.created_at)
    )
    out = []
    for ev, user_name in rows.all():
        ev.created_by_name = user_name
        out.append(ev)
    return out


@router.put("/samples/{sample_id}", response_model=SampleRequestResponse)
async def update_sample_request(
    sample_id: str,
    payload: SampleRequestUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    result = await db.execute(
        select(SampleRequest)
        .options(joinedload(SampleRequest.colors))
        .filter(SampleRequest.id == sample_id)
    )
    sample = result.unique().scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    req_date = date.fromisoformat(payload.request_date) if payload.request_date else date.today()
    est_date = date.fromisoformat(payload.estimated_completion_date) if payload.estimated_completion_date else None

    sample.customer_id = payload.customer_id
    sample.request_date = req_date
    sample.project = payload.project
    sample.customer_article_code = payload.customer_article_code
    sample.internal_article_code = payload.internal_article_code
    sample.width = payload.width
    sample.variant_type = payload.variant_type
    sample.category_value_id, sample.category = await _resolve_sample_category(
        db, payload.category_value_id, payload.category
    )
    sample.main_material = payload.main_material
    sample.middle_material = payload.middle_material
    sample.bottom_material = payload.bottom_material
    sample.weft = payload.weft
    sample.warp = payload.warp
    sample.original_weight = payload.original_weight
    sample.original_weight_unit = payload.original_weight_unit
    sample.production_weight = payload.production_weight
    sample.production_weight_unit = payload.production_weight_unit
    sample.additional_info = payload.additional_info
    sample.quantity = payload.quantity
    sample.sample_size = payload.sample_size
    sample.estimated_completion_date = est_date
    sample.completion_description = payload.completion_description
    sample.notes = payload.notes
    sample.updated_at = datetime.utcnow()
    await _mark_read(db, current_user.id, sample.id, sample.updated_at)

    # Colors diff: keep existing ids, delete removed, insert new
    incoming_ids = {str(c.id) for c in payload.colors if c.id is not None}
    for existing_color in list(sample.colors):
        if str(existing_color.id) not in incoming_ids:
            await db.delete(existing_color)

    for i, color_data in enumerate(payload.colors):
        if not color_data.name.strip():
            continue
        if color_data.id is not None:
            color_result = await db.execute(
                select(SampleColor).filter(SampleColor.id == color_data.id)
            )
            existing = color_result.scalars().first()
            if existing:
                existing.name = color_data.name.strip()
                existing.is_repeat = color_data.is_repeat
                existing.order = i
        else:
            db.add(SampleColor(
                sample_request_id=sample.id,
                name=color_data.name.strip(),
                is_repeat=color_data.is_repeat,
                order=i,
            ))

    await db.commit()

    result = await db.execute(
        select(SampleRequest)
        .options(joinedload(SampleRequest.colors), joinedload(SampleRequest.created_by).joinedload(User.role))
        .filter(SampleRequest.id == sample_id)
    )
    sample = result.unique().scalars().first()
    _enrich_creator([sample])

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="SampleRequest",
        entity_id=sample_id,
        details=f"Updated Sample Request {sample.code}",
        changes={"customer_article_code": sample.customer_article_code},
    )

    await _enrich_colors_with_items(db, [sample])
    sample.is_unread = False
    return sample


@router.put("/samples/{sample_id}/status")
async def update_sample_status(
    sample_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.update_status')),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    valid_statuses = ["DRAFT", "IN_PRODUCTION", "SENT", "PENDING_APPROVAL", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    previous_status = sample.status
    sample.status = status
    sample.updated_at = datetime.utcnow()
    await _mark_read(db, current_user.id, sample.id, sample.updated_at)
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_STATUS",
        entity_type="SampleRequest",
        entity_id=sample_id,
        details=f"Updated Sample {sample.code} status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )

    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": f"Sample updated to {status}"}


@router.put("/samples/{sample_id}/colors/{color_id}/status", response_model=SampleColorResponse)
async def update_color_status(
    sample_id: str,
    color_id: str,
    status: str,
    reason: str | None = None,
    notes: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.update_status')),
):
    result = await db.execute(
        select(SampleColor).filter(SampleColor.id == color_id, SampleColor.sample_request_id == sample_id)
    )
    color = result.scalars().first()
    if not color:
        raise HTTPException(status_code=404, detail="Color not found")

    valid_statuses = ["PENDING", "IN_PRODUCTION", "SENT", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    # APPROVED is terminal — the shade is signed off and its item lineage is minted.
    if color.status == "APPROVED":
        raise HTTPException(status_code=400, detail="Approved color status is locked and cannot be changed")
    # REJECTED rests but is reopenable: the only exit is back to IN_PRODUCTION for
    # another attempt (same rule as lab dip variants). Every attempt is a new event
    # row, which is what makes "rejected N times" countable in the report.
    if color.status == "REJECTED" and status != "IN_PRODUCTION":
        raise HTTPException(status_code=400, detail="A rejected color can only be reopened to In Production")

    previous_status = color.status
    now = datetime.utcnow()
    reason_v = (reason or "").strip() or None
    notes_v = (notes or "").strip() or None

    color.status = status
    if status == "REJECTED":
        color.rejection_reason = reason_v
        color.rejection_notes = notes_v
    else:
        color.rejection_reason = None
        color.rejection_notes = None
    # Approval note is the mirror of the rejection one; both sides also take a photo,
    # uploaded straight after this call. Only the current status' pair is kept on the
    # variant — the per-round copies live on the event rows.
    color.approval_notes = notes_v if status == "APPROVED" else None
    if status != "APPROVED":
        color.approval_image_url = None
    if status != "REJECTED":
        color.rejection_image_url = None

    # Own timestamps + attempt tallies. The parent's updated_at moves on any edit, so
    # the report dates a variant only from these and from the event rows.
    color.status_updated_at = now
    if status == "IN_PRODUCTION":
        color.process_count = (color.process_count or 0) + 1
        color.first_process_at = color.first_process_at or now
        color.last_process_at = now
    elif status == "SENT":
        color.sent_at = now
    elif status == "APPROVED":
        color.approve_count = (color.approve_count or 0) + 1
        color.approved_at = now
    elif status == "REJECTED":
        color.reject_count = (color.reject_count or 0) + 1
        color.rejected_at = now
        # A reopened variant is rejected again later; the previous rejected_at is
        # overwritten on purpose — the event log keeps every round.

    prior_same = await db.scalar(
        select(func.count()).select_from(SampleColorEvent).where(
            SampleColorEvent.sample_color_id == color.id,
            SampleColorEvent.event == status,
        )
    ) or 0
    db.add(SampleColorEvent(
        sample_color_id=color.id,
        sample_request_id=color.sample_request_id,
        event=status,
        previous_status=previous_status,
        round_no=prior_same + 1,
        reason=reason_v,
        notes=notes_v,
        created_by_id=current_user.id,
    ))

    # Bump parent sample's updated_at so all users see it as unread
    parent_result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    parent_sample = parent_result.scalars().first()
    if parent_sample:
        parent_sample.updated_at = datetime.utcnow()
        await _mark_read(db, current_user.id, parent_sample.id, parent_sample.updated_at)

    await db.commit()
    await db.refresh(color)
    color.item_id = None
    color.item_code = None

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_COLOR_STATUS",
        entity_type="SampleColor",
        entity_id=color_id,
        details=f"Updated color '{color.name}' status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )
    return color


@router.post("/samples/{sample_id}/read")
async def mark_sample_read(
    sample_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    await _mark_read(db, current_user.id, sample_id)
    await db.commit()
    return {"status": "success"}


@router.delete("/samples/{sample_id}/read")
async def mark_sample_unread(
    sample_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    result = await db.execute(
        select(SampleRequestRead).filter(
            SampleRequestRead.user_id == current_user.id,
            SampleRequestRead.sample_request_id == uuid.UUID(sample_id),
        )
    )
    read_record = result.scalars().first()
    if read_record:
        await db.delete(read_record)
        await db.commit()
    return {"status": "success"}


@router.post("/samples/read-all")
async def mark_all_samples_read(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    await db.execute(
        delete(SampleRequestRead).where(SampleRequestRead.user_id == current_user.id)
    )
    samples_result = await db.execute(select(SampleRequest.id))
    now = datetime.utcnow()
    for row in samples_result.all():
        db.add(SampleRequestRead(
            user_id=current_user.id,
            sample_request_id=row[0],
            read_at=now,
        ))
    await db.commit()
    return {"status": "success"}


@router.post("/samples/{sample_id}/completion-image")
async def upload_completion_image(
    sample_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    upload_dir = Path("static/samples")
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext == ".jpeg":
        ext = ".jpg"
    file_path = upload_dir / f"{sample_id}_completion{ext}"
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    sample.completion_image_url = f"/static/samples/{sample_id}_completion{ext}"
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "SampleRequest", sample_id, details="Uploaded completion image")
    return {"completion_image_url": sample.completion_image_url}


@router.post("/samples/{sample_id}/colors/{color_id}/status-image")
async def upload_color_status_image(
    sample_id: str,
    color_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.update_status')),
):
    """One proof photo for the variant's current approval/rejection.

    Called right after the status PUT, so the side is read from the variant's status
    rather than passed in. The file name carries the round number, so reopening and
    rejecting again does not overwrite the photo an earlier event row points at.
    """
    result = await db.execute(
        select(SampleColor).filter(SampleColor.id == color_id, SampleColor.sample_request_id == sample_id)
    )
    color = result.scalars().first()
    if not color:
        raise HTTPException(status_code=404, detail="Color not found")
    if color.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="A photo can only be attached to an approved or rejected color")

    # Newest event for this variant = the transition this photo belongs to.
    ev_result = await db.execute(
        select(SampleColorEvent)
        .where(SampleColorEvent.sample_color_id == color.id)
        .order_by(SampleColorEvent.created_at.desc(), SampleColorEvent.round_no.desc())
        .limit(1)
    )
    event = ev_result.scalars().first()
    round_no = event.round_no if event else 1

    upload_dir = Path("static/samples")
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext == ".jpeg":
        ext = ".jpg"
    kind = "approval" if color.status == "APPROVED" else "rejection"
    filename = f"{color_id}_{kind}_{round_no}{ext}"
    file_path = upload_dir / filename
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    url = f"/static/samples/{filename}"
    if color.status == "APPROVED":
        color.approval_image_url = url
    else:
        color.rejection_image_url = url
    if event:
        event.image_url = url

    await db.commit()
    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_COLOR_STATUS",
        entity_type="SampleColor",
        entity_id=color_id,
        details=f"Attached {kind} photo to color '{color.name}'",
        changes={"image_url": url},
    )
    return {"image_url": url}


@router.post("/samples/{sample_id}/design-pdf")
async def upload_design_pdf(
    sample_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.edit')),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    upload_dir = Path("static/samples")
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(file.filename).suffix.lower() if file.filename else ".pdf"
    file_path = upload_dir / f"{sample_id}_design{ext}"
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    sample.design_pdf_url = f"/static/samples/{sample_id}_design{ext}"
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "SampleRequest", sample_id, details="Uploaded design PDF")
    return {"design_pdf_url": sample.design_pdf_url}


@router.delete("/samples/{sample_id}")
async def delete_sample(
    sample_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('sample_request.delete')),
):
    result = await db.execute(select(SampleRequest).filter(SampleRequest.id == sample_id))
    sample = result.scalars().first()
    if not sample:
        raise HTTPException(status_code=404, detail="Sample not found")

    details = f"Deleted Sample {sample.code}"
    await db.delete(sample)
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="SampleRequest",
        entity_id=sample_id,
        details=details,
    )

    await kpi_service.invalidate_and_broadcast(db, {"type": "KPI_UPDATE"})

    return {"status": "success", "message": "Sample deleted"}
