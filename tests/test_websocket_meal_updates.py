"""Tests for the live channel that carries background-analysis updates.

The socket is a notification bus and never the payload of record: the client
still reads the meal over REST, so what matters here is that the push
happens, that it carries the terminal status, and that the handshake
refuses a token it has no business accepting.
"""

import asyncio
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.db.session import get_db
from app.main import app
from app.models import MealStatus
from app.services import nutrition
from app.services.auth import create_access_token
from app.ws.manager import ConnectionManager

STATIC_JS = Path(__file__).resolve().parents[1] / "static" / "js"


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeUser:
    def __init__(self, user_id: int):
        self.id = user_id
        self.is_active = True


class FakeSession:
    """Just enough of AsyncSession for the handshake's user lookup."""

    def __init__(self, user):
        self._user = user

    async def execute(self, statement):
        return FakeResult(self._user)


class FakeSocket:
    """A WebSocket stand-in that records what was sent over it."""

    def __init__(self):
        self.sent = []
        self.accepted = False
        self.closed = None

    async def accept(self):
        self.accepted = True

    async def send_text(self, data):
        self.sent.append(data)

    async def close(self, code=1000, reason=""):
        self.closed = (code, reason)


async def test_notify_meal_update_pushes_the_terminal_status():
    manager = ConnectionManager()
    socket = FakeSocket()
    await manager.connect(socket, 7)

    await manager.notify_meal_update(
        db=None,
        meal_id=42,
        status=MealStatus.COMPLETED,
        user_id=7,
        dish_name="Овсянка",
        calories=320.0,
    )

    assert len(socket.sent) == 1
    message = json.loads(socket.sent[0])
    assert message["type"] == "meal_update"
    assert message["payload"]["meal_id"] == 42
    assert message["payload"]["status"] == "completed"
    assert message["payload"]["dish_name"] == "Овсянка"
    assert message["payload"]["calories"] == 320.0


async def test_notify_meal_update_carries_the_failure():
    manager = ConnectionManager()
    socket = FakeSocket()
    await manager.connect(socket, 7)

    await manager.notify_meal_update(
        db=None,
        meal_id=42,
        status=MealStatus.FAILED,
        user_id=7,
        error_message="Vision timeout",
    )

    message = json.loads(socket.sent[0])
    assert message["payload"]["status"] == "failed"
    assert message["payload"]["error_message"] == "Vision timeout"


async def test_notify_meal_update_leaves_other_users_alone():
    manager = ConnectionManager()
    mine = FakeSocket()
    theirs = FakeSocket()
    await manager.connect(mine, 7)
    await manager.connect(theirs, 8)

    await manager.notify_meal_update(
        db=None,
        meal_id=42,
        status=MealStatus.COMPLETED,
        user_id=7,
    )

    assert len(mine.sent) == 1
    assert theirs.sent == []


async def test_notify_meal_analysis_update_never_raises(monkeypatch):
    """The push is best-effort: the analysis task must not fail because of it."""
    from app.ws.manager import manager

    async def boom(*args, **kwargs):
        raise RuntimeError("socket is broken")

    monkeypatch.setattr(manager, "notify_meal_update", boom)

    # Must not raise.
    await nutrition.notify_meal_analysis_update(
        db=None,
        meal_id=1,
        status=MealStatus.COMPLETED,
        user_id=7,
    )


def test_websocket_answers_ping_with_pong():
    token = create_access_token({"sub": "7"})
    app.dependency_overrides[get_db] = lambda: FakeSession(FakeUser(7))
    try:
        client = TestClient(app)
        with client.websocket_connect(f"/api/v1/ws?token={token}") as websocket:
            websocket.send_text(json.dumps({"type": "ping"}))
            assert websocket.receive_json() == {"type": "pong"}
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_websocket_refuses_an_invalid_token():
    app.dependency_overrides[get_db] = lambda: FakeSession(FakeUser(7))
    try:
        client = TestClient(app)
        with pytest.raises(WebSocketDisconnect) as excinfo:
            with client.websocket_connect("/api/v1/ws?token=not-a-token") as websocket:
                websocket.receive_json()
        # 4001 tells the client that reconnecting with this token is pointless.
        assert excinfo.value.code == 4001
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_the_client_addresses_the_registered_websocket_route():
    """The client must open the route the server registered.

    A handshake to the API prefix matches no websocket route: the server
    answers it with a close before the handshake, which the browser reports
    as "403 Forbidden". The path is therefore pinned to the route here.
    """
    source = (STATIC_JS / "api.js").read_text(encoding="utf-8")
    match = re.search(r"const\s+WS_PATH\s*=\s*['\"]([^'\"]+)['\"]", source)
    assert match, "api.js must define the websocket path as a literal"
    client_path = match.group(1)

    server_paths = {
        route.path
        for route in app.routes
        if getattr(route, "path", "").endswith("/ws")
    }
    assert server_paths, "the server exposes no websocket route"
    assert client_path in server_paths, (
        f"the client opens {client_path!r}, but the server only serves "
        f"{sorted(server_paths)!r}"
    )


def test_an_unknown_websocket_path_is_refused_before_the_handshake():
    """What the browser reports as 403: a close before the handshake."""
    app.dependency_overrides[get_db] = lambda: FakeSession(FakeUser(7))
    try:
        client = TestClient(app)
        with pytest.raises(WebSocketDisconnect):
            with client.websocket_connect("/api/v1?token=whatever") as websocket:
                websocket.receive_json()
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_the_push_reaches_a_connected_client():
    """The whole chain: the endpoint registers the socket, the push finds it."""
    from app.ws.manager import manager

    token = create_access_token({"sub": "7"})
    app.dependency_overrides[get_db] = lambda: FakeSession(FakeUser(7))
    try:
        client = TestClient(app)
        with client.websocket_connect(f"/api/v1/ws?token={token}") as websocket:
            asyncio.run(
                manager.notify_meal_update(
                    db=None,
                    meal_id=42,
                    status=MealStatus.COMPLETED,
                    user_id=7,
                    dish_name="Овсянка",
                )
            )
            message = websocket.receive_json()
            assert message["type"] == "meal_update"
            assert message["payload"]["meal_id"] == 42
            assert message["payload"]["status"] == "completed"
            assert message["payload"]["dish_name"] == "Овсянка"
    finally:
        app.dependency_overrides.pop(get_db, None)
