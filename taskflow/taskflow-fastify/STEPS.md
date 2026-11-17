# STEPS · Rebuild `taskflow-fastify` from an empty folder

You'll build the **TaskFlow API** (a Jira/Trello-lite backend) with **Fastify 5, Drizzle ORM, PostgreSQL 18 and Redis**, by hand, one small step at a time. At the end your repo behaves exactly like this one: the same endpoints, the same 71 tests, the same CI.

This is the **second** of six TaskFlow backends. You built the first one, `taskflow-express`, and this guide keeps its Part and Step numbers, so Step 7.2 here and Step 7.2 there do the same job. It spends its words on what **changes** when the framework and the ORM change:

1. **Fastify's model.** Express is a chain of middleware functions. Fastify is a tree of **plugins** with **hooks** at fixed points in a request's lifecycle, **encapsulation** (what a plugin registers stays inside it), and a **schema on every route** that drives validation, serialization and TypeScript types at once.
2. **Drizzle instead of Prisma.** The schema is TypeScript, queries look like SQL, and the migration needs no hand-editing.
3. **The data structures and algorithms** stay the same as in Express. Every non-trivial feature still gets its 🧠 box (complexity, why it scales, rejected alternatives), shorter where the idea is unchanged.

> **Design docs you'll want open:** [`../README.md`](../README.md) (the TaskFlow design: data model, RBAC, auth, real-time protocol, Redis keys) and [`contract/openapi.yaml`](contract/openapi.yaml) (the API). This guide implements them; it doesn't repeat them.

## What you'll build

```mermaid
flowchart LR
    Client["HTTP / WebSocket client"] --> API
    subgraph Fastify["taskflow-fastify"]
        API["main.ts<br/>Fastify app + WS route"]
        Worker["worker.ts<br/>BullMQ worker + schedules"]
    end
    API --> PG[("PostgreSQL 18<br/>Drizzle ORM")]
    API --> R[("Redis 8<br/>tokens · cache · limits ·<br/>presence · pub/sub · queue")]
    API --> S3[("RustFS<br/>S3 API")]
    Worker --> PG
    Worker --> R
    Worker --> S3
    Worker --> Mail["Mailpit<br/>SMTP"]
```

**Inside the API process**, a request passes Fastify's lifecycle. Each box is a place where your code can run:

```mermaid
flowchart LR
    A["onRequest hooks<br/>request id · auth ·<br/>rate limit"] --> B["parse body<br/>(JSON only)"]
    B --> C["validate<br/>params · query · body<br/>(TypeBox + Ajv)"]
    C --> D["handler<br/>(*.routes.ts)"]
    D --> E["service<br/>RBAC, rules,<br/>transactions"]
    E --> F["Drizzle"]
    D --> G["serialize<br/>response schema"]
    E -. after commit .-> X["cache · pub/sub · jobs"]
```

## Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Node.js | 24 (npm 11.17+) | `node -v && npm -v` |
| Docker + Compose | Compose v5 | `docker compose version` |
| uv (for the contract test) | 0.12+ | `uv --version` |
| A GitHub account | | |

You've finished `taskflow-express` (or at least read its guide). Where a file here is the same as there, this guide still shows all of it, so the repo stands on its own, but explains only what's new.

## The finished repo

```text
taskflow-fastify/
├── .github/            dependabot.yml, workflows/ci.yml, workflows/codeql.yml
├── contract/           openapi.yaml (copy of the master contract)
├── drizzle/            generated SQL migrations + drizzle-kit snapshots
├── src/
│   ├── main.ts         starts the server, graceful shutdown
│   ├── worker.ts       background job worker + cron schedules
│   ├── migrate.ts      applies migrations (production runs it with plain node)
│   ├── app.ts          builds the Fastify app: plugins, hooks, route contexts
│   ├── container.ts    creates infra clients and wires every service (manual DI)
│   ├── config.ts       typed, validated environment (TypeBox)
│   ├── db/             Drizzle schema, relations, client
│   ├── http/           validation, errors, 405, auth hooks, rate limiting, request log
│   ├── infra/          Redis, S3, logger factories
│   ├── jobs/           queue facade, processors, mailer
│   ├── lib/            problem errors, shared schemas, cursors, fractional indexing
│   ├── modules/        one folder per feature: routes (plugin) → service → (repository)
│   └── types/          Fastify type augmentation
├── tests/              unit/ and integration/ (real Postgres, Redis, S3, SMTP)
├── docker-compose.yml  local infra (+ the app under the "app" profile)
├── Dockerfile          multi-stage, non-root
└── schemathesis.toml   contract-test settings
```

**Parts:** 0 Repo setup · 1 Infrastructure & config · 2 Database · 3 HTTP foundations · 4 Authentication · 5 Workspaces & RBAC · 6 Projects, columns & ordering · 7 Tasks · 8 Comments, activity & search · 9 Attachments · 10 Real-time · 11 Background jobs · 12 Contract testing · 13 Docker · 14 CI/CD · 15 Full stack & next steps

**How to read the code blocks:** each block says which file it belongs to and where it goes: **new file**, **continue** (append to the end of the file), **add after `<line>`** (insert the block right below that existing line), **add before `<line>`**, or **add at the top**. Type them in that order and your files will match the repo exactly.

---
## Part 0 · Repo setup

### Step 0.1 · Create the repo

**Goal:** an empty git repository with the npm project file.

**Files:** `package.json`

```bash
mkdir taskflow-fastify && cd taskflow-fastify
git init -b main
npm init -y
npm pkg set name=taskflow-fastify description="TaskFlow API: Fastify 5 + Drizzle + PostgreSQL + Redis"
npm pkg set private=true --json
npm pkg set license=MIT type=module engines.node=">=24"
npm pkg delete main keywords author scripts.test
```

**What's new**
- Same ESM setup as Express: `"type": "module"`, and imports name the compiled file (`'./config.js'` for `config.ts`).
- `npm pkg delete … scripts.test` removes npm's placeholder `test` script; you'll add the real one in Step 0.4.

**✅ Checkpoint**

```bash
npm pkg get name type
```

Expected: `"name": "taskflow-fastify"` and `"type": "module"`.

**Commit:** `chore: initialise npm package`

### Step 0.2 · TypeScript

**Goal:** the same strict TypeScript setup as Express, with a separate build config.

**Files:** `tsconfig.json`, `tsconfig.build.json`

```bash
npm i -D -E typescript@6.0.3 @types/node@26.6.6 tsx@4.23.15
npm approve-scripts esbuild
```

- **`typescript` 6.0.3, not 7**, because `typescript-eslint` supports only `<6.1` so far. `-E` pins the exact version.
- **`tsx`** runs `.ts` files directly in development. **`npm approve-scripts esbuild`** lets tsx's bundled esbuild check its platform binary at install time.

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
  "include": ["src", "tests", "drizzle.config.ts", "vitest.config.ts", "eslint.config.js"]
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
- The only difference from Express is the last `include` entry: `drizzle.config.ts` (Part 2) replaces `prisma.config.ts`.
- Reminder: `verbatimModuleSyntax` forces `import type` for type-only imports, `noUncheckedIndexedAccess` makes `array[i]` possibly `undefined`, and `tsconfig.build.json` compiles only `src/` into `dist/`.

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
npm i -D -E eslint@10.14.0 @eslint/js@10.0.1 typescript-eslint@8.72.2 globals@17.14.0 \
  prettier@3.10.0 eslint-config-prettier@10.1.8
```

**`eslint.config.js`** · new file

```js
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'coverage/'] },
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
```

**`eslint.config.js`** · continue

```js
      // Fastify plugins and hooks are async by contract, even when they have nothing to await.
      '@typescript-eslint/require-await': 'off',
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

```gitignore
node_modules/
dist/
coverage/
drizzle/
package-lock.json
contract/
STEPS.md
README.md
.schemathesis/
schemathesis-report/
.hypothesis/
```

**`.editorconfig`** · new file

```ini
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

```gitignore
node_modules/
dist/
coverage/
.env
*.log
.DS_Store
.schemathesis/
schemathesis-report/
.hypothesis/
```

**What's new (vs. Express)**
- **`require-await` is off.** A Fastify plugin is an `async` function, and so is a hook: Fastify awaits whatever they return, and an `async` function is how you say "I'm done" without a callback. Many of them have nothing to await (a plugin that only declares routes), and `strictTypeChecked` would flag every one. The rule protects against a mistake Fastify's design makes deliberate, so we switch it off.
- `.prettierignore` lists `drizzle/`: drizzle-kit writes SQL and JSON snapshots there (Part 2), and they're generated output.
- There is no `src/generated/`: Drizzle doesn't generate a client. Its types come from your schema file directly (Part 2).

**✅ Checkpoint**

```bash
npx eslint --version && npx prettier --version
```

Expected: `v10.14.0` and `3.10.0`.

**Commit:** `chore: add eslint, prettier, editorconfig and gitignore`

### Step 0.4 · npm scripts and install-script approvals

**Goal:** the scripts you'll use every day.

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
- The same scripts as Express. npm 11.17+ still holds back dependencies' install scripts until you approve them; `--allow-scripts-pending` lists anything waiting (nothing yet besides esbuild, which you approved). The decisions live in `package.json` under `allowScripts`, so CI and Docker make the same ones.

**✅ Checkpoint**

```bash
npx tsc --version && npx eslint --version && npx prettier --version
```

Expected: `Version 6.0.3`, `v10.14.0`, `3.10.0`.

**Commit:** `chore: scaffold TypeScript project with ESLint and Prettier`

### Step 0.5 · Push to GitHub

**Goal:** the repo exists on GitHub so CI can run later.

**Files:** none (GitHub only)

```bash
gh repo create taskflow-fastify --private --source=. --remote=origin --push
```

(Without the GitHub CLI: create an empty repo on github.com, then `git remote add origin git@github.com:<you>/taskflow-fastify.git && git push -u origin main`.)

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

Each repo publishes its own host ports, so Express's stack can keep running next to this one.

**`docker-compose.yml`** · new file

```yaml
name: taskflow-fastify
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
      - '15402:5432'
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
      - '16302:6379'
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
      - '19002:9000'
      - '19102:9001'
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
      - '11002:1025'
      - '18002:8025'
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
- This is the Express stack with two changes. **`name: taskflow-fastify`**: Compose prefixes containers, networks and **volumes** with the project name, so this repo gets its own empty database (`taskflow-fastify_postgres-data`) and never sees Express's data. And **the host ports end in `02`**, Fastify's slot in the workspace's port scheme: Postgres **15402**, Redis **16302**, S3 **19002** (console 19102), SMTP **11002** (Mailpit UI 18002), API **8002**. Express uses `01`, so both stacks run at the same time.
- Inside the compose network the services still listen on their defaults (5432, 6379, 9000, 1025); only the published host side differs. `s3-init` creates the bucket and its CORS rules; Mailpit catches email on 1025 and shows it on http://localhost:18002.

**✅ Checkpoint**

```bash
docker compose up -d
docker compose ps --format 'table {{.Service}}\t{{.Status}}' -a
```

Expected: `postgres`, `redis`, `rustfs` and `mailpit` are `Up … (healthy)`, and `s3-init` is `Exited (0)`.

**Commit:** `chore: docker compose for postgres, redis, rustfs and mailpit`

### Step 1.2 · Typed configuration

**Goal:** read every environment variable once, validate it, and fail fast at startup with a readable message, this time with **TypeBox**, the schema library Fastify is built around.

**Files:** `.env.example`, `src/config.ts`

```bash
npm i -E typebox@1.4.6
```

- **`typebox`** builds **JSON Schema** objects with a TypeScript API, and infers a static type from each one. Fastify validates requests against JSON Schema (Part 3), so the same library describes config, request bodies and responses. (Version 1 is published as `typebox`; the older 0.x line was `@sinclair/typebox`.)
- **No `dotenv`.** Node 24 can read a `.env` file itself with `process.loadEnvFile()`.

**`.env.example`** · new file

```bash
# Copy to .env for local development: cp .env.example .env
# Every value below matches docker-compose.yml, so `docker compose up -d` + `npm run dev` just works.

NODE_ENV=development
PORT=8002
LOG_LEVEL=info

# PostgreSQL 18 (compose service "postgres")
DATABASE_URL=postgresql://taskflow:taskflow@localhost:15402/taskflow

# Redis (compose service "redis"): refresh tokens, cache, rate limits, presence, pub/sub, job queue
REDIS_URL=redis://localhost:16302/0

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
S3_ENDPOINT=http://localhost:19002
S3_PUBLIC_ENDPOINT=http://localhost:19002
S3_REGION=us-east-1
S3_BUCKET=taskflow-attachments
S3_ACCESS_KEY=taskflow
S3_SECRET_KEY=taskflow-secret

# Sliding-window limits (requests per minute). The contract test raises these.
RATE_LIMIT_AUTH_PER_MINUTE=10
RATE_LIMIT_API_PER_MINUTE=300

# Email via Mailpit (web UI: http://localhost:18002)
SMTP_HOST=localhost
SMTP_PORT=11002
MAIL_FROM=TaskFlow <no-reply@taskflow.local>
```

**`src/config.ts`** · new file

```ts
import { existsSync } from 'node:fs';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

if (existsSync('.env')) process.loadEnvFile('.env');

const Url = Type.String({ format: 'uri' });
const PositiveInt = (fallback: number) => Type.Integer({ minimum: 1, default: fallback });

const ConfigSchema = Type.Object({
  NODE_ENV: Type.Enum(['development', 'test', 'production'], { default: 'development' }),
  PORT: PositiveInt(8000),
  DATABASE_URL: Url,
  REDIS_URL: Url,
  JWT_SECRET: Type.String({ minLength: 32 }),
  ACCESS_TOKEN_TTL_SECONDS: PositiveInt(900),
  REFRESH_TOKEN_TTL_SECONDS: PositiveInt(604_800),
  COOKIE_SECURE: Type.Boolean({ default: true }),
  FRONTEND_URL: Type.String({ format: 'uri', default: 'http://localhost:5173' }),
  S3_ENDPOINT: Url,
  S3_PUBLIC_ENDPOINT: Url,
  S3_REGION: Type.String({ default: 'us-east-1' }),
  S3_BUCKET: Type.String({ minLength: 3 }),
  S3_ACCESS_KEY: Type.String({ minLength: 1 }),
  S3_SECRET_KEY: Type.String({ minLength: 1 }),
  SMTP_HOST: Type.String({ default: 'localhost' }),
  SMTP_PORT: PositiveInt(1025),
  MAIL_FROM: Type.String({ default: 'TaskFlow <no-reply@taskflow.local>' }),
  RATE_LIMIT_AUTH_PER_MINUTE: PositiveInt(10),
  RATE_LIMIT_API_PER_MINUTE: PositiveInt(300),
  LOG_LEVEL: Type.Enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
    default: 'info',
  }),
});
```

**`src/config.ts`** · continue

```ts

export type Config = Static<typeof ConfigSchema>;

/** Default → Convert ("900" → 900, "false" → false) → Clean (drop unknown vars) → Check. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const value = Value.Clean(
    ConfigSchema,
    Value.Convert(ConfigSchema, Value.Default(ConfigSchema, { ...env })),
  );
  if (!Value.Check(ConfigSchema, value)) {
    const problems = [...Value.Errors(ConfigSchema, value)]
      .map((e) => `  ${e.instancePath.slice(1) || '(root)'}: ${e.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return value;
}
```

**What's new (TypeBox vs. zod)**
- **A TypeBox schema *is* JSON Schema.** `Type.Integer({ minimum: 1, default: 8000 })` returns the plain object `{ type: 'integer', minimum: 1, default: 8000 }`. zod schemas are classes with methods; TypeBox schemas are data, which is why Fastify can hand them to its validator and to its serializer.
- **`Static<typeof ConfigSchema>`** is TypeBox's `z.infer`: the TypeScript type derived from the schema.
- **Validation is a pipeline you can see.** Environment variables are always strings, so `Value.Convert` turns `"900"` into `900` and `"false"` into `false` (zod's `z.coerce`), `Value.Default` fills in defaults, `Value.Clean` drops every variable the schema doesn't mention (`process.env` holds hundreds), and `Value.Check` tests the result. `Value.Errors` lists every problem at once, so a broken deploy tells you everything that's wrong, not just the first thing.
- **`process.loadEnvFile('.env')`** (Node 21+) does what `dotenv` did. The `existsSync` guard skips it in Docker and CI, where the variables come from the environment and there is no `.env`.
- **Why not `@fastify/env`?** That plugin validates the environment and decorates the Fastify instance with `app.config`. But Fastify needs `LOG_LEVEL` *while* it builds the instance (Part 3), and the background worker (Part 11) has no Fastify instance at all. So config is a plain module that both processes call.

**✅ Checkpoint**

```bash
cp .env.example .env
npx tsx -e "import('./src/config.ts').then(m => console.log(m.loadConfig().PORT))"
JWT_SECRET=short npx tsx -e "import('./src/config.ts').then(m => m.loadConfig())" 2>&1 | grep JWT
```

Expected: `8000`, then `  JWT_SECRET: must not have fewer than 32 characters`.

**Commit:** `chore: docker compose infrastructure and typed config`

---

## Part 2 · Database schema & migrations

The data model is designed in the TaskFlow README (§4). It's the same reference schema Express produced; here **Drizzle** produces it.

### Step 2.1 · Install Drizzle and drizzle-kit

**Goal:** the ORM, its migration CLI, and a config file for the CLI.

**Files:** `drizzle.config.ts`

```bash
npm i -E drizzle-orm@0.45.4 pg@8.23.1
npm i -D -E drizzle-kit@0.31.11 @types/pg@8.23.1
npm approve-scripts esbuild
```

- **`drizzle-orm`** is the runtime: schema builders, the query builder and the relational query API. It's a thin layer over a driver you choose; we use **`pg`** (node-postgres), the same driver Prisma's adapter wrapped in Express.
- **`drizzle-kit`** is the dev-time CLI that turns your schema file into SQL migrations. It pulls in two older esbuild versions, so approve esbuild's install script again.
- Pin **0.45.4**: npm also has Drizzle 1.0 release candidates under other tags, with a reworked relational API. `latest` is 0.45.

**`drizzle.config.ts`** · new file

```ts
import { defineConfig } from 'drizzle-kit';
import { loadConfig } from './src/config.js';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url: loadConfig().DATABASE_URL },
  strict: true,
});
```

**What's new**
- `schema` points at **a TypeScript file** that *is* your schema (next step). `out` is where generated migrations go. `strict: true` makes drizzle-kit ask before running anything destructive.
- The config reuses `loadConfig()`, so drizzle-kit reads the same validated `DATABASE_URL` as the app.

**✅ Checkpoint**

```bash
npx drizzle-kit --version
```

Expected: `drizzle-kit: v0.31.11` and `drizzle-orm: v0.45.4`.

**Commit:** `chore: add drizzle orm and drizzle-kit`

### Step 2.2 · Column helpers and the first tables

**Goal:** model the tables in TypeScript, mapping camelCase properties to snake_case columns.

**Files:** `src/db/schema.ts`

**`src/db/schema.ts`** · new file

```ts
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();
const updatedAt = () =>
  timestamptz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/** Fractional-index keys compare byte by byte, so the column must use the "C" collation. */
const orderKey = customType<{ data: string }>({ dataType: () => 'text COLLATE "C"' });
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
```

**What's new (Drizzle vs. Prisma)**
- **The schema is plain TypeScript.** Prisma had its own language (`schema.prisma`) and a generator that wrote a client. Drizzle's `pgTable(...)` calls *are* the schema: the ORM reads them at runtime, and TypeScript infers every row type from them. Nothing is generated, so there's no `postinstall` step.
- **Column helpers are just functions.** `id()`, `createdAt()` and `updatedAt()` return column builders, so every table gets identical definitions without copy-paste. (The import list already names builders the next step uses.)
- **`default(sql\`uuidv7()\`)`**: PostgreSQL 18 generates **UUIDv7** itself. Prisma generated the id in Node before the INSERT; here the database does it, so a row inserted from `psql` gets a proper id too.
- **`timestamp(name, { withTimezone: true, mode: 'date' })`** is `timestamptz`, read back as a JS `Date`.
- **`$onUpdate(() => new Date())`** is Prisma's `@updatedAt`: Drizzle adds `updated_at = now` to every `update()` that doesn't set it.
- **`customType`** declares a column type Drizzle doesn't have a builder for. `orderKey` is `text COLLATE "C"`, the byte-order collation that fractional-index keys need (Part 6). Prisma couldn't express a collation at all, which is why Express's migration was hand-edited.

**`src/db/schema.ts`** · continue

```ts

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_email_check', sql`${t.email} = lower(${t.email})`),
  ],
);

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('workspaces_slug_key').on(t.slug)],
);

```

**`src/db/schema.ts`** · continue

```ts
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'viewer'] }).notNull(),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('workspace_members_workspace_id_user_id_key').on(t.workspaceId, t.userId),
    index('workspace_members_user_idx').on(t.userId, t.workspaceId),
    check('workspace_members_role_check', sql`${t.role} IN ('owner', 'admin', 'member', 'viewer')`),
  ],
);

```

**What's new**
- `pgTable('users', { … }, (t) => [ … ])`: the object maps **TypeScript property → column**. `passwordHash: text('password_hash')` is Prisma's `@map`. The third argument returns the table's indexes and constraints.
- `uniqueIndex('users_email_key')` and `check('users_email_check', sql\`…\`)`: names are explicit, so they match the reference schema (and Express's database) exactly. **CHECK constraints live in the schema**, so drizzle-kit generates them; Express had to add them by hand.
- `.references(() => users.id, { onDelete: 'cascade' })`: a foreign key. The arrow function delays the lookup, so tables can reference each other in any order.
- `text('role', { enum: [...] })` doesn't create a Postgres enum (the column stays `text`), but TypeScript now types `role` as `'owner' | 'admin' | 'member' | 'viewer'` everywhere you read it. The `check` enforces the same list in the database.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output (no errors).

**Commit:** `feat: drizzle tables for users, workspaces and members`

### Step 2.3 · The remaining tables

**Goal:** invitations, projects, columns, tasks, comments, attachments and the activity log.

**Files:** `src/db/schema.ts`

**`src/db/schema.ts`** · continue

```ts
export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member', 'viewer'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invitations_token_hash_key').on(t.tokenHash),
    uniqueIndex('invitations_pending_email_uq')
      .on(t.workspaceId, t.email)
      .where(sql`accepted_at IS NULL`),
    index('invitations_workspace_idx')
      .on(t.workspaceId, t.id)
      .where(sql`accepted_at IS NULL`),
    check('invitations_email_check', sql`${t.email} = lower(${t.email})`),
    check('invitations_role_check', sql`${t.role} IN ('admin', 'member', 'viewer')`),
  ],
);

```

**What's new**
- **Partial indexes:** `uniqueIndex(...).on(...).where(sql\`accepted_at IS NULL\`)` indexes only pending invitations. "One pending invitation per email" is enforced by the database, while accepted ones can repeat. Prisma needed a preview feature for this.

**`src/db/schema.ts`** · continue

```ts
export const projects = pgTable(
  'projects',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    nextTaskNumber: integer('next_task_number').notNull().default(1),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('projects_workspace_id_key_key').on(t.workspaceId, t.key),
    index('projects_workspace_idx').on(t.workspaceId, t.id),
    check('projects_key_check', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

export const boardColumns = pgTable(
  'board_columns',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: orderKey('position').notNull(),
    wipLimit: integer('wip_limit'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('board_columns_project_id_position_key').on(t.projectId, t.position),
    check('board_columns_wip_limit_check', sql`${t.wipLimit} BETWEEN 1 AND 999`),
  ],
);

```

**`src/db/schema.ts`** · continue

```ts
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // No ON DELETE action: Postgres refuses to delete a column that still has tasks.
    columnId: uuid('column_id')
      .notNull()
      .references(() => boardColumns.id),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    priority: text('priority', { enum: ['low', 'medium', 'high', 'urgent'] })
      .notNull()
      .default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id),
    dueAt: timestamptz('due_at'),
    reminderSentAt: timestamptz('reminder_sent_at'),
    position: orderKey('position').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_project_id_number_key').on(t.projectId, t.number),
    uniqueIndex('tasks_column_id_position_key').on(t.columnId, t.position),
    index('tasks_project_idx').on(t.projectId, t.id),
    index('tasks_assignee_idx').on(t.assigneeId, t.id),
    index('tasks_search_idx').using('gin', t.searchVector),
    index('tasks_due_reminder_idx')
      .on(t.dueAt)
      .where(sql`reminder_sent_at IS NULL AND assignee_id IS NOT NULL`),
    check('tasks_priority_check', sql`${t.priority} IN ('low', 'medium', 'high', 'urgent')`),
  ],
);

```

**What's new**
- `columnId: uuid(...).references(() => boardColumns.id)` has **no `onDelete`**, which means `NO ACTION`: Postgres refuses to delete a column that still holds tasks (the README decision), while deleting a project still cascades to both.
- **`generatedAlwaysAs(sql\`…\`)`** makes `search_vector` a `GENERATED ALWAYS … STORED` column: Postgres computes it from `title` and `description` on every write, and you can't write it yourself. The `tsvector` type comes from the second `customType`.
- **`index('tasks_search_idx').using('gin', t.searchVector)`** is a GIN index: an **inverted index** from each word to the rows containing it, which full-text search needs (Part 8).

**`src/db/schema.ts`** · continue

```ts
export const comments = pgTable(
  'comments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('comments_task_idx').on(t.taskId, t.id)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status', { enum: ['pending', 'ready'] })
      .notNull()
      .default('pending'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('attachments_storage_key_key').on(t.storageKey),
    index('attachments_task_idx')
      .on(t.taskId, t.id)
      .where(sql`status = 'ready'`),
    index('attachments_pending_idx')
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
    check('attachments_size_bytes_check', sql`${t.sizeBytes} > 0`),
    check('attachments_status_check', sql`${t.status} IN ('pending', 'ready')`),
  ],
);

```

**`src/db/schema.ts`** · continue

```ts
export const activityEvents = pgTable(
  'activity_events',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id'),
    taskId: uuid('task_id'),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id),
    type: text('type').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_workspace_idx').on(t.workspaceId, t.id),
    index('activity_project_idx')
      .on(t.projectId, t.id)
      .where(sql`project_id IS NOT NULL`),
    index('activity_task_idx')
      .on(t.taskId, t.id)
      .where(sql`task_id IS NOT NULL`),
  ],
);
```

**What's new**
- `bigint('size_bytes', { mode: 'number' })`: Postgres `bigint` can exceed JavaScript's safe integers, so Prisma returned a `bigint` and Express converted it at the API edge. `mode: 'number'` reads it as a plain `number`. That's safe here because the API caps uploads at 25 MB.
- `jsonb('data').$type<Record<string, unknown>>()` tells TypeScript the shape of the JSON column without changing the SQL.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: drizzle tables for projects, tasks, comments, attachments and activity`

### Step 2.4 · Generate the migration

**Goal:** one SQL migration that produces exactly the README's reference schema, with nothing to hand-edit.

**Files:** `drizzle/0000_init.sql`, `drizzle/meta/` (generated)

```bash
npx drizzle-kit generate --name init
```

drizzle-kit compares `schema.ts` with its last snapshot (none yet) and writes the difference as SQL. Open `drizzle/0000_init.sql` and look for the three things Express had to add by hand:

**`drizzle/0000_init.sql`** · excerpt

```sql
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"column_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"assignee_id" uuid,
	"reporter_id" uuid NOT NULL,
	"due_at" timestamp with time zone,
	"reminder_sent_at" timestamp with time zone,
	"position" text COLLATE "C" NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_priority_check" CHECK ("tasks"."priority" IN ('low', 'medium', 'high', 'urgent'))
);
```

**`drizzle/0000_init.sql`** · excerpt

```sql
CREATE INDEX "tasks_search_idx" ON "tasks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "tasks_due_reminder_idx" ON "tasks" USING btree ("due_at") WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL;--> statement-breakpoint
```

Then apply it:

```bash
npx drizzle-kit migrate
```

**What's new**
- **Every part of the reference schema is in the generated file**: `COLLATE "C"`, the `GENERATED ALWAYS AS … STORED` column, every `CHECK`, partial and GIN indexes. That's the practical difference between the two ORMs' schema languages: Drizzle's builders cover more of Postgres, so the migration file and the schema file never disagree.
- **`drizzle/meta/`** holds a JSON **snapshot** of the schema after each migration, plus a journal. The next `generate` diffs against the snapshot, not against a database. Commit both folders. (Your snapshot's random `id` fields will differ from the repo's; that's expected.)
- `drizzle-kit migrate` applies pending migrations and records them in the `drizzle.__drizzle_migrations` table.

**✅ Checkpoint**

```bash
docker compose exec postgres psql -U taskflow -c '\d tasks' | grep -E 'position|search_vector'
```

Expected:

```text
 position         | text                     | C         | not null |
 search_vector    | tsvector                 |           |          | generated always as (...) stored
```

**Commit:** `feat: initial migration generated by drizzle-kit`

### Step 2.5 · Database client, relations and drift check

**Goal:** the Drizzle client, its relational metadata, a migration runner that production can use, the Redis factory, and a script that proves `schema.ts` and the migrations agree.

**Files:** `src/db/relations.ts`, `src/db/client.ts`, `src/migrate.ts`, `src/infra/redis.ts`

```bash
npm i -E ioredis@6.0.0
npm pkg set scripts.db:generate="drizzle-kit generate" \
  scripts.db:migrate="tsx src/migrate.ts" \
  scripts.db:drift="drizzle-kit check && drizzle-kit generate --name drift | grep 'No schema changes'"
```

**`src/db/relations.ts`** · new file

```ts
import { relations } from 'drizzle-orm';
import {
  activityEvents,
  attachments,
  boardColumns,
  comments,
  invitations,
  projects,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from './schema.js';

// Relations are TypeScript-only metadata for `db.query.*` (no SQL, no migration).
// `one()` sits on the side that holds the foreign key; `many()` is its inverse.

export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  projects: many(projects),
}));

export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, { fields: [workspaceMembers.userId], references: [users.id] }),
}));

