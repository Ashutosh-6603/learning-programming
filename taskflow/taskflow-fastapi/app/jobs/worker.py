"""The Celery worker: `celery -A app.jobs.worker worker` (and `beat` for the schedule).

Celery runs plain synchronous functions. Our job code is async, so each worker process keeps
one event loop (an asyncio.Runner) and runs every job on it. The resources (pools, clients)
are created on that loop the first time a job runs, and reused by every later job.
"""

import asyncio
from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import AsyncExitStack
from typing import Any
from uuid import UUID

from celery.schedules import crontab
from celery.signals import setup_logging

from app.config import get_settings
from app.core.logging import configure_logging
from app.infra.resources import open_resources
from app.jobs.handlers import JobHandlers
from app.jobs.mailer import Mailer
from app.jobs.queue import create_celery

settings = get_settings()
celery = create_celery(settings)
celery.conf.beat_schedule = {
    "scan-due-reminders": {"task": "scan-due-reminders", "schedule": crontab(minute="*/15")},
    "cleanup-stale-uploads": {"task": "cleanup-stale-uploads", "schedule": crontab(minute=0)},
}

# 5 attempts in all, waiting about 2 s, 4 s, 8 s, 16 s between them (randomised: "jitter").
RETRY: dict[str, Any] = {
    "autoretry_for": (Exception,),
    "retry_backoff": 2,
    "retry_jitter": True,
    "max_retries": 4,
    "acks_late": True,  # acknowledge after the job ran, so a crashed worker's job is redelivered
}


@setup_logging.connect
def _configure_logging(**_: Any) -> None:
    """With a receiver on this signal, Celery leaves logging to us: JSON lines, like the API."""
    configure_logging(settings.log_level)


_runner: asyncio.Runner | None = None
_handlers: JobHandlers | None = None


def _run[T](job: Callable[[JobHandlers], Awaitable[T]]) -> T:
    # Created lazily: Celery forks its worker processes, and an event loop can't cross a fork.
    global _runner
    _runner = _runner or asyncio.Runner()

    async def call() -> T:
        global _handlers
        if _handlers is None:
            # Never closed: the resources live as long as the worker process.
            resources = await AsyncExitStack().enter_async_context(open_resources(settings))
            _handlers = JobHandlers(resources, Mailer(settings))
        return await job(_handlers)

    return _runner.run(call())


@celery.task(name="send-invitation-email", **RETRY)
def send_invitation_email(email: str, workspace_name: str, inviter_name: str, token: str) -> None:
    _run(
        lambda h: h.send_invitation_email(
            email=email, workspace_name=workspace_name, inviter_name=inviter_name, token=token
        )
    )


@celery.task(name="send-due-reminder", **RETRY)
def send_due_reminder(task_id: str) -> bool:
    return _run(lambda h: h.send_due_reminder(UUID(task_id)))


@celery.task(name="delete-storage-prefix", **RETRY)
def delete_storage_prefix(prefix: str) -> int:
    return _run(lambda h: h.delete_storage_prefix(prefix))


@celery.task(name="scan-due-reminders")
def scan_due_reminders() -> int:
    return _run(lambda h: h.scan_due_reminders())


@celery.task(name="cleanup-stale-uploads")
def cleanup_stale_uploads() -> int:
    return _run(lambda h: h.cleanup_stale_uploads())
