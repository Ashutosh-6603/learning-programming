## Part 4 · Routing & the launch screen

### Step 4.1 · Form schemas and server-error mapping

**Goal:** zod schemas that mirror the contract's constraints, and one helper that puts a server's 422 errors under the right inputs.

**Files:** `src/lib/schemas.ts`, `src/lib/forms.ts`.

```bash
npm install --save-exact react-hook-form@7.92.0 zod@4.6.7 @hookform/resolvers@7.0.6
```

`react-hook-form` keeps form state without re-rendering on every keystroke; `zod` declares the rules; `@hookform/resolvers` connects the two.

@show src/lib/schemas.ts 1-46

@show src/lib/forms.ts 1-23

**What's new**
- **zod 4's top-level formats:** `z.email()` replaces v3's `z.string().email()`. `z.infer<typeof schema>` derives the form's TypeScript type from the schema, so the two can't drift.
- **Client validation is a convenience, not security.** The same rules run on the server, which is the authority. That's why `applyProblem` exists: when they disagree (say, "email already registered", which only the server can know), the server's 422 `errors[].field` lands under the same input the client error would have.
- **`Path<T>`** is react-hook-form's type for "a valid field name of this form". Matching `field` against the list we pass keeps a misspelled server field from being set as a phantom error.

**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add form schemas and problem-to-field mapping"
```

### Step 4.2 · The launch page

**Goal:** the first screen of the Orbit design: brand, headline, a sign-in/create-account card, and the orbiting planet.

**Files:** `src/components/orbit/orbit-hero.tsx`, `src/pages/launch-page.tsx`.

The decorative half, built from the canvas's rings and floating cards:

@show src/components/orbit/orbit-hero.tsx 1-85

Now the page. A redirect guard and the sign-in form:

@show src/pages/launch-page.tsx 1-60

The create-account form and the shared submit button:

@show src/pages/launch-page.tsx 61-121

The page itself, with the two forms behind a tab-like switch:

@show src/pages/launch-page.tsx 122-175

**What's new**
- **`form.handleSubmit(async (values) => …)`** runs zod first and only calls your function with *valid, typed* values. `isSubmitting` is true while the promise is pending, which drives the button's disabled state and label.
- **`<PasswordField>`** is the field from Step 1.4: same props as `<Field>` minus `type`. The login form uses `autoComplete="current-password"` and the register form `"new-password"`, which is how password managers know whether to fill a saved password or offer to generate one.
- **`noValidate` on the form** turns off the browser's own validation bubbles, so zod's messages are the only ones and they look the same everywhere.
- **`safeNext`** prevents an *open redirect*: `/login?next=https://evil.example` must not send a freshly signed-in user to another site. Only same-site paths (`/…`, but not `//host`, which browsers treat as another origin) are honored.
- **The tabs are links** (`/login`, `/register`), not local state, so each mode has a URL and the back button works. `aria-current="page"` marks the active one for screen readers *and* styles it via Tailwind's `aria-[current=page]:` variant.
- **`['--z' as string]`** in `orbit-hero.tsx` sets a CSS custom property from `style`. React's `CSSProperties` type doesn't know custom properties, hence the cast.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint
```

Expected: no output from either. The page isn't reachable yet; the next step routes to it.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add the launch page"
```

### Step 4.3 · The router and the app shell

**Goal:** a root layout (starfield, toaster, session bootstrap), an auth guard, and the first real routes.

**Files:** `src/components/orbit/{root-layout,require-auth}.tsx`, `src/pages/not-member.tsx`, `src/router.tsx`

@show src/components/orbit/root-layout.tsx all

@show src/components/orbit/require-auth.tsx all

@show src/pages/not-member.tsx all

The route table grows its app routes after `...devRoutes`. The signed-in routes arrive one per Part, inside the `RequireAuth` children list that's empty for now:

@show src/router.tsx 2-5

@show src/router.tsx 22-29

@show src/router.tsx 54-58

**What's new**
- **Layout routes:** a route with an `element` and `children` but no `path` wraps its children without adding a URL segment. `RootLayout` renders `<Outlet />` (the matched child) between the starfield and the toaster; `RequireAuth` renders its `<Outlet />` only for a signed-in user.
- **`createBrowserRouter` + `RouterProvider`** (since Step 1.2) is React Router's *data router* API, as opposed to `<BrowserRouter><Routes>`. It's what makes route-level `lazy` possible.
- **`{ path: '*' }`** matches anything no other route claims. React Router ranks routes by specificity, not order, so `/kit` and `/login` still win over it.
- **`<Navigate to=… replace />`** redirects during render. `replace` means the login page replaces the protected URL in history, so the back button doesn't bounce the user between them.

**✅ Checkpoint:** start the FastAPI backend's whole stack (its STEPS.md, Part 13; the seed from its Step 4.9 creates the default user):

```bash
(cd ../taskflow-fastapi && docker compose --profile app up -d --wait && uv run python -m app.seed)
npm run dev
```

Expected from the seed: `default user ashutosh@test.com: created` (or `exists`). Then in the browser:

1. http://localhost:5173/ redirects to `/login?next=%2F`.
2. Sign in as **ashutosh@test.com** / **Ashutosh#1234**. You land on **Lost in space** (no home route yet; Part 5 adds it). That means the session works. (**Create account** works too, for a second user.)
3. Reload. You stay signed in (the refresh cookie did its job) and land on the same page, with no flash of the login page.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add the router, auth guard and app shell"
```

### Step 4.4 · Testing the launch page

**Goal:** component tests that drive the real forms through the real client against a mocked network.

**Files:** `src/test/render.tsx`, `src/test/fixtures.ts`, `src/pages/launch-page.test.tsx`.

A helper that renders a set of routes with a fresh query cache:

@show src/test/render.tsx 1-20

Test data builders (used from here to Part 9):

@show src/test/fixtures.ts 1-79

@show src/pages/launch-page.test.tsx 1-41

@show src/pages/launch-page.test.tsx 42-84

And the password toggle from Step 1.4, now that it's inside a real form:

@show src/pages/launch-page.test.tsx 85-103

**What's new**
- **`createMemoryRouter`** keeps the URL in memory instead of the address bar, so tests can start at any path and assert where the user ended up (`router.state.location.pathname`).
- **A fresh `QueryClient` per test** with `retry: false`: shared caches leak data between tests, and retries turn a failing request into a slow timeout.
- **`userEvent.type` / `.click`** simulate real interactions (focus, key events, input events). Queries by **label** and **role** (`getByLabelText('Email')`, `getByRole('button', { name: /launch/i })`) double as accessibility checks: if a test can't find the field by its label, neither can a screen reader.
- **`findBy…`** waits (polls) until the element appears, which is how async UI is tested without sleeps.
- **The toggle test still finds the input with `getByLabelText('Password')`.** Testing Library matches the whole label exactly by default, so the button's "Show password" isn't a second match. It asserts `type` flips between `password` and `text` and that `aria-pressed` follows: the button keeps one name and reports its state, which screen readers announce as "Show password, toggle button, pressed".

**✅ Checkpoint**

```bash
npm test
```

Expected: `Test Files  2 passed (2)`, `Tests  11 passed (11)`.

@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "test: cover the launch page with component tests"
```

---
