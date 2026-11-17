import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { ActivityEvent } from '../../database/entities/activity-event.entity.js';
import { AccessService } from '../access/access.service.js';
import { toActivityEvent } from './activity.dto.js';

export type ActivityType =
  | 'workspace.created'
  | 'workspace.updated'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.moved'
  | 'column.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'attachment.added'
  | 'attachment.deleted';

export interface ActivityInput {
  workspaceId: string;
  actorId: string;
  type: ActivityType;
  projectId?: string | null;
  taskId?: string | null;
  data?: Record<string, unknown>;
}

/** Append-only: there is deliberately no update or delete method. */
@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityEvent) private readonly events: Repository<ActivityEvent>,
    private readonly access: AccessService,
  ) {}

  /** Takes the caller's EntityManager so the event joins the caller's transaction. */
  async record(manager: EntityManager, event: ActivityInput): Promise<void> {
    await manager.insert(ActivityEvent, {
      workspaceId: event.workspaceId,
      actorId: event.actorId,
      type: event.type,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      data: event.data ?? {},
    });
  }

  async list(
    workspaceId: string,
    userId: string,
    filter: { projectId?: string; taskId?: string },
    limit: number,
    cursor?: string,
  ) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.events
      .createQueryBuilder('event')
      .innerJoinAndSelect('event.actor', 'actor')
      .where('event.workspaceId = :workspaceId', { workspaceId });
    if (filter.projectId) query.andWhere('event.projectId = :projectId', filter);
    if (filter.taskId) query.andWhere('event.taskId = :taskId', filter);
    const rows = await keyset(query, 'event.id', 'DESC', limit, after);
    return toPage(rows, limit, toActivityEvent, (e) => ({ id: e.id }));
  }
}
