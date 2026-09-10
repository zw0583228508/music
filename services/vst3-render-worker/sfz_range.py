"""What keys an SFZ instrument actually sounds (Arrangement Brain B-03).

On the owner's first real song the sound-selection brain chose a cello
ensemble sampled 36-77 for a string part written at MIDI 79-91; the render was
silence and was rejected after the fact. This module reads the truth from the
SFZ file itself so the worker can publish it on `/health` and the API can
refuse the asset *before* rendering:

- `keyRange`     the lowest `lokey` and highest `hikey` of any region (the keys
                 that produce sound at all);
- `sampledRange` the span of `pitch_keycenter` (keys backed by their own
                 samples; outside it sfizz stretches a neighbour);
- `mappedKeys`   for kits, the exact keys with a region;
- `velocityLayers` distinct (lovel, hivel) pairs;
- `regions`      how many regions were read.

The parser follows the SFZ conventions that matter for ranges: `#define`
macros are expanded, `#include` paths are relative to the *root* file's
directory (the DrumGizmo port includes two files per line), `//` comments are
stripped, opcodes inherit from <global> / <master> / <group> into <region>,
and `key=` sets lokey/hikey/pitch_keycenter at once. Note names (`c4`, `f#2`,
`bb-1`) follow the SFZ middle-C-is-c4 convention (c4 = 60). Regions without a
key opcode default to the full keyboard, as sfizz does; regions whose sample
is a silent placeholder (`*silence`) are ignored.
"""
from __future__ import annotations

import re
from pathlib import Path

_NOTE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
_HEADER = re.compile(r"<(\w+)>")
_OPCODE = re.compile(r"([A-Za-z0-9_$]+)=(\S+)")
_DEFINE = re.compile(r"#define\s+(\$\w+)\s+(\S+)")
_INCLUDE = re.compile(r'#include\s+"([^"]+)"')


def note_to_midi(token: str) -> int | None:
    token = token.strip().lower()
    if re.fullmatch(r"-?\d+", token):
        value = int(token)
        return value if 0 <= value <= 127 else None
    match = re.fullmatch(r"([a-g])([#b]?)(-?\d+)", token)
    if not match:
        return None
    semitone = _NOTE[match.group(1)] + (1 if match.group(2) == "#" else -1 if match.group(2) == "b" else 0)
    value = semitone + (int(match.group(3)) + 1) * 12
    return value if 0 <= value <= 127 else None


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _expand(text: str, root_dir: Path, defines: dict[str, str], seen: set[Path], depth: int = 0) -> str:
    """Inline includes (root-relative) and collect #defines, in file order."""
    if depth > 12:
        return ""
    out: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.split("//", 1)[0]
        if not line.strip():
            continue
        for key, value in _DEFINE.findall(line):
            defines.setdefault(key, value)
        line = _DEFINE.sub("", line)
        cursor = 0
        for match in _INCLUDE.finditer(line):
            out.append(line[cursor:match.start()])
            cursor = match.end()
            target = (root_dir / match.group(1)).resolve()
            if target in seen or not target.is_file():
                continue
            seen.add(target)
            out.append("\n" + _expand(_read(target), root_dir, defines, seen, depth + 1) + "\n")
        out.append(line[cursor:])
        out.append("\n")
    return "".join(out)


def _apply_defines(text: str, defines: dict[str, str]) -> str:
    for key in sorted(defines, key=len, reverse=True):
        text = text.replace(key, defines[key])
    return text


def parse_sfz_ranges(path: str | Path) -> dict:
    root = Path(path).resolve()
    defines: dict[str, str] = {}
    body = _expand(_read(root), root.parent, defines, {root})
    body = _apply_defines(body, defines)

    scopes = {"global": {}, "master": {}, "group": {}}
    current: str | None = None
    current_ops: dict[str, str] = {}
    regions: list[dict[str, str]] = []

    def close_region() -> None:
        if current == "region":
            merged = {**scopes["global"], **scopes["master"], **scopes["group"], **current_ops}
            regions.append(merged)

    tokens = _HEADER.split(body)
    # tokens: [text-before-first-header, header, text, header, text, ...]
    for index in range(1, len(tokens), 2):
        header = tokens[index].lower()
        text = tokens[index + 1] if index + 1 < len(tokens) else ""
        close_region()
        ops = dict(_OPCODE.findall(text))
        if header == "global":
            scopes["global"] = ops
            scopes["master"] = {}
            scopes["group"] = {}
        elif header == "master":
            scopes["master"] = ops
            scopes["group"] = {}
        elif header == "group":
            scopes["group"] = ops
        elif header == "region":
            current_ops = ops
        current = header
    close_region()

    los: list[int] = []
    his: list[int] = []
    centers: list[int] = []
    keys: set[int] = set()
    velocity_layers: set[tuple[int, int]] = set()
    counted = 0
    for region in regions:
        sample = region.get("sample", "")
        if sample.startswith("*silence"):
            continue
        key = note_to_midi(region["key"]) if "key" in region else None
        lo = note_to_midi(region["lokey"]) if "lokey" in region else key
        hi = note_to_midi(region["hikey"]) if "hikey" in region else key
        center = note_to_midi(region["pitch_keycenter"]) if "pitch_keycenter" in region else key
        counted += 1
        if lo is None and hi is None:
            # No key opcode at all: sfizz plays it on every key, but such
            # regions are release / pedal / noise layers (Salamander's pedal
            # samples), not a pitched note — they say nothing about range.
            continue
        lo = 0 if lo is None else lo
        hi = 127 if hi is None else hi
        if hi < lo:
            continue
        los.append(lo)
        his.append(hi)
        if center is not None:
            centers.append(center)
        if hi - lo <= 2:
            keys.update(range(lo, hi + 1))
        lovel = int(region.get("lovel", "0")) if region.get("lovel", "0").lstrip("-").isdigit() else 0
        hivel = int(region.get("hivel", "127")) if region.get("hivel", "127").lstrip("-").isdigit() else 127
        velocity_layers.add((lovel, hivel))

    result: dict = {
        "sfz": str(root),
        "regions": counted,
        "keyRange": [min(los), max(his)] if los else None,
        "sampledRange": [min(centers), max(centers)] if centers else None,
        "velocityLayers": len(velocity_layers) if velocity_layers else None,
        "keyRangeSource": "sfz-regions",
    }
    # A kit: every region spans at most a few keys and the mapped keys have
    # gaps (a piano sampled every minor third covers its keys contiguously).
    if keys and all(h - l <= 2 for l, h in zip(los, his)):
        ordered = sorted(keys)
        contiguous = ordered[-1] - ordered[0] + 1 == len(ordered)
        if not contiguous:
            result["mappedKeys"] = ordered
    return result


RANGE_FIELDS = ("keyRange", "sampledRange", "mappedKeys", "velocityLayers", "keyRangeSource")


def range_hints(path: str | Path) -> dict:
    """Only the fields a manifest entry / health payload carries."""
    parsed = parse_sfz_ranges(path)
    hints = {"keyRangeSource": parsed["keyRangeSource"]}
    for field in ("keyRange", "sampledRange", "mappedKeys", "velocityLayers"):
        if parsed.get(field) is not None:
            hints[field] = parsed[field]
    return hints


if __name__ == "__main__":  # pragma: no cover - manual inspection
    import json
    import sys

    for argument in sys.argv[1:]:
        print(json.dumps(parse_sfz_ranges(argument), indent=2))
