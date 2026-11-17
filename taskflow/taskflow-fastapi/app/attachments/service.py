from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Annotated
from uuid import UUID
from uuid import uuid7

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.roles import at_least
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.attachments.schemas import AttachmentOut
from app.attachments.schemas import AttachmentUpload
from app.attachments.schemas import CreateAttachmentIn
from app.attachments.schemas import PresignedUrl
from app.attachments.schemas import UploadTarget
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import JobsDep
from app.deps import SessionDep
from app.deps import StorageDep
from app.models.task import Attachment

UPLOAD_URL_TTL = 15 * 60
DOWNLOAD_URL_TTL = 5 * 60


def _expires_at(seconds: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=seconds)


class AttachmentsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        storage: StorageDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.storage = storage
        self.jobs = jobs

    async def list(self, task_id: UUID, user_id: UUID, page: PageQuery) -> Page[AttachmentOut]:
        await self.access.task(task_id, user_id)
        query = (
            select(Attachment)
            .options(joinedload(Attachment.uploader))
            .where(Attachment.task_id == task_id, Attachment.status == "ready")
        )
        query = keyset(
            query, Attachment.id, descending=True, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, AttachmentOut.of, lambda a: {"id": str(a.id)})

    async def create(
        self, task_id: UUID, user_id: UUID, body: CreateAttachmentIn
    ) -> AttachmentUpload:
        _, project, _ = await self.access.task(task_id, user_id, "member")
        # The id is generated here, not at flush time, because the storage key needs it.
        attachment_id = uuid7()
        storage_key = f"projects/{project.id}/tasks/{task_id}/{attachment_id}"
        self.session.add(
            Attachment(
                id=attachment_id,
                task_id=task_id,
                uploader_id=user_id,
                file_name=body.file_name,
                content_type=body.content_type,
                size_bytes=body.size_bytes,
                storage_key=storage_key,
            )
        )
        await self.session.commit()
        url = self.storage.presign_upload(
            storage_key, body.content_type, body.size_bytes, UPLOAD_URL_TTL
        )
        return AttachmentUpload(
            attachment=AttachmentOut.of(await self._load(attachment_id)),
            upload=UploadTarget(
                url=url,
                headers={"Content-Type": body.content_type},
                expires_at=_expires_at(UPLOAD_URL_TTL),
            ),
        )

    async def complete(self, attachment_id: UUID, user_id: UUID) -> AttachmentOut:
        attachment, project, _ = await self.access.attachment(attachment_id, user_id)
        if attachment.uploader_id != user_id:
            raise forbidden("Only the uploader can complete an upload")
        if attachment.status == "ready":
            return AttachmentOut.of(await self._load(attachment_id))
        size = await self.storage.size_of(attachment.storage_key)
        if size is None:
            raise conflict("The file has not been uploaded yet")
        if size != attachment.size_bytes:
            raise conflict("The uploaded file size does not match")
        attachment.status = "ready"
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=attachment.task_id,
            type="attachment.added",
            data={"attachmentId": str(attachment_id), "fileName": attachment.file_name},
        )
        await self.session.commit()
        return AttachmentOut.of(await self._load(attachment_id))

    async def download(self, attachment_id: UUID, user_id: UUID) -> PresignedUrl:
        attachment, _, _ = await self.access.attachment(attachment_id, user_id)
        if attachment.status != "ready":
            raise not_found("Attachment")
        url = self.storage.presign_download(
            attachment.storage_key, attachment.file_name, DOWNLOAD_URL_TTL
        )
        return PresignedUrl(url=url, expires_at=_expires_at(DOWNLOAD_URL_TTL))

    async def delete(self, attachment_id: UUID, user_id: UUID) -> None:
        attachment, project, membership = await self.access.attachment(attachment_id, user_id)
        if attachment.uploader_id != user_id and not at_least(membership.role, "admin"):
            raise forbidden("Only the uploader or an admin can delete an attachment")
        await self.session.execute(delete(Attachment).where(Attachment.id == attachment_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=attachment.task_id,
            type="attachment.deleted",
            data={"attachmentId": str(attachment_id), "fileName": attachment.file_name},
        )
        await self.session.commit()
        await self.jobs.delete_storage_prefix(attachment.storage_key)

    async def _load(self, attachment_id: UUID) -> Attachment:
        attachment = await self.session.scalar(
            select(Attachment)
            .options(joinedload(Attachment.uploader))
            .where(Attachment.id == attachment_id)
        )
        if attachment is None:
            raise not_found("Attachment")
        return attachment


AttachmentsServiceDep = Annotated[AttachmentsService, Depends()]
