from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.schemas import PartnerCreate, PartnerResponse, PartnerUpdate
from app.models.partner import Partner
from app.api.auth import get_current_user
from app.models.auth import User
from typing import List, Optional
import uuid

router = APIRouter(prefix="/partners", tags=["partners"])

@router.post("", response_model=PartnerResponse)
def create_partner(payload: PartnerCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = Partner(
        name=payload.name,
        address=payload.address,
        type=payload.type,
        active=payload.active
    )
    db.add(partner)
    db.commit()
    db.refresh(partner)
    return partner

@router.get("", response_model=List[PartnerResponse])
def get_partners(type: Optional[str] = None, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    query = db.query(Partner)
    if type:
        query = query.filter(Partner.type == type)
    return query.all()

@router.put("/{partner_id}", response_model=PartnerResponse)
def update_partner(partner_id: uuid.UUID, payload: PartnerUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    
    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(partner, key, value)
    
    db.commit()
    db.refresh(partner)
    return partner

@router.delete("/{partner_id}")
def delete_partner(partner_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = db.query(Partner).filter(Partner.id == partner_id).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Partner not found")
    
    try:
        db.delete(partner)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Cannot delete '{partner.name}': they are referenced by existing records")
    return {"status": "success"}
