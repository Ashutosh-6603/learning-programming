from typing import Annotated
from typing import Any
from typing import Literal
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.service import AccessDep
from app.activity.schemas import ActivityOut
from app.activity.schemas import ActivityQuery
from app.core.pagination import Page
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.deps import SessionDep
from app.models.activity import ActivityEvent

type ActivityType = Literal[
    "workspace.created",
    "workspace.updated",
    "member.joined",
    "member.role_changed",
    "member.removed",
    "invitation.created",
    "invitation.revoked",
    "project.created",
    "project.updated",
    "project.deleted",
    "column.created",
    "column.updated",
    "column.moved",
    "column.deleted",
    "task.created",
    "task.updated",
    "task.moved",
    "task.deleted",
    "comment.created",
    "comment.updated",
    "comment.deleted",
    "attachment.added",
    "attachment.deleted",
]


class ActivityService:
    """Append-only: there is deliberately no update or delete method."""

    def __init__(self, session: SessionDep, access: AccessDep) -> None:
        self.session = session
        self.access = access

    def record(
        self,
        *,
        workspace_id: UUID,
        actor_id: UUID,
        type: ActivityType,
        project_id: UUID | None = None,
        task_id: UUID | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        """Adds the event to the request's session: it commits (or rolls back) with the change."""
        event = ActivityEvent(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type=type,
            project_id=project_id,
            task_id=task_id,
            data=data or {},
        )
        self.session.add(event)

    async def list(self, workspace_id: UUID, user_id: UUID, q: ActivityQuery) -> Page[ActivityOut]:
        await self.access.member(workspace_id, user_id)
        query = (
            select(ActivityEvent)
            .options(joinedload(ActivityEvent.actor))
            .where(ActivityEvent.workspace_id == workspace_id)
        )
        if q.project_id is not None:
            query = query.where(ActivityEvent.project_id == q.project_id)
        if q.task_id is not None:
            query = query.where(ActivityEvent.task_id == q.task_id)
        query = keyset(query, ActivityEvent.id, descending=True, limit=q.limit, after=after_id(q))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, q.limit, ActivityOut.of, lambda e: {"id": str(e.id)})


ActivityDep = Annotated[ActivityService, Depends()]
