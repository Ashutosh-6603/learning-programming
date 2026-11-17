## Part 5 · Workspaces & RBAC

Workspaces are the tenants: every other resource lives inside one, and every request inside one first checks the caller's membership and role (README §5). This Part also introduces three things every later Part uses: the **access service**, the **activity log**, and **keyset pagination**, plus the **job queue** that sends invitation emails.

**The transaction model, once.** One request = one `AsyncSession` (Step 3.5), shared by every service the request uses. Reads and writes happen on it; **the service method that owns the use case calls `await self.session.commit()` at the end**; side effects that must not happen for a rolled-back change (enqueueing a job, invalidating a cache, publishing a real-time event) come **after** the commit. If anything raises before the commit, the session dependency rolls back on its way out.

### Step 5.1 · The access service

**Goal:** one place that answers "is this user a member of this workspace, with at least this role?", with 404 for strangers and 403 for low roles.

**Files:** `app/access/service.py`, `app/core/params.py`

@show app/access/service.py 1-5

@show app/access/service.py 7-12

@show app/access/service.py 18-40

@show app/access/service.py 101-103

**What's new**
- **`not found` for strangers, `forbidden` for low roles:** a non-member can't tell a workspace exists (README §5). Later Parts add `project()`, `column()`, `task()`, `comment()` and `attachment()`: each loads the resource, finds its workspace, and calls `member()`.
- **`select(...).where(a, b)`**: several conditions in one `where` are joined with `AND`.
- The default parameter values (`minimum: Role = "viewer"`, `what: str = "Workspace"`) make the common call short: `await access.member(workspace_id, user_id)`.

@show app/core/params.py 1-10

**What's new**
- **Path parameters with an alias.** A route declared as `/workspaces/{workspaceId}` and a function parameter `workspace_id: WorkspaceId` are tied by **`Path(alias="workspaceId")`**: the Python name stays snake_case, the URL and the error path (`path.workspaceId`) use the contract's name. **`UUID` as the type** makes FastAPI reject `/workspaces/not-a-uuid` with a 422 before your code runs: no Postgres "invalid input syntax for type uuid" error, no 500.
- One alias per kind of id; Parts 6–9 add the rest.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 55 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: access service for workspace roles`

### Step 5.2 · The activity log and the job queue

**Goal:** record an audit event inside the same transaction as the change it describes, and enqueue background jobs through a typed facade.

**Files:** `app/activity/__init__.py`, `app/activity/service.py`, `app/jobs/__init__.py`, `app/jobs/queue.py`, `app/infra/resources.py`, `app/deps.py`

```bash
uv add --bounds exact "celery[redis]==5.7.0"
uv add --dev --bounds exact celery-types==0.26.0
mkdir app/activity app/jobs && touch app/activity/__init__.py app/jobs/__init__.py
```

- **Celery** is Python's standard distributed task queue (BullMQ's role): producers enqueue named tasks into a **broker** (Redis here; `[redis]` installs the client), workers consume them. Part 11 writes the worker; here the API only *sends*. **celery-types** adds type stubs, so mypy understands Celery (it ships without type hints).

@copy app/activity/__init__.py
@copy app/jobs/__init__.py

@show app/activity/service.py 1-6

@show app/activity/service.py 9-10

@show app/activity/service.py 17-73

@show app/activity/service.py 89-91

**What's new**
- **`record` is not `async`**: it only `session.add`s the event. The `INSERT` is sent with the next flush or commit, **in the same transaction as the change**, so a rolled-back change leaves no event behind. In NestJS, `record` took the transaction's `EntityManager` as an argument; here every service of the request shares one session, so there's nothing to pass around.
- **`type: ActivityType`** shadows Python's built-in `type()` inside this method. It's legal and reads naturally at call sites (`type="task.created"`), and nothing in the method needs the built-in.
- **`access: AccessDep`** in the constructor is used from Part 8 (the activity feed).

@show app/jobs/queue.py 1-2

@show app/jobs/queue.py 4-46

**What's new**
- **`create_celery`** builds the Celery app: the broker is our Redis URL; JSON messages only (never pickle, which can execute code from a malicious message); `task_ignore_result=True` because nothing waits for a job's return value, so no result backend is needed.
- **`send_task(name, kwargs=...)`** enqueues by **task name**, so the API never imports the worker's code. It's a **blocking** network call (Celery's client is synchronous), so it goes through `asyncio.to_thread`, like argon2.
- **A typed facade:** one method per job, with keyword-only arguments, so a call site can't misspell a job name or forget a field. The JSON body is `kwargs`.

@show app/infra/resources.py 14-15

@show app/infra/resources.py 26-26

@show app/infra/resources.py 35-35

@show app/infra/resources.py 42-42

@show app/infra/resources.py 46-46

@show app/deps.py 15-15

@show app/deps.py 34-37

@show app/deps.py 52-52

**What's new**
- The Celery app is a resource like the database engine: created at startup, `close()`d at shutdown (it keeps a connection pool to the broker).
- **`JobsDep`** hands it to services, the same pattern as `RedisDep`.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 59 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: activity log and job queue facade`

