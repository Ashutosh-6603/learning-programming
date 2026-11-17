import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestContext,
  createWorkspace,
  registerUser,
  resetState,
} from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('workspaces', () => {
  it('lists my workspaces newest first with cursor pagination', async () => {
    const user = await registerUser(ctx, 'Ada');
    for (const slug of ['one', 'two', 'three']) {
      await ctx.request
        .post('/api/v1/workspaces')
        .set(user.auth)
        .send({ name: slug, slug })
        .expect(201);
    }
    const page1 = await ctx.request.get('/api/v1/workspaces?limit=2').set(user.auth).expect(200);
    const body1 = page1.body as {
      items: { slug: string; currentUserRole: string }[];
      nextCursor: string;
    };
    expect(body1.items.map((w) => w.slug)).toEqual(['three', 'two']);
    expect(body1.items[0]?.currentUserRole).toBe('owner');
    const page2 = await ctx.request
      .get(`/api/v1/workspaces?limit=2&cursor=${body1.nextCursor}`)
      .set(user.auth)
      .expect(200);
    expect(page2.body).toMatchObject({ items: [{ slug: 'one' }], nextCursor: null });
  });

  it('hides workspaces from non-members (404) and enforces roles (403)', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const stranger = await registerUser(ctx, 'Stranger');
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(stranger.auth).expect(404);

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, member, 'member');
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(member.auth).expect(200);
    await ctx.request
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(member.auth)
      .send({ name: 'Hijacked' })
      .expect(403);
    await ctx.request.delete(`/api/v1/workspaces/${workspaceId}`).set(member.auth).expect(403);
  });

  it('rejects a taken slug with 409 and an invalid path id with 422', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/workspaces')
      .set(user.auth)
      .send({ name: 'A', slug: 'same' })
      .expect(201);
    await ctx.request
      .post('/api/v1/workspaces')
      .set(user.auth)
      .send({ name: 'B', slug: 'same' })
      .expect(409);
    const res = await ctx.request.get('/api/v1/workspaces/not-a-uuid').set(user.auth).expect(422);
    expect(res.body).toMatchObject({ errors: [{ field: 'path.workspaceId' }] });
  });

  it('lets the owner rename and delete the workspace', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const renamed = await ctx.request
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(owner.auth)
      .send({ name: 'Acme Inc.' })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Acme Inc.', currentUserRole: 'owner' });
    await ctx.request.delete(`/api/v1/workspaces/${workspaceId}`).set(owner.auth).expect(204);
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(owner.auth).expect(404);
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

    const url = (u: string) => `/api/v1/workspaces/${workspaceId}/members/${u}`;
    const res = await ctx.request
      .patch(url(member.id))
      .set(admin.auth)
      .send({ role: 'viewer' })
      .expect(200);
    expect(res.body).toMatchObject({ user: { id: member.id }, role: 'viewer' });
    await ctx.request.patch(url(member.id)).set(admin.auth).send({ role: 'admin' }).expect(403);
    await ctx.request
      .patch(url(otherAdmin.id))
      .set(admin.auth)
      .send({ role: 'member' })
      .expect(403);
    await ctx.request.delete(url(otherAdmin.id)).set(admin.auth).expect(403);
    await ctx.request.delete(url(member.id)).set(admin.auth).expect(204);
  });

  it('never leaves a workspace without an owner', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}/members/${owner.id}`;
    await ctx.request.patch(url).set(owner.auth).send({ role: 'admin' }).expect(409);
    await ctx.request.delete(url).set(owner.auth).expect(409);

    const second = await registerUser(ctx, 'Second');
    await addMember(ctx, workspaceId, second, 'owner');
    await ctx.request.delete(url).set(owner.auth).expect(204);
  });

  it('lists members in join order', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const late = await registerUser(ctx, 'Late');
    await addMember(ctx, workspaceId, late, 'viewer');
    const res = await ctx.request
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set(late.auth)
      .expect(200);
    const ids = (res.body as { items: { user: { id: string } }[] }).items.map((m) => m.user.id);
    expect(ids).toEqual([owner.id, late.id]);
  });
});

describe('invitations', () => {
  it('invites by email, queues the email, and lets the invitee join', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const invitee = await registerUser(ctx, 'Invitee');
    const created = await ctx.request
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .send({ email: invitee.email.toUpperCase(), role: 'member' })
      .expect(201);
    expect(created.body).toMatchObject({
      email: invitee.email,
      role: 'member',
      invitedBy: { id: owner.id },
    });

    const jobs = await ctx.infra.queue.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'send-invitation-email');
    const token = (job?.data as { token: string }).token;
    expect(token).toBeTruthy();

    await ctx.request
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .send({ email: invitee.email, role: 'viewer' })
      .expect(409);

    const stranger = await registerUser(ctx, 'Stranger');
    await ctx.request
      .post('/api/v1/invitations/accept')
      .set(stranger.auth)
      .send({ token })
      .expect(403);
    const joined = await ctx.request
      .post('/api/v1/invitations/accept')
      .set(invitee.auth)
      .send({ token })
      .expect(200);
    expect(joined.body).toMatchObject({ id: workspaceId, currentUserRole: 'member' });
    await ctx.request
      .post('/api/v1/invitations/accept')
      .set(invitee.auth)
      .send({ token })
      .expect(404);

    const pending = await ctx.request
      .get(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .expect(200);
    expect(pending.body).toMatchObject({ items: [], nextCursor: null });
  });

  it('only owners invite admins; members cannot invite at all', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');
    const url = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invite = (who: { auth: Record<string, string> }, role: string) =>
      ctx.request.post(url).set(who.auth).send({ email: 'x@example.com', role });
    expect((await invite(admin, 'admin')).status).toBe(403);
    expect((await invite(member, 'viewer')).status).toBe(403);
    const ok = await invite(admin, 'viewer');
    expect(ok.status).toBe(201);
    await ctx.request
      .delete(`${url}/${(ok.body as { id: string }).id}`)
      .set(admin.auth)
      .expect(204);
  });
});
