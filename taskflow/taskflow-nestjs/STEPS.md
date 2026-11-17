# STEPS · Rebuild `taskflow-nestjs` from an empty folder

You'll build the **TaskFlow API** (a Jira/Trello-lite backend) with **NestJS 12, TypeORM, PostgreSQL 18 and Redis**, by hand, one small step at a time. At the end your repo behaves exactly like this one: the same endpoints, the same 82 tests, the same CI.

This is the **third** of six TaskFlow backends, and the last one in TypeScript. You built `taskflow-express` and `taskflow-fastify`; this guide keeps their Part and Step numbers, so Step 7.2 here and Step 7.2 there do the same job. It spends its words on what **changes**:

1. **NestJS's model.** Express and Fastify gave you functions and left the structure to you. Nest gives you the structure: **modules** group related classes, a **dependency-injection container** creates those classes and hands each one what its constructor asks for, and **decorators** (`@Controller()`, `@Get()`, `@Injectable()`) attach metadata that the framework reads to wire everything up. You stop calling the framework; it calls you.
2. **TypeORM instead of Drizzle.** Tables are **classes with decorators** ("entities"), and you query through repositories or a query builder.
3. **The data structures and algorithms** stay the same. Every non-trivial feature still gets its 🧠 box, shorter where the idea is unchanged.

> **Why this repo matters for what comes next.** NestJS is deliberately modelled on Spring (via Angular). `@Module` ↔ `@Configuration`, `@Injectable()` ↔ `@Service`/`@Component`, constructor injection ↔ constructor injection, `@Controller`/`@Get` ↔ `@RestController`/`@GetMapping`, guards ↔ Spring Security filters, pipes ↔ Bean Validation, exception filters ↔ `@ControllerAdvice`, TypeORM entities ↔ JPA entities. Learn the ideas here in a language you know, and Spring Boot will read like a translation. This guide points out each parallel as it appears (look for **☕ Spring**).

> **Design docs you'll want open:** [`../README.md`](../README.md) (the TaskFlow design: data model, RBAC, auth, real-time protocol, Redis keys) and [`contract/openapi.yaml`](contract/openapi.yaml) (the API). This guide implements them; it doesn't repeat them.

## What you'll build

```mermaid
flowchart LR
    Client["HTTP / WebSocket client"] --> API
    subgraph Nest["taskflow-nestjs"]
        API["main.ts<br/>AppModule: controllers + gateway"]
        Worker["worker.ts<br/>WorkerModule: BullMQ processor"]
    end
    API --> PG[("PostgreSQL 18<br/>TypeORM")]
    API --> R[("Redis 8<br/>tokens · cache · limits ·<br/>presence · pub/sub · queue")]
    API --> S3[("RustFS<br/>S3 API")]
    Worker --> PG
    Worker --> R
    Worker --> S3
    Worker --> Mail["Mailpit<br/>SMTP"]
```

**Inside the API process**, a request passes Nest's lifecycle. Each box is a kind of class you'll write:

```mermaid
flowchart LR
    A["middleware<br/>request id · CORS ·<br/>415 · JSON body"] --> B["guards<br/>JwtAuthGuard →<br/>RateLimitGuard"]
    B --> C["pipes<br/>validate + build DTOs<br/>(class-validator)"]
    C --> D["controller<br/>(*.controller.ts)"]
    D --> E["service<br/>RBAC, rules,<br/>transactions"]
    E --> F["TypeORM"]
    D -. throw .-> G["exception filter<br/>→ problem+json"]
    E -. after commit .-> X["cache · pub/sub · jobs"]
```

## Prerequisites

| Tool | Version used | Check |
|---|---|---|
| Node.js | 24 (npm 11.17+) | `node -v && npm -v` |
| Docker + Compose | Compose v5 | `docker compose version` |
| uv (for the contract test) | 0.12+ | `uv --version` |
| A GitHub account | | |

You've finished `taskflow-express` and `taskflow-fastify` (or at least read their guides). Where a file here is the same as there, this guide still shows all of it, so the repo stands on its own, but explains only what's new.

## The finished repo

```text
taskflow-nestjs/
├── .github/              dependabot.yml, workflows/ci.yml, workflows/codeql.yml
├── contract/             openapi.yaml (copy of the master contract)
├── src/
│   ├── main.ts           starts the HTTP server
│   ├── worker.ts         starts the worker (a Nest app without HTTP)
│   ├── migrate.ts        applies migrations (production runs it with plain node)
│   ├── app.module.ts     the API's root module: feature modules + global filter, pipe, guards
│   ├── worker.module.ts  the worker's root module
│   ├── core.module.ts    config, logging, Postgres, Redis: shared by both processes
│   ├── app.setup.ts      middleware, CORS, body parser, WebSocket adapter
│   ├── docs.ts           Swagger document and UI
│   ├── config/           typed, validated environment
│   ├── database/         entities, naming strategy, data source, migrations
│   ├── common/           problem errors, exception filter, 405, validation, rate limiting,
│   │                     cursors, fractional indexing
│   ├── infra/            Redis module, S3 storage, logger options
│   ├── jobs/             queue facade, job handlers, BullMQ processor, mailer
│   ├── modules/          one folder per feature: module + controller → service, DTOs
│   └── types/            Express type augmentation
├── test/                 *.e2e-spec.ts (real Postgres, Redis, S3, SMTP)
├── docker-compose.yml    local infra (+ the app under the "app" profile)
├── Dockerfile            multi-stage, non-root
├── nest-cli.json         Nest CLI build settings
└── schemathesis.toml     contract-test settings
```

**Parts:** 0 Repo setup · 1 Infrastructure & config · 2 Database · 3 HTTP foundations · 4 Authentication · 5 Workspaces & RBAC · 6 Projects, columns & ordering · 7 Tasks · 8 Comments, activity & search · 9 Attachments · 10 Real-time · 11 Background jobs · 12 Contract testing · 13 Docker · 14 CI/CD · 15 Full stack & next steps

**How to read the code blocks:** each block says which file it belongs to and where it goes: **new file**, **continue** (append to the end of the file), **add after `<line>`** (insert the block right below that existing line), **add before `<line>`**, or **add at the top**. Type them in that order and your files will match the repo exactly. A file introduced as **new file** and then continued in the same step is one file typed top to bottom; it's split only where a later Part will insert lines.

---
## Part 0 · Repo setup

### Step 0.1 · Create the repo

**Goal:** an empty git repository with the npm project file.

**Files:** `package.json`

```bash
mkdir taskflow-nestjs && cd taskflow-nestjs
git init -b main
npm init -y
npm pkg set name=taskflow-nestjs version=1.0.0 description="TaskFlow API: NestJS 12 + TypeORM + PostgreSQL + Redis"
npm pkg set private=true --json
npm pkg set license=MIT type=module engines.node=">=24"
npm pkg delete main keywords author scripts.test
```

**What's new**
- **Why not `nest new`?** The Nest CLI can scaffold a project, but it writes a demo controller and service you'd delete, its own lint setup, and (in Nest 12) a CommonJS-or-ESM choice. Building by hand means every file in the repo is one you typed and understand. You'll still use the CLI to **build** and **run** (Step 0.4).
- Same ESM setup as Express and Fastify: `"type": "module"`, and imports name the compiled file (`'./env.js'` for `env.ts`). **Nest 12 is ESM-only**, so this isn't optional any more.

**✅ Checkpoint**

```bash
npm pkg get name type
```

Expected: `"name": "taskflow-nestjs"` and `"type": "module"`.

**Commit:** `chore: initialise npm package`

### Step 0.2 · TypeScript, with decorators switched on

**Goal:** the strict TypeScript setup from the other two repos, plus the two compiler options Nest is built on.

**Files:** `tsconfig.json`, `tsconfig.build.json`

```bash
npm i -D -E typescript@6.0.3 @types/node@26.6.6
```

- **`typescript` 6.0.3, not 7**, because `typescript-eslint` supports only `<6.1` so far. `-E` pins the exact version.
- No `tsx` this time: Nest's CLI compiles and runs the app (Step 0.4), and Vitest compiles tests itself.

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
    "strictPropertyInitialization": false,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test", "vitest.config.ts", "eslint.config.js"]
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
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

**What's new (TS → NestJS)**
- **`experimentalDecorators: true`** turns on the decorator syntax Nest uses: `@Controller()`, `@Injectable()`, `@Column()`. A decorator is a function that runs **once, when the class is defined**, and receives the class (or method, or property) it's attached to. Nest's decorators don't change your code; they **record metadata** about it ("this class is a controller for `/health`") that the framework reads later. These are the "legacy" TypeScript decorators, which Nest, TypeORM and class-validator are written for; the newer TC39 decorators are a different, incompatible design.
- **`emitDecoratorMetadata: true`** makes the compiler write down **the types TypeScript knows**, for every decorated class: for a constructor `constructor(private users: UsersService)`, it emits `design:paramtypes = [UsersService]`. That's how Nest's **dependency injection** knows what to pass to a constructor without you listing it anywhere: the parameter's type *is* the request. Types normally vanish at compile time; this option keeps the ones attached to decorated classes. (☕ Spring reads the same information from Java bytecode, which keeps types at run time anyway.)
- **`strictPropertyInitialization: false`**: entity and DTO classes declare fields like `email: string;` that TypeORM or the validation pipe fills in, never a constructor. With the check on, every such field would need a `!`.
- `include` lists `test`, `vitest.config.ts` and `eslint.config.js` so the type checker and the type-aware linter see them too. `tsconfig.build.json` compiles only `src/` (minus unit tests) into `dist/`.

**✅ Checkpoint**

```bash
npx tsc --version
```

Expected: `Version 6.0.3`.

**Commit:** `chore: add strict typescript config with decorator metadata`

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
      // A Nest module is an empty class that exists only to carry its @Module() decorator.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      // DTO classes describe shapes (for validation and Swagger); the values are plain objects,
      // so spreading one loses nothing.
      '@typescript-eslint/no-misused-spread': 'off',
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
dist/
coverage/
src/database/migrations/*-*.ts
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

**What's new (vs. Fastify)**
- **`require-await` is back on.** Fastify plugins had to be `async`; Nest methods are `async` only when they await something.
- **`no-extraneous-class` with `allowWithDecorator`.** A Nest **module** is a class with no body: `@Module({...}) export class UsersModule {}`. The class exists only to carry its decorator's metadata, which a linter would normally call pointless. With `allowWithDecorator`, a decorated empty class is fine.
- **`no-misused-spread` off.** DTOs (data transfer objects) are classes here, because decorators need a class to attach to, but the values you handle are plain objects, so `{ ...dto }` is an ordinary object spread.
- `.prettierignore` lists `src/database/migrations/*-*.ts`: the TypeORM CLI generates those (Part 2) in its own style (four-space indents, double quotes), and reformatting generated files makes them harder to compare with a fresh generation.

**✅ Checkpoint**

```bash
npx eslint --version && npx prettier --version
```

Expected: `v10.14.0` and `3.10.0`.

**Commit:** `chore: add eslint, prettier, editorconfig and gitignore`

### Step 0.4 · The Nest CLI and npm scripts

**Goal:** the CLI that compiles and runs the app, and the scripts you'll use every day.

**Files:** `nest-cli.json`, `package.json`

```bash
npm i -D -E @nestjs/cli@12.0.12 @nestjs/schematics@12.0.13
```

- **`@nestjs/cli`** gives you `nest build` (compile with `tsc`, plus Nest's compiler plugins) and `nest start --watch` (rebuild and restart on every save, like `tsx watch`). **`@nestjs/schematics`** holds the code generators behind `nest generate`; we write files by hand, but the CLI expects the collection to exist.

**`nest-cli.json`** · new file

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true,
```

**`nest-cli.json`** · continue

```json
    "tsConfigPath": "tsconfig.build.json"
  }
}
```

```bash
npm pkg set scripts.dev="nest start --watch" \
  scripts.build="nest build" \
  scripts.start="node dist/main.js" \
  scripts.typecheck="tsc --noEmit" \
  scripts.lint="eslint ." \
  scripts.format="prettier --write ." \
  scripts.format:check="prettier --check ." \
  scripts.test="vitest run" \
  scripts.test:unit="vitest run src" \
  scripts.test:e2e="vitest run test" \
  scripts.test:coverage="vitest run --coverage"
npm approve-scripts --allow-scripts-pending
```

**What's new**
- `nest-cli.json` tells the CLI where the source lives (`sourceRoot`), to empty `dist/` before each build (`deleteOutDir`), and to compile with `tsconfig.build.json`. `nest start` runs `dist/main.js` by default; Part 11 adds a second entry point with `--entryFile`.
- **Two kinds of tests** this time: unit tests sit next to the code (`src/**/*.spec.ts`, Nest's convention), integration tests in `test/` (`*.e2e-spec.ts`, "end to end" in Nest's vocabulary).
- npm 11.17+ holds back dependencies' install scripts until you approve them; nothing is pending yet. The decisions live in `package.json` under `allowScripts`, so CI and Docker make the same ones.

**✅ Checkpoint**

```bash
npx nest --version
```

Expected: `12.0.12`.

**Commit:** `chore: scaffold TypeScript project with the Nest CLI, ESLint and Prettier`

### Step 0.5 · Push to GitHub

**Goal:** the repo exists on GitHub so CI can run later.

**Files:** none (GitHub only)

```bash
gh repo create taskflow-nestjs --private --source=. --remote=origin --push
```

(Without the GitHub CLI: create an empty repo on github.com, then `git remote add origin git@github.com:<you>/taskflow-nestjs.git && git push -u origin main`.)

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
name: taskflow-nestjs
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
      - '15403:5432'
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
      - '16303:6379'
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
      - '19003:9000'
      - '19103:9001'
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
      - '11003:1025'
      - '18003:8025'
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
- The Fastify stack with a new project name and slot. **`name: taskflow-nestjs`** gives this repo its own containers, network and **volumes** (`taskflow-nestjs_postgres-data`), so it starts with an empty database. **Host ports end in `03`**, NestJS's slot: Postgres **15403**, Redis **16303**, S3 **19003** (console 19103), SMTP **11003** (Mailpit UI 18003), API **8003**. All three Node stacks can run at once.
- Inside the compose network every service keeps its default port (5432, 6379, 9000, 1025). `s3-init` creates the bucket and its CORS rules, then exits.

**✅ Checkpoint**

```bash
docker compose up -d
docker compose ps --format 'table {{.Service}}\t{{.Status}}' -a
```

Expected: `postgres`, `redis`, `rustfs` and `mailpit` are `Up … (healthy)`, and `s3-init` is `Exited (0)`.

**Commit:** `chore: docker compose for postgres, redis, rustfs and mailpit`

### Step 1.2 · Typed configuration with class-validator

**Goal:** read every environment variable once, convert and validate it, and fail at startup with a readable list of problems, using the validation library the whole Nest app will use.

**Files:** `.env.example`, `src/config/env.ts`, `vitest.config.ts`, `src/config/env.spec.ts`

```bash
npm i -E class-validator@0.15.1 class-transformer@0.5.1 reflect-metadata@0.2.2
npm i -D -E vitest@5.1.0
```

- **`class-validator`** validates objects against **decorators on a class** (`@IsInt()`, `@MinLength(32)`). It's Nest's default validation library, and you'll use it for every request body from Part 3 on, so config uses it too. (zod and TypeBox described data with values; class-validator describes it with a class.)
- **`class-transformer`** turns a plain object into an **instance** of that class (`plainToInstance`), converting values on the way. Validation decorators only work on instances.
- **`reflect-metadata`** is the polyfill that stores the metadata decorators record (`Reflect.defineMetadata` / `Reflect.getMetadata`). It's a proposal JavaScript never adopted, so a library provides it.

**`.env.example`** · new file

```bash
# Copy to .env for local development: cp .env.example .env
# Every value below matches docker-compose.yml, so `docker compose up -d` + `npm run dev` just works.

NODE_ENV=development
PORT=8003
LOG_LEVEL=info

# PostgreSQL 18 (compose service "postgres")
DATABASE_URL=postgresql://taskflow:taskflow@localhost:15403/taskflow

# Redis (compose service "redis"): refresh tokens, cache, rate limits, presence, pub/sub, job queue
REDIS_URL=redis://localhost:16303/0

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
S3_ENDPOINT=http://localhost:19003
S3_PUBLIC_ENDPOINT=http://localhost:19003
S3_REGION=us-east-1
S3_BUCKET=taskflow-attachments
S3_ACCESS_KEY=taskflow
S3_SECRET_KEY=taskflow-secret

# Sliding-window limits (requests per minute). The contract test raises these.
RATE_LIMIT_AUTH_PER_MINUTE=10
RATE_LIMIT_API_PER_MINUTE=300

# Email via Mailpit (web UI: http://localhost:18003)
SMTP_HOST=localhost
SMTP_PORT=11003
MAIL_FROM=TaskFlow <no-reply@taskflow.local>
```

**`src/config/env.ts`** · new file

```ts
import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const Url = (...protocols: string[]) =>
  IsUrl({ protocols, require_protocol: true, require_tld: false });

/**
 * Every environment variable the app reads. A field initializer is the default;
 * a field without one is required.
 */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsInt()
  @Min(1)
  PORT: number = 8000;

  @Url('postgresql', 'postgres')
  DATABASE_URL: string;

  @Url('redis', 'rediss')
  REDIS_URL: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET: string;

  @IsInt()
  @Min(1)
  ACCESS_TOKEN_TTL_SECONDS: number = 900;

  @IsInt()
  @Min(1)
  REFRESH_TOKEN_TTL_SECONDS: number = 604_800;

```

**`src/config/env.ts`** · continue

```ts
  // Implicit conversion calls Boolean("false"), which is true. Read the original text instead.
  @Transform(({ obj }: { obj: Record<string, unknown> }) =>
    typeof obj.COOKIE_SECURE === 'string' ? obj.COOKIE_SECURE === 'true' : obj.COOKIE_SECURE,
  )
  @IsBoolean()
  COOKIE_SECURE: boolean = true;

  @Url('http', 'https')
  FRONTEND_URL: string = 'http://localhost:5173';

  @Url('http', 'https')
  S3_ENDPOINT: string;

  @Url('http', 'https')
  S3_PUBLIC_ENDPOINT: string;

  @IsString()
  S3_REGION: string = 'us-east-1';

  @IsString()
  @MinLength(3)
  S3_BUCKET: string;

  @IsString()
  @MinLength(1)
  S3_ACCESS_KEY: string;

  @IsString()
  @MinLength(1)
  S3_SECRET_KEY: string;

  @IsString()
  SMTP_HOST: string = 'localhost';

  @IsInt()
  @Min(1)
  SMTP_PORT: number = 1025;

  @IsString()
  MAIL_FROM: string = 'TaskFlow <no-reply@taskflow.local>';

  @IsInt()
  @Min(1)
  RATE_LIMIT_AUTH_PER_MINUTE: number = 10;

  @IsInt()
  @Min(1)
  RATE_LIMIT_API_PER_MINUTE: number = 300;

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';
}
```

**What's new (TS → class-validator)**
- **The class is the schema.** Each property is one variable; the decorators above it are its rules; its TypeScript type is its static type. **A field initializer is the default** (`PORT: number = 8000`), and a field without one is required. Compared with zod: `z.number().int().min(1).default(8000)` became three decorators and an initializer.
- Decorators **stack bottom-up but read top-down**: `@IsInt() @Min(1)` means "an integer, at least 1".
- `const Url = (...protocols) => IsUrl({...})` is a **decorator factory of your own**: a function returning a configured decorator. `@Url('postgresql', 'postgres')` reads better than repeating the options six times.
- **`@Transform` for booleans.** Implicit conversion (next block) uses the property's TypeScript type, and converting `"false"` to a `boolean` calls `Boolean("false")`, which is `true`. The transform reads the original text from `obj` instead.

**`src/config/env.ts`** · continue

```ts

/**
 * The `validate` hook of ConfigModule: text from the environment in, a typed Env out.
 * Convert ("900" → 900) → drop unknown variables (whitelist) → check every rule.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: true });
  const errors = validateSync(env, { whitelist: true });
  if (errors.length > 0) {
    const problems = errors
      .map((e) => `  ${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return env;
}
```

**What's new**
- **`plainToInstance(Env, raw, { enableImplicitConversion: true })`** builds an `Env` from `process.env`, converting each string to the type the property was **declared** with. That's `emitDecoratorMetadata` at work: the compiler recorded `PORT`'s type as `Number`, and class-transformer reads it back.
- **`validateSync(env, { whitelist: true })`** checks every rule and removes properties without a decorator, so the result holds exactly our 21 variables, not the hundreds in `process.env`. It returns **all** errors at once.
- The function's shape (`raw → Env`, throw on error) is what `@nestjs/config` expects from a `validate` hook; Part 3 plugs it in.

**`vitest.config.ts`** · new file

```ts
import { defineConfig } from 'vitest/config';
```

**`vitest.config.ts`** · continue

```ts

export default defineConfig({
  test: {
```

**`vitest.config.ts`** · continue

```ts
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
```

**`vitest.config.ts`** · continue

```ts
    // Decorators store their metadata through this polyfill; Nest loads it in the app,
    // and unit tests that never import Nest need it too.
    setupFiles: ['reflect-metadata'],
```

**`vitest.config.ts`** · continue

```ts
  },
});
```

**`src/config/env.spec.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.js';

const required = {
  DATABASE_URL: 'postgresql://taskflow:taskflow@localhost:15403/taskflow',
  REDIS_URL: 'redis://localhost:16303/0',
  JWT_SECRET: 'x'.repeat(32),
  S3_ENDPOINT: 'http://rustfs:9000',
  S3_PUBLIC_ENDPOINT: 'http://localhost:19003',
  S3_BUCKET: 'taskflow-attachments',
  S3_ACCESS_KEY: 'taskflow',
  S3_SECRET_KEY: 'taskflow-secret',
};

describe('validateEnv', () => {
  it('applies defaults, converts text and drops unrelated variables', () => {
    const env = validateEnv({ ...required, PORT: '8003', COOKIE_SECURE: 'false', PATH: '/bin' });
    expect(env).toMatchObject({ PORT: 8003, COOKIE_SECURE: false, NODE_ENV: 'development' });
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(env).not.toHaveProperty('PATH');
  });

  it('names every invalid or missing variable', () => {
    const run = () => validateEnv({ ...required, JWT_SECRET: 'short', REDIS_URL: undefined });
    expect(run).toThrow(/Invalid environment configuration/);
    expect(run).toThrow(/JWT_SECRET/);
    expect(run).toThrow(/REDIS_URL/);
  });
});
```

**What's new**
- **`setupFiles: ['reflect-metadata']`** loads the polyfill before every test file. The app will import it through Nest; a unit test that imports only `env.ts` needs it too, because `plainToInstance` asks `Reflect.getMetadata` for the declared types.
- `include` already lists the integration tests Part 3 adds.

**✅ Checkpoint**

```bash
cp .env.example .env
npx vitest run src/config
```

Expected:

```text
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

**Commit:** `chore: docker compose infrastructure and typed config`

---

## Part 2 · Database schema & migrations

The data model is designed in the TaskFlow README (§4): the same reference schema Prisma and Drizzle produced. Here **TypeORM** produces it, from classes.

### Step 2.1 · TypeORM, a naming strategy and column helpers

**Goal:** the ORM, and the two pieces every entity uses: Postgres-style names and shared column definitions.

**Files:** `src/database/naming-strategy.ts`, `src/database/entities/columns.ts`

```bash
npm i -E typeorm@1.1.2 pg@8.23.1
npm i -D -E @types/pg@8.23.1
```

- **`typeorm`** is the ORM NestJS documents first, and the oldest of our three TS ORMs. It follows the **Data Mapper** pattern of Java's Hibernate: a table is a **class with decorators** (an *entity*), and you load and save instances through a **repository**. It ships its own CLI for migrations. TypeORM 1.x needs PostgreSQL's driver, **`pg`**, installed alongside.

**`src/database/naming-strategy.ts`** · new file

```ts
import { DefaultNamingStrategy, type NamingStrategyInterface, type Table } from 'typeorm';

const snake = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
const nameOf = (table: Table | string) => (typeof table === 'string' ? table : table.name);

/**
 * TypeORM's defaults are camelCase columns and hashed constraint names (PK_cace4a159ff9f2512dd4).
 * This gives the names a Postgres developer expects: snake_case columns, users_pkey, tasks_column_id_fkey.
 */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override columnName(propertyName: string, customName: string | undefined): string {
    return customName ?? snake(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return snake(`${relationName}_${referencedColumnName}`);
  }

  override primaryKeyName(table: Table | string): string {
    return `${nameOf(table)}_pkey`;
  }

  override foreignKeyName(table: Table | string, columnNames: string[]): string {
    return `${nameOf(table)}_${columnNames.join('_')}_fkey`;
  }
}
```

**What's new**
- **A naming strategy** is TypeORM's hook for every generated name. Its defaults are `createdAt` as the column name and hashes like `PK_cace4a159ff9f2512dd4` for constraints. We override four methods so a property `passwordHash` becomes column `password_hash`, and constraints are named the way Postgres would (`users_pkey`, `tasks_column_id_fkey`), the same names the Express and Fastify databases have.
- **`override`** is required by `noImplicitOverride` when a method replaces the parent's: a typo in a method name becomes a compile error instead of a silently unused method.

**`src/database/entities/columns.ts`** · new file

```ts
import { CreateDateColumn, PrimaryColumn, UpdateDateColumn, type ValueTransformer } from 'typeorm';

/** `id uuid PRIMARY KEY DEFAULT uuidv7()`: Postgres 18 generates time-sortable ids itself. */
export const Id = () => PrimaryColumn('uuid', { default: () => 'uuidv7()' });

export const CreatedAt = () => CreateDateColumn({ type: 'timestamptz' });
export const UpdatedAt = () => UpdateDateColumn({ type: 'timestamptz' });

/** node-postgres returns bigint as a string (it can exceed 2^53); file sizes never do. */
export const bigintAsNumber: ValueTransformer = {
  to: (value: number) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
```

**What's new**
- **Decorator factories again.** `PrimaryColumn('uuid', {...})` returns a property decorator; `Id = () => PrimaryColumn(...)` wraps it so every entity writes just `@Id()`. `default: () => 'uuidv7()'` (a function returning SQL) means "this is an SQL expression, not a string literal": Postgres 18 generates the UUIDv7.
- **`CreateDateColumn` / `UpdateDateColumn`** are TypeORM's timestamps: `DEFAULT now()`, and TypeORM sets `updated_at` on every `save()` / `update()`.
- **A `ValueTransformer`** converts between the database and the entity. node-postgres returns `bigint` as a **string** (it can exceed `Number.MAX_SAFE_INTEGER`); file sizes are capped at 25 MB, so `Number(value)` is safe.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output (no errors).

**Commit:** `chore: typeorm with snake_case naming and column helpers`

### Step 2.2 · Roles and the first entities

**Goal:** the role list, and the `users`, `workspaces` and `workspace_members` tables as entity classes.

**Files:** `src/modules/access/roles.ts`, `src/database/entities/user.entity.ts`, `src/database/entities/workspace.entity.ts`, `src/database/entities/workspace-member.entity.ts`

**`src/modules/access/roles.ts`** · new file

```ts
export const ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const INVITABLE_ROLES = ['admin', 'member', 'viewer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

const RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export function atLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}
```

**What's new**
- `as const` + `(typeof ROLES)[number]` derives the union type `'owner' | 'admin' | 'member' | 'viewer'` from the array, so the list and the type can't drift. `atLeast` compares roles by rank (Part 5 uses it for every permission check).

**`src/database/entities/user.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';

@Entity('users')
@Index('users_email_key', ['email'], { unique: true })
@Check('users_email_check', 'email = lower(email)')
export class User {
  @Id()
  id: string;

  @Column('text')
  email: string;

  // select: false keeps the hash out of every query that doesn't ask for it by name.
  @Column('text', { select: false })
  passwordHash: string;

  @Column('text')
  displayName: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**What's new (TypeORM entities)**
- **`@Entity('users')`** declares the class as a table. Class-level decorators add constraints: `@Index(name, columns, { unique: true })` and `@Check(name, sql)`. Names are explicit so they match the reference schema.
- **`@Column('text')`** maps a property to a column; the naming strategy turns `displayName` into `display_name`.
- **`select: false`** on `passwordHash` leaves the column out of every query unless one asks for it by name (Part 4 does, once). A `SELECT *` mistake can't leak a password hash.

**`src/database/entities/workspace.entity.ts`** · new file

```ts
import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { User } from './user.entity.js';

@Entity('workspaces')
@Index('workspaces_slug_key', ['slug'], { unique: true })
export class Workspace {
  @Id()
  id: string;

  @Column('text')
  name: string;

  @Column('text')
  slug: string;

  @Column('uuid')
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: Relation<User>;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**`src/database/entities/workspace-member.entity.ts`** · new file

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  type Relation,
} from 'typeorm';
import type { Role } from '../../modules/access/roles.js';
import { Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('workspace_members')
@Index('workspace_members_workspace_id_user_id_key', ['workspaceId', 'userId'], { unique: true })
@Index('workspace_members_user_idx', ['userId', 'workspaceId'])
@Check('workspace_members_role_check', `role IN ('owner', 'admin', 'member', 'viewer')`)
export class WorkspaceMember {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column('text')
  role: Role;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
```

**What's new**
- **Two properties per foreign key.** `@Column('uuid') workspaceId` is the raw column; `@ManyToOne(() => Workspace, { onDelete: 'CASCADE' }) @JoinColumn({ name: 'workspace_id' }) workspace` is the **relation** over the same column. You write ids directly (`{ workspaceId }`) and load the object only when you ask for it (`relations: { workspace: true }`). The arrow function `() => Workspace` delays the lookup, so entity files can import each other in any order.
- **`Relation<Workspace>`** (a type-only wrapper) stops TypeScript's emitted metadata from referencing the `Workspace` class at module load time. Under ESM, two entities that import each other would otherwise hit a "used before initialization" error.
- `role: Role` stores text; the `@Check` enforces the four values in the database, and the TypeScript type enforces them in code.
- `joined_at` uses `CreateDateColumn` directly because its name isn't `created_at`.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: typeorm entities for users, workspaces and members`

### Step 2.3 · The remaining entities

**Goal:** invitations, projects, columns, tasks, comments, attachments and the activity log, plus the list of every entity.

**Files:** `src/database/entities/*.entity.ts`, `src/database/entities/index.ts`

**`src/database/entities/invitation.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import type { InvitableRole } from '../../modules/access/roles.js';
import { CreatedAt, Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('invitations')
@Index('invitations_token_hash_key', ['tokenHash'], { unique: true })
@Index('invitations_pending_email_uq', ['workspaceId', 'email'], {
  unique: true,
  where: 'accepted_at IS NULL',
})
@Index('invitations_workspace_idx', ['workspaceId', 'id'], { where: 'accepted_at IS NULL' })
@Check('invitations_email_check', 'email = lower(email)')
@Check('invitations_role_check', `role IN ('admin', 'member', 'viewer')`)
export class Invitation {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('text')
  email: string;

  @Column('text')
  role: InvitableRole;

  @Column('text')
  tokenHash: string;

  @Column('uuid')
  invitedBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'invited_by' })
  inviter: Relation<User>;

  @Column('timestamptz')
  expiresAt: Date;

  @Column('timestamptz', { nullable: true })
  acceptedAt: Date | null;

  @CreatedAt()
  createdAt: Date;
}
```

**What's new**
- **Partial indexes:** `@Index(..., { unique: true, where: 'accepted_at IS NULL' })` indexes only pending invitations, so "one pending invitation per email" is enforced by the database while accepted ones can repeat.
- `invitedBy` is the column and `inviter` the relation over it; a property and its relation don't have to share a name.

**`src/database/entities/project.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('projects')
@Index('projects_workspace_id_key_key', ['workspaceId', 'key'], { unique: true })
@Index('projects_workspace_idx', ['workspaceId', 'id'])
@Check('projects_key_check', `key ~ '^[A-Z][A-Z0-9]{1,9}$'`)
export class Project {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  @Column('text')
  name: string;

  @Column('text')
  key: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('integer', { default: 1 })
  nextTaskNumber: number;

  @Column('uuid')
  createdBy: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by' })
  creator: Relation<User>;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**`src/database/entities/board-column.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Project } from './project.entity.js';

@Entity('board_columns')
@Index('board_columns_project_id_position_key', ['projectId', 'position'], { unique: true })
@Check('board_columns_wip_limit_check', 'wip_limit BETWEEN 1 AND 999')
export class BoardColumn {
  @Id()
  id: string;

  @Column('uuid')
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @Column('text')
  name: string;

  // Fractional-index keys compare byte by byte, so the column must use the "C" collation.
  @Column({ type: 'text', collation: 'C' })
  position: string;

  @Column('integer', { nullable: true })
  wipLimit: number | null;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**What's new**
- **`@Column({ type: 'text', collation: 'C' })`**: fractional-index keys (Part 6) must compare byte by byte, so the column uses the `C` collation. Prisma couldn't say this at all; TypeORM can.
- `nextTaskNumber` with `default: 1` is the per-project counter Part 7 increments.

**`src/database/entities/task.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { BoardColumn } from './board-column.entity.js';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Project } from './project.entity.js';
import { User } from './user.entity.js';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

@Entity('tasks')
@Index('tasks_project_id_number_key', ['projectId', 'number'], { unique: true })
@Index('tasks_column_id_position_key', ['columnId', 'position'], { unique: true })
@Index('tasks_project_idx', ['projectId', 'id'])
@Index('tasks_assignee_idx', ['assigneeId', 'id'])
@Index('tasks_search_idx', ['searchVector'], { type: 'gin' })
@Index('tasks_due_reminder_idx', ['dueAt'], {
  where: 'reminder_sent_at IS NULL AND assignee_id IS NOT NULL',
})
@Check('tasks_priority_check', `priority IN ('low', 'medium', 'high', 'urgent')`)
export class Task {
  @Id()
  id: string;

  @Column('uuid')
  projectId: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'project_id' })
  project: Relation<Project>;

  @Column('uuid')
  columnId: string;

  // No ON DELETE action: Postgres refuses to delete a column that still has tasks.
  @ManyToOne(() => BoardColumn)
  @JoinColumn({ name: 'column_id' })
  column: Relation<BoardColumn>;

  @Column('integer')
  number: number;

  @Column('text')
  title: string;

  @Column('text', { nullable: true })
  description: string | null;

  @Column('text', { default: 'medium' })
  priority: Priority;

  @Column('uuid', { nullable: true })
  assigneeId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assignee_id' })
  assignee: Relation<User> | null;

  @Column('uuid')
```

**`src/database/entities/task.entity.ts`** · continue

```ts
  reporterId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporter_id' })
  reporter: Relation<User>;

  @Column('timestamptz', { nullable: true })
  dueAt: Date | null;

  @Column('timestamptz', { nullable: true })
  reminderSentAt: Date | null;

  @Column({ type: 'text', collation: 'C' })
  position: string;

  @Column({
    type: 'tsvector',
    generatedType: 'STORED',
    asExpression: `setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')`,
    select: false,
    insert: false,
    update: false,
  })
  searchVector: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**What's new**
