import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { ProblemError } from '../problem.js';
import { sendProblem } from './send-problem.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Honour a well-formed incoming X-Request-Id, otherwise mint a UUIDv7; echo it and harden the response. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
  res.set({
    'X-Request-Id': req.id,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  next();
}

/**
 * This API speaks JSON only. express.json() silently skips other content types, which would
 * turn a text/plain body into "every field is missing" (422); the honest answer is 415.
 */
export function jsonBodiesOnly(req: Request, res: Response, next: NextFunction): void {
  const hasBody =
    req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0;
  if (hasBody && !req.is('application/json')) {
    sendProblem(
      req,
      res,
      new ProblemError('unsupported-media-type', 'Request body must be application/json'),
    );
    return;
  }
  next();
}
