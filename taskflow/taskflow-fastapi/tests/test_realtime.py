import asyncio
import json
from collections.abc import AsyncIterator
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import pytest
import uvicorn
from httpx import AsyncClient
from websockets.asyncio.client import ClientConnection
from websockets.asyncio.client import connect

from app.infra.resources import Resources
from app.main import create_app
from tests.helpers import ApiUser
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import reset_state
from tests.helpers import send

type Envelope = dict[str, Any]


class Socket:
    """A WebSocket client that collects every message, so a test can wait for a given type."""

    def __init__(self, conn: ClientConnection) -> None:
        self.conn = conn
        self.received: list[Envelope] = []
        self._arrived = asyncio.Event()
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        async for raw in self.conn:
            self.received.append(json.loads(raw))
            self._arrived.set()

    async def send(self, message: Envelope) -> None:
        await self.conn.send(json.dumps(message))

    async def next(self, type: str, match: Callable[[Envelope], bool] = lambda e: True) -> Envelope:
        """The first message of `type` (already received, or arriving within 5 s)."""
        async with asyncio.timeout(5):
            while True:
                self._arrived.clear()
                for i, message in enumerate(self.received):
                    if message["type"] == type and match(message):
                        return self.received.pop(i)
                await self._arrived.wait()

    async def close(self) -> None:
        await self.conn.close()
        await self._reader


@dataclass(frozen=True)
class Instance:
    http: AsyncClient
    host: str
    resources: Resources


@asynccontextmanager
async def serve() -> AsyncIterator[Instance]:
    """A complete app on a real port: its own uvicorn, hub, database pool and Redis connections."""
    app = create_app()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None))
    task = asyncio.create_task(server.serve())
    while not server.started:  # noqa: ASYNC110 (uvicorn offers a flag, not an event)
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    host = f"127.0.0.1:{port}"
    try:
        async with AsyncClient(base_url=f"http://{host}") as http:
            yield Instance(http=http, host=host, resources=app.state.resources)
    finally:
        server.should_exit = True
        await task


# Two "API instances" in one process. Only Postgres and Redis are shared between them.
@pytest.fixture(scope="module")
async def instances() -> AsyncIterator[tuple[Instance, Instance]]:
    async with serve() as a, serve() as b:
        yield a, b


@pytest.fixture
async def f(instances: tuple[Instance, Instance]) -> Fixture:
    a, _ = instances
    await reset_state(a.resources)
    return await create_fixture(a.http)


async def open_socket(instance: Instance, user: ApiUser) -> Socket:
    res = await send(instance.http, "POST", "/api/v1/ws/ticket", user=user, status=201)
    return Socket(await connect(f"ws://{instance.host}/ws?ticket={res.json()['ticket']}"))


async def test_events_fan_out_across_instances_through_redis(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, b = instances
    socket = await open_socket(a, f.owner)
    await socket.send({"type": "subscribe", "payload": {"projectId": f.project_id}})
    await socket.next("subscribed")
    presence = await socket.next("presence.updated")
    assert [u["id"] for u in presence["payload"]["users"]] == [f.owner.id]

    # The write goes through instance B; the socket lives on instance A.
    url = f"/api/v1/projects/{f.project_id}/tasks"
    await send(b.http, "POST", url, user=f.owner, json={"title": "Live!"}, status=201)
    event = await socket.next("task.created")
    assert (event["payload"]["title"], event["payload"]["key"]) == ("Live!", "TF-1")
    assert event["ts"].endswith("Z")

    await socket.send({"type": "ping"})
    await socket.next("pong")
    await socket.close()


async def test_a_bad_ticket_closes_with_4401_and_tickets_are_single_use(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, _ = instances
    async with connect(f"ws://{a.host}/ws?ticket=nope") as bad:
        await bad.wait_closed()
    assert bad.close_code == 4401

    res = await send(a.http, "POST", "/api/v1/ws/ticket", user=f.owner, status=201)
    ticket = res.json()["ticket"]
    first = Socket(await connect(f"ws://{a.host}/ws?ticket={ticket}"))
    async with connect(f"ws://{a.host}/ws?ticket={ticket}") as reused:
        await reused.wait_closed()
    assert reused.close_code == 4401
    await first.close()


async def test_subscriptions_outside_your_workspaces_are_refused(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, _ = instances
    outsider = await register_user(a.http, "Outsider")
    socket = await open_socket(a, outsider)
    await socket.send({"type": "subscribe", "payload": {"projectId": f.project_id}})
    assert (await socket.next("error"))["payload"]["code"] == "not_found"
    await socket.send({"type": "nonsense"})
    assert (await socket.next("error"))["payload"]["code"] == "bad_message"
    await socket.close()


async def test_presence_updates_when_a_viewer_leaves(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, b = instances
    other = await register_user(a.http, "Other")
    await add_member(a.resources, f.workspace_id, other, "viewer")
    subscribe = {"type": "subscribe", "payload": {"projectId": f.project_id}}

    watcher = await open_socket(a, f.owner)
    await watcher.send(subscribe)
    await watcher.next("subscribed")

    leaver = await open_socket(b, other)
    await leaver.send(subscribe)
    await watcher.next("presence.updated", lambda e: len(e["payload"]["users"]) == 2)

    await leaver.close()
    await watcher.next("presence.updated", lambda e: len(e["payload"]["users"]) == 1)
    await watcher.close()
