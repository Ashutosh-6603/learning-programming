import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import type { InvitableRole } from '../../modules/access/roles.js';
import { CreatedAt, Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('invitations')
@Index('invitations_token_hash_key', ['tokenHash'], { unique: true })
@Index('invitations_pending_email_uq', ['workspaceId', 'email'], {
  unique: true,
  where: 'accepted_at IS NULL',
})
@Index('invitations_workspace_idx', ['workspaceId', 'id'], { where: 'accepted_at IS NULL' })
@Check('invitations_email_check', 'email = lower(email)')
@Check('invitations_role_check', `role IN ('admin', 'member', 'viewer')`)
export class Invitation {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('text')
  email: string;

  @Column('text')
  role: InvitableRole;

  @Column('text')
  tokenHash: string;

  @Column('uuid')
  invitedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'invited_by' })
  inviter: Relation<User>;

  @Column('timestamptz')
  expiresAt: Date;

  @Column('timestamptz', { nullable: true })
  acceptedAt: Date | null;

  @CreatedAt()
  createdAt: Date;
}
