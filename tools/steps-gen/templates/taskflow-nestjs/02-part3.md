## Part 3 · HTTP foundations

This Part builds everything between the socket and your business logic: errors as RFC 9457 problems, validation, request IDs and logging, 404/405/415, health checks, and the app itself. It's also where you meet **every core Nest concept**: modules, providers and dependency injection, controllers, pipes, exception filters, middleware and lifecycle hooks. Take it slowly; the rest of the guide reuses these ideas.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one error class that maps to the contract's `application/problem+json` body, and the function that writes it.

**Files:** `src/common/problem.ts`, `src/types/express.d.ts`, `src/common/http/send-problem.ts`

```bash
npm i -E @nestjs/common@12.4.2 @nestjs/core@12.4.2 @nestjs/platform-express@12.4.2 rxjs@7.8.2
npm i -D -E @types/express@5.0.6
```

- **`@nestjs/core`** is the framework: the DI container, the module system, the request pipeline. **`@nestjs/common`** holds the decorators and interfaces you import every day (`@Module`, `@Injectable`, `@Get`, `HttpException`).
- **`@nestjs/platform-express`** is the HTTP adapter. Nest doesn't parse HTTP itself: it runs **on top of Express** (or Fastify, with `@nestjs/platform-fastify`). Everything you know about Express requests and middleware still applies underneath.
- **`rxjs`** is a peer dependency: Nest's interceptors and WebSocket handlers can return Observables. You won't write any, but Nest needs the library.

@show src/common/problem.ts all

**What's new**
- The same `ProblemError` as Fastify's: a slug picks the status and title, `detail` and field `errors` are optional, and small factories (`notFound('Task')`) keep call sites short. `readonly slug` in the constructor's parameter list is TypeScript's **parameter property**: it declares the field and assigns it in one go. Nest uses this idiom everywhere, as you'll see in every constructor from here on.
- **Why not Nest's `HttpException`?** Nest has its own error classes (`NotFoundException`, `ConflictException`), and its default error body is `{ statusCode, message, error }`. The contract wants RFC 9457, and our error should know its problem slug, so we keep our own class and translate Nest's into it (Step 3.4).

@show src/types/express.d.ts all

@show src/common/http/send-problem.ts all

**What's new**
- **Declaration merging, as in Express:** `req.id` (Step 3.3) and `req.user` (Part 4) become typed on every Express `Request`. Nest hands you the real Express objects, so augmenting Express's types is still the way.
- `sendProblem` writes the body with Express's `res`. Two callers need it: the exception filter (Step 3.4) and a raw middleware that rejects a request before Nest sees it (Step 3.3).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Validation: the pipe, field paths and custom decorators

**Goal:** every request body, query string and path parameter is validated against a class, and failures become a 422 with the contract's `{ field, message }` list.

**Files:** `src/common/validation/field-errors.ts`, `src/common/validation/field-errors.spec.ts`, `src/common/validation/request-validation.pipe.ts`, `src/common/validation/parse-id.pipe.ts`, `src/common/validation/decorators.ts`

@show src/common/validation/field-errors.ts all

@show src/common/validation/field-errors.spec.ts all

**What's new**
- class-validator reports a **tree** of `ValidationError`s: each has the `property`, a `constraints` map (`{ isInt: 'limit must be an integer number' }`) and `children` for nested objects. `fieldErrors` walks it and produces one entry per field.
- **The wire names come for free.** In Fastify, Ajv reported JSON paths (`/nested/projectId`) that we converted. Here a DTO's property names *are* the camelCase wire names, so the path only needs the `query.` / `path.` prefix the contract uses.
- `Paramtype` is Nest's name for where a value came from: `'body' | 'query' | 'param' | 'custom'`.

@show src/common/validation/request-validation.pipe.ts all

