from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import not_found
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.project import Project
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import CreateWorkspaceIn
from app.workspaces.schemas import UpdateWorkspaceIn
from app.workspaces.schemas import WorkspaceOut


class WorkspacesService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, jobs: JobsDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.jobs = jobs

    async def list(self, user_id: UUID, page: PageQuery) -> Page[WorkspaceOut]:
        # The (user_id, workspace_id) index serves this query directly: newest workspace first.
        query = (
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.workspace))
            .where(WorkspaceMember.user_id == user_id)
        )
        query = keyset(
            query,
            WorkspaceMember.workspace_id,
            descending=True,
            limit=page.limit,
            after=after_id(page),
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(
            rows,
            page.limit,
            lambda m: WorkspaceOut.of(m.workspace, m.role),
            lambda m: {"id": str(m.workspace_id)},
        )

    async def create(self, user_id: UUID, body: CreateWorkspaceIn) -> WorkspaceOut:
        workspace = Workspace(name=body.name, slug=body.slug, created_by=user_id)
        try:
            self.session.add(workspace)
            await self.session.flush()  # sends the INSERT now, so workspace.id is set
            self.session.add(
                WorkspaceMember(workspace_id=workspace.id, user_id=user_id, role="owner")
            )
            self.activity.record(
                workspace_id=workspace.id,
                actor_id=user_id,
                type="workspace.created",
                data={"name": workspace.name},
            )
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Slug is already taken") from err
            raise
        return WorkspaceOut.of(workspace, "owner")

    async def get(self, workspace_id: UUID, user_id: UUID) -> WorkspaceOut:
        membership = await self.access.member(workspace_id, user_id)
        workspace = await self.session.get(Workspace, workspace_id)
        if workspace is None:
            raise not_found("Workspace")
        return WorkspaceOut.of(workspace, membership.role)

    async def update(
        self, workspace_id: UUID, user_id: UUID, body: UpdateWorkspaceIn
    ) -> WorkspaceOut:
        membership = await self.access.member(workspace_id, user_id, "admin")
        workspace = await self.session.get(Workspace, workspace_id)
        if workspace is None:
            raise not_found("Workspace")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(workspace, field, value)
        changes = body.model_dump(mode="json", by_alias=True, exclude_unset=True)
        self.activity.record(
            workspace_id=workspace_id, actor_id=user_id, type="workspace.updated", data=changes
        )
        try:
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Slug is already taken") from err
            raise
        return WorkspaceOut.of(workspace, membership.role)

    async def delete(self, workspace_id: UUID, user_id: UUID) -> None:
        await self.access.member(workspace_id, user_id, "owner")
        project_ids = (
            await self.session.scalars(
                select(Project.id).where(Project.workspace_id == workspace_id)
            )
        ).all()
        await self.session.execute(delete(Workspace).where(Workspace.id == workspace_id))
        await self.session.commit()
        # After commit: never ask the worker to clean up after a delete that rolled back.
        for project_id in project_ids:
            await self.jobs.delete_storage_prefix(f"projects/{project_id}/")


WorkspacesServiceDep = Annotated[WorkspacesService, Depends()]
