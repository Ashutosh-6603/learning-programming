from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.access.roles import InvitableRole
from app.access.roles import Role
from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk
from app.models.user import User


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UuidPk]
    name: Mapped[str]
    slug: Mapped[str] = mapped_column(unique=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]


class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id"),
        CheckConstraint("role IN ('owner', 'admin', 'member', 'viewer')", name="role"),
        Index("workspace_members_user_idx", "user_id", "workspace_id"),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # An explicit Text: a Literal annotation alone would become a Postgres ENUM type.
    role: Mapped[Role] = mapped_column(Text)
    joined_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # lazy="raise": async code can't load a relationship behind your back; ask for it in the query.
    user: Mapped[User] = relationship(lazy="raise")
    workspace: Mapped[Workspace] = relationship(lazy="raise")


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email"),
        CheckConstraint("role IN ('admin', 'member', 'viewer')", name="role"),
        Index(
            "invitations_pending_email_uq",
            "workspace_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL"),
        ),
        Index(
            "invitations_workspace_idx",
            "workspace_id",
            "id",
            postgresql_where=text("accepted_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    email: Mapped[str]
    role: Mapped[InvitableRole] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(unique=True)
    invited_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime]
    accepted_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]

    inviter: Mapped[User] = relationship(lazy="raise")
    workspace: Mapped[Workspace] = relationship(lazy="raise")
