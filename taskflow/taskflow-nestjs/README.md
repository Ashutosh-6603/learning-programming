# taskflow-nestjs

The **TaskFlow API** (team project management, a Jira/Trello-lite) built with **NestJS 12, TypeORM, PostgreSQL 18 and Redis**. It's one of six interchangeable TaskFlow backends that implement the same [OpenAPI contract](contract/openapi.yaml); any TaskFlow Node frontend (`taskflow-frontend-node`) works against it unchanged.

- **Rebuild it yourself:** [STEPS.md](STEPS.md) walks through every file, from an empty folder to CI.
- **Design** (data model, RBAC, auth, real-time protocol, Redis keys): the TaskFlow README in the parent folder (`../README.md`).
- **Coming from `taskflow-express` or `taskflow-fastify`?** Same Parts and Steps, same tests. STEPS.md explains each difference as it appears. NestJS is also the bridge to Spring Boot: modules, dependency injection and decorators here become configuration classes, beans and annotations there.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, TypeScript 6.0 (strict, ESM / `nodenext`, legacy decorators with emitted metadata) |
| HTTP | NestJS 12 on Express 5 (`@nestjs/platform-express`): modules, controllers, providers, guards, pipes, filters |
| Database | PostgreSQL 18 via TypeORM 1.1 (`pg` driver), entities with decorators; migrations by the TypeORM CLI |
| Validation | `class-validator` + `class-transformer` DTO classes through a global `ValidationPipe` |
| Auth | argon2id passwords, JWT access tokens (`@nestjs/jwt` signs, `@nestjs/passport` + `passport-jwt` verifies), rotating refresh tokens in Redis |
| Cache, rate limits, presence, pub/sub | Redis 8 via ioredis |
| Jobs and schedules | BullMQ through `@nestjs/bullmq` (a separate worker process) |
| WebSockets | `@nestjs/websockets` with `WsAdapter` (`ws` underneath), plain JSON envelopes |
| Object storage | S3 API via AWS SDK v3 (RustFS locally) |
| Email | nodemailer (Mailpit locally) |
| Config | `@nestjs/config` with a class-validator schema |
| Logging | pino through `nestjs-pino` (JSON, request IDs, one line per request) |
| Tests | Vitest + `@nestjs/testing` + Supertest against real Postgres, Redis, S3 and SMTP; Schemathesis contract test |
| API docs | `@nestjs/swagger` generates OpenAPI from the code; Swagger UI at `/docs` (not in production) |

## Quick start

```bash
docker compose up -d          # Postgres, Redis, RustFS (+ bucket), Mailpit
cp .env.example .env
npm ci
npm run db:migrate            # build, then apply migrations
npm run db:seed               # default user: ashutosh@test.com / Ashutosh#1234
npm run dev                   # API on http://localhost:8003
npm run dev:worker            # background jobs (second terminal)
```

**Default login:** `npm run db:seed` creates **`ashutosh@test.com` / `Ashutosh#1234`** (every TaskFlow backend seeds the same account; running it again does nothing). It refuses to run with `NODE_ENV=production`; from your machine it also seeds the database of the Docker stack, since both use the same Postgres.

Every TaskFlow repo publishes its own host ports (see below), so several repos' stacks can run at the same time.

**Full stack in containers:** `docker compose --profile app up -d --build` (runs migrations, then the API and the worker).

| URL | What |
|---|---|
| http://localhost:8003/health/ready | Readiness (Postgres + Redis) |
| http://localhost:8003/docs | Swagger UI, generated from the code (development) |
| http://localhost:18003 | Mailpit inbox |
| http://localhost:19103 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI (pgAdmin, DBeaver, …):** host `localhost`, port **`15403`**, database `taskflow`, user `taskflow`, password `taskflow`. Redis is on `localhost:16303`. Host ports follow the workspace scheme (slot `03`): API 8003, Postgres 15403, Redis 16303, S3 19003 / console 19103, SMTP 11003 / Mailpit 18003.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `dev:worker` | API / worker with rebuild-on-change (`nest start --watch`) |
| `npm run build` / `start` / `start:worker` | Compile to `dist/` (`nest build`) and run the compiled API / worker |
| `npm run typecheck` | `tsc --noEmit` over src, tests and config |
| `npm run lint` / `format` / `format:check` | ESLint (type-aware) / Prettier |
| `npm test` / `test:unit` / `test:e2e` / `test:coverage` | All tests / `src/**/*.spec.ts` / `test/*.e2e-spec.ts` / with v8 coverage (`coverage/`) |
| `npm run test:contract` | Schemathesis against a running API (see below) |
| `npm run db:generate -- src/database/migrations/<Name>` | Build, then write a migration from the changes in the entities |
| `npm run db:migrate` | Build, then apply pending migrations (production runs `node dist/migrate.js`) |
| `npm run db:seed` | Create the default development user (`ashutosh@test.com` / `Ashutosh#1234`); idempotent, refuses in production |
| `npm run db:drift` | Fail if the entities have changes no migration captures |

