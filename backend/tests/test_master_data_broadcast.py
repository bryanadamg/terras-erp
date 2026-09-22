"""The master-data routers are sync (`def` + `Session`), so they cannot await
`manager.broadcast`. They go through `ws_manager.broadcast_sync`, which borrows
the running loop from the worker thread FastAPI put the endpoint on. That bridge
is the thing worth a test: if it stops working the mutation still succeeds and
the event just silently never arrives.
"""
import pytest

from app.core import ws_manager
from app.core.ws_events import EVENT_PERMISSIONS, EVENT_TOPICS


@pytest.fixture
def captured_events(monkeypatch):
    seen: list[dict] = []

    async def fake_broadcast(message: dict):
        seen.append(message)

    monkeypatch.setattr(ws_manager.manager, "broadcast", fake_broadcast)
    return seen


def test_creating_a_uom_reaches_the_bus_from_a_sync_route(client, auth_headers, captured_events):
    res = client.post("/api/uoms", json={"name": "TEST-BRIDGE-UOM"}, headers=auth_headers)
    assert res.status_code == 200, res.text
    assert {"type": "MASTER_DATA_UPDATE", "domain": "uoms"} in captured_events


def test_the_event_is_registered_for_delivery():
    # Unregistered types are dropped by can_receive(), so the broadcast above
    # would reach nobody.
    assert "MASTER_DATA_UPDATE" in EVENT_PERMISSIONS
    assert EVENT_TOPICS["MASTER_DATA_UPDATE"] == "system"


def test_broadcast_sync_swallows_a_dead_bus(monkeypatch):
    # A mutation that already committed must not fail because the bus is down.
    async def boom(message):
        raise RuntimeError("redis is gone")

    monkeypatch.setattr(ws_manager.manager, "broadcast", boom)
    ws_manager.broadcast_sync({"type": "MASTER_DATA_UPDATE", "domain": "uoms"})
