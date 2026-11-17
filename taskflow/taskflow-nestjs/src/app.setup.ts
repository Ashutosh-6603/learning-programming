import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { jsonBodiesOnly, requestContext } from './common/http/request-context.js';
import type { Env } from './config/env.js';
import { setupDocs } from './docs.js';
import { parseClientMessage } from './modules/realtime/client-message.js';

/** Passed to NestFactory.create() and to the test module, so both build the same app. */
export const APP_OPTIONS: NestApplicationOptions = {
  // Hold Nest's start-up log lines until our pino logger is installed, then flush them through it.
  bufferLogs: true,
  // We register the JSON parser ourselves below, with our own limit and nothing else.
  bodyParser: false,
};

/** Everything `main.ts` and the tests must agree on. Call it before `app.listen()` / `app.init()`. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');

  // Plain Express middleware, in order. These run before Nest's router, for every request.
  app.use(requestContext);
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.use(jsonBodiesOnly);
  app.useBodyParser('json', { limit: '1mb' });
  app.use(cookieParser());

  // Gateways use the `ws` library (plain WebSockets), with our { type, payload } envelope.
  app.useWebSocketAdapter(new WsAdapter(app, { messageParser: parseClientMessage }));
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupDocs(app);
  // Run OnApplicationShutdown hooks on SIGTERM / SIGINT, so connections close cleanly.
  app.enableShutdownHooks();
}
