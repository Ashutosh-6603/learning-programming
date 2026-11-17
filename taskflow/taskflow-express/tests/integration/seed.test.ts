import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER, seedDefaultUser } from '../../src/modules/users/default-user.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestContext, resetState } from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('default user seed', () => {
  it('creates the user once, and the user can log in', async () => {
    const users = new UsersRepository(ctx.infra.prisma);
    expect(await seedDefaultUser(users)).toBe('created');
    expect(await seedDefaultUser(users)).toBe('exists');
    const res = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: DEFAULT_USER.email, password: DEFAULT_USER.password })
      .expect(200);
    expect(res.body).toMatchObject({
      user: { email: DEFAULT_USER.email, displayName: 'Ashutosh' },
    });
  });
});