- `column` has **no `onDelete`**: Postgres refuses to delete a column that still holds tasks (`NO ACTION`), while deleting a project cascades to both. `assignee` is `SET NULL`: deleting a user unassigns their tasks.
- **A generated column:** `generatedType: 'STORED'` + `asExpression` makes `search_vector` a `GENERATED ALWAYS AS (…) STORED` column that Postgres recomputes from `title` and `description` on every write. `select: false, insert: false, update: false` keeps TypeORM from ever reading or writing it; only search queries use it, in SQL.
- **`@Index('tasks_search_idx', ['searchVector'], { type: 'gin' })`** is a GIN index: an inverted index from each word to the rows containing it (Part 8).
- `tasks_due_reminder_idx` is partial: only tasks that still need a reminder (Part 11's scan).

**`src/database/entities/comment.entity.ts`** · new file

```ts
import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id, UpdatedAt } from './columns.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';

@Entity('comments')
@Index('comments_task_idx', ['taskId', 'id'])
export class Comment {
  @Id()
  id: string;

  @Column('uuid')
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Relation<Task>;

  @Column('uuid')
  authorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'author_id' })
  author: Relation<User>;

  @Column('text')
  body: string;

  @CreatedAt()
  createdAt: Date;

  @UpdatedAt()
  updatedAt: Date;
}
```

**`src/database/entities/attachment.entity.ts`** · new file

```ts
import { Check, Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { bigintAsNumber, CreatedAt, Id } from './columns.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';

export type AttachmentStatus = 'pending' | 'ready';

@Entity('attachments')
@Index('attachments_storage_key_key', ['storageKey'], { unique: true })
@Index('attachments_task_idx', ['taskId', 'id'], { where: `status = 'ready'` })
@Index('attachments_pending_idx', ['createdAt'], { where: `status = 'pending'` })
@Check('attachments_size_bytes_check', 'size_bytes > 0')
@Check('attachments_status_check', `status IN ('pending', 'ready')`)
export class Attachment {
  @Id()
  id: string;

  @Column('uuid')
  taskId: string;

  @ManyToOne(() => Task, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task: Relation<Task>;

  @Column('uuid')
  uploaderId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'uploader_id' })
  uploader: Relation<User>;

  @Column('text')
  fileName: string;

  @Column('text')
  contentType: string;

  @Column('bigint', { transformer: bigintAsNumber })
  sizeBytes: number;

  @Column('text')
  storageKey: string;

  @Column('text', { default: 'pending' })
  status: AttachmentStatus;

  @CreatedAt()
  createdAt: Date;
}
```

**`src/database/entities/activity-event.entity.ts`** · new file

```ts
import { Column, Entity, Index, JoinColumn, ManyToOne, type Relation } from 'typeorm';
import { CreatedAt, Id } from './columns.js';
import { User } from './user.entity.js';
import { Workspace } from './workspace.entity.js';

@Entity('activity_events')
@Index('activity_workspace_idx', ['workspaceId', 'id'])
@Index('activity_project_idx', ['projectId', 'id'], { where: 'project_id IS NOT NULL' })
@Index('activity_task_idx', ['taskId', 'id'], { where: 'task_id IS NOT NULL' })
export class ActivityEvent {
  @Id()
  id: string;

  @Column('uuid')
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Relation<Workspace>;

  // Plain uuid columns, no foreign key: the event must outlive the project or task it describes.
  @Column('uuid', { nullable: true })
  projectId: string | null;

  @Column('uuid', { nullable: true })
  taskId: string | null;

  @Column('uuid')
  actorId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'actor_id' })
  actor: Relation<User>;

  @Column('text')
  type: string;

  @Column('jsonb', { default: {} })
  data: object;

  @CreatedAt()
  createdAt: Date;
}
```

**What's new**
- `transformer: bigintAsNumber` (Step 2.1) on `sizeBytes`.
- The activity log's `projectId` and `taskId` are **plain uuid columns with no relation**: the event must survive the deletion of the project or task it describes, so a foreign key would be wrong.
- `@Column('jsonb', { default: {} })`: a JSON column for each event's details.

**`src/database/entities/index.ts`** · new file

```ts
import { ActivityEvent } from './activity-event.entity.js';
import { Attachment } from './attachment.entity.js';
import { BoardColumn } from './board-column.entity.js';
import { Comment } from './comment.entity.js';
import { Invitation } from './invitation.entity.js';
import { Project } from './project.entity.js';
import { Task } from './task.entity.js';
import { User } from './user.entity.js';
import { WorkspaceMember } from './workspace-member.entity.js';
import { Workspace } from './workspace.entity.js';

/** Every entity, listed by hand: no file globbing, so it works the same compiled, bundled or under Vitest. */
export const ENTITIES = [
  User,
  Workspace,
  WorkspaceMember,
  Invitation,
  Project,
  BoardColumn,
  Task,
  Comment,
  Attachment,
  ActivityEvent,
];
```

**What's new**
- **An explicit list**, not a glob like `entities: ['dist/**/*.entity.js']` (the pattern many tutorials use). A glob depends on where the files are and what they compile to, so it breaks under Vitest (which runs `.ts` files) or a bundler. An array of classes works everywhere.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: typeorm entities for projects, tasks, comments, attachments and activity`

### Step 2.4 · The data source and the generated migration

**Goal:** one definition of the database connection, and a migration that TypeORM generates from the entities.

**Files:** `src/database/data-source-options.ts`, `src/database/data-source.ts`, `src/database/migrations/1794480000000-Init.ts` (generated)

**`src/database/data-source-options.ts`** · new file

```ts
import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities/index.js';
```

**`src/database/data-source-options.ts`** · continue

```ts
import { SnakeNamingStrategy } from './naming-strategy.js';

/** One definition of "how to reach the database", shared by the app, the CLI and the tests. */
export function dataSourceOptions(url: string): DataSourceOptions {
  return {
    type: 'postgres',
    url,
    entities: ENTITIES,
```

**`src/database/data-source-options.ts`** · continue

```ts
    namingStrategy: new SnakeNamingStrategy(),
    // The schema changes only through migrations, never by TypeORM guessing at startup.
    synchronize: false,
    poolSize: 10,
  };
}
```

**`src/database/data-source.ts`** · new file

```ts
import { existsSync } from 'node:fs';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from './data-source-options.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');

/** The TypeORM CLI's entry point (`-d dist/database/data-source.js`); the app builds its own. */
export default new DataSource(dataSourceOptions(url));
```

**What's new**
- **`DataSource`** is TypeORM's connection: a pool plus the entity metadata. `dataSourceOptions(url)` describes it once, for three users: the app (Part 3), the CLI (below) and the test setup (Part 3).
- **`synchronize: false`**: TypeORM can alter the schema to match your entities at startup. That's handy in a demo and dangerous anywhere else (a renamed property drops a column and its data). Schema changes go through migrations, always.
- **`data-source.ts` exports a `DataSource` as its default export**, which is what the TypeORM CLI loads. The CLI runs outside Nest, so it reads `.env` itself.

```bash
npm pkg set scripts.db:generate="nest build && typeorm migration:generate -d dist/database/data-source.js -p"
npm run db:generate -- -t 1794480000000 src/database/migrations/Init
```

TypeORM connects to the (empty) dev database, compares it with the entities, and writes the SQL that closes the gap to `src/database/migrations/1794480000000-Init.ts`. **`-t`** fixes the timestamp so your file and class are named like the repo's (without it, the name has the current time). **`-p`** pretty-prints the SQL.

Open the file. It's a class with `up()` (apply) and `down()` (revert), each a list of `queryRunner.query(sql)` calls. Make **three hand edits**:

1. The first line imports only types, so it must say so (`verbatimModuleSyntax`): change `import { MigrationInterface, QueryRunner }` to `import type { MigrationInterface, QueryRunner }`.
2. Find `INSERT INTO "typeorm_metadata"`. TypeORM records the generated column's expression in a metadata table, keyed by **database name**, and it wrote your dev database's name (`"taskflow"`) into the parameters. The test database (Part 3) is `taskflow_test`, so make it portable: replace `VALUES ($1, $2, $3, $4, $5, $6)` with `VALUES (current_database(), $1, $2, $3, $4, $5)` and delete `"taskflow",` from the start of the parameter array.
3. Do the same in `down()`, in `DELETE FROM "typeorm_metadata"`: replace `AND "database" = $3` with `AND "database" = current_database()`, renumber the next two placeholders to `$3` and `$4`, and delete `"taskflow",` from that parameter array.

The result:

**`src/database/migrations/1794480000000-Init.ts`** · excerpt

```ts
        await queryRunner.query(`
            INSERT INTO "typeorm_metadata"(
                    "database",
                    "schema",
                    "table",
                    "type",
                    "name",
                    "value"
                )
            VALUES (current_database(), $1, $2, $3, $4, $5)
        `, ["public","tasks","GENERATED_COLUMN","search_vector","setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B')"]);
```

**`src/database/migrations/1794480000000-Init.ts`** · excerpt

```ts
        await queryRunner.query(`
            DELETE FROM "typeorm_metadata"
            WHERE "type" = $1
                AND "name" = $2
                AND "database" = current_database()
                AND "schema" = $3
                AND "table" = $4
        `, ["GENERATED_COLUMN","search_vector","public","tasks"]);
```

**What's new**
- **Generated, then reviewed.** Read the SQL before you commit a generated migration: you'll see every table, `COLLATE "C"`, the `GENERATED ALWAYS AS … STORED` column, the partial and GIN indexes, and constraint names from the naming strategy. Compare with Drizzle: there the migration was SQL that drizzle-kit wrote from a snapshot; here it's a TypeScript class that TypeORM wrote by **diffing your entities against a live database**, which is why the dev database must be empty (or fully migrated) when you generate.

**✅ Checkpoint**

```bash
grep -c 'queryRunner.query' src/database/migrations/1794480000000-Init.ts
```

Expected: `104`.

**Commit:** `feat: initial migration generated by typeorm`

### Step 2.5 · Register the migration, apply it, check for drift

**Goal:** the app knows its migrations, production can apply them with plain `node`, and a script proves the entities and migrations agree.

**Files:** `src/database/migrations/index.ts`, `src/database/data-source-options.ts`, `src/migrate.ts`

**`src/database/migrations/index.ts`** · new file

```ts
import type { MigrationInterface } from 'typeorm';
import { Init1794480000000 } from './1794480000000-Init.js';

/** Every migration class, oldest first. Add each new migration here after generating it. */
export const MIGRATIONS: (new () => MigrationInterface)[] = [Init1794480000000];
```

**`src/database/data-source-options.ts`** · add after `import { ENTITIES } from './entities/index.js';`

```ts
import { MIGRATIONS } from './migrations/index.js';
```

**`src/database/data-source-options.ts`** · add after `entities: ENTITIES,`

```ts
    migrations: MIGRATIONS,
```

**`src/migrate.ts`** · new file

```ts
import dataSource from './database/data-source.js';

/** Applies pending migrations. Production runs this with plain `node dist/migrate.js`. */
await dataSource.initialize();
const applied = await dataSource.runMigrations();
await dataSource.destroy();
console.log(`migrations applied: ${applied.length}`);
```

```bash
npm pkg set scripts.db:migrate="nest build && node dist/migrate.js" \
  scripts.db:drift="nest build && typeorm migration:generate -d dist/database/data-source.js --check src/database/migrations/Drift"
```

**What's new**
- **Migrations are classes, listed by hand** for the same reason as entities. Every new migration gets a line in `MIGRATIONS`. TypeORM runs them in timestamp order and records each in the `migrations` table.
- **`src/migrate.ts`** is a tiny program: connect, `runMigrations()`, disconnect. It runs from `dist/`, so the production image (Part 13) can apply migrations without the TypeORM CLI or `ts` files. Top-level `await` works because this is an ES module.
- **`db:drift`** asks the CLI to generate a migration with `--check`: if the entities describe anything the database doesn't have, it prints the SQL and exits 1. CI runs it against a freshly migrated database (Part 14), so "I changed an entity but forgot the migration" fails the build.

**✅ Checkpoint**

```bash
npm run db:migrate
npm run db:drift
docker compose exec postgres psql -U taskflow -c '\d tasks' | grep -E 'position |search_vector'
```

Expected: `migrations applied: 1`, then `No changes in database schema were found`, then:

```text
 position         | text                     | C         | not null |
 search_vector    | tsvector                 |           | not null | generated always as (...) stored
```

**Commit:** `feat: migration runner and drift check`

---
## Part 3 · HTTP foundations

This Part builds everything between the socket and your business logic: errors as RFC 9457 problems, validation, request IDs and logging, 404/405/415, health checks, and the app itself. It's also where you meet **every core Nest concept**: modules, providers and dependency injection, controllers, pipes, exception filters, middleware and lifecycle hooks. Take it slowly; the rest of the guide reuses these ideas.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one error class that maps to the contract's `application/problem+json` body, and the function that writes it.

**Files:** `src/common/problem.ts`, `src/types/express.d.ts`, `src/common/http/send-problem.ts`

```bash
npm i -E @nestjs/common@12.4.2 @nestjs/core@12.4.2 @nestjs/platform-express@12.4.2 rxjs@7.8.2
npm i -D -E @types/express@5.0.6
```

- **`@nestjs/core`** is the framework: the DI container, the module system, the request pipeline. **`@nestjs/common`** holds the decorators and interfaces you import every day (`@Module`, `@Injectable`, `@Get`, `HttpException`).
- **`@nestjs/platform-express`** is the HTTP adapter. Nest doesn't parse HTTP itself: it runs **on top of Express** (or Fastify, with `@nestjs/platform-fastify`). Everything you know about Express requests and middleware still applies underneath.
- **`rxjs`** is a peer dependency: Nest's interceptors and WebSocket handlers can return Observables. You won't write any, but Nest needs the library.

**`src/common/problem.ts`** · new file

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
- The same `ProblemError` as Fastify's: a slug picks the status and title, `detail` and field `errors` are optional, and small factories (`notFound('Task')`) keep call sites short. `readonly slug` in the constructor's parameter list is TypeScript's **parameter property**: it declares the field and assigns it in one go. Nest uses this idiom everywhere, as you'll see in every constructor from here on.
- **Why not Nest's `HttpException`?** Nest has its own error classes (`NotFoundException`, `ConflictException`), and its default error body is `{ statusCode, message, error }`. The contract wants RFC 9457, and our error should know its problem slug, so we keep our own class and translate Nest's into it (Step 3.4).

**`src/types/express.d.ts`** · new file

```ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by the requestContext middleware; pino-http reuses it for every log line. */
    id: string;
    /** Set by the JWT strategy once a request is authenticated. */
    user?: { id: string };
  }
}
```

**`src/common/http/send-problem.ts`** · new file

```ts
import type { Request, Response } from 'express';
import { PROBLEM_TYPE_BASE, type ProblemError } from '../problem.js';

/** Writes an RFC 9457 response. Used by the exception filter and by the raw Express middleware. */
export function sendProblem(req: Request, res: Response, problem: ProblemError): void {
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
}
```

**What's new**
- **Declaration merging, as in Express:** `req.id` (Step 3.3) and `req.user` (Part 4) become typed on every Express `Request`. Nest hands you the real Express objects, so augmenting Express's types is still the way.
- `sendProblem` writes the body with Express's `res`. Two callers need it: the exception filter (Step 3.4) and a raw middleware that rejects a request before Nest sees it (Step 3.3).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Validation: the pipe, field paths and custom decorators

**Goal:** every request body, query string and path parameter is validated against a class, and failures become a 422 with the contract's `{ field, message }` list.

**Files:** `src/common/validation/field-errors.ts`, `src/common/validation/field-errors.spec.ts`, `src/common/validation/request-validation.pipe.ts`, `src/common/validation/parse-id.pipe.ts`, `src/common/validation/decorators.ts`

**`src/common/validation/field-errors.ts`** · new file

```ts
import type { Paramtype } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import type { FieldError } from '../problem.js';

const PREFIX: Partial<Record<Paramtype, string>> = { query: 'query', param: 'path' };

/**
 * class-validator errors → our `{ field, message }` list, one entry per field. Property names
 * on a DTO are the camelCase wire names already, so the path needs no renaming.
 */
export function fieldErrors(errors: ValidationError[], source: Paramtype): FieldError[] {
  const prefix = PREFIX[source];
  const out: FieldError[] = [];
  const visit = (error: ValidationError, parents: string[]) => {
    const path = [...parents, error.property];
    const [message] = Object.values(error.constraints ?? {});
    if (message !== undefined) {
      out.push({
        field: [prefix, ...path].filter(Boolean).join('.'),
        // class-validator starts every message with the property name; the field carries it already.
        message: message.startsWith(`${error.property} `)
          ? message.slice(error.property.length + 1)
          : message,
      });
    }
    for (const child of error.children ?? []) visit(child, path);
  };
  for (const error of errors) visit(error, []);
  return out;
}
```

**`src/common/validation/field-errors.spec.ts`** · new file

```ts
import type { ValidationError } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { fieldErrors } from './field-errors.js';

const error = (
  property: string,
  constraints?: Record<string, string>,
  children: ValidationError[] = [],
): ValidationError => ({ property, constraints, children });

describe('validation field paths', () => {
  it('uses the DTO property names and drops the repeated name from the message', () => {
    const errors = [error('dueAt', { isDateTime: 'dueAt must be an ISO-8601 date-time' })];
    expect(fieldErrors(errors, 'body')).toEqual([
      { field: 'dueAt', message: 'must be an ISO-8601 date-time' },
    ]);
  });

  it('walks nested objects and reports one message per field', () => {
    const nested = error('nested', undefined, [
      error('projectId', { matches: 'must be a UUID', isString: 'projectId must be a string' }),
    ]);
    expect(fieldErrors([nested], 'body')).toEqual([
      { field: 'nested.projectId', message: 'must be a UUID' },
    ]);
  });

  it('prefixes query and path parameters', () => {
    expect(fieldErrors([error('limit', { isInt: 'x' })], 'query')[0]?.field).toBe('query.limit');
    expect(fieldErrors([error('workspaceId', { isUuid: 'x' })], 'param')[0]?.field).toBe(
      'path.workspaceId',
    );
  });
});
```

**What's new**
- class-validator reports a **tree** of `ValidationError`s: each has the `property`, a `constraints` map (`{ isInt: 'limit must be an integer number' }`) and `children` for nested objects. `fieldErrors` walks it and produces one entry per field.
- **The wire names come for free.** In Fastify, Ajv reported JSON paths (`/nested/projectId`) that we converted. Here a DTO's property names *are* the camelCase wire names, so the path only needs the `query.` / `path.` prefix the contract uses.
- `Paramtype` is Nest's name for where a value came from: `'body' | 'query' | 'param' | 'custom'`.

**`src/common/validation/request-validation.pipe.ts`** · new file

```ts
import { Injectable, ValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import type { ValidationError } from 'class-validator';
import { ProblemError } from '../problem.js';
import { fieldErrors } from './field-errors.js';

/** Carries class-validator's errors out of ValidationPipe until we know where the value came from. */
class ValidationFailed extends Error {
  constructor(readonly errors: ValidationError[]) {
    super('Validation failed');
  }
}

/**
 * Nest's ValidationPipe with our error format. For every handler argument typed as a DTO class it
 * builds an instance (transform), drops properties without a decorator (whitelist), and validates.
 */
@Injectable()
export class RequestValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      stopAtFirstError: true,
      exceptionFactory: (errors) => new ValidationFailed(errors),
    });
  }

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    // A JSON body can be an array; a DTO can only be built from an object.
    if (metadata.type === 'body' && Array.isArray(value)) throw invalidBody('must be an object');
    try {
      return await super.transform(value, metadata);
    } catch (err) {
      if (!(err instanceof ValidationFailed)) throw err;
      throw new ProblemError(
        'validation-error',
        'The request contains invalid fields',
        fieldErrors(err.errors, metadata.type),
      );
    }
  }
}

export const invalidBody = (message: string) =>
  new ProblemError('validation-error', 'The request contains invalid fields', [
    { field: 'body', message },
  ]);
```

**What's new (pipes)**
- **A pipe** is a class whose `transform(value, metadata)` runs on **each handler argument** before the handler: it can convert the value or throw. `metadata.metatype` is the argument's declared class (from `emitDecoratorMetadata` again), and `metadata.type` says whether it's the body, the query or a path parameter.
- **`ValidationPipe`** is Nest's built-in validating pipe: if the argument's type is a class with class-validator decorators, it builds an instance with class-transformer and validates it. We extend it and pass three options: **`transform: true`** hands the handler the built instance (with defaults and conversions applied), **`whitelist: true`** silently drops properties that have no decorator (the contract ignores unknown fields), **`stopAtFirstError: true`** reports one message per field.
- `exceptionFactory` normally builds Nest's `BadRequestException`. Ours wraps the raw errors, so `transform()` can catch them and turn them into a 422 `ProblemError` **with the field prefix**, which only `transform()` knows (`metadata.type`).
- **`@Injectable()`** marks a class that Nest's container may create and inject. You'll see it on every service, pipe and guard.

**`src/common/validation/parse-id.pipe.ts`** · new file

```ts
import { Injectable, Param, type ArgumentMetadata, type PipeTransform } from '@nestjs/common';
import { invalid } from '../problem.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Rejects a path parameter that isn't a UUID before Postgres has to (it would be a 500 there). */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!UUID.test(value)) throw invalid(`path.${metadata.data ?? 'id'}`, 'must be a UUID');
    return value;
  }
}

/** `@IdParam('taskId') taskId: string`: a route parameter that must be a UUID. */
export const IdParam = (name: string) => Param(name, ParseIdPipe);
```

**What's new**
- A pipe for **one parameter**: `Param(name, ParseIdPipe)` reads the route parameter and runs it through the pipe. `IdParam` is a **custom parameter decorator** built from Nest's own: `@IdParam('taskId') taskId: string` in a controller reads `:taskId` and guarantees it's a UUID. A malformed id becomes a 422 on `path.taskId` instead of a Postgres "invalid input syntax for type uuid" error (a 500).
- Nest has a built-in `ParseUUIDPipe`; ours throws our problem type with the contract's field path, and accepts any UUID version (Postgres ids are v7).

**`src/common/validation/decorators.ts`** · new file

```ts
import { applyDecorators, Body, Injectable, type PipeTransform } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsISO8601, Matches, ValidateIf } from 'class-validator';
import { UUID } from './parse-id.pipe.js';
import { invalidBody } from './request-validation.pipe.js';

/** Trims a string before its length is checked, so "  " counts as empty. */
export const Trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

export const ToLowerCase = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );

/**
 * The field may be left out. class-validator's own @IsOptional() also lets `null` through,
 * which would reach a NOT NULL column; this one skips validation for `undefined` only.
 */
export const IsOmittable = () => ValidateIf((_, value) => value !== undefined);

/** The field may be `null` (PATCH: "clear this value"). */
export const IsNullable = () => ValidateIf((_, value) => value !== null);

/** A UUID, by the same pattern the path-parameter pipe uses. */
export const IsId = () => Matches(UUID, { message: 'must be a UUID' });

const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/** A full timestamp with an offset ("2026-10-25T12:00:00Z"); a bare date is rejected. */
export const IsDateTime = () =>
  applyDecorators(
    Matches(RFC_3339, { message: 'must be an ISO-8601 date-time' }),
    IsISO8601({ strict: true }, { message: 'must be an ISO-8601 date-time' }),
  );
```

**`src/common/validation/decorators.ts`** · continue

```ts

/** After unknown keys are stripped, a PATCH body must still change something. */
@Injectable()
export class NonEmptyPatchPipe implements PipeTransform<object, object> {
  transform(value: object): object {
    if (Object.values(value).every((field) => field === undefined)) {
      throw invalidBody('at least one field is required');
    }
    return value;
  }
}

/** `@PatchBody() dto: UpdateTaskDto`: a validated body with at least one field present. */
export const PatchBody = () => Body(NonEmptyPatchPipe);

/** Drops `undefined` fields: what's left is exactly what the client sent. */
export function defined<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}
```

**What's new**
- **Your own validation decorators** are just combinations of library ones. `Trim()` is a `Transform` (it runs during `plainToInstance`, before validation, so `"  "` fails `@Length(1, 80)`). `applyDecorators(a, b)` combines several decorators into one, as `IsDateTime()` does.
- **`IsOmittable` vs `@IsOptional()`.** class-validator's `@IsOptional()` skips validation for `undefined` **and `null`**. For a PATCH, `null` means "clear this field", and for a NOT NULL column it must be rejected. `ValidateIf(...)` says exactly when to validate: `IsOmittable` skips only `undefined`, `IsNullable` skips only `null`.
- **`NonEmptyPatchPipe`** runs *after* the global validation pipe (Step 3.6 registers that one): by then unknown keys are gone, so `{ "nonsense": 1 }` arrives as `{}` and is rejected. `PatchBody()` is `Body(NonEmptyPatchPipe)`: a body decorator with an extra pipe.
- `defined(dto)` drops `undefined` fields, so a service receives only what the client sent (merge semantics for PATCH).

**✅ Checkpoint**

```bash
npx vitest run src
```

Expected:

```text
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

**Commit:** `feat: class-validator pipe with wire field paths and custom decorators`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an `X-Request-Id`, every log line is JSON with that ID, each request is logged once, responses carry the README's security headers, and non-JSON bodies are refused.

**Files:** `src/common/http/request-context.ts`, `src/infra/logger.ts`

```bash
npm i -E nestjs-pino@5.3.1 pino@10.4.0 pino-http@11.0.0 uuid@14.0.3
```

- **`nestjs-pino`** replaces Nest's built-in logger with **pino** (the logger Fastify uses), through **`pino-http`**, which logs one line per request. **`uuid`** mints request IDs (UUIDv7).

**`src/common/http/request-context.ts`** · new file

```ts
import type { NextFunction, Request, Response } from 'express';
import { v7 as uuidv7 } from 'uuid';
import { ProblemError } from '../problem.js';
import { sendProblem } from './send-problem.js';

const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/** Honour a well-formed incoming X-Request-Id, otherwise mint a UUIDv7; echo it and harden the response. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id'];
  req.id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : uuidv7();
  res.set({
    'X-Request-Id': req.id,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  next();
}

/**
 * This API speaks JSON only. express.json() silently skips other content types, which would
 * turn a text/plain body into "every field is missing" (422); the honest answer is 415.
 */
export function jsonBodiesOnly(req: Request, res: Response, next: NextFunction): void {
  const hasBody =
    req.headers['transfer-encoding'] !== undefined || Number(req.headers['content-length']) > 0;
  if (hasBody && !req.is('application/json')) {
    sendProblem(
      req,
      res,
      new ProblemError('unsupported-media-type', 'Request body must be application/json'),
    );
    return;
  }
  next();
}
```

**What's new**
- **These are plain Express middleware**, `(req, res, next)` functions, exactly as in the Express repo. Nest supports its own middleware classes too, but these run for *every* request before routing, so registering them on the underlying Express app (Step 3.6) is simplest and runs earliest.
- **`jsonBodiesOnly` returns 415** for a body that isn't `application/json`. Express's JSON parser silently skips other content types, so without this a `text/plain` body would reach validation as "every field missing", a misleading 422.

> **🧠 DSA & scalability · request IDs**
> - **Data structure:** a UUIDv7 string per request: 48 bits of millisecond timestamp, then random bits.
> - **Algorithm:** reuse a well-formed incoming `X-Request-Id` (a proxy or the frontend may have set one), otherwise generate one; echo it in the response and in every log line.
> - **Complexity:** O(1); the regex caps incoming IDs at 128 safe characters, so a client can't inject log lines.
> - **Why it scales:** IDs are generated independently on every instance with no coordination, and being time-ordered they sort log searches naturally.
> - **Rejected:** incrementing counters (need shared state), UUIDv4 (no time order).

**`src/infra/logger.ts`** · new file

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Request } from 'express';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import type { Env } from '../config/env.js';

function completed(req: IncomingMessage, res: ServerResponse, fields: object) {
  const request = req as Request;
  return {
    ...fields,
    userId: request.user?.id,
    method: request.method,
    path: request.originalUrl,
    status: res.statusCode,
  };
}

/** One JSON line per request: requestId, userId, method, path, status, responseTime. */
export function loggerOptions(env: Pick<Env, 'LOG_LEVEL'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'taskflow-nestjs' },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      // requestContext already chose req.id; pino-http reuses it instead of minting its own.
      genReqId: (req) => (req as Request).id,
      customAttributeKeys: { reqId: 'requestId' },
      // Log lines carry the request id, not a dump of the request and response: their
      // headers hold the access token and the refresh cookie, which must never reach a log.
      quietReqLogger: true,
      serializers: { req: () => undefined, res: () => undefined },
      // Evaluated once, when the response is finished (by then the auth guard has set req.user).
      customSuccessObject: completed,
      customErrorObject: (req, res, _err, fields: object) => completed(req, res, fields),
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request completed',
      autoLogging: { ignore: (req) => (req as Request).originalUrl.startsWith('/health') },
    },
  };
}
```

**What's new**
- `loggerOptions` returns **`nestjs-pino`'s `Params`**: under `pinoHttp`, options for pino-http. The same JSON shape as Fastify's logs: ISO time, `level` as a label, `service`, `requestId`.
- **`quietReqLogger` + serializers returning `undefined`**: by default pino-http logs the whole request and response objects, headers included. Headers carry the access token and the refresh cookie, which must never reach a log, so we log only the fields we choose in `completed`.
- **`customSuccessObject` runs when the response finishes**, after the auth guard (Part 4) has set `req.user`, so the line can carry the `userId`.
- `genReqId` reuses the ID `requestContext` already chose; `autoLogging.ignore` keeps health probes (every few seconds, from Docker or Kubernetes) out of the logs.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · The exception filter: 404, 405 and everything else

**Goal:** a single place where every error becomes a problem response, including unknown routes (404) and known routes with the wrong method (405 + `Allow`).

**Files:** `src/common/pg-errors.ts`, `src/common/http/routes.ts`, `src/common/http/route-table.ts`, `src/common/http/problem.filter.ts`

**`src/common/pg-errors.ts`** · new file

```ts
import { QueryFailedError } from 'typeorm';

/** Postgres SQLSTATE codes we turn into API errors. */
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

/** TypeORM wraps the driver's error in a QueryFailedError; the SQLSTATE is on `driverError`. */
export function pgErrorCode(err: unknown): string | undefined {
  if (!(err instanceof QueryFailedError)) return undefined;
  const { code } = err.driverError as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

export const isUniqueViolation = (err: unknown) => pgErrorCode(err) === UNIQUE_VIOLATION;
export const isForeignKeyViolation = (err: unknown) => pgErrorCode(err) === FOREIGN_KEY_VIOLATION;

```

**What's new**
- TypeORM wraps the driver's error in a **`QueryFailedError`** whose `driverError` holds node-postgres's error, with the SQLSTATE `code`. `23505` is a unique violation, `23503` a foreign key violation; services translate them into 409s.

**`src/common/http/routes.ts`** · new file

```ts
/** Every API controller is declared as `@Controller(API_PREFIX)`; health checks stay at the root. */
export const API_PREFIX = 'api/v1';
```

**`src/common/http/route-table.ts`** · new file

```ts
import { Injectable, RequestMethod, type OnApplicationBootstrap } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';

const ORDER = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SPECIAL = /[.*+?^${}()|[\]\\]/g;

interface Route {
  pattern: RegExp;
  method: string;
}

/**
 * Knows every route the controllers declare, so an unmatched request can be told apart:
 * unknown path (404) or known path with the wrong method (405 + Allow).
 */
@Injectable()
export class RouteTable implements OnApplicationBootstrap {
  private readonly routes: Route[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly scanner: MetadataScanner,
  ) {}

  /** Decorators only wrote metadata; here we read it back, once every module is loaded. */
  onApplicationBootstrap(): void {
    for (const { metatype } of this.discovery.getControllers()) {
      if (typeof metatype !== 'function') continue;
      const base = Reflect.getMetadata(PATH_METADATA, metatype) as string;
      const prototype = metatype.prototype as Record<string, object>;
      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (!handler) continue;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
        if (method === undefined) continue;
        const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
        this.routes.push({ pattern: toPattern(base, path), method: RequestMethod[method] });
      }
    }
  }

  /** The methods declared for a path, in a stable order; empty when no route has this path. */
  allowedMethods(path: string): string[] {
    const methods = new Set(this.routes.filter((r) => r.pattern.test(path)).map((r) => r.method));
    if (methods.has('GET')) methods.add('HEAD');
    return ORDER.filter((m) => methods.has(m));
  }
}

/** ('api/v1', 'workspaces/:workspaceId/members') → /^\/api\/v1\/workspaces\/[^/]+\/members\/?$/ */
function toPattern(base: string, path: string): RegExp {
  const source = [base, path]
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .map((segment) => (segment.startsWith(':') ? '[^/]+' : segment.replace(SPECIAL, '\\$&')))
    .join('/');
  return new RegExp(`^/${source}/?$`);
}
```

**What's new (metadata and discovery)**
- **Why this class exists.** Express and Fastify told us directly "this path exists, but not with this method". Nest's router throws a plain `NotFoundException` for both cases. To answer 405 we need to know every route the app declares.
- **Decorators wrote metadata; here we read it back.** `@Controller('health')` stored `PATH_METADATA = 'health'` on the class, `@Get('live')` stored `PATH_METADATA = 'live'` and `METHOD_METADATA = GET` on the method. `Reflect.getMetadata(key, target)` reads them: this is the mechanism behind every Nest decorator.
- **`DiscoveryService`** (from `DiscoveryModule`, Step 3.6) lists every controller the container created; `MetadataScanner` lists a prototype's method names.
- **`OnApplicationBootstrap`** is a **lifecycle hook**: Nest calls `onApplicationBootstrap()` once every module is initialised, so all controllers are known. (Others you'll meet: `OnModuleInit`, `OnApplicationShutdown`.)
- `RequestMethod[method]` turns the numeric enum back into `'GET'`. `HEAD` is allowed wherever `GET` is, because Express answers HEAD with the GET handler.
- `API_PREFIX` is a constant every API controller uses in `@Controller()`. (Nest's `app.setGlobalPrefix()` would also work, but then Nest's own 404 handling wouldn't cover the root path; one constant keeps it explicit.)

> **🧠 DSA & scalability · method lookup for 405**
> - **Data structure:** an array of `{ pattern: RegExp, method }`, one per declared route, built once at startup from decorator metadata.
> - **Algorithm:** on a 404, test the path against every pattern; collect the methods of the matches; emit them in a fixed order.
> - **Complexity:** O(R) regex tests for R routes (~45 here), and **only for unmatched requests**: matched requests never touch it.
> - **Why it scales:** read-only after startup, so no locking; each instance builds its own.
> - **Rejected:** a radix tree keyed by path segments (faster, but more code for a cold path); listing allowed methods by hand per route (drifts from the controllers).

**`src/common/http/problem.filter.ts`** · new file

```ts
import {
  Catch,
  HttpException,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { isUniqueViolation } from '../pg-errors.js';
import { ProblemError, type ProblemSlug } from '../problem.js';
import { RouteTable } from './route-table.js';
import { sendProblem } from './send-problem.js';

/** Statuses Nest raises on its own (body parser, router, passport), mapped to our problem slugs. */
const BY_STATUS: Partial<Record<number, ProblemSlug>> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  413: 'payload-too-large',
  415: 'unsupported-media-type',
};

