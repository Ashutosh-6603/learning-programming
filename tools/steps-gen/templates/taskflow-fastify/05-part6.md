## Part 6 · Projects, columns & ordering

Projects come with three default columns, columns can be reordered, and the whole board is served from a Redis cache. The ordering algorithm (fractional indexing) is the same code as in Express, because it's pure TypeScript; what's new is expressing the board queries in Drizzle and a few TypeBox schema patterns.

### Step 6.1 · Fractional indexing

**Goal:** `keyBetween(a, b)` returns a string that sorts strictly between `a` and `b`, so moving an item rewrites one row.

**Files:** `src/lib/fractional-index.ts`, `tests/unit/fractional-index.test.ts`

@chunks src/lib/fractional-index.ts all

**What's new**
- Identical to Express, line for line: it's a pure function over strings. The test vectors below are shared by all six backends (the TaskFlow README lists them), so a Python or Java port must produce the same keys.
- Reading it once more: a key is an **integer part** (a head character that encodes its length, then digits) plus an optional **fraction**. `keyBetween(a, null)` appends by incrementing the integer part; `keyBetween(a, b)` with a shared integer part bisects the fractions with `midpoint`.

@show tests/unit/fractional-index.test.ts all

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

@verify npx vitest run tests/unit/fractional-index.test.ts

**Commit:** `feat: fractional indexing`

### Step 6.2 · DTOs, the board cache and the real-time publisher

**Goal:** the response schemas for projects, columns, tasks and the board; a cache-aside wrapper for the board; and a publisher that announces board changes over Redis Pub/Sub (Part 10 delivers them).

**Files:** `src/modules/projects/projects.dto.ts`, `src/modules/projects/board-cache.ts`, `src/modules/realtime/publisher.ts`

@chunks src/modules/projects/projects.dto.ts 1-48

**What's new**
- `Task` nests `UserSummary` twice and `Nullable(...)` where the contract says `oneOf [X, null]`; the board schema builds a column-with-tasks type by spreading `Column.properties` and adding `tasks: Type.Array(Task)`.
- **One schema, three uses:** the board's response schema validates nothing at run time but drives the serializer (only listed properties are written, in a fixed order), the TypeScript type of `board()`, and documentation of intent.

@chunks src/modules/projects/projects.dto.ts 49-$

**What's new**
- `Omit<ProjectDto, 'createdAt' | 'updatedAt'> & { createdAt: Date; updatedAt: Date }`: the row type is "the DTO, but with `Date`s", written with TypeScript's utility types instead of a second hand-written interface.
- **`taskWith`** is the Drizzle `with` object that loads everything `toTask` needs (the project key, assignee and reporter summaries) in one query, like Express's `taskInclude`. `as const` keeps its literal types, so Drizzle can infer the loaded shape from it.

@show src/modules/projects/board-cache.ts all

@show src/modules/realtime/publisher.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: board cache, dtos and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** retry a transaction when a concurrent move took the same position key.

**Files:** `src/lib/pg-errors.ts`

@show src/lib/pg-errors.ts 18-34

**What's new**
- `return await attempt()` inside `try`: the `await` matters. Without it the rejected promise would escape the `try`, and the retry would never happen.
- Only a **unique violation** is retried, and at most three times: the `UNIQUE (parent, position)` index is what detects that two users computed the same key; any other error propagates at once.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: retry on position conflicts`

### Step 6.4 · Projects service and the board

**Goal:** projects with three default columns, cache invalidation on every write, and the board as one cached read.

**Files:** `src/modules/projects/projects.service.ts`

@chunks src/modules/projects/projects.service.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: projects service and cached board`

### Step 6.5 · Columns service

**Goal:** add, rename, reorder and delete columns, with the cache invalidated and an event published after every change.

**Files:** `src/modules/projects/columns.service.ts`

@chunks src/modules/projects/columns.service.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: columns service`

### Step 6.6 · Routes, wiring and tests

**Goal:** the project and column endpoints, wired in, with tests for default columns, roles, cascades and reordering.

**Files:** `src/modules/projects/projects.routes.ts`, `src/container.ts`, `src/app.ts`, `tests/helpers.ts`, `tests/integration/projects.test.ts`

@chunks src/modules/projects/projects.routes.ts all

**What's new**
- `Type.Optional(Description)` on create versus a plain property inside `Patch(...)`: in a PATCH, `null` clears the description and omitting it leaves it alone ("merge semantics"); both rules come from the contract.
- `MoveColumnBody` requires `afterColumnId`, which may be `null` (move to the front).

@show src/container.ts 16-18

@show src/container.ts 20-20

@show src/container.ts 64-66

@show src/container.ts 77-78

@show src/app.ts 21-21

@show src/app.ts 143-143

@show tests/helpers.ts 137-157

@chunks tests/integration/projects.test.ts all

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  8 passed (8)
      Tests  46 passed (46)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `feat: projects, columns and fractional ordering with a cached board`

---
