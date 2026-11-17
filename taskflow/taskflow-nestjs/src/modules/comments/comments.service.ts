import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { forbidden, notFound } from '../../common/problem.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { AccessService } from '../access/access.service.js';
import { atLeast } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { toComment } from './comment.dto.js';

async function loadComment(manager: EntityManager, id: string) {
  const comment = await manager.findOne(Comment, { where: { id }, relations: { author: true } });
  if (!comment) throw notFound('Comment');
  return toComment(comment);
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.comments
      .createQueryBuilder('comment')
      .innerJoinAndSelect('comment.author', 'author')
      .where('comment.taskId = :taskId', { taskId });
    const rows = await keyset(query, 'comment.id', 'ASC', limit, after);
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }

  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(Comment, { taskId, authorId: userId, body }),
      );
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return loadComment(manager, created.id);
    });
    await this.realtime.publish(project.id, 'comment.created', { projectId: project.id, comment });
    return comment;
  }

  async update(commentId: string, userId: string, body: string) {
    const { comment, project } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId) throw forbidden('Only the author can edit a comment');
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Comment, { id: commentId }, { body });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return loadComment(manager, commentId);
    });
  }

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Comment, { id: commentId });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.deleted',
        data: { commentId },
      });
    });
  }
}
