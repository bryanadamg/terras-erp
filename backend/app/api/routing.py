from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.routing import WorkCenter, Operation
from app.models.auth import User
from app.models.audit import AuditLog
from app.schemas import WorkCenterCreate, WorkCenterResponse, OperationCreate, OperationResponse
from app.core.ws_manager import broadcast_sync
from app.api.auth import get_current_user, require_permission
from app.services import work_center_service

router = APIRouter()


def _resolve_node_type(payload: WorkCenterCreate) -> str:
    """Explicit node_type wins; otherwise infer the legacy 2-level shape."""
    nt = (payload.node_type or "").upper()
    if not nt:
        return "MACHINE" if payload.parent_id else "TYPE"
    if nt not in work_center_service.NODE_TYPES:
        raise HTTPException(status_code=422, detail=f"node_type must be one of {work_center_service.NODE_TYPES}")
    return nt


def _validate_placement(db: Session, node_type: str, parent_id, *, self_id=None) -> None:
    """Enforce TYPE -> GROUP -> MACHINE. GROUP is optional, so a MACHINE may sit
    under either a TYPE or a GROUP; nothing may sit under a MACHINE."""
    if node_type == "TYPE":
        if parent_id:
            raise HTTPException(status_code=422, detail="A work center TYPE is a root — it cannot have a parent")
        return
    if node_type == "GROUP" and not parent_id:
        raise HTTPException(status_code=422, detail="A work center GROUP must sit under a work center TYPE")
    if not parent_id:
        return
    if self_id and str(parent_id) == str(self_id):
        raise HTTPException(status_code=422, detail="A work center cannot be its own parent")
    parent = db.query(WorkCenter).filter(WorkCenter.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent work center not found")
    parent_type = (parent.node_type or "MACHINE").upper()
    if parent_type == "MACHINE":
        raise HTTPException(status_code=422, detail="A machine cannot contain other work centers")
    if node_type == "GROUP" and parent_type != "TYPE":
        raise HTTPException(status_code=422, detail="A GROUP must sit directly under a TYPE")
    if self_id and str(parent_id) in {str(i) for i in work_center_service.descendant_ids_sync(db, self_id)}:
        raise HTTPException(status_code=422, detail="Cannot move a work center under one of its own children")


def _with_effective_locations(db: Session, wc: WorkCenter) -> WorkCenter:
    work_center_service.decorate_effective_locations([wc], work_center_service.location_map_sync(db))
    return wc


# --- Work Centers ---
def _positive_or_none(value):
    """A measured machine constant, or None when it has never been measured.

    Zero and negatives collapse to None rather than being stored: the dyeing
    monitor divides by this, and a 0 would read as "measured, and the vessel
    moves no cloth" instead of "nobody has measured the reel yet".
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


@router.post("/work-centers", response_model=WorkCenterResponse)
def create_work_center(payload: WorkCenterCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('routing.create'))):
    if db.query(WorkCenter).filter(WorkCenter.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Work Center Code already exists")

    node_type = _resolve_node_type(payload)
    _validate_placement(db, node_type, payload.parent_id)

    wc = WorkCenter(
        node_type=node_type,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        cost_per_hour=payload.cost_per_hour,
        center_type=payload.center_type,
        input_location_id=payload.input_location_id,
        output_location_id=payload.output_location_id,
        reject_location_id=payload.reject_location_id,
        parent_id=payload.parent_id,
        beam_slots=max(1, int(payload.beam_slots or 1)),
    )
    db.add(wc)
    db.commit()
    db.refresh(wc)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="work_center", entity_id=str(wc.id), details=f"Created work center {wc.code}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "routing"})
    return _with_effective_locations(db, wc)

@router.get("/work-centers", response_model=list[WorkCenterResponse])
def get_work_centers(skip: int = 0, limit: int = 2000, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # The whole tree is a picker source (machine selects walk it client-side), so a
    # 100-row default silently hid machines on plants with >100 looms. Order by name
    # so every consumer gets a stable, readable list instead of heap order.
    rows = db.query(WorkCenter).order_by(WorkCenter.name).offset(skip).limit(limit).all()
    # Resolve against the whole tree, not just the page — an ancestor may be on
    # another page (or outside the limit entirely).
    work_center_service.decorate_effective_locations(rows, work_center_service.location_map_sync(db))
    return rows

@router.put("/work-centers/{wc_id}", response_model=WorkCenterResponse)
def update_work_center(wc_id: str, payload: WorkCenterCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('routing.edit'))):
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work Center not found")
    existing = db.query(WorkCenter).filter(WorkCenter.code == payload.code, WorkCenter.id != wc_id).first()
    if existing:
        raise HTTPException(status_code=400, detail="Work Center Code already exists")
    node_type = _resolve_node_type(payload) if payload.node_type else (wc.node_type or "MACHINE").upper()
    _validate_placement(db, node_type, payload.parent_id, self_id=wc.id)
    type_changed = wc.center_type != payload.center_type
    wc.node_type = node_type
    wc.code = payload.code
    wc.name = payload.name
    wc.description = payload.description
    wc.cost_per_hour = payload.cost_per_hour
    wc.center_type = payload.center_type
    wc.input_location_id = payload.input_location_id
    wc.output_location_id = payload.output_location_id
    wc.reject_location_id = payload.reject_location_id
    wc.parent_id = payload.parent_id
    wc.beam_slots = max(1, int(payload.beam_slots or 1))
    # Cascade center_type down the whole subtree, not just direct children — with a
    # GROUP tier in between, a one-hop update left the machines on the old type.
    if type_changed and node_type != "MACHINE":
        desc_ids = work_center_service.descendant_ids_sync(db, wc.id)
        if desc_ids:
            db.query(WorkCenter).filter(WorkCenter.id.in_(desc_ids)).update(
                {"center_type": payload.center_type}, synchronize_session=False
            )
    db.add(AuditLog(user_id=current_user.id, action="UPDATE", entity_type="work_center", entity_id=str(wc.id), details=f"Updated work center {wc.code}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "routing"})
    db.refresh(wc)
    return _with_effective_locations(db, wc)

@router.delete("/work-centers/{wc_id}")
def delete_work_center(wc_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('routing.delete'))):
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work Center not found")
    if db.query(WorkCenter).filter(WorkCenter.parent_id == wc.id).first():
        raise HTTPException(status_code=400, detail="Move or delete the work centers inside this one first")
    db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="work_center", entity_id=str(wc.id), details=f"Deleted work center {wc.code}"))
    db.delete(wc)
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "routing"})
    return {"status": "success", "message": "Work Center deleted"}

# --- Operations ---
@router.post("/operations", response_model=OperationResponse)
def create_operation(payload: OperationCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('routing.create'))):
    if db.query(Operation).filter(Operation.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Operation Code already exists")

    op = Operation(
        code=payload.code,
        name=payload.name,
        description=payload.description
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="operation", entity_id=str(op.id), details=f"Created operation {op.code}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "routing"})
    return op

@router.get("/operations", response_model=list[OperationResponse])
def get_operations(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    # Whole set: a lookup feed for BOM routing / WO pickers.
    return db.query(Operation).order_by(Operation.name).all()

@router.delete("/operations/{op_id}")
def delete_operation(op_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('routing.delete'))):
    op = db.query(Operation).filter(Operation.id == op_id).first()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    if op.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system operation")
    db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="operation", entity_id=str(op.id), details=f"Deleted operation {op.code}"))
    db.delete(op)
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "routing"})
    return {"status": "success", "message": "Operation deleted"}
