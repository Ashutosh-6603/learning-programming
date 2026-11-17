## Part 6 · Projects, columns & ordering

### Step 6.1 · Fractional indexing

**Goal:** `key_between(a, b)`: a string that sorts strictly between two others, so a drag-and-drop move rewrites one row instead of renumbering a column.

**Files:** `app/core/fractional_index.py`, `tests/unit/test_fractional_index.py`

@chunks app/core/fractional_index.py all

**What's new (TS → Python)**
- **The same algorithm as the TypeScript repos**, line for line. Strings compare by code point with `<`, as in JS, and `s[n]`, `s[:n]`, `s[n:]` are indexing and slicing (`s.slice(0, n)`, `s.slice(n)`).
- **One deliberate difference: rounding.** The midpoint digit is `(digit_a + digit_b + 1) // 2`, not `round((a + b) / 2)`. Python's `round()` rounds **half to even** ("banker's rounding": `round(46.5) == 46`), while JavaScript's `Math.round(46.5)` is 47. With `round()`, `key_between("a0V", "a1")` would return `a0k` instead of the README's `a0l`, and two backends would disagree about the same board. The shared test vectors caught this while the repo was being built ([gotcha](../../docs/gotchas.md#round-uses-bankers-rounding)).
- **`for i in reversed(range(len(digits)))`** counts down over indexes (`for (let i = n - 1; i >= 0; i--)`). A `for` loop that falls off the end without `return` continues after it: here, that means every digit carried over.
- **`ord(c)` / `chr(n)`** convert between a character and its code point (`charCodeAt` / `String.fromCharCode`). `"0" * 26` repeats a string.
- `raise ValueError(...)` for impossible input: these are bugs, not client errors, and they end up as 500s.

@show tests/unit/test_fractional_index.py all

**What's new (TS → pytest)**
- **`@pytest.mark.parametrize(("a", "b", "expected"), [...])`** runs the test once per tuple, with those values as arguments: Vitest's `it.each`. Each case is reported separately (`test_shared_vectors[a0V-a1-a0l]`).
- **`random.Random(7)`** is a generator with a fixed seed, so the "random" insertions are the same on every run. `keys.insert(at, x)` is `splice(at, 0, x)`; `sorted(keys)` returns a sorted copy.
- **`pytest.raises(ValueError, match="a1 >= a0")`** also checks the message (a regex).

> **🧠 DSA & scalability · Fractional indexing**
> - **Data structure:** a variable-length base-62 string per row (`position text COLLATE "C"`), compared by bytes; a unique B-tree index on `(column_id, position)` keeps a column's tasks in order.
> - **Algorithm:** a key is an *integer part* (a head character encoding its length, then digits) plus a *fraction*. `key_between(a, b)`: if the integer parts differ and `a`'s can be incremented without reaching `b`, use that; otherwise keep `a`'s integer part and append the fraction midway between the two fractions (digit by digit, recursing when adjacent digits leave no room).
> - **Complexity:** O(k) for a key of length k. Keys grow about one character every 6 insertions into the *same* gap (log₂ 62 ≈ 5.95 halvings per digit); normal use stays at 2–4 characters.
> - **Why it scales:** a move writes **one** row. Integer positions would renumber up to every task in the column, holding row locks on all of them; floats run out of precision after ~50 repeated bisections.
> - **Alternatives rejected:** integer positions with gaps (still need occasional renumbering); a linked list (`previous_id`: ordered reads become recursive queries); floats (precision).

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `13 passed` (3 validation tests + 10 fractional-index tests: 7 vectors and 3 properties).

