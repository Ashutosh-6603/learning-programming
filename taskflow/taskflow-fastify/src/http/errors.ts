import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUniqueViolation } from '../lib/pg-errors.js';
import { PROBLEM_TYPE_BASE, ProblemError, type ProblemSlug } from '../lib/problem.js';
import { fieldErrors } from './validation.js';

/** Fastify's own error codes for body parsing, mapped to our problem slugs. */
const BODY_ERRORS: Record<string, ProblemError> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: new ProblemError(
    'unsupported-media-type',
    'Request body must be application/json',
  ),
  FST_ERR_CTP_BODY_TOO_LARGE: new ProblemError('payload-too-large'),
  FST_ERR_CTP_INVALID_JSON_BODY: new ProblemError('bad-request', 'Malformed JSON'),
  FST_ERR_CTP_EMPTY_JSON_BODY: new ProblemError('bad-request', 'Malformed JSON'),
};

const BY_STATUS: Partial<Record<number, ProblemSlug>> = {
  400: 'bad-request',
  404: 'not-found',
  405: 'method-not-allowed',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
};

function isFastifyError(err: unknown): err is FastifyError {
  return err instanceof Error && 'code' in err;
}

function toProblem(err: unknown): ProblemError {
  if (err instanceof ProblemError) return err;
  if (isFastifyError(err) && err.validation && err.validationContext) {
    return new ProblemError(
      'validation-error',
      'The request contains invalid fields',
      fieldErrors(err.validation, err.validationContext),
    );
  }
  if (isFastifyError(err)) {
    const known = BODY_ERRORS[err.code];
    if (known) return known;
    // Any other client error Fastify raises itself keeps its status.
    const slug = BY_STATUS[err.statusCode ?? 500];
    if (slug) return new ProblemError(slug, err.message);
  }
  // JSON.parse failures inside the default body parser surface as a plain 400 SyntaxError.
  if (err instanceof SyntaxError && 'statusCode' in err && err.statusCode === 400) {
    return new ProblemError('bad-request', 'Malformed JSON');
  }
  if (isUniqueViolation(err)) {
    return new ProblemError('conflict', 'A resource with these values already exists');
  }
  return new ProblemError('internal', 'An unexpected error occurred');
}

function sendProblem(request: FastifyRequest, reply: FastifyReply, problem: ProblemError) {
  return reply
    .status(problem.status)
    .type('application/problem+json')
    .send({
      type: PROBLEM_TYPE_BASE + problem.slug,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      instance: request.url.split('?')[0],
      requestId: request.id,
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
}

export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    const problem = toProblem(err);
    if (problem.status >= 500) request.log.error({ err }, 'unhandled error');
    return sendProblem(request, reply, problem);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, new ProblemError('not-found', 'No route matches this path')),
  );
}
