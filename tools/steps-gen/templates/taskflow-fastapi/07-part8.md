## Part 8 · Comments, activity feed & search

### Step 8.1 · Comments

**Goal:** list a task's comments oldest first; members comment; only the author edits; the author or an admin deletes; new comments are published live.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/comments/__init__.py`, `app/comments/schemas.py`, `app/realtime/publisher.py`, `app/comments/service.py`

```bash
mkdir app/comments && touch app/comments/__init__.py
```

@copy app/comments/__init__.py

@show app/access/service.py 16-16

@show app/access/service.py 73-86

@show app/core/params.py 14-14

**What's new**
- **Chained eager loading:** `joinedload(Comment.task).joinedload(Task.project)` joins the comment's task and *that* task's project in one query: the access check needs the project's workspace.

@show app/comments/schemas.py all

@show app/realtime/publisher.py 12-12

@show app/realtime/publisher.py 40-44

**What's new**
- **A model inside a model:** `CommentCreated.comment` is a `CommentOut`; dumping the envelope dumps it too, with camelCase keys all the way down.

@show app/comments/service.py 1-62

@show app/comments/service.py 63-104

**What's new**
- **`comment.body = body` then `commit()`**: the unit of work again; SQLAlchemy writes `body` and `updated_at`.
- **Authorization beyond roles:** editing needs authorship (`comment.author_id != user_id` → 403), deleting needs authorship *or* admin (`at_least(membership.role, "admin")`). The access service returns the membership, so the role check costs no extra query.
- **Comments don't touch the board cache:** the board shows tasks, not their comments. Only `comment.created` is published (README §9.2).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 86 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: comments with author and admin rules`

### Step 8.2 · The activity feed

**Goal:** the workspace's audit log, newest first, filterable by project and task.

**Files:** `app/activity/schemas.py`, `app/activity/service.py`, `app/activity/router.py`

@show app/activity/schemas.py all

@show app/activity/service.py 7-8

@show app/activity/service.py 11-16

@show app/activity/service.py 74-88

@show app/activity/router.py all

**What's new**
- **`list` reuses `self.access`**, injected since Part 5: the reason `ActivityService` asked for the access service before it needed it.
- **Two partial indexes** serve the filters: `(project_id, id) WHERE project_id IS NOT NULL` and `(task_id, id) WHERE task_id IS NOT NULL`. Workspace-level events (no project, no task) don't take space in them.
- **`data: dict[str, Any]`** is returned as stored: the JSON object each service recorded.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 88 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: activity feed with project and task filters`

### Step 8.3 · Full-text search

**Goal:** search task titles and descriptions across a workspace, best match first, with safe highlighted snippets and `(rank, id)` cursors.

**Files:** `app/search/__init__.py`, `app/search/schemas.py`, `app/search/service.py`, `tests/unit/test_search.py`

```bash
mkdir app/search && touch app/search/__init__.py
```

@copy app/search/__init__.py

@show app/search/schemas.py all

@show app/search/service.py 1-48

**What's new**
- **Raw SQL with `text(...)`** and named parameters (`:q`, `:workspace_id`): this query uses Postgres functions the ORM has no shortcuts for (`websearch_to_tsquery`, `ts_rank`, `ts_headline`). Values still travel separately from the SQL text. **`.format(after=...)`** only inserts one of two constant SQL fragments, never user input.
- **`CAST(:after_id AS uuid)`**: inside a row comparison, asyncpg can't infer a parameter's type, so it's spelled out.
- **`html.escape`** escapes `& < > " '`. `ts_headline` can't escape HTML itself, so matches are marked with control characters (`\x01`, `\x02`), the snippet is escaped, then the markers become `<mark>` tags.

@show app/search/service.py 49-83

**What's new**
- **`.all()` on a `text()` query returns rows** whose columns are attributes: `h.id`, `h.rank`, `h.headline`.
- **Two queries:** the ranked ids first (cheap, index-driven), then the tasks with their relationships, rebuilt in rank order through a dict: `{task.id: TaskOut.of(task) for task in tasks}` is a **dict comprehension** (`Object.fromEntries(...)`).
- **The rank cursor** carries a float: Python's `json.dumps` writes the shortest decimal that reads back to the same float, and the SQL casts it back to `real` (`ts_rank`'s type), so the row comparison is exact.

@show tests/unit/test_search.py all

> **🧠 DSA & scalability · Full-text search with a GIN index**
> - **Data structure:** `tasks.search_vector`, a generated `tsvector` (title weighted A, description B), indexed by **GIN**: an inverted index from each lexeme ("login") to the posting list of rows containing it.
> - **Algorithm:** `websearch_to_tsquery('english', q)` parses web-search syntax (words, `"phrases"`, `or`, `-excluded`) and stems the words; `@@` intersects the posting lists through the index; `ts_rank` scores matches (weight A > B); `ts_headline` builds the snippet for the page only. Paging continues with `(rank, id) < (cursor.rank, cursor.id)`.
> - **Complexity:** O(Σ posting-list lengths) to find candidates, then ranking and sorting the matches: O(m log m) for m matches. The workspace filter is a join on `projects`.
> - **Why it scales:** the index does the expensive part, and the vector is maintained by Postgres on every write, so the app can't forget to update it.
> - **Alternatives rejected:** `ILIKE '%login%'` (no index, O(N) scan, no stemming: "logins" wouldn't match "login"); a search engine (OpenSearch: better ranking and fuzziness, but one more service to run and keep in sync; Pulse revisits this). Rank cursors are the fragile part: ranks tie and are floats, which is why `id` breaks ties and the float is cast back to `real`.

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `14 passed`.

@verify .venv/bin/pytest -q tests/unit
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: full-text search with safe headlines`

### Step 8.4 · Wiring and tests

**Goal:** the comment and search routes, wired in; tests for comments, the activity feed and search.

**Files:** `app/comments/router.py`, `app/search/router.py`, `app/main.py`, `tests/test_collaboration.py`

@show app/comments/router.py all

@show app/search/router.py all

@show app/main.py 10-10

@show app/main.py 14-14

@show app/main.py 27-27

@show app/main.py 82-84

@show tests/test_collaboration.py all

**What's new**
- **`params={"q": "login", "limit": 1}`** builds the query string (httpx encodes it).
- The search test checks the ranking (title match first), the escaping (`<b>` from a description never comes back as markup) and `(rank, id)` paging.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `61 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: comment, activity and search routes`

---
