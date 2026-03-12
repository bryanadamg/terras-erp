from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_async_db
from app.schemas import CompanyProfileResponse, CompanyProfileUpdate
from app.models.settings import CompanyProfile
from app.api.auth import get_current_user
from app.models.auth import User
import shutil
import os
from pathlib import Path

router = APIRouter(prefix="/settings", tags=["settings"])

UPLOAD_DIR = Path("static/logos")

@router.get("/company", response_model=CompanyProfileResponse)
async def get_company_profile(db: AsyncSession = Depends(get_async_db)):
    result = await db.execute(select(CompanyProfile))
    profile = result.scalars().first()
    if not profile:
        # Create a default one if it doesn't exist
        profile = CompanyProfile(name="My Company")
        db.add(profile)
        await db.commit()
        await db.refresh(profile)
    return profile

@router.put("/company", response_model=CompanyProfileResponse)
async def update_company_profile(
    payload: CompanyProfileUpdate, 
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    # Only Admin can update profile
    if current_user.role.name != "Administrator":
        raise HTTPException(status_code=403, detail="Not authorized")
        
    result = await db.execute(select(CompanyProfile))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile()
        db.add(profile)

    for field, value in payload.dict(exclude_unset=True).items():
        setattr(profile, field, value)
    
    await db.commit()
    await db.refresh(profile)
    return profile

@router.post("/company/logo")
async def upload_logo(
    file: UploadFile = File(...), 
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user)
):
    if current_user.role.name != "Administrator":
        raise HTTPException(status_code=403, detail="Not authorized")
        
    # Ensure dir exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Save file
    file_ext = os.path.splitext(file.filename)[1]
    file_path = UPLOAD_DIR / f"company_logo{file_ext}"
    
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Update profile
    result = await db.execute(select(CompanyProfile))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile()
        db.add(profile)
    
    # Store relative URL
    profile.logo_url = f"/static/logos/company_logo{file_ext}"
    await db.commit()
    
    return {"logo_url": profile.logo_url}
