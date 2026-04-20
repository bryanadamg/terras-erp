from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.models.location import Location
from app.models.auth import User
from app.schemas import LocationCreate, LocationResponse
from app.api.auth import get_current_user

router = APIRouter()

@router.post("/locations", response_model=LocationResponse)
def create_location(payload: LocationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_location = db.query(Location).filter(Location.code == payload.code).first()
    if db_location:
        raise HTTPException(status_code=400, detail="Location already exists")

    new_location = Location(
        code=payload.code,
        name=payload.name
    )
    db.add(new_location)
    db.commit()
    db.refresh(new_location)
    return new_location

@router.get("/locations", response_model=list[LocationResponse])
def get_locations(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Location).offset(skip).limit(limit).all()

@router.delete("/locations/{location_id}")
def delete_location(location_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    location = db.query(Location).filter(Location.id == location_id).first()
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    
    db.delete(location)
    db.commit()
    return {"status": "success", "message": "Location deleted"}
