from httpx import AsyncClient
from httpx import Response

from tests.helpers import register_user
from tests.helpers import send

REGISTER = "/api/v1/auth/register"


def refresh_cookie(res: Response) -> tuple[str, str]:
    """The raw Set-Cookie header for the refresh token, and the `name=value` part to send back."""
    header = next(c for c in res.headers.get_list("set-cookie") if c.startswith("refresh_token="))
    return header, header.split(";", 1)[0]


async def register(client: AsyncClient, email: str) -> Response:
    body = {"email": email, "password": "correct-horse", "displayName": "Ada"}
    return await send(client, "POST", REGISTER, json=body, status=201)


async def test_register_sets_a_hardened_refresh_cookie_and_returns_the_session(
    client: AsyncClient,
) -> None:
    body = {"email": "Ada@Example.com", "password": "correct-horse", "displayName": "  Ada  "}
    res = await send(client, "POST", REGISTER, json=body, status=201)
    data = res.json()
    assert data["tokenType"] == "Bearer"
    assert data["expiresIn"] == 900
    assert data["user"] | {"id": None, "createdAt": None} == {
        "id": None,
        "email": "ada@example.com",
        "displayName": "Ada",
        "createdAt": None,
    }
    header, _ = refresh_cookie(res)
    for part in ["HttpOnly", "Secure", "SameSite=lax", "Path=/api/v1/auth", "Max-Age=604800"]:
        assert part in header


async def test_duplicate_email_is_a_409(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    body = {"email": user.email.upper(), "password": "another-pass", "displayName": "Ada"}
    await send(client, "POST", REGISTER, json=body, status=409)


async def test_422_lists_camel_case_fields(client: AsyncClient) -> None:
    body = {"email": "not-an-email", "password": "short", "displayName": ""}
    res = await send(client, "POST", REGISTER, json=body, status=422)
    assert res.headers["content-type"] == "application/problem+json"
    fields = sorted(e["field"] for e in res.json()["errors"])
    assert fields == ["displayName", "email", "password"]


async def test_body_types_are_never_coerced_and_unknown_fields_are_ignored(
    client: AsyncClient,
) -> None:
    body = {"email": "typed@example.com", "password": 12345678, "displayName": "Ada"}
    res = await send(client, "POST", REGISTER, json=body, status=422)
    assert [e["field"] for e in res.json()["errors"]] == ["password"]
    extra = body | {"password": "correct-horse", "isAdmin": True}
    await send(client, "POST", REGISTER, json=extra, status=201)


async def test_malformed_json_is_400_and_a_wrong_method_405(client: AsyncClient) -> None:
    login = "/api/v1/auth/login"
    json = {"Content-Type": "application/json"}
    await send(client, "POST", login, headers=json, content='{"email":', status=400)
    res = await send(client, "PUT", login, json={}, status=405)
    assert res.headers["allow"] == "POST"


async def test_unknown_email_and_wrong_password_get_the_same_401(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    login = "/api/v1/auth/login"
    ok = {"email": user.email, "password": "correct-horse-battery"}
    await send(client, "POST", login, json=ok, status=200)
    wrong = await send(client, "POST", login, json=ok | {"password": "nope"}, status=401)
    unknown = await send(
        client, "POST", login, json={"email": "ghost@example.com", "password": "nope"}, status=401
    )
    assert wrong.json()["detail"] == unknown.json()["detail"]


async def test_refresh_rotates_and_reuse_revokes_the_family(client: AsyncClient) -> None:
    _, first = refresh_cookie(await register(client, "rot@example.com"))

    async def refresh(cookie: str, status: int) -> Response:
        return await send(
            client, "POST", "/api/v1/auth/refresh", headers={"Cookie": cookie}, status=status
        )

    refreshed = await refresh(first, 200)
    assert refreshed.json()["tokenType"] == "Bearer"
    _, second = refresh_cookie(refreshed)
    assert second != first

    # Replaying the rotated token looks like theft: everything in the family dies.
    await refresh(first, 401)
    await refresh(second, 401)


async def test_logout_revokes_the_session_and_clears_the_cookie(client: AsyncClient) -> None:
    _, cookie = refresh_cookie(await register(client, "out@example.com"))
    headers = {"Cookie": cookie}
    res = await send(client, "POST", "/api/v1/auth/logout", headers=headers, status=204)
    header, _ = refresh_cookie(res)
    assert "Max-Age=0" in header
    await send(client, "POST", "/api/v1/auth/refresh", headers=headers, status=401)


async def test_users_me_is_protected_and_renamable(client: AsyncClient) -> None:
    me = "/api/v1/users/me"
    await send(client, "GET", me, status=401)
    await send(client, "GET", me, headers={"Authorization": "Bearer junk"}, status=401)
    user = await register_user(client, "Ada")
    await send(client, "PATCH", me, user=user, json={"displayName": "Ada L."}, status=200)
    res = await send(client, "GET", me, user=user, status=200)
    assert (res.json()["id"], res.json()["displayName"]) == (user.id, "Ada L.")
    empty = await send(client, "PATCH", me, user=user, json={}, status=422)
    assert empty.json()["errors"][0]["field"] == "body"
    await send(client, "PATCH", me, user=user, json={"displayName": None}, status=422)


async def test_auth_is_limited_to_10_per_minute_per_ip_then_429(client: AsyncClient) -> None:
    body = {"email": "nobody@example.com", "password": "x"}
    for _ in range(10):
        await send(client, "POST", "/api/v1/auth/login", json=body, status=401)
    limited = await send(client, "POST", "/api/v1/auth/login", json=body, status=429)
    assert int(limited.headers["retry-after"]) > 0
    assert limited.json()["type"] == "https://taskflow.example/problems/rate-limited"
