"""Production output is its own permission, not part of `reports.view`.

Per-machine and per-packer output is a performance figure about named people, so
it was split out of the general reports permission deliberately. A role holding
`reports.view` seeing it again is the regression this guards — and it is silent,
because the person who checks is usually an admin who passes either way.

The report bodies are asserted on shape, not on numbers: the arithmetic
(`reject_pct` and the per-WO grain) has its own coverage in the packing and
manufacturing suites, and an empty window is the honest fixture here.
"""
import pytest

ENDPOINTS = ("/api/reports/machine-output", "/api/reports/packing-output")


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_reports_view_alone_does_not_open_production_output(user_factory, client, endpoint):
    _, headers = user_factory(["reports.view"], "reporter")

    res = client.get(endpoint, headers=headers)
    assert res.status_code == 403, res.text


@pytest.mark.parametrize("endpoint", ENDPOINTS)
def test_production_output_view_opens_it(user_factory, client, endpoint):
    _, headers = user_factory(["production_output.view"], "floor-manager")

    res = client.get(endpoint, headers=headers)
    assert res.status_code == 200, res.text
    body = res.json()
    assert isinstance(body["rows"], list)
    assert "totals" in body


def test_machine_output_echoes_the_grouping_it_applied(client, auth_headers):
    """The UI renders a different table per grouping, so it reads the mode back
    off the response rather than trusting what it asked for."""
    for asked, expected in (("wo", "wo"), ("group", "group"), ("machine", "machine"), ("nonsense", "machine")):
        res = client.get(f"/api/reports/machine-output?group_by={asked}", headers=auth_headers)
        assert res.status_code == 200, res.text
        assert res.json()["group_by"] == expected


def test_wo_status_filter_is_parsed_as_a_list(client, auth_headers):
    res = client.get(
        "/api/reports/machine-output?group_by=wo&wo_status=completed,%20in_progress",
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    assert res.json()["wo_status"] == ["COMPLETED", "IN_PROGRESS"]
