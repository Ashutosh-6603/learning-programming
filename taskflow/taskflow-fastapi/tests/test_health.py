from httpx import AsyncClient

from tests.helpers import send


async def test_liveness_never_touches_dependencies(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/live", status=200)
    assert res.json() == {"status": "ok"}


async def test_readiness_checks_postgres_and_redis(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/ready", status=200)
    assert res.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}


async def test_unknown_routes_get_a_problem_404_that_echoes_the_request_id(
    client: AsyncClient,
) -> None:
    res = await send(client, "GET", "/nope", headers={"X-Request-Id": "abc-123"}, status=404)
    assert res.headers["content-type"] == "application/problem+json"
    assert res.headers["x-request-id"] == "abc-123"
    assert res.json() | {"detail": None} == {
        "type": "https://taskflow.example/problems/not-found",
        "title": "Not found",
        "status": 404,
        "detail": None,
        "instance": "/nope",
        "requestId": "abc-123",
    }


async def test_undeclared_methods_get_405_with_an_allow_header(client: AsyncClient) -> None:
    res = await send(client, "POST", "/health/live", status=405)
    assert res.headers["allow"] == "GET"
    assert res.json()["type"] == "https://taskflow.example/problems/method-not-allowed"


async def test_non_json_bodies_get_415_and_oversized_ones_413(client: AsyncClient) -> None:
    # The body guard answers before routing, so any path shows it.
    text = {"Content-Type": "text/plain"}
    await send(client, "POST", "/health/live", headers=text, content="hi", status=415)
    huge = '{"blob": "' + "x" * 1_100_000 + '"}'
    json = {"Content-Type": "application/json"}
    await send(client, "POST", "/health/live", headers=json, content=huge, status=413)


async def test_security_headers_on_every_response(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/live", status=200)
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"
