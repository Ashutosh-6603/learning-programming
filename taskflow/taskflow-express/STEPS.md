# STEPS · Rebuild `taskflow-express` from an empty folder

You'll build the **TaskFlow API** (a Jira/Trello-lite backend) with **Express 5, Prisma 7, PostgreSQL 18 and Redis**, by hand, one small step at a time. At the end your repo behaves exactly like this one: the same endpoints, the same tests, the same CI.

This is the **first** of six TaskFlow backends, and the reference implementation. You already know TypeScript and Node, so this guide spends its words on three things:

1. **The architecture and the "why"** behind each piece. Every later backend (Fastify, NestJS, FastAPI, Django, Spring Boot) uses the same Part/Step numbering, so you can compare Step 7.2 here with Step 7.2 in Spring Boot.
2. **Library specifics** that may be new to you: Express 5, Prisma 7 (driver adapters, `prisma.config.ts`), zod 4, ioredis, BullMQ, `ws`, the AWS SDK v3.
3. **The data structures and algorithms**, in a 🧠 box under every non-trivial feature: complexity, why it scales, and the alternatives that were rejected.

> **Design docs you'll want open:** [`../README.md`](../README.md) (the TaskFlow design: data model, RBAC, auth, real-time protocol, Redis keys) and [`contract/openapi.yaml`](contract/openapi.yaml) (the API). This guide implements them; it doesn't repeat them.

## What you'll build

```mermaid
flowchart LR
    Client["HTTP / WebSocket client"] --> API
    subgraph Express["taskflow-express"]
        API["main.ts<br/>Express app + WS gateway"]
        Worker["worker.ts<br/>BullMQ worker + schedules"]
    end
    API --> PG[("PostgreSQL 18<br/>Prisma 7")]
    API --> R[("Redis 8<br/>tokens · cache · limits ·<br/>presence · pub/sub · queue")]
    API --> S3[("RustFS<br/>S3 API")]
    Worker --> PG
    Worker --> R
    Worker --> S3
    Worker --> Mail["Mailpit<br/>SMTP"]
```

**Inside the API process**, every request flows through the same layers:

```mermaid
flowchart LR
    R["routes<br/>(*.routes.ts)<br/>parse + validate"] --> S["services<br/>(*.service.ts)<br/>RBAC, rules,<br/>transactions"]
    S --> D["Prisma Client /<br/>repositories"]
    S -. after commit .-> X["cache · pub/sub · jobs"]
```

## Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Node.js | 24 (npm 11.17+) | `node -v && npm -v` |
| Docker + Compose | Compose v5 | `docker compose version` |
| uv (for the contract test) | 0.12+ | `uv --version` |
| A GitHub account | | |

npm **11.17 or newer** matters: it blocks dependency install scripts unless you approve them (Step 0.4).

## The finished repo

```text
taskflow-express/
├── .github/            dependabot.yml, workflows/ci.yml, workflows/codeql.yml
├── contract/           openapi.yaml (copy of the master contract)
├── prisma/             schema.prisma, migrations/
├── src/
│   ├── main.ts         HTTP server + WebSocket gateway + graceful shutdown
│   ├── worker.ts       background job worker + cron schedules
│   ├── app.ts          builds the Express app (middleware + routes)
│   ├── container.ts    creates infra clients and wires every service (manual DI)
│   ├── config.ts       typed, validated environment
│   ├── http/           middleware: logging, errors, auth, rate limiting
│   ├── infra/          Prisma, Redis, S3, logger factories
│   ├── jobs/           queue facade, processors, mailer
│   ├── lib/            problem errors, validation, cursors, fractional indexing
│   ├── modules/        one folder per feature: routes → service → (repository)
│   └── types/          Express type augmentation
├── tests/              unit/ and integration/ (real Postgres, Redis, S3, SMTP)
├── docker-compose.yml  local infra (+ the app under the "app" profile)
├── Dockerfile          multi-stage, non-root
└── schemathesis.toml   contract-test settings
```

**Parts:** 0 Repo setup · 1 Infrastructure & config · 2 Database · 3 HTTP foundations · 4 Authentication · 5 Workspaces & RBAC · 6 Projects, columns & ordering · 7 Tasks · 8 Comments, activity & search · 9 Attachments · 10 Real-time · 11 Background jobs · 12 Contract testing · 13 Docker · 14 CI/CD · 15 Full stack & next steps

**How to read the code blocks:** each block says which file it belongs to and where it goes: **new file**, **continue** (append to the end of the file), or **add after `<line>`** (insert the block right below that existing line). Type them in that order and your files will match the repo exactly.

---

## Part 0 · Repo setup

### Step 0.1 · Create the repo

**Goal:** an empty git repository with the npm project file.

**Files:** `package.json`

```bash
mkdir taskflow-express && cd taskflow-express
git init -b main
npm init -y
npm pkg set name=taskflow-express description="TaskFlow API: Express 5 + Prisma 7 + PostgreSQL + Redis"
npm pkg set private=true --json
npm pkg set license=MIT type=module engines.node=">=24"
npm pkg delete main keywords author
```

**What's new**
- `"type": "module"` makes every `.js` file an ES module, so you write `import`/`export` without a bundler. The catch with TypeScript's `nodenext` resolution is that **imports must name the compiled file**: you write `import { x } from './config.js'` even though the file on disk is `config.ts`. TypeScript maps it back. This is the single biggest surprise when moving from bundler-based projects.
- `npm pkg set` edits `package.json` from the command line, so every change here is reproducible.

**✅ Checkpoint**

```bash
npm pkg get name type
```

Expected: `"name": "taskflow-express"` and `"type": "module"`.

**Commit:** `chore: initialise npm package`

### Step 0.2 · TypeScript

**Goal:** a strict TypeScript setup with a separate build config.

**Files:** `tsconfig.json`, `tsconfig.build.json`

```bash
npm i -D -E typescript@6.0.3 @types/node@26.6.6 tsx@4.23.15
npm approve-scripts esbuild
```

- **`typescript` 6.0.3, not 7.** TypeScript 7 (the Go-native compiler) exists, but `typescript-eslint` supports only `<6.1` so far, so we pin the newest version it supports. `-E` (`--save-exact`) writes `6.0.3` instead of `^6.0.3`: every repo in this workspace pins exact versions.
- **`tsx`** runs `.ts` files directly in development (with watch mode), like `ts-node` but faster (it uses esbuild).
- **`npm approve-scripts esbuild`**: esbuild's install script checks that its platform-specific binary was installed. It's the first of a few install-script decisions (see Step 0.4).

**`tsconfig.json`** · new file

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "tests", "prisma.config.ts", "vitest.config.ts", "eslint.config.js"]
}
```

**`tsconfig.build.json`** · new file

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": false
  },
  "include": ["src"]
}
```

**What's new**
- `module`/`moduleResolution: nodenext` makes TypeScript follow Node's real ESM rules (hence the `.js` extensions).
- `verbatimModuleSyntax` forces `import type` for type-only imports, so the compiled JS never imports something that only existed at compile time.
- `noUncheckedIndexedAccess` makes `array[i]` and `record[key]` return `T | undefined`. It's stricter than most codebases you've seen, and you'll write `?? fallback` more often. It catches real bugs.
- Two configs: `tsconfig.json` type-checks **everything** (src, tests, config files) for `tsc --noEmit` and the editor; `tsconfig.build.json` compiles only `src/` into `dist/` for production.

**✅ Checkpoint**

```bash
npx tsc --version
```

Expected: `Version 6.0.3`.

**Commit:** `chore: add strict typescript config`

### Step 0.3 · Lint, format, editor settings, ignores

**Goal:** ESLint (type-aware), Prettier, `.editorconfig` and `.gitignore`.

**Files:** `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore`

```bash
npm i -D -E eslint@10.13.0 @eslint/js@10.0.1 typescript-eslint@8.72.1 globals@17.13.0 \
  prettier@3.9.10 eslint-config-prettier@10.1.8
```

**`eslint.config.js`** · new file

```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'src/generated/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['eslint.config.js'], extends: [tseslint.configs.disableTypeChecked] },
  prettier,
);
```

**`.prettierrc.json`** · new file

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "trailingComma": "all"
}
```

**`.prettierignore`** · new file

```text
node_modules/
dist/
coverage/
src/generated/
prisma/migrations/
package-lock.json
contract/
STEPS.md
README.md
.schemathesis/
schemathesis-report/
.hypothesis/
```

**`.editorconfig`** · new file

```text
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

**`.gitignore`** · new file

```text
node_modules/
dist/
coverage/
src/generated/
.env
*.log
.DS_Store
.schemathesis/
schemathesis-report/
.hypothesis/
```

**What's new**
- **Flat config** (`eslint.config.js`) is the only format ESLint 10 supports. `strictTypeChecked` turns on rules that need type information (`projectService: true` lets ESLint ask TypeScript), for example "this condition is always true" or "you forgot to `await` this promise".
- `eslint-config-prettier` goes **last**: it switches off every ESLint rule that would fight Prettier over formatting.
- `argsIgnorePattern: '^_'` lets you keep a parameter you must declare but don't use, such as Express's 4-argument error handler `(err, req, res, _next)`.
- The ignore files already list folders that only appear later (`src/generated/`, `.schemathesis/`, …), so you never commit them by accident.

**✅ Checkpoint**

```bash
npx eslint --version && npx prettier --version
```

Expected: `v10.13.0` and `3.9.10`.

**Commit:** `chore: add eslint, prettier, editorconfig and gitignore`

### Step 0.4 · npm scripts and install-script approvals

**Goal:** the scripts you'll use every day, and a decision about which dependencies may run install scripts.

**Files:** `package.json`

```bash
npm pkg set scripts.dev="tsx watch src/main.ts" \
  scripts.build="tsc -p tsconfig.build.json" \
  scripts.start="node dist/main.js" \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint ." \
  scripts.format="prettier --write ." \
  scripts.format:check="prettier --check ." \
  scripts.test="vitest run" \
  scripts.test:unit="vitest run tests/unit" \
  scripts.test:coverage="vitest run --coverage"
npm approve-scripts --allow-scripts-pending
```

**What's new**
- **npm 11.17+ doesn't run dependencies' `preinstall`/`install`/`postinstall` scripts until you approve them.** It's a supply-chain defence: a compromised package can no longer run code on your machine just by being installed. `npm approve-scripts --allow-scripts-pending` lists the packages waiting for a decision. We'll answer it as packages arrive (Steps 2.1 and 4.1), and the decisions are stored in `package.json` under `allowScripts`, so CI and Docker make the same choices.

**✅ Checkpoint**

```bash
npx tsc --version && npx eslint --version && npx prettier --version
```

Expected: `Version 6.0.3`, `v10.13.0`, `3.9.10`.

**Commit:** `chore: scaffold TypeScript project with ESLint and Prettier`

### Step 0.5 · Push to GitHub

**Goal:** the repo exists on GitHub so CI can run later.

**Files:** none (GitHub only)

```bash
gh repo create taskflow-express --private --source=. --remote=origin --push
```

(Without the GitHub CLI: create an empty repo on github.com, then `git remote add origin git@github.com:<you>/taskflow-express.git && git push -u origin main`.)

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
name: taskflow-express
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
      - '15401:5432'
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
      - '16301:6379'
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
      - '19001:9000'
      - '19101:9001'
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
      - '11001:1025'
      - '18001:8025'
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
- **`name: taskflow-express`** namespaces containers, networks and **volumes** (`taskflow-express_postgres-data`), so six TaskFlow repos never share a database by accident. Each repo also publishes its **own host ports** (next point), so several repos' stacks can run side by side.
- **`ports: 'HOST:CONTAINER'`**. Inside its container, Postgres listens on its normal port, 5432. `'15401:5432'` publishes that port on your machine as **15401**. Two programs can't bind the same host port (*Bind for 0.0.0.0:5432 failed: port is already allocated*), so every repo in this workspace gets its own: the last two digits are the repo's slot (`01` for Express, `02` for Fastify, …), giving Express Postgres **15401**, Redis **16301**, S3 **19001** (console 19101), SMTP **11001** (Mailpit UI 18001) and the API **8001**. None of them is a default, so they also stay clear of other projects on your machine. Only the host side changes. Containers in this compose file still reach each other at `postgres:5432` and `redis:6379`, and so does CI (Part 14), where the runner starts empty and nothing else is using the defaults.
- **`healthcheck`** on every service. Other services (and `s3-init`) wait with `depends_on: condition: service_healthy`, the compose equivalent of "await until ready".
- **RustFS** is an S3-compatible object store (an Apache-2.0 replacement for MinIO, which stopped publishing Docker images in 2025). Your code only ever speaks the S3 API, so AWS S3 in production is a configuration change.
- **`s3-init`** is a one-shot job: it creates the bucket and sets **CORS** so a browser on `localhost:5173` may `PUT` files straight to S3 (Part 9). `$$` escapes `$` in compose files.
- **Mailpit** accepts any email on port 1025 and shows it in a web UI on port 8025: you test emails without sending real ones.

**✅ Checkpoint**

```bash
docker compose up -d
docker compose ps --format 'table {{.Service}}\t{{.Status}}' -a
```

Expected: `postgres`, `redis`, `rustfs` and `mailpit` are `Up … (healthy)`, and `s3-init` is `Exited (0)`. `docker compose logs s3-init` ends with `bucket taskflow-attachments ready`.

**Commit:** `chore: docker compose for postgres, redis, rustfs and mailpit`

### Step 1.2 · Typed configuration

**Goal:** read every environment variable once, validate it, and fail fast at startup with a readable message.

**Files:** `.env.example`, `src/config.ts`

```bash
npm i -E dotenv@18.0.9 zod@4.6.7
cp .env.example .env    # after you create .env.example below
```

- **`dotenv`** loads `.env` into `process.env` in development. In Docker and CI the variables come from the environment instead, and dotenv silently does nothing.
- **`zod`** validates the variables and gives you a typed `Config` object. It's also our request validator from Part 3 on.

**`.env.example`** · new file

```bash
# Copy to .env for local development: cp .env.example .env
# Every value below matches docker-compose.yml, so `docker compose up -d` + `npm run dev` just works.

NODE_ENV=development
PORT=8001
LOG_LEVEL=info

# PostgreSQL 18 (compose service "postgres")
DATABASE_URL=postgresql://taskflow:taskflow@localhost:15401/taskflow

# Redis (compose service "redis"): refresh tokens, cache, rate limits, presence, pub/sub, job queue
REDIS_URL=redis://localhost:16301/0

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
S3_ENDPOINT=http://localhost:19001
S3_PUBLIC_ENDPOINT=http://localhost:19001
S3_REGION=us-east-1
S3_BUCKET=taskflow-attachments
S3_ACCESS_KEY=taskflow
S3_SECRET_KEY=taskflow-secret

# Sliding-window limits (requests per minute). The contract test raises these.
RATE_LIMIT_AUTH_PER_MINUTE=10
RATE_LIMIT_API_PER_MINUTE=300

# Email via Mailpit (web UI: http://localhost:18001)
SMTP_HOST=localhost
SMTP_PORT=11001
MAIL_FROM=TaskFlow <no-reply@taskflow.local>
```

**`src/config.ts`** · new file

```ts
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv({ quiet: true });

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(604_800),
  COOKIE_SECURE: z.stringbool().default(true),
  FRONTEND_URL: z.url().default('http://localhost:5173'),
  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  MAIL_FROM: z.string().default('TaskFlow <no-reply@taskflow.local>'),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_PER_MINUTE: z.coerce.number().int().positive().default(300),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
```

**`src/config.ts`** · continue

```ts

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = ConfigSchema.safeParse(env);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
```

**What's new**
- `z.coerce.number()` turns the string `"8000"` into a number before validating (environment variables are always strings). `z.stringbool()` (zod 4) accepts `true/false/1/0/yes/no`.
- `z.infer<typeof ConfigSchema>` derives the TypeScript type from the runtime schema: one source of truth for both. This is the pattern Python's pydantic-settings and Spring's `@ConfigurationProperties` give you natively, as you'll see later.
- `loadConfig(env)` takes the environment as a parameter (defaulting to `process.env`), so tests can build a config from any object.

**✅ Checkpoint**

```bash
cp .env.example .env
npx tsx -e "import('./src/config.ts').then(m => console.log(m.loadConfig().PORT))"
JWT_SECRET=short npx tsx -e "import('./src/config.ts').then(m => m.loadConfig())" 2>&1 | grep -A1 JWT
```

Expected: `8000`, then an error containing `✖ must be at least 32 characters` and `→ at JWT_SECRET`.

**Commit:** `chore: docker compose infrastructure and typed config`

---

## Part 2 · Database schema & migrations

The data model is designed in the TaskFlow README (§4). Read §4.1 to §4.3 first: the ER diagram, the reference schema every backend must produce, and the reasons behind each decision.

### Step 2.1 · Install Prisma 7 and initialise it

**Goal:** Prisma's CLI and client, with Prisma 7's new pieces: a **driver adapter** and a **`prisma.config.ts`**.

**Files:** `prisma/schema.prisma`, `prisma.config.ts`

```bash
npm i -E @prisma/client@7.10.1 @prisma/adapter-pg@7.10.1 pg@8.23.1
npm i -D -E prisma@7.10.1 @types/pg@8.23.1
npm approve-scripts @prisma/engines prisma
npx prisma init --datasource-provider postgresql --output ../src/generated/prisma --no-skills
mv prisma7.config.ts prisma.config.ts
cp .env.example .env      # prisma init rewrites .env with a sample URL; restore ours
npx prettier --write prisma.config.ts
```

- Pin **7.10.1** explicitly. npm's `latest` tag for `prisma` currently points to an **8.0 release candidate**, so a bare `npm i prisma` would install a pre-release.
- `npm approve-scripts @prisma/engines prisma` lets Prisma download its **schema engine** (the binary behind `migrate`).
- `--no-skills`: without it, `prisma init` also downloads AI-assistant "skill" files into `.agents/`, `.claude/` and `.windsurf/`. They aren't part of your app.
- `prisma init` names the config `prisma7.config.ts`. Prisma also reads the version-neutral `prisma.config.ts`, which is what we use. `init` also overwrites `.env` with a sample `DATABASE_URL`, so restore ours.

**`prisma.config.ts`** · new file

```ts
// This file was generated by Prisma, and assumes you have installed the following:
// npm install --save-dev prisma dotenv
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
```

**What's new (Prisma 7)**
- **The connection URL moved out of `schema.prisma`** into `prisma.config.ts`, which is TypeScript, so it can load `.env` itself (`import 'dotenv/config'`).
- **No more Rust query engine.** Prisma Client now talks to Postgres through a **driver adapter** wrapping the normal `pg` driver (`@prisma/adapter-pg`). You'll see it in Step 2.4.
- **The client is generated into your source tree** (`src/generated/prisma`) as TypeScript, and compiled with the rest of your code. It's in `.gitignore`: every machine regenerates it.

**✅ Checkpoint**

```bash
npx prisma validate
```

Expected: `The schema at prisma/schema.prisma is valid 🚀` (the empty schema from `init`).

**Commit:** `chore: add prisma 7 with the pg driver adapter`

### Step 2.2 · The generator and the first models

**Goal:** model the tables with Prisma's schema language, mapping camelCase fields to snake_case columns.

**Files:** `prisma/schema.prisma` (replace the generated content)

**`prisma/schema.prisma`** · new file

```prisma
generator client {
  provider            = "prisma-client"
  output              = "../src/generated/prisma"
  moduleFormat        = "esm"
  importFileExtension = "js"
  previewFeatures     = ["partialIndexes"]
}

datasource db {
  provider = "postgresql"
}
```

**`prisma/schema.prisma`** · continue

```prisma
model User {
  id           String   @id @default(uuid(7)) @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  displayName  String   @map("display_name")
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt    DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  workspacesCreated Workspace[]       @relation("WorkspaceCreator")
  memberships       WorkspaceMember[]
  invitationsSent   Invitation[]
  projectsCreated   Project[]
  tasksAssigned     Task[]            @relation("TaskAssignee")
  tasksReported     Task[]            @relation("TaskReporter")
  comments          Comment[]
  attachments       Attachment[]
  activity          ActivityEvent[]

  @@map("users")
}
```

**`prisma/schema.prisma`** · continue

```prisma
model Workspace {
  id        String   @id @default(uuid(7)) @db.Uuid
  name      String
  slug      String   @unique
  createdBy String   @map("created_by") @db.Uuid
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  creator     User              @relation("WorkspaceCreator", fields: [createdBy], references: [id])
  members     WorkspaceMember[]
  invitations Invitation[]
  projects    Project[]
  activity    ActivityEvent[]

  @@map("workspaces")
}

model WorkspaceMember {
  id          String   @id @default(uuid(7)) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  userId      String   @map("user_id") @db.Uuid
  role        String
  joinedAt    DateTime @default(now()) @map("joined_at") @db.Timestamptz

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId, workspaceId], map: "workspace_members_user_idx")
  @@map("workspace_members")
}
```

**What's new**
- `moduleFormat = "esm"` + `importFileExtension = "js"` make the generated client match our `nodenext` setup (it imports `./enums.js`, …).
- `previewFeatures = ["partialIndexes"]` enables `@@index(..., where: raw("..."))`. Without it, Prisma can't express partial indexes, and its drift check would want to drop the ones in the database.
- `@id @default(uuid(7)) @db.Uuid` generates **UUIDv7** in the client before the INSERT, stored in a native `uuid` column. README §4.3 explains why v7.
- `@map("password_hash")` / `@@map("users")`: TypeScript sees `passwordHash` on a `User`, while the database has `password_hash` in `users`. Every backend uses the same snake_case schema.
- `@updatedAt` makes Prisma set the column on every update (the README's "updated_at maintained by the application").
- Relations are declared on **both** sides: the foreign key on one model (`fields: [createdBy], references: [id]`) and a list (`Workspace[]`) on the other. When two relations connect the same pair of models (a task's assignee and its reporter), they need names (`@relation("TaskAssignee")`).

**✅ Checkpoint**

```bash
npx prisma validate
```

Expected: validation **errors** about `Invitation`, `Project`, `Task`… The models above already point at models you'll write in the next step, so these errors are expected and disappear in Step 2.3.

**Commit:** `feat: prisma models for users, workspaces and members`

### Step 2.3 · The remaining models

**Goal:** Model the remaining tables: invitations, projects, columns, tasks, comments, attachments and the activity log.

**Files:** `prisma/schema.prisma` (continue)

**`prisma/schema.prisma`** · continue

```prisma
model Invitation {
  id          String    @id @default(uuid(7)) @db.Uuid
  workspaceId String    @map("workspace_id") @db.Uuid
  email       String
  role        String
  tokenHash   String    @unique @map("token_hash")
  invitedBy   String    @map("invited_by") @db.Uuid
  expiresAt   DateTime  @map("expires_at") @db.Timestamptz
  acceptedAt  DateTime? @map("accepted_at") @db.Timestamptz
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  inviter   User      @relation(fields: [invitedBy], references: [id])

  @@unique([workspaceId, email], map: "invitations_pending_email_uq", where: raw("accepted_at IS NULL"))
  @@index([workspaceId, id], map: "invitations_workspace_idx", where: raw("accepted_at IS NULL"))
  @@map("invitations")
}

model Project {
  id             String   @id @default(uuid(7)) @db.Uuid
  workspaceId    String   @map("workspace_id") @db.Uuid
  name           String
  key            String
  description    String?
  nextTaskNumber Int      @default(1) @map("next_task_number")
  createdBy      String   @map("created_by") @db.Uuid
  createdAt      DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  workspace Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  creator   User          @relation(fields: [createdBy], references: [id])
  columns   BoardColumn[]
  tasks     Task[]

  @@unique([workspaceId, key])
  @@index([workspaceId, id], map: "projects_workspace_idx")
  @@map("projects")
}
```

**`prisma/schema.prisma`** · continue

```prisma

model BoardColumn {
  id        String   @id @default(uuid(7)) @db.Uuid
  projectId String   @map("project_id") @db.Uuid
  name      String
  position  String
  wipLimit  Int?     @map("wip_limit")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  tasks   Task[]

  @@unique([projectId, position])
  @@map("board_columns")
}
```

**`prisma/schema.prisma`** · continue

```prisma
model Task {
  id             String                   @id @default(uuid(7)) @db.Uuid
  projectId      String                   @map("project_id") @db.Uuid
  columnId       String                   @map("column_id") @db.Uuid
  number         Int
  title          String
  description    String?
  priority       String                   @default("medium")
  assigneeId     String?                  @map("assignee_id") @db.Uuid
  reporterId     String                   @map("reporter_id") @db.Uuid
  dueAt          DateTime?                @map("due_at") @db.Timestamptz
  reminderSentAt DateTime?                @map("reminder_sent_at") @db.Timestamptz
  position       String
  searchVector   Unsupported("tsvector")? @default(dbgenerated("(setweight(to_tsvector('english'::regconfig, title), 'A'::\"char\") || setweight(to_tsvector('english'::regconfig, COALESCE(description, ''::text)), 'B'::\"char\"))")) @map("search_vector")
  createdAt      DateTime                 @default(now()) @map("created_at") @db.Timestamptz
  updatedAt      DateTime                 @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  project     Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  column      BoardColumn  @relation(fields: [columnId], references: [id], onDelete: NoAction)
  assignee    User?        @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  reporter    User         @relation("TaskReporter", fields: [reporterId], references: [id])
  comments    Comment[]
  attachments Attachment[]

  @@unique([projectId, number])
  @@unique([columnId, position])
  @@index([projectId, id], map: "tasks_project_idx")
  @@index([assigneeId, id], map: "tasks_assignee_idx")
  @@index([searchVector], map: "tasks_search_idx", type: Gin)
  @@index([dueAt], map: "tasks_due_reminder_idx", where: raw("reminder_sent_at IS NULL AND assignee_id IS NOT NULL"))
  @@map("tasks")
}
```

**`prisma/schema.prisma`** · continue

```prisma
model Comment {
  id        String   @id @default(uuid(7)) @db.Uuid
  taskId    String   @map("task_id") @db.Uuid
  authorId  String   @map("author_id") @db.Uuid
  body      String
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz

  task   Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  author User @relation(fields: [authorId], references: [id])

  @@index([taskId, id], map: "comments_task_idx")
  @@map("comments")
}

model Attachment {
  id          String   @id @default(uuid(7)) @db.Uuid
  taskId      String   @map("task_id") @db.Uuid
  uploaderId  String   @map("uploader_id") @db.Uuid
  fileName    String   @map("file_name")
  contentType String   @map("content_type")
  sizeBytes   BigInt   @map("size_bytes")
  storageKey  String   @unique @map("storage_key")
  status      String   @default("pending")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  task     Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  uploader User @relation(fields: [uploaderId], references: [id])

  @@index([taskId, id], map: "attachments_task_idx", where: raw("status = 'ready'"))
  @@index([createdAt], map: "attachments_pending_idx", where: raw("status = 'pending'"))
  @@map("attachments")
}
```

**`prisma/schema.prisma`** · continue

```prisma
model ActivityEvent {
  id          String   @id @default(uuid(7)) @db.Uuid
  workspaceId String   @map("workspace_id") @db.Uuid
  projectId   String?  @map("project_id") @db.Uuid
  taskId      String?  @map("task_id") @db.Uuid
  actorId     String   @map("actor_id") @db.Uuid
  type        String
  data        Json     @default("{}")
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  actor     User      @relation(fields: [actorId], references: [id])

  @@index([workspaceId, id], map: "activity_workspace_idx")
  @@index([projectId, id], map: "activity_project_idx", where: raw("project_id IS NOT NULL"))
  @@index([taskId, id], map: "activity_task_idx", where: raw("task_id IS NOT NULL"))
  @@map("activity_events")
}
```

**What's new**
- `role String` instead of a Prisma `enum`: the README chose `text + CHECK` so all six ORMs can migrate it the same way. The `CHECK` constraints are added by hand in the migration (next step).
- `searchVector Unsupported("tsvector")? @default(dbgenerated(...))` declares a column type Prisma doesn't support. The `dbgenerated` expression is exactly how Postgres *reports* the generated column back. Declaring it means Prisma's drift check (Step 2.5) sees no difference.
- `onDelete: NoAction` on `Task.column` reproduces the README decision: a column that still has tasks can't be deleted, but deleting a project still cascades.
- `type: Gin` on the search index: a GIN index is an **inverted index** (word → rows), which is what full-text search needs (Part 8).
- `sizeBytes BigInt`: Postgres `bigint` arrives in JavaScript as a `bigint`, because `number` can't hold all 64-bit values. We convert it at the API edge (Part 9).

**✅ Checkpoint**

```bash
npx prisma validate && npx prisma format --check
```

Expected: `The schema at prisma/schema.prisma is valid 🚀` and `All files are formatted correctly!`.

**Commit:** `feat: prisma models for projects, tasks, comments, attachments and activity`

### Step 2.4 · Generate the migration and add what Prisma can't express

**Goal:** a migration that produces exactly the README's reference schema.

**Files:** `prisma/migrations/<timestamp>_init/migration.sql`

```bash
npx prisma migrate dev --create-only --name init
```

`--create-only` writes the SQL **without** applying it, so you can edit it first. Open the new `migration.sql` and make three edits.

**Edit 1.** In `CREATE TABLE "board_columns"`, add `COLLATE "C"` to `position`.
**Edit 2.** In `CREATE TABLE "tasks"`, do the same for `position`, and replace the `search_vector … DEFAULT (...)` line with a real generated column:

**`prisma/migrations/20261030081525_init/migration.sql`** · excerpt

```sql
    "position" TEXT COLLATE "C" NOT NULL,
    "search_vector" tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('english', title), 'A') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'B')
    ) STORED,
```

**Edit 3.** Append the `CHECK` constraints at the end of the file:

**`prisma/migrations/20261030081525_init/migration.sql`** · excerpt

```sql
-- Hand-written: constraints Prisma's schema language can't express (see README "Migrations")
ALTER TABLE "users" ADD CONSTRAINT "users_email_check" CHECK (email = lower(email));
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_role_check" CHECK (role IN ('owner', 'admin', 'member', 'viewer'));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_email_check" CHECK (email = lower(email));
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_role_check" CHECK (role IN ('admin', 'member', 'viewer'));
ALTER TABLE "projects" ADD CONSTRAINT "projects_key_check" CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');
ALTER TABLE "board_columns" ADD CONSTRAINT "board_columns_wip_limit_check" CHECK (wip_limit BETWEEN 1 AND 999);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_priority_check" CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_size_bytes_check" CHECK (size_bytes > 0);
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_status_check" CHECK (status IN ('pending', 'ready'));
```

Then apply it and generate the client:

```bash
npx prisma migrate dev
```

**What's new**
- **Why hand-edit a generated migration?** Prisma's schema language has no syntax for column collations, generated columns or `CHECK` constraints. Editing the SQL before it's applied is the officially supported escape hatch. The migration file is what actually runs in production, so it's the source of truth for the database.
- **`COLLATE "C"`** makes `ORDER BY position` compare bytes instead of applying English language rules. Fractional-index keys (Part 6) only sort correctly in byte order: the README's DDL test shows `Zz < a0 < a0V` under `"C"`, but `a0 < a0V < Zz` under `en_US`.
- **`GENERATED ALWAYS AS (...) STORED`**: Postgres computes `search_vector` from `title` and `description` on every insert and update. You can never write it, and it can never be stale.

**✅ Checkpoint**

```bash
npx prisma migrate status
```

Expected: `1 migration found in prisma/migrations` and `Database schema is up to date!`.

**Commit:** `feat: initial migration with collations, generated column and checks`

### Step 2.5 · Database client and drift check

**Goal:** a Prisma client factory, a Redis factory, and a script that proves `schema.prisma` and the migrations agree.

**Files:** `src/infra/db.ts`, `src/infra/redis.ts`

```bash
npm i -E ioredis@6.0.0
npm pkg set scripts.postinstall="prisma generate" \
  scripts.db:migrate="prisma migrate dev" \
  scripts.db:deploy="prisma migrate deploy" \
  scripts.db:drift="prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code"
```

**`src/infra/db.ts`** · new file

```ts
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

export type Db = PrismaClient | Prisma.TransactionClient;

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}
```

**`src/infra/redis.ts`** · new file

```ts
import { Redis } from 'ioredis';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}
```

**What's new**
- `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })`: Prisma 7's client is handed a driver adapter instead of a URL. The adapter owns a `pg` connection pool.
- `type Db = PrismaClient | Prisma.TransactionClient`. Inside `prisma.$transaction(async (tx) => …)` you receive a `tx` that has the same query API, but no `$transaction` and no `$connect`. Functions typed with `Db` work both inside and outside a transaction (Part 5 uses this for the activity log).
- `postinstall: prisma generate` regenerates the client after every `npm install`/`npm ci`, on every machine.
- **`maxRetriesPerRequest: null`** on ioredis: BullMQ (Part 11) requires it, and it makes commands wait for a reconnect instead of failing during a brief Redis restart.

**✅ Checkpoint**

```bash
npm run db:drift
docker compose exec postgres psql -U taskflow -c '\d tasks' | grep -E 'position|search_vector'
```

Expected: `No difference detected.`, then:

```text
 position         | text                     | C         | not null |
 search_vector    | tsvector                 |           |          | generated always as (...) stored
```

**Commit:** `feat: prisma schema and initial migration`

---

## Part 3 · HTTP foundations

Before any business logic, we build the things every endpoint relies on: problem+json errors, validation, request IDs and logging, health checks, 405 handling, the app/container skeleton, and the test harness.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one error type that becomes a `application/problem+json` response.

**Files:** `src/lib/problem.ts`

**`src/lib/problem.ts`** · new file

```ts
export interface FieldError {
  field: string;
  message: string;
}

const TITLES = {
  'bad-request': 'Bad request',
  unauthorized: 'Unauthorized',
  forbidden: 'Forbidden',
  'not-found': 'Not found',
  'method-not-allowed': 'Method not allowed',
  conflict: 'Conflict',
  'payload-too-large': 'Payload too large',
  'unsupported-media-type': 'Unsupported media type',
  'validation-error': 'Validation failed',
  'rate-limited': 'Too many requests',
  internal: 'Internal server error',
} as const;

export type ProblemSlug = keyof typeof TITLES;

const STATUS: Record<ProblemSlug, number> = {
  'bad-request': 400,
  unauthorized: 401,
  forbidden: 403,
  'not-found': 404,
  'method-not-allowed': 405,
  conflict: 409,
  'payload-too-large': 413,
  'unsupported-media-type': 415,
  'validation-error': 422,
  'rate-limited': 429,
  internal: 500,
};

export const PROBLEM_TYPE_BASE = 'https://taskflow.example/problems/';
```

**`src/lib/problem.ts`** · continue

```ts

/** An error that maps 1:1 to an RFC 9457 problem response. */
export class ProblemError extends Error {
  readonly status: number;
  readonly title: string;

  constructor(
    readonly slug: ProblemSlug,
    detail?: string,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? TITLES[slug]);
    this.name = 'ProblemError';
    this.status = STATUS[slug];
    this.title = TITLES[slug];
  }
}

export const notFound = (what = 'Resource') => new ProblemError('not-found', `${what} not found`);
export const forbidden = (detail = 'Your role does not allow this action') =>
  new ProblemError('forbidden', detail);
export const conflict = (detail: string) => new ProblemError('conflict', detail);
export const unauthorized = (detail = 'Authentication required') =>
  new ProblemError('unauthorized', detail);
export const invalid = (field: string, message: string) =>
  new ProblemError('validation-error', 'The request contains invalid fields', [{ field, message }]);
```

**What's new**
- `TITLES` is declared `as const`, and `ProblemSlug = keyof typeof TITLES` derives the union `'bad-request' | 'unauthorized' | …` from it. `STATUS: Record<ProblemSlug, number>` then **forces** you to give every slug a status: add a slug and forget the status, and it won't compile.
- **Parameter properties** (`readonly slug: ProblemSlug` in the constructor) declare and assign a field in one go. Services throw these (`throw notFound('Task')`), and one error handler (Step 3.4) turns them into responses.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Validation helpers

**Goal:** parse `body`, `query` and path params with zod, turning failures into a 422 whose `errors[].field` uses the wire names.

**Files:** `src/lib/validation.ts`

**`src/lib/validation.ts`** · new file

```ts
import type { Request } from 'express';
import { z } from 'zod';
import { ProblemError } from './problem.js';

type Location = 'body' | 'query' | 'path';

function parse<T extends z.ZodType>(schema: T, data: unknown, location: Location): z.infer<T> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const errors = result.error.issues.map((issue) => {
    const path = issue.path.map(String).join('.');
    const field = location === 'body' ? path || 'body' : [location, path].filter(Boolean).join('.');
    return { field, message: issue.message };
  });
  throw new ProblemError('validation-error', 'The request contains invalid fields', errors);
}

export const parseBody = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.body ?? {}, 'body');
export const parseQuery = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.query, 'query');
export const parseParams = <T extends z.ZodType>(schema: T, req: Request) =>
  parse(schema, req.params, 'path');
```

**What's new**
- These are plain functions you call **inside** the handler: `const body = parseBody(CreateTaskBody, req)`. The return type is inferred from the schema, so `body.title` is typed. Validation *middleware* is the other common Express style, but Express's `req.body` is `any`, so middleware can't give you a typed result.
- The field prefix follows the contract (README §13): body fields are bare (`title`), query and path fields get a prefix (`query.limit`, `path.taskId`).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: zod validation helpers with wire field paths`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an `X-Request-Id`, every log line is JSON with that ID, and responses carry the security headers from the README.

**Files:** `src/infra/logger.ts`, `src/types/express.d.ts`, `src/http/middleware.ts`

```bash
npm i -E express@5.3.0 pino@10.4.0 pino-http@11.0.0 uuid@14.0.3
npm i -D -E @types/express@5.0.6
```

**`src/infra/logger.ts`** · new file

```ts
import { pino, type Logger } from 'pino';
import type { Config } from '../config.js';

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'taskflow-express' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
  });
}
```

**`src/types/express.d.ts`** · new file

```ts
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string };
    }
  }
}

