import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { attachments } from '../../src/db/schema.js';
import { Mailer } from '../../src/jobs/mailer.js';
import { createProcessors } from '../../src/jobs/processors.js';
import { Jobs } from '../../src/jobs/queue.js';
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
const { config } = ctx.infra;
const mailer = new Mailer(config);
const processors = createProcessors({
  db: ctx.infra.db,
  storage: ctx.infra.storage,
  mailer,
  jobs: new Jobs(ctx.infra.queue),
  logger: ctx.infra.logger,
  frontendUrl: config.FRONTEND_URL,
});
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:18002';

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
  await ctx.infra.queue.obliterate({ force: true });
  f = await createFixture(ctx);
});
afterAll(async () => {
  mailer.close();
  await ctx.close();
});

describe('jobs', () => {
  it('sends the invitation email with an accept link', async () => {
    const email = `invitee-${Date.now()}@example.com`;
    await processors['send-invitation-email']({
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
    expect(full.Text).toContain(`${config.FRONTEND_URL}/invitations/accept?token=tok-123`);
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

    expect(await processors['scan-due-reminders']({})).toEqual({ claimed: 1 });
    expect(await processors['scan-due-reminders']({})).toEqual({ claimed: 0 });

    const [job] = await ctx.infra.queue.getJobs(['waiting']);
    expect(job?.name).toBe('send-due-reminder');
    await processors['send-due-reminder'](job?.data as { taskId: string });
    const [message] = await inbox(assignee.email);
    expect(message?.Subject).toBe('Due soon: TF-1 Due soon');
  });

  it('deletes every object under a storage prefix', async () => {
    const s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
    const prefix = `projects/${f.projectId}/`;
    for (const name of ['a', 'b', 'c']) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: `${prefix}tasks/t/${name}`,
          Body: name,
        }),
      );
    }
    s3.destroy();
    expect(await processors['delete-storage-prefix']({ prefix })).toEqual({ deleted: 3 });
    expect(await processors['delete-storage-prefix']({ prefix })).toEqual({ deleted: 0 });
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
    await ctx.infra.db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(attachments.id, id));
    expect(await processors['cleanup-stale-uploads']({})).toEqual({ removed: 1 });
    const [remaining] = await ctx.infra.db.select({ n: count() }).from(attachments);
    expect(remaining?.n).toBe(0);
  });
});
