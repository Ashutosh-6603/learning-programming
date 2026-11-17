## Part 7 · Tasks

### Step 7.1 · Schemas, types and the filtered list

**Goal:** the task request models, the access check for a task, and the filtered, paginated task list.

**Files:** `app/tasks/__init__.py`, `app/tasks/schemas.py`, `app/access/service.py`, `app/core/params.py`, `app/tasks/service.py`

```bash
mkdir app/tasks && touch app/tasks/__init__.py
```

@copy app/tasks/__init__.py

@show app/tasks/schemas.py all

**What's new**
- **`class ListTasksQuery(PageQuery)`** extends the pagination query with filters: a subclass of a Pydantic model inherits its fields. `?columnId=…&priority=high&limit=5` arrives as one validated object.
- **`assignee_id`** is a UUID *or* the literal `none`. A `UUID | Literal["none"]` union would work, but a failure would be reported once per union member (`query.assigneeId.uuid`, `query.assigneeId.literal['none']`); one regex gives one clear error, and the service converts.
- **`due_before: Timestamp | None`**: the query string is text either way, and `Timestamp` still demands a timezone.
- **`column_id: Annotated[UUID | None, NotNull] = None`** on create: omit it for the first column, but `null` is refused (a task always has a column). `priority: Priority = "medium"` is a plain default.
- **`MoveTaskIn.after_task_id`** is required and nullable, like `afterColumnId`.

@show app/access/service.py 17-17

@show app/access/service.py 62-72

@show app/core/params.py 13-13

@show app/tasks/service.py 2-2

@show app/tasks/service.py 4-6

@show app/tasks/service.py 11-11

@show app/tasks/service.py 13-15

@show app/tasks/service.py 17-20

@show app/tasks/service.py 22-22

@show app/tasks/service.py 24-25

@show app/tasks/service.py 28-28

@show app/tasks/service.py 30-32

@show app/tasks/service.py 34-34

@show app/tasks/service.py 37-37

@show app/tasks/service.py 40-41

@show app/tasks/service.py 51-88

@show app/tasks/service.py 225-232

@show app/tasks/service.py 265-267

**What's new (TS → SQLAlchemy)**
- **Building a query step by step:** `query = query.where(...)` adds a condition for each filter that was given. Every value is a **bound parameter**, sent separately from the SQL text, so nothing the user typed is ever parsed as SQL.
- `Task.assignee_id.is_(None)` is `IS NULL` (`= NULL` is never true in SQL).
- **`.options(*task_relations())`** joins the project, assignee and reporter, so `TaskOut.of` has everything it reads in one query.
- **`_load`** reloads a task with its relationships: every method that returns a task ends with it.

