from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.db.session import create_engine
from app.db.session import create_session_factory
from app.infra.storage import Storage
from app.jobs.queue import Jobs
from app.jobs.queue import create_celery


@dataclass(frozen=True, slots=True)
class Resources:
    """Everything with a connection or a pool: created once at startup, closed at shutdown."""

    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
    jobs: Jobs
    storage: Storage


@asynccontextmanager
async def open_resources(settings: Settings) -> AsyncIterator[Resources]:
    engine = create_engine(settings)
    # decode_responses: Redis replies arrive as str, not bytes.
    redis = Redis.from_url(str(settings.redis_url), decode_responses=True)
    celery = create_celery(settings)
    try:
        yield Resources(
            settings=settings,
            engine=engine,
            sessions=create_session_factory(engine),
            redis=redis,
            jobs=Jobs(celery),
            storage=Storage(settings),
        )
    finally:
        celery.close()
        await redis.aclose()
        await engine.dispose()
