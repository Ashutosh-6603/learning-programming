from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from fastapi import Cookie
from fastapi import Depends
from fastapi import Response

from app.auth.dependencies import limit_auth
from app.auth.schemas import AccessToken
from app.auth.schemas import AuthSession
from app.auth.schemas import LoginIn
from app.auth.schemas import RegisterIn
from app.auth.service import AuthServiceDep
from app.auth.tokens import create_access_token
from app.config import Settings
from app.deps import SettingsDep
from app.models.user import User
from app.users.schemas import UserOut

COOKIE = "refresh_token"
COOKIE_PATH = "/api/v1/auth"

router = APIRouter(prefix="/auth", tags=["auth"])
# `refresh_token: RefreshCookie` reads the cookie of that name (None when absent).
RefreshCookie = Annotated[str | None, Cookie()]


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.refresh_token_ttl_seconds,
        path=COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def _access_token(user_id: UUID, settings: Settings) -> AccessToken:
    return AccessToken(
        access_token=create_access_token(user_id, settings),
        expires_in=settings.access_token_ttl_seconds,
    )


def _session(user: User, settings: Settings) -> AuthSession:
    token = _access_token(user.id, settings)
    return AuthSession(**token.model_dump(), user=UserOut.of(user))


@router.post("/register", status_code=201, dependencies=[Depends(limit_auth)])
async def register(
    body: RegisterIn, response: Response, auth: AuthServiceDep, settings: SettingsDep
) -> AuthSession:
    user, refresh_token = await auth.register(body)
    _set_cookie(response, refresh_token, settings)
    return _session(user, settings)


@router.post("/login", dependencies=[Depends(limit_auth)])
async def login(
    body: LoginIn, response: Response, auth: AuthServiceDep, settings: SettingsDep
) -> AuthSession:
    user, refresh_token = await auth.login(body)
    _set_cookie(response, refresh_token, settings)
    return _session(user, settings)


@router.post("/refresh", dependencies=[Depends(limit_auth)])
async def refresh(
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: RefreshCookie = None,
) -> AccessToken:
    user_id, new_token = await auth.refresh(refresh_token)
    _set_cookie(response, new_token, settings)
    return _access_token(user_id, settings)


@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: RefreshCookie = None,
) -> None:
    await auth.logout(refresh_token)
    response.delete_cookie(
        COOKIE, path=COOKIE_PATH, secure=settings.cookie_secure, httponly=True, samesite="lax"
    )
