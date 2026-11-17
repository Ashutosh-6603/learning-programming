import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Project } from './project.entity.js';

@Entity('board_columns')
@Index('board_columns_project_id_position_key', ['projectId', 'position'], { unique: true })
@Check('board_columns_wip_limit_check', 'wip_limit BETWEEN 1 AND 999')
export class BoardColumn {
  @Id()
  id: string;

  @Column('uuid')
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @Column('text')
  name: string;

  // Fractional-index keys compare byte by byte, so the column must use the "C" collation.
  @Column({ type: 'text', collation: 'C' })
  position: string;

  @Column('integer', { nullable: true })
  wipLimit: number | null;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
