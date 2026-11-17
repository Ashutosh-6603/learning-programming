import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { methodNotAllowed } from '../../http/middleware.js';

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

export function healthRoutes(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();

  router
    .route('/health/live')
    .get((_req, res) => {
      res.json({ status: 'ok' });
    })
    .all(methodNotAllowed);

  router
    .route('/health/ready')
    .get(async (_req, res) => {
      const [database, cache] = await Promise.all([
        check(() => prisma.$queryRaw`SELECT 1`),
        check(() => redis.ping()),
      ]);
      const ok = database === 'ok' && cache === 'ok';
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'unavailable',
        checks: { database, redis: cache },
      });
    })
    .all(methodNotAllowed);

  return router;
}
