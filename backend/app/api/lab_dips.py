import os
import shutil
import uuid as uuid_lib
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text, func, case, or_, and_, update as sa_update
from sqlalchemy.orm import joinedload
from app.db.session import get_async_db
from app.models.lab_dip import (
    LabDipRequest, LabDipItem, LabDipLine, LabDipRejection, LabDipItemEvent,
)
from app.models.color import Color
from app.models.item import Item as ItemModel
from app.models.partner import Partner
from app.models.attribute import Attribute, AttributeValue
from app.models.manufacturing import ManufacturingOrder
from app.models.sales import SalesOrderLine
from app.schemas import (
    LabDipRequestCreate, LabDipRequestUpdate, LabDipRequestResponse, LabDipLineResponse,
    PaginatedLabDipRequestResponse,
    LabDipDevelopmentReport, LabDipReportTotals, LabDipReportVariantRow, LabDipReportGroupRow,
)
from app.core.pagination import PageParams, PageWindow
from app.models.auth import User
from app.api.auth import get_current_user, require_permission, require_any_permission
from app.services import audit_service
from app.core.ws_manager import manager
from datetime import datetime, date, time, timedelta

router = APIRouter()


def _parse_date(value, default=None):
    return date.fromisoformat(value) if value else default


def _load_full(request_id):
    """Query loading a request with its items→dips and any ungrouped dips."""
    return (
        select(LabDipRequest)
        .options(
            joinedload(LabDipRequest.items).joinedload(LabDipItem.dips),
            joinedload(LabDipRequest.items).joinedload(LabDipItem.item),
            joinedload(LabDipRequest.items).joinedload(LabDipItem.rejections),
            joinedload(LabDipRequest.dips),
        )
        .filter(LabDipRequest.id == request_id)
    )


def _seq_part(req) -> str:
    """The numeric part of a request code, namespaced by book.

    FG:   LD-2026-00003  → '00003'
    YARN: LDY-2026-00003 → 'Y00003'

    Both books run their own sequence from 1, so the raw number collides across them.
    Every derived identity hangs off this string — the variant code ('Y00003-A'), the
    minted Color Library code ('Y00003-A-2', UNIQUE), and the MO/SO `labdip_variant_code`
    backfill match. Without the marker a yarn approval would be blocked by an unrelated
    FG shade of the same number, and would stamp its color onto FG rows awaiting theirs.
    """
    raw = req.code.rsplit("-", 1)[-1] if req and req.code else ""
    return f"Y{raw}" if req is not None and getattr(req, "kind", "FG") == "YARN" else raw


def _variant_letter(seq: int) -> str:
    """0 → A, 1 → B, … 25 → Z, 26 → AA (spreadsheet-column style)."""
    s = ""
    n = seq + 1
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


async def _picked_color_variant_value_ids(db: AsyncSession, request_id, item_id) -> list:
    """`Colors` (system_role='color') AttributeValue ids the request picked for this variant.

    A dip's `color_name` is a value of the `Colors` variant attribute (that's what the
    request's ③ Colors picker offers), so the shade minted on approval can inherit the
    variant it was dipped for. The item's own dips win; otherwise the request-level picks
    (which apply to every item) are used. Order follows dip order, duplicates dropped.
    """
    lines = (await db.execute(
        select(LabDipLine.color_name, LabDipLine.lab_dip_item_id)
        .filter(LabDipLine.lab_dip_request_id == request_id)
        .order_by(LabDipLine.order)
    )).all()
    own = [n.strip() for n, iid in lines if iid is not None and str(iid) == str(item_id) and n and n.strip()]
    shared = [n.strip() for n, iid in lines if iid is None and n and n.strip()]
    names = own or shared
    if not names:
        return []
    rows = (await db.execute(
        select(AttributeValue.id, AttributeValue.value)
        .join(Attribute, AttributeValue.attribute_id == Attribute.id)
        .filter(Attribute.system_role == "color", AttributeValue.value.in_(names))
    )).all()
    by_name = {value: vid for vid, value in rows}
    out: list = []
    for n in names:
        vid = by_name.get(n)
        if vid is not None and vid not in out:
            out.append(vid)
    return out


def _decorate(req: LabDipRequest) -> LabDipRequest:
    """Attach the derived variant_code (e.g. '00001-A', yarn 'Y00001-A') and item name/code."""
    seq_part = _seq_part(req)
    for it in (req.items or []):
        it.variant_code = it.locked_variant_code or f"{seq_part}-{_variant_letter(it.variant_seq)}"
        # Full approved code appends the free-text "set" captured at approval.
        it.approved_color_code = f"{it.variant_code}-{it.approved_set}" if it.approved_set else None
        it.item_code = it.item.code if it.item else None
        it.item_name = it.item.name if it.item else None
        it.rejection_count = len(it.rejections or [])
    return req


