import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Type } from 'typebox';
import type { Database } from '../../db/client.js';

const TIMEOUT_MS = 1000;

async function check(probe: () => Promise<unknown>): Promise<'ok' | 'unavailable'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
  });
  try {
    await Promise.race([probe(), timeout]);
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

const Status = Type.Enum(['ok', 'unavailable']);
const Readiness = Type.Object({
  status: Status,
  checks: Type.Object({ database: Status, redis: Status }),
});

export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Database; redis: Redis }> = async (
  app,
  { db, redis },
) => {
  app.get('/health/live', { schema: { response: { 200: Type.Object({ status: Status }) } } }, () =>
    Promise.resolve({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    { schema: { response: { 200: Readiness, 503: Readiness } } },
    async (_request, reply) => {
      const [database, cache] = await Promise.all([
        check(() => db.execute(sql`SELECT 1`)),
        check(() => redis.ping()),
      ]);
      const ok = database === 'ok' && cache === 'ok';
      return reply
        .status(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'unavailable', checks: { database, redis: cache } });
    },
  );
};
