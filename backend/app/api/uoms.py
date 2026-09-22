from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload
from app.db.session import get_db
from app.models.uom import UOM, UOMFactor
from app.models.auth import User
from app.models.audit import AuditLog
from app.schemas import UOMCreate, UOMResponse, UOMFactorCreate, UOMFactorResponse
from app.core.ws_manager import broadcast_sync
from app.api.auth import get_current_user, require_permission

router = APIRouter()

def _factor_response(factor: UOMFactor) -> dict:
    return {
        "id": factor.id,
        "from_uom_id": factor.from_uom_id,
        "to_uom_id": factor.to_uom_id,
        "from_uom_name": factor.from_uom.name if factor.from_uom else '',
        "to_uom_name": factor.to_uom.name if factor.to_uom else '',
        "value": float(factor.value),
    }

@router.post("/uoms", response_model=UOMResponse)
def create_uom(payload: UOMCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('uom.create'))):
    if db.query(UOM).filter(UOM.name == payload.name).first():
        raise HTTPException(status_code=400, detail="UOM already exists")

    uom = UOM(name=payload.name)
    db.add(uom)
    db.commit()
    db.refresh(uom)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="uom", entity_id=str(uom.id), details=f"Created UOM {uom.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "uoms"})
    return uom

@router.get("/uoms", response_model=list[UOMResponse])
def get_uoms(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    uoms = (
        db.query(UOM)
        .options(
            joinedload(UOM.factors).joinedload(UOMFactor.from_uom),
            joinedload(UOM.factors).joinedload(UOMFactor.to_uom),
        )
        .all()
    )
    result = []
    for uom in uoms:
        d = {"id": uom.id, "name": uom.name, "is_system": uom.is_system, "factors": []}
        for f in uom.factors:
            d["factors"].append(_factor_response(f))
        result.append(d)
    return result

@router.delete("/uoms/{uom_id}")
def delete_uom(uom_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('uom.delete'))):
    uom = db.query(UOM).filter(UOM.id == uom_id).first()
    if not uom:
        raise HTTPException(status_code=404, detail="UOM not found")
    if uom.is_system:
        raise HTTPException(status_code=400, detail=f"'{uom.name}' is a system UOM and cannot be deleted")
    db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="uom", entity_id=str(uom.id), details=f"Deleted UOM {uom.name}"))
    db.delete(uom)
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "uoms"})
    return {"status": "success", "message": "UOM deleted"}

@router.post("/uoms/{from_uom_id}/factors", response_model=UOMFactorResponse)
def create_uom_factor(from_uom_id: str, payload: UOMFactorCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('uom.edit'))):
    from_uom = db.query(UOM).filter(UOM.id == from_uom_id).first()
    if not from_uom:
        raise HTTPException(status_code=404, detail="From UOM not found")
    to_uom = db.query(UOM).filter(UOM.id == str(payload.to_uom_id)).first()
    if not to_uom:
        raise HTTPException(status_code=404, detail="To UOM not found")
    factor = UOMFactor(from_uom_id=from_uom.id, to_uom_id=to_uom.id, value=payload.value)
    db.add(factor)
    db.commit()
    db.refresh(factor)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="uom_factor", entity_id=str(factor.id), details=f"Created UOM factor {from_uom.name} -> {to_uom.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "uoms"})
    # reload relationships
    factor.from_uom = from_uom
    factor.to_uom = to_uom
    return _factor_response(factor)

@router.delete("/uoms/{from_uom_id}/factors/{factor_id}")
def delete_uom_factor(from_uom_id: str, factor_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('uom.edit'))):
    factor = db.query(UOMFactor).filter(UOMFactor.id == factor_id, UOMFactor.from_uom_id == from_uom_id).first()
    if not factor:
        raise HTTPException(status_code=404, detail="Factor not found")
    db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="uom_factor", entity_id=str(factor.id), details="Deleted UOM factor"))
    db.delete(factor)
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "uoms"})
    return {"status": "success", "message": "Factor deleted"}
