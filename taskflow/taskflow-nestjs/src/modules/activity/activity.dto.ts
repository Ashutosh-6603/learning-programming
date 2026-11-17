import { PageQueryDto } from '../../common/page-query.dto.js';
import { IsId, IsOmittable } from '../../common/validation/decorators.js';
import type { ActivityEvent } from '../../database/entities/activity-event.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class ActivityQueryDto extends PageQueryDto {
  @IsOmittable()
  @IsId()
  projectId?: string;

  @IsOmittable()
  @IsId()
  taskId?: string;
}

export class ActivityEventDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  actor: UserSummaryDto;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export const toActivityEvent = (e: ActivityEvent): ActivityEventDto => ({
  id: e.id,
  workspaceId: e.workspaceId,
  projectId: e.projectId,
  taskId: e.taskId,
  actor: toUserSummary(e.actor),
  type: e.type,
  data: e.data as Record<string, unknown>,
  createdAt: e.createdAt.toISOString(),
});
