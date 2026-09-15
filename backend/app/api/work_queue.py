"""Work-center dispatch queue endpoint.

One read-only list per work-center type, priority-ordered and stamped with a
material-readiness verdict — the screen a Dyeing/Weaving/Beaming PIC keeps open.
All the logic lives in services/work_queue_service.py; this file is scoping,
paging and RBAC only.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from collections import Counter

from app.core.pagination import PageParams, PageWindow
from app.db.session import get_async_db
from app.models.auth import User
from app.api.auth import require_any_permission, wo_scope_ok
from app.schemas import WorkQueueResponse
from app.services import work_queue_service

router = APIRouter()


@router.get("/work-queue", response_model=WorkQueueResponse)
async def get_work_queue(
    center_type: str = Query("", description="DYEING / WEAVING / BEAMING / ... (aliases resolved)"),
    work_center_id: str = Query("", description="Narrow to a single machine"),
    verdict: str = Query("", description="Filter to one verdict, or READY_ONLY for startable rows"),
    search: str = Query(""),
    sort: str = Query("date", description="date (scheduled order), readiness (verdict first) or have (substrate coverage)"),
    sort_dir: str = Query("asc", description="asc / desc — only read by sort=have; the other two have one honest direction"),
    overdue_only: bool = Query(False),
    include_unreleased: bool = Query(True, description="Include open orders that have no work order yet"),
    unreleased_only: bool = Query(False),
    # Paging is in-memory here: the queue is a computed, priority-ordered list with
    # an allocation walk over the WHOLE set (see work_queue_service), so it cannot be
    # sliced in SQL. `allow_uncapped=False` because every row carries its full
    # material breakdown — there is no export path that could justify serving it whole.
    window: PageWindow = Depends(PageParams(default_size=50, max_size=200, allow_uncapped=False)),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_any_permission("work_order.view", "manufacturing_order.view")),
):
    # A PIC restricted to their own operations (Role.allowed_work_center_types)
    # must not read another floor's queue — the same gate the WO actions use.
    if center_type and not wo_scope_ok(current_user, center_type):
        raise HTTPException(status_code=403, detail="Not permitted for this work center type")

    rows, materials = await work_queue_service.build_queue(
        db, center_type=center_type, work_center_id=work_center_id, search=search,
        sort=(sort or "date").lower(), sort_dir=(sort_dir or "asc").lower(),
        include_unreleased=include_unreleased,
    )
    # Counts are taken before the row filters so the tab badges keep showing the
    # whole queue while the list shows one slice of it.
    counts = dict(Counter(r["verdict"] for r in rows))
    overdue_count = sum(1 for r in rows if r["is_overdue"])
    undated_count = sum(1 for r in rows if r["date_source"] == "created")
    unreleased_count = sum(1 for r in rows if not r["is_released"])

    if unreleased_only:
        rows = [r for r in rows if not r["is_released"]]
    if overdue_only:
        rows = [r for r in rows if r["is_overdue"]]
    if verdict:
        if verdict.upper() == "READY_ONLY":
            keep = {work_queue_service.VERDICT_READY, work_queue_service.VERDICT_STAGED}
            rows = [r for r in rows if r["verdict"] in keep]
        else:
            rows = [r for r in rows if r["verdict"] == verdict.upper()]

    total = len(rows)
    page_rows = (
        rows[window.offset:] if window.uncapped
        else rows[window.offset:window.offset + window.limit]
    )
    return window.envelope(
        page_rows, total, counts=counts,
        overdue_count=overdue_count, undated_count=undated_count,
        unreleased_count=unreleased_count, sort=(sort or "date").lower(),
        sort_dir=(sort_dir or "asc").lower(),
        materials=materials,
    )
