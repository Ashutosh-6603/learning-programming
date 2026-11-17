# taskflow-frontend-node

The **TaskFlow** web app ("Orbit"): a Jira/Trello-lite Kanban UI with a 3D board in a starfield. It talks to any of the three Node backends of [TaskFlow](../README.md): `taskflow-express`, `taskflow-fastify` or `taskflow-nestjs`. They implement one contract ([`contract/openapi.yaml`](contract/openapi.yaml)), so switching is a matter of `VITE_API_URL`.

**To rebuild this repo by hand, follow [STEPS.md](STEPS.md).**

## Features

- Sign up / sign in with a short-lived access token in memory and a rotating `httpOnly` refresh cookie, behind a **single-flight refresh** (concurrent 401s share one refresh, so rotation never trips reuse detection)
- Workspaces as a **3D carousel** with cursor pagination; projects per workspace
- A **3D-tilted Kanban board**: native drag-and-drop plus keyboard/button moves, **optimistic updates with rollback**, WIP-limit warnings
- **Live updates and presence** over a plain WebSocket (ticket auth, ping, reconnect with exponential backoff + full jitter, refetch after every resubscribe)
- Task dialog bound to the URL (`?task=…`): merge-patch edits, comments, activity feed, **presigned S3 uploads**
- Workspace **full-text search** with highlighted matches, rendered without `innerHTML`
- Members, roles and invitations, with controls shown according to RBAC (the server still decides)
- RFC 9457 problems mapped onto form fields (422) or toasts (everything else)
- Accessible: real buttons and labels, ARIA tabs, focus-trapped dialogs, reduced-motion support

## Stack

| Concern | Choice |
|---|---|
| Build / dev server | Vite 8, TypeScript 6 (strict, `noUncheckedIndexedAccess`) |
| UI | React 19, Tailwind CSS 4 (CSS-first `@theme`), shadcn/ui on Radix, lucide icons |
| Server state | TanStack Query 5 (infinite queries, optimistic mutations) |
| Client state | Zustand 5 (auth in memory; preferences persisted) |
| Routing | React Router 8 data router, `lazy` route chunks |
| Forms | react-hook-form + zod 4 |
| Real-time | Browser `WebSocket` (no Socket.IO) |
| Unit / component tests | Vitest 5, Testing Library, MSW 3 (HTTP *and* WebSocket mocks) |
| End-to-end | Playwright 1.64 against a real backend |
| Container | Multi-stage: Node build → `nginx-unprivileged` (uid 101) |

## Quick start

```bash
# 1. Start a backend (from its own folder), e.g.
cd ../taskflow-express && cp .env.example .env && npm ci && docker compose --profile app up -d --build && npm run db:seed && cd -

# 2. Run the app
cp .env.example .env          # VITE_API_URL picks the backend: 8001 express (default), 8002 fastify, 8003 nestjs
npm ci
npm run dev                   # http://localhost:5173
```

Sign in with the default user **`ashutosh@test.com` / `Ashutosh#1234`** (run `npm run db:seed` once in the backend's folder to create it), or register a new account on the launch page. Create a workspace and a project, and you're on the board. Invitation emails land in that backend's Mailpit: http://localhost:18001 (express), 18002 (fastify), 18003 (nestjs).

Each backend publishes its own ports, so you can keep several stacks up and switch the frontend between them with `VITE_API_URL`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on :5173 (strict port: the backend's CORS allows exactly this origin) |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build on :5173 |
| `npm run typecheck` | `tsc -b --noEmit` across app and tooling configs |
| `npm run lint` | ESLint with `strictTypeChecked` |
| `npm run format` / `format:check` | Prettier |
| `npm test` | Vitest (unit + component), once |
| `npm run test:coverage` | Same, with V8 coverage in `coverage/` |
| `npm run e2e` | Playwright: builds, serves with `vite preview`, runs `e2e/` against the backend at `VITE_API_URL` |

## Environment

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8001` (express; fastify is 8002, nestjs 8003) | Backend base URL; the WebSocket URL is derived from it (`http` → `ws`). Inlined at **build** time. |

## Tests

- `npm test` runs 54 tests in 11 files: pure logic (board reducers, carousel geometry, permissions, backoff, highlight parsing, dates, slugs), the API client (including the single-flight refresh), the WebSocket client (reconnect with a fresh ticket), and the launch and board pages (validation, the show/hide password toggle, server errors, optimistic move and rollback, viewer restrictions, URL-bound dialog).
- `npm run e2e` runs 4 Playwright tests against a real backend: the full sign-up-to-comment journey, drag-and-drop, two tabs updating live, and search. The backend's rate limits must be raised for the burst of sign-ups; see [STEPS.md, Part 11](STEPS.md#part-11--end-to-end-tests). On WSL without Chromium's system libraries, run them in `mcr.microsoft.com/playwright:v1.64.1-noble` (same section).

## Docker

```bash
docker compose up -d --build   # serves the production build on http://localhost:5173
docker compose down
```

`VITE_API_URL` is a build argument (`VITE_API_URL=https://api.example.com docker compose build`). nginx serves the SPA with a fallback to `index.html`, caches hashed assets for a year, never caches `index.html`, and sets security headers on every response.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: format, lint and typecheck → Vitest with a coverage artifact → production build → Playwright E2E (enabled by setting the repository variable `E2E_BACKEND_REPO`, e.g. `you/taskflow-express`; the job checks that repo out and starts its compose stack) → Docker image, pushed to `ghcr.io/<owner>/taskflow-frontend-node` with the commit SHA and `latest` on `main`. CodeQL and Dependabot run alongside.

## Layout

```text
src/
├── main.tsx, router.tsx, index.css, config.ts
├── components/ui/       shadcn/ui primitives (generated, lightly edited)
├── components/orbit/    app chrome: brand, starfield, dialogs, presence, toaster
├── components/board/    card, column, search box, task dialog and its tabs
├── hooks/               useDebouncedValue, useProjectRealtime
├── lib/api/             wire types, fetch client, endpoints
├── lib/queries/         TanStack Query hooks per feature
├── lib/realtime/        ProjectSocket, backoff
├── lib/*.ts             pure logic: board-cache, carousel, headline, permissions, format, slug
├── pages/               one component per route
├── stores/              Zustand: auth, toasts, preferences
└── test/                MSW server, fixtures, render helper
```

TypeScript 6 is deliberate: `typescript-eslint` supports TypeScript below 6.1, so Dependabot is told to skip TypeScript majors until it catches up.
