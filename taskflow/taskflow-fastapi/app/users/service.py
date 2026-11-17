from collections.abc import Iterable
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.deps import SessionDep
from app.models.user import User
from app.users.schemas import UpdateUserIn


class UsersService:
    def __init__(self, session: SessionDep) -> None:
        self.session = session

    async def get(self, user_id: UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email_with_password(self, email: str) -> User | None:
        """The only query that reads the password hash (the column is deferred)."""
        query = select(User).where(User.email == email).options(undefer(User.password_hash))
        return await self.session.scalar(query)

    async def get_many(self, ids: Iterable[UUID]) -> list[User]:
        result = await self.session.scalars(select(User).where(User.id.in_(list(ids))))
        return list(result)

    async def create(self, *, email: str, password_hash: str, display_name: str) -> User:
        user = User(email=email, password_hash=password_hash, display_name=display_name)
        self.session.add(user)
        await self.session.commit()
        return user

    async def update(self, user_id: UUID, body: UpdateUserIn) -> User | None:
        user = await self.get(user_id)
        if user is None:
            return None
        # exclude_unset: only the fields the client sent (JSON merge-patch semantics).
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(user, field, value)
        await self.session.commit()
        return user


UsersServiceDep = Annotated[UsersService, Depends()]
