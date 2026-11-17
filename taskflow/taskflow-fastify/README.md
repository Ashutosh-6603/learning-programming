# taskflow-fastify

The **TaskFlow API** (team project management, a Jira/Trello-lite) built with **Fastify 5, Drizzle ORM, PostgreSQL 18 and Redis**. It's one of six interchangeable TaskFlow backends that implement the same [OpenAPI contract](contract/openapi.yaml); any TaskFlow Node frontend (`taskflow-frontend-node`) works against it unchanged.

- **Rebuild it yourself:** [STEPS.md](STEPS.md) walks through every file, from an empty folder to CI.
- **Design** (data model, RBAC, auth, real-time protocol, Redis keys): the TaskFlow README in the parent folder (`../README.md`).
- **Coming from `taskflow-express`?** Same Parts and Steps, same tests. STEPS.md explains each difference as it appears.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, TypeScript 6.0 (strict, ESM / `nodenext`) |
| HTTP | Fastify 5 (plugins, hooks, encapsulation) |
| Database | PostgreSQL 18 via Drizzle ORM (`node-postgres` driver); migrations by drizzle-kit |
| Validation and serialization | TypeBox 1 schemas on every route (Ajv validates, fast-json-stringify serializes) |
| Auth | argon2id passwords, JWT access tokens (`@fastify/jwt`), rotating refresh tokens in Redis |
| Cache, rate limits, presence, pub/sub | Redis 8 via ioredis |
| Jobs and schedules | BullMQ (a separate worker process) |
| WebSockets | `@fastify/websocket` (`ws` underneath) |
| Object storage | S3 API via AWS SDK v3 (RustFS locally) |
| Email | nodemailer (Mailpit locally) |
| Logging | Fastify's built-in pino logger (JSON, request IDs, one line per request) |
| Tests | Vitest + `app.inject()` against real Postgres, Redis, S3 and SMTP; Schemathesis contract test |
| API docs | `@fastify/swagger` (static mode) + `@fastify/swagger-ui` at `/docs` (development only) |

## Quick start

```bash
docker compose up -d          # Postgres, Redis, RustFS (+ bucket), Mailpit
cp .env.example .env
npm ci
npm run db:migrate            # apply migrations
npm run db:seed               # default user: ashutosh@test.com / Ashutosh#1234
npm run dev                   # API on http://localhost:8002
npm run dev:worker            # background jobs (second terminal)
```

**Default login:** `npm run db:seed` creates **`ashutosh@test.com` / `Ashutosh#1234`** (every TaskFlow backend seeds the same account; running it again does nothing). It refuses to run with `NODE_ENV=production`; from your machine it also seeds the database of the Docker stack, since both use the same Postgres.

Every TaskFlow repo publishes its own host ports (see the table below), so several repos' stacks can run at the same time.

**Full stack in containers:** `docker compose --profile app up -d --build` (runs migrations, then the API and the worker).

| URL | What |
|---|---|
| http://localhost:8002/health/ready | Readiness (Postgres + Redis) |
| http://localhost:8002/docs | Swagger UI for the contract (development) |
| http://localhost:18002 | Mailpit inbox |
| http://localhost:19102 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI (pgAdmin, DBeaver, …):** host `localhost`, port **`15402`**, database `taskflow`, user `taskflow`, password `taskflow`. Redis is on `localhost:16302`. Host ports follow the workspace scheme (slot `02`): API 8002, Postgres 15402, Redis 16302, S3 19002 / console 19102, SMTP 11002 / Mailpit 18002. None is a default, so this stack runs alongside other TaskFlow repos and other projects. `npx drizzle-kit studio` opens Drizzle's own browser-based table viewer.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `dev:worker` | API / worker with hot reload (`tsx watch`) |
| `npm run build` / `start` / `start:worker` | Compile to `dist/` and run the compiled API / worker |
| `npm run typecheck` | `tsc --noEmit` over src, tests and config |
| `npm run lint` / `format` / `format:check` | ESLint (type-aware) / Prettier |
| `npm test` / `test:unit` / `test:coverage` | All tests / unit tests only / with v8 coverage (`coverage/`) |
| `npm run test:contract` | Schemathesis against a running API (see below) |
| `npm run db:generate` | Write a new migration from the changes in `src/db/schema.ts` |
| `npm run db:migrate` | Apply pending migrations (production runs `node dist/migrate.js`) |
| `npm run db:seed` | Create the default development user (`ashutosh@test.com` / `Ashutosh#1234`); idempotent, refuses in production |
| `npm run db:drift` | Fail if `src/db/schema.ts` has changes no migration captures |

