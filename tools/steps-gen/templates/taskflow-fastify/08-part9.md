## Part 9 · Attachments (presigned S3 uploads)

Files never pass through the API: the client asks for a **presigned URL**, uploads straight to S3 (RustFS locally), then tells the API the upload is complete. The storage wrapper is Express's unchanged; the service and routes are ported to Drizzle and TypeBox.

### Step 9.1 · The storage wrapper

**Goal:** presign uploads and downloads, check an object's size, and delete a whole prefix.

**Files:** `src/infra/storage.ts`

```bash
npm i -E @aws-sdk/client-s3@3.1167.0 @aws-sdk/s3-request-presigner@3.1167.0
```

- The **AWS SDK v3** is modular: `client-s3` for S3 commands, `s3-request-presigner` for signing URLs. It speaks to any S3-compatible service (RustFS here, AWS S3 in production).

@chunks src/infra/storage.ts all

**What's new**
- Identical to Express. Two clients: `internal` talks to `S3_ENDPOINT` (inside Docker that's `http://rustfs:9000`), while `presigner` signs URLs for `S3_PUBLIC_ENDPOINT`, the address the **browser** uses, because a signature covers the host.
- `ContentLength` is part of the signed upload, so S3 itself rejects a body of a different size.

> **🧠 DSA & scalability · deleting a prefix**
> - **Data structure:** S3 has no folders: a flat, sorted key space where "a folder" is a **key prefix** (`projects/{id}/`), which is why our keys are hierarchical.
> - **Algorithm:** `ListObjectsV2(prefix)` returns up to 1,000 keys per page plus a continuation token; one `DeleteObjects` per page (also capped at 1,000).
> - **Complexity:** O(n / 1000) round trips for n objects; memory O(1000).
> - **Why it scales:** a project with 50,000 files costs 50 list calls and 50 batch deletes, in a background job (Part 11), never in an HTTP request.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: s3 storage wrapper`

### Step 9.2 · The attachments service and routes

**Goal:** start an upload, confirm it, download it and delete it, enforcing who may do what.

**Files:** `src/modules/attachments/attachments.service.ts`, `src/modules/attachments/attachments.routes.ts`

@chunks src/modules/attachments/attachments.service.ts all

**What's new**
- **The id is generated in the app** (`uuidv7()` from `uuid`), not by Postgres's `uuidv7()` default: the storage key `projects/{p}/tasks/{t}/{id}` must exist *before* the insert. Passing `id` in `values()` overrides the column default.
- The user's file name is never part of the key, so `../../etc/passwd` can't escape the prefix; it comes back on download through `Content-Disposition` (RFC 5987 encoding for non-ASCII names).
- **No `bigint` juggling:** `sizeBytes` is a `number` (`mode: 'number'`, Step 2.3), so `size !== attachment.sizeBytes` compares two numbers. Express had to convert between `bigint` and `number` in three places.
- `headers: Type.Record(Type.String(), Type.String())` in `AttachmentUpload` is a string-to-string map: the headers the client must send with its `PUT`.

@chunks src/modules/attachments/attachments.routes.ts all

**What's new**
- **The file-name pattern is a JSON Schema `pattern`** (a regex source string): `^[^/\\\\\\u0000-\\u001f]+$` in TypeScript source is the regex `^[^/\\\u0000-\u001f]+$` after string escaping: no slash, no backslash, no control character. Ajv compiles patterns with the `u` flag, so `\u0000` escapes are valid.
- `sizeBytes` is capped at 25 MB by the schema; the database `CHECK (size_bytes > 0)` is the last line of defence.

**✅ Checkpoint**

```bash
npx tsc --noEmit
```

Expected: no output.

@verify npx tsc --noEmit

**Commit:** `feat: attachments service and routes`

### Step 9.3 · Wiring and tests

**Goal:** add storage to the infrastructure and the attachment routes to the app; make sure the test bucket exists; test the whole upload flow against real S3.

**Files:** `src/container.ts`, `src/app.ts`, `tests/global-setup.ts`, `tests/integration/attachments.test.ts`

@show src/container.ts 8-8

@show src/container.ts 12-12

@show src/container.ts 35-35

@show src/container.ts 46-46

@show src/container.ts 81-81

@show src/app.ts 17-17

@show src/app.ts 146-146

@show tests/global-setup.ts 1-1

@show tests/global-setup.ts 4-4

@show tests/global-setup.ts 22-35

**What's new**
- `global-setup.ts` now also creates the bucket if it's missing (`HeadBucket`, then `CreateBucket`). Compose's `s3-init` creates it for development; CI's bare service container doesn't.

@chunks tests/integration/attachments.test.ts all

**What's new**
- The test uploads with the real `fetch` to the presigned URL, the same request a browser makes, and downloads the file back through the presigned download URL. A wrong-size upload is rejected by S3 itself.

**✅ Checkpoint**

```bash
npm test
```

Expected:

```text
 Test Files  12 passed (12)
      Tests  63 passed (63)
```

@verify npx tsc --noEmit
@verify npx eslint .
@verify npx vitest run

**Commit:** `feat: attachments via presigned S3 uploads`

---
