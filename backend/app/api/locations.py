from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.location import Location
from app.models.auth import User
from app.models.audit import AuditLog
from app.schemas import LocationCreate, LocationResponse, LocationUpdate
from app.core.ws_manager import broadcast_sync
from app.api.auth import get_current_user, require_permission

router = APIRouter()


def _infer_child_type(parent: Location) -> str:
    """Return the location_type a new child should receive."""
    if parent.location_type == 'warehouse':
        return 'zone'
    if parent.location_type == 'zone':
        return 'bin'
    raise HTTPException(status_code=400, detail="Bins cannot have children (max 3 levels: warehouse > zone > bin)")


def _assert_parent_ok(db: Session, parent_id, *, moving_id=None) -> str | None:
    """Validate parent assignment; return inferred location_type for the child (None = warehouse)."""
    if parent_id is None:
        return 'warehouse'
    if moving_id and str(parent_id) == str(moving_id):
        raise HTTPException(status_code=400, detail="A location cannot be its own parent")
    parent = db.query(Location).filter(Location.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent location not found")
    child_type = _infer_child_type(parent)
    # Moving an existing location: ensure its children wouldn't exceed depth
    if moving_id:
        has_children = db.query(Location).filter(Location.parent_id == moving_id).first()
        if has_children and child_type == 'bin':
            raise HTTPException(status_code=400, detail="This location has sub-locations; cannot nest it as a bin")
    return child_type


def _compute_full_path(loc_id, id_to_name: dict, id_to_parent: dict) -> str:
    parts = []
    cur = loc_id
    visited = set()
    while cur and cur not in visited:
        visited.add(cur)
        name = id_to_name.get(cur)
        if name:
            parts.append(name)
        cur = id_to_parent.get(cur)
    return " / ".join(reversed(parts))


@router.post("/locations", response_model=LocationResponse)
def create_location(payload: LocationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('location.create'))):
    if db.query(Location).filter(Location.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Location code already exists")
    loc_type = _assert_parent_ok(db, payload.parent_id)
    loc = Location(
        code=payload.code,
        name=payload.name,
        parent_id=payload.parent_id,
        location_type=loc_type,
        is_quarantine=payload.is_quarantine,
    )
    db.add(loc)
    db.commit()
    db.refresh(loc)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="location", entity_id=str(loc.id), details=f"Created location {loc.code}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "locations"})
    return loc


@router.get("/locations", response_model=list[LocationResponse])
def get_locations(skip: int = 0, limit: int = 1000, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Location).offset(skip).limit(limit).all()
    id_to_name = {r.id: r.name for r in rows}
    id_to_parent = {r.id: r.parent_id for r in rows}
    parents_with_children = {r.parent_id for r in rows if r.parent_id}
    return [
        LocationResponse(
            id=r.id,
            code=r.code,
            name=r.name,
            parent_id=r.parent_id,
            parent_name=id_to_name.get(r.parent_id),
            has_children=r.id in parents_with_children,
            location_type=r.location_type,
            system_code=r.system_code,
            is_quarantine=r.is_quarantine,
            full_path=_compute_full_path(r.id, id_to_name, id_to_parent),
        )
        for r in rows
    ]


@router.patch("/locations/{location_id}", response_model=LocationResponse)
def update_location(location_id: str, payload: LocationUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('location.edit'))):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        if loc.system_code:
            raise HTTPException(status_code=400, detail="System stores cannot be renamed")
        loc.name = data["name"]
    if "parent_id" in data:
        if loc.system_code:
            raise HTTPException(status_code=400, detail="System stores cannot be moved")
        _assert_parent_ok(db, data["parent_id"], moving_id=loc.id)
        loc.parent_id = data["parent_id"]
    # Hold-area flag is editable on system stores too — a plant may run its QC
    # hold somewhere other than the seeded Quarantine warehouse.
    if data.get("is_quarantine") is not None:
        loc.is_quarantine = data["is_quarantine"]
    db.add(AuditLog(user_id=current_user.id, action="UPDATE", entity_type="location", entity_id=str(loc.id), details=f"Updated location {loc.code}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "locations"})
    db.refresh(loc)
    return loc


@router.delete("/locations/{location_id}")
def delete_location(location_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('location.delete'))):
    loc = db.query(Location).filter(Location.id == location_id).first()
    if not loc:
        raise HTTPException(status_code=404, detail="Location not found")
    if loc.system_code:
        raise HTTPException(status_code=400, detail="System stores cannot be deleted")
    if db.query(Location).filter(Location.parent_id == loc.id).first():
        raise HTTPException(status_code=400, detail="Remove sub-locations first")
    db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="location", entity_id=str(loc.id), details=f"Deleted location {loc.code}"))
    db.delete(loc)
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "locations"})
    return {"status": "success", "message": "Location deleted"}
