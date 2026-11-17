import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Fractional-index keys compare byte by byte, so the column must use the "C" collation. */
const orderKey = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_check', sql`${t.email} = lower(${t.email})`),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspace_members_workspace_id_user_id_key').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId, t.workspaceId),
    check('workspace_members_role_check', sql`${t.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    uniqueIndex('invitations_pending_email_uq')
      .on(t.workspaceId, t.email)
      .where(sql`accepted_at IS NULL`),
    index('invitations_workspace_idx')
      .on(t.workspaceId, t.id)
      .where(sql`accepted_at IS NULL`),
    check('invitations_email_check', sql`${t.email} = lower(${t.email})`),
    check('invitations_role_check', sql`${t.role} IN ('admin', 'member', 'viewer')`),
  ],
);

export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_workspace_id_key_key').on(t.workspaceId, t.key),
    index('projects_workspace_idx').on(t.workspaceId, t.id),
    check('projects_key_check', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

export const boardColumns = pgTable(
  'board_columns',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: orderKey('position').notNull(),
    wipLimit: integer('wip_limit'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('board_columns_project_id_position_key').on(t.projectId, t.position),
    check('board_columns_wip_limit_check', sql`${t.wipLimit} BETWEEN 1 AND 999`),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // No ON DELETE action: Postgres refuses to delete a column that still has tasks.
    columnId: uuid('column_id')
      .notNull()
      .references(() => boardColumns.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] })
      .notNull()
      .default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    dueAt: timestamptz('due_at'),
    reminderSentAt: timestamptz('reminder_sent_at'),
    position: orderKey('position').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_id_number_key').on(t.projectId, t.number),
    uniqueIndex('tasks_column_id_position_key').on(t.columnId, t.position),
    index('tasks_project_idx').on(t.projectId, t.id),
    index('tasks_assignee_idx').on(t.assigneeId, t.id),
    index('tasks_search_idx').using('gin', t.searchVector),
    index('tasks_due_reminder_idx')
      .on(t.dueAt)
      .where(sql`reminder_sent_at IS NULL AND assignee_id IS NOT NULL`),
    check('tasks_priority_check', sql`${t.priority} IN ('low', 'medium', 'high', 'urgent')`),
  ],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('comments_task_idx').on(t.taskId, t.id)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: ['pending', 'ready'] })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    index('attachments_task_idx')
      .on(t.taskId, t.id)
      .where(sql`status = 'ready'`),
    index('attachments_pending_idx')
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
    check('attachments_size_bytes_check', sql`${t.sizeBytes} > 0`),
    check('attachments_status_check', sql`${t.status} IN ('pending', 'ready')`),
  ],
);

export const activityEvents = pgTable(
  'activity_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_workspace_idx').on(t.workspaceId, t.id),
    index('activity_project_idx')
      .on(t.projectId, t.id)
      .where(sql`project_id IS NOT NULL`),
    index('activity_task_idx')
      .on(t.taskId, t.id)
      .where(sql`task_id IS NOT NULL`),
  ],
);
