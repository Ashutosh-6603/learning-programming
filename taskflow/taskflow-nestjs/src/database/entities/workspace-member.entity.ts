import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import type { Role } from '../../modules/access/roles.js';
import { Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('workspace_members')
@Index('workspace_members_workspace_id_user_id_key', ['workspaceId', 'userId'], { unique: true })
@Index('workspace_members_user_idx', ['userId', 'workspaceId'])
@Check('workspace_members_role_check', `role IN ('owner', 'admin', 'member', 'viewer')`)
export class WorkspaceMember {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column('text')
  role: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
