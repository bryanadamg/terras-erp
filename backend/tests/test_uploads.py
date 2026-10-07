import io

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient

from app.core.uploads import DOCUMENT_EXTS, IMAGE_EXTS, SafeStaticFiles, upload_ext


def _file(name):
    return UploadFile(file=io.BytesIO(b"x"), filename=name)


def test_upload_ext_allows_and_defaults():
    assert upload_ext(_file("a.JPG"), IMAGE_EXTS, ".jpg") == ".jpg"
    assert upload_ext(_file("noext"), DOCUMENT_EXTS, ".pdf") == ".pdf"


@pytest.mark.parametrize("name", ["x.html", "x.svg", "x.htm", "x.js", "x.pdf.html"])
def test_upload_ext_rejects_script_capable(name):
    with pytest.raises(HTTPException) as e:
        upload_ext(_file(name), DOCUMENT_EXTS, ".pdf")
    assert e.value.status_code == 415


def test_static_forces_download_for_non_inline(tmp_path):
    (tmp_path / "evil.html").write_text("<script>alert(1)</script>")
    (tmp_path / "ok.png").write_bytes(b"\x89PNG")
    app = FastAPI()
    app.mount("/static", SafeStaticFiles(directory=tmp_path), name="static")
    c = TestClient(app)

    evil = c.get("/static/evil.html")
    assert evil.headers["content-disposition"] == "attachment"
    assert evil.headers["x-content-type-options"] == "nosniff"

    ok = c.get("/static/ok.png")
    assert "content-disposition" not in ok.headers
    assert ok.headers["x-content-type-options"] == "nosniff"
