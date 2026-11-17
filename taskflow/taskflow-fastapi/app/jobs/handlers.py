from datetime import UTC
from datetime import datetime
from datetime import timedelta
from urllib.parse import quote
from uuid import UUID

import structlog
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy import text
from sqlalchemy.orm import joinedload

from app.infra.resources import Resources
from app.jobs.mailer import Mailer
from app.models.task import Attachment
from app.models.task import Task

log = structlog.get_logger("jobs")

STALE_UPLOAD_AGE = timedelta(hours=24)

# SKIP LOCKED lets several schedulers run at once without blocking each other or claiming
# the same rows; setting reminder_sent_at is the claim.
_CLAIM_DUE_TASKS = text("""
UPDATE tasks SET reminder_sent_at = now()
WHERE id IN (
    SELECT id FROM tasks
    WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
      AND due_at > now() AND due_at <= now() + interval '24 hours'
    ORDER BY due_at
    LIMIT :batch
    FOR UPDATE SKIP LOCKED
)
RETURNING id
""")


class JobHandlers:
    """What each job does. Plain async methods: the worker calls them, and so do the tests."""

    def __init__(self, resources: Resources, mailer: Mailer) -> None:
        self.resources = resources
        self.mailer = mailer
        self.frontend = resources.settings.frontend_origin

    async def send_invitation_email(
        self, *, email: str, workspace_name: str, inviter_name: str, token: str
    ) -> None:
        link = f"{self.frontend}/invitations/accept?token={quote(token, safe='')}"
        await self.mailer.send(
            to=email,
            subject=f"{inviter_name} invited you to {workspace_name} on TaskFlow",
            text=(
                f'{inviter_name} invited you to join "{workspace_name}".\n\n'
                f"Accept the invitation: {link}\n\nThe link expires in 7 days."
            ),
        )

    async def scan_due_reminders(self) -> int:
        async with self.resources.sessions() as session:
            claimed = (await session.scalars(_CLAIM_DUE_TASKS, {"batch": 100})).all()
            await session.commit()
        for task_id in claimed:
            await self.resources.jobs.send_due_reminder(task_id)
        log.info("due reminders claimed", claimed=len(claimed))
        return len(claimed)

    async def send_due_reminder(self, task_id: UUID) -> bool:
        async with self.resources.sessions() as session:
            task = await session.scalar(
                select(Task)
                .options(joinedload(Task.assignee), joinedload(Task.project))
                .where(Task.id == task_id)
            )
        if task is None or task.assignee is None or task.due_at is None:
            return False
        await self.mailer.send(
            to=task.assignee.email,
            subject=f"Due soon: {task.project.key}-{task.number} {task.title}",
            text=(
                f'"{task.title}" in {task.project.name} is due at '
                f"{task.due_at.isoformat().replace('+00:00', 'Z')}.\n\n"
                f"Open it: {self.frontend}/tasks/{task.id}"
            ),
        )
        return True

    async def delete_storage_prefix(self, prefix: str) -> int:
        return await self.resources.storage.delete_prefix(prefix)

    async def cleanup_stale_uploads(self) -> int:
        cutoff = datetime.now(UTC) - STALE_UPLOAD_AGE
        async with self.resources.sessions() as session:
            stale = (
                await session.execute(
                    select(Attachment.id, Attachment.storage_key)
                    .where(Attachment.status == "pending", Attachment.created_at < cutoff)
                    .limit(500)
                )
            ).all()
            for row in stale:
                await self.resources.storage.delete_prefix(row.storage_key)
            if stale:
                await session.execute(
                    delete(Attachment).where(Attachment.id.in_([r.id for r in stale]))
                )
                await session.commit()
        log.info("stale uploads cleaned", removed=len(stale))
        return len(stale)
