from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.interfaces import LoaderOption

from app.core.schemas import CamelModel
from app.core.schemas import JsonInt
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Priority
from app.models.task import Task
from app.users.schemas import UserSummary

ProjectName = Annotated[Trimmed, Field(min_length=1, max_length=80)]
ProjectKey = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9]{1,9}$")]
Description = Annotated[str, Field(max_length=2000)]
ColumnName = Annotated[Trimmed, Field(min_length=1, max_length=50)]
WipLimit = Annotated[JsonInt, Field(ge=1, le=999)]


class CreateProjectIn(CamelModel):
    name: ProjectName
    key: ProjectKey
    description: Description | None = None


class UpdateProjectIn(PatchModel):
    name: Annotated[ProjectName | None, NotNull] = None
    description: Description | None = None


class CreateColumnIn(CamelModel):
    name: ColumnName
    wip_limit: WipLimit | None = None


class UpdateColumnIn(PatchModel):
    name: Annotated[ColumnName | None, NotNull] = None
    wip_limit: WipLimit | None = None


class MoveColumnIn(CamelModel):
    # Required, but null is a value: "move to the first position". No default = required.
    after_column_id: UUID | None


class ProjectOut(CamelModel):
    id: UUID
    workspace_id: UUID
    name: str
    key: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, project: Project) -> Self:
        return cls(
            id=project.id,
            workspace_id=project.workspace_id,
            name=project.name,
            key=project.key,
            description=project.description,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )


class ColumnOut(CamelModel):
    id: UUID
    project_id: UUID
    name: str
    position: str
    wip_limit: int | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, column: BoardColumn) -> Self:
        return cls(
            id=column.id,
            project_id=column.project_id,
            name=column.name,
            position=column.position,
            wip_limit=column.wip_limit,
            created_at=column.created_at,
            updated_at=column.updated_at,
        )


def task_relations() -> list[LoaderOption]:
    """The relationships TaskOut.of reads. Pass them to every query that feeds it: one JOIN,
    instead of one extra query per task (the N+1 problem) or an error (lazy="raise")."""
    return [joinedload(Task.project), joinedload(Task.assignee), joinedload(Task.reporter)]


class TaskOut(CamelModel):
    id: UUID
    key: str
    number: int
    project_id: UUID
    column_id: UUID
    title: str
    description: str | None
    priority: Priority
    assignee: UserSummary | None
    reporter: UserSummary
    due_at: datetime | None
    position: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, task: Task) -> Self:
        return cls(
            id=task.id,
            key=f"{task.project.key}-{task.number}",
            number=task.number,
            project_id=task.project_id,
            column_id=task.column_id,
            title=task.title,
            description=task.description,
            priority=task.priority,
            assignee=UserSummary.of(task.assignee) if task.assignee else None,
            reporter=UserSummary.of(task.reporter),
            due_at=task.due_at,
            position=task.position,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


class BoardColumnOut(ColumnOut):
    tasks: list[TaskOut]


class BoardOut(CamelModel):
    project: ProjectOut
    columns: list[BoardColumnOut]
