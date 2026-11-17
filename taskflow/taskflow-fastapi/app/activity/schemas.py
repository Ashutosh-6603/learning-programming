from datetime import datetime
from typing import Any
from typing import Self
from uuid import UUID

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.models.activity import ActivityEvent
from app.users.schemas import UserSummary


class ActivityQuery(PageQuery):
    project_id: UUID | None = None
    task_id: UUID | None = None


class ActivityOut(CamelModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None
    task_id: UUID | None
    actor: UserSummary
    type: str
    data: dict[str, Any]
    created_at: datetime

    @classmethod
    def of(cls, event: ActivityEvent) -> Self:
        return cls(
            id=event.id,
            workspace_id=event.workspace_id,
            project_id=event.project_id,
            task_id=event.task_id,
            actor=UserSummary.of(event.actor),
            type=event.type,
            data=event.data,
            created_at=event.created_at,
        )