> **🧠 DSA & scalability · Filtered keyset lists**
> - **Data structure:** B-tree indexes `(project_id, id)` and `(assignee_id, id)` on `tasks`.
> - **Algorithm:** `WHERE project_id = $1 [AND filters] AND id < $cursor ORDER BY id DESC LIMIT n + 1`. The planner walks `(project_id, id)` backwards from the cursor and applies the other filters to each row it reads.
> - **Complexity:** O(log N + rows examined); with a selective filter (one assignee), Postgres can switch to `(assignee_id, id)` instead.
> - **Why it scales:** no page ever costs more because it's deep, and the planner picks the index that matches the filter.
> - **Alternatives rejected:** an index per filter combination (indexes cost every write); filtering in Python after a broad query (moves the whole project's tasks over the network).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: task schemas and the filtered task list`

### Step 7.2 · Creating a task: the per-project counter

**Goal:** create a task at the bottom of its column, with the next per-project number, safely under concurrency.

**Files:** `app/tasks/service.py`

First the helpers `create` needs (they go at the end of the class), then `create` itself:

@show app/tasks/service.py 7-7

@show app/tasks/service.py 10-10

@show app/tasks/service.py 12-12

@show app/tasks/service.py 16-16

@show app/tasks/service.py 21-21

@show app/tasks/service.py 23-23

@show app/tasks/service.py 26-27

@show app/tasks/service.py 29-29

@show app/tasks/service.py 33-33

@show app/tasks/service.py 36-36

@show app/tasks/service.py 233-264

**What's new**
- **`_resolve_column`** picks the project's first column when none is given, and refuses a column from another project with a 422 on `columnId`.
- **`_assert_assignable`** runs `SELECT EXISTS (...)`: an assignee must be a member of the workspace.

@show app/tasks/service.py 89-140

**What's new (TS → SQLAlchemy)**
- **`update(Project).where(...).values(next_task_number=Project.next_task_number + 1).returning(Project.next_task_number - 1)`** is `UPDATE projects SET next_task_number = next_task_number + 1 WHERE id = $1 RETURNING next_task_number - 1`: arithmetic on columns builds SQL, and `session.scalar` reads the one returned value. **`synchronize_session=False`** tells SQLAlchemy not to update the `Project` object already loaded in this session (we don't read the counter from it).
- **The counter's `UPDATE` takes a row lock** on the project until the request commits, so concurrent creates in the same project queue up there, and each later statement sees the previous creator's committed task. Creates in different projects don't wait for each other.
- **The whole attempt runs in a savepoint** (Step 6.3): if two creates still collide on the position, only the attempt rolls back (counter increment included) and retries.

> **🧠 DSA & scalability · A per-project counter with a row lock**
> - **Data structure:** one integer column, `projects.next_task_number`, and a unique index `(project_id, number)` as a safety net.
> - **Algorithm:** `UPDATE ... SET n = n + 1 ... RETURNING n - 1` reads and increments atomically while holding the row's lock until commit; the task is inserted with that number.
> - **Complexity:** O(1); contention only between creates in the *same* project, which serialise for the length of one short transaction.
> - **Why it scales:** numbers are dense and per-project (`TF-1`, `TF-2`, …) with no gaps from failed reads, and the lock is one row, not a table.
> - **Alternatives rejected:** `MAX(number) + 1` (two creates read the same max: duplicates); a global sequence (fast, but numbers wouldn't be per-project); an advisory lock (works, but invisible in the schema).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: create tasks with per-project numbers`

### Step 7.3 · Update, move and delete

**Goal:** edit a task's fields with an activity record of what changed, move it between columns with one row write, and delete it.

**Files:** `app/tasks/service.py`

@show app/tasks/service.py 1-1

@show app/tasks/service.py 3-3

@show app/tasks/service.py 8-9

@show app/tasks/service.py 35-35

@show app/tasks/service.py 38-39

@show app/tasks/service.py 42-50

@show app/tasks/service.py 141-224

**What's new**
- **The change log:** for each field the client sent, compare the old and new values and record `{"from": …, "to": …}` under the field's **camelCase** name (`to_camel("due_at")` → `"dueAt"`), converted to JSON-friendly values by `_json`. Comparing two aware datetimes with `!=` compares instants, whatever their time zones.
- **A changed due date resets `reminder_sent_at`**, so the new date gets its own reminder (Part 11).
- **Moving:** the moved task's `column_id` and `position` are assigned, and `flush()` sends the `UPDATE` inside the savepoint, where a duplicate position surfaces. The attempt returns nothing (`-> None`); the task is reloaded after the commit.
- **Deleting** cascades to comments and attachments in Postgres; after the commit, the task's stored files are queued for deletion.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 81 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: update, move and delete tasks`

### Step 7.4 · The router and the wiring

**Goal:** the six task routes.

**Files:** `app/tasks/router.py`, `app/main.py`

@show app/tasks/router.py all

@show app/main.py 28-28

@show app/main.py 81-81

**What's new**
- **`query: Annotated[ListTasksQuery, Query()]`**: the whole filter set from the query string, as one model.

**✅ Checkpoint**

With the API running (`uv run --env-file .env fastapi dev`) and `TOKEN` set as in Step 5.7, create a project and a task in your workspace:

```bash
WS=$(curl -s localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN" \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["items"][0]["id"])')
P=$(curl -s -X POST localhost:8004/api/v1/workspaces/$WS/projects -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"TaskFlow","key":"TF"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["id"])')
curl -s -X POST localhost:8004/api/v1/projects/$P/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"title":"Write the guide"}'
```

Expected: a task with `"key":"TF-1"`, `"number":1`, `"priority":"medium"`, `"position":"a0"`, and your user as `reporter`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: task routes`

### Step 7.5 · Tests

**Goal:** numbering under concurrency, fractional moves, move validation, cache invalidation, merge-patch semantics, assignment rules, filters and pagination, viewer permissions, and the column-delete rule.

**Files:** `tests/test_tasks.py`

@show tests/test_tasks.py all

**What's new**
- **`asyncio.gather(*(create_task(...) for i in range(10)))`** starts ten creates at once and waits for all of them, `Promise.all(Array.from({length: 10}, ...))`. Ten requests run concurrently through the app, each with its own session and pool connection, and the row lock makes their numbers 1 to 10.
- **`todo, _, done = f.column_ids`** unpacks three ids at once.
- **The walrus operator** `if (cursor := page["nextCursor"]) is None:` assigns and tests in one expression, handy in loops like this one.
- **`a["position"] < b["position"] < c["position"]`**: comparisons chain in Python (`a < b and b < c`).

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `56 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `test: tasks, moves, filters and concurrency`

---
