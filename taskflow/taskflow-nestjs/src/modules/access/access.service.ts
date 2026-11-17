import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { forbidden, notFound } from '../../common/problem.js';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(BoardColumn) private readonly columns: Repository<BoardColumn>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
  ) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.members.findOneBy({ workspaceId, userId });
    if (!membership) throw notFound(what);
    if (!atLeast(membership.role, minimum)) throw forbidden();
    return membership;
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.projects.findOneBy({ id: projectId });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.columns.findOne({
      where: { id: columnId },
      relations: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }

  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { project: true } });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.comments.findOne({
      where: { id: commentId },
      relations: { task: { project: true } },
    });
    if (!comment) throw notFound('Comment');
    const { project } = comment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Comment');
    return { comment, project, membership };
  }

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.attachments.findOne({
      where: { id: attachmentId },
      relations: { task: { project: true } },
    });
    if (!attachment) throw notFound('Attachment');
    const { project } = attachment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Attachment');
    return { attachment, project, membership };
  }
}
