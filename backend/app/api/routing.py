from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.routing import WorkCenter, Operation
from app.models.auth import User
from app.schemas import WorkCenterCreate, WorkCenterResponse, OperationCreate, OperationResponse
from app.api.auth import get_current_user

router = APIRouter()

# --- Work Centers ---
@router.post("/work-centers", response_model=WorkCenterResponse)
def create_work_center(payload: WorkCenterCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(WorkCenter).filter(WorkCenter.code == payload.code).first():
        raise HTTPException(status_code=400, detail="Work Center Code already exists")

    wc = WorkCenter(
        code=payload.code,
        name=payload.name,
        description=payload.description,
        cost_per_hour=payload.cost_per_hour
    )
    db.add(wc)
    db.commit()
    db.refresh(wc)
    return wc

@router.get("/work-centers", response_model=list[WorkCenterResponse])
def get_work_centers(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(WorkCenter).offset(skip).limit(limit).all()

@router.delete("/work-centers/{wc_id}")
def delete_work_center(wc_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    wc = db.query(WorkCenter).filter(WorkCenter.id == wc_id).first()
    if not wc:
        raise HTTPException(status_code=404, detail="Work Center not found")
    db.delete(wc)
    db.commit()
    return {"status": "success", "message": "Work Center deleted"}

# --- Operations ---
@router.post("/operations", response_model=OperationResponse)
def create_operation(payload: OperationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
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
    return op

@router.get("/operations", response_model=list[OperationResponse])
def get_operations(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Operation).offset(skip).limit(limit).all()

@router.delete("/operations/{op_id}")
def delete_operation(op_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    op = db.query(Operation).filter(Operation.id == op_id).first()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")
    db.delete(op)
    db.commit()
    return {"status": "success", "message": "Operation deleted"}
