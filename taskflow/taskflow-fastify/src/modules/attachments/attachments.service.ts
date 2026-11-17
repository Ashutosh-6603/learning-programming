import { and, desc, eq, lt } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import { v7 as uuidv7 } from 'uuid';
import type { Database, Db } from '../../db/client.js';
import { attachments } from '../../db/schema.js';
import type { Storage } from '../../infra/storage.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import { Id, Timestamp } from '../../lib/schemas.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

export const Attachment = Type.Object({
  id: Id,
  taskId: Id,
  uploader: UserSummary,
  fileName: Type.String(),
  contentType: Type.String(),
  sizeBytes: Type.Integer(),
  status: Type.Enum(['pending', 'ready']),
  createdAt: Timestamp,
});

export const AttachmentUpload = Type.Object({
  attachment: Attachment,
  upload: Type.Object({
    url: Type.String(),
    method: Type.Literal('PUT'),
    headers: Type.Record(Type.String(), Type.String()),
    expiresAt: Timestamp,
  }),
});

export const DownloadUrl = Type.Object({ url: Type.String(), expiresAt: Timestamp });

const toAttachment = (a: {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'ready';
  createdAt: Date;
}): Static<typeof Attachment> => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});

const withUploader = { uploader: { columns: userSummaryColumns } } as const;
const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadAttachment(db: Db, id: string) {
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, id),
    with: withUploader,
  });
  if (!attachment) throw notFound('Attachment');
  return toAttachment(attachment);
}

export class AttachmentsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.attachments.findMany({
      where: and(
        eq(attachments.taskId, taskId),
        eq(attachments.status, 'ready'),
        after ? lt(attachments.id, after) : undefined,
      ),
      orderBy: desc(attachments.id),
      limit: limit + 1,
      with: withUploader,
    });
    return toPage(rows, limit, toAttachment, (a) => ({ id: a.id }));
  }

  async create(
    taskId: string,
    userId: string,
    input: { fileName: string; contentType: string; sizeBytes: number },
  ) {
    const { project } = await this.access.task(taskId, userId, 'member');
    // The id is generated here (not by the database) because the storage key needs it.
    const id = uuidv7();
    const storageKey = `projects/${project.id}/tasks/${taskId}/${id}`;
    await this.db
      .insert(attachments)
      .values({ id, taskId, uploaderId: userId, storageKey, ...input });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: await loadAttachment(this.db, id),
      upload: {
        url,
        method: 'PUT' as const,
        headers: { 'Content-Type': input.contentType },
        expiresAt: expiresAt(UPLOAD_URL_TTL),
      },
    };
  }

  async complete(attachmentId: string, userId: string) {
    const { attachment, project } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId)
      throw forbidden('Only the uploader can complete an upload');
    if (attachment.status === 'ready') return loadAttachment(this.db, attachmentId);
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (size !== attachment.sizeBytes) throw conflict('The uploaded file size does not match');
    return this.db.transaction(async (tx) => {
      await tx.update(attachments).set({ status: 'ready' }).where(eq(attachments.id, attachmentId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return loadAttachment(tx, attachmentId);
    });
  }

  async download(attachmentId: string, userId: string) {
    const { attachment } = await this.access.attachment(attachmentId, userId);
    if (attachment.status !== 'ready') throw notFound('Attachment');
    const url = await this.storage.presignDownload(
      attachment.storageKey,
      attachment.fileName,
      DOWNLOAD_URL_TTL,
    );
    return { url, expiresAt: expiresAt(DOWNLOAD_URL_TTL) };
  }

  async delete(attachmentId: string, userId: string) {
    const { attachment, project, membership } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the uploader or an admin can delete an attachment');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(attachments).where(eq(attachments.id, attachmentId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.deleted',
        data: { attachmentId, fileName: attachment.fileName },
      });
    });
    await this.jobs.enqueue('delete-storage-prefix', { prefix: attachment.storageKey });
  }
}
