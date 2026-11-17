from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.activity.schemas import ActivityOut
from app.activity.schemas import ActivityQuery
from app.activity.service import ActivityDep
from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import WorkspaceId

router = APIRouter(tags=["activity"])


@router.get("/workspaces/{workspaceId}/activity")
async def list_activity(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    query: Annotated[ActivityQuery, Query()],
    activity: ActivityDep,
) -> Page[ActivityOut]:
    return await activity.list(workspace_id, user_id, query)
