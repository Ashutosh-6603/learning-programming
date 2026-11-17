import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { userIdOf } from '../../http/auth.js';
import { notFound } from '../../lib/problem.js';
import { Patch, Trimmed } from '../../lib/schemas.js';
import { toUser, User } from './users.dto.js';
import type { UsersRepository } from './users.repository.js';

const UpdateUserBody = Patch({ displayName: Trimmed(1, 80) });

export const usersRoutes: FastifyPluginAsyncTypebox<{ users: UsersRepository }> = async (
  app,
  { users },
) => {
  app.get('/users/me', { schema: { response: { 200: User } } }, async (request) => {
    const user = await users.findById(userIdOf(request));
    if (!user) throw notFound('User');
    return toUser(user);
  });

  app.patch(
    '/users/me',
    { schema: { body: UpdateUserBody, response: { 200: User } } },
    async (request) => {
      const user = await users.update(userIdOf(request), request.body);
      if (!user) throw notFound('User');
      return toUser(user);
    },
  );
};
