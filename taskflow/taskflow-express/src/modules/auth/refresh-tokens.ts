import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

const tokenKey = (hash: string) => `auth:rt:${hash}`;
const familyKey = (familyId: string) => `auth:family:${familyId}`;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

// Runs atomically inside Redis, so two concurrent refreshes with the same token can't both win.
// KEYS[1] = auth:rt:<old hash>   ARGV[1] = new hash   ARGV[2] = ttl seconds
const ROTATE_SCRIPT = `
local data = redis.call('HGETALL', KEYS[1])
if #data == 0 then return {'missing'} end
local t = {}
for i = 1, #data, 2 do t[data[i]] = data[i + 1] end
local family = 'auth:family:' .. t.familyId
if t.status == 'rotated' then
  for _, h in ipairs(redis.call('SMEMBERS', family)) do redis.call('DEL', 'auth:rt:' .. h) end
  redis.call('DEL', family)
  return {'reused'}
end
redis.call('HSET', KEYS[1], 'status', 'rotated')
local newKey = 'auth:rt:' .. ARGV[1]
redis.call('HSET', newKey, 'userId', t.userId, 'familyId', t.familyId, 'status', 'active')
redis.call('EXPIRE', newKey, ARGV[2])
redis.call('SADD', family, ARGV[1])
redis.call('EXPIRE', family, ARGV[2])
return {'ok', t.userId}
`;

export type RotateResult = { status: 'ok'; userId: string; token: string } | { status: 'invalid' };

export class RefreshTokens {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /** Starts a new token family (one per login). */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const familyId = uuidv7();
    await this.redis
      .multi()
      .hset(tokenKey(hash), { userId, familyId, status: 'active' })
      .expire(tokenKey(hash), this.ttlSeconds)
      .sadd(familyKey(familyId), hash)
      .expire(familyKey(familyId), this.ttlSeconds)
      .exec();
    return token;
  }

  async rotate(token: string): Promise<RotateResult> {
    const next = randomBytes(32).toString('base64url');
    const result = (await this.redis.eval(
      ROTATE_SCRIPT,
      1,
      tokenKey(sha256(token)),
      sha256(next),
      this.ttlSeconds,
    )) as [string, string?];
    const [status, userId] = result;
    if (status === 'ok' && userId !== undefined) return { status: 'ok', userId, token: next };
    return { status: 'invalid' };
  }

  async revokeFamily(token: string): Promise<void> {
    const familyId = await this.redis.hget(tokenKey(sha256(token)), 'familyId');
    if (familyId === null) return;
    const hashes = await this.redis.smembers(familyKey(familyId));
    await this.redis.del(familyKey(familyId), ...hashes.map(tokenKey));
  }
}