## Configuration

Every variable is listed, with safe local defaults and comments, in [.env.example](.env.example), and validated at startup by [src/config.ts](src/config.ts) with a TypeBox schema. A missing or invalid value stops the process with a readable message. `RATE_LIMIT_*` exists so the contract test can raise the limits; production keeps the defaults (10/min for auth, 300/min otherwise).

## Project layout

```text
src/
  main.ts           starts the server, graceful shutdown (close-with-grace)
  worker.ts         BullMQ worker and cron schedules
  migrate.ts        applies migrations (no drizzle-kit needed at runtime)
  app.ts            builds the Fastify app: plugins, hooks, encapsulated route contexts
  container.ts      infra clients and manual dependency injection
  config.ts         typed, validated environment (TypeBox)
  db/               Drizzle schema, relations, client
  http/             validation compilers, error handler, 405, auth hooks, rate limiting, request log
  infra/            Redis, S3, logger factories
  jobs/             queue facade, processors, mailer
  lib/              problem errors, shared schemas, cursors, fractional indexing, pg errors
  modules/<feature> routes (Fastify plugins) → service (→ repository), DTO schemas
tests/
  unit/             pure logic
  integration/      HTTP (app.inject) + WebSocket tests against real services
drizzle/            generated SQL migrations + drizzle-kit snapshots
```

## Migrations

The schema is TypeScript in [src/db/schema.ts](src/db/schema.ts); drizzle-kit diffs it against its last snapshot (`drizzle/meta/`) and writes SQL. Unlike Prisma, Drizzle expresses the whole reference schema, so **no migration is hand-edited**: `COLLATE "C"` (a custom column type), the generated `tsvector` column, partial and GIN indexes, and every `CHECK` constraint all live in `schema.ts`. Ids are generated by Postgres 18's built-in `uuidv7()`.

To change the schema: edit `schema.ts` → `npm run db:generate -- --name <change>` → review the SQL in `drizzle/` → `npm run db:migrate`. CI fails if `schema.ts` has changes that no migration captures (`npm run db:drift`); if it fails locally, it has just written the missing migration for you to review.

## Testing

Tests need the compose infrastructure running. They use a separate database (`<name>_test`, created and migrated automatically) and Redis database 1, so they never touch your dev data. Most tests run requests in-process with Fastify's `app.inject()` (no port); the WebSocket tests start two real instances on random ports.

```bash
npm test
```

**Contract test.** Start the API with relaxed rate limits, get a token, then run Schemathesis (needs [uv](https://docs.astral.sh/uv/)):

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm run dev
TOKEN=$(curl -s localhost:8002/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8002 -H "Authorization: Bearer $TOKEN"
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request: format/lint/typecheck → tests with Postgres, Redis, RustFS and Mailpit service containers + migration drift check + coverage artifact → Schemathesis contract test → Docker build (pushed to `ghcr.io/<owner>/taskflow-fastify` with the commit SHA and `latest` on `main`). CodeQL and Dependabot run alongside.

## Known notes

- **TypeScript is pinned to 6.0.x** because `typescript-eslint` doesn't support TypeScript 7 yet. Dependabot ignores TypeScript major updates.
- **npm's `latest` tag for `drizzle-orm` is 0.45; Drizzle 1.0 is a release candidate** with a new relational-query API. Upgrade deliberately, with exact versions.
- **Config doesn't use `@fastify/env`.** Fastify's logger and the worker process need the configuration before (or without) a Fastify instance, so [src/config.ts](src/config.ts) validates the environment with TypeBox directly.
