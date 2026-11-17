import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from './access.js';
import { asRole, type Role } from './roles.js';
import { toInvitation, toWorkspace } from './workspaces.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export class InvitationsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.invitation.findMany({
      where: { workspaceId, acceptedAt: null, ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { inviter: { select: userSummarySelect } },
    });
    return toPage(rows, limit, toInvitation, (i) => ({ id: i.id }));
  }

  async create(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: Exclude<Role, 'owner'> },
  ) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    if (input.role === 'admin' && actor.role !== 'owner') {
      throw forbidden('Only owners can invite admins');
    }
    const alreadyMember = await this.db.workspaceMember.findFirst({
      where: { workspaceId, user: { email: input.email } },
    });
    if (alreadyMember) throw conflict('This person is already a member');

    const token = randomBytes(32).toString('base64url');
    let invitation;
    try {
      invitation = await this.db.$transaction(async (tx) => {
        await tx.invitation.deleteMany({
          where: {
            workspaceId,
            email: input.email,
            acceptedAt: null,
            expiresAt: { lte: new Date() },
          },
        });
        const created = await tx.invitation.create({
          data: {
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          },
          include: { inviter: { select: userSummarySelect }, workspace: true },
        });
        await this.activity.record(tx, {
          workspaceId,
          actorId,
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('This email already has a pending invitation');
      }
      throw err;
    }

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
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.invitation.deleteMany({
        where: { id: invitationId, workspaceId, acceptedAt: null },
      });
      if (count === 0) throw notFound('Invitation');
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.db.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }

    const membership = await this.db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      });
      if (existing) return existing;
      const created = await tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      });
      await this.activity.record(tx, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        type: 'member.joined',
        data: { role: invitation.role },
      });
      return created;
    });
    return toWorkspace(invitation.workspace, asRole(membership.role));
  }
}
