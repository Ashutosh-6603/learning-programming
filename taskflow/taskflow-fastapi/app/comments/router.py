from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.comments.schemas import CommentBody
from app.comments.schemas import CommentOut
from app.comments.service import CommentsServiceDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import CommentId
from app.core.params import TaskId

router = APIRouter(tags=["comments"])


@router.get("/tasks/{taskId}/comments")
async def list_comments(
    task_id: TaskId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    comments: CommentsServiceDep,
) -> Page[CommentOut]:
    return await comments.list(task_id, user_id, page)


@router.post("/tasks/{taskId}/comments", status_code=201)
async def create_comment(
    task_id: TaskId, user_id: CurrentUser, body: CommentBody, comments: CommentsServiceDep
) -> CommentOut:
    return await comments.create(task_id, user_id, body.body)


@router.patch("/comments/{commentId}")
async def update_comment(
    comment_id: CommentId, user_id: CurrentUser, body: CommentBody, comments: CommentsServiceDep
) -> CommentOut:
    return await comments.update(comment_id, user_id, body.body)


@router.delete("/comments/{commentId}", status_code=204)
async def delete_comment(
    comment_id: CommentId, user_id: CurrentUser, comments: CommentsServiceDep
) -> None:
    await comments.delete(comment_id, user_id)
