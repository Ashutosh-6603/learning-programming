import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const Url = (...protocols: string[]) =>
  IsUrl({ protocols, require_protocol: true, require_tld: false });

/**
 * Every environment variable the app reads. A field initializer is the default;
 * a field without one is required.
 */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  PORT: number = 8000;

  @Url('postgresql', 'postgres')
  DATABASE_URL: string;

  @Url('redis', 'rediss')
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS: number = 604_800;

  // Implicit conversion calls Boolean("false"), which is true. Read the original text instead.
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.COOKIE_SECURE === 'string' ? obj.COOKIE_SECURE === 'true' : obj.COOKIE_SECURE,
  )
  @IsBoolean()
  COOKIE_SECURE: boolean = true;

  @Url('http', 'https')
  FRONTEND_URL: string = 'http://localhost:5173';

  @Url('http', 'https')
  S3_ENDPOINT: string;

  @Url('http', 'https')
  S3_PUBLIC_ENDPOINT: string;

  @IsString()
  S3_REGION: string = 'us-east-1';

  @IsString()
  @MinLength(3)
  S3_BUCKET: string;

  @IsString()
  @MinLength(1)
  S3_ACCESS_KEY: string;

  @IsString()
  @MinLength(1)
  S3_SECRET_KEY: string;

  @IsString()
  SMTP_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  SMTP_PORT: number = 1025;

  @IsString()
  MAIL_FROM: string = 'TaskFlow <no-reply@taskflow.local>';

  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_PER_MINUTE: number = 10;

  @IsInt()
  @Min(1)
  RATE_LIMIT_API_PER_MINUTE: number = 300;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';
}

/**
 * The `validate` hook of ConfigModule: text from the environment in, a typed Env out.
 * Convert ("900" → 900) → drop unknown variables (whitelist) → check every rule.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env, { whitelist: true });
  if (errors.length > 0) {
    const problems = errors
      .map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return env;
}