/** `@Catch()` with no arguments catches everything: the one place errors become responses. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  constructor(
    private readonly routes: RouteTable,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ProblemFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error({ err: exception }, 'unhandled error outside HTTP');
      return;
    }
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception, req, res);
    if (problem.status >= 500) this.logger.error({ err: exception }, 'unhandled error');
    sendProblem(req, res, problem);
  }
```

**`src/common/http/problem.filter.ts`** · continue

```ts

  private toProblem(exception: unknown, req: Request, res: Response): ProblemError {
    if (exception instanceof ProblemError) return exception;
    if (exception instanceof NotFoundException) return this.unmatched(req, res);
    if (exception instanceof HttpException) {
      const slug = BY_STATUS[exception.getStatus()];
      if (slug === 'bad-request') return new ProblemError(slug, 'Malformed JSON');
      if (slug) return new ProblemError(slug);
    }
    if (isUniqueViolation(exception)) {
      return new ProblemError('conflict', 'A resource with these values already exists');
    }
    return new ProblemError('internal', 'An unexpected error occurred');
  }

  /** Nest's router found no handler: either the path is unknown, or only the method is. */
  private unmatched(req: Request, res: Response): ProblemError {
    const allowed = this.routes.allowedMethods(req.path);
    if (allowed.length === 0) return new ProblemError('not-found', 'No route matches this path');
    res.set('Allow', allowed.join(', '));
    return new ProblemError('method-not-allowed', `${req.method} is not supported on this path`);
  }
}
```

**What's new (exception filters)**
- **An exception filter** catches errors thrown anywhere in the request pipeline (guards, pipes, handlers, services) and writes the response. **`@Catch()` with no arguments catches everything**; `@Catch(HttpException)` would catch only that class. ☕ This is Spring's `@ControllerAdvice` + `@ExceptionHandler`.
- **`ArgumentsHost`** abstracts over transports: the same filter could run for HTTP, WebSockets or microservices. `host.switchToHttp().getRequest<Request>()` gets the Express request.
- **Constructor injection.** The filter asks for `RouteTable` and `PinoLogger` by type; Nest creates them and passes them in. Nothing calls `new ProblemFilter(...)` yourself. **`PinoLogger`** is nestjs-pino's injectable logger; `setContext` names the class in each line.
- **Translation rules:** our `ProblemError` passes through; Nest's `NotFoundException` means "no route" (404 or 405); other `HttpException`s are mapped by status (the body parser throws a 400 for malformed JSON and a 413 for an oversized body); a unique violation that escaped a service is a 409; anything else is a 500 with the details logged, never sent.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: problem+json exception filter with 404 and 405`

### Step 3.5 · Configuration, Postgres and Redis as modules, and health checks

**Goal:** the module every process shares (config, logging, database, Redis), and `GET /health/live` / `GET /health/ready`.

**Files:** `src/database/database.module.ts`, `src/infra/redis.module.ts`, `src/core.module.ts`, `src/modules/health/health.controller.ts`, `src/modules/health/health.module.ts`

```bash
npm i -E @nestjs/config@12.1.1 @nestjs/typeorm@12.0.3 ioredis@5.11.1 @nestjs/swagger@12.1.1
npm deny-scripts @scarf/scarf
```

- **`@nestjs/config`** loads the environment into an injectable `ConfigService`, validated by our `validateEnv`. **`@nestjs/typeorm`** creates the TypeORM `DataSource` inside Nest's container and makes repositories injectable. **`ioredis` 5.x**, not 6: TypeORM 1.1 declares a peer dependency on ioredis 5 (for its optional Redis cache), and two majors in one tree would be confusing.

**`src/database/database.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.js';
import { dataSourceOptions } from './data-source-options.js';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        dataSourceOptions(config.get('DATABASE_URL', { infer: true })),
    }),
  ],
})
export class DatabaseModule {}
```

**What's new (modules)**
- **A module** is a class decorated with `@Module({ imports, providers, controllers, exports })`. It groups related providers and declares what it needs from other modules (`imports`) and what it offers them (`exports`). The app is a **tree of modules**; Nest builds a container from it. ☕ Spring's `@Configuration` classes play this role.
- **Dynamic modules:** `TypeOrmModule.forRootAsync({ ... })` is a method that *returns* a configured module. `forRoot` / `forRootAsync` is the convention for "configure this library once, at the root"; `Async` means the options come from a **factory** that can depend on other providers.
- **`inject: [ConfigService]` + `useFactory: (config) => ...`**: the factory's parameters are resolved from the container in that order. `ConfigService<Env, true>` types `config.get('DATABASE_URL', { infer: true })` as `string` (the `true` says "validated, so never undefined").
- **`@nestjs/swagger`** is here because controllers carry its `@ApiTags()` from the first one on; Step 3.6 explains it. Its `swagger-ui-dist` dependency pulls in `@scarf/scarf`, whose install script sends usage analytics; denying it changes nothing else.

**`src/infra/redis.module.ts`** · new file

```ts
import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

/** The injection token: `@Inject(REDIS) private readonly redis: Redis`. */
export const REDIS = Symbol('REDIS');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        // BullMQ's blocking commands require maxRetriesPerRequest: null on the connection.
        new Redis(config.get('REDIS_URL', { infer: true }), { maxRetriesPerRequest: null }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onApplicationShutdown(): void {
    this.redis.disconnect();
  }
}
```

**What's new (providers and tokens)**
- **A provider** is anything the container can inject. A class with `@Injectable()` is the simplest (its type is its token). Here the provider is an **ioredis instance**, and a class type can't name *this particular* `Redis`, so we give it a **token**: `Symbol('REDIS')`. `{ provide: REDIS, inject, useFactory }` registers it; `@Inject(REDIS) private readonly redis: Redis` asks for it. ☕ Spring's `@Bean` method plus `@Qualifier`.
- **`@Global()`** makes the module's exports available everywhere without importing the module. Use it sparingly: Redis is a true app-wide resource, so it qualifies. (`ConfigModule` and nestjs-pino's `LoggerModule` are global too.)
- **The module itself is injectable**: its constructor receives the client, and `onApplicationShutdown()` (a lifecycle hook) disconnects it when the app closes.
- `maxRetriesPerRequest: null` is BullMQ's requirement (Part 5) for the connection it shares.

**`src/core.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { loggerOptions } from './infra/logger.js';
import { RedisModule } from './infra/redis.module.js';

/** What every process needs, API and worker alike: configuration, logging, Postgres, Redis. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        loggerOptions({ LOG_LEVEL: config.get('LOG_LEVEL', { infer: true }) }),
    }),
    DatabaseModule,
    RedisModule,
  ],
})
export class CoreModule {}
```

**What's new**
- **`ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })`** reads `process.env` (and `.env`: `@nestjs/config` loads the file itself), runs it through our function, and makes `ConfigService` injectable everywhere. Invalid config stops the app before it opens a port.
- **`LoggerModule.forRootAsync`** builds the pino options from config.
- **`CoreModule`** bundles what *every* process needs. The API (Step 3.6) and the background worker (Part 11) both import it, so they can't disagree about config, logging or connections.

**`src/modules/health/health.controller.ts`** · new file

```ts
import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Redis } from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../../infra/redis.module.js';
```

**`src/modules/health/health.controller.ts`** · continue

```ts

const TIMEOUT_MS = 1000;
type Status = 'ok' | 'unavailable';

async function check(probe: () => Promise<unknown>): Promise<Status> {
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

**`src/modules/health/health.controller.ts`** · continue

```ts
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get('live')
  live(): { status: Status } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      check(() => this.dataSource.query('SELECT 1')),
      check(() => this.redis.ping()),
    ]);
    const ok = database === 'ok' && redis === 'ok';
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'unavailable', checks: { database, redis } };
  }
}
```

**`src/modules/health/health.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({ controllers: [HealthController] })
export class HealthModule {}
```

**What's new (controllers)**
- **`@Controller('health')`** declares a class whose methods handle routes under `/health`; **`@Get('live')`** maps `GET /health/live` to `live()`. A handler **returns** its response body; Nest serialises it to JSON with status 200 (201 for `@Post`). ☕ `@RestController` + `@GetMapping`.
- **Constructor injection again:** `DataSource` is injectable because `TypeOrmModule.forRootAsync` registered it; `Redis` comes through the `REDIS` token.
- **`@Res({ passthrough: true }) res`** gives you the Express response to set the status (503 when a dependency is down) **while still returning the body** for Nest to send. Without `passthrough`, injecting `@Res()` means you must send the response yourself.
- `@ApiTags('health')` groups the routes in the generated docs (Step 3.6).
- `check()` races each probe against a 1-second timeout, so a hung database makes readiness fail fast instead of hanging the probe.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: core module and health endpoints`

### Step 3.6 · The app module, `main.ts` and the docs

**Goal:** the root module, the app's configuration (middleware, CORS, body parser), Swagger UI at `/docs`, and the entry point. After this step `npm run dev` serves the health endpoints.

**Files:** `src/docs.ts`, `nest-cli.json`, `src/app.module.ts`, `src/app.setup.ts`, `src/main.ts`, `contract/openapi.yaml`

```bash
mkdir -p contract && cp ../openapi.yaml contract/openapi.yaml   # the master contract
```

- **`@nestjs/swagger`** (installed in Step 3.5) builds an OpenAPI document from controllers and DTO classes and serves Swagger UI.

**`src/docs.ts`** · new file

```ts
import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * Builds an OpenAPI document from the controllers and DTO classes and serves Swagger UI at
 * /docs (the JSON at /docs-json). It documents this implementation; the hand-written
 * contract/openapi.yaml stays the source of truth, and the contract test compares the two.
 */
export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('TaskFlow API (NestJS)')
    .setDescription('Generated from code. The contract lives in contract/openapi.yaml.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
}
```

**`nest-cli.json`** · add after `"deleteOutDir": true,`

```json
    "plugins": [{ "name": "@nestjs/swagger", "options": { "dtoFileNameSuffix": [".dto.ts"] } }],
```

**What's new**
- **Generated docs, not the contract.** Express and Fastify served the hand-written `contract/openapi.yaml`. Nest's idiom is to generate the document from code, so `/docs` shows what this implementation actually declares. The contract stays the source of truth: Schemathesis (Part 12) checks the running API against `contract/openapi.yaml`.
- **The CLI plugin** (`nest-cli.json`) reads each `*.dto.ts` file at compile time and adds Swagger metadata for every property from its TypeScript type, so DTOs don't need an `@ApiProperty()` on each field. It runs inside `nest build`; type checking and tests don't need it.

**`src/app.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE, DiscoveryModule } from '@nestjs/core';
import { ProblemFilter } from './common/http/problem.filter.js';
import { RouteTable } from './common/http/route-table.js';
import { RequestValidationPipe } from './common/validation/request-validation.pipe.js';
import { CoreModule } from './core.module.js';
```

**`src/app.module.ts`** · continue

```ts
import { HealthModule } from './modules/health/health.module.js';
```

**`src/app.module.ts`** · continue

```ts

@Module({
  imports: [
    CoreModule,
    DiscoveryModule,
    HealthModule,
```

**`src/app.module.ts`** · continue

```ts
  ],
  providers: [
    RouteTable,
    { provide: APP_FILTER, useClass: ProblemFilter },
    { provide: APP_PIPE, useClass: RequestValidationPipe },
  ],
})
export class AppModule {}
```

**What's new**
- **`AppModule` is the root of the tree.** It imports `CoreModule`, Nest's `DiscoveryModule` (for `RouteTable`) and the feature modules; each Part adds its module here.
- **`APP_FILTER` and `APP_PIPE` are special tokens**: a provider registered under them becomes **global**, applied to every route, and (unlike `app.useGlobalFilters(new X())`) is created by the container, so it can inject dependencies: the filter gets `RouteTable` and `PinoLogger`.
- `RouteTable` is a plain provider here; the filter asks for it by type.

**`src/app.setup.ts`** · new file

```ts
import type { NestApplicationOptions } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
```

**`src/app.setup.ts`** · continue

```ts
import { Logger } from 'nestjs-pino';
import { jsonBodiesOnly, requestContext } from './common/http/request-context.js';
import type { Env } from './config/env.js';
import { setupDocs } from './docs.js';
```

**`src/app.setup.ts`** · continue

```ts

/** Passed to NestFactory.create() and to the test module, so both build the same app. */
export const APP_OPTIONS: NestApplicationOptions = {
  // Hold Nest's start-up log lines until our pino logger is installed, then flush them through it.
  bufferLogs: true,
  // We register the JSON parser ourselves below, with our own limit and nothing else.
  bodyParser: false,
};

/** Everything `main.ts` and the tests must agree on. Call it before `app.listen()` / `app.init()`. */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');

  // Plain Express middleware, in order. These run before Nest's router, for every request.
  app.use(requestContext);
  app.enableCors({
    origin: config.get('FRONTEND_URL', { infer: true }),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    exposedHeaders: ['X-Request-Id', 'Retry-After'],
    maxAge: 600,
  });
  app.use(jsonBodiesOnly);
  app.useBodyParser('json', { limit: '1mb' });
```

**`src/app.setup.ts`** · continue

```ts

```

**`src/app.setup.ts`** · continue

```ts
  if (config.get('NODE_ENV', { infer: true }) !== 'production') setupDocs(app);
  // Run OnApplicationShutdown hooks on SIGTERM / SIGINT, so connections close cleanly.
  app.enableShutdownHooks();
}
```

**What's new**
- **`bufferLogs: true`** holds Nest's start-up messages until `app.useLogger(app.get(Logger))` installs pino, so they come out as JSON too. `app.get(X)` pulls any provider out of the container.
- **`bodyParser: false`**, then `app.useBodyParser('json', { limit: '1mb' })`: Nest would register JSON *and* urlencoded parsers by default. The API takes only JSON, capped at 1 MB (larger is a 413).
- **Order matters, as in Express:** request ID and headers → CORS (which also answers preflight `OPTIONS` requests) → 415 check → JSON parser. `app.use()` registers Express middleware on the underlying Express app.
- **`enableShutdownHooks()`** makes Nest call every `onApplicationShutdown()` on SIGTERM, so Redis and Postgres connections close before the process exits.
- `configureApp` is a function, not inline in `main.ts`, because the tests (next step) build the same app.

**`src/main.ts`** · new file

```ts
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, APP_OPTIONS);
configureApp(app);
const config = app.get<ConfigService<Env, true>>(ConfigService);
await app.listen(config.get('PORT', { infer: true }), '0.0.0.0');
```

**What's new**
- **`NestFactory.create(AppModule)`** reads the module tree, creates every provider in dependency order, and returns the app; `app.listen()` starts the HTTP server. `NestExpressApplication` types the Express-specific methods (`useBodyParser`, `disable`).
- `'0.0.0.0'` listens on every interface, which Docker needs (Part 13).

> **🧠 DSA & scalability · the DI container**
> - **Data structure:** a graph of modules, each holding a map from **token** (a class or a symbol) to a provider definition, plus the created instances.
> - **Algorithm:** at start-up Nest walks the module tree, reads each provider's constructor parameter types (`design:paramtypes`) and `@Inject()` tokens, resolves them through the module's own providers, its imports' exports and the global modules, and creates instances in dependency order. Instances are **singletons** by default: one `UsersService` for the whole app.
> - **Complexity:** O(P + E) for P providers and E dependency edges, once at start-up; per request, nothing (handlers get already-built instances).
> - **Why it matters for scale:** singletons are shared by all concurrent requests, so they must not keep per-request state in fields; everything request-specific travels as arguments.
> - **Rejected:** request-scoped providers (Nest supports them, but they're rebuilt per request, and the scope spreads to everything that injects them).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s localhost:8003/health/ready; echo
curl -s -i -X POST localhost:8003/health/live | grep -iE '^(HTTP|allow)'
curl -s localhost:8003/nope; echo
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
Allow: GET, HEAD
{"type":"https://taskflow.example/problems/not-found","title":"Not found","status":404,"detail":"No route matches this path","instance":"/nope","requestId":"01a1…"}
```

The dev terminal prints JSON lines (`"msg":"Mapped {/health/live, GET} route"`, then `"Nest application successfully started"`), and http://localhost:8003/docs shows Swagger UI.

**Commit:** `feat: app module, configuration and server entry point`

### Step 3.7 · The test harness

**Goal:** integration tests that build the real app through Nest's testing module, against a separate test database and Redis database.

**Files:** `vitest.config.ts`, `test/test-env.ts`, `test/global-setup.ts`, `test/helpers.ts`, `test/health.e2e-spec.ts`

```bash
npm i -D -E @nestjs/testing@12.4.2 supertest@7.3.2 @types/supertest@7.2.1 @vitest/coverage-v8@5.1.0
```

- **`@nestjs/testing`** compiles a module tree for a test, where you can override providers. **`supertest`** sends HTTP requests to a server object without opening a port (the same library Express used). **`@vitest/coverage-v8`** powers `npm run test:coverage`.

**`test/test-env.ts`** · new file

```ts
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');

/** Tests never touch the dev database: same server, database name suffixed with _test. */
function testDatabaseUrl(): string {
  const url = new URL(
    process.env.DATABASE_URL ?? 'postgresql://taskflow:taskflow@localhost:15403/taskflow',
  );
  url.pathname = `${url.pathname}_test`;
  return url.toString();
}

/** Redis logical database 1 instead of 0. */
function testRedisUrl(): string {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:16303/0');
  url.pathname = '/1';
  return url.toString();
}

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: testDatabaseUrl(),
  REDIS_URL: testRedisUrl(),
```

**`test/test-env.ts`** · continue

```ts
};
```

**`vitest.config.ts`** · add after `import { defineConfig } from 'vitest/config';`

```ts
import { testEnv } from './test/test-env.js';
```

**`vitest.config.ts`** · add after `test: {`

```ts
    env: testEnv,
```

**`vitest.config.ts`** · add after `include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],`

```ts
    globalSetup: ['test/global-setup.ts'],
```

**`vitest.config.ts`** · add after `setupFiles: ['reflect-metadata'],`

```ts
    // Integration tests share one database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/worker.ts',
        'src/migrate.ts',
```

**`vitest.config.ts`** · add after `'src/migrate.ts',`

```ts
        'src/database/data-source.ts',
        'src/database/migrations/**',
      ],
      reporter: ['text-summary', 'html', 'lcov'],
    },
```

**What's new**
- **The test environment is computed from yours:** the same Postgres server with `_test` appended to the database name, Redis database 1, silent logs. Vitest's `env` sets these before any test file runs, so `ConfigModule` reads them.
- `fileParallelism: false`: test files share one database and truncate it, so they run one at a time.

**`test/global-setup.ts`** · new file

```ts
import pg from 'pg';
import { DataSource } from 'typeorm';
```

**`test/global-setup.ts`** · continue

```ts
import { dataSourceOptions } from '../src/database/data-source-options.js';
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

  const dataSource = new DataSource(dataSourceOptions(testEnv.DATABASE_URL));
  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();

```

**`test/global-setup.ts`** · continue

```ts
}
```

**What's new**
- **`globalSetup` runs once, before every test file**, in its own context: create `taskflow_test` if it doesn't exist (connected to the `postgres` maintenance database, because you can't create the database you're connected to), then apply the migrations with a throwaway `DataSource`. That's why the migration's metadata row had to use `current_database()`.

**`test/helpers.ts`** · new file

```ts
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
```

**`test/helpers.ts`** · continue

```ts
import type { Redis } from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { expect } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { APP_OPTIONS, configureApp } from '../src/app.setup.js';
import type { Env } from '../src/config/env.js';
```

**`test/helpers.ts`** · continue

```ts
import { REDIS } from '../src/infra/redis.module.js';
```

**`test/helpers.ts`** · continue

```ts

export interface TestContext {
  app: NestExpressApplication;
  server: Server;
  /** Set when the context was created with `listen: true`. */
  port: number;
  config: ConfigService<Env, true>;
  dataSource: DataSource;
  redis: Redis;
```

**`test/helpers.ts`** · continue

```ts
  close: () => Promise<void>;
}

/**
 * Builds the real AppModule through Nest's testing module: same providers, same wiring.
 * Supertest talks to the HTTP server directly, so most tests need no port; the WebSocket
 * tests pass `listen: true` to get one. `imports` adds modules the API doesn't load itself.
 */
export async function createTestContext(
  options: { listen?: boolean; imports?: Type[] } = {},
): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>(APP_OPTIONS);
  configureApp(app);
  if (options.listen) await app.listen(0, '127.0.0.1');
  else await app.init();
  const server: Server = app.getHttpServer();
  return {
    app,
    server,
    port: options.listen ? (server.address() as AddressInfo).port : 0,
    config: app.get<ConfigService<Env, true>>(ConfigService),
    dataSource: app.get(DataSource),
    redis: app.get<Redis>(REDIS),
```

**`test/helpers.ts`** · continue

```ts
    close: () => app.close(),
  };
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SendOptions {
  as?: { auth: Record<string, string> };
  body?: string | object;
  headers?: Record<string, string>;
  query?: Record<string, string | number>;
}

/** What the tests read from a response: the same shape in every TaskFlow backend's test suite. */
export interface TestResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- like fetch's res.json()
  json: <T = unknown>() => T;
}

/**
 * One request through Supertest. Pass `status` to assert it; on a mismatch the failure
 * message shows the response body.
 */
export async function send(
  ctx: TestContext,
  method: Method,
  url: string,
  options: SendOptions = {},
  status?: number,
): Promise<TestResponse> {
  let req = request(ctx.server)
    [method.toLowerCase() as Lowercase<Method>](url)
    .set({ ...options.as?.auth, ...options.headers });
  if (options.query) req = req.query(options.query);
  if (options.body !== undefined) req = req.send(options.body);
  const res = await req;
  if (status !== undefined) expect(res.status, `${method} ${url}: ${res.text}`).toBe(status);
  return {
    status: res.status,
    headers: res.headers,
    text: res.text,
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    json: <T>() => res.body as T,
  };
}
```

**What's new**
- **`Test.createTestingModule({ imports: [AppModule] }).compile()`** builds the real module tree; `createNestApplication()` turns it into an app like `NestFactory.create` does, and `configureApp(app)` applies the same middleware. `app.init()` runs the lifecycle hooks without listening; Supertest calls the HTTP server directly. (Later tests pass `listen: true` for WebSockets, and `imports` to add modules the API doesn't load.)
- **`send()`** is the same helper as in the other two repos, so the test files read alike across all three: one call, optional expected status, and on mismatch the failure shows the response body. `request(ctx.server)[method](url)` picks Supertest's method by name.

**`test/health.e2e-spec.ts`** · new file

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { createTestContext, send } from './helpers.js';

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

  it('answers 400 to malformed JSON, 415 to non-JSON and 413 to oversized bodies', async () => {
    const json = { 'Content-Type': 'application/json' };
    await send(ctx, 'POST', '/health/live', { headers: json, body: '{"email":' }, 400);
    const text = { 'Content-Type': 'text/plain' };
    await send(ctx, 'POST', '/health/live', { headers: text, body: 'hi' }, 415);
    const huge = JSON.stringify({ blob: 'x'.repeat(1_100_000) });
    await send(ctx, 'POST', '/health/live', { headers: json, body: huge }, 413);
  });
});
```

**What's new**
- **Top-level `await` in a test file** builds the app once per file; `afterAll(() => ctx.close())` shuts it down (closing Postgres and Redis).
- These five tests cover Part 3: liveness, readiness, 404 with the echoed request ID, 405 with `Allow`, and the body errors (400 malformed JSON, 415 non-JSON, 413 too large).

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  3 passed (3)
      Tests  10 passed (10)
```

**Commit:** `test: vitest harness with the nest testing module and health tests`

---
## Part 4 · Authentication

The auth design (README §6) is unchanged: argon2id passwords, 15-minute JWT access tokens, and 7-day refresh tokens that rotate on every use, are stored hashed in Redis, and revoke their whole family when replayed. What changes is how Nest plugs it in: a **Passport strategy**, a **global guard** that protects every route unless it's marked `@Public()`, **custom parameter decorators**, and a guard for rate limiting.

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
- Identical to Express and Fastify: this file doesn't touch the framework.

> **🧠 DSA & scalability · password hashing**
> - **Algorithm:** argon2id, a *memory-hard* hash: each verification fills 19 MiB of RAM and makes 2 passes over it.
> - **Why memory-hard:** attackers guess passwords on GPUs with thousands of cores but little memory per core; 19 MiB per guess caps how many run in parallel. bcrypt is only CPU-hard, and SHA-256 is designed to be fast, the opposite of what you want.
> - **Cost:** ~20–50 ms of CPU per login, on purpose. Logins are rare, and `/auth/*` gets a strict rate limit (Step 4.6).
> - **Timing side channel:** `verifyAgainstDummy` makes "no such email" do the same work as "wrong password", so response times don't reveal which emails have accounts.
> - **Rejected:** bcrypt (72-byte limit, not memory-hard), PBKDF2 (CPU-hard only), plain SHA-256 (fast = crackable).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: argon2id password hashing`

### Step 4.2 · Access tokens: a Passport strategy, a global guard and `@Public()`

**Goal:** verify the `Authorization: Bearer` token on every request, unless the route opts out.

**Files:** `src/modules/auth/jwt.strategy.ts`, `src/modules/auth/decorators.ts`, `src/modules/auth/jwt-auth.guard.ts`

```bash
npm i -E @nestjs/jwt@12.0.4 @nestjs/passport@12.0.1 passport@0.7.0 passport-jwt@4.0.1
npm i -D -E @types/passport-jwt@4.0.1
```

- **Passport** is Node's classic authentication library: each way of authenticating is a **strategy** (`passport-jwt` for bearer tokens, `passport-google-oauth20` for Google, …). **`@nestjs/passport`** wraps strategies as injectable classes and turns them into guards. **`@nestjs/jwt`** wraps `jsonwebtoken` as an injectable `JwtService` for **signing** (Step 4.7).
- Why Passport, when `jsonwebtoken` alone would do? It's Nest's documented way to authenticate, and adding a second login method later means adding a strategy, not rewriting the guard.

**`src/modules/auth/jwt.strategy.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../../config/env.js';

export const ISSUER = 'taskflow';
export const AUDIENCE = 'taskflow-api';

/**
 * Passport's "jwt" strategy: finds the Bearer token, verifies signature, expiry, issuer and
 * audience, then calls validate(). Whatever validate() returns becomes `request.user`.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      // The typings flag this option as deprecated for issuer/audience; clockTolerance has no other home.
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      jsonWebTokenOptions: { clockTolerance: 30 },
    });
  }

  validate(payload: { sub: string }): { id: string } {
    return { id: payload.sub };
  }
}
```

**What's new**
- **`PassportStrategy(Strategy)`** is a **mixin**: a function that returns a class, so `extends PassportStrategy(Strategy)` creates an injectable Nest class from passport-jwt's `Strategy`. The `super({...})` options tell passport-jwt where the token is (`fromAuthHeaderAsBearerToken()`), the secret, and what to check: `HS256` only (so a token claiming `alg: none` is rejected), issuer `taskflow`, audience `taskflow-api`, 30 seconds of clock tolerance.
- **`validate(payload)`** runs only after the signature and claims check out. **Whatever it returns becomes `request.user`**: here `{ id }` from the `sub` claim. No database lookup: the token is enough.

**`src/modules/auth/decorators.ts`** · new file

```ts
import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { unauthorized } from '../../common/problem.js';

export const IS_PUBLIC = 'isPublic';

/** Marks a controller or handler as reachable without an access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** `@CurrentUser() userId: string`: the authenticated user's id, set by the JWT strategy. */
export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const { user } = context.switchToHttp().getRequest<Request>();
  if (!user) throw unauthorized();
  return user.id;
});

/** `@Cookie('refresh_token') token?: string`: a cookie's value, or undefined when absent or empty. */
export const Cookie = createParamDecorator((name: string, context: ExecutionContext) => {
  const cookies = context.switchToHttp().getRequest<Request>().cookies as Record<string, string>;
  return cookies[name] || undefined;
});
```

**What's new**
- **`SetMetadata(key, value)`** is the simplest decorator factory: it attaches a key/value to a class or method. `@Public()` attaches `isPublic: true`; the guard below reads it.
- **`createParamDecorator`** makes a **parameter decorator** like `@Body()`: Nest calls the function with the decorator's argument and the `ExecutionContext`, and passes the result to the handler. `@CurrentUser() userId: string` hands a handler the signed-in user's id; `@Cookie('refresh_token')` hands it a cookie. Controllers never touch `req`.

**`src/modules/auth/jwt-auth.guard.ts`** · new file

```ts
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { unauthorized } from '../../common/problem.js';
import { IS_PUBLIC } from './decorators.js';

/**
 * Registered globally, so every route requires a valid access token unless it (or its
 * controller) is marked @Public(). Secure by default: forgetting a decorator locks a route.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }

  /** Passport calls this with the strategy's result; `info` says why there is no user. */
  override handleRequest<TUser>(err: unknown, user: TUser | false, info: unknown): TUser {
    if (err || !user) {
      const missing = info instanceof Error && info.message === 'No auth token';
      throw unauthorized(missing ? undefined : 'Invalid or expired access token');
    }
    return user;
  }
}
```

**What's new (guards)**
- **A guard** decides whether a request may reach its handler: `canActivate()` returns `true`, `false` (a 403) or throws. Guards run **after middleware and before pipes**, and unlike middleware they know **which handler** will run (`context.getHandler()`, `context.getClass()`), so they can read its metadata. ☕ Spring Security's filter chain and `@PreAuthorize`.
- **`AuthGuard('jwt')`** is @nestjs/passport's guard for the strategy named `jwt` (passport-jwt's default name). We extend it: **`Reflector.getAllAndOverride(IS_PUBLIC, [handler, class])`** reads `@Public()` from the method first, then the controller. Public routes skip the strategy; everything else runs it.
- **`handleRequest(err, user, info)`** is where Passport reports the outcome. `info` says why there's no user (`No auth token`, `jwt expired`, `invalid signature`); we turn every failure into our 401 problem.
- **Secure by default.** The guard will be registered **globally** (Step 4.7), so a new controller is protected the moment it exists, and forgetting a decorator locks a route rather than exposing it. Express and Fastify did the opposite (attach the auth middleware/hooks to a group); there, forgetting it exposes a route.

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

**Commit:** `feat: passport jwt strategy, global auth guard and @Public()`

### Step 4.3 · Refresh-token rotation in Redis

**Goal:** opaque refresh tokens, stored as SHA-256 hashes, rotated atomically on every use, with reuse detection.

**Files:** `src/modules/auth/refresh-tokens.service.ts`

**`src/modules/auth/refresh-tokens.service.ts`** · new file

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';
import type { Env } from '../../config/env.js';
import { REDIS } from '../../infra/redis.module.js';

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

export type RotateResult = { status: 'ok'; userId: string; token: string } | { status: 'invalid' };

```

**`src/modules/auth/refresh-tokens.service.ts`** · continue

```ts
@Injectable()
export class RefreshTokens {
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService<Env, true>,
  ) {
    this.ttlSeconds = config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }

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
- The Redis logic is Express's. The Nest part is the wrapper: an **`@Injectable()` service** that receives the Redis client by token (`@Inject(REDIS)`) and the config by type, and reads the TTL once in its constructor.

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

### Step 4.4 · The users service and DTOs

**Goal:** the user table's queries in one injectable service, and the public shape of a user.

**Files:** `src/modules/users/user.dto.ts`, `src/modules/users/users.service.ts`

**`src/modules/users/user.dto.ts`** · new file

```ts
import { IsString, Length } from 'class-validator';
import { IsOmittable, Trim } from '../../common/validation/decorators.js';

export class UpdateUserDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  displayName?: string;
}

export class UserSummaryDto {
  id: string;
  email: string;
  displayName: string;
}

export class UserDto extends UserSummaryDto {
  createdAt: string;
}

/** Explicit field-by-field mapping: nothing reaches the wire unless it's listed here. */
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
- **Input DTOs and output DTOs are both classes.** `UpdateUserDto` has validation decorators: the global pipe builds and checks it. `UserSummaryDto` and `UserDto` have none: they exist so the Swagger plugin can document responses, and so `extends` can reuse fields (`UserDto` = summary + `createdAt`).
- The mappers pick fields explicitly, so an entity's `passwordHash` can never reach a response, and turn `Date`s into ISO strings.

**`src/modules/users/users.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../../database/entities/user.entity.js';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  /** The only query that reads the password hash: the column is `select: false`. */
  findByEmailWithPassword(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email })
      .getOne();
  }

  findByIds(ids: string[]): Promise<User[]> {
    return this.users.findBy({ id: In(ids) });
  }

  create(data: { email: string; passwordHash: string; displayName: string }): Promise<User> {
    return this.users.save(this.users.create(data));
  }

  async update(id: string, data: { displayName?: string }): Promise<User | null> {
    await this.users.update({ id }, data);
    return this.findById(id);
  }
}
```

**What's new (TypeORM repositories)**
- **`@InjectRepository(User)`** asks for TypeORM's `Repository<User>`, the object you query a table through. It exists because the module will call `TypeOrmModule.forFeature([User])` (Step 4.7). ☕ Spring Data's `JpaRepository<User, UUID>`, except you don't write an interface: TypeORM gives you the generic one.
- **`findOneBy({ id })`** is `SELECT … WHERE id = $1 LIMIT 1`, returning the entity or `null`. `findBy({ id: In(ids) })` uses a **find operator** for `IN (…)`.
- **The query builder** (`createQueryBuilder('user')`) is TypeORM's SQL-like API, for what `find` options can't say. `.addSelect('user.passwordHash')` adds the `select: false` column for the one query that needs it; `:email` is a **named parameter**, sent separately from the SQL, so there's no injection.
- **`save(create(data))`**: `create` builds an entity instance from a plain object (no SQL), `save` INSERTs it and returns it with database defaults (`id`, timestamps) filled in. `update(criteria, data)` is a single `UPDATE` that doesn't return the row, hence the `findById` after it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: users service and dtos`