async def _next_code(db: AsyncSession, kind: str = "FG") -> str:
    """Mint the next request code from the persistent DB sequence for this book.

    A plain COUNT(*)+1 (or max+1) frees a number when a request is deleted, so a
    later create can reuse it — colliding with the UNIQUE constraint (deleting a
    middle row) or silently reissuing an old item code (deleting the top row).
    The sequences only ever advance, so a number is never handed out twice
    regardless of deletions, and nextval is atomic under concurrency.

    FG and YARN draw separate sequences on purpose: the client wants a fresh yarn
    numbering series, not yarn numbers gapped around finished-goods ones.
    """
    seq = "lab_dip_yarn_request_seq" if kind == "YARN" else "lab_dip_request_seq"
    prefix = "LDY" if kind == "YARN" else "LD"
    result = await db.execute(text(f"SELECT nextval('{seq}')"))
    n = result.scalar_one()
    return f"{prefix}-{datetime.now().year}-{str(n).zfill(5)}"


@router.post("/lab-dips", response_model=LabDipRequestResponse)
async def create_lab_dip_request(
    payload: LabDipRequestCreate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.create')),
):
    kind = "YARN" if (payload.kind or "FG").upper() == "YARN" else "FG"
    code = await _next_code(db, kind)

    now = datetime.utcnow()
    req = LabDipRequest(
        code=code,
        kind=kind,
        customer_id=payload.customer_id,
        base_item_id=payload.base_item_id,
        approved_recipe_id=payload.approved_recipe_id,
        color_id=payload.color_id,
        request_date=_parse_date(payload.request_date, date.today()),
        season=payload.season,
        customer_article_code=payload.customer_article_code,
        internal_article_code=payload.internal_article_code,
        substrate=payload.substrate,
        color_standard=payload.color_standard,
        request_type=payload.request_type,
        due_date=_parse_date(payload.due_date),
        estimated_completion_date=_parse_date(payload.estimated_completion_date),
        notes=payload.notes,
        status="DRAFT",
        updated_at=now,
    )
    db.add(req)
    await db.flush()

    # Per-item groups, each with its own dips. New request → variant_seq == position.
    for gi, group in enumerate(payload.items):
        item = LabDipItem(lab_dip_request_id=req.id, item_id=group.item_id, order=gi, variant_seq=gi, locked_variant_code=group.locked_variant_code)
        db.add(item)
        await db.flush()
        for i, dip in enumerate(group.dips):
            if dip.color_name.strip():
                db.add(LabDipLine(
                    lab_dip_request_id=req.id,
                    lab_dip_item_id=item.id,
                    color_name=dip.color_name.strip(),
                    color_id=dip.color_id,
                    submission_round=dip.submission_round,
                    recipe_ref=dip.recipe_ref,
                    order=i,
                ))

    # Legacy/ungrouped dips sent at the request level (no item).
    for i, dip in enumerate(payload.dips):
        if dip.color_name.strip():
            db.add(LabDipLine(
                lab_dip_request_id=req.id,
                color_name=dip.color_name.strip(),
                color_id=dip.color_id,
                submission_round=dip.submission_round,
                recipe_ref=dip.recipe_ref,
                order=i,
            ))

    await db.commit()

    result = await db.execute(_load_full(req.id))
    req = result.unique().scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="LabDipRequest",
        entity_id=str(req.id),
        details=f"Created Lab Dip Request {req.code}",
        changes={"code": req.code, "color_standard": req.color_standard},
    )
    return _decorate(req)


def _labdip_conditions(
    kind_v: str,
    search: str | None,
    status: str | None,
    created_from: str | None,
    created_to: str | None,
) -> list:
    """WHERE clauses shared by the page query, the total count and the focus rank.

    Built once so all three see the same filtered set — a count computed over
    different filters than the rows makes the pager disagree with the table.
    `search` mirrors the view's old client-side matcher exactly: code, color
    standard, customer article code.
    """
    conds = [LabDipRequest.kind == kind_v]
    if search and search.strip():
        like = f"%{search.strip().lower()}%"
        conds.append(or_(
            func.lower(LabDipRequest.code).like(like),
            func.lower(LabDipRequest.color_standard).like(like),
            func.lower(LabDipRequest.customer_article_code).like(like),
        ))
    if status and status != "ALL":
        conds.append(LabDipRequest.status == status)
    # The date inputs emit yyyy-mm-dd against a timestamp column, so the upper
    # bound is exclusive-next-midnight to keep the range inclusive at both ends.
    if created_from:
        conds.append(LabDipRequest.created_at >= datetime.combine(date.fromisoformat(created_from), time.min))
    if created_to:
        conds.append(LabDipRequest.created_at < datetime.combine(date.fromisoformat(created_to) + timedelta(days=1), time.min))
    return conds


