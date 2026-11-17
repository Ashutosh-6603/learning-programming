// Wire types from contract/openapi.yaml. Timestamps are ISO-8601 strings; ids are UUIDv7 strings.

export type Role = 'owner' | 'admin' | 'member' | 'viewer';
export type InvitableRole = Exclude<Role, 'owner'>;
export type Priority = 'urgent' | 'high' | 'medium' | 'low';

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface FieldError {
  field: string;
  message: string;
}

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: FieldError[];
}

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
}

export interface User extends UserSummary {
  createdAt: string;
}

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface AuthSession extends AccessToken {
  user: User;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  currentUserRole: Role;
  createdAt: string;
  updatedAt: string;
}

export interface Member {
  user: UserSummary;
  role: Role;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableRole;
  invitedBy: UserSummary;
  expiresAt: string;
  createdAt: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  projectId: string;
  name: string;
  position: string;
  wipLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  key: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: UserSummary | null;
  reporter: UserSummary;
  dueAt: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export interface BoardColumn extends Column {
  tasks: Task[];
}

export interface Board {
  project: Project;
  columns: BoardColumn[];
}

export interface Comment {
  id: string;
  taskId: string;
  author: UserSummary;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface Attachment {
  id: string;
  taskId: string;
  uploader: UserSummary;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'ready';
  createdAt: string;
}

export interface PresignedUrl {
  url: string;
  expiresAt: string;
}

export interface AttachmentUpload {
  attachment: Attachment;
  upload: PresignedUrl & { method: 'PUT'; headers: Record<string, string> };
}

export interface ActivityEvent {
  id: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  actor: UserSummary;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface SearchHit {
  task: Task;
  rank: number;
  headline: string;
}

export interface WsTicket {
  ticket: string;
  expiresAt: string;
}

/** Server → client WebSocket envelopes (README §9.2). */
export type ServerMessage =
  | { type: 'subscribed'; payload: { projectId: string }; ts: string }
  | { type: 'pong'; ts: string }
  | { type: 'error'; payload: { code: string; message: string }; ts: string }
  | { type: 'presence.updated'; payload: { projectId: string; users: UserSummary[] }; ts: string }
  | { type: 'task.created' | 'task.updated' | 'task.moved'; payload: Task; ts: string }
  | {
      type: 'task.deleted';
      payload: { id: string; projectId: string; columnId: string };
      ts: string;
    }
  | { type: 'column.created' | 'column.updated' | 'column.moved'; payload: Column; ts: string }
  | { type: 'column.deleted'; payload: { id: string; projectId: string }; ts: string }
  | { type: 'comment.created'; payload: { projectId: string; comment: Comment }; ts: string };
