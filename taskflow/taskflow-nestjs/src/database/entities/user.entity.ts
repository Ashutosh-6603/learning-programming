import { Check, Column, Entity, Index } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';

@Entity('users')
@Index('users_email_key', ['email'], { unique: true })
@Check('users_email_check', 'email = lower(email)')
export class User {
  @Id()
  id: string;

  @Column('text')
  email: string;

  // select: false keeps the hash out of every query that doesn't ask for it by name.
  @Column('text', { select: false })
  passwordHash: string;

  @Column('text')
  displayName: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
