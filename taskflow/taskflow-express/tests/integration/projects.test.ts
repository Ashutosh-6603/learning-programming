import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
} from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function columnNames() {
  const res = await ctx.request
    .get(`/api/v1/projects/${f.projectId}/board`)
    .set(f.owner.auth)
    .expect(200);
  return (res.body as { columns: { name: string }[] }).columns.map((c) => c.name);
}

describe('projects', () => {
  it('creates three default columns and rejects a duplicate key', async () => {
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
    await ctx.request
      .post(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .send({ name: 'Again', key: 'TF' })
      .expect(409);
  });

  it('lists projects newest first and updates them', async () => {
    await ctx.request
      .post(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .send({ name: 'Second', key: 'SEC', description: 'Another one' })
      .expect(201);
    const list = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .expect(200);
    expect((list.body as { items: { key: string }[] }).items.map((p) => p.key)).toEqual([
      'SEC',
      'TF',
    ]);
    const updated = await ctx.request
      .patch(`/api/v1/projects/${f.projectId}`)
      .set(f.owner.auth)
      .send({ description: null, name: 'TaskFlow v2' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'TaskFlow v2', description: null, key: 'TF' });
  });

  it('keeps project and column management for admins', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    await ctx.request.get(`/api/v1/projects/${f.projectId}`).set(member.auth).expect(200);
    await ctx.request
      .post(`/api/v1/projects/${f.projectId}/columns`)
      .set(member.auth)
      .send({ name: 'Nope' })
      .expect(403);
    await ctx.request.delete(`/api/v1/projects/${f.projectId}`).set(member.auth).expect(403);
  });

  it('cascades a workspace delete to its projects', async () => {
    await ctx.request.delete(`/api/v1/workspaces/${f.workspaceId}`).set(f.owner.auth).expect(204);
    await ctx.request.get(`/api/v1/projects/${f.projectId}`).set(f.owner.auth).expect(404);
  });
});

describe('columns', () => {
  it('adds, renames, reorders and deletes columns', async () => {
    const created = await ctx.request
      .post(`/api/v1/projects/${f.projectId}/columns`)
      .set(f.owner.auth)
      .send({ name: 'Review', wipLimit: 3 })
      .expect(201);
    const reviewId = (created.body as { id: string }).id;
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);

    await ctx.request
      .patch(`/api/v1/columns/${reviewId}`)
      .set(f.owner.auth)
      .send({ name: 'QA' })
      .expect(200);
    await ctx.request
      .post(`/api/v1/columns/${reviewId}/move`)
      .set(f.owner.auth)
      .send({ afterColumnId: null })
      .expect(200);
    expect(await columnNames()).toEqual(['QA', 'To Do', 'In Progress', 'Done']);

    await ctx.request
      .post(`/api/v1/columns/${reviewId}/move`)
      .set(f.owner.auth)
      .send({ afterColumnId: f.columnIds[1] })
      .expect(200);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'QA', 'Done']);

    await ctx.request.delete(`/api/v1/columns/${reviewId}`).set(f.owner.auth).expect(204);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
  });
});
