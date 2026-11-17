import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

// Sliding-window log. KEYS[1] = bucket key. ARGV = now(ms), window(ms), limit, unique member.
// Returns {1, 0} when allowed, {0, oldestTimestamp} when the window is full.
const SLIDING_WINDOW = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2])}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async hit(key: string, now = Date.now()): Promise<RateLimitResult> {
    const [allowed, oldest] = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      key,
      now,
      this.windowMs,
      this.limit,
      uuidv7(),
    )) as [number, number];
    if (allowed === 1) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
    };
  }
}
