import type { Request, Response } from 'express';
import { PROBLEM_TYPE_BASE, type ProblemError } from '../problem.js';

/** Writes an RFC 9457 response. Used by the exception filter and by the raw Express middleware. */
export function sendProblem(req: Request, res: Response, problem: ProblemError): void {
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
      type: PROBLEM_TYPE_BASE + problem.slug,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      instance: req.originalUrl.split('?')[0],
      requestId: req.id,
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
}
