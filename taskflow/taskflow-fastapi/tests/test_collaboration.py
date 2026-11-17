import pytest
from httpx import AsyncClient

from app.infra.resources import Resources
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import send


@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)


async def create_task(
    client: AsyncClient, f: Fixture, title: str, description: str | None = None
) -> str:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    body = {"title": title, "description": description}
    return str((await send(client, "POST", url, user=f.owner, json=body, status=201)).json()["id"])


async def test_comments_oldest_first_author_edits_author_or_admin_deletes(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    task_id = await create_task(client, f, "Discuss me")
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    url = f"/api/v1/tasks/{task_id}/comments"
    first = await send(client, "POST", url, user=member, json={"body": "first"}, status=201)
    await send(client, "POST", url, user=f.owner, json={"body": "second"}, status=201)
    comment = f"/api/v1/comments/{first.json()['id']}"

    listed = await send(client, "GET", url, user=member, status=200)
    assert [c["body"] for c in listed.json()["items"]] == ["first", "second"]

    await send(client, "PATCH", comment, user=f.owner, json={"body": "hijack"}, status=403)
    edited = await send(client, "PATCH", comment, user=member, json={"body": "edited"}, status=200)
    assert (edited.json()["body"], edited.json()["author"]["id"]) == ("edited", member.id)
    await send(client, "DELETE", comment, user=f.owner, status=204)


async def test_every_change_is_recorded_newest_first(client: AsyncClient, f: Fixture) -> None:
    task_id = await create_task(client, f, "Doomed")
    await send(client, "DELETE", f"/api/v1/tasks/{task_id}", user=f.owner, status=204)
    activity = f"/api/v1/workspaces/{f.workspace_id}/activity"
    for_task = await send(client, "GET", f"{activity}?taskId={task_id}", user=f.owner, status=200)
    assert [e["type"] for e in for_task.json()["items"]] == ["task.deleted", "task.created"]

    everything = await send(client, "GET", f"{activity}?limit=100", user=f.owner, status=200)
    assert everything.json()["items"][-1]["type"] == "workspace.created"


async def test_search_ranks_title_matches_first_escapes_and_pages_by_rank(
    client: AsyncClient, f: Fixture
) -> None:
    await create_task(client, f, "Write docs", "Explain the <b>login</b> flow")
    await create_task(client, f, "Fix login redirect", "Users bounce back")
    await create_task(client, f, "Unrelated", "Nothing here")

    url = f"/api/v1/workspaces/{f.workspace_id}/search"
    res = await send(client, "GET", url, user=f.owner, params={"q": "login"}, status=200)
    hits = res.json()["items"]
    assert [h["task"]["title"] for h in hits] == ["Fix login redirect", "Write docs"]
    # Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    assert "<mark>login</mark>" in hits[1]["headline"]
    assert "<b>" not in hits[1]["headline"]

    page1 = await send(
        client, "GET", url, user=f.owner, params={"q": "login", "limit": 1}, status=200
    )
    cursor = page1.json()["nextCursor"]
    params = {"q": "login", "limit": 1, "cursor": cursor}
    page2 = (await send(client, "GET", url, user=f.owner, params=params, status=200)).json()
    assert [h["task"]["title"] for h in page2["items"]] == ["Write docs"]
    assert page2["nextCursor"] is None


async def test_search_is_limited_to_your_workspaces(client: AsyncClient, f: Fixture) -> None:
    outsider = await register_user(client, "Outsider")
    url = f"/api/v1/workspaces/{f.workspace_id}/search?q=docs"
    await send(client, "GET", url, user=outsider, status=404)
