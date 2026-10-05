"""Print layout templates — storage for client-edited document designs.

Contract with the frontend:
  * A missing row is not an error. It means "use the built-in default layout",
    which lives as a TS constant next to the renderer. So `GET` returns only the
    rows that have been customised, and `DELETE` is how the designer's
    "Reset to default" button works.
  * `layout` is opaque here. The backend stores and returns it untouched; the
    frontend `TemplateRenderer` is the sole interpreter. Do not add validation of
    band shapes in this module — a new band type must not require a backend
    deploy.

Writes are gated on `admin.access` (Administrator role only): a print layout is
company-wide, and every operator on the floor prints from it.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_async_db
from app.models.print_template import PrintTemplate
from app.models.auth import User
from app.api.auth import get_current_user, require_permission
from app.services import audit_service
from app.core.ws_manager import manager
from app.schemas import PrintTemplateSave, PrintTemplateResponse

router = APIRouter()


@router.get("/print-templates", response_model=list[PrintTemplateResponse])
async def list_print_templates(
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    """Every customised template. Small table (one row per document type), so the
    frontend loads it whole into DataContext and prints from memory."""
    result = await db.execute(select(PrintTemplate).order_by(PrintTemplate.doc_type))
    return result.scalars().all()


@router.get("/print-templates/{doc_type}", response_model=PrintTemplateResponse)
async def get_print_template(
    doc_type: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(PrintTemplate).filter(PrintTemplate.doc_type == doc_type))
    tpl = result.scalars().first()
    if not tpl:
        # 404 means "not customised" — the caller falls back to its built-in default.
        raise HTTPException(status_code=404, detail="No saved template for this document type")
    return tpl


@router.put("/print-templates/{doc_type}", response_model=PrintTemplateResponse)
async def save_print_template(
    doc_type: str,
    payload: PrintTemplateSave,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("print_layout.edit")),
):
    """Upsert — the designer saves the whole layout, not a patch."""
    result = await db.execute(select(PrintTemplate).filter(PrintTemplate.doc_type == doc_type))
    tpl = result.scalars().first()
    action = "UPDATE" if tpl else "CREATE"

    if tpl:
        tpl.layout = payload.layout
        tpl.paper = payload.paper
        tpl.updated_by_id = current_user.id
    else:
        tpl = PrintTemplate(
            doc_type=doc_type,
            layout=payload.layout,
            paper=payload.paper,
            updated_by_id=current_user.id,
        )
        db.add(tpl)

    await db.commit()
    result = await db.execute(select(PrintTemplate).filter(PrintTemplate.doc_type == doc_type))
    tpl = result.scalars().first()

    band_count = len((payload.layout or {}).get("bands") or [])
    await audit_service.log_activity(
        db, str(current_user.id), action, "PrintTemplate", str(tpl.id),
        details=f"Saved print layout for {doc_type} ({band_count} bands)",
        changes=audit_service.added({"doc_type": doc_type}),
    )
    await manager.broadcast({"type": "PRINT_TEMPLATE_UPDATE", "doc_type": doc_type})
    return tpl


@router.delete("/print-templates/{doc_type}")
async def reset_print_template(
    doc_type: str,
    db: AsyncSession = Depends(get_async_db),
    current_user: User = Depends(require_permission("print_layout.edit")),
):
    """Reset to the built-in default by dropping the customisation."""
    result = await db.execute(select(PrintTemplate).filter(PrintTemplate.doc_type == doc_type))
    tpl = result.scalars().first()
    if not tpl:
        raise HTTPException(status_code=404, detail="No saved template for this document type")

    tpl_id = str(tpl.id)
    await db.delete(tpl)
    await db.commit()

    await audit_service.log_activity(
        db, str(current_user.id), "DELETE", "PrintTemplate", tpl_id,
        details=f"Reset print layout for {doc_type} to built-in default",
        changes=audit_service.added({"doc_type": doc_type}),
    )
    await manager.broadcast({"type": "PRINT_TEMPLATE_UPDATE", "doc_type": doc_type})
    return {"ok": True, "doc_type": doc_type}
