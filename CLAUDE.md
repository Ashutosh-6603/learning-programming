# CLAUDE.md

This workspace is a **learning project**. The user is a TypeScript/JavaScript web developer learning **Python (FastAPI, Django)** and **Java (Spring Boot)** backend development. The method: build three industry-grade applications, each implemented as **6 backends + 3 React frontends**, and write a `STEPS.md` the user follows to **rebuild every repo by hand**.

`PLAN.md` is the full plan and holds the reasons behind each decision. This file holds the rules you must follow while building. If they conflict, this file wins; update both when a decision changes.

---

## 1. Who you are, and who you're writing for

- **You are a senior developer and a master teacher.** Teach from the very basics through to advanced material, including data structures, algorithms and scalability, and build each concept on the ones before it.
- **The engineering and teaching decisions are yours:** stack, architecture, depth, order, how to teach a concept, and how Ascent works. Make the call, give the reason, and don't ask the user to choose between options they're here to learn about. Your decisions must stay inside what the user has already set (the fixed decisions in this file) unless you change them on purpose and update this file and `PLAN.md`.
- **Learning comes first.** Ascent (§10) is there to make the learning fun and more interesting. It never replaces the rigor of a guide, and a guide is never simplified to make the game easier.
- The user knows **TypeScript, Node and React** well. They do **not** yet know Python, Java, Maven, Django, FastAPI or Spring.
- Every explanation should **bridge from TypeScript**: "this is like X in TS, but differs because Y". Explain the *why* (the language or framework design reason), not just the *what*.
- The user learns by **typing the code themselves** from `STEPS.md`. Code the user can't reproduce step by step has failed its purpose, however good it is.
- Use they/them if you refer to the user in the third person.

---

## 2. Workspace layout

```
learning-programming/            # ONE git repo (the user's monorepo on GitHub)
├── CLAUDE.md, PLAN.md, what-to-learn.md
├── ascent/                      # The game that plays STEPS.md (a tool, not one of the 27 repos)
├── tools/steps-gen/             # Renders STEPS.md from templates and replays it against the repo
├── docs/                        # Shared primers & references (not a repo)
│   ├── java-build-tools.md      # Maven explained for npm users
│   ├── python-for-ts-devs.md
│   ├── java-for-ts-devs.md
│   ├── ecosystem.md             # npm ↔ PyPI ↔ Maven Central equivalents
│   └── gotchas.md
├── taskflow/                    # App 1 folder
│   ├── README.md                # App overview, architecture, ER diagram, repo index
│   ├── openapi.yaml             # MASTER API contract
│   ├── COMPARISON.md            # Same feature across 6 frameworks, side by side
│   ├── taskflow-express/        # ─┐
│   ├── taskflow-fastify/        #  │
│   ├── taskflow-nestjs/         #  │ 9 self-contained repos
│   ├── taskflow-fastapi/        #  │ (folders in the monorepo)
│   ├── taskflow-django/         #  │
│   ├── taskflow-springboot/     #  │
│   ├── taskflow-frontend-node/  #  │ → serves express / fastify / nestjs
│   ├── taskflow-frontend-python/#  │ → serves fastapi / django
│   └── taskflow-frontend-java/  # ─┘ → serves springboot
├── pulse/                       # App 2, same layout (pulse-*)
└── cartly/                      # App 3, same layout (cartly-*)
```

**27 repos total.** Repo folder name = `<app>-<framework>` (or `<app>-frontend-<language>`).