@router.get("/lab-dips", response_model=PaginatedLabDipRequestResponse)
async def get_lab_dips(
    kind: str = "FG",
    search: str | None = None,
    status: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    focus_id: str | None = None,
    window: PageWindow = Depends(PageParams(default_size=100)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lab_dip_request.view", "yarn_lab_dip.view", "dye_recipe.view")),
):
    """One page of lab dip requests from one numbering book.

    Server-paginated + server-filtered: this used to return a bare list capped at
    100 rows with no total, and the page then paginated client-side over just those
    100 — request #101 was unreachable however far you clicked. Filters live here now
    so the window is taken over the whole matching set, not over the first page.
    """
    # Two separate books; a caller always gets one. Defaults to FG so existing
    # callers (and the finished-goods page) are unchanged.
    kind_v = "YARN" if kind.upper() == "YARN" else "FG"
    conds = _labdip_conditions(kind_v, search, status, created_from, created_to)

    total = await db.scalar(
        select(func.count()).select_from(LabDipRequest).where(*conds)
    ) or 0

    # Last-touched first — updated_at is bumped by any item status change, so a
    # freshly rejected/reopened request floats to the top. This is the order the
    # view used to apply client-side; with a server window it has to be the server's
    # order, or page 1 would hold the newest-*created* rows instead. `id` breaks ties
    # so rows never jump between pages; legacy rows with no updated_at fall back to
    # created_at rather than sorting as NULL.
    sort_key = func.coalesce(LabDipRequest.updated_at, LabDipRequest.created_at)
    order_cols = (sort_key.desc(), LabDipRequest.id.desc())

    # ?focus_id= (the Color Library "From Lab Dip" deep link) has to reach a request
    # that may sit on any page — so rank it under the active filters and report the
    # page that holds it as `focus_page`.
    #
    # The rank goes through `window.at_offset()` (the shared "land on the page holding
    # this row" primitive) but the RESULT IS NOT assigned to `window`, unlike
    # get_samples: the frontend hook keeps its params (focus_id included) for the whole
    # session, so a window that snapped on every request would pin the user to that one
    # page forever. Reporting the page instead lets the client jump once and then page
    # freely.
    focus_page = None
    if focus_id:
        try:
            focus_uuid = uuid_lib.UUID(str(focus_id))
        except ValueError:
            focus_uuid = None
        if focus_uuid is not None:
            target = (await db.execute(
                select(sort_key, LabDipRequest.id).where(LabDipRequest.id == focus_uuid, *conds)
            )).first()
            if target:
                rank = await db.scalar(
                    select(func.count()).select_from(LabDipRequest).where(
                        *conds,
                        or_(
                            sort_key > target[0],
                            and_(sort_key == target[0], LabDipRequest.id > target[1]),
                        ),
                    )
                ) or 0
                focus_page = window.at_offset(rank).page

    # Two-step (ids, then rows): the window has to slice REQUESTS, and the eager
    # loads below fan each request out into many joined rows. Same shape as
    # get_samples in api/samples.py.
    id_rows = await db.execute(
        window.apply(select(LabDipRequest.id).where(*conds).order_by(*order_cols))
    )
    ids = [r[0] for r in id_rows.all()]

    reqs: list = []
    if ids:
        result = await db.execute(
            select(LabDipRequest)
            .where(LabDipRequest.id.in_(ids))
            .options(
                joinedload(LabDipRequest.items).joinedload(LabDipItem.dips),
                joinedload(LabDipRequest.items).joinedload(LabDipItem.item),
                joinedload(LabDipRequest.items).joinedload(LabDipItem.rejections),
                joinedload(LabDipRequest.dips),
            )
        )
        by_id = {r.id: r for r in result.unique().scalars().all()}
        reqs = [by_id[i] for i in ids if i in by_id]

    # Variant-grain tallies for the status bar. A request is a bag of per-color
    # variants each approved/rejected on its own, so the footer counts variants —
    # and it must count them over the whole FILTERED set, not the page, or the
    # numbers would shrink as you page through. Declared on the response model
    # (`variant_counts`), otherwise FastAPI drops the key silently.
    variant_counts = {"total": 0, "PENDING": 0, "IN_PROGRESS": 0, "APPROVED": 0, "REJECTED": 0}
    for st, n in (await db.execute(
        select(LabDipItem.status, func.count())
        .select_from(LabDipItem)
        .join(LabDipRequest, LabDipRequest.id == LabDipItem.lab_dip_request_id)
        .where(*conds)
        .group_by(LabDipItem.status)
    )).all():
        variant_counts["total"] += n
        key = st or "PENDING"
        if key in variant_counts:
            variant_counts[key] += n

    return window.envelope(
        [_decorate(r) for r in reqs], total,
        variant_counts=variant_counts, focus_page=focus_page,
    )


@router.get("/lab-dips/pending-variants")
async def get_pending_labdip_variants(
    item_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("lab_dip_request.view", "yarn_lab_dip.view", "dye_recipe.view")),
):
    """Lab dip variants for a finished good that are still in progress (not yet
    approved to a Color Library shade). Feeds the SO color picker so an order can be
    placed against a pending shade. Each row's variant_code is the stable identity
    (preserved across reject->resubmit) that later auto-backfills the minted color."""
    # The parent request rides along on the join — one query, not one per row.
    result = await db.execute(
        select(LabDipItem, LabDipRequest)
        .join(LabDipRequest, LabDipRequest.id == LabDipItem.lab_dip_request_id)
        .filter(
            LabDipItem.item_id == item_id,
            LabDipItem.status.in_(["PENDING", "IN_PROGRESS"]),
        )
        .order_by(LabDipRequest.created_at.desc())
    )
    out = []
    for it, parent in result.all():
        variant_code = it.locked_variant_code or f"{_seq_part(parent)}-{_variant_letter(it.variant_seq)}"
        out.append({
            "labdip_item_id": str(it.id),
            "variant_code": variant_code,
            "status": it.status,
            "request_id": str(it.lab_dip_request_id),
            "request_code": parent.code if parent else None,
        })
    return out


