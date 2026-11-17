from datetime import datetime
from typing import Annotated
from typing import Any
from typing import Self

from pydantic import AwareDatetime
from pydantic import BaseModel
from pydantic import BeforeValidator
from pydantic import ConfigDict
from pydantic import StringConstraints
from pydantic import model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError


class CamelModel(BaseModel):
    """snake_case in Python, camelCase on the wire: `display_name` ⇄ `"displayName"`."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
    )


class PatchModel(CamelModel):
    """A PATCH body: every field optional, but at least one must be sent."""

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        # model_fields_set holds the fields the client actually sent (merge-patch semantics).
        if not self.model_fields_set:
            raise PydanticCustomError("empty_patch", "at least one field is required")
        return self


# Trimmed before its length is checked, so "   " counts as empty: Annotated[Trimmed, Field(...)].
Trimmed = Annotated[str, StringConstraints(strip_whitespace=True)]


def _number_only(value: Any) -> Any:
    if isinstance(value, str | bool):
        raise PydanticCustomError("int_type", "Input should be a valid integer")
    return value


# A JSON number with no fractional part: 5 and 5.0 (JSON Schema calls both integers), not "5"
# or true, which lax mode would convert. Query strings are text, so they stay lax.
JsonInt = Annotated[int, BeforeValidator(_number_only)]


def _string_only(value: Any) -> Any:
    # Lax mode would read 1700000000 as a Unix time; the contract says ISO-8601 text.
    if not isinstance(value, str | datetime):
        raise PydanticCustomError("datetime_type", "must be an ISO-8601 date-time string")
    return value


# A full timestamp with an offset ("2026-10-25T12:00:00Z"); a bare date or a naive one is refused.
Timestamp = Annotated[AwareDatetime, BeforeValidator(_string_only)]


def _reject_null(value: Any) -> Any:
    if value is None:
        raise PydanticCustomError("not_null", "may be omitted, but not null")
    return value


# For PATCH fields that can be left out but not cleared: Annotated[str | None, NotNull] = None.
NotNull = BeforeValidator(_reject_null)
