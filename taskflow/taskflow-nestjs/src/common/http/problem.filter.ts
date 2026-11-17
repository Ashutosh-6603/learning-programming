import {
  Catch,
  HttpException,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { isUniqueViolation } from '../pg-errors.js';
import { ProblemError, type ProblemSlug } from '../problem.js';
import { RouteTable } from './route-table.js';
import { sendProblem } from './send-problem.js';

/** Statuses Nest raises on its own (body parser, router, passport), mapped to our problem slugs. */
const BY_STATUS: Partial<Record<number, ProblemSlug>> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
};

/** `@Catch()` with no arguments catches everything: the one place errors become responses. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(
    private readonly routes: RouteTable,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProblemFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error({ err: exception }, 'unhandled error outside HTTP');
      return;
    }
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception, req, res);
    if (problem.status >= 500) this.logger.error({ err: exception }, 'unhandled error');
    sendProblem(req, res, problem);
  }

  private toProblem(exception: unknown, req: Request, res: Response): ProblemError {
    if (exception instanceof ProblemError) return exception;
    if (exception instanceof NotFoundException) return this.unmatched(req, res);
    if (exception instanceof HttpException) {
      const slug = BY_STATUS[exception.getStatus()];
      if (slug === 'bad-request') return new ProblemError(slug, 'Malformed JSON');
      if (slug) return new ProblemError(slug);
    }
    if (isUniqueViolation(exception)) {
      return new ProblemError('conflict', 'A resource with these values already exists');
    }
    return new ProblemError('internal', 'An unexpected error occurred');
  }

  /** Nest's router found no handler: either the path is unknown, or only the method is. */
  private unmatched(req: Request, res: Response): ProblemError {
    const allowed = this.routes.allowedMethods(req.path);
    if (allowed.length === 0) return new ProblemError('not-found', 'No route matches this path');
    res.set('Allow', allowed.join(', '));
    return new ProblemError('method-not-allowed', `${req.method} is not supported on this path`);
  }
}