@verify .venv/bin/pytest -q tests/unit
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: fractional indexing with the shared test vectors`

### Step 6.2 · Schemas, the board cache and the real-time publisher

**Goal:** the project, column, task and board models; a cache-aside board cache in Redis; and the publisher that announces changes on Redis Pub/Sub.

**Files:** `app/projects/__init__.py`, `app/projects/schemas.py`, `app/projects/board_cache.py`, `app/realtime/__init__.py`, `app/realtime/publisher.py`

```bash
mkdir app/projects app/realtime && touch app/projects/__init__.py app/realtime/__init__.py
```

@copy app/projects/__init__.py
@copy app/realtime/__init__.py

@show app/projects/schemas.py 1-51

**What's new**
- **Required but nullable:** `after_column_id: UUID | None` with **no default** must be present in the body, and `null` is a valid value ("first position"). A default of `None` would make it optional. Pydantic distinguishes the two cases by the default alone.
- **`WipLimit = Annotated[JsonInt, Field(ge=1, le=999)]`**: `JsonInt` (Step 3.2) refuses `"5"`, and `Field` adds the range.
- `description: Description | None = None` on create, and the same on update (no `NotNull`): `null` clears the description.

@show app/projects/schemas.py 52-95

@show app/projects/schemas.py 96-146

**What's new**
- **`task_relations()`** returns the loader options `TaskOut.of` needs (`project` for the key, `assignee`, `reporter`): every query that feeds `TaskOut` passes them with `.options(*task_relations())` (`*` spreads a list into arguments). One `JOIN` per relationship instead of a query per task.
- **`class BoardColumnOut(ColumnOut)`** adds `tasks` to a column: Pydantic models inherit fields, like TS interfaces `extends`.
- `key=f"{task.project.key}-{task.number}"`: the task key (`TF-42`) isn't stored, it's computed for every response.

@show app/projects/board_cache.py all

**What's new**
- **`Callable[[], Awaitable[BoardOut]]`** is the type of an async function with no arguments returning a `BoardOut`: TS's `() => Promise<BoardOut>`.
- **`board.model_dump_json(by_alias=True)`** serialises with camelCase keys (the same JSON a client receives), and **`BoardOut.model_validate_json(cached)`** parses and validates it back into a model. `ex=TTL_SECONDS` is `SET ... EX 300`.

> **🧠 DSA & scalability · Cache-aside for the board**
> - **Data structure:** Redis string `cache:board:{projectId}` holding the board's JSON, 5-minute TTL.
> - **Algorithm:** read → `GET`; hit → parse and return; miss → load columns and tasks from Postgres, `SET ... EX 300`, return. Every write that changes the board → `DEL` after commit.
> - **Complexity:** O(1) Redis round trip on a hit; the miss path is two indexed queries, O(columns + tasks).
> - **Why it scales:** the board is the hottest read (every viewer, every reconnect) and changes rarely compared with how often it's read; any instance can serve it from Redis. Deleting after commit (not before) means a reader can't re-cache stale data from a write that's still in flight… almost: the TTL bounds the rare race and the staleness from writes that don't invalidate (a user renaming themselves).
> - **Alternatives rejected:** an in-process cache (each instance would be stale differently); updating the cached JSON on every write (every write path would need to rebuild a board fragment correctly); no cache (fine at small scale; the board query joins three tables).

@show app/realtime/publisher.py 1-11

@show app/realtime/publisher.py 13-14

@show app/realtime/publisher.py 16-39

@show app/realtime/publisher.py 50-75

**What's new**
- **`envelope`** builds the protocol's `{type, payload?, ts}` JSON. `payload.model_dump(mode="json", by_alias=True)` turns a model into plain JSON-ready data (UUIDs and datetimes become strings), and `json.dumps` writes it. `isoformat(timespec="milliseconds")` with `+00:00` replaced by `Z` is `new Date().toISOString()`.
- **Payload models** for events that aren't a whole resource (`ColumnDeleted`, `TaskDeleted`): typed, camelCase on the wire. Parts 8 and 10 add two more.
- **`redis.publish(channel, message)`** is fire-and-forget: every instance subscribed to `project:{id}` receives it (Part 10 subscribes).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 74 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: project schemas, board cache and realtime publisher`

### Step 6.3 · Position conflicts

**Goal:** when two users drop into the same gap at once, retry the losing move instead of failing it.

**Files:** `app/db/errors.py`

@show app/db/errors.py 1-3

@show app/db/errors.py 5-5

@show app/db/errors.py 24-42

