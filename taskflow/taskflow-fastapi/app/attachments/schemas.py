from datetime import datetime
from typing import Annotated
from typing import Literal
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.core.schemas import JsonInt
from app.models.task import Attachment
from app.models.task import AttachmentStatus
from app.users.schemas import UserSummary

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


class CreateAttachmentIn(CamelModel):
    # A display name only: no slashes, backslashes or control characters (U+0000 to U+001F).
    file_name: Annotated[str, Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")]
    # Lowercase media type without parameters, as browsers report it in File.type.
    content_type: Annotated[
        str,
        Field(
            min_length=3,
            max_length=127,
            pattern=r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$",
        ),
    ]
    size_bytes: Annotated[JsonInt, Field(ge=1, le=MAX_ATTACHMENT_BYTES)]


class AttachmentOut(CamelModel):
    id: UUID
    task_id: UUID
    uploader: UserSummary
    file_name: str
    content_type: str
    size_bytes: int
    status: AttachmentStatus
    created_at: datetime

    @classmethod
    def of(cls, attachment: Attachment) -> Self:
        return cls(
            id=attachment.id,
            task_id=attachment.task_id,
            uploader=UserSummary.of(attachment.uploader),
            file_name=attachment.file_name,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            status=attachment.status,
            created_at=attachment.created_at,
        )


class PresignedUrl(CamelModel):
    url: str
    expires_at: datetime


class UploadTarget(PresignedUrl):
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]


class AttachmentUpload(CamelModel):
    attachment: AttachmentOut
    upload: UploadTarget
