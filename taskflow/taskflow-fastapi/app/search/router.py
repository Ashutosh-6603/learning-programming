from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import WorkspaceId
from app.search.schemas import SearchHit
from app.search.schemas import SearchQuery
from app.search.service import SearchServiceDep

router = APIRouter(tags=["search"])


@router.get("/workspaces/{workspaceId}/search")
async def search_tasks(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    query: Annotated[SearchQuery, Query()],
    search: SearchServiceDep,
) -> Page[SearchHit]:
    return await search.search(workspace_id, user_id, query)
