## Part 4 · Authentication

The auth design (README §6) is unchanged: argon2id passwords, 15-minute JWT access tokens, and 7-day refresh tokens that rotate on every use, are stored hashed in Redis, and revoke their whole family when replayed. What changes is how Nest plugs it in: a **Passport strategy**, a **global guard** that protects every route unless it's marked `@Public()`, **custom parameter decorators**, and a guard for rate limiting.

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
- Identical to Express and Fastify: this file doesn't touch the framework.

> **🧠 DSA & scalability · password hashing**
> - **Algorithm:** argon2id, a *memory-hard* hash: each verification fills 19 MiB of RAM and makes 2 passes over it.
> - **Why memory-hard:** attackers guess passwords on GPUs with thousands of cores but little memory per core; 19 MiB per guess caps how many run in parallel. bcrypt is only CPU-hard, and SHA-256 is designed to be fast, the opposite of what you want.
> - **Cost:** ~20–50 ms of CPU per login, on purpose. Logins are rare, and `/auth/*` gets a strict rate limit (Step 4.6).
> - **Timing side channel:** `verifyAgainstDummy` makes "no such email" do the same work as "wrong password", so response times don't reveal which emails have accounts.
> - **Rejected:** bcrypt (72-byte limit, not memory-hard), PBKDF2 (CPU-hard only), plain SHA-256 (fast = crackable).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: argon2id password hashing`

### Step 4.2 · Access tokens: a Passport strategy, a global guard and `@Public()`

**Goal:** verify the `Authorization: Bearer` token on every request, unless the route opts out.

**Files:** `src/modules/auth/jwt.strategy.ts`, `src/modules/auth/decorators.ts`, `src/modules/auth/jwt-auth.guard.ts`

```bash
npm i -E @nestjs/jwt@12.0.4 @nestjs/passport@12.0.1 passport@0.7.0 passport-jwt@4.0.1
npm i -D -E @types/passport-jwt@4.0.1
```

- **Passport** is Node's classic authentication library: each way of authenticating is a **strategy** (`passport-jwt` for bearer tokens, `passport-google-oauth20` for Google, …). **`@nestjs/passport`** wraps strategies as injectable classes and turns them into guards. **`@nestjs/jwt`** wraps `jsonwebtoken` as an injectable `JwtService` for **signing** (Step 4.7).
- Why Passport, when `jsonwebtoken` alone would do? It's Nest's documented way to authenticate, and adding a second login method later means adding a strategy, not rewriting the guard.

@show src/modules/auth/jwt.strategy.ts all

**What's new**
- **`PassportStrategy(Strategy)`** is a **mixin**: a function that returns a class, so `extends PassportStrategy(Strategy)` creates an injectable Nest class from passport-jwt's `Strategy`. The `super({...})` options tell passport-jwt where the token is (`fromAuthHeaderAsBearerToken()`), the secret, and what to check: `HS256` only (so a token claiming `alg: none` is rejected), issuer `taskflow`, audience `taskflow-api`, 30 seconds of clock tolerance.
- **`validate(payload)`** runs only after the signature and claims check out. **Whatever it returns becomes `request.user`**: here `{ id }` from the `sub` claim. No database lookup: the token is enough.

@show src/modules/auth/decorators.ts all

**What's new**
- **`SetMetadata(key, value)`** is the simplest decorator factory: it attaches a key/value to a class or method. `@Public()` attaches `isPublic: true`; the guard below reads it.
- **`createParamDecorator`** makes a **parameter decorator** like `@Body()`: Nest calls the function with the decorator's argument and the `ExecutionContext`, and passes the result to the handler. `@CurrentUser() userId: string` hands a handler the signed-in user's id; `@Cookie('refresh_token')` hands it a cookie. Controllers never touch `req`.

@show src/modules/auth/jwt-auth.guard.ts all

**What's new (guards)**
- **A guard** decides whether a request may reach its handler: `canActivate()` returns `true`, `false` (a 403) or throws. Guards run **after middleware and before pipes**, and unlike middleware they know **which handler** will run (`context.getHandler()`, `context.getClass()`), so they can read its metadata. ☕ Spring Security's filter chain and `@PreAuthorize`.
- **`AuthGuard('jwt')`** is @nestjs/passport's guard for the strategy named `jwt` (passport-jwt's default name). We extend it: **`Reflector.getAllAndOverride(IS_PUBLIC, [handler, class])`** reads `@Public()` from the method first, then the controller. Public routes skip the strategy; everything else runs it.
- **`handleRequest(err, user, info)`** is where Passport reports the outcome. `info` says why there's no user (`No auth token`, `jwt expired`, `invalid signature`); we turn every failure into our 401 problem.
- **Secure by default.** The guard will be registered **globally** (Step 4.7), so a new controller is protected the moment it exists, and forgetting a decorator locks a route rather than exposing it. Express and Fastify did the opposite (attach the auth middleware/hooks to a group); there, forgetting it exposes a route.

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
@verify npx eslint .

**Commit:** `feat: passport jwt strategy, global auth guard and @Public()`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** opaque refresh tokens, stored as SHA-256 hashes, rotated atomically on every use, with reuse detection.

**Files:** `src/modules/auth/refresh-tokens.service.ts`

@show src/modules/auth/refresh-tokens.service.ts 1-36

@show src/modules/auth/refresh-tokens.service.ts 37-83

**What's new**
- The Redis logic is Express's. The Nest part is the wrapper: an **`@Injectable()` service** that receives the Redis client by token (`@Inject(REDIS)`) and the config by type, and reads the TTL once in its constructor.

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

### Step 4.4 · The users service and DTOs

**Goal:** the user table's queries in one injectable service, and the public shape of a user.

**Files:** `src/modules/users/user.dto.ts`, `src/modules/users/users.service.ts`

@show src/modules/users/user.dto.ts all

**What's new**
- **Input DTOs and output DTOs are both classes.** `UpdateUserDto` has validation decorators: the global pipe builds and checks it. `UserSummaryDto` and `UserDto` have none: they exist so the Swagger plugin can document responses, and so `extends` can reuse fields (`UserDto` = summary + `createdAt`).
- The mappers pick fields explicitly, so an entity's `passwordHash` can never reach a response, and turn `Date`s into ISO strings.

@show src/modules/users/users.service.ts all

**What's new (TypeORM repositories)**
- **`@InjectRepository(User)`** asks for TypeORM's `Repository<User>`, the object you query a table through. It exists because the module will call `TypeOrmModule.forFeature([User])` (Step 4.7). ☕ Spring Data's `JpaRepository<User, UUID>`, except you don't write an interface: TypeORM gives you the generic one.
- **`findOneBy({ id })`** is `SELECT … WHERE id = $1 LIMIT 1`, returning the entity or `null`. `findBy({ id: In(ids) })` uses a **find operator** for `IN (…)`.
- **The query builder** (`createQueryBuilder('user')`) is TypeORM's SQL-like API, for what `find` options can't say. `.addSelect('user.passwordHash')` adds the `select: false` column for the one query that needs it; `:email` is a **named parameter**, sent separately from the SQL, so there's no injection.
- **`save(create(data))`**: `create` builds an entity instance from a plain object (no SQL), `save` INSERTs it and returns it with database defaults (`id`, timestamps) filled in. `update(criteria, data)` is a single `UPDATE` that doesn't return the row, hence the `findById` after it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: users service and dtos`

