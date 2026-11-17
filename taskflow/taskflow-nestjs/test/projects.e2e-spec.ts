import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from './helpers.js';

const ctx = await createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function columnNames() {
  const res = await send(ctx, 'GET', `/api/v1/projects/${f.projectId}/board`, { as: f.owner }, 200);
  return res.json<{ columns: { name: string }[] }>().columns.map((c) => c.name);
}

describe('projects', () => {
  it('creates three default columns and rejects a duplicate key', async () => {
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
    await send(
      ctx,
      'POST',
      `/api/v1/workspaces/${f.workspaceId}/projects`,
      { as: f.owner, body: { name: 'Again', key: 'TF' } },
      409,
    );
  });

  it('lists projects newest first and updates them', async () => {
    const projects = `/api/v1/workspaces/${f.workspaceId}/projects`;
    await send(
      ctx,
      'POST',
      projects,
      { as: f.owner, body: { name: 'Second', key: 'SEC', description: 'Another one' } },
      201,
    );
    const list = await send(ctx, 'GET', projects, { as: f.owner }, 200);
    expect(list.json<{ items: { key: string }[] }>().items.map((p) => p.key)).toEqual([
      'SEC',
      'TF',
    ]);
    const updated = await send(
      ctx,
      'PATCH',
      `/api/v1/projects/${f.projectId}`,
      { as: f.owner, body: { description: null, name: 'TaskFlow v2' } },
      200,
    );
    expect(updated.json()).toMatchObject({ name: 'TaskFlow v2', description: null, key: 'TF' });
  });

  it('keeps project and column management for admins', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const project = `/api/v1/projects/${f.projectId}`;
    await send(ctx, 'GET', project, { as: member }, 200);
    await send(ctx, 'POST', `${project}/columns`, { as: member, body: { name: 'Nope' } }, 403);
    await send(ctx, 'DELETE', project, { as: member }, 403);
  });

  it('cascades a workspace delete to its projects', async () => {
    await send(ctx, 'DELETE', `/api/v1/workspaces/${f.workspaceId}`, { as: f.owner }, 204);
    await send(ctx, 'GET', `/api/v1/projects/${f.projectId}`, { as: f.owner }, 404);
  });
});

describe('columns', () => {
  it('adds, renames, reorders and deletes columns', async () => {
    const created = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/columns`,
      { as: f.owner, body: { name: 'Review', wipLimit: 3 } },
      201,
    );
    const column = `/api/v1/columns/${created.json<{ id: string }>().id}`;
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);

    await send(ctx, 'PATCH', column, { as: f.owner, body: { name: 'QA' } }, 200);
    await send(ctx, 'POST', `${column}/move`, { as: f.owner, body: { afterColumnId: null } }, 200);
    expect(await columnNames()).toEqual(['QA', 'To Do', 'In Progress', 'Done']);

    const afterColumnId = f.columnIds[1];
    await send(ctx, 'POST', `${column}/move`, { as: f.owner, body: { afterColumnId } }, 200);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'QA', 'Done']);

    await send(ctx, 'DELETE', column, { as: f.owner }, 204);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
  });
});
