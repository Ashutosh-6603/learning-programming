import { api, expectOk, unwrap } from './client';
import type { CreateTaskBody, InvitableRole, Role, UpdateTaskBody } from './types';

// Path parameters are named like the contract's ({workspaceId}, {taskId}, …), and TypeScript
// rejects a path, a parameter or a body field the contract doesn't have.

export const authApi = {
  register: (body: { email: string; password: string; displayName: string }) =>
    unwrap(api.POST('/api/v1/auth/register', { body })),
  login: (body: { email: string; password: string }) =>
    unwrap(api.POST('/api/v1/auth/login', { body })),
  logout: () => expectOk(api.POST('/api/v1/auth/logout')),
  me: () => unwrap(api.GET('/api/v1/users/me')),
};

const workspace = (workspaceId: string) => ({ path: { workspaceId } });

export const workspacesApi = {
  list: (cursor?: string) =>
    unwrap(api.GET('/api/v1/workspaces', { params: { query: { limit: 50, cursor } } })),
  get: (id: string) =>
    unwrap(api.GET('/api/v1/workspaces/{workspaceId}', { params: workspace(id) })),
  create: (body: { name: string; slug: string }) =>
    unwrap(api.POST('/api/v1/workspaces', { body })),
  members: (id: string) =>
    unwrap(
      api.GET('/api/v1/workspaces/{workspaceId}/members', {
        params: { ...workspace(id), query: { limit: 100 } },
      }),
    ),
  updateMember: (id: string, userId: string, role: Role) =>
    unwrap(
      api.PATCH('/api/v1/workspaces/{workspaceId}/members/{userId}', {
        params: { path: { workspaceId: id, userId } },
        body: { role },
      }),
    ),
  removeMember: (id: string, userId: string) =>
    expectOk(
      api.DELETE('/api/v1/workspaces/{workspaceId}/members/{userId}', {
        params: { path: { workspaceId: id, userId } },
      }),
    ),
  invitations: (id: string) =>
    unwrap(
      api.GET('/api/v1/workspaces/{workspaceId}/invitations', {
        params: { ...workspace(id), query: { limit: 100 } },
      }),
    ),
  invite: (id: string, body: { email: string; role: InvitableRole }) =>
    unwrap(
      api.POST('/api/v1/workspaces/{workspaceId}/invitations', { params: workspace(id), body }),
    ),
  revokeInvitation: (id: string, invitationId: string) =>
    expectOk(
      api.DELETE('/api/v1/workspaces/{workspaceId}/invitations/{invitationId}', {
        params: { path: { workspaceId: id, invitationId } },
      }),
    ),
  acceptInvitation: (token: string) =>
    unwrap(api.POST('/api/v1/invitations/accept', { body: { token } })),
  search: (id: string, q: string) =>
    unwrap(
      api.GET('/api/v1/workspaces/{workspaceId}/search', {
        params: { ...workspace(id), query: { q, limit: 8 } },
      }),
    ),
  activity: (id: string, filter: { taskId?: string; projectId?: string }) =>
    unwrap(
      api.GET('/api/v1/workspaces/{workspaceId}/activity', {
        params: { ...workspace(id), query: { ...filter, limit: 30 } },
      }),
    ),
};

export const projectsApi = {
  list: (workspaceId: string) =>
    unwrap(
      api.GET('/api/v1/workspaces/{workspaceId}/projects', {
        params: { ...workspace(workspaceId), query: { limit: 100 } },
      }),
    ),
  create: (workspaceId: string, body: { name: string; key: string; description?: string | null }) =>
    unwrap(
      api.POST('/api/v1/workspaces/{workspaceId}/projects', {
        params: workspace(workspaceId),
        body,
      }),
    ),
  board: (projectId: string) =>
    unwrap(api.GET('/api/v1/projects/{projectId}/board', { params: { path: { projectId } } })),
};

const task = (taskId: string) => ({ path: { taskId } });

export const tasksApi = {
  get: (id: string) => unwrap(api.GET('/api/v1/tasks/{taskId}', { params: task(id) })),
  create: (projectId: string, body: CreateTaskBody) =>
    unwrap(
      api.POST('/api/v1/projects/{projectId}/tasks', { params: { path: { projectId } }, body }),
    ),
  update: (id: string, body: UpdateTaskBody) =>
    unwrap(api.PATCH('/api/v1/tasks/{taskId}', { params: task(id), body })),
  move: (id: string, body: { columnId: string; afterTaskId: string | null }) =>
    unwrap(api.POST('/api/v1/tasks/{taskId}/move', { params: task(id), body })),
  remove: (id: string) => expectOk(api.DELETE('/api/v1/tasks/{taskId}', { params: task(id) })),
  comments: (id: string) =>
    unwrap(
      api.GET('/api/v1/tasks/{taskId}/comments', {
        params: { ...task(id), query: { limit: 100 } },
      }),
    ),
  comment: (id: string, body: string) =>
    unwrap(api.POST('/api/v1/tasks/{taskId}/comments', { params: task(id), body: { body } })),
};

const attachment = (attachmentId: string) => ({ path: { attachmentId } });

export const attachmentsApi = {
  list: (taskId: string) =>
    unwrap(
      api.GET('/api/v1/tasks/{taskId}/attachments', {
        params: { ...task(taskId), query: { limit: 50 } },
      }),
    ),
  create: (taskId: string, body: { fileName: string; contentType: string; sizeBytes: number }) =>
    unwrap(api.POST('/api/v1/tasks/{taskId}/attachments', { params: task(taskId), body })),
  complete: (id: string) =>
    unwrap(api.POST('/api/v1/attachments/{attachmentId}/complete', { params: attachment(id) })),
  download: (id: string) =>
    unwrap(api.GET('/api/v1/attachments/{attachmentId}/download', { params: attachment(id) })),
  remove: (id: string) =>
    expectOk(api.DELETE('/api/v1/attachments/{attachmentId}', { params: attachment(id) })),
};

export const realtimeApi = {
  ticket: () => unwrap(api.POST('/api/v1/ws/ticket')),
};
