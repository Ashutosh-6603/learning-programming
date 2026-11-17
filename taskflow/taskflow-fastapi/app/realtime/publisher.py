import json
from datetime import UTC
from datetime import datetime
from typing import Annotated
from typing import Any
from typing import Literal
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel

from app.comments.schemas import CommentOut
from app.core.schemas import CamelModel
from app.deps import RedisDep
from app.users.schemas import UserSummary

type EventType = Literal[
    "task.created",
    "task.updated",
    "task.moved",
    "task.deleted",
    "column.created",
    "column.updated",
    "column.moved",
    "column.deleted",
    "comment.created",
    "presence.updated",
]


class ColumnDeleted(CamelModel):
    id: UUID
    project_id: UUID


class TaskDeleted(CamelModel):
    id: UUID
    project_id: UUID
    column_id: UUID


class CommentCreated(CamelModel):
    project_id: UUID
    comment: CommentOut


class PresenceUpdated(CamelModel):
    project_id: UUID
    users: list[UserSummary]


def project_channel(project_id: UUID | str) -> str:
    return f"project:{project_id}"


def envelope(type: str, payload: BaseModel | None = None) -> str:
    """`{ "type", "payload"?, "ts" }`, the JSON every message on the socket is wrapped in."""
    message: dict[str, Any] = {"type": type}
    if payload is not None:
        message["payload"] = payload.model_dump(mode="json", by_alias=True)
    message["ts"] = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return json.dumps(message)


class Publisher:
    """Publishes to Redis; every API instance's WebSocket hub relays to its own sockets."""

    def __init__(self, redis: RedisDep) -> None:
        self.redis = redis

    async def publish(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.redis.publish(project_channel(project_id), envelope(type, payload))


PublisherDep = Annotated[Publisher, Depends()]
