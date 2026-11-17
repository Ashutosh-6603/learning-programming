from typing import Any

from app.core.validation import field_errors


def error(*loc: str | int, msg: str = "is wrong") -> dict[str, Any]:
    return {"loc": loc, "msg": msg, "type": "x"}


def test_body_fields_use_their_wire_names() -> None:
    assert field_errors([error("body", "dueAt", msg="must be a date")]) == [
        {"field": "dueAt", "message": "must be a date"}
    ]


def test_nested_paths_are_dotted_and_each_field_is_reported_once() -> None:
    errors = [error("body", "payload", "projectId"), error("body", "payload", "projectId")]
    assert [e["field"] for e in field_errors(errors)] == ["payload.projectId"]


def test_query_and_path_parameters_are_prefixed() -> None:
    errors = [error("query", "limit"), error("path", "workspaceId"), error("body")]
    assert [e["field"] for e in field_errors(errors)] == ["query.limit", "path.workspaceId", "body"]
