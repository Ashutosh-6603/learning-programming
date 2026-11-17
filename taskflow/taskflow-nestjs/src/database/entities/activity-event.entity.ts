import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('activity_events')
@Index('activity_workspace_idx', ['workspaceId', 'id'])
@Index('activity_project_idx', ['projectId', 'id'], { where: 'project_id IS NOT NULL' })
@Index('activity_task_idx', ['taskId', 'id'], { where: 'task_id IS NOT NULL' })
export class ActivityEvent {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  // Plain uuid columns, no foreign key: the event must outlive the project or task it describes.
  @Column('uuid', { nullable: true })
  projectId: string | null;

  @Column('uuid', { nullable: true })
  taskId: string | null;

  @Column('uuid')
  actorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_id' })
  actor: Relation<User>;

  @Column('text')
  type: string;

  @Column('jsonb', { default: {} })
  data: object;

  @CreatedAt()
  createdAt: Date;
}
