import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, createTestContext, resetState, send, type Fixture } from '../helpers.js';

const ctx = await createTestContext();
let f: Fixture;
let taskId: string;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
  const task = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title: 'Has files' } },
    201,
  );
  taskId = task.json<{ id: string }>().id;
});
afterAll(() => ctx.close());

interface Created {
  attachment: { id: string; status: string };
  upload: { url: string; method: string; headers: Record<string, string> };
}

const start = (body: Record<string, unknown>, status: number) =>
  send(ctx, 'POST', `/api/v1/tasks/${taskId}/attachments`, { as: f.owner, body }, status);

describe('attachments', () => {
  it('uploads straight to S3 with a presigned URL, then completes and downloads', async () => {
    const content = 'hello attachment';
    const created = await start(
      { fileName: 'notes résumé.txt', contentType: 'text/plain', sizeBytes: content.length },
      201,
    );
    const { attachment, upload } = created.json<Created>();
    const url = `/api/v1/attachments/${attachment.id}`;
    expect(attachment.status).toBe('pending');
    expect(upload.method).toBe('PUT');

    // Completing before the bytes exist is a conflict.
    await send(ctx, 'POST', `${url}/complete`, { as: f.owner }, 409);

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(put.status).toBe(200);

    const done = await send(ctx, 'POST', `${url}/complete`, { as: f.owner }, 200);
    expect(done.json()).toMatchObject({ status: 'ready', sizeBytes: content.length });

    const list = await send(
      ctx,
      'GET',
      `/api/v1/tasks/${taskId}/attachments`,
      { as: f.owner },
      200,
    );
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const download = await send(ctx, 'GET', `${url}/download`, { as: f.owner }, 200);
    const file = await fetch(download.json<{ url: string }>().url);
    expect(await file.text()).toBe(content);
    expect(file.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt",
    );

    await send(ctx, 'DELETE', url, { as: f.owner }, 204);
    await send(ctx, 'GET', `${url}/download`, { as: f.owner }, 404);
  });

  it('refuses uploads whose size differs from what was declared', async () => {
    const created = await start(
      { fileName: 'a.txt', contentType: 'text/plain', sizeBytes: 5 },
      201,
    );
    const { attachment, upload } = created.json<Created>();
    // The signed Content-Length makes S3 itself reject a different size.
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: 'way too long',
    });
    expect(put.ok).toBe(false);
    await send(ctx, 'POST', `/api/v1/attachments/${attachment.id}/complete`, { as: f.owner }, 409);
  });

  it('validates file metadata', async () => {
    const res = await start(
      { fileName: '../etc/passwd', contentType: 'Text/Plain', sizeBytes: 30 * 1024 * 1024 },
      422,
    );
    const fields = res
      .json<{ errors: { field: string }[] }>()
      .errors.map((e) => e.field)
      .sort();
    expect(fields).toEqual(['contentType', 'fileName', 'sizeBytes']);
  });
});
