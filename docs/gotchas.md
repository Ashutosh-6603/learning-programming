# Gotchas: traps for TypeScript developers

Things that behave differently from what your TS/Node instincts expect. Each entry gives the **symptom**, the **why**, and the **fix**. The STEPS.md guides link here when a trap first shows up. Add new entries as you hit them.

Every ` ```python ` / ` ```java ` block here is runnable, and the `# →` / `// →` comments show the real output (Python 3.14.4, Java 25.0.4.1).

Contents: [Node / npm / Prisma / Express](#node--npm--prisma--express) · [Python](#python) · [FastAPI / SQLAlchemy](#fastapi--sqlalchemy) · [Django](#django) · [Java](#java) · [Spring / JPA](#spring--jpa) · [Maven](#maven) · [React frontends](#react-frontends) · [Across all backends](#across-all-backends) · [WSL / Docker](#wsl--docker)

---

## Node / npm / Prisma / Express

Found while building `taskflow-express` (October 2026: npm 11.17, Prisma 7.10, Express 5.3).

### npm no longer runs dependency install scripts by default

**Symptom:** `npm install` prints `npm warn allow-scripts … prisma@7.10.1 (preinstall: …)`, and a package that needs its install step silently doesn't work.
**Why:** since npm 11.17, `preinstall`/`install`/`postinstall` scripts of dependencies only run once approved. It's a supply-chain defence.
**Fix:** decide per package with `npm approve-scripts <pkg>` or `npm deny-scripts <pkg>`. The decisions are stored under `allowScripts` in `package.json`, so CI and Docker make the same choices. Approve what really needs it (Prisma's engine download, esbuild's binary check). Deny compile-from-source scripts for packages that ship prebuilt binaries (`argon2`), and telemetry (`@scarf/scarf`).

### `npm i prisma` installs a release candidate

npm's `latest` dist-tag for `prisma` currently points to `8.0.0-rc.*`. Always install exact versions (`npm i -D -E prisma@7.10.1`), and check `npm view <pkg> dist-tags` when a major version looks surprising.

### `prisma init` writes more than a schema

It also downloads AI-assistant "skill" files into `.agents/`, `.claude/` and `.windsurf/` (pass `--no-skills`), names the config `prisma7.config.ts` (Prisma also reads `prisma.config.ts`), and rewrites `.env`.

### The Prisma CLI sneaks into production images

`@prisma/client` declares `prisma` and `typescript` as *optional peer dependencies*. When `prisma` is also your devDependency, the lockfile marks it `devOptional`, and `npm ci --omit=dev` **keeps** it, which adds ~330 MB (CLI, TypeScript, Studio). Use `npm ci --omit=dev --omit=optional`, after checking that none of your *production* optional dependencies are needed.

### `DeprecationWarning: Calling client.query() when the client is already executing a query`

It comes from inside `@prisma/adapter-pg` 7.10 (parallel nested reads on a transaction's connection), not from your code. It's harmless with `pg` 8 and will matter for `pg` 9. Watch the Prisma release notes.

### Express answers unknown methods with 404, not 405

FastAPI, Django and Spring return `405 Method Not Allowed` + `Allow` automatically. Express doesn't. Chain a catch-all on each route: `router.route('/x').get(…).post(…).all(methodNotAllowed)`, and read `req.route.methods` to build `Allow`. Schemathesis flags this (check ST204).

### `express.json()` ignores non-JSON bodies

With the wrong `Content-Type`, `req.body` is just `undefined` and validation reports missing fields (422). If the contract says 415, check `req.is('application/json')` yourself.

### ioredis 6 types want strings for scores and ranges

`zremrangebyscore(key, '-inf', String(ts))` and `zrange(key, '0', '-1')`: numbers no longer type-check. They're sent as strings anyway.

---

## Python

### Mutable default arguments

**Symptom:** a function "remembers" values from previous calls.
**Why:** default values are evaluated **once, when the function is defined**, not on each call. In JS they're evaluated on every call.

```python
def add_tag_bad(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags


print(add_tag_bad("a"), add_tag_bad("b"))      # → ['a', 'b'] ['a', 'b']   (same list both times!)


def add_tag(tag: str, tags: list[str] | None = None) -> list[str]:
    tags = [] if tags is None else tags         # fix: default to None and create the list inside
    tags.append(tag)
    return tags


print(add_tag("a"), add_tag("b"))              # → ['a'] ['b']
```

For dataclass fields, use `field(default_factory=list)`. Pydantic copies defaults for you, so `tags: list[str] = []` is safe in a `BaseModel`.

### Closures in loops capture the variable, not the value

```python
from collections.abc import Callable

handlers: list[Callable[[], int]] = [lambda: i for i in range(3)]
print([h() for h in handlers])                 # → [2, 2, 2]   (all closures see the final i)

def make_handler(i: int) -> Callable[[], int]:  # fix: a factory gives each closure its own `i`
    return lambda: i                            # (the `lambda i=i: i` default-argument trick also works)


handlers = [make_handler(i) for i in range(3)]
print([h() for h in handlers])                 # → [0, 1, 2]
```

In JS, `let` in a `for` loop creates a new binding on every iteration. Python's loop variable is a single variable that keeps getting reassigned, which is how `var` behaves.

### Empty collections are falsy, and `0` vs `None`

`[]`, `{}`, `set()`, `""` and `0` are all falsy. In JS, `[]` and `{}` are truthy. The real trap is `if not value:` when `0` or `""` are valid values:

```python
def page_size(limit: int | None) -> int:
    return limit or 20                          # BUG: limit=0 becomes 20


def page_size_fixed(limit: int | None) -> int:
    return 20 if limit is None else limit       # fix: test for None explicitly


print(page_size(0), page_size_fixed(0))         # → 20 0
```

(`??` doesn't exist in Python, and `or` behaves like `||`, not like `??`.)

### No implicit type coercion

```python
try:
    print("count: " + 3)                       # type: ignore[operator]
except TypeError as e:
    print(e)                                   # → can only concatenate str (not "int") to str
print("count: " + str(3), f"count: {3}")       # → count: 3 count: 3
# no coercion and no `==` vs `===` split; mypy strict even flags this line as a bug:
print("5" == 5)  # type: ignore[comparison-overlap]
# → False
```

### `round()` uses banker's rounding

```python
from decimal import ROUND_HALF_UP, Decimal

print(round(0.5), round(1.5), round(2.5))      # → 0 2 2   (ties round to the even number)
print(Decimal("2.5").quantize(Decimal("1"), rounding=ROUND_HALF_UP))   # → 3
print(0.1 + 0.2 == 0.3, Decimal("0.1") + Decimal("0.2") == Decimal("0.3"))   # → False True
```

JS `Math.round(2.5)` is `3`. For money (Cartly), always use `Decimal` built from **strings**, and pick the rounding mode explicitly.

### One-element tuples and stray trailing commas

```python
not_a_tuple = (1)
a_tuple = (1,)
oops = 42,                                      # the trailing comma makes this a tuple!
print(type(not_a_tuple).__name__, type(a_tuple).__name__, oops)   # → int tuple (42,)
```

### `[[0] * 3] * 3` shares the inner list

```python
grid = [[0] * 3] * 3
grid[0][0] = 1
print(grid)                                     # → [[1, 0, 0], [1, 0, 0], [1, 0, 0]]
grid = [[0] * 3 for _ in range(3)]              # fix: a comprehension builds 3 separate lists
grid[0][0] = 1
print(grid)                                     # → [[1, 0, 0], [0, 0, 0], [0, 0, 0]]
```

### Shadowing built-ins and standard-library modules

- Naming a variable `id`, `type`, `list`, `input` or `filter` hides the built-in for the rest of that scope. Ruff's `A` rules flag this, which is why our models use `task_id` in function parameters.
- Naming a file `json.py`, `redis.py`, `celery.py` (outside the project package) or `test.py` makes `import json` find **your file** instead of the library. The symptom is `AttributeError: module 'redis' has no attribute 'Redis'`.

### Circular imports

**Symptom:** `ImportError: cannot import name 'X' from partially initialized module 'app.y' (most likely due to a circular import)`.
**Why:** a module's code runs top to bottom on its first import. If `a.py` imports `b.py` and `b.py` imports a name from `a.py` before `a.py` has finished defining it, the name doesn't exist yet. ESM resolves some cycles through live bindings. Python doesn't.
**Fix:** move shared types into a lower-level module (`app/models.py`, `app/schemas.py`) that imports nothing above it. If a name is only needed for type hints, import it under `if TYPE_CHECKING:` (and since Python 3.14's lazy annotations, you don't need to quote it).

### Forgetting `await` creates a coroutine that never runs

```python
import asyncio
import warnings

warnings.simplefilter("always")


async def save() -> str:
    return "saved"


async def main() -> None:
    result = save()                                # forgot await: nothing ran!
    print(type(result).__name__)                   # → coroutine
    del result                                     # → RuntimeWarning: coroutine 'save' was never awaited
    print(await save())                            # → saved


asyncio.run(main())
```

In JS, a forgotten `await` still *runs* the work and just leaks a Promise. In Python, **nothing happens at all**. mypy strict catches most of these (`Value of type "Coroutine[...]" must be used`).

### Blocking calls inside `async def` freeze everything

```python
import asyncio
import time


async def bad() -> None:
    time.sleep(0.2)                   # blocks the whole event loop: nothing else can run


async def good() -> None:
    await asyncio.sleep(0.2)          # yields to the event loop while waiting


async def measure(fn: object) -> float:
    start = time.perf_counter()
    await asyncio.gather(*(fn() for _ in range(5)))    # type: ignore[operator]
    return round(time.perf_counter() - start, 1)


print(asyncio.run(measure(bad)), asyncio.run(measure(good)))   # → 1.0 0.2
```

Common blockers: `time.sleep`, `requests`, `psycopg2`, plain `redis.Redis`, `boto3`, CPU-heavy loops. Use the async library, or `await asyncio.to_thread(blocking_fn, ...)`.

### Naive vs aware datetimes

```python
from datetime import UTC, datetime

aware = datetime.now(UTC)                       # ✓ has tzinfo
naive = datetime(2026, 10, 25, 12, 0)           # ✗ no tzinfo: "12:00 somewhere"
try:
    print(aware > naive)
except TypeError as e:
    print(e)                                    # → can't compare offset-naive and offset-aware datetimes
print(datetime.fromisoformat("2026-10-25T12:00:00Z").tzinfo)   # → UTC
```

`datetime.utcnow()` is deprecated: it returns a *naive* datetime that only pretends to be UTC. Always use `datetime.now(UTC)`. Also see [timestamp formats](#timestamps-z-vs-0000) below.

---

## FastAPI / SQLAlchemy

### `async def` vs `def` endpoints

FastAPI runs `async def` endpoints **on the event loop** and plain `def` endpoints **in a thread pool**. A blocking call inside `async def` stalls every request on that worker. Rule: `async def` only when everything you call inside is awaited.

### Lazy loading raises `MissingGreenlet` in async SQLAlchemy

**Symptom:** `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called` when you access `task.comments`.
**Why:** a lazy relationship load would need hidden synchronous I/O, which async SQLAlchemy can't do implicitly.
**Fix:** load relationships eagerly in the query (`selectinload(Task.comments)`), and create the session with `expire_on_commit=False` so attributes stay readable after a commit.

### Response models silently drop fields

When an endpoint declares `response_model=TaskOut`, FastAPI **filters** the returned object down to `TaskOut`'s fields. That's good for not leaking `password_hash`. But a field missing from `TaskOut` just disappears, with no error. The Schemathesis contract test catches this.

### A `Literal` column type becomes a Postgres `ENUM`

`role: Mapped[Literal["owner", "admin"]]` with no column type makes SQLAlchemy create a native Postgres `ENUM` type. To keep `text` + `CHECK` (the TaskFlow schema), name the type: `mapped_column(Text)`. The annotation then only says "not nullable".

### `model_dump()` keys follow `serialize_by_alias`

With `serialize_by_alias=True` in a model's config, `model_dump()` returns **camelCase** keys, and `setattr(row, key, value)` for a PATCH silently sets attributes the ORM ignores. taskflow-fastapi leaves the setting off (FastAPI serialises responses by alias anyway) and passes `by_alias=True` where it writes JSON itself.

### Lax mode converts more than you expect

Pydantic's default mode accepts `"5"` for an `int` and `1700000000` for a `datetime`. For JSON bodies, refuse strings with a `BeforeValidator`, but don't switch to `strict=True` for ints: strict also refuses `5.0`, which JSON Schema (and the contract fuzzer) calls an integer. Use `AwareDatetime` so a timestamp without an offset is refused.

### `EmailStr` refuses reserved domains

Pydantic's `EmailStr` delegates to `email-validator`, which rejects special-use domains (`.test`, `.local`, `.localhost`) even with deliverability checks off. If the contract only says `format: email`, a fuzzer will send such addresses and expect them to be accepted. taskflow-fastapi checks syntax with the WHATWG pattern browsers use.

### Starlette's `Allow` header lists only one route's methods

`GET /x` and `POST /x` are two routes; a `PUT /x` gets a 405 whose `Allow` names only the first route's methods. Since FastAPI 0.162, `app.routes` also no longer lists the routes of included routers (they stay nested), so walking it finds nothing. Ask the router instead: `route.matches({**scope, "method": m})` returns `Match.FULL` for each method some route serves.

### structlog tracebacks include local variables

`structlog.processors.dict_tracebacks` renders each frame's local variables by default, so an exception in a login handler can write a password into the log. Use `ExceptionRenderer(ExceptionDictTransformer(show_locals=False))`.

### uvicorn closes WebSockets with 1012 before your shutdown code runs

On `SIGTERM`, uvicorn closes open WebSocket connections itself with code 1012 ("service restart"), then runs the app's lifespan shutdown. Code there that sends 1001 finds the sockets already closed. Clients should treat 1001 and 1012 alike: reconnect.

### Celery tasks are synchronous, and event loops can't cross a fork

A Celery task is a plain function. To run async code, keep one `asyncio.Runner` per worker process and create it, and the pools, **lazily in the child**: Celery's prefork pool forks workers from a parent, and a loop or socket created before the fork is broken after it. `asyncio.run()` per task works but builds and tears down the database pool every time.

### botocore adds checksums to presigned uploads

Recent botocore versions add CRC32 checksum parameters to presigned `PutObject` URLs, which a browser can't satisfy, so its upload fails. Create the client with `Config(request_checksum_calculation="when_required", response_checksum_validation="when_required")`.

---

## Django

### N+1 queries: querysets are lazy

`for task in Task.objects.all(): task.assignee.name` runs **1 + N** queries. Use `select_related("assignee")` (SQL JOIN, for foreign keys) or `prefetch_related("tags")` (a second query, for many-to-many and reverse relations). `django-debug-toolbar` or `assertNumQueries` in tests catch it. Spring/JPA has the same trap ([below](#n1-queries-and-lazyinitializationexception)).

### The ORM is synchronous

Calling the ORM from `async def` code (Channels consumers, async views) raises `SynchronousOnlyOperation`. Use the async variants (`await Task.objects.aget(...)`, `async for t in qs`) or wrap the call in `sync_to_async`.

### A new app's models are invisible

If `makemigrations` says *No changes detected*, the app is probably missing from `INSTALLED_APPS`. Django only discovers models in registered apps.

### Migrations are code: commit them

Django generates migration files, and **you commit them**. CI runs `makemigrations --check` to fail when a model changed without a migration. Never edit an applied migration. Create a new one instead.

---

## Java

### `==` compares references for objects

```java
void main() {
    String a = "task", b = new String("task");
    System.out.println((a == b) + " " + a.equals(b));      // → false true

    Integer x = 127, y = 127, p = 128, q = 128;
    System.out.println((x == y) + " " + (p == q));         // → true false   (-128..127 are cached!)
    System.out.println(p.equals(q));                       // → true
}
```

The `Integer` cache makes `==` *appear* to work in small tests and then fail in production. Always use `.equals()` (or `Objects.equals(a, b)`, which is null-safe) for objects.

### Unboxing `null` throws

```java
import java.util.Map;

void main() {
    Map<String, Integer> points = Map.of("t1", 3);
    Integer boxed = points.get("t2");          // null: the key is missing
    try {
        int value = boxed;                     // auto-unboxing null → NullPointerException
        System.out.println(value);
    } catch (NullPointerException e) {
        System.out.println("NPE: " + e.getMessage());
        // → NPE: Cannot invoke "java.lang.Integer.intValue()" because "<local2>" is null
        //   (Maven builds keep debug info, so there the message names the variable: "boxed")
    }
}
```

### Silent integer overflow and integer division

```java
void main() {
    int big = Integer.MAX_VALUE;
    System.out.println(big + 1);                       // → -2147483648
    long millis = 30 * 24 * 60 * 60 * 1000;            // computed as int first, THEN widened
    System.out.println(millis);                        // → -1702967296
    long fixed = 30L * 24 * 60 * 60 * 1000;            // make the first operand a long
    System.out.println(fixed + " " + (5 / 2) + " " + (5 / 2.0));   // → 2592000000 2 2.5
}
```

### `BigDecimal`: `equals` checks the scale, and never construct one from a double

```java
import java.math.BigDecimal;
import java.math.RoundingMode;

void main() {
    var a = new BigDecimal("1.0");
    var b = new BigDecimal("1.00");
    System.out.println(a.equals(b) + " " + (a.compareTo(b) == 0));   // → false true
    System.out.println(new BigDecimal(0.1));         // → 0.1000000000000000055511151231257827021181583404541015625
    System.out.println(new BigDecimal("0.1"));       // → 0.1
    System.out.println(new BigDecimal("10").divide(new BigDecimal("3"), 2, RoundingMode.HALF_UP));  // → 3.33
}
```

Compare money with `compareTo`. `divide` without a scale throws `ArithmeticException` for repeating decimals.

### `String.split` takes a regex

```java
void main() {
    System.out.println("a.b.c".split(".").length);             // → 0    ("." matches every character!)
    System.out.println("a.b.c".split("\\.").length);           // → 3
    System.out.println("a,b,,".split(",").length);             // → 2    (trailing empty strings are dropped)
}
```

### Immutable collections and their limits

```java
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

void main() {
    try {
        List.of("a").add("b");
    } catch (UnsupportedOperationException e) {
        System.out.println("List.of is immutable");          // → List.of is immutable
    }
    try {
        List.of("a", null);
    } catch (NullPointerException e) {
        System.out.println("List.of rejects null");          // → List.of rejects null
    }
    var tasks = new ArrayList<>(List.of("a", "b", "c"));
    try {
        for (String t : tasks) if (t.equals("a")) tasks.remove(t);
    } catch (java.util.ConcurrentModificationException e) {
        System.out.println("can't remove while iterating");  // → can't remove while iterating
    }
    var fresh = new ArrayList<>(List.of("a", "b", "c"));
    fresh.removeIf(t -> t.equals("a"));                      // fix: removeIf (or an explicit Iterator)
    System.out.println(fresh + " " + Map.of("k", 1));        // → [b, c] {k=1}
}
```

Removing inside a for-each loop doesn't *always* throw. Removing the second-to-last element happens to end the loop early without the check firing, so the bug can hide in tests. `Map.of` accepts at most 10 key/value pairs. Beyond that, use `Map.ofEntries(Map.entry(k, v), ...)`.

### `equals` without `hashCode` breaks `HashSet` / `HashMap`

If you override `equals`, you **must** override `hashCode` too, or two "equal" objects land in different hash buckets. Records generate both correctly, which is one more reason to use them for value types. JPA entities are the exception ([below](#entity-equality)).

### Checked exceptions inside lambdas don't compile

`list.forEach(p -> Files.readString(p))` fails with *unreported exception IOException*, because `Consumer.accept` doesn't declare `throws IOException`. Fix: catch the exception inside the lambda and rethrow it as `UncheckedIOException`, or use a plain `for` loop.

### Compact source files make classes *inner* classes

In a compact `void main()` file (handy for experiments, see [java-for-ts-devs.md](java-for-ts-devs.md#2-hello-world-classic-and-compact)), top-level `class` declarations become inner classes of the implicit class. A `static` method inside one of them that does `new OtherClass()` fails with *non-static variable this cannot be referenced from a static context*. Records, enums and interfaces are implicitly static and unaffected. Real projects use normal files, so this only bites in scratch files.

---

## Spring / JPA

### `@Transactional` is ignored on self-calls

**Symptom:** a method annotated `@Transactional` doesn't roll back.
**Why:** Spring implements `@Transactional` with a **proxy** wrapped around your bean. Calling `this.otherMethod()` from inside the same class bypasses the proxy, so no transaction is started. It also only applies to `public` methods called from *another* bean.
**Fix:** put the transactional boundary on the public service method that the controller calls, or move the inner method into a separate bean.

### N+1 queries and `LazyInitializationException`

JPA relationships (`@OneToMany`, and `@ManyToOne` when you set `fetch = LAZY`, which we always do) load on first access. Touching them outside a transaction throws `LazyInitializationException`. Touching them in a loop inside one triggers N+1 queries.
**Fix:** fetch what the endpoint needs in the query itself (`JOIN FETCH` in JPQL, or `@EntityGraph`), and map to DTO records inside the service's transaction.
We set **`spring.jpa.open-in-view: false`**. Spring Boot enables it by default (and logs a warning about it), which keeps the DB session open through the whole web request and hides these bugs until production.

### Entity equality

JPA entities are **mutable classes, not records**: Hibernate needs a no-arg constructor and settable fields. Don't base `equals`/`hashCode` on a database-generated ID (it's `null` before persisting). Either use an application-assigned UUIDv7 ID (our approach) or keep the default identity equality.

### Singleton beans are shared across threads

A `@Service` exists once and is used by every request thread at the same time. A mutable field such as `private List<String> recent = new ArrayList<>()` is a data race. Keep beans stateless, and put per-request state in method locals.

### Field injection hides dependencies

`@Autowired private TaskRepository repo;` works, but it can't be `final`, hides the dependency from the constructor, and makes unit tests need Spring or reflection. We use **constructor injection only**. With exactly one constructor, Spring doesn't need `@Autowired` at all.

### The Mockito "self-attaching" warning in test output

```text
Mockito is currently self-attaching to enable the inline-mock-maker. This will no longer work in future releases of the JDK.
WARNING: A Java agent has been loaded dynamically (.../byte-buddy-agent-....jar)
```

This shows up in the test output of a freshly generated Spring Boot 4.1 project on Java 25. It's **harmless today**. The JDK is phasing out dynamic agent loading, and the long-term fix is to configure Mockito as a `-javaagent` in Surefire. The Spring repo's STEPS.md will cover it if it hasn't been fixed upstream by then.

---

## Maven

### Tests that are silently skipped

Surefire only runs test classes whose names match `Test*`, `*Test`, `*Tests` or `*TestCase`. A class named `TaskSpec` or `TaskChecks` compiles fine and **never runs**. Integration tests named `*IT` run under Failsafe in the `verify` phase, not under `test`.

### `./mvnw: Permission denied` or `/bin/sh^M: bad interpreter`

The executable bit or the line endings got lost, usually through a Windows checkout or a zip download. Initializr ships a `.gitattributes` that prevents the line-ending problem:

```text
/mvnw text eol=lf
*.cmd text eol=crlf
```

Fix the executable bit with `chmod +x mvnw && git update-index --chmod=+x mvnw`.

### Running `mvn` instead of `./mvnw`

A globally installed `mvn` might be a different version than the one the project pins. Always use `./mvnw`.

### `NoSuchMethodError` / `ClassNotFoundException` at runtime

Two dependencies wanted different versions of the same library, and the classpath can hold only one. See [java-build-tools.md §8](java-build-tools.md#8-transitive-dependencies-and-conflicts). Diagnose with `./mvnw dependency:tree -Dincludes=<group>:<artifact>`.

### Stale build output

If behaviour doesn't match the code (a deleted class still "exists", or a resource change is ignored), run `./mvnw clean verify`. It's the Maven version of `rm -rf dist`.

---

## React frontends

Found while building `taskflow-frontend-node` (October 2026: create-vite 9.3.3, shadcn 4.23.0, React 19.3, Playwright 1.64).

### The Vite React template doesn't install

**Symptom:** `npm install` straight after `npm create vite@9.3.3 … --template react-ts --eslint` fails with `ERESOLVE … peer typescript@">=4.8.4 <6.1.0" from typescript-eslint`.
**Why:** the template pins TypeScript 7, and typescript-eslint doesn't support it yet.
**Fix:** `npm pkg set devDependencies.typescript=6.0.3` *before* the first `npm install`.

### `shadcn add` imports `cn` from a package called `cn`

**Symptom:** generated components say `import { cn } from "cn"`, and `src/lib/utils.ts` is a one-line re-export.
**Why:** shadcn 4.x switched to a tiny `cn` npm package. It does so even when `components.json` says `"utils": "@/lib/utils"`.
**Fix:** keep the classic `clsx` + `tailwind-merge` helper in `src/lib/utils.ts`, `npm uninstall cn`, and `sed -i 's#from "cn"#from "@/lib/utils"#' src/components/ui/*.tsx`. `init` and `add` also install the `shadcn` CLI and a font as dependencies; uninstall what you don't use.

### Clicks miss elements inside nested 3D transforms

**Symptom:** on a CSS-3D-tilted board, clicking some cards does nothing; the `click` lands on the container behind. `document.elementFromPoint(x, y)` still returns the card, so it looks impossible.
**Why:** with nested `transform-style: preserve-3d` layers, Chrome hit-tests *input events* by 3D depth and can disagree with `elementFromPoint`. Animating a `translateZ` on hover makes it worse: the card moves out from under the pointer, loses hover, drops back and flickers.
**Fix:** one 3D transform on the outer plane, everything inside flat (no `preserve-3d`, no `translateZ` on children), and hover effects that don't move the element (glow, border).

### End-to-end clicks miss buttons that are still animating in

**Symptom:** a Playwright click "succeeds" but nothing happens; the trace shows the page mid-entrance-animation.
**Why:** Playwright waits for an element to be stable for two frames, but a long ease-out moves it by sub-pixel amounts per frame, so the click can land where the button *was*.
**Fix:** `use: { contextOptions: { reducedMotion: 'reduce' } }` in `playwright.config.ts`, with the app honoring `prefers-reduced-motion`. Also run E2E against `vite build && vite preview`, not the dev server, whose on-demand dependency optimisation can reload the page during the first visit to a lazy route.

### nginx drops your security headers in some locations

**Symptom:** `X-Frame-Options` and friends are set at `server` level, but missing from responses.
**Why:** a `location` that has *any* `add_header` of its own inherits **none** from the enclosing block.
**Fix:** put the headers in a snippet and `include` it in every location (store it outside `conf.d/`, which the main config auto-includes at `http` level).

### Prettier formats `*.inc` files as HTML

Prettier infers the HTML parser for `.inc` and reflows an nginx snippet into one line. Name nginx snippets `*.conf` (Prettier leaves unknown extensions alone) or add them to `.prettierignore`.

---

## Across all backends

These matter because six backends must produce **byte-for-byte compatible** API responses.

### Take the lock before you read what it protects

A transaction that reads "the last position in this column" and *then* takes a row lock (`UPDATE projects … RETURNING`) computes its value from a snapshot taken before it waited. Ten concurrent creates all saw the same last task and collided. Under READ COMMITTED, each statement sees data committed before *that statement* started, so **lock first, then read**, and every read after the lock sees the previous holder's commit.

### `ts_headline` doesn't escape HTML (and drops tags)

Postgres' text-search parser treats `<b>` as a tag token and leaves it out of the headline, but other text comes back raw. Highlight with control characters (`StartSel=\u0001`), HTML-escape the whole string, then swap the markers for `<mark>`.

### YAML flow mappings split on commas

In `{ type: string, description: Opaque, single-use. }` the comma ends the description, and `single-use.` becomes a *key*. A `: ` inside an unquoted value (`description: Tasks: CRUD`) is a parse error. Quote descriptions in flow mappings. `openapi-spec-validator` missed the first one, and Redocly caught it.

### Big integers lose precision in JavaScript

`Number.MAX_SAFE_INTEGER` is 2⁵³ − 1. A Java `long` or Python `int` ID such as `9007199254740993` arrives in the browser as `9007199254740992`. That's one reason our contract sends **IDs as strings** (UUIDv7) and money as **strings** or integer minor units (cents).

### Timestamps: `Z` vs `+00:00`

```python
from datetime import UTC, datetime

ts = datetime(2026, 10, 25, 12, 0, tzinfo=UTC)
print(ts.isoformat())                                    # → 2026-10-25T12:00:00+00:00
print(ts.isoformat().replace("+00:00", "Z"))             # → 2026-10-25T12:00:00Z
```

Java's `Instant.toString()` and JS's `toISOString()` produce `...Z` (JS always adds milliseconds: `.000Z`). Python produces `+00:00`. All of these are valid ISO-8601 and every parser accepts them, but our contract uses the `Z` form, so the Python backends configure their serialisers to emit it. **Parsing:** always accept both.

### Store `timestamptz`, never `timestamp`

Postgres `timestamp` (without time zone) stores a wall-clock time with no zone, which is the database version of a naive datetime. `timestamptz` stores an absolute instant (normalised to UTC). Use `timestamptz` everywhere. Hibernate maps `Instant` to it, SQLAlchemy needs `DateTime(timezone=True)`, and Django uses it automatically with `USE_TZ = True`.

### camelCase on the wire, native names in code

TS uses `dueDate` everywhere. Python uses `due_date` in code and needs aliasing (Pydantic `alias_generator`, the DRF camel-case renderer/parser). Java fields are already `dueDate`. When you add a field, check it in the JSON with `curl`. Don't trust the code. The Schemathesis contract test is the safety net.

### Error shapes differ by default

Each framework has its own default error body: FastAPI returns `{"detail": ...}`, DRF returns `{"field": ["msg"]}`, and Spring returns its own JSON or problem details. Our contract requires RFC 9457 `application/problem+json` everywhere, so every backend installs a global handler that converts framework errors (including validation errors → **422** with `errors[]`; Spring and DRF default to 400) into that one shape.

---

## WSL / Docker

- **Keep repos on the Linux filesystem** (`~/Projects/...`), never under `/mnt/c/...`. Cross-filesystem I/O is many times slower, and file watchers (hot reload) often miss changes there.
- **Every repo has its own host ports.** Ports are `<service prefix><slot>`, where the slot is the repo's two-digit number (TaskFlow 01–06: express, fastify, nestjs, fastapi, django, springboot; Pulse 11–16; Cartly 21–26): API `80xx`, Postgres `154xx`, Redis `163xx`, S3 `190xx` / console `191xx`, SMTP `110xx` / Mailpit `180xx`. Express is 8001/15401/16301…, Fastify 8002/15402/16302…, so their stacks run side by side. *Bind for 0.0.0.0:154xx failed: port is already allocated* means that same repo's stack is already up (or something else took the port): `docker ps` finds it.
- **Why not the defaults (5432, 6379, 8000…).** Other projects on your machine usually hold them already, and with Docker Desktop a published `5432` can land on the Windows side while a Postgres installed in WSL listens on `127.0.0.1:5432`, so a backend run on the host silently talks to the wrong database. Only the *host* side of each mapping changes (`'15401:5432'`); inside compose and in CI, services keep the defaults (`postgres:5432`, API on 8000).
- **Playwright's Chromium needs system libraries.** On a fresh WSL distro, browsers fail with `libnspr4.so: cannot open shared object file`. Install them with `sudo npx playwright install-deps chromium`, or run the tests in `mcr.microsoft.com/playwright:v<version>-noble` (pass `--user "$(id -u):$(id -g)"` so it doesn't leave root-owned files in your repo).
- **Data from a previous run.** Named volumes survive `docker compose down`. If a migration or seed misbehaves on a fresh setup, `docker compose down -v` wipes that repo's volumes (and only that repo's, thanks to the per-repo `name:`).
- **`pkill -f <pattern>` can kill your own shell.** `-f` matches the full command line, so `bash -c "pkill -f 'src/main.ts'; npx tsx src/main.ts"` matches itself. Kill by PID (`pgrep -f … | xargs kill`) in a separate command, or use a pattern that can't appear in the command.
