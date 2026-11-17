import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '../generated/prisma/client.js';
import { PROBLEM_TYPE_BASE, ProblemError } from '../lib/problem.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customProps: (req) => ({ requestId: req.id, userId: req.auth?.userId }),
    customLogLevel: (_req, res, err) =>
      err !== undefined || res.statusCode >= 500 ? 'error' : 'info',
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url }),
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url.startsWith('/health') },
  });
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};

/** express.json() silently skips non-JSON bodies; the contract wants 415 instead. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) {
    next(new ProblemError('unsupported-media-type', 'Request body must be application/json'));
    return;
  }
  next();
};

/**
 * Express answers unknown methods with 404. Chained last on `router.route(path)`, this turns
 * them into 405 + Allow, using the methods registered on that route.
 */
export const methodNotAllowed: RequestHandler = (req, res, next) => {
  const route = req.route as { methods: Record<string, boolean> };
  const allowed = Object.keys(route.methods)
    .filter((m) => m !== '_all')
    .map((m) => m.toUpperCase());
  if (allowed.includes('GET')) allowed.push('HEAD');
  res.setHeader('Allow', allowed.join(', '));
  next(new ProblemError('method-not-allowed', `${req.method} is not supported on this path`));
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ProblemError('not-found', 'No route matches this path'));
};

function toProblem(err: unknown): ProblemError {
  if (err instanceof ProblemError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ProblemError('conflict', 'A resource with these values already exists');
  }
  if (typeof err === 'object' && err !== null && 'type' in err) {
    // Errors thrown by express.json() (body-parser) carry a `type`.
    if (err.type === 'entity.parse.failed')
      return new ProblemError('bad-request', 'Malformed JSON');
    if (err.type === 'entity.too.large') return new ProblemError('payload-too-large');
  }
  return new ProblemError('internal', 'An unexpected error occurred');
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const problem = toProblem(err);
  if (problem.status >= 500) req.log.error({ err }, 'unhandled error');
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
};
