"""Open-licence SFZ sound assets for the sfizz native host (PR-93, SOUND-2).

Credential-free rules shared by the Modal provisioning app, the per-asset
operator and the tests. Nothing here talks to the network or to Modal, so the
whole module runs on the Windows checkout under pytest.

Three things live here:

* the catalogue (`open_licence_assets.json`): every asset the platform may
  fetch into the cloud, with a pinned source, the licence the source is
  expected to carry and an explicit instrument -> platform-family map;
* the licence gate: an asset whose licence text was not captured, or whose
  captured text is not the licence the catalogue expects, is refused - it is
  never staged and never rendered;
* the SFZ dependency resolver: the files one `.sfz` really needs (includes,
  `default_path`, `sample=` opcodes), so a library is staged as the subset an
  instrument uses and the subset's tree hash is what the worker pins.

The worker's lifecycle (`app.py`) is one active `sfz` asset per manifest, so
each catalogue asset is staged into its own asset root and attested by its
own `renderer_health("SFIZZ_VSCO2_CE")`; see `operator_open_licence_asset.py`.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent
CATALOGUE_PATH = HERE / "open_licence_assets.json"
PLATFORM_FAMILIES = ("keys", "strings", "brass", "drums", "guitar", "voice", "synth")
AUDITION_FAMILIES = ("piano", "strings", "world", "bass", "guitar", "drums")
# What the captured licence text must contain for the SPDX id the catalogue
# claims. The check is on the legal code itself, not on a README's summary.
LICENCE_MARKERS = {
    "CC0-1.0": ("CC0 1.0 Universal",),
    "CC-BY-3.0": ("Attribution 3.0 Unported",),
    "CC-BY-4.0": ("Attribution 4.0 International",),
    "CC-BY-SA-3.0": ("Attribution-ShareAlike 3.0 Unported",),
    "FAL-1.3": ("Free Art License 1.3", "Licence Art Libre 1.3"),
}
_OPCODE = re.compile(r"(?<![\w$])([A-Za-z_][\w$]*)=")


class LicenceRefused(ValueError):
    """The asset may not be staged: its licence text is missing or is not what the catalogue expects."""


def load_catalogue(path: Path | None = None) -> dict:
    catalogue = json.loads((path or CATALOGUE_PATH).read_text(encoding="utf-8"))
    problems = catalogue_problems(catalogue)
    if problems:
        raise ValueError("open-licence catalogue is invalid: " + "; ".join(problems))
    return catalogue


def catalogue_problems(catalogue: object) -> list[str]:
    problems: list[str] = []
    if not isinstance(catalogue, dict) or not isinstance(catalogue.get("assets"), list):
        return ["catalogue must be an object with an `assets` list"]
    for index, excluded in enumerate(catalogue.get("excluded") or []):
        # Libraries the survey looked at and the platform will NOT fetch; the
        # reason travels with the catalogue so the evidence can print it.
        if not isinstance(excluded, dict) or not all(isinstance(excluded.get(k), str) and excluded[k].strip() for k in ("id", "identity", "reason")):
            problems.append(f"excluded {index} needs id, identity and reason")
    seen: set[str] = set()
    for index, asset in enumerate(catalogue["assets"]):
        label = f"asset {index}"
        if not isinstance(asset, dict):
            problems.append(f"{label} is not an object")
            continue
        asset_id = asset.get("assetId")
        if not isinstance(asset_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,127}", asset_id):
            problems.append(f"{label} needs an assetId of letters, digits, dots, dashes or underscores")
        elif asset_id in seen:
            problems.append(f"{label} repeats assetId {asset_id}")
        else:
            seen.add(asset_id)
            label = asset_id
        for key in ("identity", "licenseOwner"):
            if not isinstance(asset.get(key), str) or not asset[key].strip():
                problems.append(f"{label} is missing {key}")
        source = asset.get("source")
        if not isinstance(source, dict) or source.get("kind") not in {"git", "archive", "soundfont"}:
            problems.append(f"{label} source.kind must be git, archive or soundfont")
        elif source["kind"] == "git" and not (isinstance(source.get("repository"), str) and re.fullmatch(r"[0-9a-f]{40}", str(source.get("commit", "")))):
            problems.append(f"{label} git source needs repository and a 40-hex commit")
        elif source["kind"] in {"archive", "soundfont"} and not isinstance(source.get("url"), str):
            problems.append(f"{label} {source['kind']} source needs a url")
        licence = asset.get("licence")
        if not isinstance(licence, dict) or licence.get("spdx") not in LICENCE_MARKERS or not isinstance(licence.get("file"), str):
            problems.append(f"{label} licence needs a known spdx id and the licence file path inside the source")
        instruments = asset.get("instruments")
        if not isinstance(instruments, list) or not instruments:
            problems.append(f"{label} has no instruments")
            continue
        for position, instrument in enumerate(instruments):
            where = f"{label} instrument {position}"
            if not isinstance(instrument, dict):
                problems.append(f"{where} is not an object")
                continue
            sfz = instrument.get("sfz")
            if not isinstance(sfz, str) or not sfz.lower().endswith(".sfz") or PurePosixPath(sfz).is_absolute() or ".." in PurePosixPath(sfz).parts:
                problems.append(f"{where} must name a library-relative .sfz")
            if instrument.get("family") not in PLATFORM_FAMILIES:
                problems.append(f"{where} family must be one of {', '.join(PLATFORM_FAMILIES)}")
            if instrument.get("auditionFamily") not in AUDITION_FAMILIES:
                problems.append(f"{where} auditionFamily must be one of {', '.join(AUDITION_FAMILIES)}")
            if not isinstance(instrument.get("instrument"), str) or not instrument["instrument"].strip():
                problems.append(f"{where} must name its instrument")
            key_range = instrument.get("keyRange")
            if not (isinstance(key_range, list) and len(key_range) == 2 and all(isinstance(v, int) and 0 <= v <= 127 for v in key_range) and key_range[0] <= key_range[1]):
                problems.append(f"{where} keyRange must be [low, high] MIDI notes")
            if "standIn" in instrument and (not isinstance(instrument["standIn"], str) or not instrument["standIn"].strip()):
                problems.append(f"{where} standIn must be a sentence")
            if "world" in instrument and not isinstance(instrument["world"], bool):
                problems.append(f"{where} world must be true or false")
            drum_keys = instrument.get("drumKeys")
            if drum_keys is not None and not (isinstance(drum_keys, dict) and all(isinstance(v, int) and 0 <= v <= 127 for v in drum_keys.values())):
                problems.append(f"{where} drumKeys must map names to MIDI notes")
        smoke = asset.get("smokeInstrument")
        if not isinstance(smoke, str) or smoke not in {i.get("sfz") for i in instruments if isinstance(i, dict)}:
            problems.append(f"{label} smokeInstrument must be one of its instruments")
    return problems


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while block := handle.read(1024 * 1024):
            digest.update(block)
    return digest.hexdigest()


def tree_evidence(root: Path, *, ignore_parts: tuple[str, ...] = (".git",)) -> dict:
    """The worker's own tree hash (sorted relative path, NUL, bytes) plus counts.

    Identical to `app._sha256_tree` and `bootstrap_sfizz_vsco2.tree_evidence`
    for a directory, so the hash recorded at provisioning is the hash the
    worker re-derives at every render.
    """
    files = sorted(p for p in root.rglob("*") if p.is_file() and not any(part in ignore_parts for part in p.parts))
    digest = hashlib.sha256()
    size = 0
    for path in files:
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(b"\0")
        with path.open("rb") as handle:
            while block := handle.read(1024 * 1024):
                size += len(block)
                digest.update(block)
    return {"sha256": digest.hexdigest(), "fileCount": len(files), "bytes": size}


def capture_licence(root: Path, asset: dict) -> dict:
    """Read the licence file the catalogue names and check it is that licence.

    Returns the captured record (path, sha256, bytes, first line, markers
    found) or raises LicenceRefused. Absence, an empty file, or text that does
    not carry the expected legal-code marker all refuse the asset; a
    catalogue that says CC0 for a file that turns out to be CC-BY-NC is caught
    here, before any byte is staged.
    """
    licence = asset["licence"]
    path = root / licence["file"]
    if not path.is_file():
        raise LicenceRefused(f"{asset['assetId']}: licence file {licence['file']} is not in the source")
    text = path.read_text(encoding="utf-8", errors="replace")
    if not text.strip():
        raise LicenceRefused(f"{asset['assetId']}: licence file {licence['file']} is empty")
    markers = LICENCE_MARKERS[licence["spdx"]]
    found = [marker for marker in markers if marker.lower() in text.lower()]
    if not found:
        raise LicenceRefused(
            f"{asset['assetId']}: licence file {licence['file']} does not carry {licence['spdx']} ({' / '.join(markers)}); first line: {text.strip().splitlines()[0][:120]!r}"
        )
    forbidden = [word for word in ("NonCommercial", "Non-Commercial", "NoDerivatives") if word.lower() in text.lower()[:4000]]
    if forbidden and licence["spdx"] not in {"CC-BY-NC-4.0"}:
        raise LicenceRefused(f"{asset['assetId']}: licence text carries {forbidden} which contradicts {licence['spdx']}")
    return {
        "spdx": licence["spdx"],
        "file": licence["file"],
        "sha256": sha256_bytes(path.read_bytes()),
        "bytes": path.stat().st_size,
        "firstLine": text.strip().splitlines()[0].strip(),
        "markersFound": found,
        "attribution": licence.get("attribution"),
    }


def admissible(asset: dict, captured: dict | None) -> bool:
    """The rule the platform side mirrors: no captured licence text, no asset."""
    return bool(
        captured
        and isinstance(captured.get("sha256"), str)
        and re.fullmatch(r"[0-9a-f]{64}", captured["sha256"])
        and captured.get("spdx") == asset["licence"]["spdx"]
        and captured.get("markersFound")
    )


def _strip_comment(line: str) -> str:
    cut = line.find("//")
    return line if cut < 0 else line[:cut]


def _opcodes(text: str) -> list[tuple[str, str]]:
    """Split one logical line into (opcode, value) pairs; values may contain spaces."""
    pairs: list[tuple[str, str]] = []
    matches = list(_OPCODE.finditer(text))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        pairs.append((match.group(1).lower(), text[match.end():end].strip()))
    return pairs


def _normalise(relative: str) -> str:
    """A library-relative POSIX path with `.` and `..` folded (never escaping the root)."""
    parts: list[str] = []
    for part in PurePosixPath(relative.replace("\\", "/")).parts:
        if part in ("", "."):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def sfz_dependencies(library: Path, sfz: str, known_files: dict[str, int] | None = None) -> dict:
    """Every file `sfz` needs, resolved case-insensitively inside `library`.

    Paths follow sfizz/ARIA: `#include` paths, `<control> default_path=` and
    a `sample=` without a default path are all relative to the directory of
    the *root* .sfz file, not of the file that mentions them (DrumGizmo's
    `Data/stereo/*.txt` include `../Data/mic/*.txt` from the `Stereo/` root).
    `#define $VAR` substitutions apply to what follows; several `#include`s
    may share one line; `*sine`-style generators are not files.

    `known_files` (library-relative path -> bytes, e.g. from `git ls-tree`)
    lets the walk run before the samples are on disk, so a sparse checkout
    can fetch exactly the files an instrument needs; the .sfz/.txt files
    themselves must be readable. Missing files are reported, not invented -
    a subset that lacks a sample renders silence and fails the worker's
    audibility check, which is the point of listing them here first.
    """
    library = library.resolve()
    if known_files is None:
        index = {str(p.relative_to(library)).replace("\\", "/").lower(): (str(p.relative_to(library)).replace("\\", "/"), p.stat().st_size) for p in library.rglob("*") if p.is_file()}
    else:
        index = {k.replace("\\", "/").lower(): (k.replace("\\", "/"), v) for k, v in known_files.items()}

    def resolve(relative: str) -> tuple[str, int] | None:
        return index.get(_normalise(relative).lower())

    files: dict[str, int] = {}
    missing: list[str] = []
    visited: set[str] = set()
    root_base = PurePosixPath(_normalise(sfz)).parent
    state = {"default_path": root_base}

    def visit(relative_sfz: str, defines: dict[str, str]) -> None:
        key = _normalise(relative_sfz)
        if key.lower() in visited:
            return
        visited.add(key.lower())
        found = resolve(key)
        if found is None:
            missing.append(key)
            return
        files[found[0]] = found[1]
        local_defines = dict(defines)
        for raw in (library / found[0]).read_text(encoding="utf-8", errors="replace").splitlines():
            line = _strip_comment(raw).strip()
            if not line:
                continue
            for name, value in sorted(local_defines.items(), key=lambda kv: -len(kv[0])):
                line = line.replace(name, value)
            if line.startswith("#define"):
                parts = line.split(None, 2)
                if len(parts) == 3:
                    local_defines[parts[1]] = parts[2].strip()
                continue
            if "#include" in line:
                for included in re.findall(r'#include\s+"([^"]+)"', line):
                    visit((root_base / included.replace("\\", "/")).as_posix(), local_defines)
                continue
            for opcode, value in _opcodes(line):
                if opcode == "default_path":
                    state["default_path"] = (root_base / value.replace("\\", "/")) if value else root_base
                elif opcode == "sample" and value and not value.startswith("*"):
                    target = (state["default_path"] / value.replace("\\", "/")).as_posix()
                    sample = resolve(target)
                    if sample is None:
                        missing.append(_normalise(target))
                    else:
                        files[sample[0]] = sample[1]

    visit(sfz, {})
    return {
        "files": sorted(files),
        "bytes": sum(files.values()),
        "missing": sorted(set(missing)),
    }


def subset_files(library: Path, asset: dict, known_files: dict[str, int] | None = None) -> dict:
    """The union of every instrument's dependencies plus the licence and readme files."""
    union: dict[str, dict] = {}
    for instrument in asset["instruments"]:
        union[instrument["sfz"]] = sfz_dependencies(library, instrument["sfz"], known_files)
    files = sorted({f for deps in union.values() for f in deps["files"]})
    if known_files is None:
        top_level = {str(p.relative_to(library)).replace("\\", "/"): p.stat().st_size for p in library.iterdir() if p.is_file()}
    else:
        top_level = {k: v for k, v in known_files.items() if "/" not in k.replace("\\", "/")}
    sizes = dict(known_files or {})
    for deps in union.values():
        for relative in deps["files"]:
            sizes.setdefault(relative, (library / relative).stat().st_size if (library / relative).is_file() else 0)
    extras = sorted(name for name in top_level if name.lower().startswith(("license", "licence", "readme", "copying", "credits", "changelog")))
    licence_file = asset["licence"]["file"].replace("\\", "/")
    for extra in [*extras, licence_file]:
        if extra not in files and (extra in top_level or extra in sizes or (library / extra).is_file()):
            files.append(extra)
            sizes.setdefault(extra, top_level.get(extra) or ((library / extra).stat().st_size if (library / extra).is_file() else 0))
    files.sort()
    return {
        "files": files,
        "bytes": sum(sizes.get(f, 0) for f in files),
        "perInstrument": {sfz: {"fileCount": len(d["files"]), "bytes": d["bytes"], "missing": d["missing"]} for sfz, d in union.items()},
        "missing": sorted({m for d in union.values() for m in d["missing"]}),
    }


