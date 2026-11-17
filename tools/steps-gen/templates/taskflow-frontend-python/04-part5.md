## Part 5 · Workspaces & projects

### Step 5.1 · The carousel's geometry

**Goal:** the math behind the "Choose your world" screen, as pure functions: workspaces are panels on a 3D ring that rotates to bring one to the front.

**Files:** `src/lib/carousel.ts`, `src/lib/carousel.test.ts`.

@show src/lib/carousel.ts 1-66

@show src/lib/carousel.test.ts 1-59

**What's new**
- **`((i % n) + n) % n`**: JavaScript's `%` is a *remainder*, not a modulo, so `-1 % 5` is `-1`. Adding `n` and taking `%` again maps any integer into `0..n-1`. You'll meet this in every language with C-style `%` (Java too; Python's `%` already floors).
- **The rotation is unbounded** for a full ring: pressing "next" five times on five panels gives `rotation = 5`, not `0`. CSS then animates `rotateY` from `-288deg` to `-360deg`, a smooth step forward. Wrapping to `0` would make the transition spin the ring all the way back.
- **Why `MIN_SLOTS = 5`:** with 3 panels spaced 120° apart, the neighbours face *away* from the viewer (more than 90°), and `backface-visibility: hidden` makes them vanish. Spacing them as if there were 5 keeps the neighbours at ±72°, visible and tilted, like the design.

> 🧠 **DSA & scalability · a ring on a circle**
> - **Data structure:** none beyond the array of workspaces; positions are computed from the index.
> - **Algorithm:** panel *i* sits at angle `i · 360°/slots`, pushed out by `radius` (`rotateY(θ) translateZ(r)`). The ring as a whole is rotated by `-rotation · 360°/slots`. To reach panel *j*, take the **shortest signed step** on the ring: `δ = wrap(j − current)`, and if `δ > n/2` go `δ − n` (backwards). The radius that keeps neighbours from intersecting is `r = (w/2) / tan(π/slots)`, from the isosceles triangle formed by the centre and one panel's edges.
> - **Complexity:** O(1) per panel per render; O(n) per frame for n panels.
> - **Why it scales:** the browser composites the transforms on the GPU; React only re-renders when `rotation` changes.
> - **Rejected:** a 2D slider (doesn't match the design), and a WebGL scene (a 3D engine for five rectangles that are also buttons, losing native focus, labels and hit-testing).

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  3 passed (3)`, `Tests  19 passed (19)`.


@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add carousel geometry"
```

### Step 5.2 · Workspace queries and slugs

**Goal:** fetch workspaces with cursor pagination, create workspaces and projects, and suggest a slug and a project key while the user types a name.

**Files:** `src/lib/queries/workspaces.ts`, `src/lib/slug.ts`, `src/lib/slug.test.ts`.

@show src/lib/queries/workspaces.ts 1-35

@show src/lib/slug.ts 1-22

@show src/lib/slug.test.ts 1-19

**What's new**
- **`useInfiniteQuery`** stores a list of *pages*. `initialPageParam` is the first cursor (`undefined`), `getNextPageParam` reads the next one from the last page, and `fetchNextPage()` appends a page. `data.pages.flatMap((p) => p.items)` flattens them for rendering.
- **`?? undefined` in `getNextPageParam`:** the API's end-of-list marker is `null`, but TanStack Query's is `undefined` (that's what makes `hasNextPage` false).
- **`normalize('NFKD')`** splits "é" into "e" + a combining accent, and the next regex drops the accent: `Café` → `cafe`.

> 🧠 **DSA & scalability · cursor pagination on the client**
> - **Data structure:** an ordered list of pages, each `{ items, nextCursor }`; the cursor is an opaque string from the server (a base64 keyset: the last row's sort key).
> - **Algorithm:** first request without a cursor; each "load more" sends the last page's `nextCursor`; stop when it's `null`.
> - **Complexity:** each page is O(limit) to transfer; the server answers each in O(log N + limit) with an index seek, so page 1,000 costs the same as page 1.
> - **Why it scales:** inserts while you page don't shift later pages (unlike `offset`, where a new row makes you see one item twice). And the client never computes offsets.
> - **Rejected:** `?page=3` offset pagination, which the contract forbids for list endpoints (README §8).

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  4 passed (4)`, `Tests  21 passed (21)`.


@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add workspace queries and slug helpers"
```

### Step 5.3 · The workspaces screen

**Goal:** "Choose your world": the 3D carousel, a create-workspace dialog, and the user menu.

**Files:** `src/components/orbit/{user-menu,create-workspace-dialog}.tsx`, `src/pages/orbit-page.tsx`, `src/router.tsx`.

@show src/components/orbit/user-menu.tsx 1-25

@show src/components/orbit/create-workspace-dialog.tsx 1-71

The page. State and keyboard handling first:

@show src/pages/orbit-page.tsx 1-29

The header, and the loading, error and empty states:

@show src/pages/orbit-page.tsx 30-58

The ring itself. Every panel is a real `<button>`:

@show src/pages/orbit-page.tsx 59-103

The controls under the ring:

@show src/pages/orbit-page.tsx 104-160

Register it as the home route, the first child of `RequireAuth`:

@show src/router.tsx 30-33 | inside the `children: [` under `element: <RequireAuth />`

**What's new**
- **`lazy: async () => ({ Component: … })`** splits the page into its own JavaScript chunk, downloaded the first time the route matches. The launch page stays in the main bundle (it's what a signed-out visitor needs first); everything behind sign-in loads on demand. `npm run build` now prints one `orbit-page-….js` file.
- **Accessible 3D:** only the front panel has `tabIndex={0}`; the others are `-1`, so Tab doesn't wander around the back of the ring. Each panel's `aria-label` says what clicking does ("Enter Acme" vs "Rotate to Acme"). The arrow keys are handled on the carousel `<section>`, not on `window`, so they never hijack typing elsewhere.
- **`dirtyFields.slug`** (react-hook-form) tells you whether the user has typed in the slug field. Until they do, the slug follows the name; after that, it's theirs.
- **`void navigate(…)`:** React Router 8's `navigate` returns a promise. `void` says "intentionally not awaited", which `no-floating-promises` requires.

**✅ Checkpoint:** with the backend running and `npm run dev`, sign in. You see **Create your first world**. Create three workspaces (the slug fills itself in). Each one opens its (empty) page, which isn't built yet ("Lost in space"). Go back to `/`: three panels on the ring, the arrows and ←/→ keys rotate it, and clicking a side panel rotates it to the front.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add the workspaces carousel screen"
```

### Step 5.4 · The workspace page and permissions

**Goal:** a workspace's projects, with "New project" shown only to admins and owners.

**Files:** `src/lib/permissions.ts`, `src/lib/permissions.test.ts`, `src/components/orbit/create-project-dialog.tsx`, `src/pages/workspace-page.tsx`, `src/router.tsx`.

@show src/lib/permissions.ts 1-26

@show src/lib/permissions.test.ts 1-24

@show src/components/orbit/create-project-dialog.tsx 1-77

@show src/pages/workspace-page.tsx 1-97

@show src/router.tsx 34-39 | after the `'/'` route

**What's new**
- **The UI's permission checks only decide what to *show*.** The server checks every request again (README §5), so hiding a button is about not offering an action that will fail, not about security.
- **`RANK` turns roles into numbers**, so "admin or higher" is one comparison (`atLeast(role, 'admin')`) instead of a list.
- **`setValueAs`** on the key field upper-cases whatever is typed before validation, so `tf` is accepted as `TF`.
- **404, not 403, for non-members:** the API answers 404 for a workspace you don't belong to, so it doesn't reveal that the workspace exists. `NotMember` handles both "doesn't exist" and "not yours" with one message.

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  5 passed (5)`, `Tests  24 passed (24)`.

In the browser, enter a workspace, create a project called **TaskFlow API** (the key suggests `TA`). You're sent to its board URL, which doesn't exist yet (Part 9). Back on the workspace page, the project is listed with its planet.

@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add the workspace page and permissions"
```


---
