import { Router, type CookieOptions, type RequestHandler } from 'express';
import { z } from 'zod';
import { methodNotAllowed } from '../../http/middleware.js';
import { Email, parseBody, trimmed } from '../../lib/validation.js';
import type { AuthService } from './auth.service.js';

const COOKIE = 'refresh_token';

const RegisterBody = z.object({
  email: Email,
  password: z.string().min(8).max(128),
  displayName: trimmed(1, 80),
});

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});

export function authRoutes(
  auth: AuthService,
  opts: { secureCookie: boolean; refreshTtlSeconds: number; authRateLimit: RequestHandler },
): Router {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: opts.secureCookie,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
  const withMaxAge = { ...cookieOptions, maxAge: opts.refreshTtlSeconds * 1000 };
  const router = Router();

  router
    .route('/auth/register')
    .post(opts.authRateLimit, async (req, res) => {
      const session = await auth.register(parseBody(RegisterBody, req));
      res.cookie(COOKIE, session.refreshToken, withMaxAge);
      res.status(201).json(session.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/login')
    .post(opts.authRateLimit, async (req, res) => {
      const { email, password } = parseBody(LoginBody, req);
      const session = await auth.login(email, password);
      res.cookie(COOKIE, session.refreshToken, withMaxAge);
      res.json(session.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/refresh')
    .post(opts.authRateLimit, async (req, res) => {
      const result = await auth.refresh(cookieOf(req.cookies));
      res.cookie(COOKIE, result.refreshToken, withMaxAge);
      res.json(result.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/logout')
    .post(async (req, res) => {
      await auth.logout(cookieOf(req.cookies));
      res.clearCookie(COOKIE, cookieOptions);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  return router;
}

function cookieOf(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value: unknown = (cookies as Record<string, unknown>)[COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
