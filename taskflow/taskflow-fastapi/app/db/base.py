from datetime import datetime
from typing import Annotated
from typing import Any
from typing import ClassVar
from uuid import UUID
from uuid import uuid7

from sqlalchemy import DateTime
from sqlalchemy import MetaData
from sqlalchemy import Text
from sqlalchemy import func
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import mapped_column

# Postgres's own names: users_pkey, users_email_key, tasks_column_id_fkey, users_email_check.
NAMING_CONVENTION = {
    "pk": "%(table_name)s_pkey",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
    "ck": "%(table_name)s_%(constraint_name)s_check",
    "ix": "%(table_name)s_%(column_0_N_name)s_idx",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # Python type → column type, for every `Mapped[...]` that doesn't name one itself.
    type_annotation_map: ClassVar = {str: Text(), datetime: DateTime(timezone=True)}
    # INSERT and UPDATE use RETURNING to read back what the database filled in (now(), defaults).
    __mapper_args__: Any = {"eager_defaults": True}  # noqa: RUF012 (SQLAlchemy reads it)


# Reusable column definitions: `id: Mapped[UuidPk]` reads like a type, and is one.
UuidPk = Annotated[UUID, mapped_column(primary_key=True, default=uuid7)]
CreatedAt = Annotated[datetime, mapped_column(server_default=func.now())]
UpdatedAt = Annotated[datetime, mapped_column(server_default=func.now(), onupdate=func.now())]
