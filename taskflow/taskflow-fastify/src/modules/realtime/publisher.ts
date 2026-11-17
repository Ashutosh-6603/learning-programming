import type { Redis } from 'ioredis';

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
export class RealtimePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(projectId: string, type: ServerEventType, payload: unknown): Promise<void> {
    await this.redis.publish(projectChannel(projectId), envelope(type, payload));
  }
}
