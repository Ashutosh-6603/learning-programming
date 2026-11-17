import { Type, type Static } from 'typebox';
import type { Database } from '../../db/client.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { Id, Nullable, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary } from '../users/users.dto.js';
import type { Access } from '../workspaces/access.js';
import type { ActivityRepository } from './activity.repository.js';

export const ActivityEvent = Type.Object({
  id: Id,
  workspaceId: Id,
  projectId: Nullable(Id),
  taskId: Nullable(Id),
  actor: UserSummary,
  type: Type.String(),
  data: Type.Object({}, { additionalProperties: true }),
  createdAt: Timestamp,
});

export class ActivityService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    filter: { projectId?: string | undefined; taskId?: string | undefined },
    limit: number,
    cursor?: string,
  ) {
    await this.access.member(workspaceId, userId);
    const afterId = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.activity.list(this.db, { workspaceId, ...filter }, { limit, afterId });
    return toPage(
      rows,
      limit,
      (e): Static<typeof ActivityEvent> => ({
        id: e.id,
        workspaceId: e.workspaceId,
        projectId: e.projectId,
        taskId: e.taskId,
        actor: toUserSummary(e.actor),
        type: e.type,
        data: e.data,
        createdAt: e.createdAt.toISOString(),
      }),
      (e) => ({ id: e.id }),
    );
  }
}
