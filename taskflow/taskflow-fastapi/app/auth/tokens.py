from datetime import UTC
from datetime import datetime
from datetime import timedelta
from uuid import UUID

import jwt

from app.config import Settings

ISSUER = "taskflow"
AUDIENCE = "taskflow-api"
ALGORITHM = "HS256"


def create_access_token(user_id: UUID, settings: Settings) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)


def read_access_token(token: str, settings: Settings) -> UUID | None:
    """The user id, if the token's signature, expiry, issuer and audience all check out."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
            leeway=30,
            options={"require": ["sub", "exp", "iat"]},
        )
        return UUID(claims["sub"])
    except jwt.InvalidTokenError, ValueError:
        return None
