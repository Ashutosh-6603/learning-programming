# Java for TypeScript developers

A language tour for someone who already writes TypeScript every day. It covers enough modern Java (Java 25) for the Spring Boot STEPS.md guides to teach Spring rather than syntax.

**Versions:** Java **25 LTS** (Eclipse Temurin 25.0.4.1) · Spring Boot **4.1** (checked October 2026).

**How to use this file:** every ` ```java ` block that contains `void main()` is a complete program. Save it as `Main.java` and run `java Main.java`. Since Java 11, the `java` launcher compiles and runs a single source file in one go, so you don't need Maven for experiments. The `// →` comments show the output. Run `jshell` for a REPL.

Related: [java-build-tools.md](java-build-tools.md) (Maven) · [ecosystem.md](ecosystem.md) · [gotchas.md](gotchas.md) · [python-for-ts-devs.md](python-for-ts-devs.md)

---

## Contents

1. [The mental model](#1-the-mental-model)
2. [Hello world: classic and compact](#2-hello-world-classic-and-compact)
3. [Types, variables, strings](#3-types-variables-strings)
4. [Collections and streams](#4-collections-and-streams)
5. [Control flow and switch expressions](#5-control-flow-and-switch-expressions)
6. [Methods, lambdas, functional interfaces](#6-methods-lambdas-functional-interfaces)
7. [Classes and interfaces](#7-classes-and-interfaces)
8. [Records, sealed types, pattern matching](#8-records-sealed-types-pattern-matching)
9. [Exceptions](#9-exceptions)
10. [Null and `Optional`](#10-null-and-optional)
11. [Generics](#11-generics)
12. [Packages, imports, visibility, project layout](#12-packages-imports-visibility-project-layout)
13. [Annotations: how Spring's "magic" works](#13-annotations-how-springs-magic-works)
14. [Concurrency: threads, not an event loop](#14-concurrency-threads-not-an-event-loop)
15. [Dates and times](#15-dates-and-times)
16. [Cheat sheet](#16-cheat-sheet)

---

## 1. The mental model

| | TypeScript | Java |
|---|---|---|
| Compilation | `tsc` → JS (optional, types erased) | `javac` → `.class` **bytecode** (required), run by the **JVM** |
| Typing | **Structural**: matching shapes are compatible | **Nominal**: a class must *declare* `implements Foo` to be a `Foo` |
| Types at runtime | Gone | **Kept** (`obj.getClass()`, reflection). Generic *parameters* are erased, though (§11). |
| Where code lives | Anywhere: top-level functions, objects | **Everything is inside a class** (compact source files are the exception, used for scripts) |
| Numbers | `number` | `int`, `long`, `double`, … plus `BigDecimal` for money |
| `null` | `null` + `undefined`, tracked by `strictNullChecks` | Only `null`, and **the compiler does not track it**. Any reference can be null. |
| Errors | throw anything | `throw` a `Throwable`. **Checked exceptions** must be declared or caught. |
| Concurrency | One thread + event loop | **Many real threads**. Spring MVC handles each request on its own thread. |
| Package manager + build | npm + tsc + scripts | **Maven** does all of it ([java-build-tools.md](java-build-tools.md)) |

**Why so much ceremony?** Java (1995) was designed for big teams and long-lived codebases. Explicit types, nominal interfaces and checked exceptions make code easy to navigate and refactor safely in an IDE, at the cost of verbosity. Modern Java (records, `var`, switch expressions, pattern matching, compact source files) has cut much of that verbosity. The Spring repo uses all of these features.

---

## 2. Hello world: classic and compact

The classic form, which you'll see in every Spring app (`Application.java`):

```java
public class Main {
    public static void main(String[] args) {
        System.out.println("Hello from " + System.getProperty("java.version"));  // → Hello from 25.0.4.1
    }
}
```

- `public class Main`: a public class must live in a file with the **same name** (`Main.java`).
- `public static void main(String[] args)` is the entry point. `static` means it belongs to the class, so no instance is needed. `void` means it returns nothing. `args` holds the CLI arguments (`process.argv.slice(2)`).
- `System.out.println` is `console.log`.

**Compact source files (finalised in Java 25):** for scripts and learning, you can skip the class. The file becomes an implicit class, and the whole `java.base` module (`java.util.*`, `java.time.*`, …) is imported automatically.

```java
void main() {
    var names = List.of("ada", "linus");      // List works without an import here
    System.out.println(names);               // → [ada, linus]
}
```

The rest of this primer uses the compact form to keep examples short, but still writes the `import` lines out so you learn which package each type comes from. In a Spring project, every file is a normal class inside a package (§12).

---

## 3. Types, variables, strings

### Primitives vs references

| Kind | Types | Default | Can be `null`? |
|---|---|---|---|
| **Primitives** (raw values, on the stack) | `byte` `short` `int` (32-bit) `long` (64-bit) `float` `double` `boolean` `char` | `0` / `false` | no |
| **References** (objects, on the heap) | `String`, `Integer`, `List<T>`, your classes | `null` | **yes** |

Each primitive has a **boxed** wrapper class (`int` ↔ `Integer`, `long` ↔ `Long`, `boolean` ↔ `Boolean`). Generics only accept references, so you write `List<Integer>`, never `List<int>`. Java converts between the two automatically ("autoboxing").

```java
void main() {
    int count = 3;                     // primitive
    long bigId = 9_007_199_254_740_993L;   // L suffix = long literal; _ separators are allowed
    double price = 19.99;
    boolean done = false;
    char grade = 'A';                  // single quotes = char, double quotes = String
    String name = "Ada";

    var tasks = new java.util.ArrayList<String>();  // `var` = local type inference (like `const x = ...`)
    final int maxRetries = 5;          // final = can't reassign (like const)
    // maxRetries = 6;                 // compile error

    System.out.println(count + bigId + " " + price + " " + done + " " + grade + " " + name + " " + tasks);
    // → 9007199254740996 19.99 false A Ada []
    System.out.println(7 / 2 + " " + 7 / 2.0 + " " + 7 % 2);    // → 3 3.5 1   (int / int = int!)
    System.out.println(Integer.MAX_VALUE + 1);                   // → -2147483648 (silent overflow)
    System.out.println(Math.addExact(1L, 2L));                   // → 3  (*Exact methods throw on overflow)
}
```

- **`var`** only works for local variables with an initialiser. Fields, parameters and return types must be written out. That's the opposite of TS, where inference works almost everywhere.
- **`final`** on a variable works like `const`: the variable can't be reassigned, but the object it points to can still be mutated.
- `long` holds IDs beyond 2⁵³ exactly. JS `number` can't, which is one reason our contract uses string IDs.

### Strings

```java
void main() {
    String a = "task";
    String b = new String("task");             // forces a separate object (never do this in real code)

    System.out.println(a == b);                // → false  (== compares REFERENCES for objects)
    System.out.println(a.equals(b));           // → true   (equals compares VALUES — always use this)

    String title = "  Ship v2  ";
    System.out.println(title.strip().toUpperCase().replace("V2", "V3"));   // → SHIP V3
    System.out.println(String.join(", ", "a", "b") + " " + "abc".contains("b") + " " + "x".repeat(3));
    // → a, b true xxx

    // Formatting (there's no `${}` interpolation in Java)
    System.out.println("%s has %d tasks (%.1f%%)".formatted("Ada", 3, 42.5));  // → Ada has 3 tasks (42.5%)

    // Text blocks: multi-line strings with triple quotes (great for SQL and JSON)
    String sql = """
        SELECT id, title
        FROM tasks
        WHERE board_id = ?
        """;
    System.out.print(sql);                     // indentation is stripped to the closing """
}
```

**`==` vs `.equals()` is the #1 Java trap for JS developers.** For objects (String, Integer, your classes), `==` asks "same object?", like `===` on JS objects. Use `.equals()` for value comparison. Primitives (`int`, `boolean`) compare by value with `==` as you'd expect.

---

## 4. Collections and streams

| TypeScript | Java interface | Usual implementation | Immutable factory |
|---|---|---|---|
| `T[]` | `List<T>` | `ArrayList<T>` | `List.of(...)` |
| `Map<K, V>` / `Record<K, V>` | `Map<K, V>` | `HashMap` (no order), `LinkedHashMap` (insertion order), `TreeMap` (sorted) | `Map.of(k, v, ...)` |
| `Set<T>` | `Set<T>` | `HashSet`, `LinkedHashSet`, `TreeSet` | `Set.of(...)` |
| queue | `Deque<T>` | `ArrayDeque<T>` | — |
| fixed-size typed array | `T[]` (a real array: `int[]`, `String[]`) | | |

**Program to the interface:** declare `List<String> tasks = new ArrayList<>();`, so the variable's type is the interface and only the constructor names the implementation. Spring code follows this everywhere. The `<>` ("diamond") infers the type arguments.

```java
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

void main() {
    List<String> tasks = new ArrayList<>();
    tasks.add("plan");
    tasks.add("build");
    tasks.addFirst("idea");                      // Java 21+
    System.out.println(tasks.get(0) + " " + tasks.size() + " " + tasks.contains("build"));  // → idea 3 true

    List<String> fixed = List.of("a", "b");
    try {
        fixed.add("c");                          // List.of is immutable
    } catch (UnsupportedOperationException e) {
        System.out.println("immutable!");        // → immutable!
    }

    Map<String, Integer> points = new HashMap<>();
    points.put("t1", 3);
    points.merge("t1", 2, Integer::sum);         // add 2 to the existing value
    points.putIfAbsent("t2", 1);
    System.out.println(points.get("t1") + " " + points.get("missing") + " " + points.getOrDefault("missing", 0));
    // → 5 null 0       (get() returns null for missing keys; it doesn't throw)

    for (var entry : points.entrySet()) {        // Object.entries
        System.out.println(entry.getKey() + "=" + entry.getValue());   // → t1=5 / t2=1
    }
}
```

### Streams: `.map / .filter / .reduce`

JS array methods are eager and return arrays. Java **streams** are lazy pipelines: you open one with `.stream()` and close it with a terminal operation (`toList()`, `collect`, `count`, …).

```java
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

record Task(String title, String status, int points) {}

void main() {
    var tasks = List.of(
        new Task("spec", "done", 3),
        new Task("api", "doing", 5),
        new Task("ui", "doing", 8));

    List<String> active = tasks.stream()
        .filter(t -> t.status().equals("doing"))     // .filter(t => t.status === 'doing')
        .map(Task::title)                            // method reference = t -> t.title()
        .toList();
    System.out.println(active);                      // → [api, ui]

    int total = tasks.stream().mapToInt(Task::points).sum();
    boolean anyDone = tasks.stream().anyMatch(t -> t.status().equals("done"));
    var first = tasks.stream().filter(t -> t.points() > 4).findFirst();   // Optional<Task> (§10)
    System.out.println(total + " " + anyDone + " " + first.map(Task::title).orElse("none"));  // → 16 true api

    Map<String, Long> countByStatus = tasks.stream()
        .collect(Collectors.groupingBy(Task::status, Collectors.counting()));
    System.out.println(countByStatus);               // → {doing=2, done=1}  (HashMap order is not guaranteed)
}
```

Complexities match their TS/Python counterparts: `ArrayList` get/add-at-end O(1), insert at the front O(n); `HashMap`/`HashSet` O(1) average; `TreeMap`/`TreeSet` O(log n) with sorted iteration (a red-black tree, which neither JS nor Python ships).

---

## 5. Control flow and switch expressions

```java
void main() {
    int n = 7;
    if (n > 5 && n % 2 == 1) {                 // conditions must be boolean: `if (n)` doesn't compile
        System.out.println("big odd");         // → big odd
    } else if (n == 0) {
        System.out.println("zero");
    }

    for (int i = 0; i < 3; i++) System.out.print(i + " ");     // → 0 1 2   C-style loop exists
    System.out.println();
    for (String s : java.util.List.of("a", "b")) System.out.print(s);   // → ab   like for...of
    System.out.println();

    // Ternary is the same as in TS
    String parity = n % 2 == 0 ? "even" : "odd";

    // Switch EXPRESSION (Java 14+): arrows, no fall-through, returns a value, compiler checks exhaustiveness
    String day = "SAT";
    int hours = switch (day) {
        case "SAT", "SUN" -> 0;
        case "FRI" -> 6;
        default -> {
            int base = 8;
            yield base;                        // `yield` returns a value from a block arm
        }
    };
    System.out.println(parity + " " + hours);  // → odd 0
}
```

**There's no truthiness.** `if (list)`, `if (str)` and `if (count)` don't compile. Write `!list.isEmpty()`, `str != null && !str.isBlank()` and `count > 0`. Strict, but it rules out a whole class of JS bugs.

---

## 6. Methods, lambdas, functional interfaces

```java
import java.util.List;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

// Overloading: same name, different parameter lists. Java's answer to default parameters.
String greet(String name) { return greet(name, "Hello"); }
String greet(String name, String greeting) { return greeting + ", " + name; }

// Varargs: like (...ids: string[])
int countAll(String... ids) { return ids.length; }

void main() {
    System.out.println(greet("Ada") + " | " + greet("Ada", "Hi") + " | " + countAll("a", "b", "c"));
    // → Hello, Ada | Hi, Ada | 3

    // A lambda's type is a FUNCTIONAL INTERFACE (an interface with exactly one abstract method)
    Function<String, Integer> length = s -> s.length();          // (s: string) => number
    Predicate<Integer> isEven = x -> x % 2 == 0;                 // (x: number) => boolean
    Supplier<String> now = () -> "12:00";                        // () => string
    Runnable task = () -> System.out.println("ran");             // () => void
    task.run();                                                  // → ran

    System.out.println(length.apply("four") + " " + isEven.test(3) + " " + now.get());   // → 4 false 12:00

    // Method references: ClassName::method or object::method
    List.of("b", "a").stream().sorted().forEach(System.out::println);   // → a / b
}
```

| TS function type | Java functional interface | Call it with |
|---|---|---|
| `(a: A) => R` | `Function<A, R>` | `.apply(a)` |
| `(a: A, b: B) => R` | `BiFunction<A, B, R>` | `.apply(a, b)` |
| `(a: A) => boolean` | `Predicate<A>` | `.test(a)` |
| `(a: A) => void` | `Consumer<A>` | `.accept(a)` |
| `() => R` | `Supplier<R>` | `.get()` |
| `() => void` | `Runnable` | `.run()` |

Why the different names? Java has no function *types*, only interfaces. A lambda is shorthand for "an object implementing that one-method interface". This is also why you can't call `length("x")` directly: you call the interface's method.

Lambdas can only read local variables that are **effectively final** (never reassigned). To keep a counter, use an `AtomicInteger` or restructure the code.

---

## 7. Classes and interfaces

```java
import java.util.ArrayList;
import java.util.List;

interface Notifier {                                   // nominal: implementers must say `implements Notifier`
    boolean send(String to, String body);

    default boolean sendAll(List<String> to, String body) {   // default method = shared implementation
        return to.stream().allMatch(t -> send(t, body));
    }
}

abstract class BaseNotifier implements Notifier {      // abstract = can't be instantiated
    protected final List<String> sent = new ArrayList<>();   // visible to subclasses
}

final class EmailNotifier extends BaseNotifier {       // final class = can't be subclassed
    private final String from;                         // private field, set once in the constructor

    EmailNotifier(String from) {                       // constructor: same name as the class, no return type
        this.from = from;
    }

    @Override                                          // compiler checks this really overrides something
    public boolean send(String to, String body) {
        sent.add(to);
        System.out.println(from + " -> " + to + ": " + body);
        return true;
    }

    int sentCount() { return sent.size(); }
}

void main() {
    Notifier n = new EmailNotifier("no-reply@taskflow.dev");   // variable typed as the interface
    n.sendAll(List.of("a@x.io", "b@x.io"), "hi");
    // → no-reply@taskflow.dev -> a@x.io: hi / no-reply@taskflow.dev -> b@x.io: hi
    if (n instanceof EmailNotifier email) {            // pattern matching instanceof: test + cast + bind
        System.out.println(email.sentCount());         // → 2
    }
}
```

Access modifiers:

| Modifier | Visible to | TS analogue |
|---|---|---|
| `public` | everyone | `export` + public |
| `protected` | subclasses and the same package | `protected` |
| *(none)* "package-private" | the **same package** only | roughly "not exported from the module" |
| `private` | this class only (**enforced**, even at runtime) | `#private` |

**Dependency injection by constructor.** In Spring, a service declares its dependencies as `private final` fields and takes them in its constructor. Spring calls that constructor for you (§13). There's no `@Autowired` on fields and no Lombok in our repos, so everything stays visible and testable.

```java
final class TaskService {
    private final TaskRepository repository;           // dependency
    TaskService(TaskRepository repository) { this.repository = repository; }
    String title(String id) { return repository.findTitle(id); }
}

interface TaskRepository { String findTitle(String id); }

void main() {
    var service = new TaskService(id -> "Fake task " + id);   // a lambda can implement a 1-method interface
    System.out.println(service.title("t1"));                  // → Fake task t1
}
```

---

## 8. Records, sealed types, pattern matching

### Records: immutable data classes

A `record` is Java's answer to a readonly TS object type plus a constructor. It generates the constructor, accessors, `equals`, `hashCode` and `toString`. It's the Java equivalent of a Python `@dataclass(frozen=True)`. We use records for DTOs (request and response bodies).

```java
import java.util.List;

record CreateTaskRequest(String title, int points, List<String> tags) {
    CreateTaskRequest {                                      // "compact constructor": validate or normalise
        if (title == null || title.isBlank()) throw new IllegalArgumentException("title required");
        tags = List.copyOf(tags);                            // defensive immutable copy
    }

    CreateTaskRequest withPoints(int newPoints) {            // "wither" instead of { ...req, points }
        return new CreateTaskRequest(title, newPoints, tags);
    }
}

void main() {
    var req = new CreateTaskRequest("Ship", 3, List.of("api"));
    System.out.println(req);                                 // → CreateTaskRequest[title=Ship, points=3, tags=[api]]
    System.out.println(req.title() + " " + req.points());    // accessors are title(), not getTitle()
    System.out.println(req.equals(new CreateTaskRequest("Ship", 3, List.of("api"))));   // → true
    System.out.println(req.withPoints(5).points());          // → 5
}
```

Jackson (Spring's JSON library) serialises records to `{"title":"Ship","points":3,"tags":["api"]}`. The component names are already camelCase, so they match our wire format without any configuration.

### Sealed interfaces + switch patterns = discriminated unions

TS:

```ts
type Event = { type: 'created'; title: string } | { type: 'moved'; from: string; to: string };
```

Java 25:

```java
sealed interface TaskEvent permits Created, Moved, Deleted {}
record Created(String title) implements TaskEvent {}
record Moved(String from, String to) implements TaskEvent {}
record Deleted(String id) implements TaskEvent {}

String describe(TaskEvent e) {
    return switch (e) {                                   // exhaustive: no default needed
        case Created(var title) -> "created " + title;    // record pattern destructures the fields
        case Moved(var from, var to) when from.equals(to) -> "no-op move";   // guard
        case Moved(var from, var to) -> "moved " + from + " -> " + to;
        case Deleted(var id) -> "deleted " + id;
    };
}

void main() {
    System.out.println(describe(new Created("Ship")));         // → created Ship
    System.out.println(describe(new Moved("todo", "todo")));   // → no-op move
    System.out.println(describe(new Moved("todo", "done")));   // → moved todo -> done
}
```

`sealed ... permits` closes the set of subtypes, so the compiler knows the switch covers every case. If you add a fourth event, every non-exhaustive `switch` fails to compile. That's the same safety you get in TS from a `never` exhaustiveness check.

### Enums

Java enums are full classes. They can have fields, constructors and methods, which TS enums can't.

```java
enum Role {
    OWNER(3), ADMIN(2), MEMBER(1);

    private final int level;
    Role(int level) { this.level = level; }

    boolean atLeast(Role other) { return level >= other.level; }
}

void main() {
    Role r = Role.valueOf("ADMIN");                           // parse (throws on unknown)
    System.out.println(r + " " + r.atLeast(Role.MEMBER) + " " + r.name().toLowerCase());  // → ADMIN true admin
    for (Role each : Role.values()) System.out.print(each.ordinal() + " ");               // → 0 1 2
    System.out.println();
}
```

---

## 9. Exceptions

```java
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

// Unchecked (extends RuntimeException): the compiler doesn't force anyone to handle it
class NotFoundException extends RuntimeException {
    NotFoundException(String resource, String id) { super(resource + " " + id + " not found"); }
}

// Checked (extends Exception but not RuntimeException): callers MUST catch it or declare `throws`
String readConfig(Path path) throws IOException {
    return Files.readString(path);
}

void main() {
    try {
        throw new NotFoundException("Task", "t42");
    } catch (NotFoundException e) {
        System.out.println("404: " + e.getMessage());     // → 404: Task t42 not found
    } finally {
        System.out.println("cleanup");                    // → cleanup
    }

    try {
        readConfig(Path.of("/does/not/exist"));
    } catch (IOException e) {                             // removing this catch = compile error
        System.out.println("io: " + e.getClass().getSimpleName());   // → io: NoSuchFileException
    }

    // try-with-resources: auto-closes anything AutoCloseable (like Python's `with`, TS `using`)
    try (var lines = Files.lines(Path.of(System.getProperty("java.home"), "release"))) {
        System.out.println(lines.findFirst().orElse("").startsWith("IMPLEMENTOR"));   // → true
    } catch (IOException e) {
        throw new RuntimeException(e);                    // wrap a checked exception as unchecked (keeps the cause)
    }
}
```

| | Checked | Unchecked |
|---|---|---|
| Extends | `Exception` | `RuntimeException` |
| Compiler forces handling? | yes: `catch` or `throws` | no |
| Examples | `IOException`, `SQLException`, `InterruptedException` | `NullPointerException`, `IllegalArgumentException`, `IllegalStateException` |
| In our code | Wrap them at the boundary | **Domain errors extend `RuntimeException`.** A `@RestControllerAdvice` turns them into problem+json. |

**Why do checked exceptions exist?** They were designed to make failure part of a method's signature, so callers can't forget it. In practice they don't compose well with lambdas and streams, so modern frameworks (Spring included) throw unchecked exceptions almost everywhere.

---

## 10. Null and `Optional`

The compiler doesn't track null. A `String` parameter can always be `null`, and calling a method on it throws `NullPointerException`. Java 14+ makes the message helpful (`Cannot invoke "String.length()" because "name" is null`), but it's still a runtime crash.

Our conventions:
- **Never return `null` from a method that may find nothing.** Return `Optional<T>`. Spring Data's `findById` returns `Optional<Task>`.
- Don't use `Optional` for fields or parameters. It's meant for return values.
- Validate inputs at the edge (Bean Validation `@NotNull`) and assume non-null inside.

```java
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

Map<String, String> db = Map.of("t1", "Ship v2");

Optional<String> findTitle(String id) {
    return Optional.ofNullable(db.get(id));                 // wraps a possibly-null value
}

void main() {
    System.out.println(findTitle("t1").map(String::toUpperCase).orElse("?"));   // → SHIP V2
    System.out.println(findTitle("zz").orElse("untitled"));                      // → untitled
    System.out.println(findTitle("zz").isPresent());                             // → false

    try {
        findTitle("zz").orElseThrow(() -> new IllegalStateException("task zz missing"));
    } catch (IllegalStateException e) {
        System.out.println(e.getMessage());                                      // → task zz missing
    }

    String maybe = null;
    System.out.println(Objects.requireNonNullElse(maybe, "fallback"));          // like maybe ?? 'fallback'
}
```

| TS | Java |
|---|---|
| `x ?? y` | `Objects.requireNonNullElse(x, y)` or `Optional.ofNullable(x).orElse(y)` |
| `x?.y?.z` | `Optional.ofNullable(x).map(X::y).map(Y::z)` |
| `T \| undefined` return | `Optional<T>` |
| `x!` | `Objects.requireNonNull(x)` (fails fast with a clear message) |

---

## 11. Generics

```java
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

record Page<T>(List<T> items, String nextCursor) {}         // generic record, like Page<T> in TS

<T extends Comparable<T>> T max(List<T> items) {            // bounded type parameter: T must be comparable
    return items.stream().max(Comparator.naturalOrder()).orElseThrow();
}

double sum(List<? extends Number> nums) {                   // wildcard: a list of ANY Number subtype
    return nums.stream().mapToDouble(Number::doubleValue).sum();
}

void main() {
    Page<String> page = new Page<>(List.of("a", "b"), null);
    System.out.println(page.items().size() + " " + max(List.of(3, 9, 4)) + " " + sum(List.of(1, 2.5)));
    // → 2 9 3.5

    // Type erasure: at runtime, List<String> and List<Integer> are the same class
    System.out.println(new ArrayList<String>().getClass() == new ArrayList<Integer>().getClass());   // → true
}
```

- `<T>` goes **before** the return type on a method: `<T> T first(List<T> xs)`. In TS it goes after the name.
- `extends` in a bound means "is a subtype of" for both classes and interfaces.
- **Erasure:** generic arguments exist only at compile time, just as all TS types do. That's why you can't write `new T()` or `x instanceof List<String>`, and why Jackson sometimes needs a `TypeReference<List<Task>>` to deserialise generic types.
- The rule of thumb for wildcards is **PECS**: *Producer `extends`, Consumer `super`*. You'll mostly read them in library signatures rather than write them.

---

## 12. Packages, imports, visibility, project layout

Java packages are reversed domain names, and **the folder structure must match the package name**.

```
src/main/java/dev/taskflow/                        ← package dev.taskflow
├── TaskflowApplication.java                       ← @SpringBootApplication entry point
├── task/                                          ← package dev.taskflow.task (one feature per package)
│   ├── TaskController.java
│   ├── TaskService.java
│   ├── TaskRepository.java
│   ├── Task.java                                  ← JPA entity
│   └── dto/CreateTaskRequest.java                 ← record
└── common/error/GlobalExceptionHandler.java
src/main/resources/application.yml                 ← config (classpath resources)
src/test/java/dev/taskflow/task/TaskControllerTest.java   ← tests mirror the main package tree
```

```java
// src/main/java/dev/taskflow/task/TaskService.java  (fragment, not runnable on its own)
package dev.taskflow.task;                          // first line: must match the folder path

import java.util.List;                              // import a single class
import java.util.Optional;
import static java.util.Objects.requireNonNull;     // static import: use requireNonNull(...) unqualified

import dev.taskflow.common.error.NotFoundException;

public class TaskService { /* ... */ }
```

| TS | Java |
|---|---|
| `import { List } from 'java/util'` | `import java.util.List;` |
| `import * as util` | `import java.util.*;` (allowed, but formatters usually expand it) |
| relative imports `./x` | **none**: always the fully qualified package |
| `export` | `public` |
| not exported | package-private (no modifier) |
| `node_modules` | the **classpath**: your compiled classes plus every dependency JAR, assembled by Maven |

**Package-by-feature** (`task/`, `board/`, `auth/`) rather than package-by-layer (`controllers/`, `services/`) is the modern Spring convention. It lets you keep classes package-private within a feature.

---

## 13. Annotations: how Spring's "magic" works

An annotation (`@Something`) is **metadata attached to a class, method, field or parameter**. On its own it does nothing. Some other code (the compiler, a framework, a test runner) reads it, usually at runtime through **reflection**. This differs from TS decorators, which are functions that run and can replace what they decorate.

Here's a tiny version of what Spring does when it sees `@GetMapping`:

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.Method;

@Retention(RetentionPolicy.RUNTIME)        // keep the annotation in the .class file so reflection can see it
@Target(ElementType.METHOD)
@interface Get { String value(); }          // declares an annotation type with one attribute

class TaskController {
    @Get("/api/v1/tasks")
    public String list() { return "[task1, task2]"; }

    @Get("/api/v1/boards")
    public String boards() { return "[board1]"; }
}

void main() throws Exception {
    // "Framework" code: scan the class, find annotated methods, build a route table, dispatch
    var controller = new TaskController();
    for (Method m : TaskController.class.getDeclaredMethods()) {
        Get route = m.getAnnotation(Get.class);
        if (route != null && route.value().equals("/api/v1/tasks")) {
            System.out.println("GET " + route.value() + " -> " + m.invoke(controller));
        }
    }
    // → GET /api/v1/tasks -> [task1, task2]
}
```

That's the core of Spring: at startup it **scans your packages** for annotated classes (`@RestController`, `@Service`, `@Repository`, `@Configuration`), **creates one instance of each** (a "bean"), **injects constructor dependencies** from the other beans (the DI container), and reads method annotations (`@GetMapping`, `@Transactional`, `@Scheduled`) to wire up routing, transactions and schedules. NestJS does the same with TS decorators plus `reflect-metadata`, which is why it's the bridge.

Annotations you'll meet first:

| Annotation | Meaning | NestJS equivalent |
|---|---|---|
| `@SpringBootApplication` | Entry point. Enables component scanning and auto-configuration. | `NestFactory.create(AppModule)` |
| `@RestController` + `@RequestMapping("/api/v1/tasks")` | HTTP controller | `@Controller('tasks')` |
| `@GetMapping("/{id}")`, `@PostMapping` | route handler | `@Get(':id')`, `@Post()` |
| `@PathVariable`, `@RequestParam`, `@RequestBody @Valid` | parameter binding plus validation | `@Param`, `@Query`, `@Body()` + ValidationPipe |
| `@Service`, `@Repository`, `@Component` | "register me as a bean" | `@Injectable()` |
| `@Configuration` + `@Bean` | factory methods for beans | `useFactory` providers |
| `@Transactional` | run the method in a DB transaction | (manual in NestJS) |
| `@Override` | compiler check only (no runtime effect) | `override` keyword |

---

## 14. Concurrency: threads, not an event loop

Node runs your code on one thread and uses `await` to avoid blocking. Java runs **many threads in parallel**. Spring MVC (which we use) gives every HTTP request its own thread, and code simply **blocks** on I/O. There's no `async`/`await`, and none is needed.

```java
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

String fetchUser(int id) {
    try {
        Thread.sleep(Duration.ofMillis(100));           // blocking I/O stand-in: blocks only THIS thread
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        throw new RuntimeException(e);
    }
    return "user-" + id;
}

void main() {
    long start = System.currentTimeMillis();

    // Virtual threads (Java 21+): millions of cheap threads, so blocking code scales like async code
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        var futures = List.of(1, 2, 3).stream()
            .map(id -> CompletableFuture.supplyAsync(() -> fetchUser(id), executor))   // ≈ Promise
            .toList();
        var users = futures.stream().map(CompletableFuture::join).toList();            // ≈ await Promise.all
        System.out.println(users + " in ~" + (System.currentTimeMillis() - start) / 100 * 100 + "ms");
        // → [user-1, user-2, user-3] in ~100ms
    }

    // Shared mutable state needs thread-safe types; in Node, a plain `count++` is always safe
    var counter = new AtomicInteger();
    try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
        for (int i = 0; i < 1000; i++) executor.submit(counter::incrementAndGet);
    }                                                    // close() waits for all tasks
    System.out.println(counter.get());                   // → 1000
}
```

- **Virtual threads** make the thread-per-request model as scalable as Node's event loop for I/O-bound work. Our Spring repo enables them with `spring.threads.virtual.enabled: true`.
- **Shared state is the new danger.** Singleton beans (every `@Service`) are shared by all request threads, so they must not hold per-request mutable fields. Keep services stateless and use `ConcurrentHashMap` / `Atomic*` when you really need shared state.
- `CompletableFuture` ≈ `Promise` (`thenApply` ≈ `.then`, `join()` ≈ `await`). You'll rarely need it in Spring MVC.

---

## 15. Dates and times

Use the `java.time` package. **Never** use the legacy `java.util.Date` / `Calendar`.

```java
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;

void main() {
    Instant created = Instant.parse("2026-10-25T12:00:00Z");   // a point on the UTC timeline, maps to timestamptz
    Instant due = created.plus(Duration.ofDays(3));
    System.out.println(due);                                   // → 2026-10-28T12:00:00Z  (ISO-8601, our wire format)
    System.out.println(ChronoUnit.HOURS.between(created, due));  // → 72
    System.out.println(due.isAfter(created));                  // → true
    System.out.println(OffsetDateTime.ofInstant(created, ZoneOffset.ofHours(5)).getHour());   // → 17
}
```

`Instant` ↔ JS `Date` (both are a UTC timestamp). `LocalDate` is a date without time or zone (a birthday). `OffsetDateTime` / `ZonedDateTime` are for when you need a zone. All of them are immutable.

---

## 16. Cheat sheet

| TypeScript | Java |
|---|---|
| `const x = 1` | `final var x = 1;` (local) / `private final int x;` (field) |
| `` `Hi ${name}` `` | `"Hi %s".formatted(name)` or `"Hi " + name` |
| `a === b` (strings, objects) | `a.equals(b)` / `Objects.equals(a, b)` (null-safe) |
| `arr.length` / `str.length` | `list.size()` / `array.length` / `str.length()` |
| `[1, 2]` | `List.of(1, 2)` (immutable) / `new ArrayList<>(List.of(1, 2))` |
| `{ a: 1 }` | `Map.of("a", 1)` or, better, a `record` |
| `arr.map(f).filter(p)` | `list.stream().map(f).filter(p).toList()` |
| `arr.find(p)` | `list.stream().filter(p).findFirst()` → `Optional` |
| `arr.includes(x)` | `list.contains(x)` |
| `[...a].sort((x, y) => x.n - y.n)` | `list.stream().sorted(Comparator.comparingInt(X::n)).toList()` |
| `(x) => x * 2` | `x -> x * 2` |
| `obj.method.bind(obj)` | `obj::method` |
| `interface User { id: string }` (data) | `record User(String id) {}` |
| `interface Repo { find(): T }` (behaviour) | `interface Repo { T find(); }` |
| union + `switch (e.type)` | `sealed interface` + `switch` with record patterns |
| `x ?? y` | `Objects.requireNonNullElse(x, y)` |
| `throw new Error('x')` | `throw new IllegalStateException("x");` |
| `JSON.stringify(o)` | Jackson `objectMapper.writeValueAsString(o)` (Spring does it for you) |
| `process.env.X` | `System.getenv("X")`; in Spring: `application.yml` + `@ConfigurationProperties` |
| `new Date().toISOString()` | `Instant.now().toString()` |
| `async/await` | plain blocking calls on (virtual) threads |
| `console.log` | `System.out.println` (scripts), SLF4J `log.info("x={}", x)` (apps) |
| `npm i` / `npm run build` / `npm test` | `./mvnw` handles it: `./mvnw package` / `./mvnw test` |
| `tsc --noEmit` | `./mvnw compile` |
| Prettier | `./mvnw spotless:apply` (google-java-format) |
