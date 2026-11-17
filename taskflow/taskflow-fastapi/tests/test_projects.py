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


async def column_names(client: AsyncClient, f: Fixture) -> list[str]:
    res = await send(
        client, "GET", f"/api/v1/projects/{f.project_id}/board", user=f.owner, status=200
    )
    return [c["name"] for c in res.json()["columns"]]


async def test_three_default_columns_and_a_duplicate_key_is_409(
    client: AsyncClient, f: Fixture
) -> None:
    assert await column_names(client, f) == ["To Do", "In Progress", "Done"]
    url = f"/api/v1/workspaces/{f.workspace_id}/projects"
    await send(client, "POST", url, user=f.owner, json={"name": "Again", "key": "TF"}, status=409)


async def test_projects_newest_first_and_updated_with_merge_patch(
    client: AsyncClient, f: Fixture
) -> None:
    projects = f"/api/v1/workspaces/{f.workspace_id}/projects"
    body = {"name": "Second", "key": "SEC", "description": "Another one"}
    await send(client, "POST", projects, user=f.owner, json=body, status=201)
    listed = await send(client, "GET", projects, user=f.owner, status=200)
    assert [p["key"] for p in listed.json()["items"]] == ["SEC", "TF"]
    patch = {"description": None, "name": "TaskFlow v2"}
    res = await send(
        client, "PATCH", f"/api/v1/projects/{f.project_id}", user=f.owner, json=patch, status=200
    )
    assert (res.json()["name"], res.json()["description"], res.json()["key"]) == (
        "TaskFlow v2",
        None,
        "TF",
    )


async def test_project_and_column_management_is_for_admins(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    project = f"/api/v1/projects/{f.project_id}"
    await send(client, "GET", project, user=member, status=200)
    await send(client, "POST", f"{project}/columns", user=member, json={"name": "Nope"}, status=403)
    await send(client, "DELETE", project, user=member, status=403)


async def test_a_workspace_delete_cascades_to_its_projects(client: AsyncClient, f: Fixture) -> None:
    await send(client, "DELETE", f"/api/v1/workspaces/{f.workspace_id}", user=f.owner, status=204)
    await send(client, "GET", f"/api/v1/projects/{f.project_id}", user=f.owner, status=404)


async def test_columns_are_added_renamed_reordered_and_deleted(
    client: AsyncClient, f: Fixture
) -> None:
    body = {"name": "Review", "wipLimit": 3}
    url = f"/api/v1/projects/{f.project_id}/columns"
    created = await send(client, "POST", url, user=f.owner, json=body, status=201)
    column = f"/api/v1/columns/{created.json()['id']}"
    assert await column_names(client, f) == ["To Do", "In Progress", "Done", "Review"]

    await send(client, "PATCH", column, user=f.owner, json={"name": "QA"}, status=200)
    await send(
        client, "POST", f"{column}/move", user=f.owner, json={"afterColumnId": None}, status=200
    )
    assert await column_names(client, f) == ["QA", "To Do", "In Progress", "Done"]

    after = {"afterColumnId": f.column_ids[1]}
    await send(client, "POST", f"{column}/move", user=f.owner, json=after, status=200)
    assert await column_names(client, f) == ["To Do", "In Progress", "QA", "Done"]

    await send(client, "DELETE", column, user=f.owner, status=204)
    assert await column_names(client, f) == ["To Do", "In Progress", "Done"]


async def test_move_requires_after_column_id_and_wip_limit_is_a_json_integer(
    client: AsyncClient, f: Fixture
) -> None:
    column = f"/api/v1/columns/{f.column_ids[0]}"
    res = await send(client, "POST", f"{column}/move", user=f.owner, json={}, status=422)
    assert res.json()["errors"][0]["field"] == "afterColumnId"
    res = await send(client, "PATCH", column, user=f.owner, json={"wipLimit": "5"}, status=422)
    assert res.json()["errors"][0]["field"] == "wipLimit"
