import { and, asc, eq, gt } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import type { Database, Db } from '../../db/client.js';
import { comments } from '../../db/schema.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { Id, Timestamp } from '../../lib/schemas.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

export const Comment = Type.Object({
  id: Id,
  taskId: Id,
  author: UserSummary,
  body: Type.String(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

const toComment = (c: {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): Static<typeof Comment> => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const withAuthor = { author: { columns: userSummaryColumns } } as const;

async function loadComment(db: Db, id: string) {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: withAuthor,
  });
  if (!comment) throw notFound('Comment');
  return toComment(comment);
}

export class CommentsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.comments.findMany({
      where: and(eq(comments.taskId, taskId), after ? gt(comments.id, after) : undefined),
      orderBy: asc(comments.id),
      limit: limit + 1,
      with: withAuthor,
    });
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }

  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(comments)
        .values({ taskId, authorId: userId, body })
        .returning({ id: comments.id });
      if (!created) throw new Error('INSERT … RETURNING returned no row');
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return loadComment(tx, created.id);
    });
    await this.realtime.publish(project.id, 'comment.created', { projectId: project.id, comment });
    return comment;
  }

  async update(commentId: string, userId: string, body: string) {
    const { comment, project } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId) throw forbidden('Only the author can edit a comment');
    return this.db.transaction(async (tx) => {
      await tx.update(comments).set({ body }).where(eq(comments.id, commentId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return loadComment(tx, commentId);
    });
  }

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, commentId));
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
