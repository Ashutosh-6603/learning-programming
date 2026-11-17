## Part 8 · Comments, activity feed & search

Three read-mostly features on top of tasks. Comments and the feed reuse everything you've built; search shows how to run **raw SQL with Drizzle** when a query is Postgres-specific.

### Step 8.1 · Comments

**Goal:** comments on a task, oldest first; only the author edits; the author or an admin deletes; new comments are pushed live.

**Files:** `src/modules/comments/comments.service.ts`, `src/modules/comments/comments.routes.ts`

@chunks src/modules/comments/comments.service.ts all

**What's new**
- The response schema (`Comment`) lives next to the service that maps to it, since only this module uses it.
- `loadComment` returns the **DTO**, so the transaction callbacks return exactly what the route sends.
- Comments page **oldest first** (`asc`, `gt`): a conversation reads top to bottom, so the cursor moves forward.

@chunks src/modules/comments/comments.routes.ts all

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: comments`

### Step 8.2 · The activity feed

**Goal:** the workspace's activity log, newest first, optionally narrowed to a project or a task.

**Files:** `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.routes.ts`

@chunks src/modules/activity/activity.service.ts all

**What's new**
- **`data: Type.Object({}, { additionalProperties: true })`**: the event's `data` is free-form JSON (different per event type). An object schema with no listed properties and `additionalProperties: true` tells the serializer to write whatever keys are there. Without it, fast-json-stringify would write `{}`, because a response schema only writes the properties it lists.

@show src/modules/activity/activity.routes.ts all

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

@verify npx tsc --noEmit

**Commit:** `feat: activity feed`

### Step 8.3 · Full-text search

**Goal:** ranked search over task titles and descriptions in a workspace, with safe highlighted snippets and pagination by rank.

**Files:** `src/modules/search/search.service.ts`, `src/modules/search/search.routes.ts`, `tests/unit/headline.test.ts`

@chunks src/modules/search/search.service.ts 1-31

**What's new**
- `toSafeHeadline` is Express's: Postgres marks matches with control characters, we HTML-escape the whole snippet, then turn the markers into `<mark>` tags, so nothing user-supplied survives as raw HTML.
- `interface Hit extends Record<string, unknown>` satisfies `db.execute<T>()`, whose row type must be a record.

@chunks src/modules/search/search.service.ts 32-$

**What's new (raw SQL with Drizzle)**
- **`db.execute(sql\`…\`)`** runs any SQL through the pool and returns the driver's result (`{ rows }` for node-postgres). Every `${value}` becomes a **bound parameter** (`$1`, `$2`…), never string concatenation, so `q` can't inject SQL.
- **Composable fragments:** `afterClause` is either a `sql\`AND …\`` fragment or an empty `sql\`\``; interpolating one `sql` inside another splices it in with its own parameters, like Prisma's `Prisma.sql` and `Prisma.empty`.
- `websearch_to_tsquery('english', q)` accepts what people type into search boxes: quotes for phrases, `-word` to exclude, `or`.
- After the ranked ids come back, the tasks are loaded with the relational API (`inArray(tasks.id, ids)`) and reassembled **in rank order** with a `Map`.

@show src/modules/search/search.routes.ts all

@show tests/unit/headline.test.ts all

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

@verify npx vitest run tests/unit/headline.test.ts

**Commit:** `feat: full-text search`

### Step 8.4 · Wiring and tests

**Goal:** wire the three modules in and test comment permissions, the transactional activity log and ranked, paginated search.

**Files:** `src/container.ts`, `src/app.ts`, `tests/integration/collaboration.test.ts`

@show src/container.ts 11-11

@show src/container.ts 15-15

@show src/container.ts 22-22

@show src/container.ts 80-80

@show src/container.ts 82-83

@show src/app.ts 16-16

@show src/app.ts 19-19

@show src/app.ts 24-24

@show src/app.ts 145-145

@show src/app.ts 147-148

@chunks tests/integration/collaboration.test.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `feat: comments, activity feed and full-text search`

---
