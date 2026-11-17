import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('projects')
@Index('projects_workspace_id_key_key', ['workspaceId', 'key'], { unique: true })
@Index('projects_workspace_idx', ['workspaceId', 'id'])
@Check('projects_key_check', `key ~ '^[A-Z][A-Z0-9]{1,9}$'`)
export class Project {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('text')
  name: string;

  @Column('text')
  key: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('integer', { default: 1 })
  nextTaskNumber: number;

  @Column('uuid')
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: Relation<User>;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
