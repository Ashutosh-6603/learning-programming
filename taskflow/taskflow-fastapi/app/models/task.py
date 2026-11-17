from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import BigInteger
from sqlalchemy import CheckConstraint
from sqlalchemy import Computed
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.user import User

type Priority = Literal["low", "medium", "high", "urgent"]
type AttachmentStatus = Literal["pending", "ready"]

SEARCH_VECTOR = (
    "setweight(to_tsvector('english', title), 'A') || "
    "setweight(to_tsvector('english', coalesce(description, '')), 'B')"
)


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "number"),
        UniqueConstraint("column_id", "position"),
        CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name="priority"),
        Index("tasks_project_idx", "project_id", "id"),
        Index("tasks_assignee_idx", "assignee_id", "id"),
        Index("tasks_search_idx", "search_vector", postgresql_using="gin"),
        Index(
            "tasks_due_reminder_idx",
            "due_at",
            postgresql_where=text("reminder_sent_at IS NULL AND assignee_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # No ON DELETE action: Postgres refuses to delete a column that still has tasks.
    column_id: Mapped[UUID] = mapped_column(ForeignKey("board_columns.id"))
    number: Mapped[int]
    title: Mapped[str]
    description: Mapped[str | None]
    priority: Mapped[Priority] = mapped_column(Text, server_default="medium")
    assignee_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reporter_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    due_at: Mapped[datetime | None]
    reminder_sent_at: Mapped[datetime | None]
    position: Mapped[str] = mapped_column(Text(collation="C"))
    # Postgres computes it on every write; the ORM never selects or sets it.
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR, Computed(SEARCH_VECTOR, persisted=True), deferred=True, deferred_raiseload=True
    )
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    project: Mapped[Project] = relationship(lazy="raise")
    column: Mapped[BoardColumn] = relationship(lazy="raise")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id], lazy="raise")
    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id], lazy="raise")


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("comments_task_idx", "task_id", "id"),)

    id: Mapped[UuidPk]
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    author_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    task: Mapped[Task] = relationship(lazy="raise")
    author: Mapped[User] = relationship(lazy="raise")


class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="size_bytes"),
        CheckConstraint("status IN ('pending', 'ready')", name="status"),
        Index("attachments_task_idx", "task_id", "id", postgresql_where=text("status = 'ready'")),
        Index("attachments_pending_idx", "created_at", postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[UuidPk]
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    uploader_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    file_name: Mapped[str]
    content_type: Mapped[str]
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(unique=True)
    status: Mapped[AttachmentStatus] = mapped_column(Text, server_default="pending")
    created_at: Mapped[CreatedAt]

    task: Mapped[Task] = relationship(lazy="raise")
    uploader: Mapped[User] = relationship(lazy="raise")
