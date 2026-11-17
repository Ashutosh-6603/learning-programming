import hashlib
import secrets
from typing import Annotated
from typing import Literal
from uuid import UUID
from uuid import uuid7

from fastapi import Depends

from app.deps import RedisDep
from app.deps import SettingsDep


def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _token_key(token_hash: str) -> str:
    return f"auth:rt:{token_hash}"


def _family_key(family_id: str) -> str:
    return f"auth:family:{family_id}"


# Runs atomically inside Redis, so two concurrent refreshes with the same token can't both win.
# KEYS[1] = auth:rt:<old hash>   ARGV[1] = new hash   ARGV[2] = ttl seconds
_ROTATE = """
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
"""


class RefreshTokens:
    """Opaque refresh tokens, stored in Redis only as SHA-256 hashes, grouped in families."""

    def __init__(self, redis: RedisDep, settings: SettingsDep) -> None:
        self.redis = redis
        self.ttl = settings.refresh_token_ttl_seconds
        # Loaded once per Redis server and then called by its SHA1 (EVALSHA), not resent each time.
        self._rotate = redis.register_script(_ROTATE)

    async def issue(self, user_id: UUID) -> str:
        """Starts a new token family (one per login)."""
        token = secrets.token_urlsafe(32)
        token_hash = _sha256(token)
        family_id = str(uuid7())
        async with self.redis.pipeline(transaction=True) as tx:
            tx.hset(
                _token_key(token_hash),
                mapping={"userId": str(user_id), "familyId": family_id, "status": "active"},
            )
            tx.expire(_token_key(token_hash), self.ttl)
            tx.sadd(_family_key(family_id), token_hash)
            tx.expire(_family_key(family_id), self.ttl)
            await tx.execute()
        return token

    async def rotate(
        self, token: str
    ) -> tuple[Literal["ok"], UUID, str] | tuple[Literal["invalid"]]:
        """Swaps a valid token for a new one in the same family; a reused one kills the family."""
        new = secrets.token_urlsafe(32)
        result = await self._rotate(
            keys=[_token_key(_sha256(token))], args=[_sha256(new), self.ttl]
        )
        if result[0] == "ok":
            return "ok", UUID(result[1]), new
        return ("invalid",)

    async def revoke_family(self, token: str) -> None:
        family_id = await self.redis.hget(_token_key(_sha256(token)), "familyId")
        if family_id is None:
            return
        family = _family_key(str(family_id))
        hashes = await self.redis.smembers(family)
        await self.redis.delete(family, *(_token_key(str(h)) for h in hashes))


RefreshTokensDep = Annotated[RefreshTokens, Depends()]
