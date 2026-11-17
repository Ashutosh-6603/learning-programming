## Part 5 · Workspaces & RBAC

Workspaces, members and invitations: the README's RBAC rules (§5) and the first services that write several rows in one transaction. The business rules are Express's; the new material is **TypeORM's transactions, locks, relation filters and query builder**, and feature modules that import each other's services.

### Step 5.1 · The access service

**Goal:** one service that answers "may this user do this to that?" for every workspace-scoped resource.

**Files:** `src/modules/access/access.service.ts`, `src/modules/access/access.module.ts`

@show src/modules/access/access.service.ts 1-40

@show src/modules/access/access.service.ts 41-80

@show src/modules/access/access.module.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: roles and workspace access checks`

### Step 5.2 · The activity log and the job queue

**Goal:** an append-only activity log written inside the caller's transaction, and a typed facade over a BullMQ queue.

**Files:** `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.module.ts`, `src/jobs/jobs.service.ts`, `src/jobs/jobs.module.ts`

@show src/modules/activity/activity.service.ts 1-3

@show src/modules/activity/activity.service.ts 6-7

@show src/modules/activity/activity.service.ts 9-62

@show src/modules/activity/activity.service.ts 82-82

@show src/modules/activity/activity.module.ts 1-4

@show src/modules/activity/activity.module.ts 6-9

@show src/modules/activity/activity.module.ts 11-14

**What's new**
- **`record(manager, event)` takes an `EntityManager`.** Inside `dataSource.transaction(async (manager) => …)`, every query must go through *that* `manager` to be part of the transaction. Passing it in means the event is committed or rolled back together with the change it describes. (Prisma and Drizzle had the same pattern with `tx`.)
- `manager.insert(Entity, values)` is a plain `INSERT` that returns nothing useful; we don't need the row back.
- The constructor already asks for the repository and `AccessService`; Part 8 adds the feed that uses them.

```bash
npm i -E @nestjs/bullmq@12.0.1 bullmq@6.7.5
npm deny-scripts msgpackr-extract
```

- **`bullmq`** is the Redis-backed job queue Express and Fastify used; **`@nestjs/bullmq`** makes queues injectable and workers declarable (Part 11). `msgpackr-extract` is an optional native speed-up for BullMQ's serializer; without its install script, msgpackr falls back to pure JavaScript.

@show src/jobs/jobs.service.ts all

@show src/jobs/jobs.module.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: activity log and typed job queue`

### Step 5.3 · Cursor pagination

**Goal:** opaque cursors, a keyset helper for TypeORM's query builder, the shared `?limit&cursor` query DTO, and a Swagger decorator for pages.

**Files:** `src/common/cursor.ts`, `src/common/cursor.spec.ts`, `src/common/keyset.ts`, `src/common/page-query.dto.ts`, `src/common/http/api-page.ts`

@show src/common/cursor.ts all

@show src/common/cursor.spec.ts all

**What's new**
- The same cursor format as the other repos (base64url JSON), with **type guards** (`value is IdCursor`) so a decoded cursor is checked like any other input. A bad cursor is a 422 on `query.cursor`.
- `Page<T>` is a class (not an interface) only so Swagger has something to point at; `toPage` fetches-one-more to know whether another page exists.

@show src/common/keyset.ts all

**What's new**
- **`.limit()` vs `.take()`.** With joins, `take` makes TypeORM run a `SELECT DISTINCT` subquery first, in case a one-to-many join multiplied the rows. Our list joins are all many-to-one, so a plain SQL `LIMIT` is correct, and it lets Postgres walk the index and stop.
- `query.andWhere(...)` mutates the builder; the helper adds the cursor condition, the order and the limit to whatever filters the caller already set.

@show src/common/page-query.dto.ts all

@show src/common/http/api-page.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run src/common

**Commit:** `feat: keyset cursor pagination helpers`

### Step 5.4 · Workspace DTOs and service

**Goal:** list, create, read, rename and delete workspaces.

**Files:** `src/modules/workspaces/workspace.dto.ts`, `src/modules/workspaces/workspaces.service.ts`

@show src/modules/workspaces/workspace.dto.ts 1-56

@show src/modules/workspaces/workspace.dto.ts 57-106

**What's new**
- `@IsIn(ROLES)` accepts only the listed values; the array from `roles.ts` is both the validator's list and (through `Role`) the TypeScript type.
- Input DTOs above, output DTOs and mappers below, the same split as `user.dto.ts`.

@show src/modules/workspaces/workspaces.service.ts 1-43

@show src/modules/workspaces/workspaces.service.ts 44-103

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

@verify npx tsc --noEmit

**Commit:** `feat: workspaces service`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** admins manage members and viewers, owners manage everyone, and a workspace can never lose its last owner, even under concurrent requests.

**Files:** `src/modules/workspaces/members.service.ts`

@show src/modules/workspaces/members.service.ts 1-60

@show src/modules/workspaces/members.service.ts 61-115

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

@verify npx tsc --noEmit

**Commit:** `feat: member role changes and removal with last-owner lock`

### Step 5.6 · Invitations

**Goal:** invite by email with a single-use token, stored hashed; the invitee accepts while signed in with that email.

**Files:** `src/modules/workspaces/invitations.service.ts`

@show src/modules/workspaces/invitations.service.ts 1-44

@show src/modules/workspaces/invitations.service.ts 45-107

@show src/modules/workspaces/invitations.service.ts 108-161

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

@verify npx tsc --noEmit

**Commit:** `feat: email invitations with hashed tokens`

### Step 5.7 · The controller and the module

**Goal:** the eleven workspace, member and invitation routes.

**Files:** `src/modules/workspaces/workspaces.controller.ts`, `src/modules/workspaces/workspaces.module.ts`, `src/app.module.ts`

@show src/modules/workspaces/workspaces.controller.ts 1-50

@show src/modules/workspaces/workspaces.controller.ts 51-98

@show src/modules/workspaces/workspaces.controller.ts 99-137

**What's new**
- **`@Controller(API_PREFIX)` with full paths in each route** (`'workspaces/:workspaceId/members'`), because this controller serves three resources. One controller per URL prefix would work too; one per module keeps the module's surface in one file.
- **`@Query() query: PageQueryDto`** validates and converts the whole query string into the DTO.
- Handlers are one line each: extract, delegate, return. The service owns every rule.

@show src/modules/workspaces/workspaces.module.ts all

@show src/app.module.ts 17-17

@show src/app.module.ts 26-26

**What's new**
- **Modules compose.** `WorkspacesModule` imports `AccessModule`, `ActivityModule` and `JobsModule` to inject their exported services, and registers its own repositories with `forFeature`. Importing the same module from several places is fine: Nest creates each module's providers once.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** pagination, 404-vs-403, slugs, role management, the last-owner rule and invitations.

**Files:** `test/helpers.ts`, `test/workspaces.e2e-spec.ts`

@show test/helpers.ts 7-8

@show test/helpers.ts 16-16

@show test/helpers.ts 18-19

@show test/helpers.ts 29-29

@show test/helpers.ts 56-56

@show test/helpers.ts 151-180

**What's new**
- **`app.get(getQueueToken(QUEUE_NAME))`** pulls the BullMQ queue out of the container (the token `@InjectQueue` uses), so a test can assert "an invitation email was queued" without running a worker.
- `addMember` inserts a membership directly through a repository: tests can set up state faster than the API allows.

@chunks test/workspaces.e2e-spec.ts all

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  7 passed (7)
      Tests  36 passed (36)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: workspace, member and invitation tests`

---
