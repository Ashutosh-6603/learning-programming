import type { Board, BoardColumn, Task, UserSummary, Workspace } from '@/lib/api/types';

export const ada: UserSummary = {
  id: '01900000-0000-7000-8000-00000000a0a0',
  email: 'ada@acme.dev',
  displayName: 'Ada Lovelace',
};

const stamp = '2026-10-25T12:00:00Z';

export function makeTask(
  overrides: Partial<Task> & Pick<Task, 'id' | 'columnId' | 'position'>,
): Task {
  const number = overrides.number ?? 1;
  return {
    key: `TF-${number}`,
    number,
    projectId: 'p1',
    title: `Task ${number}`,
    description: null,
    priority: 'medium',
    assignee: null,
    reporter: ada,
    dueAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

function column(id: string, name: string, position: string, tasks: Task[]): BoardColumn {
  return {
    id,
    projectId: 'p1',
    name,
    position,
    wipLimit: null,
    createdAt: stamp,
    updatedAt: stamp,
    tasks,
  };
}

/** To Do: TF-1, TF-2 · In Progress: TF-3 · Done: (empty) */
export function makeBoard(): Board {
  return {
    project: {
      id: 'p1',
      workspaceId: 'w1',
      name: 'TaskFlow API',
      key: 'TF',
      description: null,
      createdAt: stamp,
      updatedAt: stamp,
    },
    columns: [
      column('c1', 'To Do', 'a0', [
        makeTask({ id: 't1', number: 1, columnId: 'c1', position: 'a0' }),
        makeTask({ id: 't2', number: 2, columnId: 'c1', position: 'a1' }),
      ]),
      column('c2', 'In Progress', 'a1', [
        makeTask({ id: 't3', number: 3, columnId: 'c2', position: 'a0' }),
      ]),
      column('c3', 'Done', 'a2', []),
    ],
  };
}

export function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'w1',
    name: 'Acme Product',
    slug: 'acme-product',
    currentUserRole: 'member',
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}
