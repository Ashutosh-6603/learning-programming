import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);
export const InvitableRoleSchema = z.enum(['admin', 'member', 'viewer']);

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function asRole(value: string): Role {
  return RoleSchema.parse(value);
}

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
