from httpx import AsyncClient

from app.infra.resources import Resources
from app.users.default_user import DEFAULT_EMAIL
from app.users.default_user import DEFAULT_PASSWORD
from app.users.default_user import seed_default_user
from app.users.service import UsersService
from tests.helpers import send


async def test_seed_creates_the_user_once_and_the_user_can_log_in(
    client: AsyncClient, resources: Resources
) -> None:
    async with resources.sessions() as session:
        users = UsersService(session)
        assert await seed_default_user(users) == "created"
        assert await seed_default_user(users) == "exists"
    body = {"email": DEFAULT_EMAIL, "password": DEFAULT_PASSWORD}
    res = await send(client, "POST", "/api/v1/auth/login", json=body, status=200)
    assert res.json()["user"]["displayName"] == "Ashutosh"
