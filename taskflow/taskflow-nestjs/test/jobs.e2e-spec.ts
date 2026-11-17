import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Attachment } from '../src/database/entities/attachment.entity.js';
import { JobHandlersModule } from '../src/jobs/job-handlers.module.js';
import { JobHandlers } from '../src/jobs/job-handlers.service.js';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from './helpers.js';

// The API never loads the job handlers; the test adds their module next to AppModule.
// No JobsProcessor is registered, so no worker runs and queued jobs stay inspectable.
const ctx = await createTestContext({ imports: [JobHandlersModule] });
const handlers = ctx.app.get(JobHandlers);
const config = ctx.config;
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:18003';

interface MailpitMessage {
  Subject: string;
  To: { Address: string }[];
  ID: string;
}

async function inbox(to: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  await ctx.queue.obliterate({ force: true });
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

describe('jobs', () => {
  it('sends the invitation email with an accept link', async () => {
    const email = `invitee-${Date.now()}@example.com`;
    await handlers.sendInvitationEmail({
      email,
      workspaceName: 'Acme',
      inviterName: 'Owner',
      token: 'tok-123',
    });
    const [message] = await inbox(email);
    expect(message?.Subject).toBe('Owner invited you to Acme on TaskFlow');
    const full = (await (await fetch(`${mailpit}/api/v1/message/${message?.ID ?? ''}`)).json()) as {
      Text: string;
    };
    const frontendUrl = config.get('FRONTEND_URL', { infer: true });
    expect(full.Text).toContain(`${frontendUrl}/invitations/accept?token=tok-123`);
  });

  it('claims each due-soon task exactly once, then emails the assignee', async () => {
    const assignee = await registerUser(ctx, 'Assignee');
    await addMember(ctx, f.workspaceId, assignee, 'member');
    const create = (title: string, dueInHours: number, assigned = true) =>
      send(
        ctx,
        'POST',
        `/api/v1/projects/${f.projectId}/tasks`,
        {
          as: f.owner,
          body: {
            title,
            dueAt: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
            ...(assigned ? { assigneeId: assignee.id } : {}),
          },
        },
        201,
      );
    await create('Due soon', 2);
    await create('Due later', 72);
    await create('Nobody assigned', 2, false);

    expect(await handlers.scanDueReminders()).toEqual({ claimed: 1 });
    expect(await handlers.scanDueReminders()).toEqual({ claimed: 0 });

    const [job] = await ctx.queue.getJobs(['waiting']);
    expect(job?.name).toBe('send-due-reminder');
    // Through run(), the way the worker dispatches it.
    expect(await handlers.run('send-due-reminder', job?.data)).toEqual({ sent: true });
    const [message] = await inbox(assignee.email);
    expect(message?.Subject).toBe('Due soon: TF-1 Due soon');
    await expect(async () => handlers.run('no-such-job', {})).rejects.toThrow(/Unknown job/);
  });

  it('deletes every object under a storage prefix', async () => {
    const s3 = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });
    const prefix = `projects/${f.projectId}/`;
    for (const name of ['a', 'b', 'c']) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.get('S3_BUCKET', { infer: true }),
          Key: `${prefix}tasks/t/${name}`,
          Body: name,
        }),
      );
    }
    s3.destroy();
    expect(await handlers.deleteStoragePrefix({ prefix })).toEqual({ deleted: 3 });
    expect(await handlers.deleteStoragePrefix({ prefix })).toEqual({ deleted: 0 });
  });

  it('removes uploads left pending for more than a day', async () => {
    const task = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/tasks`,
      { as: f.owner, body: { title: 'With upload' } },
      201,
    );
    const created = await send(
      ctx,
      'POST',
      `/api/v1/tasks/${task.json<{ id: string }>().id}/attachments`,
      { as: f.owner, body: { fileName: 'old.txt', contentType: 'text/plain', sizeBytes: 3 } },
      201,
    );
    const id = created.json<{ attachment: { id: string } }>().attachment.id;
    const attachments = ctx.dataSource.getRepository(Attachment);
    await attachments.update({ id }, { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    expect(await handlers.cleanupStaleUploads()).toEqual({ removed: 1 });
    expect(await attachments.count()).toBe(0);
  });
});
