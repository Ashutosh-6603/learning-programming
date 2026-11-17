import type { PrismaClient } from '../../generated/prisma/client.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { asRole, atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
export class Access {
  constructor(private readonly db: PrismaClient) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw notFound(what);
    const role = asRole(membership.role);
    if (!atLeast(role, minimum)) throw forbidden();
    return { ...membership, role };
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.db.boardColumn.findUnique({
      where: { id: columnId },
      include: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }

  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      include: { task: { include: { project: true } } },
    });
    if (!comment) throw notFound('Comment');
    const membership = await this.member(
      comment.task.project.workspaceId,
      userId,
      'viewer',
      'Comment',
    );
    return { comment, project: comment.task.project, membership };
  }

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.db.attachment.findUnique({
      where: { id: attachmentId },
      include: { task: { include: { project: true } } },
    });
    if (!attachment) throw notFound('Attachment');
    const membership = await this.member(
      attachment.task.project.workspaceId,
      userId,
      'viewer',
      'Attachment',
    );
    return { attachment, project: attachment.task.project, membership };
  }
}