export const invitationsRelations = relations(invitations, ({ one }) => ({
  workspace: one(workspaces, { fields: [invitations.workspaceId], references: [workspaces.id] }),
  inviter: one(users, { fields: [invitations.invitedBy], references: [users.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, { fields: [projects.workspaceId], references: [workspaces.id] }),
```

**`src/db/relations.ts`** · continue

```ts
  columns: many(boardColumns),
  tasks: many(tasks),
}));

export const boardColumnsRelations = relations(boardColumns, ({ one, many }) => ({
  project: one(projects, { fields: [boardColumns.projectId], references: [projects.id] }),
  tasks: many(tasks),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  column: one(boardColumns, { fields: [tasks.columnId], references: [boardColumns.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  reporter: one(users, { fields: [tasks.reporterId], references: [users.id] }),
  comments: many(comments),
  attachments: many(attachments),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, { fields: [comments.taskId], references: [tasks.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  task: one(tasks, { fields: [attachments.taskId], references: [tasks.id] }),
  uploader: one(users, { fields: [attachments.uploaderId], references: [users.id] }),
}));

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  actor: one(users, { fields: [activityEvents.actorId], references: [users.id] }),
}));
```

**What's new**
- Drizzle has **two query APIs**. The **SQL-like builder** (`db.select().from(users).where(...)`) needs nothing else. The **relational API** (`db.query.tasks.findMany({ with: { assignee: true } })`) loads nested objects like Prisma's `include`, and for that it needs these `relations()` declarations. They are TypeScript only: no SQL, no migration.
- `one(users, { fields: [tasks.assigneeId], references: [users.id] })` sits on the side that holds the foreign key. `many(tasks)` on the other side is its inverse.
- A task has two relations to `users` (`assignee` and `reporter`). Because each `one()` names its own foreign key, there's no clash; Prisma needed `@relation("TaskAssignee")` names for the same situation.

**`src/db/client.ts`** · new file

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as relations from './relations.js';
import * as tables from './schema.js';

export const schema = { ...tables, ...relations };

export type Database = NodePgDatabase<typeof schema> & { $client: pg.Pool };
/** The `tx` handed to `db.transaction(async (tx) => …)`. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run a query: the pool-backed client or an open transaction. */
export type Db = Database | Tx;

export function createDb(databaseUrl: string): Database {
  return drizzle({ client: new pg.Pool({ connectionString: databaseUrl, max: 10 }), schema });
}
```

**What's new**
- `drizzle({ client: pool, schema })` wraps a node-postgres **pool** (10 connections). Passing `schema` (tables + relations) enables `db.query.*`.
- `Database` is the client; `Tx` is the `tx` you get inside `db.transaction(async (tx) => …)`; `Db` accepts either. Functions typed with `Db` work inside and outside a transaction (the activity log in Part 5 relies on it). Prisma had the same split (`PrismaClient | Prisma.TransactionClient`).
- `Parameters<Parameters<Database['transaction']>[0]>[0]` reads as "the first parameter of the callback that `transaction` takes", a way to name a type the library doesn't export.

**`src/migrate.ts`** · new file

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';

/** Applies pending migrations from ./drizzle. Production runs this with plain `node`. */
const db = createDb(loadConfig().DATABASE_URL);
await migrate(db, { migrationsFolder: 'drizzle' });
await db.$client.end();
console.log('migrations applied');
```

**`src/infra/redis.ts`** · new file

```ts
import { Redis } from 'ioredis';

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, lazyConnect: false });
}
```

**What's new**
- **`src/migrate.ts` applies migrations without drizzle-kit.** `migrate()` from `drizzle-orm/node-postgres/migrator` reads the SQL files and the journal, and runs whatever the `__drizzle_migrations` table hasn't seen. `drizzle-orm` is a runtime dependency, so the production image (Part 13) can run `node dist/migrate.js` without the dev-only CLI. Express's image had to keep the Prisma CLI for that.
- **Top-level `await`** works because this is an ES module.
- `db:drift` runs `drizzle-kit check` (are the snapshots consistent?) and then asks `generate` for a migration. If `schema.ts` has changes no migration captures, `generate` writes one and `grep` fails the script, and the new file shows you exactly what drifted. Unlike Prisma's drift check, it doesn't need a database.
- **`maxRetriesPerRequest: null`** on ioredis, as in Express: BullMQ needs it, and commands wait through a brief Redis restart instead of failing.

**✅ Checkpoint**

```bash
npm run db:migrate
npm run db:drift
```

Expected: `migrations applied` (nothing was pending, since you applied it in Step 2.4), then `No schema changes, nothing to migrate 😴`.

**Commit:** `feat: drizzle client, relations and migration runner`

---
## Part 3 · HTTP foundations

Before any business logic, we build what every endpoint relies on: problem+json errors, validation, request IDs and logging, 404/405/415 handling, health checks, the app/container skeleton, and the test harness. This is the Part where Fastify differs most from Express, so read the "What's new" notes closely.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one error type that becomes an `application/problem+json` response.

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
```

**`src/lib/problem.ts`** · continue

```ts

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
- Nothing: this file is identical to Express's. It knows nothing about the HTTP framework, which is exactly why it carries over. `ProblemSlug` is derived from `TITLES`, and `STATUS: Record<ProblemSlug, number>` refuses to compile if a slug lacks a status. Services throw these (`throw notFound('Task')`); one error handler (Step 3.4) turns them into responses.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output (no type errors).

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Schemas and validation

**Goal:** shared TypeBox schemas, and a validator setup that turns every request into typed data or a 422 whose `errors[].field` uses the wire names.

**Files:** `src/lib/schemas.ts`, `src/http/validation.ts`

```bash
npm i -E fastify@5.12.8 @fastify/type-provider-typebox@6.3.0 ajv@8.20.0 ajv-formats@3.0.1 ajv-keywords@5.1.0
```

- **`fastify`** itself. **`@fastify/type-provider-typebox`** teaches Fastify's TypeScript types to read TypeBox schemas, so a route's `request.body` gets the type of its body schema.
- **`ajv`** is the JSON Schema validator Fastify uses internally. We install it ourselves because we configure it (below); **`ajv-formats`** adds `format: 'email'`, `'uuid'`, `'date-time'`…; **`ajv-keywords`** adds the `transform` keyword (trim, lowercase).

**`src/lib/schemas.ts`** · new file

```ts
import { Type, type TSchema, type TProperties } from 'typebox';

/** A UUID string (the validator's `uuid` format is tightened in http/validation.ts). */
export const Id = Type.String({ format: 'uuid' });

export const Timestamp = Type.String({ format: 'date-time' });

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

/** A string trimmed before its length is checked (the `transform` keyword from ajv-keywords). */
export const Trimmed = (minLength: number, maxLength: number) =>
  Type.String({ transform: ['trim'], minLength, maxLength });

/** RFC 5322 address, stored lowercase. */
export const Email = Type.String({ format: 'email', maxLength: 254, transform: ['toLowerCase'] });

export const PageQuery = Type.Object({
  limit: Type.Integer({ minimum: 1, maximum: 100, default: 20 }),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$' })),
});

export const Page = <T extends TSchema>(item: T) =>
  Type.Object({ items: Type.Array(item), nextCursor: Nullable(Type.String()) });

/** PATCH bodies: every field optional, but after unknown keys are stripped at least one must remain. */
export const Patch = <T extends TProperties>(properties: T) =>
  Type.Partial(Type.Object(properties), { atLeastOneField: true });
```

**What's new**
- **These are schemas, not parsers.** In Express you called `parseBody(schema, req)` inside every handler. In Fastify you attach schemas to the route (`schema: { body, querystring, params, response }`) and Fastify validates **before** your handler runs; a handler only ever sees valid data.
- `Nullable`, `Page` and `Patch` are **functions that build schemas**. Because schemas are plain objects, generic helpers are ordinary TypeScript.
- `Trimmed` and `Email` carry a `transform` keyword: Ajv trims or lowercases the string *during* validation, before `minLength` is checked, which is what zod's `.trim()` and `.transform()` did.
- `Patch` makes every property optional and adds our own keyword, `atLeastOneField`, explained next.

**`src/http/validation.ts`** · new file

```ts
import { Ajv, type Options } from 'ajv';
import addFormats from 'ajv-formats';
import addKeywords from 'ajv-keywords';
import type { FastifyInstance, FastifySchemaValidationError } from 'fastify';
import type { FieldError } from '../lib/problem.js';

function createAjv(options: Options): Ajv {
  const ajv = new Ajv({ useDefaults: true, allErrors: true, strict: false, ...options });
  // Both are CommonJS packages: under Node's ESM rules their function is the `.default` export.
  addFormats.default(ajv);
  addKeywords.default(ajv, ['transform']);
  // ajv-formats' uuid also accepts a `urn:uuid:` prefix, which Postgres would reject with a 500.
  ajv.addFormat('uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  // Custom keywords run after `properties`, i.e. after unknown keys were stripped.
  ajv.addKeyword({
    keyword: 'atLeastOneField',
    type: 'object',
    schemaType: 'boolean',
    validate: (required: boolean, data: object) => !required || Object.keys(data).length > 0,
    error: { message: 'at least one field is required' },
  });
  return ajv;
}
```

**`src/http/validation.ts`** · continue

```ts

/**
 * Fastify compiles one validator per route part. Query strings and path params arrive as text,
 * so they need type coercion ("20" → 20); JSON bodies already carry types, so coercion there
 * would wrongly accept `{"title": 5}`.
 */
export function installValidators(app: FastifyInstance): void {
  const body = createAjv({ coerceTypes: false, removeAdditional: 'all' });
  const text = createAjv({ coerceTypes: 'array', removeAdditional: true });
  app.setValidatorCompiler(({ schema, httpPart }) =>
    (httpPart === 'body' ? body : text).compile(schema),
  );
}
```

**What's new**
- **One validator per request part.** Fastify compiles a validator for each route's `body`, `querystring`, `params` and `headers`, and `setValidatorCompiler` lets us choose how. Query strings and path params are text, so they need **coercion** (`"20"` → `20`). A JSON body already has types, so coercing it would wrongly accept `{"title": 5}`. Two Ajv instances keep the two policies apart.
- **`allErrors: true`** reports every invalid field at once (Ajv stops at the first by default). **`removeAdditional: 'all'`** strips unknown body keys, like zod objects did, so a client can't sneak `id` or `createdAt` into an update.
- **`atLeastOneField`** exists because of an ordering detail. JSON Schema's own `minProperties: 1` is checked *before* unknown keys are stripped, so `{"zz": 1}` would pass as `{}`. Ajv runs custom keywords after `properties`, so ours sees the cleaned object.
- **`addFormats.default(ajv)`**: `ajv-formats` is a CommonJS package. Imported from ES modules with `nodenext` resolution, its function arrives as the `.default` property. You'll meet this CJS/ESM seam again; the type checker tells you when it applies.
- We replace the `uuid` format: the stock one also accepts `urn:uuid:…`, which Postgres refuses with an error, and an unhandled error means a 500.

**`src/http/validation.ts`** · continue

```ts

export type RequestPart = 'body' | 'querystring' | 'params' | 'headers';

const PREFIX: Record<RequestPart, string> = {
  body: '',
  querystring: 'query',
  params: 'path',
  headers: 'header',
};

/** Ajv errors → our `{ field, message }` list, using the camelCase wire names. */
export function fieldErrors(
  errors: FastifySchemaValidationError[],
  context: RequestPart,
): FieldError[] {
  return errors.map((e) => {
    const segments = e.instancePath.split('/').filter(Boolean);
    if (e.keyword === 'required') segments.push(String(e.params.missingProperty));
    const path = segments.join('.');
    const prefix = PREFIX[context];
    const field = prefix ? [prefix, path].filter(Boolean).join('.') : path || 'body';
    return { field, message: e.message ?? 'is invalid' };
  });
}
```

**What's new**
- Ajv reports `instancePath: '/nested/projectId'` and, for a missing property, `keyword: 'required'` with `params.missingProperty`. `fieldErrors` turns those into the contract's wire names: `nested.projectId` for body fields, `query.limit` and `path.workspaceId` for the others (README §13), exactly the strings Express produced.

> **🧠 DSA & scalability · compiled validators**
> - **Data structure:** one generated JavaScript function per (route, request part), held in memory for the process's lifetime.
> - **Algorithm:** at startup, Ajv walks the schema once and **generates source code** (`if (typeof data.title !== 'string') errors.push(…)`), then `new Function()` turns it into a function. Per request, Fastify calls that function: no schema walking, no allocation beyond the error list.
> - **Complexity:** compile O(schema size) once; validate O(size of the input) per request.
> - **Why it scales:** the per-request cost is close to hand-written `if` statements, which is a large part of why Fastify benchmarks well. The same schemas also feed the serializer (Step 3.6).
> - **Rejected:** validating with zod inside handlers (works, but walks the schema on every call and keeps validation out of Fastify's lifecycle); coercing bodies (accepts wrong types); Ajv's default `allErrors: false` (clients fix one field per round trip).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: typebox schemas and ajv validation with wire field paths`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an `X-Request-Id`, every log line is JSON with that ID, each request is logged once, and responses carry the README's security headers.

**Files:** `src/infra/logger.ts`, `src/types/fastify.d.ts`, `src/http/hooks.ts`

```bash
npm i -E pino@10.4.0 uuid@14.0.3
```

- **`pino`** is Fastify's own logger. Fastify can create one for you; we create it ourselves, so the worker process (Part 11) logs in exactly the same format. **`uuid`** mints UUIDv7 request IDs.

**`src/infra/logger.ts`** · new file

```ts
import { pino, type Logger } from 'pino';
import type { Config } from '../config.js';

export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    base: { service: 'taskflow-fastify' },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
  });
}
```

**`src/types/fastify.d.ts`** · new file

```ts
import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the `authenticate` hook; null for anonymous requests. */
    userId: string | null;
  }
}

```

**`src/http/hooks.ts`** · new file

```ts
import type { IncomingMessage } from 'node:http';
import {
  LogController,
  type FastifyReply,
  type FastifyRequest,
  type onRequestAsyncHookHandler,
} from 'fastify';
import { v7 as uuidv7 } from 'uuid';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Fastify's `genReqId`: honour a well-formed incoming X-Request-Id, otherwise mint a UUIDv7. */
export function requestIdFrom(req: IncomingMessage): string {
  const incoming = req.headers['x-request-id'];
  return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
}

export const echoRequestIdAndSecure: onRequestAsyncHookHandler = async (request, reply) => {
  reply.headers({
    'X-Request-Id': request.id,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
};
```

**What's new**
- **Declaration merging, Fastify style.** `declare module 'fastify' { interface FastifyRequest { userId: … } }` adds a property to Fastify's request type. (Express's types lived in a global `Express` namespace; Fastify's are a normal module, so we *augment* the module.) The bare `import 'fastify'` makes this file a module augmentation rather than a fresh declaration.
- **`requestIdFrom`** becomes Fastify's `genReqId` option (Step 3.6). Fastify calls it once per request with the raw Node request, and `request.id` holds the result. A well-formed incoming `X-Request-Id` is kept, so one request can be traced across services.
- **A hook** is a function Fastify calls at a fixed point of the request lifecycle. `onRequest` is the first one, before the body is even read. This one echoes the ID and sets the security headers on **every** response, errors included. Typing it `onRequestAsyncHookHandler` says "async hook": Fastify waits for the returned promise instead of passing a `done` callback.

**`src/http/hooks.ts`** · continue

```ts

/** Fastify logs two lines per request by default; we want one, with the user, and no health probes. */
export class RequestLog extends LogController {
  constructor() {
    super({
      requestIdLogLabel: 'requestId',
      disableRequestLogging: (request) => request.url.startsWith('/health'),
    });
  }

  override incomingRequest(): void {
    // Folded into requestCompleted.
  }

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    if (this.isLogDisabled(request)) return;
    const line = {
      userId: request.userId ?? undefined,
      method: request.method,
      path: request.url,
      status: reply.statusCode,
      responseTime: Math.round(reply.elapsedTime),
    };
    if (error || reply.statusCode >= 500)
      reply.log.error({ ...line, err: error }, 'request completed');
    else reply.log.info(line, 'request completed');
  }
}
```

**What's new**
- **Fastify logs each request by default**, as two lines ("incoming request" and "request completed"). Express needed `pino-http` for this. Since Fastify 5.12 you customise those lines by subclassing **`LogController`** and passing an instance as the `logController` option: here we disable the "incoming" line, write one line per request with the user, method, path, status and duration, and skip health probes (`isLogDisabled`).
- `requestIdLogLabel: 'requestId'` names the request ID field in every log line (Fastify's default is `reqId`).
- `override` is TypeScript's keyword for "this method replaces the parent's" (required by `noImplicitOverride`).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · 415, 405, 404 and the error handler

**Goal:** turn every failure (unknown route, wrong method, non-JSON body, malformed JSON, invalid fields, a thrown `ProblemError`, a unique violation) into one problem+json response.

**Files:** `src/lib/pg-errors.ts`, `src/http/errors.ts`, `src/http/method-not-allowed.ts`

**`src/lib/pg-errors.ts`** · new file

```ts
/** Postgres SQLSTATE codes we turn into API errors. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/**
 * Drizzle wraps driver errors in a DrizzleQueryError whose `cause` is the pg DatabaseError,
 * so walk the cause chain to find the SQLSTATE.
 */
export function pgErrorCode(err: unknown): string | undefined {
  for (let e: unknown = err; typeof e === 'object' && e !== null; e = (e as Error).cause) {
    if ('code' in e && typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  }
  return undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === UNIQUE_VIOLATION;
export const isForeignKeyViolation = (err: unknown) => pgErrorCode(err) === FOREIGN_KEY_VIOLATION;
```

**What's new**
- **Drizzle doesn't classify database errors** the way Prisma did (`P2002` for unique violations). It wraps the driver's error in a `DrizzleQueryError` whose `cause` is the `pg` error carrying Postgres's **SQLSTATE** code: `23505` unique violation, `23503` foreign-key violation. `pgErrorCode` walks the `cause` chain until it finds a five-character code, so it works whether or not the error was wrapped.

**`src/http/errors.ts`** · new file

```ts
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { isUniqueViolation } from '../lib/pg-errors.js';
import { PROBLEM_TYPE_BASE, ProblemError, type ProblemSlug } from '../lib/problem.js';
import { fieldErrors } from './validation.js';

/** Fastify's own error codes for body parsing, mapped to our problem slugs. */
const BODY_ERRORS: Record<string, ProblemError> = {
  FST_ERR_CTP_INVALID_MEDIA_TYPE: new ProblemError(
    'unsupported-media-type',
    'Request body must be application/json',
  ),
  FST_ERR_CTP_BODY_TOO_LARGE: new ProblemError('payload-too-large'),
  FST_ERR_CTP_INVALID_JSON_BODY: new ProblemError('bad-request', 'Malformed JSON'),
  FST_ERR_CTP_EMPTY_JSON_BODY: new ProblemError('bad-request', 'Malformed JSON'),
};

const BY_STATUS: Partial<Record<number, ProblemSlug>> = {
  400: 'bad-request',
  404: 'not-found',
  405: 'method-not-allowed',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
};

function isFastifyError(err: unknown): err is FastifyError {
  return err instanceof Error && 'code' in err;
}
```

**`src/http/errors.ts`** · continue

```ts

function toProblem(err: unknown): ProblemError {
  if (err instanceof ProblemError) return err;
  if (isFastifyError(err) && err.validation && err.validationContext) {
    return new ProblemError(
      'validation-error',
      'The request contains invalid fields',
      fieldErrors(err.validation, err.validationContext),
    );
  }
  if (isFastifyError(err)) {
    const known = BODY_ERRORS[err.code];
    if (known) return known;
    // Any other client error Fastify raises itself keeps its status.
    const slug = BY_STATUS[err.statusCode ?? 500];
    if (slug) return new ProblemError(slug, err.message);
  }
  // JSON.parse failures inside the default body parser surface as a plain 400 SyntaxError.
  if (err instanceof SyntaxError && 'statusCode' in err && err.statusCode === 400) {
    return new ProblemError('bad-request', 'Malformed JSON');
  }
  if (isUniqueViolation(err)) {
    return new ProblemError('conflict', 'A resource with these values already exists');
  }
  return new ProblemError('internal', 'An unexpected error occurred');
}
```

**What's new**
- **Fastify raises its own errors** with stable codes (`FST_ERR_…`) and a `statusCode`. A body with the wrong `Content-Type` is `FST_ERR_CTP_INVALID_MEDIA_TYPE` (415, which Express needed custom middleware for), a body over `bodyLimit` is `FST_ERR_CTP_BODY_TOO_LARGE` (413). `BY_STATUS` maps any other Fastify client error by its status, so nothing Fastify raises falls through to a 500.
- **A validation failure is an error too:** Fastify attaches Ajv's errors as `err.validation` and the part that failed as `err.validationContext` (`'body'`, `'querystring'`, `'params'`), and we turn them into a 422 with `fieldErrors`. Fastify's default would be a 400; the contract says 422.

**`src/http/errors.ts`** · continue

```ts

function sendProblem(request: FastifyRequest, reply: FastifyReply, problem: ProblemError) {
  return reply
    .status(problem.status)
    .type('application/problem+json')
    .send({
      type: PROBLEM_TYPE_BASE + problem.slug,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      instance: request.url.split('?')[0],
      requestId: request.id,
      ...(problem.errors ? { errors: problem.errors } : {}),
    });
}

export function installErrorHandlers(app: FastifyInstance): void {
  app.setErrorHandler((err, request, reply) => {
    const problem = toProblem(err);
    if (problem.status >= 500) request.log.error({ err }, 'unhandled error');
    return sendProblem(request, reply, problem);
  });

  app.setNotFoundHandler((request, reply) =>
    sendProblem(request, reply, new ProblemError('not-found', 'No route matches this path')),
  );
}
```

**What's new**
- **`setErrorHandler`** is Express's 4-argument error middleware: every error thrown in a hook or handler (sync or async) ends here. In Express 5 async errors also reach the handler; in Fastify that has always been the case.
- **`setNotFoundHandler`** answers routes nothing matched. Express used a last-resort middleware; Fastify has a dedicated handler (and you can set one per URL prefix).

**`src/http/method-not-allowed.ts`** · new file

```ts
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { ProblemError } from '../lib/problem.js';

/**
 * Fastify answers a known path with an unknown method by 404; the contract wants 405 + Allow.
 * Runs `register`, records every route it declares, then adds one route per path that answers
 * every other method Fastify knows (TRACE and QUERY included). OPTIONS is left alone: CORS
 * preflight needs it. The new routes live in the same plugin, so they run behind the same
 * hooks (an anonymous `PUT /api/v1/workspaces` still gets 401 first).
 */
export async function withMethodNotAllowed(
  app: FastifyInstance,
  register: () => PromiseLike<unknown>,
): Promise<void> {
  const allowed = new Map<string, Set<string>>();
  let collecting = true;
  app.addHook('onRoute', (route) => {
    if (!collecting) return;
    const methods = allowed.get(route.routePath) ?? new Set<string>();
    for (const m of [route.method].flat()) methods.add(m);
    if (methods.has('GET')) methods.add('HEAD');
    allowed.set(route.routePath, methods);
  });

  await register();
  collecting = false;

```

**`src/http/method-not-allowed.ts`** · continue

```ts
  const candidates = app.supportedMethods.filter((m) => m !== 'OPTIONS') as HTTPMethods[];
  for (const [path, methods] of allowed) {
    const allow = candidates.filter((m) => methods.has(m)).join(', ');
    app.route({
      method: candidates.filter((m) => !methods.has(m)),
      url: path,
      // onRequest, not the handler: Fastify checks bodies (e.g. QUERY needs a Content-Type)
      // between the two, and the answer must be 405 whatever the body.
      onRequest: async (request, reply) => {
        reply.header('Allow', allow);
        throw new ProblemError(
          'method-not-allowed',
          `${request.method} is not supported on this path`,
        );
      },
      handler: async () => undefined,
    });
  }
}
```

**What's new**
- **Fastify answers a known path with an unknown method by 404.** The contract wants **405 with an `Allow` header**. Fastify has no switch for it, so `withMethodNotAllowed` builds it from two Fastify features:
  - **`onRoute` hook:** called every time a route is declared, with its path and methods. We use it to record which methods each path has.
  - **`app.supportedMethods`:** every method Fastify can route, including `TRACE` and `QUERY`. For each path we declare one more route with all the *other* methods, and it answers 405. `OPTIONS` is left out because CORS preflight (Step 3.6) uses it.
- The 405 is thrown from the route's own **`onRequest`** hook, not its handler. Between the two, Fastify checks bodies (a `QUERY` request must have a `Content-Type`), and an unsupported method must get 405 whatever its body looks like.
- The helper **wraps** the registrations (`withMethodNotAllowed(app, () => app.register(...))`) because it has to see all of a plugin's routes before adding its own. Its routes are declared in the same plugin, so they sit behind the same hooks: an anonymous `PUT /api/v1/workspaces` still gets 401 before 405, as in Express.

> **🧠 DSA & scalability · 405 without a per-request cost**
> - **Data structure:** at startup, a `Map<path, Set<method>>` built from `onRoute` events; at run time, ordinary routes in Fastify's router (**find-my-way**, a radix tree keyed by path segments, with one handler per method).
> - **Algorithm:** for each recorded path, declare a route for (all supported methods − the path's methods). A request with a wrong method then **matches a route** like any other request; no fallback search happens per request.
> - **Complexity:** O(routes) once at startup; per request, the usual radix-tree lookup, O(length of the path).
> - **Why it scales:** the 405 decision costs nothing extra at run time, and it lives inside each plugin, so encapsulated hooks (auth, rate limits) still apply.
> - **Rejected:** checking `app.hasRoute` for every method inside the 404 handler (that API takes a route *pattern*, not a concrete URL, and it would cost a lookup per method on every miss); Express-style `.all()` (Fastify has no per-path catch-all).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: problem+json error handler, 404 and 405`

### Step 3.5 · Health checks

**Goal:** `GET /health/live` (the process is up) and `GET /health/ready` (Postgres and Redis answer within a second), as **a Fastify plugin**.

**Files:** `src/modules/health/health.routes.ts`

**`src/modules/health/health.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { Type } from 'typebox';
import type { Database } from '../../db/client.js';

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
const Status = Type.Enum(['ok', 'unavailable']);
const Readiness = Type.Object({
  status: Status,
  checks: Type.Object({ database: Status, redis: Status }),
});

export const healthRoutes: FastifyPluginAsyncTypebox<{ db: Database; redis: Redis }> = async (
  app,
  { db, redis },
) => {
  app.get('/health/live', { schema: { response: { 200: Type.Object({ status: Status }) } } }, () =>
    Promise.resolve({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    { schema: { response: { 200: Readiness, 503: Readiness } } },
    async (_request, reply) => {
      const [database, cache] = await Promise.all([
        check(() => db.execute(sql`SELECT 1`)),
        check(() => redis.ping()),
      ]);
      const ok = database === 'ok' && cache === 'ok';
      return reply
        .status(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'unavailable', checks: { database, redis: cache } });
    },
  );
};
```

**What's new**
- **A route module is a plugin**: an `async (app, options) => { … }` function that declares routes on the instance it receives. `app.register(healthRoutes, { db, redis })` (Step 3.6) calls it with those options. Plugin options are how this codebase passes dependencies to routes, the role that factory-function arguments (`healthRoutes(prisma, redis)`) played in Express.
- **`FastifyPluginAsyncTypebox<Options>`** types the plugin: `options` is typed, and routes inside use the TypeBox type provider.
- **`schema: { response: { 200: …, 503: … } }`** is a **response schema**. Fastify compiles it into a **serializer** (fast-json-stringify) that writes exactly those properties, faster than `JSON.stringify`, and never leaks a property the schema doesn't list. TypeScript also checks your return value against it. Every route in this repo declares one.
- `return reply.status(...).send(...)` vs. `return value`: an async handler can simply return the body (as `/health/live` does); when you need a status code or headers, set them on `reply`.
- `db.execute(sql\`SELECT 1\`)` runs raw SQL through Drizzle's pool, the equivalent of Prisma's `$queryRaw`.

> **🧠 DSA & scalability · readiness with a deadline**
> - **Data structure:** none persistent; two promises raced against a timer.
> - **Algorithm:** run both probes **in parallel** (`Promise.all`), each raced against a 1-second timeout; the `finally` clears the timer so it can't keep the event loop alive.
> - **Complexity:** O(1) work; latency = max(probe latencies), capped at 1 s.
> - **Why it scales:** orchestrators poll readiness constantly. A hung dependency yields a fast `503` (take this instance out of the load balancer) instead of a probe that hangs.
> - **Rejected:** probing sequentially (latencies add up); a liveness probe that checks dependencies (a database blip would restart every healthy pod at once).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: health endpoints`

### Step 3.6 · The container, the app and `main.ts`

**Goal:** the three files that tie everything together. They start small and grow in every Part.

**Files:** `src/container.ts`, `src/app.ts`, `src/main.ts`

```bash
npm i -E @fastify/cors@11.4.1 @fastify/swagger@9.9.3 @fastify/swagger-ui@6.1.3 close-with-grace@2.5.0
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

- **`@fastify/cors`**, **`@fastify/swagger`** + **`@fastify/swagger-ui`** are official Fastify plugins (the `@fastify/` scope is maintained by the Fastify team). **`close-with-grace`** is the Fastify team's helper for graceful shutdown.

**`src/container.ts`** · new file

```ts
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Config } from './config.js';
import { createDb, type Database } from './db/client.js';
import { createLogger } from './infra/logger.js';
import { createRedis } from './infra/redis.js';
```

**`src/container.ts`** · continue

```ts

export interface Infra {
  config: Config;
  logger: Logger;
  db: Database;
  redis: Redis;
```

**`src/container.ts`** · continue

```ts
}

export function createInfra(config: Config): Infra {
  const redis = createRedis(config.REDIS_URL);
  return {
    config,
    logger: createLogger(config),
    db: createDb(config.DATABASE_URL),
    redis,
```

**`src/container.ts`** · continue

```ts
  };
}

export async function closeInfra(infra: Infra): Promise<void> {
```

**`src/container.ts`** · continue

```ts
  await infra.db.$client.end();
  infra.redis.disconnect();
}

/** Manual dependency injection: the one place that knows how everything is wired. */
export function createServices(infra: Infra) {
```

**`src/container.ts`** · continue

```ts
  return {
```

**`src/container.ts`** · continue

```ts
  };
}

export type Services = ReturnType<typeof createServices>;
```

**What's new**
- The same **hand-written dependency injection** as Express: `createInfra` builds the clients, `createServices` the services, and tests call the same functions. `createServices` returns `{}` for now and fills up as you go. (Fastify's own answer to DI is decorators and plugin options; we use plugin options to hand services to routes, below.)
- `infra.db.$client.end()` closes the node-postgres pool that Drizzle wraps.

**`src/app.ts`** · new file

```ts
import cors from '@fastify/cors';
```

**`src/app.ts`** · continue

```ts
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
```

**`src/app.ts`** · continue

```ts
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { Infra, Services } from './container.js';
```

**`src/app.ts`** · continue

```ts
import { installErrorHandlers } from './http/errors.js';
import { echoRequestIdAndSecure, RequestLog, requestIdFrom } from './http/hooks.js';
import { withMethodNotAllowed } from './http/method-not-allowed.js';
```

**`src/app.ts`** · continue

```ts
import { installValidators } from './http/validation.js';
```

**`src/app.ts`** · continue

```ts
import { healthRoutes } from './modules/health/health.routes.js';
```

**`src/app.ts`** · continue

```ts

```

**`src/app.ts`** · continue

```ts
export async function buildApp(infra: Infra, services: Services): Promise<FastifyInstance> {
  const { config, redis } = infra;
  // Widen pino's Logger to the interface Fastify's types are written against.
  const logger: FastifyBaseLogger = infra.logger;
  const app = Fastify({
    loggerInstance: logger,
    logController: new RequestLog(),
    genReqId: requestIdFrom,
    bodyLimit: 1_048_576,
    // A JSON key named __proto__ or constructor could poison prototypes; drop it instead of
    // failing the request, the same way unknown fields are ignored.
    onProtoPoisoning: 'remove',
    onConstructorPoisoning: 'remove',
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Fastify parses JSON and text/plain out of the box; this API speaks JSON only, so anything
  // else (text/plain included) is answered with 415 before a handler runs.
  app.removeContentTypeParser('text/plain');
  installValidators(app);
  installErrorHandlers(app);
  app.decorateRequest('userId', null);
  app.addHook('onRequest', echoRequestIdAndSecure);

```

**What's new**
- **`Fastify({ … })` creates an instance**; `buildApp` configures it but doesn't listen, so tests can use it without a port. It's `async` because registering plugins is asynchronous.
- **Options:** `loggerInstance` hands Fastify our pino logger (widened to the `FastifyBaseLogger` interface its types expect), `logController` the one-line request log, `genReqId` the request-ID function, `bodyLimit` the 1 MB JSON limit (413 above it). `onProtoPoisoning: 'remove'` deletes a `__proto__` key from parsed JSON instead of rejecting the request: Fastify protects against prototype poisoning by default, and removing the key keeps that protection while treating it like any other unknown field.
- **`.withTypeProvider<TypeBoxTypeProvider>()`** switches the instance's route typing to TypeBox: a route's `request.body`, `request.query` and return type come from its schemas.
- **`removeContentTypeParser('text/plain')`**: Fastify parses JSON and plain text out of the box. Without the text parser, a `text/plain` body gets 415 like every other non-JSON type.
- **`decorateRequest('userId', null)`** adds the property declared in `fastify.d.ts` to every request object, initialised once on the prototype. Fastify asks you to declare request properties up front so V8 can keep every request object the same shape (fast property access).
- **`addHook('onRequest', …)`** on the root instance runs for **every** request, including 404s.

**`src/app.ts`** · continue

```ts
  await app.register(cors, {
    origin: config.FRONTEND_URL,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
```

**`src/app.ts`** · continue

```ts

  if (config.NODE_ENV !== 'production') {
    await app.register(swagger, {
      mode: 'static',
      specification: { path: './contract/openapi.yaml', baseDir: process.cwd() },
    });
    await app.register(swaggerUi, { routePrefix: '/docs' });
  }

  await withMethodNotAllowed(app, () => app.register(healthRoutes, { db: infra.db, redis }));
```

**`src/app.ts`** · continue

```ts

  return app;
}
```

**What's new**
- **`await app.register(plugin, options)`** is the heart of Fastify. A plugin is a function that receives an instance and configures it; Fastify loads plugins **in order**, each after the previous one is ready (the loader is called *avvio*). Awaiting `register` makes "CORS first, then Swagger, then routes" explicit.
- **`@fastify/cors`** answers preflight `OPTIONS` requests itself and adds the CORS headers to every response, the same options as Express's `cors()`.
- **`@fastify/swagger` in `static` mode** serves the **committed** contract (the source of truth) instead of generating one from the routes, and `@fastify/swagger-ui` shows it at `/docs`. Development only.
- **`withMethodNotAllowed(app, () => app.register(healthRoutes, …))`**: the health plugin gets 405 handling for its two paths.

**`src/main.ts`** · new file

```ts
import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { closeInfra, createInfra, createServices } from './container.js';

const config = loadConfig();
const infra = createInfra(config);
const app = await buildApp(infra, createServices(infra));

closeWithGrace({ delay: 10_000 }, async ({ signal, err }) => {
  if (err) app.log.error({ err }, 'crashed');
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await closeInfra(infra);
});

await app.listen({ port: config.PORT, host: '0.0.0.0' });
```

**What's new**
- **`app.listen({ port, host: '0.0.0.0' })`**: Fastify's default host is `localhost`, which inside a container is unreachable from outside, so we listen on every interface. Fastify logs the address it listens on.
- **`closeWithGrace`** installs `SIGINT`/`SIGTERM` (and uncaught-error) handlers, runs our callback once, and force-exits after `delay` (10 s) if shutdown hangs, which is what Express's hand-written `shutdown()` did. **`app.close()`** stops accepting connections, waits for in-flight requests, and runs every plugin's `onClose` hook; then we close the pools.

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s localhost:8002/health/ready
curl -si -X POST localhost:8002/health/live | grep -iE '^(HTTP|allow)'
curl -s localhost:8002/nope
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
allow: GET, HEAD
{"type":"https://taskflow.example/problems/not-found","title":"Not found","status":404,"detail":"No route matches this path","instance":"/nope","requestId":"01…"}
```

The dev server's terminal shows one JSON line per request (none for `/health/*`). Open http://localhost:8002/docs to see the contract in Swagger UI.

**Commit:** `feat: app, container and server entry point`

### Step 3.7 · The test harness

**Goal:** Vitest running against a **separate** test database, with a helper that builds the whole app and sends requests **in-process**.

**Files:** `tests/test-env.ts`, `tests/global-setup.ts`, `vitest.config.ts`, `tests/helpers.ts`, `tests/unit/validation.test.ts`, `tests/integration/health.test.ts`

```bash
npm i -D -E vitest@5.1.0 @vitest/coverage-v8@5.1.0
```

- No Supertest: Fastify has request injection built in (below).

**`tests/test-env.ts`** · new file

```ts
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

/** Tests never touch the dev database: same server, database name suffixed with _test. */
function testDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://taskflow:taskflow@localhost:15402/taskflow',
  );
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Redis logical database 1 instead of 0. */
function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:16302/0');
  url.pathname = '/1';
  return url.toString();
}

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
  MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:18002',
};
```

**`tests/global-setup.ts`** · new file

```ts
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
```

**`tests/global-setup.ts`** · continue

```ts
import { createDb } from '../src/db/client.js';
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

  const db = createDb(testEnv.DATABASE_URL);
  await migrate(db, { migrationsFolder: 'drizzle' });
  await db.$client.end();
```

**`tests/global-setup.ts`** · continue

```ts
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
      exclude: ['src/main.ts', 'src/worker.ts', 'src/migrate.ts', 'src/seed.ts', 'src/types/**'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
```

**What's new**
- The same isolation as Express: database `taskflow_test` on the same server, Redis database 1, and test files run one at a time because they share that database.
- **`global-setup.ts` migrates with `migrate()`**, the same function as `src/migrate.ts`, so tests never shell out to a CLI.
- `process.loadEnvFile` again replaces `dotenv`.

**`tests/helpers.ts`** · new file

```ts
import type { FastifyInstance, HTTPMethods, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { closeInfra, createInfra, createServices, type Infra } from '../src/container.js';
```

**`tests/helpers.ts`** · continue

```ts

export interface TestContext {
  infra: Infra;
  services: ReturnType<typeof createServices>;
  app: FastifyInstance;
  close: () => Promise<void>;
}

export async function createTestContext(): Promise<TestContext> {
  const infra = createInfra(loadConfig());
  const services = createServices(infra);
  const app = await buildApp(infra, services);
  await app.ready();
  return {
    infra,
    services,
    app,
    close: async () => {
      await app.close();
      await closeInfra(infra);
    },
  };
}

export interface SendOptions {
  as?: { auth: Record<string, string> };
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

/**
 * `app.inject()` runs the request through Fastify in-process: no socket, no port.
 * Pass `status` to assert it; on a mismatch the failure message shows the response body.
 */
export async function send(
  ctx: TestContext,
  method: HTTPMethods,
  url: string,
  options: SendOptions = {},
  status?: number,
): Promise<LightMyRequestResponse> {
  const res = await ctx.app.inject({
    method,
    url,
    headers: { ...options.as?.auth, ...options.headers },
    ...(options.query ? { query: stringify(options.query) } : {}),
    ...(options.body !== undefined ? { payload: options.body as InjectOptions['payload'] } : {}),
  });
  if (status !== undefined) expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(status);
  return res;
}

const stringify = (query: Record<string, string | number>) =>
  Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));
```

**What's new**
- **`app.inject()`** runs a request through the whole Fastify pipeline (hooks, parsing, validation, handler, serialization) **without opening a socket**. It's provided by `light-my-request`, which Fastify includes, and it's why Fastify tests don't need Supertest. The response has `.statusCode`, `.headers`, `.json()` and `.cookies`.
- **`await app.ready()`** loads every registered plugin. `inject()` would do it on first use, but calling it in the helper surfaces plugin errors at setup.
- `send()` is our thin wrapper: `as: user` adds that user's `Authorization` header, `body` becomes the JSON payload, and passing `status` asserts it with the response body in the failure message, so a failing test tells you *why*.
- Test files use **top-level `await`**: `const ctx = await createTestContext();`.

**`tests/unit/validation.test.ts`** · new file

```ts
import type { FastifySchemaValidationError } from 'fastify';
import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../../src/http/validation.js';

const error = (
  instancePath: string,
  keyword = 'type',
  params: Record<string, unknown> = {},
): FastifySchemaValidationError => ({
  instancePath,
  keyword,
  params,
  schemaPath: '#',
  message: 'x',
});

describe('validation field paths', () => {
  it('uses camelCase wire paths for body fields, including missing ones', () => {
    const errors = [
      error('', 'required', { missingProperty: 'dueAt' }),
      error('/nested', 'required', { missingProperty: 'projectId' }),
      error('', 'atLeastOneField'),
    ];
    expect(fieldErrors(errors, 'body').map((e) => e.field)).toEqual([
      'dueAt',
      'nested.projectId',
      'body',
    ]);
  });

  it('prefixes query and path parameters', () => {
    expect(fieldErrors([error('/limit')], 'querystring')[0]?.field).toBe('query.limit');
    expect(fieldErrors([error('/workspaceId')], 'params')[0]?.field).toBe('path.workspaceId');
  });
});
```

**`tests/integration/health.test.ts`** · new file

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext, send } from '../helpers.js';

const ctx = await createTestContext();
afterAll(() => ctx.close());

describe('health', () => {
  it('reports liveness without touching dependencies', async () => {
    const res = await send(ctx, 'GET', '/health/live', {}, 200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('reports readiness of Postgres and Redis', async () => {
    const res = await send(ctx, 'GET', '/health/ready', {}, 200);
    expect(res.json()).toEqual({ status: 'ok', checks: { database: 'ok', redis: 'ok' } });
  });

  it('answers unknown routes with a problem+json 404 that echoes the request id', async () => {
    const res = await send(ctx, 'GET', '/nope', { headers: { 'X-Request-Id': 'abc-123' } }, 404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.headers['x-request-id']).toBe('abc-123');
    expect(res.json()).toMatchObject({
      type: 'https://taskflow.example/problems/not-found',
      status: 404,
      instance: '/nope',
      requestId: 'abc-123',
    });
  });

  it('answers undeclared methods with 405 and an Allow header', async () => {
    const res = await send(ctx, 'POST', '/health/live', {}, 405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.json()).toMatchObject({
      type: 'https://taskflow.example/problems/method-not-allowed',
    });
  });
});
```

**What's new**
- The unit test feeds `fieldErrors` the shape Ajv produces, so the wire field names are pinned without a server.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 ✓ tests/unit/validation.test.ts (2 tests)
 ✓ tests/integration/health.test.ts (4 tests)

 Test Files  2 passed (2)
      Tests  6 passed (6)
```

**Commit:** `test: vitest harness with app.inject and health tests`

---
## Part 4 · Authentication

The auth design (README §6) is unchanged: argon2id passwords, 15-minute JWT access tokens, and 7-day refresh tokens that rotate on every use, are stored hashed in Redis, and revoke their whole family when replayed. What changes is how Fastify plugs it in: a JWT **plugin**, **hooks** instead of middleware, and **encapsulation** to protect a group of routes.

### Step 4.1 · Password hashing with argon2id

**Goal:** hash passwords with argon2id, and make "unknown email" take as long as "wrong password".

**Files:** `src/modules/auth/passwords.ts`

```bash
npm i -E argon2@0.45.2
npm deny-scripts argon2
```

argon2's install script would compile it from C (`node-gyp rebuild`); the package also ships **prebuilt binaries** for Linux, macOS and Windows, which it loads when the build is skipped. Denying the script keeps installs fast and works in a slim Docker image without a compiler.

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
- Identical to Express: this file doesn't touch the HTTP framework.

> **🧠 DSA & scalability · password hashing**
> - **Algorithm:** argon2id, a *memory-hard* hash: each verification fills 19 MiB of RAM and makes 2 passes over it.
> - **Why memory-hard:** attackers guess passwords on GPUs with thousands of cores but little memory per core; 19 MiB per guess caps how many run in parallel. bcrypt is only CPU-hard, and SHA-256 is designed to be fast, the opposite of what you want.
> - **Cost:** ~20–50 ms of CPU per login, on purpose. Logins are rare, and `/auth/*` gets a strict rate limit (Step 4.6).
> - **Timing side channel:** `verifyAgainstDummy` makes "no such email" do the same work as "wrong password", so response times don't reveal which emails have accounts.
> - **Rejected:** bcrypt (72-byte limit, not memory-hard), PBKDF2 (CPU-hard only), plain SHA-256 (fast = crackable).

**✅ Checkpoint**

```bash
npx tsx -e "import('./src/modules/auth/passwords.ts').then(async (m) => { const h = await m.hashPassword('pw'); console.log(h.slice(0, 31), await m.verifyPassword(h, 'pw')) })"
```

Expected: `$argon2id$v=19$m=19456,t=2,p=1$ true` (the hash's parameters, then a successful verification).

**Commit:** `feat: argon2id password hashing`

### Step 4.2 · Access tokens with `@fastify/jwt`

**Goal:** sign and verify 15-minute access tokens with Fastify's JWT plugin.

**Files:** `src/types/fastify.d.ts`, `src/app.ts`

```bash
npm i -E @fastify/jwt@10.2.7
```

- **`@fastify/jwt`** wraps **fast-jwt** and plugs it into Fastify: `app.jwt.sign()` creates a token, and `request.jwtVerify()` reads the `Authorization: Bearer …` header and verifies it. In Express you wrote this as an `AccessTokens` class around `jsonwebtoken`.

**`src/types/fastify.d.ts`** · add at the top

```ts
import '@fastify/jwt';
```

**`src/types/fastify.d.ts`** · continue

```ts
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: Record<string, never>;
    user: { sub: string };
  }
}
```

**What's new**
- **`FastifyJWT`** is the plugin's extension point for your token shapes: `payload` is what you sign (empty: everything we need goes in registered claims), and `user` is what `jwtVerify()` returns. Augmenting it makes both typed.

**`src/app.ts`** · add after `import cors from '@fastify/cors';`

```ts
import jwt from '@fastify/jwt';
```

**`src/app.ts`** · add before `export async function buildApp(infra: Infra, services: Services): Promise<FastifyInstance> {`

```ts
export const ISSUER = 'taskflow';
export const AUDIENCE = 'taskflow-api';

```

**`src/app.ts`** · add after the CORS registration (after its closing `});`)

```ts
  await app.register(jwt, {
    secret: config.JWT_SECRET,
    sign: {
      algorithm: 'HS256',
      iss: ISSUER,
      aud: AUDIENCE,
      expiresIn: config.ACCESS_TOKEN_TTL_SECONDS,
    },
    verify: {
      algorithms: ['HS256'],
      allowedIss: ISSUER,
      allowedAud: AUDIENCE,
      clockTolerance: 30_000,
    },
  });
```

**What's new**
- **Plugin options are the configuration**: `sign` defaults apply to every `app.jwt.sign()` call, `verify` defaults to every `request.jwtVerify()`. `HS256` with a ≥ 32-byte secret, issuer `taskflow`, audience `taskflow-api`, 15-minute lifetime (`expiresIn` is in seconds here), 30 s of clock tolerance (in milliseconds: fast-jwt's unit).
- `algorithms: ['HS256']` pins the verifier to one algorithm, so a token claiming `alg: none` or an asymmetric algorithm is rejected (a classic JWT attack).
- `ISSUER` and `AUDIENCE` are exported constants: tests and other services can refer to them instead of repeating strings.
- **`register` decorates the instance.** After this line, `app.jwt` exists on the instance and `request.jwtVerify` on every request. Plugins extend Fastify by **decorating** it; that's how a plugin "adds features".

> **🧠 DSA & scalability · stateless access tokens**
> - **Data structure:** a JWT: base64url(header) . base64url(claims) . HMAC-SHA256(secret, the first two parts).
> - **Algorithm:** verifying = recompute the HMAC and compare in constant time, then check `exp`, `iss`, `aud`.
> - **Complexity:** O(token length), no I/O.
> - **Why it scales:** any API instance can verify any token without asking a database or Redis, so the hot path (every authenticated request) has no shared state. The price is that an access token can't be revoked; that's why it lives only 15 minutes, and revocation happens at refresh (Step 4.3).
> - **Rejected:** opaque session IDs looked up in Redis on every request (a network round trip per request); long-lived JWTs (a leaked one works for days).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: jwt access tokens with @fastify/jwt`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** opaque refresh tokens, stored as SHA-256 hashes, rotated atomically on every use, with reuse detection.

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
- Identical to Express: refresh tokens are a Redis concern, not a framework one. Read the 🧠 box as a refresher.

> **🧠 DSA & scalability · refresh-token rotation**
> - **Data structures (Redis):** a **hash** per token, `auth:rt:{sha256}` → `{userId, familyId, status}`, and a **set** per family, `auth:family:{id}` → token hashes. Both have a TTL, so Redis expires old sessions by itself.
> - **Algorithm (rotate, one Lua script):** missing → invalid. Status `rotated` → the token was already used once (stolen or replayed): delete the whole family → invalid. Otherwise mark it `rotated`, create the next token in the same family, return it.
> - **Complexity:** rotate O(1); revoking a family O(k) for its k tokens (bounded by the TTL).
> - **Why atomic:** two tabs refreshing with the same token at once would both pass a check-then-update done in two round trips. Inside one Lua script, exactly one wins.
> - **Why hash:** a Redis dump or a leaked log shows only SHA-256 hashes. Fast hashing is fine here (unlike for passwords) because the token is 256 random bits.
> - **Rejected:** refresh JWTs (not revocable without a denylist), Postgres storage (a DB write per refresh), no rotation (a stolen token lives 7 days).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: rotating refresh tokens with reuse detection`

### Step 4.4 · Users repository and DTOs

**Goal:** the user table's queries in one place, and the public shape of a user as a TypeBox schema.

**Files:** `src/modules/users/users.dto.ts`, `src/modules/users/users.repository.ts`

**`src/modules/users/users.dto.ts`** · new file

```ts
import { Type, type Static } from 'typebox';
import { Id, Timestamp } from '../../lib/schemas.js';

export const UserSummary = Type.Object({
  id: Id,
  email: Type.String(),
  displayName: Type.String(),
});
export const User = Type.Object({ ...UserSummary.properties, createdAt: Timestamp });

export type UserSummaryDto = Static<typeof UserSummary>;
export type UserDto = Static<typeof User>;

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
- **The DTO is a schema first.** `UserSummary` and `User` are TypeBox schemas that routes use as **response schemas**; the `…Dto` types are derived from them with `Static`. In Express you wrote the interfaces by hand. Now the API shape, the serializer and the TypeScript type come from one definition.
- `{ ...UserSummary.properties, createdAt }` extends an object schema by spreading its properties, like `z.object().extend()`.
- The mappers (`toUser`) still exist: they convert a row (with `Date`s) into the wire format (ISO strings), and they pick fields explicitly, so a row's `passwordHash` can never reach a response.

**`src/modules/users/users.repository.ts`** · new file

```ts
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { users } from '../../db/schema.js';

/** Drizzle `columns` selection for the public user summary (never the password hash). */
export const userSummaryColumns = { id: true, email: true, displayName: true } as const;

export class UsersRepository {
  constructor(private readonly db: Db) {}

  findById(id: string) {
    return this.db.query.users.findFirst({ where: eq(users.id, id) });
  }

  findByEmail(email: string) {
    return this.db.query.users.findFirst({ where: eq(users.email, email) });
  }

  findSummaries(ids: string[]) {
    return this.db.query.users.findMany({
      where: inArray(users.id, ids),
      columns: userSummaryColumns,
    });
  }

  async create(data: { email: string; passwordHash: string; displayName: string }) {
    const [user] = await this.db.insert(users).values(data).returning();
    if (!user) throw new Error('INSERT … RETURNING returned no row');
    return user;
  }

  async update(id: string, data: { displayName?: string | undefined }) {
    const [user] = await this.db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }
}
```

**What's new (Drizzle queries)**
- **`db.query.users.findFirst({ where: eq(users.id, id) })`** is the relational API: it returns the row or `undefined`. `eq` builds a SQL condition from a column and a value (bound as a parameter, so there's no SQL injection).
- **`columns: userSummaryColumns`** selects only those columns, like Prisma's `select`.
- **`db.insert(users).values(data).returning()`** is the SQL-like builder: `INSERT … RETURNING *`. It returns an **array** (an INSERT can write many rows), hence `const [user] = …`, and `noUncheckedIndexedAccess` makes `user` possibly `undefined`, hence the guard.
- **`db.update(users).set(data).where(…)`**: an `UPDATE`. Keys whose value is `undefined` are left out of the `SET`, so `{ displayName: undefined }` changes nothing. Our `updatedAt` column gets `now` automatically (`$onUpdate`, Step 2.2).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: users repository and dtos`

### Step 4.5 · Auth service and the authentication hooks

**Goal:** register, login, refresh and logout as plain business logic, and the hooks that read the access token.

**Files:** `src/modules/auth/auth.service.ts`, `src/http/auth.ts`

**`src/modules/auth/auth.service.ts`** · new file

```ts
import { conflict, unauthorized } from '../../lib/problem.js';
import { toUser, type UserDto } from '../users/users.dto.js';
import type { UsersRepository } from '../users/users.repository.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import type { RefreshTokens } from './refresh-tokens.js';

/** The service proves who you are; the route turns that into an access token and a cookie. */
export interface Session {
  user: UserDto;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly users: UsersRepository,
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

  async refresh(token: string | undefined): Promise<{ userId: string; refreshToken: string }> {
    if (!token) throw unauthorized('Missing refresh token');
    const result = await this.refreshTokens.rotate(token);
    if (result.status !== 'ok') throw unauthorized('Invalid refresh token');
    return { userId: result.userId, refreshToken: result.token };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.refreshTokens.revokeFamily(token);
  }

  private async startSession(user: Parameters<typeof toUser>[0]): Promise<Session> {
    return { user: toUser(user), refreshToken: await this.refreshTokens.issue(user.id) };
  }
}
```

**What's new**
- **The service doesn't create access tokens any more.** In Express, `AuthService` took an `AccessTokens` class. Here signing belongs to the jwt plugin, which lives on the Fastify instance, so the service returns *who* the user is (and the new refresh token) and the route (Step 4.7) signs the access token. The service stays free of HTTP and JWT details.

**`src/http/auth.ts`** · new file

```ts
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { unauthorized } from '../lib/problem.js';

/** Reads a Bearer token if there is one. A bad token is a 401; no token is decided later. */
export const authenticate: onRequestAsyncHookHandler = async (request) => {
  if (!request.headers.authorization?.startsWith('Bearer ')) return;
  try {
    const { sub } = await request.jwtVerify<{ sub: string }>();
    request.userId = sub;
  } catch {
    throw unauthorized('Invalid or expired access token');
  }
};

export const requireAuth: onRequestAsyncHookHandler = async (request) => {
  if (request.userId === null) throw unauthorized();
};

/** The authenticated user's id. Only call behind `requireAuth`. */
export function userIdOf(request: FastifyRequest): string {
  if (request.userId === null) throw unauthorized();
  return request.userId;
}
```

**What's new**
- **These are `onRequest` hooks, not middleware.** A hook doesn't call `next()`: it returns (or resolves) to continue, and throws to stop with an error, which goes to the error handler. Express's `next(err)` and `next()` become `throw` and `return`.
- `authenticate` only *reads* a token. A missing header leaves `request.userId` null, a bad token is a 401. `requireAuth` then rejects anonymous requests. Keeping them apart lets the rate limiter (next step) run in between and limit by user when it can, by IP otherwise, the same order as in Express.
- **`request.jwtVerify()`** comes from `@fastify/jwt`. Its errors have their own messages and codes; we replace them with our single "Invalid or expired access token" 401, so clients see one problem type.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: auth service and authentication hooks`

### Step 4.6 · Sliding-window rate limiting

**Goal:** 10 auth requests per minute per IP, 300 API requests per minute per user, shared by every instance through Redis.

**Files:** `src/http/rate-limit.ts`

**`src/http/rate-limit.ts`** · new file

```ts
import type { onRequestAsyncHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
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

/** An `onRequest` hook: it runs before the body is even read, so a flood costs almost nothing. */
export function rateLimit(options: {
  limiter: SlidingWindowLimiter;
  bucket: string;
  byUser: boolean;
}): onRequestAsyncHookHandler {
  return async (request, reply) => {
    const subject =
      options.byUser && request.userId ? `user:${request.userId}` : `ip:${request.ip}`;
    let result: RateLimitResult;
    try {
      result = await options.limiter.hit(`ratelimit:${options.bucket}:${subject}`);
    } catch (err) {
      request.log.warn({ err }, 'rate limiter unavailable; failing open');
      return;
    }
    if (result.allowed) return;
    reply.header('Retry-After', String(result.retryAfterSeconds));
    throw new ProblemError('rate-limited', `Retry in ${result.retryAfterSeconds} seconds`);
  };
}
```

**What's new**
- The limiter class is Express's; only the wrapper changed: **`rateLimit()` returns an `onRequest` hook**. `onRequest` runs before Fastify reads the body, so a flood of large requests is rejected before any of it is parsed.
- `request.ip` is the client address Fastify computed (honouring `trustProxy` if you enable it behind a load balancer).
- **Why not `@fastify/rate-limit`?** It's the official plugin, and a fine choice for most apps. It implements a **fixed window** (one counter per window), while TaskFlow's README asks for a **sliding window**, and we want the same algorithm in all six backends so the comparison stays fair.

> **🧠 DSA & scalability · sliding-window log**
> - **Data structure:** a Redis **sorted set** per (bucket, subject): member = a unique request ID, score = timestamp in ms.
> - **Algorithm (one Lua call):** `ZREMRANGEBYSCORE` drops entries older than the window → `ZCARD` counts the rest → if count ≥ limit, read the oldest score to compute `Retry-After` → else `ZADD` this request and `PEXPIRE` the key.
> - **Complexity:** O(log n) per request for n entries in the window; memory O(limit) per subject.
> - **Why it scales:** the state is in Redis, so every API instance shares one limit per user; the Lua script makes it atomic. If Redis is down we **fail open** (log and let the request through) rather than take the API down with it.
> - **Rejected:** fixed window (`INCR` + `EXPIRE`, O(1) but allows 2× the limit across a boundary), token bucket (great for bursts; Pulse uses one), in-memory limits (wrong as soon as there are two instances).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: redis sliding-window rate limiter`

### Step 4.7 · Routes, and wiring it all up

**Goal:** `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and `/users/me`, wired into the app behind the right hooks.

**Files:** `src/modules/auth/auth.routes.ts`, `src/modules/users/users.routes.ts`, `src/app.ts`, `src/container.ts`

```bash
npm i -E @fastify/cookie@11.1.5
```

- **`@fastify/cookie`** parses the `Cookie` header into `request.cookies` and adds `reply.setCookie()` / `reply.clearCookie()`, Express's `cookie-parser` plus `res.cookie()`.

**`src/modules/auth/auth.routes.ts`** · new file

```ts
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyRequest, onRequestAsyncHookHandler } from 'fastify';
import { Type } from 'typebox';
import { Email, Trimmed } from '../../lib/schemas.js';
import { User } from '../users/users.dto.js';
import type { AuthService } from './auth.service.js';

const COOKIE = 'refresh_token';

const RegisterBody = Type.Object({
  email: Email,
  password: Type.String({ minLength: 8, maxLength: 128 }),
  displayName: Trimmed(1, 80),
});

const LoginBody = Type.Object({
  email: Email,
  password: Type.String({ minLength: 1, maxLength: 128 }),
});

const AccessToken = Type.Object({
  accessToken: Type.String(),
  tokenType: Type.Literal('Bearer'),
  expiresIn: Type.Integer(),
});
const AuthSession = Type.Object({ ...AccessToken.properties, user: User });

export interface AuthRoutesOptions {
  auth: AuthService;
  secureCookie: boolean;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  rateLimit: onRequestAsyncHookHandler;
}

```

**What's new**
- **Request and response schemas side by side.** `RegisterBody` validates the input (trimmed name, lowercased email); `AuthSession` describes the output and drives the serializer. `Type.Literal('Bearer')` is a one-value type, like zod's `z.literal`.
- `AuthRoutesOptions` is what the plugin needs from outside: the service, the cookie settings, and the rate-limit hook. The app (below) passes them in.

**`src/modules/auth/auth.routes.ts`** · continue

```ts
export const authRoutes: FastifyPluginAsyncTypebox<AuthRoutesOptions> = async (app, opts) => {
  const cookie: CookieSerializeOptions = {
    httpOnly: true,
    secure: opts.secureCookie,
    sameSite: 'lax',
    path: '/api/v1/auth',
  };
  const persistent = { ...cookie, maxAge: opts.refreshTtlSeconds };
  const accessToken = (userId: string) => ({
    accessToken: app.jwt.sign({}, { sub: userId }),
    tokenType: 'Bearer' as const,
    expiresIn: opts.accessTtlSeconds,
  });
  const limited = { onRequest: opts.rateLimit };

  app.post(
    '/auth/register',
    { ...limited, schema: { body: RegisterBody, response: { 201: AuthSession } } },
    async (request, reply) => {
      const { user, refreshToken } = await opts.auth.register(request.body);
      reply.setCookie(COOKIE, refreshToken, persistent).status(201);
      return { ...accessToken(user.id), user };
    },
  );
```

**`src/modules/auth/auth.routes.ts`** · continue

```ts

  app.post(
    '/auth/login',
    { ...limited, schema: { body: LoginBody, response: { 200: AuthSession } } },
    async (request, reply) => {
      const { email, password } = request.body;
      const { user, refreshToken } = await opts.auth.login(email, password);
      reply.setCookie(COOKIE, refreshToken, persistent);
      return { ...accessToken(user.id), user };
    },
  );

  app.post(
    '/auth/refresh',
    { ...limited, schema: { response: { 200: AccessToken } } },
    async (request, reply) => {
      const { userId, refreshToken } = await opts.auth.refresh(cookieOf(request));
      reply.setCookie(COOKIE, refreshToken, persistent);
      return accessToken(userId);
    },
  );

  app.post('/auth/logout', async (request, reply) => {
    await opts.auth.logout(cookieOf(request));
    return reply.clearCookie(COOKIE, cookie).status(204).send();
  });
};

function cookieOf(request: FastifyRequest): string | undefined {
  const value = request.cookies[COOKIE];
  return value !== undefined && value.length > 0 ? value : undefined;
}
```

**What's new**
- **Route-level hooks:** `{ onRequest: opts.rateLimit }` in a route's options runs that hook for this route only. `limited` is spread into the three routes that need the strict auth limit; `/auth/logout` doesn't.
- **`app.jwt.sign({}, { sub: userId })`** signs with the defaults from Step 4.2 plus the subject. The route builds the token response, since the jwt plugin lives on the instance.
- **`reply.setCookie(name, value, options)`**: `maxAge` is in **seconds** here (Express's `res.cookie` took milliseconds). `clearCookie` must repeat the same `path`, or the browser keeps the cookie. `reply.status(201)` then `return body`: setting the status doesn't send anything; returning the body does.
- **`request.cookies`** is typed `Record<string, string | undefined>`; `cookieOf` turns an empty value into `undefined`.

**`src/modules/users/users.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { userIdOf } from '../../http/auth.js';
import { notFound } from '../../lib/problem.js';
import { Patch, Trimmed } from '../../lib/schemas.js';
import { toUser, User } from './users.dto.js';
import type { UsersRepository } from './users.repository.js';

const UpdateUserBody = Patch({ displayName: Trimmed(1, 80) });

export const usersRoutes: FastifyPluginAsyncTypebox<{ users: UsersRepository }> = async (
  app,
  { users },
) => {
  app.get('/users/me', { schema: { response: { 200: User } } }, async (request) => {
    const user = await users.findById(userIdOf(request));
    if (!user) throw notFound('User');
    return toUser(user);
  });

  app.patch(
    '/users/me',
    { schema: { body: UpdateUserBody, response: { 200: User } } },
    async (request) => {
      const user = await users.update(userIdOf(request), request.body);
      if (!user) throw notFound('User');
      return toUser(user);
    },
  );
};
```

**What's new**
- The handler only extracts what it needs and returns a DTO; validation already happened (`UpdateUserBody` is a `Patch`, so `{}` is a 422 before the handler runs).

**`src/container.ts`** · add after `import { createRedis } from './infra/redis.js';`

```ts
import { AuthService } from './modules/auth/auth.service.js';
import { RefreshTokens } from './modules/auth/refresh-tokens.js';
```

**`src/container.ts`** · add after `import { RefreshTokens } from './modules/auth/refresh-tokens.js';`

```ts
import { UsersRepository } from './modules/users/users.repository.js';
```

**`src/container.ts`** · add after `export function createServices(infra: Infra) {`

```ts
  const { config, db, redis } = infra;
  const users = new UsersRepository(db);
```

**`src/container.ts`** · add after `return {` in `createServices`

```ts
    users,
```

**`src/container.ts`** · add after `users,`

```ts
    auth: new AuthService(users, new RefreshTokens(redis, config.REFRESH_TOKEN_TTL_SECONDS)),
```

**`src/app.ts`** · add at the top

```ts
import cookie from '@fastify/cookie';
```

**`src/app.ts`** · add after `import type { Infra, Services } from './container.js';`

```ts
import { authenticate, requireAuth } from './http/auth.js';
```

**`src/app.ts`** · add after `import { withMethodNotAllowed } from './http/method-not-allowed.js';`

```ts
import { rateLimit, SlidingWindowLimiter } from './http/rate-limit.js';
```

**`src/app.ts`** · add after `import { installValidators } from './http/validation.js';`

```ts
import { authRoutes } from './modules/auth/auth.routes.js';
```

**`src/app.ts`** · add after `import { healthRoutes } from './modules/health/health.routes.js';`

```ts
import { usersRoutes } from './modules/users/users.routes.js';
```

**`src/app.ts`** · add before `export const ISSUER = 'taskflow';`

```ts
const MINUTE = 60_000;
```

**`src/app.ts`** · add before `await app.register(jwt, {`

```ts
  await app.register(cookie);
```

**`src/app.ts`** · add after `await withMethodNotAllowed(app, () => app.register(healthRoutes, { db: infra.db, redis }));`

```ts

  const authLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_AUTH_PER_MINUTE, MINUTE),
    bucket: 'auth',
    byUser: false,
  });
  const apiLimit = rateLimit({
    limiter: new SlidingWindowLimiter(redis, config.RATE_LIMIT_API_PER_MINUTE, MINUTE),
    bucket: 'api',
    byUser: true,
  });

  await app.register(
    async (api) => {
      await withMethodNotAllowed(api, () =>
        api.register(authRoutes, {
          auth: services.auth,
          secureCookie: config.COOKIE_SECURE,
          accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
          refreshTtlSeconds: config.REFRESH_TOKEN_TTL_SECONDS,
          rateLimit: authLimit,
        }),
      );

      // Everything in this child context requires a valid access token. Hooks added here
      // don't leak to the auth routes above: that's Fastify's plugin encapsulation.
      await api.register(async (secured) => {
        secured.addHook('onRequest', authenticate);
        secured.addHook('onRequest', apiLimit);
        secured.addHook('onRequest', requireAuth);
        await withMethodNotAllowed(secured, async () => {
          await secured.register(usersRoutes, { users: services.users });
```

**`src/app.ts`** · add after `await secured.register(usersRoutes, { users: services.users });`

```ts
        });
      });
    },
    { prefix: '/api/v1' },
  );
```

**What's new**
- **Encapsulation is the key Fastify idea here.** `app.register(async (api) => { … }, { prefix: '/api/v1' })` creates a **child context**: routes registered inside get the `/api/v1` prefix, and hooks added inside apply only inside. Within it, the auth routes are registered first, then **another child context** (`secured`) adds `authenticate`, the API rate limit and `requireAuth`. Those hooks run for every route registered in `secured` and **never** for the auth routes next to it. In Express the same effect came from the *order* of `api.use()` calls; in Fastify it's the *shape of the plugin tree*, which can't be broken by moving a line.
- **Hook order** is the order of `addHook` calls: authenticate → rate limit (by user if known) → require auth.
- `withMethodNotAllowed` wraps each context's registrations, so `PUT /api/v1/auth/login` is a 405 and an anonymous `PUT /api/v1/users/me` is a 401.

> **🧠 DSA & scalability · hooks per context**
> - **Data structure:** each Fastify context (plugin instance) holds arrays of hooks per lifecycle event; a child copies its parent's arrays when it's created, then appends its own.
> - **Algorithm:** at registration, each route gets the hook arrays of the context it was declared in, frozen; per request, Fastify runs that route's arrays in order.
> - **Complexity:** per request O(hooks on that route): no matching or `if (path.startsWith(…))` checks at run time.
> - **Why it scales:** adding protected modules adds no per-request cost to unprotected ones, and a route can't accidentally escape authentication by being declared in the wrong order.
> - **Rejected:** a global hook that checks the URL against an allow-list (easy to forget a path; every request pays for the check).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s -c /tmp/tf.cookies localhost:8002/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}' | head -c 120; echo
curl -s -b /tmp/tf.cookies -X POST localhost:8002/api/v1/auth/refresh | head -c 60; echo
curl -s localhost:8002/api/v1/users/me
```

Expected: a session starting `{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":900,"user":{…`, then `{"accessToken":"eyJ…` (refreshed with the cookie; curl, like browsers, sends `Secure` cookies to `localhost`), then a 401 problem: `{"type":"https://taskflow.example/problems/unauthorized",…}`.

**Commit:** `feat: auth and users routes behind encapsulated hooks`

### Step 4.8 · Auth tests

**Goal:** prove registration, validation, content types, login, rotation with reuse detection, logout, protection and rate limiting.

**Files:** `tests/helpers.ts`, `tests/integration/auth.test.ts`

**`tests/helpers.ts`** · add at the top

```ts
import { sql } from 'drizzle-orm';
```

**`tests/helpers.ts`** · continue

```ts

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
  await ctx.infra.db.execute(sql.raw(`TRUNCATE ${TABLES.join(', ')} CASCADE`));
  await ctx.infra.redis.flushdb();
}
```

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
  const res = await send(
    ctx,
    'POST',
    '/api/v1/auth/register',
    { body: { email, password: 'correct-horse-battery', displayName: name } },
    201,
  );
  const body = res.json<{ accessToken: string; user: { id: string } }>();
  return {
    id: body.user.id,
    email,
    token: body.accessToken,
    auth: { Authorization: `Bearer ${body.accessToken}` },
  };
}
```

**What's new**
- `resetState` truncates every table and flushes Redis database 1 before each test. `sql.raw()` inserts the SQL text as-is (table names can't be bound parameters), which is only safe because the string is ours.
- `registerUser` goes through the real API, so every test user has a real argon2 hash and a real token.

**`tests/integration/auth.test.ts`** · new file

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerUser, resetState, send } from '../helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

/** The raw Set-Cookie header for the refresh token, and the `name=value` part to send back. */
function refreshCookie(res: LightMyRequestResponse) {
  const header = [res.headers['set-cookie'] ?? []]
    .flat()
    .find((c) => c.startsWith('refresh_token='));
  if (!header) throw new Error('no refresh cookie');
  return { header, pair: header.split(';')[0] ?? '' };
}

const register = (email: string) =>
  send(
    ctx,
    'POST',
    '/api/v1/auth/register',
    { body: { email, password: 'correct-horse', displayName: 'Ada' } },
    201,
  );
```

**`tests/integration/auth.test.ts`** · continue

```ts

describe('auth', () => {
  it('registers, sets a hardened refresh cookie, and returns the session', async () => {
    const res = await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: 'Ada@Example.com', password: 'correct-horse', displayName: '  Ada  ' } },
      201,
    );
    expect(res.json()).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
      user: { email: 'ada@example.com', displayName: 'Ada' },
    });
    const { header } = refreshCookie(res);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rejects a duplicate email with 409', async () => {
    const user = await registerUser(ctx, 'Ada');
    await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: user.email.toUpperCase(), password: 'another-pass', displayName: 'Ada' } },
      409,
    );
  });
```

**`tests/integration/auth.test.ts`** · continue

```ts

  it('returns 422 with camelCase field errors', async () => {
    const res = await send(
      ctx,
      'POST',
      '/api/v1/auth/register',
      { body: { email: 'not-an-email', password: 'short', displayName: '' } },
      422,
    );
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    const fields = res
      .json<{ errors: { field: string }[] }>()
      .errors.map((e) => e.field)
      .sort();
    expect(fields).toEqual(['displayName', 'email', 'password']);
  });

  it('returns 400 for malformed JSON, 415 for non-JSON bodies, 405 for other methods', async () => {
    const login = '/api/v1/auth/login';
    const json = { 'Content-Type': 'application/json' };
    await send(ctx, 'POST', login, { headers: json, body: '{"email":' }, 400);
    await send(ctx, 'POST', login, { headers: { 'Content-Type': 'text/plain' }, body: 'hi' }, 415);
    const res = await send(ctx, 'PUT', login, { body: {} }, 405);
    expect(res.headers.allow).toBe('POST');
  });

  it('logs in, and gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerUser(ctx, 'Ada');
    const login = (email: string, password: string) =>
      send(ctx, 'POST', '/api/v1/auth/login', { body: { email, password } });
    expect((await login(user.email, 'correct-horse-battery')).statusCode).toBe(200);
    const wrong = await login(user.email, 'nope');
    const unknown = await login('ghost@example.com', 'nope');
    expect([wrong.statusCode, unknown.statusCode]).toEqual([401, 401]);
    expect(wrong.json<{ detail: string }>().detail).toBe(unknown.json<{ detail: string }>().detail);
  });
```

**`tests/integration/auth.test.ts`** · continue

```ts

  it('rotates refresh tokens and revokes the family when an old one is reused', async () => {
    const first = refreshCookie(await register('rot@example.com')).pair;
    const refresh = (cookie: string, status: number) =>
      send(ctx, 'POST', '/api/v1/auth/refresh', { headers: { Cookie: cookie } }, status);

    const refreshed = await refresh(first, 200);
    expect(refreshed.json()).toMatchObject({ tokenType: 'Bearer' });
    const second = refreshCookie(refreshed).pair;
    expect(second).not.toBe(first);

    // Replaying the rotated token looks like theft: everything in the family dies.
    await refresh(first, 401);
    await refresh(second, 401);
  });

  it('logout revokes the session and clears the cookie', async () => {
    const cookie = refreshCookie(await register('out@example.com')).pair;
    const headers = { Cookie: cookie };
    const res = await send(ctx, 'POST', '/api/v1/auth/logout', { headers }, 204);
    expect(refreshCookie(res).header).toMatch(/Expires=Thu, 01 Jan 1970/);
    await send(ctx, 'POST', '/api/v1/auth/refresh', { headers }, 401);
  });

  it('protects /users/me and lets the user rename themselves', async () => {
    await send(ctx, 'GET', '/api/v1/users/me', {}, 401);
    await send(ctx, 'GET', '/api/v1/users/me', { headers: { Authorization: 'Bearer junk' } }, 401);
    const user = await registerUser(ctx, 'Ada');
    await send(
      ctx,
      'PATCH',
      '/api/v1/users/me',
      { as: user, body: { displayName: 'Ada L.' } },
      200,
    );
    const me = await send(ctx, 'GET', '/api/v1/users/me', { as: user }, 200);
    expect(me.json()).toMatchObject({ id: user.id, displayName: 'Ada L.' });
    await send(ctx, 'PATCH', '/api/v1/users/me', { as: user, body: {} }, 422);
  });
```

**`tests/integration/auth.test.ts`** · continue

```ts

  it('allows 10 auth requests per minute per IP, then 429 with Retry-After', async () => {
    const attempt = () =>
      send(ctx, 'POST', '/api/v1/auth/login', {
        body: { email: 'nobody@example.com', password: 'x' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).statusCode).toBe(401);
    const limited = await attempt();
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({
      type: 'https://taskflow.example/problems/rate-limited',
    });
  });
});
```

**What's new**
- **`res.headers['set-cookie']`** from `inject()` is the raw header (a string or an array); `refreshCookie` finds ours and keeps the `name=value` part to send back in a `Cookie` header.
- The malformed-JSON case sends a raw string as the body with a JSON `Content-Type`; the 415 case sends `text/plain`, which only works because we removed Fastify's text parser in Step 3.6.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  3 passed (3)
      Tests  15 passed (15)
```

**Commit:** `test: auth integration tests`

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

**`src/seed.ts`** · new file

```ts
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { DEFAULT_USER, seedDefaultUser } from './modules/users/default-user.js';
import { UsersRepository } from './modules/users/users.repository.js';

/** `npm run db:seed`: creates the default development user (idempotent). */
const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
const db = createDb(config.DATABASE_URL);
const result = await seedDefaultUser(new UsersRepository(db));
await db.$client.end();
console.log(`default user ${DEFAULT_USER.email}: ${result}`);
```

```bash
npm pkg set scripts.db:seed="tsx src/seed.ts"
```

**What's new**
- A small program, like `src/migrate.ts`: load the validated config, open a Drizzle client, seed, close the pool so the process can exit.
- **It refuses to run in production**: the password is in this repo, so a seeded production database would have an account anyone can log into. (`vitest.config.ts` already lists `src/seed.ts` among the entry scripts excluded from coverage.)

**`tests/integration/seed.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER, seedDefaultUser } from '../../src/modules/users/default-user.js';
import { UsersRepository } from '../../src/modules/users/users.repository.js';
import { createTestContext, resetState, send } from '../helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('default user seed', () => {
  it('creates the user once, and the user can log in', async () => {
    const users = new UsersRepository(ctx.infra.db);
    expect(await seedDefaultUser(users)).toBe('created');
    expect(await seedDefaultUser(users)).toBe('exists');
    const body = { email: DEFAULT_USER.email, password: DEFAULT_USER.password };
    const res = await send(ctx, 'POST', '/api/v1/auth/login', { body }, 200);
    expect(res.json()).toMatchObject({
      user: { email: DEFAULT_USER.email, displayName: 'Ashutosh' },
    });
  });
});
```

**✅ Checkpoint**

```bash
npm run db:seed && npm run db:seed
npm test
```

Expected: `default user ashutosh@test.com: created`, then `default user ashutosh@test.com: exists`, then:

```text
 Test Files  4 passed (4)
      Tests  16 passed (16)
```

Now `npm run dev` and log in from the frontend (or `curl`) with `ashutosh@test.com` / `Ashutosh#1234`.

**Commit:** `feat: seed the default development user`

---
## Part 5 · Workspaces & RBAC

Workspaces, members and invitations: the README's RBAC rules (§5) and the first services that write several rows in one transaction. The business rules are Express's; the new material is **Drizzle's transactions, locks, joins and subqueries**, and route modules as typed plugins.

### Step 5.1 · Roles and the access check

**Goal:** one place that answers "is this user a member of this workspace, with at least this role?", with 404 for outsiders and 403 for a role that's too low.

**Files:** `src/modules/workspaces/roles.ts`, `src/modules/workspaces/access.ts`

**`src/modules/workspaces/roles.ts`** · new file

```ts
import { Type } from 'typebox';

export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = Type.Enum(ROLES);
export const InvitableRoleSchema = Type.Enum(['admin', 'member', 'viewer']);

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
```

**What's new**
- `ROLES` is a `const` tuple; `Role` is derived from it, and `RoleSchema` is a TypeBox enum built from the same tuple. Express had a zod enum and an `asRole()` parser, needed because Prisma typed `role` as `string`. **Drizzle types the column itself** (`text('role', { enum: … })`, Step 2.2), so every row already has `role: Role` and `asRole()` disappears.

**`src/modules/workspaces/access.ts`** · new file

```ts
import { and, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  attachments,
  boardColumns,
  comments,
  projects,
  tasks,
  workspaceMembers,
} from '../../db/schema.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
export class Access {
  constructor(private readonly db: Database) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    });
    if (!membership) throw notFound(what);
    if (!atLeast(membership.role, minimum)) throw forbidden();
    return membership;
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.db.query.projects.findFirst({ where: eq(projects.id, projectId) });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }
```

**`src/modules/workspaces/access.ts`** · continue

```ts

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.db.query.boardColumns.findFirst({
      where: eq(boardColumns.id, columnId),
      with: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }

  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.db.query.tasks.findFirst({
      where: eq(tasks.id, taskId),
      with: { project: true },
    });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.db.query.comments.findFirst({
      where: eq(comments.id, commentId),
      with: { task: { with: { project: true } } },
    });
    if (!comment) throw notFound('Comment');
    const { project } = comment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Comment');
    return { comment, project, membership };
  }
```

**`src/modules/workspaces/access.ts`** · continue

```ts

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.db.query.attachments.findFirst({
      where: eq(attachments.id, attachmentId),
      with: { task: { with: { project: true } } },
    });
    if (!attachment) throw notFound('Attachment');
    const { project } = attachment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Attachment');
    return { attachment, project, membership };
  }
}
```

**What's new**
- **`and(eq(…), eq(…))`** combines conditions; the composite `UNIQUE (workspace_id, user_id)` index answers it with one seek. (Prisma exposed that index as `workspaceId_userId`; Drizzle just writes the `WHERE`.)
- **`with: { project: true }`** loads a relation in the same query (Drizzle builds a JSON sub-select), like Prisma's `include`. `with: { task: { with: { project: true } } }` nests.
- Every method returns the loaded rows, so services don't fetch the same resource twice.

> **🧠 DSA & scalability · authorization check**
> - **Data structure:** the `UNIQUE (workspace_id, user_id)` B-tree index, and a 4-entry rank table in code.
> - **Algorithm:** one indexed lookup for the membership, then `RANK[role] >= RANK[minimum]`. Nested resources (task → project → workspace) add one primary-key lookup with a join.
> - **Complexity:** O(log n) index seek; O(1) role comparison.
> - **Why 404 for outsiders:** a 403 would confirm the ID exists; the same 404 as a missing ID leaks nothing.
> - **Rejected:** roles inside the JWT (a demoted admin keeps their rights until the token expires, and roles differ per workspace); a permission-per-action table (overkill for four fixed roles).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: roles and workspace access checks`

### Step 5.2 · The activity log and the job queue

**Goal:** an append-only activity log that writes **inside** the caller's transaction, and a typed facade over a BullMQ queue.

**Files:** `src/modules/activity/activity.repository.ts`, `src/jobs/queue.ts`

```bash
npm i -E bullmq@6.7.5
npm deny-scripts msgpackr-extract
```

**BullMQ** is a Redis-backed job queue (the same choice as Express); `msgpackr-extract` is an optional native speed-up a dependency tries to compile, with a pure-JavaScript fallback.

**`src/modules/activity/activity.repository.ts`** · new file

```ts
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { activityEvents } from '../../db/schema.js';
import { userSummaryColumns } from '../users/users.repository.js';

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
  data?: Record<string, unknown>;
}
```

**`src/modules/activity/activity.repository.ts`** · continue

```ts

/** Append-only: there is deliberately no update or delete method. */
export class ActivityRepository {
  /** Takes `db` per call so it can join the caller's transaction. */
  async record(db: Db, event: ActivityInput): Promise<void> {
    await db.insert(activityEvents).values({
      workspaceId: event.workspaceId,
      actorId: event.actorId,
      type: event.type,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      data: event.data ?? {},
    });
  }

  list(
    db: Db,
    filter: { workspaceId: string; projectId?: string | undefined; taskId?: string | undefined },
    page: { limit: number; afterId?: string | undefined },
  ) {
    return db.query.activityEvents.findMany({
      // and() skips undefined conditions, so optional filters need no branching.
      where: and(
        eq(activityEvents.workspaceId, filter.workspaceId),
        filter.projectId ? eq(activityEvents.projectId, filter.projectId) : undefined,
        filter.taskId ? eq(activityEvents.taskId, filter.taskId) : undefined,
        page.afterId ? lt(activityEvents.id, page.afterId) : undefined,
      ),
      orderBy: desc(activityEvents.id),
      limit: page.limit + 1,
      with: { actor: { columns: userSummaryColumns } },
    });
  }
}
```

**What's new**
- **`record(db: Db, …)`** takes the database handle per call. Pass a transaction's `tx` and the activity row commits or rolls back with the change it describes.
- **`and()` skips `undefined` arguments**, so optional filters are written inline (`filter.projectId ? eq(…) : undefined`) instead of the spread-into-an-object pattern Prisma needed.
- `orderBy: desc(activityEvents.id)` and `limit: page.limit + 1` set up cursor pagination (Step 5.3).
- `data: event.data ?? {}` goes into the `jsonb` column as-is: the driver serialises it.

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
- Identical to Express: services enqueue through `Jobs.enqueue(name, data)`, typed per job name by `JobData`, and never import BullMQ themselves. Retries use exponential backoff with jitter; completed and failed jobs are trimmed.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: activity log repository and typed job queue`

### Step 5.3 · Cursor pagination

**Goal:** opaque, tamper-proof-enough cursors and one helper that turns `limit + 1` rows into a page.

**Files:** `src/lib/cursor.ts`, `tests/unit/cursor.test.ts`

**`src/lib/cursor.ts`** · new file

```ts
import { Type, type Static, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { invalid } from './problem.js';
import { Id } from './schemas.js';

export const IdCursor = Type.Object({ id: Id });
export const RankCursor = Type.Object({ rank: Type.Number(), id: Id });

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<T extends TSchema>(schema: T, cursor: string): Static<T> {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
  if (!Value.Check(schema, json)) throw invalid('query.cursor', 'is not a valid cursor');
  return json;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
```

**`src/lib/cursor.ts`** · continue

```ts

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

**What's new**
- The cursor is base64url JSON, as in Express. Decoding validates it with **TypeBox's `Value.Check`**, the same library as everything else, instead of a zod schema. A cursor that isn't base64, isn't JSON, or doesn't match the schema is a 422 on `query.cursor`.
- `decodeCursor<T extends TSchema>(schema: T, …): Static<T>` is generic over the schema, so `decodeCursor(IdCursor, c).id` is typed `string`.

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

> **🧠 DSA & scalability · keyset (cursor) pagination**
> - **Data structure:** composite B-tree indexes like `(workspace_id, id)`; UUIDv7 IDs are **time-ordered**, so `ORDER BY id` is creation order.
> - **Algorithm:** `WHERE <scope> AND id < :cursor ORDER BY id DESC LIMIT limit + 1`; the extra row only says "there is a next page", and the cursor is the last row returned.
> - **Complexity:** O(log n + k) per page: one index seek, then k entries. Page 1000 costs what page 1 costs.
> - **Why not OFFSET:** `OFFSET 20000` walks and discards 20,000 rows (O(n)), and concurrent inserts shift pages (duplicates, skipped rows). A keyset cursor is stable.

**✅ Checkpoint**

```bash
npm test -- tests/unit/cursor.test.ts
```

Expected: `Tests  6 passed (6)`.

**Commit:** `feat: keyset cursor pagination helpers`

### Step 5.4 · Workspace service

**Goal:** list, create, read, rename and delete workspaces, each change recorded in the activity log in the same transaction.

**Files:** `src/modules/workspaces/workspaces.dto.ts`, `src/modules/workspaces/workspaces.service.ts`

**`src/modules/workspaces/workspaces.dto.ts`** · new file

```ts
import { Type, type Static } from 'typebox';
import { Id, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { InvitableRoleSchema, RoleSchema, type Role } from './roles.js';

export const Workspace = Type.Object({
  id: Id,
  name: Type.String(),
  slug: Type.String(),
  currentUserRole: RoleSchema,
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Member = Type.Object({ user: UserSummary, role: RoleSchema, joinedAt: Timestamp });

export const Invitation = Type.Object({
  id: Id,
  workspaceId: Id,
  email: Type.String(),
  role: InvitableRoleSchema,
  invitedBy: UserSummary,
  expiresAt: Timestamp,
  createdAt: Timestamp,
});

export const toWorkspace = (
  w: { id: string; name: string; slug: string; createdAt: Date; updatedAt: Date },
  role: Role,
): Static<typeof Workspace> => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});
```

**`src/modules/workspaces/workspaces.dto.ts`** · continue

```ts

export const toMember = (m: {
  user: UserSummaryDto;
  role: Role;
  joinedAt: Date;
}): Static<typeof Member> => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});

