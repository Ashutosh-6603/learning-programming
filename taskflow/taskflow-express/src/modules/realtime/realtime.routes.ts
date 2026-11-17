import { Router } from 'express';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import type { Tickets } from './tickets.js';

export function realtimeRoutes(tickets: Tickets): Router {
  const router = Router();

  router
    .route('/ws/ticket')
    .post(async (req, res) => {
      res.status(201).json(await tickets.issue(userIdOf(req)));
    })
    .all(methodNotAllowed);

  return router;
}
