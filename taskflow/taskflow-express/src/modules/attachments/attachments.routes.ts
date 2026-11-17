import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import type { AttachmentsService } from './attachments.service.js';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const SAFE_FILE_NAME = /^[^/\\\x00-\x1f]+$/;

const CreateAttachmentBody = z.object({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .regex(SAFE_FILE_NAME, 'must not contain slashes or control characters'),
  contentType: z
    .string()
    .min(3)
    .max(127)
    .regex(
      /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/,
      'must be a lowercase media type',
    ),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
});

const TaskParams = z.object({ taskId: Id });
const AttachmentParams = z.object({ attachmentId: Id });

export function attachmentsRoutes(attachments: AttachmentsService): Router {
  const router = Router();

  router
    .route('/tasks/:taskId/attachments')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await attachments.list(taskId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(CreateAttachmentBody, req);
      res.status(201).json(await attachments.create(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId')
    .delete(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      await attachments.delete(attachmentId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId/complete')
    .post(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      res.json(await attachments.complete(attachmentId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId/download')
    .get(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      res.json(await attachments.download(attachmentId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  return router;
}
