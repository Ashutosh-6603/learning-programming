import type { FastifyInstance, HTTPMethods } from 'fastify';
import { ProblemError } from '../lib/problem.js';

/**
 * Fastify answers a known path with an unknown method by 404; the contract wants 405 + Allow.
 * Runs `register`, records every route it declares, then adds one route per path that answers
 * every other method Fastify knows (TRACE and QUERY included). OPTIONS is left alone: CORS
 * preflight needs it. The new routes live in the same plugin, so they run behind the same
 * hooks (an anonymous `PUT /api/v1/workspaces` still gets 401 first).
 */
export async function withMethodNotAllowed(
  app: FastifyInstance,
  register: () => PromiseLike<unknown>,
): Promise<void> {
  const allowed = new Map<string, Set<string>>();
  let collecting = true;
  app.addHook('onRoute', (route) => {
    if (!collecting) return;
    const methods = allowed.get(route.routePath) ?? new Set<string>();
    for (const m of [route.method].flat()) methods.add(m);
    if (methods.has('GET')) methods.add('HEAD');
    allowed.set(route.routePath, methods);
  });

  await register();
  collecting = false;

  const candidates = app.supportedMethods.filter((m) => m !== 'OPTIONS') as HTTPMethods[];
  for (const [path, methods] of allowed) {
    const allow = candidates.filter((m) => methods.has(m)).join(', ');
    app.route({
      method: candidates.filter((m) => !methods.has(m)),
      url: path,
      // onRequest, not the handler: Fastify checks bodies (e.g. QUERY needs a Content-Type)
      // between the two, and the answer must be 405 whatever the body.
      onRequest: async (request, reply) => {
        reply.header('Allow', allow);
        throw new ProblemError(
          'method-not-allowed',
          `${request.method} is not supported on this path`,
        );
      },
      handler: async () => undefined,
    });
  }
}
