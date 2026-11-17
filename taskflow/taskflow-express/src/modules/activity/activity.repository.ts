import type { Prisma } from '../../generated/prisma/client.js';
import type { Db } from '../../infra/db.js';
import { userSummarySelect } from '../users/users.repository.js';

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
  data?: Prisma.InputJsonObject;
}

/** Append-only: there is deliberately no update or delete method. */
export class ActivityRepository {
  /** Takes `db` per call so it can join the caller's transaction. */
  record(db: Db, event: ActivityInput) {
    return db.activityEvent.create({
      data: {
        workspaceId: event.workspaceId,
        actorId: event.actorId,
        type: event.type,
        projectId: event.projectId ?? null,
        taskId: event.taskId ?? null,
        data: event.data ?? {},
      },
    });
  }

  list(
    db: Db,
    filter: { workspaceId: string; projectId?: string | undefined; taskId?: string | undefined },
    page: { limit: number; afterId?: string | undefined },
  ) {
    return db.activityEvent.findMany({
      where: {
        workspaceId: filter.workspaceId,
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.taskId ? { taskId: filter.taskId } : {}),
        ...(page.afterId ? { id: { lt: page.afterId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: page.limit + 1,
      include: { actor: { select: userSummarySelect } },
    });
  }
}
