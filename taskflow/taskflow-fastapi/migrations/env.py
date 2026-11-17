"""Alembic's entry point: connects with the app's settings and compares against the models."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.config import get_settings
from app.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)


def run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()


async def main() -> None:
    # NullPool: a one-off command needs one connection, not a pool kept warm.
    engine = create_async_engine(get_settings().sqlalchemy_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        # Alembic's API is synchronous; run_sync hands it a sync facade over the async connection.
        await connection.run_sync(run_migrations)
    await engine.dispose()


asyncio.run(main())
