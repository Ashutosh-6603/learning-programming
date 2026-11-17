import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { bigintAsNumber, CreatedAt, Id } from './columns.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';

export type AttachmentStatus = 'pending' | 'ready';

@Entity('attachments')
@Index('attachments_storage_key_key', ['storageKey'], { unique: true })
@Index('attachments_task_idx', ['taskId', 'id'], { where: `status = 'ready'` })
@Index('attachments_pending_idx', ['createdAt'], { where: `status = 'pending'` })
@Check('attachments_size_bytes_check', 'size_bytes > 0')
@Check('attachments_status_check', `status IN ('pending', 'ready')`)
export class Attachment {
  @Id()
  id: string;

  @Column('uuid')
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Relation<Task>;

  @Column('uuid')
  uploaderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploader_id' })
  uploader: Relation<User>;

  @Column('text')
  fileName: string;

  @Column('text')
  contentType: string;

  @Column('bigint', { transformer: bigintAsNumber })
  sizeBytes: number;

  @Column('text')
  storageKey: string;

  @Column('text', { default: 'pending' })
  status: AttachmentStatus;

  @CreatedAt()
  createdAt: Date;
}
