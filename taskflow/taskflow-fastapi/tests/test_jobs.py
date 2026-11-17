import os
import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any

import boto3
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import update

from app.infra.resources import Resources
from app.jobs.handlers import JobHandlers
from app.jobs.mailer import Mailer
from app.jobs.worker import celery
from app.models.task import Attachment
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import queued_jobs
from tests.helpers import register_user
from tests.helpers import send


@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)


@pytest.fixture
def handlers(resources: Resources) -> JobHandlers:
    # The API never runs jobs; the test builds the worker's handlers on the same resources.
    return JobHandlers(resources, Mailer(resources.settings))


MAILPIT_URL = os.environ.get("MAILPIT_URL", "http://localhost:18004")


async def inbox(to: str) -> list[dict[str, Any]]:
    """Mailpit's HTTP API: the messages sent to `to`, each with its full text."""
    async with httpx.AsyncClient(base_url=MAILPIT_URL) as mailpit:
        found = await mailpit.get("/api/v1/search", params={"query": f"to:{to}"})
        return [
            (await mailpit.get(f"/api/v1/message/{m['ID']}")).json()
            for m in found.json()["messages"]
        ]


async def test_the_invitation_email_carries_an_accept_link(
    resources: Resources, handlers: JobHandlers
) -> None:
    email = f"invitee-{secrets.token_hex(4)}@example.com"
    await handlers.send_invitation_email(
        email=email, workspace_name="Acme", inviter_name="Owner", token="tok-123"
    )
    [message] = await inbox(email)
    assert message["Subject"] == "Owner invited you to Acme on TaskFlow"
    assert (
        f"{resources.settings.frontend_origin}/invitations/accept?token=tok-123" in message["Text"]
    )


async def test_each_due_task_is_claimed_once_then_the_assignee_is_emailed(
    client: AsyncClient, resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    assignee = await register_user(client, "Assignee")
    await add_member(resources, f.workspace_id, assignee, "member")
    url = f"/api/v1/projects/{f.project_id}/tasks"

    async def create(title: str, due_in_hours: int, assigned: bool = True) -> None:
        due = (datetime.now(UTC) + timedelta(hours=due_in_hours)).isoformat()
        body = {"title": title, "dueAt": due} | ({"assigneeId": assignee.id} if assigned else {})
        await send(client, "POST", url, user=f.owner, json=body, status=201)

    await create("Due soon", 2)
    await create("Due later", 72)
    await create("Nobody assigned", 2, assigned=False)

    assert await handlers.scan_due_reminders() == 1
    assert await handlers.scan_due_reminders() == 0

    [(name, data)] = await queued_jobs(resources)
    assert name == "send-due-reminder"
    assert await handlers.send_due_reminder(data["task_id"]) is True
    [message] = await inbox(assignee.email)
    assert message["Subject"] == "Due soon: TF-1 Due soon"


async def test_every_object_under_a_prefix_is_deleted(
    resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    settings = resources.settings
    s3 = boto3.client(
        "s3",
        endpoint_url=str(settings.s3_endpoint),
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )
    prefix = f"projects/{f.project_id}/"
    for name in ["a", "b", "c"]:
        s3.put_object(Bucket=settings.s3_bucket, Key=f"{prefix}tasks/t/{name}", Body=name.encode())
    assert await handlers.delete_storage_prefix(prefix) == 3
    assert await handlers.delete_storage_prefix(prefix) == 0


async def test_uploads_pending_for_more_than_a_day_are_removed(
    client: AsyncClient, resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    task = await send(client, "POST", url, user=f.owner, json={"title": "With upload"}, status=201)
    body = {"fileName": "old.txt", "contentType": "text/plain", "sizeBytes": 3}
    attachments = f"/api/v1/tasks/{task.json()['id']}/attachments"
    await send(client, "POST", attachments, user=f.owner, json=body, status=201)
    async with resources.sessions() as session:
        yesterday = datetime.now(UTC) - timedelta(hours=25)
        await session.execute(update(Attachment).values(created_at=yesterday))
        await session.commit()
    assert await handlers.cleanup_stale_uploads() == 1
    async with resources.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Attachment)) == 0


def test_the_worker_registers_every_job_and_the_schedule() -> None:
    names = {"send-invitation-email", "send-due-reminder", "delete-storage-prefix"}
    names |= {"scan-due-reminders", "cleanup-stale-uploads"}
    assert names <= set(celery.tasks)
    assert celery.tasks["send-due-reminder"].max_retries == 4
    assert set(celery.conf.beat_schedule) == {"scan-due-reminders", "cleanup-stale-uploads"}
