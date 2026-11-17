import re
import time
from uuid import uuid7

import structlog
from starlette.datastructures import Headers
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.types import ASGIApp
from starlette.types import Message
from starlette.types import Receive
from starlette.types import Scope
from starlette.types import Send

from app.core.errors import problem_response
from app.core.problems import ProblemError

log = structlog.get_logger("http")

REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,128}")
MAX_BODY_BYTES = 1024 * 1024
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-site",
}


class RequestContextMiddleware:
    """Request id, security headers, one access-log line, and a 500 problem for anything uncaught.

    Plain ASGI: a callable taking (scope, receive, send). It wraps `send` to edit the response
    headers on their way out, the same trick Express middleware plays with `res.set()`.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if REQUEST_ID.fullmatch(incoming) else str(uuid7())
        scope.setdefault("state", {})["request_id"] = request_id
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(requestId=request_id)

        status = 500
        started = time.perf_counter()

        async def send_with_headers(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-Id"] = request_id
                headers.update(SECURITY_HEADERS)
            await send(message)

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:
            log.exception("unhandled error")
            problem = ProblemError("internal", "An unexpected error occurred")
            response = problem_response(problem, scope["path"], request_id)
            await response(scope, receive, send_with_headers)
        finally:
            if not scope["path"].startswith("/health"):
                log.info(
                    "request completed",
                    userId=scope["state"].get("user_id"),
                    method=scope["method"],
                    path=scope["path"],
                    status=status,
                    durationMs=round((time.perf_counter() - started) * 1000, 1),
                )


class BodyGuardMiddleware:
    """This API reads JSON only: other bodies get 415, and bodies over 1 MiB get 413."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        length = int(headers.get("content-length") or 0)
        chunked = "transfer-encoding" in headers
        problem = None
        if length > MAX_BODY_BYTES:
            problem = ProblemError("payload-too-large", "Request bodies are limited to 1 MiB")
        elif (length > 0 or chunked) and not _is_json(headers.get("content-type", "")):
            problem = ProblemError(
                "unsupported-media-type", "Request body must be application/json"
            )
        if problem is not None:
            request_id = scope.get("state", {}).get("request_id")
            await problem_response(problem, scope["path"], request_id)(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            # A chunked body has no Content-Length to check up front: count as it arrives.
            nonlocal received
            message = await receive()
            received += len(message.get("body", b""))
            if received > MAX_BODY_BYTES:
                raise HTTPException(413)
            return message

        await self.app(scope, counting_receive, send)


def _is_json(content_type: str) -> bool:
    return content_type.split(";", 1)[0].strip().lower() == "application/json"
