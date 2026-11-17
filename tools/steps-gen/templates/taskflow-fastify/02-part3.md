## Part 3 · HTTP foundations

Before any business logic, we build what every endpoint relies on: problem+json errors, validation, request IDs and logging, 404/405/415 handling, health checks, the app/container skeleton, and the test harness. This is the Part where Fastify differs most from Express, so read the "What's new" notes closely.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one error type that becomes an `application/problem+json` response.

**Files:** `src/lib/problem.ts`

@show src/lib/problem.ts 1-53

@show src/lib/problem.ts 54-62

**What's new**
- Nothing: this file is identical to Express's. It knows nothing about the HTTP framework, which is exactly why it carries over. `ProblemSlug` is derived from `TITLES`, and `STATUS: Record<ProblemSlug, number>` refuses to compile if a slug lacks a status. Services throw these (`throw notFound('Task')`); one error handler (Step 3.4) turns them into responses.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output (no type errors).

@verify npx tsc --noEmit

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Schemas and validation

**Goal:** shared TypeBox schemas, and a validator setup that turns every request into typed data or a 422 whose `errors[].field` uses the wire names.

**Files:** `src/lib/schemas.ts`, `src/http/validation.ts`

```bash
npm i -E fastify@5.12.8 @fastify/type-provider-typebox@6.3.0 ajv@8.20.0 ajv-formats@3.0.1 ajv-keywords@5.1.0
```

- **`fastify`** itself. **`@fastify/type-provider-typebox`** teaches Fastify's TypeScript types to read TypeBox schemas, so a route's `request.body` gets the type of its body schema.
- **`ajv`** is the JSON Schema validator Fastify uses internally. We install it ourselves because we configure it (below); **`ajv-formats`** adds `format: 'email'`, `'uuid'`, `'date-time'`…; **`ajv-keywords`** adds the `transform` keyword (trim, lowercase).

@show src/lib/schemas.ts all

**What's new**
- **These are schemas, not parsers.** In Express you called `parseBody(schema, req)` inside every handler. In Fastify you attach schemas to the route (`schema: { body, querystring, params, response }`) and Fastify validates **before** your handler runs; a handler only ever sees valid data.
- `Nullable`, `Page` and `Patch` are **functions that build schemas**. Because schemas are plain objects, generic helpers are ordinary TypeScript.
- `Trimmed` and `Email` carry a `transform` keyword: Ajv trims or lowercases the string *during* validation, before `minLength` is checked, which is what zod's `.trim()` and `.transform()` did.
- `Patch` makes every property optional and adds our own keyword, `atLeastOneField`, explained next.

@show src/http/validation.ts 1-23

@show src/http/validation.ts 24-36

**What's new**
- **One validator per request part.** Fastify compiles a validator for each route's `body`, `querystring`, `params` and `headers`, and `setValidatorCompiler` lets us choose how. Query strings and path params are text, so they need **coercion** (`"20"` → `20`). A JSON body already has types, so coercing it would wrongly accept `{"title": 5}`. Two Ajv instances keep the two policies apart.
- **`allErrors: true`** reports every invalid field at once (Ajv stops at the first by default). **`removeAdditional: 'all'`** strips unknown body keys, like zod objects did, so a client can't sneak `id` or `createdAt` into an update.
- **`atLeastOneField`** exists because of an ordering detail. JSON Schema's own `minProperties: 1` is checked *before* unknown keys are stripped, so `{"zz": 1}` would pass as `{}`. Ajv runs custom keywords after `properties`, so ours sees the cleaned object.
- **`addFormats.default(ajv)`**: `ajv-formats` is a CommonJS package. Imported from ES modules with `nodenext` resolution, its function arrives as the `.default` property. You'll meet this CJS/ESM seam again; the type checker tells you when it applies.
- We replace the `uuid` format: the stock one also accepts `urn:uuid:…`, which Postgres refuses with an error, and an unhandled error means a 500.

@show src/http/validation.ts 37-60

**What's new**
- Ajv reports `instancePath: '/nested/projectId'` and, for a missing property, `keyword: 'required'` with `params.missingProperty`. `fieldErrors` turns those into the contract's wire names: `nested.projectId` for body fields, `query.limit` and `path.workspaceId` for the others (README §13), exactly the strings Express produced.

