"""Find the VST3 instruments pedalboard can host on this machine.

Each plugin is probed in its own subprocess with a timeout: a plugin that
opens a licence dialog or crashes on load must not take the worker down with
it. Effects are recorded too, marked as such, because the operator needs to
know why a plugin they own is not offered as an instrument.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import host

DEFAULT_DIRS = [
    r"C:\Program Files\Common Files\VST3",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Common\VST3"),
    "/Library/Audio/Plug-Ins/VST3",
    os.path.expanduser("~/Library/Audio/Plug-Ins/VST3"),
    "/usr/lib/vst3",
    "/usr/local/lib/vst3",
    os.path.expanduser("~/.vst3"),
]

_PROBE = r"""
import json, sys, time, hashlib
from pathlib import Path
sys.path.insert(0, sys.argv[2])
import host
t0 = time.time()
try:
    plugin, identity = host.load_instrument(sys.argv[1])
    print(json.dumps({"ok": True, "loadSeconds": round(time.time() - t0, 2), **identity.to_dict()}))
except ValueError as e:
    # Loaded, but not an instrument.
    from pedalboard import load_plugin
    p = load_plugin(str(host.resolve_plugin_binary(sys.argv[1])))
    print(json.dumps({"ok": True, "is_instrument": False, "name": str(p.name), "identifier": str(getattr(p, "identifier", "")),
                      "version": str(getattr(p, "version", "")), "manufacturer": str(getattr(p, "manufacturer_name", "")),
                      "category": str(getattr(p, "category", "")), "loadSeconds": round(time.time() - t0, 2)}))
except Exception as e:
    print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {str(e)[:300]}"}))
"""


def candidate_bundles(directories: list[str]) -> list[Path]:
    found: list[Path] = []
    for directory in directories:
        root = Path(directory)
        if not root.is_dir():
            continue
        for path in sorted(root.rglob("*.vst3")):
            # Bundles contain their binary under Contents/; skip the inner file
            # so each plugin is probed once, by its bundle.
            if "Contents" in path.parts:
                continue
            found.append(path)
    return found


def probe(bundle: Path, timeout_seconds: float = 60.0) -> dict:
    try:
        binary = host.resolve_plugin_binary(bundle)
    except FileNotFoundError as error:
        return {"bundle": str(bundle), "ok": False, "error": str(error)}
    completed = subprocess.run(
        [sys.executable, "-c", _PROBE, str(binary), str(Path(__file__).resolve().parent)],
        capture_output=True, text=True, timeout=timeout_seconds, encoding="utf-8", errors="replace",
    )
    line = next((l for l in reversed(completed.stdout.splitlines()) if l.startswith("{")), None)
    result = json.loads(line) if line else {"ok": False, "error": (completed.stderr or "no output")[-300:]}
    return {"bundle": str(bundle), "binary": str(binary), **result}


def scan(directories: list[str] | None = None, timeout_seconds: float = 60.0, only: str | None = None) -> list[dict]:
    results = []
    for bundle in candidate_bundles(directories or DEFAULT_DIRS):
        if only and only.lower() not in bundle.name.lower():
            continue
        try:
            results.append(probe(bundle, timeout_seconds))
        except subprocess.TimeoutExpired:
            results.append({"bundle": str(bundle), "ok": False, "error": f"load exceeded {timeout_seconds}s (dialog or hang)"})
    return results


def inventory_path() -> Path:
    return host.default_state_dir() / "instrument-inventory.json"


def inventory(refresh: bool = False, **kwargs) -> dict:
    path = inventory_path()
    if not refresh and path.is_file():
        return json.loads(path.read_text(encoding="utf-8"))
    started = time.time()
    results = scan(**kwargs)
    payload = {
        "scannedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "scanSeconds": round(time.time() - started, 1),
        "hostIdentity": host.renderer_identity(),
        "instruments": [r for r in results if r.get("ok") and r.get("is_instrument")],
        "effects": [r for r in results if r.get("ok") and not r.get("is_instrument")],
        "failed": [r for r in results if not r.get("ok")],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="List VST3 instruments pedalboard can host here.")
    parser.add_argument("--only", help="substring filter on the bundle name")
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--dir", action="append", help="extra VST3 directory (repeatable)")
    args = parser.parse_args()
    dirs = DEFAULT_DIRS + (args.dir or [])
    result = inventory(refresh=True, directories=dirs, timeout_seconds=args.timeout, only=args.only)
    for item in result["instruments"]:
        print(f"INSTRUMENT  {item['name']:<28} {item.get('identity','')}  ({item['loadSeconds']}s)  {item['bundle']}")
    for item in result["effects"]:
        print(f"effect      {item['name']:<28} {item.get('category','')}")
    for item in result["failed"]:
        print(f"FAILED      {Path(item['bundle']).name:<28} {item['error'][:90]}")
    print(f"\n{len(result['instruments'])} instrument(s), {len(result['effects'])} effect(s), {len(result['failed'])} failed -> {inventory_path()}")
