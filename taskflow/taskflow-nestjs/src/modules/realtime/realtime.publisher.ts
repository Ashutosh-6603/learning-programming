import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';

export type ServerEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.moved'
  | 'column.deleted'
  | 'comment.created'
  | 'presence.updated';

export const projectChannel = (projectId: string) => `project:${projectId}`;

export const envelope = (type: string, payload?: unknown) =>
  JSON.stringify({
    type,
    ...(payload === undefined ? {} : { payload }),
    ts: new Date().toISOString(),
  });

/** Publishes to Redis; every API instance's WebSocket gateway relays to its own sockets. */
@Injectable()
export class RealtimePublisher {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(projectId: string, type: ServerEventType, payload: unknown): Promise<void> {
    await this.redis.publish(projectChannel(projectId), envelope(type, payload));
  }
}
