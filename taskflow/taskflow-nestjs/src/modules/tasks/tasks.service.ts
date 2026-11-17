import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Not, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyBetween } from '../../common/fractional-index.js';
import { keyset } from '../../common/keyset.js';
import { retryOnPositionConflict } from '../../common/pg-errors.js';
import { invalid, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task, type Priority } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { BoardCache } from '../projects/board-cache.js';
import { TASK_RELATIONS, toTask, type TaskDto } from '../projects/project.dto.js';
import { RealtimePublisher, type ServerEventType } from '../realtime/realtime.publisher.js';

export interface TaskFilters {
  columnId?: string;
  assigneeId?: string;
  priority?: Priority;
  dueBefore?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  columnId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  dueAt?: string | null;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

/** ISO-8601 string from the wire → Date for Postgres; null and undefined pass through. */
function toDate<T extends null | undefined>(value: string | T): Date | T {
  return typeof value === 'string' ? new Date(value) : value;
}

async function loadTask(manager: EntityManager, id: string): Promise<Task> {
  const task = await manager.findOne(Task, { where: { id }, relations: TASK_RELATIONS });
  if (!task) throw notFound('Task');
  return task;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
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
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const { columnId, assigneeId, priority, dueBefore } = filters;
    const query = this.tasks
      .createQueryBuilder('task')
      .innerJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .innerJoinAndSelect('task.reporter', 'reporter')
      .where('task.projectId = :projectId', { projectId });
    // Named parameters (:columnId) are sent separately from the SQL text, like $1 in raw SQL.
    if (columnId) query.andWhere('task.columnId = :columnId', { columnId });
    if (assigneeId === 'none') query.andWhere('task.assigneeId IS NULL');
    else if (assigneeId) query.andWhere('task.assigneeId = :assigneeId', { assigneeId });
    if (priority) query.andWhere('task.priority = :priority', { priority });
    if (dueBefore) query.andWhere('task.dueAt < :dueBefore', { dueBefore: new Date(dueBefore) });
    const rows = await keyset(query, 'task.id', 'DESC', limit, after);
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(await loadTask(this.dataSource.manager, taskId));
  }

  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const counter = await manager
          .createQueryBuilder()
          .update(Project)
          .set({ nextTaskNumber: () => 'next_task_number + 1' })
          .where('id = :projectId', { projectId })
          .returning('next_task_number')
          .execute();
        const [row] = counter.raw as { next_task_number: number }[];
        const columnId = await this.resolveColumn(manager, projectId, input.columnId);
        const last = await manager.findOne(Task, {
          where: { columnId },
          order: { position: 'DESC' },
        });
        const created = await manager.save(
          manager.create(Task, {
            projectId,
            columnId,
            number: row ? row.next_task_number - 1 : 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'medium',
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: toDate(input.dueAt) ?? null,
            position: keyBetween(last?.position ?? null, null),
          }),
        );
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
        return loadTask(manager, created.id);
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }

  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);
    const values = { ...input, ...('dueAt' in input ? { dueAt: toDate(input.dueAt) } : {}) };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = values[field];
      if (to === undefined) continue;
      const from = before[field];
      const same =
        from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
      if (!same) {
        changes[field] = {
          from: from instanceof Date ? from.toISOString() : from,
          to: to instanceof Date ? to.toISOString() : to,
        };
      }
    }

    const task = await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Task,
        { id: taskId },
        { ...values, ...('dueAt' in changes ? { reminderSentAt: null } : {}) },
      );
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes },
      });
      return loadTask(manager, taskId);
    });
    return this.afterWrite(project.id, 'task.updated', toTask(task));
  }

  async move(
    taskId: string,
    userId: string,
    input: { columnId: string; afterTaskId: string | null },
  ) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.afterTaskId === taskId) {
      throw invalid('afterTaskId', 'cannot place a task after itself');
    }

    const task = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const column = await manager.findOneBy(BoardColumn, { id: input.columnId });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await manager.findOneBy(Task, { id: input.afterTaskId });
          if (after?.columnId !== input.columnId) {
            throw invalid('afterTaskId', 'must be a task in the target column');
          }
          lower = after.position;
        }
        const next = await manager.findOne(Task, {
          where: {
            columnId: input.columnId,
            id: Not(taskId),
            ...(lower !== null ? { position: MoreThan(lower) } : {}),
          },
          order: { position: 'ASC' },
        });
        await manager.update(
          Task,
          { id: taskId },
          { columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) },
        );
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return loadTask(manager, taskId);
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Task, { id: taskId });
      await this.activity.record(manager, {
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

  private async resolveColumn(
    manager: EntityManager,
    projectId: string,
    columnId: string | undefined,
  ) {
    if (columnId === undefined) {
      const first = await manager.findOne(BoardColumn, {
        where: { projectId },
        order: { position: 'ASC' },
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await manager.findOneBy(BoardColumn, { id: columnId });
    if (column?.projectId !== projectId) {
      throw invalid('columnId', 'must be a column of this project');
    }
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const isMember = await this.members.existsBy({ workspaceId, userId: assigneeId });
    if (!isMember) throw invalid('assigneeId', 'must be a member of the workspace');
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
