from collections.abc import Awaitable
from collections.abc import Callable

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

# Postgres SQLSTATE codes we turn into API errors.
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"


def sqlstate(err: IntegrityError) -> str | None:
    """The Postgres error code behind an IntegrityError (asyncpg puts it on the original error)."""
    code = getattr(err.orig, "sqlstate", None)
    return code if isinstance(code, str) else None


def is_unique_violation(err: IntegrityError) -> bool:
    return sqlstate(err) == UNIQUE_VIOLATION


def is_foreign_key_violation(err: IntegrityError) -> bool:
    return sqlstate(err) == FOREIGN_KEY_VIOLATION


async def retry_on_position_conflict[T](
    session: AsyncSession, attempt: Callable[[], Awaitable[T]], max_attempts: int = 3
) -> T:
    """Two users dropping into the same gap at once compute the same position key, and the
    UNIQUE (parent, position) index rejects the second. Re-reading the neighbours fixes it.

    Each attempt runs inside a SAVEPOINT, so a failed one rolls back only itself, not the
    request's whole transaction."""
    tries = 0
    while True:
        tries += 1
        try:
            async with session.begin_nested():
                return await attempt()
        except IntegrityError as err:
            if not is_unique_violation(err) or tries >= max_attempts:
                raise
