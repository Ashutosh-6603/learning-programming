import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerUser, resetState } from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

const refreshCookieOf = (setCookie: string[] | string | undefined) => {
  const header = [setCookie ?? []].flat().find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('no refresh cookie');
  return header;
};

describe('auth', () => {
  it('registers, sets a hardened refresh cookie, and returns the session', async () => {
    const res = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'Ada@Example.com', password: 'correct-horse', displayName: '  Ada  ' })
      .expect(201);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ada@example.com', displayName: 'Ada' },
    });
    const cookie = refreshCookieOf(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects a duplicate email with 409', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: user.email.toUpperCase(), password: 'another-pass', displayName: 'Ada' })
      .expect(409);
  });

  it('returns 422 with camelCase field errors', async () => {
    const res = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '' })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
    const fields = (res.body as { errors: { field: string }[] }).errors.map((e) => e.field).sort();
    expect(fields).toEqual(['displayName', 'email', 'password']);
  });

  it('returns 400 for malformed JSON, 415 for non-JSON bodies, 405 for other methods', async () => {
    await ctx.request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    await ctx.request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(415);
    const res = await ctx.request.put('/api/v1/auth/login').send({}).expect(405);
    expect(res.headers.allow).toBe('POST');
  });

  it('logs in, and gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'correct-horse-battery' })
      .expect(200);
    const wrong = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'nope' })
      .expect(401);
    const unknown = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope' })
      .expect(401);
    expect((wrong.body as { detail: string }).detail).toBe(
      (unknown.body as { detail: string }).detail,
    );
  });

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const register = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'rot@example.com', password: 'correct-horse', displayName: 'Rot' })
      .expect(201);
    const first = refreshCookieOf(register.headers['set-cookie']).split(';')[0] ?? '';

    const refreshed = await ctx.request
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    expect(refreshed.body).toMatchObject({ tokenType: 'Bearer' });
    const second = refreshCookieOf(refreshed.headers['set-cookie']).split(';')[0] ?? '';
    expect(second).not.toBe(first);

    // Replaying the rotated token looks like theft: everything in the family dies.
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const register = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'out@example.com', password: 'correct-horse', displayName: 'Out' })
      .expect(201);
    const cookie = refreshCookieOf(register.headers['set-cookie']).split(';')[0] ?? '';
    const res = await ctx.request.post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    expect(refreshCookieOf(res.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('protects /users/me and lets the user rename themselves', async () => {
    await ctx.request.get('/api/v1/users/me').expect(401);
    await ctx.request.get('/api/v1/users/me').set('Authorization', 'Bearer junk').expect(401);
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .patch('/api/v1/users/me')
      .set(user.auth)
      .send({ displayName: 'Ada L.' })
      .expect(200);
    const me = await ctx.request.get('/api/v1/users/me').set(user.auth).expect(200);
    expect(me.body).toMatchObject({ id: user.id, displayName: 'Ada L.' });
    await ctx.request.patch('/api/v1/users/me').set(user.auth).send({}).expect(422);
  });

  it('allows 10 auth requests per minute per IP, then 429 with Retry-After', async () => {
    const attempt = () =>
      ctx.request.post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'x' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body).toMatchObject({ type: 'https://taskflow.example/problems/rate-limited' });
  });
});