**What's new (pipes)**
- **A pipe** is a class whose `transform(value, metadata)` runs on **each handler argument** before the handler: it can convert the value or throw. `metadata.metatype` is the argument's declared class (from `emitDecoratorMetadata` again), and `metadata.type` says whether it's the body, the query or a path parameter.
- **`ValidationPipe`** is Nest's built-in validating pipe: if the argument's type is a class with class-validator decorators, it builds an instance with class-transformer and validates it. We extend it and pass three options: **`transform: true`** hands the handler the built instance (with defaults and conversions applied), **`whitelist: true`** silently drops properties that have no decorator (the contract ignores unknown fields), **`stopAtFirstError: true`** reports one message per field.
- `exceptionFactory` normally builds Nest's `BadRequestException`. Ours wraps the raw errors, so `transform()` can catch them and turn them into a 422 `ProblemError` **with the field prefix**, which only `transform()` knows (`metadata.type`).
- **`@Injectable()`** marks a class that Nest's container may create and inject. You'll see it on every service, pipe and guard.

@show src/common/validation/parse-id.pipe.ts all

**What's new**
- A pipe for **one parameter**: `Param(name, ParseIdPipe)` reads the route parameter and runs it through the pipe. `IdParam` is a **custom parameter decorator** built from Nest's own: `@IdParam('taskId') taskId: string` in a controller reads `:taskId` and guarantees it's a UUID. A malformed id becomes a 422 on `path.taskId` instead of a Postgres "invalid input syntax for type uuid" error (a 500).
- Nest has a built-in `ParseUUIDPipe`; ours throws our problem type with the contract's field path, and accepts any UUID version (Postgres ids are v7).

@show src/common/validation/decorators.ts 1-35

@show src/common/validation/decorators.ts 36-56

**What's new**
- **Your own validation decorators** are just combinations of library ones. `Trim()` is a `Transform` (it runs during `plainToInstance`, before validation, so `"  "` fails `@Length(1, 80)`). `applyDecorators(a, b)` combines several decorators into one, as `IsDateTime()` does.
- **`IsOmittable` vs `@IsOptional()`.** class-validator's `@IsOptional()` skips validation for `undefined` **and `null`**. For a PATCH, `null` means "clear this field", and for a NOT NULL column it must be rejected. `ValidateIf(...)` says exactly when to validate: `IsOmittable` skips only `undefined`, `IsNullable` skips only `null`.
- **`NonEmptyPatchPipe`** runs *after* the global validation pipe (Step 3.6 registers that one): by then unknown keys are gone, so `{ "nonsense": 1 }` arrives as `{}` and is rejected. `PatchBody()` is `Body(NonEmptyPatchPipe)`: a body decorator with an extra pipe.
- `defined(dto)` drops `undefined` fields, so a service receives only what the client sent (merge semantics for PATCH).

**✅ Checkpoint**

```bash
npx vitest run src
```

Expected:

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run src

**Commit:** `feat: class-validator pipe with wire field paths and custom decorators`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an `X-Request-Id`, every log line is JSON with that ID, each request is logged once, responses carry the README's security headers, and non-JSON bodies are refused.

**Files:** `src/common/http/request-context.ts`, `src/infra/logger.ts`

```bash
npm i -E nestjs-pino@5.3.1 pino@10.4.0 pino-http@11.0.0 uuid@14.0.3
```

- **`nestjs-pino`** replaces Nest's built-in logger with **pino** (the logger Fastify uses), through **`pino-http`**, which logs one line per request. **`uuid`** mints request IDs (UUIDv7).

@show src/common/http/request-context.ts all

**What's new**
- **These are plain Express middleware**, `(req, res, next)` functions, exactly as in the Express repo. Nest supports its own middleware classes too, but these run for *every* request before routing, so registering them on the underlying Express app (Step 3.6) is simplest and runs earliest.
- **`jsonBodiesOnly` returns 415** for a body that isn't `application/json`. Express's JSON parser silently skips other content types, so without this a `text/plain` body would reach validation as "every field missing", a misleading 422.

> **🧠 DSA & scalability · request IDs**
> - **Data structure:** a UUIDv7 string per request: 48 bits of millisecond timestamp, then random bits.
> - **Algorithm:** reuse a well-formed incoming `X-Request-Id` (a proxy or the frontend may have set one), otherwise generate one; echo it in the response and in every log line.
> - **Complexity:** O(1); the regex caps incoming IDs at 128 safe characters, so a client can't inject log lines.
> - **Why it scales:** IDs are generated independently on every instance with no coordination, and being time-ordered they sort log searches naturally.
> - **Rejected:** incrementing counters (need shared state), UUIDv4 (no time order).

@show src/infra/logger.ts all

