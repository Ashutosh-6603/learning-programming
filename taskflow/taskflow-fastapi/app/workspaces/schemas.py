from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.access.roles import InvitableRole
from app.access.roles import Role
from app.auth.schemas import Email
from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.users.schemas import UserSummary

Name = Annotated[Trimmed, Field(min_length=1, max_length=80)]
Slug = Annotated[str, Field(min_length=3, max_length=40, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]


class CreateWorkspaceIn(CamelModel):
    name: Name
    slug: Slug


class UpdateWorkspaceIn(PatchModel):
    name: Annotated[Name | None, NotNull] = None
    slug: Annotated[Slug | None, NotNull] = None


class UpdateMemberIn(CamelModel):
    role: Role


class CreateInvitationIn(CamelModel):
    email: Email
    role: InvitableRole


class AcceptInvitationIn(CamelModel):
    token: Annotated[str, Field(min_length=1, max_length=128)]


class WorkspaceOut(CamelModel):
    id: UUID
    name: str
    slug: str
    current_user_role: Role
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, workspace: Workspace, role: Role) -> Self:
        return cls(
            id=workspace.id,
            name=workspace.name,
            slug=workspace.slug,
            current_user_role=role,
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )


class MemberOut(CamelModel):
    user: UserSummary
    role: Role
    joined_at: datetime

    @classmethod
    def of(cls, member: WorkspaceMember) -> Self:
        return cls(user=UserSummary.of(member.user), role=member.role, joined_at=member.joined_at)


class InvitationOut(CamelModel):
    id: UUID
    workspace_id: UUID
    email: str
    role: InvitableRole
    invited_by: UserSummary
    expires_at: datetime
    created_at: datetime

    @classmethod
    def of(cls, invitation: Invitation) -> Self:
        return cls(
            id=invitation.id,
            workspace_id=invitation.workspace_id,
            email=invitation.email,
            role=invitation.role,
            invited_by=UserSummary.of(invitation.inviter),
            expires_at=invitation.expires_at,
            created_at=invitation.created_at,
        )
