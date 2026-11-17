"""Path parameters. The alias is the wire name, so a bad id is reported as `path.workspaceId`."""

from typing import Annotated
from uuid import UUID

from fastapi import Path

WorkspaceId = Annotated[UUID, Path(alias="workspaceId")]
UserId = Annotated[UUID, Path(alias="userId")]
InvitationId = Annotated[UUID, Path(alias="invitationId")]
ProjectId = Annotated[UUID, Path(alias="projectId")]
ColumnId = Annotated[UUID, Path(alias="columnId")]
TaskId = Annotated[UUID, Path(alias="taskId")]
CommentId = Annotated[UUID, Path(alias="commentId")]
AttachmentId = Annotated[UUID, Path(alias="attachmentId")]
