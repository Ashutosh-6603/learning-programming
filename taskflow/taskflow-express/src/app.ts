import { readFileSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import type { Infra, Services } from './container.js';
import { authenticate, requireAuth } from './http/auth.js';
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  requireJsonBody,
  securityHeaders,
} from './http/middleware.js';
import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';
import { activityRoutes } from './modules/activity/activity.routes.js';
import { attachmentsRoutes } from './modules/attachments/attachments.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { commentsRoutes } from './modules/comments/comments.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { projectsRoutes } from './modules/projects/projects.routes.js';
import { realtimeRoutes } from './modules/realtime/realtime.routes.js';
import { searchRoutes } from './modules/search/search.routes.js';
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
import { usersRoutes } from './modules/users/users.routes.js';
import { workspacesRoutes } from './modules/workspaces/workspaces.routes.js';

const MINUTE = 60_000;

export function createApp(infra: Infra, services: Services): Express {
  const { config, logger, redis } = infra;
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(securityHeaders);
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(healthRoutes(infra.prisma, redis));

  if (config.NODE_ENV !== 'production') {
    const contract: unknown = parseYaml(readFileSync('contract/openapi.yaml', 'utf8'));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(contract as swaggerUi.JsonObject));
  }

  const authLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_AUTH_PER_MINUTE, MINUTE),
    bucket: 'auth',
    logger,
    byUser: false,
  });
  const apiLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_API_PER_MINUTE, MINUTE),
    bucket: 'api',
    logger,
    byUser: true,
  });

  const api = Router();
  api.use(requireJsonBody, express.json({ limit: '1mb' }), cookieParser());
  api.use(
    authRoutes(services.auth, {
      secureCookie: config.COOKIE_SECURE,
      refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      authRateLimit: authLimit,
    }),
  );

  // Everything below requires a valid access token.
  api.use(authenticate(services.accessTokens), apiLimit, requireAuth);
  api.use(usersRoutes(services.users));
  api.use(workspacesRoutes(services.workspaces, services.members, services.invitations));
  api.use(projectsRoutes(services.projects, services.columns));
  api.use(tasksRoutes(services.tasks));
  api.use(commentsRoutes(services.comments));
  api.use(attachmentsRoutes(services.attachments));
  api.use(activityRoutes(services.activity));
  api.use(searchRoutes(services.search));
  api.use(realtimeRoutes(services.tickets));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