### Step 4.5 · The auth service and its DTOs

**Goal:** register, login, refresh and logout as plain business logic, independent of HTTP.

**Files:** `src/modules/auth/auth.dto.ts`, `src/modules/auth/auth.service.ts`

**`src/modules/auth/auth.dto.ts`** · new file

```ts
import { IsEmail, IsString, Length, MaxLength } from 'class-validator';
import { ToLowerCase, Trim } from '../../common/validation/decorators.js';
import { UserDto } from '../users/user.dto.js';

export class RegisterDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(8, 128)
  password: string;

  @Trim()
  @IsString()
  @Length(1, 80)
  displayName: string;
}

export class LoginDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @Length(1, 128)
  password: string;
}

export class AccessTokenDto {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export class AuthSessionDto extends AccessTokenDto {
  user: UserDto;
}
```

**`src/modules/auth/auth.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { conflict, unauthorized } from '../../common/problem.js';
import type { User } from '../../database/entities/user.entity.js';
import { toUser, type UserDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords.js';
import { RefreshTokens } from './refresh-tokens.service.js';

/** The service proves who you are; the controller turns that into an access token and a cookie. */
export interface Session {
  user: UserDto;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly refreshTokens: RefreshTokens,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<Session> {
    if (await this.users.findByEmailWithPassword(input.email)) {
      throw conflict('Email is already registered');
    }
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash: await hashPassword(input.password),
    });
    return this.startSession(user);
  }

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findByEmailWithPassword(email);
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

  private async startSession(user: User): Promise<Session> {
    return { user: toUser(user), refreshToken: await this.refreshTokens.issue(user.id) };
  }
}
```

**What's new**
- **`@ToLowerCase()` runs before `@IsEmail()`**, so emails are stored and compared in one case (the database's `CHECK (email = lower(email))` backs it up).
- The service depends on two other services through its constructor; Nest wires them. It knows nothing about cookies or JWTs: it proves who you are and returns the new refresh token, and the controller (Step 4.7) turns that into an access token and a cookie, as in Fastify.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: auth service and dtos`

### Step 4.6 · Sliding-window rate limiting as a guard

**Goal:** 10 auth requests per minute per IP, 300 API requests per minute per user, shared by every instance through Redis.

**Files:** `src/common/rate-limit/sliding-window-limiter.ts`, `src/common/rate-limit/rate-limit.guard.ts`

**`src/common/rate-limit/sliding-window-limiter.ts`** · new file

```ts
import type { Redis } from 'ioredis';
import { v7 as uuidv7 } from 'uuid';

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

**`src/common/rate-limit/rate-limit.guard.ts`** · new file

```ts
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import type { Env } from '../../config/env.js';
import { REDIS } from '../../infra/redis.module.js';
import { ProblemError } from '../problem.js';
import { SlidingWindowLimiter, type RateLimitResult } from './sliding-window-limiter.js';

const MINUTE = 60_000;
const RATE_LIMIT = 'rateLimit';

/** `@RateLimit('auth')`: count this route per IP address in the strict "auth" bucket. */
export const RateLimit = (bucket: 'auth') => SetMetadata(RATE_LIMIT, bucket);

/**
 * Runs after JwtAuthGuard (guards run in the order they are registered), so `request.user`
 * is already known: signed-in requests are counted per user, @RateLimit('auth') routes per IP.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly auth: SlidingWindowLimiter;
  private readonly api: SlidingWindowLimiter;

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) redis: Redis,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RateLimitGuard.name);
    const perMinute = (name: 'RATE_LIMIT_AUTH_PER_MINUTE' | 'RATE_LIMIT_API_PER_MINUTE') =>
      new SlidingWindowLimiter(redis, config.get(name, { infer: true }), MINUTE);
    this.auth = perMinute('RATE_LIMIT_AUTH_PER_MINUTE');
    this.api = perMinute('RATE_LIMIT_API_PER_MINUTE');
  }

```

**`src/common/rate-limit/rate-limit.guard.ts`** · continue

```ts
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const bucket = this.reflector.get<'auth' | undefined>(RATE_LIMIT, context.getHandler());
    // Public routes without @RateLimit (health checks, logout) aren't counted.
    if (!bucket && !req.user) return true;

    const [limiter, key] =
      bucket === 'auth' || !req.user
        ? [this.auth, `ratelimit:auth:ip:${req.ip ?? 'unknown'}`]
        : [this.api, `ratelimit:api:user:${req.user.id}`];
    let result: RateLimitResult;
    try {
      result = await limiter.hit(key);
    } catch (err) {
      this.logger.warn({ err }, 'rate limiter unavailable; failing open');
      return true;
    }
    if (result.allowed) return true;
    http.getResponse<Response>().set('Retry-After', String(result.retryAfterSeconds));
    throw new ProblemError('rate-limited', `Retry in ${result.retryAfterSeconds} seconds`);
  }
}
```

**What's new**
- The limiter class is Express's. The wrapper is a **second global guard**: guards run in registration order, so it runs after `JwtAuthGuard` and already knows `req.user`. Signed-in requests count per user; `@RateLimit('auth')` routes (login, register, refresh) count per IP in the strict bucket; other public routes (health checks, logout) aren't counted.
- **`this.reflector.get(RATE_LIMIT, context.getHandler())`** reads the handler's `@RateLimit()` metadata, the same mechanism as `@Public()`.
- **Why not `@nestjs/throttler`?** It's Nest's official rate-limit module and a fine choice for most apps. Its Redis storage counts requests in **fixed windows**, while TaskFlow's README asks for a **sliding window**, and we want the same algorithm in all six backends so the comparison stays fair.

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

**Commit:** `feat: redis sliding-window rate limit guard`

### Step 4.7 · Controllers, modules, and wiring it all up

**Goal:** `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and `/users/me`, with the two guards installed globally.

**Files:** `src/app.setup.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/users/users.controller.ts`, `src/modules/users/users.module.ts`, `src/modules/auth/auth.module.ts`, `src/app.module.ts`, `src/modules/health/health.controller.ts`

```bash
npm i -E cookie-parser@1.4.7
npm i -D -E @types/cookie-parser@1.4.10
```

- **`cookie-parser`** is the Express middleware that fills `req.cookies`, which `@Cookie()` reads. Nest runs on Express, so it's the same package the Express repo used.

**`src/app.setup.ts`** · add after `import type { NestExpressApplication } from '@nestjs/platform-express';`

```ts
import cookieParser from 'cookie-parser';
```

**`src/app.setup.ts`** · add after `app.useBodyParser('json', { limit: '1mb' });`

```ts
  app.use(cookieParser());
```

**`src/modules/auth/auth.controller.ts`** · new file

```ts
import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ApiTags } from '@nestjs/swagger';
import type { CookieOptions, Response } from 'express';
import { API_PREFIX } from '../../common/http/routes.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.guard.js';
import type { Env } from '../../config/env.js';
import { AuthService } from './auth.service.js';
import { Cookie, Public } from './decorators.js';
import { AccessTokenDto, AuthSessionDto, LoginDto, RegisterDto } from './auth.dto.js';

const COOKIE = 'refresh_token';

@Public()
@ApiTags('auth')
@Controller(`${API_PREFIX}/auth`)
export class AuthController {
  private readonly cookie: CookieOptions;
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlSeconds: number;

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.cookie = {
      httpOnly: true,
      secure: config.get('COOKIE_SECURE', { infer: true }),
      sameSite: 'lax',
      path: `/${API_PREFIX}/auth`,
    };
    this.accessTtlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    this.refreshTtlSeconds = config.get('REFRESH_TOKEN_TTL_SECONDS', { infer: true });
  }
```

**`src/modules/auth/auth.controller.ts`** · continue

```ts

  @RateLimit('auth')
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { user, refreshToken } = await this.auth.register(dto);
    this.setCookie(res, refreshToken);
    return { ...(await this.accessToken(user.id)), user };
  }

  @RateLimit('auth')
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthSessionDto> {
    const { user, refreshToken } = await this.auth.login(dto.email, dto.password);
    this.setCookie(res, refreshToken);
    return { ...(await this.accessToken(user.id)), user };
  }

  @RateLimit('auth')
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Cookie(COOKIE) token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccessTokenDto> {
    const { userId, refreshToken } = await this.auth.refresh(token);
    this.setCookie(res, refreshToken);
    return this.accessToken(userId);
  }
```

**`src/modules/auth/auth.controller.ts`** · continue

```ts

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Cookie(COOKIE) token: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(token);
    res.clearCookie(COOKIE, this.cookie);
  }

  private setCookie(res: Response, refreshToken: string): void {
    // Express counts maxAge in milliseconds (the Set-Cookie header itself uses seconds).
    res.cookie(COOKIE, refreshToken, { ...this.cookie, maxAge: this.refreshTtlSeconds * 1000 });
  }

  private async accessToken(userId: string): Promise<AccessTokenDto> {
    return {
      accessToken: await this.jwt.signAsync({}, { subject: userId }),
      tokenType: 'Bearer',
      expiresIn: this.accessTtlSeconds,
    };
  }
}
```

**What's new**
- **`@Public()` on the controller** applies to all four routes. **`@RateLimit('auth')`** on three of them.
- **`@Post()` defaults to 201**; `@HttpCode(200)` and `@HttpCode(204)` set the others.
- **`@Body() dto: RegisterDto`**: the global validation pipe sees the type `RegisterDto` and validates the body against it before the method runs. The method receives a **validated instance**.
- **`JwtService.signAsync({}, { subject: userId })`** signs with the defaults from `JwtModule.registerAsync` (below) plus the subject.
- `res.cookie(name, value, { maxAge })` counts **milliseconds** (Express's API); `clearCookie` must repeat the same `path`, or the browser keeps the cookie.
- The return type `Promise<AuthSessionDto>` is also what the Swagger plugin documents as the response.

**`src/modules/users/users.controller.ts`** · new file

```ts
import { Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/http/routes.js';
import { notFound } from '../../common/problem.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { CurrentUser } from '../auth/decorators.js';
import { toUser, UpdateUserDto, UserDto } from './user.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@Controller(`${API_PREFIX}/users`)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserDto> {
    const user = await this.users.findById(userId);
    if (!user) throw notFound('User');
    return toUser(user);
  }

  @Patch('me')
  async updateMe(@CurrentUser() userId: string, @PatchBody() dto: UpdateUserDto): Promise<UserDto> {
    const user = await this.users.update(userId, defined(dto));
    if (!user) throw notFound('User');
    return toUser(user);
  }
}
```

**`src/modules/users/users.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../database/entities/user.entity.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  // forFeature registers a Repository<User> provider that @InjectRepository(User) asks for.
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersService],
  // Providers are private to their module unless exported.
  exports: [UsersService],
})
export class UsersModule {}
```

**What's new**
- **`TypeOrmModule.forFeature([User])`** registers `Repository<User>` as a provider *in this module*: that's what `@InjectRepository(User)` resolves to.
- **`exports: [UsersService]`**: providers are private to their module. `AuthModule` imports `UsersModule` and can inject `UsersService` only because it's exported. ☕ Spring has no such walls by default (every bean is visible); Nest's modules are closer to Java modules' `exports`.
- `@PatchBody()` (Step 3.2) rejects an empty PATCH; `defined(dto)` passes only the fields sent.

**`src/modules/auth/auth.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard.js';
import type { Env } from '../../config/env.js';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AUDIENCE, ISSUER, JwtStrategy } from './jwt.strategy.js';
import { RefreshTokens } from './refresh-tokens.service.js';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          algorithm: 'HS256',
          issuer: ISSUER,
          audience: AUDIENCE,
          expiresIn: config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshTokens,
    JwtStrategy,
    // APP_GUARD makes a guard global, whichever module declares it. They run in this
    // order: first "who are you?", then "how often?".
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AuthModule {}
```

**What's new**
- **`JwtModule.registerAsync`** configures `JwtService` with the secret and default sign options (HS256, issuer, audience, 15-minute `expiresIn` in seconds). `registerAsync` is the per-module twin of `forRootAsync`.
- **`PassportModule`** registers Passport; listing `JwtStrategy` as a provider registers the strategy with Passport when Nest creates it.
- **`{ provide: APP_GUARD, useClass: JwtAuthGuard }`** makes the guard **global**, whichever module declares it; Nest's docs recommend declaring it next to the guard it registers. Two `APP_GUARD` providers in one module run in the order listed: authentication first, then rate limiting.

**`src/app.module.ts`** · add after `import { CoreModule } from './core.module.js';`

```ts
import { AuthModule } from './modules/auth/auth.module.js';
```

**`src/app.module.ts`** · add after `import { HealthModule } from './modules/health/health.module.js';`

```ts
import { UsersModule } from './modules/users/users.module.js';
```

**`src/app.module.ts`** · add after `HealthModule,`

```ts
    AuthModule,
    UsersModule,
```

**`src/modules/health/health.controller.ts`** · add after `import { REDIS } from '../../infra/redis.module.js';`

```ts
import { Public } from '../auth/decorators.js';
```

**`src/modules/health/health.controller.ts`** · add before `@ApiTags('health')`

```ts
@Public()
```

**What's new**
- The health checks get **`@Public()`** now that every route requires a token by default: a load balancer probing `/health/ready` has no token.

> **🧠 DSA & scalability · global guards and metadata**
> - **Data structure:** per handler, a metadata map written once by decorators (`isPublic`, `rateLimit`), and a list of global guards.
> - **Algorithm:** for each request, Nest runs the guards in order; each reads the handler's metadata through `Reflector` (a map lookup) and decides.
> - **Complexity:** O(guards) map lookups per request, plus the token's HMAC check on protected routes.
> - **Why it scales:** no per-request I/O to authenticate; the only shared state is the rate-limit sorted set in Redis.
> - **Rejected:** listing public paths in a guard (a path list drifts from the controllers); per-controller `@UseGuards()` (forgetting one exposes a route).

**✅ Checkpoint**

```bash
npm run dev
# in a second terminal:
curl -s -c /tmp/tf.cookies localhost:8003/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse","displayName":"Ada"}' | head -c 120; echo
curl -s -b /tmp/tf.cookies -X POST localhost:8003/api/v1/auth/refresh | head -c 60; echo
curl -s localhost:8003/api/v1/users/me; echo
```

Expected: a session starting `{"accessToken":"eyJ…","tokenType":"Bearer","expiresIn":900,"user":{…`, then `{"accessToken":"eyJ…` (refreshed with the cookie; curl, like browsers, sends `Secure` cookies to `localhost`), then a 401 problem: `{"type":"https://taskflow.example/problems/unauthorized",…,"detail":"Authentication required",…}`.

**Commit:** `feat: auth and users controllers behind a global guard`

### Step 4.8 · Auth tests

**Goal:** prove registration, validation, content types, login, rotation with reuse detection, logout, protection and rate limiting.

**Files:** `test/helpers.ts`, `test/auth.e2e-spec.ts`

**`test/helpers.ts`** · continue

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
  await ctx.dataSource.query(`TRUNCATE ${TABLES.join(', ')} CASCADE`);
  await ctx.redis.flushdb();
}

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
- `resetState` truncates every table (in one statement, `CASCADE` for the foreign keys) and flushes Redis database 1 before each test. Table names can't be bound parameters, so the list is ours, never user input.
- `registerUser` goes through the real API, so every test user has a real argon2 hash and a real token.

**`test/auth.e2e-spec.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, registerUser, resetState, send, type TestResponse } from './helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

/** The raw Set-Cookie header for the refresh token, and the `name=value` part to send back. */
function refreshCookie(res: TestResponse) {
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

**`test/auth.e2e-spec.ts`** · continue

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
    expect(res.json()).not.toHaveProperty('user.passwordHash');
    const { header } = refreshCookie(res);
    expect(header).toMatch(/HttpOnly/);
    expect(header).toMatch(/Secure/);
    expect(header).toMatch(/SameSite=Lax/);
    expect(header).toMatch(/Path=\/api\/v1\/auth/);
    expect(header).toMatch(/Max-Age=604800/);
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

**`test/auth.e2e-spec.ts`** · continue

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

  it('never coerces body types and ignores unknown fields', async () => {
    const body = { email: 'typed@example.com', password: 12345678, displayName: 'Ada' };
    const res = await send(ctx, 'POST', '/api/v1/auth/register', { body }, 422);
    expect(res.json()).toMatchObject({ errors: [{ field: 'password' }] });
    const extra = { ...body, password: 'correct-horse', isAdmin: true };
    await send(ctx, 'POST', '/api/v1/auth/register', { body: extra }, 201);
  });

  it('returns 400 for malformed JSON, 415 for non-JSON bodies, 405 for other methods', async () => {
    const login = '/api/v1/auth/login';
    const json = { 'Content-Type': 'application/json' };
    await send(ctx, 'POST', login, { headers: json, body: '{"email":' }, 400);
    await send(ctx, 'POST', login, { headers: { 'Content-Type': 'text/plain' }, body: 'hi' }, 415);
    const res = await send(ctx, 'PUT', login, { body: {} }, 405);
    expect(res.headers.allow).toBe('POST');
  });
```

**`test/auth.e2e-spec.ts`** · continue

```ts

  it('logs in, and gives the same 401 for an unknown email and a wrong password', async () => {
    const user = await registerUser(ctx, 'Ada');
    const login = (email: string, password: string) =>
      send(ctx, 'POST', '/api/v1/auth/login', { body: { email, password } });
    expect((await login(user.email, 'correct-horse-battery')).status).toBe(200);
    const wrong = await login(user.email, 'nope');
    const unknown = await login('ghost@example.com', 'nope');
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect(wrong.json<{ detail: string }>().detail).toBe(unknown.json<{ detail: string }>().detail);
  });

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
```

**`test/auth.e2e-spec.ts`** · continue

```ts

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
    const empty = await send(ctx, 'PATCH', '/api/v1/users/me', { as: user, body: {} }, 422);
    expect(empty.json()).toMatchObject({ errors: [{ field: 'body' }] });
    await send(ctx, 'PATCH', '/api/v1/users/me', { as: user, body: { displayName: null } }, 422);
  });

  it('allows 10 auth requests per minute per IP, then 429 with Retry-After', async () => {
    const attempt = () =>
      send(ctx, 'POST', '/api/v1/auth/login', {
        body: { email: 'nobody@example.com', password: 'x' },
      });
    for (let i = 0; i < 10; i++) expect((await attempt()).status).toBe(401);
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.json()).toMatchObject({
      type: 'https://taskflow.example/problems/rate-limited',
    });
  });
});
```

**What's new**
- `res.headers['set-cookie']` from Supertest is an array of raw headers; `refreshCookie` finds ours and keeps the `name=value` part to send back.
- The rate-limit test makes 10 allowed requests, then expects a 429 with `Retry-After`. It works because `resetState` flushes the limiter's keys before each test.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  4 passed (4)
      Tests  20 passed (20)
```

**Commit:** `test: auth integration tests`

---

### Step 4.9 · Seed the default user

**Goal:** one command that creates the login every TaskFlow backend shares for local development, **`ashutosh@test.com` / `Ashutosh#1234`**, so the frontend has an account ready on a fresh database.

**Files:** `src/modules/users/default-user.ts`, `src/seed.ts`, `vitest.config.ts`, `test/seed.e2e-spec.ts`

**`src/modules/users/default-user.ts`** · new file

```ts
import { hashPassword } from '../auth/passwords.js';
import type { UsersService } from './users.service.js';

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
export async function seedDefaultUser(users: UsersService): Promise<'created' | 'exists'> {
  if (await users.findByEmailWithPassword(DEFAULT_USER.email)) return 'exists';
  await users.create({
    email: DEFAULT_USER.email,
    displayName: DEFAULT_USER.displayName,
    passwordHash: await hashPassword(DEFAULT_USER.password),
  });
  return 'created';
}
```

**What's new**
- **Seed through the app's own code.** The function hashes with `hashPassword` (argon2id, Step 4.1) and writes through `UsersService`, so a seeded user is indistinguishable from one who signed up. Inserting a row with raw SQL would need a hash computed somewhere else, and would skip whatever rules `create` gains later.
- **Idempotent:** if the email exists it does nothing and says `exists`. You can run it after every `docker compose down -v`, or twice by accident.

**`src/seed.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Env } from './config/env.js';
import { CoreModule } from './core.module.js';
import { DEFAULT_USER, seedDefaultUser } from './modules/users/default-user.js';
import { UsersModule } from './modules/users/users.module.js';
import { UsersService } from './modules/users/users.service.js';

@Module({ imports: [CoreModule, UsersModule] })
class SeedModule {}

/** `npm run db:seed`: a standalone app (like the worker) that creates the default development user. */
const app = await NestFactory.createApplicationContext(SeedModule, { logger: false });
const config = app.get<ConfigService<Env, true>>(ConfigService);
if (config.get('NODE_ENV', { infer: true }) === 'production') {
  await app.close();
  throw new Error('Refusing to seed a production database');
}
const result = await seedDefaultUser(app.get(UsersService));
await app.close();
console.log(`default user ${DEFAULT_USER.email}: ${result}`);
```

**`vitest.config.ts`** · add after `'src/migrate.ts',`

```ts
        'src/seed.ts',
```

```bash
npm pkg set scripts.db:seed="nest build && node dist/seed.js"
```

**What's new**
- **A third standalone application.** Like the worker (Part 11), `NestFactory.createApplicationContext(SeedModule)` builds the DI container without HTTP. `SeedModule` imports `CoreModule` (config, database) and `UsersModule`, then `app.get(UsersService)` takes the service out of the container. The module is declared right in the script because nothing else needs it. `logger: false` keeps Nest's start-up lines out of a one-line command.
- **It refuses to run in production**: the password is in this repo, so a seeded production database would have an account anyone can log into. `db:seed` builds first and runs the compiled file, like `db:migrate`.
- `src/seed.ts` joins the other entry scripts in the coverage exclusions: it's a program, tested through the function it calls.

**`test/seed.e2e-spec.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER, seedDefaultUser } from '../src/modules/users/default-user.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { createTestContext, resetState, send } from './helpers.js';

const ctx = await createTestContext();
beforeEach(() => resetState(ctx));
afterAll(() => ctx.close());

describe('default user seed', () => {
  it('creates the user once, and the user can log in', async () => {
    const users = ctx.app.get(UsersService);
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
 Test Files  5 passed (5)
      Tests  21 passed (21)
```

Now `npm run dev` and log in from the frontend (or `curl`) with `ashutosh@test.com` / `Ashutosh#1234`.

**Commit:** `feat: seed the default development user`

---
## Part 5 · Workspaces & RBAC

Workspaces, members and invitations: the README's RBAC rules (§5) and the first services that write several rows in one transaction. The business rules are Express's; the new material is **TypeORM's transactions, locks, relation filters and query builder**, and feature modules that import each other's services.

### Step 5.1 · The access service

**Goal:** one service that answers "may this user do this to that?" for every workspace-scoped resource.

**Files:** `src/modules/access/access.service.ts`, `src/modules/access/access.module.ts`

**`src/modules/access/access.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { forbidden, notFound } from '../../common/problem.js';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { atLeast, type Role } from './roles.js';

/**
 * Every workspace-scoped request goes through here.
 * Not a member → 404 (don't reveal the resource exists). Role too low → 403.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(BoardColumn) private readonly columns: Repository<BoardColumn>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
  ) {}

  async member(workspaceId: string, userId: string, minimum: Role = 'viewer', what = 'Workspace') {
    const membership = await this.members.findOneBy({ workspaceId, userId });
    if (!membership) throw notFound(what);
    if (!atLeast(membership.role, minimum)) throw forbidden();
    return membership;
  }

  async project(projectId: string, userId: string, minimum: Role = 'viewer') {
    const project = await this.projects.findOneBy({ id: projectId });
    if (!project) throw notFound('Project');
    const membership = await this.member(project.workspaceId, userId, minimum, 'Project');
    return { project, membership };
  }
```

**`src/modules/access/access.service.ts`** · continue

```ts

  async column(columnId: string, userId: string, minimum: Role = 'viewer') {
    const column = await this.columns.findOne({
      where: { id: columnId },
      relations: { project: true },
    });
    if (!column) throw notFound('Column');
    const membership = await this.member(column.project.workspaceId, userId, minimum, 'Column');
    return { column, project: column.project, membership };
  }

  async task(taskId: string, userId: string, minimum: Role = 'viewer') {
    const task = await this.tasks.findOne({ where: { id: taskId }, relations: { project: true } });
    if (!task) throw notFound('Task');
    const membership = await this.member(task.project.workspaceId, userId, minimum, 'Task');
    return { task, project: task.project, membership };
  }

  async comment(commentId: string, userId: string) {
    const comment = await this.comments.findOne({
      where: { id: commentId },
      relations: { task: { project: true } },
    });
    if (!comment) throw notFound('Comment');
    const { project } = comment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Comment');
    return { comment, project, membership };
  }

  async attachment(attachmentId: string, userId: string) {
    const attachment = await this.attachments.findOne({
      where: { id: attachmentId },
      relations: { task: { project: true } },
    });
    if (!attachment) throw notFound('Attachment');
    const { project } = attachment.task;
    const membership = await this.member(project.workspaceId, userId, 'viewer', 'Attachment');
    return { attachment, project, membership };
  }
}
```

**`src/modules/access/access.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { AccessService } from './access.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WorkspaceMember, Project, BoardColumn, Task, Comment, Attachment]),
  ],
  providers: [AccessService],
  exports: [AccessService],
})
export class AccessModule {}
```

**What's new**
- **Six repositories in one constructor**, each requested with `@InjectRepository(Entity)`; `forFeature([...])` in the module registers all six. The service is exported, so every feature module that imports `AccessModule` can inject it.
- **`findOne({ where, relations })`** loads an entity with its relations joined: `relations: { project: true }` adds a `LEFT JOIN projects` and fills `column.project`; `relations: { task: { project: true } }` joins two levels. ☕ JPA's `JOIN FETCH`.
- Every method returns what it found **plus the caller's membership**, so services don't query twice: `const { task, project, membership } = await this.access.task(...)`.

> **🧠 DSA & scalability · the access check**
> - **Data structure:** the `workspace_members` row for (workspace, user), found through the unique index `workspace_members_workspace_id_user_id_key` (a B-tree).
> - **Algorithm:** resolve the resource to its workspace (one indexed lookup, with joins for nested resources), then look up the membership; no row → 404, rank too low → 403.
> - **Complexity:** O(log n) per lookup; one or two queries per request.
> - **Why 404, not 403, for non-members:** a 403 would confirm that the workspace (or task) exists. Outsiders learn nothing.
> - **Rejected:** caching memberships in the JWT (roles would stay stale for 15 minutes after a change); a policy engine (more machinery than four roles need).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: roles and workspace access checks`

### Step 5.2 · The activity log and the job queue

**Goal:** an append-only activity log written inside the caller's transaction, and a typed facade over a BullMQ queue.

**Files:** `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.module.ts`, `src/jobs/jobs.service.ts`, `src/jobs/jobs.module.ts`

**`src/modules/activity/activity.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type EntityManager } from 'typeorm';
```

**`src/modules/activity/activity.service.ts`** · continue

```ts
import { ActivityEvent } from '../../database/entities/activity-event.entity.js';
import { AccessService } from '../access/access.service.js';
```

**`src/modules/activity/activity.service.ts`** · continue

```ts

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

/** Append-only: there is deliberately no update or delete method. */
@Injectable()
export class ActivityService {
  constructor(
    @InjectRepository(ActivityEvent) private readonly events: Repository<ActivityEvent>,
    private readonly access: AccessService,
  ) {}

  /** Takes the caller's EntityManager so the event joins the caller's transaction. */
  async record(manager: EntityManager, event: ActivityInput): Promise<void> {
    await manager.insert(ActivityEvent, {
      workspaceId: event.workspaceId,
      actorId: event.actorId,
      type: event.type,
      projectId: event.projectId ?? null,
      taskId: event.taskId ?? null,
      data: event.data ?? {},
    });
  }
```

**`src/modules/activity/activity.service.ts`** · continue

```ts
}
```

**`src/modules/activity/activity.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityEvent } from '../../database/entities/activity-event.entity.js';
import { AccessModule } from '../access/access.module.js';
```

**`src/modules/activity/activity.module.ts`** · continue

```ts
import { ActivityService } from './activity.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([ActivityEvent]), AccessModule],
```

**`src/modules/activity/activity.module.ts`** · continue

```ts
  providers: [ActivityService],
  exports: [ActivityService],
})
export class ActivityModule {}
```

**What's new**
- **`record(manager, event)` takes an `EntityManager`.** Inside `dataSource.transaction(async (manager) => …)`, every query must go through *that* `manager` to be part of the transaction. Passing it in means the event is committed or rolled back together with the change it describes. (Prisma and Drizzle had the same pattern with `tx`.)
- `manager.insert(Entity, values)` is a plain `INSERT` that returns nothing useful; we don't need the row back.
- The constructor already asks for the repository and `AccessService`; Part 8 adds the feed that uses them.

```bash
npm i -E @nestjs/bullmq@12.0.1 bullmq@6.7.5
npm deny-scripts msgpackr-extract
```

- **`bullmq`** is the Redis-backed job queue Express and Fastify used; **`@nestjs/bullmq`** makes queues injectable and workers declarable (Part 11). `msgpackr-extract` is an optional native speed-up for BullMQ's serializer; without its install script, msgpackr falls back to pure JavaScript.

**`src/jobs/jobs.service.ts`** · new file

```ts
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue, type JobsOptions } from 'bullmq';

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

/** The typed facade services use; they never touch BullMQ directly. */
@Injectable()
export class Jobs {
  constructor(@InjectQueue(QUEUE_NAME) private readonly queue: Queue) {}

  async enqueue<N extends JobName>(name: N, data: JobData[N]): Promise<void> {
    await this.queue.add(name, data);
  }
}
```

**`src/jobs/jobs.module.ts`** · new file

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../infra/redis.module.js';
import { Jobs, QUEUE_NAME, RETRY } from './jobs.service.js';

/** The producing side of the queue: everything a service needs to enqueue a job. */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS],
      useFactory: (redis: Redis) => ({ connection: redis }),
    }),
    BullModule.registerQueue({ name: QUEUE_NAME, defaultJobOptions: RETRY }),
  ],
  providers: [Jobs],
  exports: [Jobs, BullModule],
})
export class JobsModule {}
```

**What's new**
- **`JobData` maps each job name to its payload type**, so `jobs.enqueue('send-invitation-email', {...})` checks the payload at compile time. `<N extends JobName>(name: N, data: JobData[N])` is the generic that ties them together.
- **`@InjectQueue(QUEUE_NAME)`** injects the `Queue` that `BullModule.registerQueue` created. `BullModule.forRootAsync` shares our Redis connection (from the global `REDIS` token) with every queue.
- `RETRY` gives every job 5 attempts with exponential backoff (2 s, 4 s, 8 s, … with ±50% jitter) and bounded history.
- `exports: [Jobs, BullModule]`: importers get the facade, and (for the worker, Part 11) the queue registration.

> **🧠 DSA & scalability · the job queue**
> - **Data structure (Redis):** BullMQ keeps waiting jobs in a list, delayed and retrying jobs in a sorted set scored by run time, and each job's data in a hash.
> - **Algorithm:** `add` pushes a job; a worker atomically moves it to "active" with a lock it keeps renewing; on failure it's rescheduled at `now + backoff(attempt)`.
> - **Complexity:** O(1) enqueue and dequeue; O(log n) for delayed jobs.
> - **Why it scales:** any number of API instances enqueue and any number of workers consume; the atomic move means each job is processed by one worker at a time, and a crashed worker's lock expires so another picks the job up.
> - **Rejected:** sending email inside the request (slow, and a mail outage fails the request); `setTimeout` in the API (lost on restart, duplicated across instances).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: activity log and typed job queue`

### Step 5.3 · Cursor pagination

**Goal:** opaque cursors, a keyset helper for TypeORM's query builder, the shared `?limit&cursor` query DTO, and a Swagger decorator for pages.

**Files:** `src/common/cursor.ts`, `src/common/cursor.spec.ts`, `src/common/keyset.ts`, `src/common/page-query.dto.ts`, `src/common/http/api-page.ts`

**`src/common/cursor.ts`** · new file

```ts
import { invalid } from './problem.js';
import { UUID } from './validation/parse-id.pipe.js';

export interface IdCursor {
  id: string;
}

export interface RankCursor {
  rank: number;
  id: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const isIdCursor = (value: unknown): value is IdCursor =>
  isRecord(value) && typeof value.id === 'string' && UUID.test(value.id);

export const isRankCursor = (value: unknown): value is RankCursor =>
  isRecord(value) && typeof value.rank === 'number' && isIdCursor(value);

export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** A cursor comes from the client, so it is checked like any other input before use. */
export function decodeCursor<T>(cursor: string, isValid: (value: unknown) => value is T): T {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid('query.cursor', 'is not a valid cursor');
  }
  if (!isValid(json)) throw invalid('query.cursor', 'is not a valid cursor');
  return json;
}

export class Page<T> {
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
  cursorOf: (row: Row) => object,
): Page<Item> {
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(toItem),
    nextCursor: rows.length > limit && last !== undefined ? encodeCursor(cursorOf(last)) : null,
  };
}
```

**`src/common/cursor.spec.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, isIdCursor, isRankCursor, toPage } from './cursor.js';
import { ProblemError } from './problem.js';

const ID = '01a18b7e-951f-71f4-affb-2b64a14174e2';

