import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { Type } from 'typebox';
import { Email, Trimmed } from '../../lib/schemas.js';
import { User } from '../users/users.dto.js';
import type { AuthService } from './auth.service.js';

const COOKIE = 'refresh_token';

const RegisterBody = Type.Object({
  email: Email,
  password: Type.String({ minLength: 8, maxLength: 128 }),
  displayName: Trimmed(1, 80),
});

const LoginBody = Type.Object({
  email: Email,
  password: Type.String({ minLength: 1, maxLength: 128 }),
});

const AccessToken = Type.Object({
  accessToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  expiresIn: Type.Integer(),
});
const AuthSession = Type.Object({ ...AccessToken.properties, user: User });

export interface AuthRoutesOptions {
  auth: AuthService;
  secureCookie: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  rateLimit: onRequestAsyncHookHandler;
}

export const authRoutes: FastifyPluginAsyncTypebox<AuthRoutesOptions> = async (app, opts) => {
  const cookie: CookieSerializeOptions = {
    httpOnly: true,
    secure: opts.secureCookie,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
  const persistent = { ...cookie, maxAge: opts.refreshTtlSeconds };
  const accessToken = (userId: string) => ({
    accessToken: app.jwt.sign({}, { sub: userId }),
    tokenType: 'Bearer' as const,
    expiresIn: opts.accessTtlSeconds,
  });
  const limited = { onRequest: opts.rateLimit };

  app.post(
    '/auth/register',
    { ...limited, schema: { body: RegisterBody, response: { 201: AuthSession } } },
    async (request, reply) => {
      const { user, refreshToken } = await opts.auth.register(request.body);
      reply.setCookie(COOKIE, refreshToken, persistent).status(201);
      return { ...accessToken(user.id), user };
    },
  );

  app.post(
    '/auth/login',
    { ...limited, schema: { body: LoginBody, response: { 200: AuthSession } } },
    async (request, reply) => {
      const { email, password } = request.body;
      const { user, refreshToken } = await opts.auth.login(email, password);
      reply.setCookie(COOKIE, refreshToken, persistent);
      return { ...accessToken(user.id), user };
    },
  );

  app.post(
    '/auth/refresh',
    { ...limited, schema: { response: { 200: AccessToken } } },
    async (request, reply) => {
      const { userId, refreshToken } = await opts.auth.refresh(cookieOf(request));
      reply.setCookie(COOKIE, refreshToken, persistent);
      return accessToken(userId);
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    await opts.auth.logout(cookieOf(request));
    return reply.clearCookie(COOKIE, cookie).status(204).send();
  });
};

function cookieOf(request: FastifyRequest): string | undefined {
  const value = request.cookies[COOKIE];
  return value !== undefined && value.length > 0 ? value : undefined;
}