## Configuration

Every variable is listed, with safe local defaults and comments, in [.env.example](.env.example), and validated at startup by [src/config/env.ts](src/config/env.ts) (a class with class-validator decorators, plugged into `@nestjs/config`). A missing or invalid value stops the process with a readable message. `RATE_LIMIT_*` exists so the contract test can raise the limits; production keeps the defaults (10/min for auth, 300/min otherwise).

## Project layout

```text
src/
  main.ts             starts the HTTP server
  worker.ts           starts the worker (a Nest application without HTTP)
  migrate.ts          applies migrations
  app.module.ts       the API's root module: feature modules + global filter and pipe
  worker.module.ts    the worker's root module
  core.module.ts      config, logging, Postgres, Redis: shared by both processes
  app.setup.ts        middleware, CORS, body parser, WebSocket adapter (shared with the tests)
  docs.ts             Swagger document and UI
  config/             typed, validated environment
  database/           entities, naming strategy, data source, migrations
  common/             problem errors, exception filter, 405 route table, validation pipe and
                      decorators, rate-limit guard, cursors, fractional indexing, pg errors
  infra/              Redis module, S3 storage, logger options
  jobs/               queue facade, job handlers, BullMQ processor, mailer
  modules/<feature>   module + controller → service, DTO classes
test/                 *.e2e-spec.ts: HTTP (Supertest) + WebSocket tests against real services
```

Unit tests sit next to the code they test (`src/**/*.spec.ts`), the Nest convention.

## Migrations

The schema is the set of entity classes in [src/database/entities](src/database/entities). The TypeORM CLI compares them with the database and writes the SQL: `npm run db:generate -- src/database/migrations/<Name>`, then add the new class to [src/database/migrations/index.ts](src/database/migrations/index.ts) and run `npm run db:migrate`.

The CLI loads the **compiled** data source (`dist/database/data-source.js`), which is why the `db:*` scripts build first. Entities express the whole reference schema: `COLLATE "C"`, the generated `tsvector` column, partial and GIN indexes, every `CHECK`. The first migration has two small hand edits (STEPS.md Step 2.4 shows them): `import type` for the type-only import, and `current_database()` in the two `typeorm_metadata` statements. TypeORM records generated columns in that table keyed by database name, and the generated SQL hard-codes the name; `current_database()` makes it work for the test database too.

## Testing

Tests need the compose infrastructure running. They use a separate database (`<name>_test`, created and migrated automatically) and Redis database 1, so they never touch your dev data. Each test file builds the real `AppModule` through `@nestjs/testing` and calls it with Supertest; the WebSocket tests start two complete application instances on random ports.

```bash
npm test
```

**Contract test.** Start the API with relaxed rate limits, get a token, then run Schemathesis (needs [uv](https://docs.astral.sh/uv/)):

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm run dev
TOKEN=$(curl -s localhost:8003/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8003 -H "Authorization: Bearer $TOKEN"
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request: format/lint/typecheck → tests with Postgres, Redis, RustFS and Mailpit service containers + migration drift check + coverage artifact → Schemathesis contract test → Docker build (pushed to `ghcr.io/<owner>/taskflow-nestjs` with the commit SHA and `latest` on `main`). CodeQL and Dependabot run alongside.

## Known notes

- **Tests run on Vitest, not Jest.** NestJS 12 ships as ES modules only and its own project generator sets up Vitest. Jest can load ESM-only packages only behind an experimental Node flag, so this repo follows the framework's default. Older NestJS projects you'll meet at work use Jest; the test code is nearly identical (`vi.fn()` instead of `jest.fn()`).
- **TypeScript is pinned to 6.0.x** because `typescript-eslint` doesn't support TypeScript 7 yet. Dependabot ignores TypeScript major updates.
- **ioredis is 5.x here** (6.x in the other Node repos): TypeORM 1.1 declares `ioredis@^5` as an optional peer dependency, and npm refuses to install a conflicting major.
- **The two global guards (JWT, then rate limit) are registered in `AuthModule`** with `APP_GUARD`, next to the guard they install, as Nest's docs recommend; every route needs a token unless marked `@Public()`.
- **Rate limiting is a hand-written guard, not `@nestjs/throttler`,** so all six backends run the same sliding-window algorithm against the same Redis keys.
- **`/docs` is generated from the code** by `@nestjs/swagger`; the contract in `contract/openapi.yaml` remains the source of truth and Schemathesis checks the API against it.
