import { v7 as uuidv7 } from 'uuid';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Storage } from '../../infra/storage.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

const toAttachment = (a: {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: bigint;
  status: string;
  createdAt: Date;
}) => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: Number(a.sizeBytes),
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});

const include = { uploader: { select: userSummarySelect } } as const;
const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

export class AttachmentsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.attachment.findMany({
      where: { taskId, status: 'ready', ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include,
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
    const attachment = await this.db.attachment.create({
      data: {
        id,
        taskId,
        uploaderId: userId,
        storageKey,
        ...input,
        sizeBytes: BigInt(input.sizeBytes),
      },
      include,
    });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: toAttachment(attachment),
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
    if (attachment.status === 'ready') {
      return toAttachment(
        await this.db.attachment.findUniqueOrThrow({ where: { id: attachmentId }, include }),
      );
    }
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (BigInt(size) !== attachment.sizeBytes)
      throw conflict('The uploaded file size does not match');
    return this.db.$transaction(async (tx) => {
      const ready = await tx.attachment.update({
        where: { id: attachmentId },
        data: { status: 'ready' },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return toAttachment(ready);
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
    await this.db.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachmentId } });
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
