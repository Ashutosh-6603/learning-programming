import asyncio
import contextlib
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from dataclasses import field
from typing import Annotated
from typing import cast
from uuid import UUID
from uuid import uuid7

import structlog
from fastapi import Depends
from fastapi.requests import HTTPConnection
from redis.asyncio import Redis
from redis.asyncio.client import PubSub
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.websockets import WebSocket
from starlette.websockets import WebSocketState

from app.access.service import AccessService
from app.core.problems import ProblemError
from app.core.schemas import CamelModel
from app.infra.resources import Resources
from app.realtime.messages import Ping
from app.realtime.messages import Subscribe
from app.realtime.messages import parse_client_message
from app.realtime.presence import Presence
from app.realtime.publisher import PresenceUpdated
from app.realtime.publisher import Publisher
from app.realtime.publisher import envelope
from app.realtime.publisher import project_channel
from app.realtime.tickets import Tickets

log = structlog.get_logger("realtime")

CLOSE_GOING_AWAY = 1001
CLOSE_TOO_BIG = 1009
CLOSE_BAD_MESSAGES = 4400
CLOSE_UNAUTHORIZED = 4401
MAX_BAD_MESSAGES = 10
MAX_MESSAGE_CHARS = 16 * 1024
IDLE_TIMEOUT_S = 75


@dataclass(eq=False)  # eq=False keeps identity hashing, so a Client can live in a set
class Client:
    ws: WebSocket
    user_id: UUID
    connection_id: UUID = field(default_factory=uuid7)
    projects: set[UUID] = field(default_factory=set)
    last_seen: float = field(default_factory=time.monotonic)
    bad_messages: int = 0
    # One socket, several writers (its own handler, the Pub/Sub relay): send one frame at a time.
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)


