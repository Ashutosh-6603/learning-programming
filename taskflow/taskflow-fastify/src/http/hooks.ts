import type { IncomingMessage } from 'node:http';
import {
  LogController,
  type FastifyReply,
  type FastifyRequest,
  type onRequestAsyncHookHandler,
} from 'fastify';
import { v7 as uuidv7 } from 'uuid';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Fastify's `genReqId`: honour a well-formed incoming X-Request-Id, otherwise mint a UUIDv7. */
export function requestIdFrom(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
}

export const echoRequestIdAndSecure: onRequestAsyncHookHandler = async (request, reply) => {
  reply.headers({
    'X-Request-Id': request.id,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
};

/** Fastify logs two lines per request by default; we want one, with the user, and no health probes. */
export class RequestLog extends LogController {
  constructor() {
    super({
      requestIdLogLabel: 'requestId',
      disableRequestLogging: (request) => request.url.startsWith('/health'),
    });
  }

  override incomingRequest(): void {
    // Folded into requestCompleted.
  }

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.isLogDisabled(request)) return;
    const line = {
      userId: request.userId ?? undefined,
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      responseTime: Math.round(reply.elapsedTime),
    };
    if (error || reply.statusCode >= 500)
      reply.log.error({ ...line, err: error }, 'request completed');
    else reply.log.info(line, 'request completed');
  }
}
