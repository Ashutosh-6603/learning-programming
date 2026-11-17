import type { IncomingMessage } from 'node:http';
import { Inject, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';
import { WebSocket } from 'ws';
import { ProblemError } from '../../common/problem.js';
import { REDIS } from '../../infra/redis.module.js';
import { AccessService } from '../access/access.service.js';
import { Presence } from './presence.service.js';
import { envelope, projectChannel, RealtimePublisher } from './realtime.publisher.js';
import { Tickets } from './tickets.service.js';

export const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BAD_MESSAGES = 4400;
const CLOSE_GOING_AWAY = 1001;
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

interface ProjectPayload {
  projectId: string;
}

/** The ws server shares the HTTP server and answers upgrades on /ws. */
@WebSocketGateway({ path: '/ws', maxPayload: 16 * 1024 })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  /** projectId → this instance's sockets watching it. */
  private readonly local = new Map<string, Set<Client>>();
  /**
   * socket → its client, once the ticket is redeemed (null if it was refused). A promise,
   * because Nest starts delivering a socket's messages without waiting for handleConnection.
   */
  private readonly sessions = new Map<WebSocket, Promise<Client | null>>();
  private readonly clients = new Set<Client>();
  // A Redis connection in SUBSCRIBE mode can't run other commands, so it gets its own.
  private readonly subscriber: Redis;
  private readonly reaper: NodeJS.Timeout;

  constructor(
    @Inject(REDIS) redis: Redis,
    private readonly access: AccessService,
    private readonly presence: Presence,
    private readonly publisher: RealtimePublisher,
    private readonly tickets: Tickets,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeGateway.name);
    this.subscriber = redis.duplicate();
    this.subscriber.on('message', (channel: string, message: string) => {
      const projectId = channel.slice('project:'.length);
      for (const client of this.local.get(projectId) ?? []) send(client.ws, message);
    });
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
      for (const client of this.clients) if (client.lastSeen < cutoff) client.ws.terminate();
    }, 30_000);
  }

  handleConnection(ws: WebSocket, request: IncomingMessage): void {
    ws.on('error', (err) => {
      this.logger.warn({ err }, 'websocket error');
    });
    this.sessions.set(ws, this.authenticate(ws, request));
  }

  private async authenticate(ws: WebSocket, request: IncomingMessage): Promise<Client | null> {
    const ticket = new URL(request.url ?? '/', 'http://localhost').searchParams.get('ticket');
    const userId = ticket ? await this.tickets.redeem(ticket).catch(() => null) : null;
    // The handshake is already accepted; close with a code the browser can read.
    if (userId === null) {
      ws.close(CLOSE_UNAUTHORIZED, 'invalid or expired ticket');
      return null;
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
    return client;
  }

  @SubscribeMessage('subscribe')
  onSubscribe(@ConnectedSocket() ws: WebSocket, @MessageBody() { projectId }: ProjectPayload) {
    return this.handle(ws, (client) => this.subscribe(client, projectId));
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(@ConnectedSocket() ws: WebSocket, @MessageBody() { projectId }: ProjectPayload) {
    return this.handle(ws, (client) => this.unsubscribe(client, projectId));
  }

  @SubscribeMessage('ping')
  onPing(@ConnectedSocket() ws: WebSocket) {
    return this.handle(ws, async (client) => {
      for (const projectId of client.projects) {
        await this.presence.touch(projectId, client.userId, client.connectionId);
      }
      send(ws, envelope('pong'));
    });
  }

  /** Where the message parser sends anything it couldn't understand. */
  @SubscribeMessage('invalid')
  onInvalid(@ConnectedSocket() ws: WebSocket) {
    return this.handle(ws, (client) => {
      client.badMessages++;
      if (client.badMessages > MAX_BAD_MESSAGES) {
        ws.close(CLOSE_BAD_MESSAGES, 'too many malformed messages');
        return;
      }
      send(ws, envelope('error', { code: 'bad_message', message: 'Malformed message' }));
    });
  }

  /** Shared by every handler: wait for the session, note the activity, turn errors into frames. */
  private async handle(ws: WebSocket, action: (client: Client) => Promise<void> | void) {
    const client = await this.sessions.get(ws);
    if (!client) return;
    client.lastSeen = Date.now();
    try {
      await action(client);
    } catch (err) {
      if (err instanceof ProblemError && (err.status === 404 || err.status === 403)) {
        const code = err.status === 404 ? 'not_found' : 'forbidden';
        send(ws, envelope('error', { code, message: err.message }));
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
    send(client.ws, envelope('subscribed', { projectId }));
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

  async handleDisconnect(ws: WebSocket): Promise<void> {
    const client = await this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!client) return;
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

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.reaper);
    for (const ws of this.sessions.keys()) ws.close(CLOSE_GOING_AWAY, 'server shutting down');
    await this.subscriber.quit();
  }
}

function send(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(message);
}
