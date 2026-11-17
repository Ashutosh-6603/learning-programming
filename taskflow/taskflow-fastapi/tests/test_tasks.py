import asyncio
from typing import Any

import pytest
from httpx import AsyncClient
from httpx import Response

from app.infra.resources import Resources
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import send


@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)


async def create_task(client: AsyncClient, f: Fixture, title: str, **extra: Any) -> dict[str, Any]:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    res = await send(client, "POST", url, user=f.owner, json={"title": title, **extra}, status=201)
    task: dict[str, Any] = res.json()
    return task


async def board_titles(client: AsyncClient, f: Fixture) -> list[tuple[str, list[str]]]:
    res = await send(
        client, "GET", f"/api/v1/projects/{f.project_id}/board", user=f.owner, status=200
    )
    return [(c["name"], [t["title"] for t in c["tasks"]]) for c in res.json()["columns"]]


async def move(
    client: AsyncClient, f: Fixture, task_id: str, column_id: str, after: str | None, status: int
) -> Response:
    body = {"columnId": column_id, "afterTaskId": after}
    return await send(
        client, "POST", f"/api/v1/tasks/{task_id}/move", user=f.owner, json=body, status=status
    )


async def test_tasks_are_numbered_per_project_even_under_concurrent_creates(
    client: AsyncClient, f: Fixture
) -> None:
    tasks = await asyncio.gather(*(create_task(client, f, f"Task {i}") for i in range(10)))
    assert sorted(t["number"] for t in tasks) == list(range(1, 11))
    assert next(t["key"] for t in tasks if t["number"] == 7) == "TF-7"


async def test_new_tasks_go_to_the_bottom_and_move_with_fractional_positions(
    client: AsyncClient, f: Fixture
) -> None:
    a = await create_task(client, f, "A")
    b = await create_task(client, f, "B")
    c = await create_task(client, f, "C")
    assert a["position"] < b["position"] < c["position"]

    todo, _, done = f.column_ids
    await move(client, f, c["id"], todo, None, 200)  # C to the top of To Do
    await move(client, f, a["id"], done, None, 200)  # A to the top of Done
    moved = await move(client, f, b["id"], done, a["id"], 200)  # B right after A
    assert moved.json()["columnId"] == done

    assert await board_titles(client, f) == [
        ("To Do", ["C"]),
        ("In Progress", []),
        ("Done", ["A", "B"]),
    ]


async def test_move_targets_are_validated(client: AsyncClient, f: Fixture) -> None:
    a = await create_task(client, f, "A")
    url = f"/api/v1/workspaces/{f.workspace_id}/projects"
    other = await send(
        client, "POST", url, user=f.owner, json={"name": "Other", "key": "OT"}, status=201
    )
    board = await send(
        client, "GET", f"/api/v1/projects/{other.json()['id']}/board", user=f.owner, status=200
    )
    foreign_column = board.json()["columns"][0]["id"]
    res = await move(client, f, a["id"], foreign_column, None, 422)
    assert res.json()["errors"][0]["field"] == "columnId"
    await move(client, f, a["id"], f.column_ids[0], a["id"], 422)


async def test_the_board_is_cached_and_invalidated_on_writes(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    key = f"cache:board:{f.project_id}"
    await create_task(client, f, "Cached")
    await board_titles(client, f)
    assert await resources.redis.exists(key) == 1
    await create_task(client, f, "Fresh")
    assert await resources.redis.exists(key) == 0
    assert (await board_titles(client, f))[0] == ("To Do", ["Cached", "Fresh"])


async def test_patch_has_merge_semantics(client: AsyncClient, f: Fixture) -> None:
    t = await create_task(client, f, "Patch me", description="keep", dueAt="2030-01-01T09:00:00Z")
    body = {"dueAt": None, "priority": "high"}
    res = await send(
        client, "PATCH", f"/api/v1/tasks/{t['id']}", user=f.owner, json=body, status=200
    )
    task = res.json()
    assert (task["description"], task["dueAt"], task["priority"], task["title"]) == (
        "keep",
        None,
        "high",
        "Patch me",
    )


async def test_only_members_are_assignable_and_leaving_unassigns(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    stranger = await register_user(client, "Stranger")
    url = f"/api/v1/projects/{f.project_id}/tasks"
    body = {"title": "X", "assigneeId": stranger.id}
    rejected = await send(client, "POST", url, user=f.owner, json=body, status=422)
    assert rejected.json()["errors"][0]["field"] == "assigneeId"

    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    t = await create_task(client, f, "Assigned", assigneeId=member.id)
    leave = f"/api/v1/workspaces/{f.workspace_id}/members/{member.id}"
    await send(client, "DELETE", leave, user=member, status=204)
    after = await send(client, "GET", f"/api/v1/tasks/{t['id']}", user=f.owner, status=200)
    assert after.json()["assignee"] is None


async def test_the_task_list_filters_and_pages_newest_first(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    for i in range(1, 6):
        extra = {"assigneeId": member.id, "priority": "high"} if i % 2 else {}
        await create_task(client, f, f"T{i}", **extra)
    tasks = f"/api/v1/projects/{f.project_id}/tasks"

    async def titles(query: str) -> list[str]:
        res = await send(client, "GET", f"{tasks}?{query}", user=f.owner, status=200)
        return [t["title"] for t in res.json()["items"]]

    assert await titles(f"assigneeId={member.id}") == ["T5", "T3", "T1"]
    assert await titles("assigneeId=none") == ["T4", "T2"]
    assert await titles("priority=high&limit=2") == ["T5", "T3"]

    seen: list[str] = []
    cursor = None
    while True:
        query = f"limit=2&cursor={cursor}" if cursor else "limit=2"
        page = (await send(client, "GET", f"{tasks}?{query}", user=f.owner, status=200)).json()
        seen += [t["title"] for t in page["items"]]
        if (cursor := page["nextCursor"]) is None:
            break
    assert seen == ["T5", "T4", "T3", "T2", "T1"]
    res = await send(client, "GET", f"{tasks}?cursor=garbage", user=f.owner, status=422)
    assert res.json()["errors"][0]["field"] == "query.cursor"


async def test_viewers_read_but_cannot_write_and_outsiders_see_nothing(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    t = await create_task(client, f, "Secret")
    task = f"/api/v1/tasks/{t['id']}"
    viewer = await register_user(client, "Viewer")
    outsider = await register_user(client, "Outsider")
    await add_member(resources, f.workspace_id, viewer, "viewer")
    await send(client, "GET", task, user=viewer, status=200)
    await send(client, "PATCH", task, user=viewer, json={"title": "x"}, status=403)
    await send(client, "GET", task, user=outsider, status=404)


async def test_a_column_with_tasks_cannot_be_deleted(client: AsyncClient, f: Fixture) -> None:
    t = await create_task(client, f, "Blocker", columnId=f.column_ids[1])
    column = f"/api/v1/columns/{f.column_ids[1]}"
    await send(client, "DELETE", column, user=f.owner, status=409)
    await send(client, "DELETE", f"/api/v1/tasks/{t['id']}", user=f.owner, status=204)
    await send(client, "GET", f"/api/v1/tasks/{t['id']}", user=f.owner, status=404)
    await send(client, "DELETE", column, user=f.owner, status=204)
