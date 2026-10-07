from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_async_db
from app.schemas import (
    CompanyProfileResponse,
    CompanyProfileUpdate,
    QtyFormulaResponse,
    QtyFormulaRuleIO,
    QtyFormulaUpdate,
)
from app.models.settings import CompanyProfile
from app.core.uploads import upload_ext, IMAGE_EXTS
from app.api.auth import get_current_user, get_current_admin
from app.models.auth import User
from app.services import audit_service, qty_formula_service
import shutil
import os
from pathlib import Path

router = APIRouter(prefix="/settings", tags=["settings"])

UPLOAD_DIR = Path("static/logos")

@router.get("/company", response_model=CompanyProfileResponse)
async def get_company_profile(db: AsyncSession = Depends(get_async_db), current_user: User = Depends(get_current_user)):
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
    current_user: User = Depends(get_current_admin)
):
    result = await db.execute(select(CompanyProfile))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile()
        db.add(profile)

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, field, value)

    await db.commit()
    await db.refresh(profile)
    await audit_service.log_activity(db, current_user.id, "UPDATE", "CompanyProfile", str(profile.id), details="Updated company profile")
    return profile

@router.post("/company/logo")
async def upload_logo(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_admin)
):
    # Ensure dir exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    
    # Save file
    file_ext = upload_ext(file, IMAGE_EXTS, ".png")
    file_path = UPLOAD_DIR / f"company_logo{file_ext}"
    
    with file_path.open("wb") as buffer:
        await run_in_threadpool(shutil.copyfileobj, file.file, buffer)
    
    # Update profile
    result = await db.execute(select(CompanyProfile))
    profile = result.scalars().first()
    if not profile:
        profile = CompanyProfile()
        db.add(profile)
    
    # Store relative URL
    profile.logo_url = f"/static/logos/company_logo{file_ext}"
    await db.commit()
    await audit_service.log_activity(db, current_user.id, "UPDATE", "CompanyProfile", str(profile.id), details="Uploaded company logo")

    return {"logo_url": profile.logo_url}


# ── Production quantity formula ──────────────────────────────────────────────
# The rule that turns ordered sizes into sizes to make, in the Production Run
# modal. Readable by any authenticated user (the modal needs it); writable by
# admins only — it changes what every planner's Apply button produces.

@router.get("/qty-formula", response_model=QtyFormulaResponse)
async def get_qty_formula(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    rules = await qty_formula_service.get_rules(db)
    return QtyFormulaResponse(
        rules=[QtyFormulaRuleIO(size_name=r.size_name, expression=r.expression) for r in rules],
        defaults=[
            QtyFormulaRuleIO(size_name=n, expression=e)
            for n, e in qty_formula_service.DEFAULT_RULES
        ],
        sizes=await qty_formula_service.size_names(db),
        functions=sorted(qty_formula_service.FUNCTIONS.keys()),
        fallback=qty_formula_service.FALLBACK,
        self_name=qty_formula_service.SELF_NAME,
    )


@router.put("/qty-formula", response_model=QtyFormulaResponse)
async def update_qty_formula(
    payload: QtyFormulaUpdate,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_admin),
):
    known = await qty_formula_service.size_names(db)
    fallback = qty_formula_service.FALLBACK

    cleaned: list[tuple[str, str]] = []
    seen: set[str] = set()
    for rule in payload.rules:
        name = (rule.size_name or "").strip()
        expr = (rule.expression or "").strip()
        if not name:
            raise HTTPException(status_code=422, detail="A rule is missing its size")
        if name != fallback and name not in known:
            raise HTTPException(status_code=422, detail=f"'{name}' is not a known size")
        if name in seen:
            raise HTTPException(status_code=422, detail=f"Duplicate rule for '{name}'")
        seen.add(name)
        if not expr:
            # An empty row is how a size goes back to the fallback, so drop it
            # rather than storing a blank expression nothing can evaluate.
            continue
        try:
            qty_formula_service.validate_expression(expr, known)
        except qty_formula_service.FormulaError as exc:
            label = "Fallback" if name == fallback else name
            raise HTTPException(status_code=422, detail=f"{label}: {exc}")
        cleaned.append((name, expr))

    # Without a fallback, any size the planner did not write a rule for would
    # come out blank. Fall back to the default fallback rather than 422 on a
    # rule the user never had to think about.
    if fallback not in dict(cleaned):
        cleaned.append((fallback, qty_formula_service.SELF_NAME))

    before_rules = {r.size_name: r.expression for r in await qty_formula_service.get_rules(db)}
    rules = await qty_formula_service.replace_rules(db, cleaned, current_user.id)
    await audit_service.log_activity(
        db,
        current_user.id,
        "UPDATE",
        "QtyFormula",
        "singleton",
        details="Updated production quantity formula",
        changes={"rules": [before_rules, {r.size_name: r.expression for r in rules}]},
    )
    return QtyFormulaResponse(
        rules=[QtyFormulaRuleIO(size_name=r.size_name, expression=r.expression) for r in rules],
        defaults=[
            QtyFormulaRuleIO(size_name=n, expression=e)
            for n, e in qty_formula_service.DEFAULT_RULES
        ],
        sizes=known,
        functions=sorted(qty_formula_service.FUNCTIONS.keys()),
        fallback=fallback,
        self_name=qty_formula_service.SELF_NAME,
    )
