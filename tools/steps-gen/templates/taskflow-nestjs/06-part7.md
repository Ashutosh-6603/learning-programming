## Part 7 · Tasks

Tasks are the busiest resource: a filtered, paginated list; per-project numbers (`TF-1`, `TF-2`) that stay unique under concurrent creates; PATCH with merge semantics; moves between columns; and every write invalidates the board and publishes an event.

### Step 7.1 · DTOs, types and the filtered list

**Goal:** the task DTOs, and `GET /projects/:projectId/tasks` with filters.

**Files:** `src/modules/tasks/task.dto.ts`, `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/task.dto.ts 1-31

@show src/modules/tasks/task.dto.ts 32-99

**What's new**
- **DTO inheritance:** `ListTasksQueryDto extends PageQueryDto` inherits `limit` and `cursor` with their decorators, and adds the filters. class-validator and the Swagger plugin both follow `extends`.
- `assigneeId` accepts a UUID **or the word `none`** ("unassigned"); one regex says both.
- `UpdateTaskDto` has no `columnId`: moving is its own endpoint with its own rules.

@show src/modules/tasks/tasks.service.ts 1-47

@show src/modules/tasks/tasks.service.ts 48-91

@show src/modules/tasks/tasks.service.ts 289-289

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

@verify npx tsc --noEmit

**Commit:** `feat: tasks service with filtered list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** `POST /projects/:projectId/tasks`, with numbers that are unique and gap-free per project, even when two people create tasks at the same moment.

**Files:** `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/tasks.service.ts 92-140 | add after `get()` (after its closing `}`)

@show src/modules/tasks/tasks.service.ts 254-288 | add before the class's closing `}`

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

@verify npx tsc --noEmit

**Commit:** `feat: task creation with per-project numbering`

### Step 7.3 · Update, move and delete

**Goal:** PATCH with merge semantics and a change log, moves between columns, and delete with storage cleanup.

**Files:** `src/modules/tasks/tasks.service.ts`

@show src/modules/tasks/tasks.service.ts 141-179 | add after `create()` (after its closing `}`)

**What's new**
- **Merge semantics:** fields left out of the body stay as they are (`defined()` in the controller drops them), `null` clears. `'dueAt' in input` distinguishes "dueAt: null" from "no dueAt".
- **The activity event records only what changed**, as `{ field: { from, to } }`; `Date`s compare by `getTime()`, since two `Date` objects are never `===`.
- Changing the due date resets `reminderSentAt`, so the new date gets its own reminder (Part 11).

@show src/modules/tasks/tasks.service.ts 180-230 | add after `update()` (after its closing `}`)

@show src/modules/tasks/tasks.service.ts 231-253 | add after `move()` (after its closing `}`)

**What's new**
- **A move is one UPDATE of `column_id` and `position`**, computed from the target column's neighbours (the same pattern as columns), inside `retryOnPositionConflict`.
- Deleting a task enqueues the deletion of its attachments' storage prefix; the database rows cascade.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output (every import is used now).

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: task update, move and delete`

### Step 7.4 · Controller and module

**Goal:** the six task routes.

**Files:** `src/modules/tasks/tasks.controller.ts`, `src/modules/tasks/tasks.module.ts`, `src/app.module.ts`

@show src/modules/tasks/tasks.controller.ts all

@show src/modules/tasks/tasks.module.ts all

@show src/app.module.ts 15-15

@show src/app.module.ts 28-28

**What's new**
- `const { limit, cursor, ...filters } = query` splits the query DTO with a rest pattern; `defined(filters)` keeps only the filters sent.
- `TasksModule` imports `ProjectsModule` for `BoardCache`, and `PublisherModule` for events; the comment says why, since an import with no visible use is easy to delete by mistake.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** numbering under concurrency, fractional moves, cache invalidation, PATCH semantics, assignment rules, filters, roles, and the column-delete guard.

**Files:** `test/tasks.e2e-spec.ts`

@chunks test/tasks.e2e-spec.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `test: task tests`

---
