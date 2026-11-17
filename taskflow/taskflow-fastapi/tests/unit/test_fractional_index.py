import random

import pytest

from app.core.fractional_index import key_between


# The shared vectors from the TaskFlow README; all six backends must agree on them.
@pytest.mark.parametrize(
    ("a", "b", "expected"),
    [
        (None, None, "a0"),
        ("a0", None, "a1"),
        (None, "a0", "Zz"),
        ("a0", "a1", "a0V"),
        ("a1", "a2", "a1V"),
        ("a0V", "a1", "a0l"),
        ("Zz", "a0", "ZzV"),
    ],
)
def test_shared_vectors(a: str | None, b: str | None, expected: str) -> None:
    assert key_between(a, b) == expected


def test_byte_order_holds_through_2000_random_insertions() -> None:
    rng = random.Random(7)  # seeded: the same "random" sequence on every run
    keys: list[str] = []
    for _ in range(2000):
        at = rng.randint(0, len(keys))
        before = keys[at - 1] if at > 0 else None
        after = keys[at] if at < len(keys) else None
        keys.insert(at, key_between(before, after))
    assert keys == sorted(keys)
    assert len(set(keys)) == len(keys)


def test_keys_grow_slowly_when_always_inserting_into_the_same_gap() -> None:
    upper = "a1"
    for _ in range(50):
        upper = key_between("a0", upper)
    assert len(upper) <= 12


def test_keys_in_the_wrong_order_are_refused() -> None:
    with pytest.raises(ValueError, match="a1 >= a0"):
        key_between("a1", "a0")
    with pytest.raises(ValueError, match="a1 >= a1"):
        key_between("a1", "a1")
