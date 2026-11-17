import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { projects, workspaceMembers, workspaces } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from './access.js';
import { toWorkspace } from './workspaces.dto.js';

export class WorkspacesService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const rows = await this.db.query.workspaceMembers.findMany({
      where: and(
        eq(workspaceMembers.userId, userId),
        after ? lt(workspaceMembers.workspaceId, after) : undefined,
      ),
      orderBy: desc(workspaceMembers.workspaceId),
      limit: limit + 1,
      with: { workspace: true },
    });
    return toPage(
      rows,
      limit,
      (m) => toWorkspace(m.workspace, m.role),
      (m) => ({ id: m.workspaceId }),
    );
  }

  async create(userId: string, input: { name: string; slug: string }) {
    try {
      const workspace = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workspaces)
          .values({ ...input, createdBy: userId })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: created.id, userId, role: 'owner' });
        await this.activity.record(tx, {
          workspaceId: created.id,
          actorId: userId,
          type: 'workspace.created',
          data: { name: created.name },
        });
        return created;
      });
      return toWorkspace(workspace, 'owner');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }

  async get(workspaceId: string, userId: string) {
    const membership = await this.access.member(workspaceId, userId);
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    if (!workspace) throw notFound('Workspace');
    return toWorkspace(workspace, membership.role);
  }

  async update(
    workspaceId: string,
    userId: string,
    input: { name?: string | undefined; slug?: string | undefined },
  ) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(workspaces)
          .set(input)
          .where(eq(workspaces.id, workspaceId))
          .returning();
        if (!updated) throw notFound('Workspace');
        await this.activity.record(tx, {
          workspaceId,
          actorId: userId,
          type: 'workspace.updated',
          data: { ...input },
        });
        return updated;
      });
      return toWorkspace(workspace, membership.role);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }

  async delete(workspaceId: string, userId: string) {
    await this.access.member(workspaceId, userId, 'owner');
    const owned = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    for (const p of owned) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
