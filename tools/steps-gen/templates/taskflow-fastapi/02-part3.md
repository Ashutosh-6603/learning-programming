## Part 3 · HTTP foundations

This Part builds everything between the socket and your business logic: errors as RFC 9457 problems, validation with Pydantic, request IDs and logging, 404/405/413/415, the database and Redis connections, health checks, and the app itself. It's also where you meet **every core FastAPI idea**: ASGI and middleware, exception handlers, the **lifespan**, and **dependencies** (`Depends`). Take it slowly; the rest of the guide reuses all of it.

### Step 3.1 · Problem details (RFC 9457)

**Goal:** one exception class that maps to the contract's `application/problem+json` body.

**Files:** `app/core/__init__.py`, `app/core/problems.py`

```bash
mkdir app/core && touch app/core/__init__.py
```

@copy app/core/__init__.py

@show app/core/problems.py all

**What's new (TS → Python)**
- **`class ProblemError(Exception)`**: a custom error is a subclass of `Exception` (Python's `Error`). Raising it is `raise ProblemError(...)` (`throw new ...`, without `new`: calling a class creates an instance).
- **`def __init__(self, ...)`** is the constructor. Python has no parameter properties (`constructor(readonly slug: ...)`): you assign `self.slug = slug` yourself. `super().__init__(self.detail)` calls the parent constructor, like `super(detail)`.
- **Default and keyword arguments.** `detail: str | None = None` is an optional parameter. A caller can name any argument (`ProblemError("conflict", detail="…")`), so long parameter lists stay readable without an options object ([primer §6](../../docs/python-for-ts-devs.md#6-functions)).
- **Tuples and unpacking:** `_PROBLEMS[slug]` is a `tuple[int, str]`, a fixed-size pair like TS's `[number, string]`, and `self.status, self.title = ...` unpacks it into two attributes in one line.
- **`detail or self.title`**: `or` returns the first truthy operand, like JS's `||`. `headers or {}` gives each error its own empty dict.
- **`TypedDict`** describes a dict with known keys: `FieldError` is the TS interface `{ field: string; message: string }`, and `FieldError(field=..., message=...)` builds a plain dict that mypy checks.
- **f-strings:** `f"{what} not found"` is a template literal (`` `${what} not found` ``).
- The small factories (`not_found("Task")`, `conflict(...)`) keep call sites short, as in every TaskFlow backend.

**✅ Checkpoint**

```bash
uv run python -c "from app.core.problems import not_found; e = not_found('Task'); print(e.status, e.title, e.detail)"
```

Expected: `404 Not found Task not found`.

@verify .venv/bin/mypy .

**Commit:** `feat: rfc 9457 problem errors`

### Step 3.2 · Validation: camelCase models, field paths and custom types

**Goal:** the base class every request and response model shares, the validation rules the contract needs, and a function that turns Pydantic's errors into the contract's `{ field, message }` list.

**Files:** `app/core/schemas.py`, `app/core/validation.py`, `tests/unit/__init__.py`, `tests/unit/test_validation.py`

@show app/core/schemas.py 1-35

**What's new (TS → Pydantic)**
- **`class CamelModel(BaseModel)`**: a **Pydantic model** is a class whose annotated fields are validated whenever an instance is created, from a dict, from JSON or from keyword arguments. FastAPI uses models for request bodies, query strings and responses. Every model in this repo inherits from `CamelModel`.
- **camelCase on the wire, snake_case in Python.** `alias_generator=to_camel` gives every field an **alias**: `display_name` is read from and written to JSON as `displayName`. `validate_by_alias` accepts the camelCase name in input (what clients send), `validate_by_name` also accepts `display_name` (handy in Python code and tests). Output uses the alias because FastAPI serialises responses `by_alias` (Part 4 shows one). This is how a Python API meets the contract's casing rule without either side changing style.
- **`PatchModel`** adds a **model validator**: a method that runs after the fields are validated (`mode="after"`). **`model_fields_set`** is the set of fields the client *actually sent*, which is how a PATCH tells "omitted" from "set to null" (JSON merge-patch). `{}` gets a 422 on the whole body.
- **Decorators** (`@model_validator(...)`) wrap a function or method, as in TS; here Pydantic's decorator registers the method as a validator ([primer §13](../../docs/python-for-ts-devs.md#13-decorators)). `-> Self` means "returns an instance of whatever class this is".
- **`PydanticCustomError("empty_patch", "…")`** reports a validation error with our own type and message. A plain `ValueError` would also work, but Pydantic would prefix the message with "Value error, ".

@show app/core/schemas.py 36-70

**What's new**
- **`Trimmed`**: `StringConstraints(strip_whitespace=True)` trims the value **before** length rules run. Combined later as `Annotated[Trimmed, Field(min_length=1, max_length=80)]`, `"   "` becomes `""` and fails `min_length`, as the contract's "trimmed before validation" requires. Pydantic flattens nested `Annotated` types, so the metadata stacks.
- **`BeforeValidator(fn)`** runs `fn` on the raw input before Pydantic's own conversion. We use it to *remove* conversions. Pydantic's default **lax mode** converts compatible input: `"5"` → `5` for an `int`, `1700000000` → a date for a `datetime`. That's right for query strings, which are always text, but the contract says a JSON body's numbers are numbers and its dates are strings:
  - **`JsonInt`** refuses strings and booleans, then lets lax mode turn `5.0` into `5` (JSON Schema calls `5.0` an integer, and the contract fuzzer sends it).
  - **`Timestamp`** demands a string, then **`AwareDatetime`** demands an offset: `"2026-10-25T12:00:00Z"` passes, `"2026-10-25T12:00:00"` (no zone) doesn't. Naive datetimes are a classic Python bug source ([gotcha](../../docs/gotchas.md#naive-vs-aware-datetimes)).
  - **`NotNull`** is for PATCH fields that may be **left out but not cleared**: the field is declared `X | None = None` so it can be omitted, and the validator rejects an explicit `null`. The default (`None`) isn't validated, so leaving the field out still works.
- **`isinstance(value, str | bool)`** is a runtime type check (TS's `typeof` and `instanceof` in one). It accepts a union of classes.
- **`Any`** is TS's `any`: these helpers really do accept anything.

```bash
mkdir -p tests/unit && touch tests/unit/__init__.py
```

@copy tests/unit/__init__.py

@show app/core/validation.py all

@show tests/unit/test_validation.py all

**What's new**
- **Pydantic's error format.** A failed validation lists errors as dicts: `{"type": "string_too_short", "loc": ("body", "displayName"), "msg": "String should have at least 1 character", ...}`. FastAPI prefixes `loc` with where the value came from (`body`, `query`, `path`), and **the rest of `loc` already uses the aliases**, so the wire names come for free (Fastify needed a JSON-pointer conversion, NestJS a tree walk).
- **`source, *path = error["loc"]`** unpacks the first item and collects the rest, like `const [source, ...path] = loc`. `[str(p) for p in path]` is a **list comprehension** (`path.map(String)`), and `".".join(parts)` is `parts.join('.')` written from the separator's side.
- `seen` is a **set**, so each field appears once, even if two rules failed.
- **`def error(*loc: str | int, ...)`** in the test takes any number of positional arguments into a tuple, like a TS rest parameter (`...loc`).

**✅ Checkpoint**

```bash
uv run pytest tests/unit
```

Expected: `3 passed`.

@verify .venv/bin/pytest -q tests/unit
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: camelcase models, validation types and field paths`

### Step 3.3 · Request IDs, logging and security headers

**Goal:** every request gets an id that appears in the response, in every log line and in every problem body; every response gets the security headers; non-JSON bodies get 415 and oversized ones 413; and one JSON log line is written per request.

**Files:** `app/core/logging.py`, `app/core/errors.py`, `app/core/middleware.py`

```bash
uv add --bounds exact fastapi==0.162.7 "uvicorn[standard]==0.54.0" structlog==26.1.0
```

- **FastAPI** is the web framework; it brings **Starlette** (the HTTP toolkit underneath: requests, responses, routing, middleware, WebSockets) and Pydantic. **uvicorn** is the server that runs it, the role Node's `http` module plays for Express; `[standard]` adds uvloop (a faster event loop, written in C on libuv, Node's own event loop library) and httptools.
- **ASGI** is the interface between them: an app is any async callable `app(scope, receive, send)`. `scope` describes the request (method, path, headers), `receive()` reads body chunks, `send()` writes the response. Every framework layer, including your middleware, is an ASGI app that wraps the next one. It's Express's `(req, res, next)`, at a lower level.
- **structlog** writes structured (JSON) logs and keeps per-request context, the role pino played in the Node repos.

@show app/core/logging.py all

**What's new**
- **Two logging systems, one output.** Python's standard library has `logging` (named loggers, levels, handlers), and every library uses it: uvicorn, SQLAlchemy, Celery. structlog adds structured key-value events on top. **`ProcessorFormatter`** makes both kinds end up as the same JSON line: `foreign_pre_chain` processes standard-library records (uvicorn's) the way structlog processes its own.
- **Processors** are a pipeline: each function receives the event dict and returns it changed. `merge_contextvars` adds whatever is bound to the current request (its id, later its user), `TimeStamper` adds `timestamp`, `EventRenamer("message")` renames structlog's `event` key to `message`, `JSONRenderer` turns the dict into one line.
- **No local variables in tracebacks.** structlog can include each stack frame's local variables in an exception's JSON. Here those locals would include passwords and tokens, so they're switched off.
- **`for name in ("uvicorn", "uvicorn.error"):`** loops over a tuple. uvicorn configures its own log handlers before importing the app, so we clear them and let its records flow to ours. Its access log is disabled: our middleware writes a better one.

@show app/core/errors.py 1-2

@show app/core/errors.py 6-6

@show app/core/errors.py 10-12

@show app/core/errors.py 27-45

**What's new**
- `problem_response` builds the RFC 9457 body. **`JSONResponse(body, status_code=..., media_type=...)`** is Starlette's response class: it serialises the dict with `json.dumps` and sets the content type, the equivalent of `res.status(...).type(...).json(...)`. Two places need it: the middleware below (for errors raised before any route runs) and the exception handlers (next step).
- `body: dict[str, Any] = {...}` annotates a **local variable**. mypy would infer a narrower type from the literal, which wouldn't allow adding `errors` later.

@show app/core/middleware.py 1-79

**What's new (TS → ASGI middleware)**
- **A middleware is a class with `__init__(self, app)` and `async __call__(self, scope, receive, send)`.** `__call__` makes instances callable like functions (Python's "dunder" methods, double-underscore names, plug objects into the language: `__init__` for construction, `__call__` for calling). Starlette creates it once with the next app in the chain, and calls it for every connection.
- **Only HTTP:** WebSocket connections (Part 10) pass straight through. `scope["type"]` says which.
- **`Headers(scope=scope)`** reads request headers (case-insensitive). **`scope.setdefault("state", {})["request_id"] = …`** stores the id where Starlette's `request.state` will find it later: `request.state` is a view over `scope["state"]`.
- **Wrapping `send`.** The inner function `send_with_headers` intercepts the `http.response.start` message (status + headers), adds our headers and passes it on. It's how `res.set(...)` works in Express, made explicit. **`nonlocal status`** lets the inner function assign to the outer function's variable; without it, assigning would create a new local (JS closures don't need this; [primer §6](../../docs/python-for-ts-devs.md#6-functions)).
- **`structlog.contextvars`**: `bind_contextvars(requestId=…)` attaches the id to the current **context**, and every log line written while handling this request, anywhere in the code, carries it. A context variable is per-task, so concurrent requests don't mix (Node's `AsyncLocalStorage`).
- **`try / except Exception / finally`**: anything no handler caught becomes a 500 problem (logged with its traceback by `log.exception`). The `finally` block always runs and writes the access line, skipping health checks.
- **`time.perf_counter()`** is a monotonic clock for durations (`performance.now()`).

@show app/core/middleware.py 80-121

**What's new**
- **415 and 413 before routing.** FastAPI only parses a body when a route asks for one, and a `text/plain` body sent to a JSON route becomes a confusing 422 ("Input should be a valid dictionary"). This guard answers honestly, for every path: bodies must be `application/json`, and at most 1 MiB.
- **A chunked body has no `Content-Length`**, so `counting_receive` wraps `receive()` and counts bytes as they arrive. Raising Starlette's `HTTPException(413)` inside it stops the read, and the exception handler (next step) turns it into the problem body.
- `int(headers.get("content-length") or 0)`: `.get` returns `None` when the header is missing, and `None or 0` is `0`.
- `_is_json` drops parameters (`; charset=utf-8`) before comparing, like `req.is('application/json')`.

**✅ Checkpoint**

```bash
uv run python -c "import app.core.middleware; print('ok')"
uv run mypy .
```

Expected: `ok`, then `Success: no issues found in 25 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: request ids, json logging and security headers`

### Step 3.4 · Exception handlers: 404, 405 and everything else

**Goal:** the one place where errors become problem responses, including Starlette's own 404 and 405, malformed JSON, validation errors and unique-constraint violations.

**Files:** `app/db/errors.py`, `app/core/errors.py`

@show app/db/errors.py 4-4

@show app/db/errors.py 6-23

**What's new**
- **SQLSTATE codes:** Postgres reports every error with a five-character code; `23505` is a unique violation, `23503` a foreign-key violation. SQLAlchemy wraps the driver's error in `IntegrityError`, and the original asyncpg error is on **`err.orig`**, with the code as `sqlstate`.
- **`getattr(obj, "sqlstate", None)`** reads an attribute by name with a default, like `obj?.sqlstate ?? null`. The `isinstance` check narrows `Any` to `str` for mypy.
- Part 6 adds a retry helper to this file.

@show app/core/errors.py 3-5

@show app/core/errors.py 7-9

@show app/core/errors.py 13-26

@show app/core/errors.py 46-105

**What's new (TS → FastAPI exception handlers)**
- **`app.add_exception_handler(ExceptionClass, handler)`** registers an `async` function that turns that exception (and its subclasses) into a response, NestJS's exception filter in function form. FastAPI looks handlers up by the exception's class.
- **`RequestValidationError`** is what FastAPI raises when Pydantic rejects a request. One special case: **malformed JSON** arrives as a validation error of type `json_invalid`, and the contract wants 400 for it, not 422.
- **404 or 405?** Starlette raises `HTTPException(404)` when no route matches the path, and `HTTPException(405)` when one matches the path but not the method, with an `Allow` header naming **only that one route's methods** (`GET` and `POST` on the same path are two routes). `allowed_methods` asks every route the same question the router asks: **`route.matches(scope)`** returns `Match.FULL` when path *and* method match. Trying each method in turn gives the complete `Allow` list. (In NestJS you built a route table for this; the router's own matching makes that unnecessary here.)
- **`{**request.scope, "method": method}`** copies the scope dict with one key changed, `{ ...scope, method }`.
- **`any(... for route in ...)`** is `routes.some(...)`; the expression inside the brackets is a generator, evaluated lazily, so `any` stops at the first match.
- **`assert isinstance(exc, ProblemError)`**: Starlette types every handler's argument as plain `Exception`; the assert narrows it for mypy (and documents the assumption).
- **`raise exc`** in the integrity handler: anything other than a unique violation isn't ours to explain, so it continues as an unhandled error and the middleware's 500 catches it.

> **🧠 DSA & scalability · Computing `Allow` by asking the router**
> - **Data structure:** the app's list of routes, each with a compiled path regex and a method set (in memory, built once at startup).
> - **Algorithm:** for each of 6 methods, copy the request scope with that method and ask each route `matches()`; collect the methods with a full match.
> - **Complexity:** O(6 × routes) regex matches, about 300 for this app, and only on the 404/405 error path. Successful requests never pay it.
> - **Why it scales:** it reads the same routing table the router uses, so it can't drift from the real routes (a hand-kept list would), and there's no shared state.
> - **Alternatives rejected:** trusting Starlette's `Allow` (incomplete when one path has several routes); a route table built at startup (NestJS's approach: correct, but more code to keep in sync).

**✅ Checkpoint**

```bash
uv run mypy .
uv run ruff check .
```

Expected: `Success: no issues found in 26 source files` and `All checks passed!`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: problem exception handlers with 404, 405 and conflicts`

### Step 3.5 · Postgres and Redis as resources, dependencies, and health checks

**Goal:** the database engine and the Redis client, opened once at startup and closed at shutdown, handed to route functions through **dependencies**; then the two health endpoints, the first routes that use them.

**Files:** `app/db/session.py`, `app/infra/__init__.py`, `app/infra/resources.py`, `app/deps.py`, `app/health/__init__.py`, `app/health/router.py`

```bash
uv add --bounds exact redis==8.1.0
mkdir app/infra app/health && touch app/infra/__init__.py app/health/__init__.py
```

- **redis-py** is the official Redis client; `redis.asyncio` is its async API (ioredis's role in Node).

@copy app/infra/__init__.py
@copy app/health/__init__.py

@show app/db/session.py all

**What's new (TS → SQLAlchemy sessions)**
- **The engine** owns the connection pool (`pool_size=10`, `pool_pre_ping` tests a connection before handing it out, so a Postgres restart doesn't surface as errors). One engine per process.
- **A session** is SQLAlchemy's **unit of work**: you load objects through it, change them, add new ones, and `commit()` writes everything in one transaction. It borrows a connection from the pool only while a transaction is open. `async_sessionmaker(engine)` is a factory: call it to get a new session. TypeORM's `EntityManager` is the closest relative.
- **`expire_on_commit=False`**: by default a session forgets loaded values after commit and reloads them on the next access. That reload would be an implicit query, which async code can't do, so objects stay readable after commit.

@show app/infra/resources.py 1-12

@show app/infra/resources.py 16-25

@show app/infra/resources.py 28-34

@show app/infra/resources.py 36-41

@show app/infra/resources.py 44-45

@show app/infra/resources.py 47-48

**What's new (TS → Python)**
- **`@dataclass(frozen=True, slots=True)`** generates `__init__`, `__repr__` and `__eq__` from the annotated fields: a typed, immutable record in a few lines, like a TS `readonly` interface plus its constructor ([primer §7](../../docs/python-for-ts-devs.md#7-classes-dataclasses-protocols-enums)). Models that come from *outside* (requests, config) use Pydantic; data you build yourself uses dataclasses, which don't validate.
- **`@asynccontextmanager` + `yield`** turns a function into an **async context manager**: the code before `yield` runs on enter (open the pools), the yielded value is what `async with ... as resources` receives, and the `finally:` after it runs on exit (close them), even if the app crashed. One function holds both halves of a resource's life, where Nest needed a provider plus an `onApplicationShutdown` hook.
- **`decode_responses=True`**: Redis returns bytes by default (Python keeps `bytes` and `str` strictly apart); this makes every reply a `str`.
- `Resources` grows a field in Part 5 (the job queue) and Part 9 (S3 storage).

@show app/deps.py 1-13

@show app/deps.py 16-33

@show app/deps.py 42-51

**What's new (TS → FastAPI dependencies)**
- **A dependency is a function FastAPI calls for you, and passes the result in.** A route function declares a parameter `session: SessionDep`, and FastAPI sees `Depends(get_session)` in its type, calls `get_session(...)`, and passes the session. Dependencies can have dependencies: `get_session` asks for `ResourcesDep`, which asks for the connection. FastAPI resolves the graph per request, **caching each dependency for the request**, so two services that both ask for a session in one request get *the same session*. This is FastAPI's whole DI system: no container, no modules, just function signatures. (NestJS: the container + `@Inject()`; Express: `req.something` set by a middleware.)
- **`Annotated[AsyncSession, Depends(get_session)]`** bundles the type (for mypy and your editor) and the provider (for FastAPI) into one reusable name. Writing `SessionDep` instead of `Annotated[...]` in every signature is the FastAPI docs' recommended style.
- **A dependency with `yield`** gets setup and teardown: FastAPI runs it up to `yield`, injects the session, runs the route, then resumes after `yield`, where `async with` closes the session and **rolls back anything uncommitted**. If the route raises, the rollback still happens.
- **`HTTPConnection`** is the common parent of `Request` and `WebSocket`, so `get_resources` works for both kinds of route. `conn.app.state` is where the lifespan (next step) puts things; `cast(Resources, ...)` tells mypy the type of that untyped attribute without changing anything at run time, TS's `as Resources`.

@show app/health/router.py all

**What's new**
- **`APIRouter(prefix="/health")`** groups routes, like `express.Router()`; `main.py` includes it in the app (next step). **`@router.get("/live")`** registers the decorated function as the handler for `GET /health/live`.
- **The return type is the response schema.** `-> Liveness` tells FastAPI to validate the returned object against `Liveness` and serialise it. The same annotation documents the response in the generated OpenAPI. A route function is a plain function with typed parameters: FastAPI reads the types to decide what to inject.
- **`response: Response`** asks FastAPI for the response object, here only to set the status code (503 when a dependency is down).
- **`asyncio.gather(a, b)`** runs both probes concurrently, `Promise.all`. **`asyncio.timeout(1)`** cancels the probe after one second; leaving the block early raises `TimeoutError`, which the `except` turns into `"unavailable"`. The parameter is an `Awaitable`: the probe is created by the caller (`redis.ping()` without `await`) and awaited inside the timeout.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 32 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: database and redis resources, dependencies and health checks`

### Step 3.6 · The app factory, the lifespan and the docs

**Goal:** `create_app()`, which assembles middleware, exception handlers and routers and opens the resources at startup; a module-level `app` for uvicorn; and the dev server with Swagger UI.

**Files:** `app/main.py`, `pyproject.toml`

```bash
uv add --dev --bounds exact fastapi-cli==0.0.34
```

- **fastapi-cli** gives you `fastapi dev`: uvicorn with auto-reload and a nicer banner, the `tsx watch` of this repo. Production runs uvicorn directly (Part 13).

@show app/main.py 1-4

@show app/main.py 7-9

@show app/main.py 15-22

@show app/main.py 31-46

@show app/main.py 48-74

@show app/main.py 92-95

**What's new (TS → FastAPI)**
- **An app factory.** `create_app()` builds a complete, independent application; `app = create_app()` at the bottom is the instance uvicorn imports (`app.main:app` means "the `app` attribute of the module `app.main`"). Tests (next step, and Part 10) call `create_app()` to get apps of their own.
- **The lifespan** is an async context manager FastAPI enters at startup and exits at shutdown: before `yield` = startup, after = shutdown. **`AsyncExitStack`** is a stack of context managers you enter one by one: on exit (or if a later one fails during startup) it closes them **in reverse order**. Part 10 adds the WebSocket hub to the stack with one line.
- **A function defined inside a function** (`lifespan`) can use the outer function's variables (`settings`): a closure, as in JS.
- **Middleware order:** `add_middleware` *wraps* the current app, so **the last one added runs first**: request context (outermost, so even CORS preflights get an id) → CORS → body guard → routes. `CORSMiddleware` implements the contract's CORS rules: one exact origin, credentials, the exposed headers, a 10-minute preflight cache.
- **Docs only outside production:** `docs_url=None` disables Swagger UI. FastAPI builds the OpenAPI document from your routes' type annotations; it documents *this* implementation, while `contract/openapi.yaml` stays the source of truth (Part 12 checks one against the other).
- **`settings or get_settings()`**: tests may pass their own settings; otherwise the environment's. `API_PREFIX` is used from Part 4.

Tell the FastAPI CLI where the app is:

@excerpt pyproject.toml 75-76 | add at the end

**✅ Checkpoint**

```bash
docker compose up -d
uv run --env-file .env fastapi dev
```

`--env-file .env` loads `.env` into the environment, so the CLI reads `PORT=8004` from it. In a second terminal:

```bash
curl -s localhost:8004/health/ready
curl -s -i -X POST localhost:8004/health/live | grep -iE '^(HTTP|allow|x-request-id)'
```

Expected:

```text
{"status":"ok","checks":{"database":"ok","redis":"ok"}}
HTTP/1.1 405 Method Not Allowed
allow: GET
x-request-id: 01a1d8dc-…
```

Then open http://localhost:8004/docs: Swagger UI lists the two health routes, generated from your code. Stop the server with Ctrl+C.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: app factory with lifespan, middleware and docs`

### Step 3.7 · The test harness

**Goal:** tests that run the real application against real Postgres and Redis, on their own database, with an HTTP client wired straight to the app.

**Files:** `tests/conftest.py`, `tests/helpers.py`, `tests/test_health.py`

```bash
uv add --dev --bounds exact httpx==0.28.1
```

- **httpx** is an HTTP client (`fetch`/axios) with an **ASGI transport**: requests go straight into the app object in memory, no port, no network. It's Supertest's role.

@show tests/conftest.py 1-6

@show tests/conftest.py 8-10

@show tests/conftest.py 12-48

@show tests/conftest.py 63-66

@show tests/conftest.py 69-90

**What's new (TS → pytest)**
- **`conftest.py`** is a file pytest loads automatically before the tests in its folder: shared fixtures and hooks live here (Vitest's `setupFiles` + `globalSetup`).
- **The environment is changed before the app is imported.** `os.environ |= {...}` points the tests at the `taskflow_test` database and Redis database 1, so they never touch your dev data. `get_settings.cache_clear()` forgets any cached settings. The app imports come *after* this, hence the `# noqa: E402` ("import not at top of file"), with the reason.
- **`pytest_sessionstart`** is a **hook**: a function with a name pytest knows, called once before any test. It creates the test database if needed (`CREATE DATABASE` can't run inside a transaction, hence `AUTOCOMMIT`) and runs the migrations with Alembic's Python API (`command.upgrade`), so the test schema is always the migrated one.
- **Fixtures** are pytest's dependency injection: a test that declares a parameter named `client` gets the value of the fixture function named `client`. **`scope="session"`** creates it once per test run; the default is once per test. A fixture with `yield` runs its setup, hands over the value, and runs the rest as teardown. Fixtures can ask for other fixtures, just like FastAPI dependencies.
- **`app`** builds the real application and enters its lifespan (`application.router.lifespan_context(application)`), so the pools are opened exactly as in production, once for the whole run. **`client`** resets the data, then yields an httpx client on the ASGI transport.

@show tests/helpers.py 1-2

@show tests/helpers.py 7-8

@show tests/helpers.py 10-14

@show tests/helpers.py 16-16

@show tests/helpers.py 18-67

**What's new**
- `TRUNCATE ... CASCADE` empties every table in one statement, and `flushdb` empties Redis database 1: each test starts clean.
- **`@property def auth(self)`** again, on a frozen dataclass: `user.auth` is the `Authorization` header dict.
- **`send(...)`** is the one helper every request goes through, the same shape as in the other TaskFlow test suites. Parameters after a bare **`*`** are **keyword-only** (`send(client, "GET", url, status=200)`, never positionally), and **`**kwargs`** collects any other keyword arguments (`json=`, `content=`, `params=`) and passes them on to httpx unchanged. `{**a, **b}` merges two dicts.

@show tests/test_health.py all

**What's new**
- **`async def test_...(client: AsyncClient)`**: the parameter name `client` requests the fixture; the type annotation is for you and mypy. pytest-asyncio runs the test on the session's event loop.
- **`res.json() | {"detail": None}`** overwrites one key before comparing, so the assertion ignores the detail text. **`res.headers`** is case-insensitive, as in Node.
- The 405 test expects `Allow: GET`. Express also answers `HEAD` for every `GET` route, so its tests expected `GET, HEAD`; FastAPI doesn't, and `Allow` lists only methods that are really served.

**✅ Checkpoint**

```bash
docker compose up -d
uv run pytest
```

Expected: `11 passed` (the two config tests, the three unit tests and the six health tests). The first run creates and migrates `taskflow_test`; you'll see Alembic's `Running upgrade  -> 0001, init` once.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `test: pytest harness with real postgres and redis`

---
