import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { activityEvents } from '../../db/schema.js';
import { userSummaryColumns } from '../users/users.repository.js';

export type ActivityType =
  | 'workspace.created'
  | 'workspace.updated'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.moved'
  | 'column.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'attachment.added'
  | 'attachment.deleted';

export interface ActivityInput {
  workspaceId: string;
  actorId: string;
  type: ActivityType;
  projectId?: string | null;
  taskId?: string | null;
  data?: Record<string, unknown>;
}

/** Append-only: there is deliberately no update or delete method. */
export class ActivityRepository {
  /** Takes `db` per call so it can join the caller's transaction. */
  async record(db: Db, event: ActivityInput): Promise<void> {
    await db.insert(activityEvents).values({
      workspaceId: event.workspaceId,
      actorId: event.actorId,
      type: event.type,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      data: event.data ?? {},
    });
  }

  list(
    db: Db,
    filter: { workspaceId: string; projectId?: string | undefined; taskId?: string | undefined },
    page: { limit: number; afterId?: string | undefined },
  ) {
    return db.query.activityEvents.findMany({
      // and() skips undefined conditions, so optional filters need no branching.
      where: and(
        eq(activityEvents.workspaceId, filter.workspaceId),
        filter.projectId ? eq(activityEvents.projectId, filter.projectId) : undefined,
        filter.taskId ? eq(activityEvents.taskId, filter.taskId) : undefined,
        page.afterId ? lt(activityEvents.id, page.afterId) : undefined,
      ),
      orderBy: desc(activityEvents.id),
      limit: page.limit + 1,
      with: { actor: { columns: userSummaryColumns } },
    });
  }
}
