import '@fastify/jwt';
import '@fastify/websocket';
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the `authenticate` hook; null for anonymous requests. */
    userId: string | null;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Record<string, never>;
    user: { sub: string };
  }
}
