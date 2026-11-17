from collections.abc import Awaitable
from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.deps import RedisDep
from app.projects.schemas import BoardOut

TTL_SECONDS = 300


def _key(project_id: UUID) -> str:
    return f"cache:board:{project_id}"


class BoardCache:
    """Cache-aside: read through on a miss, delete after every write that changes the board."""

    def __init__(self, redis: RedisDep) -> None:
        self.redis = redis

    async def get_or_load(
        self, project_id: UUID, load: Callable[[], Awaitable[BoardOut]]
    ) -> BoardOut:
        cached = await self.redis.get(_key(project_id))
        if cached is not None:
            return BoardOut.model_validate_json(cached)
        board = await load()
        await self.redis.set(_key(project_id), board.model_dump_json(by_alias=True), ex=TTL_SECONDS)
        return board

    async def invalidate(self, project_id: UUID) -> None:
        await self.redis.delete(_key(project_id))


BoardCacheDep = Annotated[BoardCache, Depends()]