### Step 5.3 · Cursor pagination

**Goal:** `?limit=&cursor=` on every list, with opaque base64url cursors that every TaskFlow backend encodes the same way.

**Files:** `app/core/pagination.py`

@show app/core/pagination.py all

**What's new (TS → Python)**
- **`class Page[T](CamelModel)`** is a **generic class** (Python 3.12 syntax; `class Page<T>` in TS). `Page[TaskOut]` is a model with `items: list[TaskOut]`, which FastAPI validates and documents as such.
- **Generic functions:** `def decode_cursor[C: BaseModel](cursor: str, model: type[C]) -> C` takes a model *class* (`type[C]`) and returns an instance of it, `<C extends BaseModel>(cursor: string, model: new () => C): C`. `def to_page[R, I](...)` maps rows of type `R` to items of type `I`.
- **The cursor is validated like input**, because it is input: `base64.urlsafe_b64decode` (padding added back: `-len(cursor) % 4` is the number of `=` it needs), then `model.model_validate_json(raw)` parses and validates in one step. **`except ValueError`** catches everything that can go wrong (bad base64, bad UTF-8, bad JSON, a `ValidationError`): they all derive from `ValueError`. `raise ... from None` hides the original exception from the traceback; the 422 is the whole story.
- **`PageQuery`** describes the query string. In a route, `page: Annotated[PageQuery, Query()]` makes FastAPI read `?limit=…&cursor=…` into the model, with its rules: `limit` 1–100, default 20; `cursor` base64url characters only. Query strings are text, so lax mode converts `"20"` to `20`.
- **`keyset`** finishes a SQLAlchemy query: `Select[T]` is the type of `select(...)`, and the `.where()`/`.order_by()`/`.limit()` calls each return a new query (immutable builders, like Drizzle). `column < after` builds SQL, not a Python comparison.
- **Slicing:** `rows[:limit]` is `rows.slice(0, limit)`, and `rows[-1]` is the last item (`at(-1)`).

> **🧠 DSA & scalability · Keyset pagination on UUIDv7**
> - **Data structure:** a composite **B-tree index** per list, e.g. `(workspace_id, id)` on projects; ids are UUIDv7, so `id` order is creation order.
> - **Algorithm:** `WHERE workspace_id = $1 AND id < $cursor ORDER BY id DESC LIMIT n + 1`. The index seeks to the cursor and reads n + 1 entries; the extra row only says whether a next page exists, and the cursor encodes the *n-th* row's id.
> - **Complexity:** O(log N + n) per page, wherever the page is. `OFFSET k` is O(k + n): page 10,000 reads 200,000 rows to throw them away.
> - **Why it scales:** cost is flat in the depth of the page, and concurrent inserts can't shift a page (OFFSET pages skip or repeat rows when rows are added before them).
> - **Alternatives rejected:** OFFSET (above); a timestamp cursor (ties between rows created in the same millisecond); exposing raw ids as cursors (clients start building them; base64 JSON keeps the format ours to change).

**✅ Checkpoint**

```bash
uv run python -c "
from app.core.pagination import encode_cursor, decode_cursor, IdCursor
c = encode_cursor({'id': '01a18b7e-951f-71f4-affb-2b64a14174e2'})
print(c)
print(decode_cursor(c, IdCursor))
try: decode_cursor('garbage', IdCursor)
except Exception as e: print(e.status, e.errors)"
```

Expected:

```text
eyJpZCI6IjAxYTE4YjdlLTk1MWYtNzFmNC1hZmZiLTJiNjRhMTQxNzRlMiJ9
id=UUID('01a18b7e-951f-71f4-affb-2b64a14174e2')
422 [{'field': 'query.cursor', 'message': 'is not a valid cursor'}]
```

