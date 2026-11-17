import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { boardColumns, projects, tasks } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { taskWith, toColumn, toProject, toTask, type BoardDto } from './projects.dto.js';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

export class ProjectsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.projects.findMany({
      where: and(eq(projects.workspaceId, workspaceId), after ? lt(projects.id, after) : undefined),
      orderBy: desc(projects.id),
      limit: limit + 1,
    });
    return toPage(rows, limit, toProject, (p) => ({ id: p.id }));
  }

  async create(
    workspaceId: string,
    userId: string,
    input: { name: string; key: string; description?: string | null | undefined },
  ) {
    await this.access.member(workspaceId, userId, 'admin');
    try {
      const project = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(projects)
          .values({
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            createdBy: userId,
          })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        let position: string | null = null;
        for (const name of DEFAULT_COLUMNS) {
          position = keyBetween(position, null);
          await tx.insert(boardColumns).values({ projectId: created.id, name, position });
        }
        await this.activity.record(tx, {
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
    input: { name?: string | undefined; description?: string | null | undefined },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set(input)
        .where(eq(projects.id, projectId))
        .returning();
      if (!row) throw notFound('Project');
      await this.activity.record(tx, {
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
    await this.db.transaction(async (tx) => {
      await tx.delete(projects).where(eq(projects.id, projectId));
      await this.activity.record(tx, {
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
      const [columns, taskRows] = await Promise.all([
        this.db.query.boardColumns.findMany({
          where: eq(boardColumns.projectId, projectId),
          orderBy: asc(boardColumns.position),
        }),
        this.db.query.tasks.findMany({
          where: eq(tasks.projectId, projectId),
          orderBy: asc(tasks.position),
          with: taskWith,
        }),
      ]);
      const byColumn = Map.groupBy(taskRows.map(toTask), (t) => t.columnId);
      return {
        project: toProject(project),
        columns: columns.map((c) => ({ ...toColumn(c), tasks: byColumn.get(c.id) ?? [] })),
      };
    });
  }
}