> **🧠 DSA & scalability · compiled validators**
> - **Data structure:** one generated JavaScript function per (route, request part), held in memory for the process's lifetime.
> - **Algorithm:** at startup, Ajv walks the schema once and **generates source code** (`if (typeof data.title !== 'string') errors.push(…)`), then `new Function()` turns it into a function. Per request, Fastify calls that function: no schema walking, no allocation beyond the error list.
> - **Complexity:** compile O(schema size) once; validate O(size of the input) per request.
> - **Why it scales:** the per-request cost is close to hand-written `if` statements, which is a large part of why Fastify benchmarks well. The same schemas also feed the serializer (Step 3.6).
> - **Rejected:** validating with zod inside handlers (works, but walks the schema on every call and keeps validation out of Fastify's lifecycle); coercing bodies (accepts wrong types); Ajv's default `allErrors: false` (clients fix one field per round trip).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: typebox schemas and ajv validation with wire field paths`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an `X-Request-Id`, every log line is JSON with that ID, each request is logged once, and responses carry the README's security headers.

**Files:** `src/infra/logger.ts`, `src/types/fastify.d.ts`, `src/http/hooks.ts`

```bash
npm i -E pino@10.4.0 uuid@14.0.3
```

- **`pino`** is Fastify's own logger. Fastify can create one for you; we create it ourselves, so the worker process (Part 11) logs in exactly the same format. **`uuid`** mints UUIDv7 request IDs.

@show src/infra/logger.ts all

@show src/types/fastify.d.ts 3-11

@show src/http/hooks.ts 1-26

**What's new**
- **Declaration merging, Fastify style.** `declare module 'fastify' { interface FastifyRequest { userId: … } }` adds a property to Fastify's request type. (Express's types lived in a global `Express` namespace; Fastify's are a normal module, so we *augment* the module.) The bare `import 'fastify'` makes this file a module augmentation rather than a fresh declaration.
- **`requestIdFrom`** becomes Fastify's `genReqId` option (Step 3.6). Fastify calls it once per request with the raw Node request, and `request.id` holds the result. A well-formed incoming `X-Request-Id` is kept, so one request can be traced across services.
- **A hook** is a function Fastify calls at a fixed point of the request lifecycle. `onRequest` is the first one, before the body is even read. This one echoes the ID and sets the security headers on **every** response, errors included. Typing it `onRequestAsyncHookHandler` says "async hook": Fastify waits for the returned promise instead of passing a `done` callback.

@show src/http/hooks.ts 27-58

**What's new**
- **Fastify logs each request by default**, as two lines ("incoming request" and "request completed"). Express needed `pino-http` for this. Since Fastify 5.12 you customise those lines by subclassing **`LogController`** and passing an instance as the `logController` option: here we disable the "incoming" line, write one line per request with the user, method, path, status and duration, and skip health probes (`isLogDisabled`).
- `requestIdLogLabel: 'requestId'` names the request ID field in every log line (Fastify's default is `reqId`).
- `override` is TypeScript's keyword for "this method replaces the parent's" (required by `noImplicitOverride`).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · 415, 405, 404 and the error handler

**Goal:** turn every failure (unknown route, wrong method, non-JSON body, malformed JSON, invalid fields, a thrown `ProblemError`, a unique violation) into one problem+json response.

**Files:** `src/lib/pg-errors.ts`, `src/http/errors.ts`, `src/http/method-not-allowed.ts`

@show src/lib/pg-errors.ts 1-17

**What's new**
- **Drizzle doesn't classify database errors** the way Prisma did (`P2002` for unique violations). It wraps the driver's error in a `DrizzleQueryError` whose `cause` is the `pg` error carrying Postgres's **SQLSTATE** code: `23505` unique violation, `23503` foreign-key violation. `pgErrorCode` walks the `cause` chain until it finds a five-character code, so it works whether or not the error was wrapped.

@show src/http/errors.ts 1-27

@show src/http/errors.ts 28-53

**What's new**
- **Fastify raises its own errors** with stable codes (`FST_ERR_…`) and a `statusCode`. A body with the wrong `Content-Type` is `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415, which Express needed custom middleware for), a body over `bodyLimit` is `FST_ERR_CTP_BODY_TOO_LARGE` (413). `BY_STATUS` maps any other Fastify client error by its status, so nothing Fastify raises falls through to a 500.
- **A validation failure is an error too:** Fastify attaches Ajv's errors as `err.validation` and the part that failed as `err.validationContext` (`'body'`, `'querystring'`, `'params'`), and we turn them into a 422 with `fieldErrors`. Fastify's default would be a 400; the contract says 422.

