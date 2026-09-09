"""The explicit TrackModel -> SFZ instrument map for the sfizz/VSCO 2 CE renderer.

The worker and the native host both resolve every track through this module,
so the instrument a stem was rendered with is decided in exactly one place and
advertised by `/health`. There is deliberately no default: a track that
matches no entry is refused with a reason that names its family, and the
platform falls back to its preview synth with that reason on the stem. A
family is never mapped to a wrong instrument silently; entries that stand in
for an instrument the library does not have carry a `standIn` sentence that
travels with the render.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

PLATFORM_FAMILIES = ("keys", "strings", "brass", "drums", "guitar", "voice", "synth")
MATCH_KEYS = ("nameKeyword", "instrumentId", "family")
ENV_NAME = "MUSIC_AI_SFIZZ_INSTRUMENT_MAP"


def load_instrument_map(value: str | None = None) -> dict:
    """Load the map from inline JSON or a JSON file path (env `MUSIC_AI_SFIZZ_INSTRUMENT_MAP`)."""
    raw = value if value is not None else os.getenv(ENV_NAME)
    if not raw or not raw.strip():
        raise ValueError(f"{ENV_NAME} is not configured; the sfizz renderer has no instrument map")
    text = raw.strip()
    if not text.startswith("{"):
        path = Path(text)
        if not path.is_file():
            raise ValueError(f"{ENV_NAME} names a missing instrument map file")
        text = path.read_text(encoding="utf-8")
    try:
        instrument_map = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{ENV_NAME} is not valid JSON: {exc}") from exc
    problems = _shape_problems(instrument_map)
    if problems:
        raise ValueError("instrument map is invalid: " + "; ".join(problems))
    return instrument_map


def instrument_map_sha256(instrument_map: dict) -> str:
    canonical = json.dumps(instrument_map, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _shape_problems(instrument_map: object) -> list[str]:
    problems: list[str] = []
    if not isinstance(instrument_map, dict) or not isinstance(instrument_map.get("entries"), list):
        return ["map must be an object with an `entries` list"]
    if not instrument_map["entries"]:
        problems.append("map has no entries")
    for index, entry in enumerate(instrument_map["entries"]):
        label = f"entry {index}"
        if not isinstance(entry, dict):
            problems.append(f"{label} is not an object")
            continue
        match = entry.get("match")
        if not isinstance(match, dict) or len(match) != 1 or next(iter(match)) not in MATCH_KEYS:
            problems.append(f"{label} must match exactly one of {', '.join(MATCH_KEYS)}")
        elif not isinstance(next(iter(match.values())), str) or not next(iter(match.values())).strip():
            problems.append(f"{label} has an empty match value")
        sfz = entry.get("sfz")
        if not isinstance(sfz, str) or not sfz.lower().endswith(".sfz") or Path(sfz).is_absolute() or ".." in Path(sfz).parts:
            problems.append(f"{label} must name a library-relative .sfz file")
        if not isinstance(entry.get("instrument"), str) or not entry["instrument"].strip():
            problems.append(f"{label} must name its instrument")
        if "standIn" in entry and (not isinstance(entry["standIn"], str) or not entry["standIn"].strip()):
            problems.append(f"{label} standIn must be a sentence")
    return problems


def track_identity(track: dict) -> dict:
    definition = track.get("instrumentDefinition") if isinstance(track.get("instrumentDefinition"), dict) else {}
    name = str(track.get("instrument") or "").strip().lower()
    family = definition.get("family")
    if not isinstance(family, str) or not family:
        # The canonical smoke TrackModel names its family as the instrument
        # itself; an explicit family on the definition always wins.
        family = name if name in PLATFORM_FAMILIES else None
    instrument_id = definition.get("id")
    return {
        "name": name,
        "instrumentId": instrument_id if isinstance(instrument_id, str) and instrument_id else None,
        "family": family,
    }


def resolve_sfz_instrument(instrument_map: dict, track: dict) -> dict:
    """The first entry, in map order, whose single match holds for this track.

    Raises ValueError with a reason that names the family when nothing
    matches; the reason is what the platform records as the fallback.
    """
    identity = track_identity(track)
    for entry in instrument_map["entries"]:
        key, value = next(iter(entry["match"].items()))
        expected = value.strip().lower()
        matched = (
            (key == "nameKeyword" and bool(identity["name"]) and expected in identity["name"])
            or (key == "instrumentId" and identity["instrumentId"] is not None and identity["instrumentId"].lower() == expected)
            or (key == "family" and identity["family"] is not None and identity["family"].lower() == expected)
        )
        if matched:
            return {
                "sfz": entry["sfz"],
                "instrument": entry["instrument"],
                "matchedBy": {key: value},
                **({"standIn": entry["standIn"]} if entry.get("standIn") else {}),
                **({"keyRange": entry["keyRange"]} if isinstance(entry.get("keyRange"), list) else {}),
            }
    family = identity["family"] or "unknown"
    served = ", ".join(served_families(instrument_map)) or "none"
    raise ValueError(
        f"SFIZZ_VSCO2_CE has no approved instrument for family '{family}'"
        f" (instrument '{identity['name'] or '?'}', id '{identity['instrumentId'] or '?'}');"
        f" served families: {served}"
    )


def served_families(instrument_map: dict) -> list[str]:
    """Families the map serves by a `family` entry (the whole family) - in platform order."""
    by_family = {
        entry["match"]["family"].strip().lower()
        for entry in instrument_map["entries"]
        if "family" in entry["match"]
    }
    return [family for family in PLATFORM_FAMILIES if family in by_family]


def validate_instrument_map(instrument_map: dict, library: Path) -> list[str]:
    """Every mapped .sfz must exist inside the active library, or health is unhealthy."""
    problems = _shape_problems(instrument_map)
    if problems:
        return problems
    root = library.resolve()
    for entry in instrument_map["entries"]:
        candidate = (root / entry["sfz"]).resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            problems.append(f"{entry['sfz']} escapes the library")
            continue
        if not candidate.is_file():
            problems.append(f"{entry['sfz']} is missing from the active library")
    return problems


def public_instrument_map(instrument_map: dict) -> dict:
    """What `/health` publishes: the entries and the unserved reasons, nothing private."""
    return {
        "version": instrument_map.get("version"),
        "library": instrument_map.get("library"),
        "entries": [
            {
                "match": entry["match"],
                "sfz": entry["sfz"],
                "instrument": entry["instrument"],
                **({"standIn": entry["standIn"]} if entry.get("standIn") else {}),
                **({"keyRange": entry["keyRange"]} if isinstance(entry.get("keyRange"), list) else {}),
            }
            for entry in instrument_map["entries"]
        ],
        "unserved": instrument_map.get("unserved", {}),
    }
