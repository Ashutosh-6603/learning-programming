import html
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy import text

from app.access.service import AccessDep
from app.core.pagination import Page
from app.core.pagination import RankCursor
from app.core.pagination import decode_cursor
from app.core.pagination import to_page
from app.deps import SessionDep
from app.models.task import Task
from app.projects.schemas import TaskOut
from app.projects.schemas import task_relations
from app.search.schemas import SearchHit
from app.search.schemas import SearchQuery

# ts_headline can't HTML-escape, so matches are marked with control characters, the whole
# snippet is escaped, and then the markers become <mark> tags.
START = "\x01"
STOP = "\x02"

_SEARCH = """
SELECT t.id,
       ts_rank(t.search_vector, query) AS rank,
       ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query, :options)
           AS headline
FROM tasks t
JOIN projects p ON p.id = t.project_id,
     websearch_to_tsquery('english', :q) AS query
WHERE p.workspace_id = :workspace_id
  AND t.search_vector @@ query
  {after}
ORDER BY rank DESC, t.id DESC
LIMIT :limit
"""
# rank is a float4 (`real`). Casting the cursor's value back to real makes the row comparison
# exact, because JSON carries the shortest decimal that round-trips.
_AFTER = (
    "AND (ts_rank(t.search_vector, query), t.id) < (CAST(:rank AS real), CAST(:after_id AS uuid))"
)


def safe_headline(raw: str) -> str:
    return html.escape(raw).replace(START, "<mark>").replace(STOP, "</mark>")


class SearchService:
    def __init__(self, session: SessionDep, access: AccessDep) -> None:
        self.session = session
        self.access = access

    async def search(self, workspace_id: UUID, user_id: UUID, q: SearchQuery) -> Page[SearchHit]:
        await self.access.member(workspace_id, user_id)
        after = decode_cursor(q.cursor, RankCursor) if q.cursor else None
        # :name placeholders are bound parameters: what the user typed is never parsed as SQL.
        params = {
            "options": f"StartSel={START}, StopSel={STOP}",
            "q": q.q,
            "workspace_id": workspace_id,
            "limit": q.limit + 1,
        }
        if after is not None:
            params |= {"rank": after.rank, "after_id": after.id}
        sql = _SEARCH.format(after=_AFTER if after else "")
        hits = (await self.session.execute(text(sql), params)).all()

        tasks = await self.session.scalars(
            select(Task).options(*task_relations()).where(Task.id.in_([h.id for h in hits]))
        )
        by_id = {task.id: TaskOut.of(task) for task in tasks}
        rows = [
            SearchHit(task=by_id[h.id], rank=h.rank, headline=safe_headline(h.headline))
            for h in hits
            if h.id in by_id
        ]
        return to_page(rows, q.limit, lambda r: r, lambda r: {"rank": r.rank, "id": str(r.task.id)})


SearchServiceDep = Annotated[SearchService, Depends()]
