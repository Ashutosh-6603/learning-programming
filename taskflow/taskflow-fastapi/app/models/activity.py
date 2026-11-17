from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UuidPk
from app.models.user import User


class ActivityEvent(Base):
    """Append-only audit log. No FK to projects or tasks: history outlives what it describes."""

    __tablename__ = "activity_events"
    __table_args__ = (
        Index("activity_workspace_idx", "workspace_id", "id"),
        Index(
            "activity_project_idx",
            "project_id",
            "id",
            postgresql_where=text("project_id IS NOT NULL"),
        ),
        Index("activity_task_idx", "task_id", "id", postgresql_where=text("task_id IS NOT NULL")),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    project_id: Mapped[UUID | None]
    task_id: Mapped[UUID | None]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str]
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    created_at: Mapped[CreatedAt]

    actor: Mapped[User] = relationship(lazy="raise")