@router.get("/lab-dips/report", response_model=LabDipDevelopmentReport)
async def get_lab_dip_report(
    date_from: str | None = None,
    date_to: str | None = None,
    customer_id: str | None = None,
    kind: str = "ALL",
    group_by: str = "customer",
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.view')),
):
    """Lab dip activity over a date range, at attempt grain.

    Same question as the sample development report, one flow down: in this window, how
    many variants did we touch, how many times did we dip them, how many times was a
    variant rejected, how many times approved. Counts are event rows
    (`lab_dip_item_events`), NOT current statuses — a variant rejected twice before
    approval contributes 2 rejects, 1 approval and 3 dips, and it lands in whichever
    window each attempt happened in. The range is on the event's own timestamp;
    LabDipRequest.updated_at is unusable here because any edit bumps it.
    """
    if group_by not in ("customer", "kind", "month"):
        raise HTTPException(status_code=400, detail="group_by must be customer, kind or month")

    conds = []
    if date_from:
        conds.append(LabDipItemEvent.created_at >= datetime.combine(date.fromisoformat(date_from), time.min))
    if date_to:
        # Inclusive upper bound: date inputs are yyyy-mm-dd against a timestamp column.
        conds.append(LabDipItemEvent.created_at < datetime.combine(date.fromisoformat(date_to) + timedelta(days=1), time.min))
    if customer_id:
        conds.append(LabDipRequest.customer_id == customer_id)
    if kind and kind != "ALL":
        conds.append(LabDipRequest.kind == kind)

    def _c(event: str):
        """Count of one event kind inside the grouped set (0, never NULL)."""
        return func.coalesce(func.sum(case((LabDipItemEvent.event == event, 1), else_=0)), 0)

    dips_expr = _c("IN_PROGRESS")
    approvals_expr = _c("APPROVED")
    rejects_expr = _c("REJECTED")

    totals_row = (await db.execute(
        select(
            func.count(func.distinct(LabDipItemEvent.lab_dip_item_id)),
            func.count(func.distinct(LabDipItemEvent.lab_dip_request_id)),
            dips_expr, approvals_expr, rejects_expr,
        ).select_from(LabDipItemEvent)
        .join(LabDipRequest, LabDipRequest.id == LabDipItemEvent.lab_dip_request_id)
        .where(*conds)
    )).first()

    variants, requests, dips, approvals, rejects = totals_row if totals_row else (0, 0, 0, 0, 0)
    decided = (approvals or 0) + (rejects or 0)
    totals = LabDipReportTotals(
        variants=variants or 0,
        requests=requests or 0,
        dips=dips or 0,
        approvals=approvals or 0,
        rejects=rejects or 0,
        # Share of decided attempts that passed — reject rate is its complement.
        approval_rate=round((approvals or 0) * 100.0 / decided, 1) if decided else 0.0,
        # Dip runs per variant touched: >1 means re-dips are the norm.
        avg_dips_per_variant=round((dips or 0) / variants, 2) if variants else 0.0,
    )

    # Variant grain: one row per lab dip variant that saw activity in the window.
    row_result = await db.execute(
        select(
            LabDipItem.id,
            LabDipItem.status,
            LabDipItem.variant_seq,
            LabDipItem.locked_variant_code,
            LabDipItem.approved_set,
            LabDipRequest.id,
            LabDipRequest.code,
            LabDipRequest.kind,
            LabDipRequest.customer_article_code,
            LabDipRequest.season,
            ItemModel.code,
            ItemModel.name,
            Partner.name,
            dips_expr, approvals_expr, rejects_expr,
            func.max(LabDipItemEvent.created_at),
        )
        .select_from(LabDipItemEvent)
        .join(LabDipItem, LabDipItem.id == LabDipItemEvent.lab_dip_item_id)
        .join(LabDipRequest, LabDipRequest.id == LabDipItemEvent.lab_dip_request_id)
        .join(ItemModel, ItemModel.id == LabDipItem.item_id, isouter=True)
        .join(Partner, Partner.id == LabDipRequest.customer_id, isouter=True)
        .where(*conds)
        .group_by(
            LabDipItem.id, LabDipItem.status, LabDipItem.variant_seq,
            LabDipItem.locked_variant_code, LabDipItem.approved_set,
            LabDipRequest.id, LabDipRequest.code, LabDipRequest.kind,
            LabDipRequest.customer_article_code, LabDipRequest.season,
            ItemModel.code, ItemModel.name, Partner.name,
        )
        .order_by(func.max(LabDipItemEvent.created_at).desc())
    )
    rows = []
    for r in row_result.all():
        # Same derivation as _decorate(): the request's book-namespaced sequence part
        # plus the variant letter, unless the row carries a locked code from a resubmit.
        raw = r[6].rsplit("-", 1)[-1] if r[6] else ""
        seq_part = f"Y{raw}" if r[7] == "YARN" else raw
        variant_code = r[3] or f"{seq_part}-{_variant_letter(r[2] or 0)}"
        rows.append(LabDipReportVariantRow(
            item_id=r[0], variant_code=variant_code, item_code=r[10], item_name=r[11],
            status=r[1], request_id=r[5], request_code=r[6], kind=r[7],
            customer_name=r[12], customer_article_code=r[8], season=r[9],
            approved_color_code=f"{variant_code}-{r[4]}" if r[4] else None,
            dips=r[13] or 0, approvals=r[14] or 0, rejects=r[15] or 0,
            last_event_at=r[16],
        ))

    # One aggregate tier so the report reads without client-side rollups.
    if group_by == "customer":
        label_col = func.coalesce(Partner.name, "(No customer)")
    elif group_by == "kind":
        label_col = func.coalesce(LabDipRequest.kind, "FG")
    else:
        label_col = func.to_char(LabDipItemEvent.created_at, "YYYY-MM")

    group_result = await db.execute(
        select(
            label_col,
            func.count(func.distinct(LabDipItemEvent.lab_dip_item_id)),
            dips_expr, approvals_expr, rejects_expr,
        )
        .select_from(LabDipItemEvent)
        .join(LabDipRequest, LabDipRequest.id == LabDipItemEvent.lab_dip_request_id)
        .join(Partner, Partner.id == LabDipRequest.customer_id, isouter=True)
        .where(*conds)
        .group_by(label_col)
        .order_by(label_col)
    )
    groups = []
    for g in group_result.all():
        g_decided = (g[3] or 0) + (g[4] or 0)
        groups.append(LabDipReportGroupRow(
            label=g[0] or "—",
            variants=g[1] or 0,
            dips=g[2] or 0,
            approvals=g[3] or 0,
            rejects=g[4] or 0,
            approval_rate=round((g[3] or 0) * 100.0 / g_decided, 1) if g_decided else 0.0,
        ))

    return LabDipDevelopmentReport(
        date_from=date_from,
        date_to=date_to,
        group_by=group_by,
        totals=totals,
        rows=rows,
        groups=groups,
    )


