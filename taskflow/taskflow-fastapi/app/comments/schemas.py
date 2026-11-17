from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.models.task import Comment
from app.users.schemas import UserSummary


class CommentBody(CamelModel):
    body: Annotated[str, Field(min_length=1, max_length=5000)]


class CommentOut(CamelModel):
    id: UUID
    task_id: UUID
    author: UserSummary
    body: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, comment: Comment) -> Self:
        return cls(
            id=comment.id,
            task_id=comment.task_id,
            author=UserSummary.of(comment.author),
            body=comment.body,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
        )
