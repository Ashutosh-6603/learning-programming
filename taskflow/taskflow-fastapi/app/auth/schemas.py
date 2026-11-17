import re
from typing import Annotated
from typing import Literal

from pydantic import AfterValidator
from pydantic import Field
from pydantic_core import PydanticCustomError

from app.core.schemas import CamelModel
from app.users.schemas import DisplayName
from app.users.schemas import UserOut

# The WHATWG rule browsers apply to <input type="email">: syntax only. (Pydantic's EmailStr
# also refuses reserved domains such as .test, a delivery policy the contract doesn't have.)
_EMAIL = re.compile(
    r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"
)


def _email(value: str) -> str:
    if not _EMAIL.fullmatch(value):
        raise PydanticCustomError("email", "must be a valid email address")
    return value.lower()  # stored and compared in lowercase (the users table has a CHECK)


Email = Annotated[
    str, Field(max_length=254, json_schema_extra={"format": "email"}), AfterValidator(_email)
]


class RegisterIn(CamelModel):
    email: Email
    password: Annotated[str, Field(min_length=8, max_length=128)]
    display_name: DisplayName


class LoginIn(CamelModel):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=128)]


class AccessToken(CamelModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105 (a token type, not a secret)
    expires_in: int


class AuthSession(AccessToken):
    user: UserOut
