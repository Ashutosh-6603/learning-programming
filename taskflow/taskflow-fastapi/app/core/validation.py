from collections.abc import Sequence
from typing import Any

from app.core.problems import FieldError


def field_errors(errors: Sequence[Any]) -> list[FieldError]:
    """Pydantic errors → `{field, message}`, one per field. `loc` is already in wire (alias) form.

    ("body", "displayName") → "displayName"; ("query", "limit") → "query.limit";
    ("body",) → "body" (the body as a whole: not an object, or an empty PATCH).
    """
    out: list[FieldError] = []
    seen: set[str] = set()
    for error in errors:
        source, *path = error["loc"]
        parts = [str(p) for p in path]
        if source != "body":
            parts.insert(0, source)
        field = ".".join(parts) or "body"
        if field not in seen:
            seen.add(field)
            out.append(FieldError(field=field, message=error["msg"]))
    return out
