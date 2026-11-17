import math
import time
from dataclasses import dataclass
from uuid import uuid7

from redis.asyncio import Redis

# Sliding-window log. KEYS[1] = bucket key. ARGV = now (ms), window (ms), limit, unique member.
# Returns {1, 0} when allowed, {0, oldest timestamp} when the window is full.
_SLIDING_WINDOW = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2])}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0}
"""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    retry_after_seconds: int


class SlidingWindowLimiter:
    def __init__(self, redis: Redis, limit: int, window_ms: int) -> None:
        self.limit = limit
        self.window_ms = window_ms
        self._script = redis.register_script(_SLIDING_WINDOW)

    async def hit(self, key: str, now_ms: int | None = None) -> RateLimitResult:
        now = now_ms if now_ms is not None else time.time_ns() // 1_000_000
        allowed, oldest = await self._script(
            keys=[key], args=[now, self.window_ms, self.limit, str(uuid7())]
        )
        if allowed == 1:
            return RateLimitResult(allowed=True, retry_after_seconds=0)
        wait_ms = oldest + self.window_ms - now
        return RateLimitResult(allowed=False, retry_after_seconds=max(1, math.ceil(wait_ms / 1000)))
