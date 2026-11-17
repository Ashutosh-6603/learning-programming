# Python for TypeScript developers

A language tour for someone who already writes TypeScript every day. It covers just enough Python for the FastAPI and Django STEPS.md guides to read like framework lessons rather than syntax lessons.

**Versions:** Python **3.14** · uv **0.12** · mypy **2.4** (checked October 2026).

**How to use this file:** every ` ```python ` block is a complete program. Paste it into `scratch.py` and run `uv run --no-project python scratch.py` (or just `python3 scratch.py`). The `# →` comments show what gets printed. For quick experiments, run `python3` with no arguments to get a REPL, the way `node` does.

Related: [ecosystem.md](ecosystem.md) (npm ↔ uv, libraries) · [gotchas.md](gotchas.md) (traps) · [java-for-ts-devs.md](java-for-ts-devs.md)

---

## Contents

1. [The mental model](#1-the-mental-model)
2. [Syntax basics](#2-syntax-basics)
3. [Types and type hints](#3-types-and-type-hints)
4. [Collections](#4-collections)
5. [Control flow](#5-control-flow)
6. [Functions](#6-functions)
7. [Classes, dataclasses, protocols, enums](#7-classes-dataclasses-protocols-enums)
8. [Modules and packages](#8-modules-and-packages)
9. [Errors](#9-errors)
10. [Context managers (`with`)](#10-context-managers-with)
11. [Iterators and generators](#11-iterators-and-generators)
12. [Async / await](#12-async--await)
13. [Decorators](#13-decorators)
14. [Pydantic: runtime-validated types](#14-pydantic-runtime-validated-types)
15. [Cheat sheet](#15-cheat-sheet)

---

## 1. The mental model

| | TypeScript | Python |
|---|---|---|
| Typing | Static types, **erased** at runtime | Optional type hints, **ignored** by the interpreter but **checked by mypy**. Values still carry real runtime types (`type(x)`). |
| Type checker | `tsc` (part of the build) | `mypy` (a separate tool). We run it in `--strict` mode, the equivalent of `strict: true`. |
| Blocks | `{ }` | **Indentation** (4 spaces). A colon `:` starts a block. |
| "Nothing" | `undefined` and `null` | Only `None` |
| Runtime | V8, single event loop, async by default | CPython interpreter. Code is **synchronous by default**, and async is opt-in (`asyncio`). |
| Numbers | One `number` type (a 64-bit float) | `int` (arbitrary precision, never overflows), `float` (64-bit), `Decimal` (exact decimal) |
| Equality | `===` | `==` (compares values, never coerces types). `is` checks identity, like `===` on objects. |
| Errors | `throw` anything | `raise` an instance of an `Exception` subclass |

**Why indentation?** Python's designer wanted code that looks the same no matter who wrote it. Indentation *is* the syntax, so there's nothing to argue about in reviews. `ruff format` is Python's Prettier.

**Why don't hints affect runtime?** Python started out dynamic. Type hints were added in 2014 (PEP 484) as metadata that tools *may* read. This is like TS, with one important difference: libraries **can read hints at runtime**. FastAPI and Pydantic use them to validate requests (see [§14](#14-pydantic-runtime-validated-types)). In TS you need zod for that, because the types are gone by the time the code runs.

---

## 2. Syntax basics

```python
# Variables: no let/const/var. Assignment creates the variable.
user_name = "Ada"            # snake_case for variables and functions
MAX_RETRIES = 3              # UPPER_CASE = "constant" by convention only

# f-strings are template literals: f"..." instead of `...`
print(f"Hello {user_name}, retries={MAX_RETRIES}")       # → Hello Ada, retries=3
print(f"{3.14159:.2f} | {42:>5} | {user_name!r}")        # → 3.14 |    42 | 'Ada'

# Multi-line strings use triple quotes (like backtick strings without interpolation)
sql = """
SELECT *
FROM tasks
"""

# Booleans are capitalised, and the logical operators are words
is_admin = True
is_owner = False
print(is_admin and not is_owner or False)                # → True

# Blocks: colon + indentation. `pass` is an empty block (like `{}`).
if is_admin:
    print("admin")                                       # → admin
else:
    pass

# Ternary: value_if_true if condition else value_if_false
role = "admin" if is_admin else "member"
print(role)                                              # → admin

# Integer vs float division
print(7 / 2, 7 // 2, 7 % 2, 2 ** 10)                     # → 3.5 3 1 1024
```

What's new compared to TS:
- **No semicolons and no braces.** A statement ends at the end of the line. Inside `()`, `[]` and `{}` you can break lines freely.
- `and` / `or` / `not` replace `&&` / `||` / `!`. They short-circuit and return one of their operands, just as in JS. `x or "default"` works like `x || "default"`.
- `//` is floor division and `**` is exponentiation. Unlike JS, `/` always returns a float, even for `4 / 2`.
- `!r` in an f-string formats the value with `repr()`, its developer-facing form (strings get quotes). It's handy in logs.

---

## 3. Types and type hints

### Primitive mapping

| TypeScript | Python hint | Notes |
|---|---|---|
| `number` (integer) | `int` | Arbitrary precision: `2**100` is exact |
| `number` (fractional) | `float` | IEEE-754 double, same as JS |
| money | `decimal.Decimal` | Never use float for money (Cartly) |
| `string` | `str` | Immutable, Unicode |
| `boolean` | `bool` | `True` / `False` |
| `null` / `undefined` | `None` | `x: int \| None` is like `x?: number` |
| `any` | `typing.Any` | Turns checking off. mypy strict complains about it. |
| `unknown` | `object` | You must narrow before use |
| `never` | `typing.Never` | |
| `void` (return) | `-> None` | |
| `'a' \| 'b'` | `Literal["a", "b"]` | |
| `type X = ...` | `type X = ...` | Same keyword (Python 3.12+) |
| `readonly` | `typing.Final` (variables), frozen dataclass (objects) | |

```python
from typing import Literal

type Priority = Literal["low", "medium", "high"]   # like: type Priority = 'low' | 'medium' | 'high'
type TaskId = str


def describe(task_id: TaskId, priority: Priority, due: str | None = None) -> str:
    # Narrowing works the way it does in TS: after this check mypy knows `due` is str
    if due is None:
        return f"{task_id} [{priority}]"
    return f"{task_id} [{priority}] due {due.upper()}"


print(describe("t1", "high"))                  # → t1 [high]
print(describe("t2", "low", due="friday"))     # → t2 [low] due FRIDAY
print(type(42), type("x"), type(None))         # → <class 'int'> <class 'str'> <class 'NoneType'>
print(isinstance(True, int))                   # → True  (bool is a subclass of int!)
```

- Hints go **after** the name (`name: str`), and the return type follows `->`.
- `x is None` is the idiomatic null check. Don't write `x == None`.
- `isinstance(x, SomeClass)` works like `instanceof`. Because Python classes exist at runtime, `isinstance(x, int)` works too. TS has no equivalent of that for primitives except `typeof`.
- **Forward references are fine.** Since Python 3.14, annotations are evaluated lazily (PEP 649), so a class can mention a type defined further down the file without quoting it. Older code writes `"User"` in quotes or adds `from __future__ import annotations`. You'll see both in tutorials.

### Running mypy

```bash
uv add --dev mypy
uv run mypy --strict .
```

`--strict` turns on everything, including "every function must be annotated" and "no implicit `Any`". It is the closest equivalent of `"strict": true` in `tsconfig.json`. Our repos set it in `pyproject.toml` under `[tool.mypy]`.

---

## 4. Collections

| TypeScript | Python | Mutable? | Literal |
|---|---|---|---|
| `T[]` / `Array<T>` | `list[T]` | yes | `[1, 2, 3]` |
| `readonly [A, B]` (tuple) | `tuple[A, B]`; `tuple[T, ...]` for any length | **no** | `(1, "a")` |
| `Record<K, V>` / `Map<K, V>` | `dict[K, V]` (keeps insertion order, like `Map`) | yes | `{"a": 1}` |
| `Set<T>` | `set[T]` / `frozenset[T]` | yes / no | `{1, 2}` (but `set()` for an empty set) |

```python
tasks: list[str] = ["write spec", "build api"]
tasks.append("ship")                        # push
tasks.insert(0, "plan")                     # unshift-ish
last = tasks.pop()                          # pop() → "ship"
print(len(tasks), tasks)                    # → 3 ['plan', 'write spec', 'build api']

# Slicing: seq[start:stop:step] (stop is exclusive, negatives count from the end)
nums = [0, 1, 2, 3, 4, 5]
print(nums[1:3], nums[-2:], nums[::-1])     # → [1, 2] [4, 5] [5, 4, 3, 2, 1, 0]

# Comprehensions replace .map/.filter chains
squares_of_evens = [n * n for n in nums if n % 2 == 0]
print(squares_of_evens)                     # → [0, 4, 16]
by_len = {t: len(t) for t in tasks}         # dict comprehension
print(by_len["plan"])                       # → 4

# dict access: [] raises KeyError if the key is missing; .get() returns None or a default
user = {"name": "Ada", "role": "admin"}
print(user.get("email"), user.get("email", "n/a"))   # → None n/a
for key, value in user.items():             # Object.entries(user)
    print(key, value)                       # → name Ada / role admin

# Spread: * for sequences, ** for dicts
merged = {**user, "role": "owner"}          # {...user, role: 'owner'}
combined = [*nums[:2], *squares_of_evens]   # [...a, ...b]
print(merged, combined)                     # → {'name': 'Ada', 'role': 'owner'} [0, 1, 0, 4, 16]

# Destructuring is called "unpacking"
first, *rest = nums                         # const [first, ...rest] = nums
x, y = (10, 20)
x, y = y, x                                 # swap without a temp variable
print(first, rest, x, y)                    # → 0 [1, 2, 3, 4, 5] 20 10

# Membership uses `in`, and works for lists, sets, dict keys and substrings
print("admin" in user.values(), "name" in user, "spec" in "write spec")  # → True True True

# Sets
a, b = {1, 2, 3}, {2, 3, 4}
print(a & b, a | b, a - b)                  # → {2, 3} {1, 2, 3, 4} {1}
```

**Complexities you'll use in the DSA boxes:**

| Operation | `list` | `dict` / `set` |
|---|---|---|
| index / `d[k]` | O(1) | O(1) average (hash table) |
| `append` / `pop()` at the end | O(1) amortised | — |
| `insert(0, x)` / `pop(0)` | **O(n)**: use `collections.deque` for queues | — |
| `x in ...` | **O(n)** | **O(1)** average |
| sort | O(n log n) (Timsort, stable) | — |

There's no object-literal-as-type in Python. When you'd write `{ id: string; title: string }` in TS, you use a **dataclass**, a **TypedDict** or a **Pydantic model** instead. See §7 and §14.

---

## 5. Control flow

```python
def classify(n: int) -> str:
    if n < 0:
        return "negative"
    elif n == 0:          # `elif`, not `else if`
        return "zero"
    else:
        return "positive"


print([classify(n) for n in (-1, 0, 5)])   # → ['negative', 'zero', 'positive']

# `for` always iterates over a collection (like for...of). There's no C-style for(;;).
for i in range(3):                       # 0, 1, 2
    print(i, end=" ")                    # → 0 1 2
print()

for index, name in enumerate(["a", "b"]):   # arr.forEach((name, index) => ...)
    print(index, name)                       # → 0 a / 1 b

for name, score in zip(["ann", "bo"], [90, 85]):   # walk two lists in step
    print(f"{name}={score}")                       # → ann=90 / bo=85

# Truthiness: like JS, but EMPTY CONTAINERS ARE FALSY ([] and {} are truthy in JS!)
values: list[object] = [0, "", [], {}, None, "0", [0]]
for value in values:
    print(repr(value), bool(value))
# → 0 False / '' False / [] False / {} False / None False / '0' True / [0] True

# Comparisons can be chained
age = 30
print(18 <= age < 65)                    # → True   (means 18 <= age and age < 65)

# while / break / continue work the way you expect. `for ... else` runs when no break happened:
for n in [3, 5, 7]:
    if n % 2 == 0:
        break
else:
    print("no even numbers")             # → no even numbers
```

### `match` (structural pattern matching)

`match` is much more powerful than JS `switch`. It can destructure values and test their shapes, which makes it a good fit for discriminated unions such as WebSocket envelopes.

```python
def handle(event: dict[str, object]) -> str:
    match event:
        case {"type": "task.created", "payload": {"title": str(title)}}:
            return f"new task: {title}"
        case {"type": "task.deleted", "payload": {"id": task_id}}:
            return f"deleted {task_id}"
        case {"type": str(other)}:
            return f"ignored {other}"
        case _:                          # default
            return "malformed"


print(handle({"type": "task.created", "payload": {"title": "Ship it"}}))  # → new task: Ship it
print(handle({"type": "task.deleted", "payload": {"id": "t9"}}))          # → deleted t9
print(handle({"type": "presence.join"}))                                  # → ignored presence.join
print(handle({}))                                                         # → malformed
```

Cases are tried from top to bottom and there's no fall-through, so you never write `break`.

---

## 6. Functions

```python
from collections.abc import Callable


# Defaults, plus keyword arguments at the call site
def paginate(items: list[int], limit: int = 20, cursor: int | None = None) -> list[int]:
    start = 0 if cursor is None else cursor
    return items[start : start + limit]


data = list(range(100))
print(paginate(data, 3))                        # → [0, 1, 2]
print(paginate(data, cursor=50, limit=2))       # → [50, 51]   keyword args, in any order


# Parameters after a bare `*` are keyword-only.
# This replaces the TS habit of `fn({ a, b }: Options)` for readable call sites.
def create_user(email: str, *, is_admin: bool = False, send_welcome: bool = True) -> str:
    return f"{email} admin={is_admin} welcome={send_welcome}"


print(create_user("a@x.io", is_admin=True))     # → a@x.io admin=True welcome=True
# create_user("a@x.io", True)                   # TypeError: takes 1 positional argument


# *args / **kwargs: rest parameters for positional and for keyword arguments
def log(event: str, *args: object, **fields: object) -> None:
    print(event, args, fields)


log("login", 1, 2, user="ada", ok=True)         # → login (1, 2) {'user': 'ada', 'ok': True}


# Lambdas are single-expression arrow functions
by_length: Callable[[str], int] = lambda s: len(s)
print(sorted(["ccc", "a", "bb"], key=by_length))          # → ['a', 'bb', 'ccc']
print(sorted(["ccc", "a", "bb"], key=len, reverse=True))  # → ['ccc', 'bb', 'a']


# Generics: square brackets after the name (Python 3.12+), like <T> in TS
def first[T](items: list[T], default: T) -> T:
    return items[0] if items else default


print(first([10, 20], 0), first([], "none"))    # → 10 none


# Closures work the same as in JS, but rebinding an outer variable needs `nonlocal`
def make_counter() -> Callable[[], int]:
    count = 0

    def increment() -> int:
        nonlocal count            # without this, `count += 1` would create a new local
        count += 1
        return count

    return increment


counter = make_counter()
counter()
print(counter())                                # → 2
```

- **Mutable default arguments are a trap.** Never write `def f(items: list[str] = [])`. See [gotchas.md](gotchas.md#mutable-default-arguments).
- Callable types are written `Callable[[ArgTypes], Return]`. `(s: string) => number` becomes `Callable[[str], int]`.
- There's no function overloading by signature. Use defaults, unions, or `@typing.overload` for type-only overloads.

---

## 7. Classes, dataclasses, protocols, enums

### Plain classes

```python
class Account:
    # Class attribute: shared by every instance (like `static`)
    currency = "USD"

    def __init__(self, owner: str, balance: int = 0) -> None:   # the constructor
        self.owner = owner              # instance attributes are created by assigning to self
        self._balance = balance         # leading _ = "private by convention" (not enforced)

    @property                           # a getter: account.balance (no parentheses)
    def balance(self) -> int:
        return self._balance

    def deposit(self, amount: int) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        self._balance += amount

    @classmethod                        # alternative constructor; receives the class as `cls`
    def empty(cls, owner: str) -> "Account":
        return cls(owner)

    @staticmethod                       # plain function namespaced under the class
    def is_valid_owner(owner: str) -> bool:
        return bool(owner.strip())

    def __repr__(self) -> str:          # "dunder" (double-underscore) hook used by print()/repr()
        return f"Account({self.owner!r}, {self._balance})"


class SavingsAccount(Account):          # inheritance: class Child(Parent)
    def __init__(self, owner: str, rate: float) -> None:
        super().__init__(owner)
        self.rate = rate


acc = Account.empty("ada")
acc.deposit(50)
print(acc, acc.balance, Account.currency)                 # → Account('ada', 50) 50 USD
print(SavingsAccount("bo", 0.02), Account.is_valid_owner(" "))  # → Account('bo', 0) False
```

What's new compared to TS:
- **`self` is explicit.** Every method takes the instance as its first parameter, and it's what `this` is in TS. You declare it but never pass it: `acc.deposit(50)` calls `Account.deposit(acc, 50)`. Because it's explicit, `self` never gets "lost" the way `this` does in a detached JS callback.
- **There's no `private` / `protected`.** `_name` signals "internal, don't touch". `__name` triggers name mangling, which is rarely used. Python's motto is "we're all consenting adults here".
- **Dunder methods** let a class plug into the language: `__init__` (constructor), `__repr__` (debug string), `__eq__` (`==`), `__hash__` (dict key), `__len__` (`len()`), `__iter__` (`for` loops), `__enter__`/`__exit__` (`with`). This is how Python does operator overloading, which TS doesn't have.

### Dataclasses: the everyday choice for data

A `@dataclass` generates `__init__`, `__repr__` and `__eq__` from the annotated fields. Think of it as an `interface` that is also a constructor.

```python
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime


@dataclass(frozen=True, slots=True)     # frozen = immutable (readonly), slots = less memory
class Task:
    id: str
    title: str
    tags: list[str] = field(default_factory=list)   # mutable default → use a factory
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


t1 = Task(id="t1", title="Write spec", tags=["docs"])
t2 = replace(t1, title="Write better spec")          # like { ...t1, title: '...' }
print(t1.title, "|", t2.title)                       # → Write spec | Write better spec
print(t1 == Task("t1", "Write spec", ["docs"], t1.created_at))  # → True  (value equality!)
# t1.title = "x"   → dataclasses.FrozenInstanceError
```

`==` on two dataclasses compares their **fields**. TS's `===` compares references. Use `is` when you really want identity.

### Protocols: TS-style structural interfaces

TS interfaces are **structural**: anything with the right shape matches. Python has two options:
- `abc.ABC`: **nominal**. A class must explicitly inherit from it, like `implements` in Java.
- `typing.Protocol`: **structural**, just like a TS interface. mypy checks the shape, with no inheritance needed.

```python
from typing import Protocol


class Notifier(Protocol):
    def send(self, to: str, body: str) -> bool: ...   # `...` = no body (declaration only)


class EmailNotifier:                 # note: does NOT inherit from Notifier
    def send(self, to: str, body: str) -> bool:
        print(f"email to {to}: {body}")
        return True


def notify_all(notifier: Notifier, users: list[str]) -> None:
    for u in users:
        notifier.send(u, "Your task was assigned")


notify_all(EmailNotifier(), ["ada@x.io"])   # → email to ada@x.io: Your task was assigned
```

We use `Protocol` for service dependencies, so tests can pass in a fake implementation without inheritance.

### Enums

```python
from enum import StrEnum


class Role(StrEnum):            # each member IS a str, so it serialises cleanly to JSON
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"


r = Role("admin")               # parse from a string (raises ValueError if invalid)
print(r, r is Role.ADMIN, r == "admin", [m.value for m in Role])
# → admin True True ['owner', 'admin', 'member']
```

TS `enum Role { Owner = 'owner' }` maps to `StrEnum`. Use `IntEnum` for numeric ones.

---

## 8. Modules and packages

| TypeScript | Python |
|---|---|
| a file is a module | a `.py` file is a module |
| a folder with `index.ts` | a folder is a **package**. `__init__.py` marks it and plays the role of `index.ts`. |
| `import { a, b } from './utils'` | `from app.utils import a, b` (absolute) or `from .utils import a, b` (relative) |
| `import * as utils from './utils'` | `import app.utils as utils` / `from app import utils` |
| `export` | Nothing to write: **every top-level name is importable**. A leading `_` marks a name as internal. |
| `export default` | Doesn't exist. Everything is a named import. |
| `node_modules` resolution | Imports resolve from `sys.path`: the project root plus `.venv/lib/.../site-packages` |

```py
# app/services/tasks.py
from app.models import Task              # absolute import from the project root (preferred)
from .ranking import between             # relative import within the same package

__all__ = ["create_task"]                # optional: what `from module import *` exposes


def create_task(title: str) -> Task: ...


if __name__ == "__main__":               # true only when run directly (python -m app.services.tasks)
    print(create_task("demo"))           # like `if (import.meta.main)` / `require.main === module`
```

- A module's top-level code runs **once**, the first time it's imported, and is then cached (`sys.modules`). This is the same as ES module caching.
- **Circular imports fail at import time** with `ImportError: cannot import name ...` when two modules import names from each other at the top level. See [gotchas.md](gotchas.md#circular-imports).
- Run modules as `python -m package.module` so absolute imports resolve from the project root. `uv run` handles this for you when the project is installed in editable mode.

---

## 9. Errors

```python
class DomainError(Exception):
    """Base for errors our API maps to problem+json."""


class NotFoundError(DomainError):
    def __init__(self, resource: str, id: str) -> None:
        super().__init__(f"{resource} {id} not found")
        self.resource = resource
        self.id = id


def find_task(task_id: str) -> str:
    raise NotFoundError("Task", task_id)


try:
    find_task("t42")
except NotFoundError as e:                  # catch by type (no instanceof checks needed)
    print("404:", e, e.resource)            # → 404: Task t42 not found Task
except (ValueError, KeyError):              # several types at once
    print("bad input")
else:
    print("only runs if nothing was raised")
finally:
    print("always runs")                    # → always runs

# Re-raise as another type and keep the cause (like `new Error(msg, { cause })`)
try:
    try:
        int("abc")
    except ValueError as e:
        raise DomainError("invalid page size") from e
except DomainError as e:
    print(e, "<-", repr(e.__cause__))       # → invalid page size <- ValueError("invalid literal for int() with base 10: 'abc'")
```

- **Catch specific exceptions.** A bare `except:` or `except Exception:` swallows bugs, so use it only at the outermost boundary (an error handler middleware).
- Python has no checked exceptions (Java does, see [java-for-ts-devs.md](java-for-ts-devs.md#9-exceptions)). As in TS, you document what a function raises in its docstring.
- Common built-ins: `ValueError` (bad value), `TypeError` (wrong type), `KeyError` (missing dict key), `IndexError`, `AttributeError` (missing attribute, roughly "cannot read property of undefined"), `NotImplementedError`.

---

## 10. Context managers (`with`)

`with` guarantees cleanup, the way `try/finally` does. TS 5.2's `using` declaration was modelled on it. Files, DB sessions, locks and HTTP clients are all used through `with`.

```python
from collections.abc import Iterator
from contextlib import contextmanager
import time


@contextmanager
def timed(label: str) -> Iterator[None]:
    start = time.perf_counter()
    try:
        yield                                # the body of the `with` block runs here
    finally:
        print(f"{label} took {time.perf_counter() - start:.0f}s")


with timed("query"):
    total = sum(range(1000))
# → query took 0s

with open(__file__) as f:                    # the file is closed even if an exception is raised
    print(f.readline().strip())              # → from collections.abc import Iterator
```

Async code uses `async with`. FastAPI's DB session (`async with session_maker() as session:`) is the example you'll meet first.

---

## 11. Iterators and generators

A function containing `yield` is a **generator**, the same idea as `function*` in JS. It produces values lazily, which keeps memory constant when streaming big result sets.

```python
from collections.abc import Iterator


def batched_ids(total: int, size: int) -> Iterator[list[int]]:
    for start in range(0, total, size):
        yield list(range(start, min(start + size, total)))


for batch in batched_ids(7, 3):
    print(batch)                         # → [0, 1, 2] / [3, 4, 5] / [6]

# Generator *expressions* are lazy comprehensions: round brackets instead of square ones
total = sum(n * n for n in range(1_000_000))     # never builds a million-element list
print(total)                                     # → 333332833333500000
```

`range`, `zip`, `enumerate`, `dict.items()` and `map` are all lazy iterables, like JS iterators. Wrap one in `list(...)` to materialise it.

---

## 12. Async / await

The syntax looks the same as TS, but the runtime model is different:

| | Node / TS | Python `asyncio` |
|---|---|---|
| Event loop | always running | **you start it**: `asyncio.run(main())` (frameworks like FastAPI do this for you) |
| Calling an async function | starts running immediately and returns a `Promise` | returns a **coroutine object that does nothing until awaited** |
| `Promise.all` | | `asyncio.gather(...)` or `asyncio.TaskGroup` |
| fire and forget | call without `await` | `asyncio.create_task(coro)` (keep a reference to it!) |
| `setTimeout` delay | `await new Promise(r => setTimeout(r, ms))` | `await asyncio.sleep(seconds)` |
| Blocking I/O | almost nothing blocks | **many libraries block** (`requests`, `time.sleep`, psycopg2). Calling them in async code freezes the whole loop. |

```python
import asyncio
import time


async def fetch_user(user_id: int) -> str:
    await asyncio.sleep(0.1)              # simulated I/O
    return f"user-{user_id}"


async def main() -> None:
    started = time.perf_counter()

    # Run concurrently, like Promise.all
    users = await asyncio.gather(fetch_user(1), fetch_user(2), fetch_user(3))
    print(users, f"{time.perf_counter() - started:.1f}s")   # → ['user-1', 'user-2', 'user-3'] 0.1s

    # TaskGroup (3.11+): structured concurrency. If one task fails, the others are cancelled.
    async with asyncio.TaskGroup() as tg:
        a = tg.create_task(fetch_user(4))
        b = tg.create_task(fetch_user(5))
    print(a.result(), b.result())                           # → user-4 user-5

    # Timeouts
    try:
        async with asyncio.timeout(0.05):
            await fetch_user(6)
    except TimeoutError:
        print("timed out")                                  # → timed out

    coro = fetch_user(7)          # NOT running yet: just a coroutine object
    print(await coro)             # → user-7


asyncio.run(main())               # there's no top-level await in a script, so start the loop here
```

**Rules of thumb for the FastAPI repo:**
1. `async def` endpoints must only `await` async libraries (SQLAlchemy async, redis-py asyncio, httpx).
2. If you have to call blocking code, use a plain `def` endpoint (FastAPI runs it in a thread pool) or wrap the call in `await asyncio.to_thread(fn, ...)`.
3. Django is mostly synchronous. Its ORM is sync-first, and the async ORM methods (`aget`, `acreate`) just run in a thread for you. Celery workers are sync.

---

## 13. Decorators

A decorator is **a function that takes a function (or class) and returns a replacement**. The `@` line is syntax sugar. Like TS decorators, they run once, when the function is defined.

```python
import functools
from collections.abc import Callable


def retry[**P, R](times: int) -> Callable[[Callable[P, R]], Callable[P, R]]:
    def decorator(fn: Callable[P, R]) -> Callable[P, R]:
        @functools.wraps(fn)                      # keep the wrapped function's name and docstring
        def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            for attempt in range(1, times + 1):
                try:
                    return fn(*args, **kwargs)
                except ConnectionError:
                    print(f"attempt {attempt} failed")
            raise ConnectionError(f"gave up after {times} attempts")
        return wrapper
    return decorator


calls = 0


@retry(times=3)                     # same as: flaky = retry(times=3)(flaky)
def flaky(x: int) -> int:
    global calls                    # assigning to a module-level name needs `global`
    calls += 1
    if calls < 3:
        raise ConnectionError
    return x * 2


print(flaky(21))                    # → attempt 1 failed / attempt 2 failed / 42
```

You'll mostly *use* decorators rather than write them. When you see `@app.get("/tasks")` in FastAPI, it means "register this function as the handler for GET /tasks and return it unchanged". Django's `@login_required`, `@pytest.fixture` and `@dataclass` all follow the same pattern.

`[**P, R]` declares a *ParamSpec* (`P`, the whole parameter list) and a type variable (`R`). Together they let mypy check that the wrapper has the same signature as the function it wraps. TS infers this automatically. In Python you spell it out.

---

## 14. Pydantic: runtime-validated types

Pydantic is to FastAPI what zod is to an Express app. The difference is that **the class *is* the schema**: there's no separate `z.infer<>` step, because Python type hints exist at runtime.

```python
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic.alias_generators import to_camel


class CreateTask(BaseModel):
    # camelCase on the wire, snake_case in Python (our contract rule)
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    title: str = Field(min_length=1, max_length=200)
    due_date: str | None = None
    story_points: int = Field(default=1, ge=1, le=13)


task = CreateTask.model_validate({"title": "Ship", "storyPoints": 5})
print(task.story_points, task.model_dump(by_alias=True))
# → 5 {'title': 'Ship', 'dueDate': None, 'storyPoints': 5}

try:
    CreateTask.model_validate({"title": "", "storyPoints": 99})
except ValidationError as e:
    print([(err["loc"], err["type"]) for err in e.errors()])
# → [(('title',), 'string_too_short'), (('storyPoints',), 'less_than_equal')]
```

Run it with `uv run --no-project --with pydantic python scratch.py`. The FastAPI STEPS.md explains Pydantic in depth. This is just enough to recognise it.

---

## 15. Cheat sheet

| TypeScript | Python |
|---|---|
| `const x = 1; let y = 2` | `x = 1; y = 2` |
| `` `Hi ${name}` `` | `f"Hi {name}"` |
| `a ?? b` | `a if a is not None else b` |
| `a?.b` | `a.b if a is not None else None` (no operator for it) |
| `arr.length` | `len(arr)` |
| `arr.map(f)` / `.filter(p)` | `[f(x) for x in arr]` / `[x for x in arr if p(x)]` |
| `arr.reduce((a, b) => a + b, 0)` | `sum(arr)`; generally `functools.reduce` |
| `arr.find(p)` | `next((x for x in arr if p(x)), None)` |
| `arr.some(p)` / `.every(p)` | `any(p(x) for x in arr)` / `all(...)` |
| `arr.includes(x)` | `x in arr` |
| `arr.slice(1, 3)` | `arr[1:3]` |
| `[...arr].sort((a, b) => a.n - b.n)` | `sorted(arr, key=lambda a: a.n)` |
| `Object.keys(o)` / `.entries(o)` | `d.keys()` / `d.items()` |
| `JSON.stringify` / `JSON.parse` | `json.dumps` / `json.loads` |
| `typeof x === 'string'` | `isinstance(x, str)` |
| `console.log` | `print` (scripts), `structlog` / `logging` (apps) |
| `throw new Error('x')` | `raise ValueError("x")` |
| `try {} catch (e) {}` | `try: ... except SomeError as e: ...` |
| `async/await`, `Promise.all` | `async/await`, `asyncio.gather` |
| `interface` (shape) | `Protocol` (behaviour), `@dataclass` / Pydantic `BaseModel` (data) |
| `enum` | `enum.StrEnum` / `IntEnum` |
| `process.env.X` | `os.environ["X"]` / pydantic-settings |
| `new Date().toISOString()` | `datetime.now(UTC).isoformat()` |
| `import x from 'y'` | `from y import x` |
| `npm i zod` | `uv add pydantic` |
| `npx tsc --noEmit` | `uv run mypy --strict .` |
| ESLint + Prettier | `uv run ruff check .` + `uv run ruff format .` |
