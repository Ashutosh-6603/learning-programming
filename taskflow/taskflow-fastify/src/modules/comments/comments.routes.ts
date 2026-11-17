import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { Comment, type CommentsService } from './comments.service.js';

const CommentBody = Type.Object({ body: Type.String({ minLength: 1, maxLength: 5000 }) });
const TaskParams = Type.Object({ taskId: Id });
const CommentParams = Type.Object({ commentId: Id });

export const commentsRoutes: FastifyPluginAsyncTypebox<{ comments: CommentsService }> = async (
  app,
  { comments },
) => {
  app.get(
    '/tasks/:taskId/comments',
    { schema: { params: TaskParams, querystring: PageQuery, response: { 200: Page(Comment) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return comments.list(request.params.taskId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/tasks/:taskId/comments',
    { schema: { params: TaskParams, body: CommentBody, response: { 201: Comment } } },
    async (request, reply) => {
      reply.status(201);
      return comments.create(request.params.taskId, userIdOf(request), request.body.body);
    },
  );

  app.patch(
    '/comments/:commentId',
    { schema: { params: CommentParams, body: CommentBody, response: { 200: Comment } } },
    async (request) =>
      comments.update(request.params.commentId, userIdOf(request), request.body.body),
  );

  app.delete(
    '/comments/:commentId',
    { schema: { params: CommentParams } },
    async (request, reply) => {
      await comments.delete(request.params.commentId, userIdOf(request));
      return reply.status(204).send();
    },
  );
};
