## Part 8 · Comments, activity feed & search

Three read-heavy features on top of what exists: comments on tasks, the workspace activity feed (the log you've been writing since Part 5), and Postgres full-text search with ranked, highlighted results.

### Step 8.1 · Comments

**Goal:** list (oldest first), create, edit (author only) and delete (author or admin) comments.

**Files:** `src/modules/comments/comment.dto.ts`, `src/modules/comments/comments.service.ts`, `src/modules/comments/comments.controller.ts`, `src/modules/comments/comments.module.ts`

@show src/modules/comments/comment.dto.ts all

@show src/modules/comments/comments.service.ts 1-59

@show src/modules/comments/comments.service.ts 60-95

@show src/modules/comments/comments.controller.ts all

@show src/modules/comments/comments.module.ts all

**What's new**
- **Ownership rules on top of roles:** `access.comment()` returns the comment and the caller's membership; editing requires `authorId === userId`; deleting accepts the author or `atLeast(role, 'admin')`.
- Comments page **oldest first** (`ASC`), the reading order of a conversation.
- `comment.created` is published to the project channel, so an open task drawer shows new comments live.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: comments`

### Step 8.2 · The activity feed

**Goal:** `GET /workspaces/:workspaceId/activity`, newest first, optionally filtered by project or task.

**Files:** `src/modules/activity/activity.dto.ts`, `src/modules/activity/activity.service.ts`, `src/modules/activity/activity.controller.ts`, `src/modules/activity/activity.module.ts`

@show src/modules/activity/activity.dto.ts all

@show src/modules/activity/activity.service.ts 4-5

@show src/modules/activity/activity.service.ts 8-8

@show src/modules/activity/activity.service.ts 63-81 | add after `record()` (after its closing `}`)

@show src/modules/activity/activity.controller.ts all

@show src/modules/activity/activity.module.ts 5-5

@show src/modules/activity/activity.module.ts 10-10

**What's new**
- `query.andWhere('event.projectId = :projectId', filter)` passes the whole filter object as parameters; TypeORM picks the names the SQL mentions.
- The partial indexes from Part 2 (`activity_project_idx … WHERE project_id IS NOT NULL`) serve the filtered feeds; the unfiltered feed uses `(workspace_id, id)`.

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: activity feed`

### Step 8.3 · Full-text search

**Goal:** `GET /workspaces/:workspaceId/search?q=…`: ranked results with safely highlighted snippets, paginated by rank.

**Files:** `src/modules/search/search.dto.ts`, `src/modules/search/search.service.ts`, `src/modules/search/search.service.spec.ts`, `src/modules/search/search.controller.ts`, `src/modules/search/search.module.ts`

@show src/modules/search/search.dto.ts all

@show src/modules/search/search.service.ts 1-38

@show src/modules/search/search.service.ts 39-85

@show src/modules/search/search.service.spec.ts all

**What's new**
- **Raw SQL when the ORM has nothing to say.** `ts_rank`, `ts_headline` and `websearch_to_tsquery` aren't part of TypeORM's API, so the query is SQL through `dataSource.query(sql, params)` with **numbered parameters** (`$1`, `$2`). Then one repository query loads the matching tasks with their relations, and a `Map` puts them back in rank order.
- **`websearch_to_tsquery`** understands what people type into search boxes: `login -oauth "reset password"`. It never raises a syntax error, unlike `to_tsquery`.
- **Safe highlights:** `ts_headline` can't HTML-escape. We ask it to mark matches with control characters (`\u0001`, `\u0002`), escape the whole snippet, then swap the markers for `<mark>` tags. A task titled `<script>` comes back escaped; only our `<mark>` tags are HTML.
- **A cursor with two parts:** results order by `(rank DESC, id DESC)`, so the cursor carries both, and `(rank, id) < ($5::real, $6::uuid)` is a **row comparison** that resumes exactly after the last result. `ts_rank` returns `real` (float4); casting the cursor's value back to `real` makes equal ranks compare equal.

@show src/modules/search/search.controller.ts all

@show src/modules/search/search.module.ts all

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

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run src/modules/search

**Commit:** `feat: full-text search`

### Step 8.4 · Wiring and tests

**Goal:** the three modules in the app, and tests for all three features.

**Files:** `src/app.module.ts`, `test/collaboration.e2e-spec.ts`

@show src/app.module.ts 7-7

@show src/app.module.ts 10-10

@show src/app.module.ts 14-14

@show src/app.module.ts 29-30

@show src/app.module.ts 33-33

**What's new**
- `ActivityModule` was already loaded (workspaces import it), but listing it in `AppModule` says the feed is a feature of the app, not just a helper.

@chunks test/collaboration.e2e-spec.ts all

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  12 passed (12)
      Tests  65 passed (65)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build
@verify npx vitest run

**Commit:** `feat: comments, activity feed and full-text search`

---
