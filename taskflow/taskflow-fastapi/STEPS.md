# STEPS · Rebuild `taskflow-fastapi` from an empty folder

You'll build the **TaskFlow API** (a Jira/Trello-lite backend) with **FastAPI, SQLAlchemy 2 (async), PostgreSQL 18 and Redis**, in **Python 3.14**, by hand, one small step at a time. At the end your repo behaves exactly like this one: the same endpoints, the same 79 tests, the same CI.

This is the **fourth** of six TaskFlow backends and the **first one in Python**. You built Express, Fastify and NestJS in TypeScript; this guide keeps their Part and Step numbers, so Step 7.2 here and Step 7.2 there do the same job. Two things change at once, and the guide spends its words on both:

1. **The language.** Every Python construct is explained the first time it appears, bridged from TypeScript ("this is like X in TS, but differs because Y"). Keep [docs/python-for-ts-devs.md](../../docs/python-for-ts-devs.md) open in another tab: it's the short language tour this guide links to instead of repeating, and [docs/gotchas.md](../../docs/gotchas.md#python) lists the traps.
2. **FastAPI's model.** FastAPI is minimal like Express and Fastify, but **type-driven**: the parameters you declare on a handler (their names, their types, their defaults) *are* the routing, parsing and validation instructions. **Dependency injection** is a plain function parameter, `Depends(...)`, instead of NestJS's container and decorators. You'll see that one idea do the work of Express middleware, Nest guards and Nest pipes.

The **data structures and algorithms** stay the same as in the TypeScript repos. Every non-trivial feature still gets its 🧠 box, shorter where the idea is unchanged, longer where Python or SQLAlchemy changes how it's done.

> **Design docs you'll want open:** [`../README.md`](../README.md) (the TaskFlow design: data model, RBAC, auth, real-time protocol, Redis keys) and [`contract/openapi.yaml`](contract/openapi.yaml) (the API). This guide implements them; it doesn't repeat them.

## What you'll build

```mermaid
flowchart LR
    Client["HTTP / WebSocket client"] --> API
    subgraph Py["taskflow-fastapi"]
        API["uvicorn → app.main:app<br/>FastAPI routers + WebSocket hub"]
        Worker["celery worker<br/>app.jobs.worker"]
        Beat["celery beat<br/>(the schedule)"]
    end
    API --> PG[("PostgreSQL 18<br/>SQLAlchemy + asyncpg")]
    API --> R[("Redis 8<br/>tokens · cache · limits ·<br/>presence · pub/sub · queue")]
    API --> S3[("RustFS<br/>S3 API (boto3)")]
    Beat --> R
    Worker --> PG
    Worker --> R
    Worker --> S3
    Worker --> Mail["Mailpit<br/>SMTP"]
```

**Inside the API process**, a request passes through these layers. Each box is something you'll write:

```mermaid
flowchart LR
    A["ASGI middleware<br/>request id · CORS ·<br/>415 / 413 guard"] --> B["dependencies<br/>authenticate →<br/>rate limit"]
    B --> C["Pydantic<br/>validates path, query,<br/>body"]
    C --> D["router function<br/>(router.py)"]
    D --> E["service<br/>RBAC, rules,<br/>one session"]
    E --> F["SQLAlchemy<br/>(async)"]
    D -. raise .-> G["exception handlers<br/>→ problem+json"]
    E -. after commit .-> X["cache · pub/sub · jobs"]
```

## Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Python | 3.14 (uv can install it: `uv python install 3.14`) | `uv python find 3.14` |
| uv | 0.12+ | `uv --version` |
| Docker + Compose | Compose v5 | `docker compose version` |
| A GitHub account | | |

You've finished at least one of the TypeScript backends (or read its guide). Read sections 1 to 6 of the [Python primer](../../docs/python-for-ts-devs.md) before you start; the rest is linked from the steps that need it.

## The finished repo

```text
taskflow-fastapi/
├── .github/              dependabot.yml, workflows/ci.yml, workflows/codeql.yml
├── app/
│   ├── main.py           create_app(): middleware, error handlers, routers, lifespan
│   ├── config.py         typed, validated environment (pydantic-settings)
│   ├── deps.py           shared dependencies: database session, Redis, jobs, storage
│   ├── seed.py           `python -m app.seed`: the default development user
│   ├── core/             problem errors and handlers, middleware, logging, validation types,
│   │                     cursors, fractional indexing, rate limiter, path parameters
│   ├── db/               declarative base, engine and sessions, Postgres error codes
│   ├── models/           SQLAlchemy models
│   ├── infra/            resources opened at startup (pools, clients), S3 storage
│   ├── <feature>/        router.py → service.py, schemas.py: auth, users, workspaces,
│   │                     projects, tasks, comments, activity, search, attachments, realtime
│   └── jobs/             queue facade, Celery worker and schedule, job handlers, mailer
├── migrations/           Alembic: env.py, script template, versions/
├── tests/                pytest: integration tests; tests/unit for pure logic
├── contract/             openapi.yaml (copy of the master contract)
├── docker-compose.yml    local infra (+ the app under the "app" profile)
├── Dockerfile            multi-stage, non-root
├── alembic.ini           Alembic settings
├── pyproject.toml        the project, its dependencies and every tool's settings
├── uv.lock               exact versions of everything (commit it)
└── schemathesis.toml     contract-test settings
```

**Parts:** 0 Repo setup · 1 Infrastructure & config · 2 Database · 3 HTTP foundations · 4 Authentication · 5 Workspaces & RBAC · 6 Projects, columns & ordering · 7 Tasks · 8 Comments, activity & search · 9 Attachments · 10 Real-time · 11 Background jobs · 12 Contract testing · 13 Docker · 14 CI/CD · 15 Full stack & next steps

**How to read the code blocks:** each block says which file it belongs to and where it goes: **new file**, **continue** (append to the end of the file), **add after `<line>`** (insert the block right below that existing line), **add before `<line>`**, or **add at the top**. Type them in that order and your files will match the repo exactly. A file introduced as **new file** and then continued in the same step is one file typed top to bottom; it's split only where a later Part will insert lines.

**Imports, one per line.** Python files start with their imports, and this repo writes **one imported name per line** (`from x import a` and `from x import b`, never `from x import a, b`). The linter enforces it (Step 0.3). It costs a few lines, but it's why a later step can add an import without editing an existing line, and it keeps diffs to one line per name.

---
## Part 0 · Repo setup

### Step 0.1 · Create the repo

**Goal:** an empty git repository with a uv project file, pinned to Python 3.14.

**Files:** `pyproject.toml`, `.python-version`

```bash
mkdir taskflow-fastapi && cd taskflow-fastapi
git init -b main
uv init --bare --name taskflow-fastapi \
  --description "TaskFlow API: FastAPI + SQLAlchemy 2 (async) + PostgreSQL + Redis" --python 3.14
uv python pin 3.14
uv version 1.0.0
```

Then add this table at the end of the file uv created:

**`pyproject.toml`** · add at the end

```toml
[tool.uv]
package = false
```

**What's new (npm → uv)**
- **uv is npm for Python, and nvm too.** It installs Python versions, creates the project's private package folder, resolves and locks dependencies, and runs commands. The mapping: `pyproject.toml` ≈ `package.json`, `uv.lock` ≈ `package-lock.json`, `.venv/` ≈ `node_modules/`, `uv add` ≈ `npm i`, `uv run <cmd>` ≈ `npx <cmd>`. The [ecosystem table](../../docs/ecosystem.md) has the rest.
- **`pyproject.toml`** is the standard project file every Python tool reads (TOML: `key = value` lines under `[section]` headers). `[project]` is the standard part (name, version, Python requirement, dependencies); every tool keeps its settings under `[tool.<name>]` in the same file, so there's no `.eslintrc`/`tsconfig.json` zoo.
- `uv init --bare` writes only `pyproject.toml`; without `--bare` it would add a sample `main.py` and README you'd delete. `uv python pin 3.14` writes `.python-version`, which uv (and the Docker image, Part 13) reads to pick the interpreter, like `.nvmrc`.
- **`[tool.uv] package = false`:** this is an *application*, not a library you publish to PyPI, so uv shouldn't try to build and install it as a package. The code is imported straight from the repo folder.

**✅ Checkpoint**

```bash
cat pyproject.toml
```

Expected:

```text
[project]
name = "taskflow-fastapi"
version = "1.0.0"
description = "TaskFlow API: FastAPI + SQLAlchemy 2 (async) + PostgreSQL + Redis"
requires-python = ">=3.14"
dependencies = []

[tool.uv]
package = false
```

**Commit:** `chore: initialise uv project`

### Step 0.2 · Python 3.14 and a strict type checker

**Goal:** mypy in strict mode, Python's equivalent of `tsc --noEmit` with `strict: true`.

**Files:** `pyproject.toml`

```bash
uv add --dev --bounds exact mypy==2.4.1
```

- **Why a separate type checker?** Python's type hints (`name: str`, `-> int`) are **not checked when the code runs**: the interpreter mostly ignores them. TypeScript's types vanish at compile time; Python's survive at run time as plain data but nobody enforces them unless a tool does. **mypy** is that tool. Libraries like Pydantic and FastAPI *also* read the hints at run time to validate data, which TypeScript can't do (zod exists because of that gap).
- `--dev` puts it in the `dev` dependency group (`devDependencies`); `--bounds exact` writes `mypy==2.4.1` instead of `mypy>=2.4.1`, like `npm i -E`. The lockfile pins everything either way; exact bounds make `pyproject.toml` say so too.

**`pyproject.toml`** · add at the end

```toml
[tool.mypy]
python_version = "3.14"
strict = true
```

- **`strict = true`** turns on every optional check: every function needs annotated parameters and a return type, no implicit `Any`, no calling untyped functions from typed code. It's `strict: true` plus `noImplicitAny` plus a few TS doesn't have.

**✅ Checkpoint**

```bash
uv run mypy --version
```

Expected: `mypy 2.4.1 (compiled: yes)`.

**Commit:** `chore: add mypy in strict mode`

### Step 0.3 · Lint, format, editor settings, ignores

**Goal:** ruff (linter and formatter in one), `.editorconfig` and `.gitignore`.

**Files:** `pyproject.toml`, `.editorconfig`, `.gitignore`

```bash
uv add --dev --bounds exact ruff==0.17.5
```

- **ruff replaces ESLint *and* Prettier.** `ruff check` lints, `ruff format` formats (Black's style), and it's fast enough to run on every save. Python's style guide, **PEP 8**, is built in: `snake_case` for functions and variables, `PascalCase` for classes, `UPPER_CASE` for constants, four-space indents.

**`pyproject.toml`** · add at the end

```toml
[tool.ruff]
line-length = 100
target-version = "py314"
extend-exclude = ["*.md"]

[tool.ruff.lint]
select = ["E", "W", "F", "I", "B", "UP", "SIM", "RUF", "ASYNC", "S", "N", "PT", "RET"]
ignore = ["S101"]

[tool.ruff.lint.isort]
force-single-line = true

[tool.ruff.lint.per-file-ignores]
"tests/**" = ["S105", "S106", "S311"]
"migrations/versions/*" = ["E501"]
```

**What's new**
- `select` turns on rule families by letter: `E`/`W`/`F` (pycodestyle and pyflakes: the basics), `I` (import sorting), `B` (bugbear: likely bugs), `UP` (pyupgrade: use the modern syntax for our Python version), `SIM` (simplifications), `RUF` (ruff's own), `ASYNC` (blocking calls inside async code), `S` (bandit: security), `N` (naming), `PT` (pytest style), `RET` (returns). `S101` is off: `assert` is how pytest checks things.
- **`extend-exclude = ["*.md"]`**: recent ruff versions also format the Python code blocks inside Markdown files. This guide's blocks are excerpts of files (fragments, "add after" snippets), not complete files, so `ruff format --check .` would flag them; ruff should only check real `.py` files.
- **`force-single-line = true`** is the one-import-per-line rule from the introduction.
- `per-file-ignores` relaxes three security rules in tests (hard-coded passwords and a seeded random generator are fine there), and line length in generated migrations (Part 2).

**`.editorconfig`** · new file

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 4
insert_final_newline = true
trim_trailing_whitespace = true

[*.{yml,yaml,json}]
indent_size = 2

[*.md]
trim_trailing_whitespace = false
```

**`.gitignore`** · new file

```gitignore
.venv/
__pycache__/
*.py[cod]
.env
.coverage
htmlcov/
coverage.xml
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.log
.DS_Store
.schemathesis/
schemathesis-report/
.hypothesis/
celerybeat-schedule*
```

**What's new**
- Four-space indents, because in Python **indentation is syntax**: a block is the indented lines after a colon, with no braces. Two spaces stays for YAML and JSON.
- `.gitignore` lists Python's caches: `__pycache__/` (compiled bytecode, Python's `dist/`), `.mypy_cache/`, `.ruff_cache/`, `.pytest_cache/`, coverage output, and `.venv/` (your `node_modules/`).

**✅ Checkpoint**

```bash
uv run ruff --version
```

Expected: `ruff 0.17.5`.

**Commit:** `chore: add ruff, editorconfig and gitignore`

### Step 0.4 · pytest and the everyday commands

**Goal:** the test runner and its settings, and the handful of commands you'll type all day.

**Files:** `pyproject.toml`

```bash
uv add --dev --bounds exact pytest==9.2.0 pytest-asyncio==1.5.0 pytest-cov==7.1.0
```

- **pytest** is Python's Vitest: it finds `test_*.py` files and runs every `test_*` function in them. A plain `assert x == y` is the assertion; pytest rewrites it to print both sides when it fails, so there's no `expect(...).toBe(...)` API to learn.
- **pytest-asyncio** runs `async def` tests (our app is async from end to end). **pytest-cov** adds coverage (`--cov`), like `@vitest/coverage-v8`.

**`pyproject.toml`** · add at the end

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
asyncio_mode = "auto"
asyncio_default_fixture_loop_scope = "session"
asyncio_default_test_loop_scope = "session"
```

**`pyproject.toml`** · add at the end

```toml
[tool.coverage.run]
source = ["app"]
```

**What's new**
- `pythonpath = ["."]` lets tests write `from app.config import Settings`: the repo root is on Python's import path.
- `asyncio_mode = "auto"` treats every `async def test_*` as an asyncio test without a decorator on each. The two `loop_scope = "session"` lines run **every test and fixture on one event loop** for the whole run. Part 3 starts the app once and shares it between tests, and its database pool belongs to the loop it was created on.
- `[tool.coverage.run] source = ["app"]` measures the application code, not the tests.

**There are no npm-style scripts in Python.** These are the commands you'll use, all from the repo root:

| Command | Like |
|---|---|
| `uv run pytest` | `npm test` |
| `uv run ruff check .` / `uv run ruff format .` | `npm run lint` / `npm run format` |
| `uv run mypy .` | `npm run typecheck` |
| `uv sync` | `npm ci` (makes `.venv` match `uv.lock` exactly) |

**✅ Checkpoint**

```bash
uv run pytest --version
```

Expected: `pytest 9.2.0`.

**Commit:** `chore: add pytest with asyncio and coverage`

### Step 0.5 · Push to GitHub

**Goal:** the repo exists on GitHub so CI can run later.

**Files:** none (GitHub only)

```bash
gh repo create taskflow-fastapi --private --source=. --remote=origin --push
```

(Without the GitHub CLI: create an empty repo on github.com, then `git remote add origin git@github.com:<you>/taskflow-fastapi.git && git push -u origin main`.)

**✅ Checkpoint**

```bash
git remote -v
```

Expected: two `origin` lines pointing at your GitHub repo.

**Commit:** nothing new to commit in this step.

---

## Part 1 · Local infrastructure & configuration

### Step 1.1 · Docker Compose for the infrastructure

**Goal:** Postgres, Redis, S3-compatible storage and an SMTP catcher, all started with one command.

**Files:** `docker-compose.yml`

**`docker-compose.yml`** · new file

```yaml
name: taskflow-fastapi
```

**`docker-compose.yml`** · continue

```yaml
services:
  postgres:
    image: postgres:18.6
    environment:
      POSTGRES_USER: taskflow
      POSTGRES_PASSWORD: taskflow
      POSTGRES_DB: taskflow
    ports:
      - '15404:5432'
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U taskflow -d taskflow']
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:8.8.4
    ports:
      - '16304:6379'
    volumes:
      - redis-data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 5s
      timeout: 3s
      retries: 20
```

**`docker-compose.yml`** · continue

```yaml

  rustfs:
    image: rustfs/rustfs:1.0.4
    environment:
      RUSTFS_ACCESS_KEY: taskflow
      RUSTFS_SECRET_KEY: taskflow-secret
    ports:
      - '19004:9000'
      - '19104:9001'
    volumes:
      - rustfs-data:/data
    healthcheck:
      test: ['CMD', 'curl', '-fs', 'http://localhost:9000/health']
      interval: 5s
      timeout: 3s
      retries: 20

  s3-init:
    image: amazon/aws-cli:2.39.2
    depends_on:
      rustfs:
        condition: service_healthy
    environment:
      AWS_ACCESS_KEY_ID: taskflow
      AWS_SECRET_ACCESS_KEY: taskflow-secret
      AWS_DEFAULT_REGION: us-east-1
    entrypoint: ['sh', '-c']
    command:
      - |
        set -e
        S3="aws --endpoint-url http://rustfs:9000 s3api"
        $$S3 head-bucket --bucket taskflow-attachments 2>/dev/null || $$S3 create-bucket --bucket taskflow-attachments
        $$S3 put-bucket-cors --bucket taskflow-attachments --cors-configuration '{"CORSRules":[{"AllowedOrigins":["http://localhost:5173"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":600}]}'
        echo "bucket taskflow-attachments ready"
```

**`docker-compose.yml`** · continue

```yaml

  mailpit:
    image: axllent/mailpit:v1.32.0
    ports:
      - '11004:1025'
      - '18004:8025'
    healthcheck:
      test: ['CMD', '/mailpit', 'readyz']
      interval: 5s
      timeout: 3s
      retries: 20
```

**`docker-compose.yml`** · continue

```yaml
volumes:
  postgres-data:
  redis-data:
  rustfs-data:
```

**What's new**
- The same stack as the Node repos, with a new project name and slot. **`name: taskflow-fastapi`** gives this repo its own containers, network and **volumes** (`taskflow-fastapi_postgres-data`), so it starts with an empty database. **Host ports end in `04`**, FastAPI's slot: Postgres **15404**, Redis **16304**, S3 **19004** (console 19104), SMTP **11004** (Mailpit UI 18004), API **8004**. All the TaskFlow stacks can run at once.
- Inside the compose network every service keeps its default port (5432, 6379, 9000, 1025). `s3-init` creates the bucket and its CORS rules, then exits.

**✅ Checkpoint**

```bash
docker compose up -d
docker compose ps --format 'table {{.Service}}\t{{.Status}}' -a
```

Expected: `postgres`, `redis`, `rustfs` and `mailpit` are `Up … (healthy)`, and `s3-init` is `Exited (0)`.

**Commit:** `chore: docker compose for postgres, redis, rustfs and mailpit`

### Step 1.2 · Typed configuration with pydantic-settings

**Goal:** read every environment variable once, convert and validate it, and fail at startup with a readable list of problems.

**Files:** `.env.example`, `app/__init__.py`, `app/config.py`, `pyproject.toml`, `tests/__init__.py`, `tests/test_config.py`

```bash
uv add --bounds exact pydantic-settings==2.16.3
```

- **Pydantic** (pulled in by pydantic-settings) is the library this whole app stands on: **classes whose type hints are validated at run time**. It's zod, but the schema is a class with annotated fields instead of a chain of calls, and it's the validation layer inside FastAPI. **pydantic-settings** adds one class, `BaseSettings`, that fills its fields from environment variables and `.env`. One library replaces Express's dotenv + zod.

**`.env.example`** · new file

```bash
# Copy to .env for local development: cp .env.example .env
# Every value below matches docker-compose.yml, so `docker compose up -d` + `uv run fastapi dev` just works.

APP_ENV=development
LOG_LEVEL=info
# Read by the FastAPI CLI: `uv run --env-file .env fastapi dev` serves on this port.
PORT=8004

# PostgreSQL 18 (compose service "postgres"). The app switches the driver to asyncpg itself.
DATABASE_URL=postgresql://taskflow:taskflow@localhost:15404/taskflow

# Redis (compose service "redis"): refresh tokens, cache, rate limits, presence, pub/sub, job queue
REDIS_URL=redis://localhost:16304/0

# Auth. JWT_SECRET must be at least 32 characters; generate a real one with: openssl rand -base64 48
JWT_SECRET=dev-only-change-me-at-least-32-bytes-long!!
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=604800
# Browsers accept Secure cookies on http://localhost; set false only for non-localhost plain HTTP
COOKIE_SECURE=true

# The React frontend: CORS origin and the base of links in emails
FRONTEND_URL=http://localhost:5173

# S3-compatible storage (compose service "rustfs"). The API talks to S3_ENDPOINT;
# presigned URLs handed to the browser are signed for S3_PUBLIC_ENDPOINT.
S3_ENDPOINT=http://localhost:19004
S3_PUBLIC_ENDPOINT=http://localhost:19004
S3_REGION=us-east-1
S3_BUCKET=taskflow-attachments
S3_ACCESS_KEY=taskflow
S3_SECRET_KEY=taskflow-secret

# Sliding-window limits (requests per minute). The contract test raises these.
RATE_LIMIT_AUTH_PER_MINUTE=10
RATE_LIMIT_API_PER_MINUTE=300

# Email via Mailpit (web UI: http://localhost:18004)
SMTP_HOST=localhost
SMTP_PORT=11004
MAIL_FROM=TaskFlow <no-reply@taskflow.local>
```

```bash
cp .env.example .env
mkdir app && touch app/__init__.py
```

**What's new**
- The same variables as every TaskFlow backend, with slot-04 ports. `DATABASE_URL` is the plain `postgresql://` URL the other five backends use; the app picks its driver itself (below). `PORT` is read by the FastAPI CLI, not by the app (Part 3).
- **`app/__init__.py`** makes the folder `app` a **package**: a directory Python can import from (`import app.config`). An empty file is enough. Every folder of code gets one; that's how Python tells a package from a random directory. (The [primer's §8](../../docs/python-for-ts-devs.md#8-modules-and-packages) has more.)

**`app/config.py`** · new file

```python
from functools import lru_cache
from typing import Annotated
from typing import Literal

from pydantic import Field
from pydantic import HttpUrl
from pydantic import PostgresDsn
from pydantic import RedisDsn
from pydantic_settings import BaseSettings
from pydantic_settings import SettingsConfigDict

PositiveInt = Annotated[int, Field(ge=1)]

class Settings(BaseSettings):
    """Every environment variable the app reads. A default makes a variable optional."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore", frozen=True)

    app_env: Literal["development", "test", "production"] = "development"
    log_level: Literal["critical", "error", "warning", "info", "debug"] = "info"

    database_url: PostgresDsn
    redis_url: RedisDsn

    jwt_secret: Annotated[str, Field(min_length=32)]
    access_token_ttl_seconds: PositiveInt = 900
    refresh_token_ttl_seconds: PositiveInt = 604_800
    cookie_secure: bool = True

    frontend_url: HttpUrl = HttpUrl("http://localhost:5173")

    s3_endpoint: HttpUrl
    s3_public_endpoint: HttpUrl
    s3_region: str = "us-east-1"
    s3_bucket: Annotated[str, Field(min_length=3)]
    s3_access_key: Annotated[str, Field(min_length=1)]
    s3_secret_key: Annotated[str, Field(min_length=1)]

    smtp_host: str = "localhost"
    smtp_port: PositiveInt = 1025
    mail_from: str = "TaskFlow <no-reply@taskflow.local>"

    rate_limit_auth_per_minute: PositiveInt = 10
    rate_limit_api_per_minute: PositiveInt = 300

```

**What's new (TS → Python)**
- **Imports name a module, then what you take from it:** `from pydantic import Field` is `import { Field } from 'pydantic'`. Module paths use dots (`app.config`), not slashes, and are always absolute from the import root here.
- **A class body is a list of annotated fields.** `database_url: PostgresDsn` declares a field of type `PostgresDsn` with **no default, so it's required**; `cookie_secure: bool = True` has a default. That's the whole schema: Pydantic reads the annotations when the class is created. Compare zod's `z.object({ ... })`.
- **`Annotated[int, Field(ge=1)]`** is a type plus metadata: still an `int` for mypy, plus a rule ("≥ 1") for Pydantic. `PositiveInt = Annotated[...]` names it once, like `type PositiveInt = ...` in TS, but the alias also carries the runtime rule.
- **`Literal["development", "test", "production"]`** is TS's `'development' | 'test' | 'production'`.
- **Converting text.** Environment variables are strings. Pydantic converts them to the declared type: `"8004"` → `8004`, `"false"` → `False` (it knows `"false"`, `"0"`, `"no"`, unlike `Boolean("false")` in JS). `PostgresDsn`, `RedisDsn` and `HttpUrl` validate URLs and their schemes.
- **`model_config = SettingsConfigDict(...)`**: class-level options. `env_file=".env"` reads the file too (real environment variables win), `extra="ignore"` skips the hundreds of unrelated variables, `frozen=True` makes the object immutable. Field names are matched case-insensitively: `database_url` reads `DATABASE_URL`.
- `604_800`: underscores in number literals, as in TS.

**`app/config.py`** · continue

```python
    @property
    def sqlalchemy_url(self) -> str:
        """The same database, reached through the asyncpg driver (SQLAlchemy picks it by scheme)."""
        return str(self.database_url).replace("postgresql://", "postgresql+asyncpg://", 1)

    @property
    def frontend_origin(self) -> str:
        """HttpUrl normalises to a trailing slash; a CORS origin never has one."""
        return str(self.frontend_url).rstrip("/")

@lru_cache
def get_settings() -> Settings:
    """Read and validate the environment once; every later call returns the same object."""
    return Settings()
```

**What's new**
- **`@property`** turns a method into a read-only attribute: `settings.sqlalchemy_url`, no parentheses. It's a TS `get sqlalchemyUrl()` getter. `self` is `this`, but explicit: every method's first parameter.
- **`sqlalchemy_url`** swaps the URL scheme for `postgresql+asyncpg://`. SQLAlchemy picks its **driver** from the scheme, and asyncpg is the async Postgres driver (Part 2). Keeping the plain URL in the environment means CI, Docker and the frontend docs are the same for all six backends.
- **`@lru_cache` on a function with no arguments** caches its result after the first call: `get_settings()` reads and validates the environment once, then returns the same object. It's a memoised singleton without a global variable. (`str(x)` converts anything to text, like `String(x)`.)
- A **docstring** (`"""..."""` as a function's or class's first line) documents it, like JSDoc, and tools show it on hover.

Pydantic ships a mypy plugin that teaches mypy how Pydantic classes are constructed (which keyword arguments each one takes). Add it under `[tool.mypy]`, and its settings at the end:

**`pyproject.toml`** · add under `strict = true` in `[tool.mypy]`

```toml
plugins = ["pydantic.mypy"]
```

**`pyproject.toml`** · add at the end

```toml
[tool.pydantic-mypy]
init_forbid_extra = true
init_typed = true
```

```bash
touch tests/__init__.py
```

**`tests/test_config.py`** · new file

```python
import pytest
from pydantic import ValidationError

from app.config import Settings

REQUIRED = {
    "database_url": "postgresql://taskflow:taskflow@localhost:15404/taskflow",
    "redis_url": "redis://localhost:16304/0",
    "jwt_secret": "x" * 32,
    "s3_endpoint": "http://rustfs:9000",
    "s3_public_endpoint": "http://localhost:19004",
    "s3_bucket": "taskflow-attachments",
    "s3_access_key": "taskflow",
    "s3_secret_key": "taskflow-secret",
}

def test_defaults_conversions_and_the_asyncpg_url() -> None:
    # _env_file=None: read only what we pass, not the developer's .env.
    settings = Settings(_env_file=None, **REQUIRED, smtp_port="11004", cookie_secure="false")  # type: ignore[arg-type]
    assert settings.smtp_port == 11004
    assert settings.cookie_secure is False
    assert settings.access_token_ttl_seconds == 900
    assert settings.sqlalchemy_url.startswith("postgresql+asyncpg://")
    assert settings.frontend_origin == "http://localhost:5173"

def test_every_invalid_variable_is_named() -> None:
    with pytest.raises(ValidationError) as caught:
        Settings(_env_file=None, **(REQUIRED | {"jwt_secret": "short", "redis_url": "nope"}))  # type: ignore[arg-type]
    fields = {str(e["loc"][0]) for e in caught.value.errors()}
    assert fields == {"jwt_secret", "redis_url"}
```

**What's new**
- **A test is a function named `test_*`;** `assert` is the assertion. `pytest.raises(ValidationError)` is `expect(() => ...).toThrow(ValidationError)`, written as a `with` block (a **context manager**: the code inside runs, and leaving the block checks that the error happened; [primer §10](../../docs/python-for-ts-devs.md#10-context-managers-with)). `as caught` keeps the error for inspection.
- **`**REQUIRED`** spreads a dict into keyword arguments, like `{...required}` into props; `REQUIRED | {...}` merges two dicts (the right side wins), like `{ ...a, ...b }`. `{x for x in ...}` is a **set comprehension** ([primer §4](../../docs/python-for-ts-devs.md#4-collections)).
- `_env_file=None` tells this one `Settings` to skip `.env`. The `# type: ignore[arg-type]` comment silences one specific mypy error on that line: mypy knows `smtp_port` is an `int`, and the test deliberately passes the text a real environment would hold.

**✅ Checkpoint**

```bash
uv run pytest
uv run mypy .
```

Expected: `2 passed`, then `Success: no issues found in 4 source files`.

**Commit:** `feat: typed configuration with pydantic-settings`

---

## Part 2 · Database schema & migrations

This Part writes the schema as **SQLAlchemy models** and lets **Alembic** generate the migration from them, the way TypeORM's CLI did in NestJS. SQLAlchemy is the most widely used Python ORM, and version 2 has a fully typed, async-capable API.

### Step 2.1 · SQLAlchemy, a naming convention and column types

**Goal:** the declarative base every model inherits from, with Postgres-style constraint names and a few reusable column definitions.

**Files:** `app/db/__init__.py`, `app/db/base.py`

```bash
uv add --bounds exact "sqlalchemy[asyncio]==2.1.8" asyncpg==0.32.0
mkdir app/db && touch app/db/__init__.py
```

- **SQLAlchemy** is two layers: **Core** (a typed SQL builder: `select(...)`, `update(...)`, like Drizzle) and the **ORM** on top (classes mapped to tables, a session that tracks changes, like TypeORM). We'll use both. The `[asyncio]` extra adds its async API.
- **asyncpg** is the async Postgres driver (the role `pg` plays in Node). It's among the fastest Postgres drivers in any language.

**`app/db/base.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Any
from typing import ClassVar
from uuid import UUID
from uuid import uuid7

from sqlalchemy import DateTime
from sqlalchemy import MetaData
from sqlalchemy import Text
from sqlalchemy import func
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.orm import mapped_column

# Postgres's own names: users_pkey, users_email_key, tasks_column_id_fkey, users_email_check.
NAMING_CONVENTION = {
    "pk": "%(table_name)s_pkey",
    "uq": "%(table_name)s_%(column_0_N_name)s_key",
    "fk": "%(table_name)s_%(column_0_N_name)s_fkey",
    "ck": "%(table_name)s_%(constraint_name)s_check",
    "ix": "%(table_name)s_%(column_0_N_name)s_idx",
}

class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    # Python type → column type, for every `Mapped[...]` that doesn't name one itself.
    type_annotation_map: ClassVar = {str: Text(), datetime: DateTime(timezone=True)}
    # INSERT and UPDATE use RETURNING to read back what the database filled in (now(), defaults).
    __mapper_args__: Any = {"eager_defaults": True}  # noqa: RUF012 (SQLAlchemy reads it)

# Reusable column definitions: `id: Mapped[UuidPk]` reads like a type, and is one.
UuidPk = Annotated[UUID, mapped_column(primary_key=True, default=uuid7)]
CreatedAt = Annotated[datetime, mapped_column(server_default=func.now())]
UpdatedAt = Annotated[datetime, mapped_column(server_default=func.now(), onupdate=func.now())]
```

**What's new (TS → SQLAlchemy)**
- **`class Base(DeclarativeBase)`**: every model will subclass `Base`. Inheritance is `class Child(Parent):`, `extends` in TS. `Base.metadata` collects every table the models define; Alembic reads it in Step 2.4.
- **The naming convention** gives constraints the names Postgres itself would choose: `users_pkey`, `users_email_key`, `tasks_column_id_fkey`, `users_email_check`. Without it, SQLAlchemy leaves some unnamed and Postgres invents names you can't predict in a migration. `%(table_name)s` is Python's old-style string formatting; SQLAlchemy fills the placeholders. (NestJS needed a whole naming-strategy class for the same result.)
- **`type_annotation_map`**: when a model says `name: Mapped[str]`, SQLAlchemy needs a column type. We map `str` to `TEXT` (Postgres's natural string type; the default would be `VARCHAR`) and `datetime` to `TIMESTAMP WITH TIME ZONE`. `ClassVar` tells mypy it's a class-level setting, not a field.
- **`eager_defaults`**: after an `INSERT` or `UPDATE`, SQLAlchemy uses Postgres's `RETURNING` to read back what the database filled in (`now()`, defaults). Without it, those attributes would need another query later, and in async code an implicit query is an error (you'll see why in Step 2.2).
- **`Annotated[UUID, mapped_column(...)]` as a reusable column.** `id: Mapped[UuidPk]` in a model means "UUID primary key". **`default=uuid7`**: Python 3.14's standard library generates **UUIDv7** (time-ordered) ids, in the app, before the `INSERT`. The README explains why ids are v7 and generated by the application.
- `server_default=func.now()` is `DEFAULT now()` in the table: the *database* fills `created_at`. `onupdate=func.now()` makes SQLAlchemy set `updated_at = now()` in every `UPDATE` it writes, the application-maintained `updated_at` the README asks for.
- **`# noqa: RUF012`** silences one lint rule on one line, with the reason. Ruff wants mutable class attributes marked `ClassVar`, but SQLAlchemy's own base class declares `__mapper_args__` as a plain attribute and mypy would object to the change.

**✅ Checkpoint**

```bash
uv run python -c "from app.db.base import Base; print(Base.metadata.naming_convention['uq'])"
```

Expected: `%(table_name)s_%(column_0_N_name)s_key`. (`uv run python -c "..."` runs one line of Python inside the project, handy for quick checks.)

**Commit:** `feat: sqlalchemy declarative base with postgres naming convention`

### Step 2.2 · Roles and the first models

**Goal:** the role names, and the user, workspace, membership and invitation tables.

**Files:** `app/access/__init__.py`, `app/access/roles.py`, `app/models/user.py`, `app/models/workspace.py`

```bash
mkdir app/access app/models && touch app/access/__init__.py
```

**`app/access/roles.py`** · new file

```python
from typing import Literal

type Role = Literal["owner", "admin", "member", "viewer"]
type InvitableRole = Literal["admin", "member", "viewer"]

_RANK: dict[Role, int] = {"owner": 3, "admin": 2, "member": 1, "viewer": 0}

def at_least(role: Role, minimum: Role) -> bool:
    return _RANK[role] >= _RANK[minimum]
```

**What's new**
- **`type Role = Literal[...]`** is a type alias with Python 3.12's `type` statement, the exact twin of TS's `type Role = 'owner' | ...`. `dict[Role, int]` is `Record<Role, number>`.
- **A leading underscore** (`_RANK`) means "private to this module". Python has no `export`: everything is importable, and the underscore is the convention that says "don't".
- `at_least` compares ranks; Part 5 uses it for every permission check.

**`app/models/user.py`** · new file

```python
from sqlalchemy import CheckConstraint
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk

class User(Base):
    __tablename__ = "users"
    __table_args__ = (CheckConstraint("email = lower(email)", name="email"),)

    id: Mapped[UuidPk]
    email: Mapped[str] = mapped_column(unique=True)
    # Deferred: ordinary queries never read the hash. Touching it without undefer() raises.
    password_hash: Mapped[str] = mapped_column(deferred=True, deferred_raiseload=True)
    display_name: Mapped[str]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]
```

**What's new (TS → SQLAlchemy models)**
- **`__tablename__`** names the table, and **`__table_args__`** holds table-level constraints and indexes, as a **tuple**: `(x,)` with the trailing comma is a one-element tuple (`(x)` would just be `x` in brackets; [gotcha](../../docs/gotchas.md#one-element-tuples-and-stray-trailing-commas)).
- **`email: Mapped[str] = mapped_column(unique=True)`**: `Mapped[str]` says "a column holding a `str`, not nullable"; `mapped_column(...)` adds options. A field with no `mapped_column` at all (`display_name: Mapped[str]`) is a plain `TEXT NOT NULL` column. **Nullability comes from the type**: `Mapped[str | None]` would allow `NULL`. Compare TypeORM's `@Column('text', { nullable: true })`.
- **Column names are the attribute names.** Python already uses `snake_case`, the same as SQL, so there's no naming strategy to configure.
- **`deferred=True, deferred_raiseload=True`** on the password hash: ordinary queries never load it, and code that touches it without asking (`undefer(...)`, Part 4) gets an error instead of a silent extra query. TypeORM's `select: false`, but enforced.
- `CheckConstraint("...", name="email")` becomes `users_email_check` through the naming convention.

**`app/models/workspace.py`** · new file

```python
from datetime import datetime
from uuid import UUID

from sqlalchemy import CheckConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy import func
from sqlalchemy import text
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.access.roles import InvitableRole
from app.access.roles import Role
from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk
from app.models.user import User

class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[UuidPk]
    name: Mapped[str]
    slug: Mapped[str] = mapped_column(unique=True)
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

class WorkspaceMember(Base):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id"),
        CheckConstraint("role IN ('owner', 'admin', 'member', 'viewer')", name="role"),
        Index("workspace_members_user_idx", "user_id", "workspace_id"),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    # An explicit Text: a Literal annotation alone would become a Postgres ENUM type.
    role: Mapped[Role] = mapped_column(Text)
    joined_at: Mapped[datetime] = mapped_column(server_default=func.now())

    # lazy="raise": async code can't load a relationship behind your back; ask for it in the query.
    user: Mapped[User] = relationship(lazy="raise")
    workspace: Mapped[Workspace] = relationship(lazy="raise")

```

**What's new**
- **`ForeignKey("users.id", ondelete="CASCADE")`** points at `table.column`. `UniqueConstraint("workspace_id", "user_id")` and `Index(...)` go in `__table_args__`.
- **`role: Mapped[Role] = mapped_column(Text)`**: the explicit `Text` matters. Given a `Literal` type and nothing else, SQLAlchemy would create a native Postgres `ENUM` type, and the README chose `text` + `CHECK` instead.
- **`relationship(lazy="raise")`** declares the object you reach through the foreign key: `member.user` is a `User`. In TypeORM, loading a relationship you didn't join was `undefined`. In SQLAlchemy's synchronous API, touching an unloaded relationship *silently runs a query* (lazy loading: the classic N+1 problem). In **async** code that implicit query can't run at all, because it would need an `await` that isn't there, so it fails with a confusing `MissingGreenlet` error ([gotcha](../../docs/gotchas.md#lazy-loading-raises-missinggreenlet-in-async-sqlalchemy)). `lazy="raise"` turns it into a clear error that names the relationship, and you load relationships explicitly in each query (Part 5).
- `Mapped[Workspace]` can refer to the `Workspace` class above it; a string `"Workspace"` would also work for classes defined later or in another file.

**`app/models/workspace.py`** · continue

```python

class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email"),
        CheckConstraint("role IN ('admin', 'member', 'viewer')", name="role"),
        Index(
            "invitations_pending_email_uq",
            "workspace_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL"),
        ),
        Index(
            "invitations_workspace_idx",
            "workspace_id",
            "id",
            postgresql_where=text("accepted_at IS NULL"),
        ),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    email: Mapped[str]
    role: Mapped[InvitableRole] = mapped_column(Text)
    token_hash: Mapped[str] = mapped_column(unique=True)
    invited_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime]
    accepted_at: Mapped[datetime | None]
    created_at: Mapped[CreatedAt]

    inviter: Mapped[User] = relationship(lazy="raise")
    workspace: Mapped[Workspace] = relationship(lazy="raise")
```

**What's new**
- **A partial unique index:** `Index(..., unique=True, postgresql_where=text("accepted_at IS NULL"))` is `CREATE UNIQUE INDEX ... WHERE accepted_at IS NULL`: one *pending* invitation per (workspace, email), while accepted ones stay as history. `text("...")` passes raw SQL where SQLAlchemy expects an expression.
- `Mapped[datetime | None]` is a nullable `timestamptz` (`X | None` is TS's `X | null`; `None` is Python's `null`).

**✅ Checkpoint**

```bash
uv run python -c "
from sqlalchemy.schema import CreateTable
from sqlalchemy.dialects import postgresql
from app.models.workspace import WorkspaceMember
print(CreateTable(WorkspaceMember.__table__).compile(dialect=postgresql.dialect()))"
```

Expected (SQLAlchemy prints the DDL it would run):

```text
CREATE TABLE workspace_members (
	id UUID NOT NULL, 
	workspace_id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	role TEXT NOT NULL, 
	joined_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT workspace_members_pkey PRIMARY KEY (id), 
	CONSTRAINT workspace_members_workspace_id_user_id_key UNIQUE (workspace_id, user_id), 
	CONSTRAINT workspace_members_role_check CHECK (role IN ('owner', 'admin', 'member', 'viewer')), 
	CONSTRAINT workspace_members_workspace_id_fkey FOREIGN KEY(workspace_id) REFERENCES workspaces (id) ON DELETE CASCADE, 
	CONSTRAINT workspace_members_user_id_fkey FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
)
```

**Commit:** `feat: user, workspace, member and invitation models`

### Step 2.3 · The remaining models

**Goal:** projects, board columns, tasks, comments, attachments and the activity log, and one module that imports them all.

**Files:** `app/models/project.py`, `app/models/task.py`, `app/models/activity.py`, `app/models/__init__.py`

**`app/models/project.py`** · new file

```python
from uuid import UUID

from sqlalchemy import CheckConstraint
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk

class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        UniqueConstraint("workspace_id", "key"),
        CheckConstraint("key ~ '^[A-Z][A-Z0-9]{1,9}$'", name="key"),
        Index("projects_workspace_idx", "workspace_id", "id"),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    name: Mapped[str]
    key: Mapped[str]
    description: Mapped[str | None]
    next_task_number: Mapped[int] = mapped_column(server_default="1")
    created_by: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

class BoardColumn(Base):
    __tablename__ = "board_columns"
    __table_args__ = (
        UniqueConstraint("project_id", "position"),
        CheckConstraint("wip_limit BETWEEN 1 AND 999", name="wip_limit"),
    )

    id: Mapped[UuidPk]
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str]
    # Byte order, not the locale's: fractional keys must sort "Zz" < "a0".
    position: Mapped[str] = mapped_column(Text(collation="C"))
    wip_limit: Mapped[int | None]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    project: Mapped[Project] = relationship(lazy="raise")
```

**What's new**
- **`Text(collation="C")`** is `text COLLATE "C"`: fractional position keys must sort by **byte order**, and the default `en_US` collation doesn't (Part 6 explains why).
- `server_default="1"` is `DEFAULT '1'` for the per-project task counter (Part 7).

**`app/models/task.py`** · new file

```python
from datetime import datetime
from typing import Literal
from uuid import UUID

from sqlalchemy import BigInteger
from sqlalchemy import CheckConstraint
from sqlalchemy import Computed
from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import Text
from sqlalchemy import UniqueConstraint
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UpdatedAt
from app.db.base import UuidPk
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.user import User

type Priority = Literal["low", "medium", "high", "urgent"]
type AttachmentStatus = Literal["pending", "ready"]

SEARCH_VECTOR = (
    "setweight(to_tsvector('english', title), 'A') || "
    "setweight(to_tsvector('english', coalesce(description, '')), 'B')"
)

class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("project_id", "number"),
        UniqueConstraint("column_id", "position"),
        CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name="priority"),
        Index("tasks_project_idx", "project_id", "id"),
        Index("tasks_assignee_idx", "assignee_id", "id"),
        Index("tasks_search_idx", "search_vector", postgresql_using="gin"),
        Index(
            "tasks_due_reminder_idx",
            "due_at",
            postgresql_where=text("reminder_sent_at IS NULL AND assignee_id IS NOT NULL"),
        ),
    )

    id: Mapped[UuidPk]
    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    # No ON DELETE action: Postgres refuses to delete a column that still has tasks.
    column_id: Mapped[UUID] = mapped_column(ForeignKey("board_columns.id"))
    number: Mapped[int]
    title: Mapped[str]
    description: Mapped[str | None]
    priority: Mapped[Priority] = mapped_column(Text, server_default="medium")
    assignee_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reporter_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    due_at: Mapped[datetime | None]
```

**What's new**
- **`search_vector`** is a **generated column**: `Computed(SEARCH_VECTOR, persisted=True)` is `GENERATED ALWAYS AS (...) STORED`, so Postgres recomputes the full-text vector on every write, and `TSVECTOR` is the Postgres type from `sqlalchemy.dialects.postgresql`. Deferred with raiseload, because nothing in Python ever reads it. Part 8 searches it through a **GIN index** (`postgresql_using="gin"`).
- **Two foreign keys to `users`** (`assignee_id`, `reporter_id`): each relationship says which column it follows with `foreign_keys=[...]`, or SQLAlchemy couldn't tell them apart.
- The string constant is split over three lines; adjacent string literals inside brackets are joined into one, like `'a' + 'b'` without the `+`.
- `type Priority = Literal[...]` lives next to the model that uses it; the schemas import it (Part 6).

**`app/models/task.py`** · continue

```python
    reminder_sent_at: Mapped[datetime | None]
    position: Mapped[str] = mapped_column(Text(collation="C"))
    # Postgres computes it on every write; the ORM never selects or sets it.
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR, Computed(SEARCH_VECTOR, persisted=True), deferred=True, deferred_raiseload=True
    )
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    project: Mapped[Project] = relationship(lazy="raise")
    column: Mapped[BoardColumn] = relationship(lazy="raise")
    assignee: Mapped[User | None] = relationship(foreign_keys=[assignee_id], lazy="raise")
    reporter: Mapped[User] = relationship(foreign_keys=[reporter_id], lazy="raise")

class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("comments_task_idx", "task_id", "id"),)

    id: Mapped[UuidPk]
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    author_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str]
    created_at: Mapped[CreatedAt]
    updated_at: Mapped[UpdatedAt]

    task: Mapped[Task] = relationship(lazy="raise")
    author: Mapped[User] = relationship(lazy="raise")

class Attachment(Base):
    __tablename__ = "attachments"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="size_bytes"),
        CheckConstraint("status IN ('pending', 'ready')", name="status"),
        Index("attachments_task_idx", "task_id", "id", postgresql_where=text("status = 'ready'")),
        Index("attachments_pending_idx", "created_at", postgresql_where=text("status = 'pending'")),
    )

    id: Mapped[UuidPk]
    task_id: Mapped[UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"))
    uploader_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    file_name: Mapped[str]
    content_type: Mapped[str]
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    storage_key: Mapped[str] = mapped_column(unique=True)
    status: Mapped[AttachmentStatus] = mapped_column(Text, server_default="pending")
    created_at: Mapped[CreatedAt]

    task: Mapped[Task] = relationship(lazy="raise")
    uploader: Mapped[User] = relationship(lazy="raise")
```

**What's new**
- `BigInteger` for `size_bytes` (`bigint`): files can exceed 2 GiB in principle. Python's `int` has no size limit, so unlike node-postgres, nothing comes back as a string.
- Two partial indexes on `attachments`: ready attachments per task (the list), pending ones by age (the cleanup job, Part 11).

**`app/models/activity.py`** · new file

```python
from typing import Any
from uuid import UUID

from sqlalchemy import ForeignKey
from sqlalchemy import Index
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped
from sqlalchemy.orm import mapped_column
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.db.base import CreatedAt
from app.db.base import UuidPk
from app.models.user import User

class ActivityEvent(Base):
    """Append-only audit log. No FK to projects or tasks: history outlives what it describes."""

    __tablename__ = "activity_events"
    __table_args__ = (
        Index("activity_workspace_idx", "workspace_id", "id"),
        Index(
            "activity_project_idx",
            "project_id",
            "id",
            postgresql_where=text("project_id IS NOT NULL"),
        ),
        Index("activity_task_idx", "task_id", "id", postgresql_where=text("task_id IS NOT NULL")),
    )

    id: Mapped[UuidPk]
    workspace_id: Mapped[UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    project_id: Mapped[UUID | None]
    task_id: Mapped[UUID | None]
    actor_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str]
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'"))
    created_at: Mapped[CreatedAt]

    actor: Mapped[User] = relationship(lazy="raise")
```

**What's new**
- **`Mapped[dict[str, Any]]` with `JSONB`**: the `data` column holds any JSON object. `Any` is TS's `any`, deliberately limited to places that really hold arbitrary data.
- **No foreign keys to projects or tasks**, on purpose: the audit log must outlive what it describes (the README's design table explains it).
- The **class docstring** is the first statement in the class body.

**`app/models/__init__.py`** · new file

```python
"""Every model, imported once, so `Base.metadata` knows all tables (Alembic reads it)."""

from app.models.activity import ActivityEvent
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Attachment
from app.models.task import Comment
from app.models.task import Task
from app.models.user import User
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember

__all__ = [
    "ActivityEvent",
    "Attachment",
    "BoardColumn",
    "Comment",
    "Invitation",
    "Project",
    "Task",
    "User",
    "Workspace",
    "WorkspaceMember",
]
```

**What's new**
- **`__init__.py` with content** runs when the package is first imported, so `import app.models` imports every model module, and every table is registered on `Base.metadata`. Alembic needs that (next step).
- **`__all__`** lists the module's public names: it's what `from app.models import *` exports, and it tells linters these imports are intentional re-exports, like an `index.ts` barrel.

**✅ Checkpoint**

```bash
uv run python -c "import app.models; from app.db.base import Base; print(sorted(Base.metadata.tables))"
```

Expected:

```text
['activity_events', 'attachments', 'board_columns', 'comments', 'invitations', 'projects', 'tasks', 'users', 'workspace_members', 'workspaces']
```

**Commit:** `feat: project, column, task, comment, attachment and activity models`

### Step 2.4 · Alembic and the generated migration

**Goal:** a migration tool that compares the models with the database and writes the SQL changes as a Python file.

**Files:** `alembic.ini`, `migrations/env.py`, `migrations/script.py.mako`, `migrations/versions/0001_init.py`

```bash
uv add --bounds exact alembic==1.20.1
uv run alembic init -t async migrations
rm migrations/README
```

- **Alembic** is SQLAlchemy's migration tool, written by SQLAlchemy's author: `alembic revision --autogenerate` diffs the models against the live database and writes a migration, `alembic upgrade head` applies migrations, `alembic check` fails if the models have changes no migration captures. It's TypeORM's `migration:generate` / `migration:run` and drift check in one CLI.
- `alembic init -t async migrations` scaffolds the `migrations/` folder from the **async** template. The generated files are long and commented; **replace** the three below with these shorter versions.

**`alembic.ini`** · new file

```ini
# Alembic reads this file. The database URL isn't here: migrations/env.py takes it from Settings.
[alembic]
script_location = %(here)s/migrations
prepend_sys_path = .
path_separator = os
# 0001_init.py, not a random hex prefix (we pass --rev-id).
file_template = %%(rev)s_%%(slug)s

# Generated migrations get the same lint fixes and formatting as hand-written code.
[post_write_hooks]
hooks = ruff_format, ruff_fix
ruff_fix.type = module
ruff_fix.module = ruff
ruff_fix.options = check --fix REVISION_SCRIPT_FILENAME
ruff_format.type = module
ruff_format.module = ruff
ruff_format.options = format REVISION_SCRIPT_FILENAME

# Python logging for the alembic command: one line per migration applied.
[loggers]
keys = root,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

**What's new**
- An **INI file** (sections in brackets, `key = value`), the format Python's own `logging` and `configparser` read. **The database URL isn't here:** `env.py` takes it from `Settings`, so there's one source of configuration.
- `file_template = %%(rev)s_%%(slug)s` names files `0001_init.py` instead of the default random hex prefix (`%%` escapes `%` in INI files). We pass the revision id ourselves with `--rev-id`.
- **`[post_write_hooks]`** run ruff over every generated migration: format first (long lines become readable), then lint fixes (import sorting). Generated code then looks like hand-written code and passes `ruff check`.
- The `[loggers]`/`[handlers]`/`[formatters]` sections configure Python's standard `logging` for the `alembic` command, so it prints one line per migration it runs.

**`migrations/script.py.mako`** · new file

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision: str = ${repr(up_revision)}
down_revision: str | Sequence[str] | None = ${repr(down_revision)}
branch_labels: str | Sequence[str] | None = ${repr(branch_labels)}
depends_on: str | Sequence[str] | None = ${repr(depends_on)}

def upgrade() -> None:
    ${upgrades if upgrades else "pass"}

def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

**What's new**
- The template every new migration file starts from (`.mako` is a template language: `${message}` and `${upgrades}` are filled in by Alembic). Ours uses modern typing (`str | None` instead of `Optional[str]`) so generated files pass ruff's `UP` rules.

**`migrations/env.py`** · new file

```python
"""Alembic's entry point: connects with the app's settings and compares against the models."""

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import Connection
from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine

from app import models  # noqa: F401  (registers every table on Base.metadata)
from app.config import get_settings
from app.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

def run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()

async def main() -> None:
    # NullPool: a one-off command needs one connection, not a pool kept warm.
    engine = create_async_engine(get_settings().sqlalchemy_url, poolclass=pool.NullPool)
    async with engine.connect() as connection:
        # Alembic's API is synchronous; run_sync hands it a sync facade over the async connection.
        await connection.run_sync(run_migrations)
    await engine.dispose()

asyncio.run(main())
```

**What's new (TS → Python)**
- **`import asyncio`** and **`asyncio.run(main())`**: Python's event loop isn't always running, as it is in Node. A script that wants to `await` starts a loop explicitly with `asyncio.run(...)`, which runs the coroutine to completion and closes the loop. ([primer §12](../../docs/python-for-ts-devs.md#12-async--await))
- **`async with engine.connect() as connection:`** is an **async context manager**: it opens the connection, runs the block, and closes the connection when the block ends, even on an error. It's `try { ... } finally { await conn.close() }` built into the syntax. You'll write `async with` everywhere in this repo.
- **`connection.run_sync(run_migrations)`**: Alembic's API is synchronous. `run_sync` hands it a synchronous facade over the async connection, so the same Alembic code works with an async driver. Functions are values, as in JS: `run_migrations` is passed without calling it.
- `from app import models  # noqa: F401`: imported only for its side effect (registering the tables), so the "unused import" rule (`F401`) is silenced on that line.
- **`NullPool`**: a one-off command needs one connection, not a pool kept warm.

```bash
docker compose up -d
uv run alembic revision --autogenerate -m "init" --rev-id 0001
```

Expected (the tail of the output):

```text
INFO  [alembic.autogenerate.compare.tables] Detected added table 'comments'
INFO  [alembic.autogenerate.compare.constraints] Detected added index 'comments_task_idx' on '('task_id', 'id')'
Generating /…/taskflow-fastapi/migrations/versions/0001_init.py ...  done
Running post write hook 'ruff_format' ...
1 file reformatted
  done
Running post write hook 'ruff_fix' ...
All checks passed!
  done
```

The generated file, `migrations/versions/0001_init.py`, starts like this (your `Create Date` is today's; everything else should match the repo's file line for line):

**`migrations/versions/0001_init.py`** · excerpt

```python
"""init

Revision ID: 0001
Revises:
Create Date: 2026-11-14 12:28:39.150459

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

def upgrade() -> None:
    # ### commands auto generated by Alembic - please adjust! ###
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.Text(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("email = lower(email)", name=op.f("users_email_check")),
        sa.PrimaryKeyConstraint("id", name=op.f("users_pkey")),
        sa.UniqueConstraint("email", name=op.f("users_email_key")),
    )
```

**What's new**
- **A migration is a Python file with `upgrade()` and `downgrade()` functions** that call `op.create_table(...)`, `op.create_index(...)` and friends. You can read it like SQL: every column, type, default, `CHECK`, foreign key and index of the reference schema is there, with Postgres's own constraint names (`op.f(...)` marks a name as final, so the naming convention isn't applied twice).
- **No hand edits were needed** (NestJS's TypeORM migration needed three). If yours differs from the repo's beyond the header, compare the models first.
- `revision` / `down_revision` chain migrations: `0002` will say `down_revision = "0001"`, and Alembic keeps a one-row `alembic_version` table recording where each database is.

> **🧠 DSA & scalability · Why migrations are generated, then reviewed**
> - **Data structure:** two schema descriptions, the models in `Base.metadata` (in memory) and the database's catalog (`pg_catalog`, read through SQL), compared as trees of tables → columns, constraints, indexes.
> - **Algorithm:** `--autogenerate` reflects the database, walks both trees and emits an operation for every difference (added table, removed column, changed type…); `alembic check` runs the same comparison and fails if the list is non-empty.
> - **Complexity:** O(tables + columns + constraints) catalog reads, done once per command, never at app start-up.
> - **Why it scales:** the app never alters the schema at start-up (TypeORM's `synchronize`, Django's old `syncdb`), so ten instances starting at once can't race to migrate. One `migrate` job (Part 13) runs first; CI's drift check (Part 14) stops a model change from shipping without its migration.
> - **Alternatives rejected:** hand-written SQL migrations (no drift detection, easy to forget an index); `Base.metadata.create_all()` at start-up (no history, no way to change an existing table). Autogenerate isn't perfect (it doesn't compare `CHECK` constraints, and a renamed column looks like drop + add), so a migration is always read before it's committed.

**Commit:** `feat: alembic and the initial migration`

### Step 2.5 · Apply the migration and check for drift

**Goal:** the schema in the dev database, and proof that models and migrations agree.

**Files:** none

```bash
uv run alembic upgrade head
uv run alembic check
docker compose exec postgres psql -U taskflow -d taskflow -c '\dt'
```

Expected: `Running upgrade  -> 0001, init`, then `No new upgrade operations detected.`, then 11 tables: the ten from the models plus `alembic_version`.

```text
                List of tables
 Schema |       Name        | Type  |  Owner   
--------+-------------------+-------+----------
 public | activity_events   | table | taskflow
 public | alembic_version   | table | taskflow
 public | attachments       | table | taskflow
 public | board_columns     | table | taskflow
 public | comments          | table | taskflow
 public | invitations       | table | taskflow
 public | projects          | table | taskflow
 public | tasks             | table | taskflow
 public | users             | table | taskflow
 public | workspace_members | table | taskflow
 public | workspaces        | table | taskflow
(11 rows)
```

Look at one table the way Postgres sees it: `docker compose exec postgres psql -U taskflow -d taskflow -c '\d tasks'` shows `position text COLLATE "C"`, the generated `search_vector`, the GIN index and the partial `tasks_due_reminder_idx`.

**✅ Checkpoint**

```bash
uv run alembic check
```

Expected: `No new upgrade operations detected.` (the last line).

**Commit:** nothing new to commit in this step: the migration was committed with Step 2.4.

---
## Part 3 · HTTP foundations

This Part builds everything between the socket and your business logic: errors as RFC 9457 problems, validation with Pydantic, request IDs and logging, 404/405/413/415, the database and Redis connections, health checks, and the app itself. It's also where you meet **every core FastAPI idea**: ASGI and middleware, exception handlers, the **lifespan**, and **dependencies** (`Depends`). Take it slowly; the rest of the guide reuses all of it.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one exception class that maps to the contract's `application/problem+json` body.

**Files:** `app/core/__init__.py`, `app/core/problems.py`

```bash
mkdir app/core && touch app/core/__init__.py
```

**`app/core/problems.py`** · new file

```python
from typing import Literal
from typing import TypedDict

PROBLEM_TYPE_BASE = "https://taskflow.example/problems/"

type ProblemSlug = Literal[
    "bad-request",
    "unauthorized",
    "forbidden",
    "not-found",
    "method-not-allowed",
    "conflict",
    "payload-too-large",
    "unsupported-media-type",
    "validation-error",
    "rate-limited",
    "internal",
]

# slug → (HTTP status, title)
_PROBLEMS: dict[ProblemSlug, tuple[int, str]] = {
    "bad-request": (400, "Bad request"),
    "unauthorized": (401, "Unauthorized"),
    "forbidden": (403, "Forbidden"),
    "not-found": (404, "Not found"),
    "method-not-allowed": (405, "Method not allowed"),
    "conflict": (409, "Conflict"),
    "payload-too-large": (413, "Payload too large"),
    "unsupported-media-type": (415, "Unsupported media type"),
    "validation-error": (422, "Validation failed"),
    "rate-limited": (429, "Too many requests"),
    "internal": (500, "Internal server error"),
}

class FieldError(TypedDict):
    field: str
    message: str

class ProblemError(Exception):
    """An error that maps 1:1 to an RFC 9457 problem response."""

    def __init__(
        self,
        slug: ProblemSlug,
        detail: str | None = None,
        errors: list[FieldError] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.slug = slug
        self.status, self.title = _PROBLEMS[slug]
        self.detail = detail or self.title
        self.errors = errors
        self.headers = headers or {}
        super().__init__(self.detail)

def not_found(what: str = "Resource") -> ProblemError:
    return ProblemError("not-found", f"{what} not found")

def forbidden(detail: str = "Your role does not allow this action") -> ProblemError:
    return ProblemError("forbidden", detail)

def conflict(detail: str) -> ProblemError:
    return ProblemError("conflict", detail)

def unauthorized(detail: str = "Authentication required") -> ProblemError:
    return ProblemError("unauthorized", detail)

def invalid(field: str, message: str) -> ProblemError:
    errors = [FieldError(field=field, message=message)]
    return ProblemError("validation-error", "The request contains invalid fields", errors)
```

**What's new (TS → Python)**
- **`class ProblemError(Exception)`**: a custom error is a subclass of `Exception` (Python's `Error`). Raising it is `raise ProblemError(...)` (`throw new ...`, without `new`: calling a class creates an instance).
- **`def __init__(self, ...)`** is the constructor. Python has no parameter properties (`constructor(readonly slug: ...)`): you assign `self.slug = slug` yourself. `super().__init__(self.detail)` calls the parent constructor, like `super(detail)`.
- **Default and keyword arguments.** `detail: str | None = None` is an optional parameter. A caller can name any argument (`ProblemError("conflict", detail="…")`), so long parameter lists stay readable without an options object ([primer §6](../../docs/python-for-ts-devs.md#6-functions)).
- **Tuples and unpacking:** `_PROBLEMS[slug]` is a `tuple[int, str]`, a fixed-size pair like TS's `[number, string]`, and `self.status, self.title = ...` unpacks it into two attributes in one line.
- **`detail or self.title`**: `or` returns the first truthy operand, like JS's `||`. `headers or {}` gives each error its own empty dict.
- **`TypedDict`** describes a dict with known keys: `FieldError` is the TS interface `{ field: string; message: string }`, and `FieldError(field=..., message=...)` builds a plain dict that mypy checks.
- **f-strings:** `f"{what} not found"` is a template literal (`` `${what} not found` ``).
- The small factories (`not_found("Task")`, `conflict(...)`) keep call sites short, as in every TaskFlow backend.

**✅ Checkpoint**

```bash
uv run python -c "from app.core.problems import not_found; e = not_found('Task'); print(e.status, e.title, e.detail)"
```

Expected: `404 Not found Task not found`.

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Validation: camelCase models, field paths and custom types

**Goal:** the base class every request and response model shares, the validation rules the contract needs, and a function that turns Pydantic's errors into the contract's `{ field, message }` list.

**Files:** `app/core/schemas.py`, `app/core/validation.py`, `tests/unit/__init__.py`, `tests/unit/test_validation.py`

**`app/core/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Any
from typing import Self

from pydantic import AwareDatetime
from pydantic import BaseModel
from pydantic import BeforeValidator
from pydantic import ConfigDict
from pydantic import StringConstraints
from pydantic import model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

class CamelModel(BaseModel):
    """snake_case in Python, camelCase on the wire: `display_name` ⇄ `"displayName"`."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
    )

class PatchModel(CamelModel):
    """A PATCH body: every field optional, but at least one must be sent."""

    @model_validator(mode="after")
    def _not_empty(self) -> Self:
        # model_fields_set holds the fields the client actually sent (merge-patch semantics).
        if not self.model_fields_set:
            raise PydanticCustomError("empty_patch", "at least one field is required")
        return self

```

**What's new (TS → Pydantic)**
- **`class CamelModel(BaseModel)`**: a **Pydantic model** is a class whose annotated fields are validated whenever an instance is created, from a dict, from JSON or from keyword arguments. FastAPI uses models for request bodies, query strings and responses. Every model in this repo inherits from `CamelModel`.
- **camelCase on the wire, snake_case in Python.** `alias_generator=to_camel` gives every field an **alias**: `display_name` is read from and written to JSON as `displayName`. `validate_by_alias` accepts the camelCase name in input (what clients send), `validate_by_name` also accepts `display_name` (handy in Python code and tests). Output uses the alias because FastAPI serialises responses `by_alias` (Part 4 shows one). This is how a Python API meets the contract's casing rule without either side changing style.
- **`PatchModel`** adds a **model validator**: a method that runs after the fields are validated (`mode="after"`). **`model_fields_set`** is the set of fields the client *actually sent*, which is how a PATCH tells "omitted" from "set to null" (JSON merge-patch). `{}` gets a 422 on the whole body.
- **Decorators** (`@model_validator(...)`) wrap a function or method, as in TS; here Pydantic's decorator registers the method as a validator ([primer §13](../../docs/python-for-ts-devs.md#13-decorators)). `-> Self` means "returns an instance of whatever class this is".
- **`PydanticCustomError("empty_patch", "…")`** reports a validation error with our own type and message. A plain `ValueError` would also work, but Pydantic would prefix the message with "Value error, ".

**`app/core/schemas.py`** · continue

```python

# Trimmed before its length is checked, so "   " counts as empty: Annotated[Trimmed, Field(...)].
Trimmed = Annotated[str, StringConstraints(strip_whitespace=True)]

def _number_only(value: Any) -> Any:
    if isinstance(value, str | bool):
        raise PydanticCustomError("int_type", "Input should be a valid integer")
    return value

# A JSON number with no fractional part: 5 and 5.0 (JSON Schema calls both integers), not "5"
# or true, which lax mode would convert. Query strings are text, so they stay lax.
JsonInt = Annotated[int, BeforeValidator(_number_only)]

def _string_only(value: Any) -> Any:
    # Lax mode would read 1700000000 as a Unix time; the contract says ISO-8601 text.
    if not isinstance(value, str | datetime):
        raise PydanticCustomError("datetime_type", "must be an ISO-8601 date-time string")
    return value

# A full timestamp with an offset ("2026-10-25T12:00:00Z"); a bare date or a naive one is refused.
Timestamp = Annotated[AwareDatetime, BeforeValidator(_string_only)]

def _reject_null(value: Any) -> Any:
    if value is None:
        raise PydanticCustomError("not_null", "may be omitted, but not null")
    return value

# For PATCH fields that can be left out but not cleared: Annotated[str | None, NotNull] = None.
NotNull = BeforeValidator(_reject_null)
```

**What's new**
- **`Trimmed`**: `StringConstraints(strip_whitespace=True)` trims the value **before** length rules run. Combined later as `Annotated[Trimmed, Field(min_length=1, max_length=80)]`, `"   "` becomes `""` and fails `min_length`, as the contract's "trimmed before validation" requires. Pydantic flattens nested `Annotated` types, so the metadata stacks.
- **`BeforeValidator(fn)`** runs `fn` on the raw input before Pydantic's own conversion. We use it to *remove* conversions. Pydantic's default **lax mode** converts compatible input: `"5"` → `5` for an `int`, `1700000000` → a date for a `datetime`. That's right for query strings, which are always text, but the contract says a JSON body's numbers are numbers and its dates are strings:
  - **`JsonInt`** refuses strings and booleans, then lets lax mode turn `5.0` into `5` (JSON Schema calls `5.0` an integer, and the contract fuzzer sends it).
  - **`Timestamp`** demands a string, then **`AwareDatetime`** demands an offset: `"2026-10-25T12:00:00Z"` passes, `"2026-10-25T12:00:00"` (no zone) doesn't. Naive datetimes are a classic Python bug source ([gotcha](../../docs/gotchas.md#naive-vs-aware-datetimes)).
  - **`NotNull`** is for PATCH fields that may be **left out but not cleared**: the field is declared `X | None = None` so it can be omitted, and the validator rejects an explicit `null`. The default (`None`) isn't validated, so leaving the field out still works.
- **`isinstance(value, str | bool)`** is a runtime type check (TS's `typeof` and `instanceof` in one). It accepts a union of classes.
- **`Any`** is TS's `any`: these helpers really do accept anything.

```bash
mkdir -p tests/unit && touch tests/unit/__init__.py
```

**`app/core/validation.py`** · new file

```python
from collections.abc import Sequence
from typing import Any

from app.core.problems import FieldError

def field_errors(errors: Sequence[Any]) -> list[FieldError]:
    """Pydantic errors → `{field, message}`, one per field. `loc` is already in wire (alias) form.

    ("body", "displayName") → "displayName"; ("query", "limit") → "query.limit";
    ("body",) → "body" (the body as a whole: not an object, or an empty PATCH).
    """
    out: list[FieldError] = []
    seen: set[str] = set()
    for error in errors:
        source, *path = error["loc"]
        parts = [str(p) for p in path]
        if source != "body":
            parts.insert(0, source)
        field = ".".join(parts) or "body"
        if field not in seen:
            seen.add(field)
            out.append(FieldError(field=field, message=error["msg"]))
    return out
```

**`tests/unit/test_validation.py`** · new file

```python
from typing import Any

from app.core.validation import field_errors

def error(*loc: str | int, msg: str = "is wrong") -> dict[str, Any]:
    return {"loc": loc, "msg": msg, "type": "x"}

def test_body_fields_use_their_wire_names() -> None:
    assert field_errors([error("body", "dueAt", msg="must be a date")]) == [
        {"field": "dueAt", "message": "must be a date"}
    ]

def test_nested_paths_are_dotted_and_each_field_is_reported_once() -> None:
    errors = [error("body", "payload", "projectId"), error("body", "payload", "projectId")]
    assert [e["field"] for e in field_errors(errors)] == ["payload.projectId"]

def test_query_and_path_parameters_are_prefixed() -> None:
    errors = [error("query", "limit"), error("path", "workspaceId"), error("body")]
    assert [e["field"] for e in field_errors(errors)] == ["query.limit", "path.workspaceId", "body"]
```

**What's new**
- **Pydantic's error format.** A failed validation lists errors as dicts: `{"type": "string_too_short", "loc": ("body", "displayName"), "msg": "String should have at least 1 character", ...}`. FastAPI prefixes `loc` with where the value came from (`body`, `query`, `path`), and **the rest of `loc` already uses the aliases**, so the wire names come for free (Fastify needed a JSON-pointer conversion, NestJS a tree walk).
- **`source, *path = error["loc"]`** unpacks the first item and collects the rest, like `const [source, ...path] = loc`. `[str(p) for p in path]` is a **list comprehension** (`path.map(String)`), and `".".join(parts)` is `parts.join('.')` written from the separator's side.
- `seen` is a **set**, so each field appears once, even if two rules failed.
- **`def error(*loc: str | int, ...)`** in the test takes any number of positional arguments into a tuple, like a TS rest parameter (`...loc`).

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `3 passed`.

**Commit:** `feat: camelcase models, validation types and field paths`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an id that appears in the response, in every log line and in every problem body; every response gets the security headers; non-JSON bodies get 415 and oversized ones 413; and one JSON log line is written per request.

**Files:** `app/core/logging.py`, `app/core/errors.py`, `app/core/middleware.py`

```bash
uv add --bounds exact fastapi==0.162.7 "uvicorn[standard]==0.54.0" structlog==26.1.0
```

- **FastAPI** is the web framework; it brings **Starlette** (the HTTP toolkit underneath: requests, responses, routing, middleware, WebSockets) and Pydantic. **uvicorn** is the server that runs it, the role Node's `http` module plays for Express; `[standard]` adds uvloop (a faster event loop, written in C on libuv, Node's own event loop library) and httptools.
- **ASGI** is the interface between them: an app is any async callable `app(scope, receive, send)`. `scope` describes the request (method, path, headers), `receive()` reads body chunks, `send()` writes the response. Every framework layer, including your middleware, is an ASGI app that wraps the next one. It's Express's `(req, res, next)`, at a lower level.
- **structlog** writes structured (JSON) logs and keeps per-request context, the role pino played in the Node repos.

**`app/core/logging.py`** · new file

```python
import logging

import structlog

# Added to every line, from structlog and from the standard library (uvicorn, celery) alike.
_SHARED: list[structlog.typing.Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True, key="timestamp"),
]

def configure_logging(level: str) -> None:
    """One JSON object per line: timestamp, level, message, plus requestId/userId when bound."""
    structlog.configure(
        processors=[*_SHARED, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=_SHARED,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.EventRenamer("message"),
            # Tracebacks as JSON, without local variables: they can hold passwords and tokens.
            structlog.processors.ExceptionRenderer(
                structlog.tracebacks.ExceptionDictTransformer(show_locals=False)
            ),
            structlog.processors.JSONRenderer(),
        ],
    )
    handler = logging.StreamHandler()
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())
    # Uvicorn installs its own handlers before it imports the app; send its lines through ours.
    for name in ("uvicorn", "uvicorn.error"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True
    # The request-context middleware writes one access line per request instead.
    logging.getLogger("uvicorn.access").disabled = True
```

**What's new**
- **Two logging systems, one output.** Python's standard library has `logging` (named loggers, levels, handlers), and every library uses it: uvicorn, SQLAlchemy, Celery. structlog adds structured key-value events on top. **`ProcessorFormatter`** makes both kinds end up as the same JSON line: `foreign_pre_chain` processes standard-library records (uvicorn's) the way structlog processes its own.
- **Processors** are a pipeline: each function receives the event dict and returns it changed. `merge_contextvars` adds whatever is bound to the current request (its id, later its user), `TimeStamper` adds `timestamp`, `EventRenamer("message")` renames structlog's `event` key to `message`, `JSONRenderer` turns the dict into one line.
- **No local variables in tracebacks.** structlog can include each stack frame's local variables in an exception's JSON. Here those locals would include passwords and tokens, so they're switched off.
- **`for name in ("uvicorn", "uvicorn.error"):`** loops over a tuple. uvicorn configures its own log handlers before importing the app, so we clear them and let its records flow to ours. Its access log is disabled: our middleware writes a better one.

**`app/core/errors.py`** · new file

```python
from typing import Any

```

**`app/core/errors.py`** · continue

```python
from fastapi.responses import JSONResponse
```

**`app/core/errors.py`** · continue

```python

from app.core.problems import PROBLEM_TYPE_BASE
from app.core.problems import ProblemError
```

**`app/core/errors.py`** · continue

```python

def problem_response(problem: ProblemError, instance: str, request_id: str | None) -> JSONResponse:
    body: dict[str, Any] = {
        "type": PROBLEM_TYPE_BASE + problem.slug,
        "title": problem.title,
        "status": problem.status,
        "detail": problem.detail,
        "instance": instance,
        "requestId": request_id,
    }
    if problem.errors is not None:
        body["errors"] = problem.errors
    return JSONResponse(
        body,
        status_code=problem.status,
        headers=problem.headers,
        media_type="application/problem+json",
    )
```

**What's new**
- `problem_response` builds the RFC 9457 body. **`JSONResponse(body, status_code=..., media_type=...)`** is Starlette's response class: it serialises the dict with `json.dumps` and sets the content type, the equivalent of `res.status(...).type(...).json(...)`. Two places need it: the middleware below (for errors raised before any route runs) and the exception handlers (next step).
- `body: dict[str, Any] = {...}` annotates a **local variable**. mypy would infer a narrower type from the literal, which wouldn't allow adding `errors` later.

**`app/core/middleware.py`** · new file

```python
import re
import time
from uuid import uuid7

import structlog
from starlette.datastructures import Headers
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp
from starlette.types import Message
from starlette.types import Receive
from starlette.types import Scope
from starlette.types import Send

from app.core.errors import problem_response
from app.core.problems import ProblemError

log = structlog.get_logger("http")

REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
MAX_BODY_BYTES = 1024 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
}

class RequestContextMiddleware:
    """Request id, security headers, one access-log line, and a 500 problem for anything uncaught.

    Plain ASGI: a callable taking (scope, receive, send). It wraps `send` to edit the response
    headers on their way out, the same trick Express middleware plays with `res.set()`.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if REQUEST_ID.fullmatch(incoming) else str(uuid7())
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(requestId=request_id)

        status = 500
        started = time.perf_counter()

        async def send_with_headers(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-Id"] = request_id
                headers.update(SECURITY_HEADERS)
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            log.exception("unhandled error")
            problem = ProblemError("internal", "An unexpected error occurred")
            response = problem_response(problem, scope["path"], request_id)
            await response(scope, receive, send_with_headers)
        finally:
            if not scope["path"].startswith("/health"):
                log.info(
                    "request completed",
                    userId=scope["state"].get("user_id"),
                    method=scope["method"],
                    path=scope["path"],
                    status=status,
                    durationMs=round((time.perf_counter() - started) * 1000, 1),
                )

```

**What's new (TS → ASGI middleware)**
- **A middleware is a class with `__init__(self, app)` and `async __call__(self, scope, receive, send)`.** `__call__` makes instances callable like functions (Python's "dunder" methods, double-underscore names, plug objects into the language: `__init__` for construction, `__call__` for calling). Starlette creates it once with the next app in the chain, and calls it for every connection.
- **Only HTTP:** WebSocket connections (Part 10) pass straight through. `scope["type"]` says which.
- **`Headers(scope=scope)`** reads request headers (case-insensitive). **`scope.setdefault("state", {})["request_id"] = …`** stores the id where Starlette's `request.state` will find it later: `request.state` is a view over `scope["state"]`.
- **Wrapping `send`.** The inner function `send_with_headers` intercepts the `http.response.start` message (status + headers), adds our headers and passes it on. It's how `res.set(...)` works in Express, made explicit. **`nonlocal status`** lets the inner function assign to the outer function's variable; without it, assigning would create a new local (JS closures don't need this; [primer §6](../../docs/python-for-ts-devs.md#6-functions)).
- **`structlog.contextvars`**: `bind_contextvars(requestId=…)` attaches the id to the current **context**, and every log line written while handling this request, anywhere in the code, carries it. A context variable is per-task, so concurrent requests don't mix (Node's `AsyncLocalStorage`).
- **`try / except Exception / finally`**: anything no handler caught becomes a 500 problem (logged with its traceback by `log.exception`). The `finally` block always runs and writes the access line, skipping health checks.
- **`time.perf_counter()`** is a monotonic clock for durations (`performance.now()`).

**`app/core/middleware.py`** · continue

```python

class BodyGuardMiddleware:
    """This API reads JSON only: other bodies get 415, and bodies over 1 MiB get 413."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        length = int(headers.get("content-length") or 0)
        chunked = "transfer-encoding" in headers
        problem = None
        if length > MAX_BODY_BYTES:
            problem = ProblemError("payload-too-large", "Request bodies are limited to 1 MiB")
        elif (length > 0 or chunked) and not _is_json(headers.get("content-type", "")):
            problem = ProblemError(
                "unsupported-media-type", "Request body must be application/json"
            )
        if problem is not None:
            request_id = scope.get("state", {}).get("request_id")
            await problem_response(problem, scope["path"], request_id)(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            # A chunked body has no Content-Length to check up front: count as it arrives.
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY_BYTES:
                raise HTTPException(413)
            return message

        await self.app(scope, counting_receive, send)

def _is_json(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() == "application/json"
```

**What's new**
- **415 and 413 before routing.** FastAPI only parses a body when a route asks for one, and a `text/plain` body sent to a JSON route becomes a confusing 422 ("Input should be a valid dictionary"). This guard answers honestly, for every path: bodies must be `application/json`, and at most 1 MiB.
- **A chunked body has no `Content-Length`**, so `counting_receive` wraps `receive()` and counts bytes as they arrive. Raising Starlette's `HTTPException(413)` inside it stops the read, and the exception handler (next step) turns it into the problem body.
- `int(headers.get("content-length") or 0)`: `.get` returns `None` when the header is missing, and `None or 0` is `0`.
- `_is_json` drops parameters (`; charset=utf-8`) before comparing, like `req.is('application/json')`.

**✅ Checkpoint**

```bash
uv run python -c "import app.core.middleware; print('ok')"
uv run mypy .
```

Expected: `ok`, then `Success: no issues found in 25 source files`.

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · Exception handlers: 404, 405 and everything else

**Goal:** the one place where errors become problem responses, including Starlette's own 404 and 405, malformed JSON, validation errors and unique-constraint violations.

**Files:** `app/db/errors.py`, `app/core/errors.py`

**`app/db/errors.py`** · new file

```python
from sqlalchemy.exc import IntegrityError
```

**`app/db/errors.py`** · continue

```python

# Postgres SQLSTATE codes we turn into API errors.
UNIQUE_VIOLATION = "23505"
FOREIGN_KEY_VIOLATION = "23503"

def sqlstate(err: IntegrityError) -> str | None:
    """The Postgres error code behind an IntegrityError (asyncpg puts it on the original error)."""
    code = getattr(err.orig, "sqlstate", None)
    return code if isinstance(code, str) else None

def is_unique_violation(err: IntegrityError) -> bool:
    return sqlstate(err) == UNIQUE_VIOLATION

def is_foreign_key_violation(err: IntegrityError) -> bool:
    return sqlstate(err) == FOREIGN_KEY_VIOLATION
```

**What's new**
- **SQLSTATE codes:** Postgres reports every error with a five-character code; `23505` is a unique violation, `23503` a foreign-key violation. SQLAlchemy wraps the driver's error in `IntegrityError`, and the original asyncpg error is on **`err.orig`**, with the code as `sqlstate`.
- **`getattr(obj, "sqlstate", None)`** reads an attribute by name with a default, like `obj?.sqlstate ?? null`. The `isinstance` check narrows `Any` to `str` for mypy.
- Part 6 adds a retry helper to this file.

**`app/core/errors.py`** · add before `from fastapi.responses import JSONResponse`

```python
from fastapi import FastAPI
from fastapi import Request
from fastapi.exceptions import RequestValidationError
```

**`app/core/errors.py`** · add after `from fastapi.responses import JSONResponse`

```python
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException
from starlette.routing import Match
```

**`app/core/errors.py`** · add after `from app.core.problems import ProblemError`

```python
from app.core.problems import ProblemSlug
from app.core.validation import field_errors
from app.db.errors import is_unique_violation

_METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
# Statuses Starlette raises on its own, mapped to our problem slugs.
_BY_STATUS: dict[int, ProblemSlug] = {
    400: "bad-request",
    401: "unauthorized",
    403: "forbidden",
    404: "not-found",
    413: "payload-too-large",
    415: "unsupported-media-type",
}
```

**`app/core/errors.py`** · continue

```python

def allowed_methods(request: Request) -> list[str]:
    """Every method that some route would fully match for this path, in a stable order."""
    allowed = []
    for method in _METHOD_ORDER:
        probe = {**request.scope, "method": method}
        if any(route.matches(probe)[0] == Match.FULL for route in request.app.router.routes):
            allowed.append(method)
    return allowed

def _respond(request: Request, problem: ProblemError) -> JSONResponse:
    return problem_response(problem, request.url.path, getattr(request.state, "request_id", None))

async def _on_problem(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ProblemError)
    return _respond(request, exc)

async def _on_validation(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    if any(error["type"] == "json_invalid" for error in exc.errors()):
        return _respond(request, ProblemError("bad-request", "Malformed JSON"))
    problem = ProblemError(
        "validation-error", "The request contains invalid fields", field_errors(exc.errors())
    )
    return _respond(request, problem)

async def _on_http(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HTTPException)
    if exc.status_code in (404, 405):
        # Starlette's own Allow header lists only the first matching route's methods.
        allowed = allowed_methods(request)
        if not allowed:
            return _respond(request, ProblemError("not-found", "No route matches this path"))
        detail = f"{request.method} is not supported on this path"
        problem = ProblemError("method-not-allowed", detail, headers={"Allow": ", ".join(allowed)})
        return _respond(request, problem)
    slug = _BY_STATUS.get(exc.status_code, "internal")
    return _respond(request, ProblemError(slug))

async def _on_integrity(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, IntegrityError)
    if is_unique_violation(exc):
        return _respond(
            request, ProblemError("conflict", "A resource with these values already exists")
        )
    raise exc

def add_exception_handlers(app: FastAPI) -> None:
    """The one place where exceptions become problem+json responses (Nest's exception filter)."""
    app.add_exception_handler(ProblemError, _on_problem)
    app.add_exception_handler(RequestValidationError, _on_validation)
    app.add_exception_handler(HTTPException, _on_http)
    app.add_exception_handler(IntegrityError, _on_integrity)
```

**What's new (TS → FastAPI exception handlers)**
- **`app.add_exception_handler(ExceptionClass, handler)`** registers an `async` function that turns that exception (and its subclasses) into a response, NestJS's exception filter in function form. FastAPI looks handlers up by the exception's class.
- **`RequestValidationError`** is what FastAPI raises when Pydantic rejects a request. One special case: **malformed JSON** arrives as a validation error of type `json_invalid`, and the contract wants 400 for it, not 422.
- **404 or 405?** Starlette raises `HTTPException(404)` when no route matches the path, and `HTTPException(405)` when one matches the path but not the method, with an `Allow` header naming **only that one route's methods** (`GET` and `POST` on the same path are two routes). `allowed_methods` asks every route the same question the router asks: **`route.matches(scope)`** returns `Match.FULL` when path *and* method match. Trying each method in turn gives the complete `Allow` list. (In NestJS you built a route table for this; the router's own matching makes that unnecessary here.)
- **`{**request.scope, "method": method}`** copies the scope dict with one key changed, `{ ...scope, method }`.
- **`any(... for route in ...)`** is `routes.some(...)`; the expression inside the brackets is a generator, evaluated lazily, so `any` stops at the first match.
- **`assert isinstance(exc, ProblemError)`**: Starlette types every handler's argument as plain `Exception`; the assert narrows it for mypy (and documents the assumption).
- **`raise exc`** in the integrity handler: anything other than a unique violation isn't ours to explain, so it continues as an unhandled error and the middleware's 500 catches it.

> **🧠 DSA & scalability · Computing `Allow` by asking the router**
> - **Data structure:** the app's list of routes, each with a compiled path regex and a method set (in memory, built once at startup).
> - **Algorithm:** for each of 6 methods, copy the request scope with that method and ask each route `matches()`; collect the methods with a full match.
> - **Complexity:** O(6 × routes) regex matches, about 300 for this app, and only on the 404/405 error path. Successful requests never pay it.
> - **Why it scales:** it reads the same routing table the router uses, so it can't drift from the real routes (a hand-kept list would), and there's no shared state.
> - **Alternatives rejected:** trusting Starlette's `Allow` (incomplete when one path has several routes); a route table built at startup (NestJS's approach: correct, but more code to keep in sync).

**✅ Checkpoint**

```bash
uv run mypy .
uv run ruff check .
```

Expected: `Success: no issues found in 26 source files` and `All checks passed!`.

**Commit:** `feat: problem exception handlers with 404, 405 and conflicts`

### Step 3.5 · Postgres and Redis as resources, dependencies, and health checks

**Goal:** the database engine and the Redis client, opened once at startup and closed at shutdown, handed to route functions through **dependencies**; then the two health endpoints, the first routes that use them.

**Files:** `app/db/session.py`, `app/infra/__init__.py`, `app/infra/resources.py`, `app/deps.py`, `app/health/__init__.py`, `app/health/router.py`

```bash
uv add --bounds exact redis==8.1.0
mkdir app/infra app/health && touch app/infra/__init__.py app/health/__init__.py
```

- **redis-py** is the official Redis client; `redis.asyncio` is its async API (ioredis's role in Node).

**`app/db/session.py`** · new file

```python
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings

def create_engine(settings: Settings) -> AsyncEngine:
    # The engine owns the connection pool; one per process, created at startup.
    return create_async_engine(settings.sqlalchemy_url, pool_size=10, pool_pre_ping=True)

def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay readable after commit, without another round trip
    # (async code can't lazily refresh an attribute anyway).
    return async_sessionmaker(engine, expire_on_commit=False)
```

**What's new (TS → SQLAlchemy sessions)**
- **The engine** owns the connection pool (`pool_size=10`, `pool_pre_ping` tests a connection before handing it out, so a Postgres restart doesn't surface as errors). One engine per process.
- **A session** is SQLAlchemy's **unit of work**: you load objects through it, change them, add new ones, and `commit()` writes everything in one transaction. It borrows a connection from the pool only while a transaction is open. `async_sessionmaker(engine)` is a factory: call it to get a new session. TypeORM's `EntityManager` is the closest relative.
- **`expire_on_commit=False`**: by default a session forgets loaded values after commit and reloads them on the next access. That reload would be an implicit query, which async code can't do, so objects stay readable after commit.

**`app/infra/resources.py`** · new file

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncEngine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.config import Settings
from app.db.session import create_engine
from app.db.session import create_session_factory
```

**`app/infra/resources.py`** · continue

```python

@dataclass(frozen=True, slots=True)
class Resources:
    """Everything with a connection or a pool: created once at startup, closed at shutdown."""

    settings: Settings
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    redis: Redis
```

**`app/infra/resources.py`** · continue

```python

@asynccontextmanager
async def open_resources(settings: Settings) -> AsyncIterator[Resources]:
    engine = create_engine(settings)
    # decode_responses: Redis replies arrive as str, not bytes.
    redis = Redis.from_url(str(settings.redis_url), decode_responses=True)
```

**`app/infra/resources.py`** · continue

```python
    try:
        yield Resources(
            settings=settings,
            engine=engine,
            sessions=create_session_factory(engine),
            redis=redis,
```

**`app/infra/resources.py`** · continue

```python
        )
    finally:
```

**`app/infra/resources.py`** · continue

```python
        await redis.aclose()
        await engine.dispose()
```

**What's new (TS → Python)**
- **`@dataclass(frozen=True, slots=True)`** generates `__init__`, `__repr__` and `__eq__` from the annotated fields: a typed, immutable record in a few lines, like a TS `readonly` interface plus its constructor ([primer §7](../../docs/python-for-ts-devs.md#7-classes-dataclasses-protocols-enums)). Models that come from *outside* (requests, config) use Pydantic; data you build yourself uses dataclasses, which don't validate.
- **`@asynccontextmanager` + `yield`** turns a function into an **async context manager**: the code before `yield` runs on enter (open the pools), the yielded value is what `async with ... as resources` receives, and the `finally:` after it runs on exit (close them), even if the app crashed. One function holds both halves of a resource's life, where Nest needed a provider plus an `onApplicationShutdown` hook.
- **`decode_responses=True`**: Redis returns bytes by default (Python keeps `bytes` and `str` strictly apart); this makes every reply a `str`.
- `Resources` grows a field in Part 5 (the job queue) and Part 9 (S3 storage).

**`app/deps.py`** · new file

```python
"""Dependencies shared by every feature: `def handler(session: SessionDep)` asks FastAPI for one."""

from collections.abc import AsyncIterator
from typing import Annotated
from typing import cast

from fastapi import Depends
from fastapi.requests import HTTPConnection
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.infra.resources import Resources
```

**`app/deps.py`** · continue

```python

def get_resources(conn: HTTPConnection) -> Resources:
    # HTTPConnection is what Request and WebSocket have in common, so this works for both.
    return cast(Resources, conn.app.state.resources)

ResourcesDep = Annotated[Resources, Depends(get_resources)]

def get_settings_dep(resources: ResourcesDep) -> Settings:
    return resources.settings

def get_redis(resources: ResourcesDep) -> Redis:
    return resources.redis

```

**`app/deps.py`** · continue

```python
async def get_session(resources: ResourcesDep) -> AsyncIterator[AsyncSession]:
    """One session per request. Leaving the `async with` closes it, rolling back anything
    uncommitted, so a request that raises never leaves half a change behind."""
    async with resources.sessions() as session:
        yield session

SettingsDep = Annotated[Settings, Depends(get_settings_dep)]
RedisDep = Annotated[Redis, Depends(get_redis)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
```

**What's new (TS → FastAPI dependencies)**
- **A dependency is a function FastAPI calls for you, and passes the result in.** A route function declares a parameter `session: SessionDep`, and FastAPI sees `Depends(get_session)` in its type, calls `get_session(...)`, and passes the session. Dependencies can have dependencies: `get_session` asks for `ResourcesDep`, which asks for the connection. FastAPI resolves the graph per request, **caching each dependency for the request**, so two services that both ask for a session in one request get *the same session*. This is FastAPI's whole DI system: no container, no modules, just function signatures. (NestJS: the container + `@Inject()`; Express: `req.something` set by a middleware.)
- **`Annotated[AsyncSession, Depends(get_session)]`** bundles the type (for mypy and your editor) and the provider (for FastAPI) into one reusable name. Writing `SessionDep` instead of `Annotated[...]` in every signature is the FastAPI docs' recommended style.
- **A dependency with `yield`** gets setup and teardown: FastAPI runs it up to `yield`, injects the session, runs the route, then resumes after `yield`, where `async with` closes the session and **rolls back anything uncommitted**. If the route raises, the rollback still happens.
- **`HTTPConnection`** is the common parent of `Request` and `WebSocket`, so `get_resources` works for both kinds of route. `conn.app.state` is where the lifespan (next step) puts things; `cast(Resources, ...)` tells mypy the type of that untyped attribute without changing anything at run time, TS's `as Resources`.

**`app/health/router.py`** · new file

```python
import asyncio
from collections.abc import Awaitable
from typing import Any
from typing import Literal

from fastapi import APIRouter
from fastapi import Response
from sqlalchemy import text

from app.core.schemas import CamelModel
from app.deps import RedisDep
from app.deps import SessionDep

type Status = Literal["ok", "unavailable"]

router = APIRouter(prefix="/health", tags=["health"])

class Liveness(CamelModel):
    status: Literal["ok"]

class Checks(CamelModel):
    database: Status
    redis: Status

class Readiness(CamelModel):
    status: Status
    checks: Checks

async def _check(probe: Awaitable[Any]) -> Status:
    try:
        async with asyncio.timeout(1):
            await probe
    except Exception:
        return "unavailable"
    return "ok"

@router.get("/live")
async def live() -> Liveness:
    return Liveness(status="ok")

@router.get("/ready")
async def ready(response: Response, session: SessionDep, redis: RedisDep) -> Readiness:
    database, cache = await asyncio.gather(
        _check(session.execute(text("SELECT 1"))), _check(redis.ping())
    )
    ok = database == "ok" and cache == "ok"
    response.status_code = 200 if ok else 503
    return Readiness(
        status="ok" if ok else "unavailable", checks=Checks(database=database, redis=cache)
    )
```

**What's new**
- **`APIRouter(prefix="/health")`** groups routes, like `express.Router()`; `main.py` includes it in the app (next step). **`@router.get("/live")`** registers the decorated function as the handler for `GET /health/live`.
- **The return type is the response schema.** `-> Liveness` tells FastAPI to validate the returned object against `Liveness` and serialise it. The same annotation documents the response in the generated OpenAPI. A route function is a plain function with typed parameters: FastAPI reads the types to decide what to inject.
- **`response: Response`** asks FastAPI for the response object, here only to set the status code (503 when a dependency is down).
- **`asyncio.gather(a, b)`** runs both probes concurrently, `Promise.all`. **`asyncio.timeout(1)`** cancels the probe after one second; leaving the block early raises `TimeoutError`, which the `except` turns into `"unavailable"`. The parameter is an `Awaitable`: the probe is created by the caller (`redis.ping()` without `await`) and awaited inside the timeout.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 32 source files`.

**Commit:** `feat: database and redis resources, dependencies and health checks`

### Step 3.6 · The app factory, the lifespan and the docs

**Goal:** `create_app()`, which assembles middleware, exception handlers and routers and opens the resources at startup; a module-level `app` for uvicorn; and the dev server with Swagger UI.

**Files:** `app/main.py`, `pyproject.toml`

```bash
uv add --dev --bounds exact fastapi-cli==0.0.34
```

- **fastapi-cli** gives you `fastapi dev`: uvicorn with auto-reload and a nicer banner, the `tsx watch` of this repo. Production runs uvicorn directly (Part 13).

**`app/main.py`** · new file

```python
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from contextlib import asynccontextmanager

```

**`app/main.py`** · continue

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

```

**`app/main.py`** · continue

```python
from app.config import Settings
from app.config import get_settings
from app.core.errors import add_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodyGuardMiddleware
from app.core.middleware import RequestContextMiddleware
from app.health.router import router as health_router
from app.infra.resources import open_resources
```

**`app/main.py`** · continue

```python

API_PREFIX = "/api/v1"

def create_app(settings: Settings | None = None) -> FastAPI:
    """Builds a complete, independent app. main.py's `app` is one; each test can make its own."""
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Code before `yield` runs at startup, code after it at shutdown. The exit stack closes
        # what was opened, in reverse order, even if startup fails halfway.
        async with AsyncExitStack() as stack:
            resources = await stack.enter_async_context(open_resources(settings))
            app.state.resources = resources
```

**`app/main.py`** · continue

```python
            yield

    docs = settings.app_env != "production"
    app = FastAPI(
        title="TaskFlow API (FastAPI)",
        description="Generated from code. The contract lives in contract/openapi.yaml.",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    add_exception_handlers(app)
    # The last middleware added runs first: request context → CORS → body guard → routes.
    app.add_middleware(BodyGuardMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(RequestContextMiddleware)

    app.include_router(health_router)
```

**`app/main.py`** · continue

```python
    return app

app = create_app()
```

**What's new (TS → FastAPI)**
- **An app factory.** `create_app()` builds a complete, independent application; `app = create_app()` at the bottom is the instance uvicorn imports (`app.main:app` means "the `app` attribute of the module `app.main`"). Tests (next step, and Part 10) call `create_app()` to get apps of their own.
- **The lifespan** is an async context manager FastAPI enters at startup and exits at shutdown: before `yield` = startup, after = shutdown. **`AsyncExitStack`** is a stack of context managers you enter one by one: on exit (or if a later one fails during startup) it closes them **in reverse order**. Part 10 adds the WebSocket hub to the stack with one line.
- **A function defined inside a function** (`lifespan`) can use the outer function's variables (`settings`): a closure, as in JS.
- **Middleware order:** `add_middleware` *wraps* the current app, so **the last one added runs first**: request context (outermost, so even CORS preflights get an id) → CORS → body guard → routes. `CORSMiddleware` implements the contract's CORS rules: one exact origin, credentials, the exposed headers, a 10-minute preflight cache.
- **Docs only outside production:** `docs_url=None` disables Swagger UI. FastAPI builds the OpenAPI document from your routes' type annotations; it documents *this* implementation, while `contract/openapi.yaml` stays the source of truth (Part 12 checks one against the other).
- **`settings or get_settings()`**: tests may pass their own settings; otherwise the environment's. `API_PREFIX` is used from Part 4.

Tell the FastAPI CLI where the app is:

**`pyproject.toml`** · add at the end

```toml
[tool.fastapi]
entrypoint = "app.main:app"
```

**✅ Checkpoint**

```bash
docker compose up -d
uv run --env-file .env fastapi dev
```

`--env-file .env` loads `.env` into the environment, so the CLI reads `PORT=8004` from it. In a second terminal:

```bash
curl -s localhost:8004/health/ready
curl -s -i -X POST localhost:8004/health/live | grep -iE '^(HTTP|allow|x-request-id)'
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
allow: GET
x-request-id: 01a1d8dc-…
```

Then open http://localhost:8004/docs: Swagger UI lists the two health routes, generated from your code. Stop the server with Ctrl+C.

**Commit:** `feat: app factory with lifespan, middleware and docs`

### Step 3.7 · The test harness

**Goal:** tests that run the real application against real Postgres and Redis, on their own database, with an HTTP client wired straight to the app.

**Files:** `tests/conftest.py`, `tests/helpers.py`, `tests/test_health.py`

```bash
uv add --dev --bounds exact httpx==0.28.1
```

- **httpx** is an HTTP client (`fetch`/axios) with an **ASGI transport**: requests go straight into the app object in memory, no port, no network. It's Supertest's role.

**`tests/conftest.py`** · new file

```python
"""Shared fixtures. pytest loads this file before any test module."""

import asyncio
import os
from collections.abc import AsyncIterator

```

**`tests/conftest.py`** · continue

```python
import pytest
from alembic import command
from alembic.config import Config
```

**`tests/conftest.py`** · continue

```python
from fastapi import FastAPI
from httpx import ASGITransport
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import Settings
from app.config import get_settings

# Tests never touch the dev data: the same Postgres with a `_test` database, Redis database 1.
_dev = Settings()
os.environ |= {
    "APP_ENV": "test",
    "LOG_LEVEL": "critical",
    "DATABASE_URL": f"{str(_dev.database_url).rsplit('/', 1)[0]}/taskflow_test",
    "REDIS_URL": f"{str(_dev.redis_url).rsplit('/', 1)[0]}/1",
}
get_settings.cache_clear()

from app.infra.resources import Resources  # noqa: E402  (after the environment is set)
from app.main import create_app  # noqa: E402
from tests.helpers import reset_state  # noqa: E402

async def _create_database(settings: Settings) -> None:
    server, name = settings.sqlalchemy_url.rsplit("/", 1)
    # CREATE DATABASE can't run inside a transaction, hence AUTOCOMMIT.
    engine = create_async_engine(f"{server}/postgres", isolation_level="AUTOCOMMIT")
    async with engine.connect() as conn:
        exists = await conn.scalar(
            text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name}
        )
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{name}"'))
    await engine.dispose()

```

**`tests/conftest.py`** · continue

```python
def pytest_sessionstart(session: pytest.Session) -> None:
    """Once, before any test: create the test database and migrate it to the latest revision."""
    asyncio.run(_create_database(get_settings()))
    command.upgrade(Config("alembic.ini"), "head")
```

**`tests/conftest.py`** · continue

```python

@pytest.fixture(scope="session")
async def app() -> AsyncIterator[FastAPI]:
    """The real application, started once: its lifespan opens the pools, as in production."""
    application = create_app()
    async with application.router.lifespan_context(application):
        yield application

@pytest.fixture(scope="session")
def resources(app: FastAPI) -> Resources:
    resources: Resources = app.state.resources
    return resources

@pytest.fixture
async def client(app: FastAPI, resources: Resources) -> AsyncIterator[AsyncClient]:
    """An HTTP client wired straight to the app (no port, no network), on an empty database."""
    await reset_state(resources)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        yield client
```

**What's new (TS → pytest)**
- **`conftest.py`** is a file pytest loads automatically before the tests in its folder: shared fixtures and hooks live here (Vitest's `setupFiles` + `globalSetup`).
- **The environment is changed before the app is imported.** `os.environ |= {...}` points the tests at the `taskflow_test` database and Redis database 1, so they never touch your dev data. `get_settings.cache_clear()` forgets any cached settings. The app imports come *after* this, hence the `# noqa: E402` ("import not at top of file"), with the reason.
- **`pytest_sessionstart`** is a **hook**: a function with a name pytest knows, called once before any test. It creates the test database if needed (`CREATE DATABASE` can't run inside a transaction, hence `AUTOCOMMIT`) and runs the migrations with Alembic's Python API (`command.upgrade`), so the test schema is always the migrated one.
- **Fixtures** are pytest's dependency injection: a test that declares a parameter named `client` gets the value of the fixture function named `client`. **`scope="session"`** creates it once per test run; the default is once per test. A fixture with `yield` runs its setup, hands over the value, and runs the rest as teardown. Fixtures can ask for other fixtures, just like FastAPI dependencies.
- **`app`** builds the real application and enters its lifespan (`application.router.lifespan_context(application)`), so the pools are opened exactly as in production, once for the whole run. **`client`** resets the data, then yields an httpx client on the ASGI transport.

**`tests/helpers.py`** · new file

```python
"""What the integration tests share: requests, users and fixtures, as in every TaskFlow backend."""

```

**`tests/helpers.py`** · continue

```python
from dataclasses import dataclass
from typing import Any
```

**`tests/helpers.py`** · continue

```python

from httpx import AsyncClient
from httpx import Response
from sqlalchemy import text

```

**`tests/helpers.py`** · continue

```python
from app.infra.resources import Resources
```

**`tests/helpers.py`** · continue

```python

TABLES = [
    "activity_events",
    "attachments",
    "comments",
    "tasks",
    "board_columns",
    "projects",
    "invitations",
    "workspace_members",
    "workspaces",
    "users",
]

async def reset_state(resources: Resources) -> None:
    async with resources.engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {', '.join(TABLES)} CASCADE"))
    await resources.redis.flushdb()

@dataclass(frozen=True)
class ApiUser:
    id: str
    email: str
    token: str

    @property
    def auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}

async def send(
    client: AsyncClient,
    method: str,
    url: str,
    *,
    user: ApiUser | None = None,
    status: int | None = None,
    headers: dict[str, str] | None = None,
    **kwargs: Any,
) -> Response:
    """One request; `status=` asserts it, showing the body when it's wrong. kwargs go to httpx
    (json=, content=, params=)."""
    res = await client.request(
        method, url, headers={**(user.auth if user else {}), **(headers or {})}, **kwargs
    )
    if status is not None:
        assert res.status_code == status, f"{method} {url}: {res.status_code} {res.text}"
    return res
```

**What's new**
- `TRUNCATE ... CASCADE` empties every table in one statement, and `flushdb` empties Redis database 1: each test starts clean.
- **`@property def auth(self)`** again, on a frozen dataclass: `user.auth` is the `Authorization` header dict.
- **`send(...)`** is the one helper every request goes through, the same shape as in the other TaskFlow test suites. Parameters after a bare **`*`** are **keyword-only** (`send(client, "GET", url, status=200)`, never positionally), and **`**kwargs`** collects any other keyword arguments (`json=`, `content=`, `params=`) and passes them on to httpx unchanged. `{**a, **b}` merges two dicts.

**`tests/test_health.py`** · new file

```python
from httpx import AsyncClient

from tests.helpers import send

async def test_liveness_never_touches_dependencies(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/live", status=200)
    assert res.json() == {"status": "ok"}

async def test_readiness_checks_postgres_and_redis(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/ready", status=200)
    assert res.json() == {"status": "ok", "checks": {"database": "ok", "redis": "ok"}}

async def test_unknown_routes_get_a_problem_404_that_echoes_the_request_id(
    client: AsyncClient,
) -> None:
    res = await send(client, "GET", "/nope", headers={"X-Request-Id": "abc-123"}, status=404)
    assert res.headers["content-type"] == "application/problem+json"
    assert res.headers["x-request-id"] == "abc-123"
    assert res.json() | {"detail": None} == {
        "type": "https://taskflow.example/problems/not-found",
        "title": "Not found",
        "status": 404,
        "detail": None,
        "instance": "/nope",
        "requestId": "abc-123",
    }

async def test_undeclared_methods_get_405_with_an_allow_header(client: AsyncClient) -> None:
    res = await send(client, "POST", "/health/live", status=405)
    assert res.headers["allow"] == "GET"
    assert res.json()["type"] == "https://taskflow.example/problems/method-not-allowed"

async def test_non_json_bodies_get_415_and_oversized_ones_413(client: AsyncClient) -> None:
    # The body guard answers before routing, so any path shows it.
    text = {"Content-Type": "text/plain"}
    await send(client, "POST", "/health/live", headers=text, content="hi", status=415)
    huge = '{"blob": "' + "x" * 1_100_000 + '"}'
    json = {"Content-Type": "application/json"}
    await send(client, "POST", "/health/live", headers=json, content=huge, status=413)

async def test_security_headers_on_every_response(client: AsyncClient) -> None:
    res = await send(client, "GET", "/health/live", status=200)
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["referrer-policy"] == "no-referrer"
```

**What's new**
- **`async def test_...(client: AsyncClient)`**: the parameter name `client` requests the fixture; the type annotation is for you and mypy. pytest-asyncio runs the test on the session's event loop.
- **`res.json() | {"detail": None}`** overwrites one key before comparing, so the assertion ignores the detail text. **`res.headers`** is case-insensitive, as in Node.
- The 405 test expects `Allow: GET`. Express also answers `HEAD` for every `GET` route, so its tests expected `GET, HEAD`; FastAPI doesn't, and `Allow` lists only methods that are really served.

**✅ Checkpoint**

```bash
docker compose up -d
uv run pytest
```

Expected: `11 passed` (the two config tests, the three unit tests and the six health tests). The first run creates and migrates `taskflow_test`; you'll see Alembic's `Running upgrade  -> 0001, init` once.

**Commit:** `test: pytest harness with real postgres and redis`

---
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

**`app/auth/passwords.py`** · new file

```python
import asyncio
from functools import cache
from typing import Literal

from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher

# OWASP baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane.
_hasher = PasswordHash((Argon2Hasher(memory_cost=19_456, time_cost=2, parallelism=1),))

# argon2 burns ~20 ms of CPU on purpose. Run on the event loop, that would freeze every other
# request for those 20 ms; asyncio.to_thread moves it to a worker thread (argon2 releases the GIL).
async def hash_password(password: str) -> str:
    return await asyncio.to_thread(_hasher.hash, password)

async def verify_password(password: str, password_hash: str) -> bool:
    return await asyncio.to_thread(_hasher.verify, password, password_hash)

@cache
def _dummy_hash() -> str:
    return _hasher.hash("dummy-password-for-timing")

async def verify_against_dummy(password: str) -> Literal[False]:
    """Burns the same time as a real check, so unknown emails can't be detected by timing."""
    await asyncio.to_thread(_hasher.verify, password, _dummy_hash())
    return False
```

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

**Commit:** `feat: argon2id password hashing off the event loop`

### Step 4.2 · Access tokens and the `authenticate` dependency

**Goal:** sign and verify HS256 JWTs, and a dependency that turns a valid `Authorization: Bearer` header into the caller's user id, or a 401.

**Files:** `app/auth/tokens.py`, `app/auth/dependencies.py`

```bash
uv add --bounds exact pyjwt==2.15.1
```

- **PyJWT** is the standard Python JWT library (`jsonwebtoken`'s role). It signs, and it verifies the signature, expiry, issuer and audience in one call.

**`app/auth/tokens.py`** · new file

```python
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from uuid import UUID

import jwt

from app.config import Settings

ISSUER = "taskflow"
AUDIENCE = "taskflow-api"
ALGORITHM = "HS256"

def create_access_token(user_id: UUID, settings: Settings) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + timedelta(seconds=settings.access_token_ttl_seconds),
        "iss": ISSUER,
        "aud": AUDIENCE,
    }
    return jwt.encode(claims, settings.jwt_secret, algorithm=ALGORITHM)

def read_access_token(token: str, settings: Settings) -> UUID | None:
    """The user id, if the token's signature, expiry, issuer and audience all check out."""
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            audience=AUDIENCE,
            issuer=ISSUER,
            leeway=30,
            options={"require": ["sub", "exp", "iat"]},
        )
        return UUID(claims["sub"])
    except jwt.InvalidTokenError, ValueError:
        return None
```

**What's new**
- **`datetime.now(UTC)`** is an **aware** datetime (it knows it's UTC); PyJWT turns `datetime` values into the numeric `iat`/`exp` claims. `timedelta(seconds=…)` is a duration you can add to a datetime.
- **`leeway=30`** tolerates 30 seconds of clock skew between servers; `options={"require": [...]}` refuses tokens without those claims.
- **`except jwt.InvalidTokenError, ValueError:`** catches either exception. Since **Python 3.14** the brackets are optional: older code writes `except (A, B):`. `InvalidTokenError` covers a bad signature, expiry, wrong issuer or audience and garbage input; `ValueError` covers a `sub` that isn't a UUID.

**`app/auth/dependencies.py`** · new file

```python
from typing import Annotated
from uuid import UUID

import structlog
from fastapi import Depends
from fastapi import Request
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.security import HTTPBearer
```

**`app/auth/dependencies.py`** · continue

```python

from app.auth.tokens import read_access_token
```

**`app/auth/dependencies.py`** · continue

```python
from app.core.problems import unauthorized
```

**`app/auth/dependencies.py`** · continue

```python
from app.deps import SettingsDep

# auto_error=False: a missing header reaches us as None, so the 401 is our problem+json.
# It also tells the generated OpenAPI document that these routes take a Bearer token.
bearer = HTTPBearer(auto_error=False)

async def authenticate(
    request: Request,
    settings: SettingsDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> UUID:
    """The caller's user id, from a valid access token; otherwise 401."""
    if credentials is None:
        raise unauthorized()
    user_id = read_access_token(credentials.credentials, settings)
    if user_id is None:
        raise unauthorized("Invalid or expired access token")
    # For the access log, and for every log line written while handling this request.
    request.state.user_id = str(user_id)
    structlog.contextvars.bind_contextvars(userId=str(user_id))
    return user_id

# `user_id: CurrentUser` in a handler: FastAPI runs authenticate() first and passes the result.
CurrentUser = Annotated[UUID, Depends(authenticate)]
```

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

**Commit:** `feat: jwt access tokens and the authenticate dependency`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** issue, rotate (with reuse detection) and revoke refresh tokens, atomically, in Redis.

**Files:** `app/auth/refresh_tokens.py`

**`app/auth/refresh_tokens.py`** · new file

```python
import hashlib
import secrets
from typing import Annotated
from typing import Literal
from uuid import UUID
from uuid import uuid7

from fastapi import Depends

from app.deps import RedisDep
from app.deps import SettingsDep

def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

def _token_key(token_hash: str) -> str:
    return f"auth:rt:{token_hash}"

def _family_key(family_id: str) -> str:
    return f"auth:family:{family_id}"

# Runs atomically inside Redis, so two concurrent refreshes with the same token can't both win.
# KEYS[1] = auth:rt:<old hash>   ARGV[1] = new hash   ARGV[2] = ttl seconds
_ROTATE = """
local data = redis.call('HGETALL', KEYS[1])
if #data == 0 then return {'missing'} end
local t = {}
for i = 1, #data, 2 do t[data[i]] = data[i + 1] end
local family = 'auth:family:' .. t.familyId
if t.status == 'rotated' then
  for _, h in ipairs(redis.call('SMEMBERS', family)) do redis.call('DEL', 'auth:rt:' .. h) end
  redis.call('DEL', family)
  return {'reused'}
end
redis.call('HSET', KEYS[1], 'status', 'rotated')
local newKey = 'auth:rt:' .. ARGV[1]
redis.call('HSET', newKey, 'userId', t.userId, 'familyId', t.familyId, 'status', 'active')
redis.call('EXPIRE', newKey, ARGV[2])
redis.call('SADD', family, ARGV[1])
redis.call('EXPIRE', family, ARGV[2])
return {'ok', t.userId}
"""

class RefreshTokens:
    """Opaque refresh tokens, stored in Redis only as SHA-256 hashes, grouped in families."""

    def __init__(self, redis: RedisDep, settings: SettingsDep) -> None:
        self.redis = redis
        self.ttl = settings.refresh_token_ttl_seconds
        # Loaded once per Redis server and then called by its SHA1 (EVALSHA), not resent each time.
        self._rotate = redis.register_script(_ROTATE)

    async def issue(self, user_id: UUID) -> str:
        """Starts a new token family (one per login)."""
        token = secrets.token_urlsafe(32)
        token_hash = _sha256(token)
        family_id = str(uuid7())
        async with self.redis.pipeline(transaction=True) as tx:
            tx.hset(
                _token_key(token_hash),
                mapping={"userId": str(user_id), "familyId": family_id, "status": "active"},
            )
            tx.expire(_token_key(token_hash), self.ttl)
            tx.sadd(_family_key(family_id), token_hash)
            tx.expire(_family_key(family_id), self.ttl)
            await tx.execute()
        return token

    async def rotate(
        self, token: str
    ) -> tuple[Literal["ok"], UUID, str] | tuple[Literal["invalid"]]:
        """Swaps a valid token for a new one in the same family; a reused one kills the family."""
        new = secrets.token_urlsafe(32)
        result = await self._rotate(
            keys=[_token_key(_sha256(token))], args=[_sha256(new), self.ttl]
        )
        if result[0] == "ok":
            return "ok", UUID(result[1]), new
        return ("invalid",)

    async def revoke_family(self, token: str) -> None:
        family_id = await self.redis.hget(_token_key(_sha256(token)), "familyId")
        if family_id is None:
            return
        family = _family_key(str(family_id))
        hashes = await self.redis.smembers(family)
        await self.redis.delete(family, *(_token_key(str(h)) for h in hashes))

RefreshTokensDep = Annotated[RefreshTokens, Depends()]
```

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

**Commit:** `feat: refresh token rotation with reuse detection`

### Step 4.4 · The users service and schemas

**Goal:** the user's request and response models, and the service that reads and writes users.

**Files:** `app/users/__init__.py`, `app/users/schemas.py`, `app/users/service.py`

```bash
mkdir app/users && touch app/users/__init__.py
```

**`app/users/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.user import User

DisplayName = Annotated[Trimmed, Field(min_length=1, max_length=80)]

class UpdateUserIn(PatchModel):
    display_name: Annotated[DisplayName | None, NotNull] = None

class UserSummary(CamelModel):
    id: UUID
    email: str
    display_name: str

    @classmethod
    def of(cls, user: User) -> Self:
        """Explicit, field-by-field: nothing reaches the wire unless it's listed here."""
        return cls(id=user.id, email=user.email, display_name=user.display_name)

class UserOut(UserSummary):
    created_at: datetime

    @classmethod
    def of(cls, user: User) -> Self:
        return cls(
            id=user.id, email=user.email, display_name=user.display_name, created_at=user.created_at
        )
```

**What's new**
- **Input and output models are separate classes.** `UpdateUserIn` is what a client may send; `UserSummary` and `UserOut` are what the API returns. The model *is* the documentation: FastAPI publishes all three in the OpenAPI schema with camelCase names.
- **`@classmethod def of(cls, user: User) -> Self`** is a **named constructor**: called on the class (`UserOut.of(user)`), it receives the class as `cls` and returns a new instance. It's a TS `static of(user: User): UserOut`. Each output model lists its fields explicitly, so a column added later (like `password_hash`) never reaches the wire by accident.
- **`class UserOut(UserSummary)`** inherits the summary's fields and adds `created_at`; its `of` **overrides** the parent's.
- **`Annotated[DisplayName | None, NotNull] = None`**: the field may be omitted (default `None`), but sending `"displayName": null` is a 422 (Step 3.2).

**`app/users/service.py`** · new file

```python
from collections.abc import Iterable
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy.orm import undefer

from app.deps import SessionDep
from app.models.user import User
from app.users.schemas import UpdateUserIn

class UsersService:
    def __init__(self, session: SessionDep) -> None:
        self.session = session

    async def get(self, user_id: UUID) -> User | None:
        return await self.session.get(User, user_id)

    async def get_by_email_with_password(self, email: str) -> User | None:
        """The only query that reads the password hash (the column is deferred)."""
        query = select(User).where(User.email == email).options(undefer(User.password_hash))
        return await self.session.scalar(query)

    async def get_many(self, ids: Iterable[UUID]) -> list[User]:
        result = await self.session.scalars(select(User).where(User.id.in_(list(ids))))
        return list(result)

    async def create(self, *, email: str, password_hash: str, display_name: str) -> User:
        user = User(email=email, password_hash=password_hash, display_name=display_name)
        self.session.add(user)
        await self.session.commit()
        return user

    async def update(self, user_id: UUID, body: UpdateUserIn) -> User | None:
        user = await self.get(user_id)
        if user is None:
            return None
        # exclude_unset: only the fields the client sent (JSON merge-patch semantics).
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(user, field, value)
        await self.session.commit()
        return user

UsersServiceDep = Annotated[UsersService, Depends()]
```

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

**Commit:** `feat: users service and schemas`

### Step 4.5 · The auth service and its schemas

**Goal:** register, log in, refresh and log out, as a service that knows nothing about HTTP.

**Files:** `app/auth/schemas.py`, `app/auth/service.py`

**`app/auth/schemas.py`** · new file

```python
import re
from typing import Annotated
from typing import Literal

from pydantic import AfterValidator
from pydantic import Field
from pydantic_core import PydanticCustomError

from app.core.schemas import CamelModel
from app.users.schemas import DisplayName
from app.users.schemas import UserOut

# The WHATWG rule browsers apply to <input type="email">: syntax only. (Pydantic's EmailStr
# also refuses reserved domains such as .test, a delivery policy the contract doesn't have.)
_EMAIL = re.compile(
    r"[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?"
    r"(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*"
)

def _email(value: str) -> str:
    if not _EMAIL.fullmatch(value):
        raise PydanticCustomError("email", "must be a valid email address")
    return value.lower()  # stored and compared in lowercase (the users table has a CHECK)

Email = Annotated[
    str, Field(max_length=254, json_schema_extra={"format": "email"}), AfterValidator(_email)
]

class RegisterIn(CamelModel):
    email: Email
    password: Annotated[str, Field(min_length=8, max_length=128)]
    display_name: DisplayName

class LoginIn(CamelModel):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=128)]

class AccessToken(CamelModel):
    access_token: str
    token_type: Literal["Bearer"] = "Bearer"  # noqa: S105 (a token type, not a secret)
    expires_in: int

class AuthSession(AccessToken):
    user: UserOut
```

**What's new**
- **`AfterValidator(_email)`** runs after Pydantic has checked that the value is a string: it validates the syntax and returns the **lowercased** value, which is what the model stores. A validator can transform, not just accept or reject.
- **Why not Pydantic's `EmailStr`?** It delegates to the `email-validator` package, which also refuses reserved domains like `.test` and `.local`: a *delivery* policy, not syntax. The contract says only `format: email`, and the contract test (Part 12) generates such addresses. The WHATWG pattern is what browsers apply to `<input type="email">`. `json_schema_extra={"format": "email"}` keeps the generated docs accurate.
- **`re.compile(r"...")`** builds a regular expression once; `r"..."` is a **raw string**, where backslashes are literal (no `"\\."`). Two adjacent raw strings are joined into one. `fullmatch` must match the whole value, like `^...$`.
- **`token_type: Literal["Bearer"] = "Bearer"`**: a constant field with a default, so the router never sets it.

**`app/auth/service.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.auth.passwords import hash_password
from app.auth.passwords import verify_against_dummy
from app.auth.passwords import verify_password
from app.auth.refresh_tokens import RefreshTokensDep
from app.auth.schemas import LoginIn
from app.auth.schemas import RegisterIn
from app.core.problems import conflict
from app.core.problems import unauthorized
from app.models.user import User
from app.users.service import UsersServiceDep

class AuthService:
    """Proves who you are. The router turns the result into an access token and a cookie."""

    def __init__(self, users: UsersServiceDep, refresh_tokens: RefreshTokensDep) -> None:
        self.users = users
        self.refresh_tokens = refresh_tokens

    async def register(self, body: RegisterIn) -> tuple[User, str]:
        if await self.users.get_by_email_with_password(body.email) is not None:
            raise conflict("Email is already registered")
        user = await self.users.create(
            email=body.email,
            password_hash=await hash_password(body.password),
            display_name=body.display_name,
        )
        return user, await self.refresh_tokens.issue(user.id)

    async def login(self, body: LoginIn) -> tuple[User, str]:
        user = await self.users.get_by_email_with_password(body.email)
        if user is None:
            await verify_against_dummy(body.password)
            raise unauthorized("Invalid email or password")
        if not await verify_password(body.password, user.password_hash):
            raise unauthorized("Invalid email or password")
        return user, await self.refresh_tokens.issue(user.id)

    async def refresh(self, token: str | None) -> tuple[UUID, str]:
        if not token:
            raise unauthorized("Missing refresh token")
        match await self.refresh_tokens.rotate(token):
            case ("ok", user_id, new_token):
                return user_id, new_token
            case _:
                raise unauthorized("Invalid refresh token")

    async def logout(self, token: str | None) -> None:
        if token:
            await self.refresh_tokens.revoke_family(token)

AuthServiceDep = Annotated[AuthService, Depends()]
```

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

**Commit:** `feat: auth service with register, login, refresh and logout`

### Step 4.6 · Sliding-window rate limiting as dependencies

**Goal:** 10 requests a minute per IP for register/login/refresh, 300 a minute per user for everything else, in Redis, failing open if Redis is down.

**Files:** `app/core/rate_limit.py`, `app/auth/dependencies.py`

**`app/core/rate_limit.py`** · new file

```python
import math
import time
from dataclasses import dataclass
from uuid import uuid7

from redis.asyncio import Redis

# Sliding-window log. KEYS[1] = bucket key. ARGV = now (ms), window (ms), limit, unique member.
# Returns {1, 0} when allowed, {0, oldest timestamp} when the window is full.
_SLIDING_WINDOW = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2])}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0}
"""

@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    retry_after_seconds: int

class SlidingWindowLimiter:
    def __init__(self, redis: Redis, limit: int, window_ms: int) -> None:
        self.limit = limit
        self.window_ms = window_ms
        self._script = redis.register_script(_SLIDING_WINDOW)

    async def hit(self, key: str, now_ms: int | None = None) -> RateLimitResult:
        now = now_ms if now_ms is not None else time.time_ns() // 1_000_000
        allowed, oldest = await self._script(
            keys=[key], args=[now, self.window_ms, self.limit, str(uuid7())]
        )
        if allowed == 1:
            return RateLimitResult(allowed=True, retry_after_seconds=0)
        wait_ms = oldest + self.window_ms - now
        return RateLimitResult(allowed=False, retry_after_seconds=max(1, math.ceil(wait_ms / 1000)))
```

**What's new**
- **`time.time_ns() // 1_000_000`** is the current time in milliseconds (`Date.now()`); `//` is integer division.
- **`allowed, oldest = await self._script(...)`** unpacks the script's two-item reply.
- `math.ceil` rounds up: `Retry-After` is whole seconds, never 0.
- The limiter is a plain class, not a dependency: the two dependencies below construct one each per request (cheap: `register_script` only computes a hash).

**`app/auth/dependencies.py`** · add after `from fastapi.security import HTTPBearer`

```python
from redis.exceptions import RedisError
```

**`app/auth/dependencies.py`** · add after `from app.auth.tokens import read_access_token`

```python
from app.core.problems import ProblemError
```

**`app/auth/dependencies.py`** · add after `from app.core.problems import unauthorized`

```python
from app.core.rate_limit import SlidingWindowLimiter
from app.deps import RedisDep
```

**`app/auth/dependencies.py`** · continue

```python

MINUTE_MS = 60_000
log = structlog.get_logger("rate-limit")

async def _enforce(limiter: SlidingWindowLimiter, key: str) -> None:
    try:
        result = await limiter.hit(key)
    except RedisError:
        # Better to serve without limits for a while than to refuse every request.
        log.warning("rate limiter unavailable; failing open", exc_info=True)
        return
    if not result.allowed:
        seconds = result.retry_after_seconds
        raise ProblemError(
            "rate-limited", f"Retry in {seconds} seconds", headers={"Retry-After": str(seconds)}
        )

async def limit_auth(request: Request, redis: RedisDep, settings: SettingsDep) -> None:
    """The strict "auth" bucket (register, login, refresh), counted per client IP."""
    ip = request.client.host if request.client else "unknown"
    limiter = SlidingWindowLimiter(redis, settings.rate_limit_auth_per_minute, MINUTE_MS)
    await _enforce(limiter, f"ratelimit:auth:ip:{ip}")

async def limit_api(user_id: CurrentUser, redis: RedisDep, settings: SettingsDep) -> None:
    """Every authenticated route, counted per user. Depends on CurrentUser, so it runs second."""
    limiter = SlidingWindowLimiter(redis, settings.rate_limit_api_per_minute, MINUTE_MS)
    await _enforce(limiter, f"ratelimit:api:user:{user_id}")
```

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

**Commit:** `feat: sliding-window rate limiting in redis`

### Step 4.7 · Routers, and wiring it all up

**Goal:** the auth and users routes, and the router tree that makes every route except auth's require a token.

**Files:** `app/auth/router.py`, `app/users/router.py`, `app/main.py`

**`app/auth/router.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter
from fastapi import Cookie
from fastapi import Depends
from fastapi import Response

from app.auth.dependencies import limit_auth
from app.auth.schemas import AccessToken
from app.auth.schemas import AuthSession
from app.auth.schemas import LoginIn
from app.auth.schemas import RegisterIn
from app.auth.service import AuthServiceDep
from app.auth.tokens import create_access_token
from app.config import Settings
from app.deps import SettingsDep
from app.models.user import User
from app.users.schemas import UserOut

COOKIE = "refresh_token"
COOKIE_PATH = "/api/v1/auth"

router = APIRouter(prefix="/auth", tags=["auth"])
# `refresh_token: RefreshCookie` reads the cookie of that name (None when absent).
RefreshCookie = Annotated[str | None, Cookie()]

def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE,
        token,
        max_age=settings.refresh_token_ttl_seconds,
        path=COOKIE_PATH,
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )

def _access_token(user_id: UUID, settings: Settings) -> AccessToken:
    return AccessToken(
        access_token=create_access_token(user_id, settings),
        expires_in=settings.access_token_ttl_seconds,
    )

def _session(user: User, settings: Settings) -> AuthSession:
    token = _access_token(user.id, settings)
    return AuthSession(**token.model_dump(), user=UserOut.of(user))

@router.post("/register", status_code=201, dependencies=[Depends(limit_auth)])
async def register(
    body: RegisterIn, response: Response, auth: AuthServiceDep, settings: SettingsDep
) -> AuthSession:
    user, refresh_token = await auth.register(body)
    _set_cookie(response, refresh_token, settings)
    return _session(user, settings)

@router.post("/login", dependencies=[Depends(limit_auth)])
async def login(
    body: LoginIn, response: Response, auth: AuthServiceDep, settings: SettingsDep
) -> AuthSession:
    user, refresh_token = await auth.login(body)
    _set_cookie(response, refresh_token, settings)
    return _session(user, settings)

@router.post("/refresh", dependencies=[Depends(limit_auth)])
async def refresh(
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: RefreshCookie = None,
) -> AccessToken:
    user_id, new_token = await auth.refresh(refresh_token)
    _set_cookie(response, new_token, settings)
    return _access_token(user_id, settings)

@router.post("/logout", status_code=204)
async def logout(
    response: Response,
    auth: AuthServiceDep,
    settings: SettingsDep,
    refresh_token: RefreshCookie = None,
) -> None:
    await auth.logout(refresh_token)
    response.delete_cookie(
        COOKIE, path=COOKIE_PATH, secure=settings.cookie_secure, httponly=True, samesite="lax"
    )
```

**What's new (TS → FastAPI routing)**
- **How FastAPI reads a route function's parameters:** a Pydantic model (`body: RegisterIn`) is the **JSON body**; `Response` is the response object; a `Depends(...)` annotation is a **dependency**; `Cookie()` reads a **cookie** with the parameter's name (`refresh_token`); a plain `int`/`str` would be a **query parameter**, and a name inside the path (`{taskId}`, Part 5) a **path parameter**. Everything is validated before your code runs, and a failure is a 422 with the field path (Step 3.4).
- **`dependencies=[Depends(limit_auth)]`** on the decorator runs a dependency whose *result* the function doesn't need, here only for its side effect (counting, maybe a 429).
- **`status_code=201`** sets the success status; the default is 200, and logout's 204 sends no body.
- **`response.set_cookie(...)`** writes `Set-Cookie`: `max_age` is in **seconds** here (Express wanted milliseconds), and `delete_cookie` sends the same cookie with `Max-Age=0`.
- **`AuthSession(**token.model_dump(), user=...)`**: `model_dump()` turns a model into a dict of its fields, and `**` spreads it into keyword arguments, `{...token, user}`.
- **`refresh_token: RefreshCookie = None`**: the default makes the cookie optional, so a missing cookie reaches the service (401), rather than failing validation (422). Parameters with defaults must come last in Python.
- **Response serialisation:** returning an `AuthSession` makes FastAPI dump it **by alias** (`accessToken`, `expiresIn`), validated against the return annotation.

**`app/users/router.py`** · new file

```python
from fastapi import APIRouter

from app.auth.dependencies import CurrentUser
from app.core.problems import not_found
from app.users.schemas import UpdateUserIn
from app.users.schemas import UserOut
from app.users.service import UsersServiceDep

router = APIRouter(prefix="/users", tags=["users"])

@router.get("/me")
async def get_me(user_id: CurrentUser, users: UsersServiceDep) -> UserOut:
    user = await users.get(user_id)
    if user is None:
        raise not_found("User")
    return UserOut.of(user)

@router.patch("/me")
async def update_me(user_id: CurrentUser, body: UpdateUserIn, users: UsersServiceDep) -> UserOut:
    user = await users.update(user_id, body)
    if user is None:
        raise not_found("User")
    return UserOut.of(user)
```

**`app/main.py`** · add before `from fastapi import FastAPI`

```python
from fastapi import APIRouter
from fastapi import Depends
```

**`app/main.py`** · add before `from app.config import Settings`

```python
from app.auth.dependencies import limit_api
from app.auth.router import router as auth_router
```

**`app/main.py`** · add after `from app.infra.resources import open_resources`

```python
from app.users.router import router as users_router
```

**`app/main.py`** · add after `app.include_router(health_router)`

```python
    # Secure by default: every router included here needs an access token, and is rate limited
    # per user. Only routers included straight into `api` (auth) are public.
    protected = APIRouter(dependencies=[Depends(limit_api)])
    protected.include_router(users_router)
```

**`app/main.py`** · add after `protected.include_router(users_router)`

```python
    api = APIRouter(prefix=API_PREFIX)
    api.include_router(auth_router)
    api.include_router(protected)
    app.include_router(api)
```

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

**Commit:** `feat: auth and users routes behind a secure-by-default router`

### Step 4.8 · Auth tests

**Goal:** the auth flows, end to end: register, login, refresh rotation and reuse, logout, `/users/me`, validation, 400/405, and the rate limit.

**Files:** `tests/helpers.py`, `tests/test_auth.py`

**`tests/helpers.py`** · add before `from dataclasses import dataclass`

```python
import itertools
```

**`tests/helpers.py`** · add after `import itertools`

```python
import secrets
```

**`tests/helpers.py`** · continue

```python

_counter = itertools.count(1)
# Unique per test run: Mailpit keeps the emails of earlier runs.
_RUN = secrets.token_hex(3)

async def register_user(client: AsyncClient, name: str = "User") -> ApiUser:
    email = f"{name.lower()}{next(_counter)}.{_RUN}@example.com"
    body = {"email": email, "password": "correct-horse-battery", "displayName": name}
    res = await send(client, "POST", "/api/v1/auth/register", json=body, status=201)
    data = res.json()
    return ApiUser(id=data["user"]["id"], email=email, token=data["accessToken"])
```

**What's new**
- **`itertools.count(1)`** is an endless counter: `next(_counter)` returns 1, 2, 3… Each user gets a unique email; `_RUN` adds a random suffix per test run, because Mailpit keeps emails between runs (Part 11 reads them).
- `register_user` registers through the API, as a real client would, and returns the id, email and access token.

**`tests/test_auth.py`** · new file

```python
from httpx import AsyncClient
from httpx import Response

from tests.helpers import register_user
from tests.helpers import send

REGISTER = "/api/v1/auth/register"

def refresh_cookie(res: Response) -> tuple[str, str]:
    """The raw Set-Cookie header for the refresh token, and the `name=value` part to send back."""
    header = next(c for c in res.headers.get_list("set-cookie") if c.startswith("refresh_token="))
    return header, header.split(";", 1)[0]

async def register(client: AsyncClient, email: str) -> Response:
    body = {"email": email, "password": "correct-horse", "displayName": "Ada"}
    return await send(client, "POST", REGISTER, json=body, status=201)

async def test_register_sets_a_hardened_refresh_cookie_and_returns_the_session(
    client: AsyncClient,
) -> None:
    body = {"email": "Ada@Example.com", "password": "correct-horse", "displayName": "  Ada  "}
    res = await send(client, "POST", REGISTER, json=body, status=201)
    data = res.json()
    assert data["tokenType"] == "Bearer"
    assert data["expiresIn"] == 900
    assert data["user"] | {"id": None, "createdAt": None} == {
        "id": None,
        "email": "ada@example.com",
        "displayName": "Ada",
        "createdAt": None,
    }
    header, _ = refresh_cookie(res)
    for part in ["HttpOnly", "Secure", "SameSite=lax", "Path=/api/v1/auth", "Max-Age=604800"]:
        assert part in header

async def test_duplicate_email_is_a_409(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    body = {"email": user.email.upper(), "password": "another-pass", "displayName": "Ada"}
    await send(client, "POST", REGISTER, json=body, status=409)

async def test_422_lists_camel_case_fields(client: AsyncClient) -> None:
    body = {"email": "not-an-email", "password": "short", "displayName": ""}
    res = await send(client, "POST", REGISTER, json=body, status=422)
    assert res.headers["content-type"] == "application/problem+json"
    fields = sorted(e["field"] for e in res.json()["errors"])
    assert fields == ["displayName", "email", "password"]

async def test_body_types_are_never_coerced_and_unknown_fields_are_ignored(
    client: AsyncClient,
) -> None:
    body = {"email": "typed@example.com", "password": 12345678, "displayName": "Ada"}
    res = await send(client, "POST", REGISTER, json=body, status=422)
    assert [e["field"] for e in res.json()["errors"]] == ["password"]
    extra = body | {"password": "correct-horse", "isAdmin": True}
    await send(client, "POST", REGISTER, json=extra, status=201)

async def test_malformed_json_is_400_and_a_wrong_method_405(client: AsyncClient) -> None:
    login = "/api/v1/auth/login"
    json = {"Content-Type": "application/json"}
    await send(client, "POST", login, headers=json, content='{"email":', status=400)
    res = await send(client, "PUT", login, json={}, status=405)
    assert res.headers["allow"] == "POST"

async def test_unknown_email_and_wrong_password_get_the_same_401(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    login = "/api/v1/auth/login"
    ok = {"email": user.email, "password": "correct-horse-battery"}
    await send(client, "POST", login, json=ok, status=200)
    wrong = await send(client, "POST", login, json=ok | {"password": "nope"}, status=401)
    unknown = await send(
        client, "POST", login, json={"email": "ghost@example.com", "password": "nope"}, status=401
    )
    assert wrong.json()["detail"] == unknown.json()["detail"]

async def test_refresh_rotates_and_reuse_revokes_the_family(client: AsyncClient) -> None:
    _, first = refresh_cookie(await register(client, "rot@example.com"))

    async def refresh(cookie: str, status: int) -> Response:
        return await send(
            client, "POST", "/api/v1/auth/refresh", headers={"Cookie": cookie}, status=status
        )

    refreshed = await refresh(first, 200)
    assert refreshed.json()["tokenType"] == "Bearer"
    _, second = refresh_cookie(refreshed)
    assert second != first

    # Replaying the rotated token looks like theft: everything in the family dies.
    await refresh(first, 401)
    await refresh(second, 401)

async def test_logout_revokes_the_session_and_clears_the_cookie(client: AsyncClient) -> None:
    _, cookie = refresh_cookie(await register(client, "out@example.com"))
    headers = {"Cookie": cookie}
    res = await send(client, "POST", "/api/v1/auth/logout", headers=headers, status=204)
    header, _ = refresh_cookie(res)
    assert "Max-Age=0" in header
    await send(client, "POST", "/api/v1/auth/refresh", headers=headers, status=401)

async def test_users_me_is_protected_and_renamable(client: AsyncClient) -> None:
    me = "/api/v1/users/me"
    await send(client, "GET", me, status=401)
    await send(client, "GET", me, headers={"Authorization": "Bearer junk"}, status=401)
    user = await register_user(client, "Ada")
    await send(client, "PATCH", me, user=user, json={"displayName": "Ada L."}, status=200)
    res = await send(client, "GET", me, user=user, status=200)
    assert (res.json()["id"], res.json()["displayName"]) == (user.id, "Ada L.")
    empty = await send(client, "PATCH", me, user=user, json={}, status=422)
    assert empty.json()["errors"][0]["field"] == "body"
    await send(client, "PATCH", me, user=user, json={"displayName": None}, status=422)

async def test_auth_is_limited_to_10_per_minute_per_ip_then_429(client: AsyncClient) -> None:
    body = {"email": "nobody@example.com", "password": "x"}
    for _ in range(10):
        await send(client, "POST", "/api/v1/auth/login", json=body, status=401)
    limited = await send(client, "POST", "/api/v1/auth/login", json=body, status=429)
    assert int(limited.headers["retry-after"]) > 0
    assert limited.json()["type"] == "https://taskflow.example/problems/rate-limited"
```

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

**Commit:** `test: auth flows, rotation, rate limits`

### Step 4.9 · Seed the default user

**Goal:** a development login that exists on every fresh database: **`ashutosh@test.com` / `Ashutosh#1234`**, the same account every TaskFlow backend seeds.

**Files:** `app/users/default_user.py`, `app/seed.py`, `tests/test_seed.py`, `pyproject.toml`

**`app/users/default_user.py`** · new file

```python
from typing import Final
from typing import Literal

from app.auth.passwords import hash_password
from app.users.service import UsersService

# The account every TaskFlow backend seeds for local development, so the frontend has a login
# ready. Its password is public: app/seed.py refuses to run in production.
DEFAULT_EMAIL: Final = "ashutosh@test.com"
DEFAULT_PASSWORD: Final = "Ashutosh#1234"  # noqa: S105 (a documented development login)
DEFAULT_DISPLAY_NAME: Final = "Ashutosh"

async def seed_default_user(users: UsersService) -> Literal["created", "exists"]:
    """Creates the default user unless the email is already registered. Safe to run repeatedly."""
    if await users.get_by_email_with_password(DEFAULT_EMAIL) is not None:
        return "exists"
    await users.create(
        email=DEFAULT_EMAIL,
        password_hash=await hash_password(DEFAULT_PASSWORD),
        display_name=DEFAULT_DISPLAY_NAME,
    )
    return "created"
```

**What's new**
- **`Final`** marks a constant mypy won't let you reassign (TS's `const` for module-level names, which Python lacks).
- **Idempotent:** if the email exists, it returns `"exists"` and changes nothing; otherwise it creates the user through the same `UsersService` and hasher the API uses (no raw SQL), and returns `"created"`.

**`app/seed.py`** · new file

```python
"""`uv run python -m app.seed`: creates the default development user in the database."""

import asyncio

from app.config import get_settings
from app.db.session import create_engine
from app.db.session import create_session_factory
from app.users.default_user import DEFAULT_EMAIL
from app.users.default_user import seed_default_user
from app.users.service import UsersService

async def main() -> None:
    settings = get_settings()
    if settings.app_env == "production":
        raise SystemExit("Refusing to seed a production database")
    engine = create_engine(settings)
    try:
        async with create_session_factory(engine)() as session:
            result = await seed_default_user(UsersService(session))
    finally:
        await engine.dispose()
    print(f"default user {DEFAULT_EMAIL}: {result}")

if __name__ == "__main__":
    asyncio.run(main())
```

**What's new**
- **`python -m app.seed`** runs a module as a script. **`if __name__ == "__main__":`** is true only when the file is run that way, not when it's imported: Python's version of "is this the entry point?" (`import.meta.main`).
- **`raise SystemExit("...")`** exits with an error message and status 1. The password is public, so the seed refuses `APP_ENV=production`.
- It builds its own engine and session (no FastAPI here) and passes the session straight to `UsersService`: outside FastAPI, a service is a plain class.

**`tests/test_seed.py`** · new file

```python
from httpx import AsyncClient

from app.infra.resources import Resources
from app.users.default_user import DEFAULT_EMAIL
from app.users.default_user import DEFAULT_PASSWORD
from app.users.default_user import seed_default_user
from app.users.service import UsersService
from tests.helpers import send

async def test_seed_creates_the_user_once_and_the_user_can_log_in(
    client: AsyncClient, resources: Resources
) -> None:
    async with resources.sessions() as session:
        users = UsersService(session)
        assert await seed_default_user(users) == "created"
        assert await seed_default_user(users) == "exists"
    body = {"email": DEFAULT_EMAIL, "password": DEFAULT_PASSWORD}
    res = await send(client, "POST", "/api/v1/auth/login", json=body, status=200)
    assert res.json()["user"]["displayName"] == "Ashutosh"
```

The seed script is an entry point with no logic of its own; leave it out of coverage, like the other entry scripts:

**`pyproject.toml`** · add under `source = ["app"]` in `[tool.coverage.run]`

```toml
omit = ["app/seed.py"]
```

**✅ Checkpoint**

```bash
uv run python -m app.seed
uv run python -m app.seed
uv run pytest
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then `22 passed`. You can now log in as `ashutosh@test.com` / `Ashutosh#1234` from Swagger UI or the frontend.

**Commit:** `feat: seed the default development user`

---
## Part 5 · Workspaces & RBAC

Workspaces are the tenants: every other resource lives inside one, and every request inside one first checks the caller's membership and role (README §5). This Part also introduces three things every later Part uses: the **access service**, the **activity log**, and **keyset pagination**, plus the **job queue** that sends invitation emails.

**The transaction model, once.** One request = one `AsyncSession` (Step 3.5), shared by every service the request uses. Reads and writes happen on it; **the service method that owns the use case calls `await self.session.commit()` at the end**; side effects that must not happen for a rolled-back change (enqueueing a job, invalidating a cache, publishing a real-time event) come **after** the commit. If anything raises before the commit, the session dependency rolls back on its way out.

### Step 5.1 · The access service

**Goal:** one place that answers "is this user a member of this workspace, with at least this role?", with 404 for strangers and 403 for low roles.

**Files:** `app/access/service.py`, `app/core/params.py`

**`app/access/service.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
```

**`app/access/service.py`** · continue

```python

from app.access.roles import Role
from app.access.roles import at_least
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
```

**`app/access/service.py`** · continue

```python
from app.models.workspace import WorkspaceMember

class AccessService:
    """Every workspace-scoped request goes through here.
    Not a member → 404 (don't reveal the resource exists). Role too low → 403."""

    def __init__(self, session: SessionDep) -> None:
        self.session = session

    async def member(
        self, workspace_id: UUID, user_id: UUID, minimum: Role = "viewer", what: str = "Workspace"
    ) -> WorkspaceMember:
        membership = await self.session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id
            )
        )
        if membership is None:
            raise not_found(what)
        if not at_least(membership.role, minimum):
            raise forbidden()
        return membership
```

**`app/access/service.py`** · continue

```python

AccessDep = Annotated[AccessService, Depends()]
```

**What's new**
- **`not found` for strangers, `forbidden` for low roles:** a non-member can't tell a workspace exists (README §5). Later Parts add `project()`, `column()`, `task()`, `comment()` and `attachment()`: each loads the resource, finds its workspace, and calls `member()`.
- **`select(...).where(a, b)`**: several conditions in one `where` are joined with `AND`.
- The default parameter values (`minimum: Role = "viewer"`, `what: str = "Workspace"`) make the common call short: `await access.member(workspace_id, user_id)`.

**`app/core/params.py`** · new file

```python
"""Path parameters. The alias is the wire name, so a bad id is reported as `path.workspaceId`."""

from typing import Annotated
from uuid import UUID

from fastapi import Path

WorkspaceId = Annotated[UUID, Path(alias="workspaceId")]
UserId = Annotated[UUID, Path(alias="userId")]
InvitationId = Annotated[UUID, Path(alias="invitationId")]
```

**What's new**
- **Path parameters with an alias.** A route declared as `/workspaces/{workspaceId}` and a function parameter `workspace_id: WorkspaceId` are tied by **`Path(alias="workspaceId")`**: the Python name stays snake_case, the URL and the error path (`path.workspaceId`) use the contract's name. **`UUID` as the type** makes FastAPI reject `/workspaces/not-a-uuid` with a 422 before your code runs: no Postgres "invalid input syntax for type uuid" error, no 500.
- One alias per kind of id; Parts 6–9 add the rest.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 55 source files`.

**Commit:** `feat: access service for workspace roles`

### Step 5.2 · The activity log and the job queue

**Goal:** record an audit event inside the same transaction as the change it describes, and enqueue background jobs through a typed facade.

**Files:** `app/activity/__init__.py`, `app/activity/service.py`, `app/jobs/__init__.py`, `app/jobs/queue.py`, `app/infra/resources.py`, `app/deps.py`

```bash
uv add --bounds exact "celery[redis]==5.7.0"
uv add --dev --bounds exact celery-types==0.26.0
mkdir app/activity app/jobs && touch app/activity/__init__.py app/jobs/__init__.py
```

- **Celery** is Python's standard distributed task queue (BullMQ's role): producers enqueue named tasks into a **broker** (Redis here; `[redis]` installs the client), workers consume them. Part 11 writes the worker; here the API only *sends*. **celery-types** adds type stubs, so mypy understands Celery (it ships without type hints).

**`app/activity/service.py`** · new file

```python
from typing import Annotated
from typing import Any
from typing import Literal
from uuid import UUID

from fastapi import Depends
```

**`app/activity/service.py`** · continue

```python

from app.access.service import AccessDep
```

**`app/activity/service.py`** · continue

```python
from app.deps import SessionDep
from app.models.activity import ActivityEvent

type ActivityType = Literal[
    "workspace.created",
    "workspace.updated",
    "member.joined",
    "member.role_changed",
    "member.removed",
    "invitation.created",
    "invitation.revoked",
    "project.created",
    "project.updated",
    "project.deleted",
    "column.created",
    "column.updated",
    "column.moved",
    "column.deleted",
    "task.created",
    "task.updated",
    "task.moved",
    "task.deleted",
    "comment.created",
    "comment.updated",
    "comment.deleted",
    "attachment.added",
    "attachment.deleted",
]

class ActivityService:
    """Append-only: there is deliberately no update or delete method."""

    def __init__(self, session: SessionDep, access: AccessDep) -> None:
        self.session = session
        self.access = access

    def record(
        self,
        *,
        workspace_id: UUID,
        actor_id: UUID,
        type: ActivityType,
        project_id: UUID | None = None,
        task_id: UUID | None = None,
        data: dict[str, Any] | None = None,
    ) -> None:
        """Adds the event to the request's session: it commits (or rolls back) with the change."""
        event = ActivityEvent(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type=type,
            project_id=project_id,
            task_id=task_id,
            data=data or {},
        )
        self.session.add(event)
```

**`app/activity/service.py`** · continue

```python

ActivityDep = Annotated[ActivityService, Depends()]
```

**What's new**
- **`record` is not `async`**: it only `session.add`s the event. The `INSERT` is sent with the next flush or commit, **in the same transaction as the change**, so a rolled-back change leaves no event behind. In NestJS, `record` took the transaction's `EntityManager` as an argument; here every service of the request shares one session, so there's nothing to pass around.
- **`type: ActivityType`** shadows Python's built-in `type()` inside this method. It's legal and reads naturally at call sites (`type="task.created"`), and nothing in the method needs the built-in.
- **`access: AccessDep`** in the constructor is used from Part 8 (the activity feed).

**`app/jobs/queue.py`** · new file

```python
import asyncio
from typing import Any
```

**`app/jobs/queue.py`** · continue

```python

from celery import Celery

from app.config import Settings

def create_celery(settings: Settings) -> Celery:
    """One Celery app for both sides: the API sends with it, the worker (Part 11) consumes."""
    celery = Celery("taskflow", broker=str(settings.redis_url))
    celery.conf.update(
        task_serializer="json",
        accept_content=["json"],
        task_ignore_result=True,
        broker_connection_retry_on_startup=True,
        timezone="UTC",
    )
    return celery

class Jobs:
    """The typed facade services use; they never touch Celery directly."""

    def __init__(self, celery: Celery) -> None:
        self.celery = celery

    async def _send(self, name: str, **kwargs: Any) -> None:
        # send_task enqueues by name, so the API needn't import the worker's code. It is a
        # blocking network call, so it runs in a thread, off the event loop.
        await asyncio.to_thread(self.celery.send_task, name, kwargs=kwargs)

    async def send_invitation_email(
        self, *, email: str, workspace_name: str, inviter_name: str, token: str
    ) -> None:
        await self._send(
            "send-invitation-email",
            email=email,
            workspace_name=workspace_name,
            inviter_name=inviter_name,
            token=token,
        )

    async def delete_storage_prefix(self, prefix: str) -> None:
        await self._send("delete-storage-prefix", prefix=prefix)
```

**What's new**
- **`create_celery`** builds the Celery app: the broker is our Redis URL; JSON messages only (never pickle, which can execute code from a malicious message); `task_ignore_result=True` because nothing waits for a job's return value, so no result backend is needed.
- **`send_task(name, kwargs=...)`** enqueues by **task name**, so the API never imports the worker's code. It's a **blocking** network call (Celery's client is synchronous), so it goes through `asyncio.to_thread`, like argon2.
- **A typed facade:** one method per job, with keyword-only arguments, so a call site can't misspell a job name or forget a field. The JSON body is `kwargs`.

**`app/infra/resources.py`** · add after `from app.db.session import create_session_factory`

```python
from app.jobs.queue import Jobs
from app.jobs.queue import create_celery
```

**`app/infra/resources.py`** · add after `redis: Redis`

```python
    jobs: Jobs
```

**`app/infra/resources.py`** · add after `redis = Redis.from_url(str(settings.redis_url), decode_responses=True)`

```python
    celery = create_celery(settings)
```

**`app/infra/resources.py`** · add after `redis=redis,`

```python
            jobs=Jobs(celery),
```

**`app/infra/resources.py`** · add after `finally:`

```python
        celery.close()
```

**`app/deps.py`** · add after `from app.infra.resources import Resources`

```python
from app.jobs.queue import Jobs
```

**`app/deps.py`** · add before `async def get_session(resources: ResourcesDep) -> AsyncIterator[AsyncSession]:`

```python
def get_jobs(resources: ResourcesDep) -> Jobs:
    return resources.jobs

```

**`app/deps.py`** · continue

```python
JobsDep = Annotated[Jobs, Depends(get_jobs)]
```

**What's new**
- The Celery app is a resource like the database engine: created at startup, `close()`d at shutdown (it keeps a connection pool to the broker).
- **`JobsDep`** hands it to services, the same pattern as `RedisDep`.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 59 source files`.

**Commit:** `feat: activity log and job queue facade`

### Step 5.3 · Cursor pagination

**Goal:** `?limit=&cursor=` on every list, with opaque base64url cursors that every TaskFlow backend encodes the same way.

**Files:** `app/core/pagination.py`

**`app/core/pagination.py`** · new file

```python
import base64
import json
from collections.abc import Callable
from collections.abc import Sequence
from typing import Annotated
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from pydantic import Field
from sqlalchemy import Select
from sqlalchemy.orm import InstrumentedAttribute

from app.core.problems import invalid
from app.core.schemas import CamelModel

class PageQuery(CamelModel):
    """`?limit=20&cursor=…`. List endpoints subclass it to add their own filters."""

    limit: Annotated[int, Field(ge=1, le=100)] = 20
    cursor: (
        Annotated[str, Field(min_length=1, max_length=512, pattern=r"^[A-Za-z0-9_-]+$")] | None
    ) = None

class Page[T](CamelModel):
    items: list[T]
    next_cursor: str | None

class IdCursor(BaseModel):
    id: UUID

class RankCursor(BaseModel):
    rank: float
    id: UUID

def encode_cursor(value: dict[str, Any]) -> str:
    """base64url(JSON) without padding: the same bytes every TaskFlow backend produces."""
    raw = json.dumps(value, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

def decode_cursor[C: BaseModel](cursor: str, model: type[C]) -> C:
    """A cursor comes from the client, so it is validated like any other input."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        return model.model_validate_json(raw)
    except ValueError:  # bad base64, bad UTF-8, bad JSON and ValidationError all derive from it
        raise invalid("query.cursor", "is not a valid cursor") from None

def after_id(page: PageQuery) -> UUID | None:
    return decode_cursor(page.cursor, IdCursor).id if page.cursor else None

def keyset[T](
    query: Select[T],
    column: InstrumentedAttribute[UUID],
    *,
    descending: bool,
    limit: int,
    after: UUID | None,
) -> Select[T]:
    """Finishes a list query with keyset pagination: only rows past the cursor, in index order,
    one row more than the page (the extra row tells to_page() whether to mint a cursor)."""
    if after is not None:
        query = query.where(column < after if descending else column > after)
    return query.order_by(column.desc() if descending else column.asc()).limit(limit + 1)

def to_page[R, I](
    rows: Sequence[R],
    limit: int,
    to_item: Callable[[R], I],
    cursor_of: Callable[[R], dict[str, Any]],
) -> Page[I]:
    page_rows = rows[:limit]
    more = len(rows) > limit
    return Page[I](
        items=[to_item(row) for row in page_rows],
        next_cursor=encode_cursor(cursor_of(page_rows[-1])) if more and page_rows else None,
    )
```

**What's new (TS → Python)**
- **`class Page[T](CamelModel)`** is a **generic class** (Python 3.12 syntax; `class Page<T>` in TS). `Page[TaskOut]` is a model with `items: list[TaskOut]`, which FastAPI validates and documents as such.
- **Generic functions:** `def decode_cursor[C: BaseModel](cursor: str, model: type[C]) -> C` takes a model *class* (`type[C]`) and returns an instance of it, `<C extends BaseModel>(cursor: string, model: new () => C): C`. `def to_page[R, I](...)` maps rows of type `R` to items of type `I`.
- **The cursor is validated like input**, because it is input: `base64.urlsafe_b64decode` (padding added back: `-len(cursor) % 4` is the number of `=` it needs), then `model.model_validate_json(raw)` parses and validates in one step. **`except ValueError`** catches everything that can go wrong (bad base64, bad UTF-8, bad JSON, a `ValidationError`): they all derive from `ValueError`. `raise ... from None` hides the original exception from the traceback; the 422 is the whole story.
- **`PageQuery`** describes the query string. In a route, `page: Annotated[PageQuery, Query()]` makes FastAPI read `?limit=…&cursor=…` into the model, with its rules: `limit` 1–100, default 20; `cursor` base64url characters only. Query strings are text, so lax mode converts `"20"` to `20`.
- **`keyset`** finishes a SQLAlchemy query: `Select[T]` is the type of `select(...)`, and the `.where()`/`.order_by()`/`.limit()` calls each return a new query (immutable builders, like Drizzle). `column < after` builds SQL, not a Python comparison.
- **Slicing:** `rows[:limit]` is `rows.slice(0, limit)`, and `rows[-1]` is the last item (`at(-1)`).

> **🧠 DSA & scalability · Keyset pagination on UUIDv7**
> - **Data structure:** a composite **B-tree index** per list, e.g. `(workspace_id, id)` on projects; ids are UUIDv7, so `id` order is creation order.
> - **Algorithm:** `WHERE workspace_id = $1 AND id < $cursor ORDER BY id DESC LIMIT n + 1`. The index seeks to the cursor and reads n + 1 entries; the extra row only says whether a next page exists, and the cursor encodes the *n-th* row's id.
> - **Complexity:** O(log N + n) per page, wherever the page is. `OFFSET k` is O(k + n): page 10,000 reads 200,000 rows to throw them away.
> - **Why it scales:** cost is flat in the depth of the page, and concurrent inserts can't shift a page (OFFSET pages skip or repeat rows when rows are added before them).
> - **Alternatives rejected:** OFFSET (above); a timestamp cursor (ties between rows created in the same millisecond); exposing raw ids as cursors (clients start building them; base64 JSON keeps the format ours to change).

**✅ Checkpoint**

```bash
uv run python -c "
from app.core.pagination import encode_cursor, decode_cursor, IdCursor
c = encode_cursor({'id': '01a18b7e-951f-71f4-affb-2b64a14174e2'})
print(c)
print(decode_cursor(c, IdCursor))
try: decode_cursor('garbage', IdCursor)
except Exception as e: print(e.status, e.errors)"
```

Expected:

```text
eyJpZCI6IjAxYTE4YjdlLTk1MWYtNzFmNC1hZmZiLTJiNjRhMTQxNzRlMiJ9
id=UUID('01a18b7e-951f-71f4-affb-2b64a14174e2')
422 [{'field': 'query.cursor', 'message': 'is not a valid cursor'}]
```

The first line is the same cursor every TaskFlow backend produces for that id.

**Commit:** `feat: keyset pagination with opaque cursors`

### Step 5.4 · Workspace schemas and service

**Goal:** list, create, read, rename and delete workspaces.

**Files:** `app/workspaces/__init__.py`, `app/workspaces/schemas.py`, `app/workspaces/service.py`

```bash
mkdir app/workspaces && touch app/workspaces/__init__.py
```

**`app/workspaces/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.access.roles import InvitableRole
from app.access.roles import Role
from app.auth.schemas import Email
from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.users.schemas import UserSummary

Name = Annotated[Trimmed, Field(min_length=1, max_length=80)]
Slug = Annotated[str, Field(min_length=3, max_length=40, pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")]

class CreateWorkspaceIn(CamelModel):
    name: Name
    slug: Slug

class UpdateWorkspaceIn(PatchModel):
    name: Annotated[Name | None, NotNull] = None
    slug: Annotated[Slug | None, NotNull] = None

class UpdateMemberIn(CamelModel):
    role: Role

class CreateInvitationIn(CamelModel):
    email: Email
    role: InvitableRole

class AcceptInvitationIn(CamelModel):
    token: Annotated[str, Field(min_length=1, max_length=128)]
```

**What's new**
- **`Slug`** carries its rules in the type: `Field(pattern=r"^...$")` is a regex constraint, checked by Pydantic's Rust core.
- **`role: Role`** with `Role` a `Literal`: Pydantic accepts exactly those four strings and rejects anything else with a 422 listing the allowed values.
- `AcceptInvitationIn.token` is a plain bounded string; the service hashes it.

**`app/workspaces/schemas.py`** · continue

```python

class WorkspaceOut(CamelModel):
    id: UUID
    name: str
    slug: str
    current_user_role: Role
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, workspace: Workspace, role: Role) -> Self:
        return cls(
            id=workspace.id,
            name=workspace.name,
            slug=workspace.slug,
            current_user_role=role,
            created_at=workspace.created_at,
            updated_at=workspace.updated_at,
        )

class MemberOut(CamelModel):
    user: UserSummary
    role: Role
    joined_at: datetime

    @classmethod
    def of(cls, member: WorkspaceMember) -> Self:
        return cls(user=UserSummary.of(member.user), role=member.role, joined_at=member.joined_at)

class InvitationOut(CamelModel):
    id: UUID
    workspace_id: UUID
    email: str
    role: InvitableRole
    invited_by: UserSummary
    expires_at: datetime
    created_at: datetime

    @classmethod
    def of(cls, invitation: Invitation) -> Self:
        return cls(
            id=invitation.id,
            workspace_id=invitation.workspace_id,
            email=invitation.email,
            role=invitation.role,
            invited_by=UserSummary.of(invitation.inviter),
            expires_at=invitation.expires_at,
            created_at=invitation.created_at,
        )
```

**What's new**
- `WorkspaceOut.of(workspace, role)` takes the caller's role as a second argument: `currentUserRole` isn't a column, it depends on who asks.
- `InvitationOut.invited_by` comes from the `inviter` relationship, which the query must load (next steps).

**`app/workspaces/service.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import not_found
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.project import Project
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import CreateWorkspaceIn
from app.workspaces.schemas import UpdateWorkspaceIn
from app.workspaces.schemas import WorkspaceOut

class WorkspacesService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, jobs: JobsDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.jobs = jobs

    async def list(self, user_id: UUID, page: PageQuery) -> Page[WorkspaceOut]:
        # The (user_id, workspace_id) index serves this query directly: newest workspace first.
        query = (
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.workspace))
            .where(WorkspaceMember.user_id == user_id)
        )
        query = keyset(
            query,
            WorkspaceMember.workspace_id,
            descending=True,
            limit=page.limit,
            after=after_id(page),
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(
            rows,
            page.limit,
            lambda m: WorkspaceOut.of(m.workspace, m.role),
            lambda m: {"id": str(m.workspace_id)},
        )
```

**What's new (TS → SQLAlchemy)**
- **Loading a relationship in the query: `.options(joinedload(WorkspaceMember.workspace))`** adds a `JOIN` and fills `member.workspace` from the same result set. That's TypeORM's `innerJoinAndSelect`. Without it, `m.workspace` would raise (`lazy="raise"`, Step 2.2).
- **`(await self.session.scalars(query)).all()`** runs the query and returns a list. The brackets matter: `await` applies to `session.scalars(...)`, and `.all()` runs on its result.
- **`lambda m: WorkspaceOut.of(m.workspace, m.role)`** is an arrow function (`m => ...`), limited to one expression.
- **`await self.session.flush()`** sends pending `INSERT`s now, without committing: after it, `workspace.id` is set (the `uuid7` default runs at flush) and the member row can reference it. Everything still commits or rolls back together.
- **`try / except IntegrityError as err`**: the slug's unique constraint fires at flush or commit. **`raise conflict(...) from err`** raises our 409 and keeps the original as its cause (`new Error(msg, { cause })`); a bare **`raise`** re-raises the current exception unchanged.

**`app/workspaces/service.py`** · continue

```python

    async def create(self, user_id: UUID, body: CreateWorkspaceIn) -> WorkspaceOut:
        workspace = Workspace(name=body.name, slug=body.slug, created_by=user_id)
        try:
            self.session.add(workspace)
            await self.session.flush()  # sends the INSERT now, so workspace.id is set
            self.session.add(
                WorkspaceMember(workspace_id=workspace.id, user_id=user_id, role="owner")
            )
            self.activity.record(
                workspace_id=workspace.id,
                actor_id=user_id,
                type="workspace.created",
                data={"name": workspace.name},
            )
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Slug is already taken") from err
            raise
        return WorkspaceOut.of(workspace, "owner")

    async def get(self, workspace_id: UUID, user_id: UUID) -> WorkspaceOut:
        membership = await self.access.member(workspace_id, user_id)
        workspace = await self.session.get(Workspace, workspace_id)
        if workspace is None:
            raise not_found("Workspace")
        return WorkspaceOut.of(workspace, membership.role)

    async def update(
        self, workspace_id: UUID, user_id: UUID, body: UpdateWorkspaceIn
    ) -> WorkspaceOut:
        membership = await self.access.member(workspace_id, user_id, "admin")
        workspace = await self.session.get(Workspace, workspace_id)
        if workspace is None:
            raise not_found("Workspace")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(workspace, field, value)
        changes = body.model_dump(mode="json", by_alias=True, exclude_unset=True)
        self.activity.record(
            workspace_id=workspace_id, actor_id=user_id, type="workspace.updated", data=changes
        )
        try:
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Slug is already taken") from err
            raise
        return WorkspaceOut.of(workspace, membership.role)

    async def delete(self, workspace_id: UUID, user_id: UUID) -> None:
        await self.access.member(workspace_id, user_id, "owner")
        project_ids = (
            await self.session.scalars(
                select(Project.id).where(Project.workspace_id == workspace_id)
            )
        ).all()
        await self.session.execute(delete(Workspace).where(Workspace.id == workspace_id))
        await self.session.commit()
        # After commit: never ask the worker to clean up after a delete that rolled back.
        for project_id in project_ids:
            await self.jobs.delete_storage_prefix(f"projects/{project_id}/")

WorkspacesServiceDep = Annotated[WorkspacesService, Depends()]
```

**What's new**
- **`for field, value in body.model_dump(exclude_unset=True).items(): setattr(...)`**: the PATCH pattern from Step 4.4. The activity event records the same changes **by alias** (`model_dump(mode="json", by_alias=True, ...)`): camelCase keys, JSON-ready values, for display.
- **`delete(Workspace).where(...)`** is a Core `DELETE` statement executed on the session; Postgres cascades it to projects, columns, tasks, comments, attachments, members, invitations and activity (`ON DELETE CASCADE`).
- **After the commit, enqueue cleanup jobs** for each project's stored files: the job runs only if the delete really happened.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 63 source files`.

**Commit:** `feat: workspace service and schemas`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** list members in join order; change roles and remove members within the RBAC rules; never leave a workspace without an owner.

**Files:** `app/workspaces/members.py`

**`app/workspaces/members.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import joinedload

from app.access.roles import Role
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
from app.models.project import Project
from app.models.task import Task
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import MemberOut

ADMIN_MANAGEABLE: frozenset[Role] = frozenset({"member", "viewer"})

class MembersService:
    def __init__(self, session: SessionDep, access: AccessDep, activity: ActivityDep) -> None:
        self.session = session
        self.access = access
        self.activity = activity
```

**`app/workspaces/members.py`** · continue

```python

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[MemberOut]:
        await self.access.member(workspace_id, user_id)
        query = (
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.user))
            .where(WorkspaceMember.workspace_id == workspace_id)
        )
        query = keyset(
            query, WorkspaceMember.id, descending=False, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, MemberOut.of, lambda m: {"id": str(m.id)})

    async def update_role(
        self, workspace_id: UUID, actor_id: UUID, target_user_id: UUID, new_role: Role
    ) -> MemberOut:
        actor = await self.access.member(workspace_id, actor_id, "admin")
        target = await self._target(workspace_id, target_user_id)
        old_role = target.role
        if actor.role != "owner" and not {old_role, new_role} <= ADMIN_MANAGEABLE:
            raise forbidden("Only owners can grant or revoke admin and owner roles")
        if old_role == "owner" and new_role != "owner":
            await self._assert_not_last_owner(workspace_id)
        target.role = new_role
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="member.role_changed",
            data={"userId": str(target_user_id), "from": old_role, "to": new_role},
        )
        await self.session.commit()
        return MemberOut.of(target)
```

**`app/workspaces/members.py`** · continue

```python

    async def remove(self, workspace_id: UUID, actor_id: UUID, target_user_id: UUID) -> None:
        actor = await self.access.member(workspace_id, actor_id)
        target = await self._target(workspace_id, target_user_id)
        leaving = actor_id == target_user_id
        allowed = actor.role == "owner" or (
            actor.role == "admin" and target.role in ADMIN_MANAGEABLE
        )
        if not leaving and not allowed:
            raise forbidden("Your role cannot remove this member")
        if target.role == "owner":
            await self._assert_not_last_owner(workspace_id)
        await self.session.execute(delete(WorkspaceMember).where(WorkspaceMember.id == target.id))
        # One statement for every project of this workspace: a subquery inside IN (…).
        projects = select(Project.id).where(Project.workspace_id == workspace_id)
        await self.session.execute(
            update(Task)
            .where(Task.assignee_id == target_user_id, Task.project_id.in_(projects))
            .values(assignee_id=None)
        )
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="member.removed",
            data={"userId": str(target_user_id)},
        )
        await self.session.commit()

    async def _target(self, workspace_id: UUID, user_id: UUID) -> WorkspaceMember:
        target = await self.session.scalar(
            select(WorkspaceMember)
            .options(joinedload(WorkspaceMember.user))
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.user_id == user_id)
        )
        if target is None:
            raise not_found("Member")
        return target
```

**`app/workspaces/members.py`** · continue

```python

    async def _assert_not_last_owner(self, workspace_id: UUID) -> None:
        """Locks every owner row first (SELECT … FOR UPDATE), so two owners demoting each other
        at the same time can't both pass the check and leave the workspace without an owner."""
        owners = await self.session.scalars(
            select(WorkspaceMember.id)
            .where(WorkspaceMember.workspace_id == workspace_id, WorkspaceMember.role == "owner")
            .with_for_update()
        )
        if len(owners.all()) <= 1:
            raise conflict("A workspace must keep at least one owner")

MembersServiceDep = Annotated[MembersService, Depends()]
```

**What's new**
- **`frozenset({"member", "viewer"})`** is an immutable set; **`{old_role, new_role} <= ADMIN_MANAGEABLE`** asks "is this set a subset of that one?". Admins may only move people between member and viewer.
- **Changing an attribute is the update:** `target.role = new_role`, then `commit()` writes `UPDATE workspace_members SET role = ...`.
- **A subquery inside `IN`:** `Task.project_id.in_(projects)` where `projects` is a `select(...)`: SQLAlchemy inlines it, so unassigning a removed member's tasks across the whole workspace is one statement.
- **`.with_for_update()`** is `SELECT ... FOR UPDATE`: it locks the owner rows until the transaction ends.

> **🧠 DSA & scalability · The last-owner invariant under concurrency**
> - **Data structure:** the workspace's owner rows in `workspace_members`, found through the `(workspace_id, user_id)` unique index.
> - **Algorithm:** before demoting or removing an owner, `SELECT id ... WHERE role = 'owner' FOR UPDATE` locks all owner rows, then counts them; ≤ 1 → 409. The change and the commit happen while the lock is held.
> - **Complexity:** O(owners) rows read and locked; typically 1–3.
> - **Why it scales:** two owners demoting each other at the same moment both try to lock the same rows; the second waits for the first to commit and then sees only one owner left, so it gets the 409. Without the lock both would count 2 and both succeed. Requests for other workspaces never wait.
> - **Alternatives rejected:** a check-then-update without a lock (the race above); a `SERIALIZABLE` transaction (works, but retries on every serialization failure); a counter column on `workspaces` (one more value to keep correct).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 64 source files`.

**Commit:** `feat: member roles and removal with the last-owner rule`

### Step 5.6 · Invitations

**Goal:** invite by email (admins invite members and viewers, owners also admins), revoke, and accept with a single-use token.

**Files:** `app/workspaces/invitations.py`

**`app/workspaces/invitations.py`** · new file

```python
import hashlib
import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import exists
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import forbidden
from app.core.problems import not_found
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.user import User
from app.models.workspace import Invitation
from app.models.workspace import Workspace
from app.models.workspace import WorkspaceMember
from app.workspaces.schemas import CreateInvitationIn
from app.workspaces.schemas import InvitationOut
from app.workspaces.schemas import WorkspaceOut

INVITATION_TTL = timedelta(days=7)

def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

class InvitationsService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, jobs: JobsDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.jobs = jobs

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[InvitationOut]:
        await self.access.member(workspace_id, user_id, "admin")
        query = (
            select(Invitation)
            .options(joinedload(Invitation.inviter))
            .where(Invitation.workspace_id == workspace_id, Invitation.accepted_at.is_(None))
        )
        query = keyset(
            query, Invitation.id, descending=True, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, InvitationOut.of, lambda i: {"id": str(i.id)})
```

**What's new**
- **`timedelta(days=7)`** is a duration constant; `now + INVITATION_TTL` is a datetime a week later.
- `Invitation.accepted_at.is_(None)` is `accepted_at IS NULL` (`== None` would also work, but linters flag it).

**`app/workspaces/invitations.py`** · continue

```python

    async def create(
        self, workspace_id: UUID, actor_id: UUID, body: CreateInvitationIn
    ) -> InvitationOut:
        actor = await self.access.member(workspace_id, actor_id, "admin")
        if body.role == "admin" and actor.role != "owner":
            raise forbidden("Only owners can invite admins")
        already_member = await self.session.scalar(
            select(
                exists().where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == User.id,
                    User.email == body.email,
                )
            )
        )
        if already_member:
            raise conflict("This person is already a member")

        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        # An expired pending invitation would block the partial unique index; clear it first.
        await self.session.execute(
            delete(Invitation).where(
                Invitation.workspace_id == workspace_id,
                Invitation.email == body.email,
                Invitation.accepted_at.is_(None),
                Invitation.expires_at <= now,
            )
        )
        invitation = Invitation(
            workspace_id=workspace_id,
            email=body.email,
            role=body.role,
            token_hash=_sha256(token),
            invited_by=actor_id,
            expires_at=now + INVITATION_TTL,
        )
        self.session.add(invitation)
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="invitation.created",
            data={"email": body.email, "role": body.role},
        )
        try:
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("This email already has a pending invitation") from err
            raise

        loaded = await self.session.scalar(
            select(Invitation)
            .options(joinedload(Invitation.inviter), joinedload(Invitation.workspace))
            .where(Invitation.id == invitation.id)
        )
        assert loaded is not None
        await self.jobs.send_invitation_email(
            email=loaded.email,
            workspace_name=loaded.workspace.name,
            inviter_name=loaded.inviter.display_name,
            token=token,
        )
        return InvitationOut.of(loaded)
```

**What's new**
- **`exists().where(...)`**: `SELECT EXISTS (SELECT 1 FROM workspace_members, users WHERE ...)` checks "is that email already a member?" without loading anything. Listing `User.id` and `User.email` in the conditions brings `users` into the subquery.
- **The token is sent, its hash is stored.** `secrets.token_urlsafe(32)` makes the token, only `sha256(token)` reaches the database, and the plain token goes into the email job. A leaked database can't accept invitations.
- **Delete-then-insert:** an *expired* pending invitation would still block the partial unique index, so it's deleted first, in the same transaction.
- **After the commit, a fresh query with `joinedload`** loads the inviter and the workspace for the response and the email. The email job is enqueued only once the invitation really exists.
- `assert loaded is not None` narrows the type: the row was just committed, so it's there.

**`app/workspaces/invitations.py`** · continue

```python

    async def revoke(self, workspace_id: UUID, actor_id: UUID, invitation_id: UUID) -> None:
        await self.access.member(workspace_id, actor_id, "admin")
        result = await self.session.execute(
            delete(Invitation)
            .where(
                Invitation.id == invitation_id,
                Invitation.workspace_id == workspace_id,
                Invitation.accepted_at.is_(None),
            )
            .returning(Invitation.id)
        )
        if result.first() is None:
            raise not_found("Invitation")
        self.activity.record(
            workspace_id=workspace_id,
            actor_id=actor_id,
            type="invitation.revoked",
            data={"invitationId": str(invitation_id)},
        )
        await self.session.commit()

    async def accept(self, user_id: UUID, token: str) -> WorkspaceOut:
        invitation = await self.session.scalar(
            select(Invitation)
            .options(joinedload(Invitation.workspace))
            .where(Invitation.token_hash == _sha256(token))
        )
        now = datetime.now(UTC)
        if invitation is None or invitation.accepted_at is not None or invitation.expires_at <= now:
            raise not_found("Invitation")
        user = await self.session.get(User, user_id)
        if user is None or user.email != invitation.email:
            raise forbidden("This invitation was sent to a different email address")

        invitation.accepted_at = now
        workspace: Workspace = invitation.workspace
        existing = await self.session.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == invitation.workspace_id,
                WorkspaceMember.user_id == user_id,
            )
        )
        if existing is not None:
            await self.session.commit()
            return WorkspaceOut.of(workspace, existing.role)
        self.session.add(
            WorkspaceMember(
                workspace_id=invitation.workspace_id, user_id=user_id, role=invitation.role
            )
        )
        self.activity.record(
            workspace_id=invitation.workspace_id,
            actor_id=user_id,
            type="member.joined",
            data={"role": invitation.role},
        )
        await self.session.commit()
        return WorkspaceOut.of(workspace, invitation.role)

InvitationsServiceDep = Annotated[InvitationsService, Depends()]
```

**What's new**
- **`delete(...).returning(Invitation.id)`** + `result.first()`: `DELETE ... RETURNING id` reports whether a row was deleted, in one round trip.
- **Accepting is idempotent for existing members:** the invitation is marked used either way, and someone who is already a member keeps their role.
- The email must match the account's (403 otherwise); unknown, used and expired tokens are all 404.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 65 source files`.

**Commit:** `feat: email invitations with hashed single-use tokens`

### Step 5.7 · The router and the wiring

**Goal:** every workspace, member and invitation route, behind the protected router.

**Files:** `app/workspaces/router.py`, `app/main.py`

**`app/workspaces/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import InvitationId
from app.core.params import UserId
from app.core.params import WorkspaceId
from app.workspaces.invitations import InvitationsServiceDep
from app.workspaces.members import MembersServiceDep
from app.workspaces.schemas import AcceptInvitationIn
from app.workspaces.schemas import CreateInvitationIn
from app.workspaces.schemas import CreateWorkspaceIn
from app.workspaces.schemas import InvitationOut
from app.workspaces.schemas import MemberOut
from app.workspaces.schemas import UpdateMemberIn
from app.workspaces.schemas import UpdateWorkspaceIn
from app.workspaces.schemas import WorkspaceOut
from app.workspaces.service import WorkspacesServiceDep

router = APIRouter(tags=["workspaces"])
# `page: Paging`: FastAPI reads `?limit=&cursor=` into a PageQuery and validates it.
Paging = Annotated[PageQuery, Query()]

@router.get("/workspaces")
async def list_workspaces(
    user_id: CurrentUser, page: Paging, workspaces: WorkspacesServiceDep
) -> Page[WorkspaceOut]:
    return await workspaces.list(user_id, page)

@router.post("/workspaces", status_code=201)
async def create_workspace(
    user_id: CurrentUser, body: CreateWorkspaceIn, workspaces: WorkspacesServiceDep
) -> WorkspaceOut:
    return await workspaces.create(user_id, body)

@router.get("/workspaces/{workspaceId}")
async def get_workspace(
    workspace_id: WorkspaceId, user_id: CurrentUser, workspaces: WorkspacesServiceDep
) -> WorkspaceOut:
    return await workspaces.get(workspace_id, user_id)
```

**What's new**
- **Thin routes:** each function only maps HTTP to one service call. The service does the work, raises problems, and returns output models.
- **`Paging = Annotated[PageQuery, Query()]`**: one name for "read `limit` and `cursor` from the query string". `Query()` tells FastAPI to fill a model from query parameters, the way a body parameter is filled from JSON.
- **The return annotation `-> Page[WorkspaceOut]`** is the response schema: FastAPI validates the returned page and documents it.

**`app/workspaces/router.py`** · continue

```python

@router.patch("/workspaces/{workspaceId}")
async def update_workspace(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: UpdateWorkspaceIn,
    workspaces: WorkspacesServiceDep,
) -> WorkspaceOut:
    return await workspaces.update(workspace_id, user_id, body)

@router.delete("/workspaces/{workspaceId}", status_code=204)
async def delete_workspace(
    workspace_id: WorkspaceId, user_id: CurrentUser, workspaces: WorkspacesServiceDep
) -> None:
    await workspaces.delete(workspace_id, user_id)

@router.get("/workspaces/{workspaceId}/members")
async def list_members(
    workspace_id: WorkspaceId, user_id: CurrentUser, page: Paging, members: MembersServiceDep
) -> Page[MemberOut]:
    return await members.list(workspace_id, user_id, page)

@router.patch("/workspaces/{workspaceId}/members/{userId}")
async def update_member(
    workspace_id: WorkspaceId,
    target_user_id: UserId,
    user_id: CurrentUser,
    body: UpdateMemberIn,
    members: MembersServiceDep,
) -> MemberOut:
    return await members.update_role(workspace_id, user_id, target_user_id, body.role)

@router.delete("/workspaces/{workspaceId}/members/{userId}", status_code=204)
async def remove_member(
    workspace_id: WorkspaceId,
    target_user_id: UserId,
    user_id: CurrentUser,
    members: MembersServiceDep,
) -> None:
    await members.remove(workspace_id, user_id, target_user_id)

@router.get("/workspaces/{workspaceId}/invitations")
async def list_invitations(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    page: Paging,
    invitations: InvitationsServiceDep,
) -> Page[InvitationOut]:
    return await invitations.list(workspace_id, user_id, page)

@router.post("/workspaces/{workspaceId}/invitations", status_code=201)
async def create_invitation(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: CreateInvitationIn,
    invitations: InvitationsServiceDep,
) -> InvitationOut:
    return await invitations.create(workspace_id, user_id, body)

@router.delete("/workspaces/{workspaceId}/invitations/{invitationId}", status_code=204)
async def revoke_invitation(
    workspace_id: WorkspaceId,
    invitation_id: InvitationId,
    user_id: CurrentUser,
    invitations: InvitationsServiceDep,
) -> None:
    await invitations.revoke(workspace_id, user_id, invitation_id)

@router.post("/invitations/accept")
async def accept_invitation(
    user_id: CurrentUser, body: AcceptInvitationIn, invitations: InvitationsServiceDep
) -> WorkspaceOut:
    return await invitations.accept(user_id, body.token)
```

**What's new**
- **Two path parameters, two aliases:** `/members/{userId}` reads `target_user_id: UserId`, while `user_id: CurrentUser` is the caller. The names say which is which.
- `status_code=204` routes return `None`: no body.

**`app/main.py`** · add after `from app.users.router import router as users_router`

```python
from app.workspaces.router import router as workspaces_router
```

**`app/main.py`** · add after `protected.include_router(users_router)`

```python
    protected.include_router(workspaces_router)
```

**✅ Checkpoint**

Start the API (`uv run --env-file .env fastapi dev`), then in a second terminal log in as the seeded user and create a workspace:

```bash
TOKEN=$(curl -s -X POST localhost:8004/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ashutosh@test.com","password":"Ashutosh#1234"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])')
curl -s -X POST localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Acme","slug":"acme"}'
curl -s localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN"
```

Expected: the created workspace (`"currentUserRole":"owner"`, `createdAt`/`updatedAt` ending in `Z`), then `{"items":[{…"slug":"acme"…}],"nextCursor":null}`. Running the create again gives a 409 problem: `"detail":"Slug is already taken"`.

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** RBAC (404 vs 403), pagination, the last-owner rule, and the invitation flow including the queued email job.

**Files:** `tests/helpers.py`, `tests/test_workspaces.py`

**`tests/helpers.py`** · add before `import itertools`

```python
import base64
```

**`tests/helpers.py`** · add after `import itertools`

```python
import json
```

**`tests/helpers.py`** · add after `from typing import Any`

```python
from uuid import UUID
```

**`tests/helpers.py`** · add before `from app.infra.resources import Resources`

```python
from app.access.roles import Role
```

**`tests/helpers.py`** · add after `from app.infra.resources import Resources`

```python
from app.models.workspace import WorkspaceMember
```

**`tests/helpers.py`** · continue

```python

@dataclass(frozen=True)
class WorkspaceFixture:
    owner: ApiUser
    workspace_id: str

async def create_workspace(client: AsyncClient) -> WorkspaceFixture:
    """A fresh owner with their own workspace."""
    owner = await register_user(client, "Owner")
    body = {"name": "Acme", "slug": f"acme-{next(_counter)}"}
    res = await send(client, "POST", "/api/v1/workspaces", user=owner, json=body, status=201)
    return WorkspaceFixture(owner=owner, workspace_id=res.json()["id"])

async def add_member(resources: Resources, workspace_id: str, user: ApiUser, role: Role) -> None:
    """Adds an existing user to a workspace with a role, bypassing invitations."""
    async with resources.sessions() as session:
        session.add(
            WorkspaceMember(workspace_id=UUID(workspace_id), user_id=UUID(user.id), role=role)
        )
        await session.commit()

async def queued_jobs(resources: Resources) -> list[tuple[str, dict[str, Any]]]:
    """Celery's Redis broker keeps a queue as a plain list named after it ("celery"). Each entry
    is a JSON envelope whose base64 body holds [args, kwargs, options]. Oldest first."""
    jobs = []
    for raw in reversed(await resources.redis.lrange("celery", 0, -1)):
        message = json.loads(raw)
        _, kwargs, _ = json.loads(base64.b64decode(message["body"]))
        jobs.append((message["headers"]["task"], kwargs))
    return jobs
```

**What's new**
- **`add_member`** writes a membership straight to the database through a session: tests need roles quickly, without the invitation dance.
- **`queued_jobs` reads Celery's queue straight out of Redis.** Celery's Redis broker keeps a queue as a **plain list** named after it (`celery`): `LPUSH` to enqueue, `BRPOP` to consume. Each entry is a JSON envelope whose base64 `body` holds `[args, kwargs, options]` and whose `headers.task` is the job name. `reversed(...)` puts the oldest first. No worker runs in the tests, so jobs stay in the list for the test to inspect.
- **`_, kwargs, _ = ...`**: `_` is the conventional name for "a value I don't need".

**`tests/test_workspaces.py`** · new file

```python
from httpx import AsyncClient

from app.infra.resources import Resources
from tests.helpers import ApiUser
from tests.helpers import add_member
from tests.helpers import create_workspace
from tests.helpers import queued_jobs
from tests.helpers import register_user
from tests.helpers import send

WORKSPACES = "/api/v1/workspaces"

async def test_my_workspaces_newest_first_with_cursor_pagination(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    for slug in ["one", "two", "three"]:
        await send(
            client, "POST", WORKSPACES, user=user, json={"name": slug, "slug": slug}, status=201
        )
    page1 = (await send(client, "GET", f"{WORKSPACES}?limit=2", user=user, status=200)).json()
    assert [w["slug"] for w in page1["items"]] == ["three", "two"]
    assert page1["items"][0]["currentUserRole"] == "owner"
    url = f"{WORKSPACES}?limit=2&cursor={page1['nextCursor']}"
    page2 = (await send(client, "GET", url, user=user, status=200)).json()
    assert [w["slug"] for w in page2["items"]] == ["one"]
    assert page2["nextCursor"] is None

async def test_non_members_get_404_and_low_roles_get_403(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}"
    stranger = await register_user(client, "Stranger")
    await send(client, "GET", url, user=stranger, status=404)

    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, member, "member")
    await send(client, "GET", url, user=member, status=200)
    await send(client, "PATCH", url, user=member, json={"name": "Hijacked"}, status=403)
    await send(client, "DELETE", url, user=member, status=403)

async def test_taken_slug_is_409_and_a_bad_path_id_is_422(client: AsyncClient) -> None:
    user = await register_user(client, "Ada")
    await send(
        client, "POST", WORKSPACES, user=user, json={"name": "A", "slug": "same"}, status=201
    )
    await send(
        client, "POST", WORKSPACES, user=user, json={"name": "B", "slug": "same"}, status=409
    )
    res = await send(client, "GET", f"{WORKSPACES}/not-a-uuid", user=user, status=422)
    assert res.json()["errors"][0]["field"] == "path.workspaceId"

async def test_the_owner_renames_and_deletes_the_workspace(client: AsyncClient) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}"
    res = await send(client, "PATCH", url, user=ws.owner, json={"name": "Acme Inc."}, status=200)
    assert (res.json()["name"], res.json()["currentUserRole"]) == ("Acme Inc.", "owner")
    await send(client, "DELETE", url, user=ws.owner, status=204)
    await send(client, "GET", url, user=ws.owner, status=404)

async def test_admins_manage_members_and_viewers_but_not_other_admins(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    admin = await register_user(client, "Admin")
    other_admin = await register_user(client, "Admin2")
    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, admin, "admin")
    await add_member(resources, ws.workspace_id, other_admin, "admin")
    await add_member(resources, ws.workspace_id, member, "member")

    def url(u: ApiUser) -> str:
        return f"{WORKSPACES}/{ws.workspace_id}/members/{u.id}"

    res = await send(client, "PATCH", url(member), user=admin, json={"role": "viewer"}, status=200)
    assert (res.json()["user"]["id"], res.json()["role"]) == (member.id, "viewer")
    await send(client, "PATCH", url(member), user=admin, json={"role": "admin"}, status=403)
    await send(client, "PATCH", url(other_admin), user=admin, json={"role": "member"}, status=403)
    await send(client, "DELETE", url(other_admin), user=admin, status=403)
    await send(client, "DELETE", url(member), user=admin, status=204)

async def test_a_workspace_never_loses_its_last_owner(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    url = f"{WORKSPACES}/{ws.workspace_id}/members/{ws.owner.id}"
    await send(client, "PATCH", url, user=ws.owner, json={"role": "admin"}, status=409)
    await send(client, "DELETE", url, user=ws.owner, status=409)

    second = await register_user(client, "Second")
    await add_member(resources, ws.workspace_id, second, "owner")
    await send(client, "DELETE", url, user=ws.owner, status=204)

async def test_members_are_listed_in_join_order(client: AsyncClient, resources: Resources) -> None:
    ws = await create_workspace(client)
    late = await register_user(client, "Late")
    await add_member(resources, ws.workspace_id, late, "viewer")
    res = await send(
        client, "GET", f"{WORKSPACES}/{ws.workspace_id}/members", user=late, status=200
    )
    assert [m["user"]["id"] for m in res.json()["items"]] == [ws.owner.id, late.id]

async def test_invite_queue_the_email_and_join(client: AsyncClient, resources: Resources) -> None:
    ws = await create_workspace(client)
    invitations = f"{WORKSPACES}/{ws.workspace_id}/invitations"
    invitee = await register_user(client, "Invitee")
    body = {"email": invitee.email.upper(), "role": "member"}
    created = (await send(client, "POST", invitations, user=ws.owner, json=body, status=201)).json()
    assert (created["email"], created["role"]) == (invitee.email, "member")
    assert created["invitedBy"]["id"] == ws.owner.id

    [(name, data)] = await queued_jobs(resources)
    assert name == "send-invitation-email"
    token = data["token"]

    again = {"email": invitee.email, "role": "viewer"}
    await send(client, "POST", invitations, user=ws.owner, json=again, status=409)

    accept = "/api/v1/invitations/accept"
    stranger = await register_user(client, "Stranger")
    await send(client, "POST", accept, user=stranger, json={"token": token}, status=403)
    joined = await send(client, "POST", accept, user=invitee, json={"token": token}, status=200)
    assert (joined.json()["id"], joined.json()["currentUserRole"]) == (ws.workspace_id, "member")
    await send(client, "POST", accept, user=invitee, json={"token": token}, status=404)

    pending = await send(client, "GET", invitations, user=ws.owner, status=200)
    assert pending.json() == {"items": [], "nextCursor": None}

async def test_only_owners_invite_admins_and_members_cannot_invite(
    client: AsyncClient, resources: Resources
) -> None:
    ws = await create_workspace(client)
    admin = await register_user(client, "Admin")
    member = await register_user(client, "Member")
    await add_member(resources, ws.workspace_id, admin, "admin")
    await add_member(resources, ws.workspace_id, member, "member")
    url = f"{WORKSPACES}/{ws.workspace_id}/invitations"

    async def invite(who: ApiUser, role: str, status: int) -> str:
        body = {"email": "x@example.com", "role": role}
        res = await send(client, "POST", url, user=who, json=body, status=status)
        return str(res.json().get("id"))

    await invite(admin, "admin", 403)
    await invite(member, "viewer", 403)
    invitation_id = await invite(admin, "viewer", 201)
    await send(client, "DELETE", f"{url}/{invitation_id}", user=admin, status=204)
```

**What's new**
- **`[(name, data)] = await queued_jobs(resources)`** unpacks a list that must have **exactly one** item (a different length raises): the invitation enqueued one job, and the test takes its name and data in one line.
- **A nested function** (`def url(u: ApiUser) -> str:` inside the test) is a local helper, a closure over `ws`.
- Tests ask for both `client` and `resources`: pytest resolves each fixture once and shares it.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `31 passed`.

**Commit:** `test: workspaces, rbac, members and invitations`

---
## Part 6 · Projects, columns & ordering

### Step 6.1 · Fractional indexing

**Goal:** `key_between(a, b)`: a string that sorts strictly between two others, so a drag-and-drop move rewrites one row instead of renumbering a column.

**Files:** `app/core/fractional_index.py`, `tests/unit/test_fractional_index.py`

**`app/core/fractional_index.py`** · new file

```python
"""Fractional indexing (variable-length base62 keys), after David Greenspan's algorithm.

A key is an "integer part" (a head character that encodes its length, then digits) followed by a
fraction. Keys compare correctly with plain byte order, which is why the column is COLLATE "C".
"""

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
INTEGER_ZERO = "a0"
SMALLEST_INTEGER = "A" + "0" * 26

def _midpoint(a: str, b: str | None) -> str:
    """A fraction strictly between a and b (None means 1). Neither may end in '0'."""
    if b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")
    if a.endswith("0") or (b is not None and b.endswith("0")):
        raise ValueError("trailing zero")
    if b is not None:
        n = 0
        while (a[n] if n < len(a) else "0") == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if digit_b - digit_a > 1:
        # Round half up, as JavaScript's Math.round does. Python's round() rounds half to even
        # (round(46.5) == 46), which would break the shared test vectors.
        return DIGITS[(digit_a + digit_b + 1) // 2]
    if b is not None and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)

```

**`app/core/fractional_index.py`** · continue

```python

def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise ValueError(f"invalid order key head: {head}")

def _integer_part(key: str) -> str:
    length = _integer_length(key[0])
    if length > len(key):
        raise ValueError(f"invalid order key: {key}")
    return key[:length]

def _validate(key: str) -> None:
    if key == SMALLEST_INTEGER:
        raise ValueError(f"invalid order key: {key}")
    if key[len(_integer_part(key)) :].endswith("0"):
        raise ValueError(f"invalid order key: {key}")

```

**`app/core/fractional_index.py`** · continue

```python

def _increment_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) + 1
        if d < len(DIGITS):
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = "0"
    if head == "Z":
        return "a0"
    if head == "z":
        return None
    next_head = chr(ord(head) + 1)
    if next_head > "a":
        digits.append("0")
    else:
        digits.pop()
    return next_head + "".join(digits)

def _decrement_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) - 1
        if d >= 0:
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = DIGITS[-1]
    if head == "a":
        return "Z" + DIGITS[-1]
    if head == "A":
        return None
    prev_head = chr(ord(head) - 1)
    if prev_head < "Z":
        digits.append(DIGITS[-1])
    else:
        digits.pop()
    return prev_head + "".join(digits)
```

**`app/core/fractional_index.py`** · continue

```python

def key_between(a: str | None, b: str | None) -> str:
    """A key strictly between a and b; None means "open end"."""
    if a is not None:
        _validate(a)
    if b is not None:
        _validate(b)
    if a is not None and b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")

    if a is None:
        if b is None:
            return INTEGER_ZERO
        int_b = _integer_part(b)
        frac_b = b[len(int_b) :]
        if int_b == SMALLEST_INTEGER:
            return int_b + _midpoint("", frac_b)
        if int_b < b:
            return int_b
        decremented = _decrement_integer(int_b)
        if decremented is None:
            raise ValueError("cannot decrement any more")
        return decremented

    int_a = _integer_part(a)
    frac_a = a[len(int_a) :]
    if b is None:
        incremented = _increment_integer(int_a)
        return incremented if incremented is not None else int_a + _midpoint(frac_a, None)
```

**`app/core/fractional_index.py`** · continue

```python

    int_b = _integer_part(b)
    frac_b = b[len(int_b) :]
    if int_a == int_b:
        return int_a + _midpoint(frac_a, frac_b)
    incremented = _increment_integer(int_a)
    if incremented is None:
        raise ValueError("cannot increment any more")
    if incremented < b:
        return incremented
    return int_a + _midpoint(frac_a, None)
```

**What's new (TS → Python)**
- **The same algorithm as the TypeScript repos**, line for line. Strings compare by code point with `<`, as in JS, and `s[n]`, `s[:n]`, `s[n:]` are indexing and slicing (`s.slice(0, n)`, `s.slice(n)`).
- **One deliberate difference: rounding.** The midpoint digit is `(digit_a + digit_b + 1) // 2`, not `round((a + b) / 2)`. Python's `round()` rounds **half to even** ("banker's rounding": `round(46.5) == 46`), while JavaScript's `Math.round(46.5)` is 47. With `round()`, `key_between("a0V", "a1")` would return `a0k` instead of the README's `a0l`, and two backends would disagree about the same board. The shared test vectors caught this while the repo was being built ([gotcha](../../docs/gotchas.md#round-uses-bankers-rounding)).
- **`for i in reversed(range(len(digits)))`** counts down over indexes (`for (let i = n - 1; i >= 0; i--)`). A `for` loop that falls off the end without `return` continues after it: here, that means every digit carried over.
- **`ord(c)` / `chr(n)`** convert between a character and its code point (`charCodeAt` / `String.fromCharCode`). `"0" * 26` repeats a string.
- `raise ValueError(...)` for impossible input: these are bugs, not client errors, and they end up as 500s.

**`tests/unit/test_fractional_index.py`** · new file

```python
import random

import pytest

from app.core.fractional_index import key_between

# The shared vectors from the TaskFlow README; all six backends must agree on them.
@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        (None, None, "a0"),
        ("a0", None, "a1"),
        (None, "a0", "Zz"),
        ("a0", "a1", "a0V"),
        ("a1", "a2", "a1V"),
        ("a0V", "a1", "a0l"),
        ("Zz", "a0", "ZzV"),
    ],
)
def test_shared_vectors(a: str | None, b: str | None, expected: str) -> None:
    assert key_between(a, b) == expected

def test_byte_order_holds_through_2000_random_insertions() -> None:
    rng = random.Random(7)  # seeded: the same "random" sequence on every run
    keys: list[str] = []
    for _ in range(2000):
        at = rng.randint(0, len(keys))
        before = keys[at - 1] if at > 0 else None
        after = keys[at] if at < len(keys) else None
        keys.insert(at, key_between(before, after))
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)

def test_keys_grow_slowly_when_always_inserting_into_the_same_gap() -> None:
    upper = "a1"
    for _ in range(50):
        upper = key_between("a0", upper)
    assert len(upper) <= 12

def test_keys_in_the_wrong_order_are_refused() -> None:
    with pytest.raises(ValueError, match="a1 >= a0"):
        key_between("a1", "a0")
    with pytest.raises(ValueError, match="a1 >= a1"):
        key_between("a1", "a1")
```

**What's new (TS → pytest)**
- **`@pytest.mark.parametrize(("a", "b", "expected"), [...])`** runs the test once per tuple, with those values as arguments: Vitest's `it.each`. Each case is reported separately (`test_shared_vectors[a0V-a1-a0l]`).
- **`random.Random(7)`** is a generator with a fixed seed, so the "random" insertions are the same on every run. `keys.insert(at, x)` is `splice(at, 0, x)`; `sorted(keys)` returns a sorted copy.
- **`pytest.raises(ValueError, match="a1 >= a0")`** also checks the message (a regex).

> **🧠 DSA & scalability · Fractional indexing**
> - **Data structure:** a variable-length base-62 string per row (`position text COLLATE "C"`), compared by bytes; a unique B-tree index on `(column_id, position)` keeps a column's tasks in order.
> - **Algorithm:** a key is an *integer part* (a head character encoding its length, then digits) plus a *fraction*. `key_between(a, b)`: if the integer parts differ and `a`'s can be incremented without reaching `b`, use that; otherwise keep `a`'s integer part and append the fraction midway between the two fractions (digit by digit, recursing when adjacent digits leave no room).
> - **Complexity:** O(k) for a key of length k. Keys grow about one character every 6 insertions into the *same* gap (log₂ 62 ≈ 5.95 halvings per digit); normal use stays at 2–4 characters.
> - **Why it scales:** a move writes **one** row. Integer positions would renumber up to every task in the column, holding row locks on all of them; floats run out of precision after ~50 repeated bisections.
> - **Alternatives rejected:** integer positions with gaps (still need occasional renumbering); a linked list (`previous_id`: ordered reads become recursive queries); floats (precision).

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `13 passed` (3 validation tests + 10 fractional-index tests: 7 vectors and 3 properties).

**Commit:** `feat: fractional indexing with the shared test vectors`

### Step 6.2 · Schemas, the board cache and the real-time publisher

**Goal:** the project, column, task and board models; a cache-aside board cache in Redis; and the publisher that announces changes on Redis Pub/Sub.

**Files:** `app/projects/__init__.py`, `app/projects/schemas.py`, `app/projects/board_cache.py`, `app/realtime/__init__.py`, `app/realtime/publisher.py`

```bash
mkdir app/projects app/realtime && touch app/projects/__init__.py app/realtime/__init__.py
```

**`app/projects/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field
from sqlalchemy.orm import joinedload
from sqlalchemy.orm.interfaces import LoaderOption

from app.core.schemas import CamelModel
from app.core.schemas import JsonInt
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Trimmed
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Priority
from app.models.task import Task
from app.users.schemas import UserSummary

ProjectName = Annotated[Trimmed, Field(min_length=1, max_length=80)]
ProjectKey = Annotated[str, Field(pattern=r"^[A-Z][A-Z0-9]{1,9}$")]
Description = Annotated[str, Field(max_length=2000)]
ColumnName = Annotated[Trimmed, Field(min_length=1, max_length=50)]
WipLimit = Annotated[JsonInt, Field(ge=1, le=999)]

class CreateProjectIn(CamelModel):
    name: ProjectName
    key: ProjectKey
    description: Description | None = None

class UpdateProjectIn(PatchModel):
    name: Annotated[ProjectName | None, NotNull] = None
    description: Description | None = None

class CreateColumnIn(CamelModel):
    name: ColumnName
    wip_limit: WipLimit | None = None

class UpdateColumnIn(PatchModel):
    name: Annotated[ColumnName | None, NotNull] = None
    wip_limit: WipLimit | None = None

class MoveColumnIn(CamelModel):
    # Required, but null is a value: "move to the first position". No default = required.
    after_column_id: UUID | None
```

**What's new**
- **Required but nullable:** `after_column_id: UUID | None` with **no default** must be present in the body, and `null` is a valid value ("first position"). A default of `None` would make it optional. Pydantic distinguishes the two cases by the default alone.
- **`WipLimit = Annotated[JsonInt, Field(ge=1, le=999)]`**: `JsonInt` (Step 3.2) refuses `"5"`, and `Field` adds the range.
- `description: Description | None = None` on create, and the same on update (no `NotNull`): `null` clears the description.

**`app/projects/schemas.py`** · continue

```python

class ProjectOut(CamelModel):
    id: UUID
    workspace_id: UUID
    name: str
    key: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, project: Project) -> Self:
        return cls(
            id=project.id,
            workspace_id=project.workspace_id,
            name=project.name,
            key=project.key,
            description=project.description,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )

class ColumnOut(CamelModel):
    id: UUID
    project_id: UUID
    name: str
    position: str
    wip_limit: int | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, column: BoardColumn) -> Self:
        return cls(
            id=column.id,
            project_id=column.project_id,
            name=column.name,
            position=column.position,
            wip_limit=column.wip_limit,
            created_at=column.created_at,
            updated_at=column.updated_at,
        )
```

**`app/projects/schemas.py`** · continue

```python

def task_relations() -> list[LoaderOption]:
    """The relationships TaskOut.of reads. Pass them to every query that feeds it: one JOIN,
    instead of one extra query per task (the N+1 problem) or an error (lazy="raise")."""
    return [joinedload(Task.project), joinedload(Task.assignee), joinedload(Task.reporter)]

class TaskOut(CamelModel):
    id: UUID
    key: str
    number: int
    project_id: UUID
    column_id: UUID
    title: str
    description: str | None
    priority: Priority
    assignee: UserSummary | None
    reporter: UserSummary
    due_at: datetime | None
    position: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, task: Task) -> Self:
        return cls(
            id=task.id,
            key=f"{task.project.key}-{task.number}",
            number=task.number,
            project_id=task.project_id,
            column_id=task.column_id,
            title=task.title,
            description=task.description,
            priority=task.priority,
            assignee=UserSummary.of(task.assignee) if task.assignee else None,
            reporter=UserSummary.of(task.reporter),
            due_at=task.due_at,
            position=task.position,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )

class BoardColumnOut(ColumnOut):
    tasks: list[TaskOut]

class BoardOut(CamelModel):
    project: ProjectOut
    columns: list[BoardColumnOut]
```

**What's new**
- **`task_relations()`** returns the loader options `TaskOut.of` needs (`project` for the key, `assignee`, `reporter`): every query that feeds `TaskOut` passes them with `.options(*task_relations())` (`*` spreads a list into arguments). One `JOIN` per relationship instead of a query per task.
- **`class BoardColumnOut(ColumnOut)`** adds `tasks` to a column: Pydantic models inherit fields, like TS interfaces `extends`.
- `key=f"{task.project.key}-{task.number}"`: the task key (`TF-42`) isn't stored, it's computed for every response.

**`app/projects/board_cache.py`** · new file

```python
from collections.abc import Awaitable
from collections.abc import Callable
from typing import Annotated
from uuid import UUID

from fastapi import Depends

from app.deps import RedisDep
from app.projects.schemas import BoardOut

TTL_SECONDS = 300

def _key(project_id: UUID) -> str:
    return f"cache:board:{project_id}"

class BoardCache:
    """Cache-aside: read through on a miss, delete after every write that changes the board."""

    def __init__(self, redis: RedisDep) -> None:
        self.redis = redis

    async def get_or_load(
        self, project_id: UUID, load: Callable[[], Awaitable[BoardOut]]
    ) -> BoardOut:
        cached = await self.redis.get(_key(project_id))
        if cached is not None:
            return BoardOut.model_validate_json(cached)
        board = await load()
        await self.redis.set(_key(project_id), board.model_dump_json(by_alias=True), ex=TTL_SECONDS)
        return board

    async def invalidate(self, project_id: UUID) -> None:
        await self.redis.delete(_key(project_id))

BoardCacheDep = Annotated[BoardCache, Depends()]
```

**What's new**
- **`Callable[[], Awaitable[BoardOut]]`** is the type of an async function with no arguments returning a `BoardOut`: TS's `() => Promise<BoardOut>`.
- **`board.model_dump_json(by_alias=True)`** serialises with camelCase keys (the same JSON a client receives), and **`BoardOut.model_validate_json(cached)`** parses and validates it back into a model. `ex=TTL_SECONDS` is `SET ... EX 300`.

> **🧠 DSA & scalability · Cache-aside for the board**
> - **Data structure:** Redis string `cache:board:{projectId}` holding the board's JSON, 5-minute TTL.
> - **Algorithm:** read → `GET`; hit → parse and return; miss → load columns and tasks from Postgres, `SET ... EX 300`, return. Every write that changes the board → `DEL` after commit.
> - **Complexity:** O(1) Redis round trip on a hit; the miss path is two indexed queries, O(columns + tasks).
> - **Why it scales:** the board is the hottest read (every viewer, every reconnect) and changes rarely compared with how often it's read; any instance can serve it from Redis. Deleting after commit (not before) means a reader can't re-cache stale data from a write that's still in flight… almost: the TTL bounds the rare race and the staleness from writes that don't invalidate (a user renaming themselves).
> - **Alternatives rejected:** an in-process cache (each instance would be stale differently); updating the cached JSON on every write (every write path would need to rebuild a board fragment correctly); no cache (fine at small scale; the board query joins three tables).

**`app/realtime/publisher.py`** · new file

```python
import json
from datetime import UTC
from datetime import datetime
from typing import Annotated
from typing import Any
from typing import Literal
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel

```

**`app/realtime/publisher.py`** · continue

```python
from app.core.schemas import CamelModel
from app.deps import RedisDep
```

**`app/realtime/publisher.py`** · continue

```python

type EventType = Literal[
    "task.created",
    "task.updated",
    "task.moved",
    "task.deleted",
    "column.created",
    "column.updated",
    "column.moved",
    "column.deleted",
    "comment.created",
    "presence.updated",
]

class ColumnDeleted(CamelModel):
    id: UUID
    project_id: UUID

class TaskDeleted(CamelModel):
    id: UUID
    project_id: UUID
    column_id: UUID
```

**`app/realtime/publisher.py`** · continue

```python

def project_channel(project_id: UUID | str) -> str:
    return f"project:{project_id}"

def envelope(type: str, payload: BaseModel | None = None) -> str:
    """`{ "type", "payload"?, "ts" }`, the JSON every message on the socket is wrapped in."""
    message: dict[str, Any] = {"type": type}
    if payload is not None:
        message["payload"] = payload.model_dump(mode="json", by_alias=True)
    message["ts"] = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return json.dumps(message)

class Publisher:
    """Publishes to Redis; every API instance's WebSocket hub relays to its own sockets."""

    def __init__(self, redis: RedisDep) -> None:
        self.redis = redis

    async def publish(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.redis.publish(project_channel(project_id), envelope(type, payload))

PublisherDep = Annotated[Publisher, Depends()]
```

**What's new**
- **`envelope`** builds the protocol's `{type, payload?, ts}` JSON. `payload.model_dump(mode="json", by_alias=True)` turns a model into plain JSON-ready data (UUIDs and datetimes become strings), and `json.dumps` writes it. `isoformat(timespec="milliseconds")` with `+00:00` replaced by `Z` is `new Date().toISOString()`.
- **Payload models** for events that aren't a whole resource (`ColumnDeleted`, `TaskDeleted`): typed, camelCase on the wire. Parts 8 and 10 add two more.
- **`redis.publish(channel, message)`** is fire-and-forget: every instance subscribed to `project:{id}` receives it (Part 10 subscribes).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 74 source files`.

**Commit:** `feat: project schemas, board cache and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** when two users drop into the same gap at once, retry the losing move instead of failing it.

**Files:** `app/db/errors.py`

**`app/db/errors.py`** · add at the top

```python
from collections.abc import Awaitable
from collections.abc import Callable

```

**`app/db/errors.py`** · add after `from sqlalchemy.exc import IntegrityError`

```python
from sqlalchemy.ext.asyncio import AsyncSession
```

**`app/db/errors.py`** · continue

```python

async def retry_on_position_conflict[T](
    session: AsyncSession, attempt: Callable[[], Awaitable[T]], max_attempts: int = 3
) -> T:
    """Two users dropping into the same gap at once compute the same position key, and the
    UNIQUE (parent, position) index rejects the second. Re-reading the neighbours fixes it.

    Each attempt runs inside a SAVEPOINT, so a failed one rolls back only itself, not the
    request's whole transaction."""
    tries = 0
    while True:
        tries += 1
        try:
            async with session.begin_nested():
                return await attempt()
        except IntegrityError as err:
            if not is_unique_violation(err) or tries >= max_attempts:
                raise
```

**What's new (TS → SQLAlchemy)**
- **`session.begin_nested()` is a SAVEPOINT.** Inside one transaction, `SAVEPOINT sp` marks a point you can roll back to without losing the rest. Each attempt runs inside one: a unique violation rolls back only that attempt (its position write and its activity row), and the retry recomputes the key from the *new* neighbours, still inside the request's transaction. NestJS retried a whole transaction; here the request's session is the transaction, so a savepoint is the natural unit.
- **`async with ...: return await attempt()`**: leaving the block normally releases the savepoint (flushing the attempt's writes first, which is where the unique violation surfaces).
- **A generic async function:** `retry_on_position_conflict[T]` returns whatever `attempt` returns, `<T>(attempt: () => Promise<T>) => Promise<T>`.
- `while True:` with a counter, and a bare `raise` re-raises the last error when it isn't ours to handle or the attempts are used up.

> **🧠 DSA & scalability · Optimistic retry on a unique index**
> - **Data structure:** the unique B-tree index `(project_id, position)` on columns (`(column_id, position)` on tasks).
> - **Algorithm:** compute the key from the neighbours you read, write it; if another transaction committed the same key first, the index rejects yours → roll back to the savepoint, re-read the neighbours (which now include the winner), compute a key between them, try again (max 3 attempts).
> - **Complexity:** one extra round of reads and a write per conflict; conflicts need two drops into the same gap within milliseconds, so retries are rare.
> - **Why it scales:** no lock is taken on the neighbours, so moves in different gaps or columns never wait for each other; the index is the referee.
> - **Alternatives rejected:** `SELECT ... FOR UPDATE` on the column's tasks (serialises every move in the column); ignoring the race (two tasks with the same key: an unstable order).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 74 source files`.

**Commit:** `feat: retry position conflicts inside a savepoint`

### Step 6.4 · The projects service and the board

**Goal:** list, create (with the three default columns), read, update and delete projects, and build the board.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/projects/service.py`

**`app/access/service.py`** · add after `from app.deps import SessionDep`

```python
from app.models.project import Project
```

**`app/access/service.py`** · add after `return membership`

```python

    async def project(
        self, project_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[Project, WorkspaceMember]:
        project = await self.session.get(Project, project_id)
        if project is None:
            raise not_found("Project")
        return project, await self.member(project.workspace_id, user_id, minimum, "Project")
```

**`app/core/params.py`** · continue

```python
ProjectId = Annotated[UUID, Path(alias="projectId")]
```

**What's new**
- **`session.get(Project, project_id)`** loads by primary key, and checks the session's **identity map** first: within one request, the same row is the same Python object, however many times it's loaded.
- `return project, await self.member(...)`: a tuple of the project and the membership; callers unpack what they need (`project, _ = ...`).

**`app/projects/service.py`** · new file

```python
from collections import defaultdict
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.fractional_index import key_between
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.db.errors import is_unique_violation
from app.deps import JobsDep
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.models.project import Project
from app.models.task import Task
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import BoardColumnOut
from app.projects.schemas import BoardOut
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateProjectIn
from app.projects.schemas import ProjectOut
from app.projects.schemas import TaskOut
from app.projects.schemas import UpdateProjectIn
from app.projects.schemas import task_relations

DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"]
```

**`app/projects/service.py`** · continue

```python

class ProjectsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.jobs = jobs

    async def list(self, workspace_id: UUID, user_id: UUID, page: PageQuery) -> Page[ProjectOut]:
        await self.access.member(workspace_id, user_id)
        query = select(Project).where(Project.workspace_id == workspace_id)
        query = keyset(query, Project.id, descending=True, limit=page.limit, after=after_id(page))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, ProjectOut.of, lambda p: {"id": str(p.id)})

    async def create(self, workspace_id: UUID, user_id: UUID, body: CreateProjectIn) -> ProjectOut:
        await self.access.member(workspace_id, user_id, "admin")
        project = Project(
            workspace_id=workspace_id,
            name=body.name,
            key=body.key,
            description=body.description,
            created_by=user_id,
        )
        try:
            self.session.add(project)
            await self.session.flush()
            position = None
            for name in DEFAULT_COLUMNS:
                position = key_between(position, None)
                self.session.add(BoardColumn(project_id=project.id, name=name, position=position))
            self.activity.record(
                workspace_id=workspace_id,
                actor_id=user_id,
                project_id=project.id,
                type="project.created",
                data={"name": project.name, "key": project.key},
            )
            await self.session.commit()
        except IntegrityError as err:
            if is_unique_violation(err):
                raise conflict("Project key is already used in this workspace") from err
            raise
        return ProjectOut.of(project)
```

**What's new**
- **Default columns in the same transaction:** the project is flushed (so its id exists), then three `BoardColumn` rows are added with consecutive keys (`a0`, `a1`, `a2`) from `key_between(previous, None)`. One commit writes the project, the columns and the activity event, or none of them.
- `position = None` then reassigned in the loop: Python variables have no declared type at runtime; mypy infers `str | None` from the two assignments.

**`app/projects/service.py`** · continue

```python

    async def get(self, project_id: UUID, user_id: UUID) -> ProjectOut:
        project, _ = await self.access.project(project_id, user_id)
        return ProjectOut.of(project)

    async def update(self, project_id: UUID, user_id: UUID, body: UpdateProjectIn) -> ProjectOut:
        project, _ = await self.access.project(project_id, user_id, "admin")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(project, field, value)
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project_id,
            type="project.updated",
            data=body.model_dump(mode="json", by_alias=True, exclude_unset=True),
        )
        await self.session.commit()
        await self.cache.invalidate(project_id)
        return ProjectOut.of(project)

    async def delete(self, project_id: UUID, user_id: UUID) -> None:
        project, _ = await self.access.project(project_id, user_id, "admin")
        await self.session.execute(delete(Project).where(Project.id == project_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project_id,
            type="project.deleted",
            data={"name": project.name, "key": project.key},
        )
        await self.session.commit()
        await self.cache.invalidate(project_id)
        await self.jobs.delete_storage_prefix(f"projects/{project_id}/")
```

**What's new**
- **After the commit:** invalidate the cache (update, delete) and enqueue the storage cleanup (delete). The order is the same in every service: commit, then side effects.

**`app/projects/service.py`** · continue

```python

    async def board(self, project_id: UUID, user_id: UUID) -> BoardOut:
        project, _ = await self.access.project(project_id, user_id)

        async def load() -> BoardOut:
            # Two queries, one after the other: a session runs one statement at a time.
            columns = await self.session.scalars(
                select(BoardColumn)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position)
            )
            tasks = await self.session.scalars(
                select(Task)
                .options(*task_relations())
                .where(Task.project_id == project_id)
                .order_by(Task.position)
            )
            by_column: defaultdict[UUID, list[TaskOut]] = defaultdict(list)
            for task in tasks:
                by_column[task.column_id].append(TaskOut.of(task))
            return BoardOut(
                project=ProjectOut.of(project),
                columns=[
                    BoardColumnOut(**ColumnOut.of(c).model_dump(), tasks=by_column[c.id])
                    for c in columns
                ],
            )

        return await self.cache.get_or_load(project_id, load)

ProjectsServiceDep = Annotated[ProjectsService, Depends()]
```

**What's new**
- **A closure as the loader:** `async def load()` inside `board` captures `project` and `project_id`, and is passed to `cache.get_or_load(...)` uncalled: it only runs on a cache miss.
- **Two queries, one after the other.** NestJS ran the columns and tasks queries in parallel with `Promise.all`; one `AsyncSession` runs one statement at a time (it holds one connection), so here they're sequential. Two sessions could run them in parallel, at the cost of two pool connections per board read; on a cache-aside path that's rarely worth it.
- **`defaultdict(list)`** is a dict that creates an empty list the first time a missing key is read, so `by_column[task.column_id].append(...)` needs no "if missing" check. `Map.groupBy` in one line.
- **`BoardColumnOut(**ColumnOut.of(c).model_dump(), tasks=...)`**: build the column's fields once, then add `tasks`.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 75 source files`.

**Commit:** `feat: projects service with default columns and the cached board`

### Step 6.5 · The columns service

**Goal:** add, rename, move and delete columns; every write invalidates the board and publishes an event.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/projects/columns.py`

**`app/access/service.py`** · add after `from sqlalchemy import select`

```python
from sqlalchemy.orm import joinedload
```

**`app/access/service.py`** · add after `from app.deps import SessionDep`

```python
from app.models.project import BoardColumn
```

**`app/access/service.py`** · add after `return project, await self.member(project.workspace_id, user_id, minimum, "Project")`

```python

    async def column(
        self, column_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[BoardColumn, Project, WorkspaceMember]:
        column = await self.session.scalar(
            select(BoardColumn)
            .options(joinedload(BoardColumn.project))
            .where(BoardColumn.id == column_id)
        )
        if column is None:
            raise not_found("Column")
        membership = await self.member(column.project.workspace_id, user_id, minimum, "Column")
        return column, column.project, membership
```

**`app/core/params.py`** · continue

```python
ColumnId = Annotated[UUID, Path(alias="columnId")]
```

**`app/projects/columns.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.core.fractional_index import key_between
from app.core.problems import conflict
from app.core.problems import invalid
from app.db.errors import is_foreign_key_violation
from app.db.errors import retry_on_position_conflict
from app.deps import SessionDep
from app.models.project import BoardColumn
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateColumnIn
from app.projects.schemas import UpdateColumnIn
from app.realtime.publisher import ColumnDeleted
from app.realtime.publisher import EventType
from app.realtime.publisher import PublisherDep

class ColumnsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        publisher: PublisherDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.publisher = publisher
```

**`app/projects/columns.py`** · continue

```python

    async def create(self, project_id: UUID, user_id: UUID, body: CreateColumnIn) -> ColumnOut:
        project, _ = await self.access.project(project_id, user_id, "admin")

        async def attempt() -> BoardColumn:
            last = await self.session.scalar(
                select(BoardColumn.position)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position.desc())
                .limit(1)
            )
            column = BoardColumn(
                project_id=project_id,
                name=body.name,
                wip_limit=body.wip_limit,
                position=key_between(last, None),
            )
            self.session.add(column)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project_id,
                type="column.created",
                data={"columnId": str(column.id), "name": column.name},
            )
            return column

        column = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = ColumnOut.of(column)
        await self._after_write(project_id, "column.created", out)
        return out
```

**What's new**
- **The attempt is a closure** that reads the last position, builds the column and records the activity; `retry_on_position_conflict` runs it in a savepoint, retrying on a duplicate position. **`.limit(1)` + `session.scalar(...)`** reads one value (`ORDER BY position DESC LIMIT 1`).
- **Commit, then `_after_write`:** invalidate the board and publish `column.created` with the same payload the client receives.

**`app/projects/columns.py`** · continue

```python

    async def update(self, column_id: UUID, user_id: UUID, body: UpdateColumnIn) -> ColumnOut:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(column, field, value)
        changes = body.model_dump(mode="json", by_alias=True, exclude_unset=True)
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            type="column.updated",
            data={"columnId": str(column_id), **changes},
        )
        await self.session.commit()
        out = ColumnOut.of(column)
        await self._after_write(project.id, "column.updated", out)
        return out

    async def move(self, column_id: UUID, user_id: UUID, after_column_id: UUID | None) -> ColumnOut:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        if after_column_id == column_id:
            raise invalid("afterColumnId", "cannot place a column after itself")

        async def attempt() -> BoardColumn:
            column.position = await self._position_after(project.id, column_id, after_column_id)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project.id,
                type="column.moved",
                data={
                    "columnId": str(column_id),
                    "afterColumnId": str(after_column_id) if after_column_id else None,
                },
            )
            return column

        moved = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = ColumnOut.of(moved)
        await self._after_write(project.id, "column.moved", out)
        return out
```

**What's new**
- **Moving a column** computes a key between the column it should follow (`after_column_id`, or the start) and the next column after that one, ignoring the column being moved. Only the moved row changes.
- `"afterColumnId": str(after_column_id) if after_column_id else None`: values in the JSONB activity data must be JSON types, so UUIDs become strings. (`x if cond else y` is the ternary.)

**`app/projects/columns.py`** · continue

```python

    async def delete(self, column_id: UUID, user_id: UUID) -> None:
        column, project, _ = await self.access.column(column_id, user_id, "admin")
        try:
            await self.session.execute(delete(BoardColumn).where(BoardColumn.id == column_id))
        except IntegrityError as err:
            # tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
            if is_foreign_key_violation(err):
                raise conflict("Move or delete the tasks in this column first") from err
            raise
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            type="column.deleted",
            data={"columnId": str(column_id), "name": column.name},
        )
        await self.session.commit()
        await self._after_write(
            project.id, "column.deleted", ColumnDeleted(id=column_id, project_id=project.id)
        )

    async def _position_after(
        self, project_id: UUID, column_id: UUID, after_id: UUID | None
    ) -> str:
        lower = None
        if after_id is not None:
            after = await self.session.get(BoardColumn, after_id)
            if after is None or after.project_id != project_id:
                raise invalid("afterColumnId", "must be a column of the same project")
            lower = after.position
        query = (
            select(BoardColumn.position)
            .where(BoardColumn.project_id == project_id, BoardColumn.id != column_id)
            .order_by(BoardColumn.position)
            .limit(1)
        )
        if lower is not None:
            query = query.where(BoardColumn.position > lower)
        return key_between(lower, await self.session.scalar(query))

    async def _after_write(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.cache.invalidate(project_id)
        await self.publisher.publish(project_id, type, payload)

ColumnsServiceDep = Annotated[ColumnsService, Depends()]
```

**What's new**
- **Postgres refuses to delete a column that still has tasks** (`tasks.column_id` has no `ON DELETE`): the `DELETE` raises `IntegrityError` with SQLSTATE 23503, which becomes a 409 with a helpful message. No count query, no race between counting and deleting.
- Methods starting with `_` are private by convention, like `#private` in TS (but nothing enforces it).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 76 source files`.

**Commit:** `feat: columns service with fractional moves`

### Step 6.6 · The router, the wiring and tests

**Goal:** the project and column routes, and tests for default columns, keys, RBAC, cascades and column moves.

**Files:** `app/projects/router.py`, `app/main.py`, `tests/helpers.py`, `tests/test_projects.py`

**`app/projects/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import ColumnId
from app.core.params import ProjectId
from app.core.params import WorkspaceId
from app.projects.columns import ColumnsServiceDep
from app.projects.schemas import BoardOut
from app.projects.schemas import ColumnOut
from app.projects.schemas import CreateColumnIn
from app.projects.schemas import CreateProjectIn
from app.projects.schemas import MoveColumnIn
from app.projects.schemas import ProjectOut
from app.projects.schemas import UpdateColumnIn
from app.projects.schemas import UpdateProjectIn
from app.projects.service import ProjectsServiceDep

router = APIRouter(tags=["projects"])

@router.get("/workspaces/{workspaceId}/projects")
async def list_projects(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    projects: ProjectsServiceDep,
) -> Page[ProjectOut]:
    return await projects.list(workspace_id, user_id, page)

@router.post("/workspaces/{workspaceId}/projects", status_code=201)
async def create_project(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    body: CreateProjectIn,
    projects: ProjectsServiceDep,
) -> ProjectOut:
    return await projects.create(workspace_id, user_id, body)
```

**`app/projects/router.py`** · continue

```python

@router.get("/projects/{projectId}")
async def get_project(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> ProjectOut:
    return await projects.get(project_id, user_id)

@router.patch("/projects/{projectId}")
async def update_project(
    project_id: ProjectId, user_id: CurrentUser, body: UpdateProjectIn, projects: ProjectsServiceDep
) -> ProjectOut:
    return await projects.update(project_id, user_id, body)

@router.delete("/projects/{projectId}", status_code=204)
async def delete_project(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> None:
    await projects.delete(project_id, user_id)

@router.get("/projects/{projectId}/board")
async def get_board(
    project_id: ProjectId, user_id: CurrentUser, projects: ProjectsServiceDep
) -> BoardOut:
    return await projects.board(project_id, user_id)

@router.post("/projects/{projectId}/columns", status_code=201)
async def create_column(
    project_id: ProjectId, user_id: CurrentUser, body: CreateColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.create(project_id, user_id, body)

@router.patch("/columns/{columnId}")
async def update_column(
    column_id: ColumnId, user_id: CurrentUser, body: UpdateColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.update(column_id, user_id, body)

@router.delete("/columns/{columnId}", status_code=204)
async def delete_column(
    column_id: ColumnId, user_id: CurrentUser, columns: ColumnsServiceDep
) -> None:
    await columns.delete(column_id, user_id)

@router.post("/columns/{columnId}/move")
async def move_column(
    column_id: ColumnId, user_id: CurrentUser, body: MoveColumnIn, columns: ColumnsServiceDep
) -> ColumnOut:
    return await columns.move(column_id, user_id, body.after_column_id)
```

**`app/main.py`** · add after `from app.infra.resources import open_resources`

```python
from app.projects.router import router as projects_router
```

**`app/main.py`** · add after `protected.include_router(workspaces_router)`

```python
    protected.include_router(projects_router)
```

**`tests/helpers.py`** · continue

```python

@dataclass(frozen=True)
class Fixture(WorkspaceFixture):
    project_id: str
    column_ids: list[str]

async def create_fixture(client: AsyncClient) -> Fixture:
    """A workspace plus a project, which comes with 3 default columns."""
    ws = await create_workspace(client)
    url = f"/api/v1/workspaces/{ws.workspace_id}/projects"
    body = {"name": "TaskFlow", "key": "TF"}
    res = await send(client, "POST", url, user=ws.owner, json=body, status=201)
    project_id = res.json()["id"]
    board = await send(client, "GET", f"/api/v1/projects/{project_id}/board", user=ws.owner)
    column_ids = [c["id"] for c in board.json()["columns"]]
    return Fixture(ws.owner, ws.workspace_id, project_id, column_ids)
```

**What's new**
- **`@dataclass(frozen=True) class Fixture(WorkspaceFixture)`**: a dataclass can extend another, adding fields after the parent's. `Fixture(ws.owner, ws.workspace_id, project_id, column_ids)` passes them positionally, in declaration order.

**`tests/test_projects.py`** · new file

```python
import pytest
from httpx import AsyncClient

from app.infra.resources import Resources
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import send

@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)

async def column_names(client: AsyncClient, f: Fixture) -> list[str]:
    res = await send(
        client, "GET", f"/api/v1/projects/{f.project_id}/board", user=f.owner, status=200
    )
    return [c["name"] for c in res.json()["columns"]]

async def test_three_default_columns_and_a_duplicate_key_is_409(
    client: AsyncClient, f: Fixture
) -> None:
    assert await column_names(client, f) == ["To Do", "In Progress", "Done"]
    url = f"/api/v1/workspaces/{f.workspace_id}/projects"
    await send(client, "POST", url, user=f.owner, json={"name": "Again", "key": "TF"}, status=409)

async def test_projects_newest_first_and_updated_with_merge_patch(
    client: AsyncClient, f: Fixture
) -> None:
    projects = f"/api/v1/workspaces/{f.workspace_id}/projects"
    body = {"name": "Second", "key": "SEC", "description": "Another one"}
    await send(client, "POST", projects, user=f.owner, json=body, status=201)
    listed = await send(client, "GET", projects, user=f.owner, status=200)
    assert [p["key"] for p in listed.json()["items"]] == ["SEC", "TF"]
    patch = {"description": None, "name": "TaskFlow v2"}
    res = await send(
        client, "PATCH", f"/api/v1/projects/{f.project_id}", user=f.owner, json=patch, status=200
    )
    assert (res.json()["name"], res.json()["description"], res.json()["key"]) == (
        "TaskFlow v2",
        None,
        "TF",
    )

async def test_project_and_column_management_is_for_admins(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    project = f"/api/v1/projects/{f.project_id}"
    await send(client, "GET", project, user=member, status=200)
    await send(client, "POST", f"{project}/columns", user=member, json={"name": "Nope"}, status=403)
    await send(client, "DELETE", project, user=member, status=403)

async def test_a_workspace_delete_cascades_to_its_projects(client: AsyncClient, f: Fixture) -> None:
    await send(client, "DELETE", f"/api/v1/workspaces/{f.workspace_id}", user=f.owner, status=204)
    await send(client, "GET", f"/api/v1/projects/{f.project_id}", user=f.owner, status=404)

async def test_columns_are_added_renamed_reordered_and_deleted(
    client: AsyncClient, f: Fixture
) -> None:
    body = {"name": "Review", "wipLimit": 3}
    url = f"/api/v1/projects/{f.project_id}/columns"
    created = await send(client, "POST", url, user=f.owner, json=body, status=201)
    column = f"/api/v1/columns/{created.json()['id']}"
    assert await column_names(client, f) == ["To Do", "In Progress", "Done", "Review"]

    await send(client, "PATCH", column, user=f.owner, json={"name": "QA"}, status=200)
    await send(
        client, "POST", f"{column}/move", user=f.owner, json={"afterColumnId": None}, status=200
    )
    assert await column_names(client, f) == ["QA", "To Do", "In Progress", "Done"]

    after = {"afterColumnId": f.column_ids[1]}
    await send(client, "POST", f"{column}/move", user=f.owner, json=after, status=200)
    assert await column_names(client, f) == ["To Do", "In Progress", "QA", "Done"]

    await send(client, "DELETE", column, user=f.owner, status=204)
    assert await column_names(client, f) == ["To Do", "In Progress", "Done"]

async def test_move_requires_after_column_id_and_wip_limit_is_a_json_integer(
    client: AsyncClient, f: Fixture
) -> None:
    column = f"/api/v1/columns/{f.column_ids[0]}"
    res = await send(client, "POST", f"{column}/move", user=f.owner, json={}, status=422)
    assert res.json()["errors"][0]["field"] == "afterColumnId"
    res = await send(client, "PATCH", column, user=f.owner, json={"wipLimit": "5"}, status=422)
    assert res.json()["errors"][0]["field"] == "wipLimit"
```

**What's new**
- **A fixture per test file:** `f` builds a fresh workspace + project for each test that asks for it. It depends on `client`, so the database is reset first.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `47 passed`.

**Commit:** `feat: project and column routes`

---
## Part 7 · Tasks

### Step 7.1 · Schemas, types and the filtered list

**Goal:** the task request models, the access check for a task, and the filtered, paginated task list.

**Files:** `app/tasks/__init__.py`, `app/tasks/schemas.py`, `app/access/service.py`, `app/core/params.py`, `app/tasks/service.py`

```bash
mkdir app/tasks && touch app/tasks/__init__.py
```

**`app/tasks/schemas.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from pydantic import Field

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.core.schemas import NotNull
from app.core.schemas import PatchModel
from app.core.schemas import Timestamp
from app.core.schemas import Trimmed
from app.models.task import Priority

Title = Annotated[Trimmed, Field(min_length=1, max_length=200)]
Description = Annotated[str, Field(max_length=10_000)]
UUID_OR_NONE = (
    r"^(none|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$"
)

class ListTasksQuery(PageQuery):
    column_id: UUID | None = None
    # A UUID, or the literal "none" for unassigned tasks. One pattern gives one clear error.
    assignee_id: Annotated[str, Field(pattern=UUID_OR_NONE)] | None = None
    priority: Priority | None = None
    due_before: Timestamp | None = None

class CreateTaskIn(CamelModel):
    title: Title
    description: Description | None = None
    column_id: Annotated[UUID | None, NotNull] = None
    priority: Priority = "medium"
    assignee_id: UUID | None = None
    due_at: Timestamp | None = None

class UpdateTaskIn(PatchModel):
    title: Annotated[Title | None, NotNull] = None
    description: Description | None = None
    priority: Annotated[Priority | None, NotNull] = None
    assignee_id: UUID | None = None
    due_at: Timestamp | None = None

class MoveTaskIn(CamelModel):
    column_id: UUID
    # Required, but null is a value: "move to the top of the column".
    after_task_id: UUID | None
```

**What's new**
- **`class ListTasksQuery(PageQuery)`** extends the pagination query with filters: a subclass of a Pydantic model inherits its fields. `?columnId=…&priority=high&limit=5` arrives as one validated object.
- **`assignee_id`** is a UUID *or* the literal `none`. A `UUID | Literal["none"]` union would work, but a failure would be reported once per union member (`query.assigneeId.uuid`, `query.assigneeId.literal['none']`); one regex gives one clear error, and the service converts.
- **`due_before: Timestamp | None`**: the query string is text either way, and `Timestamp` still demands a timezone.
- **`column_id: Annotated[UUID | None, NotNull] = None`** on create: omit it for the first column, but `null` is refused (a task always has a column). `priority: Priority = "medium"` is a plain default.
- **`MoveTaskIn.after_task_id`** is required and nullable, like `afterColumnId`.

**`app/access/service.py`** · add after `from app.models.project import Project`

```python
from app.models.task import Task
```

**`app/access/service.py`** · add after `return column, column.project, membership`

```python

    async def task(
        self, task_id: UUID, user_id: UUID, minimum: Role = "viewer"
    ) -> tuple[Task, Project, WorkspaceMember]:
        task = await self.session.scalar(
            select(Task).options(joinedload(Task.project)).where(Task.id == task_id)
        )
        if task is None:
            raise not_found("Task")
        membership = await self.member(task.project.workspace_id, user_id, minimum, "Task")
        return task, task.project, membership
```

**`app/core/params.py`** · continue

```python
TaskId = Annotated[UUID, Path(alias="taskId")]
```

**`app/tasks/service.py`** · new file

```python
from typing import Annotated
```

**`app/tasks/service.py`** · continue

```python
from uuid import UUID

from fastapi import Depends
```

**`app/tasks/service.py`** · continue

```python
from sqlalchemy import select
```

**`app/tasks/service.py`** · continue

```python

from app.access.service import AccessDep
from app.activity.service import ActivityDep
```

**`app/tasks/service.py`** · continue

```python
from app.core.pagination import Page
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
```

**`app/tasks/service.py`** · continue

```python
from app.core.problems import not_found
```

**`app/tasks/service.py`** · continue

```python
from app.deps import JobsDep
from app.deps import SessionDep
```

**`app/tasks/service.py`** · continue

```python
from app.models.task import Task
```

**`app/tasks/service.py`** · continue

```python
from app.projects.board_cache import BoardCacheDep
from app.projects.schemas import TaskOut
from app.projects.schemas import task_relations
```

**`app/tasks/service.py`** · continue

```python
from app.realtime.publisher import PublisherDep
```

**`app/tasks/service.py`** · continue

```python
from app.tasks.schemas import ListTasksQuery
```

**`app/tasks/service.py`** · continue

```python

```

**`app/tasks/service.py`** · continue

```python
class TasksService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        cache: BoardCacheDep,
        publisher: PublisherDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.cache = cache
        self.publisher = publisher
        self.jobs = jobs

    async def list(self, project_id: UUID, user_id: UUID, q: ListTasksQuery) -> Page[TaskOut]:
        await self.access.project(project_id, user_id)
        query = select(Task).options(*task_relations()).where(Task.project_id == project_id)
        # Each filter adds a WHERE clause; values are bound parameters, never pasted into the SQL.
        if q.column_id is not None:
            query = query.where(Task.column_id == q.column_id)
        if q.assignee_id == "none":
            query = query.where(Task.assignee_id.is_(None))
        elif q.assignee_id is not None:
            query = query.where(Task.assignee_id == UUID(q.assignee_id))
        if q.priority is not None:
            query = query.where(Task.priority == q.priority)
        if q.due_before is not None:
            query = query.where(Task.due_at < q.due_before)
        query = keyset(query, Task.id, descending=True, limit=q.limit, after=after_id(q))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, q.limit, TaskOut.of, lambda t: {"id": str(t.id)})

    async def get(self, task_id: UUID, user_id: UUID) -> TaskOut:
        await self.access.task(task_id, user_id)
        return TaskOut.of(await self._load(task_id))
```

**`app/tasks/service.py`** · continue

```python

    async def _load(self, task_id: UUID) -> Task:
        task = await self.session.scalar(
            select(Task).options(*task_relations()).where(Task.id == task_id)
        )
        if task is None:
            raise not_found("Task")
        return task
```

**`app/tasks/service.py`** · continue

```python

TasksServiceDep = Annotated[TasksService, Depends()]
```

**What's new (TS → SQLAlchemy)**
- **Building a query step by step:** `query = query.where(...)` adds a condition for each filter that was given. Every value is a **bound parameter**, sent separately from the SQL text, so nothing the user typed is ever parsed as SQL.
- `Task.assignee_id.is_(None)` is `IS NULL` (`= NULL` is never true in SQL).
- **`.options(*task_relations())`** joins the project, assignee and reporter, so `TaskOut.of` has everything it reads in one query.
- **`_load`** reloads a task with its relationships: every method that returns a task ends with it.

> **🧠 DSA & scalability · Filtered keyset lists**
> - **Data structure:** B-tree indexes `(project_id, id)` and `(assignee_id, id)` on `tasks`.
> - **Algorithm:** `WHERE project_id = $1 [AND filters] AND id < $cursor ORDER BY id DESC LIMIT n + 1`. The planner walks `(project_id, id)` backwards from the cursor and applies the other filters to each row it reads.
> - **Complexity:** O(log N + rows examined); with a selective filter (one assignee), Postgres can switch to `(assignee_id, id)` instead.
> - **Why it scales:** no page ever costs more because it's deep, and the planner picks the index that matches the filter.
> - **Alternatives rejected:** an index per filter combination (indexes cost every write); filtering in Python after a broad query (moves the whole project's tasks over the network).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

**Commit:** `feat: task schemas and the filtered task list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** create a task at the bottom of its column, with the next per-project number, safely under concurrency.

**Files:** `app/tasks/service.py`

First the helpers `create` needs (they go at the end of the class), then `create` itself:

**`app/tasks/service.py`** · add after `from fastapi import Depends`

```python
from pydantic import BaseModel
```

**`app/tasks/service.py`** · add after `from pydantic import BaseModel`

```python
from sqlalchemy import exists
```

**`app/tasks/service.py`** · add after `from sqlalchemy import select`

```python
from sqlalchemy import update
```

**`app/tasks/service.py`** · add after `from app.activity.service import ActivityDep`

```python
from app.core.fractional_index import key_between
```

**`app/tasks/service.py`** · add after `from app.core.pagination import to_page`

```python
from app.core.problems import invalid
```

**`app/tasks/service.py`** · add after `from app.core.problems import not_found`

```python
from app.db.errors import retry_on_position_conflict
```

**`app/tasks/service.py`** · add after `from app.deps import SessionDep`

```python
from app.models.project import BoardColumn
from app.models.project import Project
```

**`app/tasks/service.py`** · add after `from app.models.task import Task`

```python
from app.models.workspace import WorkspaceMember
```

**`app/tasks/service.py`** · add after `from app.projects.schemas import task_relations`

```python
from app.realtime.publisher import EventType
```

**`app/tasks/service.py`** · add after `from app.realtime.publisher import PublisherDep`

```python
from app.tasks.schemas import CreateTaskIn
```

**`app/tasks/service.py`** · add after `return task`

```python

    async def _resolve_column(self, project_id: UUID, column_id: UUID | None) -> UUID:
        if column_id is None:
            first = await self.session.scalar(
                select(BoardColumn.id)
                .where(BoardColumn.project_id == project_id)
                .order_by(BoardColumn.position)
                .limit(1)
            )
            if first is None:
                raise invalid("columnId", "the project has no columns")
            return first
        column = await self.session.get(BoardColumn, column_id)
        if column is None or column.project_id != project_id:
            raise invalid("columnId", "must be a column of this project")
        return column.id

    async def _assert_assignable(self, workspace_id: UUID, assignee_id: UUID) -> None:
        is_member = await self.session.scalar(
            select(
                exists().where(
                    WorkspaceMember.workspace_id == workspace_id,
                    WorkspaceMember.user_id == assignee_id,
                )
            )
        )
        if not is_member:
            raise invalid("assigneeId", "must be a member of the workspace")

    async def _after_write(self, project_id: UUID, type: EventType, payload: BaseModel) -> None:
        await self.cache.invalidate(project_id)
        await self.publisher.publish(project_id, type, payload)
```

**What's new**
- **`_resolve_column`** picks the project's first column when none is given, and refuses a column from another project with a 422 on `columnId`.
- **`_assert_assignable`** runs `SELECT EXISTS (...)`: an assignee must be a member of the workspace.

**`app/tasks/service.py`** · add after `return TaskOut.of(await self._load(task_id))`

```python

    async def create(self, project_id: UUID, user_id: UUID, body: CreateTaskIn) -> TaskOut:
        project, _ = await self.access.project(project_id, user_id, "member")
        if body.assignee_id is not None:
            await self._assert_assignable(project.workspace_id, body.assignee_id)

        async def attempt() -> Task:
            # Row-locks the project, so concurrent creates queue up here. Everything below then
            # sees the previous creator's committed task (READ COMMITTED reads per statement).
            number = await self.session.scalar(
                update(Project)
                .where(Project.id == project_id)
                .values(next_task_number=Project.next_task_number + 1)
                .returning(Project.next_task_number - 1)
                .execution_options(synchronize_session=False)
            )
            column_id = await self._resolve_column(project_id, body.column_id)
            last = await self.session.scalar(
                select(Task.position)
                .where(Task.column_id == column_id)
                .order_by(Task.position.desc())
                .limit(1)
            )
            task = Task(
                project_id=project_id,
                column_id=column_id,
                number=number,
                title=body.title,
                description=body.description,
                priority=body.priority,
                assignee_id=body.assignee_id,
                reporter_id=user_id,
                due_at=body.due_at,
                position=key_between(last, None),
            )
            self.session.add(task)
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project_id,
                task_id=task.id,
                type="task.created",
                data={"key": f"{project.key}-{task.number}", "title": task.title},
            )
            return task

        task = await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = TaskOut.of(await self._load(task.id))
        await self._after_write(project_id, "task.created", out)
        return out
```

**What's new (TS → SQLAlchemy)**
- **`update(Project).where(...).values(next_task_number=Project.next_task_number + 1).returning(Project.next_task_number - 1)`** is `UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = $1 RETURNING next_task_number - 1`: arithmetic on columns builds SQL, and `session.scalar` reads the one returned value. **`synchronize_session=False`** tells SQLAlchemy not to update the `Project` object already loaded in this session (we don't read the counter from it).
- **The counter's `UPDATE` takes a row lock** on the project until the request commits, so concurrent creates in the same project queue up there, and each later statement sees the previous creator's committed task. Creates in different projects don't wait for each other.
- **The whole attempt runs in a savepoint** (Step 6.3): if two creates still collide on the position, only the attempt rolls back (counter increment included) and retries.

> **🧠 DSA & scalability · A per-project counter with a row lock**
> - **Data structure:** one integer column, `projects.next_task_number`, and a unique index `(project_id, number)` as a safety net.
> - **Algorithm:** `UPDATE ... SET n = n + 1 ... RETURNING n - 1` reads and increments atomically while holding the row's lock until commit; the task is inserted with that number.
> - **Complexity:** O(1); contention only between creates in the *same* project, which serialise for the length of one short transaction.
> - **Why it scales:** numbers are dense and per-project (`TF-1`, `TF-2`, …) with no gaps from failed reads, and the lock is one row, not a table.
> - **Alternatives rejected:** `MAX(number) + 1` (two creates read the same max: duplicates); a global sequence (fast, but numbers wouldn't be per-project); an advisory lock (works, but invisible in the schema).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

**Commit:** `feat: create tasks with per-project numbers`

### Step 7.3 · Update, move and delete

**Goal:** edit a task's fields with an activity record of what changed, move it between columns with one row write, and delete it.

**Files:** `app/tasks/service.py`

**`app/tasks/service.py`** · add at the top

```python
from datetime import datetime
```

**`app/tasks/service.py`** · add after `from typing import Annotated`

```python
from typing import Any
```

**`app/tasks/service.py`** · add after `from pydantic import BaseModel`

```python
from pydantic.alias_generators import to_camel
from sqlalchemy import delete
```

**`app/tasks/service.py`** · add after `from app.realtime.publisher import PublisherDep`

```python
from app.realtime.publisher import TaskDeleted
```

**`app/tasks/service.py`** · add after `from app.tasks.schemas import ListTasksQuery`

```python
from app.tasks.schemas import MoveTaskIn
from app.tasks.schemas import UpdateTaskIn
```

**`app/tasks/service.py`** · add before `class TasksService:`

```python
def _json(value: Any) -> Any:
    """A value as it appears in the activity log's JSON."""
    if isinstance(value, datetime):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, UUID):
        return str(value)
    return value

```

**`app/tasks/service.py`** · add after `return out`

```python

    async def update(self, task_id: UUID, user_id: UUID, body: UpdateTaskIn) -> TaskOut:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        values = body.model_dump(exclude_unset=True)
        if values.get("assignee_id") is not None:
            await self._assert_assignable(project.workspace_id, values["assignee_id"])
        changes: dict[str, dict[str, Any]] = {}
        for field, to in values.items():
            before = getattr(task, field)
            if before != to:
                changes[to_camel(field)] = {"from": _json(before), "to": _json(to)}
            setattr(task, field, to)
        if "dueAt" in changes:
            task.reminder_sent_at = None  # a new due date deserves a new reminder
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="task.updated",
            data={"changes": changes},
        )
        await self.session.commit()
        out = TaskOut.of(await self._load(task_id))
        await self._after_write(project.id, "task.updated", out)
        return out

    async def move(self, task_id: UUID, user_id: UUID, body: MoveTaskIn) -> TaskOut:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        if body.after_task_id == task_id:
            raise invalid("afterTaskId", "cannot place a task after itself")
        from_column_id = task.column_id

        async def attempt() -> None:
            column = await self.session.get(BoardColumn, body.column_id)
            if column is None or column.project_id != project.id:
                raise invalid("columnId", "must be a column of the same project")
            lower = None
            if body.after_task_id is not None:
                after = await self.session.get(Task, body.after_task_id)
                if after is None or after.column_id != body.column_id:
                    raise invalid("afterTaskId", "must be a task in the target column")
                lower = after.position
            query = (
                select(Task.position)
                .where(Task.column_id == body.column_id, Task.id != task_id)
                .order_by(Task.position)
                .limit(1)
            )
            if lower is not None:
                query = query.where(Task.position > lower)
            task.column_id = body.column_id
            task.position = key_between(lower, await self.session.scalar(query))
            await self.session.flush()
            self.activity.record(
                workspace_id=project.workspace_id,
                actor_id=user_id,
                project_id=project.id,
                task_id=task_id,
                type="task.moved",
                data={"fromColumnId": str(from_column_id), "toColumnId": str(body.column_id)},
            )

        await retry_on_position_conflict(self.session, attempt)
        await self.session.commit()
        out = TaskOut.of(await self._load(task_id))
        await self._after_write(project.id, "task.moved", out)
        return out

    async def delete(self, task_id: UUID, user_id: UUID) -> None:
        task, project, _ = await self.access.task(task_id, user_id, "member")
        await self.session.execute(delete(Task).where(Task.id == task_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="task.deleted",
            data={"key": f"{project.key}-{task.number}", "title": task.title},
        )
        await self.session.commit()
        deleted = TaskDeleted(id=task_id, project_id=project.id, column_id=task.column_id)
        await self._after_write(project.id, "task.deleted", deleted)
        await self.jobs.delete_storage_prefix(f"projects/{project.id}/tasks/{task_id}/")
```

**What's new**
- **The change log:** for each field the client sent, compare the old and new values and record `{"from": …, "to": …}` under the field's **camelCase** name (`to_camel("due_at")` → `"dueAt"`), converted to JSON-friendly values by `_json`. Comparing two aware datetimes with `!=` compares instants, whatever their time zones.
- **A changed due date resets `reminder_sent_at`**, so the new date gets its own reminder (Part 11).
- **Moving:** the moved task's `column_id` and `position` are assigned, and `flush()` sends the `UPDATE` inside the savepoint, where a duplicate position surfaces. The attempt returns nothing (`-> None`); the task is reloaded after the commit.
- **Deleting** cascades to comments and attachments in Postgres; after the commit, the task's stored files are queued for deletion.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

**Commit:** `feat: update, move and delete tasks`

### Step 7.4 · The router and the wiring

**Goal:** the six task routes.

**Files:** `app/tasks/router.py`, `app/main.py`

**`app/tasks/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import ProjectId
from app.core.params import TaskId
from app.projects.schemas import TaskOut
from app.tasks.schemas import CreateTaskIn
from app.tasks.schemas import ListTasksQuery
from app.tasks.schemas import MoveTaskIn
from app.tasks.schemas import UpdateTaskIn
from app.tasks.service import TasksServiceDep

router = APIRouter(tags=["tasks"])

@router.get("/projects/{projectId}/tasks")
async def list_tasks(
    project_id: ProjectId,
    user_id: CurrentUser,
    query: Annotated[ListTasksQuery, Query()],
    tasks: TasksServiceDep,
) -> Page[TaskOut]:
    return await tasks.list(project_id, user_id, query)

@router.post("/projects/{projectId}/tasks", status_code=201)
async def create_task(
    project_id: ProjectId, user_id: CurrentUser, body: CreateTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.create(project_id, user_id, body)

@router.get("/tasks/{taskId}")
async def get_task(task_id: TaskId, user_id: CurrentUser, tasks: TasksServiceDep) -> TaskOut:
    return await tasks.get(task_id, user_id)

@router.patch("/tasks/{taskId}")
async def update_task(
    task_id: TaskId, user_id: CurrentUser, body: UpdateTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.update(task_id, user_id, body)

@router.delete("/tasks/{taskId}", status_code=204)
async def delete_task(task_id: TaskId, user_id: CurrentUser, tasks: TasksServiceDep) -> None:
    await tasks.delete(task_id, user_id)

@router.post("/tasks/{taskId}/move")
async def move_task(
    task_id: TaskId, user_id: CurrentUser, body: MoveTaskIn, tasks: TasksServiceDep
) -> TaskOut:
    return await tasks.move(task_id, user_id, body)
```

**`app/main.py`** · add after `from app.projects.router import router as projects_router`

```python
from app.tasks.router import router as tasks_router
```

**`app/main.py`** · add after `protected.include_router(projects_router)`

```python
    protected.include_router(tasks_router)
```

**What's new**
- **`query: Annotated[ListTasksQuery, Query()]`**: the whole filter set from the query string, as one model.

**✅ Checkpoint**

With the API running (`uv run --env-file .env fastapi dev`) and `TOKEN` set as in Step 5.7, create a project and a task in your workspace:

```bash
WS=$(curl -s localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["items"][0]["id"])')
P=$(curl -s -X POST localhost:8004/api/v1/workspaces/$WS/projects -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"TaskFlow","key":"TF"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])')
curl -s -X POST localhost:8004/api/v1/projects/$P/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Write the guide"}'
```

Expected: a task with `"key":"TF-1"`, `"number":1`, `"priority":"medium"`, `"position":"a0"`, and your user as `reporter`.

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** numbering under concurrency, fractional moves, move validation, cache invalidation, merge-patch semantics, assignment rules, filters and pagination, viewer permissions, and the column-delete rule.

**Files:** `tests/test_tasks.py`

**`tests/test_tasks.py`** · new file

```python
import asyncio
from typing import Any

import pytest
from httpx import AsyncClient
from httpx import Response

from app.infra.resources import Resources
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import send

@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)

async def create_task(client: AsyncClient, f: Fixture, title: str, **extra: Any) -> dict[str, Any]:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    res = await send(client, "POST", url, user=f.owner, json={"title": title, **extra}, status=201)
    task: dict[str, Any] = res.json()
    return task

async def board_titles(client: AsyncClient, f: Fixture) -> list[tuple[str, list[str]]]:
    res = await send(
        client, "GET", f"/api/v1/projects/{f.project_id}/board", user=f.owner, status=200
    )
    return [(c["name"], [t["title"] for t in c["tasks"]]) for c in res.json()["columns"]]

async def move(
    client: AsyncClient, f: Fixture, task_id: str, column_id: str, after: str | None, status: int
) -> Response:
    body = {"columnId": column_id, "afterTaskId": after}
    return await send(
        client, "POST", f"/api/v1/tasks/{task_id}/move", user=f.owner, json=body, status=status
    )

async def test_tasks_are_numbered_per_project_even_under_concurrent_creates(
    client: AsyncClient, f: Fixture
) -> None:
    tasks = await asyncio.gather(*(create_task(client, f, f"Task {i}") for i in range(10)))
    assert sorted(t["number"] for t in tasks) == list(range(1, 11))
    assert next(t["key"] for t in tasks if t["number"] == 7) == "TF-7"

async def test_new_tasks_go_to_the_bottom_and_move_with_fractional_positions(
    client: AsyncClient, f: Fixture
) -> None:
    a = await create_task(client, f, "A")
    b = await create_task(client, f, "B")
    c = await create_task(client, f, "C")
    assert a["position"] < b["position"] < c["position"]

    todo, _, done = f.column_ids
    await move(client, f, c["id"], todo, None, 200)  # C to the top of To Do
    await move(client, f, a["id"], done, None, 200)  # A to the top of Done
    moved = await move(client, f, b["id"], done, a["id"], 200)  # B right after A
    assert moved.json()["columnId"] == done

    assert await board_titles(client, f) == [
        ("To Do", ["C"]),
        ("In Progress", []),
        ("Done", ["A", "B"]),
    ]

async def test_move_targets_are_validated(client: AsyncClient, f: Fixture) -> None:
    a = await create_task(client, f, "A")
    url = f"/api/v1/workspaces/{f.workspace_id}/projects"
    other = await send(
        client, "POST", url, user=f.owner, json={"name": "Other", "key": "OT"}, status=201
    )
    board = await send(
        client, "GET", f"/api/v1/projects/{other.json()['id']}/board", user=f.owner, status=200
    )
    foreign_column = board.json()["columns"][0]["id"]
    res = await move(client, f, a["id"], foreign_column, None, 422)
    assert res.json()["errors"][0]["field"] == "columnId"
    await move(client, f, a["id"], f.column_ids[0], a["id"], 422)

async def test_the_board_is_cached_and_invalidated_on_writes(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    key = f"cache:board:{f.project_id}"
    await create_task(client, f, "Cached")
    await board_titles(client, f)
    assert await resources.redis.exists(key) == 1
    await create_task(client, f, "Fresh")
    assert await resources.redis.exists(key) == 0
    assert (await board_titles(client, f))[0] == ("To Do", ["Cached", "Fresh"])

async def test_patch_has_merge_semantics(client: AsyncClient, f: Fixture) -> None:
    t = await create_task(client, f, "Patch me", description="keep", dueAt="2030-01-01T09:00:00Z")
    body = {"dueAt": None, "priority": "high"}
    res = await send(
        client, "PATCH", f"/api/v1/tasks/{t['id']}", user=f.owner, json=body, status=200
    )
    task = res.json()
    assert (task["description"], task["dueAt"], task["priority"], task["title"]) == (
        "keep",
        None,
        "high",
        "Patch me",
    )

async def test_only_members_are_assignable_and_leaving_unassigns(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    stranger = await register_user(client, "Stranger")
    url = f"/api/v1/projects/{f.project_id}/tasks"
    body = {"title": "X", "assigneeId": stranger.id}
    rejected = await send(client, "POST", url, user=f.owner, json=body, status=422)
    assert rejected.json()["errors"][0]["field"] == "assigneeId"

    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    t = await create_task(client, f, "Assigned", assigneeId=member.id)
    leave = f"/api/v1/workspaces/{f.workspace_id}/members/{member.id}"
    await send(client, "DELETE", leave, user=member, status=204)
    after = await send(client, "GET", f"/api/v1/tasks/{t['id']}", user=f.owner, status=200)
    assert after.json()["assignee"] is None

async def test_the_task_list_filters_and_pages_newest_first(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    for i in range(1, 6):
        extra = {"assigneeId": member.id, "priority": "high"} if i % 2 else {}
        await create_task(client, f, f"T{i}", **extra)
    tasks = f"/api/v1/projects/{f.project_id}/tasks"

    async def titles(query: str) -> list[str]:
        res = await send(client, "GET", f"{tasks}?{query}", user=f.owner, status=200)
        return [t["title"] for t in res.json()["items"]]

    assert await titles(f"assigneeId={member.id}") == ["T5", "T3", "T1"]
    assert await titles("assigneeId=none") == ["T4", "T2"]
    assert await titles("priority=high&limit=2") == ["T5", "T3"]

    seen: list[str] = []
    cursor = None
    while True:
        query = f"limit=2&cursor={cursor}" if cursor else "limit=2"
        page = (await send(client, "GET", f"{tasks}?{query}", user=f.owner, status=200)).json()
        seen += [t["title"] for t in page["items"]]
        if (cursor := page["nextCursor"]) is None:
            break
    assert seen == ["T5", "T4", "T3", "T2", "T1"]
    res = await send(client, "GET", f"{tasks}?cursor=garbage", user=f.owner, status=422)
    assert res.json()["errors"][0]["field"] == "query.cursor"

async def test_viewers_read_but_cannot_write_and_outsiders_see_nothing(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    t = await create_task(client, f, "Secret")
    task = f"/api/v1/tasks/{t['id']}"
    viewer = await register_user(client, "Viewer")
    outsider = await register_user(client, "Outsider")
    await add_member(resources, f.workspace_id, viewer, "viewer")
    await send(client, "GET", task, user=viewer, status=200)
    await send(client, "PATCH", task, user=viewer, json={"title": "x"}, status=403)
    await send(client, "GET", task, user=outsider, status=404)

async def test_a_column_with_tasks_cannot_be_deleted(client: AsyncClient, f: Fixture) -> None:
    t = await create_task(client, f, "Blocker", columnId=f.column_ids[1])
    column = f"/api/v1/columns/{f.column_ids[1]}"
    await send(client, "DELETE", column, user=f.owner, status=409)
    await send(client, "DELETE", f"/api/v1/tasks/{t['id']}", user=f.owner, status=204)
    await send(client, "GET", f"/api/v1/tasks/{t['id']}", user=f.owner, status=404)
    await send(client, "DELETE", column, user=f.owner, status=204)
```

**What's new**
- **`asyncio.gather(*(create_task(...) for i in range(10)))`** starts ten creates at once and waits for all of them, `Promise.all(Array.from({length: 10}, ...))`. Ten requests run concurrently through the app, each with its own session and pool connection, and the row lock makes their numbers 1 to 10.
- **`todo, _, done = f.column_ids`** unpacks three ids at once.
- **The walrus operator** `if (cursor := page["nextCursor"]) is None:` assigns and tests in one expression, handy in loops like this one.
- **`a["position"] < b["position"] < c["position"]`**: comparisons chain in Python (`a < b and b < c`).

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `56 passed`.

**Commit:** `test: tasks, moves, filters and concurrency`

---
## Part 8 · Comments, activity feed & search

### Step 8.1 · Comments

**Goal:** list a task's comments oldest first; members comment; only the author edits; the author or an admin deletes; new comments are published live.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/comments/__init__.py`, `app/comments/schemas.py`, `app/realtime/publisher.py`, `app/comments/service.py`

```bash
mkdir app/comments && touch app/comments/__init__.py
```

**`app/access/service.py`** · add after `from app.models.project import Project`

```python
from app.models.task import Comment
```

**`app/access/service.py`** · add after `return task, task.project, membership`

```python

    async def comment(
        self, comment_id: UUID, user_id: UUID
    ) -> tuple[Comment, Project, WorkspaceMember]:
        comment = await self.session.scalar(
            select(Comment)
            .options(joinedload(Comment.task).joinedload(Task.project))
            .where(Comment.id == comment_id)
        )
        if comment is None:
            raise not_found("Comment")
        project = comment.task.project
        membership = await self.member(project.workspace_id, user_id, "viewer", "Comment")
        return comment, project, membership
```

**`app/core/params.py`** · continue

```python
CommentId = Annotated[UUID, Path(alias="commentId")]
```

**What's new**
- **Chained eager loading:** `joinedload(Comment.task).joinedload(Task.project)` joins the comment's task and *that* task's project in one query: the access check needs the project's workspace.

**`app/comments/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.models.task import Comment
from app.users.schemas import UserSummary

class CommentBody(CamelModel):
    body: Annotated[str, Field(min_length=1, max_length=5000)]

class CommentOut(CamelModel):
    id: UUID
    task_id: UUID
    author: UserSummary
    body: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def of(cls, comment: Comment) -> Self:
        return cls(
            id=comment.id,
            task_id=comment.task_id,
            author=UserSummary.of(comment.author),
            body=comment.body,
            created_at=comment.created_at,
            updated_at=comment.updated_at,
        )
```

**`app/realtime/publisher.py`** · add before `from app.core.schemas import CamelModel`

```python
from app.comments.schemas import CommentOut
```

**`app/realtime/publisher.py`** · add after `column_id: UUID`

```python

class CommentCreated(CamelModel):
    project_id: UUID
    comment: CommentOut
```

**What's new**
- **A model inside a model:** `CommentCreated.comment` is a `CommentOut`; dumping the envelope dumps it too, with camelCase keys all the way down.

**`app/comments/service.py`** · new file

```python
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.roles import at_least
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.comments.schemas import CommentOut
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import SessionDep
from app.models.task import Comment
from app.realtime.publisher import CommentCreated
from app.realtime.publisher import PublisherDep

class CommentsService:
    def __init__(
        self, session: SessionDep, access: AccessDep, activity: ActivityDep, publisher: PublisherDep
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.publisher = publisher

    async def list(self, task_id: UUID, user_id: UUID, page: PageQuery) -> Page[CommentOut]:
        await self.access.task(task_id, user_id)
        query = (
            select(Comment).options(joinedload(Comment.author)).where(Comment.task_id == task_id)
        )
        query = keyset(query, Comment.id, descending=False, limit=page.limit, after=after_id(page))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, CommentOut.of, lambda c: {"id": str(c.id)})

    async def create(self, task_id: UUID, user_id: UUID, body: str) -> CommentOut:
        _, project, _ = await self.access.task(task_id, user_id, "member")
        comment = Comment(task_id=task_id, author_id=user_id, body=body)
        self.session.add(comment)
        await self.session.flush()
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=task_id,
            type="comment.created",
            data={"commentId": str(comment.id)},
        )
        await self.session.commit()
        out = CommentOut.of(await self._load(comment.id))
        await self.publisher.publish(
            project.id, "comment.created", CommentCreated(project_id=project.id, comment=out)
        )
        return out
```

**`app/comments/service.py`** · continue

```python

    async def update(self, comment_id: UUID, user_id: UUID, body: str) -> CommentOut:
        comment, project, _ = await self.access.comment(comment_id, user_id)
        if comment.author_id != user_id:
            raise forbidden("Only the author can edit a comment")
        comment.body = body
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=comment.task_id,
            type="comment.updated",
            data={"commentId": str(comment_id)},
        )
        await self.session.commit()
        return CommentOut.of(await self._load(comment_id))

    async def delete(self, comment_id: UUID, user_id: UUID) -> None:
        comment, project, membership = await self.access.comment(comment_id, user_id)
        if comment.author_id != user_id and not at_least(membership.role, "admin"):
            raise forbidden("Only the author or an admin can delete a comment")
        await self.session.execute(delete(Comment).where(Comment.id == comment_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=comment.task_id,
            type="comment.deleted",
            data={"commentId": str(comment_id)},
        )
        await self.session.commit()

    async def _load(self, comment_id: UUID) -> Comment:
        comment = await self.session.scalar(
            select(Comment).options(joinedload(Comment.author)).where(Comment.id == comment_id)
        )
        if comment is None:
            raise not_found("Comment")
        return comment

CommentsServiceDep = Annotated[CommentsService, Depends()]
```

**What's new**
- **`comment.body = body` then `commit()`**: the unit of work again; SQLAlchemy writes `body` and `updated_at`.
- **Authorization beyond roles:** editing needs authorship (`comment.author_id != user_id` → 403), deleting needs authorship *or* admin (`at_least(membership.role, "admin")`). The access service returns the membership, so the role check costs no extra query.
- **Comments don't touch the board cache:** the board shows tasks, not their comments. Only `comment.created` is published (README §9.2).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 86 source files`.

**Commit:** `feat: comments with author and admin rules`

### Step 8.2 · The activity feed

**Goal:** the workspace's audit log, newest first, filterable by project and task.

**Files:** `app/activity/schemas.py`, `app/activity/service.py`, `app/activity/router.py`

**`app/activity/schemas.py`** · new file

```python
from datetime import datetime
from typing import Any
from typing import Self
from uuid import UUID

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.models.activity import ActivityEvent
from app.users.schemas import UserSummary

class ActivityQuery(PageQuery):
    project_id: UUID | None = None
    task_id: UUID | None = None

class ActivityOut(CamelModel):
    id: UUID
    workspace_id: UUID
    project_id: UUID | None
    task_id: UUID | None
    actor: UserSummary
    type: str
    data: dict[str, Any]
    created_at: datetime

    @classmethod
    def of(cls, event: ActivityEvent) -> Self:
        return cls(
            id=event.id,
            workspace_id=event.workspace_id,
            project_id=event.project_id,
            task_id=event.task_id,
            actor=UserSummary.of(event.actor),
            type=event.type,
            data=event.data,
            created_at=event.created_at,
        )
```

**`app/activity/service.py`** · add after `from fastapi import Depends`

```python
from sqlalchemy import select
from sqlalchemy.orm import joinedload
```

**`app/activity/service.py`** · add after `from app.access.service import AccessDep`

```python
from app.activity.schemas import ActivityOut
from app.activity.schemas import ActivityQuery
from app.core.pagination import Page
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
```

**`app/activity/service.py`** · add after `self.session.add(event)`

```python

    async def list(self, workspace_id: UUID, user_id: UUID, q: ActivityQuery) -> Page[ActivityOut]:
        await self.access.member(workspace_id, user_id)
        query = (
            select(ActivityEvent)
            .options(joinedload(ActivityEvent.actor))
            .where(ActivityEvent.workspace_id == workspace_id)
        )
        if q.project_id is not None:
            query = query.where(ActivityEvent.project_id == q.project_id)
        if q.task_id is not None:
            query = query.where(ActivityEvent.task_id == q.task_id)
        query = keyset(query, ActivityEvent.id, descending=True, limit=q.limit, after=after_id(q))
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, q.limit, ActivityOut.of, lambda e: {"id": str(e.id)})
```

**`app/activity/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.activity.schemas import ActivityOut
from app.activity.schemas import ActivityQuery
from app.activity.service import ActivityDep
from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import WorkspaceId

router = APIRouter(tags=["activity"])

@router.get("/workspaces/{workspaceId}/activity")
async def list_activity(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    query: Annotated[ActivityQuery, Query()],
    activity: ActivityDep,
) -> Page[ActivityOut]:
    return await activity.list(workspace_id, user_id, query)
```

**What's new**
- **`list` reuses `self.access`**, injected since Part 5: the reason `ActivityService` asked for the access service before it needed it.
- **Two partial indexes** serve the filters: `(project_id, id) WHERE project_id IS NOT NULL` and `(task_id, id) WHERE task_id IS NOT NULL`. Workspace-level events (no project, no task) don't take space in them.
- **`data: dict[str, Any]`** is returned as stored: the JSON object each service recorded.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 88 source files`.

**Commit:** `feat: activity feed with project and task filters`

### Step 8.3 · Full-text search

**Goal:** search task titles and descriptions across a workspace, best match first, with safe highlighted snippets and `(rank, id)` cursors.

**Files:** `app/search/__init__.py`, `app/search/schemas.py`, `app/search/service.py`, `tests/unit/test_search.py`

```bash
mkdir app/search && touch app/search/__init__.py
```

**`app/search/schemas.py`** · new file

```python
from typing import Annotated

from pydantic import Field

from app.core.pagination import PageQuery
from app.core.schemas import CamelModel
from app.projects.schemas import TaskOut

class SearchQuery(PageQuery):
    q: Annotated[str, Field(min_length=1, max_length=200)]

class SearchHit(CamelModel):
    task: TaskOut
    rank: float
    headline: str
```

**`app/search/service.py`** · new file

```python
import html
from typing import Annotated
from uuid import UUID

from fastapi import Depends
from sqlalchemy import select
from sqlalchemy import text

from app.access.service import AccessDep
from app.core.pagination import Page
from app.core.pagination import RankCursor
from app.core.pagination import decode_cursor
from app.core.pagination import to_page
from app.deps import SessionDep
from app.models.task import Task
from app.projects.schemas import TaskOut
from app.projects.schemas import task_relations
from app.search.schemas import SearchHit
from app.search.schemas import SearchQuery

# ts_headline can't HTML-escape, so matches are marked with control characters, the whole
# snippet is escaped, and then the markers become <mark> tags.
START = "\x01"
STOP = "\x02"

_SEARCH = """
SELECT t.id,
       ts_rank(t.search_vector, query) AS rank,
       ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query, :options)
           AS headline
FROM tasks t
JOIN projects p ON p.id = t.project_id,
     websearch_to_tsquery('english', :q) AS query
WHERE p.workspace_id = :workspace_id
  AND t.search_vector @@ query
  {after}
ORDER BY rank DESC, t.id DESC
LIMIT :limit
"""
# rank is a float4 (`real`). Casting the cursor's value back to real makes the row comparison
# exact, because JSON carries the shortest decimal that round-trips.
_AFTER = (
    "AND (ts_rank(t.search_vector, query), t.id) < (CAST(:rank AS real), CAST(:after_id AS uuid))"
)

def safe_headline(raw: str) -> str:
    return html.escape(raw).replace(START, "<mark>").replace(STOP, "</mark>")
```

**What's new**
- **Raw SQL with `text(...)`** and named parameters (`:q`, `:workspace_id`): this query uses Postgres functions the ORM has no shortcuts for (`websearch_to_tsquery`, `ts_rank`, `ts_headline`). Values still travel separately from the SQL text. **`.format(after=...)`** only inserts one of two constant SQL fragments, never user input.
- **`CAST(:after_id AS uuid)`**: inside a row comparison, asyncpg can't infer a parameter's type, so it's spelled out.
- **`html.escape`** escapes `& < > " '`. `ts_headline` can't escape HTML itself, so matches are marked with control characters (`\x01`, `\x02`), the snippet is escaped, then the markers become `<mark>` tags.

**`app/search/service.py`** · continue

```python

class SearchService:
    def __init__(self, session: SessionDep, access: AccessDep) -> None:
        self.session = session
        self.access = access

    async def search(self, workspace_id: UUID, user_id: UUID, q: SearchQuery) -> Page[SearchHit]:
        await self.access.member(workspace_id, user_id)
        after = decode_cursor(q.cursor, RankCursor) if q.cursor else None
        # :name placeholders are bound parameters: what the user typed is never parsed as SQL.
        params = {
            "options": f"StartSel={START}, StopSel={STOP}",
            "q": q.q,
            "workspace_id": workspace_id,
            "limit": q.limit + 1,
        }
        if after is not None:
            params |= {"rank": after.rank, "after_id": after.id}
        sql = _SEARCH.format(after=_AFTER if after else "")
        hits = (await self.session.execute(text(sql), params)).all()

        tasks = await self.session.scalars(
            select(Task).options(*task_relations()).where(Task.id.in_([h.id for h in hits]))
        )
        by_id = {task.id: TaskOut.of(task) for task in tasks}
        rows = [
            SearchHit(task=by_id[h.id], rank=h.rank, headline=safe_headline(h.headline))
            for h in hits
            if h.id in by_id
        ]
        return to_page(rows, q.limit, lambda r: r, lambda r: {"rank": r.rank, "id": str(r.task.id)})

SearchServiceDep = Annotated[SearchService, Depends()]
```

**What's new**
- **`.all()` on a `text()` query returns rows** whose columns are attributes: `h.id`, `h.rank`, `h.headline`.
- **Two queries:** the ranked ids first (cheap, index-driven), then the tasks with their relationships, rebuilt in rank order through a dict: `{task.id: TaskOut.of(task) for task in tasks}` is a **dict comprehension** (`Object.fromEntries(...)`).
- **The rank cursor** carries a float: Python's `json.dumps` writes the shortest decimal that reads back to the same float, and the SQL casts it back to `real` (`ts_rank`'s type), so the row comparison is exact.

**`tests/unit/test_search.py`** · new file

```python
from app.search.service import safe_headline

def test_headlines_escape_html_but_keep_the_match_markers() -> None:
    raw = '<script>alert(1)</script> fix \x01login\x02 & "logout"'
    assert safe_headline(raw) == (
        "&lt;script&gt;alert(1)&lt;/script&gt; fix <mark>login</mark> &amp; &quot;logout&quot;"
    )
```

> **🧠 DSA & scalability · Full-text search with a GIN index**
> - **Data structure:** `tasks.search_vector`, a generated `tsvector` (title weighted A, description B), indexed by **GIN**: an inverted index from each lexeme ("login") to the posting list of rows containing it.
> - **Algorithm:** `websearch_to_tsquery('english', q)` parses web-search syntax (words, `"phrases"`, `or`, `-excluded`) and stems the words; `@@` intersects the posting lists through the index; `ts_rank` scores matches (weight A > B); `ts_headline` builds the snippet for the page only. Paging continues with `(rank, id) < (cursor.rank, cursor.id)`.
> - **Complexity:** O(Σ posting-list lengths) to find candidates, then ranking and sorting the matches: O(m log m) for m matches. The workspace filter is a join on `projects`.
> - **Why it scales:** the index does the expensive part, and the vector is maintained by Postgres on every write, so the app can't forget to update it.
> - **Alternatives rejected:** `ILIKE '%login%'` (no index, O(N) scan, no stemming: "logins" wouldn't match "login"); a search engine (OpenSearch: better ranking and fuzziness, but one more service to run and keep in sync; Pulse revisits this). Rank cursors are the fragile part: ranks tie and are floats, which is why `id` breaks ties and the float is cast back to `real`.

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `14 passed`.

**Commit:** `feat: full-text search with safe headlines`

### Step 8.4 · Wiring and tests

**Goal:** the comment and search routes, wired in; tests for comments, the activity feed and search.

**Files:** `app/comments/router.py`, `app/search/router.py`, `app/main.py`, `tests/test_collaboration.py`

**`app/comments/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.comments.schemas import CommentBody
from app.comments.schemas import CommentOut
from app.comments.service import CommentsServiceDep
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import CommentId
from app.core.params import TaskId

router = APIRouter(tags=["comments"])

@router.get("/tasks/{taskId}/comments")
async def list_comments(
    task_id: TaskId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    comments: CommentsServiceDep,
) -> Page[CommentOut]:
    return await comments.list(task_id, user_id, page)

@router.post("/tasks/{taskId}/comments", status_code=201)
async def create_comment(
    task_id: TaskId, user_id: CurrentUser, body: CommentBody, comments: CommentsServiceDep
) -> CommentOut:
    return await comments.create(task_id, user_id, body.body)

@router.patch("/comments/{commentId}")
async def update_comment(
    comment_id: CommentId, user_id: CurrentUser, body: CommentBody, comments: CommentsServiceDep
) -> CommentOut:
    return await comments.update(comment_id, user_id, body.body)

@router.delete("/comments/{commentId}", status_code=204)
async def delete_comment(
    comment_id: CommentId, user_id: CurrentUser, comments: CommentsServiceDep
) -> None:
    await comments.delete(comment_id, user_id)
```

**`app/search/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.params import WorkspaceId
from app.search.schemas import SearchHit
from app.search.schemas import SearchQuery
from app.search.service import SearchServiceDep

router = APIRouter(tags=["search"])

@router.get("/workspaces/{workspaceId}/search")
async def search_tasks(
    workspace_id: WorkspaceId,
    user_id: CurrentUser,
    query: Annotated[SearchQuery, Query()],
    search: SearchServiceDep,
) -> Page[SearchHit]:
    return await search.search(workspace_id, user_id, query)
```

**`app/main.py`** · add before `from app.auth.dependencies import limit_api`

```python
from app.activity.router import router as activity_router
```

**`app/main.py`** · add after `from app.auth.router import router as auth_router`

```python
from app.comments.router import router as comments_router
```

**`app/main.py`** · add after `from app.projects.router import router as projects_router`

```python
from app.search.router import router as search_router
```

**`app/main.py`** · add after `protected.include_router(tasks_router)`

```python
    protected.include_router(comments_router)
    protected.include_router(activity_router)
    protected.include_router(search_router)
```

**`tests/test_collaboration.py`** · new file

```python
import pytest
from httpx import AsyncClient

from app.infra.resources import Resources
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import send

@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)

async def create_task(
    client: AsyncClient, f: Fixture, title: str, description: str | None = None
) -> str:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    body = {"title": title, "description": description}
    return str((await send(client, "POST", url, user=f.owner, json=body, status=201)).json()["id"])

async def test_comments_oldest_first_author_edits_author_or_admin_deletes(
    client: AsyncClient, resources: Resources, f: Fixture
) -> None:
    task_id = await create_task(client, f, "Discuss me")
    member = await register_user(client, "Member")
    await add_member(resources, f.workspace_id, member, "member")
    url = f"/api/v1/tasks/{task_id}/comments"
    first = await send(client, "POST", url, user=member, json={"body": "first"}, status=201)
    await send(client, "POST", url, user=f.owner, json={"body": "second"}, status=201)
    comment = f"/api/v1/comments/{first.json()['id']}"

    listed = await send(client, "GET", url, user=member, status=200)
    assert [c["body"] for c in listed.json()["items"]] == ["first", "second"]

    await send(client, "PATCH", comment, user=f.owner, json={"body": "hijack"}, status=403)
    edited = await send(client, "PATCH", comment, user=member, json={"body": "edited"}, status=200)
    assert (edited.json()["body"], edited.json()["author"]["id"]) == ("edited", member.id)
    await send(client, "DELETE", comment, user=f.owner, status=204)

async def test_every_change_is_recorded_newest_first(client: AsyncClient, f: Fixture) -> None:
    task_id = await create_task(client, f, "Doomed")
    await send(client, "DELETE", f"/api/v1/tasks/{task_id}", user=f.owner, status=204)
    activity = f"/api/v1/workspaces/{f.workspace_id}/activity"
    for_task = await send(client, "GET", f"{activity}?taskId={task_id}", user=f.owner, status=200)
    assert [e["type"] for e in for_task.json()["items"]] == ["task.deleted", "task.created"]

    everything = await send(client, "GET", f"{activity}?limit=100", user=f.owner, status=200)
    assert everything.json()["items"][-1]["type"] == "workspace.created"

async def test_search_ranks_title_matches_first_escapes_and_pages_by_rank(
    client: AsyncClient, f: Fixture
) -> None:
    await create_task(client, f, "Write docs", "Explain the <b>login</b> flow")
    await create_task(client, f, "Fix login redirect", "Users bounce back")
    await create_task(client, f, "Unrelated", "Nothing here")

    url = f"/api/v1/workspaces/{f.workspace_id}/search"
    res = await send(client, "GET", url, user=f.owner, params={"q": "login"}, status=200)
    hits = res.json()["items"]
    assert [h["task"]["title"] for h in hits] == ["Fix login redirect", "Write docs"]
    # Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    assert "<mark>login</mark>" in hits[1]["headline"]
    assert "<b>" not in hits[1]["headline"]

    page1 = await send(
        client, "GET", url, user=f.owner, params={"q": "login", "limit": 1}, status=200
    )
    cursor = page1.json()["nextCursor"]
    params = {"q": "login", "limit": 1, "cursor": cursor}
    page2 = (await send(client, "GET", url, user=f.owner, params=params, status=200)).json()
    assert [h["task"]["title"] for h in page2["items"]] == ["Write docs"]
    assert page2["nextCursor"] is None

async def test_search_is_limited_to_your_workspaces(client: AsyncClient, f: Fixture) -> None:
    outsider = await register_user(client, "Outsider")
    url = f"/api/v1/workspaces/{f.workspace_id}/search?q=docs"
    await send(client, "GET", url, user=outsider, status=404)
```

**What's new**
- **`params={"q": "login", "limit": 1}`** builds the query string (httpx encodes it).
- The search test checks the ranking (title match first), the escaping (`<b>` from a description never comes back as markup) and `(rank, id)` paging.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `61 passed`.

**Commit:** `feat: comment, activity and search routes`

---
## Part 9 · Attachments (presigned S3 uploads)

The bytes never pass through the API (README §12): the API signs a URL, the browser `PUT`s the file straight to S3 (RustFS locally), and the API then checks the object exists with the declared size.

### Step 9.1 · The storage wrapper

**Goal:** presigned upload and download URLs, a size check, and prefix deletion, through boto3, without blocking the event loop.

**Files:** `app/infra/storage.py`, `app/infra/resources.py`, `app/deps.py`

```bash
uv add --bounds exact boto3==1.44.3
uv add --dev --bounds exact "types-boto3[s3]==1.44.3"
```

- **boto3** is the official AWS SDK for Python (`@aws-sdk/client-s3`'s role); it speaks to any S3-compatible service. It's **synchronous**, so its network calls run in threads (below). **types-boto3[s3]** adds type stubs for the S3 client: boto3 builds its clients at run time from JSON descriptions, so without stubs mypy sees `Any` everywhere.

**`app/infra/storage.py`** · new file

```python
import asyncio
from typing import TYPE_CHECKING
from urllib.parse import quote

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import Settings

if TYPE_CHECKING:  # the stubs exist for the type checker only; boto3 builds clients at run time
    from types_boto3_s3 import S3Client
    from types_boto3_s3.type_defs import ObjectIdentifierTypeDef

_CONFIG = Config(
    signature_version="s3v4",
    s3={"addressing_style": "path"},  # http://host/bucket/key, which RustFS (like MinIO) serves
    # Newer botocore adds CRC32 checksum parameters to presigned PUTs; a browser can't compute
    # them, so its upload would be rejected. Only send checksums when an operation requires one.
    request_checksum_calculation="when_required",
    response_checksum_validation="when_required",
)

class Storage:
    """S3 through boto3. boto3 is synchronous, so every network call runs in a worker thread."""

    def __init__(self, settings: Settings) -> None:
        def client(endpoint: str) -> S3Client:
            return boto3.client(
                "s3",
                endpoint_url=endpoint,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                config=_CONFIG,
            )

        self._internal = client(str(settings.s3_endpoint))
        # Signatures cover the host, so URLs for the browser are signed with the public endpoint.
        self._presigner = client(str(settings.s3_public_endpoint))
        self.bucket = settings.s3_bucket
```

**What's new**
- **`if TYPE_CHECKING:`** is `False` at run time and `True` for mypy: the stub types are imported only for type checking. **Python 3.14 evaluates annotations lazily**, so `-> S3Client` in the nested function is never evaluated at run time, and the name doesn't need to exist then. (Before 3.14 you'd quote it: `-> "S3Client"`.)
- **A nested function** builds the two clients with the same settings. **Two clients, two endpoints:** a presigned URL's signature covers the host, so URLs for the browser are signed for `S3_PUBLIC_ENDPOINT`, while the API's own calls use `S3_ENDPOINT` (inside Docker, `http://rustfs:9000`).
- **`request_checksum_calculation="when_required"`**: recent botocore versions add CRC32 checksum parameters to presigned uploads by default, and a browser can't compute them, so its `PUT` would fail. This restores the old behaviour. (AWS SDK v3 for JS has the same setting.)
- `addressing_style: path` puts the bucket in the path (`http://host/bucket/key`), which RustFS and MinIO serve.

**`app/infra/storage.py`** · continue

```python

    def presign_upload(self, key: str, content_type: str, size_bytes: int, expires_in: int) -> str:
        # Signing is local computation (no network), so it needs no thread.
        return self._presigner.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
                "ContentLength": size_bytes,
            },
            ExpiresIn=expires_in,
        )

    def presign_download(self, key: str, file_name: str, expires_in: int) -> str:
        disposition = f"attachment; filename*=UTF-8''{quote(file_name, safe='')}"
        return self._presigner.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": key, "ResponseContentDisposition": disposition},
            ExpiresIn=expires_in,
        )

    async def size_of(self, key: str) -> int | None:
        """The stored object's size, or None if it doesn't exist."""
        try:
            head = await asyncio.to_thread(self._internal.head_object, Bucket=self.bucket, Key=key)
        except ClientError as err:
            if err.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return head["ContentLength"]

    async def delete_prefix(self, prefix: str) -> int:
        """Deletes every object under a prefix, 1000 keys per request (the S3 maximum)."""
        return await asyncio.to_thread(self._delete_prefix, prefix)

    def _delete_prefix(self, prefix: str) -> int:
        deleted = 0
        paginator = self._internal.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            objects: list[ObjectIdentifierTypeDef] = [
                {"Key": o["Key"]} for o in page.get("Contents", []) if "Key" in o
            ]
            if objects:
                self._internal.delete_objects(Bucket=self.bucket, Delete={"Objects": objects})
                deleted += len(objects)
        return deleted
```

**What's new**
- **Presigning is local:** `generate_presigned_url` computes an HMAC signature with the secret key, without a network call, so it runs directly. **`Params={"ContentLength": size_bytes}`** puts the size into the signed headers: S3 itself rejects an upload of a different size.
- **`await asyncio.to_thread(self._internal.head_object, ...)`**: the blocking call runs in a worker thread (`HEAD` the object to read its size). A missing object raises `ClientError` with code `404`; anything else is re-raised.
- **`_delete_prefix` is a plain (synchronous) method** run as a whole in one thread: a **paginator** iterates `list_objects_v2` pages (1000 keys each, the S3 maximum) and deletes each page with one `delete_objects` call. Many blocking calls, one thread hop.
- `quote(file_name, safe='')` percent-encodes the original file name for `filename*=UTF-8''…` (RFC 5987), so `résumé.txt` downloads with its name intact.

**`app/infra/resources.py`** · add after `from app.db.session import create_session_factory`

```python
from app.infra.storage import Storage
```

**`app/infra/resources.py`** · add after `jobs: Jobs`

```python
    storage: Storage
```

**`app/infra/resources.py`** · add after `jobs=Jobs(celery),`

```python
            storage=Storage(settings),
```

**`app/deps.py`** · add after `from app.infra.resources import Resources`

```python
from app.infra.storage import Storage
```

**`app/deps.py`** · add before `async def get_session(resources: ResourcesDep) -> AsyncIterator[AsyncSession]:`

```python
def get_storage(resources: ResourcesDep) -> Storage:
    return resources.storage

```

**`app/deps.py`** · continue

```python
StorageDep = Annotated[Storage, Depends(get_storage)]
```

**✅ Checkpoint**

```bash
uv run python -c "
import asyncio
from app.config import get_settings
from app.infra.storage import Storage
s = Storage(get_settings())
print(s.presign_upload('probe/x.txt', 'text/plain', 5, 60)[:70])
print(asyncio.run(s.size_of('probe/missing')))"
```

Expected:

```text
http://localhost:19004/taskflow-attachments/probe/x.txt?X-Amz-Algorith
None
```

**Commit:** `feat: s3 storage with presigned urls`

### Step 9.2 · The attachments service and routes

**Goal:** start an upload (a pending row + an upload URL), complete it (check the object, mark it ready), list, download and delete.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/attachments/__init__.py`, `app/attachments/schemas.py`, `app/attachments/service.py`, `app/attachments/router.py`

```bash
mkdir app/attachments && touch app/attachments/__init__.py
```

**`app/access/service.py`** · add after `from app.models.project import Project`

```python
from app.models.task import Attachment
```

**`app/access/service.py`** · add after `return comment, project, membership`

```python

    async def attachment(
        self, attachment_id: UUID, user_id: UUID
    ) -> tuple[Attachment, Project, WorkspaceMember]:
        attachment = await self.session.scalar(
            select(Attachment)
            .options(joinedload(Attachment.task).joinedload(Task.project))
            .where(Attachment.id == attachment_id)
        )
        if attachment is None:
            raise not_found("Attachment")
        project = attachment.task.project
        membership = await self.member(project.workspace_id, user_id, "viewer", "Attachment")
        return attachment, project, membership
```

**`app/core/params.py`** · continue

```python
AttachmentId = Annotated[UUID, Path(alias="attachmentId")]
```

**`app/attachments/schemas.py`** · new file

```python
from datetime import datetime
from typing import Annotated
from typing import Literal
from typing import Self
from uuid import UUID

from pydantic import Field

from app.core.schemas import CamelModel
from app.core.schemas import JsonInt
from app.models.task import Attachment
from app.models.task import AttachmentStatus
from app.users.schemas import UserSummary

MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

class CreateAttachmentIn(CamelModel):
    # A display name only: no slashes, backslashes or control characters (U+0000 to U+001F).
    file_name: Annotated[str, Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")]
    # Lowercase media type without parameters, as browsers report it in File.type.
    content_type: Annotated[
        str,
        Field(
            min_length=3,
            max_length=127,
            pattern=r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$",
        ),
    ]
    size_bytes: Annotated[JsonInt, Field(ge=1, le=MAX_ATTACHMENT_BYTES)]

class AttachmentOut(CamelModel):
    id: UUID
    task_id: UUID
    uploader: UserSummary
    file_name: str
    content_type: str
    size_bytes: int
    status: AttachmentStatus
    created_at: datetime

    @classmethod
    def of(cls, attachment: Attachment) -> Self:
        return cls(
            id=attachment.id,
            task_id=attachment.task_id,
            uploader=UserSummary.of(attachment.uploader),
            file_name=attachment.file_name,
            content_type=attachment.content_type,
            size_bytes=attachment.size_bytes,
            status=attachment.status,
            created_at=attachment.created_at,
        )

class PresignedUrl(CamelModel):
    url: str
    expires_at: datetime

class UploadTarget(PresignedUrl):
    method: Literal["PUT"] = "PUT"
    headers: dict[str, str]

class AttachmentUpload(CamelModel):
    attachment: AttachmentOut
    upload: UploadTarget
```

**What's new**
- **The file name is display data:** the pattern `^[^/\\\x00-\x1f]+$` forbids path separators and control characters (`\x00`–`\x1f`), and the storage key never contains it.
- **`content_type`** must be a lowercase media type without parameters, as browsers report it in `File.type`.
- `class UploadTarget(PresignedUrl)` adds `method` and `headers` to the URL and its expiry.

**`app/attachments/service.py`** · new file

```python
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Annotated
from uuid import UUID
from uuid import uuid7

from fastapi import Depends
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from app.access.roles import at_least
from app.access.service import AccessDep
from app.activity.service import ActivityDep
from app.attachments.schemas import AttachmentOut
from app.attachments.schemas import AttachmentUpload
from app.attachments.schemas import CreateAttachmentIn
from app.attachments.schemas import PresignedUrl
from app.attachments.schemas import UploadTarget
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.pagination import after_id
from app.core.pagination import keyset
from app.core.pagination import to_page
from app.core.problems import conflict
from app.core.problems import forbidden
from app.core.problems import not_found
from app.deps import JobsDep
from app.deps import SessionDep
from app.deps import StorageDep
from app.models.task import Attachment

UPLOAD_URL_TTL = 15 * 60
DOWNLOAD_URL_TTL = 5 * 60

def _expires_at(seconds: int) -> datetime:
    return datetime.now(UTC) + timedelta(seconds=seconds)

class AttachmentsService:
    def __init__(
        self,
        session: SessionDep,
        access: AccessDep,
        activity: ActivityDep,
        storage: StorageDep,
        jobs: JobsDep,
    ) -> None:
        self.session = session
        self.access = access
        self.activity = activity
        self.storage = storage
        self.jobs = jobs

    async def list(self, task_id: UUID, user_id: UUID, page: PageQuery) -> Page[AttachmentOut]:
        await self.access.task(task_id, user_id)
        query = (
            select(Attachment)
            .options(joinedload(Attachment.uploader))
            .where(Attachment.task_id == task_id, Attachment.status == "ready")
        )
        query = keyset(
            query, Attachment.id, descending=True, limit=page.limit, after=after_id(page)
        )
        rows = (await self.session.scalars(query)).all()
        return to_page(rows, page.limit, AttachmentOut.of, lambda a: {"id": str(a.id)})
```

**`app/attachments/service.py`** · continue

```python

    async def create(
        self, task_id: UUID, user_id: UUID, body: CreateAttachmentIn
    ) -> AttachmentUpload:
        _, project, _ = await self.access.task(task_id, user_id, "member")
        # The id is generated here, not at flush time, because the storage key needs it.
        attachment_id = uuid7()
        storage_key = f"projects/{project.id}/tasks/{task_id}/{attachment_id}"
        self.session.add(
            Attachment(
                id=attachment_id,
                task_id=task_id,
                uploader_id=user_id,
                file_name=body.file_name,
                content_type=body.content_type,
                size_bytes=body.size_bytes,
                storage_key=storage_key,
            )
        )
        await self.session.commit()
        url = self.storage.presign_upload(
            storage_key, body.content_type, body.size_bytes, UPLOAD_URL_TTL
        )
        return AttachmentUpload(
            attachment=AttachmentOut.of(await self._load(attachment_id)),
            upload=UploadTarget(
                url=url,
                headers={"Content-Type": body.content_type},
                expires_at=_expires_at(UPLOAD_URL_TTL),
            ),
        )

    async def complete(self, attachment_id: UUID, user_id: UUID) -> AttachmentOut:
        attachment, project, _ = await self.access.attachment(attachment_id, user_id)
        if attachment.uploader_id != user_id:
            raise forbidden("Only the uploader can complete an upload")
        if attachment.status == "ready":
            return AttachmentOut.of(await self._load(attachment_id))
        size = await self.storage.size_of(attachment.storage_key)
        if size is None:
            raise conflict("The file has not been uploaded yet")
        if size != attachment.size_bytes:
            raise conflict("The uploaded file size does not match")
        attachment.status = "ready"
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=attachment.task_id,
            type="attachment.added",
            data={"attachmentId": str(attachment_id), "fileName": attachment.file_name},
        )
        await self.session.commit()
        return AttachmentOut.of(await self._load(attachment_id))
```

**What's new**
- **The id is generated before the insert** (`uuid7()`), because the storage key contains it: `projects/{project}/tasks/{task}/{attachment}`. Deleting a task or project later deletes its whole prefix.
- **`complete` is idempotent:** a ready attachment is returned as it is. Otherwise the object must exist (409 "not uploaded yet") with the declared size (409 "size does not match"), then the row becomes `ready` and the activity event is recorded.

**`app/attachments/service.py`** · continue

```python

    async def download(self, attachment_id: UUID, user_id: UUID) -> PresignedUrl:
        attachment, _, _ = await self.access.attachment(attachment_id, user_id)
        if attachment.status != "ready":
            raise not_found("Attachment")
        url = self.storage.presign_download(
            attachment.storage_key, attachment.file_name, DOWNLOAD_URL_TTL
        )
        return PresignedUrl(url=url, expires_at=_expires_at(DOWNLOAD_URL_TTL))

    async def delete(self, attachment_id: UUID, user_id: UUID) -> None:
        attachment, project, membership = await self.access.attachment(attachment_id, user_id)
        if attachment.uploader_id != user_id and not at_least(membership.role, "admin"):
            raise forbidden("Only the uploader or an admin can delete an attachment")
        await self.session.execute(delete(Attachment).where(Attachment.id == attachment_id))
        self.activity.record(
            workspace_id=project.workspace_id,
            actor_id=user_id,
            project_id=project.id,
            task_id=attachment.task_id,
            type="attachment.deleted",
            data={"attachmentId": str(attachment_id), "fileName": attachment.file_name},
        )
        await self.session.commit()
        await self.jobs.delete_storage_prefix(attachment.storage_key)

    async def _load(self, attachment_id: UUID) -> Attachment:
        attachment = await self.session.scalar(
            select(Attachment)
            .options(joinedload(Attachment.uploader))
            .where(Attachment.id == attachment_id)
        )
        if attachment is None:
            raise not_found("Attachment")
        return attachment

AttachmentsServiceDep = Annotated[AttachmentsService, Depends()]
```

**`app/attachments/router.py`** · new file

```python
from typing import Annotated

from fastapi import APIRouter
from fastapi import Query

from app.attachments.schemas import AttachmentOut
from app.attachments.schemas import AttachmentUpload
from app.attachments.schemas import CreateAttachmentIn
from app.attachments.schemas import PresignedUrl
from app.attachments.service import AttachmentsServiceDep
from app.auth.dependencies import CurrentUser
from app.core.pagination import Page
from app.core.pagination import PageQuery
from app.core.params import AttachmentId
from app.core.params import TaskId

router = APIRouter(tags=["attachments"])

@router.get("/tasks/{taskId}/attachments")
async def list_attachments(
    task_id: TaskId,
    user_id: CurrentUser,
    page: Annotated[PageQuery, Query()],
    attachments: AttachmentsServiceDep,
) -> Page[AttachmentOut]:
    return await attachments.list(task_id, user_id, page)

@router.post("/tasks/{taskId}/attachments", status_code=201)
async def create_attachment(
    task_id: TaskId,
    user_id: CurrentUser,
    body: CreateAttachmentIn,
    attachments: AttachmentsServiceDep,
) -> AttachmentUpload:
    return await attachments.create(task_id, user_id, body)

@router.delete("/attachments/{attachmentId}", status_code=204)
async def delete_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> None:
    await attachments.delete(attachment_id, user_id)

@router.post("/attachments/{attachmentId}/complete")
async def complete_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> AttachmentOut:
    return await attachments.complete(attachment_id, user_id)

@router.get("/attachments/{attachmentId}/download")
async def download_attachment(
    attachment_id: AttachmentId, user_id: CurrentUser, attachments: AttachmentsServiceDep
) -> PresignedUrl:
    return await attachments.download(attachment_id, user_id)
```

**What's new**
- Download URLs live 5 minutes, upload URLs 15; `_expires_at` reports when, so clients can refresh before using a stale one.
- A deleted attachment's object is removed by a job after the commit.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 100 source files`.

**Commit:** `feat: attachments with presigned uploads and downloads`

### Step 9.3 · Wiring and tests

**Goal:** the attachment routes in the app, the bucket ensured before the tests, and tests that upload real bytes to S3.

**Files:** `app/main.py`, `tests/conftest.py`, `tests/test_attachments.py`

**`app/main.py`** · add after `from app.activity.router import router as activity_router`

```python
from app.attachments.router import router as attachments_router
```

**`app/main.py`** · add after `protected.include_router(search_router)`

```python
    protected.include_router(attachments_router)
```

**`tests/conftest.py`** · add before `import pytest`

```python
import boto3
```

**`tests/conftest.py`** · add after `from alembic.config import Config`

```python
from botocore.exceptions import ClientError
```

**`tests/conftest.py`** · add before `def pytest_sessionstart(session: pytest.Session) -> None:`

```python
def _create_bucket(settings: Settings) -> None:
    s3 = boto3.client(
        "s3",
        endpoint_url=str(settings.s3_endpoint),
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )
    try:
        s3.head_bucket(Bucket=settings.s3_bucket)
    except ClientError:
        s3.create_bucket(Bucket=settings.s3_bucket)

```

**`tests/conftest.py`** · add after `command.upgrade(Config("alembic.ini"), "head")`

```python
    # CI's S3 service has no init job; locally the bucket usually exists already.
    _create_bucket(get_settings())
```

**What's new**
- CI's S3 service container has no `s3-init` job, so the test session creates the bucket when it's missing. boto3's synchronous client is fine here: no event loop is running yet.

**`tests/test_attachments.py`** · new file

```python
from typing import Any

import httpx
import pytest
from httpx import AsyncClient
from httpx import Response

from tests.helpers import Fixture
from tests.helpers import create_fixture
from tests.helpers import send

@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)

@pytest.fixture
async def task_id(client: AsyncClient, f: Fixture) -> str:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    res = await send(client, "POST", url, user=f.owner, json={"title": "Has files"}, status=201)
    return str(res.json()["id"])

async def start(
    client: AsyncClient, f: Fixture, task_id: str, status: int, **body: Any
) -> Response:
    url = f"/api/v1/tasks/{task_id}/attachments"
    return await send(client, "POST", url, user=f.owner, json=body, status=status)

async def test_upload_straight_to_s3_then_complete_and_download(
    client: AsyncClient, f: Fixture, task_id: str
) -> None:
    content = b"hello attachment"
    res = await start(
        client,
        f,
        task_id,
        201,
        fileName="notes résumé.txt",
        contentType="text/plain",
        sizeBytes=len(content),
    )
    attachment, upload = res.json()["attachment"], res.json()["upload"]
    url = f"/api/v1/attachments/{attachment['id']}"
    assert (attachment["status"], upload["method"]) == ("pending", "PUT")

    # Completing before the bytes exist is a conflict.
    await send(client, "POST", f"{url}/complete", user=f.owner, status=409)

    async with httpx.AsyncClient() as s3:  # a real HTTP client: the browser's part
        put = await s3.put(upload["url"], headers=upload["headers"], content=content)
        assert put.status_code == 200

        done = await send(client, "POST", f"{url}/complete", user=f.owner, status=200)
        assert (done.json()["status"], done.json()["sizeBytes"]) == ("ready", len(content))

        listed = await send(
            client, "GET", f"/api/v1/tasks/{task_id}/attachments", user=f.owner, status=200
        )
        assert len(listed.json()["items"]) == 1

        download = await send(client, "GET", f"{url}/download", user=f.owner, status=200)
        file = await s3.get(download.json()["url"])
        assert file.content == content
        assert (
            "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt" in file.headers["content-disposition"]
        )

    await send(client, "DELETE", url, user=f.owner, status=204)
    await send(client, "GET", f"{url}/download", user=f.owner, status=404)

async def test_an_upload_of_a_different_size_is_refused(
    client: AsyncClient, f: Fixture, task_id: str
) -> None:
    res = await start(
        client, f, task_id, 201, fileName="a.txt", contentType="text/plain", sizeBytes=5
    )
    attachment, upload = res.json()["attachment"], res.json()["upload"]
    async with httpx.AsyncClient() as s3:
        # The signed Content-Length makes S3 itself reject a different size.
        put = await s3.put(upload["url"], headers=upload["headers"], content=b"way too long")
    assert put.is_error
    await send(
        client, "POST", f"/api/v1/attachments/{attachment['id']}/complete", user=f.owner, status=409
    )

async def test_file_metadata_is_validated(client: AsyncClient, f: Fixture, task_id: str) -> None:
    res = await start(
        client,
        f,
        task_id,
        422,
        fileName="../etc/passwd",
        contentType="Text/Plain",
        sizeBytes=30 * 1024 * 1024,
    )
    assert sorted(e["field"] for e in res.json()["errors"]) == [
        "contentType",
        "fileName",
        "sizeBytes",
    ]
```

**What's new**
- **A real HTTP client for the browser's part:** `httpx.AsyncClient()` without a transport sends real requests over the network, here to RustFS: the test uploads bytes to the presigned URL, completes, then downloads through the presigned GET and checks the bytes and the `Content-Disposition`.
- **`assert put.is_error`**: S3 rejects a body whose size differs from the signed `Content-Length`.
- **Fixtures depending on fixtures:** `task_id` needs `f`, which needs `client`.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `64 passed`.

**Commit:** `feat: attachment routes and tests against real s3`

---
## Part 10 · Real-time (WebSockets, Pub/Sub, presence)

The protocol is the README's §9: the client trades its JWT for a 30-second ticket, opens `/ws?ticket=…`, subscribes to projects, and receives `{type, payload, ts}` envelopes. Every API instance subscribes to Redis Pub/Sub for the projects its own sockets watch, so a change handled by any instance reaches every viewer.

### Step 10.1 · Tickets, presence and the message parser

**Goal:** single-use WebSocket tickets, presence in a Redis sorted set, and a validating parser for client messages.

**Files:** `app/realtime/tickets.py`, `app/realtime/presence.py`, `app/realtime/publisher.py`, `app/realtime/messages.py`, `tests/unit/test_messages.py`

**`app/realtime/tickets.py`** · new file

```python
import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from uuid import UUID

from redis.asyncio import Redis

from app.core.schemas import CamelModel

TTL_SECONDS = 30

def _key(ticket: str) -> str:
    return f"ws:ticket:{ticket}"

class TicketOut(CamelModel):
    ticket: str
    expires_at: datetime

class Tickets:
    """Browsers can't set Authorization on a WebSocket handshake: they trade a JWT for a ticket."""

    def __init__(self, redis: Redis) -> None:
        self.redis = redis

    async def issue(self, user_id: UUID) -> TicketOut:
        ticket = secrets.token_urlsafe(32)
        await self.redis.set(_key(ticket), str(user_id), ex=TTL_SECONDS)
        return TicketOut(
            ticket=ticket, expires_at=datetime.now(UTC) + timedelta(seconds=TTL_SECONDS)
        )

    async def redeem(self, ticket: str) -> UUID | None:
        """Single use: GETDEL reads and deletes in one atomic step."""
        user_id = await self.redis.getdel(_key(ticket))
        return UUID(str(user_id)) if user_id is not None else None
```

**What's new**
- **`getdel`** reads and deletes the key in one atomic command (`GETDEL`): a ticket works once, even if two connections race with it.
- `UUID(str(user_id))`: Redis returns text; the user id goes back to a `UUID`.

**`app/realtime/presence.py`** · new file

```python
import time
from uuid import UUID

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.users.schemas import UserSummary
from app.users.service import UsersService

STALE_AFTER_MS = 60_000
KEY_TTL_SECONDS = 300

def _key(project_id: UUID) -> str:
    return f"presence:project:{project_id}"

def _member(user_id: UUID, connection_id: UUID) -> str:
    return f"{user_id}:{connection_id}"

def _now_ms() -> int:
    return time.time_ns() // 1_000_000

class Presence:
    """A sorted set per project: member "userId:connectionId", score = last seen (ms).
    One user with two tabs has two members, so closing one tab doesn't hide them."""

    def __init__(self, redis: Redis, sessions: async_sessionmaker[AsyncSession]) -> None:
        self.redis = redis
        self.sessions = sessions

    async def touch(self, project_id: UUID, user_id: UUID, connection_id: UUID) -> None:
        async with self.redis.pipeline(transaction=True) as tx:
            tx.zadd(_key(project_id), {_member(user_id, connection_id): _now_ms()})
            tx.expire(_key(project_id), KEY_TTL_SECONDS)
            await tx.execute()

    async def leave(self, project_id: UUID, user_id: UUID, connection_id: UUID) -> None:
        await self.redis.zrem(_key(project_id), _member(user_id, connection_id))

    async def online(self, project_id: UUID) -> list[UserSummary]:
        # Drop connections that died without a clean close, then read who's left.
        await self.redis.zremrangebyscore(_key(project_id), "-inf", _now_ms() - STALE_AFTER_MS)
        members = await self.redis.zrange(_key(project_id), 0, -1)
        user_ids = {UUID(str(m).split(":", 1)[0]) for m in members}
        if not user_ids:
            return []
        async with self.sessions() as session:
            users = await UsersService(session).get_many(user_ids)
        return sorted((UserSummary.of(u) for u in users), key=lambda u: u.display_name)
```

**What's new**
- **`zadd(key, {member: score})`** takes a dict of members to scores. The pipeline sets the score and refreshes the key's TTL in one round trip.
- **`{UUID(...) for m in members}`** is a **set comprehension**: one user with two tabs has two members but appears once.
- **`sorted(..., key=lambda u: u.display_name)`** sorts by a computed key, like `toSorted((a, b) => a.displayName.localeCompare(b.displayName))`.
- Presence looks users up with a **short session of its own** (`async with self.sessions() as session:`): it runs outside any HTTP request, inside the WebSocket hub.

> **🧠 DSA & scalability · Presence in a sorted set**
> - **Data structure:** Redis sorted set `presence:project:{id}`; member `userId:connectionId`, score = last seen (ms); key TTL 5 minutes after the last write.
> - **Algorithm:** subscribe or ping → `ZADD` (refresh the score); unsubscribe or disconnect → `ZREM`; read → `ZREMRANGEBYSCORE -inf (now − 60 s)` (drop connections that died without saying so), `ZRANGE`, dedupe by user, look the users up in one `IN (...)` query.
> - **Complexity:** O(log n) per heartbeat; O(log n + k) per read for k expired members.
> - **Why it scales:** shared across instances, self-cleaning (crashed instances' entries age out), and one member per *connection*, so closing one of two tabs doesn't hide you.
> - **Alternatives rejected:** a Redis set of user ids (no per-member expiry: a crashed instance leaves ghosts forever); a TTL key per user (finding all of a project's keys means scanning the keyspace).

**`app/realtime/publisher.py`** · add after `from app.deps import RedisDep`

```python
from app.users.schemas import UserSummary
```

**`app/realtime/publisher.py`** · add after `comment: CommentOut`

```python

class PresenceUpdated(CamelModel):
    project_id: UUID
    users: list[UserSummary]
```

**`app/realtime/messages.py`** · new file

```python
from typing import Annotated
from typing import Literal
from uuid import UUID

from pydantic import Field
from pydantic import TypeAdapter
from pydantic import ValidationError

from app.core.schemas import CamelModel

class ProjectRef(CamelModel):
    project_id: UUID

class Subscribe(CamelModel):
    type: Literal["subscribe"]
    payload: ProjectRef

class Unsubscribe(CamelModel):
    type: Literal["unsubscribe"]
    payload: ProjectRef

class Ping(CamelModel):
    type: Literal["ping"]

# A discriminated union: Pydantic reads `type` first and validates against that one model only.
type ClientMessage = Annotated[Subscribe | Unsubscribe | Ping, Field(discriminator="type")]
_client_message: TypeAdapter[ClientMessage] = TypeAdapter(ClientMessage)

def parse_client_message(raw: str) -> Subscribe | Unsubscribe | Ping | None:
    """A validated message, or None for anything malformed (bad JSON, unknown type, bad id)."""
    try:
        return _client_message.validate_json(raw)
    except ValidationError:
        return None
```

**`tests/unit/test_messages.py`** · new file

```python
from uuid import UUID

import pytest

from app.realtime.messages import Ping
from app.realtime.messages import Subscribe
from app.realtime.messages import parse_client_message

PROJECT_ID = "01a18b7e-951f-71f4-affb-2b64a14174e2"

def test_valid_messages_become_typed_objects() -> None:
    message = parse_client_message(
        f'{{"type":"subscribe","payload":{{"projectId":"{PROJECT_ID}"}}}}'
    )
    assert isinstance(message, Subscribe)
    assert message.payload.project_id == UUID(PROJECT_ID)
    assert isinstance(parse_client_message('{"type":"ping"}'), Ping)

@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "42",
        '{"type":"nonsense"}',
        '{"type":"subscribe"}',
        '{"type":"subscribe","payload":{"projectId":"nope"}}',
    ],
)
def test_anything_malformed_is_none(raw: str) -> None:
    assert parse_client_message(raw) is None
```

**What's new (TS → Pydantic)**
- **A discriminated union:** `Annotated[Subscribe | Unsubscribe | Ping, Field(discriminator="type")]`. Pydantic reads `type` first and validates against that one model, the way a TS discriminated union narrows on `type`. A message with an unknown `type`, bad JSON, or a bad `projectId` fails validation.
- **`TypeAdapter`** validates against any type, not just a model: `_client_message.validate_json(raw)` parses and validates in one step. It's built once at import time and reused.
- **`case Subscribe(payload=ref):`** in the hub (next step) matches by class and extracts an attribute: `match` works on objects as well as tuples.

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `20 passed`.

**Commit:** `feat: websocket tickets, presence and message parsing`

### Step 10.2 · The WebSocket hub

**Goal:** accept connections with a ticket, route client messages, forward Pub/Sub events to this instance's sockets, keep presence fresh, and close everything cleanly at shutdown.

**Files:** `app/realtime/hub.py`

**`app/realtime/hub.py`** · new file

```python
import asyncio
import contextlib
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from dataclasses import field
from typing import Annotated
from typing import cast
from uuid import UUID
from uuid import uuid7

import structlog
from fastapi import Depends
from fastapi.requests import HTTPConnection
from redis.asyncio import Redis
from redis.asyncio.client import PubSub
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.ext.asyncio import async_sessionmaker
from starlette.websockets import WebSocket
from starlette.websockets import WebSocketState

from app.access.service import AccessService
from app.core.problems import ProblemError
from app.core.schemas import CamelModel
from app.infra.resources import Resources
from app.realtime.messages import Ping
from app.realtime.messages import Subscribe
from app.realtime.messages import parse_client_message
from app.realtime.presence import Presence
from app.realtime.publisher import PresenceUpdated
from app.realtime.publisher import Publisher
from app.realtime.publisher import envelope
from app.realtime.publisher import project_channel
from app.realtime.tickets import Tickets

log = structlog.get_logger("realtime")

CLOSE_GOING_AWAY = 1001
CLOSE_TOO_BIG = 1009
CLOSE_BAD_MESSAGES = 4400
CLOSE_UNAUTHORIZED = 4401
MAX_BAD_MESSAGES = 10
MAX_MESSAGE_CHARS = 16 * 1024
IDLE_TIMEOUT_S = 75

@dataclass(eq=False)  # eq=False keeps identity hashing, so a Client can live in a set
class Client:
    ws: WebSocket
    user_id: UUID
    connection_id: UUID = field(default_factory=uuid7)
    projects: set[UUID] = field(default_factory=set)
    last_seen: float = field(default_factory=time.monotonic)
    bad_messages: int = 0
    # One socket, several writers (its own handler, the Pub/Sub relay): send one frame at a time.
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
```

**What's new**
- **`@dataclass(eq=False)`**: a dataclass normally compares by field values, and Python then makes it unhashable (two "equal" mutable objects can't be set members). `eq=False` keeps comparison by identity, so each `Client` can live in a `set`.
- **`field(default_factory=set)`** gives each instance its *own* new set; a plain `= set()` default would be one set shared by every client ([gotcha](../../docs/gotchas.md#mutable-default-arguments)).
- **`asyncio.Lock`** per client: two tasks (the client's own handler and the Pub/Sub relay) may send on the same socket at the same moment, and frames must not interleave. `async with client.send_lock:` takes it.

**`app/realtime/hub.py`** · continue

```python

class Hub:
    """This instance's WebSocket connections. Events reach it through Redis Pub/Sub, so a write
    handled by any instance reaches sockets connected to every instance."""

    def __init__(self, redis: Redis, sessions: async_sessionmaker[AsyncSession]) -> None:
        self.sessions = sessions
        self.tickets = Tickets(redis)
        self.presence = Presence(redis, sessions)
        self.publisher = Publisher(redis)
        # A connection in SUBSCRIBE mode can't run other commands, so Pub/Sub gets its own.
        self.pubsub: PubSub = redis.pubsub(ignore_subscribe_messages=True)
        self.local: dict[UUID, set[Client]] = {}  # projectId → this instance's sockets
        self.clients: set[Client] = set()
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        self._tasks.append(asyncio.create_task(self._reap_idle()))

    async def close(self) -> None:
        for client in list(self.clients):
            await self._close(client, CLOSE_GOING_AWAY, "server shutting down")
        for task in self._tasks:
            task.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        # redis-py leaves PubSub.aclose() unannotated, which strict mypy reports.
        await self.pubsub.aclose()  # type: ignore[no-untyped-call]

    async def serve(self, ws: WebSocket) -> None:
        """One connection, from handshake to close."""
        await ws.accept()
        ticket = ws.query_params.get("ticket")
        user_id = await self.tickets.redeem(ticket) if ticket else None
        if user_id is None:
            # The handshake is already accepted, so the browser can read this close code.
            await ws.close(CLOSE_UNAUTHORIZED, "invalid or expired ticket")
            return
        client = Client(ws=ws, user_id=user_id)
        self.clients.add(client)
        try:
            while True:
                message = await ws.receive()
                if message["type"] == "websocket.disconnect":
                    break
                text = message.get("text") or (message.get("bytes") or b"").decode(errors="replace")
                if len(text) > MAX_MESSAGE_CHARS:
                    await self._close(client, CLOSE_TOO_BIG, "message too big")
                    break
                client.last_seen = time.monotonic()
                await self._handle(client, text)
        finally:
            self.clients.discard(client)
            for project_id in list(client.projects):
                await self._unsubscribe(client, project_id)
```

**What's new (TS → Starlette WebSockets)**
- **`await ws.accept()` first, then check the ticket:** the handshake succeeds, then a bad ticket gets `close(4401, ...)`, a code the browser can read. (Rejecting the handshake itself would only give the browser a generic failure.)
- **`await ws.receive()`** waits for the next message: a dict whose `type` is `websocket.receive` (with `text` or `bytes`) or `websocket.disconnect`. The loop runs until the client leaves; `finally:` unsubscribes everything, whatever ended the loop. Each connection runs in its own task, so this loop doesn't block other connections.
- **`asyncio.create_task(...)`** starts a coroutine running in the background (a promise you didn't await); `task.cancel()` stops it at its next `await`, and `asyncio.gather(*tasks, return_exceptions=True)` waits for them to finish without raising their `CancelledError`s.
- **`redis.pubsub()`** gets a dedicated connection: a connection in `SUBSCRIBE` mode can't run other commands.
- **16 KiB message limit:** larger messages close the socket with 1009 (message too big). The protocol's messages are tiny.

**`app/realtime/hub.py`** · continue

```python

    async def _handle(self, client: Client, text: str) -> None:
        message = parse_client_message(text)
        try:
            match message:
                case Subscribe(payload=ref):
                    await self._subscribe(client, ref.project_id)
                case Ping():
                    for project_id in client.projects:
                        await self.presence.touch(project_id, client.user_id, client.connection_id)
                    await self._send(client, envelope("pong"))
                case None:
                    client.bad_messages += 1
                    if client.bad_messages > MAX_BAD_MESSAGES:
                        await self._close(client, CLOSE_BAD_MESSAGES, "too many malformed messages")
                        return
                    await self._error(client, "bad_message", "Malformed message")
                case _:  # Unsubscribe: the only type left
                    await self._unsubscribe(client, message.payload.project_id)
        except ProblemError as err:
            if err.status not in (403, 404):
                raise
            await self._error(client, "not_found" if err.status == 404 else "forbidden", err.detail)

    async def _subscribe(self, client: Client, project_id: UUID) -> None:
        async with self.sessions() as session:
            await AccessService(session).project(project_id, client.user_id)
        if project_id not in client.projects:
            client.projects.add(project_id)
            sockets = self.local.setdefault(project_id, set())
            if not sockets:  # the first local socket for this project: start listening
                await self.pubsub.subscribe(project_channel(project_id))
                if len(self._tasks) == 1:
                    self._tasks.append(asyncio.create_task(self._relay()))
            sockets.add(client)
        await self.presence.touch(project_id, client.user_id, client.connection_id)
        await self._send(client, envelope("subscribed", _ProjectPayload(project_id=project_id)))
        await self._broadcast_presence(project_id)

    async def _unsubscribe(self, client: Client, project_id: UUID) -> None:
        if project_id not in client.projects:
            return
        client.projects.discard(project_id)
        sockets = self.local.get(project_id, set())
        sockets.discard(client)
        if not sockets:  # the last local socket left: stop listening
            self.local.pop(project_id, None)
            await self.pubsub.unsubscribe(project_channel(project_id))
        await self.presence.leave(project_id, client.user_id, client.connection_id)
        await self._broadcast_presence(project_id)

    async def _broadcast_presence(self, project_id: UUID) -> None:
        users = await self.presence.online(project_id)
        await self.publisher.publish(
            project_id, "presence.updated", PresenceUpdated(project_id=project_id, users=users)
        )
```

**What's new**
- **`match message:`** dispatches on the parsed message: `case Subscribe(payload=ref):` (class pattern), `case Ping():`, `case None:` (malformed, counted; more than 10 closes with 4400), and `case _:` for the last type left.
- **Errors become frames:** the access check raises our `ProblemError` (404/403); the hub turns it into an `error` envelope (`not_found` / `forbidden`) instead of closing.
- **Reference counting:** the instance `SUBSCRIBE`s to `project:{id}` when its first local socket subscribes to that project, and `UNSUBSCRIBE`s when the last one leaves. `self.local.setdefault(project_id, set())` returns the existing set or stores and returns a new one.
- The relay task starts with the first subscription: redis-py refuses to read Pub/Sub messages before anything is subscribed.

**`app/realtime/hub.py`** · continue

```python

    async def _relay(self) -> None:
        """Forwards every Pub/Sub message to this instance's sockets for that project."""
        while True:
            message = await self.pubsub.get_message(timeout=1.0)
            if message is None or message["type"] != "message":
                continue
            project_id = UUID(str(message["channel"]).removeprefix("project:"))
            clients = list(self.local.get(project_id, ()))
            await asyncio.gather(*(self._send(c, str(message["data"])) for c in clients))

    async def _reap_idle(self) -> None:
        """Clients ping every 25 s; one that's silent for 75 s is gone without saying so."""
        while True:
            await asyncio.sleep(30)
            cutoff = time.monotonic() - IDLE_TIMEOUT_S
            for client in [c for c in self.clients if c.last_seen < cutoff]:
                await self._close(client, CLOSE_GOING_AWAY, "idle")

    async def _error(self, client: Client, code: str, message: str) -> None:
        await self._send(client, envelope("error", _ErrorPayload(code=code, message=message)))

    async def _send(self, client: Client, text: str) -> None:
        async with client.send_lock:
            if client.ws.application_state is WebSocketState.CONNECTED:
                with contextlib.suppress(Exception):  # the peer may vanish mid-send
                    await client.ws.send_text(text)

    async def _close(self, client: Client, code: int, reason: str) -> None:
        async with client.send_lock:
            if client.ws.application_state is WebSocketState.CONNECTED:
                with contextlib.suppress(Exception):
                    await client.ws.close(code, reason)
```

**What's new**
- **`_relay`** loops forever: `get_message(timeout=1.0)` returns the next Pub/Sub message or `None` after a second, and each message is sent to every local socket watching that project, concurrently (`gather`).
- **`_reap_idle`**: clients ping every 25 s; one silent for 75 s is closed. `[c for c in self.clients if ...]` copies the matching clients first, because closing changes the set.
- **`contextlib.suppress(Exception)`** is `try: ... except Exception: pass` as a context manager: a peer can vanish mid-send, and that's not an error worth logging.
- **`WebSocketState.CONNECTED`** checks the socket is still open before writing.

**`app/realtime/hub.py`** · continue

```python

class _ProjectPayload(CamelModel):
    project_id: UUID

class _ErrorPayload(CamelModel):
    code: str
    message: str

@asynccontextmanager
async def running_hub(resources: Resources) -> AsyncIterator[Hub]:
    """Started with the app (the lifespan enters it), closed at shutdown."""
    hub = Hub(resources.redis, resources.sessions)
    await hub.start()
    try:
        yield hub
    finally:
        await hub.close()

def get_hub(conn: HTTPConnection) -> Hub:
    return cast(Hub, conn.app.state.hub)

HubDep = Annotated[Hub, Depends(get_hub)]
```

**What's new**
- **`running_hub`** is an async context manager: start the hub, yield it, close it on the way out. The app's lifespan enters it (next step); closing sends 1001 to every socket the hub still has open.
- **`get_hub`** reads the hub from `app.state`, like `get_resources`. The hub isn't a field of `Resources`: it depends on the access and users services, which depend on `deps.py`, which depends on `Resources`. Keeping it separate avoids a circular import, and keeps `Resources` about pools and clients ([gotcha](../../docs/gotchas.md#circular-imports)).

> **🧠 DSA & scalability · Fan-out through Redis Pub/Sub**
> - **Data structure:** per instance, `local: dict[projectId, set[Client]]` in memory; one Redis channel per project.
> - **Algorithm:** a write commits → the service `PUBLISH`es the envelope to `project:{id}` → every instance subscribed to that channel receives it once → each sends it to its local sockets for that project.
> - **Complexity:** O(instances) messages from Redis per event, O(local subscribers) sends per instance; subscribe/unsubscribe are O(1) with reference counting.
> - **Why it scales:** instances share nothing but Redis, so you can run as many as you need behind a load balancer; an instance only receives events for projects its own sockets watch.
> - **Alternatives rejected:** broadcasting from the API process only to its own sockets (viewers on other instances miss events); one channel for everything (every instance receives every event); Socket.IO's Redis adapter (ties the frontend to Socket.IO). Pub/Sub is at-most-once: a reconnecting client refetches the board after `subscribed` (Pulse upgrades this to Redis Streams).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 106 source files`.

**Commit:** `feat: websocket hub with pub/sub fan-out and presence`

### Step 10.3 · Wiring and tests

**Goal:** the ticket route and the `/ws` endpoint, the hub in the lifespan, and tests with two complete API instances.

**Files:** `app/realtime/router.py`, `app/main.py`, `tests/test_realtime.py`

```bash
uv add --dev --bounds exact websockets==17.4
```

- **websockets** is the WebSocket library uvicorn itself uses; the tests use its client (the `ws` package's role).

**`app/realtime/router.py`** · new file

```python
from fastapi import APIRouter
from fastapi import WebSocket

from app.auth.dependencies import CurrentUser
from app.realtime.hub import HubDep
from app.realtime.tickets import TicketOut

router = APIRouter(tags=["realtime"])
# The socket itself sits at the root (/ws), outside /api/v1, and authenticates with a ticket.
ws_router = APIRouter()

@router.post("/ws/ticket", status_code=201)
async def issue_ticket(user_id: CurrentUser, hub: HubDep) -> TicketOut:
    return await hub.tickets.issue(user_id)

@ws_router.websocket("/ws")
async def websocket(ws: WebSocket, hub: HubDep) -> None:
    await hub.serve(ws)
```

**What's new**
- **`@ws_router.websocket("/ws")`** registers a WebSocket endpoint; its function receives the `WebSocket` and any dependencies. The socket lives at the root, outside `/api/v1`, and outside `protected`: it authenticates with the ticket, not a bearer header (browsers can't set headers on a WebSocket handshake).

**`app/main.py`** · add after `from app.projects.router import router as projects_router`

```python
from app.realtime.hub import running_hub
from app.realtime.router import router as realtime_router
from app.realtime.router import ws_router
```

**`app/main.py`** · add after `app.state.resources = resources`

```python
            app.state.hub = await stack.enter_async_context(running_hub(resources))
```

**`app/main.py`** · add after `protected.include_router(attachments_router)`

```python
    protected.include_router(realtime_router)
```

**`app/main.py`** · add after `app.include_router(api)`

```python
    app.include_router(ws_router)
```

**What's new**
- **One line in the lifespan** adds the hub to the exit stack (Step 3.6): it starts after the resources it uses and closes before them.

**`tests/test_realtime.py`** · new file

```python
import asyncio
import json
from collections.abc import AsyncIterator
from collections.abc import Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import pytest
import uvicorn
from httpx import AsyncClient
from websockets.asyncio.client import ClientConnection
from websockets.asyncio.client import connect

from app.infra.resources import Resources
from app.main import create_app
from tests.helpers import ApiUser
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import register_user
from tests.helpers import reset_state
from tests.helpers import send

type Envelope = dict[str, Any]

class Socket:
    """A WebSocket client that collects every message, so a test can wait for a given type."""

    def __init__(self, conn: ClientConnection) -> None:
        self.conn = conn
        self.received: list[Envelope] = []
        self._arrived = asyncio.Event()
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        async for raw in self.conn:
            self.received.append(json.loads(raw))
            self._arrived.set()

    async def send(self, message: Envelope) -> None:
        await self.conn.send(json.dumps(message))

    async def next(self, type: str, match: Callable[[Envelope], bool] = lambda e: True) -> Envelope:
        """The first message of `type` (already received, or arriving within 5 s)."""
        async with asyncio.timeout(5):
            while True:
                self._arrived.clear()
                for i, message in enumerate(self.received):
                    if message["type"] == type and match(message):
                        return self.received.pop(i)
                await self._arrived.wait()

    async def close(self) -> None:
        await self.conn.close()
        await self._reader
```

**What's new**
- **`Socket`** collects every message in a background task (`async for raw in self.conn:` reads messages until the socket closes), so a test can wait for "the next `task.created`" whatever arrived first. **`asyncio.Event`** is a flag tasks can wait on; `next` clears it, scans, and waits for the reader to set it again.
- **`asyncio.timeout(5)`**: a waiting test fails after 5 seconds instead of hanging.

**`tests/test_realtime.py`** · continue

```python

@dataclass(frozen=True)
class Instance:
    http: AsyncClient
    host: str
    resources: Resources

@asynccontextmanager
async def serve() -> AsyncIterator[Instance]:
    """A complete app on a real port: its own uvicorn, hub, database pool and Redis connections."""
    app = create_app()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None))
    task = asyncio.create_task(server.serve())
    while not server.started:  # noqa: ASYNC110 (uvicorn offers a flag, not an event)
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    host = f"127.0.0.1:{port}"
    try:
        async with AsyncClient(base_url=f"http://{host}") as http:
            yield Instance(http=http, host=host, resources=app.state.resources)
    finally:
        server.should_exit = True
        await task

# Two "API instances" in one process. Only Postgres and Redis are shared between them.
@pytest.fixture(scope="module")
async def instances() -> AsyncIterator[tuple[Instance, Instance]]:
    async with serve() as a, serve() as b:
        yield a, b

@pytest.fixture
async def f(instances: tuple[Instance, Instance]) -> Fixture:
    a, _ = instances
    await reset_state(a.resources)
    return await create_fixture(a.http)

async def open_socket(instance: Instance, user: ApiUser) -> Socket:
    res = await send(instance.http, "POST", "/api/v1/ws/ticket", user=user, status=201)
    return Socket(await connect(f"ws://{instance.host}/ws?ticket={res.json()['ticket']}"))

```

**What's new**
- **Two real servers in the test's event loop:** `uvicorn.Server(uvicorn.Config(app, port=0))` with `port=0` picks a free port; `server.serve()` runs as a task (with the app's lifespan); `server.should_exit = True` stops it. Each instance has its own hub, pools and Redis connections; only Postgres and Redis are shared, exactly as in production.
- **`@pytest.fixture(scope="module")`**: the two servers start once for this file.
- **`async with serve() as a, serve() as b:`** enters two context managers in one statement.

**`tests/test_realtime.py`** · continue

```python
async def test_events_fan_out_across_instances_through_redis(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, b = instances
    socket = await open_socket(a, f.owner)
    await socket.send({"type": "subscribe", "payload": {"projectId": f.project_id}})
    await socket.next("subscribed")
    presence = await socket.next("presence.updated")
    assert [u["id"] for u in presence["payload"]["users"]] == [f.owner.id]

    # The write goes through instance B; the socket lives on instance A.
    url = f"/api/v1/projects/{f.project_id}/tasks"
    await send(b.http, "POST", url, user=f.owner, json={"title": "Live!"}, status=201)
    event = await socket.next("task.created")
    assert (event["payload"]["title"], event["payload"]["key"]) == ("Live!", "TF-1")
    assert event["ts"].endswith("Z")

    await socket.send({"type": "ping"})
    await socket.next("pong")
    await socket.close()

async def test_a_bad_ticket_closes_with_4401_and_tickets_are_single_use(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, _ = instances
    async with connect(f"ws://{a.host}/ws?ticket=nope") as bad:
        await bad.wait_closed()
    assert bad.close_code == 4401

    res = await send(a.http, "POST", "/api/v1/ws/ticket", user=f.owner, status=201)
    ticket = res.json()["ticket"]
    first = Socket(await connect(f"ws://{a.host}/ws?ticket={ticket}"))
    async with connect(f"ws://{a.host}/ws?ticket={ticket}") as reused:
        await reused.wait_closed()
    assert reused.close_code == 4401
    await first.close()

async def test_subscriptions_outside_your_workspaces_are_refused(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, _ = instances
    outsider = await register_user(a.http, "Outsider")
    socket = await open_socket(a, outsider)
    await socket.send({"type": "subscribe", "payload": {"projectId": f.project_id}})
    assert (await socket.next("error"))["payload"]["code"] == "not_found"
    await socket.send({"type": "nonsense"})
    assert (await socket.next("error"))["payload"]["code"] == "bad_message"
    await socket.close()

async def test_presence_updates_when_a_viewer_leaves(
    instances: tuple[Instance, Instance], f: Fixture
) -> None:
    a, b = instances
    other = await register_user(a.http, "Other")
    await add_member(a.resources, f.workspace_id, other, "viewer")
    subscribe = {"type": "subscribe", "payload": {"projectId": f.project_id}}

    watcher = await open_socket(a, f.owner)
    await watcher.send(subscribe)
    await watcher.next("subscribed")

    leaver = await open_socket(b, other)
    await leaver.send(subscribe)
    await watcher.next("presence.updated", lambda e: len(e["payload"]["users"]) == 2)

    await leaver.close()
    await watcher.next("presence.updated", lambda e: len(e["payload"]["users"]) == 1)
    await watcher.close()
```

**What's new**
- **The fan-out test** subscribes a socket on instance A and creates a task through instance B: the event can only arrive through Redis.
- **`await bad.wait_closed()` then `bad.close_code`**: the close code the server sent (4401).

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `74 passed`.

**Commit:** `feat: websocket routes, wired into the lifespan`

---
## Part 11 · Background jobs & schedules

The API has been enqueueing jobs since Part 5. This Part writes the other side: what each job does, and a **Celery worker** that runs them, with retries, plus **Celery Beat**, the scheduler that enqueues the two periodic jobs (README §11).

### Step 11.1 · The mailer and the job handlers

**Goal:** send email over SMTP, and implement the five jobs as plain async methods that the worker and the tests both call.

**Files:** `app/jobs/mailer.py`, `app/jobs/handlers.py`, `app/jobs/queue.py`

```bash
uv add --bounds exact aiosmtplib==5.1.3
```

- **aiosmtplib** is an async SMTP client (nodemailer's sending role): an `async` send that doesn't block the event loop.

**`app/jobs/mailer.py`** · new file

```python
from email.message import EmailMessage

import aiosmtplib

from app.config import Settings

class Mailer:
    def __init__(self, settings: Settings) -> None:
        self.host = settings.smtp_host
        self.port = settings.smtp_port
        self.sender = settings.mail_from

    async def send(self, *, to: str, subject: str, text: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text)
        # Mailpit speaks plain SMTP; a real provider would add start_tls and credentials.
        await aiosmtplib.send(message, hostname=self.host, port=self.port, start_tls=False)
```

**What's new**
- **`EmailMessage`** is the standard library's email builder: headers by item assignment (`message["To"] = ...`), `set_content` for the plain-text body.
- Mailpit speaks plain SMTP, so `start_tls=False`; a real provider would add TLS and credentials.

**`app/jobs/handlers.py`** · new file

```python
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from urllib.parse import quote
from uuid import UUID

import structlog
from sqlalchemy import delete
from sqlalchemy import select
from sqlalchemy import text
from sqlalchemy.orm import joinedload

from app.infra.resources import Resources
from app.jobs.mailer import Mailer
from app.models.task import Attachment
from app.models.task import Task

log = structlog.get_logger("jobs")

STALE_UPLOAD_AGE = timedelta(hours=24)

# SKIP LOCKED lets several schedulers run at once without blocking each other or claiming
# the same rows; setting reminder_sent_at is the claim.
_CLAIM_DUE_TASKS = text("""
UPDATE tasks SET reminder_sent_at = now()
WHERE id IN (
    SELECT id FROM tasks
    WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
      AND due_at > now() AND due_at <= now() + interval '24 hours'
    ORDER BY due_at
    LIMIT :batch
    FOR UPDATE SKIP LOCKED
)
RETURNING id
""")

class JobHandlers:
    """What each job does. Plain async methods: the worker calls them, and so do the tests."""

    def __init__(self, resources: Resources, mailer: Mailer) -> None:
        self.resources = resources
        self.mailer = mailer
        self.frontend = resources.settings.frontend_origin
```

**What's new**
- **`text("""...""")`** at module level: the claim query is parsed once. It's the README's SQL, verbatim.
- **The handlers take `Resources`**, not FastAPI dependencies: they run in the worker, where there's no request. Each method opens its own short session where it needs one.

**`app/jobs/handlers.py`** · continue

```python

    async def send_invitation_email(
        self, *, email: str, workspace_name: str, inviter_name: str, token: str
    ) -> None:
        link = f"{self.frontend}/invitations/accept?token={quote(token, safe='')}"
        await self.mailer.send(
            to=email,
            subject=f"{inviter_name} invited you to {workspace_name} on TaskFlow",
            text=(
                f'{inviter_name} invited you to join "{workspace_name}".\n\n'
                f"Accept the invitation: {link}\n\nThe link expires in 7 days."
            ),
        )

    async def scan_due_reminders(self) -> int:
        async with self.resources.sessions() as session:
            claimed = (await session.scalars(_CLAIM_DUE_TASKS, {"batch": 100})).all()
            await session.commit()
        for task_id in claimed:
            await self.resources.jobs.send_due_reminder(task_id)
        log.info("due reminders claimed", claimed=len(claimed))
        return len(claimed)

    async def send_due_reminder(self, task_id: UUID) -> bool:
        async with self.resources.sessions() as session:
            task = await session.scalar(
                select(Task)
                .options(joinedload(Task.assignee), joinedload(Task.project))
                .where(Task.id == task_id)
            )
        if task is None or task.assignee is None or task.due_at is None:
            return False
        await self.mailer.send(
            to=task.assignee.email,
            subject=f"Due soon: {task.project.key}-{task.number} {task.title}",
            text=(
                f'"{task.title}" in {task.project.name} is due at '
                f"{task.due_at.isoformat().replace('+00:00', 'Z')}.\n\n"
                f"Open it: {self.frontend}/tasks/{task.id}"
            ),
        )
        return True
```

**What's new**
- **`(await session.scalars(_CLAIM_DUE_TASKS, {"batch": 100})).all()`**: an `UPDATE ... RETURNING id` read like a query; the claim is committed before any reminder is enqueued.
- **`quote(token, safe='')`** URL-encodes the token in the accept link (`encodeURIComponent`).
- `send_due_reminder` returns `False` when there's nothing to send (the task was deleted, unassigned or lost its due date since it was claimed).

**`app/jobs/handlers.py`** · continue

```python

    async def delete_storage_prefix(self, prefix: str) -> int:
        return await self.resources.storage.delete_prefix(prefix)

    async def cleanup_stale_uploads(self) -> int:
        cutoff = datetime.now(UTC) - STALE_UPLOAD_AGE
        async with self.resources.sessions() as session:
            stale = (
                await session.execute(
                    select(Attachment.id, Attachment.storage_key)
                    .where(Attachment.status == "pending", Attachment.created_at < cutoff)
                    .limit(500)
                )
            ).all()
            for row in stale:
                await self.resources.storage.delete_prefix(row.storage_key)
            if stale:
                await session.execute(
                    delete(Attachment).where(Attachment.id.in_([r.id for r in stale]))
                )
                await session.commit()
        log.info("stale uploads cleaned", removed=len(stale))
        return len(stale)
```

**`app/jobs/queue.py`** · add after `from typing import Any`

```python
from uuid import UUID
```

**`app/jobs/queue.py`** · continue

```python

    async def send_due_reminder(self, task_id: UUID) -> None:
        await self._send("send-due-reminder", task_id=str(task_id))
```

**What's new**
- **`cleanup_stale_uploads`** deletes pending attachments older than 24 hours: their stored objects first, then the rows, at most 500 per run.
- **`Attachment.id.in_([r.id for r in stale])`** deletes the batch in one statement.
- The scan enqueues `send-due-reminder` through the same `Jobs` facade the API uses, with the task id as a string (JSON).

> **🧠 DSA & scalability · Claiming due tasks with `SKIP LOCKED`**
> - **Data structure:** the partial index `tasks_due_reminder_idx ON tasks (due_at) WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL`: only tasks still waiting for a reminder are in it.
> - **Algorithm:** `UPDATE tasks SET reminder_sent_at = now() WHERE id IN (SELECT id ... ORDER BY due_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id`: lock up to 100 due rows, skipping rows another scheduler has locked, mark them claimed, return their ids; then enqueue one reminder job per id.
> - **Complexity:** O(log n + batch) through the partial index, where n is the number of *unsent* reminders, not all tasks.
> - **Why it scales:** two schedulers (or two Beat processes started by mistake) never block each other and never claim the same row, so no reminder is sent twice. Setting `reminder_sent_at` *is* the claim, and it commits before the emails go out.
> - **Alternatives rejected:** select, then update in a second statement (two schedulers select the same rows); a distributed lock around the whole scan (one scheduler at a time, and a crashed holder blocks everyone until the lock expires).

**✅ Checkpoint**

```bash
uv run python -c "
import asyncio
from app.config import get_settings
from app.jobs.mailer import Mailer
asyncio.run(Mailer(get_settings()).send(to='hello@example.com', subject='Hello from TaskFlow', text='It works.'))"
curl -s 'localhost:18004/api/v1/search?query=to:hello@example.com' \
  | python3 -c 'import json, sys; print([m["Subject"] for m in json.load(sys.stdin)["messages"]][:1])'
```

Expected: `['Hello from TaskFlow']`. Open http://localhost:18004 to see the email in Mailpit's inbox.

**Commit:** `feat: mailer and job handlers`

### Step 11.2 · The worker and the schedule

**Goal:** a Celery worker that runs the handlers with retries, and the Beat schedule for due reminders (every 15 minutes) and stale uploads (hourly).

**Files:** `app/jobs/worker.py`

**`app/jobs/worker.py`** · new file

```python
"""The Celery worker: `celery -A app.jobs.worker worker` (and `beat` for the schedule).

Celery runs plain synchronous functions. Our job code is async, so each worker process keeps
one event loop (an asyncio.Runner) and runs every job on it. The resources (pools, clients)
are created on that loop the first time a job runs, and reused by every later job.
"""

import asyncio
from collections.abc import Awaitable
from collections.abc import Callable
from contextlib import AsyncExitStack
from typing import Any
from uuid import UUID

from celery.schedules import crontab
from celery.signals import setup_logging

from app.config import get_settings
from app.core.logging import configure_logging
from app.infra.resources import open_resources
from app.jobs.handlers import JobHandlers
from app.jobs.mailer import Mailer
from app.jobs.queue import create_celery

settings = get_settings()
celery = create_celery(settings)
celery.conf.beat_schedule = {
    "scan-due-reminders": {"task": "scan-due-reminders", "schedule": crontab(minute="*/15")},
    "cleanup-stale-uploads": {"task": "cleanup-stale-uploads", "schedule": crontab(minute=0)},
}

# 5 attempts in all, waiting about 2 s, 4 s, 8 s, 16 s between them (randomised: "jitter").
RETRY: dict[str, Any] = {
    "autoretry_for": (Exception,),
    "retry_backoff": 2,
    "retry_jitter": True,
    "max_retries": 4,
    "acks_late": True,  # acknowledge after the job ran, so a crashed worker's job is redelivered
}

@setup_logging.connect
def _configure_logging(**_: Any) -> None:
    """With a receiver on this signal, Celery leaves logging to us: JSON lines, like the API."""
    configure_logging(settings.log_level)
```

**What's new (TS → Celery)**
- **`celery -A app.jobs.worker worker`** imports this module and looks for the Celery app in it (named `celery`). `beat_schedule` maps a schedule name to a task name and a **`crontab`** (`minute="*/15"` = every 15 minutes, `minute=0` = on the hour), BullMQ's `upsertJobScheduler`. Beat is a separate process (`celery ... beat`) that only enqueues; workers run.
- **Retries:** `autoretry_for=(Exception,)` retries on any error; `retry_backoff=2` waits about 2, 4, 8, 16 seconds; `retry_jitter=True` randomises each wait between 0 and that value ("full jitter", so failed jobs don't all retry in the same second); `max_retries=4` gives 5 attempts in all, like BullMQ's `attempts: 5`.
- **`acks_late=True`**: the job is acknowledged (removed from the queue) *after* it ran, so a worker that crashes mid-job doesn't lose it: the broker redelivers. Jobs therefore must be safe to run twice: deleting a prefix twice deletes nothing the second time, and a duplicate reminder is the worst case.
- **`@setup_logging.connect`** registers a receiver for Celery's `setup_logging` signal; when one exists, Celery doesn't configure logging itself, so the worker writes the same JSON lines as the API. `**_: Any` accepts and ignores whatever keyword arguments the signal passes.

**`app/jobs/worker.py`** · continue

```python

_runner: asyncio.Runner | None = None
_handlers: JobHandlers | None = None

def _run[T](job: Callable[[JobHandlers], Awaitable[T]]) -> T:
    # Created lazily: Celery forks its worker processes, and an event loop can't cross a fork.
    global _runner
    _runner = _runner or asyncio.Runner()

    async def call() -> T:
        global _handlers
        if _handlers is None:
            # Never closed: the resources live as long as the worker process.
            resources = await AsyncExitStack().enter_async_context(open_resources(settings))
            _handlers = JobHandlers(resources, Mailer(settings))
        return await job(_handlers)

    return _runner.run(call())

```

**What's new**
- **Celery runs plain synchronous functions; our job code is async.** Each worker process keeps one **`asyncio.Runner`**: an event loop you can run coroutines on, one after another, without closing it in between (`asyncio.run` would create and destroy a loop per job, and the database pool can't outlive its loop). `_runner.run(call())` runs one job to completion on it.
- **Created lazily, on the first job:** Celery's default "prefork" pool forks worker processes from a parent, and an event loop (or an open socket) must not cross a fork. Everything is created inside the child that uses it.
- **`global _runner`** lets the function assign the module-level variable (like `nonlocal` for the module).
- `AsyncExitStack().enter_async_context(open_resources(settings))` opens the resources and keeps them open for the life of the process.

**`app/jobs/worker.py`** · continue

```python

@celery.task(name="send-invitation-email", **RETRY)
def send_invitation_email(email: str, workspace_name: str, inviter_name: str, token: str) -> None:
    _run(
        lambda h: h.send_invitation_email(
            email=email, workspace_name=workspace_name, inviter_name=inviter_name, token=token
        )
    )

@celery.task(name="send-due-reminder", **RETRY)
def send_due_reminder(task_id: str) -> bool:
    return _run(lambda h: h.send_due_reminder(UUID(task_id)))

@celery.task(name="delete-storage-prefix", **RETRY)
def delete_storage_prefix(prefix: str) -> int:
    return _run(lambda h: h.delete_storage_prefix(prefix))

@celery.task(name="scan-due-reminders")
def scan_due_reminders() -> int:
    return _run(lambda h: h.scan_due_reminders())

@celery.task(name="cleanup-stale-uploads")
def cleanup_stale_uploads() -> int:
    return _run(lambda h: h.cleanup_stale_uploads())
```

**What's new**
- **`@celery.task(name=..., **RETRY)`** registers a task under the name the API sends (`**RETRY` spreads the retry options into the decorator call). Each task is a thin, typed adapter: its arguments are the job's JSON fields, and it runs the matching handler through `_run`.
- `lambda h: h.send_due_reminder(UUID(task_id))`: the lambda receives the handlers and returns the coroutine; `_run` awaits it.

**✅ Checkpoint**

In one terminal, start the worker with the scheduler embedded (`-B`, fine for development):

```bash
uv run celery -A app.jobs.worker worker -B --loglevel INFO
```

In another, invite someone through the API (with `TOKEN` and `WS` from Steps 5.7 and 7.4):

```bash
curl -s -X POST localhost:8004/api/v1/workspaces/$WS/invitations -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"email":"teammate@example.com","role":"member"}'
```

Expected in the worker's terminal, as JSON lines: `"message": "Task send-invitation-email[…] received"`, then `"message": "Task send-invitation-email[…] succeeded in 0.1…s: None"`; and the invitation email in Mailpit (http://localhost:18004), with an accept link to `http://localhost:5173/invitations/accept?token=…`. Stop the worker with Ctrl+C.

**Commit:** `feat: celery worker with retries and the beat schedule`

### Step 11.3 · Tests

**Goal:** each handler against real Postgres, S3 and SMTP, the claim's exactly-once property, and the worker's registrations.

**Files:** `tests/test_jobs.py`

**`tests/test_jobs.py`** · new file

```python
import os
import secrets
from datetime import UTC
from datetime import datetime
from datetime import timedelta
from typing import Any

import boto3
import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy import update

from app.infra.resources import Resources
from app.jobs.handlers import JobHandlers
from app.jobs.mailer import Mailer
from app.jobs.worker import celery
from app.models.task import Attachment
from tests.helpers import Fixture
from tests.helpers import add_member
from tests.helpers import create_fixture
from tests.helpers import queued_jobs
from tests.helpers import register_user
from tests.helpers import send

@pytest.fixture
async def f(client: AsyncClient) -> Fixture:
    return await create_fixture(client)

@pytest.fixture
def handlers(resources: Resources) -> JobHandlers:
    # The API never runs jobs; the test builds the worker's handlers on the same resources.
    return JobHandlers(resources, Mailer(resources.settings))

MAILPIT_URL = os.environ.get("MAILPIT_URL", "http://localhost:18004")

async def inbox(to: str) -> list[dict[str, Any]]:
    """Mailpit's HTTP API: the messages sent to `to`, each with its full text."""
    async with httpx.AsyncClient(base_url=MAILPIT_URL) as mailpit:
        found = await mailpit.get("/api/v1/search", params={"query": f"to:{to}"})
        return [
            (await mailpit.get(f"/api/v1/message/{m['ID']}")).json()
            for m in found.json()["messages"]
        ]

async def test_the_invitation_email_carries_an_accept_link(
    resources: Resources, handlers: JobHandlers
) -> None:
    email = f"invitee-{secrets.token_hex(4)}@example.com"
    await handlers.send_invitation_email(
        email=email, workspace_name="Acme", inviter_name="Owner", token="tok-123"
    )
    [message] = await inbox(email)
    assert message["Subject"] == "Owner invited you to Acme on TaskFlow"
    assert (
        f"{resources.settings.frontend_origin}/invitations/accept?token=tok-123" in message["Text"]
    )

async def test_each_due_task_is_claimed_once_then_the_assignee_is_emailed(
    client: AsyncClient, resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    assignee = await register_user(client, "Assignee")
    await add_member(resources, f.workspace_id, assignee, "member")
    url = f"/api/v1/projects/{f.project_id}/tasks"

    async def create(title: str, due_in_hours: int, assigned: bool = True) -> None:
        due = (datetime.now(UTC) + timedelta(hours=due_in_hours)).isoformat()
        body = {"title": title, "dueAt": due} | ({"assigneeId": assignee.id} if assigned else {})
        await send(client, "POST", url, user=f.owner, json=body, status=201)

    await create("Due soon", 2)
    await create("Due later", 72)
    await create("Nobody assigned", 2, assigned=False)

    assert await handlers.scan_due_reminders() == 1
    assert await handlers.scan_due_reminders() == 0

    [(name, data)] = await queued_jobs(resources)
    assert name == "send-due-reminder"
    assert await handlers.send_due_reminder(data["task_id"]) is True
    [message] = await inbox(assignee.email)
    assert message["Subject"] == "Due soon: TF-1 Due soon"

async def test_every_object_under_a_prefix_is_deleted(
    resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    settings = resources.settings
    s3 = boto3.client(
        "s3",
        endpoint_url=str(settings.s3_endpoint),
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
    )
    prefix = f"projects/{f.project_id}/"
    for name in ["a", "b", "c"]:
        s3.put_object(Bucket=settings.s3_bucket, Key=f"{prefix}tasks/t/{name}", Body=name.encode())
    assert await handlers.delete_storage_prefix(prefix) == 3
    assert await handlers.delete_storage_prefix(prefix) == 0

async def test_uploads_pending_for_more_than_a_day_are_removed(
    client: AsyncClient, resources: Resources, handlers: JobHandlers, f: Fixture
) -> None:
    url = f"/api/v1/projects/{f.project_id}/tasks"
    task = await send(client, "POST", url, user=f.owner, json={"title": "With upload"}, status=201)
    body = {"fileName": "old.txt", "contentType": "text/plain", "sizeBytes": 3}
    attachments = f"/api/v1/tasks/{task.json()['id']}/attachments"
    await send(client, "POST", attachments, user=f.owner, json=body, status=201)
    async with resources.sessions() as session:
        yesterday = datetime.now(UTC) - timedelta(hours=25)
        await session.execute(update(Attachment).values(created_at=yesterday))
        await session.commit()
    assert await handlers.cleanup_stale_uploads() == 1
    async with resources.sessions() as session:
        assert await session.scalar(select(func.count()).select_from(Attachment)) == 0

def test_the_worker_registers_every_job_and_the_schedule() -> None:
    names = {"send-invitation-email", "send-due-reminder", "delete-storage-prefix"}
    names |= {"scan-due-reminders", "cleanup-stale-uploads"}
    assert names <= set(celery.tasks)
    assert celery.tasks["send-due-reminder"].max_retries == 4
    assert set(celery.conf.beat_schedule) == {"scan-due-reminders", "cleanup-stale-uploads"}
```

**What's new**
- **The tests call the handlers directly**, built on the test app's resources: no worker, no queue. The job enqueued by the scan stays in Redis, where `queued_jobs` reads it, and the test runs it by hand.
- **Mailpit's HTTP API** (`/api/v1/search`, `/api/v1/message/{id}`) checks what was really sent. `MAILPIT_URL` is overridden in CI, where Mailpit runs on its default port.
- **`update(Attachment).values(created_at=yesterday)`** backdates a row to test the 24-hour rule without waiting a day.
- **`names <= set(celery.tasks)`**: set inclusion again; importing `app.jobs.worker` registers every task on the Celery app.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `79 passed`.

**Commit:** `test: job handlers, reminders and the worker's registrations`

---
## Part 12 · Contract testing with Schemathesis

Our tests check the behaviour we *thought of*. **Schemathesis** reads `contract/openapi.yaml`, generates thousands of requests (valid, edge-case and invalid), and checks every response against the contract. The contract is shared by all six backends, so this is also the test that proves the FastAPI backend behaves like the three TypeScript ones.

### Step 12.1 · The contract and the configuration

**Goal:** a copy of the master contract in the repo, and Schemathesis settings for the two places where the contract is deliberately looser than the server.

**Files:** `contract/openapi.yaml`, `schemathesis.toml`

```bash
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

**`schemathesis.toml`** · new file

```toml
# Schemathesis contract test configuration (used by `npm run test:contract` and CI).
# Docs: https://schemathesis.readthedocs.io/en/stable/reference/configuration/

[generation]
# NUL bytes in strings are valid JSON but Postgres text columns reject them.
allow-x00 = false

# Cursors are opaque tokens only the server can mint. A fuzzed but schema-valid
# cursor (e.g. "0") is correctly rejected with 422, so list endpoints may answer 422
# to otherwise valid-looking input.
[[operations]]
include-method = "GET"
checks.positive_data_acceptance.expected-statuses = [200, 401, 403, 404, 422, 429]

# Two rules make a schema-valid body semantically invalid, by design (422):
# - names and titles are trimmed before their length is checked, so " " or "\u00a0" is empty;
# - ids in a body must point into this board or workspace (move target, column, assignee).
[[operations]]
include-operation-id = [
  "register", "updateCurrentUser", "createWorkspace", "updateWorkspace",
  "createProject", "updateProject", "createColumn", "updateColumn", "moveColumn",
  "createTask", "updateTask", "moveTask",
]
checks.positive_data_acceptance.expected-statuses = [200, 201, 401, 403, 404, 409, 422, 429]
```

**What's new**
- The same file as in the Node repos: cursors are opaque, so a fuzzed but schema-valid cursor gets a correct 422; and names are trimmed and ids must point into the right board, rules a JSON Schema can't express.
- **Schemathesis is a Python tool**, and `uvx` (uv's `npx`) runs it without adding it to the project.

**✅ Checkpoint**

Start the API with the rate limits raised (the fuzzer sends thousands of requests a minute), get a token, and run Schemathesis:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 uv run --env-file .env fastapi dev
```

In a second terminal:

```bash
TOKEN=$(curl -s localhost:8004/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8004 -H "Authorization: Bearer $TOKEN"
```

Expected (after a minute or two; your case counts will differ a little, the fuzzer is random):

```text
API Operations:
  Selected: 48/48
  Tested: 48

Test Phases:
  ✅ Examples
  ✅ Coverage
  ✅ Fuzzing
  ✅ Stateful

Warnings:
  ⚠️ Authentication failed: 1 operation returned only 401/403 responses
  ⚠️ Missing test data: 20 operations repeatedly returned 404 responses

Test cases:
  6020 generated, 6020 passed
```

The two warnings are expected: `refresh` needs a cookie the fuzzer doesn't have, and random ids point at nothing. **What it caught while this repo was built:** a refresh cookie parameter without a default (a missing cookie gave 422 instead of 401), integers sent as `5.0` (valid JSON Schema integers that strict ints refused) and email addresses on reserved domains like `.test` (refused by Pydantic's `EmailStr`). Each fix is in the code you typed.

**Commit:** `test: schemathesis contract test configuration`

---

## Part 13 · Docker

### Step 13.1 · A multi-stage Dockerfile

**Goal:** a small, non-root production image with exactly the locked dependencies.

**Files:** `Dockerfile`, `.dockerignore`

**`Dockerfile`** · new file

```dockerfile
# syntax=docker/dockerfile:1

# ---- base: Debian slim with the exact Python the project pins (3.14) ----
FROM python:3.14.10-slim AS base
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app

# ---- build: resolve the locked dependencies into /app/.venv with uv ----
FROM base AS build
COPY --from=ghcr.io/astral-sh/uv:0.12.7 /uv /usr/local/bin/uv
# Compile .pyc once here (faster start-up); copy files rather than hard-link (cache mounts).
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# ---- runtime: the virtualenv and the code, no uv, no compilers, not root ----
FROM base AS runtime
RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build /app/.venv /app/.venv
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
ENV PATH="/app/.venv/bin:$PATH"
USER app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers", "--timeout-graceful-shutdown", "10"]
```

**`.dockerignore`** · new file

```gitignore
.venv
__pycache__
*.py[cod]
.env
.env.*
!.env.example
.git
.github
tests
.coverage
htmlcov
.pytest_cache
.mypy_cache
.ruff_cache
.hypothesis
.schemathesis
*.md
```

**What's new**
- **The build stage uses uv** (copied from uv's official image) to create `/app/.venv` from `uv.lock`: **`--locked`** fails if the lockfile is out of date (`npm ci`), `--no-dev` skips the dev group. `UV_COMPILE_BYTECODE=1` compiles `.pyc` files at build time, so the container starts faster; the cache mount keeps downloads between builds.
- **The runtime stage** copies only the virtualenv and the code onto the same base image (so the venv's interpreter path is the same): no uv, no compilers, no tests. `ENV PATH="/app/.venv/bin:$PATH"` puts the venv's `uvicorn`, `alembic` and `celery` on the path. A system user without a home directory runs it.
- **`PYTHONUNBUFFERED=1`** sends log lines out immediately (otherwise Python buffers stdout when it isn't a terminal); `PYTHONDONTWRITEBYTECODE=1` stops Python writing `.pyc` files at run time into a read-only image.
- **The command runs uvicorn directly:** `--no-access-log` (the middleware writes ours), `--proxy-headers` (trust `X-Forwarded-For` from a reverse proxy for client IPs), `--timeout-graceful-shutdown 10` (on `SIGTERM`, finish in-flight requests for up to 10 seconds). On shutdown uvicorn closes open WebSockets itself with code **1012** ("service restart"), before the app's lifespan runs, so clients see 1012 rather than the hub's 1001; they reconnect either way.

**✅ Checkpoint**

```bash
docker build -t taskflow-fastapi .
docker run --rm taskflow-fastapi id
docker image ls taskflow-fastapi --format '{{.Size}}'
```

Expected: `uid=999(app) gid=999(app) groups=999(app)` and about `399MB`. About 180 MB of that is the Python base image; most of the rest is the dependencies (botocore, SQLAlchemy, uvloop, asyncpg).

**Commit:** `chore: multi-stage dockerfile with uv`

### Step 13.2 · App services in compose

**Goal:** run migrations, the API, the worker and the scheduler as containers, under the `app` profile.

**Files:** `docker-compose.yml`

**`docker-compose.yml`** · add after `name: taskflow-fastapi`

```yaml

x-app: &app
  profiles: ['app']
  build: .
  environment:
    APP_ENV: production
    DATABASE_URL: postgresql://taskflow:taskflow@postgres:5432/taskflow
    REDIS_URL: redis://redis:6379/0
    JWT_SECRET: ${JWT_SECRET:-dev-only-change-me-at-least-32-bytes-long!!}
    COOKIE_SECURE: 'true'
    FRONTEND_URL: http://localhost:5173
    S3_ENDPOINT: http://rustfs:9000
    S3_PUBLIC_ENDPOINT: http://localhost:19004
    S3_REGION: us-east-1
    S3_BUCKET: taskflow-attachments
    S3_ACCESS_KEY: taskflow
    S3_SECRET_KEY: taskflow-secret
    SMTP_HOST: mailpit
    SMTP_PORT: '1025'
    MAIL_FROM: TaskFlow <no-reply@taskflow.local>
    LOG_LEVEL: info

```

**`docker-compose.yml`** · add after the `mailpit` service, before the top-level `volumes:`

```yaml

  migrate:
    <<: *app
    command: ['alembic', 'upgrade', 'head']
    depends_on:
      postgres:
        condition: service_healthy

  api:
    <<: *app
    ports:
      - '8004:8000'
    depends_on: &app-deps
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      s3-init:
        condition: service_completed_successfully
      mailpit:
        condition: service_healthy
    healthcheck:
      test:
        [
          'CMD',
          'python',
          '-c',
          "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/ready', timeout=2)",
        ]
      interval: 10s
      timeout: 3s
      retries: 10

  worker:
    <<: *app
    command: ['celery', '-A', 'app.jobs.worker', 'worker', '--loglevel', 'INFO', '--concurrency', '2']
    depends_on: *app-deps

  beat:
    <<: *app
    command: ['celery', '-A', 'app.jobs.worker', 'beat', '--loglevel', 'INFO', '--schedule', '/tmp/celerybeat-schedule']
    depends_on: *app-deps

```

**What's new**
- **`x-app: &app`** is a YAML **anchor**: a block defined once and merged into each service with **`<<: *app`** (profile, build, environment). `&app-deps` / `*app-deps` share the `depends_on` block the same way.
- **`migrate`** runs `alembic upgrade head` and exits; the API, worker and Beat wait for it (`service_completed_successfully`). One migration run, however many API containers start.
- **`worker`** and **`beat`** are separate containers: Beat must run exactly once (two would enqueue every scheduled job twice, although the `SKIP LOCKED` claim would still protect the reminders); workers can scale.
- Inside Docker the API reaches S3 at `http://rustfs:9000`, but presigns URLs for `http://localhost:19004`, the address your browser uses.

**✅ Checkpoint**

```bash
docker compose --profile app up -d --build --wait
docker compose --profile app ps -a --format 'table {{.Service}}\t{{.Status}}'
```

Expected:

```text
SERVICE    STATUS
api        Up 11 seconds (healthy)
beat       Up 11 seconds
mailpit    Up About an hour (healthy)
migrate    Exited (0) 12 seconds ago
postgres   Up About an hour (healthy)
redis      Up About an hour (healthy)
rustfs     Up About an hour (healthy)
s3-init    Exited (0) 12 seconds ago
worker     Up 11 seconds
```

The API container runs with `APP_ENV=production`, where the seed refuses to run; seed from your machine instead (`uv run python -m app.seed`): it's the same Postgres.

**Commit:** `chore: api, worker, beat and migrate services in compose`

---

## Part 14 · CI/CD with GitHub Actions

### Step 14.1 · The CI workflow

**Goal:** lint, type-check, test (with real services), check migrations for drift, run the contract test, and build (and on `main`, publish) the Docker image, on every push and pull request.

**Files:** `.github/workflows/ci.yml`

**`.github/workflows/ci.yml`** · new file

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  DATABASE_URL: postgresql://taskflow:taskflow@localhost:5432/taskflow
  REDIS_URL: redis://localhost:6379/0
  JWT_SECRET: ci-only-secret-that-is-at-least-32-bytes-long
  S3_ENDPOINT: http://localhost:9000
  S3_PUBLIC_ENDPOINT: http://localhost:9000
  S3_BUCKET: taskflow-attachments
  S3_ACCESS_KEY: taskflow
  S3_SECRET_KEY: taskflow-secret
  SMTP_HOST: localhost
  SMTP_PORT: '1025'
  MAILPIT_URL: http://localhost:8025

jobs:
  quality:
    name: Lint, format & typecheck
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
        with:
          enable-cache: true
      - run: uv sync --locked
      - run: uv run ruff format --check .
      - run: uv run ruff check .
      - run: uv run mypy .
```

**What's new**
- **`astral-sh/setup-uv`** installs uv with a download cache; **`uv sync --locked`** installs exactly the lockfile (it fails if `pyproject.toml` and `uv.lock` disagree). uv reads `.python-version` and installs Python 3.14 itself.
- `ruff format --check` fails on unformatted files without changing them.

**`.github/workflows/ci.yml`** · continue

```yaml

  test:
    name: Tests, migrations & coverage
    runs-on: ubuntu-latest
    services: &services
      postgres:
        image: postgres:18.6
        env:
          POSTGRES_USER: taskflow
          POSTGRES_PASSWORD: taskflow
          POSTGRES_DB: taskflow
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U taskflow -d taskflow"
          --health-interval 5s --health-timeout 3s --health-retries 20
      redis:
        image: redis:8.8.4
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s --health-timeout 3s --health-retries 20
      rustfs:
        image: rustfs/rustfs:1.0.4
        env:
          RUSTFS_ACCESS_KEY: taskflow
          RUSTFS_SECRET_KEY: taskflow-secret
        ports: ['9000:9000']
        options: >-
          --health-cmd "curl -fs http://localhost:9000/health"
          --health-interval 5s --health-timeout 3s --health-retries 20
      mailpit:
        image: axllent/mailpit:v1.32.0
        ports: ['1025:1025', '8025:8025']
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
        with:
          enable-cache: true
      - run: uv sync --locked
      - name: Apply migrations to an empty database
        run: uv run alembic upgrade head
      - name: Fail if the models and the migrations disagree (drift)
        run: uv run alembic check
      - run: uv run pytest --cov --cov-report=term --cov-report=html
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: coverage
          path: htmlcov/
          retention-days: 14
```

**What's new**
- **Service containers:** Postgres, Redis, RustFS and Mailpit run next to the job, on their default ports. `&services` anchors the block so the contract job reuses it with `*services`.
- **`alembic upgrade head`, then `alembic check`:** the migrations apply to an empty database, and the models match them.
- `pytest --cov --cov-report=html` writes `htmlcov/`, uploaded as an artifact.

**`.github/workflows/ci.yml`** · continue

```yaml

  contract:
    name: Contract test (Schemathesis)
    runs-on: ubuntu-latest
    services: *services
    env:
      APP_ENV: production
      RATE_LIMIT_AUTH_PER_MINUTE: '100000'
      RATE_LIMIT_API_PER_MINUTE: '100000'
    steps:
      - uses: actions/checkout@v7
      - uses: astral-sh/setup-uv@v10
        with:
          enable-cache: true
      - run: uv sync --locked --no-dev
      - run: uv run --no-dev alembic upgrade head
      - name: Start the API
        run: |
          uv run --no-dev uvicorn app.main:app --port 8000 > api.log 2>&1 &
          for _ in $(seq 30); do curl -sf http://localhost:8000/health/ready && exit 0; sleep 1; done
          cat api.log; exit 1
      - name: Get an access token
        run: |
          curl -sf -X POST http://localhost:8000/api/v1/auth/register \
            -H 'Content-Type: application/json' \
            -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
            | jq -r '"TOKEN=" + .accessToken' >> "$GITHUB_ENV"
      - name: Run Schemathesis
        run: |
          uvx schemathesis run contract/openapi.yaml \
            --url http://localhost:8000 \
            --header "Authorization: Bearer $TOKEN" \
            --report junit --report-dir schemathesis-report
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: schemathesis-report
          path: |
            schemathesis-report/
            api.log
          retention-days: 14
```

**What's new**
- **The contract job runs the production configuration** (`APP_ENV=production`, `--no-dev` dependencies) with uvicorn directly, waits for readiness, registers a user for a token, and runs Schemathesis with a JUnit report.

**`.github/workflows/ci.yml`** · continue

```yaml

  docker:
    name: Docker image
    needs: [quality, test, contract]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        if: github.event_name == 'push'
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v6
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=sha,format=long,prefix=
            type=raw,value=latest,enable={{is_default_branch}}
      - uses: docker/build-push-action@v7
        with:
          context: .
          push: ${{ github.event_name == 'push' }}
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

**What's new**
- The same Docker job as the Node repos: build on every run, push to `ghcr.io/<owner>/taskflow-fastapi` (commit SHA, plus `latest` on `main`) only on pushes, with GitHub Actions' layer cache.

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml
```

Expected: no output (actionlint found nothing). Push, then open the **Actions** tab: four green jobs.

**Commit:** `ci: lint, typecheck, tests, drift, contract and docker`

### Step 14.2 · CodeQL and Dependabot

**Goal:** security scanning for Python, and weekly dependency updates for uv, GitHub Actions and Docker.

**Files:** `.github/workflows/codeql.yml`, `.github/dependabot.yml`

**`.github/workflows/codeql.yml`** · new file

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '23 4 * * 1'

permissions:
  contents: read

jobs:
  analyze:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@v7
      - uses: github/codeql-action/init@v4
        with:
          languages: python
          queries: security-extended
      - uses: github/codeql-action/analyze@v4
```

**`.github/dependabot.yml`** · new file

```yaml
version: 2
updates:
  - package-ecosystem: uv
    directory: /
    schedule:
      interval: weekly
    groups:
      fastapi:
        patterns: ['fastapi', 'fastapi-cli', 'starlette', 'uvicorn', 'pydantic*']
      sqlalchemy:
        patterns: ['sqlalchemy', 'alembic', 'asyncpg']
      aws:
        patterns: ['boto3', 'types-boto3*']
      celery:
        patterns: ['celery', 'celery-types']
      lint:
        patterns: ['ruff', 'mypy']
      test:
        patterns: ['pytest*', 'httpx', 'websockets']
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: docker-compose
    directory: /
    schedule:
      interval: weekly
```

**What's new**
- CodeQL analyses Python (`languages: python`) with the extended security queries; `security-events: write` is the only extra permission it needs.
- **Dependabot understands uv** (`package-ecosystem: uv`): it updates `pyproject.toml` *and* `uv.lock`. Groups bundle related packages into one pull request (FastAPI with Starlette and Pydantic, SQLAlchemy with Alembic and asyncpg…).

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/*.yml
```

Expected: no output.

**Commit:** `ci: codeql and dependabot`

### Step 14.3 · Branch protection checklist

**Goal:** `main` only changes through pull requests whose checks pass.

**Files:** none (GitHub settings)

In **Settings → Branches → Add branch ruleset** (or **Branch protection rules**) for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: **Lint, format & typecheck**, **Tests, migrations & coverage**, **Contract test (Schemathesis)**, **Docker image**, **analyze** (CodeQL)
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes and deletions

**✅ Checkpoint**

Open a pull request with a deliberate lint error (an unused import): the **Lint, format & typecheck** check fails and merging is blocked.

**Commit:** nothing new to commit in this step.

---

## Part 15 · Full stack & where to go next

### Step 15.1 · Run everything

**Goal:** run the whole stack and know where everything lives.

**Files:** none

```bash
docker compose --profile app up -d --build
uv run pytest --cov                       # against the infra, from your machine
```

| URL | What |
|---|---|
| http://localhost:8004/health/ready | API readiness |
| http://localhost:8004/docs | Swagger UI generated from the code (not in production, so use `uv run --env-file .env fastapi dev` for this one); the JSON is at `/openapi.json` |
| http://localhost:18004 | Mailpit: invitation and reminder emails |
| http://localhost:19104 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI:** host `localhost`, port `15404`, database/user/password `taskflow`. Or from the terminal: `docker compose exec postgres psql -U taskflow`.

**✅ Checkpoint**

```bash
curl -s localhost:8004/health/ready
```

Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

**Commit:** nothing new to commit in this step.

### Step 15.2 · Connect the frontend

**Goal:** run a React frontend against this API, unchanged.

**Files:** none

`taskflow-frontend-python` (the next repo) is built against FastAPI and Django. Until then, the Node frontend works too: every TaskFlow backend implements one contract. With this repo's stack running, start `taskflow-frontend-node` from its folder with `VITE_API_URL=http://localhost:8004 npm run dev` (http://localhost:5173) and sign in as `ashutosh@test.com` / `Ashutosh#1234`. If you used another backend before, sign in again: all backends share `localhost`, so the browser sends the other backend's refresh cookie, which this one rejects.

**✅ Checkpoint**

```bash
curl -si -X OPTIONS localhost:8004/api/v1/workspaces -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -iE '^HTTP|allow-origin|allow-credentials'
```

Expected (Starlette answers a preflight with 200, Express with 204; both are correct):

```text
HTTP/1.1 200 OK
access-control-allow-credentials: true
access-control-allow-origin: http://localhost:5173
```

**Commit:** nothing new to commit in this step.

### Step 15.3 · Where to go next

**Goal:** stretch what you built, and compare it with the TypeScript backends.

**Files:** yours to choose

1. **Diff the generated document against the contract.** Fetch `/openapi.json` and compare it with `contract/openapi.yaml` (for example with `npx openapi-diff`). FastAPI derives it from your type hints, so every difference is a type or a contract bug.
2. **Background tasks without Celery.** FastAPI has `BackgroundTasks`: work that runs in the same process after the response is sent. Move the board-cache invalidation into one and measure the latency difference. Then ask what happens to a background task when the process restarts: that's why invitation emails live in a queue.
3. **Optimistic concurrency.** Add a `version` column to tasks with SQLAlchemy's `version_id_col`, require `If-Match`, and return 412 on a stale write.
4. **Profile a hot path.** Run the board endpoint under load (`uvx locust` or `oha`), with and without the cache, and read `pg_stat_statements`.
5. **Compare.** Put Step 4.2 of this guide next to NestJS's: a dependency (`Depends(authenticate)`) on a router subtree versus a global guard with a `@Public()` opt-out. Step 3.5's dependency graph is the whole of FastAPI's DI; NestJS needed modules and a container for the same job, and Django (next backend but one) will need neither. `COMPARISON.md` collects these side by side.

**✅ Checkpoint**

```bash
uv run pytest && uv run ruff check . && uv run mypy .
```

Expected: everything still green after each exercise.

**Commit:** nothing new to commit in this step.
