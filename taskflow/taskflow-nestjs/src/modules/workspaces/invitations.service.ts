import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Invitation } from '../../database/entities/invitation.entity.js';
import { User } from '../../database/entities/user.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import type { InvitableRole } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toInvitation, toWorkspace } from './workspace.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.invitations
      .createQueryBuilder('invitation')
      .innerJoinAndSelect('invitation.inviter', 'inviter')
      .where('invitation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('invitation.acceptedAt IS NULL');
    const rows = await keyset(query, 'invitation.id', 'DESC', limit, after);
    return toPage(rows, limit, toInvitation, (i) => ({ id: i.id }));
  }

  async create(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: InvitableRole },
  ) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    if (input.role === 'admin' && actor.role !== 'owner') {
      throw forbidden('Only owners can invite admins');
    }
    const alreadyMember = await this.members.existsBy({
      workspaceId,
      user: { email: input.email },
    });
    if (alreadyMember) throw conflict('This person is already a member');

    const token = randomBytes(32).toString('base64url');
    let invitation: Invitation | null;
    try {
      invitation = await this.dataSource.transaction(async (manager) => {
        await manager.delete(Invitation, {
          workspaceId,
          email: input.email,
          acceptedAt: IsNull(),
          expiresAt: LessThanOrEqual(new Date()),
        });
        const created = await manager.save(
          manager.create(Invitation, {
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          }),
        );
        await this.activity.record(manager, {
          workspaceId,
          actorId,
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return manager.findOne(Invitation, {
          where: { id: created.id },
          relations: { inviter: true, workspace: true },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('This email already has a pending invitation');
      }
      throw err;
    }
    if (!invitation) throw notFound('Invitation');

    await this.jobs.enqueue('send-invitation-email', {
      email: invitation.email,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter.displayName,
      token,
    });
    return toInvitation(invitation);
  }

  async revoke(workspaceId: string, actorId: string, invitationId: string) {
    await this.access.member(workspaceId, actorId, 'admin');
    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.delete(Invitation, {
        id: invitationId,
        workspaceId,
        acceptedAt: IsNull(),
      });
      if (!affected) throw notFound('Invitation');
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: sha256(token) },
      relations: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.users.findOneBy({ id: userId });
    if (user?.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }

    const role = await this.dataSource.transaction(async (manager) => {
      await manager.update(Invitation, { id: invitation.id }, { acceptedAt: new Date() });
      const existing = await manager.findOneBy(WorkspaceMember, {
        workspaceId: invitation.workspaceId,
        userId,
      });
      if (existing) return existing.role;
      await manager.insert(WorkspaceMember, {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      });
      await this.activity.record(manager, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        type: 'member.joined',
        data: { role: invitation.role },
      });
      return invitation.role;
    });
    return toWorkspace(invitation.workspace, role);
  }
}
