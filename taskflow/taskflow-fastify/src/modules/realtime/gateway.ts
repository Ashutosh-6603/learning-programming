import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { v7 as uuidv7 } from 'uuid';
import { WebSocket, type RawData } from 'ws';
import { ProblemError } from '../../lib/problem.js';
import { Id } from '../../lib/schemas.js';
import type { Access } from '../workspaces/access.js';
import type { Presence } from './presence.js';
import { envelope, projectChannel, type RealtimePublisher } from './publisher.js';

const ProjectPayload = Type.Object({ projectId: Id });
const ClientMessage = Type.Union([
  Type.Object({ type: Type.Literal('subscribe'), payload: ProjectPayload }),
  Type.Object({ type: Type.Literal('unsubscribe'), payload: ProjectPayload }),
  Type.Object({ type: Type.Literal('ping') }),
]);

export const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BAD_MESSAGES = 4400;
export const CLOSE_GOING_AWAY = 1001;
const MAX_BAD_MESSAGES = 10;
const IDLE_TIMEOUT_MS = 75_000;

interface Client {
  ws: WebSocket;
  userId: string;
  connectionId: string;
  projects: Set<string>;
  lastSeen: number;
  badMessages: number;
}

export class RealtimeGateway {
  /** projectId → this instance's sockets watching it. */
  private readonly local = new Map<string, Set<Client>>();
  private readonly clients = new Set<Client>();
  private readonly reaper: NodeJS.Timeout;

  constructor(
    private readonly subscriber: Redis,
    private readonly access: Access,
    private readonly presence: Presence,
    private readonly publisher: RealtimePublisher,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.subscriber.on('message', (channel: string, message: string) => {
      const projectId = channel.slice('project:'.length);
      for (const client of this.local.get(projectId) ?? []) send(client, message);
    });
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
      for (const client of this.clients) if (client.lastSeen < cutoff) client.ws.terminate();
    }, 30_000);
  }

  /**
   * Called synchronously from the route handler, so listeners are attached before the
   * first message can arrive. `userId` is null when the ticket was missing or already used.
   */
  accept(ws: WebSocket, userId: string | null): void {
    // Accept first, then close with a reason the browser can read.
    if (userId === null) {
      ws.close(CLOSE_UNAUTHORIZED, 'invalid or expired ticket');
      return;
    }
    const client: Client = {
      ws,
      userId,
      connectionId: uuidv7(),
      projects: new Set(),
      lastSeen: Date.now(),
      badMessages: 0,
    };
    this.clients.add(client);
    ws.on('message', (data) => void this.onMessage(client, data));
    ws.on('close', () => void this.onClose(client));
    ws.on('error', (err) => {
      this.logger.warn({ err }, 'websocket error');
    });
  }

  private async onMessage(client: Client, data: RawData): Promise<void> {
    client.lastSeen = Date.now();
    let parsed: Static<typeof ClientMessage>;
    try {
      parsed = Value.Parse(ClientMessage, JSON.parse(rawToString(data)));
    } catch {
      client.badMessages++;
      if (client.badMessages > MAX_BAD_MESSAGES) {
        client.ws.close(CLOSE_BAD_MESSAGES, 'too many malformed messages');
        return;
      }
      send(client, envelope('error', { code: 'bad_message', message: 'Malformed message' }));
      return;
    }

    try {
      switch (parsed.type) {
        case 'subscribe':
          await this.subscribe(client, parsed.payload.projectId);
          break;
        case 'unsubscribe':
          await this.unsubscribe(client, parsed.payload.projectId);
          break;
        case 'ping':
          for (const projectId of client.projects) {
            await this.presence.touch(projectId, client.userId, client.connectionId);
          }
          send(client, envelope('pong'));
          break;
      }
    } catch (err) {
      if (err instanceof ProblemError && (err.status === 404 || err.status === 403)) {
        const code = err.status === 404 ? 'not_found' : 'forbidden';
        send(client, envelope('error', { code, message: err.message }));
        return;
      }
      this.logger.error({ err }, 'websocket handler failed');
    }
  }

  private async subscribe(client: Client, projectId: string): Promise<void> {
    await this.access.project(projectId, client.userId);
    if (!client.projects.has(projectId)) {
      client.projects.add(projectId);
      let sockets = this.local.get(projectId);
      if (!sockets) {
        sockets = new Set();
        this.local.set(projectId, sockets);
        await this.subscriber.subscribe(projectChannel(projectId));
      }
      sockets.add(client);
    }
    await this.presence.touch(projectId, client.userId, client.connectionId);
    send(client, envelope('subscribed', { projectId }));
    await this.broadcastPresence(projectId);
  }

  private async unsubscribe(client: Client, projectId: string): Promise<void> {
    if (!client.projects.delete(projectId)) return;
    const sockets = this.local.get(projectId);
    sockets?.delete(client);
    if (sockets?.size === 0) {
      this.local.delete(projectId);
      await this.subscriber.unsubscribe(projectChannel(projectId));
    }
    await this.presence.leave(projectId, client.userId, client.connectionId);
    await this.broadcastPresence(projectId);
  }

  private async onClose(client: Client): Promise<void> {
    this.clients.delete(client);
    for (const projectId of [...client.projects]) {
      await this.unsubscribe(client, projectId).catch((err: unknown) => {
        this.logger.warn({ err }, 'cleanup after close failed');
      });
    }
  }

  private async broadcastPresence(projectId: string): Promise<void> {
    const users = await this.presence.online(projectId);
    await this.publisher.publish(projectId, 'presence.updated', { projectId, users });
  }

  /** Stops the reaper and drops the Redis subscriber; sockets are closed by @fastify/websocket. */
  async close(): Promise<void> {
    clearInterval(this.reaper);
    await this.subscriber.quit();
  }
}

function send(client: Client, message: string): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message);
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
