import type { Request, RequestHandler } from 'express';
import { unauthorized } from '../lib/problem.js';
import type { AccessTokens } from '../modules/auth/access-tokens.js';

export function authenticate(tokens: AccessTokens): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.auth = { userId: tokens.verify(header.slice('Bearer '.length)) };
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : unauthorized());
};

/** The authenticated user's id. Only call behind `requireAuth`. */
export function userIdOf(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}
