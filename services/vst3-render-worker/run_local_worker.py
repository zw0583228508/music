"""Start the worker with the operator's private settings from `.env.local`.

Reads VST3_RENDER_TOKEN from the repo's `.env.local` (never printed), points
the manifest/state at absolute paths given on the command line, and runs
uvicorn on the requested port. Nothing here is committed with secrets: the
file only knows *where* the settings live.

    python run_local_worker.py --port 8023 --env ../../.env.local \
        --manifest <abs path>/asset-manifest.json --state-dir <abs path>/state
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def load_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8023)
    parser.add_argument("--env", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--state-dir", required=True)
    args = parser.parse_args()
    env = load_env_file(Path(args.env).resolve())
    token = env.get("VST3_RENDER_TOKEN", "").strip()
    if not token:
        raise SystemExit("VST3_RENDER_TOKEN is not set in the env file")
    os.environ["VST3_RENDER_TOKEN"] = token
    os.environ["VST3_RENDER_ASSET_MANIFEST"] = str(Path(args.manifest).resolve())
    os.environ["VST3_RENDER_STATE_DIR"] = str(Path(args.state_dir).resolve())
    print(f"worker: manifest={os.environ['VST3_RENDER_ASSET_MANIFEST']} state={os.environ['VST3_RENDER_STATE_DIR']} port={args.port}", file=sys.stderr, flush=True)
    import uvicorn

    sys.path.insert(0, str(Path(__file__).resolve().parent))
    uvicorn.run("app:app", host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