The first line is the same cursor every TaskFlow backend produces for that id.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: keyset pagination with opaque cursors`

### Step 5.4 · Workspace schemas and service

**Goal:** list, create, read, rename and delete workspaces.

**Files:** `app/workspaces/__init__.py`, `app/workspaces/schemas.py`, `app/workspaces/service.py`

```bash
mkdir app/workspaces && touch app/workspaces/__init__.py
```

@copy app/workspaces/__init__.py

@show app/workspaces/schemas.py 1-44

**What's new**
- **`Slug`** carries its rules in the type: `Field(pattern=r"^...$")` is a regex constraint, checked by Pydantic's Rust core.
- **`role: Role`** with `Role` a `Literal`: Pydantic accepts exactly those four strings and rejects anything else with a 422 listing the allowed values.
- `AcceptInvitationIn.token` is a plain bounded string; the service hashes it.

@show app/workspaces/schemas.py 45-96

**What's new**
- `WorkspaceOut.of(workspace, role)` takes the caller's role as a second argument: `currentUserRole` isn't a column, it depends on who asks.
- `InvitationOut.invited_by` comes from the `inviter` relationship, which the query must load (next steps).

@show app/workspaces/service.py 1-59

**What's new (TS → SQLAlchemy)**
- **Loading a relationship in the query: `.options(joinedload(WorkspaceMember.workspace))`** adds a `JOIN` and fills `member.workspace` from the same result set. That's TypeORM's `innerJoinAndSelect`. Without it, `m.workspace` would raise (`lazy="raise"`, Step 2.2).
- **`(await self.session.scalars(query)).all()`** runs the query and returns a list. The brackets matter: `await` applies to `session.scalars(...)`, and `.all()` runs on its result.
- **`lambda m: WorkspaceOut.of(m.workspace, m.role)`** is an arrow function (`m => ...`), limited to one expression.
- **`await self.session.flush()`** sends pending `INSERT`s now, without committing: after it, `workspace.id` is set (the `uuid7` default runs at flush) and the member row can reference it. Everything still commits or rolls back together.
- **`try / except IntegrityError as err`**: the slug's unique constraint fires at flush or commit. **`raise conflict(...) from err`** raises our 409 and keeps the original as its cause (`new Error(msg, { cause })`); a bare **`raise`** re-raises the current exception unchanged.

@show app/workspaces/service.py 60-124

**What's new**
- **`for field, value in body.model_dump(exclude_unset=True).items(): setattr(...)`**: the PATCH pattern from Step 4.4. The activity event records the same changes **by alias** (`model_dump(mode="json", by_alias=True, ...)`): camelCase keys, JSON-ready values, for display.
- **`delete(Workspace).where(...)`** is a Core `DELETE` statement executed on the session; Postgres cascades it to projects, columns, tasks, comments, attachments, members, invitations and activity (`ON DELETE CASCADE`).
- **After the commit, enqueue cleanup jobs** for each project's stored files: the job runs only if the delete really happened.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 63 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: workspace service and schemas`

### Step 5.5 · Members: role changes, removal, and the last-owner rule

**Goal:** list members in join order; change roles and remove members within the RBAC rules; never leave a workspace without an owner.

**Files:** `app/workspaces/members.py`

@chunks app/workspaces/members.py all

**What's new**
- **`frozenset({"member", "viewer"})`** is an immutable set; **`{old_role, new_role} <= ADMIN_MANAGEABLE`** asks "is this set a subset of that one?". Admins may only move people between member and viewer.
- **Changing an attribute is the update:** `target.role = new_role`, then `commit()` writes `UPDATE workspace_members SET role = ...`.
- **A subquery inside `IN`:** `Task.project_id.in_(projects)` where `projects` is a `select(...)`: SQLAlchemy inlines it, so unassigning a removed member's tasks across the whole workspace is one statement.
- **`.with_for_update()`** is `SELECT ... FOR UPDATE`: it locks the owner rows until the transaction ends.

> **🧠 DSA & scalability · The last-owner invariant under concurrency**
> - **Data structure:** the workspace's owner rows in `workspace_members`, found through the `(workspace_id, user_id)` unique index.
> - **Algorithm:** before demoting or removing an owner, `SELECT id ... WHERE role = 'owner' FOR UPDATE` locks all owner rows, then counts them; ≤ 1 → 409. The change and the commit happen while the lock is held.
> - **Complexity:** O(owners) rows read and locked; typically 1–3.
> - **Why it scales:** two owners demoting each other at the same moment both try to lock the same rows; the second waits for the first to commit and then sees only one owner left, so it gets the 409. Without the lock both would count 2 and both succeed. Requests for other workspaces never wait.
> - **Alternatives rejected:** a check-then-update without a lock (the race above); a `SERIALIZABLE` transaction (works, but retries on every serialization failure); a counter column on `workspaces` (one more value to keep correct).

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 64 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: member roles and removal with the last-owner rule`

### Step 5.6 · Invitations

**Goal:** invite by email (admins invite members and viewers, owners also admins), revoke, and accept with a single-use token.

**Files:** `app/workspaces/invitations.py`

@show app/workspaces/invitations.py 1-64

**What's new**
- **`timedelta(days=7)`** is a duration constant; `now + INVITATION_TTL` is a datetime a week later.
- `Invitation.accepted_at.is_(None)` is `accepted_at IS NULL` (`== None` would also work, but linters flag it).

@show app/workspaces/invitations.py 65-129

**What's new**
- **`exists().where(...)`**: `SELECT EXISTS (SELECT 1 FROM workspace_members, users WHERE ...)` checks "is that email already a member?" without loading anything. Listing `User.id` and `User.email` in the conditions brings `users` into the subquery.
- **The token is sent, its hash is stored.** `secrets.token_urlsafe(32)` makes the token, only `sha256(token)` reaches the database, and the plain token goes into the email job. A leaked database can't accept invitations.
- **Delete-then-insert:** an *expired* pending invitation would still block the partial unique index, so it's deleted first, in the same transaction.
- **After the commit, a fresh query with `joinedload`** loads the inviter and the workspace for the response and the email. The email job is enqueued only once the invitation really exists.
- `assert loaded is not None` narrows the type: the row was just committed, so it's there.

@show app/workspaces/invitations.py 130-191

**What's new**
- **`delete(...).returning(Invitation.id)`** + `result.first()`: `DELETE ... RETURNING id` reports whether a row was deleted, in one round trip.
- **Accepting is idempotent for existing members:** the invitation is marked used either way, and someone who is already a member keeps their role.
- The email must match the account's (403 otherwise); unknown, used and expired tokens are all 404.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 65 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: email invitations with hashed single-use tokens`

