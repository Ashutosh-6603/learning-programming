## Part 6 · Board building blocks

The board page (Part 9) is the most complex screen, so its pieces come first, each one testable on its own.

### Step 6.1 · The board cache: pure reducers

**Goal:** every change to the cached board (a server response, an optimistic drag, a WebSocket event) goes through a few pure functions that return a **new** board.

**Files:** `src/lib/board-cache.ts`, `src/lib/board-cache.test.ts`.

Ordering and the two basic updates:

@show src/lib/board-cache.ts 1-29

The optimistic move:

@show src/lib/board-cache.ts 30-50

Applying a server event (used by Part 8):

@show src/lib/board-cache.ts 51-78

Turning a drop position into the API's `afterTaskId`, and the button alternative to dragging:

@show src/lib/board-cache.ts 79-109

@show src/lib/board-cache.test.ts 1-105

**What's new**
- **Never mutate cached data.** TanStack Query compares by reference to decide what changed; mutating `board.columns[0].tasks` in place would leave subscribers showing stale data. Every function here copies only the path it changes (`{ ...board, columns: … }`), and unchanged columns keep their identity, so React skips them.
- **`byPosition` compares strings with `<`, not `localeCompare`.** Positions are fractional-index keys (README §7) that the database sorts with `COLLATE "C"`: plain byte order. `localeCompare` would order `'a0'` and `'A0'` by language rules and disagree with the server.
- **`applyServerMessage` returns the *same* board** for events that don't touch it. TanStack Query sees no change and re-renders nothing.

> 🧠 **DSA & scalability · ordering a column**
> - **Data structure:** each column's `tasks` array sorted by `position`, a string key from fractional indexing. The server stores it in Postgres as `text COLLATE "C"`, under a `UNIQUE (column_id, position)` constraint (a unique B-tree index).
> - **Algorithm (move):** the client only says *where*: "in column C, right after task A" (`afterTaskId`, or `null` for the top). The server computes `keyBetween(A.position, B.position)`, a new key strictly between the neighbours, and writes **one row**. The optimistic version just splices the array; the server's answer replaces it with the real key, and `upsertTask` re-sorts.
> - **`afterTaskIdFor`:** remove the dragged card from the list first, then find the insertion index. Without removing it, dropping a card right below itself would name *itself* as its own predecessor.
> - **Complexity:** a move is O(k log k) on the client for a column of k cards (re-sort), and one indexed `UPDATE` on the server, independent of k.
> - **Why it scales:** integer positions (`0, 1, 2…`) would renumber every following card on each move (O(k) writes, and lock contention when two people drag in the same column). Fractional keys never renumber.
> - **Rejected:** sending the whole new order of the column (O(k) payload and a lost-update race between two users), or floats (they run out of precision after ~50 halvings).

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  6 passed (6)`, `Tests  37 passed (37)`.


@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add pure board-cache reducers"
```

### Step 6.2 · Board queries with optimistic moves

**Goal:** load a board, create tasks, and move them, with the card jumping instantly and snapping back if the server says no.

**Files:** `src/lib/queries/board.ts`.

@show src/lib/queries/board.ts 1-46

