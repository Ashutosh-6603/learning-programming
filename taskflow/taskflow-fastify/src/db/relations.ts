import { relations } from 'drizzle-orm';
import {
  activityEvents,
  attachments,
  boardColumns,
  comments,
  invitations,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from './schema.js';

// Relations are TypeScript-only metadata for `db.query.*` (no SQL, no migration).
// `one()` sits on the side that holds the foreign key; `many()` is its inverse.

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  projects: many(projects),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  workspace: one(workspaces, { fields: [invitations.workspaceId], references: [workspaces.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
  columns: many(boardColumns),
  tasks: many(tasks),
}));

export const boardColumnsRelations = relations(boardColumns, ({ one, many }) => ({
  project: one(projects, { fields: [boardColumns.projectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  column: one(boardColumns, { fields: [tasks.columnId], references: [boardColumns.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  reporter: one(users, { fields: [tasks.reporterId], references: [users.id] }),
  comments: many(comments),
  attachments: many(attachments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  task: one(tasks, { fields: [attachments.taskId], references: [tasks.id] }),
  uploader: one(users, { fields: [attachments.uploaderId], references: [users.id] }),
}));

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  actor: one(users, { fields: [activityEvents.actorId], references: [users.id] }),
}));
