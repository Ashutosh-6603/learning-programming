import base64
import json
from collections.abc import Callable
from collections.abc import Sequence
from typing import Annotated
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from sqlalchemy import Select
from sqlalchemy.orm import InstrumentedAttribute

from app.core.problems import invalid
from app.core.schemas import CamelModel


class PageQuery(CamelModel):
    """`?limit=20&cursor=…`. List endpoints subclass it to add their own filters."""

    limit: Annotated[int, Field(ge=1, le=100)] = 20
    cursor: (
        Annotated[str, Field(min_length=1, max_length=512, pattern=r"^[A-Za-z0-9_-]+$")] | None
    ) = None


class Page[T](CamelModel):
    items: list[T]
    next_cursor: str | None


class IdCursor(BaseModel):
    id: UUID


class RankCursor(BaseModel):
    rank: float
    id: UUID


def encode_cursor(value: dict[str, Any]) -> str:
    """base64url(JSON) without padding: the same bytes every TaskFlow backend produces."""
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def decode_cursor[C: BaseModel](cursor: str, model: type[C]) -> C:
    """A cursor comes from the client, so it is validated like any other input."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        return model.model_validate_json(raw)
    except ValueError:  # bad base64, bad UTF-8, bad JSON and ValidationError all derive from it
        raise invalid("query.cursor", "is not a valid cursor") from None


def after_id(page: PageQuery) -> UUID | None:
    return decode_cursor(page.cursor, IdCursor).id if page.cursor else None


def keyset[T](
    query: Select[T],
    column: InstrumentedAttribute[UUID],
    *,
    descending: bool,
    limit: int,
    after: UUID | None,
) -> Select[T]:
    """Finishes a list query with keyset pagination: only rows past the cursor, in index order,
    one row more than the page (the extra row tells to_page() whether to mint a cursor)."""
    if after is not None:
        query = query.where(column < after if descending else column > after)
    return query.order_by(column.desc() if descending else column.asc()).limit(limit + 1)


def to_page[R, I](
    rows: Sequence[R],
    limit: int,
    to_item: Callable[[R], I],
    cursor_of: Callable[[R], dict[str, Any]],
) -> Page[I]:
    page_rows = rows[:limit]
    more = len(rows) > limit
    return Page[I](
        items=[to_item(row) for row in page_rows],
        next_cursor=encode_cursor(cursor_of(page_rows[-1])) if more and page_rows else None,
    )
