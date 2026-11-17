"""Dependencies shared by every feature: `def handler(session: SessionDep)` asks FastAPI for one."""

from collections.abc import AsyncIterator
from typing import Annotated
from typing import cast

from fastapi import Depends
from fastapi.requests import HTTPConnection
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.resources import Resources
from app.infra.storage import Storage
from app.jobs.queue import Jobs


def get_resources(conn: HTTPConnection) -> Resources:
    # HTTPConnection is what Request and WebSocket have in common, so this works for both.
    return cast(Resources, conn.app.state.resources)


ResourcesDep = Annotated[Resources, Depends(get_resources)]


def get_settings_dep(resources: ResourcesDep) -> Settings:
    return resources.settings


def get_redis(resources: ResourcesDep) -> Redis:
    return resources.redis


def get_jobs(resources: ResourcesDep) -> Jobs:
    return resources.jobs


def get_storage(resources: ResourcesDep) -> Storage:
    return resources.storage


async def get_session(resources: ResourcesDep) -> AsyncIterator[AsyncSession]:
    """One session per request. Leaving the `async with` closes it, rolling back anything
    uncommitted, so a request that raises never leaves half a change behind."""
    async with resources.sessions() as session:
        yield session


SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
JobsDep = Annotated[Jobs, Depends(get_jobs)]
StorageDep = Annotated[Storage, Depends(get_storage)]
