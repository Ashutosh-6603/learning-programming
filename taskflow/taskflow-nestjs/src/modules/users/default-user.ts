import { hashPassword } from '../auth/passwords.js';
import type { UsersService } from './users.service.js';

/**
 * The account every TaskFlow backend seeds for local development, so the frontend has a
 * login ready. Its password is public: `src/seed.ts` refuses to run in production.
 */
export const DEFAULT_USER = {
  email: 'ashutosh@test.com',
  password: 'Ashutosh#1234',
  displayName: 'Ashutosh',
} as const;

/** Creates the default user unless the email is already registered. Safe to run repeatedly. */
export async function seedDefaultUser(users: UsersService): Promise<'created' | 'exists'> {
  if (await users.findByEmailWithPassword(DEFAULT_USER.email)) return 'exists';
  await users.create({
    email: DEFAULT_USER.email,
    displayName: DEFAULT_USER.displayName,
    passwordHash: await hashPassword(DEFAULT_USER.password),
  });
  return 'created';
}
