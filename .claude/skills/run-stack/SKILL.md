---
name: run-stack
description: Bring one of the backends (and its frontend) up for manual testing, with migrations and the default user seeded, and explain how to switch the frontend between backends. Use when the user asks how to run, start or try a backend or the frontend, or for login credentials.
---

# Run a backend + frontend for manual testing

Default login on every backend (after its seed has run): **`ashutosh@test.com` / `Ashutosh#1234`**.

## Ports (slot `SS`: TaskFlow 01–06, Pulse 11–16, Cartly 21–26, in build order)

| Repo slot | API | Postgres | Redis | Mailpit UI | RustFS console |
|---|---|---|---|---|---|
| SS | `80SS` | `154SS` | `163SS` | `180SS` | `191SS` |

TaskFlow: express 01, fastify 02, nestjs 03, fastapi 04, django 05, springboot 06. Postgres login `taskflow`/`taskflow`, database `taskflow`; RustFS `taskflow`/`taskflow-secret`; Mailpit and Redis need none.

## Start a backend (from its folder)

```bash
docker compose up -d --wait        # Postgres, Redis, RustFS (+ bucket), Mailpit
cp -n .env.example .env            # only the first time
```

| Stack | Install | Migrate | Seed | Run | Worker (emails, reminders) |
|---|---|---|---|---|---|
| Node (express/fastify/nestjs) | `npm ci` | `npm run db:migrate` (Express: `npm run db:deploy` on a clean DB) | `npm run db:seed` | `npm run dev` | `npm run dev:worker` |
| FastAPI | `uv sync` | `uv run alembic upgrade head` | `uv run python -m app.seed` | `uv run fastapi dev --port 80SS` | per its README |
| Django | `uv sync` | `uv run python manage.py migrate` | `uv run python manage.py seed_default_user` | `uv run python manage.py runserver 80SS` | per its README |
| Spring Boot | — | Flyway runs at start-up | `./mvnw spring-boot:run -Dspring-boot.run.profiles=seed` | `./mvnw spring-boot:run` | in-process |

Always check each repo's README quick start: it's the source of truth for that repo. Health check: `curl localhost:80SS/health/ready`.

**All in Docker instead:** `docker compose --profile app up -d --build --wait`. Containers run with `NODE_ENV`/profile `production`, where the seed refuses to run, so seed from the host (same Postgres): run the seed command above from the repo folder.

## Frontend

The `<app>-frontend-<language>` repo serves its group (node: express/fastify/nestjs; python: fastapi/django; java: springboot).

```bash
cd <app>/<app>-frontend-<language>
npm ci                              # first time
# .env: VITE_API_URL=http://localhost:80SS   (read at startup: restart `npm run dev` after changing it)
npm run dev                         # http://localhost:5173
```

## Switching backends

- Run them one at a time or side by side: ports and Docker volumes are per repo. `docker compose stop` in a repo frees its memory.
- Every backend has its own database, so the default user must be seeded in each.
- After switching, sign in again: all backends share `localhost`, so the browser sends the old backend's refresh cookie to the new one, which rejects it.