export const toInvitation = (i: {
  id: string;
  workspaceId: string;
  email: string;
  role: Exclude<Role, 'owner'>;
  inviter: UserSummaryDto;
  expiresAt: Date;
  createdAt: Date;
}): Static<typeof Invitation> => ({
  id: i.id,
  workspaceId: i.workspaceId,
  email: i.email,
  role: i.role,
  invitedBy: toUserSummary(i.inviter),
  expiresAt: i.expiresAt.toISOString(),
  createdAt: i.createdAt.toISOString(),
});
```

**What's new**
- Response schemas for the three resources of this module; each mapper declares its return type as `Static<typeof Schema>`, so a mapper that forgets a field fails to compile.

**`src/modules/workspaces/workspaces.service.ts`** · new file

```ts
import { and, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { projects, workspaceMembers, workspaces } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from './access.js';
import { toWorkspace } from './workspaces.dto.js';

export class WorkspacesService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const rows = await this.db.query.workspaceMembers.findMany({
      where: and(
        eq(workspaceMembers.userId, userId),
        after ? lt(workspaceMembers.workspaceId, after) : undefined,
      ),
      orderBy: desc(workspaceMembers.workspaceId),
      limit: limit + 1,
      with: { workspace: true },
    });
    return toPage(
      rows,
      limit,
      (m) => toWorkspace(m.workspace, m.role),
      (m) => ({ id: m.workspaceId }),
    );
  }