@router.put("/lab-dips/{request_id}", response_model=LabDipRequestResponse)
async def update_lab_dip_request(
    request_id: str,
    payload: LabDipRequestUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.edit')),
):
    result = await db.execute(_load_full(request_id))
    req = result.unique().scalars().first()
    if not req:
        raise HTTPException(status_code=404, detail="Lab dip request not found")

    req.customer_id = payload.customer_id
    req.base_item_id = payload.base_item_id
    req.approved_recipe_id = payload.approved_recipe_id
    req.color_id = payload.color_id
    req.request_date = _parse_date(payload.request_date, date.today())
    req.season = payload.season
    req.customer_article_code = payload.customer_article_code
    req.internal_article_code = payload.internal_article_code
    req.substrate = payload.substrate
    req.color_standard = payload.color_standard
    req.request_type = payload.request_type
    req.due_date = _parse_date(payload.due_date)
    req.estimated_completion_date = _parse_date(payload.estimated_completion_date)
    req.notes = payload.notes
    req.updated_at = datetime.utcnow()

    # Diff items and their dips. Keep existing rows by id so dip statuses
    # (e.g. APPROVED) survive edits; delete rows dropped from the payload.
    existing_items = {str(it.id): it for it in req.items}
    existing_lines = {str(l.id): l for l in req.dips}

    incoming_item_ids = {str(g.id) for g in payload.items if g.id is not None}
    incoming_line_ids = {
        str(d.id)
        for g in payload.items for d in g.dips if d.id is not None
    } | {str(d.id) for d in payload.dips if d.id is not None}

    # Delete removed lines first (FK points at items), then removed items.
    for lid, line in existing_lines.items():
        if lid not in incoming_line_ids:
            await db.delete(line)
    for iid, item in existing_items.items():
        if iid not in incoming_item_ids:
            await db.delete(item)

    def _upsert_line(dip, order, item_id):
        if dip.id is not None and str(dip.id) in existing_lines:
            line = existing_lines[str(dip.id)]
            line.color_name = dip.color_name.strip()
            line.color_id = dip.color_id
            line.submission_round = dip.submission_round
            line.recipe_ref = dip.recipe_ref
            line.order = order
            line.lab_dip_item_id = item_id
        else:
            db.add(LabDipLine(
                lab_dip_request_id=req.id,
                lab_dip_item_id=item_id,
                color_name=dip.color_name.strip(),
                color_id=dip.color_id,
                submission_round=dip.submission_round,
                recipe_ref=dip.recipe_ref,
                order=order,
            ))

    # New items get a fresh variant_seq above every kept item's, so letters never
    # collide with or reshuffle existing ones (stable assignment).
    kept_seqs = [existing_items[str(g.id)].variant_seq for g in payload.items
                 if g.id is not None and str(g.id) in existing_items]
    next_seq = (max(kept_seqs) + 1) if kept_seqs else 0

    for gi, group in enumerate(payload.items):
        if group.id is not None and str(group.id) in existing_items:
            item = existing_items[str(group.id)]
            item.item_id = group.item_id
            item.order = gi
            item.locked_variant_code = group.locked_variant_code
        else:
            item = LabDipItem(lab_dip_request_id=req.id, item_id=group.item_id, order=gi, variant_seq=next_seq, locked_variant_code=group.locked_variant_code)
            next_seq += 1
            db.add(item)
            await db.flush()
        for i, dip in enumerate(group.dips):
            if dip.color_name.strip():
                _upsert_line(dip, i, item.id)

    # Legacy/ungrouped dips (no item).
    for i, dip in enumerate(payload.dips):
        if dip.color_name.strip():
            _upsert_line(dip, i, None)

    await db.commit()

    # expire_on_commit=False keeps the pre-mutation items/dips collections cached on
    # the identity-mapped instance; expire so the reload reflects the diffed state.
    db.expire_all()
    result = await db.execute(_load_full(request_id))
    req = result.unique().scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE",
        entity_type="LabDipRequest",
        entity_id=request_id,
        details=f"Updated Lab Dip Request {req.code}",
        changes={"color_standard": req.color_standard},
    )
    return _decorate(req)


