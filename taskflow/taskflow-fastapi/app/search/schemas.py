from typing import Annotated

from pydantic import Field

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.projects.schemas import TaskOut


class SearchQuery(PageQuery):
    q: Annotated[str, Field(min_length=1, max_length=200)]


class SearchHit(CamelModel):
    task: TaskOut
    rank: float
    headline: str
