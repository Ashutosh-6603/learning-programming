# taskflow-fastapi

The **TaskFlow API** (team project management, a Jira/Trello-lite) built with **FastAPI, SQLAlchemy 2 (async), PostgreSQL 18 and Redis**, in Python 3.14. It's one of six interchangeable TaskFlow backends that implement the same [OpenAPI contract](contract/openapi.yaml); the TaskFlow Python frontend (`taskflow-frontend-python`) works against it unchanged, and so does the Node one.

- **Rebuild it yourself:** [STEPS.md](STEPS.md) walks through every file, from an empty folder to CI.
- **Design** (data model, RBAC, auth, real-time protocol, Redis keys): the TaskFlow README in the parent folder (`../README.md`).
- **Coming from the Node backends?** Same Parts and Steps, same tests. STEPS.md bridges every Python construct from TypeScript as it appears, and [docs/python-for-ts-devs.md](../../docs/python-for-ts-devs.md) is the language primer.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Python 3.14, managed by [uv](https://docs.astral.sh/uv/) (`pyproject.toml` + `uv.lock`) |
| HTTP | FastAPI on Starlette, served by uvicorn (uvloop) |
| Database | PostgreSQL 18 via SQLAlchemy 2.1 (async, asyncpg driver); migrations by Alembic |
| Validation | Pydantic v2 models, camelCase on the wire through an alias generator |
| Auth | argon2id passwords (pwdlib), JWT access tokens (PyJWT) through `Depends()`, rotating refresh tokens in Redis |
| Cache, rate limits, presence, pub/sub | Redis 8 via redis-py (asyncio) |
| Jobs and schedules | Celery (Redis broker) + Celery Beat, separate processes |
| WebSockets | Starlette WebSockets, plain JSON envelopes |
| Object storage | S3 API via boto3 (RustFS locally) |
| Email | aiosmtplib (Mailpit locally) |
| Config | pydantic-settings |
| Logging | structlog (JSON, request IDs, one line per request), also for uvicorn's and Celery's own lines |
| Tests | pytest + pytest-asyncio + httpx against real Postgres, Redis, S3 and SMTP; Schemathesis contract test |
| Lint / types | ruff (lint + format), mypy `--strict` |
| API docs | FastAPI generates OpenAPI from the code; Swagger UI at `/docs` (not in production) |

## Quick start

```bash
docker compose up -d                     # Postgres, Redis, RustFS (+ bucket), Mailpit
cp .env.example .env
uv sync                                  # creates .venv from uv.lock
uv run alembic upgrade head              # apply migrations
uv run python -m app.seed                # default user: ashutosh@test.com / Ashutosh#1234
uv run --env-file .env fastapi dev       # API on http://localhost:8004, reloads on save
uv run celery -A app.jobs.worker worker -B --loglevel INFO   # jobs + schedule (second terminal)
```

**Default login:** `uv run python -m app.seed` creates **`ashutosh@test.com` / `Ashutosh#1234`** (every TaskFlow backend seeds the same account; running it again prints `exists`). It refuses to run with `APP_ENV=production`; from your machine it also seeds the database of the Docker stack, since both use the same Postgres.

Every TaskFlow repo publishes its own host ports (see below), so several repos' stacks can run at the same time.

**Full stack in containers:** `docker compose --profile app up -d --build` (runs migrations, then the API, the worker and the scheduler).

| URL | What |
|---|---|
| http://localhost:8004/health/ready | Readiness (Postgres + Redis) |
| http://localhost:8004/docs | Swagger UI, generated from the code (development) |
| http://localhost:18004 | Mailpit inbox |
| http://localhost:19104 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI (pgAdmin, DBeaver, …):** host `localhost`, port **`15404`**, database `taskflow`, user `taskflow`, password `taskflow`. Redis is on `localhost:16304`. Host ports follow the workspace scheme (slot `04`): API 8004, Postgres 15404, Redis 16304, S3 19004 / console 19104, SMTP 11004 / Mailpit 18004.

## Commands

Python has no `npm run`; these are the everyday commands, all run from the repo root.

| Command | What it does |
|---|---|
| `uv sync` | Install exactly what `uv.lock` says into `.venv` (like `npm ci`) |
| `uv run --env-file .env fastapi dev` | API with reload; `PORT` from `.env` picks the port |
| `uv run celery -A app.jobs.worker worker -B` | Worker plus the Beat scheduler in one process (development) |
| `uv run ruff check .` / `uv run ruff format .` | Lint / format |
| `uv run mypy .` | Type check (strict) |
| `uv run pytest` / `uv run pytest tests/unit` / `uv run pytest --cov` | All tests / unit tests only / with coverage |
| `uv run alembic revision --autogenerate -m "<what>" --rev-id 0002` | Write a migration from the changes in the models |
| `uv run alembic upgrade head` | Apply pending migrations |
| `uv run alembic check` | Fail if the models have changes no migration captures (drift) |
| `uv run python -m app.seed` | Create the default development user; idempotent, refuses in production |

## Configuration

Every variable is listed, with safe local defaults and comments, in [.env.example](.env.example), and validated at startup by [app/config.py](app/config.py) (a pydantic-settings class). A missing or invalid value stops the process with a list of every problem. `DATABASE_URL` is the same `postgresql://` URL every TaskFlow backend uses; the app switches the driver to asyncpg itself. `RATE_LIMIT_*` exists so the contract test can raise the limits; production keeps the defaults (10/min for auth, 300/min otherwise).

## Project layout

```text
app/
  main.py             create_app(): middleware, error handlers, routers, lifespan; `app` for uvicorn
  config.py           typed, validated environment
  deps.py             shared dependencies: SessionDep, RedisDep, JobsDep, StorageDep, SettingsDep
  seed.py             `python -m app.seed`
  core/               problem errors and handlers, middleware, logging, validation types,
                      pagination cursors, fractional indexing, rate limiter, path parameters
  db/                 declarative base and naming convention, engine/session, Postgres errors
  models/             SQLAlchemy models, one file per area
  infra/              resources (pools and clients, opened in the lifespan), S3 storage
  <feature>/          router.py → service.py, schemas.py (auth, users, workspaces, projects,
                      tasks, comments, activity, search, attachments, realtime, health)
  jobs/               queue facade, Celery worker and schedule, job handlers, mailer
migrations/           Alembic environment and versions/
tests/                pytest: integration tests (HTTP, WebSocket, jobs), tests/unit for pure logic
```

## Migrations

The schema is the set of models in [app/models](app/models). Alembic compares them with the database and writes the migration: `uv run alembic revision --autogenerate -m "<what>" --rev-id 0002`, then `uv run alembic upgrade head`. Generated files are formatted by ruff automatically (a post-write hook in `alembic.ini`). The models express the whole reference schema: `COLLATE "C"`, the generated `tsvector` column, partial and GIN indexes, every `CHECK`, and Postgres's own constraint names (through a naming convention). The first migration needed no hand edits.

## Testing

Tests need the compose infrastructure running. They use a separate database (`taskflow_test`, created and migrated automatically) and Redis database 1, so they never touch your dev data. Most tests call the app in-process through httpx's ASGI transport; the WebSocket tests start two complete app instances on real ports with uvicorn.

```bash
uv run pytest
```

**Contract test.** Start the API with relaxed rate limits, get a token, then run Schemathesis:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 uv run --env-file .env fastapi dev
TOKEN=$(curl -s localhost:8004/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["accessToken"])')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8004 -H "Authorization: Bearer $TOKEN"
```

## CI

`.github/workflows/ci.yml` runs on every push and pull request: ruff format/lint + mypy → tests with Postgres, Redis, RustFS and Mailpit service containers + migration drift check (`alembic check`) + coverage artifact → Schemathesis contract test → Docker build (pushed to `ghcr.io/<owner>/taskflow-fastapi` with the commit SHA and `latest` on `main`). CodeQL and Dependabot run alongside.

## Known notes

- **SQLAlchemy 2.1.** The latest release of the 2.x line; the code uses the 2.0-style API (`select()`, `Mapped[...]`, `AsyncSession`) throughout.
- **One database session per request,** shared by every service the request uses (FastAPI caches a dependency within a request). A service commits at the end of its use case; caching, real-time events and jobs happen after the commit.
- **Celery is synchronous, the job code is async.** Each worker process keeps one event loop (`asyncio.Runner`) and runs every job on it. The API enqueues by task name (`send_task`), so it never imports the worker.
- **Emails are checked for syntax only** (the WHATWG rule browsers use), not with Pydantic's `EmailStr`: email-validator also refuses reserved domains such as `.test`, a delivery policy the contract doesn't have. The contract test caught the difference.
- **WebSockets close with 1012 on shutdown, not 1001.** uvicorn closes open sockets itself (code 1012, "service restart") before the app's shutdown code runs. Clients reconnect on either code.
- **405 responses list only methods that are really served.** FastAPI doesn't answer `HEAD` for `GET` routes (Express does), so `Allow` on `/health/live` is `GET`.
- **Rate limiting is a hand-written dependency, not slowapi,** so all six backends run the same sliding-window algorithm against the same Redis keys.
- **`/docs` is generated from the code;** the contract in `contract/openapi.yaml` remains the source of truth and Schemathesis checks the API against it.