@router.put("/lab-dips/{request_id}/items/{item_id}/status")
async def update_lab_dip_item_status(
    request_id: str,
    item_id: str,
    status: str,
    set_value: str | None = None,
    notes: str | None = None,
    reason: str | None = None,
    variant_attribute_value_id: str | None = None,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.update_status')),
):
    result = await db.execute(
        select(LabDipItem).filter(LabDipItem.id == item_id, LabDipItem.lab_dip_request_id == request_id)
    )
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Lab dip item not found")

    valid_statuses = ["PENDING", "IN_PROGRESS", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    # APPROVED is terminal — a minted shade can never be re-opened.
    if item.status == "APPROVED":
        raise HTTPException(status_code=400, detail="Variant is APPROVED and locked; its status cannot be changed")
    # REJECTED rests but is reopenable: the only exit is back to IN_PROGRESS for another
    # round. Re-rejecting or jumping straight to APPROVED from REJECTED is blocked.
    if item.status == "REJECTED" and status != "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="A rejected variant can only be reopened to IN_PROGRESS")

    parent_result = await db.execute(select(LabDipRequest).filter(LabDipRequest.id == request_id))
    parent = parent_result.scalars().first()

    minted_color_code = None
    backfilled_mo_ids: list[str] = []
    if status == "APPROVED":
        set_value = (set_value or "").strip()
        if not set_value:
            raise HTTPException(status_code=400, detail="A set index is required to approve a variant")

        seq_part = _seq_part(parent)
        code = f"{seq_part}-{_variant_letter(item.variant_seq)}-{set_value}"

        dup = await db.execute(select(Color).filter(Color.code == code))
        if dup.scalars().first():
            raise HTTPException(status_code=400, detail=f"Color code '{code}' already exists in the library")

        # Color Variant: the shade inherits the `Colors` variant it was dipped for, so the
        # Color Codes table shows the lab dip's variant instead of "—". An explicit pick
        # from the approve dialog wins; otherwise auto-resolve, and only when the request
        # picked exactly one variant (ambiguous multi-color requests stay unlinked).
        variant_value_id = None
        if variant_attribute_value_id:
            try:
                variant_value_id = uuid_lib.UUID(str(variant_attribute_value_id))
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid variant_attribute_value_id")
        else:
            candidates = await _picked_color_variant_value_ids(db, request_id, item.id)
            if len(candidates) == 1:
                variant_value_id = candidates[0]

        color = Color(
            code=code,
            name=code,  # the code is the shade identity; a friendly name is optional.
            notes=(notes or None),
            status="active",
            variant_attribute_value_id=variant_value_id,
            # A shade dipped for a customer belongs to that customer; without this the
            # library row reads as a House color. No customer on the request → House.
            customer_id=(parent.customer_id if parent else None),
        )
        db.add(color)
        await db.flush()

        # Option-A mirror: create + link a `Color Code` (labdip_color) AttributeValue so the
        # legacy LabDip color dropdown keeps resolving during the transition to the library.
        attr_id = (await db.execute(
            select(Attribute.id).filter(Attribute.system_role == "labdip_color")
        )).scalars().first()
        if attr_id is not None:
            av = AttributeValue(attribute_id=attr_id, value=code)
            db.add(av)
            await db.flush()
            color.attribute_value_id = av.id

        item.approved_set = set_value
        item.approved_color_id = color.id
        minted_color_code = code

        # Auto-backfill: any root MO / SO line ordered against this shade while it
        # was still in lab dip carries our variant_code (e.g. '00006-A'), preserved
        # across reject->resubmit via locked_variant_code. Now that the color is
        # minted, stamp it on those still-pending rows so the DYEING WO gate can
        # resolve the recipe. Only rows without a color_id yet are touched (a manual
        # MO override is never clobbered).
        variant_code = item.locked_variant_code or f"{seq_part}-{_variant_letter(item.variant_seq)}"
        mo_ids = (await db.execute(
            select(ManufacturingOrder.id).filter(
                ManufacturingOrder.labdip_variant_code == variant_code,
                ManufacturingOrder.color_id.is_(None),
            )
        )).scalars().all()
        if mo_ids:
            await db.execute(
                sa_update(ManufacturingOrder)
                .where(ManufacturingOrder.id.in_(mo_ids))
                .values(color_id=color.id)
            )
        await db.execute(
            sa_update(SalesOrderLine)
            .where(
                SalesOrderLine.labdip_variant_code == variant_code,
                SalesOrderLine.color_id.is_(None),
            )
            .values(color_id=color.id)
        )
        backfilled_mo_ids = [str(m) for m in mo_ids]

    if status == "REJECTED":
        reason_v = (reason or "").strip() or None
        notes_v = (notes or "").strip() or None
        # Mirror the latest reject onto the item for existing reads...
        item.rejection_reason = reason_v
        item.rejection_notes = notes_v
        # ...and append an immutable log row so every reject is preserved (the count of
        # these rows is the "rejected Nx" indicator, and it survives a later reopen).
        prior = (await db.execute(
            select(LabDipRejection).filter(LabDipRejection.lab_dip_item_id == item.id)
        )).scalars().all()
        db.add(LabDipRejection(
            lab_dip_item_id=item.id,
            round_no=len(prior) + 1,
            reason=reason_v,
            notes=notes_v,
            rejected_by=current_user.id,
        ))

    previous_status = item.status
    item.status = status

    # Proof photos follow the current status only; the per-round copies stay on the
    # event rows. Reopening a rejected variant drops its rejection photo.
    if status != "APPROVED":
        item.approval_image_url = None
    if status != "REJECTED":
        item.rejection_image_url = None

    # Attempt log for the Lab Dip Report. The item row only keeps its current status,
    # so every transition appends a row here; the counts survive a later reopen.
    prior_same = await db.scalar(
        select(func.count()).select_from(LabDipItemEvent).where(
            LabDipItemEvent.lab_dip_item_id == item.id,
            LabDipItemEvent.event == status,
        )
    ) or 0
    db.add(LabDipItemEvent(
        lab_dip_item_id=item.id,
        lab_dip_request_id=item.lab_dip_request_id,
        event=status,
        previous_status=previous_status,
        round_no=prior_same + 1,
        reason=(reason or "").strip() or None,
        notes=(notes or "").strip() or None,
        created_by_id=current_user.id,
    ))

    if parent:
        parent.updated_at = datetime.utcnow()

    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_ITEM_STATUS",
        entity_type="LabDipItem",
        entity_id=item_id,
        details=f"Updated lab dip item variant status from {previous_status} to {status}"
                + (f"; minted color {minted_color_code}" if minted_color_code else ""),
        changes={"status": status, "previous_status": previous_status, "approved_color_code": minted_color_code},
    )
    # Nudge the manufacturing UI so backfilled root MOs reflect their new color
    # (and their DYEING WO gate unblocks) without a manual refresh.
    for mo_id in backfilled_mo_ids:
        await manager.broadcast({"type": "MANUFACTURING_ORDER_UPDATE", "mo_id": mo_id})
    return {"status": "success", "color_code": minted_color_code, "backfilled_mo_count": len(backfilled_mo_ids)}


