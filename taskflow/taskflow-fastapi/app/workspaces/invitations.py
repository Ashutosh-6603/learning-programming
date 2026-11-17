import hashlib
import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import exists
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
from app.core.problems import forbidden
from app.core.problems import not_found
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.user import User
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import CreateInvitationIn
from app.workspaces.schemas import InvitationOut
from app.workspaces.schemas import WorkspaceOut

INVITATION_TTL = timedelta(days=7)


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class InvitationsService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, jobs: JobsDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.jobs = jobs

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[InvitationOut]:
        await self.access.member(workspace_id, user_id, "admin")
        query = (
            select(Invitation)
            .options(joinedload(Invitation.inviter))
            .where(Invitation.workspace_id == workspace_id, Invitation.accepted_at.is_(None))
        )
        query = keyset(
            query, Invitation.id, descending=True, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, InvitationOut.of, lambda i: {"id": str(i.id)})

    async def create(
        self, workspace_id: UUID, actor_id: UUID, body: CreateInvitationIn
    ) -> InvitationOut:
        actor = await self.access.member(workspace_id, actor_id, "admin")
        if body.role == "admin" and actor.role != "owner":
            raise forbidden("Only owners can invite admins")
        already_member = await self.session.scalar(
            select(
                exists().where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == User.id,
                    User.email == body.email,
                )
            )
        )
        if already_member:
            raise conflict("This person is already a member")

        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        # An expired pending invitation would block the partial unique index; clear it first.
        await self.session.execute(
            delete(Invitation).where(
                Invitation.workspace_id == workspace_id,
                Invitation.email == body.email,
                Invitation.accepted_at.is_(None),
                Invitation.expires_at <= now,
            )
        )
        invitation = Invitation(
            workspace_id=workspace_id,
            email=body.email,
            role=body.role,
            token_hash=_sha256(token),
            invited_by=actor_id,
            expires_at=now + INVITATION_TTL,
        )
        self.session.add(invitation)
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="invitation.created",
            data={"email": body.email, "role": body.role},
        )
        try:
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("This email already has a pending invitation") from err
            raise

        loaded = await self.session.scalar(
            select(Invitation)
            .options(joinedload(Invitation.inviter), joinedload(Invitation.workspace))
            .where(Invitation.id == invitation.id)
        )
        assert loaded is not None
        await self.jobs.send_invitation_email(
            email=loaded.email,
            workspace_name=loaded.workspace.name,
            inviter_name=loaded.inviter.display_name,
            token=token,
        )
        return InvitationOut.of(loaded)

    async def revoke(self, workspace_id: UUID, actor_id: UUID, invitation_id: UUID) -> None:
        await self.access.member(workspace_id, actor_id, "admin")
        result = await self.session.execute(
            delete(Invitation)
            .where(
                Invitation.id == invitation_id,
                Invitation.workspace_id == workspace_id,
                Invitation.accepted_at.is_(None),
            )
            .returning(Invitation.id)
        )
        if result.first() is None:
            raise not_found("Invitation")
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="invitation.revoked",
            data={"invitationId": str(invitation_id)},
        )
        await self.session.commit()

    async def accept(self, user_id: UUID, token: str) -> WorkspaceOut:
        invitation = await self.session.scalar(
            select(Invitation)
            .options(joinedload(Invitation.workspace))
            .where(Invitation.token_hash == _sha256(token))
        )
        now = datetime.now(UTC)
        if invitation is None or invitation.accepted_at is not None or invitation.expires_at <= now:
            raise not_found("Invitation")
        user = await self.session.get(User, user_id)
        if user is None or user.email != invitation.email:
            raise forbidden("This invitation was sent to a different email address")

        invitation.accepted_at = now
        workspace: Workspace = invitation.workspace
        existing = await self.session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == invitation.workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        if existing is not None:
            await self.session.commit()
            return WorkspaceOut.of(workspace, existing.role)
        self.session.add(
            WorkspaceMember(
                workspace_id=invitation.workspace_id, user_id=user_id, role=invitation.role
            )
        )
        self.activity.record(
            workspace_id=invitation.workspace_id,
            actor_id=user_id,
            type="member.joined",
            data={"role": invitation.role},
        )
        await self.session.commit()
        return WorkspaceOut.of(workspace, invitation.role)


InvitationsServiceDep = Annotated[InvitationsService, Depends()]
