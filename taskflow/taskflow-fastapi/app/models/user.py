from sqlalchemy import CheckConstraint
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk


class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email"),)

    id: Mapped[UuidPk]
    email: Mapped[str] = mapped_column(unique=True)
    # Deferred: ordinary queries never read the hash. Touching it without undefer() raises.
    password_hash: Mapped[str] = mapped_column(deferred=True, deferred_raiseload=True)
    display_name: Mapped[str]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]