class Hub:
    """This instance's WebSocket connections. Events reach it through Redis Pub/Sub, so a write
    handled by any instance reaches sockets connected to every instance."""

    def __init__(self, redis: Redis, sessions: async_sessionmaker[AsyncSession]) -> None:
        self.sessions = sessions
        self.tickets = Tickets(redis)
        self.presence = Presence(redis, sessions)
        self.publisher = Publisher(redis)
        # A connection in SUBSCRIBE mode can't run other commands, so Pub/Sub gets its own.
        self.pubsub: PubSub = redis.pubsub(ignore_subscribe_messages=True)
        self.local: dict[UUID, set[Client]] = {}  # projectId → this instance's sockets
        self.clients: set[Client] = set()
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        self._tasks.append(asyncio.create_task(self._reap_idle()))

    async def close(self) -> None:
        for client in list(self.clients):
            await self._close(client, CLOSE_GOING_AWAY, "server shutting down")
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        # redis-py leaves PubSub.aclose() unannotated, which strict mypy reports.
        await self.pubsub.aclose()  # type: ignore[no-untyped-call]

    async def serve(self, ws: WebSocket) -> None:
        """One connection, from handshake to close."""
        await ws.accept()
        ticket = ws.query_params.get("ticket")
        user_id = await self.tickets.redeem(ticket) if ticket else None
        if user_id is None:
            # The handshake is already accepted, so the browser can read this close code.
            await ws.close(CLOSE_UNAUTHORIZED, "invalid or expired ticket")
            return
        client = Client(ws=ws, user_id=user_id)
        self.clients.add(client)
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                text = message.get("text") or (message.get("bytes") or b"").decode(errors="replace")
                if len(text) > MAX_MESSAGE_CHARS:
                    await self._close(client, CLOSE_TOO_BIG, "message too big")
                    break
                client.last_seen = time.monotonic()
                await self._handle(client, text)
        finally:
            self.clients.discard(client)
            for project_id in list(client.projects):
                await self._unsubscribe(client, project_id)

    async def _handle(self, client: Client, text: str) -> None:
        message = parse_client_message(text)
        try:
            match message:
                case Subscribe(payload=ref):
                    await self._subscribe(client, ref.project_id)
                case Ping():
                    for project_id in client.projects:
                        await self.presence.touch(project_id, client.user_id, client.connection_id)
                    await self._send(client, envelope("pong"))
                case None:
                    client.bad_messages += 1
                    if client.bad_messages > MAX_BAD_MESSAGES:
                        await self._close(client, CLOSE_BAD_MESSAGES, "too many malformed messages")
                        return
                    await self._error(client, "bad_message", "Malformed message")
                case _:  # Unsubscribe: the only type left
                    await self._unsubscribe(client, message.payload.project_id)
        except ProblemError as err:
            if err.status not in (403, 404):
                raise
            await self._error(client, "not_found" if err.status == 404 else "forbidden", err.detail)

    async def _subscribe(self, client: Client, project_id: UUID) -> None:
        async with self.sessions() as session:
            await AccessService(session).project(project_id, client.user_id)
        if project_id not in client.projects:
            client.projects.add(project_id)
            sockets = self.local.setdefault(project_id, set())
            if not sockets:  # the first local socket for this project: start listening
                await self.pubsub.subscribe(project_channel(project_id))
                if len(self._tasks) == 1:
                    self._tasks.append(asyncio.create_task(self._relay()))
            sockets.add(client)
        await self.presence.touch(project_id, client.user_id, client.connection_id)
        await self._send(client, envelope("subscribed", _ProjectPayload(project_id=project_id)))
        await self._broadcast_presence(project_id)

    async def _unsubscribe(self, client: Client, project_id: UUID) -> None:
        if project_id not in client.projects:
            return
        client.projects.discard(project_id)
        sockets = self.local.get(project_id, set())
        sockets.discard(client)
        if not sockets:  # the last local socket left: stop listening
            self.local.pop(project_id, None)
            await self.pubsub.unsubscribe(project_channel(project_id))
        await self.presence.leave(project_id, client.user_id, client.connection_id)
        await self._broadcast_presence(project_id)

    async def _broadcast_presence(self, project_id: UUID) -> None:
        users = await self.presence.online(project_id)
        await self.publisher.publish(
            project_id, "presence.updated", PresenceUpdated(project_id=project_id, users=users)
        )

    async def _relay(self) -> None:
        """Forwards every Pub/Sub message to this instance's sockets for that project."""
        while True:
            message = await self.pubsub.get_message(timeout=1.0)
            if message is None or message["type"] != "message":
                continue
            project_id = UUID(str(message["channel"]).removeprefix("project:"))
            clients = list(self.local.get(project_id, ()))
            await asyncio.gather(*(self._send(c, str(message["data"])) for c in clients))

    async def _reap_idle(self) -> None:
        """Clients ping every 25 s; one that's silent for 75 s is gone without saying so."""
        while True:
            await asyncio.sleep(30)
            cutoff = time.monotonic() - IDLE_TIMEOUT_S
            for client in [c for c in self.clients if c.last_seen < cutoff]:
                await self._close(client, CLOSE_GOING_AWAY, "idle")

    async def _error(self, client: Client, code: str, message: str) -> None:
        await self._send(client, envelope("error", _ErrorPayload(code=code, message=message)))

    async def _send(self, client: Client, text: str) -> None:
        async with client.send_lock:
            if client.ws.application_state is WebSocketState.CONNECTED:
                with contextlib.suppress(Exception):  # the peer may vanish mid-send
                    await client.ws.send_text(text)

    async def _close(self, client: Client, code: int, reason: str) -> None:
        async with client.send_lock:
            if client.ws.application_state is WebSocketState.CONNECTED:
                with contextlib.suppress(Exception):
                    await client.ws.close(code, reason)


class _ProjectPayload(CamelModel):
    project_id: UUID


class _ErrorPayload(CamelModel):
    code: str
    message: str


@asynccontextmanager
async def running_hub(resources: Resources) -> AsyncIterator[Hub]:
    """Started with the app (the lifespan enters it), closed at shutdown."""
    hub = Hub(resources.redis, resources.sessions)
    await hub.start()
    try:
        yield hub
    finally:
        await hub.close()


def get_hub(conn: HTTPConnection) -> Hub:
    return cast(Hub, conn.app.state.hub)


HubDep = Annotated[Hub, Depends(get_hub)]
