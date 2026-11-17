"""What the integration tests share: requests, users and fixtures, as in every TaskFlow backend."""

import base64
import itertools
import json
import secrets
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from httpx import AsyncClient
from httpx import Response
from sqlalchemy import text

from app.access.roles import Role
from app.infra.resources import Resources
from app.models.workspace import WorkspaceMember

TABLES = [
    "activity_events",
    "attachments",
    "comments",
    "tasks",
    "board_columns",
    "projects",
    "invitations",
    "workspace_members",
    "workspaces",
    "users",
]


async def reset_state(resources: Resources) -> None:
    async with resources.engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
    await resources.redis.flushdb()


@dataclass(frozen=True)
class ApiUser:
    id: str
    email: str
    token: str

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def send(
    client: AsyncClient,
    method: str,
    url: str,
    *,
    user: ApiUser | None = None,
    status: int | None = None,
    headers: dict[str, str] | None = None,
    **kwargs: Any,
) -> Response:
    """One request; `status=` asserts it, showing the body when it's wrong. kwargs go to httpx
    (json=, content=, params=)."""
    res = await client.request(
        method, url, headers={**(user.auth if user else {}), **(headers or {})}, **kwargs
    )
    if status is not None:
        assert res.status_code == status, f"{method} {url}: {res.status_code} {res.text}"
    return res


_counter = itertools.count(1)
# Unique per test run: Mailpit keeps the emails of earlier runs.
_RUN = secrets.token_hex(3)


async def register_user(client: AsyncClient, name: str = "User") -> ApiUser:
    email = f"{name.lower()}{next(_counter)}.{_RUN}@example.com"
    body = {"email": email, "password": "correct-horse-battery", "displayName": name}
    res = await send(client, "POST", "/api/v1/auth/register", json=body, status=201)
    data = res.json()
    return ApiUser(id=data["user"]["id"], email=email, token=data["accessToken"])


@dataclass(frozen=True)
class WorkspaceFixture:
    owner: ApiUser
    workspace_id: str


async def create_workspace(client: AsyncClient) -> WorkspaceFixture:
    """A fresh owner with their own workspace."""
    owner = await register_user(client, "Owner")
    body = {"name": "Acme", "slug": f"acme-{next(_counter)}"}
    res = await send(client, "POST", "/api/v1/workspaces", user=owner, json=body, status=201)
    return WorkspaceFixture(owner=owner, workspace_id=res.json()["id"])


async def add_member(resources: Resources, workspace_id: str, user: ApiUser, role: Role) -> None:
    """Adds an existing user to a workspace with a role, bypassing invitations."""
    async with resources.sessions() as session:
        session.add(
            WorkspaceMember(workspace_id=UUID(workspace_id), user_id=UUID(user.id), role=role)
        )
        await session.commit()


async def queued_jobs(resources: Resources) -> list[tuple[str, dict[str, Any]]]:
    """Celery's Redis broker keeps a queue as a plain list named after it ("celery"). Each entry
    is a JSON envelope whose base64 body holds [args, kwargs, options]. Oldest first."""
    jobs = []
    for raw in reversed(await resources.redis.lrange("celery", 0, -1)):
        message = json.loads(raw)
        _, kwargs, _ = json.loads(base64.b64decode(message["body"]))
        jobs.append((message["headers"]["task"], kwargs))
    return jobs


@dataclass(frozen=True)
class Fixture(WorkspaceFixture):
    project_id: str
    column_ids: list[str]


async def create_fixture(client: AsyncClient) -> Fixture:
    """A workspace plus a project, which comes with 3 default columns."""
    ws = await create_workspace(client)
    url = f"/api/v1/workspaces/{ws.workspace_id}/projects"
    body = {"name": "TaskFlow", "key": "TF"}
    res = await send(client, "POST", url, user=ws.owner, json=body, status=201)
    project_id = res.json()["id"]
    board = await send(client, "GET", f"/api/v1/projects/{project_id}/board", user=ws.owner)
    column_ids = [c["id"] for c in board.json()["columns"]]
    return Fixture(ws.owner, ws.workspace_id, project_id, column_ids)
