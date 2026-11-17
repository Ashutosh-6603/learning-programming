from typing import Any

from fastapi import FastAPI
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException
from starlette.routing import Match

from app.core.problems import PROBLEM_TYPE_BASE
from app.core.problems import ProblemError
from app.core.problems import ProblemSlug
from app.core.validation import field_errors
from app.db.errors import is_unique_violation

_METHOD_ORDER = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]
# Statuses Starlette raises on its own, mapped to our problem slugs.
_BY_STATUS: dict[int, ProblemSlug] = {
    400: "bad-request",
    401: "unauthorized",
    403: "forbidden",
    404: "not-found",
    413: "payload-too-large",
    415: "unsupported-media-type",
}


def problem_response(problem: ProblemError, instance: str, request_id: str | None) -> JSONResponse:
    body: dict[str, Any] = {
        "type": PROBLEM_TYPE_BASE + problem.slug,
        "title": problem.title,
        "status": problem.status,
        "detail": problem.detail,
        "instance": instance,
        "requestId": request_id,
    }
    if problem.errors is not None:
        body["errors"] = problem.errors
    return JSONResponse(
        body,
        status_code=problem.status,
        headers=problem.headers,
        media_type="application/problem+json",
    )


def allowed_methods(request: Request) -> list[str]:
    """Every method that some route would fully match for this path, in a stable order."""
    allowed = []
    for method in _METHOD_ORDER:
        probe = {**request.scope, "method": method}
        if any(route.matches(probe)[0] == Match.FULL for route in request.app.router.routes):
            allowed.append(method)
    return allowed


def _respond(request: Request, problem: ProblemError) -> JSONResponse:
    return problem_response(problem, request.url.path, getattr(request.state, "request_id", None))


async def _on_problem(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, ProblemError)
    return _respond(request, exc)


async def _on_validation(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    if any(error["type"] == "json_invalid" for error in exc.errors()):
        return _respond(request, ProblemError("bad-request", "Malformed JSON"))
    problem = ProblemError(
        "validation-error", "The request contains invalid fields", field_errors(exc.errors())
    )
    return _respond(request, problem)


async def _on_http(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, HTTPException)
    if exc.status_code in (404, 405):
        # Starlette's own Allow header lists only the first matching route's methods.
        allowed = allowed_methods(request)
        if not allowed:
            return _respond(request, ProblemError("not-found", "No route matches this path"))
        detail = f"{request.method} is not supported on this path"
        problem = ProblemError("method-not-allowed", detail, headers={"Allow": ", ".join(allowed)})
        return _respond(request, problem)
    slug = _BY_STATUS.get(exc.status_code, "internal")
    return _respond(request, ProblemError(slug))


async def _on_integrity(request: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, IntegrityError)
    if is_unique_violation(exc):
        return _respond(
            request, ProblemError("conflict", "A resource with these values already exists")
        )
    raise exc


def add_exception_handlers(app: FastAPI) -> None:
    """The one place where exceptions become problem+json responses (Nest's exception filter)."""
    app.add_exception_handler(ProblemError, _on_problem)
    app.add_exception_handler(RequestValidationError, _on_validation)
    app.add_exception_handler(HTTPException, _on_http)
    app.add_exception_handler(IntegrityError, _on_integrity)
