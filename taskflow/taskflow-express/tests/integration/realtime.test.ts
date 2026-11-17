import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../../src/app.js';
import { RealtimeGateway } from '../../src/modules/realtime/gateway.js';
import {
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
  type TestContext,
} from '../helpers.js';

interface Envelope {
  type: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

/** One "API instance": its own HTTP server, gateway and Redis subscriber connection. */
async function startInstance(ctx: TestContext) {
  const server: Server = createServer(createApp(ctx.infra, ctx.services));
  const gateway = new RealtimeGateway(
    ctx.infra.redis.duplicate(),
    ctx.services.tickets,
    ctx.services.access,
    ctx.services.presence,
    ctx.services.realtime,
    ctx.infra.logger,
  );
  server.on('upgrade', (req, socket, head) => {
    gateway.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    request: supertest(server),
    stop: async () => {
      await gateway.close();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

class TestSocket {
  private readonly received: Envelope[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.received.push(JSON.parse((data as Buffer).toString('utf8')) as Envelope);
      for (const w of this.waiters) w();
    });
  }

  static open(port: number, ticket: string): Promise<TestSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
    const socket = new TestSocket(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => {
        resolve(socket);
      });
      ws.once('error', reject);
    });
  }

  send(message: Envelope) {
    this.ws.send(JSON.stringify(message));
  }

  /** Resolves with the first message of `type` (already received or arriving within 5 s). */
  next(type: string, match: (e: Envelope) => boolean = () => true): Promise<Envelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${type}`));
      }, 5000);
      const check = () => {
        const index = this.received.findIndex((e) => e.type === type && match(e));
        if (index === -1) return;
        const [found] = this.received.splice(index, 1);
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        if (found) resolve(found);
      };
      this.waiters.push(check);
      check();
    });
  }
}

const ctx = createTestContext();
let a: Awaited<ReturnType<typeof startInstance>>;
let b: Awaited<ReturnType<typeof startInstance>>;
let f: Fixture;

beforeAll(async () => {
  a = await startInstance(ctx);
  b = await startInstance(ctx);
});
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(async () => {
  await a.stop();
  await b.stop();
  await ctx.close();
});

async function ticketFor(auth: Record<string, string>) {
  const res = await a.request.post('/api/v1/ws/ticket').set(auth).expect(201);
  return (res.body as { ticket: string }).ticket;
}

describe('realtime', () => {
  it('fans events out across instances through Redis Pub/Sub', async () => {
    const socket = await TestSocket.open(a.port, await ticketFor(f.owner.auth));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await socket.next('subscribed');
    const presence = await socket.next('presence.updated');
    expect(presence.payload).toMatchObject({ projectId: f.projectId, users: [{ id: f.owner.id }] });

    // The write goes through instance B; the socket lives on instance A.
    await b.request
      .post(`/api/v1/projects/${f.projectId}/tasks`)
      .set(f.owner.auth)
      .send({ title: 'Live!' })
      .expect(201);
    const event = await socket.next('task.created');
    expect(event.payload).toMatchObject({ title: 'Live!', key: 'TF-1' });
    expect(event.ts).toMatch(/Z$/);

    socket.send({ type: 'ping' });
    await socket.next('pong');
    socket.ws.close();
  });

  it('closes with 4401 for a bad ticket, and tickets are single-use', async () => {
    const closeCode = (ws: WebSocket) =>
      new Promise<number>((resolve) =>
        ws.once('close', (code) => {
          resolve(code);
        }),
      );

    const bad = new WebSocket(`ws://127.0.0.1:${a.port}/ws?ticket=nope`);
    expect(await closeCode(bad)).toBe(4401);

    const ticket = await ticketFor(f.owner.auth);
    const first = await TestSocket.open(a.port, ticket);
    const reused = new WebSocket(`ws://127.0.0.1:${a.port}/ws?ticket=${ticket}`);
    expect(await closeCode(reused)).toBe(4401);
    first.ws.close();
  });

  it('refuses subscriptions to projects outside your workspaces', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    const socket = await TestSocket.open(a.port, await ticketFor(outsider.auth));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    const error = await socket.next('error');
    expect(error.payload).toMatchObject({ code: 'not_found' });
    socket.send({ type: 'nonsense' });
    expect((await socket.next('error')).payload).toMatchObject({ code: 'bad_message' });
    socket.ws.close();
  });

  it('updates presence when a viewer leaves', async () => {
    const other = await registerUser(ctx, 'Other');
    await ctx.infra.prisma.workspaceMember.create({
      data: { workspaceId: f.workspaceId, userId: other.id, role: 'viewer' },
    });
    const watcher = await TestSocket.open(a.port, await ticketFor(f.owner.auth));
    watcher.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('subscribed');

    const leaver = await TestSocket.open(b.port, await ticketFor(other.auth));
    leaver.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 2);

    leaver.ws.close();
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 1);
    watcher.ws.close();
  });
});
