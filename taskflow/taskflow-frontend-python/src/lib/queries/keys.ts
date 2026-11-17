/**
 * Every cache key in one place, so invalidation can't drift from the queries. Keys are
 * hierarchical arrays: invalidating ['workspaces', id] also hits ['workspaces', id, 'members'].
 */
export const keys = {
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  projects: (workspaceId: string) => ['workspaces', workspaceId, 'projects'] as const,
  members: (workspaceId: string) => ['workspaces', workspaceId, 'members'] as const,
  invitations: (workspaceId: string) => ['workspaces', workspaceId, 'invitations'] as const,
  search: (workspaceId: string, q: string) => ['workspaces', workspaceId, 'search', q] as const,
  activity: (workspaceId: string, taskId: string) =>
    ['workspaces', workspaceId, 'activity', taskId] as const,
  board: (projectId: string) => ['board', projectId] as const,
  task: (taskId: string) => ['tasks', taskId] as const,
  comments: (taskId: string) => ['tasks', taskId, 'comments'] as const,
  attachments: (taskId: string) => ['tasks', taskId, 'attachments'] as const,
};
