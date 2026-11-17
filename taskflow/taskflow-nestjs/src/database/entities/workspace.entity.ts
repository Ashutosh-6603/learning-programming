import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { User } from './user.entity.js';

@Entity('workspaces')
@Index('workspaces_slug_key', ['slug'], { unique: true })
export class Workspace {
  @Id()
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  slug: string;

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