```

**`src/modules/workspaces/workspaces.service.ts`** · continue

```ts

  async create(userId: string, input: { name: string; slug: string }) {
    try {
      const workspace = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(workspaces)
          .values({ ...input, createdBy: userId })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: created.id, userId, role: 'owner' });
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

  async get(workspaceId: string, userId: string) {
    const membership = await this.access.member(workspaceId, userId);
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(workspaces.id, workspaceId),
    });
    if (!workspace) throw notFound('Workspace');
    return toWorkspace(workspace, membership.role);
  }
```

**`src/modules/workspaces/workspaces.service.ts`** · continue

```ts

  async update(
    workspaceId: string,
    userId: string,
    input: { name?: string | undefined; slug?: string | undefined },
  ) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(workspaces)
          .set(input)
          .where(eq(workspaces.id, workspaceId))
          .returning();
        if (!updated) throw notFound('Workspace');
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
```

**`src/modules/workspaces/workspaces.service.ts`** · continue

```ts

  async delete(workspaceId: string, userId: string) {
    await this.access.member(workspaceId, userId, 'owner');
    const owned = await this.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    for (const p of owned) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
```

**What's new (Drizzle)**
- **`this.db.transaction(async (tx) => { … })`** runs the callback in one transaction: `BEGIN`, your queries on `tx`, `COMMIT`, or `ROLLBACK` if it throws. Same shape as Prisma's `$transaction`.
- **`tx.insert(workspaces).values({ ...input, createdBy: userId }).returning()`** returns the inserted row with its database-generated `id` (`uuidv7()`), which the next insert needs.
- **Unique violations** surface as `DrizzleQueryError`s; `isUniqueViolation` (Step 3.4) finds SQLSTATE `23505` in the cause chain and the service turns it into a 409 "Slug is already taken".
- **`db.select({ id: projects.id }).from(projects).where(…)`** is the SQL-like builder with an explicit column list: it returns `{ id }[]`, nothing else.
- Deleting the workspace cascades in Postgres (`ON DELETE CASCADE`); the storage cleanup is queued for the worker (Part 11).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: workspaces service`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** admins manage members and viewers, only owners manage admins and owners, and a workspace never loses its last owner, even under concurrency.

**Files:** `src/modules/workspaces/members.service.ts`

**`src/modules/workspaces/members.service.ts`** · new file

```ts
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { projects, tasks, workspaceMembers } from '../../db/schema.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from './access.js';
import type { Role } from './roles.js';
import { toMember } from './workspaces.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

export class MembersService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.workspaceMembers.findMany({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        after ? gt(workspaceMembers.id, after) : undefined,
      ),
      orderBy: asc(workspaceMembers.id),
      limit: limit + 1,
      with: { user: { columns: userSummaryColumns } },
    });
    return toPage(rows, limit, toMember, (m) => ({ id: m.id }));
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts

  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.db.transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const from = target.role;
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx
        .update(workspaceMembers)
        .set({ role: newRole })
        .where(eq(workspaceMembers.id, target.id));
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return this.findTarget(tx, workspaceId, targetUserId);
    });
    return toMember(updated);
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts

  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.db.transaction(async (tx) => {
      const target = await this.findTarget(tx, workspaceId, targetUserId);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(target.role));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (target.role === 'owner') await this.assertNotLastOwner(tx, workspaceId);
      await tx.delete(workspaceMembers).where(eq(workspaceMembers.id, target.id));
      // A subquery inside IN (…): every project of this workspace, in one statement.
      await tx
        .update(tasks)
        .set({ assigneeId: null })
        .where(
          and(
            eq(tasks.assigneeId, targetUserId),
            inArray(
              tasks.projectId,
              tx
                .select({ id: projects.id })
                .from(projects)
                .where(eq(projects.workspaceId, workspaceId)),
            ),
          ),
        );
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
    const target = await tx.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
      with: { user: { columns: userSummaryColumns } },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first, so two owners demoting each other at the same
   * time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(tx: Db, workspaceId: string) {
    const owners = await tx
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, 'owner')))
      .for('update');
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
```

**What's new (Drizzle)**
- **`.for('update')`** appends `FOR UPDATE` to a `SELECT`: Postgres row-locks the returned rows until the transaction ends. Prisma had no builder for it, so Express used raw SQL; Drizzle has it in the query builder.
- **A subquery as a value:** `inArray(tasks.projectId, tx.select({ id: projects.id }).from(projects).where(…))` becomes `project_id IN (SELECT id FROM projects WHERE …)`: one statement unassigns the leaving member from every task of the workspace.
- `findTarget` returns the membership **with its user** (`with: { user: { columns: … } }`), so `updateRole` can re-read it after the update and return a complete `Member`.

> **🧠 DSA & scalability · "a workspace always has an owner"**
> - **The race:** two owners demote each other at once. Each transaction counts 2 owners, each passes, both commit: zero owners.
> - **Algorithm:** `SELECT … WHERE role = 'owner' FOR UPDATE` locks every owner row before counting. The second transaction blocks until the first commits, re-reads, sees one owner, and fails with 409.
> - **Complexity:** O(k) for k owners; only this workspace's owner rows are locked.
> - **Rejected:** `SERIALIZABLE` isolation (correct, but the whole transaction becomes retryable for one invariant); a `CHECK` constraint (can't see other rows); a trigger (hidden from the code you're learning).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: member role changes and removal with last-owner lock`

### Step 5.6 · Invitations

**Goal:** invite by email with a single-use token (stored hashed), queue the email, and let the invitee accept.

**Files:** `src/modules/workspaces/invitations.service.ts`

**`src/modules/workspaces/invitations.service.ts`** · new file

```ts
import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, lt, lte } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { invitations, users, workspaceMembers } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from './access.js';
import type { Role } from './roles.js';
import { toInvitation, toWorkspace } from './workspaces.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');
const withInviter = { inviter: { columns: userSummaryColumns } } as const;

export class InvitationsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly jobs: Jobs,
  ) {}
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.invitations.findMany({
      where: and(
        eq(invitations.workspaceId, workspaceId),
        isNull(invitations.acceptedAt),
        after ? lt(invitations.id, after) : undefined,
      ),
      orderBy: desc(invitations.id),
      limit: limit + 1,
      with: withInviter,
    });
    return toPage(rows, limit, toInvitation, (i) => ({ id: i.id }));
  }

  async create(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: Exclude<Role, 'owner'> },
  ) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    if (input.role === 'admin' && actor.role !== 'owner') {
      throw forbidden('Only owners can invite admins');
    }
    const [alreadyMember] = await this.db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.email, input.email)))
      .limit(1);
    if (alreadyMember) throw conflict('This person is already a member');
```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts

    const token = randomBytes(32).toString('base64url');
    let invitation;
    try {
      invitation = await this.db.transaction(async (tx) => {
        await tx
          .delete(invitations)
          .where(
            and(
              eq(invitations.workspaceId, workspaceId),
              eq(invitations.email, input.email),
              isNull(invitations.acceptedAt),
              lte(invitations.expiresAt, new Date()),
            ),
          );
        const [created] = await tx
          .insert(invitations)
          .values({
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          })
          .returning({ id: invitations.id });
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await this.activity.record(tx, {
          workspaceId,
          actorId,
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return tx.query.invitations.findFirst({
          where: eq(invitations.id, created.id),
          with: { ...withInviter, workspace: true },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict('This email already has a pending invitation');
      }
      throw err;
    }
    if (!invitation) throw notFound('Invitation');

    await this.jobs.enqueue('send-invitation-email', {
      email: invitation.email,
      workspaceName: invitation.workspace.name,
      inviterName: invitation.inviter.displayName,
      token,
    });
    return toInvitation(invitation);
  }

  async revoke(workspaceId: string, actorId: string, invitationId: string) {
    await this.access.member(workspaceId, actorId, 'admin');
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(invitations)
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.workspaceId, workspaceId),
            isNull(invitations.acceptedAt),
          ),
        )
        .returning({ id: invitations.id });
      if (deleted.length === 0) throw notFound('Invitation');
      await this.activity.record(tx, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.db.query.invitations.findFirst({
      where: eq(invitations.tokenHash, sha256(token)),
      with: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.db.query.users.findFirst({ where: eq(users.id, userId) });
    if (user?.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }

    const role = await this.db.transaction(async (tx) => {
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      const existing = await tx.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, invitation.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      });
      if (existing) return existing.role;
      await tx
        .insert(workspaceMembers)
        .values({ workspaceId: invitation.workspaceId, userId, role: invitation.role });
      await this.activity.record(tx, {
        workspaceId: invitation.workspaceId,
        actorId: userId,
        type: 'member.joined',
        data: { role: invitation.role },
      });
      return invitation.role;
    });
    return toWorkspace(invitation.workspace, role);
  }
}
```

