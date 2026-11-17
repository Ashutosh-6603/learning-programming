from typing import Annotated
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.fractional_index import key_between
from app.core.problems import conflict
from app.core.problems import invalid
from app.db.errors import is_foreign_key_violation
from app.db.errors import retry_on_position_conflict
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateColumnIn
from app.projects.schemas import UpdateColumnIn
from app.realtime.publisher import ColumnDeleted
from app.realtime.publisher import EventType
from app.realtime.publisher import PublisherDep


class ColumnsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        publisher: PublisherDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.publisher = publisher

    async def create(self, project_id: UUID, user_id: UUID, body: CreateColumnIn) -> ColumnOut:
        project, _ = await self.access.project(project_id, user_id, "admin")

        async def attempt() -> BoardColumn:
            last = await self.session.scalar(
                select(BoardColumn.position)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position.desc())
                .limit(1)
            )
            column = BoardColumn(
                project_id=project_id,
                name=body.name,
                wip_limit=body.wip_limit,
                position=key_between(last, None),
            )
            self.session.add(column)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project_id,
                type="column.created",
                data={"columnId": str(column.id), "name": column.name},
            )
            return column

        column = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = ColumnOut.of(column)
        await self._after_write(project_id, "column.created", out)
        return out

    async def update(self, column_id: UUID, user_id: UUID, body: UpdateColumnIn) -> ColumnOut:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(column, field, value)
        changes = body.model_dump(mode="json", by_alias=True, exclude_unset=True)
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            type="column.updated",
            data={"columnId": str(column_id), **changes},
        )
        await self.session.commit()
        out = ColumnOut.of(column)
        await self._after_write(project.id, "column.updated", out)
        return out

    async def move(self, column_id: UUID, user_id: UUID, after_column_id: UUID | None) -> ColumnOut:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        if after_column_id == column_id:
            raise invalid("afterColumnId", "cannot place a column after itself")

        async def attempt() -> BoardColumn:
            column.position = await self._position_after(project.id, column_id, after_column_id)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project.id,
                type="column.moved",
                data={
                    "columnId": str(column_id),
                    "afterColumnId": str(after_column_id) if after_column_id else None,
                },
            )
            return column

        moved = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = ColumnOut.of(moved)
        await self._after_write(project.id, "column.moved", out)
        return out

    async def delete(self, column_id: UUID, user_id: UUID) -> None:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        try:
            await self.session.execute(delete(BoardColumn).where(BoardColumn.id == column_id))
        except IntegrityError as err:
            # tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
            if is_foreign_key_violation(err):
                raise conflict("Move or delete the tasks in this column first") from err
            raise
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            type="column.deleted",
            data={"columnId": str(column_id), "name": column.name},
        )
        await self.session.commit()
        await self._after_write(
            project.id, "column.deleted", ColumnDeleted(id=column_id, project_id=project.id)
        )

    async def _position_after(
        self, project_id: UUID, column_id: UUID, after_id: UUID | None
    ) -> str:
        lower = None
        if after_id is not None:
            after = await self.session.get(BoardColumn, after_id)
            if after is None or after.project_id != project_id:
                raise invalid("afterColumnId", "must be a column of the same project")
            lower = after.position
        query = (
            select(BoardColumn.position)
            .where(BoardColumn.project_id == project_id, BoardColumn.id != column_id)
            .order_by(BoardColumn.position)
            .limit(1)
        )
        if lower is not None:
            query = query.where(BoardColumn.position > lower)
        return key_between(lower, await self.session.scalar(query))

    async def _after_write(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.cache.invalidate(project_id)
        await self.publisher.publish(project_id, type, payload)


ColumnsServiceDep = Annotated[ColumnsService, Depends()]
