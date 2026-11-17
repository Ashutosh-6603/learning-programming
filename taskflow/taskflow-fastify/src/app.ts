import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Infra, Services } from './container.js';
import { authenticate, requireAuth } from './http/auth.js';
import { installErrorHandlers } from './http/errors.js';
import { echoRequestIdAndSecure, RequestLog, requestIdFrom } from './http/hooks.js';
import { withMethodNotAllowed } from './http/method-not-allowed.js';
import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';
import { installValidators } from './http/validation.js';
import { activityRoutes } from './modules/activity/activity.routes.js';
import { attachmentsRoutes } from './modules/attachments/attachments.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { commentsRoutes } from './modules/comments/comments.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { projectsRoutes } from './modules/projects/projects.routes.js';
import { CLOSE_GOING_AWAY, RealtimeGateway } from './modules/realtime/gateway.js';
import { socketRoutes, ticketRoutes } from './modules/realtime/realtime.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { workspacesRoutes } from './modules/workspaces/workspaces.routes.js';

const MINUTE = 60_000;
export const ISSUER = 'taskflow';
export const AUDIENCE = 'taskflow-api';

export async function buildApp(infra: Infra, services: Services): Promise<FastifyInstance> {
  const { config, redis } = infra;
  // Widen pino's Logger to the interface Fastify's types are written against.
  const logger: FastifyBaseLogger = infra.logger;
  const app = Fastify({
    loggerInstance: logger,
    logController: new RequestLog(),
    genReqId: requestIdFrom,
    bodyLimit: 1_048_576,
    // A JSON key named __proto__ or constructor could poison prototypes; drop it instead of
    // failing the request, the same way unknown fields are ignored.
    onProtoPoisoning: 'remove',
    onConstructorPoisoning: 'remove',
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Fastify parses JSON and text/plain out of the box; this API speaks JSON only, so anything
  // else (text/plain included) is answered with 415 before a handler runs.
  app.removeContentTypeParser('text/plain');
  installValidators(app);
  installErrorHandlers(app);
  app.decorateRequest('userId', null);
  app.addHook('onRequest', echoRequestIdAndSecure);

  await app.register(cors, {
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  await app.register(cookie);
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      algorithm: 'HS256',
      iss: ISSUER,
      aud: AUDIENCE,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: ISSUER,
      allowedAud: AUDIENCE,
      clockTolerance: 30_000,
    },
  });
  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
    preClose(done) {
      for (const client of this.websocketServer.clients) {
        client.close(CLOSE_GOING_AWAY, 'server shutting down');
      }
      this.websocketServer.close(() => {
        done();
      });
    },
  });

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      mode: 'static',
      specification: { path: './contract/openapi.yaml', baseDir: process.cwd() },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await withMethodNotAllowed(app, () => app.register(healthRoutes, { db: infra.db, redis }));

  const gateway = new RealtimeGateway(
    redis.duplicate(), // a Redis connection in SUBSCRIBE mode can't run other commands
    services.access,
    services.presence,
    services.realtime,
    app.log,
  );
  app.addHook('onClose', () => gateway.close());
  await app.register(socketRoutes, { gateway, tickets: services.tickets });

  const authLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_AUTH_PER_MINUTE, MINUTE),
    bucket: 'auth',
    byUser: false,
  });
  const apiLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_API_PER_MINUTE, MINUTE),
    bucket: 'api',
    byUser: true,
  });

  await app.register(
    async (api) => {
      await withMethodNotAllowed(api, () =>
        api.register(authRoutes, {
          auth: services.auth,
          secureCookie: config.COOKIE_SECURE,
          accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
          refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
          rateLimit: authLimit,
        }),
      );

      // Everything in this child context requires a valid access token. Hooks added here
      // don't leak to the auth routes above: that's Fastify's plugin encapsulation.
      await api.register(async (secured) => {
        secured.addHook('onRequest', authenticate);
        secured.addHook('onRequest', apiLimit);
        secured.addHook('onRequest', requireAuth);
        await withMethodNotAllowed(secured, async () => {
          await secured.register(usersRoutes, { users: services.users });
          await secured.register(workspacesRoutes, services);
          await secured.register(projectsRoutes, services);
          await secured.register(tasksRoutes, services);
          await secured.register(commentsRoutes, services);
          await secured.register(attachmentsRoutes, services);
          await secured.register(activityRoutes, services);
          await secured.register(searchRoutes, services);
          await secured.register(ticketRoutes, services);
        });
      });
    },
    { prefix: '/api/v1' },
  );

  return app;
}
