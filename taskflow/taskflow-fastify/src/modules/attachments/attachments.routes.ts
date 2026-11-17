import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import {
  Attachment,
  AttachmentUpload,
  DownloadUrl,
  type AttachmentsService,
} from './attachments.service.js';

const CreateAttachmentBody = Type.Object({
  // No slashes, backslashes or control characters (U+0000–U+001F).
  fileName: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^/\\\\\\u0000-\\u001f]+$' }),
  contentType: Type.String({
    minLength: 3,
    maxLength: 127,
    pattern: '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$',
  }),
  sizeBytes: Type.Integer({ minimum: 1, maximum: 25 * 1024 * 1024 }),
});

const TaskParams = Type.Object({ taskId: Id });
const AttachmentParams = Type.Object({ attachmentId: Id });

export const attachmentsRoutes: FastifyPluginAsyncTypebox<{
  attachments: AttachmentsService;
}> = async (app, { attachments }) => {
  app.get(
    '/tasks/:taskId/attachments',
    { schema: { params: TaskParams, querystring: PageQuery, response: { 200: Page(Attachment) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return attachments.list(request.params.taskId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/tasks/:taskId/attachments',
    {
      schema: {
        params: TaskParams,
        body: CreateAttachmentBody,
        response: { 201: AttachmentUpload },
      },
    },
    async (request, reply) => {
      reply.status(201);
      return attachments.create(request.params.taskId, userIdOf(request), request.body);
    },
  );

  app.delete(
    '/attachments/:attachmentId',
    { schema: { params: AttachmentParams } },
    async (request, reply) => {
      await attachments.delete(request.params.attachmentId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.post(
    '/attachments/:attachmentId/complete',
    { schema: { params: AttachmentParams, response: { 200: Attachment } } },
    async (request) => attachments.complete(request.params.attachmentId, userIdOf(request)),
  );

  app.get(
    '/attachments/:attachmentId/download',
    { schema: { params: AttachmentParams, response: { 200: DownloadUrl } } },
    async (request) => attachments.download(request.params.attachmentId, userIdOf(request)),
  );
};
