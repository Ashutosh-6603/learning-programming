from typing import Annotated
from typing import Literal
from uuid import UUID

from pydantic import Field
from pydantic import TypeAdapter
from pydantic import ValidationError

from app.core.schemas import CamelModel


class ProjectRef(CamelModel):
    project_id: UUID


class Subscribe(CamelModel):
    type: Literal["subscribe"]
    payload: ProjectRef


class Unsubscribe(CamelModel):
    type: Literal["unsubscribe"]
    payload: ProjectRef


class Ping(CamelModel):
    type: Literal["ping"]


# A discriminated union: Pydantic reads `type` first and validates against that one model only.
type ClientMessage = Annotated[Subscribe | Unsubscribe | Ping, Field(discriminator="type")]
_client_message: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)


def parse_client_message(raw: str) -> Subscribe | Unsubscribe | Ping | None:
    """A validated message, or None for anything malformed (bad JSON, unknown type, bad id)."""
    try:
        return _client_message.validate_json(raw)
    except ValidationError:
        return None
