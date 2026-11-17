import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyBetween } from '../../common/fractional-index.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { BoardCache } from './board-cache.js';
import { TASK_RELATIONS, toColumn, toProject, toTask, type BoardDto } from './project.dto.js';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(BoardColumn) private readonly columns: Repository<BoardColumn>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly cache: BoardCache,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.projects
      .createQueryBuilder('project')
      .where('project.workspaceId = :workspaceId', { workspaceId });
    const rows = await keyset(query, 'project.id', 'DESC', limit, after);
    return toPage(rows, limit, toProject, (p) => ({ id: p.id }));
  }

  async create(
    workspaceId: string,
    userId: string,
    input: { name: string; key: string; description?: string | null },
  ) {
    await this.access.member(workspaceId, userId, 'admin');
    try {
      const project = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Project, {
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            createdBy: userId,
          }),
        );
        let position: string | null = null;
        for (const name of DEFAULT_COLUMNS) {
          position = keyBetween(position, null);
          await manager.insert(BoardColumn, { projectId: created.id, name, position });
        }
        await this.activity.record(manager, {
          workspaceId,
          actorId: userId,
          projectId: created.id,
          type: 'project.created',
          data: { name: created.name, key: created.key },
        });
        return created;
      });
      return toProject(project);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('Project key is already used in this workspace');
      }
      throw err;
    }
  }

  async get(projectId: string, userId: string) {
    const { project } = await this.access.project(projectId, userId);
    return toProject(project);
  }

  async update(
    projectId: string,
    userId: string,
    input: { name?: string; description?: string | null },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const updated = await this.dataSource.transaction(async (manager) => {
      await manager.update(Project, { id: projectId }, input);
      const row = await manager.findOneBy(Project, { id: projectId });
      if (!row) throw notFound('Project');
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId,
        type: 'project.updated',
        data: { ...input },
      });
      return row;
    });
    await this.cache.invalidate(projectId);
    return toProject(updated);
  }

  async delete(projectId: string, userId: string) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Project, { id: projectId });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId,
        type: 'project.deleted',
        data: { name: project.name, key: project.key },
      });
    });
    await this.cache.invalidate(projectId);
    await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${projectId}/` });
  }

  async board(projectId: string, userId: string): Promise<BoardDto> {
    const { project } = await this.access.project(projectId, userId);
    return this.cache.getOrLoad(projectId, async () => {
      const [columns, tasks] = await Promise.all([
        this.columns.find({ where: { projectId }, order: { position: 'ASC' } }),
        this.tasks.find({
          where: { projectId },
          order: { position: 'ASC' },
          relations: TASK_RELATIONS,
        }),
      ]);
      const byColumn = Map.groupBy(tasks.map(toTask), (t) => t.columnId);
      return {
        project: toProject(project),
        columns: columns.map((c) => ({ ...toColumn(c), tasks: byColumn.get(c.id) ?? [] })),
      };
    });
  }
}
