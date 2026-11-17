from typing import Literal

type Role = Literal["owner", "admin", "member", "viewer"]
type InvitableRole = Literal["admin", "member", "viewer"]

_RANK: dict[Role, int] = {"owner": 3, "admin": 2, "member": 1, "viewer": 0}


def at_least(role: Role, minimum: Role) -> bool:
    return _RANK[role] >= _RANK[minimum]