describe('cursors', () => {
  it('round-trips through base64url JSON', () => {
    const cursor = encodeCursor({ id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, isIdCursor)).toEqual({ id: ID });
  });

  it('keeps float ranks exact', () => {
    const rank = 0.9910322;
    expect(decodeCursor(encodeCursor({ rank, id: ID }), isRankCursor).rank).toBe(rank);
  });

  it.each(['not-base64-json', encodeCursor({ id: 'nope' }), encodeCursor({ other: 1 })])(
    'rejects %s with a 422 on query.cursor',
    (bad) => {
      const run = () => decodeCursor(bad, isIdCursor);
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

**What's new**
- The same cursor format as the other repos (base64url JSON), with **type guards** (`value is IdCursor`) so a decoded cursor is checked like any other input. A bad cursor is a 422 on `query.cursor`.
- `Page<T>` is a class (not an interface) only so Swagger has something to point at; `toPage` fetches-one-more to know whether another page exists.

**`src/common/keyset.ts`** · new file

```ts
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

/**
 * Finishes a list query with keyset pagination: only rows past the cursor, ordered by the
 * same column, one row more than the page (the extra row tells toPage() whether to mint a cursor).
 *
 * `.limit()`, not `.take()` or `find({ take })`: when a query has joins, `take` makes TypeORM
 * run a SELECT DISTINCT over a subquery first, in case a join multiplied the rows. Our joins
 * are all many-to-one, so they can't, and a plain SQL LIMIT is correct and index-friendly.
 */
export function keyset<Entity extends ObjectLiteral>(
  query: SelectQueryBuilder<Entity>,
  column: string,
  direction: 'ASC' | 'DESC',
  limit: number,
  after: string | undefined,
): Promise<Entity[]> {
  if (after) query.andWhere(`${column} ${direction === 'DESC' ? '<' : '>'} :after`, { after });
  return query
    .orderBy(column, direction)
    .limit(limit + 1)
    .getMany();
}
```

**What's new**
- **`.limit()` vs `.take()`.** With joins, `take` makes TypeORM run a `SELECT DISTINCT` subquery first, in case a one-to-many join multiplied the rows. Our list joins are all many-to-one, so a plain SQL `LIMIT` is correct, and it lets Postgres walk the index and stop.
- `query.andWhere(...)` mutates the builder; the helper adds the cursor condition, the order and the limit to whatever filters the caller already set.

**`src/common/page-query.dto.ts`** · new file

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import { IsOmittable } from './validation/decorators.js';

/** `?limit=20&cursor=…`. List endpoints extend this class to add their own filters. */
export class PageQueryDto {
  // Query strings are text. @Type converts "20" to 20 before validation; bodies get no such help.
  @ApiProperty({ required: false })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @IsOmittable()
  @IsString()
  @Length(1, 512)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;
}
```

**`src/common/http/api-page.ts`** · new file

```ts
import { applyDecorators, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, getSchemaPath } from '@nestjs/swagger';

/**
 * Documents a `{ items: T[], nextCursor }` response. TypeScript generics don't exist at run
 * time, so Swagger can't see what `Page<TaskDto>` holds; this decorator spells it out.
 */
export const ApiPage = (item: Type) =>
  applyDecorators(
    ApiExtraModels(item),
    ApiOkResponse({
      schema: {
        type: 'object',
        required: ['items', 'nextCursor'],
        properties: {
          items: { type: 'array', items: { $ref: getSchemaPath(item) } },
          nextCursor: { type: 'string', nullable: true },
        },
      },
    }),
  );
```

**What's new**
- **`@Type(() => Number)`** (class-transformer) converts the query string's `"20"` into `20` before validation. Bodies are JSON with real types, so they get no implicit conversion: a body field typed `number` that arrives as `"20"` is a 422, as the contract requires.
- `limit: number = 20` is the default when the parameter is missing; `@ApiProperty({ required: false })` tells the Swagger plugin so (it would otherwise mark a field without `?` as required).
- **`applyDecorators`** bundles two Swagger decorators into one. TypeScript generics vanish at run time, so `Promise<Page<TaskDto>>` tells Swagger nothing about the items; `@ApiPage(TaskDto)` spells out `{ items: TaskDto[], nextCursor }`.

> **🧠 DSA & scalability · keyset pagination**
> - **Data structure:** a B-tree index whose order matches the list order, e.g. `workspace_members_user_idx (user_id, workspace_id)`.
> - **Algorithm:** `WHERE <filters> AND id < :after ORDER BY id DESC LIMIT n + 1`: Postgres seeks to the cursor in the index and reads n + 1 entries.
> - **Complexity:** O(log N + n) per page, whatever page you're on.
> - **Why it scales:** `OFFSET 10000` reads and discards 10,000 rows; a keyset cursor starts right where the last page ended, and rows inserted meanwhile don't shift pages. UUIDv7 ids are time-ordered, so "by id" is "by creation time".
> - **Rejected:** offset pagination (slow deep pages, duplicates and gaps under writes); cursors holding raw ids without validation (a crafted cursor would reach SQL as an unchecked value).

**✅ Checkpoint**

```bash
npx vitest run src/common
```

Expected:

```text
 Test Files  2 passed (2)
      Tests  9 passed (9)
```

**Commit:** `feat: keyset cursor pagination helpers`

### Step 5.4 · Workspace DTOs and service

**Goal:** list, create, read, rename and delete workspaces.

**Files:** `src/modules/workspaces/workspace.dto.ts`, `src/modules/workspaces/workspaces.service.ts`

**`src/modules/workspaces/workspace.dto.ts`** · new file

```ts
import { IsEmail, IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { IsOmittable, ToLowerCase, Trim } from '../../common/validation/decorators.js';
import type { Invitation } from '../../database/entities/invitation.entity.js';
import type { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import type { Workspace } from '../../database/entities/workspace.entity.js';
import { INVITABLE_ROLES, ROLES, type InvitableRole, type Role } from '../access/roles.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export class CreateWorkspaceDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  name: string;

  @IsString()
  @Length(3, 40)
  @Matches(SLUG)
  slug: string;
}

export class UpdateWorkspaceDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOmittable()
  @IsString()
  @Length(3, 40)
  @Matches(SLUG)
  slug?: string;
}

export class UpdateMemberDto {
  @IsIn(ROLES)
  role: Role;
}

export class CreateInvitationDto {
  @ToLowerCase()
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsIn(INVITABLE_ROLES)
  role: InvitableRole;
}

export class AcceptInvitationDto {
  @IsString()
  @Length(1, 128)
  token: string;
}
```

**`src/modules/workspaces/workspace.dto.ts`** · continue

```ts

export class WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  currentUserRole: Role;
  createdAt: string;
  updatedAt: string;
}

export class MemberDto {
  user: UserSummaryDto;
  role: Role;
  joinedAt: string;
}

export class InvitationDto {
  id: string;
  workspaceId: string;
  email: string;
  role: InvitableRole;
  invitedBy: UserSummaryDto;
  expiresAt: string;
  createdAt: string;
}

export const toWorkspace = (w: Workspace, role: Role): WorkspaceDto => ({
  id: w.id,
  name: w.name,
  slug: w.slug,
  currentUserRole: role,
  createdAt: w.createdAt.toISOString(),
  updatedAt: w.updatedAt.toISOString(),
});

export const toMember = (m: WorkspaceMember): MemberDto => ({
  user: toUserSummary(m.user),
  role: m.role,
  joinedAt: m.joinedAt.toISOString(),
});

export const toInvitation = (i: Invitation): InvitationDto => ({
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
- `@IsIn(ROLES)` accepts only the listed values; the array from `roles.ts` is both the validator's list and (through `Role`) the TypeScript type.
- Input DTOs above, output DTOs and mappers below, the same split as `user.dto.ts`.

**`src/modules/workspaces/workspaces.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, notFound } from '../../common/problem.js';
import { Project } from '../../database/entities/project.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Workspace } from '../../database/entities/workspace.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { toWorkspace } from './workspace.dto.js';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Workspace) private readonly workspaces: Repository<Workspace>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly jobs: Jobs,
  ) {}

  async list(userId: string, limit: number, cursor?: string) {
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    // The (user_id, workspace_id) index serves this query directly: newest workspace first.
    const query = this.members
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.workspace', 'workspace')
      .where('member.userId = :userId', { userId });
    const rows = await keyset(query, 'member.workspaceId', 'DESC', limit, after);
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
      const workspace = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Workspace, { ...input, createdBy: userId }),
        );
        await manager.insert(WorkspaceMember, { workspaceId: created.id, userId, role: 'owner' });
        await this.activity.record(manager, {
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
    const workspace = await this.workspaces.findOneBy({ id: workspaceId });
    if (!workspace) throw notFound('Workspace');
    return toWorkspace(workspace, membership.role);
  }

  async update(workspaceId: string, userId: string, input: { name?: string; slug?: string }) {
    const membership = await this.access.member(workspaceId, userId, 'admin');
    try {
      const workspace = await this.dataSource.transaction(async (manager) => {
        await manager.update(Workspace, { id: workspaceId }, input);
        const updated = await manager.findOneBy(Workspace, { id: workspaceId });
        if (!updated) throw notFound('Workspace');
        await this.activity.record(manager, {
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
    const owned = await this.projects.find({ where: { workspaceId }, select: { id: true } });
    await this.workspaces.delete({ id: workspaceId });
    for (const p of owned) {
      await this.jobs.enqueue('delete-storage-prefix', { prefix: `projects/${p.id}/` });
    }
  }
}
```

**What's new (TypeORM transactions)**
- **`this.dataSource.transaction(async (manager) => …)`** runs the callback in `BEGIN … COMMIT`, and rolls back if it throws. Creating a workspace writes three rows (workspace, owner membership, activity event): all or none.
- **`manager.save(manager.create(Workspace, {...}))`** is the transactional twin of the repository's `save(create(...))`.
- **Catching `isUniqueViolation`** turns the `workspaces_slug_key` violation into a 409. Checking first ("is the slug taken?") would race with a concurrent request; the unique index is the only reliable check.
- `list` pages over **memberships** joined to their workspace (`innerJoinAndSelect`), because "my workspaces" is "workspaces I'm a member of", and the `(user_id, workspace_id)` index serves it directly.
- `delete` relies on `ON DELETE CASCADE` for the database rows, then enqueues one storage cleanup per project (Part 11 processes them).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: workspaces service`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** admins manage members and viewers, owners manage everyone, and a workspace can never lose its last owner, even under concurrent requests.

**Files:** `src/modules/workspaces/members.service.ts`

**`src/modules/workspaces/members.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { AccessService } from '../access/access.service.js';
import type { Role } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toMember } from './workspace.dto.js';

const ADMIN_MANAGEABLE: readonly Role[] = ['member', 'viewer'];

@Injectable()
export class MembersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.members
      .createQueryBuilder('member')
      .innerJoinAndSelect('member.user', 'user')
      .where('member.workspaceId = :workspaceId', { workspaceId });
    const rows = await keyset(query, 'member.id', 'ASC', limit, after);
    return toPage(rows, limit, toMember, (m) => ({ id: m.id }));
  }

  async updateRole(workspaceId: string, actorId: string, targetUserId: string, newRole: Role) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    const updated = await this.dataSource.transaction(async (manager) => {
      const target = await this.findTarget(manager, workspaceId, targetUserId);
      const from = target.role;
      if (
        actor.role !== 'owner' &&
        !(ADMIN_MANAGEABLE.includes(from) && ADMIN_MANAGEABLE.includes(newRole))
      ) {
        throw forbidden('Only owners can grant or revoke admin and owner roles');
      }
      if (from === 'owner' && newRole !== 'owner') {
        await this.assertNotLastOwner(manager, workspaceId);
      }
      await manager.update(WorkspaceMember, { id: target.id }, { role: newRole });
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'member.role_changed',
        data: { userId: targetUserId, from, to: newRole },
      });
      return this.findTarget(manager, workspaceId, targetUserId);
    });
    return toMember(updated);
  }
```

**`src/modules/workspaces/members.service.ts`** · continue

```ts

  async remove(workspaceId: string, actorId: string, targetUserId: string) {
    const actor = await this.access.member(workspaceId, actorId);
    await this.dataSource.transaction(async (manager) => {
      const target = await this.findTarget(manager, workspaceId, targetUserId);
      const leaving = actorId === targetUserId;
      if (!leaving) {
        const allowed =
          actor.role === 'owner' ||
          (actor.role === 'admin' && ADMIN_MANAGEABLE.includes(target.role));
        if (!allowed) throw forbidden('Your role cannot remove this member');
      }
      if (target.role === 'owner') await this.assertNotLastOwner(manager, workspaceId);
      await manager.delete(WorkspaceMember, { id: target.id });
      // A subquery inside IN (…): every project of this workspace, in one statement.
      await manager
        .createQueryBuilder()
        .update(Task)
        .set({ assigneeId: null })
        .where('assignee_id = :targetUserId', { targetUserId })
        .andWhere('project_id IN (SELECT id FROM projects WHERE workspace_id = :workspaceId)', {
          workspaceId,
        })
        .execute();
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'member.removed',
        data: { userId: targetUserId },
      });
    });
  }

  private async findTarget(manager: EntityManager, workspaceId: string, userId: string) {
    const target = await manager.findOne(WorkspaceMember, {
      where: { workspaceId, userId },
      relations: { user: true },
    });
    if (!target) throw notFound('Member');
    return target;
  }

  /**
   * Locks every owner row first (SELECT … FOR UPDATE), so two owners demoting each other at
   * the same time can't both pass the check and leave the workspace without an owner.
   */
  private async assertNotLastOwner(manager: EntityManager, workspaceId: string) {
    const owners = await manager.find(WorkspaceMember, {
      where: { workspaceId, role: 'owner' },
      select: { id: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (owners.length <= 1) throw conflict('A workspace must keep at least one owner');
  }
}
```

**What's new**
- **`lock: { mode: 'pessimistic_write' }`** adds `FOR UPDATE` to the query: the owner rows stay locked until the transaction ends.
- **A query-builder `UPDATE` with a subquery** unassigns the removed member's tasks in every project of the workspace, in one statement: `.update(Task).set({ assigneeId: null }).where(...).andWhere('project_id IN (SELECT …)')`.
- Removing yourself (leaving) is always allowed, except for the last owner.

> **🧠 DSA & scalability · the last-owner invariant**
> - **Data structure:** the workspace's owner rows in `workspace_members`, locked with `SELECT … FOR UPDATE`.
> - **Algorithm:** inside the transaction, lock all owner rows → count them → refuse if this change would leave zero → apply the change → commit (releasing the locks).
> - **Complexity:** O(owners), a handful of rows.
> - **Why it's correct under concurrency:** two owners demoting each other at once both read "2 owners" without the lock, and both succeed. With the lock, the second transaction waits for the first to commit, then reads "1 owner" and is refused.
> - **Rejected:** a check outside the transaction (races); a trigger (the rule would live far from the code that explains it).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: member role changes and removal with last-owner lock`

### Step 5.6 · Invitations

**Goal:** invite by email with a single-use token, stored hashed; the invitee accepts while signed in with that email.

**Files:** `src/modules/workspaces/invitations.service.ts`

**`src/modules/workspaces/invitations.service.ts`** · new file

```ts
import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThanOrEqual, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Invitation } from '../../database/entities/invitation.entity.js';
import { User } from '../../database/entities/user.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import type { InvitableRole } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toInvitation, toWorkspace } from './workspace.dto.js';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class InvitationsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Invitation) private readonly invitations: Repository<Invitation>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId, 'admin');
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.invitations
      .createQueryBuilder('invitation')
      .innerJoinAndSelect('invitation.inviter', 'inviter')
      .where('invitation.workspaceId = :workspaceId', { workspaceId })
      .andWhere('invitation.acceptedAt IS NULL');
    const rows = await keyset(query, 'invitation.id', 'DESC', limit, after);
    return toPage(rows, limit, toInvitation, (i) => ({ id: i.id }));
  }

```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
  async create(
    workspaceId: string,
    actorId: string,
    input: { email: string; role: InvitableRole },
  ) {
    const actor = await this.access.member(workspaceId, actorId, 'admin');
    if (input.role === 'admin' && actor.role !== 'owner') {
      throw forbidden('Only owners can invite admins');
    }
    const alreadyMember = await this.members.existsBy({
      workspaceId,
      user: { email: input.email },
    });
    if (alreadyMember) throw conflict('This person is already a member');

    const token = randomBytes(32).toString('base64url');
    let invitation: Invitation | null;
    try {
      invitation = await this.dataSource.transaction(async (manager) => {
        await manager.delete(Invitation, {
          workspaceId,
          email: input.email,
          acceptedAt: IsNull(),
          expiresAt: LessThanOrEqual(new Date()),
        });
        const created = await manager.save(
          manager.create(Invitation, {
            workspaceId,
            email: input.email,
            role: input.role,
            tokenHash: sha256(token),
            invitedBy: actorId,
            expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
          }),
        );
        await this.activity.record(manager, {
          workspaceId,
          actorId,
          type: 'invitation.created',
          data: { email: input.email, role: input.role },
        });
        return manager.findOne(Invitation, {
          where: { id: created.id },
          relations: { inviter: true, workspace: true },
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

```

**`src/modules/workspaces/invitations.service.ts`** · continue

```ts
  async revoke(workspaceId: string, actorId: string, invitationId: string) {
    await this.access.member(workspaceId, actorId, 'admin');
    await this.dataSource.transaction(async (manager) => {
      const { affected } = await manager.delete(Invitation, {
        id: invitationId,
        workspaceId,
        acceptedAt: IsNull(),
      });
      if (!affected) throw notFound('Invitation');
      await this.activity.record(manager, {
        workspaceId,
        actorId,
        type: 'invitation.revoked',
        data: { invitationId },
      });
    });
  }

  async accept(userId: string, token: string) {
    const invitation = await this.invitations.findOne({
      where: { tokenHash: sha256(token) },
      relations: { workspace: true },
    });
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= new Date()) {
      throw notFound('Invitation');
    }
    const user = await this.users.findOneBy({ id: userId });
    if (user?.email !== invitation.email) {
      throw forbidden('This invitation was sent to a different email address');
    }

    const role = await this.dataSource.transaction(async (manager) => {
      await manager.update(Invitation, { id: invitation.id }, { acceptedAt: new Date() });
      const existing = await manager.findOneBy(WorkspaceMember, {
        workspaceId: invitation.workspaceId,
        userId,
      });
      if (existing) return existing.role;
      await manager.insert(WorkspaceMember, {
        workspaceId: invitation.workspaceId,
        userId,
        role: invitation.role,
      });
      await this.activity.record(manager, {
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

**What's new**
- **Relation filters in `where`:** `members.existsBy({ workspaceId, user: { email } })` filters on a column of the related `users` table; TypeORM adds the join. `existsBy` runs `SELECT 1 … LIMIT 1`.
- **Find operators:** `IsNull()` is `IS NULL`, `LessThanOrEqual(new Date())` is `<= $1`. The transaction first deletes this email's *expired* pending invitation, so re-inviting works, then inserts; a still-pending one trips the partial unique index → 409.
- The email is enqueued **after** the transaction commits: a rolled-back invitation must not send mail.
- `accept` checks the token's hash, expiry and email, then joins in a transaction (idempotent if already a member).

> **🧠 DSA & scalability · invitation tokens**
> - **Data structure:** 256 random bits sent in the email; only the SHA-256 hash stored, under a unique index.
> - **Algorithm:** accept = hash the presented token → one indexed lookup → check expiry and email → insert membership.
> - **Complexity:** O(log n).
> - **Why hash:** a database leak doesn't hand out working invitations. Fast hashing is fine for 256 random bits.
> - **Rejected:** signed JWT invitations (can't be revoked); guessable codes.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: email invitations with hashed tokens`

### Step 5.7 · The controller and the module

**Goal:** the eleven workspace, member and invitation routes.

**Files:** `src/modules/workspaces/workspaces.controller.ts`, `src/modules/workspaces/workspaces.module.ts`, `src/app.module.ts`

**`src/modules/workspaces/workspaces.controller.ts`** · new file

```ts
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  CreateWorkspaceDto,
  InvitationDto,
  MemberDto,
  UpdateMemberDto,
  UpdateWorkspaceDto,
  WorkspaceDto,
} from './workspace.dto.js';
import { WorkspacesService } from './workspaces.service.js';

@ApiTags('workspaces')
@Controller(API_PREFIX)
export class WorkspacesController {
  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('workspaces')
  @ApiPage(WorkspaceDto)
  list(@CurrentUser() userId: string, @Query() query: PageQueryDto): Promise<Page<WorkspaceDto>> {
    return this.workspaces.list(userId, query.limit, query.cursor);
  }

  @Post('workspaces')
  create(@CurrentUser() userId: string, @Body() dto: CreateWorkspaceDto): Promise<WorkspaceDto> {
    return this.workspaces.create(userId, dto);
  }

  @Get('workspaces/:workspaceId')
  get(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
  ): Promise<WorkspaceDto> {
    return this.workspaces.get(workspaceId, userId);
  }
```

**`src/modules/workspaces/workspaces.controller.ts`** · continue

```ts

  @Patch('workspaces/:workspaceId')
  update(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceDto> {
    return this.workspaces.update(workspaceId, userId, defined(dto));
  }

  @Delete('workspaces/:workspaceId')
  @HttpCode(204)
  delete(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.workspaces.delete(workspaceId, userId);
  }

  @Get('workspaces/:workspaceId/members')
  @ApiPage(MemberDto)
  listMembers(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<MemberDto>> {
    return this.members.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Patch('workspaces/:workspaceId/members/:userId')
  updateMember(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('userId') targetUserId: string,
    @CurrentUser() userId: string,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberDto> {
    return this.members.updateRole(workspaceId, userId, targetUserId, dto.role);
  }

  @Delete('workspaces/:workspaceId/members/:userId')
  @HttpCode(204)
  removeMember(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('userId') targetUserId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.members.remove(workspaceId, userId, targetUserId);
  }
```

**`src/modules/workspaces/workspaces.controller.ts`** · continue

```ts

  @Get('workspaces/:workspaceId/invitations')
  @ApiPage(InvitationDto)
  listInvitations(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<InvitationDto>> {
    return this.invitations.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Post('workspaces/:workspaceId/invitations')
  invite(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateInvitationDto,
  ): Promise<InvitationDto> {
    return this.invitations.create(workspaceId, userId, dto);
  }

  @Delete('workspaces/:workspaceId/invitations/:invitationId')
  @HttpCode(204)
  revokeInvitation(
    @IdParam('workspaceId') workspaceId: string,
    @IdParam('invitationId') invitationId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.invitations.revoke(workspaceId, userId, invitationId);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(
    @CurrentUser() userId: string,
    @Body() dto: AcceptInvitationDto,
  ): Promise<WorkspaceDto> {
    return this.invitations.accept(userId, dto.token);
  }
}
```

**What's new**
- **`@Controller(API_PREFIX)` with full paths in each route** (`'workspaces/:workspaceId/members'`), because this controller serves three resources. One controller per URL prefix would work too; one per module keeps the module's surface in one file.
- **`@Query() query: PageQueryDto`** validates and converts the whole query string into the DTO.
- Handlers are one line each: extract, delegate, return. The service owns every rule.

**`src/modules/workspaces/workspaces.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invitation } from '../../database/entities/invitation.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { User } from '../../database/entities/user.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Workspace } from '../../database/entities/workspace.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { InvitationsService } from './invitations.service.js';
import { MembersService } from './members.service.js';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember, Invitation, Project, User]),
    AccessModule,
    ActivityModule,
    JobsModule,
  ],
  controllers: [WorkspacesController],
  providers: [WorkspacesService, MembersService, InvitationsService],
})
export class WorkspacesModule {}
```

**`src/app.module.ts`** · add after `import { UsersModule } from './modules/users/users.module.js';`

```ts
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';
```

**`src/app.module.ts`** · add after `UsersModule,`

```ts
    WorkspacesModule,
```

**What's new**
- **Modules compose.** `WorkspacesModule` imports `AccessModule`, `ActivityModule` and `JobsModule` to inject their exported services, and registers its own repositories with `forFeature`. Importing the same module from several places is fine: Nest creates each module's providers once.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** pagination, 404-vs-403, slugs, role management, the last-owner rule and invitations.

**Files:** `test/helpers.ts`, `test/workspaces.e2e-spec.ts`

**`test/helpers.ts`** · add after `import { Test } from '@nestjs/testing';`

```ts
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
```

**`test/helpers.ts`** · add after `import type { Env } from '../src/config/env.js';`

```ts
import { WorkspaceMember } from '../src/database/entities/workspace-member.entity.js';
```

**`test/helpers.ts`** · add after `import { REDIS } from '../src/infra/redis.module.js';`

```ts
import { QUEUE_NAME } from '../src/jobs/jobs.service.js';
import type { Role } from '../src/modules/access/roles.js';
```

**`test/helpers.ts`** · add after `redis: Redis;`

```ts
  queue: Queue;
```

**`test/helpers.ts`** · add after `redis: app.get<Redis>(REDIS),`

```ts
    queue: app.get<Queue>(getQueueToken(QUEUE_NAME)),
```

**`test/helpers.ts`** · continue

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
  role: Role,
): Promise<void> {
  await ctx.dataSource
    .getRepository(WorkspaceMember)
    .insert({ workspaceId, userId: user.id, role });
}
```

**What's new**
- **`app.get(getQueueToken(QUEUE_NAME))`** pulls the BullMQ queue out of the container (the token `@InjectQueue` uses), so a test can assert "an invitation email was queued" without running a worker.
- `addMember` inserts a membership directly through a repository: tests can set up state faster than the API allows.

**`test/workspaces.e2e-spec.ts`** · new file

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
} from './helpers.js';

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

**`test/workspaces.e2e-spec.ts`** · continue

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

**`test/workspaces.e2e-spec.ts`** · continue

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

**`test/workspaces.e2e-spec.ts`** · continue

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

    const jobs = await ctx.queue.getJobs(['waiting']);
    const job = jobs.find((j) => j.name === 'send-invitation-email');
    const token = (job?.data as { token: string }).token;
    expect(token).toBeTruthy();
```

**`test/workspaces.e2e-spec.ts`** · continue

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
    expect((await invite(admin, 'admin')).status).toBe(403);
    expect((await invite(member, 'viewer')).status).toBe(403);
    const ok = await invite(admin, 'viewer');
    expect(ok.status).toBe(201);
    await send(ctx, 'DELETE', `${url}/${ok.json<{ id: string }>().id}`, { as: admin }, 204);
  });
});
```

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

**Commit:** `test: workspace, member and invitation tests`

---
## Part 6 · Projects, columns & ordering

Projects come with three default columns; columns and tasks keep their order with **fractional indexing**; the board is served from a Redis cache; and every board change is announced on Redis Pub/Sub for the real-time layer (Part 10).

### Step 6.1 · Fractional indexing

**Goal:** order keys that always have room between them, so moving an item writes one row.

**Files:** `src/common/fractional-index.ts`, `src/common/fractional-index.spec.ts`

**`src/common/fractional-index.ts`** · new file

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

**`src/common/fractional-index.ts`** · continue

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

**`src/common/fractional-index.ts`** · continue

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

**`src/common/fractional-index.spec.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { keyBetween } from './fractional-index.js';

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
- Identical to Express and Fastify, line for line: it's a pure function over strings. The test vectors are shared by all six backends (the TaskFlow README lists them), so the Python and Java ports must produce the same keys.

> **🧠 DSA & scalability · fractional indexing**
> - **Data structure:** variable-length base-62 strings that sort correctly byte by byte: an "integer part" (a head character encoding its length, then digits) and an optional fraction. Stored in `text COLLATE "C"` under a unique `(parent, position)` B-tree index.
> - **Algorithm:** `keyBetween(a, b)`: if the integer parts differ, try the next integer after `a`; otherwise take the **midpoint of the fractions** digit by digit, extending by one digit when two neighbours are adjacent (`a0` and `a1` → `a0V`).
> - **Complexity:** O(key length) time and space; keys grow by about one character per ~6 insertions into the same gap, and appends at the end stay short (`a0`, `a1`, `a2`, …).
> - **Why it scales:** a move writes **one row**, never renumbers siblings, so concurrent moves in a column don't contend for the same rows.
> - **Rejected:** integer positions (a move renumbers O(n) rows), floats (run out of precision after ~50 halvings), linked lists (reading the order needs a recursive query).

**✅ Checkpoint**

```bash
npx vitest run src/common/fractional-index.spec.ts
```

Expected: `Tests  10 passed (10)`.

**Commit:** `feat: fractional indexing`

### Step 6.2 · DTOs, the board cache and the real-time publisher

**Goal:** the shapes of projects, columns, tasks and the board; a cache-aside wrapper for the board; and the publishing half of real-time.

**Files:** `src/modules/projects/project.dto.ts`, `src/modules/projects/board-cache.ts`, `src/modules/realtime/realtime.publisher.ts`, `src/modules/realtime/publisher.module.ts`

**`src/modules/projects/project.dto.ts`** · new file

```ts
import { IsInt, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';
import { IsId, IsNullable, IsOmittable, Trim } from '../../common/validation/decorators.js';
import type { BoardColumn } from '../../database/entities/board-column.entity.js';
import type { Project } from '../../database/entities/project.entity.js';
import type { Priority, Task } from '../../database/entities/task.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class CreateProjectDto {
  @Trim()
  @IsString()
  @Length(1, 80)
  name: string;

  @IsString()
  @Matches(/^[A-Z][A-Z0-9]{1,9}$/)
  key: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class UpdateProjectDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(2000)
  description?: string | null;
}

export class CreateColumnDto {
  @Trim()
  @IsString()
  @Length(1, 50)
  name: string;

  @IsOmittable()
  @IsNullable()
  @IsInt()
  @Min(1)
  @Max(999)
  wipLimit?: number | null;
}

export class UpdateColumnDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOmittable()
  @IsNullable()
  @IsInt()
  @Min(1)
  @Max(999)
  wipLimit?: number | null;
}

export class MoveColumnDto {
  // Required, but null is a value: "move to the first position".
  @IsNullable()
  @IsId()
  afterColumnId: string | null;
}
```

**`src/modules/projects/project.dto.ts`** · continue

```ts

export class ProjectDto {
  id: string;
  workspaceId: string;
  name: string;
  key: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ColumnDto {
  id: string;
  projectId: string;
  name: string;
  position: string;
  wipLimit: number | null;
  createdAt: string;
  updatedAt: string;
}

export class TaskDto {
  id: string;
  key: string;
  number: number;
  projectId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: Priority;
  assignee: UserSummaryDto | null;
  reporter: UserSummaryDto;
  dueAt: string | null;
  position: string;
  createdAt: string;
  updatedAt: string;
}

export class BoardColumnDto extends ColumnDto {
  tasks: TaskDto[];
}

export class BoardDto {
  project: ProjectDto;
  columns: BoardColumnDto[];
}
```

**`src/modules/projects/project.dto.ts`** · continue

```ts

export const toProject = (p: Project): ProjectDto => ({
  id: p.id,
  workspaceId: p.workspaceId,
  name: p.name,
  key: p.key,
  description: p.description,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
});

export const toColumn = (c: BoardColumn): ColumnDto => ({
  id: c.id,
  projectId: c.projectId,
  name: c.name,
  position: c.position,
  wipLimit: c.wipLimit,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/** The relations `toTask` reads; pass it as `relations` to every query that feeds it. */
export const TASK_RELATIONS = { project: true, assignee: true, reporter: true } as const;

export const toTask = (t: Task): TaskDto => ({
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
- **`TaskDto` lives here**, not in the tasks module: the board (this Part) returns tasks, and Part 7's module imports from this one. Dependencies between modules should point one way.
- **`TASK_RELATIONS`** is the `relations` object every query feeding `toTask` must pass, because `toTask` reads `t.project.key`, `t.assignee` and `t.reporter`. Forgetting a relation would be a runtime `undefined`; one shared constant makes it hard to forget. `as const` keeps its literal type, which TypeORM's `FindOptionsRelations` accepts.
- `MoveColumnDto.afterColumnId` is **required but nullable**: `@IsNullable()` without `@IsOmittable()`, so `{}` is a 422 and `{ "afterColumnId": null }` means "first".

**`src/modules/projects/board-cache.ts`** · new file

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';

const TTL_SECONDS = 300;
const key = (projectId: string) => `cache:board:${projectId}`;

/** Cache-aside: read through on a miss, delete after every write that changes the board. */
@Injectable()
export class BoardCache {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

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

**`src/modules/realtime/realtime.publisher.ts`** · new file

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';

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
@Injectable()
export class RealtimePublisher {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(projectId: string, type: ServerEventType, payload: unknown): Promise<void> {
    await this.redis.publish(projectChannel(projectId), envelope(type, payload));
  }
}
```

**`src/modules/realtime/publisher.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime.publisher.js';

/**
 * The publishing side of real-time, on its own: services import this to announce changes.
 * The gateway lives in RealtimeModule, so importing the publisher never starts a WebSocket server.
 */
@Module({
  providers: [RealtimePublisher],
  exports: [RealtimePublisher],
})
export class PublisherModule {}
```

**What's new**
- **Two modules for real-time.** Services that *announce* changes import `PublisherModule`; the WebSocket gateway (Part 10) lives in `RealtimeModule`. If the publisher sat next to the gateway, importing it from `ProjectsModule` would also create the gateway, and a test module or the worker would start a WebSocket server it never uses.
- `envelope()` builds the contract's `{ type, payload, ts }` frame; the gateway will reuse it.

> **🧠 DSA & scalability · cache-aside for the board**
> - **Data structure:** a Redis **string** per project, `cache:board:{projectId}`, holding the board's JSON, with a 300-second TTL.
> - **Algorithm:** read: `GET` → hit: return; miss: load from Postgres, `SET … EX 300`, return. Write: commit the change, then `DEL` the key.
> - **Complexity:** a hit is one O(1) round trip instead of two queries and a group-by; a miss costs one extra `SET`.
> - **Why it scales:** the board is the most-read endpoint (every open tab loads it), and every instance shares the cache. Deleting on write (not updating) avoids racing two writers' versions of the board; the TTL bounds staleness if a `DEL` is ever lost.
> - **Rejected:** write-through (recomputing the board on every write is the expensive part); in-process caches (each instance would serve stale boards after another instance's write).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: board cache, dtos and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** retry when two users drop into the same gap at the same moment.

**Files:** `src/common/pg-errors.ts`

**`src/common/pg-errors.ts`** · continue

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
- `retryOnPositionConflict(attempt)` re-runs the whole transaction (re-reading the neighbours) when it fails with a unique violation, up to three times. `for (let i = 1; ; i++)` with no condition loops until a `return` or `throw`.

> **🧠 DSA & scalability · optimistic retries**
> - **Data structure:** the unique `(column_id, position)` index is the arbiter.
> - **Algorithm:** compute the key from the current neighbours, insert; on a unique violation, start a fresh transaction and recompute (the winner's key is now visible, so the new key lands next to it).
> - **Complexity:** one attempt almost always; a bounded number under contention.
> - **Why it scales:** no locks are held while computing keys; conflicts are rare (same column, same gap, same instant) and cheap to retry.
> - **Rejected:** locking the column's rows for every move (serialises all moves in a column).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: retry on position conflicts`

### Step 6.4 · Projects service and the board

**Goal:** project CRUD (with three default columns), and the cached board.

**Files:** `src/modules/projects/projects.service.ts`

**`src/modules/projects/projects.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyBetween } from '../../common/fractional-index.js';
import { keyset } from '../../common/keyset.js';
import { isUniqueViolation } from '../../common/pg-errors.js';
import { conflict, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { BoardCache } from './board-cache.js';
import { TASK_RELATIONS, toColumn, toProject, toTask, type BoardDto } from './project.dto.js';

const DEFAULT_COLUMNS = ['To Do', 'In Progress', 'Done'];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Project) private readonly projects: Repository<Project>,
    @InjectRepository(BoardColumn) private readonly columns: Repository<BoardColumn>,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly cache: BoardCache,
    private readonly jobs: Jobs,
  ) {}

  async list(workspaceId: string, userId: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.projects
      .createQueryBuilder('project')
      .where('project.workspaceId = :workspaceId', { workspaceId });
    const rows = await keyset(query, 'project.id', 'DESC', limit, after);
    return toPage(rows, limit, toProject, (p) => ({ id: p.id }));
  }

```

**`src/modules/projects/projects.service.ts`** · continue

```ts
  async create(
    workspaceId: string,
    userId: string,
    input: { name: string; key: string; description?: string | null },
  ) {
    await this.access.member(workspaceId, userId, 'admin');
    try {
      const project = await this.dataSource.transaction(async (manager) => {
        const created = await manager.save(
          manager.create(Project, {
            workspaceId,
            name: input.name,
            key: input.key,
            description: input.description ?? null,
            createdBy: userId,
          }),
        );
        let position: string | null = null;
        for (const name of DEFAULT_COLUMNS) {
          position = keyBetween(position, null);
          await manager.insert(BoardColumn, { projectId: created.id, name, position });
        }
        await this.activity.record(manager, {
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
```

**`src/modules/projects/projects.service.ts`** · continue

```ts

  async update(
    projectId: string,
    userId: string,
    input: { name?: string; description?: string | null },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const updated = await this.dataSource.transaction(async (manager) => {
      await manager.update(Project, { id: projectId }, input);
      const row = await manager.findOneBy(Project, { id: projectId });
      if (!row) throw notFound('Project');
      await this.activity.record(manager, {
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
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Project, { id: projectId });
      await this.activity.record(manager, {
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
      const [columns, tasks] = await Promise.all([
        this.columns.find({ where: { projectId }, order: { position: 'ASC' } }),
        this.tasks.find({
          where: { projectId },
          order: { position: 'ASC' },
          relations: TASK_RELATIONS,
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
- **The board is two queries in parallel** (`Promise.all`): columns ordered by position, and tasks with their relations ordered by position. **`Map.groupBy(tasks, t => t.columnId)`** (ES2024) groups tasks by column in one pass, so each column picks its list in O(1).
- `find({ where, order, relations })` is the find-options API: `order: { position: 'ASC' }` sorts by the `C`-collated key.
- The cache is invalidated **after** the transaction commits; a reader in between gets the old board from Postgres anyway, and the next read reloads it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: projects service and cached board`

### Step 6.5 · Columns service

**Goal:** add, rename, reorder and delete columns, with fractional positions and real-time events.

**Files:** `src/modules/projects/columns.service.ts`

**`src/modules/projects/columns.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { DataSource, MoreThan, Not, type EntityManager } from 'typeorm';
import { keyBetween } from '../../common/fractional-index.js';
import { isForeignKeyViolation, retryOnPositionConflict } from '../../common/pg-errors.js';
import { conflict, invalid, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { RealtimePublisher, type ServerEventType } from '../realtime/realtime.publisher.js';
import { BoardCache } from './board-cache.js';
import { toColumn } from './project.dto.js';

@Injectable()
export class ColumnsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly cache: BoardCache,
    private readonly realtime: RealtimePublisher,
  ) {}

  async create(
    projectId: string,
    userId: string,
    input: { name: string; wipLimit?: number | null },
  ) {
    const { project } = await this.access.project(projectId, userId, 'admin');
    const column = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const last = await manager.findOne(BoardColumn, {
          where: { projectId },
          order: { position: 'DESC' },
        });
        const created = await manager.save(
          manager.create(BoardColumn, {
            projectId,
            name: input.name,
            wipLimit: input.wipLimit ?? null,
            position: keyBetween(last?.position ?? null, null),
          }),
        );
        await this.activity.record(manager, {
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
    input: { name?: string; wipLimit?: number | null },
  ) {
    const { project } = await this.access.column(columnId, userId, 'admin');
    const column = await this.dataSource.transaction(async (manager) => {
      await manager.update(BoardColumn, { id: columnId }, input);
      const row = await manager.findOneBy(BoardColumn, { id: columnId });
      if (!row) throw notFound('Column');
      await this.activity.record(manager, {
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
    if (afterColumnId === columnId) {
      throw invalid('afterColumnId', 'cannot place a column after itself');
    }
    const moved = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const position = await this.positionAfter(
          manager,
          column.projectId,
          columnId,
          afterColumnId,
        );
        await manager.update(BoardColumn, { id: columnId }, { position });
        const row = await manager.findOneBy(BoardColumn, { id: columnId });
        if (!row) throw notFound('Column');
        await this.activity.record(manager, {
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
      await this.dataSource.transaction(async (manager) => {
        await manager.delete(BoardColumn, { id: columnId });
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          type: 'column.deleted',
          data: { columnId, name: column.name },
        });
      });
    } catch (err) {
      // tasks.column_id has no ON DELETE action, so Postgres refuses while tasks remain.
      if (isForeignKeyViolation(err)) {
        throw conflict('Move or delete the tasks in this column first');
      }
      throw err;
    }
    await this.afterWrite(project.id, 'column.deleted', { id: columnId, projectId: project.id });
  }

  private async positionAfter(
    manager: EntityManager,
    projectId: string,
    columnId: string,
    afterId: string | null,
  ) {
    let lower: string | null = null;
    if (afterId !== null) {
      const after = await manager.findOneBy(BoardColumn, { id: afterId });
      if (after?.projectId !== projectId) {
        throw invalid('afterColumnId', 'must be a column of the same project');
      }
      lower = after.position;
    }
    const next = await manager.findOne(BoardColumn, {
      where: {
        projectId,
        id: Not(columnId),
        ...(lower !== null ? { position: MoreThan(lower) } : {}),
      },
      order: { position: 'ASC' },
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

**What's new**
- **More find operators:** `Not(columnId)` is `<> $1` and `MoreThan(lower)` is `> $1`. "The next column after `lower`, excluding the one being moved" is one indexed query: `WHERE project_id = $1 AND id <> $2 AND position > $3 ORDER BY position LIMIT 1`. A spread with a conditional object (`...(lower !== null ? {...} : {})`) adds a condition only when it applies.
- **A foreign-key violation becomes a 409.** `tasks.column_id` has no `ON DELETE` action, so deleting a column that still has tasks fails in Postgres; the service translates it into "move or delete the tasks first".
- `afterWrite` invalidates the board cache and publishes the event, after the commit.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: columns service`

### Step 6.6 · Controller, module and tests

**Goal:** the project, board and column routes, and tests for them.

**Files:** `src/modules/projects/projects.controller.ts`, `src/modules/projects/projects.module.ts`, `src/app.module.ts`, `test/helpers.ts`, `test/projects.e2e-spec.ts`

**`src/modules/projects/projects.controller.ts`** · new file

```ts
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { ColumnsService } from './columns.service.js';
import {
  BoardDto,
  ColumnDto,
  CreateColumnDto,
  CreateProjectDto,
  MoveColumnDto,
  ProjectDto,
  UpdateColumnDto,
  UpdateProjectDto,
} from './project.dto.js';
import { ProjectsService } from './projects.service.js';

@ApiTags('projects')
@Controller(API_PREFIX)
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly columns: ColumnsService,
  ) {}

  @Get('workspaces/:workspaceId/projects')
  @ApiPage(ProjectDto)
  list(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<ProjectDto>> {
    return this.projects.list(workspaceId, userId, query.limit, query.cursor);
  }

  @Post('workspaces/:workspaceId/projects')
  create(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.create(workspaceId, userId, dto);
  }

  @Get('projects/:projectId')
  get(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<ProjectDto> {
    return this.projects.get(projectId, userId);
  }
```

**`src/modules/projects/projects.controller.ts`** · continue

```ts

  @Patch('projects/:projectId')
  update(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateProjectDto,
  ): Promise<ProjectDto> {
    return this.projects.update(projectId, userId, defined(dto));
  }

  @Delete('projects/:projectId')
  @HttpCode(204)
  delete(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<void> {
    return this.projects.delete(projectId, userId);
  }

  @Get('projects/:projectId/board')
  board(@IdParam('projectId') projectId: string, @CurrentUser() userId: string): Promise<BoardDto> {
    return this.projects.board(projectId, userId);
  }

  @Post('projects/:projectId/columns')
  createColumn(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.create(projectId, userId, dto);
  }

  @Patch('columns/:columnId')
  updateColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.update(columnId, userId, defined(dto));
  }

  @Delete('columns/:columnId')
  @HttpCode(204)
  deleteColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.columns.delete(columnId, userId);
  }

  @Post('columns/:columnId/move')
  @HttpCode(200)
  moveColumn(
    @IdParam('columnId') columnId: string,
    @CurrentUser() userId: string,
    @Body() dto: MoveColumnDto,
  ): Promise<ColumnDto> {
    return this.columns.move(columnId, userId, dto.afterColumnId);
  }
}
```

**`src/modules/projects/projects.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task } from '../../database/entities/task.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { BoardCache } from './board-cache.js';
import { ColumnsService } from './columns.service.js';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project, BoardColumn, Task]),
    AccessModule,
    ActivityModule,
    JobsModule,
    PublisherModule,
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ColumnsService, BoardCache],
  exports: [BoardCache],
})
export class ProjectsModule {}
```

**`src/app.module.ts`** · add after `import { HealthModule } from './modules/health/health.module.js';`

```ts
import { ProjectsModule } from './modules/projects/projects.module.js';
```

**`src/app.module.ts`** · add after `WorkspacesModule,`

```ts
    ProjectsModule,
```

**What's new**
- **`exports: [BoardCache]`**: Part 7's tasks module invalidates the board too, so it imports `ProjectsModule` for the cache.
- `POST /columns/:columnId/move` returns 200 (`@HttpCode(200)`): it's an action on an existing resource, not a creation.

**`test/helpers.ts`** · continue

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

**`test/projects.e2e-spec.ts`** · new file

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
} from './helpers.js';

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

**`test/projects.e2e-spec.ts`** · continue

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

**`test/projects.e2e-spec.ts`** · continue

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
 Test Files  9 passed (9)
      Tests  51 passed (51)
```

**Commit:** `feat: projects, columns and fractional ordering with a cached board`

---
## Part 7 · Tasks

Tasks are the busiest resource: a filtered, paginated list; per-project numbers (`TF-1`, `TF-2`) that stay unique under concurrent creates; PATCH with merge semantics; moves between columns; and every write invalidates the board and publishes an event.

### Step 7.1 · DTOs, types and the filtered list

**Goal:** the task DTOs, and `GET /projects/:projectId/tasks` with filters.

**Files:** `src/modules/tasks/task.dto.ts`, `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/task.dto.ts`** · new file

```ts
import { IsIn, IsString, Length, Matches, MaxLength } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto.js';
import {
  IsDateTime,
  IsId,
  IsNullable,
  IsOmittable,
  Trim,
} from '../../common/validation/decorators.js';
import { PRIORITIES, type Priority } from '../../database/entities/task.entity.js';

const UUID_OR_NONE = /^(none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export class ListTasksQueryDto extends PageQueryDto {
  @IsOmittable()
  @IsId()
  columnId?: string;

  @IsOmittable()
  @Matches(UUID_OR_NONE, { message: 'must be a UUID or "none"' })
  assigneeId?: string;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsDateTime()
  dueBefore?: string;
}

```

**`src/modules/tasks/task.dto.ts`** · continue

```ts
export class CreateTaskDto {
  @Trim()
  @IsString()
  @Length(1, 200)
  title: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOmittable()
  @IsId()
  columnId?: string;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsNullable()
  @IsId()
  assigneeId?: string | null;

  @IsOmittable()
  @IsNullable()
  @IsDateTime()
  dueAt?: string | null;
}

export class UpdateTaskDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOmittable()
  @IsNullable()
  @IsString()
  @MaxLength(10_000)
  description?: string | null;

  @IsOmittable()
  @IsIn(PRIORITIES)
  priority?: Priority;

  @IsOmittable()
  @IsNullable()
  @IsId()
  assigneeId?: string | null;

  @IsOmittable()
  @IsNullable()
  @IsDateTime()
  dueAt?: string | null;
}

export class MoveTaskDto {
  @IsId()
  columnId: string;

  // Required, but null is a value: "move to the top of the column".
  @IsNullable()
  @IsId()
  afterTaskId: string | null;
}
```

**What's new**
- **DTO inheritance:** `ListTasksQueryDto extends PageQueryDto` inherits `limit` and `cursor` with their decorators, and adds the filters. class-validator and the Swagger plugin both follow `extends`.
- `assigneeId` accepts a UUID **or the word `none`** ("unassigned"); one regex says both.
- `UpdateTaskDto` has no `columnId`: moving is its own endpoint with its own rules.

**`src/modules/tasks/tasks.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Not, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyBetween } from '../../common/fractional-index.js';
import { keyset } from '../../common/keyset.js';
import { retryOnPositionConflict } from '../../common/pg-errors.js';
import { invalid, notFound } from '../../common/problem.js';
import { BoardColumn } from '../../database/entities/board-column.entity.js';
import { Project } from '../../database/entities/project.entity.js';
import { Task, type Priority } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { ActivityService } from '../activity/activity.service.js';
import { BoardCache } from '../projects/board-cache.js';
import { TASK_RELATIONS, toTask, type TaskDto } from '../projects/project.dto.js';
import { RealtimePublisher, type ServerEventType } from '../realtime/realtime.publisher.js';

export interface TaskFilters {
  columnId?: string;
  assigneeId?: string;
  priority?: Priority;
  dueBefore?: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  columnId?: string;
  priority?: Priority;
  assigneeId?: string | null;
  dueAt?: string | null;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'columnId'>>;

/** ISO-8601 string from the wire → Date for Postgres; null and undefined pass through. */
function toDate<T extends null | undefined>(value: string | T): Date | T {
  return typeof value === 'string' ? new Date(value) : value;
}

async function loadTask(manager: EntityManager, id: string): Promise<Task> {
  const task = await manager.findOne(Task, { where: { id }, relations: TASK_RELATIONS });
  if (!task) throw notFound('Task');
  return task;
}
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts

@Injectable()
export class TasksService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(WorkspaceMember) private readonly members: Repository<WorkspaceMember>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
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
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const { columnId, assigneeId, priority, dueBefore } = filters;
    const query = this.tasks
      .createQueryBuilder('task')
      .innerJoinAndSelect('task.project', 'project')
      .leftJoinAndSelect('task.assignee', 'assignee')
      .innerJoinAndSelect('task.reporter', 'reporter')
      .where('task.projectId = :projectId', { projectId });
    // Named parameters (:columnId) are sent separately from the SQL text, like $1 in raw SQL.
    if (columnId) query.andWhere('task.columnId = :columnId', { columnId });
    if (assigneeId === 'none') query.andWhere('task.assigneeId IS NULL');
    else if (assigneeId) query.andWhere('task.assigneeId = :assigneeId', { assigneeId });
    if (priority) query.andWhere('task.priority = :priority', { priority });
    if (dueBefore) query.andWhere('task.dueAt < :dueBefore', { dueBefore: new Date(dueBefore) });
    const rows = await keyset(query, 'task.id', 'DESC', limit, after);
    return toPage(rows, limit, toTask, (t) => ({ id: t.id }));
  }

  async get(taskId: string, userId: string) {
    await this.access.task(taskId, userId);
    return toTask(await loadTask(this.dataSource.manager, taskId));
  }
```

**`src/modules/tasks/tasks.service.ts`** · continue

```ts
}
```

**What's new**
- The import list already names what the next two steps use; until Step 7.3 ESLint reports some of them as unused, and the type checker is happy.
- **Building a query conditionally:** `query.andWhere(...)` adds one condition per filter present; values go in as **named parameters** (`:columnId`), never into the SQL text.
- `loadTask(manager, id)` loads a task with `TASK_RELATIONS` through any `EntityManager`, inside or outside a transaction (`this.dataSource.manager` is the non-transactional one).
- `toDate` is a small generic: a string becomes a `Date`, while `null` and `undefined` pass through with their types intact, which matters for PATCH (`null` clears, `undefined` leaves alone).

> **🧠 DSA & scalability · the filtered task list**
> - **Data structure:** B-tree indexes `tasks_project_idx (project_id, id)` and `tasks_assignee_idx (assignee_id, id)`.
> - **Algorithm:** `WHERE project_id = $1 [AND column_id … AND priority … AND due_at < …] AND id < :cursor ORDER BY id DESC LIMIT n + 1`, with three many-to-one joins for the DTO.
> - **Complexity:** O(log N + n) when the index order matches (`project_id`, then `id`); selective extra filters are applied while walking it.
> - **Why it scales:** keyset pagination keeps deep pages cheap, and the joins are on primary keys.
> - **Rejected:** one endpoint per filter combination; client-side filtering of the whole board.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: tasks service with filtered list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** `POST /projects/:projectId/tasks`, with numbers that are unique and gap-free per project, even when two people create tasks at the same moment.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · add after `get()` (after its closing `}`)

```ts

  async create(projectId: string, userId: string, input: CreateTaskInput) {
    const { project } = await this.access.project(projectId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);

    const task = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        // Row-locks the project first, so concurrent creates queue up here. Everything below
        // then sees the previous creator's committed task (READ COMMITTED re-reads per statement).
        const counter = await manager
          .createQueryBuilder()
          .update(Project)
          .set({ nextTaskNumber: () => 'next_task_number + 1' })
          .where('id = :projectId', { projectId })
          .returning('next_task_number')
          .execute();
        const [row] = counter.raw as { next_task_number: number }[];
        const columnId = await this.resolveColumn(manager, projectId, input.columnId);
        const last = await manager.findOne(Task, {
          where: { columnId },
          order: { position: 'DESC' },
        });
        const created = await manager.save(
          manager.create(Task, {
            projectId,
            columnId,
            number: row ? row.next_task_number - 1 : 1,
            title: input.title,
            description: input.description ?? null,
            priority: input.priority ?? 'medium',
            assigneeId: input.assigneeId ?? null,
            reporterId: userId,
            dueAt: toDate(input.dueAt) ?? null,
            position: keyBetween(last?.position ?? null, null),
          }),
        );
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId,
          taskId: created.id,
          type: 'task.created',
          data: { key: `${project.key}-${created.number}`, title: created.title },
        });
        return loadTask(manager, created.id);
      }),
    );
    return this.afterWrite(projectId, 'task.created', toTask(task));
  }
```

**`src/modules/tasks/tasks.service.ts`** · add before the class's closing `}`

```ts

  private async resolveColumn(
    manager: EntityManager,
    projectId: string,
    columnId: string | undefined,
  ) {
    if (columnId === undefined) {
      const first = await manager.findOne(BoardColumn, {
        where: { projectId },
        order: { position: 'ASC' },
      });
      if (!first) throw invalid('columnId', 'the project has no columns');
      return first.id;
    }
    const column = await manager.findOneBy(BoardColumn, { id: columnId });
    if (column?.projectId !== projectId) {
      throw invalid('columnId', 'must be a column of this project');
    }
    return column.id;
  }

  private async assertAssignable(workspaceId: string, assigneeId: string) {
    const isMember = await this.members.existsBy({ workspaceId, userId: assigneeId });
    if (!isMember) throw invalid('assigneeId', 'must be a member of the workspace');
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

**What's new**
- **`UPDATE … SET next_task_number = next_task_number + 1 … RETURNING`** through the query builder: `.set({ nextTaskNumber: () => 'next_task_number + 1' })` (a function means "raw SQL expression"), and `.returning('next_task_number')`. The result's `raw` holds the returned rows.
- **`resolveColumn`** defaults to the first column and checks that a given column belongs to the project; `assertAssignable` checks the assignee is a workspace member (`existsBy`). Both reject with 422s on the right field.
- `afterWrite` is generic over what it publishes: a full `TaskDto`, or just `{ id, … }` for a delete.

> **🧠 DSA & scalability · the per-project counter**
> - **Data structure:** one integer column per project, `projects.next_task_number`.
> - **Algorithm:** in the creating transaction, `UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = $1 RETURNING next_task_number`; the task's number is the returned value minus one.
> - **Complexity:** O(1); one row lock per create, held until commit.
> - **Why it's correct:** the `UPDATE` takes a row lock, so concurrent creates in one project queue on it; each sees the previous one's committed value (READ COMMITTED re-reads the row after the wait). Numbers are unique and gap-free; `UNIQUE (project_id, number)` backs it up. Projects don't contend with each other.
> - **Rejected:** `MAX(number) + 1` (two transactions read the same max), a Postgres sequence per project (thousands of sequences, and gaps on rollback).

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: task creation with per-project numbering`

### Step 7.3 · Update, move and delete

**Goal:** PATCH with merge semantics and a change log, moves between columns, and delete with storage cleanup.

**Files:** `src/modules/tasks/tasks.service.ts`

**`src/modules/tasks/tasks.service.ts`** · add after `create()` (after its closing `}`)

```ts

  async update(taskId: string, userId: string, input: UpdateTaskInput) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.assigneeId) await this.assertAssignable(project.workspaceId, input.assigneeId);
    const values = { ...input, ...('dueAt' in input ? { dueAt: toDate(input.dueAt) } : {}) };

    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of ['title', 'description', 'priority', 'assigneeId', 'dueAt'] as const) {
      const to = values[field];
      if (to === undefined) continue;
      const from = before[field];
      const same =
        from instanceof Date && to instanceof Date ? from.getTime() === to.getTime() : from === to;
      if (!same) {
        changes[field] = {
          from: from instanceof Date ? from.toISOString() : from,
          to: to instanceof Date ? to.toISOString() : to,
        };
      }
    }

    const task = await this.dataSource.transaction(async (manager) => {
      await manager.update(
        Task,
        { id: taskId },
        { ...values, ...('dueAt' in changes ? { reminderSentAt: null } : {}) },
      );
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'task.updated',
        data: { changes },
      });
      return loadTask(manager, taskId);
    });
    return this.afterWrite(project.id, 'task.updated', toTask(task));
  }
