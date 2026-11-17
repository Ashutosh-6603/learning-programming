import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://taskflow:taskflow@localhost:15403/taskflow',
  REDIS_URL: 'redis://localhost:16303/0',
  JWT_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://rustfs:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:19003',
  S3_BUCKET: 'taskflow-attachments',
  S3_ACCESS_KEY: 'taskflow',
  S3_SECRET_KEY: 'taskflow-secret',
};

describe('validateEnv', () => {
  it('applies defaults, converts text and drops unrelated variables', () => {
    const env = validateEnv({ ...required, PORT: '8003', COOKIE_SECURE: 'false', PATH: '/bin' });
    expect(env).toMatchObject({ PORT: 8003, COOKIE_SECURE: false, NODE_ENV: 'development' });
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env).not.toHaveProperty('PATH');
  });

  it('names every invalid or missing variable', () => {
    const run = () => validateEnv({ ...required, JWT_SECRET: 'short', REDIS_URL: undefined });
    expect(run).toThrow(/Invalid environment configuration/);
    expect(run).toThrow(/JWT_SECRET/);
    expect(run).toThrow(/REDIS_URL/);
  });
});