**What's new (Drizzle)**
- **A join in the builder:** `.from(workspaceMembers).innerJoin(users, eq(users.id, workspaceMembers.userId)).where(…)` is exactly the SQL you'd write: "is any member of this workspace using this email?".
- **`isNull(invitations.acceptedAt)`** and **`lte(invitations.expiresAt, new Date())`**: Drizzle's operators are functions named after SQL (`eq`, `ne`, `lt`, `lte`, `gt`, `isNull`, `inArray`, …), so a condition reads like the `WHERE` clause it becomes.
- **`.returning({ id: invitations.id })`** returns only the columns you name; the invitation is then re-read inside the transaction with its inviter and workspace (`tx.query…findFirst({ with })`) for the email job and the response.
- `delete(...).returning(...)` tells `revoke` whether a row was deleted (an empty array means 404).
- The partial unique index `invitations_pending_email_uq` turns a second pending invitation for the same email into a unique violation → 409.

> **🧠 DSA & scalability · invitation tokens**
> - **Data structure:** a 256-bit random token (base64url) sent by email; only its SHA-256 is stored, behind a unique B-tree index.
> - **Algorithm:** accept = hash the presented token → one indexed lookup → check not accepted, not expired, email matches → insert the membership and mark the invitation accepted, in one transaction.
> - **Complexity:** O(log n) lookup.
> - **Why it's safe:** a database leak exposes hashes, not usable tokens; the email check stops a forwarded link from adding the wrong person.
> - **Rejected:** storing the raw token; signed JWT invitation links (can't be revoked).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: email invitations with hashed tokens`

### Step 5.7 · Routes and wiring

**Goal:** the workspace, member and invitation endpoints, and their place in the container and the app.

**Files:** `src/modules/workspaces/workspaces.routes.ts`, `src/container.ts`, `src/app.ts`

**`src/modules/workspaces/workspaces.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Email, Id, Page, PageQuery, Patch, Trimmed } from '../../lib/schemas.js';
import type { InvitationsService } from './invitations.service.js';
import type { MembersService } from './members.service.js';
import { InvitableRoleSchema, RoleSchema } from './roles.js';
import { Invitation, Member, Workspace } from './workspaces.dto.js';
import type { WorkspacesService } from './workspaces.service.js';

const Slug = Type.String({ minLength: 3, maxLength: 40, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' });

const CreateWorkspaceBody = Type.Object({ name: Trimmed(1, 80), slug: Slug });
const UpdateWorkspaceBody = Patch({ name: Trimmed(1, 80), slug: Slug });

const WorkspaceParams = Type.Object({ workspaceId: Id });
const MemberParams = Type.Object({ workspaceId: Id, userId: Id });
const InvitationParams = Type.Object({ workspaceId: Id, invitationId: Id });

const UpdateMemberBody = Type.Object({ role: RoleSchema });
const CreateInvitationBody = Type.Object({ email: Email, role: InvitableRoleSchema });
const AcceptInvitationBody = Type.Object({ token: Type.String({ minLength: 1, maxLength: 128 }) });

export interface WorkspacesRoutesOptions {
  workspaces: WorkspacesService;
  members: MembersService;
  invitations: InvitationsService;
}

```

**What's new**
- `Patch({ … })` gives the PATCH body "all optional, at least one" in one call.
- **Params schemas** (`WorkspaceParams`) validate path segments: a non-UUID `workspaceId` is a 422 on `path.workspaceId` before the handler runs.

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts
export const workspacesRoutes: FastifyPluginAsyncTypebox<WorkspacesRoutesOptions> = async (
  app,
  { workspaces, members, invitations },
) => {
  app.get(
    '/workspaces',
    { schema: { querystring: PageQuery, response: { 200: Page(Workspace) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return workspaces.list(userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces',
    { schema: { body: CreateWorkspaceBody, response: { 201: Workspace } } },
    async (request, reply) => {
      reply.status(201);
      return workspaces.create(userIdOf(request), request.body);
    },
  );

  app.get(
    '/workspaces/:workspaceId',
    { schema: { params: WorkspaceParams, response: { 200: Workspace } } },
    async (request) => workspaces.get(request.params.workspaceId, userIdOf(request)),
  );

  app.patch(
    '/workspaces/:workspaceId',
    {
      schema: { params: WorkspaceParams, body: UpdateWorkspaceBody, response: { 200: Workspace } },
    },
    async (request) =>
      workspaces.update(request.params.workspaceId, userIdOf(request), request.body),
  );
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts

  app.delete(
    '/workspaces/:workspaceId',
    { schema: { params: WorkspaceParams } },
    async (request, reply) => {
      await workspaces.delete(request.params.workspaceId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.get(
    '/workspaces/:workspaceId/members',
    {
      schema: { params: WorkspaceParams, querystring: PageQuery, response: { 200: Page(Member) } },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return members.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.patch(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: MemberParams, body: UpdateMemberBody, response: { 200: Member } } },
    async (request) => {
      const { workspaceId, userId } = request.params;
      return members.updateRole(workspaceId, userIdOf(request), userId, request.body.role);
    },
  );

  app.delete(
    '/workspaces/:workspaceId/members/:userId',
    { schema: { params: MemberParams } },
    async (request, reply) => {
      const { workspaceId, userId } = request.params;
      await members.remove(workspaceId, userIdOf(request), userId);
      return reply.status(204).send();
    },
  );
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts

  app.get(
    '/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: WorkspaceParams,
        querystring: PageQuery,
        response: { 200: Page(Invitation) },
      },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return invitations.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces/:workspaceId/invitations',
    {
      schema: {
        params: WorkspaceParams,
        body: CreateInvitationBody,
        response: { 201: Invitation },
      },
    },
    async (request, reply) => {
      reply.status(201);
      return invitations.create(request.params.workspaceId, userIdOf(request), request.body);
    },
  );
```

**`src/modules/workspaces/workspaces.routes.ts`** · continue

```ts

  app.delete(
    '/workspaces/:workspaceId/invitations/:invitationId',
    { schema: { params: InvitationParams } },
    async (request, reply) => {
      const { workspaceId, invitationId } = request.params;
      await invitations.revoke(workspaceId, userIdOf(request), invitationId);
      return reply.status(204).send();
    },
  );

  app.post(
    '/invitations/accept',
    { schema: { body: AcceptInvitationBody, response: { 200: Workspace } } },
    async (request) => invitations.accept(userIdOf(request), request.body.token),
  );
};
```

**What's new**
- **`request.params.workspaceId`, `request.query.limit`, `request.body.role`** are all typed from the route's schemas (the TypeBox type provider at work), and already validated. `limit` is a number (coerced, default 20).
- **A plugin's options can be the whole `services` object.** `WorkspacesRoutesOptions` names just the three services this module uses, and TypeScript accepts any object that has them, so the app passes `services` as is (below).
- `reply.status(204).send()` sends an empty body; `return` it so Fastify knows the reply is done.

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

**`src/container.ts`** · add after `const users = new UsersRepository(db);`

```ts
  const activity = new ActivityRepository();
  const access = new Access(db);
  const jobs = new Jobs(infra.queue);
```

**`src/container.ts`** · add after `users,`

```ts
    access,
```

**`src/container.ts`** · add after `auth: new AuthService(users, new RefreshTokens(redis, config.REFRESH_TOKEN_TTL_SECONDS)),`

```ts
    workspaces: new WorkspacesService(db, access, activity, jobs),
    members: new MembersService(db, access, activity),
    invitations: new InvitationsService(db, access, activity, jobs),
```

**`src/app.ts`** · add after `import { usersRoutes } from './modules/users/users.routes.js';`

```ts
import { workspacesRoutes } from './modules/workspaces/workspaces.routes.js';
```

**`src/app.ts`** · add after `await secured.register(usersRoutes, { users: services.users });`

```ts
          await secured.register(workspacesRoutes, services);
```

**What's new**
- The container gains the queue (shared Redis connection), the access checker, the activity repository and the three services; `closeInfra` closes the queue first.
- `secured.register(workspacesRoutes, services)`: one line per module from now on.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** pagination, 404/403 rules, slugs, member management, the last-owner rule and the invitation flow, end to end.

**Files:** `tests/helpers.ts`, `tests/integration/workspaces.test.ts`

**`tests/helpers.ts`** · add after `import { closeInfra, createInfra, createServices, type Infra } from '../src/container.js';`

```ts
import { workspaceMembers } from '../src/db/schema.js';
```

**`tests/helpers.ts`** · continue

```ts

export interface WorkspaceFixture {
  owner: TestUser;
  workspaceId: string;
}

/** A fresh owner with their own workspace. */
export async function createWorkspace(ctx: TestContext): Promise<WorkspaceFixture> {
  const owner = await registerUser(ctx, 'Owner');
  const ws = await send(
    ctx,
    'POST',
    '/api/v1/workspaces',
    { as: owner, body: { name: 'Acme', slug: `acme-${counter}` } },
    201,
  );
  return { owner, workspaceId: ws.json<{ id: string }>().id };
}

/** Adds an existing user to a workspace with a role, bypassing invitations. */
export async function addMember(
  ctx: TestContext,
  workspaceId: string,
  user: TestUser,
  role: 'owner' | 'admin' | 'member' | 'viewer',
): Promise<void> {
  await ctx.infra.db.insert(workspaceMembers).values({ workspaceId, userId: user.id, role });
}
```

**What's new**
- `addMember` inserts a membership directly with Drizzle, skipping the invitation flow, to set up role scenarios quickly.

**`tests/integration/workspaces.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createTestContext,
  createWorkspace,
  registerUser,
  resetState,
  send,
  type TestUser,
} from '../helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('workspaces', () => {
  it('lists my workspaces newest first with cursor pagination', async () => {
    const user = await registerUser(ctx, 'Ada');
    for (const slug of ['one', 'two', 'three']) {
      await send(ctx, 'POST', '/api/v1/workspaces', { as: user, body: { name: slug, slug } }, 201);
    }
    const page1 = await send(ctx, 'GET', '/api/v1/workspaces?limit=2', { as: user }, 200);
    const body1 = page1.json<{
      items: { slug: string; currentUserRole: string }[];
      nextCursor: string;
    }>();
    expect(body1.items.map((w) => w.slug)).toEqual(['three', 'two']);
    expect(body1.items[0]?.currentUserRole).toBe('owner');
    const page2 = await send(
      ctx,
      'GET',
      `/api/v1/workspaces?limit=2&cursor=${body1.nextCursor}`,
      { as: user },
      200,
    );
    expect(page2.json()).toMatchObject({ items: [{ slug: 'one' }], nextCursor: null });
  });
```

**`tests/integration/workspaces.test.ts`** · continue

```ts

  it('hides workspaces from non-members (404) and enforces roles (403)', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}`;
    const stranger = await registerUser(ctx, 'Stranger');
    await send(ctx, 'GET', url, { as: stranger }, 404);

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, member, 'member');
    await send(ctx, 'GET', url, { as: member }, 200);
    await send(ctx, 'PATCH', url, { as: member, body: { name: 'Hijacked' } }, 403);
    await send(ctx, 'DELETE', url, { as: member }, 403);
  });

  it('rejects a taken slug with 409 and an invalid path id with 422', async () => {
    const user = await registerUser(ctx, 'Ada');
    const create = (name: string, status: number) =>
      send(ctx, 'POST', '/api/v1/workspaces', { as: user, body: { name, slug: 'same' } }, status);
    await create('A', 201);
    await create('B', 409);
    const res = await send(ctx, 'GET', '/api/v1/workspaces/not-a-uuid', { as: user }, 422);
    expect(res.json()).toMatchObject({ errors: [{ field: 'path.workspaceId' }] });
  });

  it('lets the owner rename and delete the workspace', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}`;
    const renamed = await send(ctx, 'PATCH', url, { as: owner, body: { name: 'Acme Inc.' } }, 200);
    expect(renamed.json()).toMatchObject({ name: 'Acme Inc.', currentUserRole: 'owner' });
    await send(ctx, 'DELETE', url, { as: owner }, 204);
    await send(ctx, 'GET', url, { as: owner }, 404);
  });
});
```

**`tests/integration/workspaces.test.ts`** · continue

```ts

describe('members', () => {
  it('lets admins manage members and viewers but not other admins', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const otherAdmin = await registerUser(ctx, 'Admin2');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, otherAdmin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');

    const url = (u: TestUser) => `/api/v1/workspaces/${workspaceId}/members/${u.id}`;
    const res = await send(ctx, 'PATCH', url(member), { as: admin, body: { role: 'viewer' } }, 200);
    expect(res.json()).toMatchObject({ user: { id: member.id }, role: 'viewer' });
    await send(ctx, 'PATCH', url(member), { as: admin, body: { role: 'admin' } }, 403);
    await send(ctx, 'PATCH', url(otherAdmin), { as: admin, body: { role: 'member' } }, 403);
    await send(ctx, 'DELETE', url(otherAdmin), { as: admin }, 403);
    await send(ctx, 'DELETE', url(member), { as: admin }, 204);
  });

  it('never leaves a workspace without an owner', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const url = `/api/v1/workspaces/${workspaceId}/members/${owner.id}`;
    await send(ctx, 'PATCH', url, { as: owner, body: { role: 'admin' } }, 409);
    await send(ctx, 'DELETE', url, { as: owner }, 409);

    const second = await registerUser(ctx, 'Second');
    await addMember(ctx, workspaceId, second, 'owner');
    await send(ctx, 'DELETE', url, { as: owner }, 204);
  });
```

**`tests/integration/workspaces.test.ts`** · continue

```ts

  it('lists members in join order', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const late = await registerUser(ctx, 'Late');
    await addMember(ctx, workspaceId, late, 'viewer');
    const res = await send(
      ctx,
      'GET',
      `/api/v1/workspaces/${workspaceId}/members`,
      { as: late },
      200,
    );
    const ids = res.json<{ items: { user: { id: string } }[] }>().items.map((m) => m.user.id);
    expect(ids).toEqual([owner.id, late.id]);
  });
});

describe('invitations', () => {
  it('invites by email, queues the email, and lets the invitee join', async () => {
    const { owner, workspaceId } = await createWorkspace(ctx);
    const invitations = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invitee = await registerUser(ctx, 'Invitee');
    const created = await send(
      ctx,
      'POST',
      invitations,
      { as: owner, body: { email: invitee.email.toUpperCase(), role: 'member' } },
      201,
    );
    expect(created.json()).toMatchObject({
      email: invitee.email,
      role: 'member',
      invitedBy: { id: owner.id },
    });

    const jobs = await ctx.infra.queue.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'send-invitation-email');
    const token = (job?.data as { token: string }).token;
    expect(token).toBeTruthy();
```

**`tests/integration/workspaces.test.ts`** · continue

```ts

    await send(
      ctx,
      'POST',
      invitations,
      { as: owner, body: { email: invitee.email, role: 'viewer' } },
      409,
    );

    const accept = (who: TestUser, status: number) =>
      send(ctx, 'POST', '/api/v1/invitations/accept', { as: who, body: { token } }, status);
    await accept(await registerUser(ctx, 'Stranger'), 403);
    const joined = await accept(invitee, 200);
    expect(joined.json()).toMatchObject({ id: workspaceId, currentUserRole: 'member' });
    await accept(invitee, 404);

    const pending = await send(ctx, 'GET', invitations, { as: owner }, 200);
    expect(pending.json()).toMatchObject({ items: [], nextCursor: null });
  });

  it('only owners invite admins; members cannot invite at all', async () => {
    const { workspaceId } = await createWorkspace(ctx);
    const admin = await registerUser(ctx, 'Admin');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, workspaceId, admin, 'admin');
    await addMember(ctx, workspaceId, member, 'member');
    const url = `/api/v1/workspaces/${workspaceId}/invitations`;
    const invite = (who: TestUser, role: string) =>
      send(ctx, 'POST', url, { as: who, body: { email: 'x@example.com', role } });
    expect((await invite(admin, 'admin')).statusCode).toBe(403);
    expect((await invite(member, 'viewer')).statusCode).toBe(403);
    const ok = await invite(admin, 'viewer');
    expect(ok.statusCode).toBe(201);
    await send(ctx, 'DELETE', `${url}/${ok.json<{ id: string }>().id}`, { as: admin }, 204);
  });
});
```

**What's new**
- The invitation test reads the queued job from BullMQ (`ctx.infra.queue.getJobs(['waiting'])`) to get the token the email would contain; Part 11 tests the email itself.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  6 passed (6)
      Tests  31 passed (31)
```

**Commit:** `test: workspace, member and invitation tests`

---
## Part 6 · Projects, columns & ordering

Projects come with three default columns, columns can be reordered, and the whole board is served from a Redis cache. The ordering algorithm (fractional indexing) is the same code as in Express, because it's pure TypeScript; what's new is expressing the board queries in Drizzle and a few TypeBox schema patterns.

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
```

**`src/lib/fractional-index.ts`** · continue

```ts

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
```

**`src/lib/fractional-index.ts`** · continue

```ts

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

**What's new**
- Identical to Express, line for line: it's a pure function over strings. The test vectors below are shared by all six backends (the TaskFlow README lists them), so a Python or Java port must produce the same keys.
- Reading it once more: a key is an **integer part** (a head character that encodes its length, then digits) plus an optional **fraction**. `keyBetween(a, null)` appends by incrementing the integer part; `keyBetween(a, b)` with a shared integer part bisects the fractions with `midpoint`.

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

> **🧠 DSA & scalability · fractional indexing**
> - **Data structure:** a variable-length base-62 string per item, in `position text COLLATE "C"` with `UNIQUE (column_id, position)`.
> - **Algorithm (`midpoint`):** skip the shared prefix of `a` and `b`; if the next digits differ by more than one, return the digit halfway between; otherwise keep `a`'s digit and recurse with an open upper bound. Binary search, on strings.
> - **Complexity:** O(k) for keys of length k. Inserting into the same gap again and again grows a key by about one character per ~6 inserts (log₂ 62 ≈ 5.95); normal boards stay at 2–4 characters.
> - **Why it scales:** a drag-and-drop is **one** `UPDATE` of one row, whatever the column's size, and two users moving different cards never touch the same rows.
> - **Rejected:** integer positions (a move renumbers O(n) rows); floats (`(a+b)/2` runs out of precision after ~50 bisections); a linked list (`prevId`) (reading the order walks the list, and concurrent moves can corrupt it).

**✅ Checkpoint**

```bash
npm test -- tests/unit/fractional-index.test.ts
```

Expected: `Tests  10 passed (10)`.

**Commit:** `feat: fractional indexing`

### Step 6.2 · DTOs, the board cache and the real-time publisher

**Goal:** the response schemas for projects, columns, tasks and the board; a cache-aside wrapper for the board; and a publisher that announces board changes over Redis Pub/Sub (Part 10 delivers them).

**Files:** `src/modules/projects/projects.dto.ts`, `src/modules/projects/board-cache.ts`, `src/modules/realtime/publisher.ts`

**`src/modules/projects/projects.dto.ts`** · new file

```ts
import { Type, type Static } from 'typebox';
import { Id, Nullable, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';

export const Project = Type.Object({
  id: Id,
  workspaceId: Id,
  name: Type.String(),
  key: Type.String(),
  description: Nullable(Type.String()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Column = Type.Object({
  id: Id,
  projectId: Id,
  name: Type.String(),
  position: Type.String(),
  wipLimit: Nullable(Type.Integer()),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Priority = Type.Enum(['low', 'medium', 'high', 'urgent']);
```

**`src/modules/projects/projects.dto.ts`** · continue

```ts

export const Task = Type.Object({
  id: Id,
  key: Type.String(),
  number: Type.Integer(),
  projectId: Id,
  columnId: Id,
  title: Type.String(),
  description: Nullable(Type.String()),
  priority: Priority,
  assignee: Nullable(UserSummary),
  reporter: UserSummary,
  dueAt: Nullable(Timestamp),
  position: Type.String(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

export const Board = Type.Object({
  project: Project,
  columns: Type.Array(Type.Object({ ...Column.properties, tasks: Type.Array(Task) })),
});
```

**What's new**
- `Task` nests `UserSummary` twice and `Nullable(...)` where the contract says `oneOf [X, null]`; the board schema builds a column-with-tasks type by spreading `Column.properties` and adding `tasks: Type.Array(Task)`.
- **One schema, three uses:** the board's response schema validates nothing at run time but drives the serializer (only listed properties are written, in a fixed order), the TypeScript type of `board()`, and documentation of intent.

**`src/modules/projects/projects.dto.ts`** · continue

```ts

export type ProjectDto = Static<typeof Project>;
export type ColumnDto = Static<typeof Column>;
export type TaskDto = Static<typeof Task>;
export type BoardDto = Static<typeof Board>;

export const toProject = (
  p: Omit<ProjectDto, 'createdAt' | 'updatedAt'> & {
    createdAt: Date;
    updatedAt: Date;
  },
): ProjectDto => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toColumn = (
  c: Omit<ColumnDto, 'createdAt' | 'updatedAt'> & {
    createdAt: Date;
    updatedAt: Date;
  },
): ColumnDto => ({
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

/** Drizzle `with` that loads everything `toTask` needs in one query. */
export const taskWith = {
  project: { columns: { key: true } },
  assignee: { columns: userSummaryColumns },
  reporter: { columns: userSummaryColumns },
} as const;

export interface TaskRow {
  id: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: TaskDto['priority'];
  dueAt: Date | null;
  position: string;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string };
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
}
```

**`src/modules/projects/projects.dto.ts`** · continue

```ts

export const toTask = (t: TaskRow): TaskDto => ({
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
```

**What's new**
- `Omit<ProjectDto, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }`: the row type is "the DTO, but with `Date`s", written with TypeScript's utility types instead of a second hand-written interface.
- **`taskWith`** is the Drizzle `with` object that loads everything `toTask` needs (the project key, assignee and reporter summaries) in one query, like Express's `taskInclude`. `as const` keeps its literal types, so Drizzle can infer the loaded shape from it.

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
- Both are Express's files unchanged: Redis is used directly through ioredis. The publisher only `PUBLISH`es; every API instance's WebSocket route (Part 10) relays messages to its own sockets.

> **🧠 DSA & scalability · cache-aside for the board**
> - **Data structure:** a Redis string `cache:board:{projectId}` holding the board JSON, 300 s TTL.
> - **Algorithm:** read → `GET`; on a miss, query Postgres, `SET … EX 300`, return. Write → after the transaction commits, `DEL` the key; the next read rebuilds it.
> - **Complexity:** a hit is one O(1) Redis round trip instead of two queries and an O(n) grouping.
> - **Why delete, not update:** rebuilding on every write duplicates the read logic and races other writers; `DEL` is idempotent. The TTL catches writes that don't invalidate (a user renaming themselves appears in every task's `assignee`).
> - **Rejected:** write-through caching (more code, same result); caching single tasks (the board query is the expensive one).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: board cache, dtos and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** retry a transaction when a concurrent move took the same position key.

**Files:** `src/lib/pg-errors.ts`

**`src/lib/pg-errors.ts`** · continue

```ts

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
- `return await attempt()` inside `try`: the `await` matters. Without it the rejected promise would escape the `try`, and the retry would never happen.
- Only a **unique violation** is retried, and at most three times: the `UNIQUE (parent, position)` index is what detects that two users computed the same key; any other error propagates at once.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: retry on position conflicts`

### Step 6.4 · Projects service and the board

**Goal:** projects with three default columns, cache invalidation on every write, and the board as one cached read.

**Files:** `src/modules/projects/projects.service.ts`

**`src/modules/projects/projects.service.ts`** · new file

```ts
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { boardColumns, projects, tasks } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isUniqueViolation } from '../../lib/pg-errors.js';
import { conflict, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { taskWith, toColumn, toProject, toTask, type BoardDto } from './projects.dto.js';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

export class ProjectsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.projects.findMany({
      where: and(eq(projects.workspaceId, workspaceId), after ? lt(projects.id, after) : undefined),
      orderBy: desc(projects.id),
      limit: limit + 1,
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
      const project = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(projects)
          .values({
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            createdBy: userId,
          })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        let position: string | null = null;
        for (const name of DEFAULT_COLUMNS) {
          position = keyBetween(position, null);
          await tx.insert(boardColumns).values({ projectId: created.id, name, position });
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
    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(projects)
        .set(input)
        .where(eq(projects.id, projectId))
        .returning();
      if (!row) throw notFound('Project');
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
    await this.db.transaction(async (tx) => {
      await tx.delete(projects).where(eq(projects.id, projectId));
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

  async board(projectId: string, userId: string): Promise<BoardDto> {
    const { project } = await this.access.project(projectId, userId);
    return this.cache.getOrLoad(projectId, async () => {
      const [columns, taskRows] = await Promise.all([
        this.db.query.boardColumns.findMany({
          where: eq(boardColumns.projectId, projectId),
          orderBy: asc(boardColumns.position),
        }),
        this.db.query.tasks.findMany({
          where: eq(tasks.projectId, projectId),
          orderBy: asc(tasks.position),
          with: taskWith,
        }),
      ]);
      const byColumn = Map.groupBy(taskRows.map(toTask), (t) => t.columnId);
      return {
        project: toProject(project),
        columns: columns.map((c) => ({ ...toColumn(c), tasks: byColumn.get(c.id) ?? [] })),
      };
    });
  }
}
```

**What's new (Drizzle)**
- **`orderBy: asc(boardColumns.position)`**: the `COLLATE "C"` column makes this byte order, which is what fractional keys need.
- **`Promise.all([...])`** runs the columns query and the tasks query concurrently on two pool connections.
- `Map.groupBy` (ES2024) groups the tasks by `columnId` in one pass.
- `project.create` inserts the project and its three columns in one transaction; each column's position is `keyBetween(previous, null)`: `a0`, `a1`, `a2`.

> **🧠 DSA & scalability · building the board**
> - **Data:** 2 queries (columns, tasks), each ordered by `position`, using the `(project_id, position)` and `(column_id, position)` indexes.
> - **Algorithm:** fetch both lists, group tasks by column in a hash map, attach each group to its column.
> - **Complexity:** O(c + t) after the queries, instead of O(c × t) for filtering the task list per column.
> - **Avoiding N+1:** a query per column would be 1 + c round trips; two queries are constant whatever the board's size.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: projects service and cached board`

### Step 6.5 · Columns service

**Goal:** add, rename, reorder and delete columns, with the cache invalidated and an event published after every change.

**Files:** `src/modules/projects/columns.service.ts`

**`src/modules/projects/columns.service.ts`** · new file

```ts
import { and, asc, desc, eq, gt, ne } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { boardColumns } from '../../db/schema.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { isForeignKeyViolation, retryOnPositionConflict } from '../../lib/pg-errors.js';
import { conflict, invalid, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';
import type { BoardCache } from './board-cache.js';
import { toColumn } from './projects.dto.js';

export class ColumnsService {
  constructor(
    private readonly db: Database,
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
      this.db.transaction(async (tx) => {
        const last = await tx.query.boardColumns.findFirst({
          where: eq(boardColumns.projectId, projectId),
          orderBy: desc(boardColumns.position),
        });
        const [created] = await tx
          .insert(boardColumns)
          .values({
            projectId,
            name: input.name,
            wipLimit: input.wipLimit ?? null,
            position: keyBetween(last?.position ?? null, null),
          })
          .returning();
        if (!created) throw new Error('INSERT … RETURNING returned no row');
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
    const column = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(boardColumns)
        .set(input)
        .where(eq(boardColumns.id, columnId))
        .returning();
      if (!row) throw notFound('Column');
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
```

**`src/modules/projects/columns.service.ts`** · continue

```ts

  async move(columnId: string, userId: string, afterColumnId: string | null) {
    const { column, project } = await this.access.column(columnId, userId, 'admin');
    if (afterColumnId === columnId)
      throw invalid('afterColumnId', 'cannot place a column after itself');
    const moved = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        const position = await this.positionAfter(tx, column.projectId, columnId, afterColumnId);
        const [row] = await tx
          .update(boardColumns)
          .set({ position })
          .where(eq(boardColumns.id, columnId))
          .returning();
        if (!row) throw notFound('Column');
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
      await this.db.transaction(async (tx) => {
        await tx.delete(boardColumns).where(eq(boardColumns.id, columnId));
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
      const after = await tx.query.boardColumns.findFirst({ where: eq(boardColumns.id, afterId) });
      if (after?.projectId !== projectId) {
        throw invalid('afterColumnId', 'must be a column of the same project');
      }
      lower = after.position;
    }
    const next = await tx.query.boardColumns.findFirst({
      where: and(
        eq(boardColumns.projectId, projectId),
        ne(boardColumns.id, columnId),
        lower !== null ? gt(boardColumns.position, lower) : undefined,
      ),
      orderBy: asc(boardColumns.position),
    });
    return keyBetween(lower, next?.position ?? null);
  }

  private async afterWrite<T>(projectId: string, type: ServerEventType, payload: T) {
    await this.cache.invalidate(projectId);
    await this.realtime.publish(projectId, type, payload);
    return payload;
  }
}
```

**What's new (Drizzle)**
- **`ne(boardColumns.id, columnId)`** is `<>`: when moving a column we look for the next neighbour *excluding the column itself*.
- `positionAfter` computes the new key from the column we're moving after (`lower`) and the first column above it (`next`), then `keyBetween(lower, next)`.
- **Deleting a column that still holds tasks** fails in Postgres with a foreign-key violation (`NO ACTION`, Step 2.3); `isForeignKeyViolation` turns SQLSTATE `23503` into a 409 with an explanation.
- `afterWrite` runs **after** the transaction commits: invalidate the cache, then publish. Publishing inside the transaction could announce a change that then rolls back.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: columns service`

### Step 6.6 · Routes, wiring and tests

**Goal:** the project and column endpoints, wired in, with tests for default columns, roles, cascades and reordering.

**Files:** `src/modules/projects/projects.routes.ts`, `src/container.ts`, `src/app.ts`, `tests/helpers.ts`, `tests/integration/projects.test.ts`

**`src/modules/projects/projects.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Nullable, Page, PageQuery, Patch, Trimmed } from '../../lib/schemas.js';
import type { ColumnsService } from './columns.service.js';
import { Board, Column, Project } from './projects.dto.js';
import type { ProjectsService } from './projects.service.js';

const Description = Nullable(Type.String({ maxLength: 2000 }));
const WipLimit = Nullable(Type.Integer({ minimum: 1, maximum: 999 }));

const CreateProjectBody = Type.Object({
  name: Trimmed(1, 80),
  key: Type.String({ pattern: '^[A-Z][A-Z0-9]{1,9}$' }),
  description: Type.Optional(Description),
});
const UpdateProjectBody = Patch({ name: Trimmed(1, 80), description: Description });

const CreateColumnBody = Type.Object({ name: Trimmed(1, 50), wipLimit: Type.Optional(WipLimit) });
const UpdateColumnBody = Patch({ name: Trimmed(1, 50), wipLimit: WipLimit });
const MoveColumnBody = Type.Object({ afterColumnId: Nullable(Id) });

const WorkspaceParams = Type.Object({ workspaceId: Id });
const ProjectParams = Type.Object({ projectId: Id });
const ColumnParams = Type.Object({ columnId: Id });

export interface ProjectsRoutesOptions {
  projects: ProjectsService;
  columns: ColumnsService;
}
```

**`src/modules/projects/projects.routes.ts`** · continue

```ts

