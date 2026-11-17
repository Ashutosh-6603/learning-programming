import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { AccessService } from '../access/access.service.js';
import type { Role } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toMember } from './workspace.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

@Injectable()
export class MembersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.members
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.user', 'user')
      .where('member.workspaceId = :workspaceId', { workspaceId });
    const rows = await keyset(query, 'member.id', 'ASC', limit, after);
    return toPage(rows, limit, toMember, (m) => ({ id: m.id }));
  }

  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.dataSource.transaction(async (manager) => {
      const target = await this.findTarget(manager, workspaceId, targetUserId);
      const from = target.role;
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') {
        await this.assertNotLastOwner(manager, workspaceId);
      }
      await manager.update(WorkspaceMember, { id: target.id }, { role: newRole });
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return this.findTarget(manager, workspaceId, targetUserId);
    });
    return toMember(updated);
  }

  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.dataSource.transaction(async (manager) => {
      const target = await this.findTarget(manager, workspaceId, targetUserId);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(target.role));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (target.role === 'owner') await this.assertNotLastOwner(manager, workspaceId);
      await manager.delete(WorkspaceMember, { id: target.id });
      // A subquery inside IN (…): every project of this workspace, in one statement.
      await manager
        .createQueryBuilder()
        .update(Task)
        .set({ assigneeId: null })
        .where('assignee_id = :targetUserId', { targetUserId })
        .andWhere('project_id IN (SELECT id FROM projects WHERE workspace_id = :workspaceId)', {
          workspaceId,
        })
        .execute();
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'member.removed',
        data: { userId: targetUserId },
      });
    });
  }

  private async findTarget(manager: EntityManager, workspaceId: string, userId: string) {
    const target = await manager.findOne(WorkspaceMember, {
      where: { workspaceId, userId },
      relations: { user: true },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first (SELECT … FOR UPDATE), so two owners demoting each other at
   * the same time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(manager: EntityManager, workspaceId: string) {
    const owners = await manager.find(WorkspaceMember, {
      where: { workspaceId, role: 'owner' },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
