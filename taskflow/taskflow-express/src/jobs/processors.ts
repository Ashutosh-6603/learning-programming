import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Storage } from '../infra/storage.js';
import type { Mailer } from './mailer.js';
import type { JobData, JobName, Jobs } from './queue.js';

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export interface ProcessorDeps {
  prisma: PrismaClient;
  storage: Storage;
  mailer: Mailer;
  jobs: Jobs;
  logger: Logger;
  frontendUrl: string;
}

type Processors = { [N in JobName]: (data: JobData[N]) => Promise<unknown> };

export function createProcessors(deps: ProcessorDeps): Processors {
  const { prisma, storage, mailer, jobs, logger } = deps;

  return {
    async 'send-invitation-email'({ email, workspaceName, inviterName, token }) {
      const link = `${deps.frontendUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: email,
        subject: `${inviterName} invited you to ${workspaceName} on TaskFlow`,
        text: `${inviterName} invited you to join "${workspaceName}".\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`,
      });
    },

    async 'scan-due-reminders'() {
      // SKIP LOCKED lets several schedulers run at once without blocking each other
      // or claiming the same rows; setting reminder_sent_at is the claim.
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE tasks SET reminder_sent_at = now()
        WHERE id IN (
          SELECT id FROM tasks
          WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
            AND due_at > now() AND due_at <= now() + interval '24 hours'
          ORDER BY due_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`;
      for (const { id } of claimed) await jobs.enqueue('send-due-reminder', { taskId: id });
      return { claimed: claimed.length };
    },

    async 'send-due-reminder'({ taskId }) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { assignee: true, project: { select: { key: true, name: true } } },
      });
      if (!task?.assignee || !task.dueAt) return { skipped: true };
      await mailer.send({
        to: task.assignee.email,
        subject: `Due soon: ${task.project.key}-${task.number} ${task.title}`,
        text: `"${task.title}" in ${task.project.name} is due at ${task.dueAt.toISOString()}.\n\nOpen it: ${deps.frontendUrl}/tasks/${task.id}`,
      });
      return { sent: true };
    },

    async 'delete-storage-prefix'({ prefix }) {
      return { deleted: await storage.deletePrefix(prefix) };
    },

    async 'cleanup-stale-uploads'() {
      const stale = await prisma.attachment.findMany({
        where: { status: 'pending', createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_MS) } },
        take: 500,
        select: { id: true, storageKey: true },
      });
      for (const a of stale) await storage.deletePrefix(a.storageKey);
      await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
      logger.info({ removed: stale.length }, 'stale uploads cleaned');
      return { removed: stale.length };
    },
  };
}

/** Routes a BullMQ job to its typed processor by job name. */
export function dispatch(processors: Processors) {
  return (job: Job) => {
    const processor = processors[job.name as JobName] as
      ((data: unknown) => Promise<unknown>) | undefined;
    if (!processor) throw new Error(`Unknown job: ${job.name}`);
    return processor(job.data);
  };
}
