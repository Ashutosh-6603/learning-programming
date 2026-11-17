import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

/** Tests never touch the dev database: same server, database name suffixed with _test. */
function testDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://taskflow:taskflow@localhost:15402/taskflow',
  );
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Redis logical database 1 instead of 0. */
function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:16302/0');
  url.pathname = '/1';
  return url.toString();
}

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
  MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:18002',
};
