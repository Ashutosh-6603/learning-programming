import { existsSync } from 'node:fs';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

if (existsSync('.env')) process.loadEnvFile('.env');

const Url = Type.String({ format: 'uri' });
const PositiveInt = (fallback: number) => Type.Integer({ minimum: 1, default: fallback });

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Enum(['development', 'test', 'production'], { default: 'development' }),
  PORT: PositiveInt(8000),
  DATABASE_URL: Url,
  REDIS_URL: Url,
  JWT_SECRET: Type.String({ minLength: 32 }),
  ACCESS_TOKEN_TTL_SECONDS: PositiveInt(900),
  REFRESH_TOKEN_TTL_SECONDS: PositiveInt(604_800),
  COOKIE_SECURE: Type.Boolean({ default: true }),
  FRONTEND_URL: Type.String({ format: 'uri', default: 'http://localhost:5173' }),
  S3_ENDPOINT: Url,
  S3_PUBLIC_ENDPOINT: Url,
  S3_REGION: Type.String({ default: 'us-east-1' }),
  S3_BUCKET: Type.String({ minLength: 3 }),
  S3_ACCESS_KEY: Type.String({ minLength: 1 }),
  S3_SECRET_KEY: Type.String({ minLength: 1 }),
  SMTP_HOST: Type.String({ default: 'localhost' }),
  SMTP_PORT: PositiveInt(1025),
  MAIL_FROM: Type.String({ default: 'TaskFlow <no-reply@taskflow.local>' }),
  RATE_LIMIT_AUTH_PER_MINUTE: PositiveInt(10),
  RATE_LIMIT_API_PER_MINUTE: PositiveInt(300),
  LOG_LEVEL: Type.Enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
    default: 'info',
  }),
});

export type Config = Static<typeof ConfigSchema>;

/** Default → Convert ("900" → 900, "false" → false) → Clean (drop unknown vars) → Check. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = Value.Clean(
    ConfigSchema,
    Value.Convert(ConfigSchema, Value.Default(ConfigSchema, { ...env })),
  );
  if (!Value.Check(ConfigSchema, value)) {
    const problems = [...Value.Errors(ConfigSchema, value)]
      .map((e) => `  ${e.instancePath.slice(1) || '(root)'}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return value;
}
