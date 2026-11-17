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

async function createTask(title: string, description?: string) {
  const res = await ctx.request
    .post(`/api/v1/projects/${f.projectId}/tasks`)
    .set(f.owner.auth)
    .send({ title, description })
    .expect(201);
  return (res.body as { id: string }).id;
}

describe('comments', () => {
  it('lists oldest first; only the author edits; author or admin deletes', async () => {
    const taskId = await createTask('Discuss me');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const url = `/api/v1/tasks/${taskId}/comments`;
    const first = await ctx.request.post(url).set(member.auth).send({ body: 'first' }).expect(201);
    await ctx.request.post(url).set(f.owner.auth).send({ body: 'second' }).expect(201);
    const firstId = (first.body as { id: string }).id;

    const list = await ctx.request.get(url).set(member.auth).expect(200);
    const bodies = (list.body as { items: { body: string }[] }).items.map((c) => c.body);
    expect(bodies).toEqual(['first', 'second']);

    await ctx.request
      .patch(`/api/v1/comments/${firstId}`)
      .set(f.owner.auth)
      .send({ body: 'hijack' })
      .expect(403);
    const edited = await ctx.request
      .patch(`/api/v1/comments/${firstId}`)
      .set(member.auth)
      .send({ body: 'edited' })
      .expect(200);
    expect(edited.body).toMatchObject({ body: 'edited', author: { id: member.id } });
    await ctx.request.delete(`/api/v1/comments/${firstId}`).set(f.owner.auth).expect(204);
  });
});

describe('activity', () => {
  it('records every change in the same transaction, newest first', async () => {
    const taskId = await createTask('Doomed');
    await ctx.request.delete(`/api/v1/tasks/${taskId}`).set(f.owner.auth).expect(204);
    const forTask = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/activity?taskId=${taskId}`)
      .set(f.owner.auth)
      .expect(200);
    const types = (forTask.body as { items: { type: string }[] }).items.map((e) => e.type);
    expect(types).toEqual(['task.deleted', 'task.created']);

    const all = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/activity?limit=100`)
      .set(f.owner.auth)
      .expect(200);
    const allTypes = (all.body as { items: { type: string }[] }).items.map((e) => e.type);
    expect(allTypes.at(-1)).toBe('workspace.created');
  });
});

describe('search', () => {
  it('ranks title matches first, escapes headlines, and pages by (rank, id)', async () => {
    await createTask('Write docs', 'Explain the <b>login</b> flow');
    await createTask('Fix login redirect', 'Users bounce back');
    await createTask('Unrelated', 'Nothing here');

    const url = `/api/v1/workspaces/${f.workspaceId}/search`;
    const res = await ctx.request.get(url).query({ q: 'login' }).set(f.owner.auth).expect(200);
    const hits = (res.body as { items: { task: { title: string }; headline: string }[] }).items;
    expect(hits.map((h) => h.task.title)).toEqual(['Fix login redirect', 'Write docs']);
    // Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    expect(hits[1]?.headline).toContain('<mark>login</mark>');
    expect(hits[1]?.headline).not.toContain('<b>');

    const page1 = await ctx.request
      .get(url)
      .query({ q: 'login', limit: 1 })
      .set(f.owner.auth)
      .expect(200);
    const cursor = (page1.body as { nextCursor: string }).nextCursor;
    const page2 = await ctx.request
      .get(url)
      .query({ q: 'login', limit: 1, cursor })
      .set(f.owner.auth)
      .expect(200);
    const body2 = page2.body as { items: { task: { title: string } }[]; nextCursor: null };
    expect(body2.items[0]?.task.title).toBe('Write docs');
    expect(body2.nextCursor).toBeNull();
  });

  it('only searches workspaces the caller belongs to', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/search?q=docs`)
      .set(outsider.auth)
      .expect(404);
  });
});
