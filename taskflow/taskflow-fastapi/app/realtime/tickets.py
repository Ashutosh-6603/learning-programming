import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from uuid import UUID

from redis.asyncio import Redis

from app.core.schemas import CamelModel

TTL_SECONDS = 30


def _key(ticket: str) -> str:
    return f"ws:ticket:{ticket}"


class TicketOut(CamelModel):
    ticket: str
    expires_at: datetime


class Tickets:
    """Browsers can't set Authorization on a WebSocket handshake: they trade a JWT for a ticket."""

    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def issue(self, user_id: UUID) -> TicketOut:
        ticket = secrets.token_urlsafe(32)
        await self.redis.set(_key(ticket), str(user_id), ex=TTL_SECONDS)
        return TicketOut(
            ticket=ticket, expires_at=datetime.now(UTC) + timedelta(seconds=TTL_SECONDS)
        )

    async def redeem(self, ticket: str) -> UUID | None:
        """Single use: GETDEL reads and deletes in one atomic step."""
        user_id = await self.redis.getdel(_key(ticket))
        return UUID(str(user_id)) if user_id is not None else None
