import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import type { Db } from '../../infra/db.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { retryOnPositionConflict } from '../../lib/prisma-errors.js';
import { invalid } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { BoardCache } from '../projects/board-cache.js';
import { taskInclude, toTask, type TaskDto } from '../projects/projects.dto.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskFilters {
  columnId?: string | undefined;
  assigneeId?: string | undefined;
  priority?: Priority | undefined;
  dueBefore?: Date | undefined;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  columnId?: string | undefined;
  priority: Priority;
  assigneeId?: string | null | undefined;
  dueAt?: Date | null | undefined;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

export class TasksService {
  constructor(
    private readonly db: PrismaClient,
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
    const where: Prisma.TaskWhereInput = {
      projectId,
      ...(filters.columnId ? { columnId: filters.columnId } : {}),
      ...(filters.assigneeId
        ? { assigneeId: filters.assigneeId === 'none' ? null : filters.assigneeId }
        : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.dueBefore ? { dueAt: { lt: filters.dueBefore } } : {}),
      ...(after ? { id: { lt: after } } : {}),
    };
    const rows = await this.db.task.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: taskInclude,
    });
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(
      await this.db.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude }),
    );
  }

  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.db.$transaction(async (tx) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const [counter] = await tx.$queryRaw<{ number: number }[]>`
          UPDATE projects SET next_task_number = next_task_number + 1
          WHERE id = ${projectId}::uuid
          RETURNING next_task_number - 1 AS number`;
        const columnId = await this.resolveColumn(tx, projectId, input.columnId);
        const last = await tx.task.findFirst({
          where: { columnId },
          orderBy: { position: 'desc' },
        });
        const created = await tx.task.create({
          data: {
            projectId,
            columnId,
            number: counter?.number ?? 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority,
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: input.dueAt ?? null,
            position: keyBetween(last?.position ?? null, null),
          },
          include: taskInclude,
        });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
        return created;
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }

  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = input[field];
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

    const task = await this.db.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: { ...input, ...('dueAt' in changes ? { reminderSentAt: null } : {}) },
        include: taskInclude,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes } as Prisma.InputJsonObject,
      });
      return updated;
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
      this.db.$transaction(async (tx) => {
        const column = await tx.boardColumn.findUnique({ where: { id: input.columnId } });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await tx.task.findUnique({ where: { id: input.afterTaskId } });
          if (after?.columnId !== input.columnId)
            throw invalid('afterTaskId', 'must be a task in the target column');
          lower = after.position;
        }
        const next = await tx.task.findFirst({
          where: {
            columnId: input.columnId,
            id: { not: taskId },
            ...(lower !== null ? { position: { gt: lower } } : {}),
          },
          orderBy: { position: 'asc' },
        });
        const moved = await tx.task.update({
          where: { id: taskId },
          data: { columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) },
          include: taskInclude,
        });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return moved;
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.db.$transaction(async (tx) => {
      await tx.task.delete({ where: { id: taskId } });
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
      const first = await tx.boardColumn.findFirst({
        where: { projectId },
        orderBy: { position: 'asc' },
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await tx.boardColumn.findUnique({ where: { id: columnId } });
    if (column?.projectId !== projectId)
      throw invalid('columnId', 'must be a column of this project');
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const member = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
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
