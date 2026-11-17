from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import ColumnId
from app.core.params import ProjectId
from app.core.params import WorkspaceId
from app.projects.columns import ColumnsServiceDep
from app.projects.schemas import BoardOut
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateColumnIn
from app.projects.schemas import CreateProjectIn
from app.projects.schemas import MoveColumnIn
from app.projects.schemas import ProjectOut
from app.projects.schemas import UpdateColumnIn
from app.projects.schemas import UpdateProjectIn
from app.projects.service import ProjectsServiceDep

router = APIRouter(tags=["projects"])


@router.get("/workspaces/{workspaceId}/projects")
async def list_projects(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    projects: ProjectsServiceDep,
) -> Page[ProjectOut]:
    return await projects.list(workspace_id, user_id, page)


@router.post("/workspaces/{workspaceId}/projects", status_code=201)
async def create_project(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: CreateProjectIn,
    projects: ProjectsServiceDep,
) -> ProjectOut:
    return await projects.create(workspace_id, user_id, body)


@router.get("/projects/{projectId}")
async def get_project(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> ProjectOut:
    return await projects.get(project_id, user_id)


@router.patch("/projects/{projectId}")
async def update_project(
    project_id: ProjectId, user_id: CurrentUser, body: UpdateProjectIn, projects: ProjectsServiceDep
) -> ProjectOut:
    return await projects.update(project_id, user_id, body)


@router.delete("/projects/{projectId}", status_code=204)
async def delete_project(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> None:
    await projects.delete(project_id, user_id)


@router.get("/projects/{projectId}/board")
async def get_board(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> BoardOut:
    return await projects.board(project_id, user_id)


@router.post("/projects/{projectId}/columns", status_code=201)
async def create_column(
    project_id: ProjectId, user_id: CurrentUser, body: CreateColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.create(project_id, user_id, body)


@router.patch("/columns/{columnId}")
async def update_column(
    column_id: ColumnId, user_id: CurrentUser, body: UpdateColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.update(column_id, user_id, body)


@router.delete("/columns/{columnId}", status_code=204)
async def delete_column(
    column_id: ColumnId, user_id: CurrentUser, columns: ColumnsServiceDep
) -> None:
    await columns.delete(column_id, user_id)


@router.post("/columns/{columnId}/move")
async def move_column(
    column_id: ColumnId, user_id: CurrentUser, body: MoveColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.move(column_id, user_id, body.after_column_id)
