import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Timestamp } from '../../lib/schemas.js';
import type { RealtimeGateway } from './gateway.js';
import type { Tickets } from './tickets.js';

const Ticket = Type.Object({ ticket: Type.String(), expiresAt: Timestamp });

/** POST /api/v1/ws/ticket: lives in the authenticated API context. */
export const ticketRoutes: FastifyPluginAsyncTypebox<{ tickets: Tickets }> = async (
  app,
  { tickets },
) => {
  app.post('/ws/ticket', { schema: { response: { 201: Ticket } } }, async (request, reply) => {
    reply.status(201);
    return tickets.issue(userIdOf(request));
  });
};

/** GET /ws: the WebSocket endpoint itself, authenticated by a single-use ticket. */
export const socketRoutes: FastifyPluginAsync<{
  gateway: RealtimeGateway;
  tickets: Tickets;
}> = async (app, { gateway, tickets }) => {
  app.get<{ Querystring: { ticket?: string } }>(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade; the handler below must stay synchronous so it attaches its
      // message listener before the first frame arrives.
      preValidation: async (request) => {
        request.userId = await tickets.redeem(request.query.ticket ?? '');
      },
    },
    (socket, request) => {
      gateway.accept(socket, request.userId);
    },
  );
};
