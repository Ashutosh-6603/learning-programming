import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER, seedDefaultUser } from '../src/modules/users/default-user.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { createTestContext, resetState, send } from './helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('default user seed', () => {
  it('creates the user once, and the user can log in', async () => {
    const users = ctx.app.get(UsersService);
    expect(await seedDefaultUser(users)).toBe('created');
    expect(await seedDefaultUser(users)).toBe('exists');
    const body = { email: DEFAULT_USER.email, password: DEFAULT_USER.password };
    const res = await send(ctx, 'POST', '/api/v1/auth/login', { body }, 200);
    expect(res.json()).toMatchObject({
      user: { email: DEFAULT_USER.email, displayName: 'Ashutosh' },
    });
  });
});