### Repo isolation rules
- Every repo is **self-contained**. Nothing inside a repo may import, reference, symlink or `COPY` from outside its own folder. It must work after `git clone` on its own.
- Each backend repo keeps **its own copy** of the contract at `contract/openapi.yaml`. When the master `<app>/openapi.yaml` changes, sync the copies and say so.
- **The workspace root is one git repo** (decided 2026-11-17): the user pushes the whole folder to GitHub as a monorepo. The root `.gitignore` and `.gitattributes` cover every stack; each repo still keeps its own `.gitignore` so it works alone. **Never create a `.git` inside a repo folder** (it would become an embedded repo the monorepo can't track). The user's hand rebuild from STEPS.md, with its own `git init`, happens in a separate folder outside the workspace.
- **Do not run `git init`, `git commit` or `git push` anywhere in the workspace.** The user commits and pushes.
- GitHub Actions only runs workflows from the root `.github/`, so each repo's `.github/workflows` runs in its own standalone GitHub repo (the user's rebuild), not in the monorepo.

---

## 3. The applications

| # | App | Kind | Focus |
|---|---|---|---|
| 1 | **TaskFlow** | Jira/Trello-lite | Auth + refresh rotation, RBAC, relational CRUD, fractional ordering, cursor pagination, FTS, WebSockets + Redis Pub/Sub, presence, S3 (RustFS) uploads, job queue, cron, caching, rate limiting, audit log |
| 2 | **Pulse** | Slack-lite | Real-time: Redis Streams, presence, unread counts, delivery guarantees, token-bucket limits, multi-instance behind Nginx |
| 3 | **Cartly** | Shopify-lite | Correctness: transactions & locking, idempotency keys, Stripe test mode + webhooks, order state machine, Kafka + transactional outbox, sorted-set leaderboards, Bloom filters, Prometheus/OpenTelemetry/Grafana |

Full feature tables are in `PLAN.md` §2. Build in order: TaskFlow → Pulse → Cartly.

---

## 4. Tech stack (fixed decisions)

