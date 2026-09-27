"""Work-center tree walks (TYPE -> GROUP -> MACHINE).

The tree is a self-FK on `work_centers.parent_id` with an explicit `node_type`
discriminator, and the GROUP tier is optional — so nothing may assume a fixed
depth. Every "everything under this node" question goes through the recursive CTE
here instead of a one-hop `parent_id ==` filter, which silently stopped working
the moment a third level existed.
"""
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.routing import WorkCenter

NODE_TYPES = ("TYPE", "GROUP", "MACHINE")


def _descendants_cte(root_id):
    """Recursive CTE over every node below root_id (root itself excluded)."""
    wc = WorkCenter.__table__
    cte = (
        select(wc.c.id, wc.c.node_type, wc.c.parent_id)
        .where(wc.c.parent_id == root_id)
        .cte("wc_descendants", recursive=True)
    )
    child = wc.alias("wc_child")
    return cte.union_all(
        select(child.c.id, child.c.node_type, child.c.parent_id)
        .where(child.c.parent_id == cte.c.id)
    )


def _descendants_query(root_id, machines_only: bool):
    cte = _descendants_cte(root_id)
    q = select(cte.c.id)
    if machines_only:
        q = q.where(cte.c.node_type == "MACHINE")
    return q


async def descendant_ids(db: AsyncSession, root_id, machines_only: bool = False) -> list:
    res = await db.execute(_descendants_query(root_id, machines_only))
    return [r[0] for r in res.all()]


def descendant_ids_sync(db: Session, root_id, machines_only: bool = False) -> list:
    return [r[0] for r in db.execute(_descendants_query(root_id, machines_only)).all()]


def subtree_ids_query(root_id, machines_only: bool = False):
    """Scalar subquery of descendant ids — for use inside a larger filter."""
    return _descendants_query(root_id, machines_only).scalar_subquery()


async def ancestors(db: AsyncSession, wc_id) -> list[WorkCenter]:
    """Ancestor chain, nearest parent first, up to the TYPE root."""
    chain: list[WorkCenter] = []
    seen = {str(wc_id)}
    current = (await db.execute(select(WorkCenter).where(WorkCenter.id == wc_id))).scalars().first()
    while current is not None and current.parent_id is not None:
        if str(current.parent_id) in seen:  # cycle guard
            break
        seen.add(str(current.parent_id))
        parent = (await db.execute(select(WorkCenter).where(WorkCenter.id == current.parent_id))).scalars().first()
        if parent is None:
            break
        chain.append(parent)
        current = parent
    return chain


async def group_of(db: AsyncSession, wc: WorkCenter) -> Optional[WorkCenter]:
    """The GROUP a machine belongs to, or None when it hangs straight off a TYPE."""
    for a in await ancestors(db, wc.id):
        if (a.node_type or "").upper() == "GROUP":
            return a
    return None


def type_of_cte():
    """Recursive CTE of {work_center id -> its TYPE-root's center_type}, for every
    work center in the tree (TYPE/GROUP/MACHINE alike).

    TYPE nodes are the tree's roots (parent_id IS NULL) — the opposite shape of
    `_descendants_cte`, which walks down from one arbitrary node. Seeding at every
    TYPE row and walking down means one query classifies the whole table, so
    callers (e.g. classifying lots by the process that produced them) can join
    this once instead of resolving `ancestors()` per row.
    """
    wc = WorkCenter.__table__
    base = (
        select(wc.c.id, wc.c.center_type.label("center_type"))
        .where(wc.c.node_type == "TYPE")
        .cte("wc_type_of", recursive=True)
    )
    child = wc.alias("wc_type_child")
    return base.union_all(
        select(child.c.id, base.c.center_type)
        .where(child.c.parent_id == base.c.id)
    )


# --- Input/output location inheritance -------------------------------------
# Staging areas are a property of the *area*, not of each machine: every loom in
# a hall feeds from the same supply bin. So a machine's input/output location is
# its own value when set, otherwise the nearest ancestor's (GROUP, then TYPE).
# Nothing reads WorkCenter.input_location_id/output_location_id raw — the column
# only holds an override, and a blank machine is normal, not misconfigured.

_LOC_COLS = (
    WorkCenter.id,
    WorkCenter.parent_id,
    WorkCenter.input_location_id,
    WorkCenter.output_location_id,
    WorkCenter.reject_location_id,
)


def _to_loc_map(rows) -> dict:
    return {str(r[0]): (r[1], r[2], r[3], r[4]) for r in rows}


async def location_map(db: AsyncSession) -> dict:
    """One-shot {wc_id: (parent_id, input_id, output_id, reject_id)} for resolving
    inherited locations without a query per tree level. work_centers is a small
    master table."""
    res = await db.execute(select(*_LOC_COLS))
    return _to_loc_map(res.all())


def location_map_sync(db: Session) -> dict:
    return _to_loc_map(db.execute(select(*_LOC_COLS)).all())


def resolve_locations_from_map(loc_map: dict, wc_id) -> tuple:
    """(input, output, reject, src_input, src_output, src_reject) — own value first,
    then walk up. The fields resolve independently: a machine may override only its
    output and still inherit the group's defect store."""
    in_id = out_id = rej_id = None
    src_in = src_out = src_rej = None
    seen: set[str] = set()
    cur = wc_id
    while cur is not None and str(cur) not in seen:
        seen.add(str(cur))
        row = loc_map.get(str(cur))
        if row is None:
            break
        parent_id, own_in, own_out, own_rej = row
        if in_id is None and own_in is not None:
            in_id, src_in = own_in, cur
        if out_id is None and own_out is not None:
            out_id, src_out = own_out, cur
        if rej_id is None and own_rej is not None:
            rej_id, src_rej = own_rej, cur
        if in_id is not None and out_id is not None and rej_id is not None:
            break
        cur = parent_id
    return in_id, out_id, rej_id, src_in, src_out, src_rej


async def resolve_locations(db: AsyncSession, wc_id, loc_map: dict | None = None) -> tuple:
    """Effective (input_location_id, output_location_id) for a work center.
    Pass a cached `loc_map` when resolving many centers in one request.
    The defect store resolves through `resolve_reject_location` instead."""
    lm = loc_map if loc_map is not None else await location_map(db)
    in_id, out_id = resolve_locations_from_map(lm, wc_id)[:2]
    return in_id, out_id


async def resolve_reject_location(db: AsyncSession, wc_id, loc_map: dict | None = None):
    """Effective defect store for a work center — own value, else inherited from
    its GROUP/TYPE. Returns None when nothing is configured anywhere up the tree
    (the caller then falls back to the item master)."""
    if not wc_id:
        return None
    lm = loc_map if loc_map is not None else await location_map(db)
    return resolve_locations_from_map(lm, wc_id)[2]


def decorate_effective_locations(wcs, loc_map: dict) -> None:
    """Stamp effective_* / *_inherited onto WorkCenter instances for the API
    response, so the UI can show a blank machine's inherited area."""
    for wc in wcs:
        in_id, out_id, rej_id, src_in, src_out, src_rej = resolve_locations_from_map(loc_map, wc.id)
        wc.effective_input_location_id = in_id
        wc.effective_output_location_id = out_id
        wc.effective_reject_location_id = rej_id
        wc.input_location_inherited = in_id is not None and str(src_in) != str(wc.id)
        wc.output_location_inherited = out_id is not None and str(src_out) != str(wc.id)
        wc.reject_location_inherited = rej_id is not None and str(src_rej) != str(wc.id)
