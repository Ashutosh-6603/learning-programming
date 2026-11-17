## Part 7 · Task details

### Step 7.1 · Task, comment, attachment and member queries

**Goal:** the remaining server-state hooks, and the three-step presigned upload.

**Files:** `src/lib/uploads.ts`, `src/lib/queries/tasks.ts`, `src/lib/queries/members.ts`.

@show src/lib/uploads.ts 1-24

@show src/lib/queries/tasks.ts 1-72

@show src/lib/queries/members.ts 1-45

**What's new**
- **The upload never touches the API's bandwidth.** Step 1 asks the API for a presigned URL; step 2 `PUT`s the bytes straight to S3 (RustFS locally); step 3 tells the API "done", and the API checks the object exists with the declared size. The `PUT` has no `Authorization` header and no cookies: the signature in the URL *is* the permission, and it expires in 15 minutes.
- **`enabled: taskId !== null`** keeps `useTask` idle until there's an id. The hook is always called (hooks can't be conditional); `enabled` decides whether it fetches.
- **Mutations return objects of mutations** (`useMemberMutations` returns `{ changeRole, remove, invite, revoke }`): one hook call per component, each mutation with its own pending/error state.

**✅ Checkpoint**

```bash
npm run typecheck
```

Expected: no output.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add task, comment, attachment and member queries"
```

### Step 7.2 · Comments and activity

**Goal:** the task dialog's first two tabs.

**Files:** `src/components/board/task-comments.tsx`, `src/components/board/task-activity.tsx`.

@show src/components/board/task-comments.tsx 1-84

@show src/components/board/task-activity.tsx 1-44

**What's new**
- **`whitespace-pre-wrap`** keeps the line breaks people type in comments, without parsing anything as HTML.
- **`<time dateTime={iso}>`** carries the machine-readable timestamp next to the human "3 minutes ago".
- **Invalidate, don't append.** After posting a comment, the hook invalidates `comments` and `activity` and lets them refetch. Appending the response would be faster, but the activity entry is created by the server, so refetching is the simplest way to show both correctly.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint
```

Expected: no output from either.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add the comments and activity tabs"
```

### Step 7.3 · Files

**Goal:** list, upload, download and delete attachments.

**Files:** `src/components/board/task-files.tsx`.

@show src/components/board/task-files.tsx 1-100

**What's new**
- **A hidden file input, opened by a visible button.** `<input type="file">` is notoriously hard to style; it stays in the DOM (`sr-only`) for accessibility, and the button calls `input.current?.click()`.
- **`e.target.value = ''`** after reading the file, so choosing the *same* file again still fires `onChange`.
- **The download URL is fetched on click**, because it's presigned for only 5 minutes. A URL rendered into an `href` when the dialog opened could have expired by the time someone clicks it.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint
```

Expected: no output from either.

@verify npx tsc -b --noEmit && npx eslint .

**Commit:**

```bash
git add -A && git commit -m "feat: add attachment uploads and downloads"
```

### Step 7.4 · The task dialog

**Goal:** the flipping task card from the design: edit the title, status, priority, assignee, due date and description; move the task along its "trajectory"; delete it; and switch between comments, activity and files.

**Files:** `src/components/board/task-dialog.tsx`.

Props and constants:

@show src/components/board/task-dialog.tsx 1-30

Saving and moving:

@show src/components/board/task-dialog.tsx 31-68

The dialog shell: key, title (editable for members), and an accessible description:

@show src/components/board/task-dialog.tsx 69-107

The four stats, each one a control:

@show src/components/board/task-dialog.tsx 108-177

The description and the trajectory bar:

@show src/components/board/task-dialog.tsx 178-218

Move back, advance, delete:

@show src/components/board/task-dialog.tsx 219-258

The tabs, and the small `Stat` wrapper:

@show src/components/board/task-dialog.tsx 259-311

**What's new**
- **Radix `Dialog`** (through shadcn's wrapper) gives you the modal behavior for free: focus moves into the dialog and is trapped there, `Esc` and an outside click close it, the page behind is hidden from screen readers and can't scroll. `DialogTitle` and `DialogDescription` are required for the accessible name; when the visible title is an input, the `DialogTitle` stays in the DOM as `sr-only`.
- **`onOpenAutoFocus` → `preventDefault()`**: Radix focuses the first field by default, which here is the title input with its text selected, so a stray keystroke would replace the title. Focusing the dialog itself avoids that; Tab still reaches every field.
- **Uncontrolled inputs that save on blur** (`defaultValue` + `onBlur`). The `key={`title-${task.updatedAt}`}` remounts the input when the task changes on the server (say, a teammate renamed it), so it shows the new value instead of keeping stale text.
- **Merge-patch, field by field:** `save({ priority })` sends only `{"priority": "high"}`. Two people editing *different* fields of the same task never overwrite each other.
- **A real ARIA tab pattern:** `role="tablist"`, `role="tab"` with `aria-selected` and `aria-controls`, and a `role="tabpanel"` labelled by its tab.

**✅ Checkpoint**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: no errors and the same `Tests  45 passed` as Part 6. The dialog has no screen to live on yet; Part 9 gives it one, and its test.

@verify npx tsc -b --noEmit && npx eslint . && npx vitest run

**Commit:**

```bash
git add -A && git commit -m "feat: add the task dialog"
```


---
