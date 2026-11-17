from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.attachments.schemas import AttachmentOut
from app.attachments.schemas import AttachmentUpload
from app.attachments.schemas import CreateAttachmentIn
from app.attachments.schemas import PresignedUrl
from app.attachments.service import AttachmentsServiceDep
from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import AttachmentId
from app.core.params import TaskId

router = APIRouter(tags=["attachments"])


@router.get("/tasks/{taskId}/attachments")
async def list_attachments(
    task_id: TaskId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    attachments: AttachmentsServiceDep,
) -> Page[AttachmentOut]:
    return await attachments.list(task_id, user_id, page)


@router.post("/tasks/{taskId}/attachments", status_code=201)
async def create_attachment(
    task_id: TaskId,
    user_id: CurrentUser,
    body: CreateAttachmentIn,
    attachments: AttachmentsServiceDep,
) -> AttachmentUpload:
    return await attachments.create(task_id, user_id, body)


@router.delete("/attachments/{attachmentId}", status_code=204)
async def delete_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> None:
    await attachments.delete(attachment_id, user_id)


@router.post("/attachments/{attachmentId}/complete")
async def complete_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> AttachmentOut:
    return await attachments.complete(attachment_id, user_id)


@router.get("/attachments/{attachmentId}/download")
async def download_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> PresignedUrl:
    return await attachments.download(attachment_id, user_id)