```

**What's new**
- **Merge semantics:** fields left out of the body stay as they are (`defined()` in the controller drops them), `null` clears. `'dueAt' in input` distinguishes "dueAt: null" from "no dueAt".
- **The activity event records only what changed**, as `{ field: { from, to } }`; `Date`s compare by `getTime()`, since two `Date` objects are never `===`.
- Changing the due date resets `reminderSentAt`, so the new date gets its own reminder (Part 11).

**`src/modules/tasks/tasks.service.ts`** · add after `update()` (after its closing `}`)

```ts

  async move(
    taskId: string,
    userId: string,
    input: { columnId: string; afterTaskId: string | null },
  ) {
    const { task: before, project } = await this.access.task(taskId, userId, 'member');
    if (input.afterTaskId === taskId) {
      throw invalid('afterTaskId', 'cannot place a task after itself');
    }

    const task = await retryOnPositionConflict(() =>
      this.dataSource.transaction(async (manager) => {
        const column = await manager.findOneBy(BoardColumn, { id: input.columnId });
        if (column?.projectId !== project.id) {
          throw invalid('columnId', 'must be a column of the same project');
        }
        let lower: string | null = null;
        if (input.afterTaskId !== null) {
          const after = await manager.findOneBy(Task, { id: input.afterTaskId });
          if (after?.columnId !== input.columnId) {
            throw invalid('afterTaskId', 'must be a task in the target column');
          }
          lower = after.position;
        }
        const next = await manager.findOne(Task, {
          where: {
            columnId: input.columnId,
            id: Not(taskId),
            ...(lower !== null ? { position: MoreThan(lower) } : {}),
          },
          order: { position: 'ASC' },
        });
        await manager.update(
          Task,
          { id: taskId },
          { columnId: input.columnId, position: keyBetween(lower, next?.position ?? null) },
        );
        await this.activity.record(manager, {
          workspaceId: project.workspaceId,
          actorId: userId,
          projectId: project.id,
          taskId,
          type: 'task.moved',
          data: { fromColumnId: before.columnId, toColumnId: input.columnId },
        });
        return loadTask(manager, taskId);
      }),
    );
    return this.afterWrite(project.id, 'task.moved', toTask(task));
  }
```

**`src/modules/tasks/tasks.service.ts`** · add after `move()` (after its closing `}`)

```ts

  async delete(taskId: string, userId: string) {
    const { task, project } = await this.access.task(taskId, userId, 'member');
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Task, { id: taskId });
      await this.activity.record(manager, {
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
- **A move is one UPDATE of `column_id` and `position`**, computed from the target column's neighbours (the same pattern as columns), inside `retryOnPositionConflict`.
- Deleting a task enqueues the deletion of its attachments' storage prefix; the database rows cascade.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output (every import is used now).

**Commit:** `feat: task update, move and delete`

### Step 7.4 · Controller and module

**Goal:** the six task routes.

**Files:** `src/modules/tasks/tasks.controller.ts`, `src/modules/tasks/tasks.module.ts`, `src/app.module.ts`

**`src/modules/tasks/tasks.controller.ts`** · new file

```ts
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { defined, PatchBody } from '../../common/validation/decorators.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { TaskDto } from '../projects/project.dto.js';
import { CreateTaskDto, ListTasksQueryDto, MoveTaskDto, UpdateTaskDto } from './task.dto.js';
import { TasksService } from './tasks.service.js';

@ApiTags('tasks')
@Controller(API_PREFIX)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('projects/:projectId/tasks')
  @ApiPage(TaskDto)
  list(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Query() query: ListTasksQueryDto,
  ): Promise<Page<TaskDto>> {
    const { limit, cursor, ...filters } = query;
    return this.tasks.list(projectId, userId, defined(filters), limit, cursor);
  }

  @Post('projects/:projectId/tasks')
  create(
    @IdParam('projectId') projectId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.create(projectId, userId, dto);
  }

  @Get('tasks/:taskId')
  get(@IdParam('taskId') taskId: string, @CurrentUser() userId: string): Promise<TaskDto> {
    return this.tasks.get(taskId, userId);
  }

  @Patch('tasks/:taskId')
  update(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @PatchBody() dto: UpdateTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.update(taskId, userId, defined(dto));
  }

  @Delete('tasks/:taskId')
  @HttpCode(204)
  delete(@IdParam('taskId') taskId: string, @CurrentUser() userId: string): Promise<void> {
    return this.tasks.delete(taskId, userId);
  }

  @Post('tasks/:taskId/move')
  @HttpCode(200)
  move(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: MoveTaskDto,
  ): Promise<TaskDto> {
    return this.tasks.move(taskId, userId, dto);
  }
}
```

**`src/modules/tasks/tasks.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../database/entities/task.entity.js';
import { WorkspaceMember } from '../../database/entities/workspace-member.entity.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { TasksController } from './tasks.controller.js';
import { TasksService } from './tasks.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, WorkspaceMember]),
    AccessModule,
    ActivityModule,
    JobsModule,
    // For BoardCache, which ProjectsModule exports.
    ProjectsModule,
    PublisherModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
```

**`src/app.module.ts`** · add after `import { ProjectsModule } from './modules/projects/projects.module.js';`

```ts
import { TasksModule } from './modules/tasks/tasks.module.js';
```

**`src/app.module.ts`** · add after `ProjectsModule,`

```ts
    TasksModule,
```

**What's new**
- `const { limit, cursor, ...filters } = query` splits the query DTO with a rest pattern; `defined(filters)` keeps only the filters sent.
- `TasksModule` imports `ProjectsModule` for `BoardCache`, and `PublisherModule` for events; the comment says why, since an import with no visible use is easy to delete by mistake.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** numbering under concurrency, fractional moves, cache invalidation, PATCH semantics, assignment rules, filters, roles, and the column-delete guard.

**Files:** `test/tasks.e2e-spec.ts`

**`test/tasks.e2e-spec.ts`** · new file

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
  type TestResponse,
} from './helpers.js';

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

**`test/tasks.e2e-spec.ts`** · continue

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

**`test/tasks.e2e-spec.ts`** · continue

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

**`test/tasks.e2e-spec.ts`** · continue

```ts

  it('serves the board from cache and invalidates it on writes', async () => {
    await createTask('Cached');
    await boardTitles();
    expect(await ctx.redis.exists(`cache:board:${f.projectId}`)).toBe(1);
    await createTask('Fresh');
    expect(await ctx.redis.exists(`cache:board:${f.projectId}`)).toBe(0);
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

**`test/tasks.e2e-spec.ts`** · continue

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
    const titles = (res: TestResponse) =>
      res.json<{ items: TaskBody[] }>().items.map((t) => t.title);
```

**`test/tasks.e2e-spec.ts`** · continue

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
- The concurrency test fires ten creates with `Promise.all` and expects the numbers 1–10, each exactly once: the counter's row lock at work.
- The cache test reads the board, checks the Redis key exists, writes a task, and checks the key is gone.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  10 passed (10)
      Tests  60 passed (60)
```

**Commit:** `test: task tests`

---
## Part 8 · Comments, activity feed & search

Three read-heavy features on top of what exists: comments on tasks, the workspace activity feed (the log you've been writing since Part 5), and Postgres full-text search with ranked, highlighted results.

### Step 8.1 · Comments

**Goal:** list (oldest first), create, edit (author only) and delete (author or admin) comments.

**Files:** `src/modules/comments/comment.dto.ts`, `src/modules/comments/comments.service.ts`, `src/modules/comments/comments.controller.ts`, `src/modules/comments/comments.module.ts`

**`src/modules/comments/comment.dto.ts`** · new file

```ts
import { IsString, Length } from 'class-validator';
import type { Comment } from '../../database/entities/comment.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class CommentBodyDto {
  @IsString()
  @Length(1, 5000)
  body: string;
}

export class CommentDto {
  id: string;
  taskId: string;
  author: UserSummaryDto;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export const toComment = (c: Comment): CommentDto => ({
  id: c.id,
  taskId: c.taskId,
  author: toUserSummary(c.author),
  body: c.body,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});
```

**`src/modules/comments/comments.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { forbidden, notFound } from '../../common/problem.js';
import { Comment } from '../../database/entities/comment.entity.js';
import { AccessService } from '../access/access.service.js';
import { atLeast } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { toComment } from './comment.dto.js';

async function loadComment(manager: EntityManager, id: string) {
  const comment = await manager.findOne(Comment, { where: { id }, relations: { author: true } });
  if (!comment) throw notFound('Comment');
  return toComment(comment);
}

@Injectable()
export class CommentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Comment) private readonly comments: Repository<Comment>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly realtime: RealtimePublisher,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.comments
      .createQueryBuilder('comment')
      .innerJoinAndSelect('comment.author', 'author')
      .where('comment.taskId = :taskId', { taskId });
    const rows = await keyset(query, 'comment.id', 'ASC', limit, after);
    return toPage(rows, limit, toComment, (c) => ({ id: c.id }));
  }

  async create(taskId: string, userId: string, body: string) {
    const { project } = await this.access.task(taskId, userId, 'member');
    const comment = await this.dataSource.transaction(async (manager) => {
      const created = await manager.save(
        manager.create(Comment, { taskId, authorId: userId, body }),
      );
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId,
        type: 'comment.created',
        data: { commentId: created.id },
      });
      return loadComment(manager, created.id);
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
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Comment, { id: commentId }, { body });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: comment.taskId,
        type: 'comment.updated',
        data: { commentId },
      });
      return loadComment(manager, commentId);
    });
  }

  async delete(commentId: string, userId: string) {
    const { comment, project, membership } = await this.access.comment(commentId, userId);
    if (comment.authorId !== userId && !atLeast(membership.role, 'admin')) {
      throw forbidden('Only the author or an admin can delete a comment');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Comment, { id: commentId });
      await this.activity.record(manager, {
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

**`src/modules/comments/comments.controller.ts`** · new file

```ts
import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { CommentBodyDto, CommentDto } from './comment.dto.js';
import { CommentsService } from './comments.service.js';

@ApiTags('comments')
@Controller(API_PREFIX)
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get('tasks/:taskId/comments')
  @ApiPage(CommentDto)
  list(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<CommentDto>> {
    return this.comments.list(taskId, userId, query.limit, query.cursor);
  }

  @Post('tasks/:taskId/comments')
  create(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.create(taskId, userId, dto.body);
  }

  @Patch('comments/:commentId')
  update(
    @IdParam('commentId') commentId: string,
    @CurrentUser() userId: string,
    @Body() dto: CommentBodyDto,
  ): Promise<CommentDto> {
    return this.comments.update(commentId, userId, dto.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  delete(@IdParam('commentId') commentId: string, @CurrentUser() userId: string): Promise<void> {
    return this.comments.delete(commentId, userId);
  }
}
```

**`src/modules/comments/comments.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comment } from '../../database/entities/comment.entity.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { PublisherModule } from '../realtime/publisher.module.js';
import { CommentsController } from './comments.controller.js';
import { CommentsService } from './comments.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Comment]), AccessModule, ActivityModule, PublisherModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}
```

**What's new**
- **Ownership rules on top of roles:** `access.comment()` returns the comment and the caller's membership; editing requires `authorId === userId`; deleting accepts the author or `atLeast(role, 'admin')`.
- Comments page **oldest first** (`ASC`), the reading order of a conversation.
- `comment.created` is published to the project channel, so an open task drawer shows new comments live.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: comments`

### Step 8.2 · The activity feed

**Goal:** `GET /workspaces/:workspaceId/activity`, newest first, optionally filtered by project or task.

**Files:** `src/modules/activity/activity.dto.ts`, `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.controller.ts`, `src/modules/activity/activity.module.ts`

**`src/modules/activity/activity.dto.ts`** · new file

```ts
import { PageQueryDto } from '../../common/page-query.dto.js';
import { IsId, IsOmittable } from '../../common/validation/decorators.js';
import type { ActivityEvent } from '../../database/entities/activity-event.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export class ActivityQueryDto extends PageQueryDto {
  @IsOmittable()
  @IsId()
  projectId?: string;

  @IsOmittable()
  @IsId()
  taskId?: string;
}

export class ActivityEventDto {
  id: string;
  workspaceId: string;
  projectId: string | null;
  taskId: string | null;
  actor: UserSummaryDto;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export const toActivityEvent = (e: ActivityEvent): ActivityEventDto => ({
  id: e.id,
  workspaceId: e.workspaceId,
  projectId: e.projectId,
  taskId: e.taskId,
  actor: toUserSummary(e.actor),
  type: e.type,
  data: e.data as Record<string, unknown>,
  createdAt: e.createdAt.toISOString(),
});
```

**`src/modules/activity/activity.service.ts`** · add after `import { Repository, type EntityManager } from 'typeorm';`

```ts
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
```

**`src/modules/activity/activity.service.ts`** · add after `import { AccessService } from '../access/access.service.js';`

```ts
import { toActivityEvent } from './activity.dto.js';
```

**`src/modules/activity/activity.service.ts`** · add after `record()` (after its closing `}`)

```ts

  async list(
    workspaceId: string,
    userId: string,
    filter: { projectId?: string; taskId?: string },
    limit: number,
    cursor?: string,
  ) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.events
      .createQueryBuilder('event')
      .innerJoinAndSelect('event.actor', 'actor')
      .where('event.workspaceId = :workspaceId', { workspaceId });
    if (filter.projectId) query.andWhere('event.projectId = :projectId', filter);
    if (filter.taskId) query.andWhere('event.taskId = :taskId', filter);
    const rows = await keyset(query, 'event.id', 'DESC', limit, after);
    return toPage(rows, limit, toActivityEvent, (e) => ({ id: e.id }));
  }
```

**`src/modules/activity/activity.controller.ts`** · new file

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { ActivityEventDto, ActivityQueryDto } from './activity.dto.js';
import { ActivityService } from './activity.service.js';

@ApiTags('activity')
@Controller(API_PREFIX)
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('workspaces/:workspaceId/activity')
  @ApiPage(ActivityEventDto)
  list(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<Page<ActivityEventDto>> {
    const { limit, cursor, ...filter } = query;
    return this.activity.list(workspaceId, userId, filter, limit, cursor);
  }
}
```

**`src/modules/activity/activity.module.ts`** · add after `import { AccessModule } from '../access/access.module.js';`

```ts
import { ActivityController } from './activity.controller.js';
```

**`src/modules/activity/activity.module.ts`** · add after `imports: [TypeOrmModule.forFeature([ActivityEvent]), AccessModule],`

```ts
  controllers: [ActivityController],
```

**What's new**
- `query.andWhere('event.projectId = :projectId', filter)` passes the whole filter object as parameters; TypeORM picks the names the SQL mentions.
- The partial indexes from Part 2 (`activity_project_idx … WHERE project_id IS NOT NULL`) serve the filtered feeds; the unfiltered feed uses `(workspace_id, id)`.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: activity feed`

### Step 8.3 · Full-text search

**Goal:** `GET /workspaces/:workspaceId/search?q=…`: ranked results with safely highlighted snippets, paginated by rank.

**Files:** `src/modules/search/search.dto.ts`, `src/modules/search/search.service.ts`, `src/modules/search/search.service.spec.ts`, `src/modules/search/search.controller.ts`, `src/modules/search/search.module.ts`

**`src/modules/search/search.dto.ts`** · new file

```ts
import { IsString, Length } from 'class-validator';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { TaskDto } from '../projects/project.dto.js';

export class SearchQueryDto extends PageQueryDto {
  @IsString()
  @Length(1, 200)
  q: string;
}

export class SearchHitDto {
  task: TaskDto;
  rank: number;
  headline: string;
}
```

**`src/modules/search/search.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { decodeCursor, isRankCursor, toPage } from '../../common/cursor.js';
import { Task } from '../../database/entities/task.entity.js';
import { AccessService } from '../access/access.service.js';
import { TASK_RELATIONS, toTask } from '../projects/project.dto.js';

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

@Injectable()
export class SearchService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    private readonly access: AccessService,
  ) {}

