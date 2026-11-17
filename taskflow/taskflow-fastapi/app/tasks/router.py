from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import ProjectId
from app.core.params import TaskId
from app.projects.schemas import TaskOut
from app.tasks.schemas import CreateTaskIn
from app.tasks.schemas import ListTasksQuery
from app.tasks.schemas import MoveTaskIn
from app.tasks.schemas import UpdateTaskIn
from app.tasks.service import TasksServiceDep

router = APIRouter(tags=["tasks"])


@router.get("/projects/{projectId}/tasks")
async def list_tasks(
    project_id: ProjectId,
    user_id: CurrentUser,
    query: Annotated[ListTasksQuery, Query()],
    tasks: TasksServiceDep,
) -> Page[TaskOut]:
    return await tasks.list(project_id, user_id, query)


@router.post("/projects/{projectId}/tasks", status_code=201)
async def create_task(
    project_id: ProjectId, user_id: CurrentUser, body: CreateTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.create(project_id, user_id, body)


@router.get("/tasks/{taskId}")
async def get_task(task_id: TaskId, user_id: CurrentUser, tasks: TasksServiceDep) -> TaskOut:
    return await tasks.get(task_id, user_id)


@router.patch("/tasks/{taskId}")
async def update_task(
    task_id: TaskId, user_id: CurrentUser, body: UpdateTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.update(task_id, user_id, body)


@router.delete("/tasks/{taskId}", status_code=204)
async def delete_task(task_id: TaskId, user_id: CurrentUser, tasks: TasksServiceDep) -> None:
    await tasks.delete(task_id, user_id)


@router.post("/tasks/{taskId}/move")
async def move_task(
    task_id: TaskId, user_id: CurrentUser, body: MoveTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.move(task_id, user_id, body)