@show src/http/errors.ts 54-80

**What's new**
- **`setErrorHandler`** is Express's 4-argument error middleware: every error thrown in a hook or handler (sync or async) ends here. In Express 5 async errors also reach the handler; in Fastify that has always been the case.
- **`setNotFoundHandler`** answers routes nothing matched. Express used a last-resort middleware; Fastify has a dedicated handler (and you can set one per URL prefix).

@show src/http/method-not-allowed.ts 1-27

@show src/http/method-not-allowed.ts 28-46

**What's new**
- **Fastify answers a known path with an unknown method by 404.** The contract wants **405 with an `Allow` header**. Fastify has no switch for it, so `withMethodNotAllowed` builds it from two Fastify features:
  - **`onRoute` hook:** called every time a route is declared, with its path and methods. We use it to record which methods each path has.
  - **`app.supportedMethods`:** every method Fastify can route, including `TRACE` and `QUERY`. For each path we declare one more route with all the *other* methods, and it answers 405. `OPTIONS` is left out because CORS preflight (Step 3.6) uses it.
- The 405 is thrown from the route's own **`onRequest`** hook, not its handler. Between the two, Fastify checks bodies (a `QUERY` request must have a `Content-Type`), and an unsupported method must get 405 whatever its body looks like.
- The helper **wraps** the registrations (`withMethodNotAllowed(app, () => app.register(...))`) because it has to see all of a plugin's routes before adding its own. Its routes are declared in the same plugin, so they sit behind the same hooks: an anonymous `PUT /api/v1/workspaces` still gets 401 before 405, as in Express.

