## Part 5 · Workspaces & RBAC

Workspaces, members and invitations: the README's RBAC rules (§5) and the first services that write several rows in one transaction. The business rules are Express's; the new material is **Drizzle's transactions, locks, joins and subqueries**, and route modules as typed plugins.

### Step 5.1 · Roles and the access check

**Goal:** one place that answers "is this user a member of this workspace, with at least this role?", with 404 for outsiders and 403 for a role that's too low.

**Files:** `src/modules/workspaces/roles.ts`, `src/modules/workspaces/access.ts`

@show src/modules/workspaces/roles.ts all

**What's new**
- `ROLES` is a `const` tuple; `Role` is derived from it, and `RoleSchema` is a TypeBox enum built from the same tuple. Express had a zod enum and an `asRole()` parser, needed because Prisma typed `role` as `string`. **Drizzle types the column itself** (`text('role', { enum: … })`, Step 2.2), so every row already has `role: Role` and `asRole()` disappears.

@chunks src/modules/workspaces/access.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: roles and workspace access checks`

### Step 5.2 · The activity log and the job queue

**Goal:** an append-only activity log that writes **inside** the caller's transaction, and a typed facade over a BullMQ queue.

**Files:** `src/modules/activity/activity.repository.ts`, `src/jobs/queue.ts`

```bash
npm i -E bullmq@6.7.5
npm deny-scripts msgpackr-extract
```

**BullMQ** is a Redis-backed job queue (the same choice as Express); `msgpackr-extract` is an optional native speed-up a dependency tries to compile, with a pure-JavaScript fallback.

@chunks src/modules/activity/activity.repository.ts all

**What's new**
- **`record(db: Db, …)`** takes the database handle per call. Pass a transaction's `tx` and the activity row commits or rolls back with the change it describes.
- **`and()` skips `undefined` arguments**, so optional filters are written inline (`filter.projectId ? eq(…) : undefined`) instead of the spread-into-an-object pattern Prisma needed.
- `orderBy: desc(activityEvents.id)` and `limit: page.limit + 1` set up cursor pagination (Step 5.3).
- `data: event.data ?? {}` goes into the `jsonb` column as-is: the driver serialises it.

@show src/jobs/queue.ts all

**What's new**
- Identical to Express: services enqueue through `Jobs.enqueue(name, data)`, typed per job name by `JobData`, and never import BullMQ themselves. Retries use exponential backoff with jitter; completed and failed jobs are trimmed.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: activity log repository and typed job queue`

### Step 5.3 · Cursor pagination

**Goal:** opaque, tamper-proof-enough cursors and one helper that turns `limit + 1` rows into a page.

**Files:** `src/lib/cursor.ts`, `tests/unit/cursor.test.ts`

@chunks src/lib/cursor.ts all

**What's new**
- The cursor is base64url JSON, as in Express. Decoding validates it with **TypeBox's `Value.Check`**, the same library as everything else, instead of a zod schema. A cursor that isn't base64, isn't JSON, or doesn't match the schema is a 422 on `query.cursor`.
- `decodeCursor<T extends TSchema>(schema: T, …): Static<T>` is generic over the schema, so `decodeCursor(IdCursor, c).id` is typed `string`.

@show tests/unit/cursor.test.ts all

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

@verify npx vitest run tests/unit/cursor.test.ts

**Commit:** `feat: keyset cursor pagination helpers`

### Step 5.4 · Workspace service

**Goal:** list, create, read, rename and delete workspaces, each change recorded in the activity log in the same transaction.

**Files:** `src/modules/workspaces/workspaces.dto.ts`, `src/modules/workspaces/workspaces.service.ts`

@chunks src/modules/workspaces/workspaces.dto.ts all

**What's new**
- Response schemas for the three resources of this module; each mapper declares its return type as `Static<typeof Schema>`, so a mapper that forgets a field fails to compile.

@chunks src/modules/workspaces/workspaces.service.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: workspaces service`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** admins manage members and viewers, only owners manage admins and owners, and a workspace never loses its last owner, even under concurrency.

**Files:** `src/modules/workspaces/members.service.ts`

@chunks src/modules/workspaces/members.service.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: member role changes and removal with last-owner lock`

### Step 5.6 · Invitations

**Goal:** invite by email with a single-use token (stored hashed), queue the email, and let the invitee accept.

**Files:** `src/modules/workspaces/invitations.service.ts`

@chunks src/modules/workspaces/invitations.service.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: email invitations with hashed tokens`

### Step 5.7 · Routes and wiring

**Goal:** the workspace, member and invitation endpoints, and their place in the container and the app.

**Files:** `src/modules/workspaces/workspaces.routes.ts`, `src/container.ts`, `src/app.ts`

@chunks src/modules/workspaces/workspaces.routes.ts 1-29

**What's new**
- `Patch({ … })` gives the PATCH body "all optional, at least one" in one call.
- **Params schemas** (`WorkspaceParams`) validate path segments: a non-UUID `workspaceId` is a 422 on `path.workspaceId` before the handler runs.

@chunks src/modules/workspaces/workspaces.routes.ts 30-$

**What's new**
- **`request.params.workspaceId`, `request.query.limit`, `request.body.role`** are all typed from the route's schemas (the TypeBox type provider at work), and already validated. `limit` is a number (coerced, default 20).
- **A plugin's options can be the whole `services` object.** `WorkspacesRoutesOptions` names just the three services this module uses, and TypeScript accepts any object that has them, so the app passes `services` as is (below).
- `reply.status(204).send()` sends an empty body; `return` it so Fastify knows the reply is done.

@show src/container.ts 1-1

@show src/container.ts 9-10

@show src/container.ts 25-28

@show src/container.ts 36-36

@show src/container.ts 47-47

@show src/container.ts 52-52

@show src/container.ts 61-63

@show src/container.ts 69-69

@show src/container.ts 74-76

@show src/app.ts 27-27

@show src/app.ts 142-142

**What's new**
- The container gains the queue (shared Redis connection), the access checker, the activity repository and the three services; `closeInfra` closes the queue first.
- `secured.register(workspacesRoutes, services)`: one line per module from now on.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** pagination, 404/403 rules, slugs, member management, the last-owner rule and the invitation flow, end to end.

**Files:** `tests/helpers.ts`, `tests/integration/workspaces.test.ts`

@show tests/helpers.ts 7-7

@show tests/helpers.ts 109-136

**What's new**
- `addMember` inserts a membership directly with Drizzle, skipping the invitation flow, to set up role scenarios quickly.

@chunks tests/integration/workspaces.test.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: workspace, member and invitation tests`

---
