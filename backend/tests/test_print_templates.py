"""Print layouts: one row per doc_type, and NO row means the built-in default.

That second half is the load-bearing part — the designer's Reset is a DELETE, so
a template that lingers after a reset silently keeps overriding the code default
on every print.
"""
import uuid


def _doc_type():
    return f"test_doc_{uuid.uuid4().hex[:8]}"


def test_save_is_an_upsert_not_a_second_row(client, auth_headers):
    doc = _doc_type()
    first = client.put(
        f"/api/print-templates/{doc}",
        json={"layout": {"bands": [{"id": "header"}]}, "paper": {"size": "A4"}},
        headers=auth_headers,
    )
    assert first.status_code == 200, first.text

    second = client.put(
        f"/api/print-templates/{doc}",
        json={"layout": {"bands": [{"id": "header"}, {"id": "footer"}]}},
        headers=auth_headers,
    )
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"], "a second save must not mint a second template"
    assert len(second.json()["layout"]["bands"]) == 2

    listed = client.get("/api/print-templates", headers=auth_headers).json()
    assert [t["doc_type"] for t in listed].count(doc) == 1


def test_reset_removes_the_row_so_the_default_takes_over(client, auth_headers):
    doc = _doc_type()
    client.put(f"/api/print-templates/{doc}", json={"layout": {"bands": []}}, headers=auth_headers)

    res = client.delete(f"/api/print-templates/{doc}", headers=auth_headers)
    assert res.status_code == 200, res.text

    # 404 is how the frontend learns to render the built-in layout.
    assert client.get(f"/api/print-templates/{doc}", headers=auth_headers).status_code == 404
    # And resetting twice is an error, not a silent success.
    assert client.delete(f"/api/print-templates/{doc}", headers=auth_headers).status_code == 404


def test_an_undesigned_doc_type_has_no_row(client, auth_headers):
    assert client.get(f"/api/print-templates/{_doc_type()}", headers=auth_headers).status_code == 404
