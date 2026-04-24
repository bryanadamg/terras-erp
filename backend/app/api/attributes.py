from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.attribute import Attribute, AttributeValue
from app.models.auth import User
from app.schemas import AttributeCreate, AttributeResponse, AttributeValueCreate, AttributeUpdate, AttributeValueUpdate, AttributeValueResponse
from app.api.auth import get_current_user

router = APIRouter()

@router.post("/attributes", response_model=AttributeResponse)
def create_attribute(payload: AttributeCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_attr = db.query(Attribute).filter(Attribute.name == payload.name).first()
    if db_attr:
        raise HTTPException(status_code=400, detail="Attribute already exists")

    attribute = Attribute(name=payload.name)
    db.add(attribute)
    db.commit()
    db.refresh(attribute)

    for v in payload.values:
        attr_val = AttributeValue(attribute_id=attribute.id, value=v.value)
        db.add(attr_val)

    db.commit()
    db.refresh(attribute)
    return attribute

@router.get("/attributes", response_model=list[AttributeResponse])
def get_attributes(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Attribute).all()

@router.put("/attributes/{attribute_id}", response_model=AttributeResponse)
def update_attribute(attribute_id: str, payload: AttributeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")

    attribute.name = payload.name
    db.commit()
    db.refresh(attribute)
    return attribute

@router.delete("/attributes/{attribute_id}")
def delete_attribute(attribute_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")
    if attribute.name == "Colors":
        raise HTTPException(status_code=400, detail="The 'Colors' attribute is system-reserved and cannot be deleted.")

    db.delete(attribute)
    db.commit()
    return {"status": "success", "message": "Attribute deleted"}

@router.post("/attributes/{attribute_id}/values", response_model=AttributeValueResponse)
def add_attribute_value(attribute_id: str, payload: AttributeValueCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    attribute = db.query(Attribute).filter(Attribute.id == attribute_id).first()
    if not attribute:
        raise HTTPException(status_code=404, detail="Attribute not found")

    attr_val = AttributeValue(attribute_id=attribute.id, value=payload.value)
    db.add(attr_val)
    db.commit()
    db.refresh(attr_val)
    return attr_val

@router.put("/attributes/values/{value_id}", response_model=AttributeValueResponse)
def update_attribute_value(value_id: str, payload: AttributeValueUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    val = db.query(AttributeValue).filter(AttributeValue.id == value_id).first()
    if not val:
        raise HTTPException(status_code=404, detail="Attribute Value not found")

    val.value = payload.value
    db.commit()
    db.refresh(val)
    return val

@router.delete("/attributes/values/{value_id}")
def delete_attribute_value(value_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    val = db.query(AttributeValue).filter(AttributeValue.id == value_id).first()
    if not val:
        raise HTTPException(status_code=404, detail="Attribute Value not found")
    
    db.delete(val)
    db.commit()
    return {"status": "success", "message": "Value deleted"}
