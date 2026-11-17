## Part 9 · Attachments (presigned S3 uploads)

Files never pass through the API. The client asks for an upload slot, PUTs the file **straight to S3** (RustFS locally) with a presigned URL, then tells the API it's done; the API checks the stored object's size and marks the attachment ready. Downloads work the same way in reverse.

### Step 9.1 · The storage wrapper

**Goal:** an injectable S3 client with exactly the four operations the app needs.

**Files:** `src/infra/storage.service.ts`, `src/infra/storage.module.ts`

```bash
npm i -E @aws-sdk/client-s3@3.1167.0 @aws-sdk/s3-request-presigner@3.1167.0
```

- **`@aws-sdk/client-s3`** is AWS SDK v3's S3 client: one command class per API call (`PutObjectCommand`, `HeadObjectCommand`), sent with `client.send()`. **`@aws-sdk/s3-request-presigner`** signs a command into a URL that a browser can use without credentials. Both work with any S3-compatible store.

@show src/infra/storage.service.ts 1-47

@show src/infra/storage.service.ts 48-90

@show src/infra/storage.module.ts all

**What's new**
- **Two clients.** The API reaches RustFS at `S3_ENDPOINT` (inside Docker that's `http://rustfs:9000`), but a presigned URL is for the **browser**, and its signature covers the host name. So URLs are signed by a second client configured with `S3_PUBLIC_ENDPOINT`. Signing is local computation: the presigner never connects anywhere.
- **`forcePathStyle: true`** puts the bucket in the path (`host/bucket/key`) instead of a subdomain (`bucket.host`), which local S3 servers need.
- `ContentLength` in the signed PUT means S3 rejects an upload of any other size. `ResponseContentDisposition` makes the download save under the original file name (RFC 5987 encoding for non-ASCII names).
- `deletePrefix` pages through `ListObjectsV2` (1000 keys a page) and deletes each page in one `DeleteObjects` call.
- `StorageModule` is tiny and **not global**: only the attachments module and the worker need S3.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: s3 storage wrapper`

### Step 9.2 · The attachments service and routes

**Goal:** request an upload, complete it, list ready attachments, download and delete.

**Files:** `src/modules/attachments/attachment.dto.ts`, `src/modules/attachments/attachments.service.ts`, `src/modules/attachments/attachments.controller.ts`, `src/modules/attachments/attachments.module.ts`

@show src/modules/attachments/attachment.dto.ts all

**What's new**
- File names may not contain slashes, backslashes or control characters; content types must look like `type/subtype`; sizes are 1 byte to 25 MB. `// eslint-disable-next-line no-control-regex` documents that the control-character range in the regex is deliberate.

@show src/modules/attachments/attachments.service.ts 1-52

@show src/modules/attachments/attachments.service.ts 53-110

@show src/modules/attachments/attachments.service.ts 111-140

@show src/modules/attachments/attachments.controller.ts all

@show src/modules/attachments/attachments.module.ts all

**What's new**
- **The id is generated in Node** (`uuidv7()`), unlike everywhere else, because the storage key `projects/{projectId}/tasks/{taskId}/{id}` must be known before the row exists. `insert` with an explicit `id` overrides the column default.
- **`complete` is idempotent**: calling it twice returns the ready attachment. It trusts S3, not the client: `HeadObject` must find the object, with exactly the declared size.
- Only `ready` attachments are listed or downloadable; pending ones are cleaned up by a scheduled job (Part 11) if the upload never completes.

> **🧠 DSA & scalability · presigned uploads**
> - **Data structure:** an `attachments` row (status `pending` → `ready`) plus an S3 object under a hierarchical key; partial indexes `attachments_task_idx … WHERE status = 'ready'` and `attachments_pending_idx … WHERE status = 'pending'`.
> - **Algorithm:** create row + sign URL (no I/O to S3) → client PUTs to S3 → `complete` HEADs the object, checks the size, flips the status in a transaction with the activity event.
> - **Complexity:** O(1) API work per upload, independent of file size.
> - **Why it scales:** the bytes go client → S3 directly; API instances never buffer files, so a 25 MB upload costs the API the same as a 1 KB one. Prefix keys make "delete everything for this task/project" one listing.
> - **Rejected:** multipart uploads through the API (memory and bandwidth on every instance); public buckets (anyone with a key could read files).

**✅ Checkpoint**

```bash
npx tsc --noEmit && npx eslint .
```

Expected: no output.

@verify npx tsc --noEmit
@verify npx eslint .

**Commit:** `feat: attachments service and routes`

### Step 9.3 · Wiring and tests

**Goal:** the module in the app, the bucket guaranteed in tests, and an end-to-end upload test against real RustFS.

**Files:** `src/app.module.ts`, `test/global-setup.ts`, `test/attachments.e2e-spec.ts`

@show src/app.module.ts 8-8

@show src/app.module.ts 31-31

@show test/global-setup.ts 1-1

@show test/global-setup.ts 4-4

@show test/global-setup.ts 24-36 | add at the end of `setup()`, before its closing `}`

**What's new**
- The global setup now also makes sure the bucket exists (`HeadBucket`, create on failure), so tests pass even if `s3-init` hasn't run. `validateEnv` reads the S3 settings with the same rules as the app.

@chunks test/attachments.e2e-spec.ts all

**What's new**
- The first test does what a browser does: request a slot, `fetch(url, { method: 'PUT' })` the bytes **to RustFS**, complete, then download through the presigned GET and compare the bytes.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  13 passed (13)
      Tests  68 passed (68)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx nest build
@verify npx vitest run

**Commit:** `feat: attachments via presigned S3 uploads`

---
