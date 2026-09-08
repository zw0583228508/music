"""Modal deployment shell for MIDI-RWKV.

Refuses at import. There is no image, no volume and no function to deploy
until the retained licence review authorises a build, and the gate is checked
before `modal` is even imported so a deploy attempt cannot create resources.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path("/app") if Path("/app/license_gate.py").is_file() else Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from license_gate import require_authorization  # noqa: E402

require_authorization("MIDI-RWKV Modal deployment")

# Unreachable while the gate is closed. Kept as the shape a permitted
# deployment would take, so authorisation is a manifest change, not a rewrite.
import modal  # noqa: E402

app = modal.App("midi-rwkv-worker")
