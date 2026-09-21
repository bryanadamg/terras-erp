import zipfile
from pathlib import Path

from app.core import db_manager as dm


def _setup_static(tmp_path, monkeypatch):
    static = tmp_path / "static"
    (static / "logos").mkdir(parents=True)
    (static / "samples").mkdir(parents=True)
    (static / "logos" / "company_logo.png").write_bytes(b"logo-bytes")
    (static / "samples" / "12_design.pdf").write_bytes(b"pdf-bytes")
    monkeypatch.setattr(dm, "_STATIC_DIR", static)
    return static


def test_bundle_round_trips_dump_and_uploads(tmp_path, monkeypatch):
    static = _setup_static(tmp_path, monkeypatch)
    dump = tmp_path / "database.sql"
    dump.write_text("-- pg_dump output")
    bundle = tmp_path / "snapshot_manual_20260921_120000.zip"

    assert dm._bundle_snapshot(dump, "database.sql", bundle) == 2

    # Target instance: uploads gone, only the bundle carried over.
    (static / "logos" / "company_logo.png").unlink()
    (static / "samples" / "12_design.pdf").unlink()

    out = tmp_path / "extract"
    out.mkdir()
    restored_dump = dm._unpack_snapshot(bundle, out)

    assert restored_dump == out / "database.sql"
    assert restored_dump.read_text() == "-- pg_dump output"
    # Same relative paths, so the /static/... URLs in restored rows still resolve.
    assert (static / "logos" / "company_logo.png").read_bytes() == b"logo-bytes"
    assert (static / "samples" / "12_design.pdf").read_bytes() == b"pdf-bytes"


def test_unpack_ignores_paths_outside_the_roots(tmp_path, monkeypatch):
    _setup_static(tmp_path, monkeypatch)
    bundle = tmp_path / "evil.zip"
    with zipfile.ZipFile(bundle, "w") as zf:
        zf.writestr("database.sql", "-- dump")
        zf.writestr("../escaped.txt", "nope")
        zf.writestr("etc/passwd", "nope")

    out = tmp_path / "extract"
    out.mkdir()
    dm._unpack_snapshot(bundle, out)

    assert not (tmp_path.parent / "escaped.txt").exists()
    assert not Path("etc/passwd").exists()


def test_unbundled_zip_reports_missing_dump(tmp_path, monkeypatch):
    _setup_static(tmp_path, monkeypatch)
    bundle = tmp_path / "nodump.zip"
    with zipfile.ZipFile(bundle, "w") as zf:
        zf.writestr("static/logos/company_logo.png", "x")

    out = tmp_path / "extract"
    out.mkdir()
    assert dm._unpack_snapshot(bundle, out) is None