export {};
```

**`src/http/middleware.ts`** · new file

```ts
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';
import { v7 as uuidv7 } from 'uuid';
import { Prisma } from '../generated/prisma/client.js';
import { PROBLEM_TYPE_BASE, ProblemError } from '../lib/problem.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customProps: (req) => ({ requestId: req.id, userId: req.auth?.userId }),
    customLogLevel: (_req, res, err) =>
      err !== undefined || res.statusCode >= 500 ? 'error' : 'info',
    serializers: {
      req: (req: { method: string; url: string }) => ({ method: req.method, path: req.url }),
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url.startsWith('/health') },
  });
}

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
};
```

**What's new**
- **pino** writes one JSON object per line: fast, and what log platforms ingest. `redact` replaces secrets with `[redacted]` before anything is written.
- **`pino-http`**'s `genReqId` lets us honour a valid incoming `X-Request-Id` (so a request can be traced across services) or mint a UUIDv7. `req.log` is then a child logger with the request ID on every line.
- **Declaration merging** (`declare global { namespace Express { interface Request { auth?: … } } }`) adds our `req.auth` field to Express's `Request` type. The `export {}` turns the file into a module, which `declare global` requires.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · 415, 405, 404 and the error handler

**Goal:** Turn every failure (unknown route, wrong method, wrong content type, a thrown `ProblemError`, a unique violation, malformed JSON) into one problem+json response.

**Files:** `src/http/middleware.ts` (continue)

**`src/http/middleware.ts`** · continue

```ts

/** express.json() silently skips non-JSON bodies; the contract wants 415 instead. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  const hasBody =
    Number(req.headers['content-length'] ?? 0) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) {
    next(new ProblemError('unsupported-media-type', 'Request body must be application/json'));
    return;
  }
  next();
};

/**
 * Express answers unknown methods with 404. Chained last on `router.route(path)`, this turns
 * them into 405 + Allow, using the methods registered on that route.
 */
export const methodNotAllowed: RequestHandler = (req, res, next) => {
  const route = req.route as { methods: Record<string, boolean> };
  const allowed = Object.keys(route.methods)
    .filter((m) => m !== '_all')
    .map((m) => m.toUpperCase());
  if (allowed.includes('GET')) allowed.push('HEAD');
  res.setHeader('Allow', allowed.join(', '));
  next(new ProblemError('method-not-allowed', `${req.method} is not supported on this path`));
};

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new ProblemError('not-found', 'No route matches this path'));
};
```

**`src/http/middleware.ts`** · continue

```ts

function toProblem(err: unknown): ProblemError {
  if (err instanceof ProblemError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new ProblemError('conflict', 'A resource with these values already exists');
  }
  if (typeof err === 'object' && err !== null && 'type' in err) {
    // Errors thrown by express.json() (body-parser) carry a `type`.
    if (err.type === 'entity.parse.failed')
      return new ProblemError('bad-request', 'Malformed JSON');
    if (err.type === 'entity.too.large') return new ProblemError('payload-too-large');
  }
  return new ProblemError('internal', 'An unexpected error occurred');
}

export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  const problem = toProblem(err);
  if (problem.status >= 500) req.log.error({ err }, 'unhandled error');
  res
    .status(problem.status)
    .type('application/problem+json')
    .json({
      type: PROBLEM_TYPE_BASE + problem.slug,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      instance: req.originalUrl.split('?')[0],
      requestId: req.id,
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
};
```

**What's new (Express specifics)**
- **Express 5 forwards rejected promises to the error handler.** In Express 4 an `async` handler that threw left the request hanging unless you wrapped it. In Express 5, `throw notFound()` inside an `async` route just works. That's why none of our routes have try/catch.
- An **error-handling middleware** is recognised by having **four** parameters `(err, req, res, next)`. Remove `_next` and Express treats it as a normal middleware.
- **Express answers an unknown method with 404**, where HTTP says 405 + `Allow`. FastAPI, Django and Spring do this for you, Express doesn't. `methodNotAllowed` is chained **last** on each `router.route(path)`, and reads `req.route.methods` to know what *is* allowed.
- `express.json()` ignores bodies that aren't `application/json` and leaves `req.body` as `undefined`. `requireJsonBody` makes that an explicit 415, as the contract requires.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: 405, 415, 404 and the problem+json error handler`

### Step 3.5 · Health checks

**Goal:** `/health/live` (is the process up?) and `/health/ready` (can it reach Postgres and Redis?).

**Files:** `src/modules/health/health.routes.ts`

**`src/modules/health/health.routes.ts`** · new file

```ts
import { Router } from 'express';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { methodNotAllowed } from '../../http/middleware.js';

const TIMEOUT_MS = 1000;

async function check(probe: () => Promise<unknown>): Promise<'ok' | 'unavailable'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, TIMEOUT_MS);
  });
  try {
    await Promise.race([probe(), timeout]);
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}
```

**`src/modules/health/health.routes.ts`** · continue

```ts
export function healthRoutes(prisma: PrismaClient, redis: Redis): Router {
  const router = Router();

  router
    .route('/health/live')
    .get((_req, res) => {
      res.json({ status: 'ok' });
    })
    .all(methodNotAllowed);

  router
    .route('/health/ready')
    .get(async (_req, res) => {
      const [database, cache] = await Promise.all([
        check(() => prisma.$queryRaw`SELECT 1`),
        check(() => redis.ping()),
      ]);
      const ok = database === 'ok' && cache === 'ok';
      res.status(ok ? 200 : 503).json({
        status: ok ? 'ok' : 'unavailable',
        checks: { database, redis: cache },
      });
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- `router.route('/health/ready').get(…).all(methodNotAllowed)` is Express's chaining API: one `route` object per path, one handler per method, and `.all()` as the catch-all for every other method.
- `check()` races each probe against a 1-second timeout. Without it, a hung Redis would make the readiness probe hang too, and the orchestrator would see a timeout instead of a clear 503.
- **Why two probes?** Kubernetes (and compose) *restart* a container whose **liveness** fails, but only *stop sending traffic* to one whose **readiness** fails. A database outage shouldn't restart every API instance.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: liveness and readiness endpoints`

### Step 3.6 · The container, the app and `main.ts`

**Goal:** the three files that tie everything together. They start small and grow in every Part.

**Files:** `src/container.ts`, `src/app.ts`, `src/main.ts`

```bash
npm i -E cors@2.8.6 cookie-parser@1.4.7 swagger-ui-express@5.0.1 yaml@2.9.1
npm deny-scripts @scarf/scarf          # install-time telemetry pulled in by swagger-ui
npm i -D -E @types/cors@2.8.19 @types/cookie-parser@1.4.10 @types/swagger-ui-express@4.1.8
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

**`src/container.ts`** · new file

```ts
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { createPrisma } from './infra/db.js';
import { createLogger } from './infra/logger.js';
import { createRedis } from './infra/redis.js';

export interface Infra {
  config: Config;
  logger: Logger;
  prisma: PrismaClient;
  redis: Redis;
}

export function createInfra(config: Config): Infra {
  const redis = createRedis(config.REDIS_URL);
  return {
    config,
    logger: createLogger(config),
    prisma: createPrisma(config.DATABASE_URL),
    redis,
  };
}

export async function closeInfra(infra: Infra): Promise<void> {
  await infra.prisma.$disconnect();
  infra.redis.disconnect();
}

/** Manual dependency injection: the one place that knows how everything is wired. */
export function createServices(infra: Infra) {
  return {
  };
}

export type Services = ReturnType<typeof createServices>;
```

**What's new**
- **This is dependency injection, by hand.** NestJS and Spring have a container that builds objects for you. Express has nothing, so `container.ts` is the one place that says "the projects service gets this Prisma client and this cache". `createInfra` builds the clients (Postgres, Redis, …), `createServices` builds the services from them, and tests call the same two functions. `createServices` returns `{}` for now and fills up as you go.
- `export type Services = ReturnType<typeof createServices>` derives the type from the factory, so you never maintain a separate interface.

**`src/app.ts`** · new file

```ts
import { readFileSync } from 'node:fs';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import type { Infra, Services } from './container.js';
import {
  errorHandler,
  notFoundHandler,
  requestLogger,
  requireJsonBody,
  securityHeaders,
} from './http/middleware.js';
import { healthRoutes } from './modules/health/health.routes.js';

export function createApp(infra: Infra, services: Services): Express {
  const { config, logger, redis } = infra;
  const app = express();
  app.disable('x-powered-by');

  app.use(requestLogger(logger));
  app.use(securityHeaders);
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    }),
  );

  app.use(healthRoutes(infra.prisma, redis));

  if (config.NODE_ENV !== 'production') {
    const contract: unknown = parseYaml(readFileSync('contract/openapi.yaml', 'utf8'));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(contract as swaggerUi.JsonObject));
  }

  const api = Router();
  api.use(requireJsonBody, express.json({ limit: '1mb' }), cookieParser());

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
```

**What's new**
- `createApp` **builds** the app but doesn't listen. Tests pass it straight to supertest, and `main.ts` passes it to an HTTP server.
- Middleware order matters: logging first (so even errors get a request ID), then headers and CORS, then routes, and the 404 and error handlers **last**.
- `/api/v1` is a separate `Router` with the JSON body parser (1 MB limit → 413), so health checks and docs don't parse bodies.
- In development, `/docs` serves **the committed contract** with Swagger UI. The contract is the source of truth, so we serve it rather than generate a second spec from the code.

**`src/main.ts`** · new file

```ts
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeInfra, createInfra, createServices } from './container.js';

const config = loadConfig();
const infra = createInfra(config);
const services = createServices(infra);
const app = createApp(infra, services);

const server = createServer(app);

server.listen(config.PORT, () => {
  infra.logger.info({ port: config.PORT }, 'taskflow-express listening');
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  infra.logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await new Promise<void>((resolve) => {
    server.close(() => {
      resolve();
    });
  });
  await closeInfra(infra);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**What's new**
- `createServer(app)` instead of `app.listen()` gives us the raw `http.Server`, which Part 10 needs for WebSocket upgrades.
- **Graceful shutdown:** on `SIGTERM` (what Docker sends on `docker stop`) we stop accepting connections, let in-flight requests finish, and close the pools. `force.unref()` makes the 10-second safety timer not keep the process alive by itself.

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s localhost:8001/health/ready
curl -si -X POST localhost:8001/health/live | head -1
curl -s localhost:8001/nope
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
{"type":"https://taskflow.example/problems/not-found","title":"Not found","status":404,"detail":"No route matches this path","instance":"/nope","requestId":"01…"}
```

Open http://localhost:8001/docs to see the contract in Swagger UI.

**Commit:** `feat: app, container and server entry point`

### Step 3.7 · The test harness

**Goal:** Vitest running against a **separate** test database, with a helper that builds the whole app.

**Files:** `tests/test-env.ts`, `tests/global-setup.ts`, `vitest.config.ts`, `tests/helpers.ts`, `tests/unit/validation.test.ts`, `tests/integration/health.test.ts`

```bash
npm i -D -E vitest@5.0.5 @vitest/coverage-v8@5.0.5 supertest@7.3.1 @types/supertest@7.2.1
```

**`tests/test-env.ts`** · new file

```ts
import { config as loadDotenv } from 'dotenv';

loadDotenv({ quiet: true });

/** Tests never touch the dev database: same server, database name suffixed with _test. */
function testDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://taskflow:taskflow@localhost:15401/taskflow',
  );
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Redis logical database 1 instead of 0. */
function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:16301/0');
  url.pathname = '/1';
  return url.toString();
}

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
  MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:18001',
};
```

**`tests/global-setup.ts`** · new file

```ts
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { testEnv } from './test-env.js';

/** Runs once before all test files: create + migrate the test database, ensure the bucket exists. */
export default async function setup(): Promise<void> {
  const url = new URL(testEnv.DATABASE_URL);
  const database = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${database}"`);
  await admin.end();

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testEnv.DATABASE_URL },
    stdio: 'ignore',
  });
}
```

**`vitest.config.ts`** · new file

```ts
import { defineConfig } from 'vitest/config';
import { testEnv } from './tests/test-env.js';

export default defineConfig({
  test: {
    env: testEnv,
    globalSetup: ['tests/global-setup.ts'],
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/generated/**', 'src/main.ts', 'src/worker.ts', 'src/seed.ts', 'src/types/**'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
```

**`tests/helpers.ts`** · new file

```ts
import supertest from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeInfra, createInfra, createServices, type Infra } from '../src/container.js';

export interface TestContext {
  infra: Infra;
  services: ReturnType<typeof createServices>;
  request: ReturnType<typeof supertest>;
  close: () => Promise<void>;
}

export function createTestContext(): TestContext {
  const infra = createInfra(loadConfig());
  const services = createServices(infra);
  const app = createApp(infra, services);
  return { infra, services, request: supertest(app), close: () => closeInfra(infra) };
}

const TABLES = [
  'activity_events',
  'attachments',
  'comments',
  'tasks',
  'board_columns',
  'projects',
  'invitations',
  'workspace_members',
  'workspaces',
  'users',
];

export async function resetState(ctx: TestContext): Promise<void> {
  await ctx.infra.prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  await ctx.infra.redis.flushdb();
}
```

**What's new**
- **Tests run against real Postgres and Redis**, never mocks or SQLite (a workspace rule). The test database is `taskflow_test`, and Redis uses logical database 1, so running tests never touches your dev data.
- `globalSetup` runs **once** per test run, in the main Vitest process: it creates the database if needed and applies the migrations. `test.env` injects the test URLs into every test worker.
- `fileParallelism: false`: integration files share one database, and `resetState` truncates every table before each test, so files run one at a time. Tests *within* a file are sequential by default.
- `TRUNCATE … CASCADE` empties all tables in one statement, much faster than deleting rows. `flushdb` empties Redis db 1.

**`tests/unit/validation.test.ts`** · new file

```ts
import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ProblemError } from '../../src/lib/problem.js';
import { parseBody, parseQuery } from '../../src/lib/validation.js';

const fakeRequest = (parts: Partial<Request>) => parts as Request;

function fieldsOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    return (err as ProblemError).errors?.map((e) => e.field) ?? [];
  }
  return [];
}

describe('validation field paths', () => {
  it('uses camelCase wire paths for body fields', () => {
    const schema = z.object({ dueAt: z.string(), nested: z.object({ projectId: z.string() }) });
    expect(fieldsOf(() => parseBody(schema, fakeRequest({ body: { nested: {} } })))).toEqual([
      'dueAt',
      'nested.projectId',
    ]);
  });

  it('prefixes query parameters', () => {
    const schema = z.object({ limit: z.coerce.number().max(100) });
    expect(fieldsOf(() => parseQuery(schema, fakeRequest({ query: { limit: '500' } })))).toEqual([
      'query.limit',
    ]);
  });
});
```

**`tests/integration/health.test.ts`** · new file

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext } from '../helpers.js';

const ctx = createTestContext();
afterAll(() => ctx.close());

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await ctx.request.get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('reports readiness of Postgres and Redis', async () => {
    const res = await ctx.request.get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('answers unknown routes with a problem+json 404 that echoes the request id', async () => {
    const res = await ctx.request.get('/nope').set('X-Request-Id', 'abc-123').expect(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.body).toMatchObject({
      type: 'https://taskflow.example/problems/not-found',
      status: 404,
      instance: '/nope',
      requestId: 'abc-123',
    });
  });

  it('answers undeclared methods with 405 and an Allow header', async () => {
    const res = await ctx.request.post('/health/live').expect(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.body).toMatchObject({
      type: 'https://taskflow.example/problems/method-not-allowed',
    });
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/unit/validation.test.ts tests/integration/health.test.ts
```

Expected: no type errors, then `Test Files  2 passed (2)` and `Tests  6 passed (6)`.

**Commit:** `feat: http foundations (problem errors, logging, health, test harness)`

---

## Part 4 · Authentication

The design is in README §6: short-lived JWT access tokens, opaque refresh tokens stored hashed in Redis and **rotated on every use**, and reuse detection that revokes the whole token family.

### Step 4.1 · Password hashing with argon2id

**Goal:** hash passwords with argon2id at the OWASP baseline, and make unknown emails cost as much time as wrong passwords.

**Files:** `src/modules/auth/passwords.ts`

```bash
npm i -E argon2@0.45.1
npm deny-scripts argon2
```

**Why deny argon2's install script?** Its script is `node-gyp rebuild` (compile from C source, which needs Python and a C compiler). The package also ships **prebuilt binaries** for Linux, macOS and Windows, which it loads at runtime when the build is skipped. Denying the script keeps installs fast and works in a slim Docker image with no compiler.

**`src/modules/auth/passwords.ts`** · new file

```ts
import { argon2id, hash, verify, type HashOptions } from 'argon2';

// OWASP baseline for argon2id: 19 MiB memory, 2 iterations, 1 lane.
const OPTIONS: HashOptions = { type: argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export const verifyPassword = (passwordHash: string, password: string) =>
  verify(passwordHash, password);

let dummyHash: Promise<string> | undefined;

/** Burns the same CPU time as a real check, so unknown emails can't be detected by timing. */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-for-timing');
  await verify(await dummyHash, password);
  return false;
}
```

**What's new**
- `argon2` exposes named exports (`hash`, `verify`, `argon2id`), and `HashOptions` types the options object.
- `dummyHash ??= …` (logical nullish assignment) computes the dummy hash **once**, lazily, and reuses the promise.

> **🧠 DSA & scalability · password hashing**
> - **Algorithm:** argon2id, a *memory-hard* hash. Each verification fills 19 MiB of RAM and makes 2 passes over it.
> - **Why memory-hard:** attackers guess passwords on GPUs with thousands of cores but little memory per core. Requiring 19 MiB per guess caps how many guesses run in parallel. bcrypt is only CPU-hard, and SHA-256 is designed to be *fast*, the opposite of what you want here.
> - **Cost:** ~20–50 ms of CPU per login on purpose. That's fine for logins (rare), and it's why `/auth/*` gets its own strict rate limit (Step 4.6).
> - **Timing side channel:** if unknown emails returned instantly, an attacker could time responses to discover which emails have accounts. `verifyAgainstDummy` makes both paths do the same work.
> - **Rejected:** bcrypt (72-byte password limit, not memory-hard), PBKDF2 (only CPU-hard), plain SHA-256 (fast = crackable).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: argon2id password hashing`

### Step 4.2 · Access tokens (JWT)

**Goal:** sign and verify 15-minute JWTs with the claims from README §6.1.

**Files:** `src/modules/auth/access-tokens.ts`

```bash
npm i -E jsonwebtoken@9.0.3
npm i -D -E @types/jsonwebtoken@9.0.10
```

**`src/modules/auth/access-tokens.ts`** · new file

```ts
import jwt from 'jsonwebtoken';
import { unauthorized } from '../../lib/problem.js';

const ISSUER = 'taskflow';
const AUDIENCE = 'taskflow-api';

export interface AccessToken {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class AccessTokens {
  constructor(
    private readonly secret: string,
    private readonly ttlSeconds: number,
  ) {}

  issue(userId: string): AccessToken {
    const accessToken = jwt.sign({}, this.secret, {
      algorithm: 'HS256',
      subject: userId,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: this.ttlSeconds,
    });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.ttlSeconds };
  }

  /** Returns the user id, or throws 401. */
  verify(token: string): string {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
        clockTolerance: 30,
      });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error();
      return payload.sub;
    } catch {
      throw unauthorized('Invalid or expired access token');
    }
  }
}
```

**What's new**
- `jsonwebtoken` is CommonJS. With `esModuleInterop` you import its default export (`import jwt from 'jsonwebtoken'`), and Node's ESM loader hands you `module.exports`.
- `algorithms: ['HS256']` on verify is **essential**: without it, a token claiming `alg: none` or a different algorithm could be accepted. Always pin the algorithm.
- `verify` returns `string | JwtPayload`, so we narrow before reading `sub`. Any failure becomes a 401 problem, never a 500.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: jwt access tokens`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** opaque refresh tokens, stored hashed, rotated atomically, with reuse detection.

**Files:** `src/modules/auth/refresh-tokens.ts`

**`src/modules/auth/refresh-tokens.ts`** · new file

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

const tokenKey = (hash: string) => `auth:rt:${hash}`;
const familyKey = (familyId: string) => `auth:family:${familyId}`;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

// Runs atomically inside Redis, so two concurrent refreshes with the same token can't both win.
// KEYS[1] = auth:rt:<old hash>   ARGV[1] = new hash   ARGV[2] = ttl seconds
const ROTATE_SCRIPT = `
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
`;
```

**`src/modules/auth/refresh-tokens.ts`** · continue

```ts
export type RotateResult = { status: 'ok'; userId: string; token: string } | { status: 'invalid' };

export class RefreshTokens {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  /** Starts a new token family (one per login). */
  async issue(userId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const hash = sha256(token);
    const familyId = uuidv7();
    await this.redis
      .multi()
      .hset(tokenKey(hash), { userId, familyId, status: 'active' })
      .expire(tokenKey(hash), this.ttlSeconds)
      .sadd(familyKey(familyId), hash)
      .expire(familyKey(familyId), this.ttlSeconds)
      .exec();
    return token;
  }

  async rotate(token: string): Promise<RotateResult> {
    const next = randomBytes(32).toString('base64url');
    const result = (await this.redis.eval(
      ROTATE_SCRIPT,
      1,
      tokenKey(sha256(token)),
      sha256(next),
      this.ttlSeconds,
    )) as [string, string?];
    const [status, userId] = result;
    if (status === 'ok' && userId !== undefined) return { status: 'ok', userId, token: next };
    return { status: 'invalid' };
  }

  async revokeFamily(token: string): Promise<void> {
    const familyId = await this.redis.hget(tokenKey(sha256(token)), 'familyId');
    if (familyId === null) return;
    const hashes = await this.redis.smembers(familyKey(familyId));
    await this.redis.del(familyKey(familyId), ...hashes.map(tokenKey));
  }
}
```

**What's new**
- **`redis.eval(script, numKeys, ...keys, ...args)`** runs a Lua script **inside** Redis. Redis is single-threaded, so the whole script is atomic: no other command runs between its `HGETALL` and its `HSET`.
- `redis.multi()…exec()` queues several commands and sends them as one transaction (MULTI/EXEC), which also saves round trips.
- `RotateResult` is a **discriminated union**: after `if (result.status !== 'ok')`, TypeScript knows `result.userId` exists.

> **🧠 DSA & scalability · refresh-token rotation**
> - **Data structures (Redis):** a **hash** per token, `auth:rt:{sha256}` → `{userId, familyId, status}`, and a **set** per family, `auth:family:{id}` → token hashes. Both carry a TTL, so Redis deletes expired sessions by itself.
> - **Algorithm (rotate):** look up the presented token's hash. Missing → 401. Status `rotated` → it was **already used once**, so either it was stolen or a request was replayed: delete every token in the family (`SMEMBERS` + `DEL`) → 401. Otherwise mark it `rotated`, create the next token in the same family, and return it.
> - **Complexity:** rotate is O(1). Revoking a family is O(k) for k tokens in it (k grows by one per refresh, and the TTL bounds it).
> - **Why atomic:** two tabs refreshing with the same token at the same moment would both pass a "check, then update" done in two round trips. The Lua script makes the check-and-mark one indivisible step, so exactly one wins.
> - **Why hash the token:** a Redis dump or a log leak reveals only SHA-256 hashes. They can't be used, and SHA-256 is fine here (unlike for passwords) because the token is 256 random bits, not a guessable word.
> - **Rejected:** storing refresh tokens as JWTs (they can't be revoked without a denylist anyway); storing them in Postgres (works, but every refresh would be a DB write); not rotating (a stolen token stays valid for 7 days).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: rotating refresh tokens with reuse detection`

### Step 4.4 · Users repository and DTOs

**Goal:** the user queries the auth service needs, and the mapping from a database row to the JSON shape.

**Files:** `src/modules/users/users.repository.ts`, `src/modules/users/users.dto.ts`

**`src/modules/users/users.repository.ts`** · new file

```ts
import type { Db } from '../../infra/db.js';

export const userSummarySelect = { id: true, email: true, displayName: true } as const;

export class UsersRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.user.findUnique({ where: { id } });
  }

  findByEmail(email: string) {
    return this.db.user.findUnique({ where: { email } });
  }

  findSummaries(ids: string[]) {
    return this.db.user.findMany({ where: { id: { in: ids } }, select: userSummarySelect });
  }

  create(data: { email: string; passwordHash: string; displayName: string }) {
    return this.db.user.create({ data });
  }

  update(id: string, data: { displayName?: string }) {
    return this.db.user.update({ where: { id }, data });
  }
}
```

**`src/modules/users/users.dto.ts`** · new file

