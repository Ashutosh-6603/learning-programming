import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, createTestContext, resetState, type Fixture } from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
let taskId: string;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
  const task = await ctx.request
    .post(`/api/v1/projects/${f.projectId}/tasks`)
    .set(f.owner.auth)
    .send({ title: 'Has files' })
    .expect(201);
  taskId = (task.body as { id: string }).id;
});
afterAll(() => ctx.close());

interface Created {
  attachment: { id: string; status: string };
  upload: { url: string; method: string; headers: Record<string, string> };
}

const start = (body: Record<string, unknown>) =>
  ctx.request.post(`/api/v1/tasks/${taskId}/attachments`).set(f.owner.auth).send(body);

describe('attachments', () => {
  it('uploads straight to S3 with a presigned URL, then completes and downloads', async () => {
    const content = 'hello attachment';
    const created = await start({
      fileName: 'notes résumé.txt',
      contentType: 'text/plain',
      sizeBytes: content.length,
    }).expect(201);
    const { attachment, upload } = created.body as Created;
    expect(attachment.status).toBe('pending');
    expect(upload.method).toBe('PUT');

    // Completing before the bytes exist is a conflict.
    await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(409);

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(put.status).toBe(200);

    const done = await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(200);
    expect(done.body).toMatchObject({ status: 'ready', sizeBytes: content.length });

    const list = await ctx.request
      .get(`/api/v1/tasks/${taskId}/attachments`)
      .set(f.owner.auth)
      .expect(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    const download = await ctx.request
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(f.owner.auth)
      .expect(200);
    const file = await fetch((download.body as { url: string }).url);
    expect(await file.text()).toBe(content);
    expect(file.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt",
    );

    await ctx.request.delete(`/api/v1/attachments/${attachment.id}`).set(f.owner.auth).expect(204);
    await ctx.request
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(f.owner.auth)
      .expect(404);
  });

  it('refuses uploads whose size differs from what was declared', async () => {
    const created = await start({ fileName: 'a.txt', contentType: 'text/plain', sizeBytes: 5 });
    const { attachment, upload } = created.body as Created;
    // The signed Content-Length makes S3 itself reject a different size.
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: 'way too long',
    });
    expect(put.ok).toBe(false);
    await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(409);
  });

  it('validates file metadata', async () => {
    const res = await start({
      fileName: '../etc/passwd',
      contentType: 'Text/Plain',
      sizeBytes: 30 * 1024 * 1024,
    }).expect(422);
    const fields = (res.body as { errors: { field: string }[] }).errors.map((e) => e.field).sort();
    expect(fields).toEqual(['contentType', 'fileName', 'sizeBytes']);
  });
});
