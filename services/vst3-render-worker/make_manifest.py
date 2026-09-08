"""Write the private licensed-asset manifest for one VST3 instrument.

The manifest lives outside Git (default .local-vst3-assets/asset-manifest.json)
and names the operator's own plugin. Digests are computed here, once, so the
worker can later refuse a plugin or host binary that has changed underneath it.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import host


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin", required=True, help="VST3 bundle folder or inner binary")
    parser.add_argument("--license-owner", required=True)
    parser.add_argument("--license-reference", required=True)
    parser.add_argument("--id", help="asset id (default: derived from the plugin identifier)")
    parser.add_argument("--preset", help="optional .vstpreset to load")
    parser.add_argument("--families", help="comma-separated routing hint, e.g. drums or keys,synth")
    parser.add_argument("--roles", help="comma-separated routing hint, e.g. GROOVE or PAD,HARMONIC_BED")
    parser.add_argument("--character", help="comma-separated character words for sound selection, e.g. analog,warm or granular,pad")
    parser.add_argument("--append", action="store_true",
                        help="add this asset to an existing manifest's `assets` (keeps the existing default)")
    parser.add_argument("--out", default=".local-vst3-assets/asset-manifest.json")
    args = parser.parse_args()
    # Resolve outputs before loading: a plugin may change the working directory
    # while it initialises, and a relative --out would then land elsewhere.
    out = Path(args.out).resolve()
    preset = Path(args.preset).resolve() if args.preset else None

    plugin, identity = host.load_instrument(args.plugin, preset)
    del plugin
    asset = {
        "id": args.id or f"{identity.name.lower().replace(' ', '-')}-{identity.version}",
        "identity": identity.identity,
        "name": identity.name,
        "manufacturer": identity.manufacturer,
        "path": identity.binary_path,
        "sha256": identity.binary_sha256,
        "stateSha256": identity.state_sha256,
        "licenseOwner": args.license_owner,
        "licenseReference": args.license_reference,
        "rendererIdentity": host.renderer_identity(),
        "rendererSha256": host.renderer_sha256(),
        "runtimeIdentity": host.runtime_identity(),
    }
    if preset:
        asset["presetPath"] = str(preset)
    if args.families:
        asset["families"] = [f.strip() for f in args.families.split(",") if f.strip()]
    if args.roles:
        asset["roles"] = [r.strip() for r in args.roles.split(",") if r.strip()]
    if args.character:
        asset["character"] = [c.strip().lower() for c in args.character.split(",") if c.strip()]
    out.parent.mkdir(parents=True, exist_ok=True)
    if args.append and out.is_file():
        manifest = json.loads(out.read_text(encoding="utf-8"))
        extra = [a for a in (manifest.get("assets") or []) if a.get("id") != asset["id"]]
        if manifest.get("vst3", {}).get("id") == asset["id"]:
            manifest["vst3"] = asset
        else:
            extra.append(asset)
        manifest["assets"] = extra
        if "vst3" not in manifest:
            manifest["vst3"] = asset
    else:
        manifest = {"vst3": asset}
    out.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({**asset, "path": "<private>"}, indent=2))
    print(f"\nwrote {out} ({len(host.list_assets(manifest))} asset(s))")


if __name__ == "__main__":
    main()
