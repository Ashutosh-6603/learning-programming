# TaskFlow: one feature, six frameworks

The same TaskFlow feature, implemented in Express, Fastify, NestJS, FastAPI, Django and Spring Boot, shown side by side with short "why it looks like this" notes. The contract ([openapi.yaml](openapi.yaml)) and the design ([README.md](README.md)) are identical for all six, so every difference you see here comes from the framework or the language.

**How this file grows:** each framework's column is filled in when its repo is finished and verified. The side-by-side code excerpts start with the second framework (Fastify), when there's something to compare against. The closing "when to choose which framework" section is written once all six exist.

| Framework | Repo | Status |
|---|---|---|
| Express | [taskflow-express](taskflow-express/) | ✅ built |
| Fastify | [taskflow-fastify](taskflow-fastify/) | not built yet |
| NestJS | [taskflow-nestjs](taskflow-nestjs/) | not built yet |
| FastAPI | [taskflow-fastapi](taskflow-fastapi/) | not built yet |
| Django | [taskflow-django](taskflow-django/) | not built yet |
| Spring Boot | [taskflow-springboot](taskflow-springboot/) | not built yet |

---

## Features compared

1. Bootstrapping: from `main` to a listening server
2. Configuration: typed, validated environment
3. Routing and controllers
4. Validation and the 422 problem response
5. Dependency injection (or the lack of it)
6. ORM models: the `tasks` table
7. Migrations, including the parts the ORM can't express (generated `tsvector`, `COLLATE "C"`, partial indexes)
8. The auth guard: verifying the access token
9. Refresh-token rotation (Redis + Lua)
10. RBAC checks
11. Transactions: create a task with its per-project number and activity event
12. Keyset pagination
13. Full-text search
14. WebSocket handler + Redis Pub/Sub fan-out
15. Background job + schedule
16. Caching the board
17. Rate limiter
18. Presigned uploads
19. Testing an endpoint against real Postgres and Redis
20. Dockerfile

Each section follows the same layout: the six code excerpts (only the lines that matter), then a short **Why** list.

---

## Where each feature lives (by framework)

### Express (`taskflow-express`)

| # | Feature | Where | How Express does it |
|---|---|---|---|
| 1 | Bootstrapping | `src/main.ts`, `src/app.ts` | `createApp()` builds the app without listening; `main.ts` wraps it in `http.createServer` (for WebSocket upgrades) and handles `SIGTERM`. |
| 2 | Configuration | `src/config.ts` | dotenv + a zod schema; `z.infer` gives the `Config` type; fail fast at startup. |
| 3 | Routing | `src/modules/*/*.routes.ts` | One `Router` per module; `router.route(path).get(…).post(…).all(methodNotAllowed)`; mounted on `/api/v1` in `app.ts`. |
| 4 | Validation → 422 | `src/lib/validation.ts` | `parseBody/parseQuery/parseParams(schema, req)` called inside handlers (typed results); zod issues mapped to `errors[].field`. |
| 5 | Dependency injection | `src/container.ts` | None built in: `createInfra()` + `createServices()` wire classes by hand through constructors. |
| 6 | ORM model | `prisma/schema.prisma` | Prisma schema language; `@map`/`@@map` for snake_case; `Unsupported("tsvector")` + `dbgenerated` for the generated column. |
| 7 | Migrations | `prisma/migrations/*/migration.sql` | `migrate dev --create-only`, then hand-edit for `COLLATE "C"`, the generated column and `CHECK`s; `migrate diff --exit-code` as the drift check. |
| 8 | Auth guard | `src/http/auth.ts` | `authenticate` middleware sets `req.auth`, `requireAuth` rejects anonymous calls; mounted once as a gate before protected routers. |
| 9 | Refresh rotation | `src/modules/auth/refresh-tokens.ts` | ioredis `eval` of a Lua script: atomic check-and-rotate, family revocation on reuse. |
| 10 | RBAC | `src/modules/workspaces/access.ts` | An `Access` service: membership lookup by compound unique key, 404 vs 403, rank comparison. |
| 11 | Transactions | `src/modules/tasks/tasks.service.ts` | Interactive `prisma.$transaction(async tx => …)`; `UPDATE … RETURNING` via `$queryRaw` for the counter's row lock. |
| 12 | Keyset pagination | `src/lib/cursor.ts` | base64url JSON cursors; `id: { lt }` + `take: limit + 1`; generic `toPage`. |
| 13 | Full-text search | `src/modules/search/search.service.ts` | `$queryRaw` with `websearch_to_tsquery`, `ts_rank`, `ts_headline`; `Prisma.sql` fragment for the `(rank, id)` cursor. |
| 14 | WebSockets + Pub/Sub | `src/modules/realtime/gateway.ts` | `ws` with `noServer`, ticket check on `upgrade`, a per-instance `Map<projectId, Set<Client>>`, Redis `SUBSCRIBE` with ref-counting. |
| 15 | Background jobs | `src/jobs/*`, `src/worker.ts` | BullMQ queue + separate worker process; `upsertJobScheduler` for cron; typed processor map. |
| 16 | Caching | `src/modules/projects/board-cache.ts` | Cache-aside with `GET`/`SET EX`/`DEL` after commit. |
| 17 | Rate limiter | `src/http/rate-limit.ts` | Middleware factory; sliding-window log in a Redis sorted set via Lua; fails open. |
| 18 | Presigned uploads | `src/infra/storage.ts` | AWS SDK v3 `getSignedUrl`; two clients (internal vs public endpoint). |
| 19 | Testing | `tests/` | Vitest + Supertest on `createApp()`; real Postgres/Redis/S3/SMTP; `TRUNCATE` between tests; two in-process servers for the fan-out test. |
| 20 | Dockerfile | `Dockerfile` | Multi-stage; `npm ci --omit=dev --omit=optional --ignore-scripts`; `USER node`; a `deps` stage for migrations. |
