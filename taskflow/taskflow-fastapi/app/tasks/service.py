from datetime import datetime
from typing import Annotated
from typing import Any
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel
from pydantic.alias_generators import to_camel
from sqlalchemy import delete
from sqlalchemy import exists
from sqlalchemy import select
from sqlalchemy import update

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.fractional_index import key_between
from app.core.pagination import Page
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import invalid
from app.core.problems import not_found
from app.db.errors import retry_on_position_conflict
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import WorkspaceMember
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import TaskOut
from app.projects.schemas import task_relations
from app.realtime.publisher import EventType
from app.realtime.publisher import PublisherDep
from app.realtime.publisher import TaskDeleted
from app.tasks.schemas import CreateTaskIn
from app.tasks.schemas import ListTasksQuery
from app.tasks.schemas import MoveTaskIn
from app.tasks.schemas import UpdateTaskIn


def _json(value: Any) -> Any:
    """A value as it appears in the activity log's JSON."""
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, UUID):
        return str(value)
    return value


class TasksService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        publisher: PublisherDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.publisher = publisher
        self.jobs = jobs

    async def list(self, project_id: UUID, user_id: UUID, q: ListTasksQuery) -> Page[TaskOut]:
        await self.access.project(project_id, user_id)
        query = select(Task).options(*task_relations()).where(Task.project_id == project_id)
        # Each filter adds a WHERE clause; values are bound parameters, never pasted into the SQL.
        if q.column_id is not None:
            query = query.where(Task.column_id == q.column_id)
        if q.assignee_id == "none":
            query = query.where(Task.assignee_id.is_(None))
        elif q.assignee_id is not None:
            query = query.where(Task.assignee_id == UUID(q.assignee_id))
        if q.priority is not None:
            query = query.where(Task.priority == q.priority)
        if q.due_before is not None:
            query = query.where(Task.due_at < q.due_before)
        query = keyset(query, Task.id, descending=True, limit=q.limit, after=after_id(q))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, q.limit, TaskOut.of, lambda t: {"id": str(t.id)})

    async def get(self, task_id: UUID, user_id: UUID) -> TaskOut:
        await self.access.task(task_id, user_id)
        return TaskOut.of(await self._load(task_id))

    async def create(self, project_id: UUID, user_id: UUID, body: CreateTaskIn) -> TaskOut:
        project, _ = await self.access.project(project_id, user_id, "member")
        if body.assignee_id is not None:
            await self._assert_assignable(project.workspace_id, body.assignee_id)

        async def attempt() -> Task:
            # Row-locks the project, so concurrent creates queue up here. Everything below then
            # sees the previous creator's committed task (READ COMMITTED reads per statement).
            number = await self.session.scalar(
                update(Project)
                .where(Project.id == project_id)
                .values(next_task_number=Project.next_task_number + 1)
                .returning(Project.next_task_number - 1)
                .execution_options(synchronize_session=False)
            )
            column_id = await self._resolve_column(project_id, body.column_id)
            last = await self.session.scalar(
                select(Task.position)
                .where(Task.column_id == column_id)
                .order_by(Task.position.desc())
                .limit(1)
            )
            task = Task(
                project_id=project_id,
                column_id=column_id,
                number=number,
                title=body.title,
                description=body.description,
                priority=body.priority,
                assignee_id=body.assignee_id,
                reporter_id=user_id,
                due_at=body.due_at,
                position=key_between(last, None),
            )
            self.session.add(task)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project_id,
                task_id=task.id,
                type="task.created",
                data={"key": f"{project.key}-{task.number}", "title": task.title},
            )
            return task

        task = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = TaskOut.of(await self._load(task.id))
        await self._after_write(project_id, "task.created", out)
        return out

    async def update(self, task_id: UUID, user_id: UUID, body: UpdateTaskIn) -> TaskOut:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        values = body.model_dump(exclude_unset=True)
        if values.get("assignee_id") is not None:
            await self._assert_assignable(project.workspace_id, values["assignee_id"])
        changes: dict[str, dict[str, Any]] = {}
        for field, to in values.items():
            before = getattr(task, field)
            if before != to:
                changes[to_camel(field)] = {"from": _json(before), "to": _json(to)}
            setattr(task, field, to)
        if "dueAt" in changes:
            task.reminder_sent_at = None  # a new due date deserves a new reminder
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="task.updated",
            data={"changes": changes},
        )
        await self.session.commit()
        out = TaskOut.of(await self._load(task_id))
        await self._after_write(project.id, "task.updated", out)
        return out

    async def move(self, task_id: UUID, user_id: UUID, body: MoveTaskIn) -> TaskOut:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        if body.after_task_id == task_id:
            raise invalid("afterTaskId", "cannot place a task after itself")
        from_column_id = task.column_id

        async def attempt() -> None:
            column = await self.session.get(BoardColumn, body.column_id)
            if column is None or column.project_id != project.id:
                raise invalid("columnId", "must be a column of the same project")
            lower = None
            if body.after_task_id is not None:
                after = await self.session.get(Task, body.after_task_id)
                if after is None or after.column_id != body.column_id:
                    raise invalid("afterTaskId", "must be a task in the target column")
                lower = after.position
            query = (
                select(Task.position)
                .where(Task.column_id == body.column_id, Task.id != task_id)
                .order_by(Task.position)
                .limit(1)
            )
            if lower is not None:
                query = query.where(Task.position > lower)
            task.column_id = body.column_id
            task.position = key_between(lower, await self.session.scalar(query))
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project.id,
                task_id=task_id,
                type="task.moved",
                data={"fromColumnId": str(from_column_id), "toColumnId": str(body.column_id)},
            )

        await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = TaskOut.of(await self._load(task_id))
        await self._after_write(project.id, "task.moved", out)
        return out

    async def delete(self, task_id: UUID, user_id: UUID) -> None:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        await self.session.execute(delete(Task).where(Task.id == task_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="task.deleted",
            data={"key": f"{project.key}-{task.number}", "title": task.title},
        )
        await self.session.commit()
        deleted = TaskDeleted(id=task_id, project_id=project.id, column_id=task.column_id)
        await self._after_write(project.id, "task.deleted", deleted)
        await self.jobs.delete_storage_prefix(f"projects/{project.id}/tasks/{task_id}/")

    async def _load(self, task_id: UUID) -> Task:
        task = await self.session.scalar(
            select(Task).options(*task_relations()).where(Task.id == task_id)
        )
        if task is None:
            raise not_found("Task")
        return task

    async def _resolve_column(self, project_id: UUID, column_id: UUID | None) -> UUID:
        if column_id is None:
            first = await self.session.scalar(
                select(BoardColumn.id)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position)
                .limit(1)
            )
            if first is None:
                raise invalid("columnId", "the project has no columns")
            return first
        column = await self.session.get(BoardColumn, column_id)
        if column is None or column.project_id != project_id:
            raise invalid("columnId", "must be a column of this project")
        return column.id

    async def _assert_assignable(self, workspace_id: UUID, assignee_id: UUID) -> None:
        is_member = await self.session.scalar(
            select(
                exists().where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == assignee_id,
                )
            )
        )
        if not is_member:
            raise invalid("assigneeId", "must be a member of the workspace")

    async def _after_write(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.cache.invalidate(project_id)
        await self.publisher.publish(project_id, type, payload)


TasksServiceDep = Annotated[TasksService, Depends()]