```ts
export interface UserSummaryDto {
  id: string;
  email: string;
  displayName: string;
}

export interface UserDto extends UserSummaryDto {
  createdAt: string;
}

export const toUserSummary = (u: UserSummaryDto): UserSummaryDto => ({
  id: u.id,
  email: u.email,
  displayName: u.displayName,
});

export const toUser = (u: UserSummaryDto & { createdAt: Date }): UserDto => ({
  ...toUserSummary(u),
  createdAt: u.createdAt.toISOString(),
});
```

**What's new**
- **Repositories vs. Prisma Client.** Prisma Client already *is* a typed data-access layer (`prisma.user.findUnique`). We add a repository class only where queries are **shared** between services (users, the activity log). Otherwise services call Prisma directly, and `COMPARISON.md` discusses this choice against Spring Data's interfaces and Django's managers.
- `userSummarySelect` is a `select` object reused wherever a `UserSummary` is embedded. Prisma narrows the result type to exactly those three fields.
- DTO functions (`toUser`) decide what goes on the wire: `passwordHash` can never leak, because the mapper doesn't copy it, and `Date` becomes an ISO string.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: users repository and dtos`

### Step 4.5 · Auth service and the authentication middleware

**Goal:** Register, log in, refresh and log out at the service level, and authenticate requests from the Bearer token.

**Files:** `src/modules/auth/auth.service.ts`, `src/http/auth.ts`

**`src/modules/auth/auth.service.ts`** · new file

```ts
import { conflict, unauthorized } from '../../lib/problem.js';
import { toUser, type UserDto } from '../users/users.dto.js';
import type { UsersRepository } from '../users/users.repository.js';
import type { AccessToken, AccessTokens } from './access-tokens.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import type { RefreshTokens } from './refresh-tokens.js';

export interface Session {
  body: AccessToken & { user: UserDto };
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly accessTokens: AccessTokens,
    private readonly refreshTokens: RefreshTokens,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<Session> {
    if (await this.users.findByEmail(input.email)) throw conflict('Email is already registered');
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    return this.startSession(user);
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findByEmail(email);
    const ok = user
      ? await verifyPassword(user.passwordHash, password)
      : await verifyAgainstDummy(password);
    if (!user || !ok) throw unauthorized('Invalid email or password');
    return this.startSession(user);
  }
```

**`src/modules/auth/auth.service.ts`** · continue

```ts
  async refresh(token: string | undefined): Promise<{ body: AccessToken; refreshToken: string }> {
    if (!token) throw unauthorized('Missing refresh token');
    const result = await this.refreshTokens.rotate(token);
    if (result.status !== 'ok') throw unauthorized('Invalid refresh token');
    return { body: this.accessTokens.issue(result.userId), refreshToken: result.token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.refreshTokens.revokeFamily(token);
  }

  private async startSession(
    user: Parameters<typeof toUser>[0] & { id: string },
  ): Promise<Session> {
    return {
      body: { ...this.accessTokens.issue(user.id), user: toUser(user) },
      refreshToken: await this.refreshTokens.issue(user.id),
    };
  }
}
```

**`src/http/auth.ts`** · new file

```ts
import type { Request, RequestHandler } from 'express';
import { unauthorized } from '../lib/problem.js';
import type { AccessTokens } from '../modules/auth/access-tokens.js';

export function authenticate(tokens: AccessTokens): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) {
      req.auth = { userId: tokens.verify(header.slice('Bearer '.length)) };
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  next(req.auth ? undefined : unauthorized());
};

/** The authenticated user's id. Only call behind `requireAuth`. */
export function userIdOf(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}
```

**What's new**
- **The service knows nothing about HTTP.** It returns the response body and the refresh token, and the route decides how to put the token in a cookie. The same service could sit behind a CLI or a WebSocket.
- `authenticate` sets `req.auth` when a valid Bearer token is present and throws 401 for an invalid one. `requireAuth` then rejects requests with no token. Splitting them lets the rate limiter (next step) run *between* them and key on the user ID.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: auth service and authentication middleware`

### Step 4.6 · Sliding-window rate limiting

**Goal:** README §13's limits: 10/min per IP on `/auth/*`, 300/min per user elsewhere, enforced across all instances.

**Files:** `src/http/rate-limit.ts`

**`src/http/rate-limit.ts`** · new file

```ts
import type { RequestHandler } from 'express';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import { ProblemError } from '../lib/problem.js';

// Sliding-window log. KEYS[1] = bucket key. ARGV = now(ms), window(ms), limit, unique member.
// Returns {1, 0} when allowed, {0, oldestTimestamp} when the window is full.
const SLIDING_WINDOW = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', tonumber(ARGV[1]) - tonumber(ARGV[2]))
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {0, tonumber(oldest[2])}
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {1, 0}
`;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class SlidingWindowLimiter {
  constructor(
    private readonly redis: Redis,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}
```

**`src/http/rate-limit.ts`** · continue

```ts
  async hit(key: string, now = Date.now()): Promise<RateLimitResult> {
    const [allowed, oldest] = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      key,
      now,
      this.windowMs,
      this.limit,
      uuidv7(),
    )) as [number, number];
    if (allowed === 1) return { allowed: true, retryAfterSeconds: 0 };
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
    };
  }
}
```

**`src/http/rate-limit.ts`** · continue

```ts

export function rateLimit(options: {
  limiter: SlidingWindowLimiter;
  bucket: string;
  logger: Logger;
  byUser: boolean;
}): RequestHandler {
  return async (req, res, next) => {
    const subject =
      options.byUser && req.auth ? `user:${req.auth.userId}` : `ip:${req.ip ?? 'unknown'}`;
    let result: RateLimitResult;
    try {
      result = await options.limiter.hit(`ratelimit:${options.bucket}:${subject}`);
    } catch (err) {
      options.logger.warn({ err }, 'rate limiter unavailable; failing open');
      next();
      return;
    }
    if (result.allowed) {
      next();
      return;
    }
    res.setHeader('Retry-After', String(result.retryAfterSeconds));
    next(new ProblemError('rate-limited', `Retry in ${result.retryAfterSeconds} seconds`));
  };
}
```

**What's new**
- `rateLimit({...})` is a **middleware factory**: a function that returns a `RequestHandler`, closing over its options. Express middleware is "just a function", so configuration is done with closures.
- **Fail open:** if Redis is down we log and let the request through. Being unable to rate-limit for a minute is better than turning a Redis blip into a full outage. (The opposite choice, failing closed, is right for things like auth checks.)

> **🧠 DSA & scalability · sliding-window log**
> - **Data structure:** a Redis **sorted set** per (bucket, subject): member = a unique request ID, score = timestamp in ms.
> - **Algorithm (one Lua call):** `ZREMRANGEBYSCORE` drops entries older than the window → `ZCARD` counts what's left → if count ≥ limit, read the oldest score to compute `Retry-After` → otherwise `ZADD` this request and `PEXPIRE` the key.
> - **Complexity:** O(log n) per request for n requests in the window. Memory O(limit) per subject, because the set never holds more than `limit` entries.
> - **Why it scales:** the counter lives in Redis, not in process memory, so 1 or 20 API instances share one limit per user. Atomicity comes from the Lua script.
> - **Rejected:** a fixed-window counter (`INCR` + `EXPIRE`) is O(1) but allows 2× the limit across a window boundary (10 at 0:59 and 10 at 1:01). A token bucket is cheaper and great for bursty traffic, and Pulse (App 2) uses one. An in-memory limiter breaks as soon as you run two instances.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: redis sliding-window rate limiter`

### Step 4.7 · Routes, and wiring it all up

**Goal:** Expose the auth and `/users/me` endpoints, and put every later route behind the authentication gate and rate limiter.

**Files:** `src/lib/validation.ts`, `src/modules/auth/auth.routes.ts`, `src/modules/users/users.routes.ts`, `src/container.ts`, `src/app.ts`

First, three more validation helpers:

**`src/lib/validation.ts`** · add after `parse(schema, req.params, 'path');`

```ts

/** For PATCH bodies: zod omits absent optional keys, so an empty object means nothing to change. */
export const atLeastOneField = [
  (b: object) => Object.keys(b).length > 0,
  'at least one field is required',
] as const;

/** RFC 5322, matching JSON Schema's `format: email`; stored lowercase. */
export const Email = z
  .email({ pattern: z.regexes.rfc5322Email })
  .max(254)
  .transform((e) => e.toLowerCase());

export const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max);
```

**`src/modules/auth/auth.routes.ts`** · new file

```ts
import { Router, type CookieOptions, type RequestHandler } from 'express';
import { z } from 'zod';
import { methodNotAllowed } from '../../http/middleware.js';
import { Email, parseBody, trimmed } from '../../lib/validation.js';
import type { AuthService } from './auth.service.js';

const COOKIE = 'refresh_token';

const RegisterBody = z.object({
  email: Email,
  password: z.string().min(8).max(128),
  displayName: trimmed(1, 80),
});

const LoginBody = z.object({
  email: Email,
  password: z.string().min(1).max(128),
});

