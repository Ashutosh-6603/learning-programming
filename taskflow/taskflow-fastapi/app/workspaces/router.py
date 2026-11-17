from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import InvitationId
from app.core.params import UserId
from app.core.params import WorkspaceId
from app.workspaces.invitations import InvitationsServiceDep
from app.workspaces.members import MembersServiceDep
from app.workspaces.schemas import AcceptInvitationIn
from app.workspaces.schemas import CreateInvitationIn
from app.workspaces.schemas import CreateWorkspaceIn
from app.workspaces.schemas import InvitationOut
from app.workspaces.schemas import MemberOut
from app.workspaces.schemas import UpdateMemberIn
from app.workspaces.schemas import UpdateWorkspaceIn
from app.workspaces.schemas import WorkspaceOut
from app.workspaces.service import WorkspacesServiceDep

router = APIRouter(tags=["workspaces"])
# `page: Paging`: FastAPI reads `?limit=&cursor=` into a PageQuery and validates it.
Paging = Annotated[PageQuery, Query()]


@router.get("/workspaces")
async def list_workspaces(
    user_id: CurrentUser, page: Paging, workspaces: WorkspacesServiceDep
) -> Page[WorkspaceOut]:
    return await workspaces.list(user_id, page)


@router.post("/workspaces", status_code=201)
async def create_workspace(
    user_id: CurrentUser, body: CreateWorkspaceIn, workspaces: WorkspacesServiceDep
) -> WorkspaceOut:
    return await workspaces.create(user_id, body)


@router.get("/workspaces/{workspaceId}")
async def get_workspace(
    workspace_id: WorkspaceId, user_id: CurrentUser, workspaces: WorkspacesServiceDep
) -> WorkspaceOut:
    return await workspaces.get(workspace_id, user_id)


@router.patch("/workspaces/{workspaceId}")
async def update_workspace(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: UpdateWorkspaceIn,
    workspaces: WorkspacesServiceDep,
) -> WorkspaceOut:
    return await workspaces.update(workspace_id, user_id, body)


@router.delete("/workspaces/{workspaceId}", status_code=204)
async def delete_workspace(
    workspace_id: WorkspaceId, user_id: CurrentUser, workspaces: WorkspacesServiceDep
) -> None:
    await workspaces.delete(workspace_id, user_id)


@router.get("/workspaces/{workspaceId}/members")
async def list_members(
    workspace_id: WorkspaceId, user_id: CurrentUser, page: Paging, members: MembersServiceDep
) -> Page[MemberOut]:
    return await members.list(workspace_id, user_id, page)


@router.patch("/workspaces/{workspaceId}/members/{userId}")
async def update_member(
    workspace_id: WorkspaceId,
    target_user_id: UserId,
    user_id: CurrentUser,
    body: UpdateMemberIn,
    members: MembersServiceDep,
) -> MemberOut:
    return await members.update_role(workspace_id, user_id, target_user_id, body.role)


@router.delete("/workspaces/{workspaceId}/members/{userId}", status_code=204)
async def remove_member(
    workspace_id: WorkspaceId,
    target_user_id: UserId,
    user_id: CurrentUser,
    members: MembersServiceDep,
) -> None:
    await members.remove(workspace_id, user_id, target_user_id)


@router.get("/workspaces/{workspaceId}/invitations")
async def list_invitations(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    page: Paging,
    invitations: InvitationsServiceDep,
) -> Page[InvitationOut]:
    return await invitations.list(workspace_id, user_id, page)


@router.post("/workspaces/{workspaceId}/invitations", status_code=201)
async def create_invitation(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: CreateInvitationIn,
    invitations: InvitationsServiceDep,
) -> InvitationOut:
    return await invitations.create(workspace_id, user_id, body)


@router.delete("/workspaces/{workspaceId}/invitations/{invitationId}", status_code=204)
async def revoke_invitation(
    workspace_id: WorkspaceId,
    invitation_id: InvitationId,
    user_id: CurrentUser,
    invitations: InvitationsServiceDep,
) -> None:
    await invitations.revoke(workspace_id, user_id, invitation_id)


@router.post("/invitations/accept")
async def accept_invitation(
    user_id: CurrentUser, body: AcceptInvitationIn, invitations: InvitationsServiceDep
) -> WorkspaceOut:
    return await invitations.accept(user_id, body.token)
