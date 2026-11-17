## Part 6 · Projects, columns & ordering

Projects come with three default columns; columns and tasks keep their order with **fractional indexing**; the board is served from a Redis cache; and every board change is announced on Redis Pub/Sub for the real-time layer (Part 10).

### Step 6.1 · Fractional indexing

**Goal:** order keys that always have room between them, so moving an item writes one row.

**Files:** `src/common/fractional-index.ts`, `src/common/fractional-index.spec.ts`

@show src/common/fractional-index.ts 1-47

@show src/common/fractional-index.ts 48-92

@show src/common/fractional-index.ts 93-124

@show src/common/fractional-index.spec.ts all

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

@verify npx tsc --noEmit
@verify npx vitest run src/common/fractional-index.spec.ts

**Commit:** `feat: fractional indexing`

### Step 6.2 · DTOs, the board cache and the real-time publisher

**Goal:** the shapes of projects, columns, tasks and the board; a cache-aside wrapper for the board; and the publishing half of real-time.

**Files:** `src/modules/projects/project.dto.ts`, `src/modules/projects/board-cache.ts`, `src/modules/realtime/realtime.publisher.ts`, `src/modules/realtime/publisher.module.ts`

@show src/modules/projects/project.dto.ts 1-73

@show src/modules/projects/project.dto.ts 74-119

@show src/modules/projects/project.dto.ts 120-159

**What's new**
- **`TaskDto` lives here**, not in the tasks module: the board (this Part) returns tasks, and Part 7's module imports from this one. Dependencies between modules should point one way.
- **`TASK_RELATIONS`** is the `relations` object every query feeding `toTask` must pass, because `toTask` reads `t.project.key`, `t.assignee` and `t.reporter`. Forgetting a relation would be a runtime `undefined`; one shared constant makes it hard to forget. `as const` keeps its literal type, which TypeORM's `FindOptionsRelations` accepts.
- `MoveColumnDto.afterColumnId` is **required but nullable**: `@IsNullable()` without `@IsOmittable()`, so `{}` is a 422 and `{ "afterColumnId": null }` means "first".

@show src/modules/projects/board-cache.ts all

@show src/modules/realtime/realtime.publisher.ts all

@show src/modules/realtime/publisher.module.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: board cache, dtos and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** retry when two users drop into the same gap at the same moment.

**Files:** `src/common/pg-errors.ts`

@show src/common/pg-errors.ts 17-32

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

@verify npx tsc --noEmit

**Commit:** `feat: retry on position conflicts`

### Step 6.4 · Projects service and the board

**Goal:** project CRUD (with three default columns), and the cached board.

**Files:** `src/modules/projects/projects.service.ts`

@show src/modules/projects/projects.service.ts 1-42

@show src/modules/projects/projects.service.ts 43-86

@show src/modules/projects/projects.service.ts 87-145

**What's new**
- **The board is two queries in parallel** (`Promise.all`): columns ordered by position, and tasks with their relations ordered by position. **`Map.groupBy(tasks, t => t.columnId)`** (ES2024) groups tasks by column in one pass, so each column picks its list in O(1).
- `find({ where, order, relations })` is the find-options API: `order: { position: 'ASC' }` sorts by the `C`-collated key.
- The cache is invalidated **after** the transaction commits; a reader in between gets the old board from Postgres anyway, and the next read reloads it.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: projects service and cached board`

### Step 6.5 · Columns service

**Goal:** add, rename, reorder and delete columns, with fractional positions and real-time events.

**Files:** `src/modules/projects/columns.service.ts`

@show src/modules/projects/columns.service.ts 1-55

@show src/modules/projects/columns.service.ts 56-106

@show src/modules/projects/columns.service.ts 107-160

**What's new**
- **More find operators:** `Not(columnId)` is `<> $1` and `MoreThan(lower)` is `> $1`. "The next column after `lower`, excluding the one being moved" is one indexed query: `WHERE project_id = $1 AND id <> $2 AND position > $3 ORDER BY position LIMIT 1`. A spread with a conditional object (`...(lower !== null ? {...} : {})`) adds a condition only when it applies.
- **A foreign-key violation becomes a 409.** `tasks.column_id` has no `ON DELETE` action, so deleting a column that still has tasks fails in Postgres; the service translates it into "move or delete the tasks first".
- `afterWrite` invalidates the board cache and publishes the event, after the commit.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: columns service`

### Step 6.6 · Controller, module and tests

**Goal:** the project, board and column routes, and tests for them.

**Files:** `src/modules/projects/projects.controller.ts`, `src/modules/projects/projects.module.ts`, `src/app.module.ts`, `test/helpers.ts`, `test/projects.e2e-spec.ts`

@show src/modules/projects/projects.controller.ts 1-53

@show src/modules/projects/projects.controller.ts 54-111

@show src/modules/projects/projects.module.ts all

@show src/app.module.ts 12-12

@show src/app.module.ts 27-27

**What's new**
- **`exports: [BoardCache]`**: Part 7's tasks module invalidates the board too, so it imports `ProjectsModule` for the cache.
- `POST /columns/:columnId/move` returns 200 (`@HttpCode(200)`): it's an action on an existing resource, not a creation.

@show test/helpers.ts 181-201

@chunks test/projects.e2e-spec.ts all

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  9 passed (9)
      Tests  51 passed (51)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `feat: projects, columns and fractional ordering with a cached board`

---
