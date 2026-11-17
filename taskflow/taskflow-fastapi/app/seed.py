"""`uv run python -m app.seed`: creates the default development user in the database."""

import asyncio

from app.config import get_settings
from app.db.session import create_engine
from app.db.session import create_session_factory
from app.users.default_user import DEFAULT_EMAIL
from app.users.default_user import seed_default_user
from app.users.service import UsersService


async def main() -> None:
    settings = get_settings()
    if settings.app_env == "production":
        raise SystemExit("Refusing to seed a production database")
    engine = create_engine(settings)
    try:
        async with create_session_factory(engine)() as session:
            result = await seed_default_user(UsersService(session))
    finally:
        await engine.dispose()
    print(f"default user {DEFAULT_EMAIL}: {result}")


if __name__ == "__main__":
    asyncio.run(main())
