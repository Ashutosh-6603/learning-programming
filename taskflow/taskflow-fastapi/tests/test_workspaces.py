from httpx import AsyncClient

from app.infra.resources import Resources
from tests.helpers import ApiUser
from tests.helpers import add_member
from tests.helpers import create_workspace
from tests.helpers import queued_jobs
from tests.helpers import register_user
from tests.helpers import send

WORKSPACES = "/api/v1/workspaces"


async def test_my_workspaces_newest_first_with_cursor_pagination(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    for slug in ["one", "two", "three"]:
        await send(
            client, "POST", WORKSPACES, user=user, json={"name": slug, "slug": slug}, status=201
        )
    page1 = (await send(client, "GET", f"{WORKSPACES}?limit=2", user=user, status=200)).json()
    assert [w["slug"] for w in page1["items"]] == ["three", "two"]
    assert page1["items"][0]["currentUserRole"] == "owner"
    url = f"{WORKSPACES}?limit=2&cursor={page1['nextCursor']}"
    page2 = (await send(client, "GET", url, user=user, status=200)).json()
    assert [w["slug"] for w in page2["items"]] == ["one"]
    assert page2["nextCursor"] is None


async def test_non_members_get_404_and_low_roles_get_403(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}"
    stranger = await register_user(client, "Stranger")
    await send(client, "GET", url, user=stranger, status=404)

    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, member, "member")
    await send(client, "GET", url, user=member, status=200)
    await send(client, "PATCH", url, user=member, json={"name": "Hijacked"}, status=403)
    await send(client, "DELETE", url, user=member, status=403)


async def test_taken_slug_is_409_and_a_bad_path_id_is_422(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    await send(
        client, "POST", WORKSPACES, user=user, json={"name": "A", "slug": "same"}, status=201
    )
    await send(
        client, "POST", WORKSPACES, user=user, json={"name": "B", "slug": "same"}, status=409
    )
    res = await send(client, "GET", f"{WORKSPACES}/not-a-uuid", user=user, status=422)
    assert res.json()["errors"][0]["field"] == "path.workspaceId"


async def test_the_owner_renames_and_deletes_the_workspace(client: AsyncClient) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}"
    res = await send(client, "PATCH", url, user=ws.owner, json={"name": "Acme Inc."}, status=200)
    assert (res.json()["name"], res.json()["currentUserRole"]) == ("Acme Inc.", "owner")
    await send(client, "DELETE", url, user=ws.owner, status=204)
    await send(client, "GET", url, user=ws.owner, status=404)


async def test_admins_manage_members_and_viewers_but_not_other_admins(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    admin = await register_user(client, "Admin")
    other_admin = await register_user(client, "Admin2")
    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, admin, "admin")
    await add_member(resources, ws.workspace_id, other_admin, "admin")
    await add_member(resources, ws.workspace_id, member, "member")

    def url(u: ApiUser) -> str:
        return f"{WORKSPACES}/{ws.workspace_id}/members/{u.id}"

    res = await send(client, "PATCH", url(member), user=admin, json={"role": "viewer"}, status=200)
    assert (res.json()["user"]["id"], res.json()["role"]) == (member.id, "viewer")
    await send(client, "PATCH", url(member), user=admin, json={"role": "admin"}, status=403)
    await send(client, "PATCH", url(other_admin), user=admin, json={"role": "member"}, status=403)
    await send(client, "DELETE", url(other_admin), user=admin, status=403)
    await send(client, "DELETE", url(member), user=admin, status=204)


async def test_a_workspace_never_loses_its_last_owner(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}/members/{ws.owner.id}"
    await send(client, "PATCH", url, user=ws.owner, json={"role": "admin"}, status=409)
    await send(client, "DELETE", url, user=ws.owner, status=409)

    second = await register_user(client, "Second")
    await add_member(resources, ws.workspace_id, second, "owner")
    await send(client, "DELETE", url, user=ws.owner, status=204)


async def test_members_are_listed_in_join_order(client: AsyncClient, resources: Resources) -> None:
    ws = await create_workspace(client)
    late = await register_user(client, "Late")
    await add_member(resources, ws.workspace_id, late, "viewer")
    res = await send(
        client, "GET", f"{WORKSPACES}/{ws.workspace_id}/members", user=late, status=200
    )
    assert [m["user"]["id"] for m in res.json()["items"]] == [ws.owner.id, late.id]


async def test_invite_queue_the_email_and_join(client: AsyncClient, resources: Resources) -> None:
    ws = await create_workspace(client)
    invitations = f"{WORKSPACES}/{ws.workspace_id}/invitations"
    invitee = await register_user(client, "Invitee")
    body = {"email": invitee.email.upper(), "role": "member"}
    created = (await send(client, "POST", invitations, user=ws.owner, json=body, status=201)).json()
    assert (created["email"], created["role"]) == (invitee.email, "member")
    assert created["invitedBy"]["id"] == ws.owner.id

    [(name, data)] = await queued_jobs(resources)
    assert name == "send-invitation-email"
    token = data["token"]

    again = {"email": invitee.email, "role": "viewer"}
    await send(client, "POST", invitations, user=ws.owner, json=again, status=409)

    accept = "/api/v1/invitations/accept"
    stranger = await register_user(client, "Stranger")
    await send(client, "POST", accept, user=stranger, json={"token": token}, status=403)
    joined = await send(client, "POST", accept, user=invitee, json={"token": token}, status=200)
    assert (joined.json()["id"], joined.json()["currentUserRole"]) == (ws.workspace_id, "member")
    await send(client, "POST", accept, user=invitee, json={"token": token}, status=404)

    pending = await send(client, "GET", invitations, user=ws.owner, status=200)
    assert pending.json() == {"items": [], "nextCursor": None}


async def test_only_owners_invite_admins_and_members_cannot_invite(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    admin = await register_user(client, "Admin")
    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, admin, "admin")
    await add_member(resources, ws.workspace_id, member, "member")
    url = f"{WORKSPACES}/{ws.workspace_id}/invitations"

    async def invite(who: ApiUser, role: str, status: int) -> str:
        body = {"email": "x@example.com", "role": role}
        res = await send(client, "POST", url, user=who, json=body, status=status)
        return str(res.json().get("id"))

    await invite(admin, "admin", 403)
    await invite(member, "viewer", 403)
    invitation_id = await invite(admin, "viewer", 201)
    await send(client, "DELETE", f"{url}/{invitation_id}", user=admin, status=204)
