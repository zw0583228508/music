"""Add playable-range hints to an existing asset manifest (Arrangement Brain B-03).

`make_manifest.py` now records `keyRange` / `sampledRange` / `mappedKeys` /
`velocityLayers` when it writes an asset. A manifest written before B-03 has
none; this script fills them in place without loading a single plugin:

    python annotate_manifest.py                       # .local-vst3-assets/asset-manifest.json
    python annotate_manifest.py --manifest <path>     # another manifest
    python annotate_manifest.py --known-table         # regenerate known_asset_ranges.json
                                                      # from the manifest's SFZ files

Rules: an SFZ asset reads its ranges from its file; a synth (no `sfzPath`)
answers every key; an already-declared range is kept unless --force. The
worker also consults `known_asset_ranges.json` at runtime (by SFZ digest),
so restarting it after this commit publishes ranges for the known libraries
even before the manifest is annotated.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import host
import sfz_range

KNOWN_TABLE = Path(__file__).resolve().parent / "known_asset_ranges.json"


def annotate(asset: dict, force: bool) -> str:
    if not force and (asset.get("keyRange") is not None or asset.get("mappedKeys") is not None):
        return "kept"
    sfz = asset.get("sfzPath")
    if sfz:
        if not Path(sfz).is_file():
            return "sfz missing"
        for field in sfz_range.RANGE_FIELDS:
            asset.pop(field, None)
        asset.update(sfz_range.range_hints(sfz))
        return "read from sfz"
    asset["keyRange"] = [0, 127]
    asset["keyRangeSource"] = "synth: a VST3 synthesizer answers every MIDI key (no sample map)"
    return "synth"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--manifest", default=".local-vst3-assets/asset-manifest.json")
    parser.add_argument("--force", action="store_true", help="re-read ranges even where the manifest declares them")
    parser.add_argument("--known-table", action="store_true", help="also rewrite known_asset_ranges.json from the manifest's SFZ assets")
    args = parser.parse_args()
    path = Path(args.manifest).resolve()
    manifest = json.loads(path.read_text(encoding="utf-8"))
    report: list[str] = []
    for asset in host.list_assets(manifest):
        status = annotate(asset, args.force)
        report.append(f"{asset['id']}: {status} {asset.get('keyRange')}{' mapped ' + str(len(asset['mappedKeys'])) + ' keys' if asset.get('mappedKeys') else ''}")
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print("\n".join(report))
    print(f"\nwrote {path}")
    if args.known_table:
        table = json.loads(KNOWN_TABLE.read_text(encoding="utf-8")) if KNOWN_TABLE.is_file() else {"bySfzSha256": {}}
        table.setdefault("bySfzSha256", {})
        for asset in host.list_assets(manifest):
            sfz = asset.get("sfzPath")
            if not sfz or not Path(sfz).is_file():
                continue
            sha = hashlib.sha256(Path(sfz).read_bytes()).hexdigest()
            entry = {"knownAssetId": asset["id"], "library": asset.get("library", ""), "sfzFile": Path(sfz).name}
            entry.update({field: asset[field] for field in sfz_range.RANGE_FIELDS if field in asset})
            table["bySfzSha256"][sha] = entry
        KNOWN_TABLE.write_text(json.dumps(table, indent=2) + "\n", encoding="utf-8")
        print(f"wrote {KNOWN_TABLE} ({len(table['bySfzSha256'])} libraries)")


if __name__ == "__main__":
    main()
