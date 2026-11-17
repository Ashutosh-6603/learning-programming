# Learning Plan: Python & Java Backends through TypeScript

**Goal:** Learn backend development in Python (FastAPI, Django) and Java (Spring Boot) by building **industry-standard applications**. Each app gets the **same backend six times**, in six frameworks, plus **a React frontend per language** (Node, Python, Java). You already know TypeScript, so the three Node backends are the reference. The Python and Java versions show how the same production features are written there, and **why** they're written that way.

You learn by **rewriting each app yourself**, following a detailed `STEPS.md` that explains every file, every language construct, and the data structures and algorithms behind each feature.

---

## 1. Folder structure

```
learning-programming/
├── PLAN.md
├── ascent/                            # The game that plays STEPS.md (a tool, not one of the 27 repos)
├── tools/steps-gen/                   # STEPS.md generator + replay verifier
├── docs/                              # Shared reference, grows as we go
│   ├── java-build-tools.md            # Maven vs Gradle, explained for npm users
│   ├── python-for-ts-devs.md          # Language primer, TS → Python
│   ├── java-for-ts-devs.md            # Language primer, TS → Java
│   ├── ecosystem.md                   # npm ↔ PyPI ↔ Maven Central equivalents
│   └── gotchas.md                     # Traps for TS developers
│
├── taskflow/                          # App 1 (not a repo itself)
│   ├── README.md                      # What the app does, architecture diagram, which repo is which
│   ├── openapi.yaml                   # Master API contract; each repo keeps a copy in contract/
│   ├── COMPARISON.md                  # Same feature, 6 frameworks, side by side + "why"
│   │
│   ├── taskflow-express/              # ┐
│   ├── taskflow-fastify/              # │ Backends: each folder is its own git repo
│   ├── taskflow-nestjs/               # │ with STEPS.md, docker-compose.yml, Dockerfile,
│   ├── taskflow-fastapi/              # │ .github/workflows/, contract/openapi.yaml, tests
│   ├── taskflow-django/               # │
│   ├── taskflow-springboot/           # ┘
│   │
│   ├── taskflow-frontend-node/        # ┐ React frontends, also separate repos:
│   ├── taskflow-frontend-python/      # │ node → Express/Fastify/NestJS backends
│   └── taskflow-frontend-java/        # ┘ python → FastAPI/Django, java → Spring Boot
│
├── pulse/                             # App 2, same layout (pulse-express, …, pulse-frontend-java)
└── cartly/                            # App 3, same layout
```

**How the pieces fit:**
- **27 self-contained repos**: 3 apps × (6 backends + 3 frontends). Each repo folder is self-contained, with its own `README.md`, `STEPS.md`, `.env.example`, `.gitignore`, GitHub Actions workflows, and its own copy of the API contract. Nothing in a repo imports from outside its folder. `learning-programming/` itself is **one git repo** (a monorepo pushed to GitHub, decided 2026-11-17) holding the 27 repo folders plus the shared `docs/`, `openapi.yaml` and `COMPARISON.md`; no repo folder has its own `.git`. When you rebuild a repo by hand, you do it in a separate folder outside the workspace and `git init` it there (step 1 of every STEPS.md), which is the copy whose own GitHub Actions run.
- **One API contract per app** (`openapi.yaml`). Every backend exposes the same REST endpoints, WebSocket events and error format. This keeps the comparison fair: the only thing that changes is the framework. It also means each frontend works with any backend in its language group (e.g. `taskflow-frontend-node` switches between Express, Fastify and NestJS with `VITE_API_URL`).
- **Three frontends per app (one per language).** All three are React + TypeScript and build the same UI against the same contract. Building it three times is useful React practice, and later frontends can be built faster because STEPS.md for frontends 2 and 3 points out what you can reuse from the first.
- **Every backend has its own `docker-compose.yml`** that you run from inside that folder (`docker compose up -d`). It starts **PostgreSQL** (the database for all 18 backends, including all three TS ORMs), Redis, and the extra services that app needs (S3-compatible storage via RustFS, Mailpit, Kafka, …), with volumes named after the repo so the databases never collide. The backend itself also has a `Dockerfile` and an `app` service in the compose file, under a compose profile. Day to day you run the backend locally with hot reload, and `docker compose --profile app up` runs the whole stack in containers.
- **TypeScript only** on the Node side.

