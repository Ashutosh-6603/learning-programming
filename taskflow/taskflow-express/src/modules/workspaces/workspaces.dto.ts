import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import type { Role } from './roles.js';

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  currentUserRole: Role;
  createdAt: string;
  updatedAt: string;
}

export const toWorkspace = (
  w: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date },
  role: Role,
): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

export const toMember = (m: { user: UserSummaryDto; role: Role; joinedAt: Date }) => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});

export const toInvitation = (i: {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  inviter: UserSummaryDto;
  expiresAt: Date;
  createdAt: Date;
}) => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  role: i.role,
  invitedBy: toUserSummary(i.inviter),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
