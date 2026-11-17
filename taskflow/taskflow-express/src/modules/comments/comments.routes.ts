import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import type { CommentsService } from './comments.service.js';

const CommentBody = z.object({ body: z.string().min(1).max(5000) });
const TaskParams = z.object({ taskId: Id });
const CommentParams = z.object({ commentId: Id });

export function commentsRoutes(comments: CommentsService): Router {
  const router = Router();

  router
    .route('/tasks/:taskId/comments')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await comments.list(taskId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { body } = parseBody(CommentBody, req);
      res.status(201).json(await comments.create(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/comments/:commentId')
    .patch(async (req, res) => {
      const { commentId } = parseParams(CommentParams, req);
      const { body } = parseBody(CommentBody, req);
      res.json(await comments.update(commentId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { commentId } = parseParams(CommentParams, req);
      await comments.delete(commentId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  return router;
}