export function authRoutes(
  auth: AuthService,
  opts: { secureCookie: boolean; refreshTtlSeconds: number; authRateLimit: RequestHandler },
): Router {
  const cookieOptions: CookieOptions = {
    httpOnly: true,
    secure: opts.secureCookie,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
  const withMaxAge = { ...cookieOptions, maxAge: opts.refreshTtlSeconds * 1000 };
  const router = Router();
```

**`src/modules/auth/auth.routes.ts`** · continue

```ts
  router
    .route('/auth/register')
    .post(opts.authRateLimit, async (req, res) => {
      const session = await auth.register(parseBody(RegisterBody, req));
      res.cookie(COOKIE, session.refreshToken, withMaxAge);
      res.status(201).json(session.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/login')
    .post(opts.authRateLimit, async (req, res) => {
      const { email, password } = parseBody(LoginBody, req);
      const session = await auth.login(email, password);
      res.cookie(COOKIE, session.refreshToken, withMaxAge);
      res.json(session.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/refresh')
    .post(opts.authRateLimit, async (req, res) => {
      const result = await auth.refresh(cookieOf(req.cookies));
      res.cookie(COOKIE, result.refreshToken, withMaxAge);
      res.json(result.body);
    })
    .all(methodNotAllowed);

  router
    .route('/auth/logout')
    .post(async (req, res) => {
      await auth.logout(cookieOf(req.cookies));
      res.clearCookie(COOKIE, cookieOptions);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  return router;
}

function cookieOf(cookies: unknown): string | undefined {
  if (typeof cookies !== 'object' || cookies === null) return undefined;
  const value: unknown = (cookies as Record<string, unknown>)[COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
```

**`src/modules/users/users.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { notFound } from '../../lib/problem.js';
import { atLeastOneField, parseBody, trimmed } from '../../lib/validation.js';
import { toUser } from './users.dto.js';
import type { UsersRepository } from './users.repository.js';

const UpdateUserBody = z
  .object({ displayName: trimmed(1, 80).optional() })
  .refine(...atLeastOneField);

export function usersRoutes(users: UsersRepository): Router {
  const router = Router();

  router
    .route('/users/me')
    .get(async (req, res) => {
      const user = await users.findById(userIdOf(req));
      if (!user) throw notFound('User');
      res.json(toUser(user));
    })
    .patch(async (req, res) => {
      const body = parseBody(UpdateUserBody, req);
      res.json(toUser(await users.update(userIdOf(req), body)));
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- `res.cookie(name, value, options)` writes `Set-Cookie`. `httpOnly` hides it from JavaScript (so XSS can't steal it), `secure` restricts it to HTTPS (browsers treat `localhost` as secure), `sameSite: 'lax'` stops it from being sent on cross-site POSTs (CSRF), and `path: '/api/v1/auth'` means it's sent **only** to the auth endpoints, never to the rest of the API.
- `req.cookies` exists because of `cookie-parser` (mounted in Step 3.6). Its type is loose, so `cookieOf` narrows it safely.
- `.refine(...atLeastOneField)` spreads a `[predicate, message]` tuple into zod's `refine(fn, message)`: one definition reused by every PATCH body.
- The `Email` schema uses zod's **RFC 5322** pattern rather than its stricter default, because the contract says `format: email`, and the contract test generates odd-but-valid addresses like `+n99'*l8@false.info`.

Now wire them up. In `src/container.ts`:

**`src/container.ts`** · add after `import { createRedis } from './infra/redis.js';`

```ts
import { AccessTokens } from './modules/auth/access-tokens.js';
import { AuthService } from './modules/auth/auth.service.js';
import { RefreshTokens } from './modules/auth/refresh-tokens.js';
import { UsersRepository } from './modules/users/users.repository.js';
```

**`src/container.ts`** · add after `export function createServices(infra: Infra) {`

```ts
  const { config, prisma, redis } = infra;
  const users = new UsersRepository(prisma);
  const accessTokens = new AccessTokens(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SECONDS);
```

**`src/container.ts`** · add after `return {`

```ts
    users,
    accessTokens,
    auth: new AuthService(
      users,
      accessTokens,
      new RefreshTokens(redis, config.REFRESH_TOKEN_TTL_SECONDS),
    ),
```

In `src/app.ts`, the imports:

**`src/app.ts`** · add after `import type { Infra, Services } from './container.js';`

```ts
import { authenticate, requireAuth } from './http/auth.js';
```

**`src/app.ts`** · add after `} from './http/middleware.js';`

```ts
import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';
```

**`src/app.ts`** · add after `import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';`

```ts
import { authRoutes } from './modules/auth/auth.routes.js';
```

**`src/app.ts`** · add after `import { healthRoutes } from './modules/health/health.routes.js';`

```ts
import { usersRoutes } from './modules/users/users.routes.js';
```

**`src/app.ts`** · add before `export function createApp(infra: Infra, services: Services): Express {` (with a blank line on each side)

```ts
const MINUTE = 60_000;
```

the two rate limiters, after the `/docs` block:

**`src/app.ts`** · add after the `/docs` block (after its closing `}` and a blank line)

```ts
  const authLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_AUTH_PER_MINUTE, MINUTE),
    bucket: 'auth',
    logger,
    byUser: false,
  });
  const apiLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_API_PER_MINUTE, MINUTE),
    bucket: 'api',
    logger,
    byUser: true,
  });
```

and the auth routes plus the **authentication gate**, after the body parsers:

**`src/app.ts`** · add after `api.use(requireJsonBody, express.json({ limit: '1mb' }), cookieParser());`

```ts
  api.use(
    authRoutes(services.auth, {
      secureCookie: config.COOKIE_SECURE,
      refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
      authRateLimit: authLimit,
    }),
  );

  // Everything below requires a valid access token.
  api.use(authenticate(services.accessTokens), apiLimit, requireAuth);
  api.use(usersRoutes(services.users));
```

**What's new**
- **Order is security here.** Everything mounted on `api` *after* `api.use(authenticate(...), apiLimit, requireAuth)` requires a token. The auth routes are mounted *before* the gate, because you can't log in with a token you don't have yet.
- One unauthenticated side effect: an unknown path under `/api/v1/` now gets **401**, not 404, because the gate runs before route matching. That's deliberate: anonymous callers can't probe which endpoints exist.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: auth and users routes behind the auth gate`

### Step 4.8 · Auth tests

**Goal:** Prove the auth flow end to end, including refresh-token reuse detection and the rate limit.

**Files:** `tests/helpers.ts`, `tests/integration/auth.test.ts`

**`tests/helpers.ts`** · continue

```ts

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

let counter = 0;

export async function registerUser(ctx: TestContext, name = 'User'): Promise<TestUser> {
  counter++;
  const email = `${name.toLowerCase().replace(/\W/g, '')}${counter}@example.com`;
  const res = await ctx.request
    .post('/api/v1/auth/register')
    .send({ email, password: 'correct-horse-battery', displayName: name })
    .expect(201);
  const body = res.body as { accessToken: string; user: { id: string } };
  return {
    id: body.user.id,
    email,
    token: body.accessToken,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}
```

**`tests/integration/auth.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerUser, resetState } from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

const refreshCookieOf = (setCookie: string[] | string | undefined) => {
  const header = [setCookie ?? []].flat().find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('no refresh cookie');
  return header;
};

describe('auth', () => {
  it('registers, sets a hardened refresh cookie, and returns the session', async () => {
    const res = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'Ada@Example.com', password: 'correct-horse', displayName: '  Ada  ' })
      .expect(201);
    expect(res.body).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ada@example.com', displayName: 'Ada' },
    });
    const cookie = refreshCookieOf(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects a duplicate email with 409', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: user.email.toUpperCase(), password: 'another-pass', displayName: 'Ada' })
      .expect(409);
  });
```

**`tests/integration/auth.test.ts`** · continue

```ts
  it('returns 422 with camelCase field errors', async () => {
    const res = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', displayName: '' })
      .expect(422)
      .expect('Content-Type', /application\/problem\+json/);
    const fields = (res.body as { errors: { field: string }[] }).errors.map((e) => e.field).sort();
```

**`tests/integration/auth.test.ts`** · continue

```ts
    expect(fields).toEqual(['displayName', 'email', 'password']);
  });

  it('returns 400 for malformed JSON, 415 for non-JSON bodies, 405 for other methods', async () => {
    await ctx.request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    await ctx.request
      .post('/api/v1/auth/login')
      .set('Content-Type', 'text/plain')
      .send('hello')
      .expect(415);
    const res = await ctx.request.put('/api/v1/auth/login').send({}).expect(405);
    expect(res.headers.allow).toBe('POST');
  });

  it('logs in, and gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'correct-horse-battery' })
      .expect(200);
    const wrong = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'nope' })
      .expect(401);
    const unknown = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope' })
      .expect(401);
    expect((wrong.body as { detail: string }).detail).toBe(
      (unknown.body as { detail: string }).detail,
    );
  });
```

**`tests/integration/auth.test.ts`** · continue

```ts
  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const register = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'rot@example.com', password: 'correct-horse', displayName: 'Rot' })
      .expect(201);
    const first = refreshCookieOf(register.headers['set-cookie']).split(';')[0] ?? '';

    const refreshed = await ctx.request
      .post('/api/v1/auth/refresh')
      .set('Cookie', first)
      .expect(200);
    expect(refreshed.body).toMatchObject({ tokenType: 'Bearer' });
    const second = refreshCookieOf(refreshed.headers['set-cookie']).split(';')[0] ?? '';
    expect(second).not.toBe(first);

    // Replaying the rotated token looks like theft: everything in the family dies.
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', first).expect(401);
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', second).expect(401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const register = await ctx.request
      .post('/api/v1/auth/register')
      .send({ email: 'out@example.com', password: 'correct-horse', displayName: 'Out' })
      .expect(201);
    const cookie = refreshCookieOf(register.headers['set-cookie']).split(';')[0] ?? '';
    const res = await ctx.request.post('/api/v1/auth/logout').set('Cookie', cookie).expect(204);
    expect(refreshCookieOf(res.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
```

**`tests/integration/auth.test.ts`** · continue

```ts
    await ctx.request.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('protects /users/me and lets the user rename themselves', async () => {
    await ctx.request.get('/api/v1/users/me').expect(401);
    await ctx.request.get('/api/v1/users/me').set('Authorization', 'Bearer junk').expect(401);
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .patch('/api/v1/users/me')
      .set(user.auth)
      .send({ displayName: 'Ada L.' })
      .expect(200);
    const me = await ctx.request.get('/api/v1/users/me').set(user.auth).expect(200);
    expect(me.body).toMatchObject({ id: user.id, displayName: 'Ada L.' });
    await ctx.request.patch('/api/v1/users/me').set(user.auth).send({}).expect(422);
  });

  it('allows 10 auth requests per minute per IP, then 429 with Retry-After', async () => {
    const attempt = () =>
      ctx.request.post('/api/v1/auth/login').send({ email: 'nobody@example.com', password: 'x' });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.body).toMatchObject({ type: 'https://taskflow.example/problems/rate-limited' });
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/integration/auth.test.ts
```

Expected: `Tests  9 passed (9)`. Then try it by hand (`npm run dev` running):

```bash
curl -si localhost:8001/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}' | grep -iE '^HTTP|set-cookie'
```

Expected: `HTTP/1.1 201 Created` and `Set-Cookie: refresh_token=…; Max-Age=604800; Path=/api/v1/auth; …; HttpOnly; Secure; SameSite=Lax`.

**Commit:** `feat: auth with argon2id, JWT access tokens, rotating refresh tokens, rate limiting`

---

### Step 4.9 · Seed the default user

**Goal:** one command that creates the login every TaskFlow backend shares for local development, **`ashutosh@test.com` / `Ashutosh#1234`**, so the frontend has an account ready on a fresh database.

**Files:** `src/modules/users/default-user.ts`, `src/seed.ts`, `tests/integration/seed.test.ts`

**`src/modules/users/default-user.ts`** · new file

```ts
import { hashPassword } from '../auth/passwords.js';
import type { UsersRepository } from './users.repository.js';

/**
 * The account every TaskFlow backend seeds for local development, so the frontend has a
 * login ready. Its password is public: `src/seed.ts` refuses to run in production.
 */
export const DEFAULT_USER = {
  email: 'ashutosh@test.com',
  password: 'Ashutosh#1234',
  displayName: 'Ashutosh',
} as const;

/** Creates the default user unless the email is already registered. Safe to run repeatedly. */
export async function seedDefaultUser(users: UsersRepository): Promise<'created' | 'exists'> {
  if (await users.findByEmail(DEFAULT_USER.email)) return 'exists';
  await users.create({
    email: DEFAULT_USER.email,
    displayName: DEFAULT_USER.displayName,
    passwordHash: await hashPassword(DEFAULT_USER.password),
  });
  return 'created';
}
```

**What's new**
- **Seed through the app's own code.** The function hashes with `hashPassword` (argon2id, Step 4.1) and writes through `UsersRepository`, so a seeded user is indistinguishable from one who signed up. Inserting a row with raw SQL would need a hash computed somewhere else.
- **Idempotent:** if the email exists it does nothing and says `exists`. You can run it after every `docker compose down -v`, or twice by accident.
- `as const` makes every field a readonly literal type, so the credentials can't be reassigned by mistake.

**`src/seed.ts`** · new file

```ts
import { loadConfig } from './config.js';
import { createPrisma } from './infra/db.js';
import { DEFAULT_USER, seedDefaultUser } from './modules/users/default-user.js';
import { UsersRepository } from './modules/users/users.repository.js';

/** `npm run db:seed`: creates the default development user (idempotent). */
const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const prisma = createPrisma(config.DATABASE_URL);
const result = await seedDefaultUser(new UsersRepository(prisma));
await prisma.$disconnect();
console.log(`default user ${DEFAULT_USER.email}: ${result}`);
```

```bash
npm pkg set scripts.db:seed="tsx src/seed.ts"
```

**What's new**
- A small program: load the validated config, open a Prisma client, seed, disconnect so the process can exit. Top-level `await` works because this is an ES module.
- **It refuses to run in production**: the password is in this repo, so a seeded production database would have an account anyone can log into. (`vitest.config.ts` already lists `src/seed.ts` among the entry scripts excluded from coverage.)

**`tests/integration/seed.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER, seedDefaultUser } from '../../src/modules/users/default-user.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestContext, resetState } from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('default user seed', () => {
  it('creates the user once, and the user can log in', async () => {
    const users = new UsersRepository(ctx.infra.prisma);
    expect(await seedDefaultUser(users)).toBe('created');
    expect(await seedDefaultUser(users)).toBe('exists');
    const res = await ctx.request
      .post('/api/v1/auth/login')
      .send({ email: DEFAULT_USER.email, password: DEFAULT_USER.password })
      .expect(200);
    expect(res.body).toMatchObject({
      user: { email: DEFAULT_USER.email, displayName: 'Ashutosh' },
    });
  });
});
```

**✅ Checkpoint**

```bash
npm run db:seed && npm run db:seed
npm run typecheck && npx vitest run tests/integration/seed.test.ts
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then `Tests  1 passed (1)`. Now `npm run dev` and log in from the frontend (or `curl`) with `ashutosh@test.com` / `Ashutosh#1234`.

**Commit:** `feat: seed the default development user`

---

## Part 5 · Workspaces & RBAC

Workspaces are the tenants: every other resource lives inside one. This part adds roles (README §5), the authorization check every later endpoint reuses, the append-only activity log, cursor pagination, and the first background job (the invitation email, sent in Part 11).

### Step 5.1 · Roles and the access check

**Goal:** one place that answers "may this user do this in this workspace?", returning 404 for outsiders and 403 for insufficient roles.

**Files:** `src/modules/workspaces/roles.ts`, `src/modules/workspaces/access.ts`

**`src/modules/workspaces/roles.ts`** · new file

```ts
import { z } from 'zod';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);
export const InvitableRoleSchema = z.enum(['admin', 'member', 'viewer']);

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function asRole(value: string): Role {
  return RoleSchema.parse(value);
}

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
```

**`src/modules/workspaces/access.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { asRole, atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
export class Access {
  constructor(private readonly db: PrismaClient) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw notFound(what);
    const role = asRole(membership.role);
    if (!atLeast(role, minimum)) throw forbidden();
    return { ...membership, role };
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.db.project.findUnique({ where: { id: projectId } });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.db.boardColumn.findUnique({
      where: { id: columnId },
      include: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }
```

**`src/modules/workspaces/access.ts`** · continue

```ts
  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.db.task.findUnique({
      where: { id: taskId },
      include: { project: true },
    });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.db.comment.findUnique({
      where: { id: commentId },
      include: { task: { include: { project: true } } },
    });
    if (!comment) throw notFound('Comment');
    const membership = await this.member(
      comment.task.project.workspaceId,
      userId,
      'viewer',
      'Comment',
    );
    return { comment, project: comment.task.project, membership };
  }

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.db.attachment.findUnique({
      where: { id: attachmentId },
      include: { task: { include: { project: true } } },
    });
    if (!attachment) throw notFound('Attachment');
    const membership = await this.member(
      attachment.task.project.workspaceId,
      userId,
      'viewer',
      'Attachment',
    );
    return { attachment, project: attachment.task.project, membership };
  }
}
```

**What's new**
- `ROLES = [...] as const` + `(typeof ROLES)[number]` derives the union type `'owner' | 'admin' | 'member' | 'viewer'` from a runtime array. That gives you a type *and* a value to validate against (`z.enum(ROLES)`).
- `findUnique({ where: { workspaceId_userId: { … } } })`: Prisma names a compound unique key by joining its fields with `_`. It exists because of `@@unique([workspaceId, userId])` in the schema.
- Each method loads the resource **with its project** (`include: { project: true }`) in the same query, then checks membership in that project's workspace. Parts 6–9 call `access.task(taskId, userId, 'member')` and get back the task, its project and the caller's membership.

> **🧠 DSA & scalability · authorization check**
> - **Data structure:** the `UNIQUE (workspace_id, user_id)` B-tree index on `workspace_members`, plus a tiny in-code rank table (`owner: 3 … viewer: 0`).
> - **Algorithm:** one indexed lookup for the membership row, then an integer comparison `rank[role] >= rank[minimum]`.
> - **Complexity:** O(log n) for the index seek (n = all memberships), O(1) for the role check. Nested resources add one primary-key lookup.
> - **Why 404 for outsiders:** a 403 would confirm that the workspace/task ID exists. Returning the same 404 as a truly missing ID leaks nothing.
> - **Rejected:** putting roles in the JWT (a demoted admin would keep admin rights until their token expires, and one user has a different role in each workspace); a permissions table per action (flexible, but overkill for four fixed roles).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: roles and workspace access checks`

### Step 5.2 · The activity log and the job queue

**Goal:** the append-only audit log (written inside the same transaction as each change) and a typed facade over BullMQ.

**Files:** `src/modules/activity/activity.repository.ts`, `src/jobs/queue.ts`

```bash
npm i -E bullmq@6.5.1
npm deny-scripts msgpackr-extract
```

`msgpackr-extract` is an optional native speed-up that a BullMQ dependency tries to compile. It has a pure-JavaScript fallback, so we skip the compile.

**`src/modules/activity/activity.repository.ts`** · new file

```ts
import type { Prisma } from '../../generated/prisma/client.js';
import type { Db } from '../../infra/db.js';
import { userSummarySelect } from '../users/users.repository.js';

export type ActivityType =
  | 'workspace.created'
  | 'workspace.updated'
  | 'member.joined'
  | 'member.role_changed'
  | 'member.removed'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.moved'
  | 'column.deleted'
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'comment.created'
  | 'comment.updated'
  | 'comment.deleted'
  | 'attachment.added'
  | 'attachment.deleted';

export interface ActivityInput {
  workspaceId: string;
  actorId: string;
  type: ActivityType;
  projectId?: string | null;
  taskId?: string | null;
  data?: Prisma.InputJsonObject;
}
```

**`src/modules/activity/activity.repository.ts`** · continue

```ts
/** Append-only: there is deliberately no update or delete method. */
export class ActivityRepository {
  /** Takes `db` per call so it can join the caller's transaction. */
  record(db: Db, event: ActivityInput) {
    return db.activityEvent.create({
      data: {
        workspaceId: event.workspaceId,
        actorId: event.actorId,
        type: event.type,
        projectId: event.projectId ?? null,
        taskId: event.taskId ?? null,
        data: event.data ?? {},
      },
    });
  }

  list(
    db: Db,
    filter: { workspaceId: string; projectId?: string | undefined; taskId?: string | undefined },
    page: { limit: number; afterId?: string | undefined },
  ) {
    return db.activityEvent.findMany({
      where: {
        workspaceId: filter.workspaceId,
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.taskId ? { taskId: filter.taskId } : {}),
        ...(page.afterId ? { id: { lt: page.afterId } } : {}),
      },
      orderBy: { id: 'desc' },
      take: page.limit + 1,
      include: { actor: { select: userSummarySelect } },
    });
  }
}
```

**`src/jobs/queue.ts`** · new file

```ts
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAME = 'taskflow';

export interface JobData {
  'send-invitation-email': {
    email: string;
    workspaceName: string;
    inviterName: string;
    token: string;
  };
  'send-due-reminder': { taskId: string };
  'delete-storage-prefix': { prefix: string };
  'scan-due-reminders': Record<string, never>;
  'cleanup-stale-uploads': Record<string, never>;
}

export type JobName = keyof JobData;

export const RETRY: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000, jitter: 0.5 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export function createQueue(connection: Redis): Queue {
  return new Queue(QUEUE_NAME, { connection, defaultJobOptions: RETRY });
}

/** The typed facade services use; they never touch BullMQ directly. */
export class Jobs {
  constructor(private readonly queue: Queue) {}

  async enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void> {
    await this.queue.add(name, data);
  }
}
```

**What's new**
- `record(db: Db, event)` takes the client **per call** instead of storing one in the constructor, so a service can pass its transaction `tx` and the event commits or rolls back together with the change it describes.
- `Prisma.InputJsonObject` is the type Prisma accepts for a `Json` column.
- `JobData` maps each job name to its payload type, and `enqueue<N extends JobName>(name: N, data: JobData[N])` makes the compiler check that `'delete-storage-prefix'` gets `{ prefix }` and nothing else. This is the same "map type + generic key" trick as `ProblemSlug`.
- **`RETRY`**: 5 attempts with **exponential backoff and jitter** (2 s, 4 s, 8 s… each ±50%). Jitter stops a thousand failed jobs from retrying at exactly the same instant (the "thundering herd").


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: activity log repository and typed job queue`

### Step 5.3 · Cursor pagination

**Goal:** README §8's opaque keyset cursors, shared by every list endpoint.

**Files:** `src/lib/cursor.ts`, `src/lib/validation.ts`, `src/lib/prisma-errors.ts`

**`src/lib/cursor.ts`** · new file

```ts
import { z } from 'zod';
import { invalid } from './problem.js';

export const IdCursor = z.object({ id: z.guid() });
export const RankCursor = z.object({ rank: z.number(), id: z.guid() });

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends z.ZodType>(schema: T, cursor: string): z.infer<T> {
  try {
    const json: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return schema.parse(json);
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Callers fetch `limit + 1` rows. The extra row only tells us another page exists;
 * the cursor points at the last row we actually return.
 */
export function toPage<Row, Item>(
  rows: Row[],
  limit: number,
  toItem: (row: Row) => Item,
  cursorOf: (row: Row) => Record<string, unknown>,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
```

**`src/lib/validation.ts`** · add after `parse(schema, req.params, 'path');`

```ts

/** Any 8-4-4-4-12 hex string, matching JSON Schema's `format: uuid`. */
export const Id = z.guid();

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[A-Za-z0-9_-]+$/)
    .optional(),
});
```

**`src/lib/prisma-errors.ts`** · new file

```ts
import { Prisma } from '../generated/prisma/client.js';

export const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
```

**What's new**
- `Buffer.from(json).toString('base64url')` is URL-safe base64 without padding (`-` and `_` instead of `+` and `/`), so a cursor can sit in a query string unescaped.
- `toPage(rows, limit, toItem, cursorOf)` is generic in both the row type and the item type, so one function serves every list.
- `z.guid()` accepts any `8-4-4-4-12` hex string, exactly what JSON Schema's `format: uuid` means. `z.uuid()` is stricter (RFC 9562 version and variant bits), and the contract test would flag the difference.

> **🧠 DSA & scalability · keyset (cursor) pagination**
> - **Data structure:** composite B-tree indexes such as `(user_id, workspace_id)` and `(workspace_id, id)`. UUIDv7 IDs are **time-ordered**, so `ORDER BY id` is creation order.
> - **Algorithm:** `WHERE <scope> AND id < :cursorId ORDER BY id DESC LIMIT limit + 1`. The extra row only tells us whether another page exists, and the cursor encodes the last row actually returned.
> - **Complexity:** O(log n + k) per page: an index seek to the cursor, then k index entries in order. Page 1000 costs the same as page 1.
> - **Why not OFFSET:** `OFFSET 20000` makes Postgres walk and throw away 20,000 rows (O(n)), and rows inserted while you page shift every later page, so you see duplicates or skip items. A keyset cursor is stable under concurrent inserts.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: keyset cursor pagination helpers`

### Step 5.4 · Workspace service

**Goal:** create, read, list, update and delete workspaces. The creator becomes the owner in the same transaction.

**Files:** `src/modules/workspaces/workspaces.dto.ts`, `src/modules/workspaces/workspaces.service.ts`

**`src/modules/workspaces/workspaces.dto.ts`** · new file

```ts
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import type { Role } from './roles.js';

export interface WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  currentUserRole: Role;
  createdAt: string;
  updatedAt: string;
}

export const toWorkspace = (
  w: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date },
  role: Role,
): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

export const toMember = (m: { user: UserSummaryDto; role: Role; joinedAt: Date }) => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});
```

**`src/modules/workspaces/workspaces.dto.ts`** · continue

```ts
export const toInvitation = (i: {
  id: string;
  workspaceId: string;
  email: string;
  role: string;
  inviter: UserSummaryDto;
  expiresAt: Date;
  createdAt: Date;
}) => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  role: i.role,
  invitedBy: toUserSummary(i.inviter),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
```

**`src/modules/workspaces/workspaces.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { conflict } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from './access.js';
import { asRole } from './roles.js';
import { toWorkspace } from './workspaces.dto.js';

export class WorkspacesService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const rows = await this.db.workspaceMember.findMany({
      where: { userId, ...(after ? { workspaceId: { lt: after } } : {}) },
      orderBy: { workspaceId: 'desc' },
      take: limit + 1,
      include: { workspace: true },
    });
    return toPage(
      rows,
      limit,
      (m) => toWorkspace(m.workspace, asRole(m.role)),
      (m) => ({ id: m.workspaceId }),
    );
  }
```

**`src/modules/workspaces/workspaces.service.ts`** · continue

```ts
  async create(userId: string, input: { name: string; slug: string }) {
    try {
      const workspace = await this.db.$transaction(async (tx) => {
        const created = await tx.workspace.create({ data: { ...input, createdBy: userId } });
        await tx.workspaceMember.create({
          data: { workspaceId: created.id, userId, role: 'owner' },
        });
        await this.activity.record(tx, {
          workspaceId: created.id,
          actorId: userId,
          type: 'workspace.created',
          data: { name: created.name },
        });
        return created;
      });
      return toWorkspace(workspace, 'owner');
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }
```

**`src/modules/workspaces/workspaces.service.ts`** · continue

```ts
  async get(workspaceId: string, userId: string) {
    const membership = await this.access.member(workspaceId, userId);
    const workspace = await this.db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return toWorkspace(workspace, membership.role);
  }

  async update(workspaceId: string, userId: string, input: { name?: string; slug?: string }) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.db.$transaction(async (tx) => {
        const updated = await tx.workspace.update({ where: { id: workspaceId }, data: input });
        await this.activity.record(tx, {
          workspaceId,
          actorId: userId,
          type: 'workspace.updated',
          data: { ...input },
        });
        return updated;
      });
      return toWorkspace(workspace, membership.role);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('Slug is already taken');
      throw err;
    }
  }

  async delete(workspaceId: string, userId: string) {
    await this.access.member(workspaceId, userId, 'owner');
    const projects = await this.db.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    await this.db.workspace.delete({ where: { id: workspaceId } });
    for (const p of projects) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
```

**What's new**
- **Interactive transactions:** `prisma.$transaction(async (tx) => { … })` opens a transaction, passes you `tx`, and commits when the callback resolves (or rolls back if it throws). Every query inside must use `tx`, not `this.db`.
- **Unique violations become 409.** Prisma throws error code `P2002`. We let the database enforce uniqueness, catch the violation and translate it. Checking first with a `SELECT` would race: two requests could both see "free" and both insert.
- Listing reads `workspace_members` (not `workspaces`), because "my workspaces" is a property of the membership. The `(user_id, workspace_id)` index serves the filter **and** the order.
- Deleting a workspace cascades in the database (`ON DELETE CASCADE`). Its files in S3 don't, so we enqueue one storage-cleanup job per project (processed in Part 11).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: workspaces service`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** Change roles and remove members under the README §5 rules, without ever leaving a workspace ownerless.

**Files:** `src/modules/workspaces/members.service.ts`

**`src/modules/workspaces/members.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Db } from '../../infra/db.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from './access.js';
import { asRole, type Role } from './roles.js';
import { toMember } from './workspaces.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

export class MembersService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.workspaceMember.findMany({
      where: { workspaceId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      include: { user: { select: userSummarySelect } },
    });
    return toPage(
      rows,
      limit,
      (m) => toMember({ ...m, role: asRole(m.role) }),
      (m) => ({ id: m.id }),
    );
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts
  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.db.$transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const from = asRole(target.role);
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') await this.assertNotLastOwner(tx, workspaceId);
      const row = await tx.workspaceMember.update({
        where: { id: target.id },
        data: { role: newRole },
        include: { user: { select: userSummarySelect } },
      });
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return row;
    });
    return toMember({ ...updated, role: asRole(updated.role) });
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts
  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.db.$transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const targetRole = asRole(target.role);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(targetRole));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (targetRole === 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx.workspaceMember.delete({ where: { id: target.id } });
      await tx.task.updateMany({
        where: { assigneeId: targetUserId, project: { workspaceId } },
        data: { assigneeId: null },
      });
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.removed',
        data: { userId: targetUserId },
      });
    });
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts
  private async findTarget(tx: Db, workspaceId: string, userId: string) {
    const target = await tx.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first, so two owners demoting each other at the same
   * time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(tx: Db, workspaceId: string) {
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM workspace_members
      WHERE workspace_id = ${workspaceId}::uuid AND role = 'owner'
      FOR UPDATE`;
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
```

**What's new**
- `tx.$queryRaw\`…${workspaceId}::uuid…\`` is a **tagged template**: Prisma turns each `${}` into a bind parameter (`$1`), so this is safe from SQL injection. The `::uuid` cast is needed because parameters are sent as text.
- `updateMany` with a relation filter (`project: { workspaceId }`) unassigns the removed member's tasks across the workspace in one statement.

> **🧠 DSA & scalability · "a workspace always has an owner"**
> - **The race:** two owners demote each other at the same moment. Each transaction counts 2 owners, each passes the check, and both commit, leaving **zero** owners.
> - **Algorithm:** `SELECT … WHERE role = 'owner' FOR UPDATE` row-locks every owner row before counting. The second transaction blocks on those locks until the first commits, then re-reads and sees one owner, so it fails with 409.
> - **Complexity:** O(k) for k owners (tiny). Lock scope: only this workspace's owner rows, so other workspaces are never blocked.
> - **Rejected:** `SERIALIZABLE` isolation (correct, but makes the whole transaction retryable for one invariant); a `CHECK` constraint (it can't look at other rows); a trigger (hidden from the code you're learning).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: member role changes and removal with last-owner lock`

### Step 5.6 · Invitations

**Goal:** invite by email with a single-use token, and send the email from a background job.

**Files:** `src/modules/workspaces/invitations.service.ts`

**`src/modules/workspaces/invitations.service.ts`** · new file

```ts
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from './access.js';
import { asRole, type Role } from './roles.js';
import { toInvitation, toWorkspace } from './workspaces.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

export class InvitationsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.invitation.findMany({
      where: { workspaceId, acceptedAt: null, ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { inviter: { select: userSummarySelect } },
    });
    return toPage(rows, limit, toInvitation, (i) => ({ id: i.id }));
  }
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
  async create(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: Exclude<Role, 'owner'> },
  ) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    if (input.role === 'admin' && actor.role !== 'owner') {
      throw forbidden('Only owners can invite admins');
    }
    const alreadyMember = await this.db.workspaceMember.findFirst({
      where: { workspaceId, user: { email: input.email } },
    });
    if (alreadyMember) throw conflict('This person is already a member');

    const token = randomBytes(32).toString('base64url');
    let invitation;
    try {
      invitation = await this.db.$transaction(async (tx) => {
        await tx.invitation.deleteMany({
          where: {
            workspaceId,
            email: input.email,
            acceptedAt: null,
            expiresAt: { lte: new Date() },
          },
        });
        const created = await tx.invitation.create({
          data: {
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          },
          include: { inviter: { select: userSummarySelect }, workspace: true },
        });
        await this.activity.record(tx, {
          workspaceId,
          actorId,
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('This email already has a pending invitation');
      }
      throw err;
    }

    await this.jobs.enqueue('send-invitation-email', {
      email: invitation.email,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter.displayName,
      token,
    });
    return toInvitation(invitation);
  }
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
  async revoke(workspaceId: string, actorId: string, invitationId: string) {
    await this.access.member(workspaceId, actorId, 'admin');
    await this.db.$transaction(async (tx) => {
      const { count } = await tx.invitation.deleteMany({
        where: { id: invitationId, workspaceId, acceptedAt: null },
      });
      if (count === 0) throw notFound('Invitation');
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.db.invitation.findUnique({
      where: { tokenHash: sha256(token) },
      include: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.db.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
    const membership = await this.db.$transaction(async (tx) => {
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });
      const existing = await tx.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      });
      if (existing) return existing;
      const created = await tx.workspaceMember.create({
        data: { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      });
      await this.activity.record(tx, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        type: 'member.joined',
        data: { role: invitation.role },
      });
      return created;
    });
    return toWorkspace(invitation.workspace, asRole(membership.role));
  }
}
```

**What's new**
- The raw token exists only in memory and in the email job. The database keeps `sha256(token)`, so a database leak can't be turned into "accept any invitation".
- **The job is enqueued after the transaction commits.** Enqueueing inside it could email someone about an invitation that then rolled back. (The fully robust pattern, a *transactional outbox*, comes in Cartly.)
- The partial unique index `invitations_pending_email_uq` (Step 2.3) is what turns a duplicate pending invitation into P2002 → 409, while accepted invitations stay as history.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: email invitations with hashed tokens`

### Step 5.7 · Routes and wiring

**Goal:** Expose workspaces, members and invitations over HTTP and wire the new services into the container.

**Files:** `src/modules/workspaces/workspaces.routes.ts`, `src/container.ts`, `src/app.ts`

**`src/modules/workspaces/workspaces.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import {
  atLeastOneField,
  Email,
  Id,
  PageQuery,
  parseBody,
  parseParams,
  parseQuery,
  trimmed,
} from '../../lib/validation.js';
import type { InvitationsService } from './invitations.service.js';
import type { MembersService } from './members.service.js';
import { InvitableRoleSchema, RoleSchema } from './roles.js';
import type { WorkspacesService } from './workspaces.service.js';

const Slug = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase letters, digits and single hyphens only');

const CreateWorkspaceBody = z.object({ name: trimmed(1, 80), slug: Slug });
const UpdateWorkspaceBody = z
  .object({ name: trimmed(1, 80).optional(), slug: Slug.optional() })
  .refine(...atLeastOneField);

const WorkspaceParams = z.object({ workspaceId: Id });
const MemberParams = WorkspaceParams.extend({ userId: Id });
const InvitationParams = WorkspaceParams.extend({ invitationId: Id });

const UpdateMemberBody = z.object({ role: RoleSchema });
const CreateInvitationBody = z.object({ email: Email, role: InvitableRoleSchema });
const AcceptInvitationBody = z.object({ token: z.string().min(1).max(128) });
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts
export function workspacesRoutes(
  workspaces: WorkspacesService,
  members: MembersService,
  invitations: InvitationsService,
): Router {
  const router = Router();

  router
    .route('/workspaces')
    .get(async (req, res) => {
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await workspaces.list(userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const body = parseBody(CreateWorkspaceBody, req);
      res.status(201).json(await workspaces.create(userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      res.json(await workspaces.get(workspaceId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(UpdateWorkspaceBody, req);
      res.json(await workspaces.update(workspaceId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      await workspaces.delete(workspaceId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts
  router
    .route('/workspaces/:workspaceId/members')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await members.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/members/:userId')
    .patch(async (req, res) => {
      const { workspaceId, userId } = parseParams(MemberParams, req);
      const { role } = parseBody(UpdateMemberBody, req);
      res.json(await members.updateRole(workspaceId, userIdOf(req), userId, role));
    })
    .delete(async (req, res) => {
      const { workspaceId, userId } = parseParams(MemberParams, req);
      await members.remove(workspaceId, userIdOf(req), userId);
      res.status(204).end();
    })
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/invitations')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await invitations.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(CreateInvitationBody, req);
      res.status(201).json(await invitations.create(workspaceId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/workspaces/:workspaceId/invitations/:invitationId')
    .delete(async (req, res) => {
      const { workspaceId, invitationId } = parseParams(InvitationParams, req);
      await invitations.revoke(workspaceId, userIdOf(req), invitationId);
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/invitations/accept')
    .post(async (req, res) => {
      const { token } = parseBody(AcceptInvitationBody, req);
      res.json(await invitations.accept(userIdOf(req), token));
    })
    .all(methodNotAllowed);

  return router;
}
```

In `src/container.ts`, add the imports (the first one at the very top):

**`src/container.ts`** · add at the top

```ts
import type { Queue } from 'bullmq';
```

**`src/container.ts`** · add after `import { createRedis } from './infra/redis.js';`

```ts
import { createQueue, Jobs } from './jobs/queue.js';
import { ActivityRepository } from './modules/activity/activity.repository.js';
```

**`src/container.ts`** · add after `import { UsersRepository } from './modules/users/users.repository.js';`

```ts
import { Access } from './modules/workspaces/access.js';
import { InvitationsService } from './modules/workspaces/invitations.service.js';
import { MembersService } from './modules/workspaces/members.service.js';
import { WorkspacesService } from './modules/workspaces/workspaces.service.js';
```

the queue in `Infra`, `createInfra` and `closeInfra`:

**`src/container.ts`** · add after `redis: Redis;`

```ts
  queue: Queue;
```

**`src/container.ts`** · add after `redis,`

```ts
    queue: createQueue(redis),
```

**`src/container.ts`** · add after `export async function closeInfra(infra: Infra): Promise<void> {`

```ts
  await infra.queue.close();
```

and the services:

**`src/container.ts`** · add after `const users = new UsersRepository(prisma);`

```ts
  const activity = new ActivityRepository();
  const access = new Access(prisma);
  const jobs = new Jobs(infra.queue);
```

**`src/container.ts`** · add after `users,`

```ts
    access,
```

**`src/container.ts`** · add after `),`

```ts
    workspaces: new WorkspacesService(prisma, access, activity, jobs),
    members: new MembersService(prisma, access, activity),
    invitations: new InvitationsService(prisma, access, activity, jobs),
```

In `src/app.ts`:

**`src/app.ts`** · add after `import { usersRoutes } from './modules/users/users.routes.js';`

```ts
import { workspacesRoutes } from './modules/workspaces/workspaces.routes.js';
```

**`src/app.ts`** · add after `api.use(usersRoutes(services.users));`

```ts
  api.use(workspacesRoutes(services.workspaces, services.members, services.invitations));
```

**What's new**
- `WorkspaceParams.extend({ userId: Id })` builds a new schema from an existing one (like an `interface … extends`).
- One Redis connection is shared by the app and BullMQ's `Queue` here. The worker (Part 11) creates its own, because a BullMQ worker *blocks* its connection while waiting for jobs.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** Test pagination, RBAC (404 vs 403), the last-owner rule and the invitation flow.

**Files:** `tests/helpers.ts`, `tests/unit/cursor.test.ts`, `tests/integration/workspaces.test.ts`

**`tests/helpers.ts`** · continue

```ts

export interface WorkspaceFixture {
  owner: TestUser;
  workspaceId: string;
}

/** A fresh owner with their own workspace. */
export async function createWorkspace(ctx: TestContext): Promise<WorkspaceFixture> {
  const owner = await registerUser(ctx, 'Owner');
  const ws = await ctx.request
    .post('/api/v1/workspaces')
    .set(owner.auth)
    .send({ name: 'Acme', slug: `acme-${counter}` })
    .expect(201);
  return { owner, workspaceId: (ws.body as { id: string }).id };
}

/** Adds an existing user to a workspace with a role, bypassing invitations. */
export async function addMember(
  ctx: TestContext,
  workspaceId: string,
  user: TestUser,
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<void> {
  await ctx.infra.prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } });
}
```

**`tests/unit/cursor.test.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, IdCursor, RankCursor, toPage } from '../../src/lib/cursor.js';
import { ProblemError } from '../../src/lib/problem.js';

const ID = '01a18b7e-951f-71f4-affb-2b64a14174e2';

describe('cursors', () => {
  it('round-trips through base64url JSON', () => {
    const cursor = encodeCursor({ id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(IdCursor, cursor)).toEqual({ id: ID });
  });

  it('keeps float ranks exact', () => {
    const rank = 0.9910322;
    expect(decodeCursor(RankCursor, encodeCursor({ rank, id: ID })).rank).toBe(rank);
  });

  it.each(['not-base64-json', encodeCursor({ id: 'nope' }), encodeCursor({ other: 1 })])(
    'rejects %s with a 422 on query.cursor',
    (bad) => {
      const run = () => decodeCursor(IdCursor, bad);
      expect(run).toThrow(ProblemError);
      try {
        run();
      } catch (err) {
        expect((err as ProblemError).status).toBe(422);
        expect((err as ProblemError).errors?.[0]?.field).toBe('query.cursor');
      }
    },
  );
```

**`tests/unit/cursor.test.ts`** · continue

```ts
  it('returns a cursor only when an extra row exists', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const page = toPage(
      rows,
      2,
      (r) => r.id,
      (r) => ({ id: r.id }),
    );
    expect(page.items).toEqual(['a', 'b']);
    expect(Buffer.from(page.nextCursor ?? '', 'base64url').toString()).toBe('{"id":"b"}');
    expect(
      toPage(
        rows,
        3,
        (r) => r.id,
        (r) => ({ id: r.id }),
      ).nextCursor,
    ).toBeNull();
  });
});
```

**`tests/integration/workspaces.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestContext,
  createWorkspace,
  registerUser,
  resetState,
} from '../helpers.js';

const ctx = createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('workspaces', () => {
  it('lists my workspaces newest first with cursor pagination', async () => {
    const user = await registerUser(ctx, 'Ada');
    for (const slug of ['one', 'two', 'three']) {
      await ctx.request
        .post('/api/v1/workspaces')
        .set(user.auth)
        .send({ name: slug, slug })
        .expect(201);
    }
    const page1 = await ctx.request.get('/api/v1/workspaces?limit=2').set(user.auth).expect(200);
    const body1 = page1.body as {
      items: { slug: string; currentUserRole: string }[];
      nextCursor: string;
    };
    expect(body1.items.map((w) => w.slug)).toEqual(['three', 'two']);
    expect(body1.items[0]?.currentUserRole).toBe('owner');
    const page2 = await ctx.request
      .get(`/api/v1/workspaces?limit=2&cursor=${body1.nextCursor}`)
      .set(user.auth)
      .expect(200);
    expect(page2.body).toMatchObject({ items: [{ slug: 'one' }], nextCursor: null });
  });
```

**`tests/integration/workspaces.test.ts`** · continue

```ts
  it('hides workspaces from non-members (404) and enforces roles (403)', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const stranger = await registerUser(ctx, 'Stranger');
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(stranger.auth).expect(404);

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, member, 'member');
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(member.auth).expect(200);
    await ctx.request
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(member.auth)
      .send({ name: 'Hijacked' })
      .expect(403);
    await ctx.request.delete(`/api/v1/workspaces/${workspaceId}`).set(member.auth).expect(403);
  });

  it('rejects a taken slug with 409 and an invalid path id with 422', async () => {
    const user = await registerUser(ctx, 'Ada');
    await ctx.request
      .post('/api/v1/workspaces')
      .set(user.auth)
      .send({ name: 'A', slug: 'same' })
      .expect(201);
    await ctx.request
      .post('/api/v1/workspaces')
      .set(user.auth)
      .send({ name: 'B', slug: 'same' })
      .expect(409);
    const res = await ctx.request.get('/api/v1/workspaces/not-a-uuid').set(user.auth).expect(422);
    expect(res.body).toMatchObject({ errors: [{ field: 'path.workspaceId' }] });
  });

  it('lets the owner rename and delete the workspace', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const renamed = await ctx.request
      .patch(`/api/v1/workspaces/${workspaceId}`)
      .set(owner.auth)
      .send({ name: 'Acme Inc.' })
      .expect(200);
    expect(renamed.body).toMatchObject({ name: 'Acme Inc.', currentUserRole: 'owner' });
    await ctx.request.delete(`/api/v1/workspaces/${workspaceId}`).set(owner.auth).expect(204);
    await ctx.request.get(`/api/v1/workspaces/${workspaceId}`).set(owner.auth).expect(404);
```

**`tests/integration/workspaces.test.ts`** · continue

```ts
  });
});

describe('members', () => {
  it('lets admins manage members and viewers but not other admins', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const otherAdmin = await registerUser(ctx, 'Admin2');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, otherAdmin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');

    const url = (u: string) => `/api/v1/workspaces/${workspaceId}/members/${u}`;
    const res = await ctx.request
      .patch(url(member.id))
      .set(admin.auth)
      .send({ role: 'viewer' })
      .expect(200);
    expect(res.body).toMatchObject({ user: { id: member.id }, role: 'viewer' });
    await ctx.request.patch(url(member.id)).set(admin.auth).send({ role: 'admin' }).expect(403);
    await ctx.request
      .patch(url(otherAdmin.id))
      .set(admin.auth)
      .send({ role: 'member' })
      .expect(403);
    await ctx.request.delete(url(otherAdmin.id)).set(admin.auth).expect(403);
    await ctx.request.delete(url(member.id)).set(admin.auth).expect(204);
  });

  it('never leaves a workspace without an owner', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}/members/${owner.id}`;
    await ctx.request.patch(url).set(owner.auth).send({ role: 'admin' }).expect(409);
    await ctx.request.delete(url).set(owner.auth).expect(409);

    const second = await registerUser(ctx, 'Second');
    await addMember(ctx, workspaceId, second, 'owner');
    await ctx.request.delete(url).set(owner.auth).expect(204);
  });
```

**`tests/integration/workspaces.test.ts`** · continue

```ts
  it('lists members in join order', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const late = await registerUser(ctx, 'Late');
    await addMember(ctx, workspaceId, late, 'viewer');
    const res = await ctx.request
      .get(`/api/v1/workspaces/${workspaceId}/members`)
      .set(late.auth)
      .expect(200);
    const ids = (res.body as { items: { user: { id: string } }[] }).items.map((m) => m.user.id);
    expect(ids).toEqual([owner.id, late.id]);
  });
});

describe('invitations', () => {
  it('invites by email, queues the email, and lets the invitee join', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
```

**`tests/integration/workspaces.test.ts`** · continue

```ts
    const invitee = await registerUser(ctx, 'Invitee');
    const created = await ctx.request
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .send({ email: invitee.email.toUpperCase(), role: 'member' })
      .expect(201);
    expect(created.body).toMatchObject({
      email: invitee.email,
      role: 'member',
      invitedBy: { id: owner.id },
    });

    const jobs = await ctx.infra.queue.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'send-invitation-email');
    const token = (job?.data as { token: string }).token;
    expect(token).toBeTruthy();

    await ctx.request
      .post(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .send({ email: invitee.email, role: 'viewer' })
      .expect(409);

    const stranger = await registerUser(ctx, 'Stranger');
    await ctx.request
      .post('/api/v1/invitations/accept')
      .set(stranger.auth)
      .send({ token })
      .expect(403);
    const joined = await ctx.request
      .post('/api/v1/invitations/accept')
      .set(invitee.auth)
      .send({ token })
      .expect(200);
    expect(joined.body).toMatchObject({ id: workspaceId, currentUserRole: 'member' });
    await ctx.request
      .post('/api/v1/invitations/accept')
      .set(invitee.auth)
      .send({ token })
      .expect(404);
```

**`tests/integration/workspaces.test.ts`** · continue

```ts
    const pending = await ctx.request
      .get(`/api/v1/workspaces/${workspaceId}/invitations`)
      .set(owner.auth)
      .expect(200);
    expect(pending.body).toMatchObject({ items: [], nextCursor: null });
  });

  it('only owners invite admins; members cannot invite at all', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');
    const url = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invite = (who: { auth: Record<string, string> }, role: string) =>
      ctx.request.post(url).set(who.auth).send({ email: 'x@example.com', role });
    expect((await invite(admin, 'admin')).status).toBe(403);
    expect((await invite(member, 'viewer')).status).toBe(403);
    const ok = await invite(admin, 'viewer');
    expect(ok.status).toBe(201);
    await ctx.request
      .delete(`${url}/${(ok.body as { id: string }).id}`)
      .set(admin.auth)
      .expect(204);
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/unit/cursor.test.ts tests/integration/workspaces.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  15 passed (15)`. The invitations test also shows the job waiting in Redis: `docker compose exec redis redis-cli -n 1 keys 'bull:taskflow:*'` lists BullMQ's keys while that test runs.

**Commit:** `feat: workspaces, members, invitations with RBAC and activity log`

---

## Part 6 · Projects, columns & ordering

A project is a Kanban board: ordered columns, each holding ordered tasks. This part builds the ordering algorithm, the board view with its Redis cache, and the real-time *publisher* (the subscriber side arrives in Part 10).

### Step 6.1 · Fractional indexing

**Goal:** `keyBetween(a, b)` returns a string that sorts strictly between `a` and `b`, so moving an item rewrites one row.

**Files:** `src/lib/fractional-index.ts`, `tests/unit/fractional-index.test.ts`

**`src/lib/fractional-index.ts`** · new file

```ts
// Fractional indexing (variable-length base62 keys), after David Greenspan's algorithm.
// A key is an "integer part" (a length-prefix head char + digits) followed by a fraction.
// Keys compare correctly with plain byte order, which is why the DB column is COLLATE "C".

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const INTEGER_ZERO = 'a0';
const SMALLEST_INTEGER = 'A' + '0'.repeat(26);

function digitAt(s: string, i: number): string {
  const c = s[i];
  if (c === undefined) throw new Error(`index ${i} out of range in "${s}"`);
  return c;
}

/** A fraction strictly between `a` and `b` (null = 1). Neither may end in '0'. */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.endsWith('0') || b?.endsWith('0')) throw new Error('trailing zero');
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? '0') === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(digitAt(a, 0)) : 0;
  const digitB = b !== null ? DIGITS.indexOf(digitAt(b, 0)) : DIGITS.length;
  if (digitB - digitA > 1) return DIGITS.charAt(Math.round((digitA + digitB) / 2));
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS.charAt(digitA) + midpoint(a.slice(1), null);
}

function integerLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error(`invalid order key head: ${head}`);
}
```

**`src/lib/fractional-index.ts`** · continue

```ts
function integerPart(key: string): string {
  const length = integerLength(digitAt(key, 0));
  if (length > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function validateKey(key: string): void {
  if (key === SMALLEST_INTEGER) throw new Error(`invalid order key: ${key}`);
  const fraction = key.slice(integerPart(key).length);
  if (fraction.endsWith('0')) throw new Error(`invalid order key: ${key}`);
}
```

**`src/lib/fractional-index.ts`** · continue

```ts

function incrementInteger(x: string): string | null {
  const head = digitAt(x, 0);
  const digits = x.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '') + 1;
    if (d === DIGITS.length) {
      digits[i] = '0';
    } else {
      digits[i] = DIGITS.charAt(d);
      carry = false;
    }
  }
  if (!carry) return head + digits.join('');
  if (head === 'Z') return 'a0';
  if (head === 'z') return null;
  const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
  if (nextHead > 'a') digits.push('0');
  else digits.pop();
  return nextHead + digits.join('');
}

function decrementInteger(x: string): string | null {
  const head = digitAt(x, 0);
  const digits = x.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const d = DIGITS.indexOf(digits[i] ?? '') - 1;
    if (d === -1) {
      digits[i] = DIGITS.charAt(DIGITS.length - 1);
    } else {
      digits[i] = DIGITS.charAt(d);
      borrow = false;
    }
  }
  if (!borrow) return head + digits.join('');
  if (head === 'a') return 'Z' + DIGITS.charAt(DIGITS.length - 1);
  if (head === 'A') return null;
  const prevHead = String.fromCharCode(head.charCodeAt(0) - 1);
  if (prevHead < 'Z') digits.push(DIGITS.charAt(DIGITS.length - 1));
  else digits.pop();
  return prevHead + digits.join('');
}
```

**`src/lib/fractional-index.ts`** · continue

```ts

/** A key strictly between `a` and `b`; `null` means "open end". */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return INTEGER_ZERO;
    const intB = integerPart(b);
    const fracB = b.slice(intB.length);
    if (intB === SMALLEST_INTEGER) return intB + midpoint('', fracB);
    if (intB < b) return intB;
    const decremented = decrementInteger(intB);
    if (decremented === null) throw new Error('cannot decrement any more');
    return decremented;
  }

  const intA = integerPart(a);
  const fracA = a.slice(intA.length);
  if (b === null) {
    const incremented = incrementInteger(intA);
    return incremented ?? intA + midpoint(fracA, null);
  }

  const intB = integerPart(b);
  const fracB = b.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const incremented = incrementInteger(intA);
  if (incremented === null) throw new Error('cannot increment any more');
  if (incremented < b) return incremented;
  return intA + midpoint(fracA, null);
}
```

**`tests/unit/fractional-index.test.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { keyBetween } from '../../src/lib/fractional-index.js';