**What's new**
- **The optimistic-update recipe** (TanStack Query's three callbacks):
  1. `onMutate` (before the request): `cancelQueries` so an in-flight refetch can't overwrite our change, snapshot the current board, apply the change, and return the snapshot as `context`.
  2. `onError`: put the snapshot back.
  3. `onSuccess`: apply the server's version (it has the real `position`).
- **`setQueryData` with an updater** `(b) => (b ? upsertTask(b, task) : b)` handles "no board cached" (the user navigated away) without crashing.

> 🧠 **DSA & scalability · optimistic update with rollback**
> - **Data structure:** an immutable snapshot of the board, held in the mutation's `context`.
> - **Algorithm:** apply locally → send → on error restore the snapshot; on success replace with the server's truth. Because the board is immutable, the snapshot is O(1) to keep: it's just the old reference.
> - **Why it scales (for people):** the UI responds in one frame regardless of network latency; a 300 ms round trip doesn't make dragging feel sticky.
> - **Edge it accepts:** two quick moves where the first fails roll back to the snapshot taken *before the second*, then the second's success re-applies. The WebSocket refetch on reconnect (Part 8) heals any remaining drift.
> - **Rejected:** waiting for the server (laggy), or never rolling back (silently wrong UI).

**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add board queries with optimistic moves"
```

### Step 6.3 · Dates, cards and columns

**Goal:** the task card (with drag-and-drop and arrow buttons), the column (with its count and WIP limit), and the "Launch a new task" form.

**Files:** `src/lib/format.ts`, `src/lib/format.test.ts`, `src/components/board/{task-card,board-column,new-task-form}.tsx`.

@show src/lib/format.ts 1-41

@show src/lib/format.test.ts 1-44

The card's props and its native drag-and-drop handlers:

@show src/components/board/task-card.tsx 1-38

Its markup: one button to open it, and two arrow buttons that move it without a mouse:

@show src/components/board/task-card.tsx 39-104

@show src/components/board/board-column.tsx 1-82

@show src/components/board/new-task-form.tsx 1-52

**What's new**
- **Native HTML5 drag-and-drop** instead of a library. The card is `draggable`; `onDragStart` puts the task id in `dataTransfer`; `onDragOver` must call `preventDefault()` or the browser won't allow a drop there. `getBoundingClientRect()` tells us whether the pointer is in the card's top or bottom half, which decides "drop before" or "drop after".
- **Drag-and-drop is not accessible on its own.** The ← / → buttons give keyboard and screen-reader users the same power ("Move TF-2 forward"). They're also what the component tests click.
- **`Intl.RelativeTimeFormat`** produces "3 minutes ago" or "yesterday" with `numeric: 'auto'`, built into the browser with no library.
- **`dateInputToIso` stores noon UTC.** A due *date* stored at midnight UTC shows as the previous day for anyone west of Greenwich; noon keeps the calendar day stable in every timezone from UTC−12 to UTC+11.
- **`React.SubmitEvent`** is the precise type for a form's submit event. `FormEvent` is deprecated in React 19's types, and the lint rule `no-deprecated` flags it.

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  7 passed (7)`, `Tests  41 passed (41)`.


@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add task cards, columns and the new-task form"
```

### Step 6.4 · Search

**Goal:** one box that dims non-matching cards on the board instantly, and shows full-text results from the whole workspace with the matched words highlighted.

**Files:** `src/lib/headline.ts`, `src/lib/headline.test.ts`, `src/hooks/use-debounced-value.ts`, `src/lib/queries/search.ts`, `src/components/board/search-box.tsx`.

The server returns a Postgres `ts_headline` snippet like `fix the <mark>login</mark> &amp; signup`. Parse it into parts instead of injecting HTML:

@show src/lib/headline.ts 1-31

@show src/lib/headline.test.ts 1-31

@show src/hooks/use-debounced-value.ts 1-15

@show src/lib/queries/search.ts 1-11

@show src/components/board/search-box.tsx 1-99

**What's new**
- **No `dangerouslySetInnerHTML`.** The server escapes everything except `<mark>`, but trusting that would make one server bug an XSS hole in every browser. Splitting on the two literal tags and rendering text nodes means a `<script>` in a task title is always just text. The third test proves an *escaped* `&lt;mark&gt;` stays text too.
- **`onMouseDown={(e) => e.preventDefault()}`** on result links: clicking a result fires the input's `blur` *before* the click, which would close the list and swallow the click. Preventing the mousedown's default keeps focus in the input until the click lands.
- **`enabled: q.trim().length > 0`** stops the query from firing for an empty box; `staleTime: 10_000` means retyping a recent search is instant.

> 🧠 **DSA & scalability · debounced search**
> - **Data structure:** one timer per hook instance (`setTimeout` id), plus TanStack Query's cache keyed by the query string.
> - **Algorithm:** every keystroke resets the timer; only when typing pauses for 250 ms does the debounced value change, which changes the query key and fires one request. Earlier keys stay cached, so backspacing to a previous term is a cache hit.
> - **Complexity:** typing "telescope" sends **1** request instead of 9.
> - **Why it scales:** the server runs `websearch_to_tsquery` against a GIN index (README, data model), which is fast but not free. Debouncing caps load at about 4 queries/second per user even for fast typists, and the cache removes repeats.
> - **Rejected:** throttling (fires mid-word while you type), and searching the loaded board client-side only (misses other projects and descriptions; that's what the instant *dimming* is for).

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: `Test Files  8 passed (8)`, `Tests  45 passed (45)`.

@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add workspace search with safe highlights"
```


---
