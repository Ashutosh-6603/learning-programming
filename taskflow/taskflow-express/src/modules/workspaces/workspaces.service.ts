import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { conflict } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from './access.js';
import { asRole } from './roles.js';
import { toWorkspace } from './workspaces.dto.js';

export class WorkspacesService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const rows = await this.db.workspaceMember.findMany({
      where: { userId, ...(after ? { workspaceId: { lt: after } } : {}) },
      orderBy: { workspaceId: 'desc' },
      take: limit + 1,
      include: { workspace: true },
    });
    return toPage(
      rows,
      limit,
      (m) => toWorkspace(m.workspace, asRole(m.role)),
      (m) => ({ id: m.workspaceId }),
    );
  }

  async create(userId: string, input: { name: string; slug: string }) {
    try {
      const workspace = await this.db.$transaction(async (tx) => {
        const created = await tx.workspace.create({ data: { ...input, createdBy: userId } });
        await tx.workspaceMember.create({
          data: { workspaceId: created.id, userId, role: 'owner' },
        });
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
    const workspace = await this.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return toWorkspace(workspace, membership.role);
  }

  async update(workspaceId: string, userId: string, input: { name?: string; slug?: string }) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.db.$transaction(async (tx) => {
        const updated = await tx.workspace.update({ where: { id: workspaceId }, data: input });
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
    const projects = await this.db.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    await this.db.workspace.delete({ where: { id: workspaceId } });
    for (const p of projects) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
