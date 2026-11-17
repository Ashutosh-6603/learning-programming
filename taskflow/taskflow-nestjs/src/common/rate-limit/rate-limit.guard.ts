import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.js';
import { REDIS } from '../../infra/redis.module.js';
import { ProblemError } from '../problem.js';
import { SlidingWindowLimiter, type RateLimitResult } from './sliding-window-limiter.js';

const MINUTE = 60_000;
const RATE_LIMIT = 'rateLimit';

/** `@RateLimit('auth')`: count this route per IP address in the strict "auth" bucket. */
export const RateLimit = (bucket: 'auth') => SetMetadata(RATE_LIMIT, bucket);

/**
 * Runs after JwtAuthGuard (guards run in the order they are registered), so `request.user`
 * is already known: signed-in requests are counted per user, @RateLimit('auth') routes per IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly auth: SlidingWindowLimiter;
  private readonly api: SlidingWindowLimiter;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) redis: Redis,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimitGuard.name);
    const perMinute = (name: 'RATE_LIMIT_AUTH_PER_MINUTE' | 'RATE_LIMIT_API_PER_MINUTE') =>
      new SlidingWindowLimiter(redis, config.get(name, { infer: true }), MINUTE);
    this.auth = perMinute('RATE_LIMIT_AUTH_PER_MINUTE');
    this.api = perMinute('RATE_LIMIT_API_PER_MINUTE');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const bucket = this.reflector.get<'auth' | undefined>(RATE_LIMIT, context.getHandler());
    // Public routes without @RateLimit (health checks, logout) aren't counted.
    if (!bucket && !req.user) return true;

    const [limiter, key] =
      bucket === 'auth' || !req.user
        ? [this.auth, `ratelimit:auth:ip:${req.ip ?? 'unknown'}`]
        : [this.api, `ratelimit:api:user:${req.user.id}`];
    let result: RateLimitResult;
    try {
      result = await limiter.hit(key);
    } catch (err) {
      this.logger.warn({ err }, 'rate limiter unavailable; failing open');
      return true;
    }
    if (result.allowed) return true;
    http.getResponse<Response>().set('Retry-After', String(result.retryAfterSeconds));
    throw new ProblemError('rate-limited', `Retry in ${result.retryAfterSeconds} seconds`);
  }
}
