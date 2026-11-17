from uuid import UUID

import pytest

from app.realtime.messages import Ping
from app.realtime.messages import Subscribe
from app.realtime.messages import parse_client_message

PROJECT_ID = "01a18b7e-951f-71f4-affb-2b64a14174e2"


def test_valid_messages_become_typed_objects() -> None:
    message = parse_client_message(
        f'{{"type":"subscribe","payload":{{"projectId":"{PROJECT_ID}"}}}}'
    )
    assert isinstance(message, Subscribe)
    assert message.payload.project_id == UUID(PROJECT_ID)
    assert isinstance(parse_client_message('{"type":"ping"}'), Ping)


@pytest.mark.parametrize(
    "raw",
    [
        "not json",
        "42",
        '{"type":"nonsense"}',
        '{"type":"subscribe"}',
        '{"type":"subscribe","payload":{"projectId":"nope"}}',
    ],
)
def test_anything_malformed_is_none(raw: str) -> None:
    assert parse_client_message(raw) is None
