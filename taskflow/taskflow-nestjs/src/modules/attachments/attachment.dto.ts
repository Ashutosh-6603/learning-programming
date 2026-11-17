import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Attachment, AttachmentStatus } from '../../database/entities/attachment.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class CreateAttachmentDto {
  // No slashes, backslashes or control characters (U+0000–U+001F).
  @IsString()
  @Length(1, 255)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^/\\\u0000-\u001f]+$/)
  fileName: string;

  @IsString()
  @Length(3, 127)
  @Matches(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/)
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  sizeBytes: number;
}

export class AttachmentDto {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  createdAt: string;
}

export class UploadTargetDto {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export class AttachmentUploadDto {
  attachment: AttachmentDto;
  upload: UploadTargetDto;
}

export class DownloadUrlDto {
  url: string;
  expiresAt: string;
}

export const toAttachment = (a: Attachment): AttachmentDto => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});
