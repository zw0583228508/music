"""Byte-exact port of the API's render attestation digests.

The API (artifacts/api-server/src/lib/musicEngines.ts) computes
`trackModelSha256 = sha256(canonicalJson(trackModel))` and
`performedMaterialSha256(trackModel)` and refuses a render whose echoed digests
differ. So this module must reproduce JavaScript's `canonicalJson` exactly:
keys ordered by `String.prototype.localeCompare`, numbers formatted by
`JSON.stringify`. Parity is proven against Node-computed fixtures in tests.
"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any

# --- JavaScript number formatting (ECMAScript Number::toString) -------------


def js_number(value: int | float) -> str:
    if isinstance(value, bool):
        raise TypeError("booleans are not numbers")
    if isinstance(value, int):
        return str(value)
    if math.isnan(value) or math.isinf(value):
        return "null"  # JSON.stringify(NaN) === "null"
    if value == 0:
        return "0"
    negative = value < 0
    value = abs(value)
    # Below 2^53 every integer is exact and prints as itself. Above it, V8
    # prints the shortest round-trip digits zero-padded (123456789012345680000),
    # not the exact binary value (123456789012345683968), so fall through.
    if value.is_integer() and value < 2**53:
        return ("-" if negative else "") + str(int(value))
    text = repr(value)  # shortest round-trip digits, like V8
    if "e" in text:
        mantissa, exponent_text = text.split("e")
        exponent = int(exponent_text)
    else:
        mantissa, exponent = text, 0
    integer_part, _, fraction_part = mantissa.partition(".")
    raw = integer_part + fraction_part
    stripped = raw.lstrip("0")
    leading_zeros = len(raw) - len(stripped)
    digits = stripped.rstrip("0") or "0"
    n = len(integer_part) + exponent - leading_zeros  # decimal point position
    k = len(digits)
    if k <= n <= 21:
        out = digits + "0" * (n - k)
    elif 0 < n <= 21:
        out = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        out = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        out = digits[0] + ("." + digits[1:] if k > 1 else "") + "e" + ("+" if e >= 0 else "-") + str(abs(e))
    return ("-" if negative else "") + out


# --- JavaScript localeCompare for object keys --------------------------------


def _char_class(ch: str) -> int:
    if ch.isdigit():
        return 1
    if ch.isalpha():
        return 2
    return 0  # punctuation / whitespace sort first under ICU root collation


def locale_key(text: str) -> tuple:
    """Approximates ICU root collation for ASCII identifiers: primary strength
    ignores case with punctuation < digits < letters; ties break lowercase
    first. Object keys in this platform are camelCase ASCII, where this matches
    V8's localeCompare exactly (proven by fixture parity tests)."""
    primary = tuple((_char_class(ch), ch.lower()) for ch in text)
    tertiary = tuple(1 if ch.isupper() else 0 for ch in text)
    return (primary, tertiary)


def canonical_json(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: locale_key(kv[0]))
        return "{" + ",".join(f"{json.dumps(key, ensure_ascii=False)}:{canonical_json(item)}" for key, item in items) + "}"
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    raise TypeError(f"unsupported value in canonical JSON: {type(value).__name__}")


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def track_model_sha256(track: dict) -> str:
    return sha256_text(canonical_json(track))


def performed_material_sha256(track: dict) -> str:
    """Mirror of performedMaterialSha256() in musicEngines.ts."""
    return sha256_text(canonical_json({
        "id": track.get("id"),
        "instrument": track.get("instrument"),
        "role": track.get("role"),
        "notes": track.get("notes"),
        "cc": track.get("cc"),
        "articulations": track.get("articulations"),
        "automation": track.get("automation"),
        "mapping": track.get("mapping", None),
    }))
