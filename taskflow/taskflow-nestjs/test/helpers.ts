import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../src/app.setup.js';
import type { Env } from '../src/config/env.js';
import { WorkspaceMember } from '../src/database/entities/workspace-member.entity.js';
import { REDIS } from '../src/infra/redis.module.js';
import { QUEUE_NAME } from '../src/jobs/jobs.service.js';
import type { Role } from '../src/modules/access/roles.js';

export interface TestContext {
  app: NestExpressApplication;
  server: Server;
  /** Set when the context was created with `listen: true`. */
  port: number;
  config: ConfigService<Env, true>;
  dataSource: DataSource;
  redis: Redis;
  queue: Queue;
  close: () => Promise<void>;
}

/**
 * Builds the real AppModule through Nest's testing module: same providers, same wiring.
 * Supertest talks to the HTTP server directly, so most tests need no port; the WebSocket
 * tests pass `listen: true` to get one. `imports` adds modules the API doesn't load itself.
 */
export async function createTestContext(
  options: { listen?: boolean; imports?: Type[] } = {},
): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app);
  if (options.listen) await app.listen(0, '127.0.0.1');
  else await app.init();
  const server: Server = app.getHttpServer();
  return {
    app,
    server,
    port: options.listen ? (server.address() as AddressInfo).port : 0,
    config: app.get<ConfigService<Env, true>>(ConfigService),
    dataSource: app.get(DataSource),
    redis: app.get<Redis>(REDIS),
    queue: app.get<Queue>(getQueueToken(QUEUE_NAME)),
    close: () => app.close(),
  };
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SendOptions {
  as?: { auth: Record<string, string> };
  body?: string | object;
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

/** What the tests read from a response: the same shape in every TaskFlow backend's test suite. */
export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- like fetch's res.json()
  json: <T = unknown>() => T;
}

/**
 * One request through Supertest. Pass `status` to assert it; on a mismatch the failure
 * message shows the response body.
 */
export async function send(
  ctx: TestContext,
  method: Method,
  url: string,
  options: SendOptions = {},
  status?: number,
): Promise<TestResponse> {
  let req = request(ctx.server)
    [method.toLowerCase() as Lowercase<Method>](url)
    .set({ ...options.as?.auth, ...options.headers });
  if (options.query) req = req.query(options.query);
  if (options.body !== undefined) req = req.send(options.body);
  const res = await req;
  if (status !== undefined) expect(res.status, `${method} ${url}: ${res.text}`).toBe(status);
  return {
    status: res.status,
    headers: res.headers,
    text: res.text,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    json: <T>() => res.body as T,
  };
}

const TABLES = [
  'activity_events',
  'attachments',
  'comments',
  'tasks',
  'board_columns',
  'projects',
  'invitations',
  'workspace_members',
  'workspaces',
  'users',
];

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.dataSource.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  await ctx.redis.flushdb();
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

let counter = 0;

export async function registerUser(ctx: TestContext, name = 'User'): Promise<TestUser> {
  counter++;
  const email = `${name.toLowerCase().replace(/\W/g, '')}${counter}@example.com`;
  const res = await send(
    ctx,
    'POST',
    '/api/v1/auth/register',
    { body: { email, password: 'correct-horse-battery', displayName: name } },
    201,
  );
  const body = res.json<{ accessToken: string; user: { id: string } }>();
  return {
    id: body.user.id,
    email,
    token: body.accessToken,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}

export interface WorkspaceFixture {
  owner: TestUser;
  workspaceId: string;
}

/** A fresh owner with their own workspace. */
export async function createWorkspace(ctx: TestContext): Promise<WorkspaceFixture> {
  const owner = await registerUser(ctx, 'Owner');
  const ws = await send(
    ctx,
    'POST',
    '/api/v1/workspaces',
    { as: owner, body: { name: 'Acme', slug: `acme-${counter}` } },
    201,
  );
  return { owner, workspaceId: ws.json<{ id: string }>().id };
}

/** Adds an existing user to a workspace with a role, bypassing invitations. */
export async function addMember(
  ctx: TestContext,
  workspaceId: string,
  user: TestUser,
  role: Role,
): Promise<void> {
  await ctx.dataSource
    .getRepository(WorkspaceMember)
    .insert({ workspaceId, userId: user.id, role });
}

export interface Fixture extends WorkspaceFixture {
  projectId: string;
  columnIds: string[];
}

/** A workspace plus a project, which comes with 3 default columns. */
export async function createFixture(ctx: TestContext): Promise<Fixture> {
  const { owner, workspaceId } = await createWorkspace(ctx);
  const project = await send(
    ctx,
    'POST',
    `/api/v1/workspaces/${workspaceId}/projects`,
    { as: owner, body: { name: 'TaskFlow', key: 'TF' } },
    201,
  );
  const projectId = project.json<{ id: string }>().id;
  const board = await send(ctx, 'GET', `/api/v1/projects/${projectId}/board`, { as: owner }, 200);
  const columnIds = board.json<{ columns: { id: string }[] }>().columns.map((c) => c.id);
  return { owner, workspaceId, projectId, columnIds };
}
