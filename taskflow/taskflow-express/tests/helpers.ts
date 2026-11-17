import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeInfra, createInfra, createServices, type Infra } from '../src/container.js';

export interface TestContext {
  infra: Infra;
  services: ReturnType<typeof createServices>;
  request: ReturnType<typeof supertest>;
  close: () => Promise<void>;
}

export function createTestContext(): TestContext {
  const infra = createInfra(loadConfig());
  const services = createServices(infra);
  const app = createApp(infra, services);
  return { infra, services, request: supertest(app), close: () => closeInfra(infra) };
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
  await ctx.infra.prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
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
  const res = await ctx.request
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery', displayName: name })
    .expect(201);
  const body = res.body as { accessToken: string; user: { id: string } };
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
  const ws = await ctx.request
    .post('/api/v1/workspaces')
    .set(owner.auth)
    .send({ name: 'Acme', slug: `acme-${counter}` })
    .expect(201);
  return { owner, workspaceId: (ws.body as { id: string }).id };
}

/** Adds an existing user to a workspace with a role, bypassing invitations. */
export async function addMember(
  ctx: TestContext,
  workspaceId: string,
  user: TestUser,
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<void> {
  await ctx.infra.prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
}

export interface Fixture extends WorkspaceFixture {
  projectId: string;
  columnIds: string[];
}

/** A workspace plus a project, which comes with 3 default columns. */
export async function createFixture(ctx: TestContext): Promise<Fixture> {
  const { owner, workspaceId } = await createWorkspace(ctx);
  const project = await ctx.request
    .post(`/api/v1/workspaces/${workspaceId}/projects`)
    .set(owner.auth)
    .send({ name: 'TaskFlow', key: 'TF' })
    .expect(201);
  const projectId = (project.body as { id: string }).id;
  const board = await ctx.request
    .get(`/api/v1/projects/${projectId}/board`)
    .set(owner.auth)
    .expect(200);
  const columnIds = (board.body as { columns: { id: string }[] }).columns.map((c) => c.id);
  return { owner, workspaceId, projectId, columnIds };
}