@router.post("/lab-dips/{request_id}/items/{item_id}/status-image")
async def upload_lab_dip_item_status_image(
    request_id: str,
    item_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.update_status')),
):
    """One proof photo for the variant's current approval/rejection.

    Called right after the status PUT, so the side is read from the variant's status
    rather than passed in. The file name carries the round number, so reopening and
    rejecting again does not overwrite the photo an earlier event row points at.
    Mirrors the sample-request colour flow.
    """
    result = await db.execute(
        select(LabDipItem).filter(LabDipItem.id == item_id, LabDipItem.lab_dip_request_id == request_id)
    )
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail="Lab dip item not found")
    if item.status not in ("APPROVED", "REJECTED"):
        raise HTTPException(status_code=400, detail="A photo can only be attached to an approved or rejected variant")

    ev_result = await db.execute(
        select(LabDipItemEvent)
        .where(LabDipItemEvent.lab_dip_item_id == item.id)
        .order_by(LabDipItemEvent.created_at.desc(), LabDipItemEvent.round_no.desc())
        .limit(1)
    )
    event = ev_result.scalars().first()
    round_no = event.round_no if event else 1

    upload_dir = Path("static/lab_dips")
    upload_dir.mkdir(parents=True, exist_ok=True)

    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if ext == ".jpeg":
        ext = ".jpg"
    kind = "approval" if item.status == "APPROVED" else "rejection"
    filename = f"{item_id}_{kind}_{round_no}{ext}"
    file_path = upload_dir / filename
    with file_path.open("wb") as buf:
        await run_in_threadpool(shutil.copyfileobj, file.file, buf)

    url = f"/static/lab_dips/{filename}"
    if item.status == "APPROVED":
        item.approval_image_url = url
    else:
        item.rejection_image_url = url
    if event:
        event.image_url = url

    await db.commit()
    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_ITEM_STATUS",
        entity_type="LabDipItem",
        entity_id=item_id,
        details=f"Attached {kind} photo to lab dip variant",
        changes={"image_url": url},
    )
    return {"image_url": url}


