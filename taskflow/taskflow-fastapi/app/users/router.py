from fastapi import APIRouter

from app.auth.dependencies import CurrentUser
from app.core.problems import not_found
from app.users.schemas import UpdateUserIn
from app.users.schemas import UserOut
from app.users.service import UsersServiceDep

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me")
async def get_me(user_id: CurrentUser, users: UsersServiceDep) -> UserOut:
    user = await users.get(user_id)
    if user is None:
        raise not_found("User")
    return UserOut.of(user)


@router.patch("/me")
async def update_me(user_id: CurrentUser, body: UpdateUserIn, users: UsersServiceDep) -> UserOut:
    user = await users.update(user_id, body)
    if user is None:
        raise not_found("User")
    return UserOut.of(user)