---

## 2. The applications

These are three real-world apps of increasing complexity. Each one covers what a production backend team uses day to day, not toy examples.

### App 1 · TaskFlow: Team Project Management (Jira / Trello-lite)

Workspaces, projects, Kanban boards, tasks, comments, attachments, and live updates. This app covers the core of almost every SaaS backend.

| Feature | Industry technique it teaches |
|---|---|
| Sign-up / login / logout | JWT access token + **refresh token rotation** (httpOnly cookie, refresh tokens stored in Redis so they can be revoked), password hashing with argon2/bcrypt |
| Workspaces, members, roles | **RBAC** (owner/admin/member/viewer), authorization guards and policies |
| Projects, boards, tasks, comments | Relational modeling, migrations, transactions, layered architecture (controller → service → repository), DTOs and validation |
| Drag-and-drop task ordering | **Fractional indexing** (reorder in O(1) without renumbering every row) |
| Task lists with filters | **Cursor (keyset) pagination** instead of OFFSET, composite DB indexes |
| Search tasks | Postgres **full-text search** (`tsvector` + GIN index) |
| Live board updates | **WebSockets**, with **Redis Pub/Sub** fan-out so it works across multiple server instances |
| Who's online | **Presence** using Redis sets/keys with TTL heartbeats |
| File attachments | **S3-compatible storage** (RustFS locally) with presigned upload URLs |
| Email invites & notifications | **Background job queue** (Redis-backed), retries with exponential backoff, Mailpit as a local SMTP server |
| Due-date reminders | **Scheduled / cron jobs** |
| Hot reads (board view) | **Redis caching**: cache-aside with invalidation on write |
| API protection | **Rate limiting** in Redis (sliding window), CORS, security headers |
| Activity feed / audit log | Append-only event table, emitting domain events |
| Ops | Structured logging, request IDs, health/readiness checks, OpenAPI docs, config per environment, Dockerfile |
| Testing | Unit tests, integration tests against real Postgres/Redis (**Testcontainers**), API tests |

### App 2 · Pulse: Real-time Chat (Slack-lite)

Channels, DMs, threads, reactions, typing indicators, unread counts, and notifications. This app goes deep on real-time and Redis.

| Feature | Industry technique it teaches |
|---|---|
| Messaging across many servers | WebSocket gateway + **Redis Streams** (ordered, persistent, consumer groups), compared with Pub/Sub |
| Message history | Cursor pagination on time-ordered IDs (**Snowflake / ULID** IDs) |
| Unread counts & last-read markers | Redis hashes, counters updated in batches (write-behind) |
| Typing indicators / presence | Expiring keys, heartbeat protocol, connection lifecycle |
| Reactions, threads | Aggregation queries, denormalization trade-offs |
| Message search | Full-text search (Postgres first, with notes on when to add OpenSearch) |
| Delivery guarantees | At-least-once delivery, idempotent message handling, client-side dedupe |
| Abuse protection | **Token bucket** rate limiting per user and connection; backpressure |
| Push notifications for offline users | Fan-out-on-write vs fan-out-on-read, background workers |
| Scaling | Running 2+ instances behind **Nginx**, sticky sessions vs stateless sockets |

### App 3 · Cartly: E-commerce Platform (Shopify-lite)

Catalog, cart, checkout, payments, orders, and inventory. This app goes deep on correctness, concurrency, and event-driven architecture.

