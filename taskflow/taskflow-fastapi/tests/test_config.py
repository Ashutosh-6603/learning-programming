import pytest
from pydantic import ValidationError

from app.config import Settings

REQUIRED = {
    "database_url": "postgresql://taskflow:taskflow@localhost:15404/taskflow",
    "redis_url": "redis://localhost:16304/0",
    "jwt_secret": "x" * 32,
    "s3_endpoint": "http://rustfs:9000",
    "s3_public_endpoint": "http://localhost:19004",
    "s3_bucket": "taskflow-attachments",
    "s3_access_key": "taskflow",
    "s3_secret_key": "taskflow-secret",
}


def test_defaults_conversions_and_the_asyncpg_url() -> None:
    # _env_file=None: read only what we pass, not the developer's .env.
    settings = Settings(_env_file=None, **REQUIRED, smtp_port="11004", cookie_secure="false")  # type: ignore[arg-type]
    assert settings.smtp_port == 11004
    assert settings.cookie_secure is False
    assert settings.access_token_ttl_seconds == 900
    assert settings.sqlalchemy_url.startswith("postgresql+asyncpg://")
    assert settings.frontend_origin == "http://localhost:5173"


def test_every_invalid_variable_is_named() -> None:
    with pytest.raises(ValidationError) as caught:
        Settings(_env_file=None, **(REQUIRED | {"jwt_secret": "short", "redis_url": "nope"}))  # type: ignore[arg-type]
    fields = {str(e["loc"][0]) for e in caught.value.errors()}
    assert fields == {"jwt_secret", "redis_url"}