**What's new (TS → SQLAlchemy)**
- **`session.begin_nested()` is a SAVEPOINT.** Inside one transaction, `SAVEPOINT sp` marks a point you can roll back to without losing the rest. Each attempt runs inside one: a unique violation rolls back only that attempt (its position write and its activity row), and the retry recomputes the key from the *new* neighbours, still inside the request's transaction. NestJS retried a whole transaction; here the request's session is the transaction, so a savepoint is the natural unit.
- **`async with ...: return await attempt()`**: leaving the block normally releases the savepoint (flushing the attempt's writes first, which is where the unique violation surfaces).
- **A generic async function:** `retry_on_position_conflict[T]` returns whatever `attempt` returns, `<T>(attempt: () => Promise<T>) => Promise<T>`.
- `while True:` with a counter, and a bare `raise` re-raises the last error when it isn't ours to handle or the attempts are used up.

> **🧠 DSA & scalability · Optimistic retry on a unique index**
> - **Data structure:** the unique B-tree index `(project_id, position)` on columns (`(column_id, position)` on tasks).
> - **Algorithm:** compute the key from the neighbours you read, write it; if another transaction committed the same key first, the index rejects yours → roll back to the savepoint, re-read the neighbours (which now include the winner), compute a key between them, try again (max 3 attempts).
> - **Complexity:** one extra round of reads and a write per conflict; conflicts need two drops into the same gap within milliseconds, so retries are rare.
> - **Why it scales:** no lock is taken on the neighbours, so moves in different gaps or columns never wait for each other; the index is the referee.
> - **Alternatives rejected:** `SELECT ... FOR UPDATE` on the column's tasks (serialises every move in the column); ignoring the race (two tasks with the same key: an unstable order).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 74 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: retry position conflicts inside a savepoint`

### Step 6.4 · The projects service and the board

**Goal:** list, create (with the three default columns), read, update and delete projects, and build the board.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/projects/service.py`

@show app/access/service.py 14-14

@show app/access/service.py 41-48

@show app/core/params.py 11-11

**What's new**
- **`session.get(Project, project_id)`** loads by primary key, and checks the session's **identity map** first: within one request, the same row is the same Python object, however many times it's loaded.
- `return project, await self.member(...)`: a tuple of the project and the membership; callers unpack what they need (`project, _ = ...`).

@show app/projects/service.py 1-35

@show app/projects/service.py 36-88

**What's new**
- **Default columns in the same transaction:** the project is flushed (so its id exists), then three `BoardColumn` rows are added with consecutive keys (`a0`, `a1`, `a2`) from `key_between(previous, None)`. One commit writes the project, the columns and the activity event, or none of them.
- `position = None` then reassigned in the loop: Python variables have no declared type at runtime; mypy infers `str | None` from the two assignments.

@show app/projects/service.py 89-121

**What's new**
- **After the commit:** invalidate the cache (update, delete) and enqueue the storage cleanup (delete). The order is the same in every service: commit, then side effects.

@show app/projects/service.py 122-153

**What's new**
- **A closure as the loader:** `async def load()` inside `board` captures `project` and `project_id`, and is passed to `cache.get_or_load(...)` uncalled: it only runs on a cache miss.
- **Two queries, one after the other.** NestJS ran the columns and tasks queries in parallel with `Promise.all`; one `AsyncSession` runs one statement at a time (it holds one connection), so here they're sequential. Two sessions could run them in parallel, at the cost of two pool connections per board read; on a cache-aside path that's rarely worth it.
- **`defaultdict(list)`** is a dict that creates an empty list the first time a missing key is read, so `by_column[task.column_id].append(...)` needs no "if missing" check. `Map.groupBy` in one line.
- **`BoardColumnOut(**ColumnOut.of(c).model_dump(), tasks=...)`**: build the column's fields once, then add `tasks`.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 75 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: projects service with default columns and the cached board`

### Step 6.5 · The columns service

**Goal:** add, rename, move and delete columns; every write invalidates the board and publishes an event.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/projects/columns.py`

@show app/access/service.py 6-6

@show app/access/service.py 13-13

@show app/access/service.py 49-61

@show app/core/params.py 12-12

@show app/projects/columns.py 1-41

@show app/projects/columns.py 42-74

**What's new**
- **The attempt is a closure** that reads the last position, builds the column and records the activity; `retry_on_position_conflict` runs it in a savepoint, retrying on a duplicate position. **`.limit(1)` + `session.scalar(...)`** reads one value (`ORDER BY position DESC LIMIT 1`).
- **Commit, then `_after_write`:** invalidate the board and publish `column.created` with the same payload the client receives.

@show app/projects/columns.py 75-117

**What's new**
- **Moving a column** computes a key between the column it should follow (`after_column_id`, or the start) and the next column after that one, ignoring the column being moved. Only the moved row changes.
- `"afterColumnId": str(after_column_id) if after_column_id else None`: values in the JSONB activity data must be JSON types, so UUIDs become strings. (`x if cond else y` is the ternary.)

@show app/projects/columns.py 118-164

**What's new**
- **Postgres refuses to delete a column that still has tasks** (`tasks.column_id` has no `ON DELETE`): the `DELETE` raises `IntegrityError` with SQLSTATE 23503, which becomes a 409 with a helpful message. No count query, no race between counting and deleting.
- Methods starting with `_` are private by convention, like `#private` in TS (but nothing enforces it).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 76 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: columns service with fractional moves`

### Step 6.6 · The router, the wiring and tests

**Goal:** the project and column routes, and tests for default columns, keys, RBAC, cascades and column moves.

**Files:** `app/projects/router.py`, `app/main.py`, `tests/helpers.py`, `tests/test_projects.py`

@show app/projects/router.py 1-43

@show app/projects/router.py 44-99

@show app/main.py 23-23

@show app/main.py 80-80

@show tests/helpers.py 115-132

**What's new**
- **`@dataclass(frozen=True) class Fixture(WorkspaceFixture)`**: a dataclass can extend another, adding fields after the parent's. `Fixture(ws.owner, ws.workspace_id, project_id, column_ids)` passes them positionally, in declaration order.

@show tests/test_projects.py all

**What's new**
- **A fixture per test file:** `f` builds a fresh workspace + project for each test that asks for it. It depends on `client`, so the database is reset first.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `47 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: project and column routes`

---
