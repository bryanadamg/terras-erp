"""Generic "Export Excel" for any list screen.

The client posts exactly the rows and columns it shows (fetched uncapped, under the
screen's filters) and this only renders them, so a file can never drift from its
grid and a new screen needs no endpoint of its own. The rows are data the caller
could already read; `grant` is the per-screen `<resource>.export` permission that
decides who may take it off the system.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import get_current_user, user_has_permission
from app.models.auth import User
from app.services.xlsx_service import xlsx_response

router = APIRouter()


class XlsxExport(BaseModel):
    grant: str = Field(pattern=r"^[a-z_]+\.export$")
    sheet: str = Field(max_length=64)
    filename: str = Field(max_length=128)
    header: list[str]
    rows: list[list[str | float | int | None]]


@router.post("/export/xlsx")
async def export_xlsx(payload: XlsxExport, current_user: User = Depends(get_current_user)):
    if not user_has_permission(current_user, payload.grant):
        raise HTTPException(status_code=403, detail=f"Missing permission: {payload.grant}")
    return xlsx_response(payload.sheet, payload.header, payload.rows, payload.filename)
