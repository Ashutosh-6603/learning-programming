import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext } from '../helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await ctx.request.get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness of Postgres and Redis', async () => {
    const res = await ctx.request.get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('answers unknown routes with a problem+json 404 that echoes the request id', async () => {
    const res = await ctx.request.get('/nope').set('X-Request-Id', 'abc-123').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.body).toMatchObject({
      type: 'https://taskflow.example/problems/not-found',
      status: 404,
      instance: '/nope',
      requestId: 'abc-123',
    });
  });

  it('answers undeclared methods with 405 and an Allow header', async () => {
    const res = await ctx.request.post('/health/live').expect(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.body).toMatchObject({
      type: 'https://taskflow.example/problems/method-not-allowed',
    });
  });
});