export const projectsRoutes: FastifyPluginAsyncTypebox<ProjectsRoutesOptions> = async (
  app,
  { projects, columns },
) => {
  app.get(
    '/workspaces/:workspaceId/projects',
    {
      schema: { params: WorkspaceParams, querystring: PageQuery, response: { 200: Page(Project) } },
    },
    async (request) => {
      const { limit, cursor } = request.query;
      return projects.list(request.params.workspaceId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/workspaces/:workspaceId/projects',
    { schema: { params: WorkspaceParams, body: CreateProjectBody, response: { 201: Project } } },
    async (request, reply) => {
      reply.status(201);
      return projects.create(request.params.workspaceId, userIdOf(request), request.body);
    },
  );

  app.get(
    '/projects/:projectId',
    { schema: { params: ProjectParams, response: { 200: Project } } },
    async (request) => projects.get(request.params.projectId, userIdOf(request)),
  );

  app.patch(
    '/projects/:projectId',
    { schema: { params: ProjectParams, body: UpdateProjectBody, response: { 200: Project } } },
    async (request) => projects.update(request.params.projectId, userIdOf(request), request.body),
  );
```

**`src/modules/projects/projects.routes.ts`** · continue

```ts

  app.delete(
    '/projects/:projectId',
    { schema: { params: ProjectParams } },
    async (request, reply) => {
      await projects.delete(request.params.projectId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.get(
    '/projects/:projectId/board',
    { schema: { params: ProjectParams, response: { 200: Board } } },
    async (request) => projects.board(request.params.projectId, userIdOf(request)),
  );

  app.post(
    '/projects/:projectId/columns',
    { schema: { params: ProjectParams, body: CreateColumnBody, response: { 201: Column } } },
    async (request, reply) => {
      reply.status(201);
      return columns.create(request.params.projectId, userIdOf(request), request.body);
    },
  );

  app.patch(
    '/columns/:columnId',
    { schema: { params: ColumnParams, body: UpdateColumnBody, response: { 200: Column } } },
    async (request) => columns.update(request.params.columnId, userIdOf(request), request.body),
  );

  app.delete('/columns/:columnId', { schema: { params: ColumnParams } }, async (request, reply) => {
    await columns.delete(request.params.columnId, userIdOf(request));
    return reply.status(204).send();
  });
```

**`src/modules/projects/projects.routes.ts`** · continue

```ts

  app.post(
    '/columns/:columnId/move',
    { schema: { params: ColumnParams, body: MoveColumnBody, response: { 200: Column } } },
    async (request) =>
      columns.move(request.params.columnId, userIdOf(request), request.body.afterColumnId),
  );
};
```

**What's new**
- `Type.Optional(Description)` on create versus a plain property inside `Patch(...)`: in a PATCH, `null` clears the description and omitting it leaves it alone ("merge semantics"); both rules come from the contract.
- `MoveColumnBody` requires `afterColumnId`, which may be `null` (move to the front).

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

**`src/container.ts`** · add after `invitations: new InvitationsService(db, access, activity, jobs),`

```ts
    projects: new ProjectsService(db, access, activity, boardCache, jobs),
    columns: new ColumnsService(db, access, activity, boardCache, realtime),
```

**`src/app.ts`** · add after `import { healthRoutes } from './modules/health/health.routes.js';`

```ts
import { projectsRoutes } from './modules/projects/projects.routes.js';
```

**`src/app.ts`** · add after `await secured.register(workspacesRoutes, services);`

```ts
          await secured.register(projectsRoutes, services);
```

**`tests/helpers.ts`** · continue

```ts

export interface Fixture extends WorkspaceFixture {
  projectId: string;
  columnIds: string[];
}

/** A workspace plus a project, which comes with 3 default columns. */
export async function createFixture(ctx: TestContext): Promise<Fixture> {
  const { owner, workspaceId } = await createWorkspace(ctx);
  const project = await send(
    ctx,
    'POST',
    `/api/v1/workspaces/${workspaceId}/projects`,
    { as: owner, body: { name: 'TaskFlow', key: 'TF' } },
    201,
  );
  const projectId = project.json<{ id: string }>().id;
  const board = await send(ctx, 'GET', `/api/v1/projects/${projectId}/board`, { as: owner }, 200);
  const columnIds = board.json<{ columns: { id: string }[] }>().columns.map((c) => c.id);
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
  send,
  type Fixture,
} from '../helpers.js';

const ctx = await createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function columnNames() {
  const res = await send(ctx, 'GET', `/api/v1/projects/${f.projectId}/board`, { as: f.owner }, 200);
  return res.json<{ columns: { name: string }[] }>().columns.map((c) => c.name);
}

describe('projects', () => {
  it('creates three default columns and rejects a duplicate key', async () => {
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
    await send(
      ctx,
      'POST',
      `/api/v1/workspaces/${f.workspaceId}/projects`,
      { as: f.owner, body: { name: 'Again', key: 'TF' } },
      409,
    );
  });
```

**`tests/integration/projects.test.ts`** · continue

```ts

  it('lists projects newest first and updates them', async () => {
    const projects = `/api/v1/workspaces/${f.workspaceId}/projects`;
    await send(
      ctx,
      'POST',
      projects,
      { as: f.owner, body: { name: 'Second', key: 'SEC', description: 'Another one' } },
      201,
    );
    const list = await send(ctx, 'GET', projects, { as: f.owner }, 200);
    expect(list.json<{ items: { key: string }[] }>().items.map((p) => p.key)).toEqual([
      'SEC',
      'TF',
    ]);
    const updated = await send(
      ctx,
      'PATCH',
      `/api/v1/projects/${f.projectId}`,
      { as: f.owner, body: { description: null, name: 'TaskFlow v2' } },
      200,
    );
    expect(updated.json()).toMatchObject({ name: 'TaskFlow v2', description: null, key: 'TF' });
  });

  it('keeps project and column management for admins', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const project = `/api/v1/projects/${f.projectId}`;
    await send(ctx, 'GET', project, { as: member }, 200);
    await send(ctx, 'POST', `${project}/columns`, { as: member, body: { name: 'Nope' } }, 403);
    await send(ctx, 'DELETE', project, { as: member }, 403);
  });

  it('cascades a workspace delete to its projects', async () => {
    await send(ctx, 'DELETE', `/api/v1/workspaces/${f.workspaceId}`, { as: f.owner }, 204);
    await send(ctx, 'GET', `/api/v1/projects/${f.projectId}`, { as: f.owner }, 404);
  });
});
```

**`tests/integration/projects.test.ts`** · continue

```ts

describe('columns', () => {
  it('adds, renames, reorders and deletes columns', async () => {
    const created = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/columns`,
      { as: f.owner, body: { name: 'Review', wipLimit: 3 } },
      201,
    );
    const column = `/api/v1/columns/${created.json<{ id: string }>().id}`;
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done', 'Review']);

    await send(ctx, 'PATCH', column, { as: f.owner, body: { name: 'QA' } }, 200);
    await send(ctx, 'POST', `${column}/move`, { as: f.owner, body: { afterColumnId: null } }, 200);
    expect(await columnNames()).toEqual(['QA', 'To Do', 'In Progress', 'Done']);

    const afterColumnId = f.columnIds[1];
    await send(ctx, 'POST', `${column}/move`, { as: f.owner, body: { afterColumnId } }, 200);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'QA', 'Done']);

    await send(ctx, 'DELETE', column, { as: f.owner }, 204);
    expect(await columnNames()).toEqual(['To Do', 'In Progress', 'Done']);
  });
});
```

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  8 passed (8)
      Tests  46 passed (46)
```

**Commit:** `feat: projects, columns and fractional ordering with a cached board`

---
## Part 7 · Tasks

Tasks are the busiest resource: per-project numbers (`TF-42`) under concurrency, filters, fractional moves between columns, and PATCH with merge semantics. The rules are Express's; the new parts are Drizzle's SQL expressions inside the builder and converting wire strings to `Date`s yourself.

### Step 7.1 · Types and the filtered list

**Goal:** the service's input types, and a task list with optional filters and cursor pagination.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · new file

```ts
import { and, asc, desc, eq, gt, isNull, lt, ne, sql } from 'drizzle-orm';
import type { Database, Db } from '../../db/client.js';
import { boardColumns, projects, tasks, workspaceMembers } from '../../db/schema.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { keyBetween } from '../../lib/fractional-index.js';
import { retryOnPositionConflict } from '../../lib/pg-errors.js';
import { invalid, notFound } from '../../lib/problem.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { BoardCache } from '../projects/board-cache.js';
import { taskWith, toTask, type TaskDto } from '../projects/projects.dto.js';
import type { RealtimePublisher, ServerEventType } from '../realtime/publisher.js';
import type { Access } from '../workspaces/access.js';

export type Priority = TaskDto['priority'];

export interface TaskFilters {
  columnId?: string | undefined;
  assigneeId?: string | undefined;
  priority?: Priority | undefined;
  dueBefore?: string | undefined;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null | undefined;
  columnId?: string | undefined;
  priority: Priority;
  assigneeId?: string | null | undefined;
  dueAt?: string | null | undefined;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

/** ISO-8601 string from the wire → Date for Postgres; null and undefined pass through. */
function toDate<T extends null | undefined>(value: string | T): Date | T {
  return typeof value === 'string' ? new Date(value) : value;
}

async function loadTask(db: Db, id: string) {
  const task = await db.query.tasks.findFirst({ where: eq(tasks.id, id), with: taskWith });
  if (!task) throw notFound('Task');
  return task;
}

```

**What's new**
- **`dueAt` arrives as a string.** zod could `.transform()` an ISO string into a `Date` during validation. JSON Schema validates but doesn't transform, so the route hands the service the ISO string and **`toDate`** converts it. Its signature, `<T extends null | undefined>(value: string | T): Date | T`, keeps `null` (clear the due date) and `undefined` (leave it alone) distinct, which PATCH needs.
- `Priority = TaskDto['priority']`: an **indexed access type** pulls the union `'low' | 'medium' | 'high' | 'urgent'` out of the DTO type instead of repeating it.
- `loadTask` re-reads a task with everything `toTask` needs; services call it after every write (inside the transaction), because Drizzle's `insert`/`update` return plain rows without relations.

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
export class TasksService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
    private readonly jobs: Jobs,
  ) {}

  async list(
    projectId: string,
    userId: string,
    filters: TaskFilters,
    limit: number,
    cursor?: string,
  ) {
    await this.access.project(projectId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const { columnId, assigneeId, priority, dueBefore } = filters;
    const rows = await this.db.query.tasks.findMany({
      where: and(
        eq(tasks.projectId, projectId),
        columnId ? eq(tasks.columnId, columnId) : undefined,
        assigneeId === 'none' ? isNull(tasks.assigneeId) : undefined,
        assigneeId && assigneeId !== 'none' ? eq(tasks.assigneeId, assigneeId) : undefined,
        priority ? eq(tasks.priority, priority) : undefined,
        dueBefore ? lt(tasks.dueAt, new Date(dueBefore)) : undefined,
        after ? lt(tasks.id, after) : undefined,
      ),
      orderBy: desc(tasks.id),
      limit: limit + 1,
      with: taskWith,
    });
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(await loadTask(this.db, taskId));
  }
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
}
```

**What's new**
- **Filters as optional conditions:** `assigneeId === 'none' ? isNull(tasks.assigneeId) : undefined` and so on, all inside one `and(...)`. Absent filters are `undefined` and drop out.
- `lt(tasks.dueAt, new Date(dueBefore))` compares a `timestamptz` with a `Date`; the driver sends it as an ISO timestamp.
- The class is closed already; the next steps add methods inside it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: tasks service with filtered list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** numbers `1, 2, 3…` per project with no gaps or duplicates under concurrency, and the new task appended at the bottom of its column.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · add after the `get` method

```ts

  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const [counter] = await tx
          .update(projects)
          .set({ nextTaskNumber: sql`${projects.nextTaskNumber} + 1` })
          .where(eq(projects.id, projectId))
          .returning({ number: sql<number>`${projects.nextTaskNumber} - 1` });
        const columnId = await this.resolveColumn(tx, projectId, input.columnId);
        const last = await tx.query.tasks.findFirst({
          where: eq(tasks.columnId, columnId),
          orderBy: desc(tasks.position),
        });
        const [created] = await tx
          .insert(tasks)
          .values({
            projectId,
            columnId,
            number: counter?.number ?? 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority,
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: toDate(input.dueAt) ?? null,
            position: keyBetween(last?.position ?? null, null),
          })
          .returning({ id: tasks.id, number: tasks.number, title: tasks.title });
        if (!created) throw new Error('INSERT … RETURNING returned no row');
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
        return loadTask(tx, created.id);
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }
```

**`src/modules/tasks/tasks.service.ts`** · add at the end of the class, before its closing `}`

```ts

  private async resolveColumn(tx: Db, projectId: string, columnId: string | undefined) {
    if (columnId === undefined) {
      const first = await tx.query.boardColumns.findFirst({
        where: eq(boardColumns.projectId, projectId),
        orderBy: asc(boardColumns.position),
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await tx.query.boardColumns.findFirst({ where: eq(boardColumns.id, columnId) });
    if (column?.projectId !== projectId)
      throw invalid('columnId', 'must be a column of this project');
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const member = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, assigneeId),
      ),
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
```

**What's new (Drizzle)**
- **A SQL expression inside the builder:** `.set({ nextTaskNumber: sql\`${projects.nextTaskNumber} + 1\` })` and `.returning({ number: sql<number>\`${projects.nextTaskNumber} - 1\` })`. Interpolating a column into `sql` writes its quoted name; `sql<number>` tells TypeScript what the expression returns. Express needed a raw `$queryRaw` for this one statement; here it stays in the builder.
- `.returning({ id, number, title })` brings back just what the activity entry needs, then `loadTask(tx, created.id)` reads the full task inside the transaction.
- `resolveColumn` defaults to the first column (lowest position) when the client sends none; `assertAssignable` returns a 422 on `assigneeId` for a non-member.

> **🧠 DSA & scalability · per-project task numbers**
> - **Data structure:** a counter column `projects.next_task_number`, with `UNIQUE (project_id, number)` as the safety net.
> - **Algorithm:** `UPDATE projects SET next_task_number = next_task_number + 1 … RETURNING next_task_number - 1`. The `UPDATE` **row-locks** the project, so concurrent creates in one project queue on that lock and each gets the next number.
> - **Order matters:** take the lock **first**, then read the column's last position. Under READ COMMITTED each later statement sees the previous creator's committed task, so ten parallel creates don't compute the same position (the bug Express hit while it was built).
> - **Complexity:** O(1) per create; contention is per project.
> - **Rejected:** `SELECT max(number) + 1` (duplicates under concurrency); a Postgres `SEQUENCE` per project (thousands of sequences); one global sequence (numbers wouldn't be per project).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: task creation with per-project numbering`

### Step 7.3 · Update, move and delete

**Goal:** PATCH with merge semantics and a change log, fractional moves between columns, and delete with storage cleanup.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · add after the `create` method

```ts

  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);
    const values = { ...input, dueAt: toDate(input.dueAt) };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = values[field];
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

    const task = await this.db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({ ...values, ...('dueAt' in changes ? { reminderSentAt: null } : {}) })
        .where(eq(tasks.id, taskId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes },
      });
      return loadTask(tx, taskId);
    });
    return this.afterWrite(project.id, 'task.updated', toTask(task));
  }

  async move(
    taskId: string,
    userId: string,
    input: { columnId: string; afterTaskId: string | null },
  ) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.afterTaskId === taskId)
      throw invalid('afterTaskId', 'cannot place a task after itself');

    const task = await retryOnPositionConflict(() =>
      this.db.transaction(async (tx) => {
        const column = await tx.query.boardColumns.findFirst({
          where: eq(boardColumns.id, input.columnId),
        });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await tx.query.tasks.findFirst({
            where: eq(tasks.id, input.afterTaskId),
          });
          if (after?.columnId !== input.columnId)
            throw invalid('afterTaskId', 'must be a task in the target column');
          lower = after.position;
        }
        const next = await tx.query.tasks.findFirst({
          where: and(
            eq(tasks.columnId, input.columnId),
            ne(tasks.id, taskId),
            lower !== null ? gt(tasks.position, lower) : undefined,
          ),
          orderBy: asc(tasks.position),
        });
        await tx
          .update(tasks)
          .set({ columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) })
          .where(eq(tasks.id, taskId));
        await this.activity.record(tx, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return loadTask(tx, taskId);
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.db.transaction(async (tx) => {
      await tx.delete(tasks).where(eq(tasks.id, taskId));
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

**What's new**
- **Merge semantics:** `values = { ...input, dueAt: toDate(input.dueAt) }`. A key that's absent stays `undefined` and Drizzle's `set()` skips it; a key that's `null` is written as `NULL`. That's exactly "omitted fields stay, `null` clears".
- The change log compares old and new values (`Date`s by `getTime()`), records only real changes, and resets `reminderSentAt` when the due date changes, so the reminder job (Part 11) runs again for the new date.
- **`move`** validates the target column (same project) and the `afterTaskId` (same target column), finds the next task above it (`gt(tasks.position, lower)`, `ne(tasks.id, taskId)`), and writes one key: `keyBetween(lower, next)`. A position collision with a concurrent move is retried (Step 6.3).
- **`delete`** queues `delete-storage-prefix` for the task's attachments after the transaction commits.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: task update, move and delete`

### Step 7.4 · Routes and wiring

**Goal:** the task endpoints, wired into the container and the app.

**Files:** `src/modules/tasks/tasks.routes.ts`, `src/container.ts`, `src/app.ts`

**`src/modules/tasks/tasks.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Nullable, Page, PageQuery, Patch, Timestamp, Trimmed } from '../../lib/schemas.js';
import { Priority, Task } from '../projects/projects.dto.js';
import type { TasksService } from './tasks.service.js';

const Title = Trimmed(1, 200);
const Description = Nullable(Type.String({ maxLength: 10_000 }));

const ListTasksQuery = Type.Object({
  ...PageQuery.properties,
  columnId: Type.Optional(Id),
  assigneeId: Type.Optional(Type.Union([Id, Type.Literal('none')])),
  priority: Type.Optional(Priority),
  dueBefore: Type.Optional(Timestamp),
});

const CreateTaskBody = Type.Object({
  title: Title,
  description: Type.Optional(Description),
  columnId: Type.Optional(Id),
  priority: Type.Optional(Priority),
  assigneeId: Type.Optional(Nullable(Id)),
  dueAt: Type.Optional(Nullable(Timestamp)),
});

const UpdateTaskBody = Patch({
  title: Title,
  description: Description,
  priority: Priority,
  assigneeId: Nullable(Id),
  dueAt: Nullable(Timestamp),
});

const MoveTaskBody = Type.Object({ columnId: Id, afterTaskId: Nullable(Id) });

const ProjectParams = Type.Object({ projectId: Id });
const TaskParams = Type.Object({ taskId: Id });
```

**`src/modules/tasks/tasks.routes.ts`** · continue

```ts

export const tasksRoutes: FastifyPluginAsyncTypebox<{ tasks: TasksService }> = async (
  app,
  { tasks },
) => {
  app.get(
    '/projects/:projectId/tasks',
    {
      schema: { params: ProjectParams, querystring: ListTasksQuery, response: { 200: Page(Task) } },
    },
    async (request) => {
      const { limit, cursor, ...filters } = request.query;
      return tasks.list(request.params.projectId, userIdOf(request), filters, limit, cursor);
    },
  );

  app.post(
    '/projects/:projectId/tasks',
    { schema: { params: ProjectParams, body: CreateTaskBody, response: { 201: Task } } },
    async (request, reply) => {
      reply.status(201);
      const { priority = 'medium', ...rest } = request.body;
      return tasks.create(request.params.projectId, userIdOf(request), { ...rest, priority });
    },
  );

  app.get(
    '/tasks/:taskId',
    { schema: { params: TaskParams, response: { 200: Task } } },
    async (request) => tasks.get(request.params.taskId, userIdOf(request)),
  );

  app.patch(
    '/tasks/:taskId',
    { schema: { params: TaskParams, body: UpdateTaskBody, response: { 200: Task } } },
    async (request) => tasks.update(request.params.taskId, userIdOf(request), request.body),
  );
```

**`src/modules/tasks/tasks.routes.ts`** · continue

```ts

  app.delete('/tasks/:taskId', { schema: { params: TaskParams } }, async (request, reply) => {
    await tasks.delete(request.params.taskId, userIdOf(request));
    return reply.status(204).send();
  });

  app.post(
    '/tasks/:taskId/move',
    { schema: { params: TaskParams, body: MoveTaskBody, response: { 200: Task } } },
    async (request) => tasks.move(request.params.taskId, userIdOf(request), request.body),
  );
};
```

**What's new**
- **`Type.Union([Id, Type.Literal('none')])`** for `assigneeId` in the query: a UUID or the word `none` (unassigned tasks).
- `{ ...PageQuery.properties, columnId: …, … }` extends the shared page query with this endpoint's filters.
- **`priority` defaults in the handler** (`const { priority = 'medium', ...rest } = request.body`). A JSON Schema `default` would also work (Ajv's `useDefaults` fills it in), but TypeBox would still type it as optional, so the destructuring default keeps the service's input type honest.
- `const { limit, cursor, ...filters } = request.query` separates paging from filtering with rest syntax.

**`src/container.ts`** · add after `import { RealtimePublisher } from './modules/realtime/publisher.js';`

```ts
import { TasksService } from './modules/tasks/tasks.service.js';
```

**`src/container.ts`** · add after `columns: new ColumnsService(db, access, activity, boardCache, realtime),`

```ts
    tasks: new TasksService(db, access, activity, boardCache, realtime, jobs),
```

**`src/app.ts`** · add after `import { projectsRoutes } from './modules/projects/projects.routes.js';`

```ts
import { tasksRoutes } from './modules/tasks/tasks.routes.js';
```

**`src/app.ts`** · add after `await secured.register(projectsRoutes, services);`

```ts
          await secured.register(tasksRoutes, services);
```

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** prove numbering under 10 concurrent creates, fractional moves, cache invalidation, merge-patch, assignment rules, filters and pagination, and RBAC.

**Files:** `tests/integration/tasks.test.ts`

**`tests/integration/tasks.test.ts`** · new file

```ts
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from '../helpers.js';

const ctx = await createTestContext();
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
  const res = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title, ...extra } },
    201,
  );
  return res.json<TaskBody>();
}
```

**`tests/integration/tasks.test.ts`** · continue

```ts

async function boardTitles() {
  const res = await send(ctx, 'GET', `/api/v1/projects/${f.projectId}/board`, { as: f.owner }, 200);
  const { columns } = res.json<{ columns: { name: string; tasks: { title: string }[] }[] }>();
  return columns.map((c) => [c.name, c.tasks.map((t) => t.title)]);
}

const move = (
  taskId: string,
  columnId: string | undefined,
  afterTaskId: string | null,
  status: number,
) =>
  send(
    ctx,
    'POST',
    `/api/v1/tasks/${taskId}/move`,
    { as: f.owner, body: { columnId, afterTaskId } },
    status,
  );

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
```

**`tests/integration/tasks.test.ts`** · continue

```ts

    await move(c.id, f.columnIds[0], null, 200); // C to the top of To Do
    await move(a.id, f.columnIds[2], null, 200); // A to the top of Done
    const moved = await move(b.id, f.columnIds[2], a.id, 200); // B after A
    expect(moved.json<TaskBody>().columnId).toBe(f.columnIds[2]);

    expect(await boardTitles()).toEqual([
      ['To Do', ['C']],
      ['In Progress', []],
      ['Done', ['A', 'B']],
    ]);
  });

  it('validates move targets', async () => {
    const a = await createTask('A');
    const other = await send(
      ctx,
      'POST',
      `/api/v1/workspaces/${f.workspaceId}/projects`,
      { as: f.owner, body: { name: 'Other', key: 'OT' } },
      201,
    );
    const otherBoard = await send(
      ctx,
      'GET',
      `/api/v1/projects/${other.json<{ id: string }>().id}/board`,
      { as: f.owner },
      200,
    );
    const foreignColumn = otherBoard.json<{ columns: { id: string }[] }>().columns[0]?.id;
    const res = await move(a.id, foreignColumn, null, 422);
    expect(res.json()).toMatchObject({ errors: [{ field: 'columnId' }] });
    await move(a.id, f.columnIds[0], a.id, 422);
  });
```

**`tests/integration/tasks.test.ts`** · continue

```ts

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
    const res = await send(
      ctx,
      'PATCH',
      `/api/v1/tasks/${t.id}`,
      { as: f.owner, body: { dueAt: null, priority: 'high' } },
      200,
    );
    expect(res.json()).toMatchObject({
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
    const rejected = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/tasks`,
      { as: f.owner, body: { title: 'X', assigneeId: stranger.id } },
      422,
    );
    expect(rejected.json()).toMatchObject({ errors: [{ field: 'assigneeId' }] });

    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const t = await createTask('Assigned', { assigneeId: member.id });
    await send(
      ctx,
      'DELETE',
      `/api/v1/workspaces/${f.workspaceId}/members/${member.id}`,
      { as: member },
      204,
    );
    const after = await send(ctx, 'GET', `/api/v1/tasks/${t.id}`, { as: f.owner }, 200);
    expect(after.json()).toMatchObject({ assignee: null });
  });

  it('filters and paginates the task list newest first', async () => {
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    for (let i = 1; i <= 5; i++) {
      await createTask(`T${i}`, i % 2 ? { assigneeId: member.id, priority: 'high' } : {});
    }
    const tasks = `/api/v1/projects/${f.projectId}/tasks`;
    const list = (q: string) => send(ctx, 'GET', `${tasks}?${q}`, { as: f.owner }, 200);
    const titles = (res: LightMyRequestResponse) =>
      res.json<{ items: TaskBody[] }>().items.map((t) => t.title);
```

**`tests/integration/tasks.test.ts`** · continue

```ts

    expect(titles(await list(`assigneeId=${member.id}`))).toEqual(['T5', 'T3', 'T1']);
    expect(titles(await list('assigneeId=none'))).toEqual(['T4', 'T2']);
    expect(titles(await list('priority=high&limit=2'))).toEqual(['T5', 'T3']);

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await list(`limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(res));
      cursor = res.json<{ nextCursor: string | null }>().nextCursor;
    } while (cursor);
    expect(seen).toEqual(['T5', 'T4', 'T3', 'T2', 'T1']);
    await send(ctx, 'GET', `${tasks}?cursor=garbage`, { as: f.owner }, 422);
  });

  it('lets viewers read but not write, and hides tasks from outsiders', async () => {
    const t = await createTask('Secret');
    const task = `/api/v1/tasks/${t.id}`;
    const viewer = await registerUser(ctx, 'Viewer');
    const outsider = await registerUser(ctx, 'Outsider');
    await addMember(ctx, f.workspaceId, viewer, 'viewer');
    await send(ctx, 'GET', task, { as: viewer }, 200);
    await send(ctx, 'PATCH', task, { as: viewer, body: { title: 'x' } }, 403);
    await send(ctx, 'GET', task, { as: outsider }, 404);
  });

  it('refuses to delete a column that still has tasks', async () => {
    const t = await createTask('Blocker', { columnId: f.columnIds[1] });
    const column = `/api/v1/columns/${f.columnIds[1] ?? ''}`;
    await send(ctx, 'DELETE', column, { as: f.owner }, 409);
    await send(ctx, 'DELETE', `/api/v1/tasks/${t.id}`, { as: f.owner }, 204);
    await send(ctx, 'GET', `/api/v1/tasks/${t.id}`, { as: f.owner }, 404);
    await send(ctx, 'DELETE', column, { as: f.owner }, 204);
  });
});
```

**What's new**
- `Promise.all` of ten `createTask` calls runs ten requests concurrently through `inject()`; each is a real transaction on the pool, so the counter's row lock is genuinely exercised.
- The cache test looks at Redis directly (`ctx.infra.redis.exists(…)`) to prove the board is cached after a read and invalidated by a write.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  9 passed (9)
      Tests  55 passed (55)
```

**Commit:** `test: task tests`

---
## Part 8 · Comments, activity feed & search

Three read-mostly features on top of tasks. Comments and the feed reuse everything you've built; search shows how to run **raw SQL with Drizzle** when a query is Postgres-specific.

### Step 8.1 · Comments

**Goal:** comments on a task, oldest first; only the author edits; the author or an admin deletes; new comments are pushed live.

**Files:** `src/modules/comments/comments.service.ts`, `src/modules/comments/comments.routes.ts`

**`src/modules/comments/comments.service.ts`** · new file

```ts
import { and, asc, eq, gt } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import type { Database, Db } from '../../db/client.js';
import { comments } from '../../db/schema.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { forbidden, notFound } from '../../lib/problem.js';
import { Id, Timestamp } from '../../lib/schemas.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

export const Comment = Type.Object({
  id: Id,
  taskId: Id,
  author: UserSummary,
  body: Type.String(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});

const toComment = (c: {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}): Static<typeof Comment> => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
```

**`src/modules/comments/comments.service.ts`** · continue

```ts

const withAuthor = { author: { columns: userSummaryColumns } } as const;

async function loadComment(db: Db, id: string) {
  const comment = await db.query.comments.findFirst({
    where: eq(comments.id, id),
    with: withAuthor,
  });
  if (!comment) throw notFound('Comment');
  return toComment(comment);
}

export class CommentsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.comments.findMany({
      where: and(eq(comments.taskId, taskId), after ? gt(comments.id, after) : undefined),
      orderBy: asc(comments.id),
      limit: limit + 1,
      with: withAuthor,
    });
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }
```

**`src/modules/comments/comments.service.ts`** · continue

```ts

  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(comments)
        .values({ taskId, authorId: userId, body })
        .returning({ id: comments.id });
      if (!created) throw new Error('INSERT … RETURNING returned no row');
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return loadComment(tx, created.id);
    });
    await this.realtime.publish(project.id, 'comment.created', { projectId: project.id, comment });
    return comment;
  }

  async update(commentId: string, userId: string, body: string) {
    const { comment, project } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId) throw forbidden('Only the author can edit a comment');
    return this.db.transaction(async (tx) => {
      await tx.update(comments).set({ body }).where(eq(comments.id, commentId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return loadComment(tx, commentId);
    });
  }
```

**`src/modules/comments/comments.service.ts`** · continue

```ts

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(comments).where(eq(comments.id, commentId));
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

**What's new**
- The response schema (`Comment`) lives next to the service that maps to it, since only this module uses it.
- `loadComment` returns the **DTO**, so the transaction callbacks return exactly what the route sends.
- Comments page **oldest first** (`asc`, `gt`): a conversation reads top to bottom, so the cursor moves forward.

**`src/modules/comments/comments.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { Comment, type CommentsService } from './comments.service.js';

const CommentBody = Type.Object({ body: Type.String({ minLength: 1, maxLength: 5000 }) });
const TaskParams = Type.Object({ taskId: Id });
const CommentParams = Type.Object({ commentId: Id });

export const commentsRoutes: FastifyPluginAsyncTypebox<{ comments: CommentsService }> = async (
  app,
  { comments },
) => {
  app.get(
    '/tasks/:taskId/comments',
    { schema: { params: TaskParams, querystring: PageQuery, response: { 200: Page(Comment) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return comments.list(request.params.taskId, userIdOf(request), limit, cursor);
    },
  );

  app.post(
    '/tasks/:taskId/comments',
    { schema: { params: TaskParams, body: CommentBody, response: { 201: Comment } } },
    async (request, reply) => {
      reply.status(201);
      return comments.create(request.params.taskId, userIdOf(request), request.body.body);
    },
  );

  app.patch(
    '/comments/:commentId',
    { schema: { params: CommentParams, body: CommentBody, response: { 200: Comment } } },
    async (request) =>
      comments.update(request.params.commentId, userIdOf(request), request.body.body),
  );
```

**`src/modules/comments/comments.routes.ts`** · continue

```ts

  app.delete(
    '/comments/:commentId',
    { schema: { params: CommentParams } },
    async (request, reply) => {
      await comments.delete(request.params.commentId, userIdOf(request));
      return reply.status(204).send();
    },
  );
};
```

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: comments`

### Step 8.2 · The activity feed

**Goal:** the workspace's activity log, newest first, optionally narrowed to a project or a task.

**Files:** `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.routes.ts`

**`src/modules/activity/activity.service.ts`** · new file

```ts
import { Type, type Static } from 'typebox';
import type { Database } from '../../db/client.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { Id, Nullable, Timestamp } from '../../lib/schemas.js';
import { toUserSummary, UserSummary } from '../users/users.dto.js';
import type { Access } from '../workspaces/access.js';
import type { ActivityRepository } from './activity.repository.js';

export const ActivityEvent = Type.Object({
  id: Id,
  workspaceId: Id,
  projectId: Nullable(Id),
  taskId: Nullable(Id),
  actor: UserSummary,
  type: Type.String(),
  data: Type.Object({}, { additionalProperties: true }),
  createdAt: Timestamp,
});

export class ActivityService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
  ) {}
```

**`src/modules/activity/activity.service.ts`** · continue

```ts

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
      (e): Static<typeof ActivityEvent> => ({
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

**What's new**
- **`data: Type.Object({}, { additionalProperties: true })`**: the event's `data` is free-form JSON (different per event type). An object schema with no listed properties and `additionalProperties: true` tells the serializer to write whatever keys are there. Without it, fast-json-stringify would write `{}`, because a response schema only writes the properties it lists.

**`src/modules/activity/activity.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { ActivityEvent, type ActivityService } from './activity.service.js';

const WorkspaceParams = Type.Object({ workspaceId: Id });
const ActivityQuery = Type.Object({
  ...PageQuery.properties,
  projectId: Type.Optional(Id),
  taskId: Type.Optional(Id),
});

export const activityRoutes: FastifyPluginAsyncTypebox<{ activity: ActivityService }> = async (
  app,
  { activity },
) => {
  app.get(
    '/workspaces/:workspaceId/activity',
    {
      schema: {
        params: WorkspaceParams,
        querystring: ActivityQuery,
        response: { 200: Page(ActivityEvent) },
      },
    },
    async (request) => {
      const { limit, cursor, ...filter } = request.query;
      return activity.list(request.params.workspaceId, userIdOf(request), filter, limit, cursor);
    },
  );
};
```

> **🧠 DSA & scalability · the activity feed**
> - **Data structure:** an append-only table with three B-tree indexes: `(workspace_id, id)`, and **partial** `(project_id, id) WHERE project_id IS NOT NULL` and `(task_id, id) WHERE task_id IS NOT NULL`.
> - **Algorithm:** keyset pagination on the time-ordered UUIDv7 `id`, newest first, with the narrowest filter picking its index.
> - **Complexity:** O(log n + k) per page.
> - **Why it scales:** rows are never updated, so writes never contend; the partial indexes skip workspace-level events, which keeps them smaller.
> - **Rejected:** writing the log from an event bus after commit (it can lose entries on a crash; recording in the same transaction can't).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: activity feed`

### Step 8.3 · Full-text search

**Goal:** ranked search over task titles and descriptions in a workspace, with safe highlighted snippets and pagination by rank.

**Files:** `src/modules/search/search.service.ts`, `src/modules/search/search.routes.ts`, `tests/unit/headline.test.ts`

**`src/modules/search/search.service.ts`** · new file

```ts
import { inArray, sql } from 'drizzle-orm';
import { Type } from 'typebox';
import type { Database } from '../../db/client.js';
import { tasks } from '../../db/schema.js';
import { decodeCursor, RankCursor, toPage } from '../../lib/cursor.js';
import { Task, taskWith, toTask } from '../projects/projects.dto.js';
import type { Access } from '../workspaces/access.js';

export const SearchHit = Type.Object({ task: Task, rank: Type.Number(), headline: Type.String() });

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

interface Hit extends Record<string, unknown> {
  id: string;
  rank: number;
  headline: string;
}
```

**What's new**
- `toSafeHeadline` is Express's: Postgres marks matches with control characters, we HTML-escape the whole snippet, then turn the markers into `<mark>` tags, so nothing user-supplied survives as raw HTML.
- `interface Hit extends Record<string, unknown>` satisfies `db.execute<T>()`, whose row type must be a record.

**`src/modules/search/search.service.ts`** · continue

```ts

export class SearchService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
  ) {}

  async search(workspaceId: string, userId: string, q: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(RankCursor, cursor) : undefined;
    // rank is a float4 (`real`); casting the cursor value back to real makes the
    // row comparison exact, because JSON carries the shortest round-tripping decimal.
    const afterClause = after
      ? sql`AND (ts_rank(t.search_vector, query), t.id) < (${after.rank}::real, ${after.id}::uuid)`
      : sql``;
    const { rows: hits } = await this.db.execute<Hit>(sql`
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
      LIMIT ${limit + 1}`);
```

**`src/modules/search/search.service.ts`** · continue

```ts

    const found = hits.length
      ? await this.db.query.tasks.findMany({
          where: inArray(
            tasks.id,
            hits.map((h) => h.id),
          ),
          with: taskWith,
        })
      : [];
    const byId = new Map(found.map((t) => [t.id, toTask(t)]));
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

**What's new (raw SQL with Drizzle)**
- **`db.execute(sql\`…\`)`** runs any SQL through the pool and returns the driver's result (`{ rows }` for node-postgres). Every `${value}` becomes a **bound parameter** (`$1`, `$2`…), never string concatenation, so `q` can't inject SQL.
- **Composable fragments:** `afterClause` is either a `sql\`AND …\`` fragment or an empty `sql\`\``; interpolating one `sql` inside another splices it in with its own parameters, like Prisma's `Prisma.sql` and `Prisma.empty`.
- `websearch_to_tsquery('english', q)` accepts what people type into search boxes: quotes for phrases, `-word` to exclude, `or`.
- After the ranked ids come back, the tasks are loaded with the relational API (`inArray(tasks.id, ids)`) and reassembled **in rank order** with a `Map`.

**`src/modules/search/search.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import { SearchHit, type SearchService } from './search.service.js';

const WorkspaceParams = Type.Object({ workspaceId: Id });
const SearchQuery = Type.Object({
  ...PageQuery.properties,
  q: Type.String({ minLength: 1, maxLength: 200 }),
});

export const searchRoutes: FastifyPluginAsyncTypebox<{ search: SearchService }> = async (
  app,
  { search },
) => {
  app.get(
    '/workspaces/:workspaceId/search',
    {
      schema: {
        params: WorkspaceParams,
        querystring: SearchQuery,
        response: { 200: Page(SearchHit) },
      },
    },
    async (request) => {
      const { q, limit, cursor } = request.query;
      return search.search(request.params.workspaceId, userIdOf(request), q, limit, cursor);
    },
  );
};
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

> **🧠 DSA & scalability · full-text search**
> - **Data structure:** a GIN **inverted index** on the generated `tsvector`: each lexeme maps to the rows containing it.
> - **Algorithm:** parse the query into stemmed lexemes (`redirects` → `redirect`), look up each posting list in GIN and intersect them; `ts_rank` scores matches, with title words (weight `A`) above description words (`B`).
> - **Complexity:** roughly O(log V + m) for V distinct words and m matches, instead of the O(n) scan of `ILIKE '%login%'`.
> - **Pagination by rank:** cursor `(rank, id)` and a **row comparison** `(rank, id) < ($rank, $id)`. `rank` is a `real`, so the cursor value is cast back with `::real`; JSON carries the shortest round-tripping decimal, so the comparison is exact.
> - **Rejected:** `ILIKE` (no index, no stemming, no ranking); a separate search engine (another cluster; Postgres covers this scale).

**✅ Checkpoint**

```bash
npm test -- tests/unit/headline.test.ts
```

Expected: `Tests  1 passed (1)`.

**Commit:** `feat: full-text search`

### Step 8.4 · Wiring and tests

**Goal:** wire the three modules in and test comment permissions, the transactional activity log and ranked, paginated search.

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

**`src/container.ts`** · add after `tasks: new TasksService(db, access, activity, boardCache, realtime, jobs),`

```ts
    comments: new CommentsService(db, access, activity, realtime),
```

**`src/container.ts`** · add after `comments: new CommentsService(db, access, activity, realtime),`

```ts
    activity: new ActivityService(db, access, activity),
    search: new SearchService(db, access),
```

**`src/app.ts`** · add after `import { installValidators } from './http/validation.js';`

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

**`src/app.ts`** · add after `await secured.register(tasksRoutes, services);`

```ts
          await secured.register(commentsRoutes, services);
```

**`src/app.ts`** · add after `await secured.register(commentsRoutes, services);`

```ts
          await secured.register(activityRoutes, services);
          await secured.register(searchRoutes, services);
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
  send,
  type Fixture,
} from '../helpers.js';

const ctx = await createTestContext();
let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

async function createTask(title: string, description?: string) {
  const res = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title, description } },
    201,
  );
  return res.json<{ id: string }>().id;
}

describe('comments', () => {
  it('lists oldest first; only the author edits; author or admin deletes', async () => {
    const taskId = await createTask('Discuss me');
    const member = await registerUser(ctx, 'Member');
    await addMember(ctx, f.workspaceId, member, 'member');
    const url = `/api/v1/tasks/${taskId}/comments`;
    const first = await send(ctx, 'POST', url, { as: member, body: { body: 'first' } }, 201);
    await send(ctx, 'POST', url, { as: f.owner, body: { body: 'second' } }, 201);
    const comment = `/api/v1/comments/${first.json<{ id: string }>().id}`;
```

**`tests/integration/collaboration.test.ts`** · continue

```ts

    const list = await send(ctx, 'GET', url, { as: member }, 200);
    const bodies = list.json<{ items: { body: string }[] }>().items.map((c) => c.body);
    expect(bodies).toEqual(['first', 'second']);

    await send(ctx, 'PATCH', comment, { as: f.owner, body: { body: 'hijack' } }, 403);
    const edited = await send(ctx, 'PATCH', comment, { as: member, body: { body: 'edited' } }, 200);
    expect(edited.json()).toMatchObject({ body: 'edited', author: { id: member.id } });
    await send(ctx, 'DELETE', comment, { as: f.owner }, 204);
  });
});

describe('activity', () => {
  it('records every change in the same transaction, newest first', async () => {
    const taskId = await createTask('Doomed');
    await send(ctx, 'DELETE', `/api/v1/tasks/${taskId}`, { as: f.owner }, 204);
    const activity = `/api/v1/workspaces/${f.workspaceId}/activity`;
    const forTask = await send(ctx, 'GET', `${activity}?taskId=${taskId}`, { as: f.owner }, 200);
    const types = forTask.json<{ items: { type: string }[] }>().items.map((e) => e.type);
    expect(types).toEqual(['task.deleted', 'task.created']);

    const all = await send(ctx, 'GET', `${activity}?limit=100`, { as: f.owner }, 200);
    const allTypes = all.json<{ items: { type: string }[] }>().items.map((e) => e.type);
    expect(allTypes.at(-1)).toBe('workspace.created');
  });
});

describe('search', () => {
  it('ranks title matches first, escapes headlines, and pages by (rank, id)', async () => {
    await createTask('Write docs', 'Explain the <b>login</b> flow');
    await createTask('Fix login redirect', 'Users bounce back');
    await createTask('Unrelated', 'Nothing here');
```

**`tests/integration/collaboration.test.ts`** · continue

```ts

    const url = `/api/v1/workspaces/${f.workspaceId}/search`;
    const search = (query: Record<string, string | number>) =>
      send(ctx, 'GET', url, { as: f.owner, query }, 200);
    const res = await search({ q: 'login' });
    const hits = res.json<{ items: { task: { title: string }; headline: string }[] }>().items;
    expect(hits.map((h) => h.task.title)).toEqual(['Fix login redirect', 'Write docs']);
    // Postgres' parser drops tag tokens like <b>; nothing user-supplied survives as raw HTML.
    expect(hits[1]?.headline).toContain('<mark>login</mark>');
    expect(hits[1]?.headline).not.toContain('<b>');

    const page1 = await search({ q: 'login', limit: 1 });
    const cursor = page1.json<{ nextCursor: string }>().nextCursor;
    const page2 = await search({ q: 'login', limit: 1, cursor });
    const body2 = page2.json<{ items: { task: { title: string } }[]; nextCursor: null }>();
    expect(body2.items[0]?.task.title).toBe('Write docs');
    expect(body2.nextCursor).toBeNull();
  });

  it('only searches workspaces the caller belongs to', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    await send(
      ctx,
      'GET',
      `/api/v1/workspaces/${f.workspaceId}/search?q=docs`,
      { as: outsider },
      404,
    );
  });
});
```

**What's new**
- `send(..., { query: { q: 'login', limit: 1, cursor } })` passes a query object; `inject()` encodes it, the same as Supertest's `.query()`.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  11 passed (11)
      Tests  60 passed (60)
```

**Commit:** `feat: comments, activity feed and full-text search`

---
## Part 9 · Attachments (presigned S3 uploads)

Files never pass through the API: the client asks for a **presigned URL**, uploads straight to S3 (RustFS locally), then tells the API the upload is complete. The storage wrapper is Express's unchanged; the service and routes are ported to Drizzle and TypeBox.

### Step 9.1 · The storage wrapper

**Goal:** presign uploads and downloads, check an object's size, and delete a whole prefix.

**Files:** `src/infra/storage.ts`

```bash
npm i -E @aws-sdk/client-s3@3.1167.0 @aws-sdk/s3-request-presigner@3.1167.0
```

- The **AWS SDK v3** is modular: `client-s3` for S3 commands, `s3-request-presigner` for signing URLs. It speaks to any S3-compatible service (RustFS here, AWS S3 in production).

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
```

**`src/infra/storage.ts`** · continue

```ts

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
- Identical to Express. Two clients: `internal` talks to `S3_ENDPOINT` (inside Docker that's `http://rustfs:9000`), while `presigner` signs URLs for `S3_PUBLIC_ENDPOINT`, the address the **browser** uses, because a signature covers the host.
- `ContentLength` is part of the signed upload, so S3 itself rejects a body of a different size.

> **🧠 DSA & scalability · deleting a prefix**
> - **Data structure:** S3 has no folders: a flat, sorted key space where "a folder" is a **key prefix** (`projects/{id}/`), which is why our keys are hierarchical.
> - **Algorithm:** `ListObjectsV2(prefix)` returns up to 1,000 keys per page plus a continuation token; one `DeleteObjects` per page (also capped at 1,000).
> - **Complexity:** O(n / 1000) round trips for n objects; memory O(1000).
> - **Why it scales:** a project with 50,000 files costs 50 list calls and 50 batch deletes, in a background job (Part 11), never in an HTTP request.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: s3 storage wrapper`

### Step 9.2 · The attachments service and routes

**Goal:** start an upload, confirm it, download it and delete it, enforcing who may do what.

**Files:** `src/modules/attachments/attachments.service.ts`, `src/modules/attachments/attachments.routes.ts`

**`src/modules/attachments/attachments.service.ts`** · new file

```ts
import { and, desc, eq, lt } from 'drizzle-orm';
import { Type, type Static } from 'typebox';
import { v7 as uuidv7 } from 'uuid';
import type { Database, Db } from '../../db/client.js';
import { attachments } from '../../db/schema.js';
import type { Storage } from '../../infra/storage.js';
import type { Jobs } from '../../jobs/queue.js';
import { decodeCursor, IdCursor, toPage } from '../../lib/cursor.js';
import { conflict, forbidden, notFound } from '../../lib/problem.js';
import { Id, Timestamp } from '../../lib/schemas.js';
import type { ActivityRepository } from '../activity/activity.repository.js';
import { toUserSummary, UserSummary, type UserSummaryDto } from '../users/users.dto.js';
import { userSummaryColumns } from '../users/users.repository.js';
import type { Access } from '../workspaces/access.js';
import { atLeast } from '../workspaces/roles.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

export const Attachment = Type.Object({
  id: Id,
  taskId: Id,
  uploader: UserSummary,
  fileName: Type.String(),
  contentType: Type.String(),
  sizeBytes: Type.Integer(),
  status: Type.Enum(['pending', 'ready']),
  createdAt: Timestamp,
});

export const AttachmentUpload = Type.Object({
  attachment: Attachment,
  upload: Type.Object({
    url: Type.String(),
    method: Type.Literal('PUT'),
    headers: Type.Record(Type.String(), Type.String()),
    expiresAt: Timestamp,
  }),
});
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts

export const DownloadUrl = Type.Object({ url: Type.String(), expiresAt: Timestamp });

const toAttachment = (a: {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: 'pending' | 'ready';
  createdAt: Date;
}): Static<typeof Attachment> => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});

const withUploader = { uploader: { columns: userSummaryColumns } } as const;
const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadAttachment(db: Db, id: string) {
  const attachment = await db.query.attachments.findFirst({
    where: eq(attachments.id, id),
    with: withUploader,
  });
  if (!attachment) throw notFound('Attachment');
  return toAttachment(attachment);
}
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts

export class AttachmentsService {
  constructor(
    private readonly db: Database,
    private readonly access: Access,
    private readonly activity: ActivityRepository,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(IdCursor, cursor).id : undefined;
    const rows = await this.db.query.attachments.findMany({
      where: and(
        eq(attachments.taskId, taskId),
        eq(attachments.status, 'ready'),
        after ? lt(attachments.id, after) : undefined,
      ),
      orderBy: desc(attachments.id),
      limit: limit + 1,
      with: withUploader,
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
    await this.db
      .insert(attachments)
      .values({ id, taskId, uploaderId: userId, storageKey, ...input });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: await loadAttachment(this.db, id),
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
    if (attachment.status === 'ready') return loadAttachment(this.db, attachmentId);
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (size !== attachment.sizeBytes) throw conflict('The uploaded file size does not match');
    return this.db.transaction(async (tx) => {
      await tx.update(attachments).set({ status: 'ready' }).where(eq(attachments.id, attachmentId));
      await this.activity.record(tx, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return loadAttachment(tx, attachmentId);
    });
  }

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
```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts

  async delete(attachmentId: string, userId: string) {
    const { attachment, project, membership } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the uploader or an admin can delete an attachment');
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(attachments).where(eq(attachments.id, attachmentId));
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

**What's new**
- **The id is generated in the app** (`uuidv7()` from `uuid`), not by Postgres's `uuidv7()` default: the storage key `projects/{p}/tasks/{t}/{id}` must exist *before* the insert. Passing `id` in `values()` overrides the column default.
- The user's file name is never part of the key, so `../../etc/passwd` can't escape the prefix; it comes back on download through `Content-Disposition` (RFC 5987 encoding for non-ASCII names).
- **No `bigint` juggling:** `sizeBytes` is a `number` (`mode: 'number'`, Step 2.3), so `size !== attachment.sizeBytes` compares two numbers. Express had to convert between `bigint` and `number` in three places.
- `headers: Type.Record(Type.String(), Type.String())` in `AttachmentUpload` is a string-to-string map: the headers the client must send with its `PUT`.

**`src/modules/attachments/attachments.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Id, Page, PageQuery } from '../../lib/schemas.js';
import {
  Attachment,
  AttachmentUpload,
  DownloadUrl,
  type AttachmentsService,
} from './attachments.service.js';

const CreateAttachmentBody = Type.Object({
  // No slashes, backslashes or control characters (U+0000–U+001F).
  fileName: Type.String({ minLength: 1, maxLength: 255, pattern: '^[^/\\\\\\u0000-\\u001f]+$' }),
  contentType: Type.String({
    minLength: 3,
    maxLength: 127,
    pattern: '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$',
  }),
  sizeBytes: Type.Integer({ minimum: 1, maximum: 25 * 1024 * 1024 }),
});

const TaskParams = Type.Object({ taskId: Id });
const AttachmentParams = Type.Object({ attachmentId: Id });

export const attachmentsRoutes: FastifyPluginAsyncTypebox<{
  attachments: AttachmentsService;
}> = async (app, { attachments }) => {
  app.get(
    '/tasks/:taskId/attachments',
    { schema: { params: TaskParams, querystring: PageQuery, response: { 200: Page(Attachment) } } },
    async (request) => {
      const { limit, cursor } = request.query;
      return attachments.list(request.params.taskId, userIdOf(request), limit, cursor);
    },
  );
```

**`src/modules/attachments/attachments.routes.ts`** · continue

```ts

  app.post(
    '/tasks/:taskId/attachments',
    {
      schema: {
        params: TaskParams,
        body: CreateAttachmentBody,
        response: { 201: AttachmentUpload },
      },
    },
    async (request, reply) => {
      reply.status(201);
      return attachments.create(request.params.taskId, userIdOf(request), request.body);
    },
  );

  app.delete(
    '/attachments/:attachmentId',
    { schema: { params: AttachmentParams } },
    async (request, reply) => {
      await attachments.delete(request.params.attachmentId, userIdOf(request));
      return reply.status(204).send();
    },
  );

  app.post(
    '/attachments/:attachmentId/complete',
    { schema: { params: AttachmentParams, response: { 200: Attachment } } },
    async (request) => attachments.complete(request.params.attachmentId, userIdOf(request)),
  );

  app.get(
    '/attachments/:attachmentId/download',
    { schema: { params: AttachmentParams, response: { 200: DownloadUrl } } },
    async (request) => attachments.download(request.params.attachmentId, userIdOf(request)),
  );
};
```

**What's new**
- **The file-name pattern is a JSON Schema `pattern`** (a regex source string): `^[^/\\\\\\u0000-\\u001f]+$` in TypeScript source is the regex `^[^/\\\u0000-\u001f]+$` after string escaping: no slash, no backslash, no control character. Ajv compiles patterns with the `u` flag, so `\u0000` escapes are valid.
- `sizeBytes` is capped at 25 MB by the schema; the database `CHECK (size_bytes > 0)` is the last line of defence.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: attachments service and routes`

### Step 9.3 · Wiring and tests

**Goal:** add storage to the infrastructure and the attachment routes to the app; make sure the test bucket exists; test the whole upload flow against real S3.

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

**`src/container.ts`** · add after `comments: new CommentsService(db, access, activity, realtime),`

```ts
    attachments: new AttachmentsService(db, access, activity, infra.storage, jobs),
```

**`src/app.ts`** · add after `import { activityRoutes } from './modules/activity/activity.routes.js';`

```ts
import { attachmentsRoutes } from './modules/attachments/attachments.routes.js';
```

**`src/app.ts`** · add after `await secured.register(commentsRoutes, services);`

```ts
          await secured.register(attachmentsRoutes, services);
```

**`tests/global-setup.ts`** · add at the top

```ts
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
```

**`tests/global-setup.ts`** · add after `import pg from 'pg';`

```ts
import { loadConfig } from '../src/config.js';
```

**`tests/global-setup.ts`** · add after `await db.$client.end();`

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

**What's new**
- `global-setup.ts` now also creates the bucket if it's missing (`HeadBucket`, then `CreateBucket`). Compose's `s3-init` creates it for development; CI's bare service container doesn't.

**`tests/integration/attachments.test.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, createTestContext, resetState, send, type Fixture } from '../helpers.js';

const ctx = await createTestContext();
let f: Fixture;
let taskId: string;
beforeEach(async () => {
  await resetState(ctx);
  f = await createFixture(ctx);
  const task = await send(
    ctx,
    'POST',
    `/api/v1/projects/${f.projectId}/tasks`,
    { as: f.owner, body: { title: 'Has files' } },
    201,
  );
  taskId = task.json<{ id: string }>().id;
});
afterAll(() => ctx.close());

interface Created {
  attachment: { id: string; status: string };
  upload: { url: string; method: string; headers: Record<string, string> };
}

const start = (body: Record<string, unknown>, status: number) =>
  send(ctx, 'POST', `/api/v1/tasks/${taskId}/attachments`, { as: f.owner, body }, status);

describe('attachments', () => {
  it('uploads straight to S3 with a presigned URL, then completes and downloads', async () => {
    const content = 'hello attachment';
    const created = await start(
      { fileName: 'notes résumé.txt', contentType: 'text/plain', sizeBytes: content.length },
      201,
    );
    const { attachment, upload } = created.json<Created>();
    const url = `/api/v1/attachments/${attachment.id}`;
    expect(attachment.status).toBe('pending');
    expect(upload.method).toBe('PUT');
```

**`tests/integration/attachments.test.ts`** · continue

```ts

    // Completing before the bytes exist is a conflict.
    await send(ctx, 'POST', `${url}/complete`, { as: f.owner }, 409);

    const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: content });
    expect(put.status).toBe(200);

    const done = await send(ctx, 'POST', `${url}/complete`, { as: f.owner }, 200);
    expect(done.json()).toMatchObject({ status: 'ready', sizeBytes: content.length });

    const list = await send(
      ctx,
      'GET',
      `/api/v1/tasks/${taskId}/attachments`,
      { as: f.owner },
      200,
    );
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const download = await send(ctx, 'GET', `${url}/download`, { as: f.owner }, 200);
    const file = await fetch(download.json<{ url: string }>().url);
    expect(await file.text()).toBe(content);
    expect(file.headers.get('content-disposition')).toContain(
      "filename*=UTF-8''notes%20r%C3%A9sum%C3%A9.txt",
    );

    await send(ctx, 'DELETE', url, { as: f.owner }, 204);
    await send(ctx, 'GET', `${url}/download`, { as: f.owner }, 404);
  });
```

**`tests/integration/attachments.test.ts`** · continue

```ts

  it('refuses uploads whose size differs from what was declared', async () => {
    const created = await start(
      { fileName: 'a.txt', contentType: 'text/plain', sizeBytes: 5 },
      201,
    );
    const { attachment, upload } = created.json<Created>();
    // The signed Content-Length makes S3 itself reject a different size.
    const put = await fetch(upload.url, {
      method: 'PUT',
      headers: upload.headers,
      body: 'way too long',
    });
    expect(put.ok).toBe(false);
    await send(ctx, 'POST', `/api/v1/attachments/${attachment.id}/complete`, { as: f.owner }, 409);
  });

  it('validates file metadata', async () => {
    const res = await start(
      { fileName: '../etc/passwd', contentType: 'Text/Plain', sizeBytes: 30 * 1024 * 1024 },
      422,
    );
    const fields = res
      .json<{ errors: { field: string }[] }>()
      .errors.map((e) => e.field)
      .sort();
    expect(fields).toEqual(['contentType', 'fileName', 'sizeBytes']);
  });
});
```

**What's new**
- The test uploads with the real `fetch` to the presigned URL, the same request a browser makes, and downloads the file back through the presigned download URL. A wrong-size upload is rejected by S3 itself.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  12 passed (12)
      Tests  63 passed (63)
```

**Commit:** `feat: attachments via presigned S3 uploads`

---
## Part 10 · Real-time (WebSockets, Pub/Sub, presence)

Board changes reach every open browser within milliseconds, across any number of API instances. The protocol (README §9) and the Redis design are Express's. What changes is how the socket arrives: Express hooked the raw HTTP server's `upgrade` event; Fastify declares a WebSocket **route**, with hooks like any other route.

### Step 10.1 · Tickets and presence

**Goal:** single-use tickets that authenticate a WebSocket, and a presence list of who's watching a board.

**Files:** `src/modules/realtime/tickets.ts`, `src/modules/realtime/presence.ts`

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
```

**`src/modules/realtime/presence.ts`** · continue

```ts

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

**What's new**
- Both identical to Express. **Tickets** exist because browsers can't set an `Authorization` header on a WebSocket handshake: the client trades its JWT for a 30-second, single-use ticket (`GETDEL` reads and deletes atomically) and passes it as `?ticket=`.

> **🧠 DSA & scalability · presence**
> - **Data structure:** a Redis **sorted set** per project: member `userId:connectionId`, score = last-seen ms.
> - **Algorithm:** subscribe / `ping` → `ZADD` (refresh the score); unsubscribe / close → `ZREM`; read → `ZREMRANGEBYSCORE -inf (now − 60 s)` evicts connections that died silently, `ZRANGE` lists the rest, dedupe by user.
> - **Complexity:** O(log n) per heartbeat, O(log n + k) per read, for n connections on a project.
> - **Why one member per connection:** with one per *user*, closing one of two tabs would mark you offline.
> - **Rejected:** a set plus a TTL key per user (members can't expire individually); in-memory maps (each instance sees only its own sockets).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: websocket tickets and presence`

### Step 10.2 · The WebSocket gateway

**Goal:** a gateway that tracks local sockets per project, relays Redis Pub/Sub messages to them, answers `subscribe`/`unsubscribe`/`ping`, and reaps idle connections; plus the two routes that expose it.

**Files:** `src/modules/realtime/gateway.ts`, `src/modules/realtime/realtime.routes.ts`

```bash
npm i -E @fastify/websocket@11.3.7 ws@8.22.2
npm i -D -E @types/ws@8.18.2
```

- **`@fastify/websocket`** runs the **`ws`** library inside Fastify: it handles the HTTP upgrade and gives a route handler the socket. We also install `ws` itself because the gateway imports it directly (the `WebSocket` class and its `OPEN` constant); depending on a transitive package is fragile, since its version can change under you.

**`src/modules/realtime/gateway.ts`** · new file

```ts
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import { v7 as uuidv7 } from 'uuid';
import { WebSocket, type RawData } from 'ws';
import { ProblemError } from '../../lib/problem.js';
import { Id } from '../../lib/schemas.js';
import type { Access } from '../workspaces/access.js';
import type { Presence } from './presence.js';
import { envelope, projectChannel, type RealtimePublisher } from './publisher.js';

const ProjectPayload = Type.Object({ projectId: Id });
const ClientMessage = Type.Union([
  Type.Object({ type: Type.Literal('subscribe'), payload: ProjectPayload }),
  Type.Object({ type: Type.Literal('unsubscribe'), payload: ProjectPayload }),
  Type.Object({ type: Type.Literal('ping') }),
]);

export const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_BAD_MESSAGES = 4400;
export const CLOSE_GOING_AWAY = 1001;
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

**What's new**
- **Client messages are a TypeBox union** of three object schemas with literal `type`s. `Value.Parse(ClientMessage, json)` checks a message and returns it typed; TypeScript then narrows the union in the `switch` below, like a zod discriminated union.

**`src/modules/realtime/gateway.ts`** · continue

```ts

export class RealtimeGateway {
  /** projectId → this instance's sockets watching it. */
  private readonly local = new Map<string, Set<Client>>();
  private readonly clients = new Set<Client>();
  private readonly reaper: NodeJS.Timeout;

  constructor(
    private readonly subscriber: Redis,
    private readonly access: Access,
    private readonly presence: Presence,
    private readonly publisher: RealtimePublisher,
    private readonly logger: FastifyBaseLogger,
  ) {
    this.subscriber.on('message', (channel: string, message: string) => {
      const projectId = channel.slice('project:'.length);
      for (const client of this.local.get(projectId) ?? []) send(client, message);
    });
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
      for (const client of this.clients) if (client.lastSeen < cutoff) client.ws.terminate();
    }, 30_000);
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts

  /**
   * Called synchronously from the route handler, so listeners are attached before the
   * first message can arrive. `userId` is null when the ticket was missing or already used.
   */
  accept(ws: WebSocket, userId: string | null): void {
    // Accept first, then close with a reason the browser can read.
    if (userId === null) {
      ws.close(CLOSE_UNAUTHORIZED, 'invalid or expired ticket');
      return;
    }
    const client: Client = {
      ws,
      userId,
      connectionId: uuidv7(),
      projects: new Set(),
      lastSeen: Date.now(),
      badMessages: 0,
    };
    this.clients.add(client);
    ws.on('message', (data) => void this.onMessage(client, data));
    ws.on('close', () => void this.onClose(client));
    ws.on('error', (err) => {
      this.logger.warn({ err }, 'websocket error');
    });
  }
```

**`src/modules/realtime/gateway.ts`** · continue

```ts

  private async onMessage(client: Client, data: RawData): Promise<void> {
    client.lastSeen = Date.now();
    let parsed: Static<typeof ClientMessage>;
    try {
      parsed = Value.Parse(ClientMessage, JSON.parse(rawToString(data)));
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
    this.clients.delete(client);
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

  /** Stops the reaper and drops the Redis subscriber; sockets are closed by @fastify/websocket. */
  async close(): Promise<void> {
    clearInterval(this.reaper);
    await this.subscriber.quit();
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
- **`accept(ws, userId)` replaces Express's `handleUpgrade`.** The upgrade itself is now Fastify's job; the gateway just receives an open socket and a user id (or `null` for a bad ticket, which gets the readable close code 4401).
- **Attach listeners synchronously.** `accept` registers `message`, `close` and `error` listeners before returning. If the handler awaited anything first, a message sent right after `open` could arrive before anyone listens, and be lost.
- The gateway keeps its **own `Set` of clients** for the idle reaper (Express iterated its private `WebSocketServer`). `close()` stops the reaper and quits the subscriber connection; closing the sockets is left to the plugin (next step).
- `logger: FastifyBaseLogger`: the gateway logs through the app's logger (`app.log`), so its lines carry the same format.

**`src/types/fastify.d.ts`** · add after `import '@fastify/jwt';`

```ts
import '@fastify/websocket';
```

**What's new**
- **`import '@fastify/websocket'` in the types file** pulls in the plugin's type augmentations (the `websocket: true` route option and the `(socket, request)` handler signature) wherever TypeScript compiles. Until `app.ts` imports the plugin in the next step, nothing else would; the same line made `@fastify/jwt`'s types available in Step 4.2. A `.d.ts` file is never executed, so this has no runtime effect.

**`src/modules/realtime/realtime.routes.ts`** · new file

```ts
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { FastifyPluginAsync } from 'fastify';
import { Type } from 'typebox';
import { userIdOf } from '../../http/auth.js';
import { Timestamp } from '../../lib/schemas.js';
import type { RealtimeGateway } from './gateway.js';
import type { Tickets } from './tickets.js';

const Ticket = Type.Object({ ticket: Type.String(), expiresAt: Timestamp });

/** POST /api/v1/ws/ticket: lives in the authenticated API context. */
export const ticketRoutes: FastifyPluginAsyncTypebox<{ tickets: Tickets }> = async (
  app,
  { tickets },
) => {
  app.post('/ws/ticket', { schema: { response: { 201: Ticket } } }, async (request, reply) => {
    reply.status(201);
    return tickets.issue(userIdOf(request));
  });
};
```

**`src/modules/realtime/realtime.routes.ts`** · continue

```ts

/** GET /ws: the WebSocket endpoint itself, authenticated by a single-use ticket. */
export const socketRoutes: FastifyPluginAsync<{
  gateway: RealtimeGateway;
  tickets: Tickets;
}> = async (app, { gateway, tickets }) => {
  app.get<{ Querystring: { ticket?: string } }>(
    '/ws',
    {
      websocket: true,
      // Runs before the upgrade; the handler below must stay synchronous so it attaches its
      // message listener before the first frame arrives.
      preValidation: async (request) => {
        request.userId = await tickets.redeem(request.query.ticket ?? '');
      },
    },
    (socket, request) => {
      gateway.accept(socket, request.userId);
    },
  );
};
```

**What's new**
- **`{ websocket: true }`** turns a `GET` route into a WebSocket endpoint: when a request arrives with `Upgrade: websocket`, `@fastify/websocket` completes the handshake and calls the handler with `(socket, request)`.
- **The ticket is redeemed in a `preValidation` hook**, which runs before the upgrade and may be async. It stores the result in `request.userId`, so the handler itself can stay synchronous (previous point). An HTTP request without the upgrade header gets a 404.
- `app.get<{ Querystring: { ticket?: string } }>` types the query by hand, because this route has no TypeBox schema: a validation failure would be answered with an HTTP error *before* the upgrade, and the browser can't read that; a 4401 close code after accepting is readable.
- The ticket route lives in the authenticated API context (it's registered with `secured`, next step); the socket route at the root (`/ws`, outside `/api/v1`).

> **🧠 DSA & scalability · fan-out across instances**
> - **Data structures:** per instance, a `Map<projectId, Set<Client>>` of local sockets; in Redis, one Pub/Sub channel per project.
> - **Algorithm:** the first local subscriber to a project makes the instance `SUBSCRIBE project:{id}`; the last one leaving makes it `UNSUBSCRIBE` (reference counting). A write on any instance `PUBLISH`es once; Redis delivers it to every subscribed instance, which forwards it to its local sockets.
> - **Complexity:** per event, O(instances watching) deliveries + O(local subscribers) writes; instances with no viewer of a project receive nothing.
> - **Why it scales horizontally:** instances share only Redis. The test in Step 10.3 runs **two** Fastify instances to prove a move made through one reaches a socket on the other.
> - **Rejected:** sticky sessions with in-process broadcast; Socket.IO (its own protocol, not a plain browser `WebSocket`). Pulse (App 2) uses Redis **Streams** to add replay.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: websocket gateway with redis pub/sub fan-out`

### Step 10.3 · Wiring and tests

**Goal:** register the WebSocket plugin, create one gateway per app, expose `/ws` and `/api/v1/ws/ticket`, and test fan-out across two instances.

**Files:** `src/container.ts`, `src/app.ts`, `tests/integration/realtime.test.ts`

**`src/container.ts`** · add after `import { ProjectsService } from './modules/projects/projects.service.js';`

```ts
import { Presence } from './modules/realtime/presence.js';
```

**`src/container.ts`** · add after `import { RealtimePublisher } from './modules/realtime/publisher.js';`

```ts
import { Tickets } from './modules/realtime/tickets.js';
```

**`src/container.ts`** · add after `access,`

```ts
    realtime,
    tickets: new Tickets(redis),
    presence: new Presence(redis, users),
```

**`src/app.ts`** · add after `import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';`

```ts
import websocket from '@fastify/websocket';
```

**`src/app.ts`** · add after `import { projectsRoutes } from './modules/projects/projects.routes.js';`

```ts
import { CLOSE_GOING_AWAY, RealtimeGateway } from './modules/realtime/gateway.js';
import { socketRoutes, ticketRoutes } from './modules/realtime/realtime.routes.js';
```

**`src/app.ts`** · add after the JWT registration (after its closing `});`)

```ts
  await app.register(websocket, {
    options: { maxPayload: 16 * 1024 },
    preClose(done) {
      for (const client of this.websocketServer.clients) {
        client.close(CLOSE_GOING_AWAY, 'server shutting down');
      }
      this.websocketServer.close(() => {
        done();
      });
    },
  });
```

**`src/app.ts`** · add after `await withMethodNotAllowed(app, () => app.register(healthRoutes, { db: infra.db, redis }));`

```ts

  const gateway = new RealtimeGateway(
    redis.duplicate(), // a Redis connection in SUBSCRIBE mode can't run other commands
    services.access,
    services.presence,
    services.realtime,
    app.log,
  );
  app.addHook('onClose', () => gateway.close());
  await app.register(socketRoutes, { gateway, tickets: services.tickets });
```

**`src/app.ts`** · add after `await secured.register(searchRoutes, services);`

```ts
          await secured.register(ticketRoutes, services);
```

**What's new**
- **`preClose`** is a plugin option of `@fastify/websocket`: it runs when the app starts closing, before the server stops. Ours closes every socket with **1001 "going away"**, so clients know to reconnect elsewhere (the default closes them without a code). `this` is the Fastify instance, hence the `function` syntax rather than an arrow.
- **One gateway per app**, created in `buildApp` with its own Redis connection: a connection in `SUBSCRIBE` mode can't run other commands, so it needs `redis.duplicate()`. `app.addHook('onClose', …)` ties the gateway's cleanup to the app's lifecycle; `main.ts` and the tests just call `app.close()`.

**`tests/integration/realtime.test.ts`** · new file

```ts
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp } from '../../src/app.js';
import { workspaceMembers } from '../../src/db/schema.js';
import {
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  type Fixture,
  type TestContext,
  type TestUser,
} from '../helpers.js';

interface Envelope {
  type: string;
  payload?: Record<string, unknown>;
  ts?: string;
}

/** One "API instance": its own Fastify app, listening port, gateway and Redis subscriber. */
async function startInstance(ctx: TestContext) {
  const app = await buildApp(ctx.infra, ctx.services);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, port, stop: () => app.close() };
}

class TestSocket {
  private readonly received: Envelope[] = [];
  private waiters: (() => void)[] = [];

  constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => {
      this.received.push(JSON.parse((data as Buffer).toString('utf8')) as Envelope);
      for (const w of this.waiters) w();
    });
  }
```

**`tests/integration/realtime.test.ts`** · continue

```ts

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
```

**`tests/integration/realtime.test.ts`** · continue

```ts

const ctx = await createTestContext();
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

async function ticketFor(user: TestUser) {
  const res = await a.app.inject({ method: 'POST', url: '/api/v1/ws/ticket', headers: user.auth });
  expect(res.statusCode).toBe(201);
  return res.json<{ ticket: string }>().ticket;
}

describe('realtime', () => {
  it('fans events out across instances through Redis Pub/Sub', async () => {
    const socket = await TestSocket.open(a.port, await ticketFor(f.owner));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await socket.next('subscribed');
    const presence = await socket.next('presence.updated');
    expect(presence.payload).toMatchObject({ projectId: f.projectId, users: [{ id: f.owner.id }] });
```

**`tests/integration/realtime.test.ts`** · continue

```ts

    // The write goes through instance B; the socket lives on instance A.
    const created = await b.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${f.projectId}/tasks`,
      headers: f.owner.auth,
      payload: { title: 'Live!' },
    });
    expect(created.statusCode).toBe(201);
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

    const ticket = await ticketFor(f.owner);
    const first = await TestSocket.open(a.port, ticket);
    const reused = new WebSocket(`ws://127.0.0.1:${a.port}/ws?ticket=${ticket}`);
    expect(await closeCode(reused)).toBe(4401);
    first.ws.close();
  });
```

**`tests/integration/realtime.test.ts`** · continue

```ts

  it('refuses subscriptions to projects outside your workspaces', async () => {
    const outsider = await registerUser(ctx, 'Outsider');
    const socket = await TestSocket.open(a.port, await ticketFor(outsider));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    const error = await socket.next('error');
    expect(error.payload).toMatchObject({ code: 'not_found' });
    socket.send({ type: 'nonsense' });
    expect((await socket.next('error')).payload).toMatchObject({ code: 'bad_message' });
    socket.ws.close();
  });

  it('updates presence when a viewer leaves', async () => {
    const other = await registerUser(ctx, 'Other');
    await ctx.infra.db
      .insert(workspaceMembers)
      .values({ workspaceId: f.workspaceId, userId: other.id, role: 'viewer' });
    const watcher = await TestSocket.open(a.port, await ticketFor(f.owner));
    watcher.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('subscribed');

    const leaver = await TestSocket.open(b.port, await ticketFor(other));
    leaver.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 2);

    leaver.ws.close();
    await watcher.next('presence.updated', (e) => (e.payload?.users as unknown[]).length === 1);
    watcher.ws.close();
  });
});
```

**What's new (the test)**
- `startInstance` builds a **second and third Fastify app** from the same infra and services and listens on port `0` (the OS picks a free port), so the test has two API instances sharing one Redis. A socket on instance A receives a task created through instance B.
- HTTP calls in this file use `a.app.inject(...)`; only the WebSockets need a real port.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx vitest run tests/integration/realtime.test.ts
```

Expected: `Tests  4 passed (4)`.

To try it by hand with `npm run dev` running and a user registered (Step 4.7):

```bash
TOKEN=$(curl -s localhost:8002/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
TICKET=$(curl -s -X POST localhost:8002/api/v1/ws/ticket -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).ticket')
npx wscat -c "ws://localhost:8002/ws?ticket=$TICKET"
> {"type":"ping"}
< {"type":"pong","ts":"2026-…Z"}
```

**Commit:** `feat: real-time board updates over WebSockets with Redis pub/sub and presence`

---
## Part 11 · Background jobs & schedules

Emails, due-date reminders and storage cleanup run in a **separate worker process**, fed by the BullMQ queue the services have been writing to since Part 5. The worker doesn't use Fastify at all, which is exactly why `config.ts` and `container.ts` are plain modules.

### Step 11.1 · Mailer and processors

**Goal:** one typed processor per job name: invitation emails, the reminder scan, reminder emails, prefix deletion and stale-upload cleanup.

**Files:** `src/jobs/mailer.ts`, `src/jobs/processors.ts`

```bash
npm i -E nodemailer@10.5.0
npm i -D -E @types/nodemailer@8.0.2
```

- **`nodemailer`** sends email over SMTP (Mailpit locally, any provider in production).

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
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Database } from '../db/client.js';
import { attachments, tasks } from '../db/schema.js';
import type { Storage } from '../infra/storage.js';
import type { Mailer } from './mailer.js';
import type { JobData, JobName, Jobs } from './queue.js';

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

export interface ProcessorDeps {
  db: Database;
  storage: Storage;
  mailer: Mailer;
  jobs: Jobs;
  logger: Logger;
  frontendUrl: string;
}

type Processors = { [N in JobName]: (data: JobData[N]) => Promise<unknown> };

```

**What's new**
- `ProcessorDeps` takes the Drizzle `db` instead of a Prisma client; the mailer, storage and logger are the same as Express's.
- `type Processors = { [N in JobName]: (data: JobData[N]) => Promise<unknown> }` is a **mapped type**: TypeScript requires one processor per job name, with that job's data type.

**`src/jobs/processors.ts`** · continue

```ts
export function createProcessors(deps: ProcessorDeps): Processors {
  const { db, storage, mailer, jobs, logger } = deps;

  return {
    async 'send-invitation-email'({ email, workspaceName, inviterName, token }) {
      const link = `${deps.frontendUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: email,
        subject: `${inviterName} invited you to ${workspaceName} on TaskFlow`,
        text: `${inviterName} invited you to join "${workspaceName}".\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`,
      });
    },

    async 'scan-due-reminders'() {
      // SKIP LOCKED lets several schedulers run at once without blocking each other
      // or claiming the same rows; setting reminder_sent_at is the claim.
      const { rows: claimed } = await db.execute<{ id: string }>(sql`
        UPDATE tasks SET reminder_sent_at = now()
        WHERE id IN (
          SELECT id FROM tasks
          WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
            AND due_at > now() AND due_at <= now() + interval '24 hours'
          ORDER BY due_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING id`);
      for (const { id } of claimed) await jobs.enqueue('send-due-reminder', { taskId: id });
      return { claimed: claimed.length };
    },
```

**`src/jobs/processors.ts`** · continue

```ts

    async 'send-due-reminder'({ taskId }) {
      const task = await db.query.tasks.findFirst({
        where: eq(tasks.id, taskId),
        with: { assignee: true, project: { columns: { key: true, name: true } } },
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
```

**`src/jobs/processors.ts`** · continue

```ts

    async 'cleanup-stale-uploads'() {
      const stale = await db
        .select({ id: attachments.id, storageKey: attachments.storageKey })
        .from(attachments)
        .where(
          and(
            eq(attachments.status, 'pending'),
            lt(attachments.createdAt, new Date(Date.now() - STALE_UPLOAD_MS)),
          ),
        )
        .limit(500);
      for (const a of stale) await storage.deletePrefix(a.storageKey);
      if (stale.length > 0) {
        await db.delete(attachments).where(
          inArray(
            attachments.id,
            stale.map((a) => a.id),
          ),
        );
      }
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

**What's new (Drizzle)**
- **`db.execute<{ id: string }>(sql\`UPDATE … RETURNING id\`)`** runs the claim as one raw statement and types its rows. `FOR UPDATE SKIP LOCKED` inside a subquery has no builder equivalent, so this is a good place for SQL.
- `with: { assignee: true, project: { columns: { key: true, name: true } } }` loads the assignee's full row (we need the email) and two project columns.
- `cleanup-stale-uploads` uses the builder for the select (`lt(attachments.createdAt, cutoff)`) and deletes with `inArray(...)` only when there's something to delete.

> **🧠 DSA & scalability · claiming due reminders with `SKIP LOCKED`**
> - **Data structure:** the partial index `tasks_due_reminder_idx ON tasks (due_at) WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL`: only tasks still owed a reminder, so it stays small.
> - **Algorithm:** one statement selects up to 100 due-soon rows `FOR UPDATE SKIP LOCKED`, sets `reminder_sent_at = now()` (the claim) and returns their ids; each id becomes its own `send-due-reminder` job.
> - **Why `SKIP LOCKED`:** with two workers scanning, plain `FOR UPDATE` makes the second wait and then claim nothing; `SKIP LOCKED` lets it claim other rows, so work splits without duplicates or waiting.
> - **Complexity:** O(log n + 100) per scan, however many reminders were already sent.
> - **Delivery:** a failing email job retries 5 times with backoff, then stays in BullMQ's failed set: at-least-once for the email, at-most-once per claim.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: job processors and mailer`

### Step 11.2 · The worker process

**Goal:** run the processors in their own process, with retries and cron schedules.

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
  db: infra.db,
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

infra.logger.info('taskflow-fastify worker started');

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
- The same worker as Express: it builds the infra with `createInfra`, registers two cron schedules with `upsertJobScheduler` (idempotent, stored in Redis, so several workers never duplicate a tick), and runs up to five jobs at once on its own Redis connection.
- **No Fastify here.** That's the payoff of keeping config, infra and services out of Fastify's plugin system: the worker reuses them without a web server.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: background worker with cron schedules`

### Step 11.3 · Tests

**Goal:** test each processor against real Postgres, S3 and SMTP.

**Files:** `tests/integration/jobs.test.ts`

**`tests/integration/jobs.test.ts`** · new file

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { attachments } from '../../src/db/schema.js';
import { Mailer } from '../../src/jobs/mailer.js';
import { createProcessors } from '../../src/jobs/processors.js';
import { Jobs } from '../../src/jobs/queue.js';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from '../helpers.js';

const ctx = await createTestContext();
const { config } = ctx.infra;
const mailer = new Mailer(config);
const processors = createProcessors({
  db: ctx.infra.db,
  storage: ctx.infra.storage,
  mailer,
  jobs: new Jobs(ctx.infra.queue),
  logger: ctx.infra.logger,
  frontendUrl: config.FRONTEND_URL,
});
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:18002';

interface MailpitMessage {
  Subject: string;
  To: { Address: string }[];
  ID: string;
}
```

**`tests/integration/jobs.test.ts`** · continue

```ts

async function inbox(to: string): Promise<MailpitMessage[]> {
  const res = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await res.json()) as { messages: MailpitMessage[] }).messages;
}

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
```

**`tests/integration/jobs.test.ts`** · continue

```ts

  it('claims each due-soon task exactly once, then emails the assignee', async () => {
    const assignee = await registerUser(ctx, 'Assignee');
    await addMember(ctx, f.workspaceId, assignee, 'member');
    const create = (title: string, dueInHours: number, assigned = true) =>
      send(
        ctx,
        'POST',
        `/api/v1/projects/${f.projectId}/tasks`,
        {
          as: f.owner,
          body: {
            title,
            dueAt: new Date(Date.now() + dueInHours * 3_600_000).toISOString(),
            ...(assigned ? { assigneeId: assignee.id } : {}),
          },
        },
        201,
      );
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
```

**`tests/integration/jobs.test.ts`** · continue

```ts

  it('removes uploads left pending for more than a day', async () => {
    const task = await send(
      ctx,
      'POST',
      `/api/v1/projects/${f.projectId}/tasks`,
      { as: f.owner, body: { title: 'With upload' } },
      201,
    );
    const created = await send(
      ctx,
      'POST',
      `/api/v1/tasks/${task.json<{ id: string }>().id}/attachments`,
      { as: f.owner, body: { fileName: 'old.txt', contentType: 'text/plain', sizeBytes: 3 } },
      201,
    );
    const id = created.json<{ attachment: { id: string } }>().attachment.id;
    await ctx.infra.db
      .update(attachments)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(attachments.id, id));
    expect(await processors['cleanup-stale-uploads']({})).toEqual({ removed: 1 });
    const [remaining] = await ctx.infra.db.select({ n: count() }).from(attachments);
    expect(remaining?.n).toBe(0);
  });
});
```

**What's new**
- The tests call the processors **directly**, not through a running worker, so the job logic is tested deterministically; BullMQ's retry machinery is the library's to test.
- Emails are checked through **Mailpit's HTTP API**: a real SMTP round trip.
- `db.update(attachments).set({ createdAt: … })` back-dates an upload, and `db.select({ n: count() })` counts rows (`count()` is Drizzle's `count(*)` helper).

**✅ Checkpoint**

```bash
npx tsc --noEmit && npm test
```

Expected: `Test Files  14 passed (14)` and `Tests  71 passed (71)`. Then run the worker against your dev data with `npm run dev:worker`: any invitation you created earlier is emailed and shows up at http://localhost:18002.

**Commit:** `feat: background worker for emails, due-date reminders and storage cleanup`

---
## Part 12 · Contract testing with Schemathesis

Our tests check the behaviour we *thought of*. **Schemathesis** reads `contract/openapi.yaml`, generates thousands of requests (valid, edge-case and invalid), and checks every response against the contract. The contract is shared by all six backends, so this is also the test that proves Fastify behaves like Express.

### Step 12.1 · Configuration

**Goal:** configure Schemathesis, run it, and learn from what it found.

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
npm pkg set scripts.test:contract="schemathesis run contract/openapi.yaml --url http://localhost:8002"
```

**What we found the first time we ran it against this repo** (all fixed in the code you've already typed; it's the most useful lesson of this Part, because each one is a place where Fastify's defaults differ from Express's):

| Schemathesis check | What it caught | Fix |
|---|---|---|
| ST204 undeclared method | `TRACE` and `QUERY` returned 404: the first 405 helper only covered the six common methods | Code: build the 405 routes from `app.supportedMethods` (Step 3.4) |
| ST101 server error | `QUERY` without a `Content-Type` was a 500: Fastify rejects it with an error our handler didn't map | Code: raise the 405 in the route's `onRequest` hook, and map any Fastify 4xx by status (`BY_STATUS`) |
| ST202 valid input rejected | A body with a nested `"__proto__"` key got 400: Fastify's prototype-poisoning protection rejects such JSON by default | Code: `onProtoPoisoning: 'remove'` (Step 3.6) |
| ST202 valid input rejected | A move with a random but well-formed `afterColumnId` got 422 | Config: operations whose bodies reference other rows may answer 422 |
| ST202 valid input rejected | A column named `" "` (a non-breaking space) got 422: it's trimmed to an empty string | Config: same block; trimming is a documented rule, and a JSON Schema pattern for "not only whitespace" means different things in Python's and JavaScript's regex engines |

**What's new**
- The second `[[operations]]` block lists the operations by **`operationId`** (from the contract) where a schema-valid body can still be semantically invalid. The expected statuses replace the defaults, so the list repeats `200`/`201`.
- Express's repo carries the same configuration: the same contract and the same rules give the same verdicts.

**✅ Checkpoint**

Start the API with the rate limits raised (a fuzzer sends thousands of requests a minute), get a token, and run it:

```bash
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm run dev
# second terminal:
TOKEN=$(curl -s localhost:8002/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8002 -H "Authorization: Bearer $TOKEN"
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
  ⚠️ Missing test data: 19 operations repeatedly returned 404 responses
Test cases:
  5744 generated, 5744 passed
```

The two warnings are expected: `/auth/refresh` authenticates with a cookie the fuzzer doesn't have, and random UUIDs rarely hit real records.

**Commit:** `test: schemathesis contract test configuration`

---

## Part 13 · Docker

### Step 13.1 · A multi-stage Dockerfile

**Goal:** a small, non-root production image that can also run the migrations.

**Files:** `Dockerfile`, `.dockerignore`

**`Dockerfile`** · new file

```dockerfile
# syntax=docker/dockerfile:1

# ---- base: Debian slim (glibc, so argon2's prebuilt binary loads) ----
FROM node:24.22.2-slim AS base
WORKDIR /app

# ---- deps: every dependency, dev tools included, to compile ----
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile TypeScript to dist/ ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: compiled code + migrations; `node dist/migrate.js` applies them ----
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node package.json ./
USER node
EXPOSE 8000
CMD ["node", "dist/main.js"]
```

**`.dockerignore`** · new file

```gitignore
node_modules
dist
coverage
.env
.env.*
!.env.example
.git
.github
tests
*.md
```

**What's new (vs. Express)**
- **Simpler than Express's.** No OpenSSL in the base (that was for Prisma's schema engine), no `--omit=optional` trick (that was for Prisma's optional CLI peer), and **one image for everything**: the runtime stage includes `drizzle/`, and `node dist/migrate.js` applies migrations with `drizzle-orm` alone. Express needed its `deps` stage for `migrate`, because only it had the Prisma CLI.
- Same principles as before: multi-stage (the compiler and dev dependencies never ship), dependencies installed before the sources are copied (editing a `.ts` file doesn't re-run `npm ci`), and `USER node`.
- `npm ci --omit=dev` still honours `allowScripts` from `package.json`: argon2's compile step is skipped and its prebuilt Linux binary is used.

**✅ Checkpoint**

```bash
docker build -t taskflow-fastify . && docker run --rm taskflow-fastify id
```

Expected: the build finishes, and `id` prints `uid=1000(node) gid=1000(node)`.

**Commit:** `build: multi-stage dockerfile`

### Step 13.2 · App services in compose

**Goal:** run migrations, the API and the worker as containers next to the infrastructure.

**Files:** `docker-compose.yml`

The shared environment for the app containers: in-network hostnames (`postgres`, `redis`, `rustfs`, `mailpit`), while `S3_PUBLIC_ENDPOINT` stays `localhost` because browsers use it.

**`docker-compose.yml`** · add after `name: taskflow-fastify`

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
  S3_PUBLIC_ENDPOINT: http://localhost:19002
  S3_REGION: us-east-1
  S3_BUCKET: taskflow-attachments
  S3_ACCESS_KEY: taskflow
  S3_SECRET_KEY: taskflow-secret
  SMTP_HOST: mailpit
  SMTP_PORT: '1025'
  MAIL_FROM: TaskFlow <no-reply@taskflow.local>
  LOG_LEVEL: info

```

**`docker-compose.yml`** · add before the top-level `volumes:` block at the end of the file

```yaml
  migrate:
    profiles: ['app']
    build: .
    command: ['node', 'dist/migrate.js']
    environment: *app-env
    depends_on:
      postgres:
        condition: service_healthy

  api:
    profiles: ['app']
    build: .
    environment: *app-env
    ports:
      - '8002:8000'
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
- The same `x-app-env` anchor and `app` profile as Express. The difference is in `migrate`: it uses the **same image** as `api` and `worker` (`build: .`) and runs `node dist/migrate.js`.
- `api` and `worker` wait for `migrate` to finish (`service_completed_successfully`), so the app never starts against an unmigrated database.

**✅ Checkpoint**

```bash
docker compose --profile app up -d --build
docker compose --profile app ps --format 'table {{.Service}}\t{{.Status}}' -a
curl -s localhost:8002/health/ready
docker compose logs migrate
```

Expected: `api` is `Up … (healthy)`, `worker` is `Up`, `migrate` and `s3-init` are `Exited (0)`, readiness returns `{"status":"ok",…}`, and the migrate log ends with `migrations applied`. `docker image ls taskflow-fastify-api` shows about 450 MB, roughly 85 MB less than Express's. Stop `npm run dev` first: both use port 8000.

**Commit:** `build: compose app profile with migrate, api and worker`

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
```

**`.github/workflows/ci.yml`** · continue

```yaml

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
      - name: Fail if src/db/schema.ts and the migrations disagree (drift)
        run: npm run db:drift
      - name: Apply migrations to an empty database
        run: npm run db:migrate
      - run: npm run test:coverage
      - uses: actions/upload-artifact@v7
        if: always()
        with:
          name: coverage
          path: coverage/
          retention-days: 14

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
      - run: npm run build
      - run: node dist/migrate.js
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

**What's new (vs. Express)**
- The workflow is Express's with two changes: the **drift check** runs `npm run db:drift`, which compares `schema.ts` with the migration snapshots and needs no database; and migrations run through **`npm run db:migrate`** in the test job and **`node dist/migrate.js`** in the contract job, the same file production uses.
- Reminder of the shape: `quality` and `test` run in parallel; `contract` builds and starts the real API against service containers and fuzzes it; `docker` runs only if all three pass, and pushes to `ghcr.io/<owner>/taskflow-fastify` only for pushes to `main`. CI's service containers publish the default ports (5432, 6379): a fresh runner has nothing to clash with.

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml
```

Expected: no output (exit code 0).

**Commit:** `ci: lint, test, drift check, contract test and docker image`

### Step 14.2 · CodeQL and Dependabot

**Goal:** security scanning and automated dependency updates.

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
      fastify:
        patterns: ['fastify', '@fastify/*']
      drizzle:
        patterns: ['drizzle-orm', 'drizzle-kit']
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
- Dependabot **groups** `fastify` with every `@fastify/*` plugin, and `drizzle-orm` with `drizzle-kit`: those families are released together and should be upgraded together. TypeScript majors stay ignored until typescript-eslint supports 7.

**✅ Checkpoint**

```bash
docker run --rm -v "$PWD":/repo -w /repo rhysd/actionlint:latest .github/workflows/ci.yml .github/workflows/codeql.yml
```

Expected: no output. Then commit and push, and watch the run under the repo's **Actions** tab: four green jobs on `main`, and a new package under **Packages**.

**Commit:** `ci: codeql and dependabot`

### Step 14.3 · Branch protection checklist

**Goal:** make CI a gate: nothing reaches `main` without green checks.

**Files:** none (GitHub settings)

In GitHub → **Settings → Branches → Add branch ruleset** for `main`:

- [ ] **Require a pull request before merging** (0 approvals is fine while you work alone)
- [ ] **Require status checks to pass:** `Lint, format & typecheck`, `Tests, migrations & coverage`, `Contract test (Schemathesis)`, `Docker image`, `analyze` (CodeQL)
- [ ] **Require branches to be up to date before merging**
- [ ] **Block force pushes** and **restrict deletions**
- [ ] **Require linear history**

**✅ Checkpoint**

```bash
git push origin HEAD:main   # from a local commit, without a PR
```

Expected: `! [remote rejected] … (push declined due to repository rule violations)`.

**Commit:** nothing new to commit in this step.

---

## Part 15 · Full stack & where to go next

### Step 15.1 · Run everything

**Goal:** run the whole stack and know where everything lives.

**Files:** none

```bash
docker compose --profile app up -d --build
npm run test:coverage                     # against the infra, from your machine
```

| URL | What |
|---|---|
| http://localhost:8002/health/ready | API readiness |
| http://localhost:8002/docs | Swagger UI (only when `NODE_ENV` isn't `production`, so use `npm run dev` for this one) |
| http://localhost:18002 | Mailpit: invitation and reminder emails |
| http://localhost:19102 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI:** host `localhost`, port `15402`, database/user/password `taskflow`. Or run `npx drizzle-kit studio` for Drizzle's own table browser.

**✅ Checkpoint**

```bash
curl -s localhost:8002/health/ready
```

Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

**Commit:** nothing new to commit in this step.

### Step 15.2 · Connect the frontend

**Goal:** run the React frontend against this API, unchanged.

**Files:** none

`taskflow-frontend-node` works with all three Node backends: they implement one contract. With this repo's stack running (`--profile app`), start the frontend from its folder (`npm run dev`, http://localhost:5173) and use it as before. Its Playwright suite passes against this backend too: see that repo's STEPS.md, Part 11, and use the network `taskflow-fastify_default`.

**✅ Checkpoint**

```bash
curl -si -X OPTIONS localhost:8002/api/v1/workspaces -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -iE '^HTTP|allow-origin|allow-credentials'
```

Expected: `HTTP/1.1 204 No Content`, `access-control-allow-origin: http://localhost:5173` and `access-control-allow-credentials: true`.

**Commit:** nothing new to commit in this step.

### Step 15.3 · Where to go next

**Goal:** stretch what you built, and compare it with Express.

**Files:** yours to choose

1. **Generate the contract from the routes.** Switch `@fastify/swagger` to `dynamic` mode and diff its output against `contract/openapi.yaml`. Every difference is either a missing schema detail or a contract bug.
2. **Optimistic concurrency.** Add a `version` column to tasks, require `If-Match`, and return 412 on a stale write. Drizzle's `update(...).where(and(eq(id), eq(version, v))).returning()` tells you whether you won.
3. **Fastify-native DI.** Replace `container.ts` with plugins that `decorate` the instance (`app.db`, `app.redis`) and read them inside route plugins. Note what gets easier, and what gets harder for the worker.
4. **Measure the serializer.** Benchmark the board endpoint with and without its response schema (`autocannon` makes this a one-liner).
5. **Compare.** Put Step 3.6 of this guide next to Step 3.6 of Express's: plugin tree versus middleware order. `COMPARISON.md` collects these side by side.

**✅ Checkpoint**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: everything still green after each exercise.

**Commit:** nothing new to commit in this step.