### Step 4.5 · The auth service and its DTOs

**Goal:** register, login, refresh and logout as plain business logic, independent of HTTP.

**Files:** `src/modules/auth/auth.dto.ts`, `src/modules/auth/auth.service.ts`

@show src/modules/auth/auth.dto.ts all

@show src/modules/auth/auth.service.ts all

**What's new**
- **`@ToLowerCase()` runs before `@IsEmail()`**, so emails are stored and compared in one case (the database's `CHECK (email = lower(email))` backs it up).
- The service depends on two other services through its constructor; Nest wires them. It knows nothing about cookies or JWTs: it proves who you are and returns the new refresh token, and the controller (Step 4.7) turns that into an access token and a cookie, as in Fastify.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: auth service and dtos`

### Step 4.6 · Sliding-window rate limiting as a guard

**Goal:** 10 auth requests per minute per IP, 300 API requests per minute per user, shared by every instance through Redis.

**Files:** `src/common/rate-limit/sliding-window-limiter.ts`, `src/common/rate-limit/rate-limit.guard.ts`

@show src/common/rate-limit/sliding-window-limiter.ts all

@show src/common/rate-limit/rate-limit.guard.ts 1-45

@show src/common/rate-limit/rate-limit.guard.ts 46-69

**What's new**
- The limiter class is Express's. The wrapper is a **second global guard**: guards run in registration order, so it runs after `JwtAuthGuard` and already knows `req.user`. Signed-in requests count per user; `@RateLimit('auth')` routes (login, register, refresh) count per IP in the strict bucket; other public routes (health checks, logout) aren't counted.
- **`this.reflector.get(RATE_LIMIT, context.getHandler())`** reads the handler's `@RateLimit()` metadata, the same mechanism as `@Public()`.
- **Why not `@nestjs/throttler`?** It's Nest's official rate-limit module and a fine choice for most apps. Its Redis storage counts requests in **fixed windows**, while TaskFlow's README asks for a **sliding window**, and we want the same algorithm in all six backends so the comparison stays fair.

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
@verify npx eslint .

**Commit:** `feat: redis sliding-window rate limit guard`

### Step 4.7 · Controllers, modules, and wiring it all up

**Goal:** `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and `/users/me`, with the two guards installed globally.

**Files:** `src/app.setup.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/users/users.controller.ts`, `src/modules/users/users.module.ts`, `src/modules/auth/auth.module.ts`, `src/app.module.ts`, `src/modules/health/health.controller.ts`

```bash
npm i -E cookie-parser@1.4.7
npm i -D -E @types/cookie-parser@1.4.10
```

- **`cookie-parser`** is the Express middleware that fills `req.cookies`, which `@Cookie()` reads. Nest runs on Express, so it's the same package the Express repo used.

@show src/app.setup.ts 5-5

@show src/app.setup.ts 37-37

@show src/modules/auth/auth.controller.ts 1-36

@show src/modules/auth/auth.controller.ts 37-71

@show src/modules/auth/auth.controller.ts 72-95

**What's new**
- **`@Public()` on the controller** applies to all four routes. **`@RateLimit('auth')`** on three of them.
- **`@Post()` defaults to 201**; `@HttpCode(200)` and `@HttpCode(204)` set the others.
- **`@Body() dto: RegisterDto`**: the global validation pipe sees the type `RegisterDto` and validates the body against it before the method runs. The method receives a **validated instance**.
- **`JwtService.signAsync({}, { subject: userId })`** signs with the defaults from `JwtModule.registerAsync` (below) plus the subject.
- `res.cookie(name, value, { maxAge })` counts **milliseconds** (Express's API); `clearCookie` must repeat the same `path`, or the browser keeps the cookie.
- The return type `Promise<AuthSessionDto>` is also what the Swagger plugin documents as the response.

@show src/modules/users/users.controller.ts all

@show src/modules/users/users.module.ts all

**What's new**
- **`TypeOrmModule.forFeature([User])`** registers `Repository<User>` as a provider *in this module*: that's what `@InjectRepository(User)` resolves to.
- **`exports: [UsersService]`**: providers are private to their module. `AuthModule` imports `UsersModule` and can inject `UsersService` only because it's exported. ☕ Spring has no such walls by default (every bean is visible); Nest's modules are closer to Java modules' `exports`.
- `@PatchBody()` (Step 3.2) rejects an empty PATCH; `defined(dto)` passes only the fields sent.

@show src/modules/auth/auth.module.ts all

**What's new**
- **`JwtModule.registerAsync`** configures `JwtService` with the secret and default sign options (HS256, issuer, audience, 15-minute `expiresIn` in seconds). `registerAsync` is the per-module twin of `forRootAsync`.
- **`PassportModule`** registers Passport; listing `JwtStrategy` as a provider registers the strategy with Passport when Nest creates it.
- **`{ provide: APP_GUARD, useClass: JwtAuthGuard }`** makes the guard **global**, whichever module declares it; Nest's docs recommend declaring it next to the guard it registers. Two `APP_GUARD` providers in one module run in the order listed: authentication first, then rate limiting.

@show src/app.module.ts 9-9

@show src/app.module.ts 16-16

@show src/app.module.ts 24-25

@show src/modules/health/health.controller.ts 7-7

@show src/modules/health/health.controller.ts 29-29

**What's new**
- The health checks get **`@Public()`** now that every route requires a token by default: a load balancer probing `/health/ready` has no token.

> **🧠 DSA & scalability · global guards and metadata**
> - **Data structure:** per handler, a metadata map written once by decorators (`isPublic`, `rateLimit`), and a list of global guards.
> - **Algorithm:** for each request, Nest runs the guards in order; each reads the handler's metadata through `Reflector` (a map lookup) and decides.
> - **Complexity:** O(guards) map lookups per request, plus the token's HMAC check on protected routes.
> - **Why it scales:** no per-request I/O to authenticate; the only shared state is the rate-limit sorted set in Redis.
> - **Rejected:** listing public paths in a guard (a path list drifts from the controllers); per-controller `@UseGuards()` (forgetting one exposes a route).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s -c /tmp/tf.cookies localhost:8003/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}' | head -c 120; echo
curl -s -b /tmp/tf.cookies -X POST localhost:8003/api/v1/auth/refresh | head -c 60; echo
curl -s localhost:8003/api/v1/users/me; echo
```

Expected: a session starting `{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":900,"user":{…`, then `{"accessToken":"eyJ…` (refreshed with the cookie; curl, like browsers, sends `Secure` cookies to `localhost`), then a 401 problem: `{"type":"https://taskflow.example/problems/unauthorized",…,"detail":"Authentication required",…}`.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build

**Commit:** `feat: auth and users controllers behind a global guard`

### Step 4.8 · Auth tests

**Goal:** prove registration, validation, content types, login, rotation with reuse detection, logout, protection and rate limiting.

**Files:** `test/helpers.ts`, `test/auth.e2e-spec.ts`

@show test/helpers.ts 105-150

**What's new**
- `resetState` truncates every table (in one statement, `CASCADE` for the foreign keys) and flushes Redis database 1 before each test. Table names can't be bound parameters, so the list is ours, never user input.
- `registerUser` goes through the real API, so every test user has a real argon2 hash and a real token.

@chunks test/auth.e2e-spec.ts all

**What's new**
- `res.headers['set-cookie']` from Supertest is an array of raw headers; `refreshCookie` finds ours and keeps the `name=value` part to send back.
- The rate-limit test makes 10 allowed requests, then expects a 429 with `Retry-After`. It works because `resetState` flushes the limiter's keys before each test.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  4 passed (4)
      Tests  20 passed (20)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: auth integration tests`

---

### Step 4.9 · Seed the default user

**Goal:** one command that creates the login every TaskFlow backend shares for local development, **`ashutosh@test.com` / `Ashutosh#1234`**, so the frontend has an account ready on a fresh database.

**Files:** `src/modules/users/default-user.ts`, `src/seed.ts`, `vitest.config.ts`, `test/seed.e2e-spec.ts`

@show src/modules/users/default-user.ts all

**What's new**
- **Seed through the app's own code.** The function hashes with `hashPassword` (argon2id, Step 4.1) and writes through `UsersService`, so a seeded user is indistinguishable from one who signed up. Inserting a row with raw SQL would need a hash computed somewhere else, and would skip whatever rules `create` gains later.
- **Idempotent:** if the email exists it does nothing and says `exists`. You can run it after every `docker compose down -v`, or twice by accident.

@show src/seed.ts all

@show vitest.config.ts 24-24

```bash
npm pkg set scripts.db:seed="nest build && node dist/seed.js"
```

**What's new**
- **A third standalone application.** Like the worker (Part 11), `NestFactory.createApplicationContext(SeedModule)` builds the DI container without HTTP. `SeedModule` imports `CoreModule` (config, database) and `UsersModule`, then `app.get(UsersService)` takes the service out of the container. The module is declared right in the script because nothing else needs it. `logger: false` keeps Nest's start-up lines out of a one-line command.
- **It refuses to run in production**: the password is in this repo, so a seeded production database would have an account anyone can log into. `db:seed` builds first and runs the compiled file, like `db:migrate`.
- `src/seed.ts` joins the other entry scripts in the coverage exclusions: it's a program, tested through the function it calls.

@show test/seed.e2e-spec.ts all

**✅ Checkpoint**

```bash
npm run db:seed && npm run db:seed
npm test
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then:

```text
 Test Files  5 passed (5)
      Tests  21 passed (21)
```

Now `npm run dev` and log in from the frontend (or `curl`) with `ashutosh@test.com` / `Ashutosh#1234`.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build
@verify npx vitest run

**Commit:** `feat: seed the default development user`

---
