"""A Combo is two rows, not one.

The library row is what people manage; the mirrored value of the `Combo` system
attribute is what BOM/SO/sample variant gating actually resolves against. If the
mirror is not written on create — or not cleaned up on delete — the two drift and
a combo either cannot be selected anywhere or haunts the dropdowns forever.

The mirror is read back through the async session, not through `GET /attributes`:
that route is sync and sits on a different connection, which cannot see what the
async combo route just wrote inside this test's transaction.
"""
import uuid

import pytest


def _attribute_value(client, async_db_session, value_id):
    """The mirrored AttributeValue row, or None."""
    from sqlalchemy import select
    from app.models.attribute import Attribute, AttributeValue

    async def _load():
        row = (await async_db_session.execute(
            select(AttributeValue, Attribute)
            .join(Attribute, Attribute.id == AttributeValue.attribute_id)
            .filter(AttributeValue.id == value_id)
        )).first()
        return None if row is None else (row[0].value, row[1].system_role)

    return client.portal.call(_load)


@pytest.fixture
def combo(client, auth_headers):
    code = f"CMB-{uuid.uuid4().hex[:6].upper()}"
    res = client.post(
        "/api/combos",
        json={"code": code, "name": f"Mirror Test {code}", "status": "active"},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    yield body
    client.delete(f"/api/combos/{body['id']}", headers=auth_headers)


def test_creating_a_combo_mirrors_it_onto_the_combo_attribute(
    client, auth_headers, async_db_session, combo
):
    assert combo["attribute_value_id"], "the combo must remember which value mirrors it"
    mirrored = _attribute_value(client, async_db_session, combo["attribute_value_id"])
    assert mirrored is not None, "BOM/SO gating reads the attribute value, not the combo row"
    value, system_role = mirrored
    assert value == combo["name"]
    assert system_role == "combo", "the mirror must land on the Combo system attribute"


def test_deleting_an_unused_combo_takes_its_mirrored_value_with_it(
    client, auth_headers, async_db_session
):
    code = f"CMB-{uuid.uuid4().hex[:6].upper()}"
    created = client.post(
        "/api/combos", json={"code": code, "name": f"Throwaway {code}"}, headers=auth_headers
    ).json()
    assert _attribute_value(client, async_db_session, created["attribute_value_id"]) is not None

    res = client.delete(f"/api/combos/{created['id']}", headers=auth_headers)
    assert res.status_code == 200, res.text

    assert _attribute_value(client, async_db_session, created["attribute_value_id"]) is None, (
        "an unreferenced combo is a hard delete on BOTH rows"
    )


def test_duplicate_codes_are_refused(client, auth_headers, combo):
    res = client.post(
        "/api/combos", json={"code": combo["code"], "name": "Clash"}, headers=auth_headers
    )
    assert res.status_code == 400, res.text
