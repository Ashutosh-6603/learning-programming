import { sql } from 'drizzle-orm';
import type { FastifyInstance, HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeInfra, createInfra, createServices, type Infra } from '../src/container.js';
import { workspaceMembers } from '../src/db/schema.js';

export interface TestContext {
  infra: Infra;
  services: ReturnType<typeof createServices>;
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const infra = createInfra(loadConfig());
  const services = createServices(infra);
  const app = await buildApp(infra, services);
  await app.ready();
  return {
    infra,
    services,
    app,
    close: async () => {
      await app.close();
      await closeInfra(infra);
    },
  };
}

export interface SendOptions {
  as?: { auth: Record<string, string> };
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

/**
 * `app.inject()` runs the request through Fastify in-process: no socket, no port.
 * Pass `status` to assert it; on a mismatch the failure message shows the response body.
 */
export async function send(
  ctx: TestContext,
  method: HTTPMethods,
  url: string,
  options: SendOptions = {},
  status?: number,
): Promise<LightMyRequestResponse> {
  const res = await ctx.app.inject({
    method,
    url,
    headers: { ...options.as?.auth, ...options.headers },
    ...(options.query ? { query: stringify(options.query) } : {}),
    ...(options.body !== undefined ? { payload: options.body as InjectOptions['payload'] } : {}),
  });
  if (status !== undefined) expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res;
}

const stringify = (query: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));

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
  await ctx.infra.db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} CASCADE`));
  await ctx.infra.redis.flushdb();
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
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<void> {
  await ctx.infra.db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role });
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
