# Ecosystem map: npm ↔ PyPI ↔ Maven Central

A lookup table: "I know how to do X in Node. What's the equivalent in Python and in Java?" Package names were checked against npm, PyPI and Maven Central in October 2026. **Versions are deliberately left out.** Each repo pins exact versions when it's built (see [CLAUDE.md §4](../CLAUDE.md)).

Related: [python-for-ts-devs.md](python-for-ts-devs.md) · [java-for-ts-devs.md](java-for-ts-devs.md) · [java-build-tools.md](java-build-tools.md)

---

## 1. Tooling

| Task | Node (npm) | Python (uv) | Java (Maven Wrapper) |
|---|---|---|---|
| Runtime version manager | nvm / fnm | `uv python install 3.14` (uv manages Python too) | SDKMAN: `sdk install java 25.0.4.1+1-tem` |
| Project manifest | `package.json` | `pyproject.toml` | `pom.xml` |
| Lockfile | `package-lock.json` | `uv.lock` | none: exact versions in the POM ([why](java-build-tools.md#5-coordinates-and-versions)) |
| Where packages are installed | `./node_modules` | `./.venv` (a per-project virtual environment) | `~/.m2/repository` (global cache) |
| Registry | registry.npmjs.org | pypi.org | Maven Central (central.sonatype.com to search) |
| New project | `npm init -y` | `uv init --app` (or `--package`) | Spring Initializr: start.spring.io / `curl start.spring.io/starter.tgz` |
| Install from the lockfile | `npm ci` | `uv sync --locked` | automatic on build (`./mvnw dependency:go-offline` to pre-fetch) |
| Add a dependency | `npm i zod` | `uv add pydantic` | paste a `<dependency>` into `pom.xml` |
| Add a dev dependency | `npm i -D vitest` | `uv add --dev pytest` | `<scope>test</scope>` |
| Remove | `npm rm x` | `uv remove x` | delete the `<dependency>` |
| Upgrade | `npm update` / `npm i x@latest` | `uv lock --upgrade` / `uv lock -P x` | edit the version (Dependabot PRs) |
| Outdated | `npm outdated` | `uv tree --outdated` | `./mvnw versions:display-dependency-updates` |
| Dependency tree / why | `npm ls` / `npm why x` | `uv tree` / `uv tree --invert --package x` | `./mvnw dependency:tree [-Dincludes=g:a]` |
| Run a project command | `npm run x` / `npx x` | `uv run x` (inside the venv) | `./mvnw <phase or plugin:goal>` |
| One-off tool without installing | `npx cowsay` | `uvx cowsay` | `jbang` (rarely used) |
| Scripts section | `"scripts"` | none built in: we call `uv run <tool>` directly (documented in each README) | lifecycle phases + plugins |
| REPL | `node` | `python` / `uv run python` | `jshell` |
| Type check | `tsc --noEmit` | `uv run mypy .` | `./mvnw compile` |
| Lint | ESLint | `uv run ruff check .` | compiler warnings (+ Error Prone if wanted) |
| Format | Prettier | `uv run ruff format .` | `./mvnw spotless:apply` |
| Test runner | Vitest / Jest | pytest | JUnit 5 (via Surefire) |
| Env file | `.env` + dotenv | `.env` + pydantic-settings / django-environ | `application.yml` + env vars (Spring maps `SPRING_DATASOURCE_URL` → `spring.datasource.url`) |

**Virtual environments in one paragraph:** Python installs packages into an interpreter's `site-packages` folder. A **virtual environment** (`.venv/`) is a private copy of that folder for one project, Python's `node_modules`. uv creates and syncs it automatically, and `uv run` runs commands inside it, so you never need to "activate" it. Add `.venv/` to `.gitignore` just as you would `node_modules/`.

---

## 2. Libraries by concern (App 1 stack)

Python is split into FastAPI and Django columns because Django ships many of these features built in.

| Concern | Node (Express / Fastify / Nest) | FastAPI | Django | Spring Boot (`org.springframework.boot:` unless noted) |
|---|---|---|---|---|
| Web framework | `express` / `fastify` / `@nestjs/core` | `fastapi` + `uvicorn` (ASGI server) | `django` + `djangorestframework` | `spring-boot-starter-webmvc` (embedded Tomcat) |
| Validation | `zod` / `@sinclair/typebox` / `class-validator` | `pydantic` | DRF serializers (built in) | `spring-boot-starter-validation` (Jakarta Bean Validation, Hibernate Validator) |
| camelCase JSON | native | Pydantic `alias_generator=to_camel` | `djangorestframework-camel-case` | Jackson default (record component names) |
| Config | `dotenv` + zod / `@fastify/env` / `@nestjs/config` | `pydantic-settings` | `django-environ` | `application.yml` + `@ConfigurationProperties` (built in) |
| ORM | `prisma` / `drizzle-orm` / `typeorm` | `sqlalchemy` (2.0, async) | Django ORM (built in) | `spring-boot-starter-data-jpa` (Hibernate) |
| Postgres driver | `pg` (via ORM) | `asyncpg` (async) / `psycopg` | `psycopg` | `org.postgresql:postgresql` (JDBC, runtime scope) |
| Migrations | Prisma Migrate / `drizzle-kit` / TypeORM | `alembic` | `makemigrations` / `migrate` (built in) | `spring-boot-starter-flyway` + `org.flywaydb:flyway-database-postgresql` |
| JWT | `jsonwebtoken` / `@fastify/jwt` / `@nestjs/passport` | `pyjwt` | `djangorestframework-simplejwt` | `spring-boot-starter-oauth2-resource-server` (+ `spring-boot-starter-security`) |
| Password hashing | `argon2` | `pwdlib[argon2]` | built-in hashers (`argon2-cffi` for Argon2) | Spring Security `PasswordEncoder` |
| UUIDv7 | `uuid` (`v7()`) | stdlib `uuid.uuid7()` (new in 3.14) | stdlib `uuid.uuid7()` | `com.fasterxml.uuid:java-uuid-generator` (the JDK has no v7) |
| Redis client | `ioredis` | `redis` (`redis.asyncio`) | `django-redis` | `spring-boot-starter-data-redis` (Lettuce) |
| WebSockets | `ws` / `@fastify/websocket` / `@nestjs/websockets` + `@nestjs/platform-ws` | Starlette WebSocket (built into FastAPI) | `channels` + `channels-redis` + `daphne` | `spring-boot-starter-websocket` |
| Background jobs | `bullmq` / `@nestjs/bullmq` | `celery` | `celery` | `@Async` + `@Scheduled` (built in) + Redis Streams |
| Object storage (S3 / RustFS) | `@aws-sdk/client-s3` | `boto3` | `django-storages` (+ `boto3`) | `software.amazon.awssdk:s3` |
| Email | `nodemailer` | `aiosmtplib` / `fastapi-mail` | `django.core.mail` (built in) | `spring-boot-starter-mail` |
| OpenAPI docs | `swagger-ui-express` + `yaml` (serve the contract) / `@fastify/swagger` / `@nestjs/swagger` | built in (`/docs`) | `drf-spectacular` | `org.springdoc:springdoc-openapi-starter-webmvc-ui` |
| Logging | `pino` / `nestjs-pino` | `structlog` | `structlog` | SLF4J + Logback (built in; Boot has JSON structured logging built in) |
| Health / metrics | hand-rolled | hand-rolled | hand-rolled | `spring-boot-starter-actuator` |
| HTTP client | `fetch` (built in) | `httpx` | `httpx` / `requests` | `RestClient` (built into Spring) |
| Unit and integration tests | `vitest` + `supertest` / `jest` | `pytest` + `pytest-asyncio` + `httpx` | `pytest` + `pytest-django` | JUnit 5 + AssertJ + MockMvc (`spring-boot-starter-*-test`) |
| Real infra in tests | compose / service containers | compose / service containers, or `testcontainers` | same | `spring-boot-testcontainers` + `org.testcontainers:testcontainers-postgresql` |
| Contract tests | `schemathesis` (Python CLI, any backend) | `schemathesis` | `schemathesis` | `schemathesis` |
| Type stubs | `@types/*` | mostly bundled; `types-*` packages | `django-stubs`, `djangorestframework-stubs` | n/a (Java is typed) |
| Production server | `node dist/main.js` | `uvicorn` (or `fastapi run`) | `gunicorn` (WSGI) / `daphne` or `uvicorn` (ASGI) | `java -jar app.jar` |

**IDs, a decision to make at contract time:** PostgreSQL 18 (verified with the `postgres:18` image, 18.6) has a built-in **`uuidv7()`** function. Generating IDs in the database works the same way for all six backends. Generating them in app code (the libraries above) lets you know the ID before the `INSERT`. Which one we use is decided, and explained, in the TaskFlow data model.

---

## 3. Coming in Apps 2 and 3 (to be confirmed per repo)

| Concern | Node | Python | Java |
|---|---|---|---|
| Kafka | `kafkajs` | `aiokafka` / `confluent-kafka` | `org.springframework.kafka:spring-kafka` |
| Stripe | `stripe` | `stripe` | `com.stripe:stripe-java` |
| Prometheus metrics | `prom-client` | `prometheus-client` | `io.micrometer:micrometer-registry-prometheus` |
| OpenTelemetry | `@opentelemetry/sdk-node` | `opentelemetry-sdk` + instrumentations | Micrometer Tracing / OpenTelemetry starter |

The final choices go into each app's README library table, as [CLAUDE.md §4](../CLAUDE.md) requires.

---

## 4. Evaluating a package you don't know

The same checks work in every ecosystem:

| Signal | npm | PyPI | Maven Central |
|---|---|---|---|
| Popularity | weekly downloads | pypistats.org | "Used by" on mvnrepository.com |
| Recent maintenance | last publish date | release history | version list |
| Typed? | ships `.d.ts` or `@types/*` | `py.typed` marker (mypy reads the inline hints) | always |
| Framework blessing | listed in framework docs | FastAPI / Django docs | managed by the Spring Boot BOM: **if Boot manages it, prefer it** |