**What's new**
- `loggerOptions` returns **`nestjs-pino`'s `Params`**: under `pinoHttp`, options for pino-http. The same JSON shape as Fastify's logs: ISO time, `level` as a label, `service`, `requestId`.
- **`quietReqLogger` + serializers returning `undefined`**: by default pino-http logs the whole request and response objects, headers included. Headers carry the access token and the refresh cookie, which must never reach a log, so we log only the fields we choose in `completed`.
- **`customSuccessObject` runs when the response finishes**, after the auth guard (Part 4) has set `req.user`, so the line can carry the `userId`.
- `genReqId` reuses the ID `requestContext` already chose; `autoLogging.ignore` keeps health probes (every few seconds, from Docker or Kubernetes) out of the logs.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · The exception filter: 404, 405 and everything else

**Goal:** a single place where every error becomes a problem response, including unknown routes (404) and known routes with the wrong method (405 + `Allow`).

**Files:** `src/common/pg-errors.ts`, `src/common/http/routes.ts`, `src/common/http/route-table.ts`, `src/common/http/problem.filter.ts`

@show src/common/pg-errors.ts 1-16

**What's new**
- TypeORM wraps the driver's error in a **`QueryFailedError`** whose `driverError` holds node-postgres's error, with the SQLSTATE `code`. `23505` is a unique violation, `23503` a foreign key violation; services translate them into 409s.

@show src/common/http/routes.ts all

@show src/common/http/route-table.ts all

