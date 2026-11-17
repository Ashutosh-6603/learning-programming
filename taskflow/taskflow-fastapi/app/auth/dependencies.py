from typing import Annotated
from uuid import UUID

import structlog
from fastapi import Depends
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security import HTTPBearer
from redis.exceptions import RedisError

from app.auth.tokens import read_access_token
from app.core.problems import ProblemError
from app.core.problems import unauthorized
from app.core.rate_limit import SlidingWindowLimiter
from app.deps import RedisDep
from app.deps import SettingsDep

# auto_error=False: a missing header reaches us as None, so the 401 is our problem+json.
# It also tells the generated OpenAPI document that these routes take a Bearer token.
bearer = HTTPBearer(auto_error=False)


async def authenticate(
    request: Request,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> UUID:
    """The caller's user id, from a valid access token; otherwise 401."""
    if credentials is None:
        raise unauthorized()
    user_id = read_access_token(credentials.credentials, settings)
    if user_id is None:
        raise unauthorized("Invalid or expired access token")
    # For the access log, and for every log line written while handling this request.
    request.state.user_id = str(user_id)
    structlog.contextvars.bind_contextvars(userId=str(user_id))
    return user_id


# `user_id: CurrentUser` in a handler: FastAPI runs authenticate() first and passes the result.
CurrentUser = Annotated[UUID, Depends(authenticate)]


MINUTE_MS = 60_000
log = structlog.get_logger("rate-limit")


async def _enforce(limiter: SlidingWindowLimiter, key: str) -> None:
    try:
        result = await limiter.hit(key)
    except RedisError:
        # Better to serve without limits for a while than to refuse every request.
        log.warning("rate limiter unavailable; failing open", exc_info=True)
        return
    if not result.allowed:
        seconds = result.retry_after_seconds
        raise ProblemError(
            "rate-limited", f"Retry in {seconds} seconds", headers={"Retry-After": str(seconds)}
        )


async def limit_auth(request: Request, redis: RedisDep, settings: SettingsDep) -> None:
    """The strict "auth" bucket (register, login, refresh), counted per client IP."""
    ip = request.client.host if request.client else "unknown"
    limiter = SlidingWindowLimiter(redis, settings.rate_limit_auth_per_minute, MINUTE_MS)
    await _enforce(limiter, f"ratelimit:auth:ip:{ip}")


async def limit_api(user_id: CurrentUser, redis: RedisDep, settings: SettingsDep) -> None:
    """Every authenticated route, counted per user. Depends on CurrentUser, so it runs second."""
    limiter = SlidingWindowLimiter(redis, settings.rate_limit_api_per_minute, MINUTE_MS)
    await _enforce(limiter, f"ratelimit:api:user:{user_id}")
