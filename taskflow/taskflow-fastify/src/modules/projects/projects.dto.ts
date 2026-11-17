import { Type, type Static } from 'typebox';
import { Id, Nullable, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';

export const Project = Type.Object({
  id: Id,
  workspaceId: Id,
  name: Type.String(),
  key: Type.String(),
  description: Nullable(Type.String()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Column = Type.Object({
  id: Id,
  projectId: Id,
  name: Type.String(),
  position: Type.String(),
  wipLimit: Nullable(Type.Integer()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Priority = Type.Enum(['low', 'medium', 'high', 'urgent']);

export const Task = Type.Object({
  id: Id,
  key: Type.String(),
  number: Type.Integer(),
  projectId: Id,
  columnId: Id,
  title: Type.String(),
  description: Nullable(Type.String()),
  priority: Priority,
  assignee: Nullable(UserSummary),
  reporter: UserSummary,
  dueAt: Nullable(Timestamp),
  position: Type.String(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Board = Type.Object({
  project: Project,
  columns: Type.Array(Type.Object({ ...Column.properties, tasks: Type.Array(Task) })),
});

export type ProjectDto = Static<typeof Project>;
export type ColumnDto = Static<typeof Column>;
export type TaskDto = Static<typeof Task>;
export type BoardDto = Static<typeof Board>;

export const toProject = (
  p: Omit<ProjectDto, 'createdAt' | 'updatedAt'> & {
    createdAt: Date;
    updatedAt: Date;
  },
): ProjectDto => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toColumn = (
  c: Omit<ColumnDto, 'createdAt' | 'updatedAt'> & {
    createdAt: Date;
    updatedAt: Date;
  },
): ColumnDto => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  position: c.position,
  wipLimit: c.wipLimit,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/** Drizzle `with` that loads everything `toTask` needs in one query. */
export const taskWith = {
  project: { columns: { key: true } },
  assignee: { columns: userSummaryColumns },
  reporter: { columns: userSummaryColumns },
} as const;

export interface TaskRow {
  id: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskDto['priority'];
  dueAt: Date | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string };
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
}

export const toTask = (t: TaskRow): TaskDto => ({
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
