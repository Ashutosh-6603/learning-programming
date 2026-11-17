# taskflow-express

The **TaskFlow API** (team project management, a Jira/Trello-lite) built with **Express 5, Prisma 7, PostgreSQL 18 and Redis**. It's one of six interchangeable TaskFlow backends that implement the same [OpenAPI contract](contract/openapi.yaml).

- **Rebuild it yourself:** [STEPS.md](STEPS.md) walks through every file, from an empty folder to CI.
- **Design** (data model, RBAC, auth, real-time protocol, Redis keys): the TaskFlow README in the parent folder (`../README.md`).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 24, TypeScript 6.0 (strict, ESM / `nodenext`) |
| HTTP | Express 5 |
| Database | PostgreSQL 18 via Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Validation | zod 4 |
| Auth | argon2id passwords, JWT access tokens (`jsonwebtoken`), rotating refresh tokens in Redis |
| Cache, rate limits, presence, pub/sub | Redis 8 via ioredis |
| Jobs and schedules | BullMQ (a separate worker process) |
| WebSockets | `ws` |
| Object storage | S3 API via AWS SDK v3 (RustFS locally) |
| Email | nodemailer (Mailpit locally) |
| Logging | pino + pino-http (JSON, request IDs) |
| Tests | Vitest + Supertest against real Postgres, Redis, S3 and SMTP; Schemathesis contract test |
| API docs | Swagger UI serving the committed contract at `/docs` (development only) |

## Quick start

```bash
docker compose up -d          # Postgres, Redis, RustFS (+ bucket), Mailpit
cp .env.example .env
npm ci                        # also runs `prisma generate`
npm run db:deploy             # apply migrations
npm run db:seed               # default user: ashutosh@test.com / Ashutosh#1234
npm run dev                   # API on http://localhost:8001
npm run dev:worker            # background jobs (second terminal)
```

**Default login:** `npm run db:seed` creates **`ashutosh@test.com` / `Ashutosh#1234`** (every TaskFlow backend seeds the same account; running it again does nothing). It refuses to run with `NODE_ENV=production`; from your machine it also seeds the database of the Docker stack, since both use the same Postgres.

Every TaskFlow repo publishes its own host ports (see the table below), so several repos' stacks can run at the same time.

**Full stack in containers:** `docker compose --profile app up -d --build` (runs migrations, then the API and the worker).

| URL | What |
|---|---|
| http://localhost:8001/health/ready | Readiness (Postgres + Redis) |
| http://localhost:8001/docs | Swagger UI for the contract (development) |
| http://localhost:18001 | Mailpit inbox |
| http://localhost:19101 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI (pgAdmin, DBeaver, …):** host `localhost`, port **`15401`**, database `taskflow`, user `taskflow`, password `taskflow`. Redis is on `localhost:16301`. Host ports follow the workspace scheme (slot `01`): API 8001, Postgres 15401, Redis 16301, S3 19001 / console 19101, SMTP 11001 / Mailpit 18001. None is a default, so this stack runs alongside other TaskFlow repos and other projects.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `dev:worker` | API / worker with hot reload (`tsx watch`) |
| `npm run build` / `start` / `start:worker` | Compile to `dist/` and run the compiled API / worker |
| `npm run typecheck` | `tsc --noEmit` over src, tests and config |
| `npm run lint` / `format` / `format:check` | ESLint (type-aware) / Prettier |
| `npm test` / `test:unit` / `test:coverage` | All tests / unit tests only / with v8 coverage (`coverage/`) |
| `npm run test:contract` | Schemathesis against a running API (see below) |
| `npm run db:migrate` | Create and apply a migration (development) |
| `npm run db:seed` | Create the default development user (`ashutosh@test.com` / `Ashutosh#1234`); idempotent, refuses in production |
| `npm run db:deploy` | Apply pending migrations (CI, production) |
| `npm run db:drift` | Fail if `schema.prisma` and the database disagree |

## Configuration

Every variable is listed, with safe local defaults and comments, in [.env.example](.env.example), and validated at startup by [src/config.ts](src/config.ts). A missing or invalid value stops the process with a readable message. `RATE_LIMIT_*` exists so the contract test can raise the limits; production keeps the defaults (10/min for auth, 300/min otherwise).

## Project layout

```text
src/
  main.ts           HTTP server, WebSocket gateway, graceful shutdown
  worker.ts         BullMQ worker and cron schedules
  app.ts            Express app: middleware and routes
  container.ts      infra clients and manual dependency injection
  http/             logging, errors, 405/415, auth, rate limiting
  infra/            Prisma, Redis, S3, logger factories
  jobs/             queue facade, processors, mailer
  lib/              problem errors, validation, cursors, fractional indexing
  modules/<feature> routes → service (→ repository)
tests/
  unit/             pure logic
  integration/      HTTP + WebSocket tests against real services
```

## Migrations

Migrations live in `prisma/migrations/` and are **generated, then hand-edited** where Prisma's schema language can't express the reference schema:

- `COLLATE "C"` on `board_columns.position` and `tasks.position` (fractional keys must sort by bytes)
- `tasks.search_vector` as `GENERATED ALWAYS AS (...) STORED`
- every `CHECK` constraint (roles, priorities, statuses, lowercase emails, project keys)

`schema.prisma` declares the generated column with the same expression Postgres reports (`@default(dbgenerated(...))`) and enables the `partialIndexes` preview feature, so `npm run db:drift` reports **no difference**. CI runs that check on every push.

To change the schema: edit `schema.prisma` → `npx prisma migrate dev --create-only --name <change>` → review/edit the SQL → `npx prisma migrate dev`.

## Testing

Tests need the compose infrastructure running. They use a separate database (`<name>_test`, created and migrated automatically) and Redis database 1, so they never touch your dev data.

```bash
npm test
```

**Contract test.** Start the API with relaxed rate limits, get a token, then run Schemathesis (needs [uv](https://docs.astral.sh/uv/)):

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm run dev
TOKEN=$(curl -s localhost:8001/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8001 -H "Authorization: Bearer $TOKEN"
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request: format/lint/typecheck → tests with Postgres, Redis, RustFS and Mailpit service containers + migration drift check + coverage artifact → Schemathesis contract test → Docker build (pushed to `ghcr.io/<owner>/taskflow-express` with the commit SHA and `latest` on `main`). CodeQL and Dependabot run alongside.

## Known notes

- **TypeScript is pinned to 6.0.x** because `typescript-eslint` doesn't support TypeScript 7 yet. Dependabot ignores TypeScript major updates.
- **`DeprecationWarning: Calling client.query() when the client is already executing a query`** can appear in test output. It comes from inside `@prisma/adapter-pg` (parallel nested reads on a transaction connection), not from this code, and is harmless with `pg` 8.
- **npm's `latest` tag for `prisma` points to an 8.0 release candidate.** Upgrade deliberately, with exact versions.
