## Part 9 · Attachments (presigned S3 uploads)

The bytes never pass through the API (README §12): the API signs a URL, the browser `PUT`s the file straight to S3 (RustFS locally), and the API then checks the object exists with the declared size.

### Step 9.1 · The storage wrapper

**Goal:** presigned upload and download URLs, a size check, and prefix deletion, through boto3, without blocking the event loop.

**Files:** `app/infra/storage.py`, `app/infra/resources.py`, `app/deps.py`

```bash
uv add --bounds exact boto3==1.44.3
uv add --dev --bounds exact "types-boto3[s3]==1.44.3"
```

- **boto3** is the official AWS SDK for Python (`@aws-sdk/client-s3`'s role); it speaks to any S3-compatible service. It's **synchronous**, so its network calls run in threads (below). **types-boto3[s3]** adds type stubs for the S3 client: boto3 builds its clients at run time from JSON descriptions, so without stubs mypy sees `Any` everywhere.

@show app/infra/storage.py 1-42

**What's new**
- **`if TYPE_CHECKING:`** is `False` at run time and `True` for mypy: the stub types are imported only for type checking. **Python 3.14 evaluates annotations lazily**, so `-> S3Client` in the nested function is never evaluated at run time, and the name doesn't need to exist then. (Before 3.14 you'd quote it: `-> "S3Client"`.)
- **A nested function** builds the two clients with the same settings. **Two clients, two endpoints:** a presigned URL's signature covers the host, so URLs for the browser are signed for `S3_PUBLIC_ENDPOINT`, while the API's own calls use `S3_ENDPOINT` (inside Docker, `http://rustfs:9000`).
- **`request_checksum_calculation="when_required"`**: recent botocore versions add CRC32 checksum parameters to presigned uploads by default, and a browser can't compute them, so its `PUT` would fail. This restores the old behaviour. (AWS SDK v3 for JS has the same setting.)
- `addressing_style: path` puts the bucket in the path (`http://host/bucket/key`), which RustFS and MinIO serve.

@show app/infra/storage.py 43-89

**What's new**
- **Presigning is local:** `generate_presigned_url` computes an HMAC signature with the secret key, without a network call, so it runs directly. **`Params={"ContentLength": size_bytes}`** puts the size into the signed headers: S3 itself rejects an upload of a different size.
- **`await asyncio.to_thread(self._internal.head_object, ...)`**: the blocking call runs in a worker thread (`HEAD` the object to read its size). A missing object raises `ClientError` with code `404`; anything else is re-raised.
- **`_delete_prefix` is a plain (synchronous) method** run as a whole in one thread: a **paginator** iterates `list_objects_v2` pages (1000 keys each, the S3 maximum) and deletes each page with one `delete_objects` call. Many blocking calls, one thread hop.
- `quote(file_name, safe='')` percent-encodes the original file name for `filename*=UTF-8''…` (RFC 5987), so `résumé.txt` downloads with its name intact.

@show app/infra/resources.py 13-13

@show app/infra/resources.py 27-27

@show app/infra/resources.py 43-43

@show app/deps.py 14-14

@show app/deps.py 38-41

@show app/deps.py 53-53

**✅ Checkpoint**

```bash
uv run python -c "
import asyncio
from app.config import get_settings
from app.infra.storage import Storage
s = Storage(get_settings())
print(s.presign_upload('probe/x.txt', 'text/plain', 5, 60)[:70])
print(asyncio.run(s.size_of('probe/missing')))"
```

Expected:

```text
http://localhost:19004/taskflow-attachments/probe/x.txt?X-Amz-Algorith
None
```

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: s3 storage with presigned urls`

### Step 9.2 · The attachments service and routes

**Goal:** start an upload (a pending row + an upload URL), complete it (check the object, mark it ready), list, download and delete.

**Files:** `app/access/service.py`, `app/core/params.py`, `app/attachments/__init__.py`, `app/attachments/schemas.py`, `app/attachments/service.py`, `app/attachments/router.py`

```bash
mkdir app/attachments && touch app/attachments/__init__.py
```

@copy app/attachments/__init__.py

@show app/access/service.py 15-15

@show app/access/service.py 87-100

@show app/core/params.py 15-15

@show app/attachments/schemas.py all

**What's new**
- **The file name is display data:** the pattern `^[^/\\\x00-\x1f]+$` forbids path separators and control characters (`\x00`–`\x1f`), and the storage key never contains it.
- **`content_type`** must be a lowercase media type without parameters, as browsers report it in `File.type`.
- `class UploadTarget(PresignedUrl)` adds `method` and `headers` to the URL and its expiry.

@show app/attachments/service.py 1-68

@show app/attachments/service.py 69-122

**What's new**
- **The id is generated before the insert** (`uuid7()`), because the storage key contains it: `projects/{project}/tasks/{task}/{attachment}`. Deleting a task or project later deletes its whole prefix.
- **`complete` is idempotent:** a ready attachment is returned as it is. Otherwise the object must exist (409 "not uploaded yet") with the declared size (409 "size does not match"), then the row becomes `ready` and the activity event is recorded.

@show app/attachments/service.py 123-160

@show app/attachments/router.py all

**What's new**
- Download URLs live 5 minutes, upload URLs 15; `_expires_at` reports when, so clients can refresh before using a stale one.
- A deleted attachment's object is removed by a job after the commit.

**✅ Checkpoint**

```bash
uv run mypy .
```

Expected: `Success: no issues found in 100 source files`.

@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: attachments with presigned uploads and downloads`

### Step 9.3 · Wiring and tests

**Goal:** the attachment routes in the app, the bucket ensured before the tests, and tests that upload real bytes to S3.

**Files:** `app/main.py`, `tests/conftest.py`, `tests/test_attachments.py`

@show app/main.py 11-11

@show app/main.py 85-85

@show tests/conftest.py 7-7

@show tests/conftest.py 11-11

@show tests/conftest.py 49-62

@show tests/conftest.py 67-68

**What's new**
- CI's S3 service container has no `s3-init` job, so the test session creates the bucket when it's missing. boto3's synchronous client is fine here: no event loop is running yet.

@show tests/test_attachments.py all

**What's new**
- **A real HTTP client for the browser's part:** `httpx.AsyncClient()` without a transport sends real requests over the network, here to RustFS: the test uploads bytes to the presigned URL, completes, then downloads through the presigned GET and checks the bytes and the `Content-Disposition`.
- **`assert put.is_error`**: S3 rejects a body whose size differs from the signed `Content-Length`.
- **Fixtures depending on fixtures:** `task_id` needs `f`, which needs `client`.

**✅ Checkpoint**

```bash
uv run pytest
```

Expected: `64 passed`.

@verify .venv/bin/pytest -q
@verify .venv/bin/mypy .
@verify .venv/bin/ruff check .

**Commit:** `feat: attachment routes and tests against real s3`

---
