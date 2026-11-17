import { request } from './client';
import type {
  ActivityEvent,
  Attachment,
  AttachmentUpload,
  AuthSession,
  Board,
  Comment,
  InvitableRole,
  Invitation,
  Member,
  Page,
  PresignedUrl,
  Priority,
  Project,
  Role,
  SearchHit,
  Task,
  User,
  Workspace,
  WsTicket,
} from './types';

const v1 = '/api/v1';

export const authApi = {
  register: (body: { email: string; password: string; displayName: string }) =>
    request<AuthSession>('POST', `${v1}/auth/register`, { body, anonymous: true }),
  login: (body: { email: string; password: string }) =>
    request<AuthSession>('POST', `${v1}/auth/login`, { body, anonymous: true }),
  logout: () => request<undefined>('POST', `${v1}/auth/logout`, { anonymous: true }),
  me: () => request<User>('GET', `${v1}/users/me`),
};

export const workspacesApi = {
  list: (cursor?: string) =>
    request<Page<Workspace>>('GET', `${v1}/workspaces`, { query: { limit: 50, cursor } }),
  get: (id: string) => request<Workspace>('GET', `${v1}/workspaces/${id}`),
  create: (body: { name: string; slug: string }) =>
    request<Workspace>('POST', `${v1}/workspaces`, { body }),
  members: (id: string) =>
    request<Page<Member>>('GET', `${v1}/workspaces/${id}/members`, { query: { limit: 100 } }),
  updateMember: (id: string, userId: string, role: Role) =>
    request<Member>('PATCH', `${v1}/workspaces/${id}/members/${userId}`, { body: { role } }),
  removeMember: (id: string, userId: string) =>
    request<undefined>('DELETE', `${v1}/workspaces/${id}/members/${userId}`),
  invitations: (id: string) =>
    request<Page<Invitation>>('GET', `${v1}/workspaces/${id}/invitations`, {
      query: { limit: 100 },
    }),
  invite: (id: string, body: { email: string; role: InvitableRole }) =>
    request<Invitation>('POST', `${v1}/workspaces/${id}/invitations`, { body }),
  revokeInvitation: (id: string, invitationId: string) =>
    request<undefined>('DELETE', `${v1}/workspaces/${id}/invitations/${invitationId}`),
  acceptInvitation: (token: string) =>
    request<Workspace>('POST', `${v1}/invitations/accept`, { body: { token } }),
  search: (id: string, q: string) =>
    request<Page<SearchHit>>('GET', `${v1}/workspaces/${id}/search`, { query: { q, limit: 8 } }),
  activity: (id: string, filter: { taskId?: string; projectId?: string }) =>
    request<Page<ActivityEvent>>('GET', `${v1}/workspaces/${id}/activity`, {
      query: { ...filter, limit: 30 },
    }),
};

export const projectsApi = {
  list: (workspaceId: string) =>
    request<Page<Project>>('GET', `${v1}/workspaces/${workspaceId}/projects`, {
      query: { limit: 100 },
    }),
  create: (workspaceId: string, body: { name: string; key: string; description?: string | null }) =>
    request<Project>('POST', `${v1}/workspaces/${workspaceId}/projects`, { body }),
  board: (projectId: string) => request<Board>('GET', `${v1}/projects/${projectId}/board`),
};

export interface CreateTaskBody {
  title: string;
  description?: string | null;
  columnId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  dueAt?: string | null;
}

/** JSON merge-patch semantics: absent = unchanged, null = cleared. */
export type UpdateTaskBody = Partial<Omit<CreateTaskBody, 'columnId'>>;

export const tasksApi = {
  get: (id: string) => request<Task>('GET', `${v1}/tasks/${id}`),
  create: (projectId: string, body: CreateTaskBody) =>
    request<Task>('POST', `${v1}/projects/${projectId}/tasks`, { body }),
  update: (id: string, body: UpdateTaskBody) =>
    request<Task>('PATCH', `${v1}/tasks/${id}`, { body }),
  move: (id: string, body: { columnId: string; afterTaskId: string | null }) =>
    request<Task>('POST', `${v1}/tasks/${id}/move`, { body }),
  remove: (id: string) => request<undefined>('DELETE', `${v1}/tasks/${id}`),
  comments: (id: string) =>
    request<Page<Comment>>('GET', `${v1}/tasks/${id}/comments`, { query: { limit: 100 } }),
  comment: (id: string, body: string) =>
    request<Comment>('POST', `${v1}/tasks/${id}/comments`, { body: { body } }),
};

export const attachmentsApi = {
  list: (taskId: string) =>
    request<Page<Attachment>>('GET', `${v1}/tasks/${taskId}/attachments`, { query: { limit: 50 } }),
  create: (taskId: string, body: { fileName: string; contentType: string; sizeBytes: number }) =>
    request<AttachmentUpload>('POST', `${v1}/tasks/${taskId}/attachments`, { body }),
  complete: (id: string) => request<Attachment>('POST', `${v1}/attachments/${id}/complete`),
  download: (id: string) => request<PresignedUrl>('GET', `${v1}/attachments/${id}/download`),
  remove: (id: string) => request<undefined>('DELETE', `${v1}/attachments/${id}`),
};

export const realtimeApi = {
  ticket: () => request<WsTicket>('POST', `${v1}/ws/ticket`),
};
