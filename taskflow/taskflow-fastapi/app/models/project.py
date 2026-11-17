from uuid import UUID

from sqlalchemy import CheckConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "key"),
        CheckConstraint("key ~ '^[A-Z][A-Z0-9]{1,9}$'", name="key"),
        Index("projects_workspace_idx", "workspace_id", "id"),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str]
    key: Mapped[str]
    description: Mapped[str | None]
    next_task_number: Mapped[int] = mapped_column(server_default="1")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class BoardColumn(Base):
    __tablename__ = "board_columns"
    __table_args__ = (
        UniqueConstraint("project_id", "position"),
        CheckConstraint("wip_limit BETWEEN 1 AND 999", name="wip_limit"),
    )

    id: Mapped[UuidPk]
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str]
    # Byte order, not the locale's: fractional keys must sort "Zz" < "a0".
    position: Mapped[str] = mapped_column(Text(collation="C"))
    wip_limit: Mapped[int | None]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    project: Mapped[Project] = relationship(lazy="raise")
