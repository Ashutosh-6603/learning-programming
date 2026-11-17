from typing import Final
from typing import Literal

from app.auth.passwords import hash_password
from app.users.service import UsersService

# The account every TaskFlow backend seeds for local development, so the frontend has a login
# ready. Its password is public: app/seed.py refuses to run in production.
DEFAULT_EMAIL: Final = "ashutosh@test.com"
DEFAULT_PASSWORD: Final = "Ashutosh#1234"  # noqa: S105 (a documented development login)
DEFAULT_DISPLAY_NAME: Final = "Ashutosh"


async def seed_default_user(users: UsersService) -> Literal["created", "exists"]:
    """Creates the default user unless the email is already registered. Safe to run repeatedly."""
    if await users.get_by_email_with_password(DEFAULT_EMAIL) is not None:
        return "exists"
    await users.create(
        email=DEFAULT_EMAIL,
        password_hash=await hash_password(DEFAULT_PASSWORD),
        display_name=DEFAULT_DISPLAY_NAME,
    )
    return "created"
