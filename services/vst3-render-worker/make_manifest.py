"""Write the private licensed-asset manifest for one VST3 instrument.

The manifest lives outside Git (default .local-vst3-assets/asset-manifest.json)
and names the operator's own plugin. Digests are computed here, once, so the
worker can later refuse a plugin or host binary that has changed underneath it.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

import host
import sfz_range


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugin", required=True, help="VST3 bundle folder or inner binary")
    parser.add_argument("--license-owner", required=True)
    parser.add_argument("--license-reference", required=True)
    parser.add_argument("--id", help="asset id (default: derived from the plugin identifier)")
    parser.add_argument("--preset", help="optional .vstpreset to load")
    parser.add_argument("--sfz", help="SFZ instrument for a sampler plugin (sfizz); one asset per library")
    parser.add_argument("--plugin-name", help="plugin to pick from a binary that exports several (e.g. sfizz)")
    parser.add_argument("--name", help="display name for sound selection (default: the plugin's own name)")
    parser.add_argument("--library", help="library name and licence note shown with the asset, e.g. 'Salamander Grand Piano V3 (CC-BY 3.0)'")
    parser.add_argument("--families", help="comma-separated routing hint, e.g. drums or keys,synth")
    parser.add_argument("--roles", help="comma-separated routing hint, e.g. GROOVE or PAD,HARMONIC_BED")
    parser.add_argument("--character", help="comma-separated character words for sound selection, e.g. analog,warm or granular,pad")
    parser.add_argument("--patches", help="comma-separated names of the presets/patches installed for this plugin (descriptive)")
    parser.add_argument("--gain-trim-db", type=float, help="measured level trim in dB the API applies to this asset's stems (PR-97)")
    parser.add_argument("--keyswitches", help="preset keyswitch table, e.g. legato=0,long=1,short=2 (PR-97; read from the loaded preset)")
    parser.add_argument("--articulation-protocol", choices=("keyswitch", "uacc"), help="how the loaded preset switches articulations (Spitfire default: keyswitch)")
    parser.add_argument("--key-range", help="lowest,highest MIDI key the asset sounds (B-03); an --sfz asset reads it from its regions unless given")
    parser.add_argument("--articulations", help="comma-separated articulations the asset offers, e.g. sustain,vibrato or arco,pizzicato")
    parser.add_argument("--append", action="store_true",
                        help="add this asset to an existing manifest's `assets` (keeps the existing default)")
    parser.add_argument("--out", default=".local-vst3-assets/asset-manifest.json")
    args = parser.parse_args()
    # Resolve outputs before loading: a plugin may change the working directory
    # while it initialises, and a relative --out would then land elsewhere.
    out = Path(args.out).resolve()
    preset = Path(args.preset).resolve() if args.preset else None
    sfz = Path(args.sfz).resolve() if args.sfz else None

    plugin, identity = host.load_instrument(args.plugin, preset, plugin_name=args.plugin_name, sfz_path=sfz)
    del plugin
    default_id = f"{identity.name.lower().replace(' ', '-')}-{identity.version}"
    if sfz and not args.id:
        default_id = f"{default_id}-{re.sub(r'[^a-z0-9]+', '-', sfz.stem.lower()).strip('-')}"
    asset = {
        "id": args.id or default_id,
        "identity": identity.identity,
        "name": args.name or identity.name,
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
    if args.plugin_name:
        asset["pluginName"] = args.plugin_name
    if sfz:
        asset["sfzPath"] = str(sfz)
        asset["sfzSha256"] = host.sha256_file(sfz)
    if args.library:
        asset["library"] = args.library
    if args.families:
        asset["families"] = [f.strip() for f in args.families.split(",") if f.strip()]
    if args.roles:
        asset["roles"] = [r.strip() for r in args.roles.split(",") if r.strip()]
    if args.character:
        asset["character"] = [c.strip().lower() for c in args.character.split(",") if c.strip()]
    if args.patches:
        asset["patches"] = [p.strip() for p in args.patches.split(",") if p.strip()]
    if args.gain_trim_db is not None:
        asset["gainTrimDb"] = args.gain_trim_db
    if args.keyswitches or args.articulation_protocol:
        articulation: dict = {}
        if args.articulation_protocol:
            articulation["protocol"] = args.articulation_protocol
        if args.keyswitches:
            articulation["keyswitches"] = {
                pair.split("=", 1)[0].strip(): int(pair.split("=", 1)[1]) for pair in args.keyswitches.split(",") if "=" in pair
            }
        asset["articulation"] = articulation
    # B-03: the keys the asset actually sounds. An SFZ library says so itself;
    # a synth answers every key; anything else is declared or left unverified.
    if args.key_range:
        lo, hi = (int(v) for v in args.key_range.split(","))
        asset["keyRange"] = [lo, hi]
        asset["keyRangeSource"] = "operator-declared"
    elif sfz:
        asset.update(sfz_range.range_hints(sfz))
    else:
        asset["keyRange"] = [0, 127]
        asset["keyRangeSource"] = "synth: a VST3 synthesizer answers every MIDI key (no sample map)"
    if args.articulations:
        asset["articulations"] = [a.strip().lower() for a in args.articulations.split(",") if a.strip()]
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
    print(json.dumps({**asset, "path": "<private>", **({"sfzPath": "<private>"} if sfz else {})}, indent=2))
    print(f"\nwrote {out} ({len(host.list_assets(manifest))} asset(s))")


if __name__ == "__main__":
    main()
