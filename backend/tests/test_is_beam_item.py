"""`is_beam_item` must agree with `beam_item_ids`' SQL rule: category, BEAM- code, or ends."""
from types import SimpleNamespace as NS

from app.services.beam_service import is_beam_item


def _item(category=None, code="YRN-1", ends=None):
    return NS(category=NS(name=category) if category else None, code=code, ends=ends)


def test_each_leg_of_the_rule_marks_a_beam():
    assert is_beam_item(_item(category="Beam"))
    assert is_beam_item(_item(code="BEAM-001"))
    assert is_beam_item(_item(category="Yarn", ends=3200))


def test_plain_items_are_not_beams():
    assert not is_beam_item(_item(category="Yarn"))
    assert not is_beam_item(None)