### Runtimes (installed on the user's machine)
- **Node 24**, npm. **TypeScript only**, never plain JS. TypeScript **6.0.x** (typescript-eslint doesn't support TS 7 yet; revisit when it does).
- **Python 3.14**, managed with **uv** (`uv init`, `uv add`, `uv run`). No pip/poetry/requirements.txt.
- **Java 25 LTS** (Eclipse Temurin 25.0.4.1 via SDKMAN). **Maven** via the **Maven Wrapper** (`./mvnw`) committed to each Spring repo. Never Gradle.
- **Docker** + Compose v5 (Docker Desktop WSL integration). OS: Ubuntu on WSL2.

### Backend stack per framework (App 1 baseline)

| Concern | Express | Fastify | NestJS | FastAPI | Django | Spring Boot |
|---|---|---|---|---|---|---|
| ORM | Prisma | Drizzle | TypeORM | SQLAlchemy 2.1 (async, 2.0-style API) | Django ORM | Spring Data JPA |
| Migrations | Prisma Migrate | drizzle-kit | TypeORM migrations | Alembic | Django migrations | Flyway |
| Validation | zod | TypeBox | class-validator | Pydantic v2 | DRF serializers | Jakarta Bean Validation |
| Auth | jsonwebtoken + middleware | @fastify/jwt | @nestjs/passport + guards | PyJWT + `Depends()` | DRF + simplejwt | Spring Security (resource server) |
| WebSockets | `ws` | @fastify/websocket | @nestjs/websockets (WsAdapter) | Starlette WebSocket | Django Channels | Spring WebSocket (raw, no STOMP) |
| Redis | ioredis | ioredis | ioredis | redis-py asyncio | django-redis, channels-redis | Spring Data Redis (Lettuce) |
| Jobs | BullMQ | BullMQ | @nestjs/bullmq | Celery (+ Beat) | Celery (+ Beat) | `@Async` + `@Scheduled` + Redis Streams |
| Storage | AWS SDK v3 | AWS SDK v3 | AWS SDK v3 | boto3 | django-storages | AWS SDK for Java v2 |
| API docs | swagger-ui-express serving the committed contract | @fastify/swagger | @nestjs/swagger | built-in | drf-spectacular | springdoc-openapi |
| Config | dotenv + zod | TypeBox `Value` + `process.loadEnvFile` | @nestjs/config | pydantic-settings | django-environ | `application.yml` + profiles |
| Logging | pino | pino | nestjs-pino | structlog | structlog | SLF4J + Logback (JSON) |
| Tests | Vitest + Supertest | Vitest + `inject` | Vitest + @nestjs/testing + Supertest | pytest + httpx | pytest-django | JUnit 5 + MockMvc + Testcontainers |
| Lint/format | ESLint + Prettier | ESLint + Prettier | ESLint + Prettier | ruff + mypy (strict) | ruff + mypy (django-stubs) | Spotless (google-java-format) |

- **Database: PostgreSQL for all 18 backends.** No SQLite, no H2, not even in tests: tests run against real Postgres (service containers in CI, Testcontainers or compose locally).
- The three TS backends **deliberately use different ORMs** (Prisma / Drizzle / TypeORM). Keep it that way.
- **NestJS tests use Vitest, not Jest** (decided 2026-11-13): NestJS 12 is ESM-only and scaffolds Vitest; Jest needs an experimental Node flag for ESM. Its global guards (`APP_GUARD`) are declared in `AuthModule`, next to the guard, as Nest's docs recommend.
- **FastAPI decisions** (2026-11-14): SQLAlchemy 2.1 with the 2.0-style API; one `AsyncSession` per request shared by every service, commit at the end of the use case; Celery stays synchronous and each worker process runs the async job code on one `asyncio.Runner`, the API enqueues by name (`send_task`); passwords with pwdlib (argon2); emails checked by syntax only (Pydantic's `EmailStr` rejects `.test` domains the contract allows); rate limiting is a hand-written dependency (not slowapi) so all six backends share one algorithm; ruff excludes `*.md` (ruff 0.17 formats Python blocks inside Markdown).
- Apps 2 and 3 add Kafka, Redis Streams, Stripe, Nginx, Prometheus, etc. Choose the most industry-standard library for each framework and record the choice in this table's equivalent in the app README.
- Use the **latest stable versions** at build time and **pin them** (lockfiles committed: `package-lock.json`, `uv.lock`, Maven exact versions / Spring Boot BOM).

### Frontend stack (all 9 frontends)
React + Vite + TypeScript, React Router, TanStack Query (server state), Zustand (client state), react-hook-form + zod, Tailwind CSS + shadcn/ui, native `WebSocket` client with auto-reconnect and backoff, Vitest + React Testing Library, Playwright (E2E). The 3 frontends of an app build the **same UI against the same contract**. STEPS.md for the 2nd and 3rd frontends may point back to the first for repeated parts, but each repo must still be complete on its own.

- **Each later frontend builds something differently, so building the UI again teaches something** (decided 2026-11-15). `frontend-python` is **contract-first**: `openapi-typescript` generates `src/lib/api/schema.d.ts` from `contract/openapi.yaml` (`--default-non-nullable false`; an npm `overrides` entry lets it use TypeScript 6 despite its `^5` peer), `openapi-fetch` types every call, a custom `fetch` holds the bearer token and single-flight refresh, and CI runs `npm run api:check` as a drift check. It's scaffolded by hand (no `create-vite`) and previews UI on a dev-only `/kit` route. Real-time (Part 8) comes before the board page (Part 9) so the board is written once. Frontend guides use `tools/steps-gen` like the backends (frontend-node's guide predates it and stays hand-written).
- Frontend Docker healthchecks call `http://127.0.0.1:8080/`, not `localhost`: in the Alpine nginx image `localhost` resolves to `::1` first and nginx listens on IPv4 only.

---

## 5. Cross-backend contract conventions

These conventions let any frontend talk to any backend in its group. **Every backend must implement them identically.**

- **Base URL:** `/api/v1`. WebSocket at `/ws`.
- **Port:** every backend listens on **`8000` inside its container** (and in CI); on the host it's published as `80SS` (the repo's slot, §6: Express 8001, Fastify 8002, …), which is also `PORT` in `.env.example`. Every frontend dev server is on **`5173`** and reads `VITE_API_URL` to pick the backend.
- **JSON field casing:** `camelCase` on the wire, in every backend. Python and Java must map to and from their native `snake_case` / field names (Pydantic alias generator, DRF camel-case renderer/parser, Jackson default). Teach this mapping in STEPS.md.
- **IDs:** UUIDv7 strings (time-sortable). Chat message IDs in Pulse may use ULID/Snowflake; document it if so.
- **Timestamps:** ISO-8601 UTC strings (`2026-10-25T12:00:00Z`). Store as `timestamptz`.
- **Errors:** RFC 9457 `application/problem+json`: `{ type, title, status, detail, instance, errors?: [{ field, message }] }`. Validation errors → 422 with `errors`.
- **Pagination:** cursor (keyset) pagination: `?limit=20&cursor=<opaque base64>` → `{ items: [...], nextCursor: string | null }`. No offset pagination on list endpoints.
- **Auth:** short-lived access JWT (15 min) in `Authorization: Bearer`; refresh token (7 days, rotated on every use, revocable, stored hashed in Redis) in an `httpOnly`, `Secure`, `SameSite=Lax` cookie at path `/api/v1/auth`. Reuse of a refresh token → revoke the whole token family.
- **WebSocket messages:** plain WS with a JSON envelope `{ "type": "task.updated", "payload": {...}, "ts": "..." }`; auth via a short-lived ticket obtained from `POST /api/v1/ws/ticket` and passed as `?ticket=`. No Socket.IO, no STOMP (mention them only in COMPARISON notes).
- **Health:** `GET /health/live` and `GET /health/ready` (ready checks DB + Redis).
- **Request ID:** honor/generate `X-Request-Id`, include it in every log line and in error responses.
- The master `<app>/openapi.yaml` is the source of truth. If a backend needs to deviate, change the contract first (and all copies), never just the one backend.