describe('keyBetween', () => {
  // The shared vectors from the TaskFlow README; all six backends must agree on them.
  it.each([
    [null, null, 'a0'],
    ['a0', null, 'a1'],
    [null, 'a0', 'Zz'],
    ['a0', 'a1', 'a0V'],
    ['a1', 'a2', 'a1V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
  ])('keyBetween(%s, %s) = %s', (a, b, expected) => {
    expect(keyBetween(a, b)).toBe(expected);
  });

  it('keeps byte order through 2,000 random insertions', () => {
    const keys: string[] = [];
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 2000; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      keys.splice(at, 0, keyBetween(keys[at - 1] ?? null, keys[at] ?? null));
    }
    const sorted = [...keys].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('grows slowly when always inserting into the same gap', () => {
    let upper = 'a1';
    for (let i = 0; i < 50; i++) upper = keyBetween('a0', upper);
    expect(upper.length).toBeLessThanOrEqual(12);
  });

  it('rejects keys in the wrong order', () => {
    expect(() => keyBetween('a1', 'a0')).toThrow();
    expect(() => keyBetween('a1', 'a1')).toThrow();
  });
});
```

**What's new**
- The digits `0-9A-Za-z` are in **ASCII order**, so comparing keys with `<` (which compares UTF-16 code units) gives the same order as Postgres `COLLATE "C"`. That's the property everything else relies on.
- `it.each([...])` runs one test per row. The seven vectors come from the TaskFlow README, and all six backends test the same ones.
- The random-insertion test uses a tiny seeded generator (Park–Miller, `seed * 16807 % (2³¹−1)`) instead of `Math.random()`, so a failure is reproducible.

> **🧠 DSA & scalability · fractional indexing**
> - **Data structure:** a variable-length base-62 string per item, stored in `position text COLLATE "C"` with `UNIQUE (column_id, position)`.
> - **Key shape:** an *integer part* whose first character encodes its length (`a0`…`az`, then `b00`…), followed by an optional *fraction*. Appending at the end increments the integer part (`a0 → a1 → a2`), so keys stay short.
> - **Algorithm (`midpoint`):** skip the shared prefix of `a` and `b`. If their next digits differ by more than one, return the digit halfway between. Otherwise keep `a`'s digit and recurse on the rest with an open upper bound. Like binary search, but on strings.
> - **Complexity:** O(k) for keys of length k. Inserting repeatedly into the *same* gap grows keys by about one character every ~6 inserts (log₂ 62 ≈ 5.95 halvings per character). Normal use stays at 2–4 characters.
> - **Why it scales:** a drag-and-drop is **one** `UPDATE` of one row, whatever the column size. Two users moving different tasks never touch the same rows.
> - **Rejected:** integer positions (a move renumbers O(n) rows and makes concurrent moves conflict); floats (`(a+b)/2` runs out of precision after ~50 bisections); a linked list `prevId` (reading the order requires walking the list, and a concurrent move can corrupt it).

**✅ Checkpoint**

```bash
npx vitest run tests/unit/fractional-index.test.ts
```

Expected: `Tests  10 passed (10)`.

**Commit:** `feat: fractional indexing`

### Step 6.2 · DTOs, the board cache and the real-time publisher

**Goal:** Shape projects, columns and tasks for the wire, cache the board, and publish real-time events.

**Files:** `src/modules/projects/projects.dto.ts`, `src/modules/projects/board-cache.ts`, `src/modules/realtime/publisher.ts`

**`src/modules/projects/projects.dto.ts`** · new file

```ts
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';

interface ProjectRow {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toProject = (p: ProjectRow) => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

interface ColumnRow {
  id: string;
  projectId: string;
  name: string;
  position: string;
  wipLimit: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export const toColumn = (c: ColumnRow) => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  position: c.position,
  wipLimit: c.wipLimit,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
```

**`src/modules/projects/projects.dto.ts`** · continue

```ts

export interface TaskRow {
  id: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: string;
  dueAt: Date | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string };
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
}

export type TaskDto = ReturnType<typeof toTask>;

export const toTask = (t: TaskRow) => ({
  id: t.id,
  key: `${t.project.key}-${t.number}`,
  number: t.number,
  projectId: t.projectId,
  columnId: t.columnId,
  title: t.title,
  description: t.description,
  priority: t.priority,
  assignee: t.assignee ? toUserSummary(t.assignee) : null,
  reporter: toUserSummary(t.reporter),
  dueAt: t.dueAt?.toISOString() ?? null,
  position: t.position,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

/** Prisma `include` that loads everything `toTask` needs in one query. */
export const taskInclude = {
  project: { select: { key: true } },
  assignee: { select: { id: true, email: true, displayName: true } },
  reporter: { select: { id: true, email: true, displayName: true } },
} as const;
```

**`src/modules/projects/board-cache.ts`** · new file

```ts
import type { Redis } from 'ioredis';

const TTL_SECONDS = 300;
const key = (projectId: string) => `cache:board:${projectId}`;

/** Cache-aside: read through on a miss, delete after every write that changes the board. */
export class BoardCache {
  constructor(private readonly redis: Redis) {}

  async getOrLoad<T>(projectId: string, load: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key(projectId));
    if (cached !== null) return JSON.parse(cached) as T;
    const value = await load();
    await this.redis.set(key(projectId), JSON.stringify(value), 'EX', TTL_SECONDS);
    return value;
  }

  async invalidate(projectId: string): Promise<void> {
    await this.redis.del(key(projectId));
  }
}
```

**`src/modules/realtime/publisher.ts`** · new file

```ts
import type { Redis } from 'ioredis';

export type ServerEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.moved'
  | 'task.deleted'
  | 'column.created'
  | 'column.updated'
  | 'column.moved'
  | 'column.deleted'
  | 'comment.created'
  | 'presence.updated';

export const projectChannel = (projectId: string) => `project:${projectId}`;

export const envelope = (type: string, payload?: unknown) =>
  JSON.stringify({
    type,
    ...(payload === undefined ? {} : { payload }),
    ts: new Date().toISOString(),
  });

/** Publishes to Redis; every API instance's WebSocket gateway relays to its own sockets. */
export class RealtimePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(projectId: string, type: ServerEventType, payload: unknown): Promise<void> {
    await this.redis.publish(projectChannel(projectId), envelope(type, payload));
  }
}
```

**What's new**
- `export type TaskDto = ReturnType<typeof toTask>` derives the response type from the mapper, so there's no second interface to keep in sync.
- `taskInclude` is declared `as const` so Prisma can infer that `assignee` and `reporter` are loaded. Pass it to any task query and the result type fits `toTask`.
- `redis.publish(channel, message)` sends to every subscriber **right now** and forgets it: Pub/Sub has no storage and no replay (README §9.2 explains why that's acceptable here).

> **🧠 DSA & scalability · cache-aside for the board**
> - **Data structure:** a Redis string `cache:board:{projectId}` holding the board JSON, with a 300 s TTL.
> - **Algorithm:** **read** → `GET`. On a hit, return the cached board. On a miss, query Postgres, `SET … EX 300`, then return it. **Write** → after the transaction commits, `DEL` the key. The next read rebuilds it.
> - **Complexity:** a hit is one O(1) Redis round trip instead of two Postgres queries plus O(n) grouping.
> - **Why delete instead of update:** rebuilding the JSON on every write would duplicate the read logic and race with other writers. Deleting is idempotent and simple.
> - **The TTL is the safety net** for writes that don't invalidate, such as a user renaming themselves (their name is embedded in every task's `assignee`).
> - **Rejected:** write-through caching (more code, same correctness); caching per task (the board query is the expensive one).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: board cache, dtos and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** Retry a transaction when a concurrent move took the same position key.

**Files:** `src/lib/prisma-errors.ts` (continue)

**`src/lib/prisma-errors.ts`** · continue

```ts

export const isForeignKeyViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003';

/**
 * Two users dropping into the same gap at once compute the same position key; the
 * UNIQUE (parent, position) index rejects the second. Re-reading neighbours and retrying fixes it.
 */
export async function retryOnPositionConflict<T>(
  attempt: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await attempt();
    } catch (err) {
      if (!isUniqueViolation(err) || i >= maxAttempts) throw err;
    }
  }
}
```

**What's new**
- `for (let i = 1; ; i++)` with `return await` inside `try`: the `await` matters. Without it, a rejected promise would escape the `try` and skip the retry.
- `P2003` is Prisma's code for a foreign-key violation. We use it in the next step.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: retry on position conflicts`

### Step 6.4 · Projects service and the board

**Goal:** Create projects with three default columns, and serve the board in two queries through the cache.

**Files:** `src/modules/projects/projects.service.ts`

**`src/modules/projects/projects.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { conflict } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { taskInclude, toColumn, toProject, toTask } from './projects.dto.js';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

export class ProjectsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.project.findMany({
      where: { workspaceId, ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    return toPage(rows, limit, toProject, (p) => ({ id: p.id }));
  }
```

**`src/modules/projects/projects.service.ts`** · continue

```ts
  async create(
    workspaceId: string,
    userId: string,
    input: { name: string; key: string; description?: string | null | undefined },
  ) {
    await this.access.member(workspaceId, userId, 'admin');
    try {
      const project = await this.db.$transaction(async (tx) => {
        const created = await tx.project.create({
          data: {
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            createdBy: userId,
          },
        });
        let position: string | null = null;
        for (const name of DEFAULT_COLUMNS) {
          position = keyBetween(position, null);
          await tx.boardColumn.create({ data: { projectId: created.id, name, position } });
        }
        await this.activity.record(tx, {
          workspaceId,
          actorId: userId,
          projectId: created.id,
          type: 'project.created',
          data: { name: created.name, key: created.key },
        });
        return created;
      });
      return toProject(project);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('Project key is already used in this workspace');
      }
      throw err;
    }
  }
```

**`src/modules/projects/projects.service.ts`** · continue

```ts
  async get(projectId: string, userId: string) {
    const { project } = await this.access.project(projectId, userId);
    return toProject(project);
  }

  async update(
    projectId: string,
    userId: string,
    input: { name?: string | undefined; description?: string | null | undefined },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.project.update({ where: { id: projectId }, data: input });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId,
        type: 'project.updated',
        data: { ...input },
      });
      return row;
    });
    await this.cache.invalidate(projectId);
    return toProject(updated);
  }

  async delete(projectId: string, userId: string) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    await this.db.$transaction(async (tx) => {
      await tx.project.delete({ where: { id: projectId } });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId,
        type: 'project.deleted',
        data: { name: project.name, key: project.key },
      });
    });
    await this.cache.invalidate(projectId);
    await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${projectId}/` });
  }
```

**`src/modules/projects/projects.service.ts`** · continue

```ts
  async board(projectId: string, userId: string) {
    const { project } = await this.access.project(projectId, userId);
    return this.cache.getOrLoad(projectId, async () => {
      const [columns, tasks] = await Promise.all([
        this.db.boardColumn.findMany({ where: { projectId }, orderBy: { position: 'asc' } }),
        this.db.task.findMany({
          where: { projectId },
          orderBy: { position: 'asc' },
          include: taskInclude,
        }),
      ]);
      const byColumn = Map.groupBy(tasks.map(toTask), (t) => t.columnId);
      return {
        project: toProject(project),
        columns: columns.map((c) => ({ ...toColumn(c), tasks: byColumn.get(c.id) ?? [] })),
      };
    });
  }
}
```

**What's new**
- The three default columns get `keyBetween(null, null) = 'a0'`, then `'a1'`, `'a2'`: each new key goes "after the previous one".
- `Promise.all([...])` runs the column query and the task query **concurrently** on two pooled connections.
- `Map.groupBy(tasks, t => t.columnId)` (ES2024) groups an array into a `Map` in one pass. It's why `tsconfig.json` targets ES2024.

> **🧠 DSA & scalability · building the board**
> - **Data:** 2 queries (columns, tasks), both `ORDER BY position` using the `(project_id, position)` / `(column_id, position)` unique indexes.
> - **Algorithm:** fetch both lists, group the tasks by column with a hash map, and attach each group to its column.
> - **Complexity:** O(c + t) after the queries, instead of the O(c × t) of filtering the task list once per column.
> - **Avoiding N+1:** one query per *column* would be 1 + c round trips. Two queries are constant regardless of board size.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: projects service and cached board`

### Step 6.5 · Columns service

**Goal:** Add, rename, reorder and delete columns with fractional positions.

**Files:** `src/modules/projects/columns.service.ts`

**`src/modules/projects/columns.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Db } from '../../infra/db.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isForeignKeyViolation, retryOnPositionConflict } from '../../lib/prisma-errors.js';
import { conflict, invalid } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { toColumn } from './projects.dto.js';

export class ColumnsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
  ) {}
```

**`src/modules/projects/columns.service.ts`** · continue

```ts
  async create(
    projectId: string,
    userId: string,
    input: { name: string; wipLimit?: number | null | undefined },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const column = await retryOnPositionConflict(() =>
      this.db.$transaction(async (tx) => {
        const last = await tx.boardColumn.findFirst({
          where: { projectId },
          orderBy: { position: 'desc' },
        });
        const created = await tx.boardColumn.create({
          data: {
            projectId,
            name: input.name,
            wipLimit: input.wipLimit ?? null,
            position: keyBetween(last?.position ?? null, null),
          },
        });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          type: 'column.created',
          data: { columnId: created.id, name: created.name },
        });
        return created;
      }),
    );
    return this.afterWrite(projectId, 'column.created', toColumn(column));
  }
```

**`src/modules/projects/columns.service.ts`** · continue

```ts
  async update(
    columnId: string,
    userId: string,
    input: { name?: string | undefined; wipLimit?: number | null | undefined },
  ) {
    const { project } = await this.access.column(columnId, userId, 'admin');
    const column = await this.db.$transaction(async (tx) => {
      const row = await tx.boardColumn.update({ where: { id: columnId }, data: input });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        type: 'column.updated',
        data: { columnId, ...input },
      });
      return row;
    });
    return this.afterWrite(project.id, 'column.updated', toColumn(column));
  }

  async move(columnId: string, userId: string, afterColumnId: string | null) {
    const { column, project } = await this.access.column(columnId, userId, 'admin');
    if (afterColumnId === columnId)
      throw invalid('afterColumnId', 'cannot place a column after itself');
    const moved = await retryOnPositionConflict(() =>
      this.db.$transaction(async (tx) => {
        const position = await this.positionAfter(tx, column.projectId, columnId, afterColumnId);
        const row = await tx.boardColumn.update({ where: { id: columnId }, data: { position } });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.moved',
          data: { columnId, afterColumnId },
        });
        return row;
      }),
    );
    return this.afterWrite(project.id, 'column.moved', toColumn(moved));
  }
```

**`src/modules/projects/columns.service.ts`** · continue

```ts
  async delete(columnId: string, userId: string) {
    const { column, project } = await this.access.column(columnId, userId, 'admin');
    try {
      await this.db.$transaction(async (tx) => {
        await tx.boardColumn.delete({ where: { id: columnId } });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.deleted',
          data: { columnId, name: column.name },
        });
      });
    } catch (err) {
      // tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
      if (isForeignKeyViolation(err))
        throw conflict('Move or delete the tasks in this column first');
      throw err;
    }
    await this.afterWrite(project.id, 'column.deleted', { id: columnId, projectId: project.id });
  }
```

**`src/modules/projects/columns.service.ts`** · continue

```ts
  private async positionAfter(tx: Db, projectId: string, columnId: string, afterId: string | null) {
    let lower: string | null = null;
    if (afterId !== null) {
      const after = await tx.boardColumn.findUnique({ where: { id: afterId } });
      if (after?.projectId !== projectId) {
        throw invalid('afterColumnId', 'must be a column of the same project');
      }
      lower = after.position;
    }
    const next = await tx.boardColumn.findFirst({
      where: {
        projectId,
        id: { not: columnId },
        ...(lower !== null ? { position: { gt: lower } } : {}),
      },
      orderBy: { position: 'asc' },
    });
    return keyBetween(lower, next?.position ?? null);
  }

  private async afterWrite<T>(
    projectId: string,
    type: Parameters<RealtimePublisher['publish']>[1],
    payload: T,
  ) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
```

**What's new**
- **Deleting a non-empty column is refused by the database, not by the code.** The `tasks.column_id` foreign key has no `ON DELETE` action, so Postgres raises a FK violation that we translate to 409. A "count tasks, then delete" check in code could race with a concurrent task create.
- `positionAfter` computes the new key **inside** the transaction, from the neighbours as they are right now. `retryOnPositionConflict` wraps the whole transaction, so a retry re-reads them.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: columns service`

### Step 6.6 · Routes, wiring and tests

**Goal:** Expose projects and columns, wire them up, and test the board.

**Files:** `src/modules/projects/projects.routes.ts`, `src/container.ts`, `src/app.ts`, `tests/helpers.ts`, `tests/integration/projects.test.ts`

**`src/modules/projects/projects.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import {
  atLeastOneField,
  Id,
  PageQuery,
  parseBody,
  parseParams,
  parseQuery,
  trimmed,
} from '../../lib/validation.js';
import type { ColumnsService } from './columns.service.js';
import type { ProjectsService } from './projects.service.js';

const Description = z.string().max(2000).nullable();
const WipLimit = z.number().int().min(1).max(999).nullable();

const CreateProjectBody = z.object({
  name: trimmed(1, 80),
  key: z
    .string()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, '2-10 uppercase letters or digits, starting with a letter'),
  description: Description.optional(),
});
const UpdateProjectBody = z
  .object({ name: trimmed(1, 80).optional(), description: Description.optional() })
  .refine(...atLeastOneField);

const CreateColumnBody = z.object({ name: trimmed(1, 50), wipLimit: WipLimit.optional() });
const UpdateColumnBody = z
  .object({ name: trimmed(1, 50).optional(), wipLimit: WipLimit.optional() })
  .refine(...atLeastOneField);
const MoveColumnBody = z.object({ afterColumnId: Id.nullable() });

