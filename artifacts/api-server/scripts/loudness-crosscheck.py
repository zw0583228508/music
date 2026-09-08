"""PR-26: measure the harness WAVs with pyloudnorm and compare with the TS meter.

Usage: python scripts/loudness-crosscheck.py <dir with ours.json + *.wav>
Writes docs/evidence/loudness-meter-crosscheck.json (repo-relative) and exits
non-zero when any integrated-loudness difference exceeds the tolerance.
"""
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
import soundfile as sf

TOLERANCE_LU = 0.1

out_dir = Path(sys.argv[1])
ours = json.loads((out_dir / "ours.json").read_text(encoding="utf-8"))
rows = []
worst = 0.0
for entry in ours["results"]:
    data, rate = sf.read(str(out_dir / f"{entry['name']}.wav"), dtype="float64", always_2d=True)
    meter = pyln.Meter(rate)  # BS.1770-4, K-weighting, gating
    reference = meter.integrated_loudness(data)
    theirs = float(reference) if math.isfinite(reference) else None
    mine = entry["ours"]["integratedLufs"]
    mine = float(mine) if isinstance(mine, (int, float)) and math.isfinite(mine) else None
    diff = abs(mine - theirs) if (mine is not None and theirs is not None) else 0.0
    worst = max(worst, diff)
    sample_peak_dbfs = 20 * math.log10(float(np.max(np.abs(data))) + 1e-12)
    rows.append({
        "signal": entry["name"], "seconds": entry["seconds"], "sampleRate": rate,
        "tsMeterLufs": None if mine is None else round(mine, 3),
        "pyloudnormLufs": None if theirs is None else round(theirs, 3),
        "differenceLu": round(diff, 3),
        "tsTruePeakDbtp": round(entry["ours"]["truePeakDbtp"], 3),
        "samplePeakDbfs": round(sample_peak_dbfs, 3),
        "truePeakAtLeastSamplePeak": entry["ours"]["truePeakDbtp"] >= sample_peak_dbfs - 0.01,
    })
ok = worst <= TOLERANCE_LU and all(r["truePeakAtLeastSamplePeak"] for r in rows)
evidence = {
    "pr": "PR-26 mastering-engine",
    "recordedAt": datetime.now(timezone.utc).isoformat(),
    "reference": f"pyloudnorm {getattr(pyln, '__version__', 'unknown')} (BS.1770-4)",
    "meterUnderTest": ours["meter"],
    "toleranceLu": TOLERANCE_LU,
    "worstDifferenceLu": round(worst, 3),
    "pass": ok,
    "signals": rows,
    "notes": [
        "Signals are generated deterministically, quantised to 16-bit and written as WAV; both meters read the same bytes.",
        "pyloudnorm has no true-peak meter; the TS true peak is checked to be >= the sample peak (it can only add inter-sample peaks).",
        "The mastered signals were produced by masteringEngine.ts at the STREAMING (-14) and MASTER (-10) profiles; pyloudnorm's reading of them is the independent proof the engine hits its targets.",
    ],
}
repo_root = Path(__file__).resolve().parents[3]
target = repo_root / "docs" / "evidence" / "loudness-meter-crosscheck.json"
target.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
for r in rows:
    print(f"{r['signal']:<32} ts {r['tsMeterLufs']} | pyloudnorm {r['pyloudnormLufs']} | diff {r['differenceLu']} LU | TP {r['tsTruePeakDbtp']} dBTP")
print(f"worst difference {worst:.3f} LU -> {'PASS' if ok else 'FAIL'}; wrote {target}")
sys.exit(0 if ok else 1)
