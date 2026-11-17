## Part 7 · Tasks

Tasks are the busiest resource: per-project numbers (`TF-42`) under concurrency, filters, fractional moves between columns, and PATCH with merge semantics. The rules are Express's; the new parts are Drizzle's SQL expressions inside the builder and converting wire strings to `Date`s yourself.

### Step 7.1 · Types and the filtered list

**Goal:** the service's input types, and a task list with optional filters and cursor pagination.

**Files:** `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/tasks.service.ts 1-45

**What's new**
- **`dueAt` arrives as a string.** zod could `.transform()` an ISO string into a `Date` during validation. JSON Schema validates but doesn't transform, so the route hands the service the ISO string and **`toDate`** converts it. Its signature, `<T extends null | undefined>(value: string | T): Date | T`, keeps `null` (clear the due date) and `undefined` (leave it alone) distinct, which PATCH needs.
- `Priority = TaskDto['priority']`: an **indexed access type** pulls the union `'low' | 'medium' | 'high' | 'urgent'` out of the DTO type instead of repeating it.
- `loadTask` re-reads a task with everything `toTask` needs; services call it after every write (inside the transaction), because Drizzle's `insert`/`update` return plain rows without relations.

@show src/modules/tasks/tasks.service.ts 46-86

@show src/modules/tasks/tasks.service.ts 282-282

**What's new**
- **Filters as optional conditions:** `assigneeId === 'none' ? isNull(tasks.assigneeId) : undefined` and so on, all inside one `and(...)`. Absent filters are `undefined` and drop out.
- `lt(tasks.dueAt, new Date(dueBefore))` compares a `timestamptz` with a `Date`; the driver sends it as an ISO timestamp.
- The class is closed already; the next steps add methods inside it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: tasks service with filtered list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** numbers `1, 2, 3…` per project with no gaps or duplicates under concurrency, and the new task appended at the bottom of its column.

**Files:** `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/tasks.service.ts 87-134 | add after the `get` method

@show src/modules/tasks/tasks.service.ts 247-281 | add at the end of the class, before its closing `}`

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

@verify npx tsc --noEmit

**Commit:** `feat: task creation with per-project numbering`

### Step 7.3 · Update, move and delete

**Goal:** PATCH with merge semantics and a change log, fractional moves between columns, and delete with storage cleanup.

**Files:** `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/tasks.service.ts 135-246 | add after the `create` method

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

@verify npx tsc --noEmit

**Commit:** `feat: task update, move and delete`

### Step 7.4 · Routes and wiring

**Goal:** the task endpoints, wired into the container and the app.

**Files:** `src/modules/tasks/tasks.routes.ts`, `src/container.ts`, `src/app.ts`

@chunks src/modules/tasks/tasks.routes.ts all

**What's new**
- **`Type.Union([Id, Type.Literal('none')])`** for `assigneeId` in the query: a UUID or the word `none` (unassigned tasks).
- `{ ...PageQuery.properties, columnId: …, … }` extends the shared page query with this endpoint's filters.
- **`priority` defaults in the handler** (`const { priority = 'medium', ...rest } = request.body`). A JSON Schema `default` would also work (Ajv's `useDefaults` fills it in), but TypeBox would still type it as optional, so the destructuring default keeps the service's input type honest.
- `const { limit, cursor, ...filters } = request.query` separates paging from filtering with rest syntax.

@show src/container.ts 23-23

@show src/container.ts 79-79

@show src/app.ts 25-25

@show src/app.ts 144-144

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** prove numbering under 10 concurrent creates, fractional moves, cache invalidation, merge-patch, assignment rules, filters and pagination, and RBAC.

**Files:** `tests/integration/tasks.test.ts`

@chunks tests/integration/tasks.test.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: task tests`

---
