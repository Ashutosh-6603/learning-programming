import asyncio
from collections.abc import Awaitable
from typing import Any
from typing import Literal

from fastapi import APIRouter
from fastapi import Response
from sqlalchemy import text

from app.core.schemas import CamelModel
from app.deps import RedisDep
from app.deps import SessionDep

type Status = Literal["ok", "unavailable"]

router = APIRouter(prefix="/health", tags=["health"])


class Liveness(CamelModel):
    status: Literal["ok"]


class Checks(CamelModel):
    database: Status
    redis: Status


class Readiness(CamelModel):
    status: Status
    checks: Checks


async def _check(probe: Awaitable[Any]) -> Status:
    try:
        async with asyncio.timeout(1):
            await probe
    except Exception:
        return "unavailable"
    return "ok"


@router.get("/live")
async def live() -> Liveness:
    return Liveness(status="ok")


@router.get("/ready")
async def ready(response: Response, session: SessionDep, redis: RedisDep) -> Readiness:
    database, cache = await asyncio.gather(
        _check(session.execute(text("SELECT 1"))), _check(redis.ping())
    )
    ok = database == "ok" and cache == "ok"
    response.status_code = 200 if ok else 503
    return Readiness(
        status="ok" if ok else "unavailable", checks=Checks(database=database, redis=cache)
    )
