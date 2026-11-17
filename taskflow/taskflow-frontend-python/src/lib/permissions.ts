import type { InvitableRole, Role } from '@/lib/api/types';

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export const atLeast = (role: Role, minimum: Role) => RANK[role] >= RANK[minimum];

/**
 * The README §5 RBAC table, from the UI's side. These only decide what to SHOW; the server
 * re-checks every request, so a tampered client gains nothing.
 */
export const can = {
  editTasks: (role: Role) => atLeast(role, 'member'),
  comment: (role: Role) => atLeast(role, 'member'),
  manageProjects: (role: Role) => atLeast(role, 'admin'),
  invite: (role: Role) => atLeast(role, 'admin'),
  invitableRoles: (role: Role): InvitableRole[] =>
    role === 'owner' ? ['admin', 'member', 'viewer'] : role === 'admin' ? ['member', 'viewer'] : [],
  /** Roles `actor` may set on someone currently holding `target`. Empty = no control. */
  assignableRoles: (actor: Role, target: Role): Role[] => {
    if (actor === 'owner') return ['owner', 'admin', 'member', 'viewer'];
    if (actor === 'admin' && !atLeast(target, 'admin')) return ['member', 'viewer'];
    return [];
  },
  removeMember: (actor: Role, target: Role) =>
    actor === 'owner' || (actor === 'admin' && !atLeast(target, 'admin')),
};
