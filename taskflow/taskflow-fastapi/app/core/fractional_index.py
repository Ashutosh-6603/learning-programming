"""Fractional indexing (variable-length base62 keys), after David Greenspan's algorithm.

A key is an "integer part" (a head character that encodes its length, then digits) followed by a
fraction. Keys compare correctly with plain byte order, which is why the column is COLLATE "C".
"""

DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
INTEGER_ZERO = "a0"
SMALLEST_INTEGER = "A" + "0" * 26


def _midpoint(a: str, b: str | None) -> str:
    """A fraction strictly between a and b (None means 1). Neither may end in '0'."""
    if b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")
    if a.endswith("0") or (b is not None and b.endswith("0")):
        raise ValueError("trailing zero")
    if b is not None:
        n = 0
        while (a[n] if n < len(a) else "0") == b[n]:
            n += 1
        if n > 0:
            return b[:n] + _midpoint(a[n:], b[n:])
    digit_a = DIGITS.index(a[0]) if a else 0
    digit_b = DIGITS.index(b[0]) if b is not None else len(DIGITS)
    if digit_b - digit_a > 1:
        # Round half up, as JavaScript's Math.round does. Python's round() rounds half to even
        # (round(46.5) == 46), which would break the shared test vectors.
        return DIGITS[(digit_a + digit_b + 1) // 2]
    if b is not None and len(b) > 1:
        return b[:1]
    return DIGITS[digit_a] + _midpoint(a[1:], None)


def _integer_length(head: str) -> int:
    if "a" <= head <= "z":
        return ord(head) - ord("a") + 2
    if "A" <= head <= "Z":
        return ord("Z") - ord(head) + 2
    raise ValueError(f"invalid order key head: {head}")


def _integer_part(key: str) -> str:
    length = _integer_length(key[0])
    if length > len(key):
        raise ValueError(f"invalid order key: {key}")
    return key[:length]


def _validate(key: str) -> None:
    if key == SMALLEST_INTEGER:
        raise ValueError(f"invalid order key: {key}")
    if key[len(_integer_part(key)) :].endswith("0"):
        raise ValueError(f"invalid order key: {key}")


def _increment_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) + 1
        if d < len(DIGITS):
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = "0"
    if head == "Z":
        return "a0"
    if head == "z":
        return None
    next_head = chr(ord(head) + 1)
    if next_head > "a":
        digits.append("0")
    else:
        digits.pop()
    return next_head + "".join(digits)


def _decrement_integer(x: str) -> str | None:
    head, digits = x[0], list(x[1:])
    for i in reversed(range(len(digits))):
        d = DIGITS.index(digits[i]) - 1
        if d >= 0:
            digits[i] = DIGITS[d]
            return head + "".join(digits)
        digits[i] = DIGITS[-1]
    if head == "a":
        return "Z" + DIGITS[-1]
    if head == "A":
        return None
    prev_head = chr(ord(head) - 1)
    if prev_head < "Z":
        digits.append(DIGITS[-1])
    else:
        digits.pop()
    return prev_head + "".join(digits)


def key_between(a: str | None, b: str | None) -> str:
    """A key strictly between a and b; None means "open end"."""
    if a is not None:
        _validate(a)
    if b is not None:
        _validate(b)
    if a is not None and b is not None and a >= b:
        raise ValueError(f"{a} >= {b}")

    if a is None:
        if b is None:
            return INTEGER_ZERO
        int_b = _integer_part(b)
        frac_b = b[len(int_b) :]
        if int_b == SMALLEST_INTEGER:
            return int_b + _midpoint("", frac_b)
        if int_b < b:
            return int_b
        decremented = _decrement_integer(int_b)
        if decremented is None:
            raise ValueError("cannot decrement any more")
        return decremented

    int_a = _integer_part(a)
    frac_a = a[len(int_a) :]
    if b is None:
        incremented = _increment_integer(int_a)
        return incremented if incremented is not None else int_a + _midpoint(frac_a, None)

    int_b = _integer_part(b)
    frac_b = b[len(int_b) :]
    if int_a == int_b:
        return int_a + _midpoint(frac_a, frac_b)
    incremented = _increment_integer(int_a)
    if incremented is None:
        raise ValueError("cannot increment any more")
    if incremented < b:
        return incremented
    return int_a + _midpoint(frac_a, None)
