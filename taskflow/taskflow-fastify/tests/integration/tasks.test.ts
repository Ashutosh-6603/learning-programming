import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from '../helpers.js';

const ctx = await createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

interface TaskBody {
  id: string;
  key: string;
  number: number;
  columnId: string;
  position: string;
  title: string;
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title, ...extra } },
    201,
  );
  return res.json<TaskBody>();
}

async function boardTitles() {
  const res = await send(ctx, 'GET', `/api/v1/projects/${f.projectId}/board`, { as: f.owner }, 200);
  const { columns } = res.json<{ columns: { name: string; tasks: { title: string }[] }[] }>();
  return columns.map((c) => [c.name, c.tasks.map((t) => t.title)]);
}

const move = (
  taskId: string,
  columnId: string | undefined,
  afterTaskId: string | null,
  status: number,
) =>
  send(
    ctx,
    'POST',
    `/api/v1/tasks/${taskId}/move`,
    { as: f.owner, body: { columnId, afterTaskId } },
    status,
  );

describe('tasks', () => {
  it('numbers tasks per project, even under concurrent creates', async () => {
    const tasks = await Promise.all(Array.from({ length: 10 }, (_, i) => createTask(`Task ${i}`)));
    expect(tasks.map((t) => t.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(tasks.find((t) => t.number === 7)?.key).toBe('TF-7');
  });

  it('appends to the bottom and moves with fractional positions', async () => {
    const a = await createTask('A');
    const b = await createTask('B');
    const c = await createTask('C');
    expect(a.position < b.position && b.position < c.position).toBe(true);

    await move(c.id, f.columnIds[0], null, 200); // C to the top of To Do
    await move(a.id, f.columnIds[2], null, 200); // A to the top of Done
    const moved = await move(b.id, f.columnIds[2], a.id, 200); // B after A
    expect(moved.json<TaskBody>().columnId).toBe(f.columnIds[2]);

    expect(await boardTitles()).toEqual([
      ['To Do', ['C']],
      ['In Progress', []],
      ['Done', ['A', 'B']],
    ]);
  });

  it('validates move targets', async () => {
    const a = await createTask('A');
    const other = await send(
      ctx,
      'POST',
      `/api/v1/workspaces/${f.workspaceId}/projects`,
      { as: f.owner, body: { name: 'Other', key: 'OT' } },
      201,
    );
    const otherBoard = await send(
      ctx,
      'GET',
      `/api/v1/projects/${other.json<{ id: string }>().id}/board`,
      { as: f.owner },
      200,
    );
    const foreignColumn = otherBoard.json<{ columns: { id: string }[] }>().columns[0]?.id;
    const res = await move(a.id, foreignColumn, null, 422);
    expect(res.json()).toMatchObject({ errors: [{ field: 'columnId' }] });
    await move(a.id, f.columnIds[0], a.id, 422);
  });

  it('serves the board from cache and invalidates it on writes', async () => {
    await createTask('Cached');
    await boardTitles();
    expect(await ctx.infra.redis.exists(`cache:board:${f.projectId}`)).toBe(1);
    await createTask('Fresh');
    expect(await ctx.infra.redis.exists(`cache:board:${f.projectId}`)).toBe(0);
    expect((await boardTitles())[0]).toEqual(['To Do', ['Cached', 'Fresh']]);
  });

  it('PATCH uses merge semantics: omitted fields stay, null clears', async () => {
    const t = await createTask('Patch me', {
      description: 'keep',
      dueAt: '2030-01-01T09:00:00Z',
    });
    const res = await send(
      ctx,
      'PATCH',
      `/api/v1/tasks/${t.id}`,
      { as: f.owner, body: { dueAt: null, priority: 'high' } },
      200,
    );
    expect(res.json()).toMatchObject({
      description: 'keep',
      dueAt: null,
      priority: 'high',
      title: 'Patch me',
    });
  });

  it('only assigns workspace members, and unassigns them when they leave', async () => {
    const stranger = await registerUser(ctx, 'Stranger');
    const rejected = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/tasks`,
      { as: f.owner, body: { title: 'X', assigneeId: stranger.id } },
      422,
    );
    expect(rejected.json()).toMatchObject({ errors: [{ field: 'assigneeId' }] });

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const t = await createTask('Assigned', { assigneeId: member.id });
    await send(
      ctx,
      'DELETE',
      `/api/v1/workspaces/${f.workspaceId}/members/${member.id}`,
      { as: member },
      204,
    );
    const after = await send(ctx, 'GET', `/api/v1/tasks/${t.id}`, { as: f.owner }, 200);
    expect(after.json()).toMatchObject({ assignee: null });
  });

  it('filters and paginates the task list newest first', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    for (let i = 1; i <= 5; i++) {
      await createTask(`T${i}`, i % 2 ? { assigneeId: member.id, priority: 'high' } : {});
    }
    const tasks = `/api/v1/projects/${f.projectId}/tasks`;
    const list = (q: string) => send(ctx, 'GET', `${tasks}?${q}`, { as: f.owner }, 200);
    const titles = (res: LightMyRequestResponse) =>
      res.json<{ items: TaskBody[] }>().items.map((t) => t.title);

    expect(titles(await list(`assigneeId=${member.id}`))).toEqual(['T5', 'T3', 'T1']);
    expect(titles(await list('assigneeId=none'))).toEqual(['T4', 'T2']);
    expect(titles(await list('priority=high&limit=2'))).toEqual(['T5', 'T3']);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list(`limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(res));
      cursor = res.json<{ nextCursor: string | null }>().nextCursor;
    } while (cursor);
    expect(seen).toEqual(['T5', 'T4', 'T3', 'T2', 'T1']);
    await send(ctx, 'GET', `${tasks}?cursor=garbage`, { as: f.owner }, 422);
  });

  it('lets viewers read but not write, and hides tasks from outsiders', async () => {
    const t = await createTask('Secret');
    const task = `/api/v1/tasks/${t.id}`;
    const viewer = await registerUser(ctx, 'Viewer');
    const outsider = await registerUser(ctx, 'Outsider');
    await addMember(ctx, f.workspaceId, viewer, 'viewer');
    await send(ctx, 'GET', task, { as: viewer }, 200);
    await send(ctx, 'PATCH', task, { as: viewer, body: { title: 'x' } }, 403);
    await send(ctx, 'GET', task, { as: outsider }, 404);
  });

  it('refuses to delete a column that still has tasks', async () => {
    const t = await createTask('Blocker', { columnId: f.columnIds[1] });
    const column = `/api/v1/columns/${f.columnIds[1] ?? ''}`;
    await send(ctx, 'DELETE', column, { as: f.owner }, 409);
    await send(ctx, 'DELETE', `/api/v1/tasks/${t.id}`, { as: f.owner }, 204);
    await send(ctx, 'GET', `/api/v1/tasks/${t.id}`, { as: f.owner }, 404);
    await send(ctx, 'DELETE', column, { as: f.owner }, 204);
  });
});
