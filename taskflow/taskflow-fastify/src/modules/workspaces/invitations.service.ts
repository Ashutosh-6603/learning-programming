import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { invitations, users, workspaceMembers } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from './access.js';
import type { Role } from './roles.js';
import { toInvitation, toWorkspace } from './workspaces.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const withInviter = { inviter: { columns: userSummaryColumns } } as const;

export class InvitationsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.invitations.findMany({
      where: and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        after ? lt(invitations.id, after) : undefined,
      ),
      orderBy: desc(invitations.id),
      limit: limit + 1,
      with: withInviter,
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
    const [alreadyMember] = await this.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, input.email)))
      .limit(1);
    if (alreadyMember) throw conflict('This person is already a member');

    const token = randomBytes(32).toString('base64url');
    let invitation;
    try {
      invitation = await this.db.transaction(async (tx) => {
        await tx
          .delete(invitations)
          .where(
            and(
              eq(invitations.workspaceId, workspaceId),
              eq(invitations.email, input.email),
              isNull(invitations.acceptedAt),
              lte(invitations.expiresAt, new Date()),
            ),
          );
        const [created] = await tx
          .insert(invitations)
          .values({
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          })
          .returning({ id: invitations.id });
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await this.activity.record(tx, {
          workspaceId,
          actorId,
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return tx.query.invitations.findFirst({
          where: eq(invitations.id, created.id),
          with: { ...withInviter, workspace: true },
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
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.workspaceId, workspaceId),
            isNull(invitations.acceptedAt),
          ),
        )
        .returning({ id: invitations.id });
      if (deleted.length === 0) throw notFound('Invitation');
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, sha256(token)),
      with: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (user?.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }

    const role = await this.db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      const existing = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, invitation.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      });
      if (existing) return existing.role;
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: invitation.workspaceId, userId, role: invitation.role });
      await this.activity.record(tx, {
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