> **🧠 DSA & scalability · 405 without a per-request cost**
> - **Data structure:** at startup, a `Map<path, Set<method>>` built from `onRoute` events; at run time, ordinary routes in Fastify's router (**find-my-way**, a radix tree keyed by path segments, with one handler per method).
> - **Algorithm:** for each recorded path, declare a route for (all supported methods − the path's methods). A request with a wrong method then **matches a route** like any other request; no fallback search happens per request.
> - **Complexity:** O(routes) once at startup; per request, the usual radix-tree lookup, O(length of the path).
> - **Why it scales:** the 405 decision costs nothing extra at run time, and it lives inside each plugin, so encapsulated hooks (auth, rate limits) still apply.
> - **Rejected:** checking `app.hasRoute` for every method inside the 404 handler (that API takes a route *pattern*, not a concrete URL, and it would cost a lookup per method on every miss); Express-style `.all()` (Fastify has no per-path catch-all).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: problem+json error handler, 404 and 405`

### Step 3.5 · Health checks

**Goal:** `GET /health/live` (the process is up) and `GET /health/ready` (Postgres and Redis answer within a second), as **a Fastify plugin**.

**Files:** `src/modules/health/health.routes.ts`

@show src/modules/health/health.routes.ts 1-25

@show src/modules/health/health.routes.ts 26-54

**What's new**
- **A route module is a plugin**: an `async (app, options) => { … }` function that declares routes on the instance it receives. `app.register(healthRoutes, { db, redis })` (Step 3.6) calls it with those options. Plugin options are how this codebase passes dependencies to routes, the role that factory-function arguments (`healthRoutes(prisma, redis)`) played in Express.
- **`FastifyPluginAsyncTypebox<Options>`** types the plugin: `options` is typed, and routes inside use the TypeBox type provider.
- **`schema: { response: { 200: …, 503: … } }`** is a **response schema**. Fastify compiles it into a **serializer** (fast-json-stringify) that writes exactly those properties, faster than `JSON.stringify`, and never leaks a property the schema doesn't list. TypeScript also checks your return value against it. Every route in this repo declares one.
- `return reply.status(...).send(...)` vs. `return value`: an async handler can simply return the body (as `/health/live` does); when you need a status code or headers, set them on `reply`.
- `db.execute(sql\`SELECT 1\`)` runs raw SQL through Drizzle's pool, the equivalent of Prisma's `$queryRaw`.

> **🧠 DSA & scalability · readiness with a deadline**
> - **Data structure:** none persistent; two promises raced against a timer.
> - **Algorithm:** run both probes **in parallel** (`Promise.all`), each raced against a 1-second timeout; the `finally` clears the timer so it can't keep the event loop alive.
> - **Complexity:** O(1) work; latency = max(probe latencies), capped at 1 s.
> - **Why it scales:** orchestrators poll readiness constantly. A hung dependency yields a fast `503` (take this instance out of the load balancer) instead of a probe that hangs.
> - **Rejected:** probing sequentially (latencies add up); a liveness probe that checks dependencies (a database blip would restart every healthy pod at once).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: health endpoints`

### Step 3.6 · The container, the app and `main.ts`

**Goal:** the three files that tie everything together. They start small and grow in every Part.

**Files:** `src/container.ts`, `src/app.ts`, `src/main.ts`

```bash
npm i -E @fastify/cors@11.4.1 @fastify/swagger@9.9.3 @fastify/swagger-ui@6.1.3 close-with-grace@2.5.0
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

- **`@fastify/cors`**, **`@fastify/swagger`** + **`@fastify/swagger-ui`** are official Fastify plugins (the `@fastify/` scope is maintained by the Fastify team). **`close-with-grace`** is the Fastify team's helper for graceful shutdown.

@copy contract

@show src/container.ts 2-7

@show src/container.ts 29-34

@show src/container.ts 37-45

@show src/container.ts 48-51

@show src/container.ts 53-58

@show src/container.ts 67-67

@show src/container.ts 84-87

**What's new**
- The same **hand-written dependency injection** as Express: `createInfra` builds the clients, `createServices` the services, and tests call the same functions. `createServices` returns `{}` for now and fills up as you go. (Fastify's own answer to DI is decorators and plugin options; we use plugin options to hand services to routes, below.)
- `infra.db.$client.end()` closes the node-postgres pool that Drizzle wraps.

@show src/app.ts 2-2

@show src/app.ts 4-6

@show src/app.ts 8-9

@show src/app.ts 11-13

@show src/app.ts 15-15

@show src/app.ts 20-20

@show src/app.ts 28-28

@show src/app.ts 33-55

**What's new**
- **`Fastify({ … })` creates an instance**; `buildApp` configures it but doesn't listen, so tests can use it without a port. It's `async` because registering plugins is asynchronous.
- **Options:** `loggerInstance` hands Fastify our pino logger (widened to the `FastifyBaseLogger` interface its types expect), `logController` the one-line request log, `genReqId` the request-ID function, `bodyLimit` the 1 MB JSON limit (413 above it). `onProtoPoisoning: 'remove'` deletes a `__proto__` key from parsed JSON instead of rejecting the request: Fastify protects against prototype poisoning by default, and removing the key keeps that protection while treating it like any other unknown field.
- **`.withTypeProvider<TypeBoxTypeProvider>()`** switches the instance's route typing to TypeBox: a route's `request.body`, `request.query` and return type come from its schemas.
- **`removeContentTypeParser('text/plain')`**: Fastify parses JSON and plain text out of the box. Without the text parser, a `text/plain` body gets 415 like every other non-JSON type.
- **`decorateRequest('userId', null)`** adds the property declared in `fastify.d.ts` to every request object, initialised once on the prototype. Fastify asks you to declare request properties up front so V8 can keep every request object the same shape (fast property access).
- **`addHook('onRequest', …)`** on the root instance runs for **every** request, including 404s.

@show src/app.ts 56-62

@show src/app.ts 90-99

@show src/app.ts 155-157

**What's new**
- **`await app.register(plugin, options)`** is the heart of Fastify. A plugin is a function that receives an instance and configures it; Fastify loads plugins **in order**, each after the previous one is ready (the loader is called *avvio*). Awaiting `register` makes "CORS first, then Swagger, then routes" explicit.
- **`@fastify/cors`** answers preflight `OPTIONS` requests itself and adds the CORS headers to every response, the same options as Express's `cors()`.
- **`@fastify/swagger` in `static` mode** serves the **committed** contract (the source of truth) instead of generating one from the routes, and `@fastify/swagger-ui` shows it at `/docs`. Development only.
- **`withMethodNotAllowed(app, () => app.register(healthRoutes, …))`**: the health plugin gets 405 handling for its two paths.

@show src/main.ts all

**What's new**
- **`app.listen({ port, host: '0.0.0.0' })`**: Fastify's default host is `localhost`, which inside a container is unreachable from outside, so we listen on every interface. Fastify logs the address it listens on.
- **`closeWithGrace`** installs `SIGINT`/`SIGTERM` (and uncaught-error) handlers, runs our callback once, and force-exits after `delay` (10 s) if shutdown hangs, which is what Express's hand-written `shutdown()` did. **`app.close()`** stops accepting connections, waits for in-flight requests, and runs every plugin's `onClose` hook; then we close the pools.

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s localhost:8002/health/ready
curl -si -X POST localhost:8002/health/live | grep -iE '^(HTTP|allow)'
curl -s localhost:8002/nope
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
allow: GET, HEAD
{"type":"https://taskflow.example/problems/not-found","title":"Not found","status":404,"detail":"No route matches this path","instance":"/nope","requestId":"01…"}
```

The dev server's terminal shows one JSON line per request (none for `/health/*`). Open http://localhost:8002/docs to see the contract in Swagger UI.

@verify npx tsc --noEmit

**Commit:** `feat: app, container and server entry point`

### Step 3.7 · The test harness

**Goal:** Vitest running against a **separate** test database, with a helper that builds the whole app and sends requests **in-process**.

**Files:** `tests/test-env.ts`, `tests/global-setup.ts`, `vitest.config.ts`, `tests/helpers.ts`, `tests/unit/validation.test.ts`, `tests/integration/health.test.ts`

```bash
npm i -D -E vitest@5.1.0 @vitest/coverage-v8@5.1.0
```

- No Supertest: Fastify has request injection built in (below).

@show tests/test-env.ts all

@show tests/global-setup.ts 2-3

@show tests/global-setup.ts 5-21

@show tests/global-setup.ts 36-36

@show vitest.config.ts all

**What's new**
- The same isolation as Express: database `taskflow_test` on the same server, Redis database 1, and test files run one at a time because they share that database.
- **`global-setup.ts` migrates with `migrate()`**, the same function as `src/migrate.ts`, so tests never shell out to a CLI.
- `process.loadEnvFile` again replaces `dotenv`.

@show tests/helpers.ts 2-6

@show tests/helpers.ts 8-62

**What's new**
- **`app.inject()`** runs a request through the whole Fastify pipeline (hooks, parsing, validation, handler, serialization) **without opening a socket**. It's provided by `light-my-request`, which Fastify includes, and it's why Fastify tests don't need Supertest. The response has `.statusCode`, `.headers`, `.json()` and `.cookies`.
- **`await app.ready()`** loads every registered plugin. `inject()` would do it on first use, but calling it in the helper surfaces plugin errors at setup.
- `send()` is our thin wrapper: `as: user` adds that user's `Authorization` header, `body` becomes the JSON payload, and passing `status` asserts it with the response body in the failure message, so a failing test tells you *why*.
- Test files use **top-level `await`**: `const ctx = await createTestContext();`.

@show tests/unit/validation.test.ts all

@show tests/integration/health.test.ts all

**What's new**
- The unit test feeds `fieldErrors` the shape Ajv produces, so the wire field names are pinned without a server.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 ✓ tests/unit/validation.test.ts (2 tests)
 ✓ tests/integration/health.test.ts (4 tests)

 Test Files  2 passed (2)
      Tests  6 passed (6)
```

@verify npx tsc --noEmit
@verify npx vitest run

**Commit:** `test: vitest harness with app.inject and health tests`

---
