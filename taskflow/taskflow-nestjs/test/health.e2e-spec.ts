import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext, send } from './helpers.js';

const ctx = await createTestContext();
afterAll(() => ctx.close());

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await send(ctx, 'GET', '/health/live', {}, 200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness of Postgres and Redis', async () => {
    const res = await send(ctx, 'GET', '/health/ready', {}, 200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('answers unknown routes with a problem+json 404 that echoes the request id', async () => {
    const res = await send(ctx, 'GET', '/nope', { headers: { 'X-Request-Id': 'abc-123' } }, 404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.json()).toMatchObject({
      type: 'https://taskflow.example/problems/not-found',
      status: 404,
      instance: '/nope',
      requestId: 'abc-123',
    });
  });

  it('answers undeclared methods with 405 and an Allow header', async () => {
    const res = await send(ctx, 'POST', '/health/live', {}, 405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.json()).toMatchObject({
      type: 'https://taskflow.example/problems/method-not-allowed',
    });
  });

  it('answers 400 to malformed JSON, 415 to non-JSON and 413 to oversized bodies', async () => {
    const json = { 'Content-Type': 'application/json' };
    await send(ctx, 'POST', '/health/live', { headers: json, body: '{"email":' }, 400);
    const text = { 'Content-Type': 'text/plain' };
    await send(ctx, 'POST', '/health/live', { headers: text, body: 'hi' }, 415);
    const huge = JSON.stringify({ blob: 'x'.repeat(1_100_000) });
    await send(ctx, 'POST', '/health/live', { headers: json, body: huge }, 413);
  });
});
