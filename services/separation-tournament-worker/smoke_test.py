"""Build-time smoke, run on a GPU as the image's last step.

Loads the container's one separator against its verified weights, separates a
deterministic synthetic mixture and writes the readiness marker `/health`
compares against. An image that exists is an image whose separator produced
distinct, finite, non-silent stems on a GPU.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))


def main() -> int:
    from separators import run_smoke

    separator = os.environ.get("SEPARATION_SEPARATOR", "").strip()
    if not separator:
        print("SEPARATION_SEPARATOR is not set", file=sys.stderr)
        return 2
    result = run_smoke(separator)
    (ROOT / ".readiness.json").write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k not in {"weights", "provenance"}}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
