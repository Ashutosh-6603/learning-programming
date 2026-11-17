from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.roles import Role
from app.access.roles import at_least
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Attachment
from app.models.task import Comment
from app.models.task import Task
from app.models.workspace import WorkspaceMember


class AccessService:
    """Every workspace-scoped request goes through here.
    Not a member → 404 (don't reveal the resource exists). Role too low → 403."""

    def __init__(self, session: SessionDep) -> None:
        self.session = session

    async def member(
        self, workspace_id: UUID, user_id: UUID, minimum: Role = "viewer", what: str = "Workspace"
    ) -> WorkspaceMember:
        membership = await self.session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
            )
        )
        if membership is None:
            raise not_found(what)
        if not at_least(membership.role, minimum):
            raise forbidden()
        return membership

    async def project(
        self, project_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[Project, WorkspaceMember]:
        project = await self.session.get(Project, project_id)
        if project is None:
            raise not_found("Project")
        return project, await self.member(project.workspace_id, user_id, minimum, "Project")

    async def column(
        self, column_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[BoardColumn, Project, WorkspaceMember]:
        column = await self.session.scalar(
            select(BoardColumn)
            .options(joinedload(BoardColumn.project))
            .where(BoardColumn.id == column_id)
        )
        if column is None:
            raise not_found("Column")
        membership = await self.member(column.project.workspace_id, user_id, minimum, "Column")
        return column, column.project, membership

    async def task(
        self, task_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[Task, Project, WorkspaceMember]:
        task = await self.session.scalar(
            select(Task).options(joinedload(Task.project)).where(Task.id == task_id)
        )
        if task is None:
            raise not_found("Task")
        membership = await self.member(task.project.workspace_id, user_id, minimum, "Task")
        return task, task.project, membership

    async def comment(
        self, comment_id: UUID, user_id: UUID
    ) -> tuple[Comment, Project, WorkspaceMember]:
        comment = await self.session.scalar(
            select(Comment)
            .options(joinedload(Comment.task).joinedload(Task.project))
            .where(Comment.id == comment_id)
        )
        if comment is None:
            raise not_found("Comment")
        project = comment.task.project
        membership = await self.member(project.workspace_id, user_id, "viewer", "Comment")
        return comment, project, membership

    async def attachment(
        self, attachment_id: UUID, user_id: UUID
    ) -> tuple[Attachment, Project, WorkspaceMember]:
        attachment = await self.session.scalar(
            select(Attachment)
            .options(joinedload(Attachment.task).joinedload(Task.project))
            .where(Attachment.id == attachment_id)
        )
        if attachment is None:
            raise not_found("Attachment")
        project = attachment.task.project
        membership = await self.member(project.workspace_id, user_id, "viewer", "Attachment")
        return attachment, project, membership


AccessDep = Annotated[AccessService, Depends()]