| Feature | Industry technique it teaches |
|---|---|
| Product catalog with faceted filters | Read-heavy caching, cache stampede protection, ETags / HTTP caching |
| Cart | Redis hashes with TTL for guest carts, merged into the user's cart on login |
| Checkout & inventory | **Transactions, row locking vs optimistic locking** (version column), preventing overselling |
| Payments (Stripe test mode) | **Idempotency keys**, verifying webhook signatures, retries |
| Order lifecycle | **State machine** (pending → paid → shipped → delivered / refunded) |
| Services talking to each other | **Kafka** (or RabbitMQ), **transactional outbox pattern**, eventual consistency |
| Best-sellers / trending | Redis **sorted sets** (leaderboards) |
| "Has this user/coupon been seen?" | **Bloom filters**, idempotent consumers |
| Admin dashboards | Aggregation queries, materialized views, scheduled reports |
| Observability | Metrics (Prometheus), distributed tracing (OpenTelemetry), Grafana |

> Apps 2 and 3 are more advanced, so we can still adjust their exact feature lists once App 1 is done and you've seen how heavy six implementations are.

---

## 3. How the six backends map to each other

This is App 1's stack. Apps 2 and 3 add their own extras (Kafka, Streams, etc.). The libraries in each column were chosen because they're the most common choice in industry for that framework. Where an industry-standard option exists that lets you see a different style (e.g. three different TS ORMs), I picked the one that adds the most comparison value.

| Concern | Express | Fastify | NestJS | Django | FastAPI | Spring Boot |
|---|---|---|---|---|---|---|
| Language | TypeScript | TypeScript | TypeScript | Python | Python | Java 25 |
| Style | Minimal, DIY | Minimal, plugin-based, schema-first | Opinionated, DI, decorators | Batteries-included | Minimal, async, type-driven | Opinionated, DI, annotations |
| Package mgr | npm | npm | npm | uv | uv | Maven *(see §5)* |
| ORM | Prisma | Drizzle | TypeORM | Django ORM | SQLAlchemy 2.1 (async, 2.0-style API) | Spring Data JPA (Hibernate) |
| Migrations | Prisma Migrate | drizzle-kit | TypeORM migrations | Django migrations | Alembic | Flyway |
| Validation | zod | TypeBox (JSON Schema) | class-validator | DRF serializers | Pydantic v2 | Jakarta Bean Validation |
| Auth | jsonwebtoken + custom middleware | @fastify/jwt | @nestjs/passport + guards | DRF + simplejwt | PyJWT + `Depends()` | Spring Security (resource server) |
| WebSockets | `ws` | @fastify/websocket | @nestjs/websockets (ws adapter) | Django Channels | Starlette WebSocket | Spring WebSocket |
| Redis client | ioredis | ioredis | ioredis | django-redis / channels-redis | redis-py (asyncio) | Spring Data Redis (Lettuce) |
| Background jobs | BullMQ | BullMQ | @nestjs/bullmq | Celery + Celery Beat | Celery + Celery Beat (async jobs on one `asyncio.Runner` per worker) | Spring `@Async` + `@Scheduled` + Redis Streams |
| File storage | AWS SDK v3 → S3 | AWS SDK v3 → S3 | AWS SDK v3 → S3 | django-storages (boto3) | boto3 | AWS SDK for Java v2 |
| API docs | swagger-ui-express (serves the contract) | @fastify/swagger | @nestjs/swagger | drf-spectacular | Built in | springdoc-openapi |
| Config | dotenv + zod | TypeBox `Value` + `process.loadEnvFile` | @nestjs/config | django-environ | pydantic-settings | `application.yml` + profiles |
| Logging | pino | pino (built in) | pino (nestjs-pino) | structlog | structlog | SLF4J + Logback |
| Testing | Vitest + Supertest | Vitest + `fastify.inject` | Vitest + @nestjs/testing + Supertest (NestJS 12 is ESM-only and scaffolds Vitest; Jest needs an experimental flag for ESM) | pytest-django | pytest + httpx | JUnit 5 + MockMvc + Testcontainers |

**FastAPI specifics (2026-11-14):** one `AsyncSession` per request shared by every service; passwords hashed with pwdlib (argon2); emails checked by syntax only, because Pydantic's `EmailStr` refuses `.test` domains the contract allows; rate limiting is a hand-written dependency rather than slowapi, so all six backends run the same sliding window against the same Redis keys; ruff excludes `*.md` because ruff 0.17 also formats Python blocks inside Markdown.