const WorkspaceParams = z.object({ workspaceId: Id });
const ProjectParams = z.object({ projectId: Id });
const ColumnParams = z.object({ columnId: Id });
```

**`src/modules/projects/projects.routes.ts`** · continue

```ts
export function projectsRoutes(projects: ProjectsService, columns: ColumnsService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/projects')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await projects.list(workspaceId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const body = parseBody(CreateProjectBody, req);
      res.status(201).json(await projects.create(workspaceId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/projects/:projectId')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      res.json(await projects.get(projectId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(UpdateProjectBody, req);
      res.json(await projects.update(projectId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      await projects.delete(projectId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);
```

**`src/modules/projects/projects.routes.ts`** · continue

```ts
  router
    .route('/projects/:projectId/board')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      res.json(await projects.board(projectId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  router
    .route('/projects/:projectId/columns')
    .post(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(CreateColumnBody, req);
      res.status(201).json(await columns.create(projectId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/columns/:columnId')
    .patch(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      const body = parseBody(UpdateColumnBody, req);
      res.json(await columns.update(columnId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      await columns.delete(columnId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/columns/:columnId/move')
    .post(async (req, res) => {
      const { columnId } = parseParams(ColumnParams, req);
      const { afterColumnId } = parseBody(MoveColumnBody, req);
      res.json(await columns.move(columnId, userIdOf(req), afterColumnId));
    })
    .all(methodNotAllowed);

  return router;
}
```

`src/container.ts`:

**`src/container.ts`** · add after `import { RefreshTokens } from './modules/auth/refresh-tokens.js';`

```ts
import { BoardCache } from './modules/projects/board-cache.js';
import { ColumnsService } from './modules/projects/columns.service.js';
import { ProjectsService } from './modules/projects/projects.service.js';
```

**`src/container.ts`** · add after `import { ProjectsService } from './modules/projects/projects.service.js';`

```ts
import { RealtimePublisher } from './modules/realtime/publisher.js';
```

**`src/container.ts`** · add after `const jobs = new Jobs(infra.queue);`

```ts
  const realtime = new RealtimePublisher(redis);
  const boardCache = new BoardCache(redis);
```

**`src/container.ts`** · add after `accessTokens,`

```ts
    realtime,
```

**`src/container.ts`** · add after `invitations: new InvitationsService(prisma, access, activity, jobs),`

```ts
    projects: new ProjectsService(prisma, access, activity, boardCache, jobs),
    columns: new ColumnsService(prisma, access, activity, boardCache, realtime),
```

`src/app.ts`:

**`src/app.ts`** · add after `import { healthRoutes } from './modules/health/health.routes.js';`

```ts
import { projectsRoutes } from './modules/projects/projects.routes.js';
```

**`src/app.ts`** · add after `api.use(workspacesRoutes(services.workspaces, services.members, services.invitations));`

```ts
  api.use(projectsRoutes(services.projects, services.columns));
```

The fixture helper, and the tests:

**`tests/helpers.ts`** · continue

```ts

export interface Fixture extends WorkspaceFixture {
  projectId: string;
  columnIds: string[];
}

/** A workspace plus a project, which comes with 3 default columns. */
export async function createFixture(ctx: TestContext): Promise<Fixture> {
  const { owner, workspaceId } = await createWorkspace(ctx);
  const project = await ctx.request
    .post(`/api/v1/workspaces/${workspaceId}/projects`)
    .set(owner.auth)
    .send({ name: 'TaskFlow', key: 'TF' })
    .expect(201);
  const projectId = (project.body as { id: string }).id;
  const board = await ctx.request
    .get(`/api/v1/projects/${projectId}/board`)
    .set(owner.auth)
    .expect(200);
  const columnIds = (board.body as { columns: { id: string }[] }).columns.map((c) => c.id);
  return { owner, workspaceId, projectId, columnIds };
}
```

**`tests/integration/projects.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
} from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function columnNames() {
  const res = await ctx.request
    .get(`/api/v1/projects/${f.projectId}/board`)
    .set(f.owner.auth)
    .expect(200);
  return (res.body as { columns: { name: string }[] }).columns.map((c) => c.name);
}

describe('projects', () => {
  it('creates three default columns and rejects a duplicate key', async () => {
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
    await ctx.request
      .post(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .send({ name: 'Again', key: 'TF' })
      .expect(409);
  });
```

**`tests/integration/projects.test.ts`** · continue

```ts
  it('lists projects newest first and updates them', async () => {
    await ctx.request
      .post(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .send({ name: 'Second', key: 'SEC', description: 'Another one' })
      .expect(201);
    const list = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .expect(200);
    expect((list.body as { items: { key: string }[] }).items.map((p) => p.key)).toEqual([
      'SEC',
      'TF',
    ]);
    const updated = await ctx.request
      .patch(`/api/v1/projects/${f.projectId}`)
      .set(f.owner.auth)
      .send({ description: null, name: 'TaskFlow v2' })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'TaskFlow v2', description: null, key: 'TF' });
  });

  it('keeps project and column management for admins', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    await ctx.request.get(`/api/v1/projects/${f.projectId}`).set(member.auth).expect(200);
    await ctx.request
      .post(`/api/v1/projects/${f.projectId}/columns`)
      .set(member.auth)
      .send({ name: 'Nope' })
      .expect(403);
    await ctx.request.delete(`/api/v1/projects/${f.projectId}`).set(member.auth).expect(403);
  });

  it('cascades a workspace delete to its projects', async () => {
    await ctx.request.delete(`/api/v1/workspaces/${f.workspaceId}`).set(f.owner.auth).expect(204);
    await ctx.request.get(`/api/v1/projects/${f.projectId}`).set(f.owner.auth).expect(404);
  });
```

**`tests/integration/projects.test.ts`** · continue

```ts
});

describe('columns', () => {
  it('adds, renames, reorders and deletes columns', async () => {
    const created = await ctx.request
      .post(`/api/v1/projects/${f.projectId}/columns`)
      .set(f.owner.auth)
      .send({ name: 'Review', wipLimit: 3 })
      .expect(201);
    const reviewId = (created.body as { id: string }).id;
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);

    await ctx.request
      .patch(`/api/v1/columns/${reviewId}`)
      .set(f.owner.auth)
      .send({ name: 'QA' })
      .expect(200);
    await ctx.request
      .post(`/api/v1/columns/${reviewId}/move`)
      .set(f.owner.auth)
      .send({ afterColumnId: null })
      .expect(200);
    expect(await columnNames()).toEqual(['QA', 'To Do', 'In Progress', 'Done']);

    await ctx.request
      .post(`/api/v1/columns/${reviewId}/move`)
      .set(f.owner.auth)
      .send({ afterColumnId: f.columnIds[1] })
      .expect(200);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'QA', 'Done']);

    await ctx.request.delete(`/api/v1/columns/${reviewId}`).set(f.owner.auth).expect(204);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/unit/fractional-index.test.ts tests/integration/projects.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  15 passed (15)`.

**Commit:** `feat: projects, columns and fractional ordering with a cached board`

---

## Part 7 · Tasks

Tasks are the heart of the app: per-project numbering (`TF-42`), drag-and-drop moves, filtered lists, merge-patch updates, and a real-time event after every write.

### Step 7.1 · Types and the filtered list

**Goal:** Define the task types, and list tasks with optional filters and cursor pagination.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · new file

```ts
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Jobs } from '../../jobs/queue.js';
import type { Db } from '../../infra/db.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { retryOnPositionConflict } from '../../lib/prisma-errors.js';
import { invalid } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { BoardCache } from '../projects/board-cache.js';
import { taskInclude, toTask, type TaskDto } from '../projects/projects.dto.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';

export type Priority = 'low' | 'medium' | 'high' | 'urgent';

export interface TaskFilters {
  columnId?: string | undefined;
  assigneeId?: string | undefined;
  priority?: Priority | undefined;
  dueBefore?: Date | undefined;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  columnId?: string | undefined;
  priority: Priority;
  assigneeId?: string | null | undefined;
  dueAt?: Date | null | undefined;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

export class TasksService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
    private readonly jobs: Jobs,
  ) {}
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
  async list(
    projectId: string,
    userId: string,
    filters: TaskFilters,
    limit: number,
    cursor?: string,
  ) {
    await this.access.project(projectId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const where: Prisma.TaskWhereInput = {
      projectId,
      ...(filters.columnId ? { columnId: filters.columnId } : {}),
      ...(filters.assigneeId
        ? { assigneeId: filters.assigneeId === 'none' ? null : filters.assigneeId }
        : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.dueBefore ? { dueAt: { lt: filters.dueBefore } } : {}),
      ...(after ? { id: { lt: after } } : {}),
    };
    const rows = await this.db.task.findMany({
      where,
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: taskInclude,
    });
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(
      await this.db.task.findUniqueOrThrow({ where: { id: taskId }, include: taskInclude }),
    );
  }
```

**What's new**
- `Partial<Omit<CreateTaskInput, 'columnId'>>`: an update may change any field except the column (moving has its own endpoint). Built from the create type with TypeScript's utility types, not repeated.
- The `where` object is built with **conditional spreads**: `...(filters.priority ? { priority: filters.priority } : {})`. Only filters that were actually given end up in the query. `assigneeId: null` means "IS NULL" in Prisma, which is how `?assigneeId=none` works.
- `Prisma.TaskWhereInput` is the generated type for a `where` clause on tasks: autocompletion and type checking for dynamic queries.

**✅ Checkpoint**

None yet: `TasksService` is only half written (its closing brace arrives in Step 7.3), so `npm run typecheck` would report `'}' expected`. The checkpoint is at the end of Step 7.3.

**Commit:** wait until Step 7.3, so every commit compiles.

### Step 7.2 · Creating a task: the per-project counter

**Goal:** Create a task with the next per-project number, at the bottom of its column.

**Files:** `src/modules/tasks/tasks.service.ts` (continue)

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.db.$transaction(async (tx) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const [counter] = await tx.$queryRaw<{ number: number }[]>`
          UPDATE projects SET next_task_number = next_task_number + 1
          WHERE id = ${projectId}::uuid
          RETURNING next_task_number - 1 AS number`;
        const columnId = await this.resolveColumn(tx, projectId, input.columnId);
        const last = await tx.task.findFirst({
          where: { columnId },
          orderBy: { position: 'desc' },
        });
        const created = await tx.task.create({
          data: {
            projectId,
            columnId,
            number: counter?.number ?? 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority,
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: input.dueAt ?? null,
            position: keyBetween(last?.position ?? null, null),
          },
          include: taskInclude,
        });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
        return created;
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }
```

> **🧠 DSA & scalability · per-project task numbers**
> - **Data structure:** a counter column `projects.next_task_number`, plus `UNIQUE (project_id, number)` as the safety net.
> - **Algorithm:** `UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = $1 RETURNING next_task_number - 1`. The `UPDATE` takes a **row lock** on the project. Concurrent creates in the same project queue on that lock, and each gets the next number.
> - **The ordering bug this avoids (we hit it while building this repo):** the first version read the column's last `position` *before* taking the lock. Ten concurrent creates then all saw the same "last task", computed the same position, and collided on `UNIQUE (column_id, position)`. Taking the lock **first** fixes it: under READ COMMITTED every later statement in the transaction sees the previous creator's committed row.
> - **Complexity:** O(1) per create. Contention is per *project*: creates in different projects never wait for each other.
> - **Rejected:** `SELECT max(number) + 1` (two concurrent creates get the same number); a Postgres `SEQUENCE` per project (thousands of sequences, and gaps are harmless here anyway); a global sequence (numbers wouldn't be per-project).

**✅ Checkpoint**

None yet: the class is finished in the next step.

**Commit:** wait until Step 7.3, so every commit compiles.

### Step 7.3 · Update, move and delete

**Goal:** Edit, move and delete tasks; invalidate the cache and publish an event after each commit.

**Files:** `src/modules/tasks/tasks.service.ts` (continue)

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = input[field];
      if (to === undefined) continue;
      const from = before[field];
      const same =
        from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
      if (!same)
        changes[field] = {
          from: from instanceof Date ? from.toISOString() : from,
          to: to instanceof Date ? to.toISOString() : to,
        };
    }

    const task = await this.db.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: { ...input, ...('dueAt' in changes ? { reminderSentAt: null } : {}) },
        include: taskInclude,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes } as Prisma.InputJsonObject,
      });
      return updated;
    });
    return this.afterWrite(project.id, 'task.updated', toTask(task));
  }
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
  async move(
    taskId: string,
    userId: string,
    input: { columnId: string; afterTaskId: string | null },
  ) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.afterTaskId === taskId)
      throw invalid('afterTaskId', 'cannot place a task after itself');

    const task = await retryOnPositionConflict(() =>
      this.db.$transaction(async (tx) => {
        const column = await tx.boardColumn.findUnique({ where: { id: input.columnId } });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await tx.task.findUnique({ where: { id: input.afterTaskId } });
          if (after?.columnId !== input.columnId)
            throw invalid('afterTaskId', 'must be a task in the target column');
          lower = after.position;
        }
        const next = await tx.task.findFirst({
          where: {
            columnId: input.columnId,
            id: { not: taskId },
            ...(lower !== null ? { position: { gt: lower } } : {}),
          },
          orderBy: { position: 'asc' },
        });
        const moved = await tx.task.update({
          where: { id: taskId },
          data: { columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) },
          include: taskInclude,
        });
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return moved;
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.db.$transaction(async (tx) => {
      await tx.task.delete({ where: { id: taskId } });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.deleted',
        data: { key: `${project.key}-${task.number}`, title: task.title },
      });
    });
    await this.afterWrite(project.id, 'task.deleted', {
      id: taskId,
      projectId: project.id,
      columnId: task.columnId,
    });
    await this.jobs.enqueue('delete-storage-prefix', {
      prefix: `projects/${project.id}/tasks/${taskId}/`,
    });
  }
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
  private async resolveColumn(tx: Db, projectId: string, columnId: string | undefined) {
    if (columnId === undefined) {
      const first = await tx.boardColumn.findFirst({
        where: { projectId },
        orderBy: { position: 'asc' },
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await tx.boardColumn.findUnique({ where: { id: columnId } });
    if (column?.projectId !== projectId)
      throw invalid('columnId', 'must be a column of this project');
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const member = await this.db.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
    });
    if (!member) throw invalid('assigneeId', 'must be a member of the workspace');
  }

  private async afterWrite<T extends TaskDto | { id: string }>(
    projectId: string,
    type: ServerEventType,
    payload: T,
  ) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
```

**What's new**
- **Merge-patch semantics** come for free from zod + Prisma. A field absent from the JSON is absent from the parsed object, and Prisma ignores `undefined`, so it stays unchanged. A field sent as `null` is `null`, and Prisma writes NULL. The `changes` diff then records only what really changed in the activity log.
- Changing `dueAt` resets `reminderSentAt`, so a moved deadline gets a fresh reminder (Part 11).
- **The move algorithm** is README §7: read `afterTaskId`'s position (`lower`), find the next task in the target column (excluding the one being moved), and take `keyBetween(lower, next)`. One row changes.
- `afterWrite` runs **after** the transaction: invalidate the board cache, then publish the event. Clients never see an event for a write that rolled back.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: tasks service with numbering, filters, moves and merge-patch`

### Step 7.4 · Routes and wiring

**Goal:** Expose the task endpoints and wire the service.

**Files:** `src/modules/tasks/tasks.routes.ts`, `src/container.ts`, `src/app.ts`

**`src/modules/tasks/tasks.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import {
  atLeastOneField,
  Id,
  PageQuery,
  parseBody,
  parseParams,
  parseQuery,
  trimmed,
} from '../../lib/validation.js';
import type { TasksService } from './tasks.service.js';

const Priority = z.enum(['low', 'medium', 'high', 'urgent']);
const Title = trimmed(1, 200);
const Description = z.string().max(10_000).nullable();
const Timestamp = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const ListTasksQuery = PageQuery.extend({
  columnId: Id.optional(),
  assigneeId: z.union([Id, z.literal('none')]).optional(),
  priority: Priority.optional(),
  dueBefore: Timestamp.optional(),
});

const CreateTaskBody = z.object({
  title: Title,
  description: Description.optional(),
  columnId: Id.optional(),
  priority: Priority.default('medium'),
  assigneeId: Id.nullable().optional(),
  dueAt: Timestamp.nullable().optional(),
});
```

**`src/modules/tasks/tasks.routes.ts`** · continue

```ts
const UpdateTaskBody = z
  .object({
    title: Title.optional(),
    description: Description.optional(),
    priority: Priority.optional(),
    assigneeId: Id.nullable().optional(),
    dueAt: Timestamp.nullable().optional(),
  })
  .refine(...atLeastOneField);

const MoveTaskBody = z.object({ columnId: Id, afterTaskId: Id.nullable() });

const ProjectParams = z.object({ projectId: Id });
const TaskParams = z.object({ taskId: Id });
```

**`src/modules/tasks/tasks.routes.ts`** · continue

```ts
export function tasksRoutes(tasks: TasksService): Router {
  const router = Router();

  router
    .route('/projects/:projectId/tasks')
    .get(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const { limit, cursor, ...filters } = parseQuery(ListTasksQuery, req);
      res.json(await tasks.list(projectId, userIdOf(req), filters, limit, cursor));
    })
    .post(async (req, res) => {
      const { projectId } = parseParams(ProjectParams, req);
      const body = parseBody(CreateTaskBody, req);
      res.status(201).json(await tasks.create(projectId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/tasks/:taskId')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      res.json(await tasks.get(taskId, userIdOf(req)));
    })
    .patch(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(UpdateTaskBody, req);
      res.json(await tasks.update(taskId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      await tasks.delete(taskId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);
```

**`src/modules/tasks/tasks.routes.ts`** · continue

```ts
  router
    .route('/tasks/:taskId/move')
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(MoveTaskBody, req);
      res.json(await tasks.move(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  return router;
}
```

**`src/container.ts`** · add after `import { RealtimePublisher } from './modules/realtime/publisher.js';`

```ts
import { TasksService } from './modules/tasks/tasks.service.js';
```

**`src/container.ts`** · add after `columns: new ColumnsService(prisma, access, activity, boardCache, realtime),`

```ts
    tasks: new TasksService(prisma, access, activity, boardCache, realtime, jobs),
```

**`src/app.ts`** · add after `import { projectsRoutes } from './modules/projects/projects.routes.js';`

```ts
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
```

**`src/app.ts`** · add after `api.use(projectsRoutes(services.projects, services.columns));`

```ts
  api.use(tasksRoutes(services.tasks));
```

**What's new**
- `z.iso.datetime({ offset: true }).transform((s) => new Date(s))` accepts ISO-8601 with `Z` or an offset (`+05:30`) and hands the service a `Date`. JSON has no date type, so every API parses timestamps at its edge.
- `const { limit, cursor, ...filters } = parseQuery(...)`: rest destructuring splits the pagination fields from the filters in one line.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** Test numbering under concurrency, moves, caching, merge-patch, filters and permissions.

**Files:** `tests/integration/tasks.test.ts`

**`tests/integration/tasks.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
} from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

interface TaskBody {
  id: string;
  key: string;
  number: number;
  columnId: string;
  position: string;
  title: string;
}

async function createTask(title: string, extra: Record<string, unknown> = {}) {
  const res = await ctx.request
    .post(`/api/v1/projects/${f.projectId}/tasks`)
    .set(f.owner.auth)
    .send({ title, ...extra })
    .expect(201);
  return res.body as TaskBody;
}
```

**`tests/integration/tasks.test.ts`** · continue

```ts
async function boardTitles() {
  const res = await ctx.request
    .get(`/api/v1/projects/${f.projectId}/board`)
    .set(f.owner.auth)
    .expect(200);
  const columns = (res.body as { columns: { name: string; tasks: { title: string }[] }[] }).columns;
  return columns.map((c) => [c.name, c.tasks.map((t) => t.title)]);
}

const move = (taskId: string, columnId: string | undefined, afterTaskId: string | null) =>
  ctx.request
    .post(`/api/v1/tasks/${taskId}/move`)
    .set(f.owner.auth)
    .send({ columnId, afterTaskId });
```

**`tests/integration/tasks.test.ts`** · continue

```ts
describe('tasks', () => {
  it('numbers tasks per project, even under concurrent creates', async () => {
    const tasks = await Promise.all(Array.from({ length: 10 }, (_, i) => createTask(`Task ${i}`)));
    expect(tasks.map((t) => t.number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(tasks.find((t) => t.number === 7)?.key).toBe('TF-7');
  });

  it('appends to the bottom and moves with fractional positions', async () => {
    const a = await createTask('A');
    const b = await createTask('B');
    const c = await createTask('C');
    expect(a.position < b.position && b.position < c.position).toBe(true);

    await move(c.id, f.columnIds[0], null).expect(200); // C to the top of To Do
    await move(a.id, f.columnIds[2], null).expect(200); // A to the top of Done
    const moved = await move(b.id, f.columnIds[2], a.id).expect(200); // B after A
    expect((moved.body as TaskBody).columnId).toBe(f.columnIds[2]);

    expect(await boardTitles()).toEqual([
      ['To Do', ['C']],
      ['In Progress', []],
      ['Done', ['A', 'B']],
    ]);
  });
```

**`tests/integration/tasks.test.ts`** · continue

```ts
  it('validates move targets', async () => {
    const a = await createTask('A');
    const other = await ctx.request
      .post(`/api/v1/workspaces/${f.workspaceId}/projects`)
      .set(f.owner.auth)
      .send({ name: 'Other', key: 'OT' })
      .expect(201);
    const otherBoard = await ctx.request
      .get(`/api/v1/projects/${(other.body as { id: string }).id}/board`)
      .set(f.owner.auth);
    const foreignColumn = (otherBoard.body as { columns: { id: string }[] }).columns[0]?.id;
    const res = await move(a.id, foreignColumn, null).expect(422);
    expect(res.body).toMatchObject({ errors: [{ field: 'columnId' }] });
    await move(a.id, f.columnIds[0], a.id).expect(422);
  });

  it('serves the board from cache and invalidates it on writes', async () => {
    await createTask('Cached');
    await boardTitles();
    expect(await ctx.infra.redis.exists(`cache:board:${f.projectId}`)).toBe(1);
    await createTask('Fresh');
    expect(await ctx.infra.redis.exists(`cache:board:${f.projectId}`)).toBe(0);
    expect((await boardTitles())[0]).toEqual(['To Do', ['Cached', 'Fresh']]);
  });

  it('PATCH uses merge semantics: omitted fields stay, null clears', async () => {
    const t = await createTask('Patch me', {
      description: 'keep',
      dueAt: '2030-01-01T09:00:00Z',
    });
    const res = await ctx.request
      .patch(`/api/v1/tasks/${t.id}`)
      .set(f.owner.auth)
      .send({ dueAt: null, priority: 'high' })
      .expect(200);
    expect(res.body).toMatchObject({
      description: 'keep',
      dueAt: null,
      priority: 'high',
      title: 'Patch me',
    });
  });
```

**`tests/integration/tasks.test.ts`** · continue

```ts
  it('only assigns workspace members, and unassigns them when they leave', async () => {
    const stranger = await registerUser(ctx, 'Stranger');
    const rejected = await ctx.request
      .post(`/api/v1/projects/${f.projectId}/tasks`)
      .set(f.owner.auth)
      .send({ title: 'X', assigneeId: stranger.id })
      .expect(422);
    expect(rejected.body).toMatchObject({ errors: [{ field: 'assigneeId' }] });

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const t = await createTask('Assigned', { assigneeId: member.id });
    await ctx.request
      .delete(`/api/v1/workspaces/${f.workspaceId}/members/${member.id}`)
      .set(member.auth)
      .expect(204);
    const after = await ctx.request.get(`/api/v1/tasks/${t.id}`).set(f.owner.auth).expect(200);
    expect(after.body).toMatchObject({ assignee: null });
  });

  it('filters and paginates the task list newest first', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    for (let i = 1; i <= 5; i++) {
      await createTask(`T${i}`, i % 2 ? { assigneeId: member.id, priority: 'high' } : {});
    }
    const list = (q: string) =>
      ctx.request.get(`/api/v1/projects/${f.projectId}/tasks?${q}`).set(f.owner.auth).expect(200);
    const titles = (res: { body: unknown }) =>
      (res.body as { items: TaskBody[] }).items.map((t) => t.title);

    expect(titles(await list(`assigneeId=${member.id}`))).toEqual(['T5', 'T3', 'T1']);
    expect(titles(await list('assigneeId=none'))).toEqual(['T4', 'T2']);
    expect(titles(await list('priority=high&limit=2'))).toEqual(['T5', 'T3']);
```

**`tests/integration/tasks.test.ts`** · continue

```ts
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list(`limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(res));
      cursor = (res.body as { nextCursor: string | null }).nextCursor;
    } while (cursor);
    expect(seen).toEqual(['T5', 'T4', 'T3', 'T2', 'T1']);
    await ctx.request
      .get(`/api/v1/projects/${f.projectId}/tasks?cursor=garbage`)
      .set(f.owner.auth)
      .expect(422);
  });

  it('lets viewers read but not write, and hides tasks from outsiders', async () => {
    const t = await createTask('Secret');
    const viewer = await registerUser(ctx, 'Viewer');
    const outsider = await registerUser(ctx, 'Outsider');
    await addMember(ctx, f.workspaceId, viewer, 'viewer');
    await ctx.request.get(`/api/v1/tasks/${t.id}`).set(viewer.auth).expect(200);
    await ctx.request
      .patch(`/api/v1/tasks/${t.id}`)
      .set(viewer.auth)
      .send({ title: 'x' })
      .expect(403);
    await ctx.request.get(`/api/v1/tasks/${t.id}`).set(outsider.auth).expect(404);
  });

  it('refuses to delete a column that still has tasks', async () => {
    const t = await createTask('Blocker', { columnId: f.columnIds[1] });
    await ctx.request.delete(`/api/v1/columns/${f.columnIds[1]}`).set(f.owner.auth).expect(409);
    await ctx.request.delete(`/api/v1/tasks/${t.id}`).set(f.owner.auth).expect(204);
    await ctx.request.get(`/api/v1/tasks/${t.id}`).set(f.owner.auth).expect(404);
    await ctx.request.delete(`/api/v1/columns/${f.columnIds[1]}`).set(f.owner.auth).expect(204);
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/integration/tasks.test.ts
```

Expected: `Tests  9 passed (9)`. The first test fires ten creates in parallel and checks that the numbers are exactly 1–10.

**Commit:** `feat: tasks with per-project numbering, moves, filters and merge-patch`

---

## Part 8 · Comments, activity feed & search

### Step 8.1 · Comments

**Goal:** Comment on tasks: oldest first, author-only edits, author-or-admin deletes.

**Files:** `src/modules/comments/comments.service.ts`, `src/modules/comments/comments.routes.ts`

**`src/modules/comments/comments.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { forbidden } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const toComment = (c: {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

const include = { author: { select: userSummarySelect } } as const;

export class CommentsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly realtime: RealtimePublisher,
  ) {}
```

**`src/modules/comments/comments.service.ts`** · continue

```ts
  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.comment.findMany({
      where: { taskId, ...(after ? { id: { gt: after } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
      include,
    });
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }
```

**`src/modules/comments/comments.service.ts`** · continue

```ts
  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.db.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: { taskId, authorId: userId, body },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return toComment(created);
    });
    await this.realtime.publish(project.id, 'comment.created', { projectId: project.id, comment });
    return comment;
  }
```

**`src/modules/comments/comments.service.ts`** · continue

```ts
  async update(commentId: string, userId: string, body: string) {
    const { comment, project } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId) throw forbidden('Only the author can edit a comment');
    return this.db.$transaction(async (tx) => {
      const updated = await tx.comment.update({
        where: { id: commentId },
        data: { body },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return toComment(updated);
    });
  }

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.db.$transaction(async (tx) => {
      await tx.comment.delete({ where: { id: commentId } });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.deleted',
        data: { commentId },
      });
    });
  }
}
```

**`src/modules/comments/comments.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import type { CommentsService } from './comments.service.js';

const CommentBody = z.object({ body: z.string().min(1).max(5000) });
const TaskParams = z.object({ taskId: Id });
const CommentParams = z.object({ commentId: Id });

export function commentsRoutes(comments: CommentsService): Router {
  const router = Router();

  router
    .route('/tasks/:taskId/comments')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await comments.list(taskId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { body } = parseBody(CommentBody, req);
      res.status(201).json(await comments.create(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/comments/:commentId')
    .patch(async (req, res) => {
      const { commentId } = parseParams(CommentParams, req);
      const { body } = parseBody(CommentBody, req);
      res.json(await comments.update(commentId, userIdOf(req), body));
    })
    .delete(async (req, res) => {
      const { commentId } = parseParams(CommentParams, req);
      await comments.delete(commentId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- Comments are listed **oldest first** (`id > cursor ORDER BY id ASC`), unlike the newest-first lists so far. The same keyset technique works in either direction.
- The `comment.created` event is published after the transaction. Its payload carries `projectId`, because WebSocket subscriptions are per project (Part 10).
- Authorization isn't only a role: "only the author may edit" compares `comment.authorId` with the caller. Roles answer "what may you do here?", ownership answers "is this yours?".


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: comments`

### Step 8.2 · The activity feed

**Goal:** Read the audit log back as a paginated, filterable feed.

**Files:** `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.routes.ts`

**`src/modules/activity/activity.service.ts`** · new file

```ts
import type { PrismaClient } from '../../generated/prisma/client.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { toUserSummary } from '../users/users.dto.js';
import type { Access } from '../workspaces/access.js';
import type { ActivityRepository } from './activity.repository.js';

export class ActivityService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    filter: { projectId?: string | undefined; taskId?: string | undefined },
    limit: number,
    cursor?: string,
  ) {
    await this.access.member(workspaceId, userId);
    const afterId = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.activity.list(this.db, { workspaceId, ...filter }, { limit, afterId });
    return toPage(
      rows,
      limit,
      (e) => ({
        id: e.id,
        workspaceId: e.workspaceId,
        projectId: e.projectId,
        taskId: e.taskId,
        actor: toUserSummary(e.actor),
        type: e.type,
        data: e.data,
        createdAt: e.createdAt.toISOString(),
      }),
      (e) => ({ id: e.id }),
    );
  }
}
```

**`src/modules/activity/activity.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseParams, parseQuery } from '../../lib/validation.js';
import type { ActivityService } from './activity.service.js';

const WorkspaceParams = z.object({ workspaceId: Id });
const ActivityQuery = PageQuery.extend({ projectId: Id.optional(), taskId: Id.optional() });

export function activityRoutes(activity: ActivityService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/activity')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { limit, cursor, ...filter } = parseQuery(ActivityQuery, req);
      res.json(await activity.list(workspaceId, userIdOf(req), filter, limit, cursor));
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- Since Part 5, every service has written an event *inside* its transaction. This endpoint just reads them back, newest first, optionally filtered to one project or task. The partial indexes `activity_project_idx` and `activity_task_idx` serve those filters.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: activity feed`

### Step 8.3 · Full-text search

**Goal:** Rank tasks by relevance with Postgres full-text search and return safe, highlighted snippets.

**Files:** `src/modules/search/search.service.ts`, `src/modules/search/search.routes.ts`, `tests/unit/headline.test.ts`

**`src/modules/search/search.service.ts`** · new file

```ts
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { decodeCursor, RankCursor, toPage } from '../../lib/cursor.js';
import { taskInclude, toTask } from '../projects/projects.dto.js';
import type { Access } from '../workspaces/access.js';

// ts_headline can't HTML-escape, so we mark matches with control characters,
// escape the whole snippet ourselves, then swap the markers for <mark> tags.
const START = '\u0001';
const STOP = '\u0002';

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const toSafeHeadline = (raw: string) =>
  escapeHtml(raw).replaceAll(START, '<mark>').replaceAll(STOP, '</mark>');

interface Hit {
  id: string;
  rank: number;
  headline: string;
}

export class SearchService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
  ) {}
```

**`src/modules/search/search.service.ts`** · continue

```ts
  async search(workspaceId: string, userId: string, q: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(RankCursor, cursor) : undefined;
    // rank is a float4 (`real`); casting the cursor value back to real makes the
    // row comparison exact, because JSON carries the shortest round-tripping decimal.
    const afterClause = after
      ? Prisma.sql`AND (ts_rank(t.search_vector, query), t.id) < (${after.rank}::real, ${after.id}::uuid)`
      : Prisma.empty;
    const hits = await this.db.$queryRaw<Hit[]>`
      SELECT t.id,
             ts_rank(t.search_vector, query) AS rank,
             ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query,
                         ${`StartSel=${START}, StopSel=${STOP}`}) AS headline
      FROM tasks t
      JOIN projects p ON p.id = t.project_id,
           websearch_to_tsquery('english', ${q}) AS query
      WHERE p.workspace_id = ${workspaceId}::uuid
        AND t.search_vector @@ query
        ${afterClause}
      ORDER BY rank DESC, t.id DESC
      LIMIT ${limit + 1}`;

    const tasks = await this.db.task.findMany({
      where: { id: { in: hits.map((h) => h.id) } },
      include: taskInclude,
    });
    const byId = new Map(tasks.map((t) => [t.id, toTask(t)]));
    const rows = hits.flatMap((h) => {
      const task = byId.get(h.id);
      return task ? [{ task, rank: h.rank, headline: toSafeHeadline(h.headline) }] : [];
    });
    return toPage(
      rows,
      limit,
      (r) => r,
      (r) => ({ rank: r.rank, id: r.task.id }),
    );
  }
}
```

**`src/modules/search/search.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseParams, parseQuery } from '../../lib/validation.js';
import type { SearchService } from './search.service.js';

const WorkspaceParams = z.object({ workspaceId: Id });
const SearchQuery = PageQuery.extend({ q: z.string().min(1).max(200) });

export function searchRoutes(search: SearchService): Router {
  const router = Router();

  router
    .route('/workspaces/:workspaceId/search')
    .get(async (req, res) => {
      const { workspaceId } = parseParams(WorkspaceParams, req);
      const { q, limit, cursor } = parseQuery(SearchQuery, req);
      res.json(await search.search(workspaceId, userIdOf(req), q, limit, cursor));
    })
    .all(methodNotAllowed);

  return router;
}
```

**`tests/unit/headline.test.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { toSafeHeadline } from '../../src/modules/search/search.service.js';

describe('toSafeHeadline', () => {
  it('escapes HTML but keeps match markers as <mark>', () => {
    const raw = '<script>alert(1)</script> fix \u0001login\u0002 & "logout"';
    expect(toSafeHeadline(raw)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt; fix <mark>login</mark> &amp; &quot;logout&quot;',
    );
  });
});
```

**What's new**
- **`Prisma.sql` and `Prisma.empty`** build a SQL fragment with bind parameters that you can splice into a `$queryRaw` template. Here it's the optional cursor condition, so dynamic SQL stays injection-safe.
- `websearch_to_tsquery('english', q)` parses the search box like a search engine: words are ANDed, `"quoted phrases"`, `or`, `-exclude`. It never raises a syntax error on user input, unlike `to_tsquery`.
- **Why the `\u0001`/`\u0002` markers:** `ts_headline` returns the matched text with markers around hits, but it doesn't escape HTML, and the text is user input. We let it mark matches with control characters, HTML-escape the whole string ourselves, *then* turn the markers into `<mark>` tags. The result is safe to render.

> **🧠 DSA & scalability · full-text search**
> - **Data structure:** a GIN **inverted index** on the generated `tsvector` column. Each lexeme (`login`, `redirect`) maps to the list of rows containing it.
> - **Algorithm:** the query is parsed into lexemes (stemmed: `redirects` → `redirect`), then GIN looks up each lexeme's posting list and intersects them. `ts_rank` scores each match, and title words (weight `A`) count more than description words (`B`).
> - **Complexity:** roughly O(log V + m) for V distinct words and m matching rows, instead of the O(n) table scan of `ILIKE '%login%'`, which can't use a B-tree.
> - **Pagination by rank:** the cursor is `(rank, id)` and the condition is a **row comparison** `(rank, id) < ($rank, $id)`. `rank` is a `real` (float4), so the cursor value is cast back with `::real`. JSON carries the shortest decimal that round-trips, so the comparison is exact (README §8).
> - **Rejected:** `ILIKE` (no index, no stemming, no ranking); a search engine like OpenSearch (another cluster to run; Postgres FTS covers this scale).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: full-text search`

### Step 8.4 · Wiring and tests

**Goal:** Wire comments, activity and search, and test them.

**Files:** `src/container.ts`, `src/app.ts`, `tests/integration/collaboration.test.ts`

**`src/container.ts`** · add after `import { ActivityRepository } from './modules/activity/activity.repository.js';`

```ts
import { ActivityService } from './modules/activity/activity.service.js';
```

**`src/container.ts`** · add after `import { RefreshTokens } from './modules/auth/refresh-tokens.js';`

```ts
import { CommentsService } from './modules/comments/comments.service.js';
```

**`src/container.ts`** · add after `import { RealtimePublisher } from './modules/realtime/publisher.js';`

```ts
import { SearchService } from './modules/search/search.service.js';
```

**`src/container.ts`** · add after `tasks: new TasksService(prisma, access, activity, boardCache, realtime, jobs),`

```ts
    comments: new CommentsService(prisma, access, activity, realtime),
```

**`src/container.ts`** · add after `comments: new CommentsService(prisma, access, activity, realtime),`

```ts
    activity: new ActivityService(prisma, access, activity),
    search: new SearchService(prisma, access),
```

**`src/app.ts`** · add after `import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';`

```ts
import { activityRoutes } from './modules/activity/activity.routes.js';
```

**`src/app.ts`** · add after `import { authRoutes } from './modules/auth/auth.routes.js';`

```ts
import { commentsRoutes } from './modules/comments/comments.routes.js';
```

**`src/app.ts`** · add after `import { projectsRoutes } from './modules/projects/projects.routes.js';`

```ts
import { searchRoutes } from './modules/search/search.routes.js';
```

**`src/app.ts`** · add after `api.use(tasksRoutes(services.tasks));`

```ts
  api.use(commentsRoutes(services.comments));
```

**`src/app.ts`** · add after `api.use(commentsRoutes(services.comments));`

```ts
  api.use(activityRoutes(services.activity));
  api.use(searchRoutes(services.search));
```

**`tests/integration/collaboration.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
} from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function createTask(title: string, description?: string) {
  const res = await ctx.request
    .post(`/api/v1/projects/${f.projectId}/tasks`)
    .set(f.owner.auth)
    .send({ title, description })
    .expect(201);
  return (res.body as { id: string }).id;
}

describe('comments', () => {
  it('lists oldest first; only the author edits; author or admin deletes', async () => {
    const taskId = await createTask('Discuss me');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const url = `/api/v1/tasks/${taskId}/comments`;
    const first = await ctx.request.post(url).set(member.auth).send({ body: 'first' }).expect(201);
    await ctx.request.post(url).set(f.owner.auth).send({ body: 'second' }).expect(201);
    const firstId = (first.body as { id: string }).id;

    const list = await ctx.request.get(url).set(member.auth).expect(200);
    const bodies = (list.body as { items: { body: string }[] }).items.map((c) => c.body);
    expect(bodies).toEqual(['first', 'second']);
```

**`tests/integration/collaboration.test.ts`** · continue

```ts
    await ctx.request
      .patch(`/api/v1/comments/${firstId}`)
      .set(f.owner.auth)
      .send({ body: 'hijack' })
      .expect(403);
    const edited = await ctx.request
      .patch(`/api/v1/comments/${firstId}`)
      .set(member.auth)
      .send({ body: 'edited' })
      .expect(200);
    expect(edited.body).toMatchObject({ body: 'edited', author: { id: member.id } });
    await ctx.request.delete(`/api/v1/comments/${firstId}`).set(f.owner.auth).expect(204);
  });
});
```

**`tests/integration/collaboration.test.ts`** · continue

```ts
describe('activity', () => {
  it('records every change in the same transaction, newest first', async () => {
    const taskId = await createTask('Doomed');
    await ctx.request.delete(`/api/v1/tasks/${taskId}`).set(f.owner.auth).expect(204);
    const forTask = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/activity?taskId=${taskId}`)
      .set(f.owner.auth)
      .expect(200);
    const types = (forTask.body as { items: { type: string }[] }).items.map((e) => e.type);
    expect(types).toEqual(['task.deleted', 'task.created']);

    const all = await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/activity?limit=100`)
      .set(f.owner.auth)
      .expect(200);
    const allTypes = (all.body as { items: { type: string }[] }).items.map((e) => e.type);
    expect(allTypes.at(-1)).toBe('workspace.created');
  });
});

describe('search', () => {
  it('ranks title matches first, escapes headlines, and pages by (rank, id)', async () => {
    await createTask('Write docs', 'Explain the <b>login</b> flow');
    await createTask('Fix login redirect', 'Users bounce back');
    await createTask('Unrelated', 'Nothing here');

    const url = `/api/v1/workspaces/${f.workspaceId}/search`;
    const res = await ctx.request.get(url).query({ q: 'login' }).set(f.owner.auth).expect(200);
    const hits = (res.body as { items: { task: { title: string }; headline: string }[] }).items;
    expect(hits.map((h) => h.task.title)).toEqual(['Fix login redirect', 'Write docs']);
    // Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    expect(hits[1]?.headline).toContain('<mark>login</mark>');
    expect(hits[1]?.headline).not.toContain('<b>');
```

**`tests/integration/collaboration.test.ts`** · continue

```ts
    const page1 = await ctx.request
      .get(url)
      .query({ q: 'login', limit: 1 })
      .set(f.owner.auth)
      .expect(200);
    const cursor = (page1.body as { nextCursor: string }).nextCursor;
    const page2 = await ctx.request
      .get(url)
      .query({ q: 'login', limit: 1, cursor })
      .set(f.owner.auth)
      .expect(200);
    const body2 = page2.body as { items: { task: { title: string } }[]; nextCursor: null };
    expect(body2.items[0]?.task.title).toBe('Write docs');
    expect(body2.nextCursor).toBeNull();
  });

  it('only searches workspaces the caller belongs to', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    await ctx.request
      .get(`/api/v1/workspaces/${f.workspaceId}/search?q=docs`)
      .set(outsider.auth)
      .expect(404);
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/unit/headline.test.ts tests/integration/collaboration.test.ts
```

Expected: `Test Files  2 passed (2)` and `Tests  5 passed (5)`.

**Commit:** `feat: comments, activity feed and full-text search`

---

## Part 9 · Attachments (presigned S3 uploads)

File bytes never pass through the API. The API hands out short-lived **presigned URLs**: the browser `PUT`s the file straight to S3, then tells the API it's done (README §12 has the sequence diagram).

### Step 9.1 · The storage wrapper

**Goal:** presign uploads and downloads, check an object's size, and delete a whole prefix.

**Files:** `src/infra/storage.ts`

```bash
npm i -E @aws-sdk/client-s3@3.1160.0 @aws-sdk/s3-request-presigner@3.1160.0
```

**`src/infra/storage.ts`** · new file

```ts
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config.js';

type StorageConfig = Pick<
  Config,
  | 'S3_ENDPOINT'
  | 'S3_PUBLIC_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY'
  | 'S3_SECRET_KEY'
>;

export class Storage {
  private readonly internal: S3Client;
  // Signatures cover the host, so URLs for the browser must be signed with the public endpoint.
  private readonly presigner: S3Client;
  private readonly bucket: string;

  constructor(config: StorageConfig) {
    const base = {
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: config.S3_ENDPOINT });
    this.presigner = new S3Client({ ...base, endpoint: config.S3_PUBLIC_ENDPOINT });
    this.bucket = config.S3_BUCKET;
  }
```

**`src/infra/storage.ts`** · continue

```ts
  presignUpload(key: string, contentType: string, sizeBytes: number, expiresIn: number) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    });
    return getSignedUrl(this.presigner, command, { expiresIn });
  }
```

**`src/infra/storage.ts`** · continue

```ts
  presignDownload(key: string, fileName: string, expiresIn: number) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
    return getSignedUrl(this.presigner, command, { expiresIn });
  }

  /** The stored object's size, or null if it doesn't exist. */
  async sizeOf(key: string): Promise<number | null> {
    try {
      const head = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return head.ContentLength ?? null;
    } catch (err) {
      if (err instanceof NotFound) return null;
      throw err;
    }
  }

  /** Deletes every object under a prefix, 1000 keys per request (the S3 maximum). */
  async deletePrefix(prefix: string): Promise<number> {
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.internal.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      const objects = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (objects.length > 0) {
        await this.internal.send(
          new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }),
        );
        deleted += objects.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
```

**What's new**
- **AWS SDK v3 is modular and command-based:** you create one `S3Client` and `send(new SomeCommand({...}))`. You install only the clients you use, which keeps bundles small.
- **`forcePathStyle: true`** puts the bucket in the path (`http://host:9000/taskflow-attachments/key`) instead of a subdomain (`taskflow-attachments.host`), which local S3 servers need.
- **Two clients, two endpoints.** A presigned URL's signature covers the **host**. Inside Docker, the API reaches S3 at `http://rustfs:9000`, but the browser can only reach `http://localhost:19001`. Server-side calls use `S3_ENDPOINT`, and URLs for the browser are signed with `S3_PUBLIC_ENDPOINT`.
- `ContentLength: sizeBytes` is part of the upload signature, so S3 itself rejects a file of any other size. The test in Step 9.3 proves it.
- `err instanceof NotFound`: the SDK throws typed errors, so "object doesn't exist" is a class check, not string matching.

> **🧠 DSA & scalability · deleting a prefix**
> - **Data structure:** S3 has no folders, just a flat, sorted key space. "A folder" is a **key prefix** such as `projects/{id}/`, and that's why our storage keys are hierarchical.
> - **Algorithm:** `ListObjectsV2(prefix)` returns up to 1,000 keys per page plus a continuation token, then one `DeleteObjects` per page (also capped at 1,000).
> - **Complexity:** O(n / 1000) round trips for n objects. Memory O(1000).
> - **Why it scales:** deleting a project with 50,000 files is 50 list calls plus 50 batch deletes, run in a background job (Part 11), never in the HTTP request.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: s3 storage wrapper`

### Step 9.2 · The attachments service and routes

**Goal:** Start an upload, confirm it, download it and delete it, enforcing who may do what.

**Files:** `src/modules/attachments/attachments.service.ts`, `src/modules/attachments/attachments.routes.ts`

**`src/modules/attachments/attachments.service.ts`** · new file

```ts
import { v7 as uuidv7 } from 'uuid';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Storage } from '../../infra/storage.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummarySelect } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

