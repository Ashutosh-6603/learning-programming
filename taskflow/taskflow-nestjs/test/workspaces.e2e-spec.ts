import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestContext,
  createWorkspace,
  registerUser,
  resetState,
  send,
  type TestUser,
} from './helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('workspaces', () => {
  it('lists my workspaces newest first with cursor pagination', async () => {
    const user = await registerUser(ctx, 'Ada');
    for (const slug of ['one', 'two', 'three']) {
      await send(ctx, 'POST', '/api/v1/workspaces', { as: user, body: { name: slug, slug } }, 201);
    }
    const page1 = await send(ctx, 'GET', '/api/v1/workspaces?limit=2', { as: user }, 200);
    const body1 = page1.json<{
      items: { slug: string; currentUserRole: string }[];
      nextCursor: string;
    }>();
    expect(body1.items.map((w) => w.slug)).toEqual(['three', 'two']);
    expect(body1.items[0]?.currentUserRole).toBe('owner');
    const page2 = await send(
      ctx,
      'GET',
      `/api/v1/workspaces?limit=2&cursor=${body1.nextCursor}`,
      { as: user },
      200,
    );
    expect(page2.json()).toMatchObject({ items: [{ slug: 'one' }], nextCursor: null });
  });

  it('hides workspaces from non-members (404) and enforces roles (403)', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}`;
    const stranger = await registerUser(ctx, 'Stranger');
    await send(ctx, 'GET', url, { as: stranger }, 404);

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, member, 'member');
    await send(ctx, 'GET', url, { as: member }, 200);
    await send(ctx, 'PATCH', url, { as: member, body: { name: 'Hijacked' } }, 403);
    await send(ctx, 'DELETE', url, { as: member }, 403);
  });

  it('rejects a taken slug with 409 and an invalid path id with 422', async () => {
    const user = await registerUser(ctx, 'Ada');
    const create = (name: string, status: number) =>
      send(ctx, 'POST', '/api/v1/workspaces', { as: user, body: { name, slug: 'same' } }, status);
    await create('A', 201);
    await create('B', 409);
    const res = await send(ctx, 'GET', '/api/v1/workspaces/not-a-uuid', { as: user }, 422);
    expect(res.json()).toMatchObject({ errors: [{ field: 'path.workspaceId' }] });
  });

  it('lets the owner rename and delete the workspace', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}`;
    const renamed = await send(ctx, 'PATCH', url, { as: owner, body: { name: 'Acme Inc.' } }, 200);
    expect(renamed.json()).toMatchObject({ name: 'Acme Inc.', currentUserRole: 'owner' });
    await send(ctx, 'DELETE', url, { as: owner }, 204);
    await send(ctx, 'GET', url, { as: owner }, 404);
  });
});

describe('members', () => {
  it('lets admins manage members and viewers but not other admins', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const otherAdmin = await registerUser(ctx, 'Admin2');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, otherAdmin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');

    const url = (u: TestUser) => `/api/v1/workspaces/${workspaceId}/members/${u.id}`;
    const res = await send(ctx, 'PATCH', url(member), { as: admin, body: { role: 'viewer' } }, 200);
    expect(res.json()).toMatchObject({ user: { id: member.id }, role: 'viewer' });
    await send(ctx, 'PATCH', url(member), { as: admin, body: { role: 'admin' } }, 403);
    await send(ctx, 'PATCH', url(otherAdmin), { as: admin, body: { role: 'member' } }, 403);
    await send(ctx, 'DELETE', url(otherAdmin), { as: admin }, 403);
    await send(ctx, 'DELETE', url(member), { as: admin }, 204);
  });

  it('never leaves a workspace without an owner', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}/members/${owner.id}`;
    await send(ctx, 'PATCH', url, { as: owner, body: { role: 'admin' } }, 409);
    await send(ctx, 'DELETE', url, { as: owner }, 409);

    const second = await registerUser(ctx, 'Second');
    await addMember(ctx, workspaceId, second, 'owner');
    await send(ctx, 'DELETE', url, { as: owner }, 204);
  });

  it('lists members in join order', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const late = await registerUser(ctx, 'Late');
    await addMember(ctx, workspaceId, late, 'viewer');
    const res = await send(
      ctx,
      'GET',
      `/api/v1/workspaces/${workspaceId}/members`,
      { as: late },
      200,
    );
    const ids = res.json<{ items: { user: { id: string } }[] }>().items.map((m) => m.user.id);
    expect(ids).toEqual([owner.id, late.id]);
  });
});

describe('invitations', () => {
  it('invites by email, queues the email, and lets the invitee join', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const invitations = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invitee = await registerUser(ctx, 'Invitee');
    const created = await send(
      ctx,
      'POST',
      invitations,
      { as: owner, body: { email: invitee.email.toUpperCase(), role: 'member' } },
      201,
    );
    expect(created.json()).toMatchObject({
      email: invitee.email,
      role: 'member',
      invitedBy: { id: owner.id },
    });

    const jobs = await ctx.queue.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'send-invitation-email');
    const token = (job?.data as { token: string }).token;
    expect(token).toBeTruthy();

    await send(
      ctx,
      'POST',
      invitations,
      { as: owner, body: { email: invitee.email, role: 'viewer' } },
      409,
    );

    const accept = (who: TestUser, status: number) =>
      send(ctx, 'POST', '/api/v1/invitations/accept', { as: who, body: { token } }, status);
    await accept(await registerUser(ctx, 'Stranger'), 403);
    const joined = await accept(invitee, 200);
    expect(joined.json()).toMatchObject({ id: workspaceId, currentUserRole: 'member' });
    await accept(invitee, 404);

    const pending = await send(ctx, 'GET', invitations, { as: owner }, 200);
    expect(pending.json()).toMatchObject({ items: [], nextCursor: null });
  });

  it('only owners invite admins; members cannot invite at all', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');
    const url = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invite = (who: TestUser, role: string) =>
      send(ctx, 'POST', url, { as: who, body: { email: 'x@example.com', role } });
    expect((await invite(admin, 'admin')).status).toBe(403);
    expect((await invite(member, 'viewer')).status).toBe(403);
    const ok = await invite(admin, 'viewer');
    expect(ok.status).toBe(201);
    await send(ctx, 'DELETE', `${url}/${ok.json<{ id: string }>().id}`, { as: admin }, 204);
  });
});