@router.put("/lab-dips/{request_id}/status")
async def update_lab_dip_status(
    request_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.update_status')),
):
    result = await db.execute(select(LabDipRequest).filter(LabDipRequest.id == request_id))
    req = result.scalars().first()
    if not req:
        raise HTTPException(status_code=404, detail="Lab dip request not found")

    valid_statuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    previous_status = req.status
    req.status = status
    req.updated_at = datetime.utcnow()
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_STATUS",
        entity_type="LabDipRequest",
        entity_id=request_id,
        details=f"Updated Lab Dip {req.code} status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )
    return {"status": "success", "message": f"Lab dip request updated to {status}"}


@router.put("/lab-dips/{request_id}/dips/{line_id}/status", response_model=LabDipLineResponse)
async def update_dip_status(
    request_id: str,
    line_id: str,
    status: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.update_status')),
):
    result = await db.execute(
        select(LabDipLine).filter(LabDipLine.id == line_id, LabDipLine.lab_dip_request_id == request_id)
    )
    line = result.scalars().first()
    if not line:
        raise HTTPException(status_code=404, detail="Dip not found")

    valid_statuses = ["PENDING", "APPROVED", "REJECTED", "RESUBMIT"]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail="Invalid status")

    if line.status == "APPROVED":
        raise HTTPException(status_code=400, detail="Approved dip status cannot be changed")

    previous_status = line.status
    line.status = status

    parent_result = await db.execute(select(LabDipRequest).filter(LabDipRequest.id == request_id))
    parent = parent_result.scalars().first()
    if parent:
        parent.updated_at = datetime.utcnow()

    await db.commit()
    await db.refresh(line)

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="UPDATE_DIP_STATUS",
        entity_type="LabDipLine",
        entity_id=line_id,
        details=f"Updated dip '{line.color_name}' status from {previous_status} to {status}",
        changes={"status": status, "previous_status": previous_status},
    )
    return line


@router.delete("/lab-dips/{request_id}")
async def delete_lab_dip_request(
    request_id: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission('lab_dip_request.delete')),
):
    result = await db.execute(select(LabDipRequest).filter(LabDipRequest.id == request_id))
    req = result.scalars().first()
    if not req:
        raise HTTPException(status_code=404, detail="Lab dip request not found")

    code = req.code
    await db.delete(req)
    await db.commit()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="LabDipRequest",
        entity_id=request_id,
        details=f"Deleted Lab Dip Request {code}",
        changes={"code": code},
    )
    return {"status": "success"}