const toAttachment = (a: {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: bigint;
  status: string;
  createdAt: Date;
}) => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: Number(a.sizeBytes),
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});

const include = { uploader: { select: userSummarySelect } } as const;
const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts
export class AttachmentsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.attachment.findMany({
      where: { taskId, status: 'ready', ...(after ? { id: { lt: after } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include,
    });
    return toPage(rows, limit, toAttachment, (a) => ({ id: a.id }));
  }
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts
  async create(
    taskId: string,
    userId: string,
    input: { fileName: string; contentType: string; sizeBytes: number },
  ) {
    const { project } = await this.access.task(taskId, userId, 'member');
    // The id is generated here (not by the database) because the storage key needs it.
    const id = uuidv7();
    const storageKey = `projects/${project.id}/tasks/${taskId}/${id}`;
    const attachment = await this.db.attachment.create({
      data: {
        id,
        taskId,
        uploaderId: userId,
        storageKey,
        ...input,
        sizeBytes: BigInt(input.sizeBytes),
      },
      include,
    });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: toAttachment(attachment),
      upload: {
        url,
        method: 'PUT' as const,
        headers: { 'Content-Type': input.contentType },
        expiresAt: expiresAt(UPLOAD_URL_TTL),
      },
    };
  }
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts
  async complete(attachmentId: string, userId: string) {
    const { attachment, project } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId)
      throw forbidden('Only the uploader can complete an upload');
    if (attachment.status === 'ready') {
      return toAttachment(
        await this.db.attachment.findUniqueOrThrow({ where: { id: attachmentId }, include }),
      );
    }
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (BigInt(size) !== attachment.sizeBytes)
      throw conflict('The uploaded file size does not match');
    return this.db.$transaction(async (tx) => {
      const ready = await tx.attachment.update({
        where: { id: attachmentId },
        data: { status: 'ready' },
        include,
      });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return toAttachment(ready);
    });
  }
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts
  async download(attachmentId: string, userId: string) {
    const { attachment } = await this.access.attachment(attachmentId, userId);
    if (attachment.status !== 'ready') throw notFound('Attachment');
    const url = await this.storage.presignDownload(
      attachment.storageKey,
      attachment.fileName,
      DOWNLOAD_URL_TTL,
    );
    return { url, expiresAt: expiresAt(DOWNLOAD_URL_TTL) };
  }

  async delete(attachmentId: string, userId: string) {
    const { attachment, project, membership } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the uploader or an admin can delete an attachment');
    }
    await this.db.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: attachmentId } });
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.deleted',
        data: { attachmentId, fileName: attachment.fileName },
      });
    });
    await this.jobs.enqueue('delete-storage-prefix', { prefix: attachment.storageKey });
  }
}
```

**`src/modules/attachments/attachments.routes.ts`** · new file

```ts
import { Router } from 'express';
import { z } from 'zod';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import { Id, PageQuery, parseBody, parseParams, parseQuery } from '../../lib/validation.js';
import type { AttachmentsService } from './attachments.service.js';

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const SAFE_FILE_NAME = /^[^/\\\x00-\x1f]+$/;

const CreateAttachmentBody = z.object({
  fileName: z
    .string()
    .min(1)
    .max(255)
    .regex(SAFE_FILE_NAME, 'must not contain slashes or control characters'),
  contentType: z
    .string()
    .min(3)
    .max(127)
    .regex(
      /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/,
      'must be a lowercase media type',
    ),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(25 * 1024 * 1024),
});

const TaskParams = z.object({ taskId: Id });
const AttachmentParams = z.object({ attachmentId: Id });
```

**`src/modules/attachments/attachments.routes.ts`** · continue

```ts
export function attachmentsRoutes(attachments: AttachmentsService): Router {
  const router = Router();

  router
    .route('/tasks/:taskId/attachments')
    .get(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const { limit, cursor } = parseQuery(PageQuery, req);
      res.json(await attachments.list(taskId, userIdOf(req), limit, cursor));
    })
    .post(async (req, res) => {
      const { taskId } = parseParams(TaskParams, req);
      const body = parseBody(CreateAttachmentBody, req);
      res.status(201).json(await attachments.create(taskId, userIdOf(req), body));
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId')
    .delete(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      await attachments.delete(attachmentId, userIdOf(req));
      res.status(204).end();
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId/complete')
    .post(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      res.json(await attachments.complete(attachmentId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  router
    .route('/attachments/:attachmentId/download')
    .get(async (req, res) => {
      const { attachmentId } = parseParams(AttachmentParams, req);
      res.json(await attachments.download(attachmentId, userIdOf(req)));
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- **The ID is generated in the app** (`uuidv7()` from the `uuid` package) because the storage key `projects/{p}/tasks/{t}/{attachmentId}` must exist *before* the INSERT. That's the README's reason for app-side UUIDv7.
- **The user's file name is never part of the key**, so `../../etc/passwd` can't escape the prefix. The original name comes back on download through `Content-Disposition: attachment; filename*=UTF-8''…`, RFC 5987 encoding for non-ASCII names.
- `BigInt(size) !== attachment.sizeBytes`: `size_bytes` is a Postgres `bigint`, so Prisma returns a JavaScript `bigint`, and a `bigint` and a `number` are never `===`. `Number(a.sizeBytes)` in the DTO converts it for JSON (`JSON.stringify` throws on bigint).
- `SAFE_FILE_NAME` contains control characters on purpose, and the `eslint-disable-next-line no-control-regex` comment says so, with a reason.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: attachments service and routes`

### Step 9.3 · Wiring and tests

**Goal:** Wire attachments and test a real upload to S3.

**Files:** `src/container.ts`, `src/app.ts`, `tests/global-setup.ts`, `tests/integration/attachments.test.ts`

**`src/container.ts`** · add after `import { createRedis } from './infra/redis.js';`

```ts
import { Storage } from './infra/storage.js';
```

**`src/container.ts`** · add after `import { ActivityService } from './modules/activity/activity.service.js';`

```ts
import { AttachmentsService } from './modules/attachments/attachments.service.js';
```

**`src/container.ts`** · add after `redis: Redis;`

```ts
  storage: Storage;
```

**`src/container.ts`** · add after `redis,`

```ts
    storage: new Storage(config),
```

**`src/container.ts`** · add after `comments: new CommentsService(prisma, access, activity, realtime),`

```ts
    attachments: new AttachmentsService(prisma, access, activity, infra.storage, jobs),
```

**`src/app.ts`** · add after `import { activityRoutes } from './modules/activity/activity.routes.js';`

```ts
import { attachmentsRoutes } from './modules/attachments/attachments.routes.js';
```

**`src/app.ts`** · add after `api.use(commentsRoutes(services.comments));`

```ts
  api.use(attachmentsRoutes(services.attachments));
```

The test setup now also makes sure the bucket exists (CI has no `s3-init` job):

**`tests/global-setup.ts`** · add after `import { execFileSync } from 'node:child_process';`

```ts
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
```

**`tests/global-setup.ts`** · add after `import pg from 'pg';`

```ts
import { loadConfig } from '../src/config.js';
```

**`tests/global-setup.ts`** · add after `});`

```ts

  const config = loadConfig({ ...process.env, ...testEnv });
  const s3 = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
  }
  s3.destroy();
```

**`tests/integration/attachments.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, createTestContext, resetState, type Fixture } from '../helpers.js';

const ctx = createTestContext();
let f: Fixture;
let taskId: string;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
  const task = await ctx.request
    .post(`/api/v1/projects/${f.projectId}/tasks`)
    .set(f.owner.auth)
    .send({ title: 'Has files' })
    .expect(201);
  taskId = (task.body as { id: string }).id;
});
afterAll(() => ctx.close());

interface Created {
  attachment: { id: string; status: string };
  upload: { url: string; method: string; headers: Record<string, string> };
}

const start = (body: Record<string, unknown>) =>
  ctx.request.post(`/api/v1/tasks/${taskId}/attachments`).set(f.owner.auth).send(body);

describe('attachments', () => {
```

**`tests/integration/attachments.test.ts`** · continue

```ts
  it('uploads straight to S3 with a presigned URL, then completes and downloads', async () => {
    const content = 'hello attachment';
    const created = await start({
      fileName: 'notes résumé.txt',
      contentType: 'text/plain',
      sizeBytes: content.length,
    }).expect(201);
    const { attachment, upload } = created.body as Created;
    expect(attachment.status).toBe('pending');
    expect(upload.method).toBe('PUT');

    // Completing before the bytes exist is a conflict.
    await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(409);

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(put.status).toBe(200);

    const done = await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(200);
    expect(done.body).toMatchObject({ status: 'ready', sizeBytes: content.length });

    const list = await ctx.request
      .get(`/api/v1/tasks/${taskId}/attachments`)
      .set(f.owner.auth)
      .expect(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);
```

**`tests/integration/attachments.test.ts`** · continue

```ts
    const download = await ctx.request
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(f.owner.auth)
      .expect(200);
    const file = await fetch((download.body as { url: string }).url);
    expect(await file.text()).toBe(content);
    expect(file.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt",
    );

    await ctx.request.delete(`/api/v1/attachments/${attachment.id}`).set(f.owner.auth).expect(204);
    await ctx.request
      .get(`/api/v1/attachments/${attachment.id}/download`)
      .set(f.owner.auth)
      .expect(404);
  });

  it('refuses uploads whose size differs from what was declared', async () => {
    const created = await start({ fileName: 'a.txt', contentType: 'text/plain', sizeBytes: 5 });
    const { attachment, upload } = created.body as Created;
    // The signed Content-Length makes S3 itself reject a different size.
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: 'way too long',
    });
    expect(put.ok).toBe(false);
    await ctx.request
      .post(`/api/v1/attachments/${attachment.id}/complete`)
      .set(f.owner.auth)
      .expect(409);
  });

  it('validates file metadata', async () => {
    const res = await start({
      fileName: '../etc/passwd',
      contentType: 'Text/Plain',
      sizeBytes: 30 * 1024 * 1024,
    }).expect(422);
    const fields = (res.body as { errors: { field: string }[] }).errors.map((e) => e.field).sort();
    expect(fields).toEqual(['contentType', 'fileName', 'sizeBytes']);
  });
});
```

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/integration/attachments.test.ts
```

Expected: `Tests  3 passed (3)`. The first test really uploads a file to RustFS with `fetch`, and you can see it in the RustFS console at http://localhost:19101 (login `taskflow` / `taskflow-secret`) until the test deletes it.

**Commit:** `feat: attachments via presigned S3 uploads`

---

## Part 10 · Real-time (WebSockets, Pub/Sub, presence)

Since Part 6, every write has `PUBLISH`ed an event to Redis channel `project:{id}`, and nobody was listening. Now we add the listener: a WebSocket gateway that authenticates with a ticket, lets clients subscribe to projects, relays events, and tracks who's viewing each board. README §9 defines the protocol.

### Step 10.1 · Tickets and presence

**Goal:** Issue single-use WebSocket tickets and track who is viewing each board.

**Files:** `src/modules/realtime/tickets.ts`, `src/modules/realtime/presence.ts`, `src/modules/realtime/realtime.routes.ts`

**`src/modules/realtime/tickets.ts`** · new file

```ts
import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

const TTL_SECONDS = 30;
const key = (ticket: string) => `ws:ticket:${ticket}`;

/** Browsers can't send Authorization on a WebSocket handshake, so they trade a JWT for a ticket. */
export class Tickets {
  constructor(private readonly redis: Redis) {}

  async issue(userId: string) {
    const ticket = randomBytes(32).toString('base64url');
    await this.redis.set(key(ticket), userId, 'EX', TTL_SECONDS);
    return { ticket, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000).toISOString() };
  }

  /** Single use: GETDEL reads and deletes atomically. */
  redeem(ticket: string): Promise<string | null> {
    return this.redis.getdel(key(ticket));
  }
}
```

**`src/modules/realtime/presence.ts`** · new file

```ts
import type { Redis } from 'ioredis';
import { toUserSummary, type UserSummaryDto } from '../users/users.dto.js';
import type { UsersRepository } from '../users/users.repository.js';

const STALE_AFTER_MS = 60_000;
const KEY_TTL_SECONDS = 300;
const key = (projectId: string) => `presence:project:${projectId}`;
const member = (userId: string, connectionId: string) => `${userId}:${connectionId}`;

/**
 * Sorted set per project: member = "userId:connectionId", score = last seen (ms).
 * One user with two tabs has two members, so closing one tab doesn't hide them.
 */
export class Presence {
  constructor(
    private readonly redis: Redis,
    private readonly users: UsersRepository,
  ) {}

  async touch(
    projectId: string,
    userId: string,
    connectionId: string,
    now = Date.now(),
  ): Promise<void> {
    await this.redis
      .multi()
      .zadd(key(projectId), now, member(userId, connectionId))
      .expire(key(projectId), KEY_TTL_SECONDS)
      .exec();
  }

  async leave(projectId: string, userId: string, connectionId: string): Promise<void> {
    await this.redis.zrem(key(projectId), member(userId, connectionId));
  }

  async online(projectId: string, now = Date.now()): Promise<UserSummaryDto[]> {
    await this.redis.zremrangebyscore(key(projectId), '-inf', String(now - STALE_AFTER_MS));
    const members = await this.redis.zrange(key(projectId), '0', '-1');
    const userIds = [...new Set(members.map((m) => m.slice(0, m.indexOf(':'))))];
    if (userIds.length === 0) return [];
    const users = await this.users.findSummaries(userIds);
    return users.map(toUserSummary).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
```

**`src/modules/realtime/realtime.routes.ts`** · new file

```ts
import { Router } from 'express';
import { userIdOf } from '../../http/auth.js';
import { methodNotAllowed } from '../../http/middleware.js';
import type { Tickets } from './tickets.js';

export function realtimeRoutes(tickets: Tickets): Router {
  const router = Router();

  router
    .route('/ws/ticket')
    .post(async (req, res) => {
      res.status(201).json(await tickets.issue(userIdOf(req)));
    })
    .all(methodNotAllowed);

  return router;
}
```

**What's new**
- **Why a ticket?** The browser's `WebSocket` API can't set headers, so there's no `Authorization: Bearer` on the handshake. Putting the long-lived JWT in the URL would leak it into proxy and access logs. A ticket is useless after 30 seconds, and after its first use.
- `GETDEL` (Redis 6.2+) reads and deletes in one atomic command, so two connections can't share a ticket.
- ioredis 6's types want **strings** for score arguments (`String(now - STALE_AFTER_MS)`, `'0'`, `'-1'`), which is how they go over the wire anyway.

> **🧠 DSA & scalability · presence**
> - **Data structure:** a Redis **sorted set** per project: member `userId:connectionId`, score = last-seen time in ms.
> - **Algorithm:** subscribe / `ping` → `ZADD` (refreshes the score); unsubscribe / close → `ZREM`; read → `ZREMRANGEBYSCORE -inf (now − 60 s)` to evict connections that died without a goodbye, `ZRANGE` to list the rest, then dedupe by user ID.
> - **Complexity:** O(log n) per heartbeat and O(log n + k) per read, for n connections watching a project.
> - **Why one member per connection:** with one member per *user*, closing one of two tabs would mark you offline.
> - **Rejected:** a Redis **set** plus one TTL key per user (set members can't expire individually, so you'd scan the TTL keys); in-memory maps (each instance would see only its own connections).


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: websocket tickets and presence`

### Step 10.2 · The WebSocket gateway

**Goal:** authenticate the upgrade, validate client messages, subscribe to Redis channels on demand, relay events, and keep presence up to date.

**Files:** `src/modules/realtime/gateway.ts`

```bash
npm i -E ws@8.22.0
npm i -D -E @types/ws@8.18.2
```

**`src/modules/realtime/gateway.ts`** · new file

```ts
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { v7 as uuidv7 } from 'uuid';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { z } from 'zod';
import { ProblemError } from '../../lib/problem.js';
import type { Access } from '../workspaces/access.js';
import type { Presence } from './presence.js';
import { envelope, projectChannel, type RealtimePublisher } from './publisher.js';
import type { Tickets } from './tickets.js';

const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), payload: z.object({ projectId: z.guid() }) }),
  z.object({ type: z.literal('unsubscribe'), payload: z.object({ projectId: z.guid() }) }),
  z.object({ type: z.literal('ping') }),
]);

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BAD_MESSAGES = 4400;
const CLOSE_GOING_AWAY = 1001;
const MAX_BAD_MESSAGES = 10;
const IDLE_TIMEOUT_MS = 75_000;

interface Client {
  ws: WebSocket;
  userId: string;
  connectionId: string;
  projects: Set<string>;
  lastSeen: number;
  badMessages: number;
}
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
export class RealtimeGateway {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  /** projectId → this instance's sockets watching it. */
  private readonly local = new Map<string, Set<Client>>();
  private readonly clients = new WeakMap<WebSocket, Client>();
  private readonly reaper: NodeJS.Timeout;

  constructor(
    private readonly subscriber: Redis,
    private readonly tickets: Tickets,
    private readonly access: Access,
    private readonly presence: Presence,
    private readonly publisher: RealtimePublisher,
    private readonly logger: Logger,
  ) {
    this.subscriber.on('message', (channel: string, message: string) => {
      const projectId = channel.slice('project:'.length);
      for (const client of this.local.get(projectId) ?? []) send(client, message);
    });
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
      for (const client of this.wss.clients) {
        const c = this.clients.get(client);
        if (c && c.lastSeen < cutoff) client.terminate();
      }
    }, 30_000);
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
  /** Wired to the HTTP server's 'upgrade' event. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const ticket = url.searchParams.get('ticket') ?? '';
    void this.tickets.redeem(ticket).then(
      (userId) => {
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          // Accept first, then close with a reason the browser can read.
          if (userId === null) {
            ws.close(CLOSE_UNAUTHORIZED, 'invalid or expired ticket');
            return;
          }
          this.onConnection(ws, userId);
        });
      },
      (err: unknown) => {
        this.logger.error({ err }, 'ticket redemption failed');
        socket.destroy();
      },
    );
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
  private onConnection(ws: WebSocket, userId: string): void {
    const client: Client = {
      ws,
      userId,
      connectionId: uuidv7(),
      projects: new Set(),
      lastSeen: Date.now(),
      badMessages: 0,
    };
    this.clients.set(ws, client);
    ws.on('message', (data) => void this.onMessage(client, data));
    ws.on('close', () => void this.onClose(client));
    ws.on('error', (err) => {
      this.logger.warn({ err }, 'websocket error');
    });
  }

  private async onMessage(client: Client, data: RawData): Promise<void> {
    client.lastSeen = Date.now();
    let parsed: z.infer<typeof ClientMessage>;
    try {
      parsed = ClientMessage.parse(JSON.parse(rawToString(data)));
    } catch {
      client.badMessages++;
      if (client.badMessages > MAX_BAD_MESSAGES) {
        client.ws.close(CLOSE_BAD_MESSAGES, 'too many malformed messages');
        return;
      }
      send(client, envelope('error', { code: 'bad_message', message: 'Malformed message' }));
      return;
    }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
    try {
      switch (parsed.type) {
        case 'subscribe':
          await this.subscribe(client, parsed.payload.projectId);
          break;
        case 'unsubscribe':
          await this.unsubscribe(client, parsed.payload.projectId);
          break;
        case 'ping':
          for (const projectId of client.projects) {
            await this.presence.touch(projectId, client.userId, client.connectionId);
          }
          send(client, envelope('pong'));
          break;
      }
    } catch (err) {
      if (err instanceof ProblemError && (err.status === 404 || err.status === 403)) {
        const code = err.status === 404 ? 'not_found' : 'forbidden';
        send(client, envelope('error', { code, message: err.message }));
        return;
      }
      this.logger.error({ err }, 'websocket handler failed');
    }
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
  private async subscribe(client: Client, projectId: string): Promise<void> {
    await this.access.project(projectId, client.userId);
    if (!client.projects.has(projectId)) {
      client.projects.add(projectId);
      let sockets = this.local.get(projectId);
      if (!sockets) {
        sockets = new Set();
        this.local.set(projectId, sockets);
        await this.subscriber.subscribe(projectChannel(projectId));
      }
      sockets.add(client);
    }
    await this.presence.touch(projectId, client.userId, client.connectionId);
    send(client, envelope('subscribed', { projectId }));
    await this.broadcastPresence(projectId);
  }

  private async unsubscribe(client: Client, projectId: string): Promise<void> {
    if (!client.projects.delete(projectId)) return;
    const sockets = this.local.get(projectId);
    sockets?.delete(client);
    if (sockets?.size === 0) {
      this.local.delete(projectId);
      await this.subscriber.unsubscribe(projectChannel(projectId));
    }
    await this.presence.leave(projectId, client.userId, client.connectionId);
    await this.broadcastPresence(projectId);
  }

  private async onClose(client: Client): Promise<void> {
    for (const projectId of [...client.projects]) {
      await this.unsubscribe(client, projectId).catch((err: unknown) => {
        this.logger.warn({ err }, 'cleanup after close failed');
      });
    }
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts
  private async broadcastPresence(projectId: string): Promise<void> {
    const users = await this.presence.online(projectId);
    await this.publisher.publish(projectId, 'presence.updated', { projectId, users });
  }

  async close(): Promise<void> {
    clearInterval(this.reaper);
    for (const ws of this.wss.clients) ws.close(CLOSE_GOING_AWAY, 'server shutting down');
    await new Promise<void>((resolve) => {
      this.wss.close(() => {
        resolve();
      });
    });
  }
}

function send(client: Client, message: string): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(message);
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}
```

**What's new**
- **`new WebSocketServer({ noServer: true })`**: the `ws` library doesn't open its own port. We attach to the HTTP server's `upgrade` event and decide per request whether to complete the handshake. API and WebSocket share port 8000.
- **Accept, then close with 4401.** If we refused the HTTP upgrade instead, the browser would only see "connection failed" with no reason. Closing an accepted socket with an application code (4000–4999) lets the client tell "bad ticket, get a new one" apart from "network down, retry".
- `z.discriminatedUnion('type', [...])` validates the three client message shapes, and TypeScript narrows `parsed.payload` in each `switch` case.
- `WeakMap<WebSocket, Client>` attaches our per-connection state to the socket object without keeping it alive: when the socket is garbage-collected, its entry disappears.
- `void this.onMessage(...)`: event-emitter callbacks can't await, so `void` marks a promise we deliberately don't await (the lint rule `no-floating-promises` insists you say so).
- **A Redis connection in SUBSCRIBE mode can't run other commands**, so the gateway gets its own (`redis.duplicate()` in `main.ts`).

> **🧠 DSA & scalability · fan-out across instances**
> - **Data structures:** per instance, a `Map<projectId, Set<Client>>` of *local* sockets. In Redis, one Pub/Sub channel per project.
> - **Algorithm:** the first local subscriber to a project makes the instance `SUBSCRIBE project:{id}`, and the last one leaving makes it `UNSUBSCRIBE` (reference counting). A write on **any** instance `PUBLISH`es once. Redis delivers it to every subscribed instance, and each forwards it to its local sockets for that project.
> - **Complexity:** per event, O(instances watching the project) Redis deliveries + O(local subscribers) socket writes. Instances that host no viewer of a project receive nothing for it.
> - **Why it scales horizontally:** instances share nothing but Redis. Put 10 behind a load balancer and a user on instance 3 still sees a move made through instance 7. The test in Step 10.3 runs **two** servers to prove exactly that.
> - **Rejected:** sticky sessions and in-process broadcast (breaks the moment two users of one board land on different instances); Socket.IO (its own protocol, which a plain browser `WebSocket` can't speak). Pulse (App 2) replaces Pub/Sub with Redis **Streams** to add replay.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: websocket gateway with redis pub/sub fan-out`

### Step 10.3 · Wiring and tests

**Goal:** Start the gateway with the server, and test fan-out across two instances.

**Files:** `src/container.ts`, `src/app.ts`, `src/main.ts`, `tests/integration/realtime.test.ts`

**`src/container.ts`** · add after `import { ProjectsService } from './modules/projects/projects.service.js';`

```ts
import { Presence } from './modules/realtime/presence.js';
```

**`src/container.ts`** · add after `import { RealtimePublisher } from './modules/realtime/publisher.js';`

```ts
import { Tickets } from './modules/realtime/tickets.js';
```

**`src/container.ts`** · add after `realtime,`

```ts
    tickets: new Tickets(redis),
    presence: new Presence(redis, users),
```

**`src/app.ts`** · add after `import { projectsRoutes } from './modules/projects/projects.routes.js';`

```ts
import { realtimeRoutes } from './modules/realtime/realtime.routes.js';
```

**`src/app.ts`** · add after `api.use(searchRoutes(services.search));`

```ts
  api.use(realtimeRoutes(services.tickets));
```

In `src/main.ts`, create the gateway, route upgrades to it, and close it on shutdown:

**`src/main.ts`** · add after `import { closeInfra, createInfra, createServices } from './container.js';`

```ts
import { RealtimeGateway } from './modules/realtime/gateway.js';
```

**`src/main.ts`** · add after `const server = createServer(app);`

```ts
const gateway = new RealtimeGateway(
  infra.redis.duplicate(), // a Redis connection in SUBSCRIBE mode can't run other commands
  services.tickets,
  services.access,
  services.presence,
  services.realtime,
  infra.logger,
);
server.on('upgrade', (req, socket, head) => {
  gateway.handleUpgrade(req, socket, head);
});
```

**`src/main.ts`** · add after `force.unref();`

```ts
  await gateway.close();
```

**`tests/integration/realtime.test.ts`** · new file

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import supertest from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApp } from '../../src/app.js';
import { RealtimeGateway } from '../../src/modules/realtime/gateway.js';
import {
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
  type TestContext,
} from '../helpers.js';

interface Envelope {
  type: string;
  payload?: Record<string, unknown>;
  ts?: string;
}
```

**`tests/integration/realtime.test.ts`** · continue

```ts
/** One "API instance": its own HTTP server, gateway and Redis subscriber connection. */
async function startInstance(ctx: TestContext) {
  const server: Server = createServer(createApp(ctx.infra, ctx.services));
  const gateway = new RealtimeGateway(
    ctx.infra.redis.duplicate(),
    ctx.services.tickets,
    ctx.services.access,
    ctx.services.presence,
    ctx.services.realtime,
    ctx.infra.logger,
  );
  server.on('upgrade', (req, socket, head) => {
    gateway.handleUpgrade(req, socket, head);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    request: supertest(server),
    stop: async () => {
      await gateway.close();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
```

**`tests/integration/realtime.test.ts`** · continue

```ts

class TestSocket {
  private readonly received: Envelope[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.received.push(JSON.parse((data as Buffer).toString('utf8')) as Envelope);
      for (const w of this.waiters) w();
    });
  }

  static open(port: number, ticket: string): Promise<TestSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?ticket=${ticket}`);
    const socket = new TestSocket(ws);
    return new Promise((resolve, reject) => {
      ws.once('open', () => {
        resolve(socket);
      });
      ws.once('error', reject);
    });
  }

  send(message: Envelope) {
    this.ws.send(JSON.stringify(message));
  }
```

**`tests/integration/realtime.test.ts`** · continue

```ts
  /** Resolves with the first message of `type` (already received or arriving within 5 s). */
  next(type: string, match: (e: Envelope) => boolean = () => true): Promise<Envelope> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for ${type}`));
      }, 5000);
      const check = () => {
        const index = this.received.findIndex((e) => e.type === type && match(e));
        if (index === -1) return;
        const [found] = this.received.splice(index, 1);
        clearTimeout(timer);
        this.waiters = this.waiters.filter((w) => w !== check);
        if (found) resolve(found);
      };
      this.waiters.push(check);
      check();
    });
  }
}

const ctx = createTestContext();
let a: Awaited<ReturnType<typeof startInstance>>;
let b: Awaited<ReturnType<typeof startInstance>>;
let f: Fixture;

beforeAll(async () => {
  a = await startInstance(ctx);
  b = await startInstance(ctx);
});
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(async () => {
  await a.stop();
  await b.stop();
  await ctx.close();
});

async function ticketFor(auth: Record<string, string>) {
  const res = await a.request.post('/api/v1/ws/ticket').set(auth).expect(201);
  return (res.body as { ticket: string }).ticket;
}
```

**`tests/integration/realtime.test.ts`** · continue

```ts

