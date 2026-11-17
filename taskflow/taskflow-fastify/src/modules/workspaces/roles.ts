import { Type } from 'typebox';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = Type.Enum(ROLES);
export const InvitableRoleSchema = Type.Enum(['admin', 'member', 'viewer']);

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