```

**`src/modules/search/search.service.ts`** · continue

```ts
  async search(workspaceId: string, userId: string, q: string, limit: number, cursor?: string) {
    await this.access.member(workspaceId, userId);
    const after = cursor ? decodeCursor(cursor, isRankCursor) : undefined;
    // Raw SQL with numbered parameters ($1, $2, …): values travel separately from the text,
    // so nothing the user typed is ever parsed as SQL.
    const params: unknown[] = [`StartSel=${START}, StopSel=${STOP}`, q, workspaceId, limit + 1];
    // rank is a float4 (`real`); casting the cursor value back to real makes the
    // row comparison exact, because JSON carries the shortest round-tripping decimal.
    let afterClause = '';
    if (after) {
      params.push(after.rank, after.id);
      afterClause = 'AND (ts_rank(t.search_vector, query), t.id) < ($5::real, $6::uuid)';
    }
    const hits = await this.dataSource.query<Hit[]>(
      `SELECT t.id,
              ts_rank(t.search_vector, query) AS rank,
              ts_headline('english', t.title || ' ' || coalesce(t.description, ''), query, $1) AS headline
       FROM tasks t
       JOIN projects p ON p.id = t.project_id,
            websearch_to_tsquery('english', $2) AS query
       WHERE p.workspace_id = $3::uuid
         AND t.search_vector @@ query
         ${afterClause}
       ORDER BY rank DESC, t.id DESC
       LIMIT $4`,
      params,
    );

    const found = hits.length
      ? await this.tasks.find({
          where: { id: In(hits.map((h) => h.id)) },
          relations: TASK_RELATIONS,
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

**`src/modules/search/search.service.spec.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { toSafeHeadline } from './search.service.js';

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
- **Raw SQL when the ORM has nothing to say.** `ts_rank`, `ts_headline` and `websearch_to_tsquery` aren't part of TypeORM's API, so the query is SQL through `dataSource.query(sql, params)` with **numbered parameters** (`$1`, `$2`). Then one repository query loads the matching tasks with their relations, and a `Map` puts them back in rank order.
- **`websearch_to_tsquery`** understands what people type into search boxes: `login -oauth "reset password"`. It never raises a syntax error, unlike `to_tsquery`.
- **Safe highlights:** `ts_headline` can't HTML-escape. We ask it to mark matches with control characters (`\u0001`, `\u0002`), escape the whole snippet, then swap the markers for `<mark>` tags. A task titled `<script>` comes back escaped; only our `<mark>` tags are HTML.
- **A cursor with two parts:** results order by `(rank DESC, id DESC)`, so the cursor carries both, and `(rank, id) < ($5::real, $6::uuid)` is a **row comparison** that resumes exactly after the last result. `ts_rank` returns `real` (float4); casting the cursor's value back to `real` makes equal ranks compare equal.

**`src/modules/search/search.controller.ts`** · new file

```ts
import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import { SearchHitDto, SearchQueryDto } from './search.dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller(API_PREFIX)
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('workspaces/:workspaceId/search')
  @ApiPage(SearchHitDto)
  find(
    @IdParam('workspaceId') workspaceId: string,
    @CurrentUser() userId: string,
    @Query() query: SearchQueryDto,
  ): Promise<Page<SearchHitDto>> {
    return this.search.search(workspaceId, userId, query.q, query.limit, query.cursor);
  }
}
```

**`src/modules/search/search.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from '../../database/entities/task.entity.js';
import { AccessModule } from '../access/access.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [TypeOrmModule.forFeature([Task]), AccessModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
```

> **🧠 DSA & scalability · full-text search**
> - **Data structure:** the stored `search_vector` (a `tsvector`: normalised word stems with positions, title weighted A, description B) under a **GIN inverted index**: word → posting list of rows.
> - **Algorithm:** parse the query to a `tsquery` → the GIN index intersects the posting lists → rank the matches (`ts_rank`, weights favour title hits) → sort by (rank, id) → `LIMIT n + 1` → headlines for those rows only.
> - **Complexity:** O(matches) to collect and rank; the index makes "which rows contain these words" independent of table size. Headlines are computed for the page only.
> - **Why it scales:** the vector is computed on write (a generated column), not per query; the workspace filter joins on indexed keys.
> - **Rejected:** `ILIKE '%term%'` (a full scan per search, no ranking or stemming); Elasticsearch (another system to run and keep in sync, for a feature Postgres covers at this size).

**✅ Checkpoint**

```bash
npx vitest run src/modules/search
```

Expected: `Tests  1 passed (1)`.

**Commit:** `feat: full-text search`

### Step 8.4 · Wiring and tests

**Goal:** the three modules in the app, and tests for all three features.

**Files:** `src/app.module.ts`, `test/collaboration.e2e-spec.ts`

**`src/app.module.ts`** · add after `import { CoreModule } from './core.module.js';`

```ts
import { ActivityModule } from './modules/activity/activity.module.js';
```

**`src/app.module.ts`** · add after `import { AuthModule } from './modules/auth/auth.module.js';`

```ts
import { CommentsModule } from './modules/comments/comments.module.js';
```

**`src/app.module.ts`** · add after `import { ProjectsModule } from './modules/projects/projects.module.js';`

```ts
import { SearchModule } from './modules/search/search.module.js';
```

**`src/app.module.ts`** · add after `TasksModule,`

```ts
    CommentsModule,
    SearchModule,
```

**`src/app.module.ts`** · add after `SearchModule,`

```ts
    ActivityModule,
```

**What's new**
- `ActivityModule` was already loaded (workspaces import it), but listing it in `AppModule` says the feed is a feature of the app, not just a helper.

**`test/collaboration.e2e-spec.ts`** · new file

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
} from './helpers.js';

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

**`test/collaboration.e2e-spec.ts`** · continue

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

**`test/collaboration.e2e-spec.ts`** · continue

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

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  12 passed (12)
      Tests  65 passed (65)
```

**Commit:** `feat: comments, activity feed and full-text search`

---
## Part 9 · Attachments (presigned S3 uploads)

Files never pass through the API. The client asks for an upload slot, PUTs the file **straight to S3** (RustFS locally) with a presigned URL, then tells the API it's done; the API checks the stored object's size and marks the attachment ready. Downloads work the same way in reverse.

### Step 9.1 · The storage wrapper

**Goal:** an injectable S3 client with exactly the four operations the app needs.

**Files:** `src/infra/storage.service.ts`, `src/infra/storage.module.ts`

```bash
npm i -E @aws-sdk/client-s3@3.1167.0 @aws-sdk/s3-request-presigner@3.1167.0
```

- **`@aws-sdk/client-s3`** is AWS SDK v3's S3 client: one command class per API call (`PutObjectCommand`, `HeadObjectCommand`), sent with `client.send()`. **`@aws-sdk/s3-request-presigner`** signs a command into a URL that a browser can use without credentials. Both work with any S3-compatible store.

**`src/infra/storage.service.ts`** · new file

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
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';

@Injectable()
export class Storage {
  private readonly internal: S3Client;
  // Signatures cover the host, so URLs for the browser must be signed with the public endpoint.
  private readonly presigner: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<Env, true>) {
    const base = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    };
    this.internal = new S3Client({ ...base, endpoint: config.get('S3_ENDPOINT', { infer: true }) });
    this.presigner = new S3Client({
      ...base,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }),
    });
    this.bucket = config.get('S3_BUCKET', { infer: true });
  }

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

**`src/infra/storage.service.ts`** · continue

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

**`src/infra/storage.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { Storage } from './storage.service.js';

@Module({ providers: [Storage], exports: [Storage] })
export class StorageModule {}
```

**What's new**
- **Two clients.** The API reaches RustFS at `S3_ENDPOINT` (inside Docker that's `http://rustfs:9000`), but a presigned URL is for the **browser**, and its signature covers the host name. So URLs are signed by a second client configured with `S3_PUBLIC_ENDPOINT`. Signing is local computation: the presigner never connects anywhere.
- **`forcePathStyle: true`** puts the bucket in the path (`host/bucket/key`) instead of a subdomain (`bucket.host`), which local S3 servers need.
- `ContentLength` in the signed PUT means S3 rejects an upload of any other size. `ResponseContentDisposition` makes the download save under the original file name (RFC 5987 encoding for non-ASCII names).
- `deletePrefix` pages through `ListObjectsV2` (1000 keys a page) and deletes each page in one `DeleteObjects` call.
- `StorageModule` is tiny and **not global**: only the attachments module and the worker need S3.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

**Commit:** `feat: s3 storage wrapper`

### Step 9.2 · The attachments service and routes

**Goal:** request an upload, complete it, list ready attachments, download and delete.

**Files:** `src/modules/attachments/attachment.dto.ts`, `src/modules/attachments/attachments.service.ts`, `src/modules/attachments/attachments.controller.ts`, `src/modules/attachments/attachments.module.ts`

**`src/modules/attachments/attachment.dto.ts`** · new file

```ts
import { IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { Attachment, AttachmentStatus } from '../../database/entities/attachment.entity.js';
import { toUserSummary, UserSummaryDto } from '../users/user.dto.js';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export class CreateAttachmentDto {
  // No slashes, backslashes or control characters (U+0000–U+001F).
  @IsString()
  @Length(1, 255)
  // eslint-disable-next-line no-control-regex
  @Matches(/^[^/\\\u0000-\u001f]+$/)
  fileName: string;

  @IsString()
  @Length(3, 127)
  @Matches(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/)
  contentType: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ATTACHMENT_BYTES)
  sizeBytes: number;
}

export class AttachmentDto {
  id: string;
  taskId: string;
  uploader: UserSummaryDto;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  status: AttachmentStatus;
  createdAt: string;
}

export class UploadTargetDto {
  url: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

export class AttachmentUploadDto {
  attachment: AttachmentDto;
  upload: UploadTargetDto;
}

export class DownloadUrlDto {
  url: string;
  expiresAt: string;
}

export const toAttachment = (a: Attachment): AttachmentDto => ({
  id: a.id,
  taskId: a.taskId,
  uploader: toUserSummary(a.uploader),
  fileName: a.fileName,
  contentType: a.contentType,
  sizeBytes: a.sizeBytes,
  status: a.status,
  createdAt: a.createdAt.toISOString(),
});
```

**What's new**
- File names may not contain slashes, backslashes or control characters; content types must look like `type/subtype`; sizes are 1 byte to 25 MB. `// eslint-disable-next-line no-control-regex` documents that the control-character range in the regex is deliberate.

**`src/modules/attachments/attachments.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { decodeCursor, isIdCursor, toPage } from '../../common/cursor.js';
import { keyset } from '../../common/keyset.js';
import { conflict, forbidden, notFound } from '../../common/problem.js';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { Storage } from '../../infra/storage.service.js';
import { Jobs } from '../../jobs/jobs.service.js';
import { AccessService } from '../access/access.service.js';
import { atLeast } from '../access/roles.js';
import { ActivityService } from '../activity/activity.service.js';
import { toAttachment, type AttachmentUploadDto } from './attachment.dto.js';

const UPLOAD_URL_TTL = 15 * 60;
const DOWNLOAD_URL_TTL = 5 * 60;

const expiresAt = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();

async function loadAttachment(manager: EntityManager, id: string) {
  const attachment = await manager.findOne(Attachment, {
    where: { id },
    relations: { uploader: true },
  });
  if (!attachment) throw notFound('Attachment');
  return toAttachment(attachment);
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
    private readonly storage: Storage,
    private readonly jobs: Jobs,
  ) {}

  async list(taskId: string, userId: string, limit: number, cursor?: string) {
    await this.access.task(taskId, userId);
    const after = cursor ? decodeCursor(cursor, isIdCursor).id : undefined;
    const query = this.attachments
      .createQueryBuilder('attachment')
      .innerJoinAndSelect('attachment.uploader', 'uploader')
      .where('attachment.taskId = :taskId', { taskId })
      .andWhere("attachment.status = 'ready'");
    const rows = await keyset(query, 'attachment.id', 'DESC', limit, after);
    return toPage(rows, limit, toAttachment, (a) => ({ id: a.id }));
  }

```

**`src/modules/attachments/attachments.service.ts`** · continue

```ts
  async create(
    taskId: string,
    userId: string,
    input: { fileName: string; contentType: string; sizeBytes: number },
  ): Promise<AttachmentUploadDto> {
    const { project } = await this.access.task(taskId, userId, 'member');
    // The id is generated here (not by the database) because the storage key needs it.
    const id = uuidv7();
    const storageKey = `projects/${project.id}/tasks/${taskId}/${id}`;
    await this.attachments.insert({
      id,
      taskId,
      uploaderId: userId,
      storageKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
    const url = await this.storage.presignUpload(
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_URL_TTL,
    );
    return {
      attachment: await loadAttachment(this.dataSource.manager, id),
      upload: {
        url,
        method: 'PUT',
        headers: { 'Content-Type': input.contentType },
        expiresAt: expiresAt(UPLOAD_URL_TTL),
      },
    };
  }

  async complete(attachmentId: string, userId: string) {
    const { attachment, project } = await this.access.attachment(attachmentId, userId);
    if (attachment.uploaderId !== userId) {
      throw forbidden('Only the uploader can complete an upload');
    }
    if (attachment.status === 'ready') return loadAttachment(this.dataSource.manager, attachmentId);
    const size = await this.storage.sizeOf(attachment.storageKey);
    if (size === null) throw conflict('The file has not been uploaded yet');
    if (size !== attachment.sizeBytes) throw conflict('The uploaded file size does not match');
    return this.dataSource.transaction(async (manager) => {
      await manager.update(Attachment, { id: attachmentId }, { status: 'ready' });
      await this.activity.record(manager, {
        workspaceId: project.workspaceId,
        actorId: userId,
        projectId: project.id,
        taskId: attachment.taskId,
        type: 'attachment.added',
        data: { attachmentId, fileName: attachment.fileName },
      });
      return loadAttachment(manager, attachmentId);
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
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(Attachment, { id: attachmentId });
      await this.activity.record(manager, {
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

**`src/modules/attachments/attachments.controller.ts`** · new file

```ts
import { Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Page } from '../../common/cursor.js';
import { ApiPage } from '../../common/http/api-page.js';
import { API_PREFIX } from '../../common/http/routes.js';
import { PageQueryDto } from '../../common/page-query.dto.js';
import { IdParam } from '../../common/validation/parse-id.pipe.js';
import { CurrentUser } from '../auth/decorators.js';
import {
  AttachmentDto,
  AttachmentUploadDto,
  CreateAttachmentDto,
  DownloadUrlDto,
} from './attachment.dto.js';
import { AttachmentsService } from './attachments.service.js';

@ApiTags('attachments')
@Controller(API_PREFIX)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get('tasks/:taskId/attachments')
  @ApiPage(AttachmentDto)
  list(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Query() query: PageQueryDto,
  ): Promise<Page<AttachmentDto>> {
    return this.attachments.list(taskId, userId, query.limit, query.cursor);
  }

  @Post('tasks/:taskId/attachments')
  create(
    @IdParam('taskId') taskId: string,
    @CurrentUser() userId: string,
    @Body() dto: CreateAttachmentDto,
  ): Promise<AttachmentUploadDto> {
    return this.attachments.create(taskId, userId, dto);
  }

  @Delete('attachments/:attachmentId')
  @HttpCode(204)
  delete(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<void> {
    return this.attachments.delete(attachmentId, userId);
  }

  @Post('attachments/:attachmentId/complete')
  @HttpCode(200)
  complete(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<AttachmentDto> {
    return this.attachments.complete(attachmentId, userId);
  }

  @Get('attachments/:attachmentId/download')
  download(
    @IdParam('attachmentId') attachmentId: string,
    @CurrentUser() userId: string,
  ): Promise<DownloadUrlDto> {
    return this.attachments.download(attachmentId, userId);
  }
}
```

**`src/modules/attachments/attachments.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../../database/entities/attachment.entity.js';
import { StorageModule } from '../../infra/storage.module.js';
import { JobsModule } from '../../jobs/jobs.module.js';
import { AccessModule } from '../access/access.module.js';
import { ActivityModule } from '../activity/activity.module.js';
import { AttachmentsController } from './attachments.controller.js';
import { AttachmentsService } from './attachments.service.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([Attachment]),
    AccessModule,
    ActivityModule,
    JobsModule,
    StorageModule,
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsService],
})
export class AttachmentsModule {}
```

**What's new**
- **The id is generated in Node** (`uuidv7()`), unlike everywhere else, because the storage key `projects/{projectId}/tasks/{taskId}/{id}` must be known before the row exists. `insert` with an explicit `id` overrides the column default.
- **`complete` is idempotent**: calling it twice returns the ready attachment. It trusts S3, not the client: `HeadObject` must find the object, with exactly the declared size.
- Only `ready` attachments are listed or downloadable; pending ones are cleaned up by a scheduled job (Part 11) if the upload never completes.

> **🧠 DSA & scalability · presigned uploads**
> - **Data structure:** an `attachments` row (status `pending` → `ready`) plus an S3 object under a hierarchical key; partial indexes `attachments_task_idx … WHERE status = 'ready'` and `attachments_pending_idx … WHERE status = 'pending'`.
> - **Algorithm:** create row + sign URL (no I/O to S3) → client PUTs to S3 → `complete` HEADs the object, checks the size, flips the status in a transaction with the activity event.
> - **Complexity:** O(1) API work per upload, independent of file size.
> - **Why it scales:** the bytes go client → S3 directly; API instances never buffer files, so a 25 MB upload costs the API the same as a 1 KB one. Prefix keys make "delete everything for this task/project" one listing.
> - **Rejected:** multipart uploads through the API (memory and bandwidth on every instance); public buckets (anyone with a key could read files).

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: attachments service and routes`

### Step 9.3 · Wiring and tests

**Goal:** the module in the app, the bucket guaranteed in tests, and an end-to-end upload test against real RustFS.

**Files:** `src/app.module.ts`, `test/global-setup.ts`, `test/attachments.e2e-spec.ts`

**`src/app.module.ts`** · add after `import { ActivityModule } from './modules/activity/activity.module.js';`

```ts
import { AttachmentsModule } from './modules/attachments/attachments.module.js';
```

**`src/app.module.ts`** · add after `SearchModule,`

```ts
    AttachmentsModule,
```

**`test/global-setup.ts`** · add at the top

```ts
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
```

**`test/global-setup.ts`** · add after `import { DataSource } from 'typeorm';`

```ts
import { validateEnv } from '../src/config/env.js';
```

**`test/global-setup.ts`** · add at the end of `setup()`, before its closing `}`

```ts
  const env = validateEnv({ ...process.env, ...testEnv });
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  }
  s3.destroy();
```

**What's new**
- The global setup now also makes sure the bucket exists (`HeadBucket`, create on failure), so tests pass even if `s3-init` hasn't run. `validateEnv` reads the S3 settings with the same rules as the app.

**`test/attachments.e2e-spec.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createFixture, createTestContext, resetState, send, type Fixture } from './helpers.js';

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

**`test/attachments.e2e-spec.ts`** · continue

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

**`test/attachments.e2e-spec.ts`** · continue

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
- The first test does what a browser does: request a slot, `fetch(url, { method: 'PUT' })` the bytes **to RustFS**, complete, then download through the presigned GET and compare the bytes.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  13 passed (13)
      Tests  68 passed (68)
```

**Commit:** `feat: attachments via presigned S3 uploads`

---
## Part 10 · Real-time (WebSockets, Pub/Sub, presence)

Board changes reach every open browser within milliseconds, across any number of API instances. The protocol (README §9) and the Redis design are Express's. What changes is the shape: Nest's **gateways** are classes whose methods handle message types, the way controllers handle routes.

### Step 10.1 · Tickets, presence and the message parser

**Goal:** single-use connection tickets, per-connection presence, and a parser that turns our `{ type, payload }` frames into what Nest routes on.

**Files:** `src/modules/realtime/ticket.dto.ts`, `src/modules/realtime/tickets.service.ts`, `src/modules/realtime/presence.service.ts`, `src/modules/realtime/client-message.ts`, `src/modules/realtime/client-message.spec.ts`

```bash
npm i -E @nestjs/websockets@12.4.2 @nestjs/platform-ws@12.4.2 ws@8.22.2
npm i -D -E @types/ws@8.18.2
```

- **`@nestjs/websockets`** provides gateways and their decorators. **`@nestjs/platform-ws`** is the adapter for the plain **`ws`** library. Nest's default adapter is Socket.IO, which adds its own protocol on top of WebSockets; the contract specifies plain WebSockets with a JSON envelope, so we use `ws`, as Express and Fastify did.

**`src/modules/realtime/ticket.dto.ts`** · new file

```ts
export class TicketDto {
  ticket: string;
  expiresAt: string;
}
```

**`src/modules/realtime/tickets.service.ts`** · new file

```ts
import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';
import type { TicketDto } from './ticket.dto.js';

const TTL_SECONDS = 30;
const key = (ticket: string) => `ws:ticket:${ticket}`;

/** Browsers can't send Authorization on a WebSocket handshake, so they trade a JWT for a ticket. */
@Injectable()
export class Tickets {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async issue(userId: string): Promise<TicketDto> {
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

**`src/modules/realtime/presence.service.ts`** · new file

```ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis.module.js';
import { toUserSummary, type UserSummaryDto } from '../users/user.dto.js';
import { UsersService } from '../users/users.service.js';

const STALE_AFTER_MS = 60_000;
const KEY_TTL_SECONDS = 300;
const key = (projectId: string) => `presence:project:${projectId}`;
const member = (userId: string, connectionId: string) => `${userId}:${connectionId}`;

/**
 * Sorted set per project: member = "userId:connectionId", score = last seen (ms).
 * One user with two tabs has two members, so closing one tab doesn't hide them.
 */
@Injectable()
export class Presence {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly users: UsersService,
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
    const users = await this.users.findByIds(userIds);
    return users.map(toUserSummary).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
}
```

**What's new**
- **Why tickets:** browsers can't set an `Authorization` header on a WebSocket handshake, and a JWT in the URL would land in proxy logs for 15 minutes. So the client trades its JWT for a 30-second, single-use ticket (`POST /ws/ticket`) and connects with `?ticket=`. **`GETDEL`** reads and deletes in one atomic command: a ticket works once.
- Presence is the same sorted set as Express: one member per **connection** (`userId:connectionId`), so a user with two tabs stays online until both close.

**`src/modules/realtime/client-message.ts`** · new file

```ts
import type { RawData } from 'ws';
import { UUID } from '../../common/validation/parse-id.pipe.js';

/** What Nest's WsAdapter routes on: `event` picks the @SubscribeMessage handler, `data` is its argument. */
export interface RoutedMessage {
  event: 'subscribe' | 'unsubscribe' | 'ping' | 'invalid';
  data: { projectId: string } | undefined;
}

const INVALID: RoutedMessage = { event: 'invalid', data: undefined };

function rawToString(data: RawData | string): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/**
 * Nest expects `{ event, data }` frames; our protocol is `{ type, payload }`. This parser
 * translates, and validates while it's at it: anything malformed is routed to the "invalid"
 * handler instead of being dropped silently.
 */
export function parseClientMessage(raw: RawData | string): RoutedMessage {
  let message: unknown;
  try {
    message = JSON.parse(rawToString(raw));
  } catch {
    return INVALID;
  }
  if (typeof message !== 'object' || message === null) return INVALID;
  const { type, payload } = message as { type?: unknown; payload?: unknown };
  if (type === 'ping') return { event: 'ping', data: undefined };
  if (type !== 'subscribe' && type !== 'unsubscribe') return INVALID;
  if (typeof payload !== 'object' || payload === null) return INVALID;
  const { projectId } = payload as { projectId?: unknown };
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return INVALID;
  return { event: type, data: { projectId } };
}
```

**`src/modules/realtime/client-message.spec.ts`** · new file

```ts
import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './client-message.js';

const projectId = '01a18b7e-951f-71f4-affb-2b64a14174e2';

describe('parseClientMessage', () => {
  it('translates { type, payload } into the { event, data } Nest routes on', () => {
    const raw = JSON.stringify({ type: 'subscribe', payload: { projectId } });
    expect(parseClientMessage(raw)).toEqual({ event: 'subscribe', data: { projectId } });
    expect(parseClientMessage(Buffer.from('{"type":"ping"}'))).toEqual({ event: 'ping' });
  });

  it.each([
    'not json',
    '42',
    '{"type":"nonsense"}',
    '{"type":"subscribe"}',
    '{"type":"subscribe","payload":{"projectId":"nope"}}',
  ])('routes %s to the invalid handler', (raw) => {
    expect(parseClientMessage(raw)).toEqual({ event: 'invalid' });
  });
});
```

**What's new**
- **Nest's `WsAdapter` routes `{ event, data }` frames** to the gateway method decorated with `@SubscribeMessage(event)`. Our protocol uses `{ type, payload }`. The adapter accepts a custom `messageParser` (Step 10.3 plugs this one in), which translates **and validates**: anything malformed is routed to an `invalid` handler, so the server can answer it instead of dropping it silently.
- `RawData` is what `ws` delivers: a `Buffer`, an array of them (fragmented messages) or an `ArrayBuffer`.

> **🧠 DSA & scalability · presence**
> - **Data structure:** a Redis **sorted set** per project, `presence:project:{id}`: member `userId:connectionId`, score = last heartbeat (ms); the key has a 5-minute TTL.
> - **Algorithm:** subscribe/ping → `ZADD` (refresh the score); unsubscribe/close → `ZREM`; read → `ZREMRANGEBYSCORE` anything older than 60 s, then `ZRANGE`, dedupe user ids, load their names.
> - **Complexity:** O(log n) per heartbeat; O(n) to read the n connections of one project.
> - **Why it scales:** every instance writes to the same set, so presence is global; a crashed instance's connections age out within 60 s without any cleanup code.
> - **Rejected:** in-memory presence (each instance would see only its own users); a set without timestamps (dead connections would stay "online" forever).

**✅ Checkpoint**

```bash
npx vitest run src/modules/realtime
```

Expected: `Tests  6 passed (6)`.

**Commit:** `feat: websocket tickets, presence and message parser`

### Step 10.2 · The WebSocket gateway

**Goal:** authenticate sockets with a ticket, subscribe them to projects they can see, relay Redis Pub/Sub messages, keep presence, and clean up dead connections.

**Files:** `src/modules/realtime/realtime.gateway.ts`

**`src/modules/realtime/realtime.gateway.ts`** · new file

```ts
import type { IncomingMessage } from 'node:http';
import { Inject, type OnApplicationShutdown } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';
import { WebSocket } from 'ws';
import { ProblemError } from '../../common/problem.js';
import { REDIS } from '../../infra/redis.module.js';
import { AccessService } from '../access/access.service.js';
import { Presence } from './presence.service.js';
import { envelope, projectChannel, RealtimePublisher } from './realtime.publisher.js';
import { Tickets } from './tickets.service.js';

export const CLOSE_UNAUTHORIZED = 4401;
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

interface ProjectPayload {
  projectId: string;
}