describe('realtime', () => {
  it('fans events out across instances through Redis Pub/Sub', async () => {
    const socket = await TestSocket.open(a.port, await ticketFor(f.owner.auth));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await socket.next('subscribed');
    const presence = await socket.next('presence.updated');
    expect(presence.payload).toMatchObject({ projectId: f.projectId, users: [{ id: f.owner.id }] });

    // The write goes through instance B; the socket lives on instance A.
    await b.request
      .post(`/api/v1/projects/${f.projectId}/tasks`)
      .set(f.owner.auth)
      .send({ title: 'Live!' })
      .expect(201);
    const event = await socket.next('task.created');
    expect(event.payload).toMatchObject({ title: 'Live!', key: 'TF-1' });
    expect(event.ts).toMatch(/Z$/);

    socket.send({ type: 'ping' });
    await socket.next('pong');
    socket.ws.close();
  });

  it('closes with 4401 for a bad ticket, and tickets are single-use', async () => {
    const closeCode = (ws: WebSocket) =>
      new Promise<number>((resolve) =>
        ws.once('close', (code) => {
          resolve(code);
        }),
      );

    const bad = new WebSocket(`ws://127.0.0.1:${a.port}/ws?ticket=nope`);
    expect(await closeCode(bad)).toBe(4401);
```

**`tests/integration/realtime.test.ts`** · continue

```ts
    const ticket = await ticketFor(f.owner.auth);
    const first = await TestSocket.open(a.port, ticket);
    const reused = new WebSocket(`ws://127.0.0.1:${a.port}/ws?ticket=${ticket}`);
    expect(await closeCode(reused)).toBe(4401);
    first.ws.close();
  });

  it('refuses subscriptions to projects outside your workspaces', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    const socket = await TestSocket.open(a.port, await ticketFor(outsider.auth));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    const error = await socket.next('error');
    expect(error.payload).toMatchObject({ code: 'not_found' });
    socket.send({ type: 'nonsense' });
    expect((await socket.next('error')).payload).toMatchObject({ code: 'bad_message' });
    socket.ws.close();
  });

  it('updates presence when a viewer leaves', async () => {
    const other = await registerUser(ctx, 'Other');
    await ctx.infra.prisma.workspaceMember.create({
      data: { workspaceId: f.workspaceId, userId: other.id, role: 'viewer' },
    });
    const watcher = await TestSocket.open(a.port, await ticketFor(f.owner.auth));
    watcher.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('subscribed');

    const leaver = await TestSocket.open(b.port, await ticketFor(other.auth));
    leaver.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 2);

    leaver.ws.close();
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 1);
    watcher.ws.close();
  });
});
```

**What's new (the test)**
- `startInstance` builds a full HTTP server and gateway on port `0`, which makes the OS pick a free port. The test starts **two** such instances sharing one Redis: a client connected to instance A receives a task created through instance B.
- `TestSocket.next(type)` buffers incoming messages and resolves with the first matching one, so tests don't depend on message timing.

**✅ Checkpoint**


```bash
npm run typecheck && npx vitest run tests/integration/realtime.test.ts
```

Expected: `Tests  4 passed (4)`.

To try it by hand with `npm run dev` running, get a token, then a ticket, then connect with any WebSocket client (for example `npx wscat`):

```bash
TOKEN=$(curl -s localhost:8001/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
TICKET=$(curl -s -X POST localhost:8001/api/v1/ws/ticket -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).ticket')
npx wscat -c "ws://localhost:8001/ws?ticket=$TICKET"
> {"type":"ping"}
< {"type":"pong","ts":"2026-…Z"}
```

**Commit:** `feat: real-time board updates over WebSockets with Redis pub/sub and presence`

---

## Part 11 · Background jobs & schedules

Services have been enqueueing jobs since Part 5, and they've been piling up in Redis. Now we add the **worker**: a second process that runs the jobs, plus two cron schedules (README §11).

### Step 11.1 · Mailer and processors

**Goal:** Implement every job type: invitation and reminder emails, the reminder scan, storage cleanup.

**Files:** `src/jobs/mailer.ts`, `src/jobs/processors.ts`

```bash
npm i -E nodemailer@10.3.1
npm i -D -E @types/nodemailer@8.0.2
```

**`src/jobs/mailer.ts`** · new file

```ts
import nodemailer, { type Transporter } from 'nodemailer';
import type { Config } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export class Mailer {
  private readonly transport: Transporter;

  constructor(private readonly config: Pick<Config, 'SMTP_HOST' | 'SMTP_PORT' | 'MAIL_FROM'>) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: false,
    });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.config.MAIL_FROM, ...mail });
  }

  close(): void {
    this.transport.close();
  }
}
```

**`src/jobs/processors.ts`** · new file

```ts
import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { Storage } from '../infra/storage.js';
import type { Mailer } from './mailer.js';
import type { JobData, JobName, Jobs } from './queue.js';

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export interface ProcessorDeps {
  prisma: PrismaClient;
  storage: Storage;
  mailer: Mailer;
  jobs: Jobs;
  logger: Logger;
  frontendUrl: string;
}

type Processors = { [N in JobName]: (data: JobData[N]) => Promise<unknown> };

export function createProcessors(deps: ProcessorDeps): Processors {
  const { prisma, storage, mailer, jobs, logger } = deps;

  return {
    async 'send-invitation-email'({ email, workspaceName, inviterName, token }) {
      const link = `${deps.frontendUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: email,
        subject: `${inviterName} invited you to ${workspaceName} on TaskFlow`,
        text: `${inviterName} invited you to join "${workspaceName}".\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`,
      });
    },
```

**`src/jobs/processors.ts`** · continue

```ts
    async 'scan-due-reminders'() {
      // SKIP LOCKED lets several schedulers run at once without blocking each other
      // or claiming the same rows; setting reminder_sent_at is the claim.
      const claimed = await prisma.$queryRaw<{ id: string }[]>`
        UPDATE tasks SET reminder_sent_at = now()
        WHERE id IN (
          SELECT id FROM tasks
          WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
            AND due_at > now() AND due_at <= now() + interval '24 hours'
          ORDER BY due_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`;
      for (const { id } of claimed) await jobs.enqueue('send-due-reminder', { taskId: id });
      return { claimed: claimed.length };
    },
```

**`src/jobs/processors.ts`** · continue

```ts
    async 'send-due-reminder'({ taskId }) {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { assignee: true, project: { select: { key: true, name: true } } },
      });
      if (!task?.assignee || !task.dueAt) return { skipped: true };
      await mailer.send({
        to: task.assignee.email,
        subject: `Due soon: ${task.project.key}-${task.number} ${task.title}`,
        text: `"${task.title}" in ${task.project.name} is due at ${task.dueAt.toISOString()}.\n\nOpen it: ${deps.frontendUrl}/tasks/${task.id}`,
      });
      return { sent: true };
    },

    async 'delete-storage-prefix'({ prefix }) {
      return { deleted: await storage.deletePrefix(prefix) };
    },

    async 'cleanup-stale-uploads'() {
      const stale = await prisma.attachment.findMany({
        where: { status: 'pending', createdAt: { lt: new Date(Date.now() - STALE_UPLOAD_MS) } },
        take: 500,
        select: { id: true, storageKey: true },
      });
      for (const a of stale) await storage.deletePrefix(a.storageKey);
      await prisma.attachment.deleteMany({ where: { id: { in: stale.map((a) => a.id) } } });
      logger.info({ removed: stale.length }, 'stale uploads cleaned');
      return { removed: stale.length };
    },
  };
}

/** Routes a BullMQ job to its typed processor by job name. */
export function dispatch(processors: Processors) {
  return (job: Job) => {
    const processor = processors[job.name as JobName] as
      ((data: unknown) => Promise<unknown>) | undefined;
    if (!processor) throw new Error(`Unknown job: ${job.name}`);
    return processor(job.data);
  };
}
```

**What's new**
- `type Processors = { [N in JobName]: (data: JobData[N]) => Promise<unknown> }` is a **mapped type**: one entry per job name, each typed with its own payload. Forget a job, or give it the wrong argument type, and it won't compile.
- Processor names are quoted object keys (`async 'send-due-reminder'(...)`) because they contain hyphens.
- `dispatch` turns BullMQ's untyped `job.name` back into a typed call. Unknown names throw, so BullMQ marks the job failed instead of losing it.

> **🧠 DSA & scalability · claiming due reminders with `SKIP LOCKED`**
> - **Data structure:** the partial index `tasks_due_reminder_idx ON tasks (due_at) WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL`. It contains **only** tasks that still need a reminder, so it stays small as sent reminders pile up.
> - **Algorithm:** one statement that selects up to 100 due-soon rows `FOR UPDATE SKIP LOCKED`, sets `reminder_sent_at = now()` (the "claim"), and returns their IDs. Each ID then becomes its own `send-due-reminder` job.
> - **Why `SKIP LOCKED`:** with two worker instances both scanning, plain `FOR UPDATE` would make the second *wait* for the first's rows and then claim nothing. `SKIP LOCKED` makes it skip those rows and claim others, so the work is split without duplicates or waiting.
> - **Complexity:** O(log n + 100) per scan, independent of how many tasks are already reminded.
> - **Delivery guarantee:** a claimed task whose email job keeps failing is retried 5 times with backoff, then stays in BullMQ's failed set for inspection. That's at-least-once for the email, at-most-once per claim.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: job processors and mailer`

### Step 11.2 · The worker process

**Goal:** Run the processors in their own process, with retries and cron schedules.

**Files:** `src/worker.ts`

```bash
npm pkg set scripts.dev:worker="tsx watch src/worker.ts" scripts.start:worker="node dist/worker.js"
```

**`src/worker.ts`** · new file

```ts
import { Worker } from 'bullmq';
import { loadConfig } from './config.js';
import { closeInfra, createInfra } from './container.js';
import { Mailer } from './jobs/mailer.js';
import { createProcessors, dispatch } from './jobs/processors.js';
import { Jobs, QUEUE_NAME } from './jobs/queue.js';

const config = loadConfig();
const infra = createInfra(config);
const mailer = new Mailer(config);
const processors = createProcessors({
  prisma: infra.prisma,
  storage: infra.storage,
  mailer,
  jobs: new Jobs(infra.queue),
  logger: infra.logger,
  frontendUrl: config.FRONTEND_URL,
});

// Idempotent: re-running on every start updates the schedule instead of duplicating it.
await infra.queue.upsertJobScheduler(
  'scan-due-reminders',
  { pattern: '*/15 * * * *' },
  { name: 'scan-due-reminders', data: {} },
);
await infra.queue.upsertJobScheduler(
  'cleanup-stale-uploads',
  { pattern: '0 * * * *' },
  { name: 'cleanup-stale-uploads', data: {} },
);

const worker = new Worker(QUEUE_NAME, dispatch(processors), {
  connection: infra.redis.duplicate(),
  concurrency: 5,
});
```

**`src/worker.ts`** · continue

```ts
worker.on('completed', (job) => {
  infra.logger.info({ job: job.name, id: job.id }, 'job completed');
});
worker.on('failed', (job, err) => {
  infra.logger.warn({ job: job?.name, id: job?.id, attempt: job?.attemptsMade, err }, 'job failed');
});

infra.logger.info('taskflow-express worker started');

async function shutdown(signal: string): Promise<void> {
  infra.logger.info({ signal }, 'worker shutting down');
  await worker.close();
  mailer.close();
  await closeInfra(infra);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

**What's new**
- **Top-level `await`** works because the file is an ES module (`"type": "module"`). No `main()` wrapper needed.
- `upsertJobScheduler(id, { pattern }, template)` registers a cron schedule **in Redis**. It's an upsert by ID, so restarting the worker (or running three of them) never creates duplicate schedules, and only one instance runs each tick.
- `concurrency: 5` runs up to five jobs at once **in this one process**. They're I/O-bound (SMTP, S3), so concurrency, not more CPUs, is what helps.
- The worker gets its own Redis connection (`duplicate()`): BullMQ's worker blocks it with `BRPOPLPUSH`-style waits for new jobs.


**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output (no type errors).

**Commit:** `feat: background worker with cron schedules`

### Step 11.3 · Tests

**Goal:** Test each job against real Postgres, S3 and Mailpit.

**Files:** `tests/integration/jobs.test.ts`

**`tests/integration/jobs.test.ts`** · new file

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Mailer } from '../../src/jobs/mailer.js';
import { createProcessors } from '../../src/jobs/processors.js';
import { Jobs } from '../../src/jobs/queue.js';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
} from '../helpers.js';

const ctx = createTestContext();
const { config } = ctx.infra;
const mailer = new Mailer(config);
const processors = createProcessors({
  prisma: ctx.infra.prisma,
  storage: ctx.infra.storage,
  mailer,
  jobs: new Jobs(ctx.infra.queue),
  logger: ctx.infra.logger,
  frontendUrl: config.FRONTEND_URL,
});
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:18001';

interface MailpitMessage {
  Subject: string;
  To: { Address: string }[];
  ID: string;
}

async function inbox(to: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}
```

**`tests/integration/jobs.test.ts`** · continue

```ts
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  await ctx.infra.queue.obliterate({ force: true });
  f = await createFixture(ctx);
});
afterAll(async () => {
  mailer.close();
  await ctx.close();
});
```

**`tests/integration/jobs.test.ts`** · continue

```ts
describe('jobs', () => {
  it('sends the invitation email with an accept link', async () => {
    const email = `invitee-${Date.now()}@example.com`;
    await processors['send-invitation-email']({
      email,
      workspaceName: 'Acme',
      inviterName: 'Owner',
      token: 'tok-123',
    });
    const [message] = await inbox(email);
    expect(message?.Subject).toBe('Owner invited you to Acme on TaskFlow');
    const full = (await (await fetch(`${mailpit}/api/v1/message/${message?.ID ?? ''}`)).json()) as {
      Text: string;
    };
    expect(full.Text).toContain(`${config.FRONTEND_URL}/invitations/accept?token=tok-123`);
  });

  it('claims each due-soon task exactly once, then emails the assignee', async () => {
    const assignee = await registerUser(ctx, 'Assignee');
    await addMember(ctx, f.workspaceId, assignee, 'member');
    const create = (title: string, dueInHours: number, assigned = true) =>
      ctx.request
        .post(`/api/v1/projects/${f.projectId}/tasks`)
        .set(f.owner.auth)
        .send({
          title,
          dueAt: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
          ...(assigned ? { assigneeId: assignee.id } : {}),
        })
        .expect(201);
    await create('Due soon', 2);
    await create('Due later', 72);
    await create('Nobody assigned', 2, false);

    expect(await processors['scan-due-reminders']({})).toEqual({ claimed: 1 });
    expect(await processors['scan-due-reminders']({})).toEqual({ claimed: 0 });

    const [job] = await ctx.infra.queue.getJobs(['waiting']);
    expect(job?.name).toBe('send-due-reminder');
    await processors['send-due-reminder'](job?.data as { taskId: string });
    const [message] = await inbox(assignee.email);
    expect(message?.Subject).toBe('Due soon: TF-1 Due soon');
  });
```

**`tests/integration/jobs.test.ts`** · continue

```ts
  it('deletes every object under a storage prefix', async () => {
    const s3 = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
    const prefix = `projects/${f.projectId}/`;
    for (const name of ['a', 'b', 'c']) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: `${prefix}tasks/t/${name}`,
          Body: name,
        }),
      );
    }
    s3.destroy();
    expect(await processors['delete-storage-prefix']({ prefix })).toEqual({ deleted: 3 });
    expect(await processors['delete-storage-prefix']({ prefix })).toEqual({ deleted: 0 });
  });

  it('removes uploads left pending for more than a day', async () => {
    const task = await ctx.request
      .post(`/api/v1/projects/${f.projectId}/tasks`)
      .set(f.owner.auth)
      .send({ title: 'With upload' })
      .expect(201);
    const created = await ctx.request
      .post(`/api/v1/tasks/${(task.body as { id: string }).id}/attachments`)
      .set(f.owner.auth)
      .send({ fileName: 'old.txt', contentType: 'text/plain', sizeBytes: 3 })
      .expect(201);
    const id = (created.body as { attachment: { id: string } }).attachment.id;
    await ctx.infra.prisma.attachment.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await processors['cleanup-stale-uploads']({})).toEqual({ removed: 1 });
    expect(await ctx.infra.prisma.attachment.count()).toBe(0);
  });
});
```

**What's new**
- The tests call processors **directly** instead of running a worker, so they test the job logic deterministically. BullMQ's own retry machinery is the library's job to test.
- Emails are checked through **Mailpit's HTTP API** (`/api/v1/search`), with a real SMTP round trip.

**✅ Checkpoint**


```bash
npm run typecheck && npm test
```

Expected: `Test Files  14 passed (14)` and `Tests  71 passed (71)`. Then run the worker against your dev data with `npm run dev:worker`. Any invitation you created earlier is emailed, and shows up at http://localhost:18001.

**Commit:** `feat: background worker for emails, due-date reminders and storage cleanup`

---

## Part 12 · Contract testing with Schemathesis

Our tests check the behaviour we *thought of*. **Schemathesis** reads `contract/openapi.yaml`, generates thousands of requests (valid, edge-case and invalid), and checks every response against the contract: status codes, content types, response schemas, and whether valid input is accepted.

### Step 12.1 · Configuration

**Goal:** Configure Schemathesis, run it, and learn from what it found.

**Files:** `schemathesis.toml`

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

```bash
npm pkg set scripts.test:contract="schemathesis run contract/openapi.yaml --url http://localhost:8001"
```

**What we found the first time we ran it** (all fixed in the code you've already typed, and kept here because it's the most useful lesson of this Part):

| Schemathesis check | What it caught | Fix |
|---|---|---|
| ST103 undocumented status | Malformed JSON returned 400, which the contract didn't list | Contract: declare `400` and `415` on every operation with a body |
| ST204 undeclared method | `TRACE /auth/login` returned 404 | Express code: `.all(methodNotAllowed)` → 405 + `Allow` |
| ST202 valid input rejected | `+n99'*l8@false.info` (a valid RFC 5322 email) was rejected | Code: zod's RFC 5322 email pattern |
| ST202 valid input rejected | `?cursor=0` matches the cursor schema but isn't a cursor we issued | Config: GETs may answer 422 (the `[[operations]]` block above) |
| ST202 valid input rejected | A random but well-formed `afterColumnId`, or a name of only whitespace (`"\u00a0"`, trimmed to empty) | Config: the operations whose bodies reference other rows or carry trimmed names may answer 422 (second `[[operations]]` block; found later, while building `taskflow-fastify`) |

**What's new**
- `schemathesis.toml` is picked up automatically from the working directory. `allow-x00 = false` stops it from sending NUL characters, which Postgres `text` can't store. That's a database limitation, not an API bug.

**✅ Checkpoint**

Start the API with the rate limits raised (a fuzzer sends thousands of requests a minute), get a token, and run it:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm run dev
# second terminal:
TOKEN=$(curl -s localhost:8001/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8001 -H "Authorization: Bearer $TOKEN"
```

Expected (numbers vary with the random seed):

```text
Test Phases:
  ✅ Examples
  ✅ Coverage
  ✅ Fuzzing
  ✅ Stateful
Warnings:
  ⚠️ Authentication failed: 1 operation returned only 401/403 responses
  ⚠️ Missing test data: 21 operations repeatedly returned 404 responses
Test cases:
  5855 generated, 5855 passed, 42 skipped
```

The two warnings are expected: `/auth/refresh` authenticates with a cookie the fuzzer doesn't have, and random UUIDs rarely hit real records.

**Commit:** `test: schemathesis contract test configuration`

---

## Part 13 · Docker

### Step 13.1 · A multi-stage Dockerfile

**Goal:** a small, non-root production image, plus a "deps" image that can run migrations.

**Files:** `Dockerfile`, `.dockerignore`

**`Dockerfile`** · new file

```dockerfile
# syntax=docker/dockerfile:1

# ---- base: Debian slim + OpenSSL (Prisma's schema engine links against libssl 3) ----
FROM node:24.22.2-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ---- deps: all dependencies; postinstall runs `prisma generate`.
#      Also the image the compose `migrate` service runs (it needs the Prisma CLI). ----
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

# ---- build: compile TypeScript (including the generated Prisma client) to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only. The Prisma CLI is a devDependency that the lockfile
#      also marks "devOptional" (an optional peer of @prisma/client), so omit optional too. ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

# ---- runtime ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]
```

**`.dockerignore`** · new file

```text
node_modules
dist
coverage
src/generated
.env
.env.*
!.env.example
.git
.github
tests
*.md
```

**What's new**
- **Multi-stage builds:** each `FROM … AS name` is a separate image. The final `runtime` stage copies in only `dist/` and production `node_modules`. The compiler, the dev dependencies and the sources never ship.
- **Layer caching:** `package*.json` is copied and installed **before** the source code, so editing a `.ts` file doesn't re-run `npm ci`.
- **Why `--omit=dev --omit=optional`:** `@prisma/client` declares the Prisma CLI (and TypeScript) as *optional peer* dependencies, so the lockfile marks them `devOptional`, and `--omit=dev` alone keeps them. That added ~330 MB of CLI, TypeScript and Studio to the image. `--omit=optional` drops them, along with two optional native speed-ups we don't need. `--ignore-scripts` is safe because nothing in the runtime set needs an install script.
- **`USER node`:** the official Node image ships an unprivileged `node` user. Running as root inside a container is a needless risk.
- **`openssl` in the base:** Prisma's schema engine (used by `migrate deploy`) links against `libssl`, which `node:*-slim` doesn't include.

**✅ Checkpoint**

```bash
docker build -t taskflow-express . && docker run --rm taskflow-express id
```

Expected: the build finishes, and `id` prints `uid=1000(node) gid=1000(node)`.

**Commit:** `build: multi-stage dockerfile`

### Step 13.2 · App services in compose

**Goal:** Run migrations, the API and the worker as containers next to the infrastructure.

**Files:** `docker-compose.yml`

The shared environment for the app containers. Note the in-network hostnames (`postgres`, `redis`, `rustfs`, `mailpit`) and that `S3_PUBLIC_ENDPOINT` stays `localhost`:

**`docker-compose.yml`** · add after `name: taskflow-express` (with a blank line on each side)

```yaml
x-app-env: &app-env
  NODE_ENV: production
  PORT: '8000'
  DATABASE_URL: postgresql://taskflow:taskflow@postgres:5432/taskflow
  REDIS_URL: redis://redis:6379/0
  JWT_SECRET: ${JWT_SECRET:-dev-only-change-me-at-least-32-bytes-long!!}
  COOKIE_SECURE: 'true'
  FRONTEND_URL: http://localhost:5173
  S3_ENDPOINT: http://rustfs:9000
  S3_PUBLIC_ENDPOINT: http://localhost:19001
  S3_REGION: us-east-1
  S3_BUCKET: taskflow-attachments
  S3_ACCESS_KEY: taskflow
  S3_SECRET_KEY: taskflow-secret
  SMTP_HOST: mailpit
  SMTP_PORT: '1025'
  MAIL_FROM: TaskFlow <no-reply@taskflow.local>
  LOG_LEVEL: info
```

and the three app services, behind the `app` profile:

**`docker-compose.yml`** · add before the top-level `volumes:` block at the end of the file

```yaml
  migrate:
    profiles: ['app']
    build:
      context: .
      target: deps
    command: ['npx', 'prisma', 'migrate', 'deploy']
    environment: *app-env
    depends_on:
      postgres:
        condition: service_healthy

  api:
    profiles: ['app']
    build: .
    environment: *app-env
    ports:
      - '8001:8000'
    depends_on:
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
          'node',
          '-e',
          "fetch('http://localhost:8000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 10s
      timeout: 3s
      retries: 10
```

**`docker-compose.yml`** · continue

```yaml
  worker:
    profiles: ['app']
    build: .
    command: ['node', 'dist/worker.js']
    environment: *app-env
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
      s3-init:
        condition: service_completed_successfully
      mailpit:
        condition: service_healthy
```

**What's new**
- **`x-app-env: &app-env`** is a YAML **anchor**: define the map once, reuse it with `*app-env`. Compose ignores top-level keys starting with `x-`.
- **`profiles: ['app']`**: a plain `docker compose up -d` starts only the infrastructure (your daily setup, with `npm run dev` for hot reload). `--profile app` adds the containers.
- **`migrate` uses `target: deps`** (the stage that has the Prisma CLI) and exits. `api` and `worker` wait for `service_completed_successfully`, so the app never starts against an unmigrated database.

**✅ Checkpoint**

```bash
docker compose --profile app up -d --build
docker compose --profile app ps --format 'table {{.Service}}\t{{.Status}}' -a
curl -s localhost:8001/health/ready
docker compose --profile app exec api id
```

Expected: `api` is `Up … (healthy)`, `worker` is `Up`, `migrate` and `s3-init` are `Exited (0)`, readiness returns `{"status":"ok",…}`, and `id` prints `uid=1000(node)`. `docker image ls taskflow-express-api` shows roughly 540 MB (of which ~146 MB is `node_modules`, half of it Prisma's per-database query compilers). Stop the `npm run dev` from earlier first, because both use port 8000.

**Commit:** `build: multi-stage Dockerfile and compose app profile`

---

## Part 14 · CI/CD with GitHub Actions

### Step 14.1 · The CI workflow

**Goal:** on every push and pull request: lint/format/typecheck, tests against real services, the migration drift check, the contract test, coverage, and a Docker image (pushed to GHCR from `main`).

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
  NODE_VERSION: '24'
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
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run format:check
      - run: npm run lint
      - run: npm run typecheck
```

**What's new**
- **`permissions: contents: read`** at the top: the `GITHUB_TOKEN` gets the least privilege by default, and only the `docker` job adds `packages: write`.
- **`concurrency`** cancels an older run of the same branch when you push again.
- `cache: npm` in `setup-node` caches `~/.npm` keyed on `package-lock.json`.

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
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - name: Apply migrations to an empty database
```

**`.github/workflows/ci.yml`** · continue

```yaml
        run: npx prisma migrate deploy
      - name: Fail if schema.prisma and the migrations disagree (drift)
        run: npm run db:drift
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: coverage
          path: coverage/
          retention-days: 14
```

**What's new**
- **Service containers** start Postgres, Redis, RustFS and Mailpit next to the job, on `localhost`, the same images as your compose file. `options: --health-cmd …` makes the job wait until they're healthy.
- **`services: &services` … `services: *services`**: a YAML anchor shares the block with the `contract` job. GitHub Actions supports anchors since 2025.
- **The drift check:** apply all migrations to an empty database, then `prisma migrate diff --from-config-datasource --to-schema … --exit-code` fails the build if `schema.prisma` and the migrations disagree, for example if someone edited the schema but forgot `migrate dev`.

**`.github/workflows/ci.yml`** · continue

```yaml
  contract:
    name: Contract test (Schemathesis)
    runs-on: ubuntu-latest
    services: *services
    env:
      NODE_ENV: production
      RATE_LIMIT_AUTH_PER_MINUTE: '100000'
      RATE_LIMIT_API_PER_MINUTE: '100000'
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - uses: astral-sh/setup-uv@v10
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm run build
      - name: Start the API
        run: |
          node dist/main.js > api.log 2>&1 &
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
- The contract job runs the **compiled** app (`npm run build` then `node dist/main.js`) with `NODE_ENV=production`, so it tests what you ship.
- `astral-sh/setup-uv` installs uv, and `uvx schemathesis` runs it without a Python project.
- `jq -r '"TOKEN=" + .accessToken' >> "$GITHUB_ENV"` passes a value to later steps: lines appended to the `$GITHUB_ENV` file become environment variables.

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
- `needs: [quality, test, contract]` builds the image only if everything else passed.
- `docker/metadata-action` computes the tags: the full commit SHA always, `latest` only on the default branch. The image is pushed only for `push` events (merges to `main`). For pull requests it's built but not pushed.
- `cache-from/to: type=gha` stores Docker layer cache in GitHub's cache, so unchanged layers aren't rebuilt.

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml
```

Expected: no output (exit code 0).

**Commit:** `ci: lint, test, drift check, contract test and docker image`

### Step 14.2 · CodeQL and Dependabot

**Goal:** Add security scanning and automated dependency updates.

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
          languages: javascript-typescript
          queries: security-extended
      - uses: github/codeql-action/analyze@v4
```

**`.github/dependabot.yml`** · new file

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      prisma:
        patterns: ['prisma', '@prisma/*']
      aws-sdk:
        patterns: ['@aws-sdk/*']
      lint:
        patterns: ['eslint', '@eslint/*', 'typescript-eslint', 'prettier', 'eslint-config-prettier']
    ignore:
      # typescript-eslint supports TypeScript < 6.1; see README.
      - dependency-name: typescript
        update-types: ['version-update:semver-major']
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
- **CodeQL** compiles your code into a database and runs security queries over it (injection, path traversal, unsafe regexes…). `security-extended` adds more queries than the default set. The weekly `schedule` catches new queries on unchanged code.
- **Dependabot** opens one PR a week per ecosystem. `groups` bundles related packages (all of `@aws-sdk/*`) into one PR, and the `ignore` rule holds TypeScript below 7 until typescript-eslint supports it.

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml .github/workflows/codeql.yml
```

Expected: no output (exit code 0). Then commit and push, and watch the run under the repo's **Actions** tab: four green jobs on `main`, and a new package under **Packages**.

**Commit:** `ci: lint, test, drift check, contract test, docker image, codeql, dependabot`

### Step 14.3 · Branch protection checklist

**Goal:** Make CI a gate: nothing reaches `main` without green checks.

**Files:** none (GitHub settings)

In GitHub → **Settings → Branches → Add branch ruleset** (or *Add rule*) for `main`:

- [ ] **Require a pull request before merging** (you can allow 0 approvals while working alone)
- [ ] **Require status checks to pass:** `Lint, format & typecheck`, `Tests, migrations & coverage`, `Contract test (Schemathesis)`, `Docker image`, `analyze` (CodeQL)
- [ ] **Require branches to be up to date before merging**
- [ ] **Block force pushes** and **restrict deletions**
- [ ] **Require linear history** (squash or rebase merges, so the history reads like these STEPS)

From now on: branch → commit → push → PR → green checks → merge.

**✅ Checkpoint**

```bash
git push origin HEAD:main   # from a local commit, without a PR
```

Expected: `! [remote rejected] … (push declined due to repository rule violations)`.

**Commit:** nothing new to commit in this step.

---

## Part 15 · Full stack & where to go next

### Step 15.1 · Run everything

**Goal:** Run the whole stack and know where everything lives.

**Files:** none

```bash
docker compose --profile app up -d --build
npm run test:coverage                     # against the infra, from your machine
```

| URL | What |
|---|---|
| http://localhost:8001/health/ready | API readiness |
| http://localhost:8001/docs | Swagger UI (only when `NODE_ENV` isn't `production`, so run `npm run dev` for this one) |
| http://localhost:18001 | Mailpit: invitation and reminder emails |
| http://localhost:19101 | RustFS console (`taskflow` / `taskflow-secret`) |

**✅ Checkpoint**

```bash
curl -s localhost:8001/health/ready
```

Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

**Commit:** nothing new to commit in this step.

### Step 15.2 · Connect the frontend

**Goal:** Point the React frontend at this API.

**Files:** none

`taskflow-frontend-node` (the next repo) is a React app that talks to this API at `VITE_API_URL=http://localhost:8001`. CORS already allows `http://localhost:5173`, and RustFS's bucket CORS allows the browser's direct uploads. Nothing here needs to change.

**✅ Checkpoint**

```bash
curl -si -X OPTIONS localhost:8001/api/v1/workspaces -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -iE '^HTTP|allow-origin|allow-credentials'
```

Expected: `HTTP/1.1 204 No Content`, `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.

**Commit:** nothing new to commit in this step.

### Step 15.3 · Where to go next

**Goal:** Stretch what you built.

**Files:** yours to choose

Exercises that stretch what you built, each touching a different layer:

1. **Optimistic concurrency for task edits.** Add a `version` column, require `If-Match`, and return 412 on a stale write. *Layers: schema, migration, service, contract.*
2. **Replayable real-time.** Replace Pub/Sub with a Redis Stream per project, and let clients resume from their last event ID after reconnecting. *(This is Pulse's core feature, so try it before reading Pulse.)*
3. **Per-user notification preferences.** Let users opt out of reminder emails, then measure how the partial index changes the reminder scan's `EXPLAIN ANALYZE`.
4. **A second worker type.** Move image thumbnailing for attachments into its own BullMQ queue, with a separate concurrency setting.
5. **Observability.** Add an OpenTelemetry trace from an HTTP request through Prisma and into the BullMQ job it enqueues. (Cartly does this with Prometheus and Grafana.)
6. **Compare.** Rebuild Step 7.2 (the counter) in Spring Boot when you get there, and read `COMPARISON.md` §11.

**✅ Checkpoint**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: everything still green after each exercise.

**Commit:** nothing new to commit in this step.
