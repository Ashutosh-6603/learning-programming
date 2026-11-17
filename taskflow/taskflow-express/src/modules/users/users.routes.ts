import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { notFound } from '../../lib/problem.js';
import { atLeastOneField, parseBody, trimmed } from '../../lib/validation.js';
import { toUser } from './users.dto.js';
import type { UsersRepository } from './users.repository.js';

const UpdateUserBody = z
  .object({ displayName: trimmed(1, 80).optional() })
  .refine(...atLeastOneField);

export function usersRoutes(users: UsersRepository): Router {
  const router = Router();

  router
    .route('/users/me')
    .get(async (req, res) => {
      const user = await users.findById(userIdOf(req));
      if (!user) throw notFound('User');
      res.json(toUser(user));
    })
    .patch(async (req, res) => {
      const body = parseBody(UpdateUserBody, req);
      res.json(toUser(await users.update(userIdOf(req), body)));
    })
    .all(methodNotAllowed);

  return router;
}
