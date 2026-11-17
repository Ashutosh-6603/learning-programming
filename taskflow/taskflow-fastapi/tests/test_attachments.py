from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from httpx import Response

from tests.helpers import Fixture
from tests.helpers import create_fixture
from tests.helpers import send


@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)


@pytest.fixture
async def task_id(client: AsyncClient, f: Fixture) -> str:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    res = await send(client, "POST", url, user=f.owner, json={"title": "Has files"}, status=201)
    return str(res.json()["id"])


async def start(
    client: AsyncClient, f: Fixture, task_id: str, status: int, **body: Any
) -> Response:
    url = f"/api/v1/tasks/{task_id}/attachments"
    return await send(client, "POST", url, user=f.owner, json=body, status=status)


async def test_upload_straight_to_s3_then_complete_and_download(
    client: AsyncClient, f: Fixture, task_id: str
) -> None:
    content = b"hello attachment"
    res = await start(
        client,
        f,
        task_id,
        201,
        fileName="notes résumé.txt",
        contentType="text/plain",
        sizeBytes=len(content),
    )
    attachment, upload = res.json()["attachment"], res.json()["upload"]
    url = f"/api/v1/attachments/{attachment['id']}"
    assert (attachment["status"], upload["method"]) == ("pending", "PUT")

    # Completing before the bytes exist is a conflict.
    await send(client, "POST", f"{url}/complete", user=f.owner, status=409)

    async with httpx.AsyncClient() as s3:  # a real HTTP client: the browser's part
        put = await s3.put(upload["url"], headers=upload["headers"], content=content)
        assert put.status_code == 200

        done = await send(client, "POST", f"{url}/complete", user=f.owner, status=200)
        assert (done.json()["status"], done.json()["sizeBytes"]) == ("ready", len(content))

        listed = await send(
            client, "GET", f"/api/v1/tasks/{task_id}/attachments", user=f.owner, status=200
        )
        assert len(listed.json()["items"]) == 1

        download = await send(client, "GET", f"{url}/download", user=f.owner, status=200)
        file = await s3.get(download.json()["url"])
        assert file.content == content
        assert (
            "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt" in file.headers["content-disposition"]
        )

    await send(client, "DELETE", url, user=f.owner, status=204)
    await send(client, "GET", f"{url}/download", user=f.owner, status=404)


async def test_an_upload_of_a_different_size_is_refused(
    client: AsyncClient, f: Fixture, task_id: str
) -> None:
    res = await start(
        client, f, task_id, 201, fileName="a.txt", contentType="text/plain", sizeBytes=5
    )
    attachment, upload = res.json()["attachment"], res.json()["upload"]
    async with httpx.AsyncClient() as s3:
        # The signed Content-Length makes S3 itself reject a different size.
        put = await s3.put(upload["url"], headers=upload["headers"], content=b"way too long")
    assert put.is_error
    await send(
        client, "POST", f"/api/v1/attachments/{attachment['id']}/complete", user=f.owner, status=409
    )


async def test_file_metadata_is_validated(client: AsyncClient, f: Fixture, task_id: str) -> None:
    res = await start(
        client,
        f,
        task_id,
        422,
        fileName="../etc/passwd",
        contentType="Text/Plain",
        sizeBytes=30 * 1024 * 1024,
    )
    assert sorted(e["field"] for e in res.json()["errors"]) == [
        "contentType",
        "fileName",
        "sizeBytes",
    ]
