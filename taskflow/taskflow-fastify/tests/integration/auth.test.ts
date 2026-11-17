import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerUser, resetState, send } from '../helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

/** The raw Set-Cookie header for the refresh token, and the `name=value` part to send back. */
function refreshCookie(res: LightMyRequestResponse) {
  const header = [res.headers['set-cookie'] ?? []]
    .flat()
    .find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('no refresh cookie');
  return { header, pair: header.split(';')[0] ?? '' };
}

const register = (email: string) =>
  send(
    ctx,
    'POST',
    '/api/v1/auth/register',
    { body: { email, password: 'correct-horse', displayName: 'Ada' } },
    201,
  );

describe('auth', () => {
  it('registers, sets a hardened refresh cookie, and returns the session', async () => {
    const res = await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: 'Ada@Example.com', password: 'correct-horse', displayName: '  Ada  ' } },
      201,
    );
    expect(res.json()).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ada@example.com', displayName: 'Ada' },
    });
    const { header } = refreshCookie(res);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects a duplicate email with 409', async () => {
    const user = await registerUser(ctx, 'Ada');
    await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: user.email.toUpperCase(), password: 'another-pass', displayName: 'Ada' } },
      409,
    );
  });

  it('returns 422 with camelCase field errors', async () => {
    const res = await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: 'not-an-email', password: 'short', displayName: '' } },
      422,
    );
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const fields = res
      .json<{ errors: { field: string }[] }>()
      .errors.map((e) => e.field)
      .sort();
    expect(fields).toEqual(['displayName', 'email', 'password']);
  });

  it('returns 400 for malformed JSON, 415 for non-JSON bodies, 405 for other methods', async () => {
    const login = '/api/v1/auth/login';
    const json = { 'Content-Type': 'application/json' };
    await send(ctx, 'POST', login, { headers: json, body: '{"email":' }, 400);
    await send(ctx, 'POST', login, { headers: { 'Content-Type': 'text/plain' }, body: 'hi' }, 415);
    const res = await send(ctx, 'PUT', login, { body: {} }, 405);
    expect(res.headers.allow).toBe('POST');
  });

  it('logs in, and gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerUser(ctx, 'Ada');
    const login = (email: string, password: string) =>
      send(ctx, 'POST', '/api/v1/auth/login', { body: { email, password } });
    expect((await login(user.email, 'correct-horse-battery')).statusCode).toBe(200);
    const wrong = await login(user.email, 'nope');
    const unknown = await login('ghost@example.com', 'nope');
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.json<{ detail: string }>().detail).toBe(unknown.json<{ detail: string }>().detail);
  });

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const first = refreshCookie(await register('rot@example.com')).pair;
    const refresh = (cookie: string, status: number) =>
      send(ctx, 'POST', '/api/v1/auth/refresh', { headers: { Cookie: cookie } }, status);

    const refreshed = await refresh(first, 200);
    expect(refreshed.json()).toMatchObject({ tokenType: 'Bearer' });
    const second = refreshCookie(refreshed).pair;
    expect(second).not.toBe(first);

    // Replaying the rotated token looks like theft: everything in the family dies.
    await refresh(first, 401);
    await refresh(second, 401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const cookie = refreshCookie(await register('out@example.com')).pair;
    const headers = { Cookie: cookie };
    const res = await send(ctx, 'POST', '/api/v1/auth/logout', { headers }, 204);
    expect(refreshCookie(res).header).toMatch(/Expires=Thu, 01 Jan 1970/);
    await send(ctx, 'POST', '/api/v1/auth/refresh', { headers }, 401);
  });

  it('protects /users/me and lets the user rename themselves', async () => {
    await send(ctx, 'GET', '/api/v1/users/me', {}, 401);
    await send(ctx, 'GET', '/api/v1/users/me', { headers: { Authorization: 'Bearer junk' } }, 401);
    const user = await registerUser(ctx, 'Ada');
    await send(
      ctx,
      'PATCH',
      '/api/v1/users/me',
      { as: user, body: { displayName: 'Ada L.' } },
      200,
    );
    const me = await send(ctx, 'GET', '/api/v1/users/me', { as: user }, 200);
    expect(me.json()).toMatchObject({ id: user.id, displayName: 'Ada L.' });
    await send(ctx, 'PATCH', '/api/v1/users/me', { as: user, body: {} }, 422);
  });

  it('allows 10 auth requests per minute per IP, then 429 with Retry-After', async () => {
    const attempt = () =>
      send(ctx, 'POST', '/api/v1/auth/login', {
        body: { email: 'nobody@example.com', password: 'x' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({
      type: 'https://taskflow.example/problems/rate-limited',
    });
  });
});
