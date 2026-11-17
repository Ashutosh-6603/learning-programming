import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';

@Entity('comments')
@Index('comments_task_idx', ['taskId', 'id'])
export class Comment {
  @Id()
  id: string;

  @Column('uuid')
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Relation<Task>;

  @Column('uuid')
  authorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author: Relation<User>;

  @Column('text')
  body: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
