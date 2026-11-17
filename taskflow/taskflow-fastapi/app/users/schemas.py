from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.user import User

DisplayName = Annotated[Trimmed, Field(min_length=1, max_length=80)]


class UpdateUserIn(PatchModel):
    display_name: Annotated[DisplayName | None, NotNull] = None


class UserSummary(CamelModel):
    id: UUID
    email: str
    display_name: str

    @classmethod
    def of(cls, user: User) -> Self:
        """Explicit, field-by-field: nothing reaches the wire unless it's listed here."""
        return cls(id=user.id, email=user.email, display_name=user.display_name)


class UserOut(UserSummary):
    created_at: datetime

    @classmethod
    def of(cls, user: User) -> Self:
        return cls(
            id=user.id, email=user.email, display_name=user.display_name, created_at=user.created_at
        )
