from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.roles import at_least
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.comments.schemas import CommentOut
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
from app.models.task import Comment
from app.realtime.publisher import CommentCreated
from app.realtime.publisher import PublisherDep


class CommentsService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, publisher: PublisherDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.publisher = publisher

    async def list(self, task_id: UUID, user_id: UUID, page: PageQuery) -> Page[CommentOut]:
        await self.access.task(task_id, user_id)
        query = (
            select(Comment).options(joinedload(Comment.author)).where(Comment.task_id == task_id)
        )
        query = keyset(query, Comment.id, descending=False, limit=page.limit, after=after_id(page))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, CommentOut.of, lambda c: {"id": str(c.id)})

    async def create(self, task_id: UUID, user_id: UUID, body: str) -> CommentOut:
        _, project, _ = await self.access.task(task_id, user_id, "member")
        comment = Comment(task_id=task_id, author_id=user_id, body=body)
        self.session.add(comment)
        await self.session.flush()
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="comment.created",
            data={"commentId": str(comment.id)},
        )
        await self.session.commit()
        out = CommentOut.of(await self._load(comment.id))
        await self.publisher.publish(
            project.id, "comment.created", CommentCreated(project_id=project.id, comment=out)
        )
        return out

    async def update(self, comment_id: UUID, user_id: UUID, body: str) -> CommentOut:
        comment, project, _ = await self.access.comment(comment_id, user_id)
        if comment.author_id != user_id:
            raise forbidden("Only the author can edit a comment")
        comment.body = body
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=comment.task_id,
            type="comment.updated",
            data={"commentId": str(comment_id)},
        )
        await self.session.commit()
        return CommentOut.of(await self._load(comment_id))

    async def delete(self, comment_id: UUID, user_id: UUID) -> None:
        comment, project, membership = await self.access.comment(comment_id, user_id)
        if comment.author_id != user_id and not at_least(membership.role, "admin"):
            raise forbidden("Only the author or an admin can delete a comment")
        await self.session.execute(delete(Comment).where(Comment.id == comment_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=comment.task_id,
            type="comment.deleted",
            data={"commentId": str(comment_id)},
        )
        await self.session.commit()

    async def _load(self, comment_id: UUID) -> Comment:
        comment = await self.session.scalar(
            select(Comment).options(joinedload(Comment.author)).where(Comment.id == comment_id)
        )
        if comment is None:
            raise not_found("Comment")
        return comment


CommentsServiceDep = Annotated[CommentsService, Depends()]
