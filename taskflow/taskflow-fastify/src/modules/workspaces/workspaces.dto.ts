import { Type, type Static } from 'typebox';
import { Id, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { InvitableRoleSchema, RoleSchema, type Role } from './roles.js';

export const Workspace = Type.Object({
  id: Id,
  name: Type.String(),
  slug: Type.String(),
  currentUserRole: RoleSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Member = Type.Object({ user: UserSummary, role: RoleSchema, joinedAt: Timestamp });

export const Invitation = Type.Object({
  id: Id,
  workspaceId: Id,
  email: Type.String(),
  role: InvitableRoleSchema,
  invitedBy: UserSummary,
  expiresAt: Timestamp,
  createdAt: Timestamp,
});

export const toWorkspace = (
  w: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date },
  role: Role,
): Static<typeof Workspace> => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

export const toMember = (m: {
  user: UserSummaryDto;
  role: Role;
  joinedAt: Date;
}): Static<typeof Member> => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});

export const toInvitation = (i: {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  inviter: UserSummaryDto;
  expiresAt: Date;
  createdAt: Date;
}): Static<typeof Invitation> => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  role: i.role,
  invitedBy: toUserSummary(i.inviter),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
