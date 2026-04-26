from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload
from pathlib import Path
import shutil, os
from app.db.session import get_async_db
from app.models.bom import BOM, BOMLine, BOMOperation, BOMSize
from app.models.size import Size
from app.models.item import Item
from app.models.location import Location
from app.models.routing import WorkCenter, Operation
from app.schemas import BOMCreate, BOMResponse, SizeResponse
from app.models.auth import User
from app.api.auth import get_current_user
from app.services import audit_service
from app.models.attribute import AttributeValue

router = APIRouter()

@router.get("/sizes", response_model=list[SizeResponse])
async def get_sizes(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(Size).order_by(Size.sort_order))
    return result.scalars().all()

@router.post("/boms", response_model=BOMResponse)
async def create_bom(payload: BOMCreate, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    # 1. Resolve Produced Item
    result = await db.execute(select(Item).filter(Item.code == payload.item_code))
    item = result.scalars().first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Produced item '{payload.item_code}' not found")
    
    # 2. Check if BOM code exists
    result = await db.execute(select(BOM).filter(BOM.code == payload.code))
    if result.scalars().first():
        raise HTTPException(status_code=400, detail="BOM Code already exists")

    # 3. Create BOM Header
    bom = BOM(
        code=payload.code,
        description=payload.description,
        item_id=item.id,
        qty=payload.qty,
        kerapatan_picks=payload.kerapatan_picks,
        kerapatan_unit=payload.kerapatan_unit,
        sisir_no=payload.sisir_no,
        pemakaian_obat=payload.pemakaian_obat,
        pembuatan_sample_oleh=payload.pembuatan_sample_oleh,
        customer_id=payload.customer_id,
    )
    
    if payload.attribute_value_ids:
        result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(payload.attribute_value_ids)))
        vals = result.scalars().all()
        bom.attribute_values = vals

    db.add(bom)
    await db.commit()

    # 4. Create BOM Sizes
    for size_entry in payload.sizes:
        if size_entry.target_measurement is None and size_entry.measurement_min is None and size_entry.measurement_max is None:
            continue
        bom_size = BOMSize(
            bom_id=bom.id,
            size_id=size_entry.size_id,
            target_measurement=size_entry.target_measurement,
            measurement_min=size_entry.measurement_min,
            measurement_max=size_entry.measurement_max,
        )
        db.add(bom_size)
    await db.commit()

    # 5. Create BOM Lines
    for line in payload.lines:
        result = await db.execute(select(Item).filter(Item.code == line.item_code))
        material = result.scalars().first()
        if not material:
            raise HTTPException(status_code=404, detail=f"Material item '{line.item_code}' not found")
        
        bom_line = BOMLine(
            bom_id=bom.id,
            item_id=material.id,
            qty=line.qty,
            is_percentage=line.is_percentage,
            percentage=line.percentage,
        )
        
        # Resolve source location if provided
        if line.source_location_code:
            result = await db.execute(select(Location).filter(Location.code == line.source_location_code))
            loc = result.scalars().first()
            if not loc:
                raise HTTPException(status_code=404, detail=f"Source Location '{line.source_location_code}' not found")
            bom_line.source_location_id = loc.id
        
        if line.attribute_value_ids:
            result = await db.execute(select(AttributeValue).filter(AttributeValue.id.in_(line.attribute_value_ids)))
            vals = result.scalars().all()
            bom_line.attribute_values = vals

        db.add(bom_line)
    
    await db.commit()
    
    # Re-fetch with FULL eager loading for serialization
    result = await db.execute(
        select(BOM)
        .options(
            joinedload(BOM.item),
            joinedload(BOM.customer),
            selectinload(BOM.attribute_values),
            selectinload(BOM.lines).joinedload(BOMLine.item),
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(BOM.operations),
            selectinload(BOM.sizes).joinedload(BOMSize.size),
        )
        .filter(BOM.id == bom.id)
    )
    refresh_bom = result.scalars().first()

    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="CREATE",
        entity_type="BOM",
        entity_id=str(refresh_bom.id),
        details=f"Created BOM {refresh_bom.code} for {item.code}",
        changes=payload.model_dump()
    )

    refresh_bom.attribute_value_ids = [v.id for v in refresh_bom.attribute_values]
    for bl in refresh_bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]

    return refresh_bom

@router.get("/boms", response_model=list[BOMResponse])
async def get_boms(skip: int = 0, limit: int = 100, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    query = select(BOM).options(
        joinedload(BOM.item),
        joinedload(BOM.customer),
        selectinload(BOM.attribute_values),
        selectinload(BOM.lines).joinedload(BOMLine.item),
        selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
        selectinload(BOM.operations),
        selectinload(BOM.sizes).joinedload(BOMSize.size),
    )
    
    if current_user.allowed_categories:
        query = query.join(Item, BOM.item_id == Item.id).filter(Item.category.in_(current_user.allowed_categories))
        
    result = await db.execute(query.offset(skip).limit(limit))
    items_list = result.unique().scalars().all()
    
    for item in items_list:
        item.attribute_value_ids = [v.id for v in item.attribute_values]
        for bl in item.lines:
            bl.attribute_value_ids = [v.id for v in bl.attribute_values]
    return items_list

@router.get("/boms/{bom_id}", response_model=BOMResponse)
async def get_bom(bom_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(
        select(BOM)
        .options(
            joinedload(BOM.item),
            joinedload(BOM.customer),
            selectinload(BOM.attribute_values),
            selectinload(BOM.lines).joinedload(BOMLine.item),
            selectinload(BOM.lines).selectinload(BOMLine.attribute_values),
            selectinload(BOM.operations),
            selectinload(BOM.sizes).joinedload(BOMSize.size),
        )
        .filter(BOM.id == bom_id)
    )
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    bom.attribute_value_ids = [v.id for v in bom.attribute_values]
    for bl in bom.lines:
        bl.attribute_value_ids = [v.id for v in bl.attribute_values]
        
    return bom

@router.post("/boms/{bom_id}/sample-photo")
async def upload_bom_sample_photo(
    bom_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(BOM).filter(BOM.id == bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")

    upload_dir = Path("static/boms")
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    file_path = upload_dir / f"{bom_id}_sample{ext}"
    with file_path.open("wb") as buf:
        shutil.copyfileobj(file.file, buf)

    bom.sample_photo_url = f"/static/boms/{bom_id}_sample{ext}"
    await db.commit()
    return {"sample_photo_url": bom.sample_photo_url}

@router.delete("/boms/{bom_id}")
async def delete_bom(bom_id: str, db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(select(BOM).filter(BOM.id == bom_id))
    bom = result.scalars().first()
    if not bom:
        raise HTTPException(status_code=404, detail="BOM not found")
    
    details = f"Deleted BOM {bom.code}"
    
    try:
        await db.delete(bom)
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400, 
            detail="Cannot delete BOM because it is currently used by one or more Work Orders. Please delete or complete the associated Work Orders first."
        )
    
    await audit_service.log_activity(
        db,
        user_id=current_user.id,
        action="DELETE",
        entity_type="BOM",
        entity_id=bom_id,
        details=details
    )
    
    return {"status": "success", "message": "BOM deleted"}
