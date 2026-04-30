from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.db.session import get_db
from app.models.uom import UOM, UOMFactor
from app.models.auth import User
from app.schemas import UOMCreate, UOMResponse, UOMFactorCreate, UOMFactorResponse
from app.api.auth import get_current_user

router = APIRouter()

@router.post("/uoms", response_model=UOMResponse)
def create_uom(payload: UOMCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.query(UOM).filter(UOM.name == payload.name).first():
        raise HTTPException(status_code=400, detail="UOM already exists")

    uom = UOM(name=payload.name)
    db.add(uom)
    db.commit()
    db.refresh(uom)
    return uom

@router.get("/uoms", response_model=list[UOMResponse])
def get_uoms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(UOM).options(joinedload(UOM.factors)).all()

@router.delete("/uoms/{uom_id}")
def delete_uom(uom_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uom = db.query(UOM).filter(UOM.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    db.delete(uom)
    db.commit()
    return {"status": "success", "message": "UOM deleted"}

@router.post("/uoms/{uom_id}/factors", response_model=UOMFactorResponse)
def create_uom_factor(uom_id: str, payload: UOMFactorCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uom = db.query(UOM).filter(UOM.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    factor = UOMFactor(uom_id=uom.id, value=payload.value, label=payload.label)
    db.add(factor)
    db.commit()
    db.refresh(factor)
    return factor

@router.delete("/uoms/{uom_id}/factors/{factor_id}")
def delete_uom_factor(uom_id: str, factor_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    factor = db.query(UOMFactor).filter(UOMFactor.id == factor_id, UOMFactor.uom_id == uom_id).first()
    if not factor:
        raise HTTPException(status_code=404, detail="Factor not found")
    db.delete(factor)
    db.commit()
    return {"status": "success", "message": "Factor deleted"}
