import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { boardColumns, projects, tasks, workspaceMembers } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { retryOnPositionConflict } from '../../lib/pg-errors.js';
import { invalid, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { BoardCache } from '../projects/board-cache.js';
import { taskWith, toTask, type TaskDto } from '../projects/projects.dto.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';

export type Priority = TaskDto['priority'];

export interface TaskFilters {
  columnId?: string | undefined;
  assigneeId?: string | undefined;
  priority?: Priority | undefined;
  dueBefore?: string | undefined;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  columnId?: string | undefined;
  priority: Priority;
  assigneeId?: string | null | undefined;
  dueAt?: string | null | undefined;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

/** ISO-8601 string from the wire → Date for Postgres; null and undefined pass through. */
function toDate<T extends null | undefined>(value: string | T): Date | T {
  return typeof value === 'string' ? new Date(value) : value;
}

async function loadTask(db: Db, id: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id), with: taskWith });
  if (!task) throw notFound('Task');
  return task;
}

export class TasksService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
    private readonly jobs: Jobs,
  ) {}

  async list(
    projectId: string,
    userId: string,
    filters: TaskFilters,
    limit: number,
    cursor?: string,
  ) {
    await this.access.project(projectId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const { columnId, assigneeId, priority, dueBefore } = filters;
    const rows = await this.db.query.tasks.findMany({
      where: and(
        eq(tasks.projectId, projectId),
        columnId ? eq(tasks.columnId, columnId) : undefined,
        assigneeId === 'none' ? isNull(tasks.assigneeId) : undefined,
        assigneeId && assigneeId !== 'none' ? eq(tasks.assigneeId, assigneeId) : undefined,
        priority ? eq(tasks.priority, priority) : undefined,
        dueBefore ? lt(tasks.dueAt, new Date(dueBefore)) : undefined,
        after ? lt(tasks.id, after) : undefined,
      ),
      orderBy: desc(tasks.id),
      limit: limit + 1,
      with: taskWith,
    });
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(await loadTask(this.db, taskId));
  }

  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const [counter] = await tx
          .update(projects)
          .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
          .where(eq(projects.id, projectId))
          .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
        const columnId = await this.resolveColumn(tx, projectId, input.columnId);
        const last = await tx.query.tasks.findFirst({
          where: eq(tasks.columnId, columnId),
          orderBy: desc(tasks.position),
        });
        const [created] = await tx
          .insert(tasks)
          .values({
            projectId,
            columnId,
            number: counter?.number ?? 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority,
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: toDate(input.dueAt) ?? null,
            position: keyBetween(last?.position ?? null, null),
          })
          .returning({ id: tasks.id, number: tasks.number, title: tasks.title });
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
        return loadTask(tx, created.id);
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }

  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);
    const values = { ...input, dueAt: toDate(input.dueAt) };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = values[field];
      if (to === undefined) continue;
      const from = before[field];
      const same =
        from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
      if (!same)
        changes[field] = {
          from: from instanceof Date ? from.toISOString() : from,
          to: to instanceof Date ? to.toISOString() : to,
        };
    }

    const task = await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ ...values, ...('dueAt' in changes ? { reminderSentAt: null } : {}) })
        .where(eq(tasks.id, taskId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes },
      });
      return loadTask(tx, taskId);
    });
    return this.afterWrite(project.id, 'task.updated', toTask(task));
  }

  async move(
    taskId: string,
    userId: string,
    input: { columnId: string; afterTaskId: string | null },
  ) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.afterTaskId === taskId)
      throw invalid('afterTaskId', 'cannot place a task after itself');

    const task = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        const column = await tx.query.boardColumns.findFirst({
          where: eq(boardColumns.id, input.columnId),
        });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await tx.query.tasks.findFirst({
            where: eq(tasks.id, input.afterTaskId),
          });
          if (after?.columnId !== input.columnId)
            throw invalid('afterTaskId', 'must be a task in the target column');
          lower = after.position;
        }
        const next = await tx.query.tasks.findFirst({
          where: and(
            eq(tasks.columnId, input.columnId),
            ne(tasks.id, taskId),
            lower !== null ? gt(tasks.position, lower) : undefined,
          ),
          orderBy: asc(tasks.position),
        });
        await tx
          .update(tasks)
          .set({ columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) })
          .where(eq(tasks.id, taskId));
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return loadTask(tx, taskId);
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.db.transaction(async (tx) => {
      await tx.delete(tasks).where(eq(tasks.id, taskId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.deleted',
        data: { key: `${project.key}-${task.number}`, title: task.title },
      });
    });
    await this.afterWrite(project.id, 'task.deleted', {
      id: taskId,
      projectId: project.id,
      columnId: task.columnId,
    });
    await this.jobs.enqueue('delete-storage-prefix', {
      prefix: `projects/${project.id}/tasks/${taskId}/`,
    });
  }

  private async resolveColumn(tx: Db, projectId: string, columnId: string | undefined) {
    if (columnId === undefined) {
      const first = await tx.query.boardColumns.findFirst({
        where: eq(boardColumns.projectId, projectId),
        orderBy: asc(boardColumns.position),
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await tx.query.boardColumns.findFirst({ where: eq(boardColumns.id, columnId) });
    if (column?.projectId !== projectId)
      throw invalid('columnId', 'must be a column of this project');
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const member = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, assigneeId),
      ),
    });
    if (!member) throw invalid('assigneeId', 'must be a member of the workspace');
  }

  private async afterWrite<T extends TaskDto | { id: string }>(
    projectId: string,
    type: ServerEventType,
    payload: T,
  ) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
