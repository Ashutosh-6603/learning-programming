import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  attachments,
  boardColumns,
  comments,
  projects,
  tasks,
  workspaceMembers,
} from '../../db/schema.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
export class Access {
  constructor(private readonly db: Database) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    });
    if (!membership) throw notFound(what);
    if (!atLeast(membership.role, minimum)) throw forbidden();
    return membership;
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.db.query.boardColumns.findFirst({
      where: eq(boardColumns.id, columnId),
      with: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }

  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      with: { project: true },
    });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      with: { task: { with: { project: true } } },
    });
    if (!comment) throw notFound('Comment');
    const { project } = comment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Comment');
    return { comment, project, membership };
  }

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.db.query.attachments.findFirst({
      where: eq(attachments.id, attachmentId),
      with: { task: { with: { project: true } } },
    });
    if (!attachment) throw notFound('Attachment');
    const { project } = attachment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Attachment');
    return { attachment, project, membership };
  }
}
