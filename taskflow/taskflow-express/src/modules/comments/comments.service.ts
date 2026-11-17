import type { PrismaClient } from '../../generated/prisma/client.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { forbidden } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const toComment = (c: {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const include = { author: { select: userSummarySelect } } as const;

export class CommentsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.comment.findMany({
      where: { taskId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      include,
    });
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }

  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { taskId, authorId: userId, body },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return toComment(created);
    });
    await this.realtime.publish(project.id, 'comment.created', { projectId: project.id, comment });
    return comment;
  }

  async update(commentId: string, userId: string, body: string) {
    const { comment, project } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId) throw forbidden('Only the author can edit a comment');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { body },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return toComment(updated);
    });
  }

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.db.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id: commentId } });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.deleted',
        data: { commentId },
      });
    });
  }
}
