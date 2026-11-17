from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings


def create_engine(settings: Settings) -> AsyncEngine:
    # The engine owns the connection pool; one per process, created at startup.
    return create_async_engine(settings.sqlalchemy_url, pool_size=10, pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay readable after commit, without another round trip
    # (async code can't lazily refresh an attribute anyway).
    return async_sessionmaker(engine, expire_on_commit=False)
