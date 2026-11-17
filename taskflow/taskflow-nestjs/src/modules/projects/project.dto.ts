import { IsInt, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsId, IsNullable, IsOmittable, Trim } from '../../common/validation/decorators.js';
import type { BoardColumn } from '../../database/entities/board-column.entity.js';
import type { Project } from '../../database/entities/project.entity.js';
import type { Priority, Task } from '../../database/entities/task.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class CreateProjectDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  name: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/)
  key: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateProjectDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class CreateColumnDto {
  @Trim()
  @IsString()
  @Length(1, 50)
  name: string;

  @IsOmittable()
  @IsNullable()
  @IsInt()
  @Min(1)
  @Max(999)
  wipLimit?: number | null;
}

export class UpdateColumnDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOmittable()
  @IsNullable()
  @IsInt()
  @Min(1)
  @Max(999)
  wipLimit?: number | null;
}

export class MoveColumnDto {
  // Required, but null is a value: "move to the first position".
  @IsNullable()
  @IsId()
  afterColumnId: string | null;
}

export class ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ColumnDto {
  id: string;
  projectId: string;
  name: string;
  position: string;
  wipLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

export class TaskDto {
  id: string;
  key: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
  dueAt: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export class BoardColumnDto extends ColumnDto {
  tasks: TaskDto[];
}

export class BoardDto {
  project: ProjectDto;
  columns: BoardColumnDto[];
}

export const toProject = (p: Project): ProjectDto => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toColumn = (c: BoardColumn): ColumnDto => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  position: c.position,
  wipLimit: c.wipLimit,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/** The relations `toTask` reads; pass it as `relations` to every query that feeds it. */
export const TASK_RELATIONS = { project: true, assignee: true, reporter: true } as const;

export const toTask = (t: Task): TaskDto => ({
  id: t.id,
  key: `${t.project.key}-${t.number}`,
  number: t.number,
  projectId: t.projectId,
  columnId: t.columnId,
  title: t.title,
  description: t.description,
  priority: t.priority,
  assignee: t.assignee ? toUserSummary(t.assignee) : null,
  reporter: toUserSummary(t.reporter),
  dueAt: t.dueAt?.toISOString() ?? null,
  position: t.position,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});
