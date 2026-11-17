"""Shared fixtures. pytest loads this file before any test module."""

import asyncio
import os
from collections.abc import AsyncIterator

import boto3
import pytest
from alembic import command
from alembic.config import Config
from botocore.exceptions import ClientError
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings
from app.config import get_settings

# Tests never touch the dev data: the same Postgres with a `_test` database, Redis database 1.
_dev = Settings()
os.environ |= {
    "APP_ENV": "test",
    "LOG_LEVEL": "critical",
    "DATABASE_URL": f"{str(_dev.database_url).rsplit('/', 1)[0]}/taskflow_test",
    "REDIS_URL": f"{str(_dev.redis_url).rsplit('/', 1)[0]}/1",
}
get_settings.cache_clear()

from app.infra.resources import Resources  # noqa: E402  (after the environment is set)
from app.main import create_app  # noqa: E402
from tests.helpers import reset_state  # noqa: E402


async def _create_database(settings: Settings) -> None:
    server, name = settings.sqlalchemy_url.rsplit("/", 1)
    # CREATE DATABASE can't run inside a transaction, hence AUTOCOMMIT.
    engine = create_async_engine(f"{server}/postgres", isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{name}"'))
    await engine.dispose()


def _create_bucket(settings: Settings) -> None:
    s3 = boto3.client(
        "s3",
        endpoint_url=str(settings.s3_endpoint),
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        s3.create_bucket(Bucket=settings.s3_bucket)


def pytest_sessionstart(session: pytest.Session) -> None:
    """Once, before any test: create the test database and migrate it to the latest revision."""
    asyncio.run(_create_database(get_settings()))
    command.upgrade(Config("alembic.ini"), "head")
    # CI's S3 service has no init job; locally the bucket usually exists already.
    _create_bucket(get_settings())


@pytest.fixture(scope="session")
async def app() -> AsyncIterator[FastAPI]:
    """The real application, started once: its lifespan opens the pools, as in production."""
    application = create_app()
    async with application.router.lifespan_context(application):
        yield application


@pytest.fixture(scope="session")
def resources(app: FastAPI) -> Resources:
    resources: Resources = app.state.resources
    return resources


@pytest.fixture
async def client(app: FastAPI, resources: Resources) -> AsyncIterator[AsyncClient]:
    """An HTTP client wired straight to the app (no port, no network), on an empty database."""
    await reset_state(resources)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
