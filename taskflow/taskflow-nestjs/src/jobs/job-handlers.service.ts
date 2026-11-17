import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import type { Env } from '../config/env.js';
import { Attachment } from '../database/entities/attachment.entity.js';
import { Task } from '../database/entities/task.entity.js';
import { Storage } from '../infra/storage.service.js';
import { Jobs, type JobData, type JobName } from './jobs.service.js';
import { Mailer } from './mailer.service.js';

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

type Handlers = { [N in JobName]: (data: JobData[N]) => Promise<unknown> };

/** What each job does. Plain methods, so tests call them directly without a queue or a worker. */
@Injectable()
export class JobHandlers {
  private readonly frontendUrl: string;

  /** Job name → method. A mapped type, so adding a job to JobData without a handler won't compile. */
  private readonly handlers: Handlers = {
    'send-invitation-email': (data) => this.sendInvitationEmail(data),
    'scan-due-reminders': () => this.scanDueReminders(),
    'send-due-reminder': (data) => this.sendDueReminder(data),
    'delete-storage-prefix': (data) => this.deleteStoragePrefix(data),
    'cleanup-stale-uploads': () => this.cleanupStaleUploads(),
  };

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly storage: Storage,
    private readonly mailer: Mailer,
    private readonly jobs: Jobs,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JobHandlers.name);
    this.frontendUrl = config.get('FRONTEND_URL', { infer: true });
  }

  /** Routes a BullMQ job to its handler by job name. */
  run(name: string, data: unknown): Promise<unknown> {
    const handler = this.handlers[name as JobName] as
      ((data: unknown) => Promise<unknown>) | undefined;
    if (!handler) throw new Error(`Unknown job: ${name}`);
    return handler(data);
  }

  async sendInvitationEmail(data: JobData['send-invitation-email']) {
    const { email, workspaceName, inviterName, token } = data;
    const link = `${this.frontendUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: email,
      subject: `${inviterName} invited you to ${workspaceName} on TaskFlow`,
      text: `${inviterName} invited you to join "${workspaceName}".\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`,
    });
  }

  async scanDueReminders() {
    // SKIP LOCKED lets several schedulers run at once without blocking each other
    // or claiming the same rows; setting reminder_sent_at is the claim.
    // For UPDATE … RETURNING, TypeORM's query() resolves to [rows, affectedCount].
    const [claimed] = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE tasks SET reminder_sent_at = now()
       WHERE id IN (
         SELECT id FROM tasks
         WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
           AND due_at > now() AND due_at <= now() + interval '24 hours'
         ORDER BY due_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [BATCH],
    );
    for (const { id } of claimed) await this.jobs.enqueue('send-due-reminder', { taskId: id });
    return { claimed: claimed.length };
  }

  async sendDueReminder({ taskId }: JobData['send-due-reminder']) {
    const task = await this.tasks.findOne({
      where: { id: taskId },
      relations: { assignee: true, project: true },
    });
    if (!task?.assignee || !task.dueAt) return { skipped: true };
    await this.mailer.send({
      to: task.assignee.email,
      subject: `Due soon: ${task.project.key}-${task.number} ${task.title}`,
      text: `"${task.title}" in ${task.project.name} is due at ${task.dueAt.toISOString()}.\n\nOpen it: ${this.frontendUrl}/tasks/${task.id}`,
    });
    return { sent: true };
  }

  async deleteStoragePrefix({ prefix }: JobData['delete-storage-prefix']) {
    return { deleted: await this.storage.deletePrefix(prefix) };
  }

  async cleanupStaleUploads() {
    const stale = await this.attachments.find({
      where: { status: 'pending', createdAt: LessThan(new Date(Date.now() - STALE_UPLOAD_MS)) },
      select: { id: true, storageKey: true },
      take: 500,
    });
    for (const a of stale) await this.storage.deletePrefix(a.storageKey);
    if (stale.length > 0) await this.attachments.delete({ id: In(stale.map((a) => a.id)) });
    this.logger.info({ removed: stale.length }, 'stale uploads cleaned');
    return { removed: stale.length };
  }
}
