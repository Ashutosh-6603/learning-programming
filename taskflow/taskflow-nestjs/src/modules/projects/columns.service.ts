import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan, Not, type EntityManager } from 'typeorm';
import { keyBetween } from '../../common/fractional-index.js';
import { isForeignKeyViolation, retryOnPositionConflict } from '../../common/pg-errors.js';
import { conflict, invalid, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { RealtimePublisher, type ServerEventType } from '../realtime/realtime.publisher.js';
import { BoardCache } from './board-cache.js';
import { toColumn } from './project.dto.js';

@Injectable()
export class ColumnsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: { name: string; wipLimit?: number | null },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const column = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const last = await manager.findOne(BoardColumn, {
          where: { projectId },
          order: { position: 'DESC' },
        });
        const created = await manager.save(
          manager.create(BoardColumn, {
            projectId,
            name: input.name,
            wipLimit: input.wipLimit ?? null,
            position: keyBetween(last?.position ?? null, null),
          }),
        );
        await this.activity.record(manager, {
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
    input: { name?: string; wipLimit?: number | null },
  ) {
    const { project } = await this.access.column(columnId, userId, 'admin');
    const column = await this.dataSource.transaction(async (manager) => {
      await manager.update(BoardColumn, { id: columnId }, input);
      const row = await manager.findOneBy(BoardColumn, { id: columnId });
      if (!row) throw notFound('Column');
      await this.activity.record(manager, {
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
    if (afterColumnId === columnId) {
      throw invalid('afterColumnId', 'cannot place a column after itself');
    }
    const moved = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const position = await this.positionAfter(
          manager,
          column.projectId,
          columnId,
          afterColumnId,
        );
        await manager.update(BoardColumn, { id: columnId }, { position });
        const row = await manager.findOneBy(BoardColumn, { id: columnId });
        if (!row) throw notFound('Column');
        await this.activity.record(manager, {
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
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(BoardColumn, { id: columnId });
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.deleted',
          data: { columnId, name: column.name },
        });
      });
    } catch (err) {
      // tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
      if (isForeignKeyViolation(err)) {
        throw conflict('Move or delete the tasks in this column first');
      }
      throw err;
    }
    await this.afterWrite(project.id, 'column.deleted', { id: columnId, projectId: project.id });
  }

  private async positionAfter(
    manager: EntityManager,
    projectId: string,
    columnId: string,
    afterId: string | null,
  ) {
    let lower: string | null = null;
    if (afterId !== null) {
      const after = await manager.findOneBy(BoardColumn, { id: afterId });
      if (after?.projectId !== projectId) {
        throw invalid('afterColumnId', 'must be a column of the same project');
      }
      lower = after.position;
    }
    const next = await manager.findOne(BoardColumn, {
      where: {
        projectId,
        id: Not(columnId),
        ...(lower !== null ? { position: MoreThan(lower) } : {}),
      },
      order: { position: 'ASC' },
    });
    return keyBetween(lower, next?.position ?? null);
  }

  private async afterWrite<T>(projectId: string, type: ServerEventType, payload: T) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
