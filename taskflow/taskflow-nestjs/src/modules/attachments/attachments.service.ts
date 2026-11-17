import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { Storage } from '../../infra/storage.service.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { atLeast } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toAttachment, type AttachmentUploadDto } from './attachment.dto.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadAttachment(manager: EntityManager, id: string) {
  const attachment = await manager.findOne(Attachment, {
    where: { id },
    relations: { uploader: true },
  });
  if (!attachment) throw notFound('Attachment');
  return toAttachment(attachment);
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.attachments
      .createQueryBuilder('attachment')
      .innerJoinAndSelect('attachment.uploader', 'uploader')
      .where('attachment.taskId = :taskId', { taskId })
      .andWhere("attachment.status = 'ready'");
    const rows = await keyset(query, 'attachment.id', 'DESC', limit, after);
    return toPage(rows, limit, toAttachment, (a) => ({ id: a.id }));
  }

  async create(
    taskId: string,
    userId: string,
    input: { fileName: string; contentType: string; sizeBytes: number },
  ): Promise<AttachmentUploadDto> {
    const { project } = await this.access.task(taskId, userId, 'member');
    // The id is generated here (not by the database) because the storage key needs it.
    const id = uuidv7();
    const storageKey = `projects/${project.id}/tasks/${taskId}/${id}`;
    await this.attachments.insert({
      id,
      taskId,
      uploaderId: userId,
      storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: await loadAttachment(this.dataSource.manager, id),
      upload: {
        url,
        method: 'PUT',
        headers: { 'Content-Type': input.contentType },
        expiresAt: expiresAt(UPLOAD_URL_TTL),
      },
    };
  }

  async complete(attachmentId: string, userId: string) {
    const { attachment, project } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId) {
      throw forbidden('Only the uploader can complete an upload');
    }
    if (attachment.status === 'ready') return loadAttachment(this.dataSource.manager, attachmentId);
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (size !== attachment.sizeBytes) throw conflict('The uploaded file size does not match');
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Attachment, { id: attachmentId }, { status: 'ready' });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return loadAttachment(manager, attachmentId);
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
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Attachment, { id: attachmentId });
      await this.activity.record(manager, {
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