def family_coverage(catalogue: dict, results: dict[str, dict]) -> dict:
    """Which platform family has at least one attested, audibly rendered sampled instrument.

    `results` maps assetId -> {"activated": bool, "renders": {sfz: {"audible": bool}}}.
    A family counts only when an instrument mapped to it activated AND its
    phrase rendered audibly; everything else stays on the preview synth.
    """
    coverage: dict[str, dict] = {family: {"sampled": False, "instruments": []} for family in PLATFORM_FAMILIES}
    for asset in catalogue["assets"]:
        outcome = results.get(asset["assetId"]) or {}
        for instrument in asset["instruments"]:
            render = (outcome.get("renders") or {}).get(instrument["sfz"]) or {}
            if outcome.get("activated") and render.get("audible"):
                entry = coverage[instrument["family"]]
                entry["sampled"] = True
                entry["instruments"].append({
                    "assetId": asset["assetId"],
                    "sfz": instrument["sfz"],
                    "instrument": instrument["instrument"],
                    **({"standIn": instrument["standIn"]} if instrument.get("standIn") else {}),
                    **({"world": instrument["world"]} if instrument.get("world") else {}),
                })
    for family, entry in coverage.items():
        entry["fallback"] = None if entry["sampled"] else "LOCAL_EXPRESSIVE_SYNTH (no attested sampled instrument for this family in the cloud)"
    return coverage