/** The ws server shares the HTTP server and answers upgrades on /ws. */
@WebSocketGateway({ path: '/ws', maxPayload: 16 * 1024 })
export class RealtimeGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnApplicationShutdown
{
  /** projectId → this instance's sockets watching it. */
  private readonly local = new Map<string, Set<Client>>();
  /**
   * socket → its client, once the ticket is redeemed (null if it was refused). A promise,
   * because Nest starts delivering a socket's messages without waiting for handleConnection.
   */
  private readonly sessions = new Map<WebSocket, Promise<Client | null>>();
  private readonly clients = new Set<Client>();
  // A Redis connection in SUBSCRIBE mode can't run other commands, so it gets its own.
  private readonly subscriber: Redis;
  private readonly reaper: NodeJS.Timeout;

```

**What's new (gateways)**
- **`@WebSocketGateway({ path: '/ws', maxPayload: 16 * 1024 })`** declares a WebSocket server that shares the HTTP server and accepts upgrades on `/ws`; frames over 16 KB close the socket. A gateway is a provider: it gets constructor injection like any service. ☕ Spring's `WebSocketHandler`.
- **`OnGatewayConnection` / `OnGatewayDisconnect`** are the gateway's lifecycle hooks: `handleConnection(socket, request)` and `handleDisconnect(socket)`.
- **A dedicated subscriber connection:** a Redis connection in SUBSCRIBE mode can't run other commands, so `redis.duplicate()` opens a second one, used only for Pub/Sub.

**`src/modules/realtime/realtime.gateway.ts`** · continue

```ts
  constructor(
    @Inject(REDIS) redis: Redis,
    private readonly access: AccessService,
    private readonly presence: Presence,
    private readonly publisher: RealtimePublisher,
    private readonly tickets: Tickets,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RealtimeGateway.name);
    this.subscriber = redis.duplicate();
    this.subscriber.on('message', (channel: string, message: string) => {
      const projectId = channel.slice('project:'.length);
      for (const client of this.local.get(projectId) ?? []) send(client.ws, message);
    });
    this.reaper = setInterval(() => {
      const cutoff = Date.now() - IDLE_TIMEOUT_MS;
      for (const client of this.clients) if (client.lastSeen < cutoff) client.ws.terminate();
    }, 30_000);
  }

  handleConnection(ws: WebSocket, request: IncomingMessage): void {
    ws.on('error', (err) => {
      this.logger.warn({ err }, 'websocket error');
    });
    this.sessions.set(ws, this.authenticate(ws, request));
  }

  private async authenticate(ws: WebSocket, request: IncomingMessage): Promise<Client | null> {
    const ticket = new URL(request.url ?? '/', 'http://localhost').searchParams.get('ticket');
    const userId = ticket ? await this.tickets.redeem(ticket).catch(() => null) : null;
    // The handshake is already accepted; close with a code the browser can read.
    if (userId === null) {
      ws.close(CLOSE_UNAUTHORIZED, 'invalid or expired ticket');
      return null;
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
    return client;
  }

```

**What's new**
- **`sessions` maps each socket to a promise of its client.** Nest starts delivering a socket's messages without waiting for `handleConnection` to finish, and redeeming the ticket is asynchronous. Storing the *promise* lets every handler `await` the authentication, so a `subscribe` sent immediately after connecting still works, and nothing runs for a refused socket.
- A bad ticket closes the socket with **4401**: the handshake already succeeded, so the browser can read this application close code (an HTTP 401 during the handshake would reach it only as a generic failure).
- The **reaper** terminates sockets that sent nothing for 75 seconds (clients ping every 25).

**`src/modules/realtime/realtime.gateway.ts`** · continue

```ts
  @SubscribeMessage('subscribe')
  onSubscribe(@ConnectedSocket() ws: WebSocket, @MessageBody() { projectId }: ProjectPayload) {
    return this.handle(ws, (client) => this.subscribe(client, projectId));
  }

  @SubscribeMessage('unsubscribe')
  onUnsubscribe(@ConnectedSocket() ws: WebSocket, @MessageBody() { projectId }: ProjectPayload) {
    return this.handle(ws, (client) => this.unsubscribe(client, projectId));
  }

  @SubscribeMessage('ping')
  onPing(@ConnectedSocket() ws: WebSocket) {
    return this.handle(ws, async (client) => {
      for (const projectId of client.projects) {
        await this.presence.touch(projectId, client.userId, client.connectionId);
      }
      send(ws, envelope('pong'));
    });
  }

  /** Where the message parser sends anything it couldn't understand. */
  @SubscribeMessage('invalid')
  onInvalid(@ConnectedSocket() ws: WebSocket) {
    return this.handle(ws, (client) => {
      client.badMessages++;
      if (client.badMessages > MAX_BAD_MESSAGES) {
        ws.close(CLOSE_BAD_MESSAGES, 'too many malformed messages');
        return;
      }
      send(ws, envelope('error', { code: 'bad_message', message: 'Malformed message' }));
    });
  }

  /** Shared by every handler: wait for the session, note the activity, turn errors into frames. */
  private async handle(ws: WebSocket, action: (client: Client) => Promise<void> | void) {
    const client = await this.sessions.get(ws);
    if (!client) return;
    client.lastSeen = Date.now();
    try {
      await action(client);
    } catch (err) {
      if (err instanceof ProblemError && (err.status === 404 || err.status === 403)) {
        const code = err.status === 404 ? 'not_found' : 'forbidden';
        send(ws, envelope('error', { code, message: err.message }));
        return;
      }
      this.logger.error({ err }, 'websocket handler failed');
    }
  }
```

**What's new**
- **`@SubscribeMessage('subscribe')`** routes messages whose `event` is `subscribe` (after our parser) to this method. **`@ConnectedSocket()`** and **`@MessageBody()`** are the WebSocket versions of `@Req()` and `@Body()`.
- `handle()` is the shared wrapper: await the session, note the activity, run the action, and turn our 403/404 problems into `{ type: 'error' }` frames instead of crashing the handler.
- Ten malformed messages close the socket with 4400.

**`src/modules/realtime/realtime.gateway.ts`** · continue

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
    send(client.ws, envelope('subscribed', { projectId }));
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

  async handleDisconnect(ws: WebSocket): Promise<void> {
    const client = await this.sessions.get(ws);
    this.sessions.delete(ws);
    if (!client) return;
    this.clients.delete(client);
    for (const projectId of [...client.projects]) {
      await this.unsubscribe(client, projectId).catch((err: unknown) => {
        this.logger.warn({ err }, 'cleanup after close failed');
      });
    }
  }

  private async broadcastPresence(projectId: string): Promise<void> {
    const users = await this.presence.online(projectId);
    await this.publisher.publish(projectId, 'presence.updated', { projectId, users });
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.reaper);
    for (const ws of this.sessions.keys()) ws.close(CLOSE_GOING_AWAY, 'server shutting down');
    await this.subscriber.quit();
  }
}

function send(ws: WebSocket, message: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(message);
}
```

**What's new**
- **One Redis subscription per project per instance**, however many local sockets watch it: subscribe when the first local socket joins, unsubscribe when the last leaves.
- Subscribing re-checks access (`access.project`), so a user removed from a workspace can't keep listening by reconnecting.
- `onApplicationShutdown` closes every socket with 1001 ("going away") and the subscriber connection, so clients reconnect to another instance.

> **🧠 DSA & scalability · fan-out across instances**
> - **Data structure:** per instance, `Map<projectId, Set<Client>>`; in Redis, one Pub/Sub channel per project, `project:{id}`.
> - **Algorithm:** a service publishes an envelope to `project:{id}` (Part 6) → Redis delivers it to every instance subscribed to that channel → each instance writes it to its local sockets for that project.
> - **Complexity:** O(instances) for Redis per event, then O(local subscribers) per instance; subscribe/unsubscribe O(1).
> - **Why it scales:** API instances don't know about each other; adding one adds a subscriber, not a mesh of connections. A load balancer can put a user's two tabs on different instances and both get every event.
> - **Rejected:** sticky sessions (one instance would still miss events from writes on another); Redis Streams (durable, but this channel is fire-and-forget, and clients refetch the board after reconnecting); Socket.IO's Redis adapter (a second protocol on top of WebSockets).

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: websocket gateway with redis pub/sub fan-out`

### Step 10.3 · Wiring and tests

**Goal:** the ticket endpoint, the module, the `ws` adapter with our parser, and two-instance tests.

**Files:** `src/modules/realtime/realtime.controller.ts`, `src/modules/realtime/realtime.module.ts`, `src/app.setup.ts`, `src/app.module.ts`, `test/realtime.e2e-spec.ts`

**`src/modules/realtime/realtime.controller.ts`** · new file

```ts
import { Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { API_PREFIX } from '../../common/http/routes.js';
import { CurrentUser } from '../auth/decorators.js';
import { TicketDto } from './ticket.dto.js';
import { Tickets } from './tickets.service.js';

@ApiTags('realtime')
@Controller(API_PREFIX)
export class RealtimeController {
  constructor(private readonly tickets: Tickets) {}

  @Post('ws/ticket')
  issueTicket(@CurrentUser() userId: string): Promise<TicketDto> {
    return this.tickets.issue(userId);
  }
}
```

**`src/modules/realtime/realtime.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { UsersModule } from '../users/users.module.js';
import { Presence } from './presence.service.js';
import { PublisherModule } from './publisher.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { Tickets } from './tickets.service.js';

@Module({
  imports: [AccessModule, UsersModule, PublisherModule],
  controllers: [RealtimeController],
  providers: [Tickets, Presence, RealtimeGateway],
})
export class RealtimeModule {}
```

**`src/app.setup.ts`** · add after `import type { NestExpressApplication } from '@nestjs/platform-express';`

```ts
import { WsAdapter } from '@nestjs/platform-ws';
```

**`src/app.setup.ts`** · add after `import { setupDocs } from './docs.js';`

```ts
import { parseClientMessage } from './modules/realtime/client-message.js';
```

**`src/app.setup.ts`** · add before `if (config.get('NODE_ENV', { infer: true }) !== 'production') setupDocs(app);`

```ts
  // Gateways use the `ws` library (plain WebSockets), with our { type, payload } envelope.
  app.useWebSocketAdapter(new WsAdapter(app, { messageParser: parseClientMessage }));
```

**`src/app.module.ts`** · add after `import { ProjectsModule } from './modules/projects/projects.module.js';`

```ts
import { RealtimeModule } from './modules/realtime/realtime.module.js';
```

**`src/app.module.ts`** · add after `AttachmentsModule,`

```ts
    RealtimeModule,
```

**What's new**
- **`app.useWebSocketAdapter(new WsAdapter(app, { messageParser }))`** replaces the default Socket.IO adapter for every gateway, and installs our parser.
- `RealtimeModule` imports `PublisherModule` (the gateway publishes presence) and `UsersModule` (presence loads names); `RealtimeGateway` is just another provider.

**`test/realtime.e2e-spec.ts`** · new file

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
  type TestUser,
} from './helpers.js';

interface Envelope {
  type: string;
  payload?: Record<string, unknown>;
  ts?: string;
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

**`test/realtime.e2e-spec.ts`** · continue

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

**`test/realtime.e2e-spec.ts`** · continue

```ts

// Two "API instances" in one process: each is a complete Nest application with its own port,
// gateway, database pool and Redis connections. Only Postgres and Redis are shared.
const a = await createTestContext({ listen: true });
const b = await createTestContext({ listen: true });
let f: Fixture;

beforeEach(async () => {
  await resetState(a);
  f = await createFixture(a);
});
afterAll(async () => {
  await a.close();
  await b.close();
});

async function ticketFor(user: TestUser) {
  const res = await send(a, 'POST', '/api/v1/ws/ticket', { as: user }, 201);
  return res.json<{ ticket: string }>().ticket;
}

describe('realtime', () => {
  it('fans events out across instances through Redis Pub/Sub', async () => {
    const socket = await TestSocket.open(a.port, await ticketFor(f.owner));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    await socket.next('subscribed');
    const presence = await socket.next('presence.updated');
    expect(presence.payload).toMatchObject({ projectId: f.projectId, users: [{ id: f.owner.id }] });

    // The write goes through instance B; the socket lives on instance A.
    const tasks = `/api/v1/projects/${f.projectId}/tasks`;
    await send(b, 'POST', tasks, { as: f.owner, body: { title: 'Live!' } }, 201);
    const event = await socket.next('task.created');
    expect(event.payload).toMatchObject({ title: 'Live!', key: 'TF-1' });
    expect(event.ts).toMatch(/Z$/);
```

**`test/realtime.e2e-spec.ts`** · continue

```ts

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

  it('refuses subscriptions to projects outside your workspaces', async () => {
    const outsider = await registerUser(a, 'Outsider');
    const socket = await TestSocket.open(a.port, await ticketFor(outsider));
    socket.send({ type: 'subscribe', payload: { projectId: f.projectId } });
    const error = await socket.next('error');
    expect(error.payload).toMatchObject({ code: 'not_found' });
    socket.send({ type: 'nonsense' });
    expect((await socket.next('error')).payload).toMatchObject({ code: 'bad_message' });
    socket.ws.close();
  });
```

**`test/realtime.e2e-spec.ts`** · continue

```ts

  it('updates presence when a viewer leaves', async () => {
    const other = await registerUser(a, 'Other');
    await addMember(a, f.workspaceId, other, 'viewer');
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

**What's new**
- **Two complete apps** (`createTestContext({ listen: true })` twice) on random ports, sharing Postgres and Redis: a task created through instance A must reach a socket connected to instance B. That's the multi-instance claim, tested.
- `TestSocket` buffers every frame it receives; `next(type)` resolves with the first frame of that type (already received or arriving within 5 s), so a missing event fails the test instead of hanging it, and an early one isn't lost.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  15 passed (15)
      Tests  78 passed (78)
```

**Commit:** `feat: real-time board updates over WebSockets with Redis pub/sub and presence`

---
## Part 11 · Background jobs & schedules

The API has been enqueueing jobs since Part 5. Now a **second process** consumes them: a Nest application with no HTTP server, built from the same `CoreModule`, running a BullMQ worker and two cron schedules.

### Step 11.1 · The mailer and the job handlers

**Goal:** what each job does, as plain methods that tests can call directly.

**Files:** `src/jobs/mailer.service.ts`, `src/jobs/job-handlers.service.ts`, `src/jobs/job-handlers.module.ts`

```bash
npm i -E nodemailer@10.5.0
npm i -D -E @types/nodemailer@8.0.2
```

- **`nodemailer`** sends email over SMTP; locally it talks to Mailpit, which catches every message and shows it at http://localhost:18003.

**`src/jobs/mailer.service.ts`** · new file

```ts
import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

@Injectable()
export class Mailer implements OnApplicationShutdown {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    this.transport = nodemailer.createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: false,
    });
    this.from = config.get('MAIL_FROM', { infer: true });
  }

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...mail });
  }

  onApplicationShutdown(): void {
    this.transport.close();
  }
}
```

**`src/jobs/job-handlers.service.ts`** · new file

```ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import type { Env } from '../config/env.js';
import { Attachment } from '../database/entities/attachment.entity.js';
import { Task } from '../database/entities/task.entity.js';
import { Storage } from '../infra/storage.service.js';
import { Jobs, type JobData, type JobName } from './jobs.service.js';
import { Mailer } from './mailer.service.js';

const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;
const BATCH = 100;

type Handlers = { [N in JobName]: (data: JobData[N]) => Promise<unknown> };

/** What each job does. Plain methods, so tests call them directly without a queue or a worker. */
@Injectable()
export class JobHandlers {
  private readonly frontendUrl: string;

  /** Job name → method. A mapped type, so adding a job to JobData without a handler won't compile. */
  private readonly handlers: Handlers = {
    'send-invitation-email': (data) => this.sendInvitationEmail(data),
    'scan-due-reminders': () => this.scanDueReminders(),
    'send-due-reminder': (data) => this.sendDueReminder(data),
    'delete-storage-prefix': (data) => this.deleteStoragePrefix(data),
    'cleanup-stale-uploads': () => this.cleanupStaleUploads(),
  };

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(Attachment) private readonly attachments: Repository<Attachment>,
    private readonly storage: Storage,
    private readonly mailer: Mailer,
    private readonly jobs: Jobs,
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JobHandlers.name);
    this.frontendUrl = config.get('FRONTEND_URL', { infer: true });
  }

  /** Routes a BullMQ job to its handler by job name. */
  run(name: string, data: unknown): Promise<unknown> {
    const handler = this.handlers[name as JobName] as
      ((data: unknown) => Promise<unknown>) | undefined;
    if (!handler) throw new Error(`Unknown job: ${name}`);
    return handler(data);
  }

```

**`src/jobs/job-handlers.service.ts`** · continue

```ts
  async sendInvitationEmail(data: JobData['send-invitation-email']) {
    const { email, workspaceName, inviterName, token } = data;
    const link = `${this.frontendUrl}/invitations/accept?token=${encodeURIComponent(token)}`;
    await this.mailer.send({
      to: email,
      subject: `${inviterName} invited you to ${workspaceName} on TaskFlow`,
      text: `${inviterName} invited you to join "${workspaceName}".\n\nAccept the invitation: ${link}\n\nThe link expires in 7 days.`,
    });
  }

  async scanDueReminders() {
    // SKIP LOCKED lets several schedulers run at once without blocking each other
    // or claiming the same rows; setting reminder_sent_at is the claim.
    // For UPDATE … RETURNING, TypeORM's query() resolves to [rows, affectedCount].
    const [claimed] = await this.dataSource.query<[{ id: string }[], number]>(
      `UPDATE tasks SET reminder_sent_at = now()
       WHERE id IN (
         SELECT id FROM tasks
         WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL
           AND due_at > now() AND due_at <= now() + interval '24 hours'
         ORDER BY due_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id`,
      [BATCH],
    );
    for (const { id } of claimed) await this.jobs.enqueue('send-due-reminder', { taskId: id });
    return { claimed: claimed.length };
  }

  async sendDueReminder({ taskId }: JobData['send-due-reminder']) {
    const task = await this.tasks.findOne({
      where: { id: taskId },
      relations: { assignee: true, project: true },
    });
    if (!task?.assignee || !task.dueAt) return { skipped: true };
    await this.mailer.send({
      to: task.assignee.email,
      subject: `Due soon: ${task.project.key}-${task.number} ${task.title}`,
      text: `"${task.title}" in ${task.project.name} is due at ${task.dueAt.toISOString()}.\n\nOpen it: ${this.frontendUrl}/tasks/${task.id}`,
    });
    return { sent: true };
  }

  async deleteStoragePrefix({ prefix }: JobData['delete-storage-prefix']) {
    return { deleted: await this.storage.deletePrefix(prefix) };
  }

  async cleanupStaleUploads() {
    const stale = await this.attachments.find({
      where: { status: 'pending', createdAt: LessThan(new Date(Date.now() - STALE_UPLOAD_MS)) },
      select: { id: true, storageKey: true },
      take: 500,
    });
    for (const a of stale) await this.storage.deletePrefix(a.storageKey);
    if (stale.length > 0) await this.attachments.delete({ id: In(stale.map((a) => a.id)) });
    this.logger.info({ removed: stale.length }, 'stale uploads cleaned');
    return { removed: stale.length };
  }
}
```

**`src/jobs/job-handlers.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Attachment } from '../database/entities/attachment.entity.js';
import { Task } from '../database/entities/task.entity.js';
import { StorageModule } from '../infra/storage.module.js';
import { JobHandlers } from './job-handlers.service.js';
import { JobsModule } from './jobs.module.js';
import { Mailer } from './mailer.service.js';

/** The consuming side's logic, without a worker: importable by the worker process and by tests. */
@Module({
  imports: [TypeOrmModule.forFeature([Task, Attachment]), StorageModule, JobsModule],
  providers: [JobHandlers, Mailer],
  exports: [JobHandlers],
})
export class JobHandlersModule {}
```

**What's new**
- **A mapped type as a dispatch table:** `{ [N in JobName]: (data: JobData[N]) => Promise<unknown> }` requires exactly one handler per job name, each typed with its payload. Add a job to `JobData` (Part 5) without a handler here and the project stops compiling.
- `run(name, data)` is the one untyped entry point (BullMQ hands us a name and `unknown` data); it looks the handler up and fails loudly for an unknown name.
- **`JobHandlersModule` is separate from the worker** so the integration tests can import the handlers next to `AppModule` without starting a worker.

> **🧠 DSA & scalability · claiming due reminders**
> - **Data structure:** the partial index `tasks_due_reminder_idx (due_at) WHERE reminder_sent_at IS NULL AND assignee_id IS NOT NULL`: it holds only tasks that still need a reminder, so it stays small however many tasks exist.
> - **Algorithm:** one statement: `UPDATE tasks SET reminder_sent_at = now() WHERE id IN (SELECT id … due within 24 h … ORDER BY due_at LIMIT 100 FOR UPDATE SKIP LOCKED) RETURNING id`, then one `send-due-reminder` job per claimed id.
> - **Complexity:** O(log n + k) for k claimed tasks; batches of 100 bound each run.
> - **Why it scales:** **`SKIP LOCKED`** lets several schedulers run at once: each skips rows another has locked, so no task is claimed twice and nobody waits. Setting `reminder_sent_at` *is* the claim, so a crash after the commit never re-sends; the email itself is a separate retried job.
> - **Rejected:** select-then-update in two statements (two schedulers claim the same tasks); a reminder job per task scheduled at creation (thousands of delayed jobs to move whenever a due date changes).

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

**Commit:** `feat: job handlers and mailer`

### Step 11.2 · The worker process

**Goal:** a BullMQ processor with two cron schedules, its root module, and an entry point without HTTP.

**Files:** `src/jobs/jobs.processor.ts`, `src/worker.module.ts`, `src/worker.ts`, `package.json`

**`src/jobs/jobs.processor.ts`** · new file

```ts
import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { OnApplicationBootstrap } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { JobHandlers } from './job-handlers.service.js';
import { QUEUE_NAME } from './jobs.service.js';

/**
 * @Processor makes Nest start a BullMQ Worker for the queue and feed every job to process().
 * This class is only ever a provider of WorkerModule: the API process enqueues, it never consumes.
 */
@Processor(QUEUE_NAME, { concurrency: 5 })
export class JobsProcessor extends WorkerHost implements OnApplicationBootstrap {
  constructor(
    private readonly handlers: JobHandlers,
    @InjectQueue(QUEUE_NAME) private readonly queue: Queue,
    private readonly logger: PinoLogger,
  ) {
    super();
    this.logger.setContext(JobsProcessor.name);
  }

  /** Idempotent: re-running on every start updates the schedule instead of duplicating it. */
  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'scan-due-reminders',
      { pattern: '*/15 * * * *' },
      { name: 'scan-due-reminders', data: {} },
    );
    await this.queue.upsertJobScheduler(
      'cleanup-stale-uploads',
      { pattern: '0 * * * *' },
      { name: 'cleanup-stale-uploads', data: {} },
    );
  }

  process(job: Job): Promise<unknown> {
    return this.handlers.run(job.name, job.data);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.info({ job: job.name, id: job.id }, 'job completed');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.warn(
      { job: job?.name, id: job?.id, attempt: job?.attemptsMade, err },
      'job failed',
    );
  }
}
```

**What's new**
- **`@Processor(QUEUE_NAME, { concurrency: 5 })` + `extends WorkerHost`**: @nestjs/bullmq starts a BullMQ `Worker` for the queue when the module initialises, and feeds each job to `process(job)`, up to five at a time. What `process` returns is stored as the job's result; a throw triggers the retry policy from Part 5.
- **`@OnWorkerEvent('completed' | 'failed')`** subscribes methods to the worker's events, for logging.
- **`upsertJobScheduler(id, { pattern }, template)`** registers a repeatable job with a cron pattern. "Upsert" makes it idempotent: every worker start updates the same schedule instead of adding another. Several workers running at once still produce one job per tick, because BullMQ keys each tick's job by the schedule id and time.

**`src/worker.module.ts`** · new file

```ts
import { Module } from '@nestjs/common';
import { CoreModule } from './core.module.js';
import { JobHandlersModule } from './jobs/job-handlers.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { JobsProcessor } from './jobs/jobs.processor.js';

/** The worker process's root module: no controllers, no gateway, no HTTP at all. */
@Module({
  imports: [CoreModule, JobsModule, JobHandlersModule],
  providers: [JobsProcessor],
})
export class WorkerModule {}
```

**`src/worker.ts`** · new file

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module.js';

// A standalone application: the DI container without an HTTP server.
const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
const logger = app.get(Logger);
app.useLogger(logger);
// On SIGTERM, Nest closes the BullMQ worker (it finishes its active jobs first), then the connections.
app.enableShutdownHooks();
logger.log('taskflow-nestjs worker started');
```

```bash
npm pkg set scripts.dev:worker="nest start --watch --entryFile worker" \
  scripts.start:worker="node dist/worker.js"
```

**What's new**
- **`NestFactory.createApplicationContext(WorkerModule)`** builds the DI container **without an HTTP server**: no controllers, no port. The same `CoreModule` gives the worker the same config, logs and connections as the API.
- **Two processes, one codebase.** The API enqueues, the worker consumes; they scale independently (more workers when the queue backs up, more API instances for traffic). `--entryFile worker` makes `nest start` run `dist/worker.js`.
- On SIGTERM (`enableShutdownHooks`), @nestjs/bullmq closes the worker, which lets active jobs finish first.

**✅ Checkpoint**

```bash
npm run dev:worker
```

Expected: start-up lines ending with `"msg":"taskflow-nestjs worker started"`. Then, at the next whole hour, `"msg":"stale uploads cleaned"` and `"job":"cleanup-stale-uploads",…,"msg":"job completed"` (and every 15 minutes a `scan-due-reminders` completion). Stop it with Ctrl+C.

**Commit:** `feat: background worker with cron schedules`

### Step 11.3 · Tests

**Goal:** prove every job against real Postgres, S3 and Mailpit.

**Files:** `test/test-env.ts`, `test/jobs.e2e-spec.ts`

**`test/test-env.ts`** · add after `REDIS_URL: testRedisUrl(),`

```ts
  MAILPIT_URL: process.env.MAILPIT_URL ?? 'http://localhost:18003',
```

**`test/jobs.e2e-spec.ts`** · new file

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Attachment } from '../src/database/entities/attachment.entity.js';
import { JobHandlersModule } from '../src/jobs/job-handlers.module.js';
import { JobHandlers } from '../src/jobs/job-handlers.service.js';
import {
  addMember,
  createFixture,
  createTestContext,
  registerUser,
  resetState,
  send,
  type Fixture,
} from './helpers.js';

// The API never loads the job handlers; the test adds their module next to AppModule.
// No JobsProcessor is registered, so no worker runs and queued jobs stay inspectable.
const ctx = await createTestContext({ imports: [JobHandlersModule] });
const handlers = ctx.app.get(JobHandlers);
const config = ctx.config;
const mailpit = process.env.MAILPIT_URL ?? 'http://localhost:18003';

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

**`test/jobs.e2e-spec.ts`** · continue

```ts

let f: Fixture;
beforeEach(async () => {
  await resetState(ctx);
  await ctx.queue.obliterate({ force: true });
  f = await createFixture(ctx);
});
afterAll(() => ctx.close());

describe('jobs', () => {
  it('sends the invitation email with an accept link', async () => {
    const email = `invitee-${Date.now()}@example.com`;
    await handlers.sendInvitationEmail({
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
    const frontendUrl = config.get('FRONTEND_URL', { infer: true });
    expect(full.Text).toContain(`${frontendUrl}/invitations/accept?token=tok-123`);
  });
```

**`test/jobs.e2e-spec.ts`** · continue

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

    expect(await handlers.scanDueReminders()).toEqual({ claimed: 1 });
    expect(await handlers.scanDueReminders()).toEqual({ claimed: 0 });

    const [job] = await ctx.queue.getJobs(['waiting']);
    expect(job?.name).toBe('send-due-reminder');
    // Through run(), the way the worker dispatches it.
    expect(await handlers.run('send-due-reminder', job?.data)).toEqual({ sent: true });
    const [message] = await inbox(assignee.email);
    expect(message?.Subject).toBe('Due soon: TF-1 Due soon');
    await expect(async () => handlers.run('no-such-job', {})).rejects.toThrow(/Unknown job/);
  });
```

**`test/jobs.e2e-spec.ts`** · continue

```ts

  it('deletes every object under a storage prefix', async () => {
    const s3 = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
      },
    });
    const prefix = `projects/${f.projectId}/`;
    for (const name of ['a', 'b', 'c']) {
      await s3.send(
        new PutObjectCommand({
          Bucket: config.get('S3_BUCKET', { infer: true }),
          Key: `${prefix}tasks/t/${name}`,
          Body: name,
        }),
      );
    }
    s3.destroy();
    expect(await handlers.deleteStoragePrefix({ prefix })).toEqual({ deleted: 3 });
    expect(await handlers.deleteStoragePrefix({ prefix })).toEqual({ deleted: 0 });
  });
```

**`test/jobs.e2e-spec.ts`** · continue

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
    const attachments = ctx.dataSource.getRepository(Attachment);
    await attachments.update({ id }, { createdAt: new Date(Date.now() - 25 * 3_600_000) });
    expect(await handlers.cleanupStaleUploads()).toEqual({ removed: 1 });
    expect(await attachments.count()).toBe(0);
  });
});
```

**What's new**
- **`createTestContext({ imports: [JobHandlersModule] })`** adds the handlers next to `AppModule`, without `JobsProcessor`: no worker runs, so jobs the API enqueues stay in the queue where the test can inspect them, and the test calls handlers directly.
- **Mailpit's HTTP API** (`/api/v1/search?query=to:…`) lets the test read the email that was actually sent over SMTP.
- `ctx.queue.obliterate({ force: true })` empties the queue before each test.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  16 passed (16)
      Tests  82 passed (82)
```

**Commit:** `feat: background worker for emails, due-date reminders and storage cleanup`

---
## Part 12 · Contract testing with Schemathesis

Our tests check the behaviour we *thought of*. **Schemathesis** reads `contract/openapi.yaml`, generates thousands of requests (valid, edge-case and invalid), and checks every response against the contract. The contract is shared by all six backends, so this is also the test that proves NestJS behaves like Express and Fastify.

### Step 12.1 · Configuration

**Goal:** configure Schemathesis, run it, and read its verdict.

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
npm pkg set scripts.test:contract="schemathesis run contract/openapi.yaml --url http://localhost:8003"
```

**What's new**
- The same configuration as Express and Fastify: the same contract and the same rules give the same verdicts. `allow-x00 = false` stops the fuzzer from sending NUL bytes, which Postgres `text` columns reject. The first `[[operations]]` block lets list endpoints answer 422 to a schema-valid but forged cursor; the second lists, by **`operationId`**, the operations where a schema-valid body can still be semantically invalid (names trimmed to empty, ids that must point into this board). Expected statuses replace the defaults, so each list repeats `200`/`201`.
- **Where Nest needed care to pass it** (all in code you've typed): Nest's router answers an unknown method with the same 404 as an unknown path, so the 405s and `Allow` headers come from `RouteTable` (Step 3.4); Nest's default error body isn't RFC 9457, so every error goes through `ProblemFilter`; `@IsOptional()` would let `null` reach NOT NULL columns, hence `IsOmittable` (Step 3.2); and `ValidationPipe` with `whitelist` silently accepts unknown fields, which the contract allows.

**✅ Checkpoint**

Start the API with the rate limits raised (a fuzzer sends thousands of requests a minute), get a token, and run it:

```bash
npm run build
RATE_LIMIT_AUTH_PER_MINUTE=100000 RATE_LIMIT_API_PER_MINUTE=100000 npm start
# second terminal:
TOKEN=$(curl -s localhost:8003/api/v1/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"contract@example.com","password":"contract-password","displayName":"Contract"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')
uvx schemathesis run contract/openapi.yaml --url http://localhost:8003 -H "Authorization: Bearer $TOKEN"
```

Expected (numbers vary with the random seed):

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
  ⚠️ Missing test data: 17 operations repeatedly returned 404 responses
Test cases:
  5806 generated, 5806 passed
```

The two warnings are expected: `/auth/refresh` authenticates with a cookie the fuzzer doesn't have, and random UUIDs rarely hit real records. (Schemathesis also prints suggestions about OpenAPI links for its stateful phase; they're hints about the contract, not failures.)

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

# ---- build: `nest build` compiles src/ to dist/ (and runs the Swagger plugin) ----
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps: runtime dependencies only ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---- runtime: compiled code only; migrations are compiled into dist/ with everything else ----
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

```gitignore
node_modules
dist
coverage
.env
.env.*
!.env.example
.git
.github
test
*.md
```

**What's new (vs. Fastify)**
- **`nest build` in the build stage**, with `nest-cli.json` copied in, because the Swagger plugin runs inside it. The migrations are TypeScript under `src/`, so they're compiled into `dist/` with everything else, and `node dist/migrate.js` needs only `typeorm` and `pg`, both runtime dependencies: **one image** runs migrations, the API and the worker.
- **Debian slim, not Alpine**, so argon2's prebuilt glibc binary loads (its install script is denied, so there's no compiler fallback).
- Same principles as before: multi-stage (the compiler and dev dependencies never ship), dependencies installed before the sources are copied (editing a `.ts` file doesn't re-run `npm ci`), `npm ci --omit=dev` honours `allowScripts` from `package.json`, and `USER node`.

**✅ Checkpoint**

```bash
docker build -t taskflow-nestjs . && docker run --rm taskflow-nestjs id
```

Expected: the build finishes, and `id` prints `uid=1000(node) gid=1000(node) groups=1000(node)`.

**Commit:** `build: multi-stage dockerfile`

### Step 13.2 · App services in compose

**Goal:** run migrations, the API and the worker as containers next to the infrastructure.

**Files:** `docker-compose.yml`

The shared environment for the app containers: in-network hostnames (`postgres`, `redis`, `rustfs`, `mailpit`), while `S3_PUBLIC_ENDPOINT` stays `localhost` because browsers use it.

**`docker-compose.yml`** · add after `name: taskflow-nestjs`

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
  S3_PUBLIC_ENDPOINT: http://localhost:19003
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
      - '8003:8000'
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
- The same `x-app-env` anchor and `app` profile as Fastify. `migrate`, `api` and `worker` share one image and differ only in `command`.
- `api` and `worker` wait for `migrate` to finish (`service_completed_successfully`), so the app never starts against an unmigrated database. The API's healthcheck uses Node's built-in `fetch`, since the slim image has no `curl`.

**✅ Checkpoint**

```bash
docker compose --profile app up -d --build
docker compose --profile app ps --format 'table {{.Service}}\t{{.Status}}' -a
curl -s localhost:8003/health/ready; echo
docker compose logs migrate | tail -1
```

Expected: `api` is `Up … (healthy)`, `worker` is `Up`, `migrate` and `s3-init` are `Exited (0)`, readiness returns `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`, and the migrate log ends with `migrations applied: 0` (or `1` on a fresh volume). `docker image ls taskflow-nestjs-api` shows about 560 MB, about 110 MB more than Fastify's: mostly Nest's own packages and Swagger UI's bundled assets. Stop `npm run dev` first: both use port 8003.

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
      - name: Apply migrations to an empty database
        run: npm run db:migrate
      - name: Fail if the entities and the migrations disagree (drift)
        run: npm run db:drift
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

**What's new (vs. Fastify)**
- **The drift check needs a database.** drizzle-kit compared the schema with its snapshots offline; TypeORM compares the entities with a **live database**. So the test job first runs `npm run db:migrate` against the empty service-container database, then `npm run db:drift`: any difference between "what the migrations built" and "what the entities describe" fails the job.
- The contract job runs the API exactly as production does: `npm run build`, `node dist/migrate.js`, `node dist/main.js` with `NODE_ENV=production` (so no `/docs`).
- Reminder of the shape: `quality`, `test` and `contract` run in parallel; `docker` runs only if all three pass, and pushes to `ghcr.io/<owner>/taskflow-nestjs` only for pushes to `main`. `services: &services` defines the containers once and `*services` reuses them (a YAML anchor). CI's service containers publish the default ports (5432, 6379): a fresh runner has nothing to clash with.

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
      nestjs:
        patterns: ['@nestjs/*', 'nestjs-pino', 'reflect-metadata', 'rxjs']
      typeorm:
        patterns: ['typeorm', 'pg', '@types/pg']
      validation:
        patterns: ['class-validator', 'class-transformer']
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
- Dependabot **groups** the `@nestjs/*` packages (with `nestjs-pino`, `reflect-metadata` and `rxjs`, which Nest pins as peers), TypeORM with its driver, the two class-* libraries, and the AWS SDK: each family is released together and should be upgraded together. A half-upgraded Nest (core 12.5 with common 12.4) fails at start-up with confusing errors. TypeScript majors stay ignored until typescript-eslint supports 7.

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
| http://localhost:8003/health/ready | API readiness |
| http://localhost:8003/docs | Swagger UI generated from the code (only when `NODE_ENV` isn't `production`, so use `npm run dev` for this one); the JSON is at `/docs-json` |
| http://localhost:18003 | Mailpit: invitation and reminder emails |
| http://localhost:19103 | RustFS console (`taskflow` / `taskflow-secret`) |

**Database GUI:** host `localhost`, port `15403`, database/user/password `taskflow`. Or from the terminal: `docker compose exec postgres psql -U taskflow`.

**✅ Checkpoint**

```bash
curl -s localhost:8003/health/ready
```

Expected: `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

**Commit:** nothing new to commit in this step.

### Step 15.2 · Connect the frontend

**Goal:** run the React frontend against this API, unchanged.

**Files:** none

`taskflow-frontend-node` works with all three Node backends: they implement one contract. With this repo's stack running (`--profile app`), start the frontend from its folder with `VITE_API_URL=http://localhost:8003 npm run dev` (http://localhost:5173) and use it as before. Its Playwright suite passes against this backend too: see that repo's STEPS.md, Part 11, and use the network `taskflow-nestjs_default`.

**✅ Checkpoint**

```bash
curl -si -X OPTIONS localhost:8003/api/v1/workspaces -H 'Origin: http://localhost:5173' \
  -H 'Access-Control-Request-Method: GET' | grep -iE '^HTTP|allow-origin|allow-credentials'
```

Expected: `HTTP/1.1 204 No Content`, `Access-Control-Allow-Origin: http://localhost:5173` and `Access-Control-Allow-Credentials: true`.

**Commit:** nothing new to commit in this step.

### Step 15.3 · Where to go next

**Goal:** stretch what you built, and compare it with Express and Fastify.

**Files:** yours to choose

1. **Diff the generated document against the contract.** Fetch `/docs-json` and compare it with `contract/openapi.yaml` (for example with `npx openapi-diff`). Every difference is either a missing decorator or a contract bug.
2. **Write an interceptor.** Interceptors wrap a handler call (they see the request before and the result after, as an RxJS `Observable`). Add one that sets a `Server-Timing` header, and register it with `APP_INTERCEPTOR`. It's the one request-pipeline piece this guide didn't need.
3. **Run Nest on Fastify.** Swap `@nestjs/platform-express` for `@nestjs/platform-fastify`. Controllers, services and guards don't change; the middleware in `request-context.ts`, `cookie-parser` and the `WsAdapter` setup do. That's the boundary between "Nest" and "the HTTP library under it".
4. **Optimistic concurrency.** Add a TypeORM `@VersionColumn()` to tasks, require `If-Match`, and return 412 on a stale write.
5. **Compare, and look ahead.** Put Step 4.2 of this guide next to Step 4.2 of Fastify's: a global guard with an opt-out versus hooks on a plugin subtree. When you reach `taskflow-springboot`, read its Part 3 with this one open: modules become `@Configuration` classes, providers become beans, guards become Spring Security filters. `COMPARISON.md` collects these side by side.

**✅ Checkpoint**

```bash
npm test && npm run lint && npm run typecheck
```

Expected: everything still green after each exercise.

**Commit:** nothing new to commit in this step.