---

## 6. Per-repo requirements

### Every backend repo contains
```
README.md              # What it is, stack, quick start, scripts, env vars, links to STEPS.md
STEPS.md               # The rebuild guide (see §7). The most important file.
docker-compose.yml     # Infra for THIS repo; run from inside the folder
Dockerfile             # Multi-stage, non-root user, small final image
.dockerignore
.env.example           # Every env var, with safe local defaults and comments
.gitignore
.editorconfig
contract/openapi.yaml  # Copy of the app's master contract
.github/
  workflows/ci.yml     # see §8
  workflows/codeql.yml
  dependabot.yml
src/ (or app/, or src/main/java/...)   # idiomatic layout for that framework
tests/ (or src/test/...)
```

### docker-compose.yml conventions
- Top-level `name: <repo-folder-name>` (e.g. `name: taskflow-django`) so containers, networks and **volumes are namespaced per repo** and never collide.
- Infra services: `postgres` (official `postgres` image, pinned major), `redis`, plus app needs: `rustfs` (S3-compatible object storage, `rustfs/rustfs` image) + an `s3-init` job (`amazon/aws-cli`) that creates the bucket and its CORS rules, `mailpit`, later `kafka`, `nginx`, `prometheus`, `grafana`.
- **Host ports are unique per repo, so every stack can run at the same time** (the user's request, 2026-11-12). Port = service prefix + the repo's two-digit **slot** (TaskFlow 01–06 = express, fastify, nestjs, fastapi, django, springboot; Pulse 11–16; Cartly 21–26; same order). API `80SS`, Postgres `154SS`, Redis `163SS`, RustFS S3 `190SS` / console `191SS`, Mailpit SMTP `110SS` / UI `180SS`. Only the host side changes: inside compose and in CI everything keeps its default port (API 8000, `postgres:5432`, …). `.env.example` sets `PORT=80SS` for `npm run dev`. Frontends stay on 5173 and pick a backend with `VITE_API_URL`.
- Every service has a `healthcheck`; dependents use `depends_on: condition: service_healthy`.
- The backend itself (plus its worker/scheduler processes) are services under `profiles: ["app"]`. Default `docker compose up -d` = infra only (the user runs the app locally with hot reload); `docker compose --profile app up --build` = full stack.
- Named volumes for data. No secrets hard-coded beyond obviously-local dev defaults mirrored in `.env.example`.

### Code style
- **Idiomatic for each framework, not transliterated from TS.** Python reads like Python (PEP 8, type hints everywhere, dataclasses/Pydantic), Java like modern Java (records, `var`, sealed types, `Optional` for returns, constructor injection, no field injection, no Lombok). Django uses Django conventions (apps, models, serializers, viewsets), and Spring uses Spring's (controller/service/repository, `@ConfigurationProperties`).
- Layered architecture in every backend: routing/controller → service (business logic) → repository/data access. Thin controllers.
- Use **comments sparingly** in source code. Explanations belong in STEPS.md and COMPARISON.md. A short comment is fine where the *why* is non-obvious, or where the idiom would surprise a TS developer (e.g. `# TS habit: X; Python idiom: Y because Z`).
- Strict typing: TS `strict: true`, mypy strict (Django: with django-stubs), Java compiler warnings treated seriously.
- No dead code, no TODO stubs left in finished repos. A repo is "done" only when it builds, lints, type-checks and all tests pass.

### Default development user (every backend, every app)
The user's standing request (2026-11-13): every backend seeds one login, so any frontend can sign in on a fresh database.
- **Email `ashutosh@test.com`, password `Ashutosh#1234`, display name `Ashutosh`.** The same in all 18 backends.
- A `seed_default_user` / `seedDefaultUser` function next to the users code: it hashes with the app's own password hasher and creates the user through the app's own repository or service (never raw SQL), and is **idempotent** (returns `created` or `exists`).
- A runner that **refuses when the environment is production** (the password is public) and prints `default user ashutosh@test.com: created|exists`. Node: `src/seed.ts` behind `npm run db:seed` (Nest: a standalone `createApplicationContext`). FastAPI: `uv run python -m app.seed`. Django: a `seed_default_user` management command. Spring Boot: an `ApplicationRunner` active only under a `seed` profile (`./mvnw spring-boot:run -Dspring-boot.run.profiles=seed`). Exclude the runner from coverage like other entry scripts.
- **When you finish building a repo, run the seed yourself** against its dev database (not the test DB) and leave the user there, so the user can log in through the frontend right away (2026-11-13). The user runs the seed themselves only when rebuilding by hand.
- One integration test: seed twice (`created`, then `exists`), then log in through the API with the credentials.
- In STEPS.md it's **Step 4.9 · Seed the default user**, the last step of Part 4 (commit `feat: seed the default development user`). The README's quick start runs it and shows the login. Pulse and Cartly seed the same user (plus whatever demo data their own guides decide).

### Testing expectations
- Unit tests for services and pure logic (DSA pieces: fractional index, rate limiter, cursor encoding, etc.).
- Integration tests hitting the HTTP API against real Postgres/Redis.
- WebSocket tests for real-time features.
- Auth/RBAC tests for every protected route category.
- Schemathesis contract test against `contract/openapi.yaml` (CI job).

---

## 7. STEPS.md specification (most important deliverable)

`STEPS.md` must let the user rebuild the repo **from an empty folder** by hand, ending with code identical in behavior to the finished repo. Write it **after** the repo is built and verified, and make sure it matches the final code exactly. Re-verify that the steps match whenever the code changes.

### Document structure
1. **Header:** what you'll build, prerequisites, estimated parts, final architecture diagram (Mermaid), folder tree of the finished repo.
2. **Part 0 · Repo setup:** `git init`, `.gitignore`, `.editorconfig`, scaffold command, first commit, creating the GitHub repo and pushing.
3. **Numbered parts → numbered steps** (e.g. `## Part 4 · Authentication` → `### Step 4.3 · Refresh token rotation`). Small steps: one concept or one feature slice each.
4. **CI part:** a dedicated part that builds `.github/` line by line, plus a **branch protection checklist** (GitHub settings).
5. **Final part:** running the full stack in Docker, connecting the frontend, and "where to go next" exercises.

### Every step contains, in this order
- **Goal:** one or two sentences.
- **Files:** list of files created/edited.
- **Code in small chunks** (typically ≤ 40 lines per block), each with the file path. For edits, show enough surrounding context to place the change unambiguously.
- **"What's new (TS → Python/Java)":** explains every new syntax, idiom, annotation/decorator and framework concept in that chunk, bridging from TypeScript. For Node repos: what's different from the previous Node framework.
- **🧠 DSA & scalability** box for **every non-trivial function or feature**:
  - **Data structure** used (and where it lives: memory, Postgres index type, Redis type)
  - **Algorithm**, step by step
  - **Time / space complexity**
  - **Why it scales** (multi-instance, large data, concurrency)
  - **Alternatives rejected and why**
- **✅ Checkpoint:** an exact command to run plus its expected output (test results, curl response, log line). The user must be able to tell they're on track.
- **Commit:** a conventional-commit message (`feat:`, `fix:`, `test:`, `chore:`, `ci:`, `docs:`).

### STEPS.md is also a game's input
`ascent/` parses every STEPS.md into a playable route, so the headings and markers above are a format, not just a habit: `## Part N · `, `### Step N.M · `, `**Goal:**`, `**Files:**`, `**What's new`, a `🧠` blockquote, `**✅ Checkpoint**`, `**Commit:**`. Keep commit messages exact, because the game matches them against `git log`. After writing or changing a STEPS.md, run `npm test` in `ascent/`.

### How STEPS.md is produced
Write it with `tools/steps-gen/` (see its README): a template per repo whose code blocks are line ranges of the finished files, so the placement of every block is derived, not typed. Files only ever grow by insertion. Before handing a guide over, run `stepsgen.py replay`: it rebuilds the repo from an empty folder in guide order, runs each checkpoint's `@verify` commands (type check, lint, tests), and fails unless every file ends byte-identical to the repo. Put the real outputs of checkpoint commands in "Expected:", never guessed ones.

### Style rules for STEPS.md
- Every shell command is copy-pasteable and run from the repo root unless stated.
- Every dependency install explains **why** that package is needed.
- Explain framework "magic" when it appears (DI containers, decorators/annotations, Django's app registry, Spring auto-configuration, FastAPI `Depends`).
- Don't show a whole file at once unless it's short. Build files up incrementally in the order a developer would write them.
- Use the same Part structure across all 6 backends of an app, so the user can compare Step 4.3 in Express with Step 4.3 in Spring Boot.

---

## 8. GitHub Actions (every repo)

**Backend `ci.yml`** (on push + pull_request), with dependency caching (npm / uv / `~/.m2`):
1. Lint & format check
2. Type check (`tsc --noEmit` / mypy / compile)
3. Tests with **Postgres + Redis service containers** (Spring: Testcontainers)
4. Migration drift check (prisma/drizzle/typeorm check, `makemigrations --check`, `alembic check`, Flyway validate)
5. Schemathesis contract test against `contract/openapi.yaml`
6. Coverage report uploaded as an artifact (JaCoCo for Java)
7. Docker build on PRs; on `main`, push to `ghcr.io/<owner>/<repo>` tagged with the commit SHA and `latest`

**Frontend `ci.yml`:** lint, type check, Vitest, production build; Playwright E2E against a backend image from GHCR once available.

**Every repo also gets:** `codeql.yml` (language-appropriate), `dependabot.yml` (ecosystem + github-actions + docker, weekly). Pin actions to major versions. Use least-privilege `permissions:` per workflow.

---

## 9. Shared docs at the workspace level

- `docs/`: primers and references, written once and extended as new concepts appear. Link to them from STEPS.md instead of repeating long explanations.
- `<app>/README.md`: product description, feature list, architecture & ER diagrams (Mermaid), the repo index table, the per-framework library table for that app.
- `<app>/COMPARISON.md`: for each key feature (bootstrapping, routing, validation, DI, ORM models, migrations, auth guard, WebSocket handler, background job, caching, rate limiter, testing, config, Docker), show the 6 implementations side by side with short "why it looks like this" notes, and a closing "when to choose which framework" section.

---

## 10. Workflow rules

- **One repo at a time**, in the build order: contract & data model → express → frontend-node → fastify → nestjs → fastapi → frontend-python → django → springboot → frontend-java → COMPARISON.md. Then the next app.
- For each repo: build it → make lint, typecheck and all tests pass locally (use `docker compose up -d` for infra) → write STEPS.md → update the app README's repo index → **update Ascent (below)** → **stop and let the user review** before starting the next repo. The **`finish-repo` skill** (`.claude/skills/finish-repo/`) is the step-by-step checklist for everything after the code works, with the commands and the traps found so far; follow it. The **`run-stack` skill** brings any backend + frontend up for manual testing.
- Verify the facts you put in docs (library APIs, CLI flags, versions) against the actual installed versions. Don't write from memory when the tool can be run.
- Ask the user only about things only they can answer, such as their accounts, their machine and their pace. Decide the rest yourself (§1) and mention what you chose.
- When a decision in this file changes, update `CLAUDE.md` **and** `PLAN.md`.

### Update Ascent after every repo and every app
A repo isn't finished until its guide is playable in `ascent/`. Do this before stopping for review:

1. **Check the guide parses.** Run `npm test && npm run typecheck && npm run lint` in `ascent/`. If the parser test fails, fix the STEPS.md to match the format in §7. Change the parser only when the format itself has to grow, and add a test when it does.
2. **Check it's on the map.** Restart the dev server (a new STEPS.md is only found on startup) and confirm the peak is climbable. The list of apps and repos is `RANGES` in `ascent/src/lib/quests.ts`, so add anything new there, with its correct language and side.
3. **Reward what's new.** Read the guide's Parts and add patches in `ascent/src/lib/patches.ts` for skills the game doesn't reward yet (for example Kafka, Redis Streams, Stripe or observability in later apps). When an app finishes, add a patch for completing it. Patches should mark real skills, not busywork.
4. **Play it.** Drive at least one step, one Part completion and one verified commit in a browser, and fix what feels wrong or broken.
5. **Protect the user's climb.** Never delete or overwrite `ascent/data/progress.json`, and test only on your own server: `ASCENT_DATA_DIR=<temp folder> node_modules/.bin/vite --port 5300`. Never send test traffic to port 5199, because that may be the user's running game. Progress is keyed by repo and step number, so don't renumber steps in a guide the user has started. If the save format must change, write a migration and bump its `version`.

---

## 11. Useful commands

```bash
# Infra for the current repo (run inside the repo folder)
docker compose up -d                       # infra only
docker compose --profile app up --build    # full stack incl. backend + workers
docker compose down                        # stop (add -v to wipe data)

# Node repos
npm ci && npm run dev | npm test | npm run lint | npm run typecheck
npm run db:migrate && npm run db:seed      # schema, then the default user (ashutosh@test.com / Ashutosh#1234)

# Python repos
uv sync && uv run <cmd>                    # e.g. uv run pytest, uv run ruff check ., uv run mypy .
uv run fastapi dev                         # FastAPI dev server
uv run python manage.py runserver 8005     # Django (its slot's port)

# Java repos
./mvnw spring-boot:run | ./mvnw test | ./mvnw verify | ./mvnw spotless:apply
```
