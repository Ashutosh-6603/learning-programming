import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { projects, tasks, workspaceMembers } from '../../db/schema.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from './access.js';
import type { Role } from './roles.js';
import { toMember } from './workspaces.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

export class MembersService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.workspaceMembers.findMany({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        after ? gt(workspaceMembers.id, after) : undefined,
      ),
      orderBy: asc(workspaceMembers.id),
      limit: limit + 1,
      with: { user: { columns: userSummaryColumns } },
    });
    return toPage(rows, limit, toMember, (m) => ({ id: m.id }));
  }

  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.db.transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const from = target.role;
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx
        .update(workspaceMembers)
        .set({ role: newRole })
        .where(eq(workspaceMembers.id, target.id));
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return this.findTarget(tx, workspaceId, targetUserId);
    });
    return toMember(updated);
  }

  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.db.transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(target.role));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (target.role === 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx.delete(workspaceMembers).where(eq(workspaceMembers.id, target.id));
      // A subquery inside IN (…): every project of this workspace, in one statement.
      await tx
        .update(tasks)
        .set({ assigneeId: null })
        .where(
          and(
            eq(tasks.assigneeId, targetUserId),
            inArray(
              tasks.projectId,
              tx
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.workspaceId, workspaceId)),
            ),
          ),
        );
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.removed',
        data: { userId: targetUserId },
      });
    });
  }

  private async findTarget(tx: Db, workspaceId: string, userId: string) {
    const target = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
      with: { user: { columns: userSummaryColumns } },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first, so two owners demoting each other at the same
   * time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(tx: Db, workspaceId: string) {
    const owners = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')))
      .for('update');
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
