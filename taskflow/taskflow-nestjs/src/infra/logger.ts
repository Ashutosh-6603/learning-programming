import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request } from 'express';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import type { Env } from '../config/env.js';

function completed(req: IncomingMessage, res: ServerResponse, fields: object) {
  const request = req as Request;
  return {
    ...fields,
    userId: request.user?.id,
    method: request.method,
    path: request.originalUrl,
    status: res.statusCode,
  };
}

/** One JSON line per request: requestId, userId, method, path, status, responseTime. */
export function loggerOptions(env: Pick<Env, 'LOG_LEVEL'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'taskflow-nestjs' },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      // requestContext already chose req.id; pino-http reuses it instead of minting its own.
      genReqId: (req) => (req as Request).id,
      customAttributeKeys: { reqId: 'requestId' },
      // Log lines carry the request id, not a dump of the request and response: their
      // headers hold the access token and the refresh cookie, which must never reach a log.
      quietReqLogger: true,
      serializers: { req: () => undefined, res: () => undefined },
      // Evaluated once, when the response is finished (by then the auth guard has set req.user).
      customSuccessObject: completed,
      customErrorObject: (req, res, _err, fields: object) => completed(req, res, fields),
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request completed',
      autoLogging: { ignore: (req) => (req as Request).originalUrl.startsWith('/health') },
    },
  };
}