**WebSocket protocol decision:** all six backends use **plain WebSockets with the same JSON message format** (`{ type, payload }`), so the single React client can talk to any of them. Socket.IO (common in Node) and STOMP (common in Spring) are covered in the COMPARISON notes, but we don't use them because they'd tie the frontend to one backend.

**Frontend (one per app):** React + Vite + TypeScript, React Router, TanStack Query (server state), Zustand (client state), react-hook-form + zod, Tailwind CSS + shadcn/ui, and a native WebSocket client with auto-reconnect.

---

## 4. `STEPS.md`: how you'll rebuild each backend yourself

Every backend folder (and the frontend) has a `STEPS.md` that lets you rebuild the finished project from an empty folder. It's written as a sequence of small, checkpointed steps.

**Structure of each step:**

```markdown
## Step 14 · Rate limiting with a sliding window (Redis)

**Goal:** Limit each user to 100 requests per minute across all server instances.

**Files:** `app/core/rate_limit.py` (new), `app/main.py` (edit)

### 14.1 Write the limiter
<code to type, in small chunks — never a 300-line dump>

**What's new in this code (TS → Python):**
- `async def` ≈ `async function`; ...
- `@dataclass(frozen=True)` ≈ a readonly TS type with a generated constructor ...

### 🧠 DSA & scalability
- **Data structure:** Redis sorted set per user (score = timestamp).
- **Algorithm:** sliding-window log — ZREMRANGEBYSCORE (drop old entries) → ZCARD (count) → ZADD (add this request), done atomically in a Lua script / MULTI.
- **Complexity:** O(log n) per request, where n = requests in the window. Memory is O(limit) per user.
- **Why not the alternatives:** a fixed-window counter is O(1) but lets through a burst of up to 2× the limit at window edges. A token bucket is cheaper but less exact. An in-memory dict breaks as soon as you run 2 instances.

### ✅ Checkpoint
Run `uv run pytest tests/test_rate_limit.py`. Expected: 3 passed.
Then `for i in $(seq 1 105); do curl ...; done`. The last 5 should return 429.

**Commit:** `git commit -m "feat: redis sliding-window rate limiter"`
```

