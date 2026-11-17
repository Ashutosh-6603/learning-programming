from functools import lru_cache
from typing import Annotated
from typing import Literal

from pydantic import Field
from pydantic import HttpUrl
from pydantic import PostgresDsn
from pydantic import RedisDsn
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

PositiveInt = Annotated[int, Field(ge=1)]


class Settings(BaseSettings):
    """Every environment variable the app reads. A default makes a variable optional."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["critical", "error", "warning", "info", "debug"] = "info"

    database_url: PostgresDsn
    redis_url: RedisDsn

    jwt_secret: Annotated[str, Field(min_length=32)]
    access_token_ttl_seconds: PositiveInt = 900
    refresh_token_ttl_seconds: PositiveInt = 604_800
    cookie_secure: bool = True

    frontend_url: HttpUrl = HttpUrl("http://localhost:5173")

    s3_endpoint: HttpUrl
    s3_public_endpoint: HttpUrl
    s3_region: str = "us-east-1"
    s3_bucket: Annotated[str, Field(min_length=3)]
    s3_access_key: Annotated[str, Field(min_length=1)]
    s3_secret_key: Annotated[str, Field(min_length=1)]

    smtp_host: str = "localhost"
    smtp_port: PositiveInt = 1025
    mail_from: str = "TaskFlow <no-reply@taskflow.local>"

    rate_limit_auth_per_minute: PositiveInt = 10
    rate_limit_api_per_minute: PositiveInt = 300

    @property
    def sqlalchemy_url(self) -> str:
        """The same database, reached through the asyncpg driver (SQLAlchemy picks it by scheme)."""
        return str(self.database_url).replace("postgresql://", "postgresql+asyncpg://", 1)

    @property
    def frontend_origin(self) -> str:
        """HttpUrl normalises to a trailing slash; a CORS origin never has one."""
        return str(self.frontend_url).rstrip("/")


@lru_cache
def get_settings() -> Settings:
    """Read and validate the environment once; every later call returns the same object."""
    return Settings()
