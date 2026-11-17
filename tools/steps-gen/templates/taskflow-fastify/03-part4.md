## Part 4 · Authentication

The auth design (README §6) is unchanged: argon2id passwords, 15-minute JWT access tokens, and 7-day refresh tokens that rotate on every use, are stored hashed in Redis, and revoke their whole family when replayed. What changes is how Fastify plugs it in: a JWT **plugin**, **hooks** instead of middleware, and **encapsulation** to protect a group of routes.

### Step 4.1 · Password hashing with argon2id

**Goal:** hash passwords with argon2id, and make "unknown email" take as long as "wrong password".

**Files:** `src/modules/auth/passwords.ts`

```bash
npm i -E argon2@0.45.2
npm deny-scripts argon2
```

argon2's install script would compile it from C (`node-gyp rebuild`); the package also ships **prebuilt binaries** for Linux, macOS and Windows, which it loads when the build is skipped. Denying the script keeps installs fast and works in a slim Docker image without a compiler.

@show src/modules/auth/passwords.ts all

**What's new**
- Identical to Express: this file doesn't touch the HTTP framework.

> **🧠 DSA & scalability · password hashing**
> - **Algorithm:** argon2id, a *memory-hard* hash: each verification fills 19 MiB of RAM and makes 2 passes over it.
> - **Why memory-hard:** attackers guess passwords on GPUs with thousands of cores but little memory per core; 19 MiB per guess caps how many run in parallel. bcrypt is only CPU-hard, and SHA-256 is designed to be fast, the opposite of what you want.
> - **Cost:** ~20–50 ms of CPU per login, on purpose. Logins are rare, and `/auth/*` gets a strict rate limit (Step 4.6).
> - **Timing side channel:** `verifyAgainstDummy` makes "no such email" do the same work as "wrong password", so response times don't reveal which emails have accounts.
> - **Rejected:** bcrypt (72-byte limit, not memory-hard), PBKDF2 (CPU-hard only), plain SHA-256 (fast = crackable).

**✅ Checkpoint**

```bash
npx tsx -e "import('./src/modules/auth/passwords.ts').then(async (m) => { const h = await m.hashPassword('pw'); console.log(h.slice(0, 31), await m.verifyPassword(h, 'pw')) })"
```

