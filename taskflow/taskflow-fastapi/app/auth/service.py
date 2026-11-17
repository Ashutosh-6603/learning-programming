from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.auth.passwords import hash_password
from app.auth.passwords import verify_against_dummy
from app.auth.passwords import verify_password
from app.auth.refresh_tokens import RefreshTokensDep
from app.auth.schemas import LoginIn
from app.auth.schemas import RegisterIn
from app.core.problems import conflict
from app.core.problems import unauthorized
from app.models.user import User
from app.users.service import UsersServiceDep


class AuthService:
    """Proves who you are. The router turns the result into an access token and a cookie."""

    def __init__(self, users: UsersServiceDep, refresh_tokens: RefreshTokensDep) -> None:
        self.users = users
        self.refresh_tokens = refresh_tokens

    async def register(self, body: RegisterIn) -> tuple[User, str]:
        if await self.users.get_by_email_with_password(body.email) is not None:
            raise conflict("Email is already registered")
        user = await self.users.create(
            email=body.email,
            password_hash=await hash_password(body.password),
            display_name=body.display_name,
        )
        return user, await self.refresh_tokens.issue(user.id)

    async def login(self, body: LoginIn) -> tuple[User, str]:
        user = await self.users.get_by_email_with_password(body.email)
        if user is None:
            await verify_against_dummy(body.password)
            raise unauthorized("Invalid email or password")
        if not await verify_password(body.password, user.password_hash):
            raise unauthorized("Invalid email or password")
        return user, await self.refresh_tokens.issue(user.id)

    async def refresh(self, token: str | None) -> tuple[UUID, str]:
        if not token:
            raise unauthorized("Missing refresh token")
        match await self.refresh_tokens.rotate(token):
            case ("ok", user_id, new_token):
                return user_id, new_token
            case _:
                raise unauthorized("Invalid refresh token")

    async def logout(self, token: str | None) -> None:
        if token:
            await self.refresh_tokens.revoke_family(token)


AuthServiceDep = Annotated[AuthService, Depends()]
