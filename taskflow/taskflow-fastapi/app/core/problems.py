from typing import Literal
from typing import TypedDict

PROBLEM_TYPE_BASE = "https://taskflow.example/problems/"

type ProblemSlug = Literal[
    "bad-request",
    "unauthorized",
    "forbidden",
    "not-found",
    "method-not-allowed",
    "conflict",
    "payload-too-large",
    "unsupported-media-type",
    "validation-error",
    "rate-limited",
    "internal",
]

# slug → (HTTP status, title)
_PROBLEMS: dict[ProblemSlug, tuple[int, str]] = {
    "bad-request": (400, "Bad request"),
    "unauthorized": (401, "Unauthorized"),
    "forbidden": (403, "Forbidden"),
    "not-found": (404, "Not found"),
    "method-not-allowed": (405, "Method not allowed"),
    "conflict": (409, "Conflict"),
    "payload-too-large": (413, "Payload too large"),
    "unsupported-media-type": (415, "Unsupported media type"),
    "validation-error": (422, "Validation failed"),
    "rate-limited": (429, "Too many requests"),
    "internal": (500, "Internal server error"),
}


class FieldError(TypedDict):
    field: str
    message: str


class ProblemError(Exception):
    """An error that maps 1:1 to an RFC 9457 problem response."""

    def __init__(
        self,
        slug: ProblemSlug,
        detail: str | None = None,
        errors: list[FieldError] | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.slug = slug
        self.status, self.title = _PROBLEMS[slug]
        self.detail = detail or self.title
        self.errors = errors
        self.headers = headers or {}
        super().__init__(self.detail)


def not_found(what: str = "Resource") -> ProblemError:
    return ProblemError("not-found", f"{what} not found")


def forbidden(detail: str = "Your role does not allow this action") -> ProblemError:
    return ProblemError("forbidden", detail)


def conflict(detail: str) -> ProblemError:
    return ProblemError("conflict", detail)


def unauthorized(detail: str = "Authentication required") -> ProblemError:
    return ProblemError("unauthorized", detail)


def invalid(field: str, message: str) -> ProblemError:
    errors = [FieldError(field=field, message=message)]
    return ProblemError("validation-error", "The request contains invalid fields", errors)
