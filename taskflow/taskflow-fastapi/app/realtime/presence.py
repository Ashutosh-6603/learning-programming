import time
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.users.schemas import UserSummary
from app.users.service import UsersService

STALE_AFTER_MS = 60_000
KEY_TTL_SECONDS = 300


def _key(project_id: UUID) -> str:
    return f"presence:project:{project_id}"


def _member(user_id: UUID, connection_id: UUID) -> str:
    return f"{user_id}:{connection_id}"


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


class Presence:
    """A sorted set per project: member "userId:connectionId", score = last seen (ms).
    One user with two tabs has two members, so closing one tab doesn't hide them."""

    def __init__(self, redis: Redis, sessions: async_sessionmaker[AsyncSession]) -> None:
        self.redis = redis
        self.sessions = sessions

    async def touch(self, project_id: UUID, user_id: UUID, connection_id: UUID) -> None:
        async with self.redis.pipeline(transaction=True) as tx:
            tx.zadd(_key(project_id), {_member(user_id, connection_id): _now_ms()})
            tx.expire(_key(project_id), KEY_TTL_SECONDS)
            await tx.execute()

    async def leave(self, project_id: UUID, user_id: UUID, connection_id: UUID) -> None:
        await self.redis.zrem(_key(project_id), _member(user_id, connection_id))

    async def online(self, project_id: UUID) -> list[UserSummary]:
        # Drop connections that died without a clean close, then read who's left.
        await self.redis.zremrangebyscore(_key(project_id), "-inf", _now_ms() - STALE_AFTER_MS)
        members = await self.redis.zrange(_key(project_id), 0, -1)
        user_ids = {UUID(str(m).split(":", 1)[0]) for m in members}
        if not user_ids:
            return []
        async with self.sessions() as session:
            users = await UsersService(session).get_many(user_ids)
        return sorted((UserSummary.of(u) for u in users), key=lambda u: u.display_name)
