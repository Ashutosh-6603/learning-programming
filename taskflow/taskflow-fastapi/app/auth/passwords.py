import asyncio
from functools import cache
from typing import Literal

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

# OWASP baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane.
_hasher = PasswordHash((Argon2Hasher(memory_cost=19_456, time_cost=2, parallelism=1),))


# argon2 burns ~20 ms of CPU on purpose. Run on the event loop, that would freeze every other
# request for those 20 ms; asyncio.to_thread moves it to a worker thread (argon2 releases the GIL).
async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)


async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(_hasher.verify, password, password_hash)


@cache
def _dummy_hash() -> str:
    return _hasher.hash("dummy-password-for-timing")


async def verify_against_dummy(password: str) -> Literal[False]:
    """Burns the same time as a real check, so unknown emails can't be detected by timing."""
    await asyncio.to_thread(_hasher.verify, password, _dummy_hash())
    return False
