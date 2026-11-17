import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Db } from '../../infra/db.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from './access.js';
import { asRole, type Role } from './roles.js';
import { toMember } from './workspaces.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

export class MembersService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.workspaceMember.findMany({
      where: { workspaceId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { user: { select: userSummarySelect } },
    });
    return toPage(
      rows,
      limit,
      (m) => toMember({ ...m, role: asRole(m.role) }),
      (m) => ({ id: m.id }),
    );
  }

  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.db.$transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const from = asRole(target.role);
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') await this.assertNotLastOwner(tx, workspaceId);
      const row = await tx.workspaceMember.update({
        where: { id: target.id },
        data: { role: newRole },
        include: { user: { select: userSummarySelect } },
      });
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return row;
    });
    return toMember({ ...updated, role: asRole(updated.role) });
  }

  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.db.$transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const targetRole = asRole(target.role);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(targetRole));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (targetRole === 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx.workspaceMember.delete({ where: { id: target.id } });
      await tx.task.updateMany({
        where: { assigneeId: targetUserId, project: { workspaceId } },
        data: { assigneeId: null },
      });
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.removed',
        data: { userId: targetUserId },
      });
    });
  }

  private async findTarget(tx: Db, workspaceId: string, userId: string) {
    const target = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first, so two owners demoting each other at the same
   * time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(tx: Db, workspaceId: string) {
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM workspace_members
      WHERE workspace_id = ${workspaceId}::uuid AND role = 'owner'
      FOR UPDATE`;
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
