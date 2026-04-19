import pytest

def test_sample_request_lifecycle(client, auth_headers):
    payload = {
        "request_date": "2026-04-18",
        "project": "Spring 2026",
        "customer_article_code": "CUST-001",
        "internal_article_code": "BI-001",
        "width": "8 mm",
        "colors": [
            {"name": "HIJAU", "is_repeat": False, "order": 0},
            {"name": "SILVER", "is_repeat": True, "order": 1},
        ],
        "main_material": "NILON",
        "middle_material": None,
        "bottom_material": None,
        "weft": "NILON",
        "warp": "SPANDEX",
        "original_weight": 12.5,
        "production_weight": 13.0,
        "additional_info": "PRINTING ROTARY",
        "quantity": "1 METER",
        "sample_size": None,
        "estimated_completion_date": "2026-04-25",
        "completion_description": "Urgent — client review",
        "notes": None,
    }
    res = client.post("/api/samples", json=payload, headers=auth_headers)
    assert res.status_code == 200, res.text
    sample = res.json()
    assert sample["status"] == "DRAFT"
    assert "SMP-" in sample["code"]
    assert sample["customer_article_code"] == "CUST-001"
    assert sample["project"] == "Spring 2026"
    assert sample["width"] == "8 mm"
    assert sample["main_material"] == "NILON"
    assert sample["original_weight"] == 12.5
    assert len(sample["colors"]) == 2
    assert sample["colors"][0]["name"] == "HIJAU"
    assert sample["colors"][0]["is_repeat"] is False
    assert sample["colors"][1]["name"] == "SILVER"
    assert sample["colors"][1]["is_repeat"] is True

    # Status transition
    res2 = client.put(f"/api/samples/{sample['id']}/status?status=IN_PRODUCTION", headers=auth_headers)
    assert res2.status_code == 200

    # Appears in list with colors
    res3 = client.get("/api/samples", headers=auth_headers)
    found = next((s for s in res3.json() if s["id"] == sample["id"]), None)
    assert found is not None
    assert found["status"] == "IN_PRODUCTION"
    assert len(found["colors"]) == 2

    # Delete
    res4 = client.delete(f"/api/samples/{sample['id']}", headers=auth_headers)
    assert res4.status_code == 200


def test_sample_no_required_item(client, auth_headers):
    """Sample can be created without any item reference."""
    res = client.post("/api/samples", json={}, headers=auth_headers)
    assert res.status_code == 200
    sample = res.json()
    assert "SMP-" in sample["code"]
    assert sample["colors"] == []
    client.delete(f"/api/samples/{sample['id']}", headers=auth_headers)


def test_sample_empty_color_rows_excluded(client, auth_headers):
    """Color rows with empty names are not saved."""
    payload = {
        "colors": [
            {"name": "RED", "is_repeat": False, "order": 0},
            {"name": "", "is_repeat": False, "order": 1},
        ]
    }
    res = client.post("/api/samples", json=payload, headers=auth_headers)
    assert res.status_code == 200
    sample = res.json()
    assert len(sample["colors"]) == 1
    assert sample["colors"][0]["name"] == "RED"
    client.delete(f"/api/samples/{sample['id']}", headers=auth_headers)


def test_color_status_update(client, auth_headers):
    """Each color's status can be updated independently; invalid status is rejected."""
    payload = {
        "colors": [
            {"name": "RED", "is_repeat": False, "order": 0},
            {"name": "BLUE", "is_repeat": False, "order": 1},
        ]
    }
    res = client.post("/api/samples", json=payload, headers=auth_headers)
    assert res.status_code == 200
    sample = res.json()
    red_id = sample["colors"][0]["id"]
    blue_id = sample["colors"][1]["id"]
    sample_id = sample["id"]

    # Both start as PENDING
    assert sample["colors"][0]["status"] == "PENDING"
    assert sample["colors"][1]["status"] == "PENDING"

    # Approve RED
    res2 = client.put(
        f"/api/samples/{sample_id}/colors/{red_id}/status?status=APPROVED",
        headers=auth_headers,
    )
    assert res2.status_code == 200
    assert res2.json()["status"] == "APPROVED"

    # BLUE is still PENDING
    res3 = client.get("/api/samples", headers=auth_headers)
    found = next(s for s in res3.json() if s["id"] == sample_id)
    colors_by_id = {c["id"]: c for c in found["colors"]}
    assert colors_by_id[red_id]["status"] == "APPROVED"
    assert colors_by_id[blue_id]["status"] == "PENDING"

    # Wrong sample_id returns 404
    res4 = client.put(
        f"/api/samples/00000000-0000-0000-0000-000000000000/colors/{red_id}/status?status=APPROVED",
        headers=auth_headers,
    )
    assert res4.status_code == 404

    # Invalid status returns 400
    res5 = client.put(
        f"/api/samples/{sample_id}/colors/{red_id}/status?status=NONSENSE",
        headers=auth_headers,
    )
    assert res5.status_code == 400

    # Cleanup
    client.delete(f"/api/samples/{sample_id}", headers=auth_headers)
