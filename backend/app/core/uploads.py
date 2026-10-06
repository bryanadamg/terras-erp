"""Upload extension allow-list + hardened /static serving.

Uploads land in static/ and are served from the frontend's own origin (the
Next.js /static rewrite), so a client-chosen `.html`/`.svg` would run script
next to the JWT in localStorage. Every upload route picks its stored
extension through `upload_ext`, never straight off the filename.
"""
import os

from fastapi import HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles

# No .svg: it is an image that can carry <script>.
IMAGE_EXTS = frozenset({".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"})
DOCUMENT_EXTS = IMAGE_EXTS | {".pdf"}
SPREADSHEET_EXTS = frozenset({".xlsx", ".xls"})

# What /static may render inline; anything else is forced to download.
_INLINE_EXTS = DOCUMENT_EXTS


def upload_ext(file: UploadFile, allowed: frozenset[str], default: str) -> str:
    ext = os.path.splitext(file.filename or "")[1].lower() or default
    if ext not in allowed:
        raise HTTPException(
            status_code=415,
            detail=f"File type {ext} not allowed; use {', '.join(sorted(allowed))}",
        )
    return ext


class SafeStaticFiles(StaticFiles):
    """StaticFiles that never lets a stored file execute on our origin —
    covers files uploaded before the allow-list existed, too."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if os.path.splitext(path)[1].lower() not in _INLINE_EXTS:
            response.headers["Content-Disposition"] = "attachment"
        return response
