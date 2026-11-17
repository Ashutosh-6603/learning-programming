import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { BoardColumn } from './board-column.entity.js';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

@Entity('tasks')
@Index('tasks_project_id_number_key', ['projectId', 'number'], { unique: true })
@Index('tasks_column_id_position_key', ['columnId', 'position'], { unique: true })
@Index('tasks_project_idx', ['projectId', 'id'])
@Index('tasks_assignee_idx', ['assigneeId', 'id'])
@Index('tasks_search_idx', ['searchVector'], { type: 'gin' })
@Index('tasks_due_reminder_idx', ['dueAt'], {
  where: 'reminder_sent_at IS NULL AND assignee_id IS NOT NULL',
})
@Check('tasks_priority_check', `priority IN ('low', 'medium', 'high', 'urgent')`)
export class Task {
  @Id()
  id: string;

  @Column('uuid')
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @Column('uuid')
  columnId: string;

  // No ON DELETE action: Postgres refuses to delete a column that still has tasks.
  @ManyToOne(() => BoardColumn)
  @JoinColumn({ name: 'column_id' })
  column: Relation<BoardColumn>;

  @Column('integer')
  number: number;

  @Column('text')
  title: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('text', { default: 'medium' })
  priority: Priority;

  @Column('uuid', { nullable: true })
  assigneeId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee: Relation<User> | null;

  @Column('uuid')
  reporterId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter: Relation<User>;

  @Column('timestamptz', { nullable: true })
  dueAt: Date | null;

  @Column('timestamptz', { nullable: true })
  reminderSentAt: Date | null;

  @Column({ type: 'text', collation: 'C' })
  position: string;

  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: `setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    select: false,
    insert: false,
    update: false,
  })
  searchVector: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
