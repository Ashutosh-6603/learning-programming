from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import joinedload

from app.access.roles import Role
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import MemberOut

ADMIN_MANAGEABLE: frozenset[Role] = frozenset({"member", "viewer"})


class MembersService:
    def __init__(self, session: SessionDep, access: AccessDep, activity: ActivityDep) -> None:
        self.session = session
        self.access = access
        self.activity = activity

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[MemberOut]:
        await self.access.member(workspace_id, user_id)
        query = (
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.user))
            .where(WorkspaceMember.workspace_id == workspace_id)
        )
        query = keyset(
            query, WorkspaceMember.id, descending=False, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, MemberOut.of, lambda m: {"id": str(m.id)})

    async def update_role(
        self, workspace_id: UUID, actor_id: UUID, target_user_id: UUID, new_role: Role
    ) -> MemberOut:
        actor = await self.access.member(workspace_id, actor_id, "admin")
        target = await self._target(workspace_id, target_user_id)
        old_role = target.role
        if actor.role != "owner" and not {old_role, new_role} <= ADMIN_MANAGEABLE:
            raise forbidden("Only owners can grant or revoke admin and owner roles")
        if old_role == "owner" and new_role != "owner":
            await self._assert_not_last_owner(workspace_id)
        target.role = new_role
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="member.role_changed",
            data={"userId": str(target_user_id), "from": old_role, "to": new_role},
        )
        await self.session.commit()
        return MemberOut.of(target)

    async def remove(self, workspace_id: UUID, actor_id: UUID, target_user_id: UUID) -> None:
        actor = await self.access.member(workspace_id, actor_id)
        target = await self._target(workspace_id, target_user_id)
        leaving = actor_id == target_user_id
        allowed = actor.role == "owner" or (
            actor.role == "admin" and target.role in ADMIN_MANAGEABLE
        )
        if not leaving and not allowed:
            raise forbidden("Your role cannot remove this member")
        if target.role == "owner":
            await self._assert_not_last_owner(workspace_id)
        await self.session.execute(delete(WorkspaceMember).where(WorkspaceMember.id == target.id))
        # One statement for every project of this workspace: a subquery inside IN (…).
        projects = select(Project.id).where(Project.workspace_id == workspace_id)
        await self.session.execute(
            update(Task)
            .where(Task.assignee_id == target_user_id, Task.project_id.in_(projects))
            .values(assignee_id=None)
        )
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="member.removed",
            data={"userId": str(target_user_id)},
        )
        await self.session.commit()

    async def _target(self, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
        target = await self.session.scalar(
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.user))
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
        )
        if target is None:
            raise not_found("Member")
        return target

    async def _assert_not_last_owner(self, workspace_id: UUID) -> None:
        """Locks every owner row first (SELECT … FOR UPDATE), so two owners demoting each other
        at the same time can't both pass the check and leave the workspace without an owner."""
        owners = await self.session.scalars(
            select(WorkspaceMember.id)
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == "owner")
            .with_for_update()
        )
        if len(owners.all()) <= 1:
            raise conflict("A workspace must keep at least one owner")


MembersServiceDep = Annotated[MembersService, Depends()]
