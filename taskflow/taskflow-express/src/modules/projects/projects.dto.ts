import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';

interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toProject = (p: ProjectRow) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

interface ColumnRow {
  id: string;
  projectId: string;
  name: string;
  position: string;
  wipLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toColumn = (c: ColumnRow) => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  position: c.position,
  wipLimit: c.wipLimit,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export interface TaskRow {
  id: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: string;
  dueAt: Date | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string };
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
}

export type TaskDto = ReturnType<typeof toTask>;

export const toTask = (t: TaskRow) => ({
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

/** Prisma `include` that loads everything `toTask` needs in one query. */
export const taskInclude = {
  project: { select: { key: true } },
  assignee: { select: { id: true, email: true, displayName: true } },
  reporter: { select: { id: true, email: true, displayName: true } },
} as const;
