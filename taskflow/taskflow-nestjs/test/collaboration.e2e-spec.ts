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

async function createTask(title: string, description?: string) {
  const res = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title, description } },
    201,
  );
  return res.json<{ id: string }>().id;
}

describe('comments', () => {
  it('lists oldest first; only the author edits; author or admin deletes', async () => {
    const taskId = await createTask('Discuss me');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const url = `/api/v1/tasks/${taskId}/comments`;
    const first = await send(ctx, 'POST', url, { as: member, body: { body: 'first' } }, 201);
    await send(ctx, 'POST', url, { as: f.owner, body: { body: 'second' } }, 201);
    const comment = `/api/v1/comments/${first.json<{ id: string }>().id}`;

    const list = await send(ctx, 'GET', url, { as: member }, 200);
    const bodies = list.json<{ items: { body: string }[] }>().items.map((c) => c.body);
    expect(bodies).toEqual(['first', 'second']);

    await send(ctx, 'PATCH', comment, { as: f.owner, body: { body: 'hijack' } }, 403);
    const edited = await send(ctx, 'PATCH', comment, { as: member, body: { body: 'edited' } }, 200);
    expect(edited.json()).toMatchObject({ body: 'edited', author: { id: member.id } });
    await send(ctx, 'DELETE', comment, { as: f.owner }, 204);
  });
});

describe('activity', () => {
  it('records every change in the same transaction, newest first', async () => {
    const taskId = await createTask('Doomed');
    await send(ctx, 'DELETE', `/api/v1/tasks/${taskId}`, { as: f.owner }, 204);
    const activity = `/api/v1/workspaces/${f.workspaceId}/activity`;
    const forTask = await send(ctx, 'GET', `${activity}?taskId=${taskId}`, { as: f.owner }, 200);
    const types = forTask.json<{ items: { type: string }[] }>().items.map((e) => e.type);
    expect(types).toEqual(['task.deleted', 'task.created']);

    const all = await send(ctx, 'GET', `${activity}?limit=100`, { as: f.owner }, 200);
    const allTypes = all.json<{ items: { type: string }[] }>().items.map((e) => e.type);
    expect(allTypes.at(-1)).toBe('workspace.created');
  });
});

describe('search', () => {
  it('ranks title matches first, escapes headlines, and pages by (rank, id)', async () => {
    await createTask('Write docs', 'Explain the <b>login</b> flow');
    await createTask('Fix login redirect', 'Users bounce back');
    await createTask('Unrelated', 'Nothing here');

    const url = `/api/v1/workspaces/${f.workspaceId}/search`;
    const search = (query: Record<string, string | number>) =>
      send(ctx, 'GET', url, { as: f.owner, query }, 200);
    const res = await search({ q: 'login' });
    const hits = res.json<{ items: { task: { title: string }; headline: string }[] }>().items;
    expect(hits.map((h) => h.task.title)).toEqual(['Fix login redirect', 'Write docs']);
    // Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    expect(hits[1]?.headline).toContain('<mark>login</mark>');
    expect(hits[1]?.headline).not.toContain('<b>');

    const page1 = await search({ q: 'login', limit: 1 });
    const cursor = page1.json<{ nextCursor: string }>().nextCursor;
    const page2 = await search({ q: 'login', limit: 1, cursor });
    const body2 = page2.json<{ items: { task: { title: string } }[]; nextCursor: null }>();
    expect(body2.items[0]?.task.title).toBe('Write docs');
    expect(body2.nextCursor).toBeNull();
  });

  it('only searches workspaces the caller belongs to', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    await send(
      ctx,
      'GET',
      `/api/v1/workspaces/${f.workspaceId}/search?q=docs`,
      { as: outsider },
      404,
    );
  });
});
