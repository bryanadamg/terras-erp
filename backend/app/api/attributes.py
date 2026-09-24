from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.attribute import Attribute, AttributeValue
from app.models.auth import User
from app.models.audit import AuditLog
from app.schemas import AttributeCreate, AttributeResponse, AttributeValueCreate, AttributeUpdate, AttributeValueUpdate, AttributeValueResponse
from app.core.ws_manager import broadcast_sync
from app.api.auth import get_current_user, require_permission

router = APIRouter()

@router.post("/attributes", response_model=AttributeResponse)
def create_attribute(payload: AttributeCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.create'))):
    db_attr = db.query(Attribute).filter(Attribute.name == payload.name).first()
    if db_attr:
        raise HTTPException(status_code=400, detail="Attribute already exists")

    attribute = Attribute(name=payload.name)
    db.add(attribute)
    db.commit()
    db.refresh(attribute)

    for v in payload.values:
        attr_val = AttributeValue(attribute_id=attribute.id, value=v.value, hex=v.hex)
        db.add(attr_val)

    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="attribute", entity_id=str(attribute.id), details=f"Created attribute {attribute.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    db.refresh(attribute)
    return attribute

@router.get("/attributes", response_model=list[AttributeResponse])
def get_attributes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Attribute).all()

@router.put("/attributes/{attribute_id}", response_model=AttributeResponse)
def update_attribute(attribute_id: str, payload: AttributeUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.edit'))):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")

    old_name = attribute.name
    attribute.name = payload.name
    db.add(AuditLog(user_id=current_user.id, action="UPDATE", entity_type="attribute", entity_id=str(attribute.id), details=f"Renamed attribute {old_name} -> {payload.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    db.refresh(attribute)
    return attribute

@router.delete("/attributes/{attribute_id}")
def delete_attribute(attribute_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.delete'))):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")
    if attribute.is_system:
        raise HTTPException(status_code=400, detail=f"'{attribute.name}' is a system attribute and cannot be deleted.")

    try:
        db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="attribute", entity_id=str(attribute.id), details=f"Deleted attribute {attribute.name}"))
        db.delete(attribute)
        db.commit()
        broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete '{attribute.name}': it is still assigned to items or used in existing transaction records (stock, orders, BOMs, etc). Remove those references first.",
        )
    return {"status": "success", "message": "Attribute deleted"}

@router.post("/attributes/{attribute_id}/values", response_model=AttributeValueResponse)
def add_attribute_value(attribute_id: str, payload: AttributeValueCreate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.create'))):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")

    attr_val = AttributeValue(attribute_id=attribute.id, value=payload.value, hex=payload.hex)
    db.add(attr_val)
    db.commit()
    db.refresh(attr_val)
    db.add(AuditLog(user_id=current_user.id, action="CREATE", entity_type="attribute_value", entity_id=str(attr_val.id), details=f"Added value '{attr_val.value}' to attribute {attribute.name}"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    return attr_val

@router.put("/attributes/values/{value_id}", response_model=AttributeValueResponse)
def update_attribute_value(value_id: str, payload: AttributeValueUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.edit'))):
    val = db.query(AttributeValue).filter(AttributeValue.id == value_id).first()
    if not val:
        raise HTTPException(status_code=404, detail="Attribute Value not found")

    old_value = val.value
    val.value = payload.value
    val.hex = payload.hex
    db.add(AuditLog(user_id=current_user.id, action="UPDATE", entity_type="attribute_value", entity_id=str(val.id), details=f"Renamed value '{old_value}' -> '{payload.value}'"))
    db.commit()
    broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    db.refresh(val)
    return val

@router.delete("/attributes/values/{value_id}")
def delete_attribute_value(value_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_permission('attribute.delete'))):
    val = db.query(AttributeValue).filter(AttributeValue.id == value_id).first()
    if not val:
        raise HTTPException(status_code=404, detail="Attribute Value not found")

    try:
        db.add(AuditLog(user_id=current_user.id, action="DELETE", entity_type="attribute_value", entity_id=str(val.id), details=f"Deleted value '{val.value}'"))
        db.delete(val)
        db.commit()
        broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "attributes"})
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete value '{val.value}': it is still used by existing items or transaction records (stock, orders, BOMs, etc). Remove those references first.",
        )
    return {"status": "success", "message": "Value deleted"}