**What's new (metadata and discovery)**
- **Why this class exists.** Express and Fastify told us directly "this path exists, but not with this method". Nest's router throws a plain `NotFoundException` for both cases. To answer 405 we need to know every route the app declares.
- **Decorators wrote metadata; here we read it back.** `@Controller('health')` stored `PATH_METADATA = 'health'` on the class, `@Get('live')` stored `PATH_METADATA = 'live'` and `METHOD_METADATA = GET` on the method. `Reflect.getMetadata(key, target)` reads them: this is the mechanism behind every Nest decorator.
- **`DiscoveryService`** (from `DiscoveryModule`, Step 3.6) lists every controller the container created; `MetadataScanner` lists a prototype's method names.
- **`OnApplicationBootstrap`** is a **lifecycle hook**: Nest calls `onApplicationBootstrap()` once every module is initialised, so all controllers are known. (Others you'll meet: `OnModuleInit`, `OnApplicationShutdown`.)
- `RequestMethod[method]` turns the numeric enum back into `'GET'`. `HEAD` is allowed wherever `GET` is, because Express answers HEAD with the GET handler.
- `API_PREFIX` is a constant every API controller uses in `@Controller()`. (Nest's `app.setGlobalPrefix()` would also work, but then Nest's own 404 handling wouldn't cover the root path; one constant keeps it explicit.)

> **🧠 DSA & scalability · method lookup for 405**
> - **Data structure:** an array of `{ pattern: RegExp, method }`, one per declared route, built once at startup from decorator metadata.
> - **Algorithm:** on a 404, test the path against every pattern; collect the methods of the matches; emit them in a fixed order.
> - **Complexity:** O(R) regex tests for R routes (~45 here), and **only for unmatched requests**: matched requests never touch it.
> - **Why it scales:** read-only after startup, so no locking; each instance builds its own.
> - **Rejected:** a radix tree keyed by path segments (faster, but more code for a cold path); listing allowed methods by hand per route (drifts from the controllers).

@show src/common/http/problem.filter.ts 1-46

@show src/common/http/problem.filter.ts 47-69

**What's new (exception filters)**
- **An exception filter** catches errors thrown anywhere in the request pipeline (guards, pipes, handlers, services) and writes the response. **`@Catch()` with no arguments catches everything**; `@Catch(HttpException)` would catch only that class. ☕ This is Spring's `@ControllerAdvice` + `@ExceptionHandler`.
- **`ArgumentsHost`** abstracts over transports: the same filter could run for HTTP, WebSockets or microservices. `host.switchToHttp().getRequest<Request>()` gets the Express request.
- **Constructor injection.** The filter asks for `RouteTable` and `PinoLogger` by type; Nest creates them and passes them in. Nothing calls `new ProblemFilter(...)` yourself. **`PinoLogger`** is nestjs-pino's injectable logger; `setContext` names the class in each line.
- **Translation rules:** our `ProblemError` passes through; Nest's `NotFoundException` means "no route" (404 or 405); other `HttpException`s are mapped by status (the body parser throws a 400 for malformed JSON and a 413 for an oversized body); a unique violation that escaped a service is a 409; anything else is a 500 with the details logged, never sent.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: problem+json exception filter with 404 and 405`

### Step 3.5 · Configuration, Postgres and Redis as modules, and health checks

**Goal:** the module every process shares (config, logging, database, Redis), and `GET /health/live` / `GET /health/ready`.

**Files:** `src/database/database.module.ts`, `src/infra/redis.module.ts`, `src/core.module.ts`, `src/modules/health/health.controller.ts`, `src/modules/health/health.module.ts`

```bash
npm i -E @nestjs/config@12.1.1 @nestjs/typeorm@12.0.3 ioredis@5.11.1 @nestjs/swagger@12.1.1
npm deny-scripts @scarf/scarf
```

- **`@nestjs/config`** loads the environment into an injectable `ConfigService`, validated by our `validateEnv`. **`@nestjs/typeorm`** creates the TypeORM `DataSource` inside Nest's container and makes repositories injectable. **`ioredis` 5.x**, not 6: TypeORM 1.1 declares a peer dependency on ioredis 5 (for its optional Redis cache), and two majors in one tree would be confusing.

@show src/database/database.module.ts all

**What's new (modules)**
- **A module** is a class decorated with `@Module({ imports, providers, controllers, exports })`. It groups related providers and declares what it needs from other modules (`imports`) and what it offers them (`exports`). The app is a **tree of modules**; Nest builds a container from it. ☕ Spring's `@Configuration` classes play this role.
- **Dynamic modules:** `TypeOrmModule.forRootAsync({ ... })` is a method that *returns* a configured module. `forRoot` / `forRootAsync` is the convention for "configure this library once, at the root"; `Async` means the options come from a **factory** that can depend on other providers.
- **`inject: [ConfigService]` + `useFactory: (config) => ...`**: the factory's parameters are resolved from the container in that order. `ConfigService<Env, true>` types `config.get('DATABASE_URL', { infer: true })` as `string` (the `true` says "validated, so never undefined").
- **`@nestjs/swagger`** is here because controllers carry its `@ApiTags()` from the first one on; Step 3.6 explains it. Its `swagger-ui-dist` dependency pulls in `@scarf/scarf`, whose install script sends usage analytics; denying it changes nothing else.

@show src/infra/redis.module.ts all

**What's new (providers and tokens)**
- **A provider** is anything the container can inject. A class with `@Injectable()` is the simplest (its type is its token). Here the provider is an **ioredis instance**, and a class type can't name *this particular* `Redis`, so we give it a **token**: `Symbol('REDIS')`. `{ provide: REDIS, inject, useFactory }` registers it; `@Inject(REDIS) private readonly redis: Redis` asks for it. ☕ Spring's `@Bean` method plus `@Qualifier`.
- **`@Global()`** makes the module's exports available everywhere without importing the module. Use it sparingly: Redis is a true app-wide resource, so it qualifies. (`ConfigModule` and nestjs-pino's `LoggerModule` are global too.)
- **The module itself is injectable**: its constructor receives the client, and `onApplicationShutdown()` (a lifecycle hook) disconnects it when the app closes.
- `maxRetriesPerRequest: null` is BullMQ's requirement (Part 5) for the connection it shares.

@show src/core.module.ts all

**What's new**
- **`ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`** reads `process.env` (and `.env`: `@nestjs/config` loads the file itself), runs it through our function, and makes `ConfigService` injectable everywhere. Invalid config stops the app before it opens a port.
- **`LoggerModule.forRootAsync`** builds the pino options from config.
- **`CoreModule`** bundles what *every* process needs. The API (Step 3.6) and the background worker (Part 11) both import it, so they can't disagree about config, logging or connections.

@show src/modules/health/health.controller.ts 1-6

@show src/modules/health/health.controller.ts 8-28

@show src/modules/health/health.controller.ts 30-53

@show src/modules/health/health.module.ts all

**What's new (controllers)**
- **`@Controller('health')`** declares a class whose methods handle routes under `/health`; **`@Get('live')`** maps `GET /health/live` to `live()`. A handler **returns** its response body; Nest serialises it to JSON with status 200 (201 for `@Post`). ☕ `@RestController` + `@GetMapping`.
- **Constructor injection again:** `DataSource` is injectable because `TypeOrmModule.forRootAsync` registered it; `Redis` comes through the `REDIS` token.
- **`@Res({ passthrough: true }) res`** gives you the Express response to set the status (503 when a dependency is down) **while still returning the body** for Nest to send. Without `passthrough`, injecting `@Res()` means you must send the response yourself.
- `@ApiTags('health')` groups the routes in the generated docs (Step 3.6).
- `check()` races each probe against a 1-second timeout, so a hung database makes readiness fail fast instead of hanging the probe.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: core module and health endpoints`

### Step 3.6 · The app module, `main.ts` and the docs

**Goal:** the root module, the app's configuration (middleware, CORS, body parser), Swagger UI at `/docs`, and the entry point. After this step `npm run dev` serves the health endpoints.

**Files:** `src/docs.ts`, `nest-cli.json`, `src/app.module.ts`, `src/app.setup.ts`, `src/main.ts`, `contract/openapi.yaml`

```bash
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

- **`@nestjs/swagger`** (installed in Step 3.5) builds an OpenAPI document from controllers and DTO classes and serves Swagger UI.

@copy contract

@show src/docs.ts all

@show nest-cli.json 7-7

**What's new**
- **Generated docs, not the contract.** Express and Fastify served the hand-written `contract/openapi.yaml`. Nest's idiom is to generate the document from code, so `/docs` shows what this implementation actually declares. The contract stays the source of truth: Schemathesis (Part 12) checks the running API against `contract/openapi.yaml`.
- **The CLI plugin** (`nest-cli.json`) reads each `*.dto.ts` file at compile time and adds Swagger metadata for every property from its TypeScript type, so DTOs don't need an `@ApiProperty()` on each field. It runs inside `nest build`; type checking and tests don't need it.

@show src/app.module.ts 1-6

@show src/app.module.ts 11-11

@show src/app.module.ts 18-23

@show src/app.module.ts 34-41

**What's new**
- **`AppModule` is the root of the tree.** It imports `CoreModule`, Nest's `DiscoveryModule` (for `RouteTable`) and the feature modules; each Part adds its module here.
- **`APP_FILTER` and `APP_PIPE` are special tokens**: a provider registered under them becomes **global**, applied to every route, and (unlike `app.useGlobalFilters(new X())`) is created by the container, so it can inject dependencies: the filter gets `RouteTable` and `PinoLogger`.
- `RouteTable` is a plain provider here; the filter asks for it by type.

@show src/app.setup.ts 1-3

@show src/app.setup.ts 6-9

@show src/app.setup.ts 11-36

@show src/app.setup.ts 38-38

@show src/app.setup.ts 41-44

**What's new**
- **`bufferLogs: true`** holds Nest's start-up messages until `app.useLogger(app.get(Logger))` installs pino, so they come out as JSON too. `app.get(X)` pulls any provider out of the container.
- **`bodyParser: false`**, then `app.useBodyParser('json', { limit: '1mb' })`: Nest would register JSON *and* urlencoded parsers by default. The API takes only JSON, capped at 1 MB (larger is a 413).
- **Order matters, as in Express:** request ID and headers → CORS (which also answers preflight `OPTIONS` requests) → 415 check → JSON parser. `app.use()` registers Express middleware on the underlying Express app.
- **`enableShutdownHooks()`** makes Nest call every `onApplicationShutdown()` on SIGTERM, so Redis and Postgres connections close before the process exits.
- `configureApp` is a function, not inline in `main.ts`, because the tests (next step) build the same app.

@show src/main.ts all

**What's new**
- **`NestFactory.create(AppModule)`** reads the module tree, creates every provider in dependency order, and returns the app; `app.listen()` starts the HTTP server. `NestExpressApplication` types the Express-specific methods (`useBodyParser`, `disable`).
- `'0.0.0.0'` listens on every interface, which Docker needs (Part 13).

> **🧠 DSA & scalability · the DI container**
> - **Data structure:** a graph of modules, each holding a map from **token** (a class or a symbol) to a provider definition, plus the created instances.
> - **Algorithm:** at start-up Nest walks the module tree, reads each provider's constructor parameter types (`design:paramtypes`) and `@Inject()` tokens, resolves them through the module's own providers, its imports' exports and the global modules, and creates instances in dependency order. Instances are **singletons** by default: one `UsersService` for the whole app.
> - **Complexity:** O(P + E) for P providers and E dependency edges, once at start-up; per request, nothing (handlers get already-built instances).
> - **Why it matters for scale:** singletons are shared by all concurrent requests, so they must not keep per-request state in fields; everything request-specific travels as arguments.
> - **Rejected:** request-scoped providers (Nest supports them, but they're rebuilt per request, and the scope spreads to everything that injects them).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s localhost:8003/health/ready; echo
curl -s -i -X POST localhost:8003/health/live | grep -iE '^(HTTP|allow)'
curl -s localhost:8003/nope; echo
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
{"type":"https://taskflow.example/problems/not-found","title":"Not found","status":404,"detail":"No route matches this path","instance":"/nope","requestId":"01a1…"}
```

The dev terminal prints JSON lines (`"msg":"Mapped {/health/live, GET} route"`, then `"Nest application successfully started"`), and http://localhost:8003/docs shows Swagger UI.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build

**Commit:** `feat: app module, configuration and server entry point`

### Step 3.7 · The test harness

**Goal:** integration tests that build the real app through Nest's testing module, against a separate test database and Redis database.

**Files:** `vitest.config.ts`, `test/test-env.ts`, `test/global-setup.ts`, `test/helpers.ts`, `test/health.e2e-spec.ts`

```bash
npm i -D -E @nestjs/testing@12.4.2 supertest@7.3.2 @types/supertest@7.2.1 @vitest/coverage-v8@5.1.0
```

- **`@nestjs/testing`** compiles a module tree for a test, where you can override providers. **`supertest`** sends HTTP requests to a server object without opening a port (the same library Express used). **`@vitest/coverage-v8`** powers `npm run test:coverage`.

@show test/test-env.ts 1-25

@show test/test-env.ts 27-27

@show vitest.config.ts 2-2

@show vitest.config.ts 6-6

@show vitest.config.ts 8-8

@show vitest.config.ts 12-23

@show vitest.config.ts 25-29

**What's new**
- **The test environment is computed from yours:** the same Postgres server with `_test` appended to the database name, Redis database 1, silent logs. Vitest's `env` sets these before any test file runs, so `ConfigModule` reads them.
- `fileParallelism: false`: test files share one database and truncate it, so they run one at a time.

@show test/global-setup.ts 2-3

@show test/global-setup.ts 5-23

@show test/global-setup.ts 37-37

**What's new**
- **`globalSetup` runs once, before every test file**, in its own context: create `taskflow_test` if it doesn't exist (connected to the `postgres` maintenance database, because you can't create the database you're connected to), then apply the migrations with a throwaway `DataSource`. That's why the migration's metadata row had to use `current_database()`.

@show test/helpers.ts 1-6

@show test/helpers.ts 9-15

@show test/helpers.ts 17-17

@show test/helpers.ts 20-28

@show test/helpers.ts 30-55

@show test/helpers.ts 57-104

**What's new**
- **`Test.createTestingModule({ imports: [AppModule] }).compile()`** builds the real module tree; `createNestApplication()` turns it into an app like `NestFactory.create` does, and `configureApp(app)` applies the same middleware. `app.init()` runs the lifecycle hooks without listening; Supertest calls the HTTP server directly. (Later tests pass `listen: true` for WebSockets, and `imports` to add modules the API doesn't load.)
- **`send()`** is the same helper as in the other two repos, so the test files read alike across all three: one call, optional expected status, and on mismatch the failure shows the response body. `request(ctx.server)[method](url)` picks Supertest's method by name.

@show test/health.e2e-spec.ts all

**What's new**
- **Top-level `await` in a test file** builds the app once per file; `afterAll(() => ctx.close())` shuts it down (closing Postgres and Redis).
- These five tests cover Part 3: liveness, readiness, 404 with the echoed request ID, 405 with `Allow`, and the body errors (400 malformed JSON, 415 non-JSON, 413 too large).

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: vitest harness with the nest testing module and health tests`

---
