import { and, asc, desc, eq, gt, ne } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { boardColumns } from '../../db/schema.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isForeignKeyViolation, retryOnPositionConflict } from '../../lib/pg-errors.js';
import { conflict, invalid, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { toColumn } from './projects.dto.js';

export class ColumnsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: { name: string; wipLimit?: number | null | undefined },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const column = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        const last = await tx.query.boardColumns.findFirst({
          where: eq(boardColumns.projectId, projectId),
          orderBy: desc(boardColumns.position),
        });
        const [created] = await tx
          .insert(boardColumns)
          .values({
            projectId,
            name: input.name,
            wipLimit: input.wipLimit ?? null,
            position: keyBetween(last?.position ?? null, null),
          })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          type: 'column.created',
          data: { columnId: created.id, name: created.name },
        });
        return created;
      }),
    );
    return this.afterWrite(projectId, 'column.created', toColumn(column));
  }

  async update(
    columnId: string,
    userId: string,
    input: { name?: string | undefined; wipLimit?: number | null | undefined },
  ) {
    const { project } = await this.access.column(columnId, userId, 'admin');
    const column = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(boardColumns)
        .set(input)
        .where(eq(boardColumns.id, columnId))
        .returning();
      if (!row) throw notFound('Column');
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        type: 'column.updated',
        data: { columnId, ...input },
      });
      return row;
    });
    return this.afterWrite(project.id, 'column.updated', toColumn(column));
  }

  async move(columnId: string, userId: string, afterColumnId: string | null) {
    const { column, project } = await this.access.column(columnId, userId, 'admin');
    if (afterColumnId === columnId)
      throw invalid('afterColumnId', 'cannot place a column after itself');
    const moved = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        const position = await this.positionAfter(tx, column.projectId, columnId, afterColumnId);
        const [row] = await tx
          .update(boardColumns)
          .set({ position })
          .where(eq(boardColumns.id, columnId))
          .returning();
        if (!row) throw notFound('Column');
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.moved',
          data: { columnId, afterColumnId },
        });
        return row;
      }),
    );
    return this.afterWrite(project.id, 'column.moved', toColumn(moved));
  }

  async delete(columnId: string, userId: string) {
    const { column, project } = await this.access.column(columnId, userId, 'admin');
    try {
      await this.db.transaction(async (tx) => {
        await tx.delete(boardColumns).where(eq(boardColumns.id, columnId));
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.deleted',
          data: { columnId, name: column.name },
        });
      });
    } catch (err) {
      // tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
      if (isForeignKeyViolation(err))
        throw conflict('Move or delete the tasks in this column first');
      throw err;
    }
    await this.afterWrite(project.id, 'column.deleted', { id: columnId, projectId: project.id });
  }

  private async positionAfter(tx: Db, projectId: string, columnId: string, afterId: string | null) {
    let lower: string | null = null;
    if (afterId !== null) {
      const after = await tx.query.boardColumns.findFirst({ where: eq(boardColumns.id, afterId) });
      if (after?.projectId !== projectId) {
        throw invalid('afterColumnId', 'must be a column of the same project');
      }
      lower = after.position;
    }
    const next = await tx.query.boardColumns.findFirst({
      where: and(
        eq(boardColumns.projectId, projectId),
        ne(boardColumns.id, columnId),
        lower !== null ? gt(boardColumns.position, lower) : undefined,
      ),
      orderBy: asc(boardColumns.position),
    });
    return keyBetween(lower, next?.position ?? null);
  }

  private async afterWrite<T>(projectId: string, type: ServerEventType, payload: T) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