Expected: `$argon2id$v=19$m=19456,t=2,p=1$ true` (the hash's parameters, then a successful verification).

**Commit:** `feat: argon2id password hashing`

### Step 4.2 · Access tokens with `@fastify/jwt`

**Goal:** sign and verify 15-minute access tokens with Fastify's JWT plugin.

**Files:** `src/types/fastify.d.ts`, `src/app.ts`

```bash
npm i -E @fastify/jwt@10.2.7
```

- **`@fastify/jwt`** wraps **fast-jwt** and plugs it into Fastify: `app.jwt.sign()` creates a token, and `request.jwtVerify()` reads the `Authorization: Bearer …` header and verifies it. In Express you wrote this as an `AccessTokens` class around `jsonwebtoken`.

@show src/types/fastify.d.ts 1-1

@show src/types/fastify.d.ts 12-17

**What's new**
- **`FastifyJWT`** is the plugin's extension point for your token shapes: `payload` is what you sign (empty: everything we need goes in registered claims), and `user` is what `jwtVerify()` returns. Augmenting it makes both typed.

@show src/app.ts 3-3

@show src/app.ts 30-32

@show src/app.ts 64-78 | add after the CORS registration (after its closing `});`)

**What's new**
- **Plugin options are the configuration**: `sign` defaults apply to every `app.jwt.sign()` call, `verify` defaults to every `request.jwtVerify()`. `HS256` with a ≥ 32-byte secret, issuer `taskflow`, audience `taskflow-api`, 15-minute lifetime (`expiresIn` is in seconds here), 30 s of clock tolerance (in milliseconds: fast-jwt's unit).
- `algorithms: ['HS256']` pins the verifier to one algorithm, so a token claiming `alg: none` or an asymmetric algorithm is rejected (a classic JWT attack).
- `ISSUER` and `AUDIENCE` are exported constants: tests and other services can refer to them instead of repeating strings.
- **`register` decorates the instance.** After this line, `app.jwt` exists on the instance and `request.jwtVerify` on every request. Plugins extend Fastify by **decorating** it; that's how a plugin "adds features".

> **🧠 DSA & scalability · stateless access tokens**
> - **Data structure:** a JWT: base64url(header) . base64url(claims) . HMAC-SHA256(secret, the first two parts).
> - **Algorithm:** verifying = recompute the HMAC and compare in constant time, then check `exp`, `iss`, `aud`.
> - **Complexity:** O(token length), no I/O.
> - **Why it scales:** any API instance can verify any token without asking a database or Redis, so the hot path (every authenticated request) has no shared state. The price is that an access token can't be revoked; that's why it lives only 15 minutes, and revocation happens at refresh (Step 4.3).
> - **Rejected:** opaque session IDs looked up in Redis on every request (a network round trip per request); long-lived JWTs (a leaked one works for days).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: jwt access tokens with @fastify/jwt`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** opaque refresh tokens, stored as SHA-256 hashes, rotated atomically on every use, with reuse detection.

**Files:** `src/modules/auth/refresh-tokens.ts`

@show src/modules/auth/refresh-tokens.ts 1-30

@show src/modules/auth/refresh-tokens.ts 31-74

**What's new**
- Identical to Express: refresh tokens are a Redis concern, not a framework one. Read the 🧠 box as a refresher.

> **🧠 DSA & scalability · refresh-token rotation**
> - **Data structures (Redis):** a **hash** per token, `auth:rt:{sha256}` → `{userId, familyId, status}`, and a **set** per family, `auth:family:{id}` → token hashes. Both have a TTL, so Redis expires old sessions by itself.
> - **Algorithm (rotate, one Lua script):** missing → invalid. Status `rotated` → the token was already used once (stolen or replayed): delete the whole family → invalid. Otherwise mark it `rotated`, create the next token in the same family, return it.
> - **Complexity:** rotate O(1); revoking a family O(k) for its k tokens (bounded by the TTL).
> - **Why atomic:** two tabs refreshing with the same token at once would both pass a check-then-update done in two round trips. Inside one Lua script, exactly one wins.
> - **Why hash:** a Redis dump or a leaked log shows only SHA-256 hashes. Fast hashing is fine here (unlike for passwords) because the token is 256 random bits.
> - **Rejected:** refresh JWTs (not revocable without a denylist), Postgres storage (a DB write per refresh), no rotation (a stolen token lives 7 days).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: rotating refresh tokens with reuse detection`

### Step 4.4 · Users repository and DTOs

**Goal:** the user table's queries in one place, and the public shape of a user as a TypeBox schema.

**Files:** `src/modules/users/users.dto.ts`, `src/modules/users/users.repository.ts`

@show src/modules/users/users.dto.ts all

**What's new**
- **The DTO is a schema first.** `UserSummary` and `User` are TypeBox schemas that routes use as **response schemas**; the `…Dto` types are derived from them with `Static`. In Express you wrote the interfaces by hand. Now the API shape, the serializer and the TypeScript type come from one definition.
- `{ ...UserSummary.properties, createdAt }` extends an object schema by spreading its properties, like `z.object().extend()`.
- The mappers (`toUser`) still exist: they convert a row (with `Date`s) into the wire format (ISO strings), and they pick fields explicitly, so a row's `passwordHash` can never reach a response.

@show src/modules/users/users.repository.ts all

**What's new (Drizzle queries)**
- **`db.query.users.findFirst({ where: eq(users.id, id) })`** is the relational API: it returns the row or `undefined`. `eq` builds a SQL condition from a column and a value (bound as a parameter, so there's no SQL injection).
- **`columns: userSummaryColumns`** selects only those columns, like Prisma's `select`.
- **`db.insert(users).values(data).returning()`** is the SQL-like builder: `INSERT … RETURNING *`. It returns an **array** (an INSERT can write many rows), hence `const [user] = …`, and `noUncheckedIndexedAccess` makes `user` possibly `undefined`, hence the guard.
- **`db.update(users).set(data).where(…)`**: an `UPDATE`. Keys whose value is `undefined` are left out of the `SET`, so `{ displayName: undefined }` changes nothing. Our `updatedAt` column gets `now` automatically (`$onUpdate`, Step 2.2).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: users repository and dtos`

### Step 4.5 · Auth service and the authentication hooks

**Goal:** register, login, refresh and logout as plain business logic, and the hooks that read the access token.

**Files:** `src/modules/auth/auth.service.ts`, `src/http/auth.ts`

@show src/modules/auth/auth.service.ts all

**What's new**
- **The service doesn't create access tokens any more.** In Express, `AuthService` took an `AccessTokens` class. Here signing belongs to the jwt plugin, which lives on the Fastify instance, so the service returns *who* the user is (and the new refresh token) and the route (Step 4.7) signs the access token. The service stays free of HTTP and JWT details.

@show src/http/auth.ts all

**What's new**
- **These are `onRequest` hooks, not middleware.** A hook doesn't call `next()`: it returns (or resolves) to continue, and throws to stop with an error, which goes to the error handler. Express's `next(err)` and `next()` become `throw` and `return`.
- `authenticate` only *reads* a token. A missing header leaves `request.userId` null, a bad token is a 401. `requireAuth` then rejects anonymous requests. Keeping them apart lets the rate limiter (next step) run in between and limit by user when it can, by IP otherwise, the same order as in Express.
- **`request.jwtVerify()`** comes from `@fastify/jwt`. Its errors have their own messages and codes; we replace them with our single "Invalid or expired access token" 401, so clients see one problem type.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: auth service and authentication hooks`

### Step 4.6 · Sliding-window rate limiting

**Goal:** 10 auth requests per minute per IP, 300 API requests per minute per user, shared by every instance through Redis.

**Files:** `src/http/rate-limit.ts`

@show src/http/rate-limit.ts 1-47

@show src/http/rate-limit.ts 48-69

**What's new**
- The limiter class is Express's; only the wrapper changed: **`rateLimit()` returns an `onRequest` hook**. `onRequest` runs before Fastify reads the body, so a flood of large requests is rejected before any of it is parsed.
- `request.ip` is the client address Fastify computed (honouring `trustProxy` if you enable it behind a load balancer).
- **Why not `@fastify/rate-limit`?** It's the official plugin, and a fine choice for most apps. It implements a **fixed window** (one counter per window), while TaskFlow's README asks for a **sliding window**, and we want the same algorithm in all six backends so the comparison stays fair.

> **🧠 DSA & scalability · sliding-window log**
> - **Data structure:** a Redis **sorted set** per (bucket, subject): member = a unique request ID, score = timestamp in ms.
> - **Algorithm (one Lua call):** `ZREMRANGEBYSCORE` drops entries older than the window → `ZCARD` counts the rest → if count ≥ limit, read the oldest score to compute `Retry-After` → else `ZADD` this request and `PEXPIRE` the key.
> - **Complexity:** O(log n) per request for n entries in the window; memory O(limit) per subject.
> - **Why it scales:** the state is in Redis, so every API instance shares one limit per user; the Lua script makes it atomic. If Redis is down we **fail open** (log and let the request through) rather than take the API down with it.
> - **Rejected:** fixed window (`INCR` + `EXPIRE`, O(1) but allows 2× the limit across a boundary), token bucket (great for bursts; Pulse uses one), in-memory limits (wrong as soon as there are two instances).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: redis sliding-window rate limiter`

### Step 4.7 · Routes, and wiring it all up

**Goal:** `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and `/users/me`, wired into the app behind the right hooks.

**Files:** `src/modules/auth/auth.routes.ts`, `src/modules/users/users.routes.ts`, `src/app.ts`, `src/container.ts`

```bash
npm i -E @fastify/cookie@11.1.5
```

- **`@fastify/cookie`** parses the `Cookie` header into `request.cookies` and adds `reply.setCookie()` / `reply.clearCookie()`, Express's `cookie-parser` plus `res.cookie()`.

@show src/modules/auth/auth.routes.ts 1-36

**What's new**
- **Request and response schemas side by side.** `RegisterBody` validates the input (trimmed name, lowercased email); `AuthSession` describes the output and drives the serializer. `Type.Literal('Bearer')` is a one-value type, like zod's `z.literal`.
- `AuthRoutesOptions` is what the plugin needs from outside: the service, the cookie settings, and the rate-limit hook. The app (below) passes them in.

@show src/modules/auth/auth.routes.ts 37-60

@show src/modules/auth/auth.routes.ts 61-92

**What's new**
- **Route-level hooks:** `{ onRequest: opts.rateLimit }` in a route's options runs that hook for this route only. `limited` is spread into the three routes that need the strict auth limit; `/auth/logout` doesn't.
- **`app.jwt.sign({}, { sub: userId })`** signs with the defaults from Step 4.2 plus the subject. The route builds the token response, since the jwt plugin lives on the instance.
- **`reply.setCookie(name, value, options)`**: `maxAge` is in **seconds** here (Express's `res.cookie` took milliseconds). `clearCookie` must repeat the same `path`, or the browser keeps the cookie. `reply.status(201)` then `return body`: setting the status doesn't send anything; returning the body does.
- **`request.cookies`** is typed `Record<string, string | undefined>`; `cookieOf` turns an empty value into `undefined`.

@show src/modules/users/users.routes.ts all

**What's new**
- The handler only extracts what it needs and returns a DTO; validation already happened (`UpdateUserBody` is a `Patch`, so `{}` is a 422 before the handler runs).

@show src/container.ts 13-14

@show src/container.ts 24-24

@show src/container.ts 59-60

@show src/container.ts 68-68 | add after `return {` in `createServices`

@show src/container.ts 73-73

@show src/app.ts 1-1

@show src/app.ts 10-10

@show src/app.ts 14-14

@show src/app.ts 18-18

@show src/app.ts 26-26

@show src/app.ts 29-29

@show src/app.ts 63-63

@show src/app.ts 110-141

@show src/app.ts 150-154

**What's new**
- **Encapsulation is the key Fastify idea here.** `app.register(async (api) => { … }, { prefix: '/api/v1' })` creates a **child context**: routes registered inside get the `/api/v1` prefix, and hooks added inside apply only inside. Within it, the auth routes are registered first, then **another child context** (`secured`) adds `authenticate`, the API rate limit and `requireAuth`. Those hooks run for every route registered in `secured` and **never** for the auth routes next to it. In Express the same effect came from the *order* of `api.use()` calls; in Fastify it's the *shape of the plugin tree*, which can't be broken by moving a line.
- **Hook order** is the order of `addHook` calls: authenticate → rate limit (by user if known) → require auth.
- `withMethodNotAllowed` wraps each context's registrations, so `PUT /api/v1/auth/login` is a 405 and an anonymous `PUT /api/v1/users/me` is a 401.

> **🧠 DSA & scalability · hooks per context**
> - **Data structure:** each Fastify context (plugin instance) holds arrays of hooks per lifecycle event; a child copies its parent's arrays when it's created, then appends its own.
> - **Algorithm:** at registration, each route gets the hook arrays of the context it was declared in, frozen; per request, Fastify runs that route's arrays in order.
> - **Complexity:** per request O(hooks on that route): no matching or `if (path.startsWith(…))` checks at run time.
> - **Why it scales:** adding protected modules adds no per-request cost to unprotected ones, and a route can't accidentally escape authentication by being declared in the wrong order.
> - **Rejected:** a global hook that checks the URL against an allow-list (easy to forget a path; every request pays for the check).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s -c /tmp/tf.cookies localhost:8002/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}' | head -c 120; echo
curl -s -b /tmp/tf.cookies -X POST localhost:8002/api/v1/auth/refresh | head -c 60; echo
curl -s localhost:8002/api/v1/users/me
```

Expected: a session starting `{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":900,"user":{…`, then `{"accessToken":"eyJ…` (refreshed with the cookie; curl, like browsers, sends `Secure` cookies to `localhost`), then a 401 problem: `{"type":"https://taskflow.example/problems/unauthorized",…}`.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: auth and users routes behind encapsulated hooks`

### Step 4.8 · Auth tests

**Goal:** prove registration, validation, content types, login, rotation with reuse detection, logout, protection and rate limiting.

**Files:** `tests/helpers.ts`, `tests/integration/auth.test.ts`

@show tests/helpers.ts 1-1

@show tests/helpers.ts 63-80

@chunks tests/helpers.ts 81-108

**What's new**
- `resetState` truncates every table and flushes Redis database 1 before each test. `sql.raw()` inserts the SQL text as-is (table names can't be bound parameters), which is only safe because the string is ours.
- `registerUser` goes through the real API, so every test user has a real argon2 hash and a real token.

@chunks tests/integration/auth.test.ts all

**What's new**
- **`res.headers['set-cookie']`** from `inject()` is the raw header (a string or an array); `refreshCookie` finds ours and keeps the `name=value` part to send back in a `Cookie` header.
- The malformed-JSON case sends a raw string as the body with a JSON `Content-Type`; the 415 case sends `text/plain`, which only works because we removed Fastify's text parser in Step 3.6.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: auth integration tests`

---

### Step 4.9 · Seed the default user

**Goal:** one command that creates the login every TaskFlow backend shares for local development, **`ashutosh@test.com` / `Ashutosh#1234`**, so the frontend has an account ready on a fresh database.

**Files:** `src/modules/users/default-user.ts`, `src/seed.ts`, `tests/integration/seed.test.ts`

@show src/modules/users/default-user.ts all

**What's new**
- **Seed through the app's own code.** The function hashes with `hashPassword` (argon2id, Step 4.1) and writes through `UsersRepository`, so a seeded user is indistinguishable from one who signed up. Inserting a row with raw SQL would need a hash computed somewhere else.
- **Idempotent:** if the email exists it does nothing and says `exists`. You can run it after every `docker compose down -v`, or twice by accident.

@show src/seed.ts all

```bash
npm pkg set scripts.db:seed="tsx src/seed.ts"
```

**What's new**
- A small program, like `src/migrate.ts`: load the validated config, open a Drizzle client, seed, close the pool so the process can exit.
- **It refuses to run in production**: the password is in this repo, so a seeded production database would have an account anyone can log into. (`vitest.config.ts` already lists `src/seed.ts` among the entry scripts excluded from coverage.)

@show tests/integration/seed.test.ts all

**✅ Checkpoint**

```bash
npm run db:seed && npm run db:seed
npm test
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then:

```text
 Test Files  4 passed (4)
      Tests  16 passed (16)
```

Now `npm run dev` and log in from the frontend (or `curl`) with `ashutosh@test.com` / `Ashutosh#1234`.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `feat: seed the default development user`

---