### Step 5.7 · The router and the wiring

**Goal:** every workspace, member and invitation route, behind the protected router.

**Files:** `app/workspaces/router.py`, `app/main.py`

@show app/workspaces/router.py 1-47

**What's new**
- **Thin routes:** each function only maps HTTP to one service call. The service does the work, raises problems, and returns output models.
- **`Paging = Annotated[PageQuery, Query()]`**: one name for "read `limit` and `cursor` from the query string". `Query()` tells FastAPI to fill a model from query parameters, the way a body parameter is filled from JSON.
- **The return annotation `-> Page[WorkspaceOut]`** is the response schema: FastAPI validates the returned page and documents it.

@show app/workspaces/router.py 48-129

**What's new**
- **Two path parameters, two aliases:** `/members/{userId}` reads `target_user_id: UserId`, while `user_id: CurrentUser` is the caller. The names say which is which.
- `status_code=204` routes return `None`: no body.

@show app/main.py 30-30

@show app/main.py 79-79

**✅ Checkpoint**

Start the API (`uv run --env-file .env fastapi dev`), then in a second terminal log in as the seeded user and create a workspace:

```bash
TOKEN=$(curl -s -X POST localhost:8004/api/v1/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ashutosh@test.com","password":"Ashutosh#1234"}' \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["accessToken"])')
curl -s -X POST localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Acme","slug":"acme"}'
curl -s localhost:8004/api/v1/workspaces -H "Authorization: Bearer $TOKEN"
```

Expected: the created workspace (`"currentUserRole":"owner"`, `createdAt`/`updatedAt` ending in `Z`), then `{"items":[{…"slug":"acme"…}],"nextCursor":null}`. Running the create again gives a 409 problem: `"detail":"Slug is already taken"`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: workspace, member and invitation routes`

### Step 5.8 · Tests

**Goal:** RBAC (404 vs 403), pagination, the last-owner rule, and the invitation flow including the queued email job.

**Files:** `tests/helpers.py`, `tests/test_workspaces.py`

@show tests/helpers.py 3-3

@show tests/helpers.py 5-5

@show tests/helpers.py 9-9

@show tests/helpers.py 15-15

@show tests/helpers.py 17-17

@show tests/helpers.py 81-114

**What's new**
- **`add_member`** writes a membership straight to the database through a session: tests need roles quickly, without the invitation dance.
- **`queued_jobs` reads Celery's queue straight out of Redis.** Celery's Redis broker keeps a queue as a **plain list** named after it (`celery`): `LPUSH` to enqueue, `BRPOP` to consume. Each entry is a JSON envelope whose base64 `body` holds `[args, kwargs, options]` and whose `headers.task` is the job name. `reversed(...)` puts the oldest first. No worker runs in the tests, so jobs stay in the list for the test to inspect.
- **`_, kwargs, _ = ...`**: `_` is the conventional name for "a value I don't need".

@show tests/test_workspaces.py all

**What's new**
- **`[(name, data)] = await queued_jobs(resources)`** unpacks a list that must have **exactly one** item (a different length raises): the invitation enqueued one job, and the test takes its name and data in one line.
- **A nested function** (`def url(u: ApiUser) -> str:` inside the test) is a local helper, a closure over `ws`.
- Tests ask for both `client` and `resources`: pytest resolves each fixture once and shares it.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `31 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `test: workspaces, rbac, members and invitations`

---