**What `STEPS.md` guarantees:**
- **Every file, every command, in order.** That includes project scaffolding, installing each dependency (and why it's needed), the Docker Compose setup, migrations, and tests.
- **Code in small chunks you type yourself**, each followed by an explanation of the syntax and idioms that are new compared with TypeScript.
- **A "🧠 DSA & scalability" box for every non-trivial function:** the data structure, the algorithm, time/space complexity, why it scales, and the alternatives that were rejected and why. More examples of what these cover:
  - Cursor pagination → B-tree index seek, O(log n), vs OFFSET's O(n) scan
  - Kanban ordering → fractional indexing (string midpoint), O(1) per move vs O(n) renumbering
  - Presence → Redis set + TTL keys, O(1) join/leave
  - Board cache → cache-aside with an LRU eviction policy; invalidation strategy
  - Permission checks → precomputed role→permission bitmasks / sets, O(1) lookup
  - Avoiding N+1 queries → eager loading / batched `IN (...)` queries
  - Background job retries → exponential backoff with jitter
  - Full-text search → inverted index (GIN)
- **Checkpoints after every step** (a command and its expected output), so you know whether you're on track before moving on.
- **Framework "why" notes:** why Spring wants an interface here, why Django puts this in `models.py`, why FastAPI uses `Depends()` instead of middleware, and so on.

`COMPARISON.md` (one per app) then puts the six implementations of each key feature side by side, e.g. "the auth guard in 6 frameworks".

---

## 5. Maven vs Gradle (you asked for a better understanding)

**What they are:** In Node, managing dependencies (`npm`), running scripts (`npm run build`), compiling (`tsc`), and bundling are separate tools glued together by `package.json`. In Java, **one build tool does all of it**: it downloads dependencies, compiles `.java` → `.class` bytecode, runs tests, and packages everything into a runnable `.jar`. Maven and Gradle are the two build tools everyone uses.

| You know (Node) | Maven | Gradle |
|---|---|---|
| `package.json` | `pom.xml` (XML) | `build.gradle.kts` (Kotlin code) |
| `dependencies` / `devDependencies` | `<scope>compile</scope>` / `<scope>test</scope>` | `implementation(...)` / `testImplementation(...)` |
| `npm install` | runs automatically on any build | runs automatically on any build |
| `node_modules/` (per project) | `~/.m2/repository` (shared global cache) | `~/.gradle/caches` (shared global cache) |
| `npm run build` | `./mvnw package` | `./gradlew build` |
| `npm test` | `./mvnw test` | `./gradlew test` |
| `npm run dev` | `./mvnw spring-boot:run` | `./gradlew bootRun` |
| `npx`-style pinned tool version | `mvnw` (Maven Wrapper, checked into the repo) | `gradlew` (Gradle Wrapper) |
| `"scripts"` (anything you like) | **Fixed lifecycle**: validate → compile → test → package → verify → install; plugins hook into phases | **Task graph you program** (like a Vite/webpack config) |
| npm registry | Maven Central | Maven Central (same repository) |

**The real difference:**
- **Maven is declarative.** You *describe* the project in XML and Maven follows a fixed, conventional lifecycle. It's verbose but predictable: every Maven project builds the same way. It's the most common choice in enterprise and Spring backend codebases.
- **Gradle is programmable.** The build file is real code (Kotlin or Groovy). It's more concise and **faster** (incremental builds, build cache, daemon), and it's the standard for Android and large monorepos. The flexibility also means every Gradle build can be a little different, and build errors are harder to read for beginners.

**Recommendation: Maven.** You'll learn Java and Spring without also learning a build language, almost every Spring Boot guide and job codebase you'll meet uses it, and the `pom.xml` reads like a `package.json`. Once you're comfortable, switching to Gradle takes an afternoon. I can add a Gradle version of the App 1 Spring backend as a bonus so you can compare. The full guide goes in `docs/java-build-tools.md`.

(For the Python side: `uv` ≈ npm, `pyproject.toml` ≈ `package.json`, `uv.lock` ≈ `package-lock.json`, `.venv/` ≈ `node_modules/`.)

---

## 6. Setup (Phase 0, before App 1)

| Item | Status | Action |
|---|---|---|
| Node 24 | ✅ installed | none |
| Python 3.14 + uv | ✅ installed | none |
| JDK 25 (LTS) | ✅ installed | Temurin 25.0.4.1 via SDKMAN (`sdk install java 25.0.4.1+1-tem`) |
| Maven | ✅ decided | No global install needed: each Spring repo ships the Maven Wrapper (`./mvnw`), like a pinned local npm. |
| Docker | ✅ working | Docker Desktop WSL integration, Compose v5.3.1 |
| Git | ✅ decided | The workspace is one monorepo on GitHub. Each hand rebuild is its own repo outside the workspace: you `git init` it as the first step of its STEPS.md, then push it to GitHub. |
| IDE | VS Code | Extensions: Python + Pylance, Extension Pack for Java, Spring Boot Extension Pack. IntelliJ IDEA Community is a better option for Java if you want one. |

Phase 0 also produces the `docs/` primers: **Python for TS devs** and **Java for TS devs**. These are short language tours (types, classes, collections, async, error handling, modules), so the framework code in STEPS.md doesn't hit you with brand-new syntax all at once.

---

### Installing Java

Run these in your WSL terminal:

```bash
# 1. SDKMAN needs these
sudo apt update && sudo apt install -y curl zip unzip

# 2. Install SDKMAN (Java version manager, like nvm)
curl -s "https://get.sdkman.io" | bash
source "$HOME/.sdkman/bin/sdkman-init.sh"   # or open a new terminal

# 3. Find the newest Temurin 25 build
sdk list java | grep -E '25\..*tem'

# 4. Install it and make it the default (identifier from step 3)
sdk install java 25.0.4.1+1-tem
sdk default java 25.0.4.1+1-tem

# 5. Verify
java -version      # should say: openjdk version "25..." ... Temurin
javac -version     # the compiler: javac 25...
echo $JAVA_HOME    # ~/.sdkman/candidates/java/current
```

- **Why both `java` and `javac`?** `javac` compiles `.java` source to `.class` bytecode, and `java` runs that bytecode on the JVM. It's like `tsc` and `node`, except that compiling is required.
- **Maven:** don't install it globally. Every Spring repo includes `./mvnw`, which downloads the exact Maven version that project needs. (`sdk install maven` is optional, for running `mvn` outside a project.)
- **VS Code:** open the folder through WSL (`code .` from the WSL terminal), then install **Extension Pack for Java** (`vscjava.vscode-java-pack`) and **Spring Boot Extension Pack** (`vmware.vscode-boot-dev-pack`) *in WSL*. Extensions installed only on the Windows side won't see the JDK.

Verify Docker after enabling the WSL integration:

```bash
docker --version && docker compose version
docker run --rm hello-world
```

---

## 7. Build order & workflow

**Within each app:**
1. `openapi.yaml` contract + data model (ER diagram)
2. **Express**: the baseline, in a style you already know
3. **Fastify**: same language, different philosophy (plugins, schema-first)
4. **NestJS**: introduces DI, modules, and decorators. **This is your bridge to Spring.**
5. **FastAPI**: Python, in a style closest to Express/Fastify
6. **Django**: Python, the batteries-included way
7. **Spring Boot**: Java; NestJS will already have made it feel familiar
8. **Frontends**: `frontend-node` right after Express, `frontend-python` right after FastAPI, `frontend-java` right after Spring Boot. Each backend is then verified against a working UI.
9. `COMPARISON.md`

**Per repo:** I build it, its tests and CI pass locally → I write its `STEPS.md` → you review it and rebuild it yourself in your own repo → we move on. Every app gets all 6 backends and all 3 frontends; size isn't a constraint.

---

## 7b. GitHub Actions (CI/CD in every repo)

Each repo gets a `.github/` folder, and STEPS.md has a dedicated step that explains each job line by line.

**Backend repos, `ci.yml`** (runs on every push and pull request):

| Job | What it does | Node | Python | Java |
|---|---|---|---|---|
| Lint & format | Fails on style errors | ESLint + Prettier | ruff check + ruff format --check | Spotless (google-java-format) |
| Type check | Catches type errors | `tsc --noEmit` | mypy (strict) | the compiler (`./mvnw compile`) |
| Test | Unit + integration tests against **real Postgres & Redis** as service containers | Vitest / Jest | pytest | JUnit 5 + Testcontainers |
| Migrations | Applies all migrations to an empty DB and fails if models and migrations drift apart | prisma / drizzle-kit / typeorm check | `makemigrations --check` / alembic check | Flyway validate |
| Contract test | Starts the app and fuzzes every endpoint against `contract/openapi.yaml` with **Schemathesis**, so the backend can't silently drift from the contract | ✓ | ✓ | ✓ |
| Coverage | Uploads a coverage report as a build artifact | ✓ | ✓ | JaCoCo |
| Docker | Builds the image on PRs; on `main`, pushes it to **GitHub Container Registry** (`ghcr.io/<you>/<repo>`) tagged with the commit SHA | ✓ | ✓ | ✓ |

**Frontend repos, `ci.yml`:** lint, type check, Vitest + React Testing Library, production build. **Playwright** end-to-end tests run against a backend image pulled from GHCR (by App 2 or 3, once backend images exist).

**Every repo also gets:**
- `dependabot.yml`: weekly dependency update PRs (npm / uv / Maven, GitHub Actions, Docker base images)
- `codeql.yml`: GitHub's free security scanning (JS/TS, Python, Java)
- Dependency caching (npm, uv, `~/.m2`) so CI runs fast
- A **branch protection checklist** in STEPS.md (GitHub settings: require CI to pass before merging to `main`)
- **Conventional commits** (`feat:`, `fix:`, `chore:`), used in every STEPS.md commit message

---

## 8. Decisions

**Confirmed:**
1. **Maven** for Spring Boot.
2. **Apps:** TaskFlow → Pulse → Cartly.
3. **TS ORMs:** Prisma (Express), Drizzle (Fastify), TypeORM (NestJS). **All 18 backends use PostgreSQL.**
4. **Environment:** JDK 25 (Temurin) and Docker are installed and working.
5. **Repos:** 27 independent repos (18 backends + 9 frontends) at `learning-programming/<app>/<app>-<framework>/`. Each backend has its own `docker-compose.yml`, run from inside its folder.
6. **Frontends:** one React + TS frontend per language group per app (`-frontend-node`, `-frontend-python`, `-frontend-java`).
7. **GitHub:** all repos get pushed, with full CI (§7b).
8. **Object storage: RustFS instead of MinIO** (decided 2026-10-30). MinIO stopped publishing community Docker images (`minio/minio` and `minio/mc` no longer exist on Docker Hub). RustFS (`rustfs/rustfs`, Apache-2.0) is a drop-in S3-compatible replacement on the same ports. Presigned PUT/GET, HEAD, prefix deletes and bucket CORS were verified with AWS SDK v3. The bucket and its CORS rules are created by an `amazon/aws-cli` init job in each compose file. Backend code only speaks the S3 API, so the provider is swappable.
9. **TypeScript 6.0 for the Node repos, not 7.0** (decided 2026-10-30). typescript-eslint supports TypeScript `<6.1`, and TS 7 (the Go-native compiler) isn't supported yet.
10. **`ascent/`: a game that plays the STEPS.md guides** (decided 2026-11-04). It reads each guide directly, so the guides stay the single source and the STEPS.md markers (CLAUDE.md §7) are now a parsed format. Progress lives in `ascent/data/progress.json`. Updating Ascent is part of finishing every repo and app (CLAUDE.md §10).
11. **Engineering and teaching decisions belong to Claude** (decided 2026-11-04). Claude acts as a senior developer and teacher, from the basics through advanced DSA, and decides rather than asking. The user learns, reviews each repo and rebuilds it by hand; Ascent exists to make that fun.
12. **Every repo publishes its own host ports, inside its own compose file** (decided 2026-11-12, at the user's request to run stacks side by side). Port = service prefix + the repo's slot (TaskFlow 01–06, Pulse 11–16, Cartly 21–26): API `80SS`, Postgres `154SS`, Redis `163SS`, S3 `190SS`/`191SS`, Mailpit `110SS`/`180SS`. The compose files stay in the repos (a separate `docker-<framework>/` folder would break "every repo works after `git clone`" and CI, which starts the repo's own stack); containers and CI keep the default ports. Supersedes the shared 15432/16379 ports from earlier the same day.
13. **Every backend seeds one default development user** (decided 2026-11-13, at the user's request): `ashutosh@test.com` / `Ashutosh#1234`, created by an idempotent, production-refusing seed command (`npm run db:seed` in the Node repos), taught as Step 4.9 of every backend guide. When a repo is finished, Claude runs the seed against its dev database so the login works immediately; the user runs it themselves only while rebuilding. CLAUDE.md §6 has the exact contract.
10. **Express serves the committed contract instead of generating one** (decided 2026-10-30). Generating a second spec from zod (zod-to-openapi) would duplicate the hand-written contract and could drift from it; Schemathesis verifies conformance instead.
14. **`taskflow-frontend-python` is contract-first** (decided 2026-11-15). Same Orbit UI as `frontend-node`, but the wire types are generated from the contract by `openapi-typescript` and every call is typed by `openapi-fetch`, with `npm run api:check` in CI as the frontend's drift check. Building the same UI a second time is only worth it if something is built differently, and deriving the client from the contract is the industry practice the first frontend skipped. The repo is also scaffolded by hand and previews UI on a dev-only `/kit` route, so its guide is insertion-only and replayed with `tools/steps-gen`. The codegen found one contract gap: `ActivityEvent.data` was a bare `type: object` (generated as an empty record); it now says `additionalProperties: true`, synced to every repo's copy.
