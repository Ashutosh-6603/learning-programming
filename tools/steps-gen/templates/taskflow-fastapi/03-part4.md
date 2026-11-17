## Part 4 · Authentication

The design is the same as in every TaskFlow backend (README §6): argon2id passwords, a 15-minute JWT access token sent as `Authorization: Bearer`, and an opaque 7-day refresh token in an `httpOnly` cookie, rotated on every use and stored in Redis as a hash. What's new is how FastAPI expresses "this route needs a user": **a dependency**, declared once on a group of routers, instead of a middleware (Express) or a global guard (NestJS).

### Step 4.1 · Password hashing with argon2id

**Goal:** hash and verify passwords with argon2id at the OWASP baseline, without blocking the event loop.

**Files:** `app/auth/__init__.py`, `app/auth/passwords.py`

```bash
uv add --bounds exact "pwdlib[argon2]==0.3.1"
mkdir app/auth && touch app/auth/__init__.py
```

- **pwdlib** is a small, modern password-hashing library (the one FastAPI's own docs recommend); the `[argon2]` extra installs `argon2-cffi`, the binding to the reference C implementation.

@copy app/auth/__init__.py

@show app/auth/passwords.py all

**What's new (TS → Python)**
- **The event loop must never wait on the CPU.** argon2 deliberately burns about 20 ms per hash. Node's `argon2` package ran it on libuv's thread pool for you; in Python, calling `_hasher.hash(...)` inside an `async def` would freeze *every* request on this process for those 20 ms. **`await asyncio.to_thread(fn, *args)`** runs a blocking function in a worker thread and awaits the result. argon2's C code releases Python's **GIL** (the lock that lets only one thread run Python code at a time), so the threads really run in parallel. Remember this pattern: any blocking call (CPU-heavy work, a synchronous library) inside `async def` goes through `to_thread` ([gotcha](../../docs/gotchas.md#blocking-calls-inside-async-def-freeze-everything)).
- **Functions are values:** `asyncio.to_thread(_hasher.hash, password)` passes the method itself, plus its argument, like `pool.run(hasher.hash, password)`.
- **`@cache`** (from `functools`) memoises `_dummy_hash()`: the dummy hash is computed on the first unknown-email login, then reused.
- **`Literal[False]`** as a return type says "always `False`", for the call site's sake.

> **🧠 DSA & scalability · Memory-hard hashing, off the event loop**
> - **Data structure:** argon2id fills a 19 MiB block of memory with pseudo-random data derived from the password and a random salt, then reads it in a data-dependent order (t = 2 passes). The output string stores the algorithm, the parameters, the salt and the hash: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>`.
> - **Algorithm:** verify re-runs the same computation with the stored salt and parameters and compares in constant time.
> - **Complexity:** Θ(m · t) time and Θ(m) memory per hash, by design: ~20 ms and 19 MiB.
> - **Why it scales:** the cost is per login, not per request (requests carry a JWT). `to_thread` keeps it off the event loop, so other requests keep flowing while a login hashes; the default thread pool caps concurrent hashes at a few dozen, bounding memory.
> - **Alternatives rejected:** bcrypt (not memory-hard, so GPUs crack it far faster; 72-byte input limit); SHA-256 with a salt (billions per second on a GPU); hashing on the event loop (a login burst would stall the whole API).

**✅ Checkpoint**

```bash
uv run python -c "
import asyncio
from app.auth.passwords import hash_password, verify_password
async def main():
    h = await hash_password('correct-horse')
    print(h[:31], await verify_password('correct-horse', h), await verify_password('wrong', h))
asyncio.run(main())"
```

Expected: `$argon2id$v=19$m=19456,t=2,p=1$ True False`.

@verify .venv/bin/mypy .

**Commit:** `feat: argon2id password hashing off the event loop`

### Step 4.2 · Access tokens and the `authenticate` dependency

**Goal:** sign and verify HS256 JWTs, and a dependency that turns a valid `Authorization: Bearer` header into the caller's user id, or a 401.

**Files:** `app/auth/tokens.py`, `app/auth/dependencies.py`

```bash
uv add --bounds exact pyjwt==2.15.1
```

- **PyJWT** is the standard Python JWT library (`jsonwebtoken`'s role). It signs, and it verifies the signature, expiry, issuer and audience in one call.

@show app/auth/tokens.py all

**What's new**
- **`datetime.now(UTC)`** is an **aware** datetime (it knows it's UTC); PyJWT turns `datetime` values into the numeric `iat`/`exp` claims. `timedelta(seconds=…)` is a duration you can add to a datetime.
- **`leeway=30`** tolerates 30 seconds of clock skew between servers; `options={"require": [...]}` refuses tokens without those claims.
- **`except jwt.InvalidTokenError, ValueError:`** catches either exception. Since **Python 3.14** the brackets are optional: older code writes `except (A, B):`. `InvalidTokenError` covers a bad signature, expiry, wrong issuer or audience and garbage input; `ValueError` covers a `sub` that isn't a UUID.

@show app/auth/dependencies.py 1-8

@show app/auth/dependencies.py 10-11

@show app/auth/dependencies.py 13-13

@show app/auth/dependencies.py 16-41

**What's new (TS → FastAPI)**
- **`authenticate` is a dependency with dependencies.** It asks for the request, the settings and **`Depends(bearer)`**: `HTTPBearer` is FastAPI's built-in dependency that reads `Authorization: Bearer <token>`. With `auto_error=False` it returns `None` instead of raising FastAPI's own 403, so the 401 is our problem body. As a side effect, every route that depends on `bearer` is marked as needing a bearer token in the generated OpenAPI, and Swagger UI shows an **Authorize** button.
- **`CurrentUser = Annotated[UUID, Depends(authenticate)]`**: a route that declares `user_id: CurrentUser` gets the authenticated id, or never runs (the 401 is raised first). It's Nest's `@CurrentUser()` param decorator plus its guard, in one annotation.
- **`request.state.user_id`** feeds the access log (Step 3.3), and **`bind_contextvars(userId=…)`** adds the user to every log line written for the rest of the request.
- There's no "public" decorator to remember: routes are public until a dependency says otherwise. Step 4.7 attaches authentication to whole groups of routers at once, so new routes are protected by default.

**✅ Checkpoint**

```bash
uv run python -c "
from uuid import uuid7
from app.config import get_settings
from app.auth.tokens import create_access_token, read_access_token
s = get_settings(); uid = uuid7()
print(read_access_token(create_access_token(uid, s), s) == uid, read_access_token('junk', s))"
```

Expected: `True None`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: jwt access tokens and the authenticate dependency`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** issue, rotate (with reuse detection) and revoke refresh tokens, atomically, in Redis.

**Files:** `app/auth/refresh_tokens.py`

@show app/auth/refresh_tokens.py all

**What's new**
- **`"""..."""`** is a multi-line string (a template literal without interpolation); the Lua script is the same one every TaskFlow backend runs.
- **`redis.register_script(_ROTATE)`** returns a callable script object: the first call sends `SCRIPT LOAD`, later calls use `EVALSHA` with the script's hash, so the script text crosses the network once. `await self._rotate(keys=[...], args=[...])` runs it.
- **`async with self.redis.pipeline(transaction=True) as tx:`** queues commands and sends them as one `MULTI … EXEC` when `execute()` runs: all four writes succeed or none do.
- **`secrets.token_urlsafe(32)`** is 32 random bytes, base64url-encoded: `randomBytes(32).toString('base64url')`. The `secrets` module is the cryptographically secure generator; `random` is not.
- **A class as a dependency.** `RefreshTokens.__init__` declares `redis: RedisDep` and `settings: SettingsDep`, and `Annotated[RefreshTokens, Depends()]` with **no argument** tells FastAPI to build the class itself, resolving its constructor's parameters as dependencies. That's FastAPI's version of Nest's injectable providers: a service declares what it needs in its constructor and FastAPI wires it per request. In tests, the worker or a script you can still call `RefreshTokens(redis, settings)` yourself: outside FastAPI the `Annotated` metadata does nothing.
- **The return type is a union of tuples** (`("ok", user_id, token)` or `("invalid",)`): a tagged result without a class, which Step 4.5 takes apart with `match`.

> **🧠 DSA & scalability · Rotation with reuse detection**
> - **Data structure:** Redis hash `auth:rt:{sha256(token)}` → `{userId, familyId, status}`, and set `auth:family:{familyId}` of token hashes; both with a 7-day TTL.
> - **Algorithm:** issue = create a family with one active token. Rotate (one Lua script): unknown → invalid; already `rotated` → delete every token in the family (theft or replay) → invalid; otherwise mark it `rotated`, create the next token in the same family, extend the family's TTL.
> - **Complexity:** O(1) per rotation (hash and set operations), O(k) to revoke a family of k tokens.
> - **Why it scales:** Redis runs a Lua script atomically, so two concurrent refreshes with the same token can't both succeed, on any number of API instances. Only hashes are stored: a Redis dump doesn't leak usable tokens.
> - **Alternatives rejected:** long-lived access tokens (can't be revoked); refresh tokens in Postgres (works, but every refresh becomes a row lock and a write on the primary database); `WATCH`/`MULTI` optimistic transactions (correct, but retry loops in every backend; the script is simpler).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 41 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: refresh token rotation with reuse detection`

### Step 4.4 · The users service and schemas

**Goal:** the user's request and response models, and the service that reads and writes users.

**Files:** `app/users/__init__.py`, `app/users/schemas.py`, `app/users/service.py`

```bash
mkdir app/users && touch app/users/__init__.py
```

@copy app/users/__init__.py

@show app/users/schemas.py all

**What's new**
- **Input and output models are separate classes.** `UpdateUserIn` is what a client may send; `UserSummary` and `UserOut` are what the API returns. The model *is* the documentation: FastAPI publishes all three in the OpenAPI schema with camelCase names.
- **`@classmethod def of(cls, user: User) -> Self`** is a **named constructor**: called on the class (`UserOut.of(user)`), it receives the class as `cls` and returns a new instance. It's a TS `static of(user: User): UserOut`. Each output model lists its fields explicitly, so a column added later (like `password_hash`) never reaches the wire by accident.
- **`class UserOut(UserSummary)`** inherits the summary's fields and adds `created_at`; its `of` **overrides** the parent's.
- **`Annotated[DisplayName | None, NotNull] = None`**: the field may be omitted (default `None`), but sending `"displayName": null` is a 422 (Step 3.2).

@show app/users/service.py all

**What's new (TS → SQLAlchemy)**
- **`session.get(User, user_id)`** loads one row by primary key (`findOneBy({ id })`), or returns `None`.
- **`select(User).where(User.email == email)`** builds a query; **`User.email == email` doesn't compare anything**: on a mapped class, `==` builds an SQL expression (SQLAlchemy overloads the operator), so this is `WHERE users.email = $1`, with the value sent as a parameter. `.options(undefer(User.password_hash))` loads the deferred column for this one query.
- **`session.scalar(query)`** returns the first column of the first row (here a `User`) or `None`; **`session.scalars(query)`** returns all rows' first column. `User.id.in_(...)` is `WHERE id IN (...)`.
- **The unit of work:** `create` builds a `User`, `session.add(user)` stages it, `commit()` flushes the `INSERT` and commits. `update` loads the user, changes attributes, and `commit()` sends an `UPDATE` with only the changed columns (and `updated_at = now()`). There's no `save()` call: the session tracks what you changed.
- **`body.model_dump(exclude_unset=True)`** returns only the fields the client sent, as a dict with **snake_case** keys (the Python names), so `setattr(user, field, value)` can apply them: `setattr(obj, "x", v)` is `obj[x] = v` for attributes. This is FastAPI's documented PATCH pattern.
- `def create(self, *, email: ...)`: the bare `*` makes every argument keyword-only, so call sites read `create(email=..., password_hash=..., display_name=...)`.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 44 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: users service and schemas`

### Step 4.5 · The auth service and its schemas

**Goal:** register, log in, refresh and log out, as a service that knows nothing about HTTP.

**Files:** `app/auth/schemas.py`, `app/auth/service.py`

@show app/auth/schemas.py all

**What's new**
- **`AfterValidator(_email)`** runs after Pydantic has checked that the value is a string: it validates the syntax and returns the **lowercased** value, which is what the model stores. A validator can transform, not just accept or reject.
- **Why not Pydantic's `EmailStr`?** It delegates to the `email-validator` package, which also refuses reserved domains like `.test` and `.local`: a *delivery* policy, not syntax. The contract says only `format: email`, and the contract test (Part 12) generates such addresses. The WHATWG pattern is what browsers apply to `<input type="email">`. `json_schema_extra={"format": "email"}` keeps the generated docs accurate.
- **`re.compile(r"...")`** builds a regular expression once; `r"..."` is a **raw string**, where backslashes are literal (no `"\\."`). Two adjacent raw strings are joined into one. `fullmatch` must match the whole value, like `^...$`.
- **`token_type: Literal["Bearer"] = "Bearer"`**: a constant field with a default, so the router never sets it.

@show app/auth/service.py all

**What's new**
- **Constructor injection again:** `AuthService` asks for `UsersServiceDep` and `RefreshTokensDep`, and FastAPI builds the whole graph per request (with one shared session underneath).
- **Returning a tuple:** `return user, token` returns a pair, and callers unpack it: `user, token = await auth.register(body)`.
- **Same 401 either way, and constant time.** An unknown email still burns a dummy hash, so response times don't reveal which accounts exist.
- **`match` / `case`** is **structural pattern matching** ([primer §5](../../docs/python-for-ts-devs.md#match-structural-pattern-matching)): `case ("ok", user_id, new_token):` matches a three-item sequence whose first item is `"ok"` and binds the other two to names; `case _:` matches anything else. It's a `switch` that can also destructure.

**✅ Checkpoint**

```bash
uv run python -c "
from app.auth.schemas import RegisterIn
print(RegisterIn.model_validate({'email': 'Ada@Example.com', 'password': 'correct-horse', 'displayName': '  Ada  '}))"
```

Expected: `email='ada@example.com' password='correct-horse' display_name='Ada'` (lowercased, trimmed, and read from the camelCase key). `Model.model_validate(dict)` is how you validate data by hand, zod's `parse`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: auth service with register, login, refresh and logout`

### Step 4.6 · Sliding-window rate limiting as dependencies

**Goal:** 10 requests a minute per IP for register/login/refresh, 300 a minute per user for everything else, in Redis, failing open if Redis is down.

**Files:** `app/core/rate_limit.py`, `app/auth/dependencies.py`

@show app/core/rate_limit.py all

**What's new**
- **`time.time_ns() // 1_000_000`** is the current time in milliseconds (`Date.now()`); `//` is integer division.
- **`allowed, oldest = await self._script(...)`** unpacks the script's two-item reply.
- `math.ceil` rounds up: `Retry-After` is whole seconds, never 0.
- The limiter is a plain class, not a dependency: the two dependencies below construct one each per request (cheap: `register_script` only computes a hash).

@show app/auth/dependencies.py 9-9

@show app/auth/dependencies.py 12-12

@show app/auth/dependencies.py 14-15

@show app/auth/dependencies.py 42-72

**What's new**
- **`limit_api` depends on `CurrentUser`**, so FastAPI always runs `authenticate` first, and `limit_api` gets the user id: "who are you?" then "how often?", the order of Nest's two global guards, expressed as a data dependency instead of a registration order.
- **`request.client.host`** is the client's IP (behind a proxy, uvicorn's `--proxy-headers` fills it from `X-Forwarded-For`, Part 13).
- **Failing open:** `except RedisError` logs a warning and lets the request through. `exc_info=True` attaches the exception's traceback to the log line.
- **`ProblemError(..., headers={"Retry-After": ...})`**: the exception handler (Step 3.4) copies `headers` onto the response.

> **🧠 DSA & scalability · Sliding-window log in a sorted set**
> - **Data structure:** one Redis **sorted set** per bucket and subject (`ratelimit:api:user:{id}`): members are unique request ids (UUIDv7), scores are timestamps in ms. TTL = the window.
> - **Algorithm (one Lua script):** `ZREMRANGEBYSCORE` drops entries older than the window → `ZCARD` counts what's left → over the limit: return the oldest score (the client may retry when it leaves the window) → else `ZADD` this request.
> - **Complexity:** O(log n + k) per request, k = expired entries removed; memory O(limit) per subject.
> - **Why it scales:** the state lives in Redis, so all instances share one count, and the script is atomic, so concurrent requests can't both take the last slot.
> - **Alternatives rejected:** a fixed-window counter (`INCR` + `EXPIRE`: O(1), but allows 2× the limit across a window edge); a token bucket (smooths bursts; Pulse uses one); the `slowapi` library (works, but every TaskFlow backend runs the same algorithm and keys, so they're comparable).

**✅ Checkpoint**

```bash
uv run python -c "
import asyncio
from redis.asyncio import Redis
from app.config import get_settings
from app.core.rate_limit import SlidingWindowLimiter
async def main():
    redis = Redis.from_url(str(get_settings().redis_url), decode_responses=True)
    await redis.delete('ratelimit:demo')
    limiter = SlidingWindowLimiter(redis, limit=2, window_ms=60_000)
    for _ in range(3): print(await limiter.hit('ratelimit:demo'))
    await redis.delete('ratelimit:demo'); await redis.aclose()
asyncio.run(main())"
```

Expected:

```text
RateLimitResult(allowed=True, retry_after_seconds=0)
RateLimitResult(allowed=True, retry_after_seconds=0)
RateLimitResult(allowed=False, retry_after_seconds=60)
```

(A dataclass prints itself readably: that's the generated `__repr__`.)

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: sliding-window rate limiting in redis`

### Step 4.7 · Routers, and wiring it all up

**Goal:** the auth and users routes, and the router tree that makes every route except auth's require a token.

**Files:** `app/auth/router.py`, `app/users/router.py`, `app/main.py`

@show app/auth/router.py all

**What's new (TS → FastAPI routing)**
- **How FastAPI reads a route function's parameters:** a Pydantic model (`body: RegisterIn`) is the **JSON body**; `Response` is the response object; a `Depends(...)` annotation is a **dependency**; `Cookie()` reads a **cookie** with the parameter's name (`refresh_token`); a plain `int`/`str` would be a **query parameter**, and a name inside the path (`{taskId}`, Part 5) a **path parameter**. Everything is validated before your code runs, and a failure is a 422 with the field path (Step 3.4).
- **`dependencies=[Depends(limit_auth)]`** on the decorator runs a dependency whose *result* the function doesn't need, here only for its side effect (counting, maybe a 429).
- **`status_code=201`** sets the success status; the default is 200, and logout's 204 sends no body.
- **`response.set_cookie(...)`** writes `Set-Cookie`: `max_age` is in **seconds** here (Express wanted milliseconds), and `delete_cookie` sends the same cookie with `Max-Age=0`.
- **`AuthSession(**token.model_dump(), user=...)`**: `model_dump()` turns a model into a dict of its fields, and `**` spreads it into keyword arguments, `{...token, user}`.
- **`refresh_token: RefreshCookie = None`**: the default makes the cookie optional, so a missing cookie reaches the service (401), rather than failing validation (422). Parameters with defaults must come last in Python.
- **Response serialisation:** returning an `AuthSession` makes FastAPI dump it **by alias** (`accessToken`, `expiresIn`), validated against the return annotation.

@show app/users/router.py all

@show app/main.py 5-6

@show app/main.py 12-13

@show app/main.py 29-29

@show app/main.py 75-78

@show app/main.py 87-90

**What's new**
- **A router tree, secure by default.** `protected` is a router whose `dependencies=[Depends(limit_api)]` apply to **every route included in it**, and `limit_api` depends on `authenticate`: so each of those routes requires a valid token, then counts against the user's limit. Feature routers go into `protected` (Parts 5–10 add a line each); only `auth_router` is included straight into `api`. Forgetting to protect a new router would mean including it somewhere else on purpose, rather than forgetting a decorator.
- **`include_router`** nests routers; prefixes add up (`/api/v1` + `/auth` + `/login`).
- `import ... as auth_router` renames on import: every feature module calls its router `router`.

**✅ Checkpoint**

```bash
docker compose up -d
uv run --env-file .env fastapi dev
```

In a second terminal:

```bash
curl -s -X POST localhost:8004/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}'
curl -s localhost:8004/api/v1/users/me
```

Expected: the first prints a session, `{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":900,"user":{"id":"…","email":"ada@example.com","displayName":"Ada","createdAt":"…Z"}}`; the second, without a token, a 401 problem: `{"type":"https://taskflow.example/problems/unauthorized",…,"detail":"Authentication required",…}`. Swagger UI (http://localhost:8004/docs) now has an **Authorize** button. Stop the server.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: auth and users routes behind a secure-by-default router`

### Step 4.8 · Auth tests

**Goal:** the auth flows, end to end: register, login, refresh rotation and reuse, logout, `/users/me`, validation, 400/405, and the rate limit.

**Files:** `tests/helpers.py`, `tests/test_auth.py`

@show tests/helpers.py 4-4

@show tests/helpers.py 6-6

@show tests/helpers.py 68-80

**What's new**
- **`itertools.count(1)`** is an endless counter: `next(_counter)` returns 1, 2, 3… Each user gets a unique email; `_RUN` adds a random suffix per test run, because Mailpit keeps emails between runs (Part 11 reads them).
- `register_user` registers through the API, as a real client would, and returns the id, email and access token.

@show tests/test_auth.py all

**What's new**
- **`res.headers.get_list("set-cookie")`**: a response can carry several `Set-Cookie` headers; `get_list` returns them all. **`next(c for c in ... if ...)`** returns the first matching item, `find(...)`.
- **Refresh rotation and reuse**, the most important test here: after one rotation, replaying the first token must kill the whole family, so the second token stops working too.
- **The rate-limit test** makes 10 failed logins, then expects the 11th to be a 429 with `Retry-After`. Each test starts with an empty Redis (the `client` fixture), so the count is exact.
- **Malformed JSON → 400** needs a route that reads a body, which is why it lives here and not in the health tests.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `21 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `test: auth flows, rotation, rate limits`

### Step 4.9 · Seed the default user

**Goal:** a development login that exists on every fresh database: **`ashutosh@test.com` / `Ashutosh#1234`**, the same account every TaskFlow backend seeds.

**Files:** `app/users/default_user.py`, `app/seed.py`, `tests/test_seed.py`, `pyproject.toml`

@show app/users/default_user.py all

**What's new**
- **`Final`** marks a constant mypy won't let you reassign (TS's `const` for module-level names, which Python lacks).
- **Idempotent:** if the email exists, it returns `"exists"` and changes nothing; otherwise it creates the user through the same `UsersService` and hasher the API uses (no raw SQL), and returns `"created"`.

@show app/seed.py all

**What's new**
- **`python -m app.seed`** runs a module as a script. **`if __name__ == "__main__":`** is true only when the file is run that way, not when it's imported: Python's version of "is this the entry point?" (`import.meta.main`).
- **`raise SystemExit("...")`** exits with an error message and status 1. The password is public, so the seed refuses `APP_ENV=production`.
- It builds its own engine and session (no FastAPI here) and passes the session straight to `UsersService`: outside FastAPI, a service is a plain class.

@show tests/test_seed.py all

The seed script is an entry point with no logic of its own; leave it out of coverage, like the other entry scripts:

@excerpt pyproject.toml 69-69 | add under `source = ["app"]` in `[tool.coverage.run]`

**✅ Checkpoint**

```bash
uv run python -m app.seed
uv run python -m app.seed
uv run pytest
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then `22 passed`. You can now log in as `ashutosh@test.com` / `Ashutosh#1234` from Swagger UI or the frontend.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: seed the default development user`

---
