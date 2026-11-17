## Part 3 · Server state & client state

### Step 3.1 · The query client and cache keys

**Goal:** TanStack Query configured once, and every cache key defined in one module.

**Files:** `src/lib/query-client.ts`, `src/lib/queries/keys.ts`, `src/main.tsx`

```bash
npm install --save-exact @tanstack/react-query@5.107.1
npm install -D --save-exact @tanstack/react-query-devtools@5.107.1
```

The devtools give you a floating panel that shows every query, its key, its data and its state. They're tree-shaken out of production builds automatically.

@show src/lib/query-client.ts 1-13

@show src/lib/queries/keys.ts 1-18

Mount the cache for the whole app. These are the provider lines `main.tsx` was indented for in Step 1.2:

@show src/main.tsx 1-2

@show src/main.tsx 6-6

@show src/main.tsx 15-15

@show src/main.tsx 17-18

**What's new**
- **`staleTime: 30_000`**: data younger than 30 s is served from cache without a background refetch. The default (`0`) refetches on every mount and window focus; for a board kept live by WebSockets (Part 8) that's wasted requests.
- **`retry` as a function:** the default retries everything 3 times with backoff, including a 404 or a 403 that will never succeed. Retrying only network errors and 5xx keeps "not found" screens instant.
- **`<QueryClientProvider>`** puts the one `QueryClient` in React context, so every `useQuery` below it shares one cache. It wraps the router, so every route (and the kit page) is inside it. `<ReactQueryDevtools>` is the floating flower button in the bottom-left corner of the dev server; open it on the kit page and you'll see an empty cache.
- **`as const` keys** make each key a readonly tuple type, so `keys.board(id)` is `readonly ['board', string]` and a typo in a hand-written key can't silently create a second cache entry.

> 🧠 **DSA & scalability · hierarchical cache keys**
> - **Data structure:** TanStack Query's cache is a map from a *serialised key array* to a query; matching for invalidation is by **prefix**.
> - **Algorithm:** `invalidateQueries({ queryKey: ['workspaces', id] })` marks stale every query whose key *starts with* those elements: the workspace, its members, projects, invitations, activity and searches, in one call.
> - **Complexity:** O(Q) over cached queries per invalidation (Q is small: tens to hundreds).
> - **Why it scales:** you never enumerate dependents by hand. A new query under `['workspaces', id, …]` is covered by every existing invalidation automatically.
> - **Rejected:** flat string keys like `'members-' + id` (no prefix semantics, so every invalidation has to list exact keys and inevitably misses one).

**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add the query client and cache keys"
```

### Step 3.2 · Toasts and preferences

**Goal:** two more small global stores: transient error toasts, and the 3D/flat board preference that survives a reload.

**Files:** `src/stores/toasts.ts`, `src/stores/preferences.ts`, `src/components/orbit/toaster.tsx`.

@show src/stores/toasts.ts 1-43

@show src/stores/preferences.ts 1-20

@show src/components/orbit/toaster.tsx 1-38

**What's new**
- **`persist` middleware** serialises the store to `localStorage` under `taskflow-preferences` and rehydrates it on load. That's fine for a UI preference, and exactly why the access token is *not* stored this way (Step 2.1).
- **`toastError(err, action)`** is a plain function, not a hook: it calls `useToasts.getState().push(…)`, so mutation callbacks can use it without being inside a component.
- **`aria-live="polite"`** on the toast container makes screen readers announce new toasts without stealing focus.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint
```

Expected: no output from either.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add toast and preference stores"
```

### Step 3.3 · Session bootstrap

**Goal:** after a page reload, quietly trade the refresh cookie for a new access token, then load the user. Also: sign in, sign out.

**Files:** `src/lib/session.ts`.

@show src/lib/session.ts 1-41

**What's new**
- **Memoising `bootstrapSession`** with `bootstrapping ??=` matters because React 18+ **StrictMode runs effects twice** in development (mount, unmount, mount) to flush out missing cleanups. Two refresh calls would present the same refresh token twice, and the server would revoke the session as stolen (Step 2.2). The memo makes the second call a no-op.
- **`queryClient.clear()` on sign-out** drops every cached response, so the next person to sign in on this tab never sees the previous user's workspaces, even for a frame.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: no type or lint errors; `Tests  5 passed (5)`.

@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add session bootstrap and sign-out"
```


---
