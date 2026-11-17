import asyncio
from typing import Any
from uuid import UUID

from celery import Celery

from app.config import Settings


def create_celery(settings: Settings) -> Celery:
    """One Celery app for both sides: the API sends with it, the worker (Part 11) consumes."""
    celery = Celery("taskflow", broker=str(settings.redis_url))
    celery.conf.update(
        task_serializer="json",
        accept_content=["json"],
        task_ignore_result=True,
        broker_connection_retry_on_startup=True,
        timezone="UTC",
    )
    return celery


class Jobs:
    """The typed facade services use; they never touch Celery directly."""

    def __init__(self, celery: Celery) -> None:
        self.celery = celery

    async def _send(self, name: str, **kwargs: Any) -> None:
        # send_task enqueues by name, so the API needn't import the worker's code. It is a
        # blocking network call, so it runs in a thread, off the event loop.
        await asyncio.to_thread(self.celery.send_task, name, kwargs=kwargs)

    async def send_invitation_email(
        self, *, email: str, workspace_name: str, inviter_name: str, token: str
    ) -> None:
        await self._send(
            "send-invitation-email",
            email=email,
            workspace_name=workspace_name,
            inviter_name=inviter_name,
            token=token,
        )

    async def delete_storage_prefix(self, prefix: str) -> None:
        await self._send("delete-storage-prefix", prefix=prefix)

    async def send_due_reminder(self, task_id: UUID) -> None:
        await self._send("send-due-reminder", task_id=str(task_id))
