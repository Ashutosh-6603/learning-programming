from typing import Annotated
from uuid import UUID

from pydantic import Field

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Timestamp
from app.core.schemas import Trimmed
from app.models.task import Priority

Title = Annotated[Trimmed, Field(min_length=1, max_length=200)]
Description = Annotated[str, Field(max_length=10_000)]
UUID_OR_NONE = (
    r"^(none|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
)


class ListTasksQuery(PageQuery):
    column_id: UUID | None = None
    # A UUID, or the literal "none" for unassigned tasks. One pattern gives one clear error.
    assignee_id: Annotated[str, Field(pattern=UUID_OR_NONE)] | None = None
    priority: Priority | None = None
    due_before: Timestamp | None = None


class CreateTaskIn(CamelModel):
    title: Title
    description: Description | None = None
    column_id: Annotated[UUID | None, NotNull] = None
    priority: Priority = "medium"
    assignee_id: UUID | None = None
    due_at: Timestamp | None = None


class UpdateTaskIn(PatchModel):
    title: Annotated[Title | None, NotNull] = None
    description: Description | None = None
    priority: Annotated[Priority | None, NotNull] = None
    assignee_id: UUID | None = None
    due_at: Timestamp | None = None


class MoveTaskIn(CamelModel):
    column_id: UUID
    # Required, but null is a value: "move to the top of the column".
    after_task_id: UUID | None
