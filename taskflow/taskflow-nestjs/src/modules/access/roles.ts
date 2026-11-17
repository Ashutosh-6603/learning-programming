export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
