import { IsEmail, IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsOmittable, ToLowerCase, Trim } from '../../common/validation/decorators.js';
import type { Invitation } from '../../database/entities/invitation.entity.js';
import type { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import type { Workspace } from '../../database/entities/workspace.entity.js';
import { INVITABLE_ROLES, ROLES, type InvitableRole, type Role } from '../access/roles.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateWorkspaceDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  name: string;

  @IsString()
  @Length(3, 40)
  @Matches(SLUG)
  slug: string;
}

export class UpdateWorkspaceDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOmittable()
  @IsString()
  @Length(3, 40)
  @Matches(SLUG)
  slug?: string;
}

export class UpdateMemberDto {
  @IsIn(ROLES)
  role: Role;
}

export class CreateInvitationDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsIn(INVITABLE_ROLES)
  role: InvitableRole;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(1, 128)
  token: string;
}

export class WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  currentUserRole: Role;
  createdAt: string;
  updatedAt: string;
}

export class MemberDto {
  user: UserSummaryDto;
  role: Role;
  joinedAt: string;
}

export class InvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableRole;
  invitedBy: UserSummaryDto;
  expiresAt: string;
  createdAt: string;
}

export const toWorkspace = (w: Workspace, role: Role): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

export const toMember = (m: WorkspaceMember): MemberDto => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});

export const toInvitation = (i: Invitation): InvitationDto => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  role: i.role,
  invitedBy: toUserSummary(i.inviter),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
