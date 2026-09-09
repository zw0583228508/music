"""
Build-time smoke for the Composer's Assistant 2 worker.

A container that starts is a container whose pinned model produced notes from a
real multitrack MIDI. The MIDI is synthesised here with miditoolkit (three
tracks, eight 4/4 bars: a keys chord bed, a bassline, a drum pulse) so the
image carries no dataset content and the smoke is deterministic for its seed.
It then runs the exact `infill` path the HTTP route uses and writes the marker
`/health` and the evidence pipeline read.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import miditoolkit

import ca2_infer


def synth_multitrack(path: Path, bars: int = 8, tpq: int = 480) -> None:
    mid = miditoolkit.MidiFile(ticks_per_beat=tpq)
    mid.tempo_changes = [miditoolkit.TempoChange(tempo=100, time=0)]
    mid.time_signature_changes = [miditoolkit.TimeSignature(numerator=4, denominator=4, time=0)]
    keys = miditoolkit.Instrument(program=0, is_drum=False, name="keys")
    bass = miditoolkit.Instrument(program=33, is_drum=False, name="bass")
    drums = miditoolkit.Instrument(program=0, is_drum=True, name="drums")
    prog = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]
    roots = [36, 33, 29, 31]
    for bar in range(bars):
        t0 = bar * 4 * tpq
        chord = prog[bar % 4]
        for p in chord:
            keys.notes.append(miditoolkit.Note(velocity=80, pitch=p, start=t0, end=t0 + 4 * tpq))
        r = roots[bar % 4]
        bass.notes.append(miditoolkit.Note(velocity=90, pitch=r, start=t0, end=t0 + 2 * tpq))
        bass.notes.append(miditoolkit.Note(velocity=90, pitch=r + 7, start=t0 + 2 * tpq, end=t0 + 4 * tpq))
        for beat in range(4):
            tb = t0 + beat * tpq
            drums.notes.append(miditoolkit.Note(velocity=100, pitch=36 if beat % 2 == 0 else 38, start=tb, end=tb + 120))
            drums.notes.append(miditoolkit.Note(velocity=70, pitch=42, start=tb, end=tb + 60))
            drums.notes.append(miditoolkit.Note(velocity=60, pitch=42, start=tb + tpq // 2, end=tb + tpq // 2 + 60))
    mid.instruments.extend([keys, bass, drums])
    mid.dump(str(path))


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="ca2-smoke-"))
    midi = tmp / "smoke.mid"
    synth_multitrack(midi)
    ident = ca2_infer.identity()
    if not ident["healthy"]:
        print(json.dumps({"stage": "identity", "identity": ident}, indent=2))
        return 2
    # Hold out the keys track: given bass + drums, write the keys.
    result = ca2_infer.infill(str(midi), target_track=None, start_measure=0, n_measures=8, seed=int(os.environ.get("CA2_SMOKE_SEED", "7")), max_new_tokens=600)
    # PR-74: the same infill with CA2's own instructions — a mono line inside
    # C2..C5 at the model's own density bin 2, loudness level 3 — proves the
    # instruction path renders, encodes and decodes inside the image.
    instructed = ca2_infer.infill(
        str(midi), target_track=None, start_measure=0, n_measures=8, seed=int(os.environ.get("CA2_SMOKE_SEED", "7")), max_new_tokens=600,
        instructions={"atEnd": [{"id": 7}, {"id": 3}, {"id": 48, "note": 36}, {"id": 47, "note": 72}], "perCell": [39], "loudness": 3},
    )
    plan = (instructed.get("account") or {}).get("instructions") or {}
    marker = {
        "identity": {k: ident[k] for k in ("release", "modelBinVerified", "vocabVerified", "runtimePinned", "runtime")},
        "task": result.get("task"),
        "inference": result.get("inference"),
        "output": {k: v for k, v in (result.get("output") or {}).items() if k != "notes"},
        "definitionOfDone": result.get("definitionOfDone"),
        "failure": result.get("failure"),
        "instructed": {
            "applied": [a.get("token") for a in plan.get("applied", [])],
            "refused": plan.get("refused"),
            "loudnessLevels": plan.get("loudnessLevels"),
            "inputTail": (instructed.get("request") or {}).get("inputTail"),
            "output": {k: v for k, v in (instructed.get("output") or {}).items() if k != "notes"},
            "definitionOfDone": instructed.get("definitionOfDone"),
            "failure": instructed.get("failure"),
        },
    }
    out = Path(os.environ.get("CA2_SMOKE_MARKER", "/app/smoke-marker.json"))
    out.write_text(json.dumps(marker, indent=2))
    print(json.dumps(marker, indent=2))
    dod = result.get("definitionOfDone") or {}
    dod_instructed = instructed.get("definitionOfDone") or {}
    if plan.get("refused"):
        return 4  # the smoke's instructions are all trained ids; a refusal is a worker bug
    return 0 if dod.get("realSymbolicOutput") and dod_instructed.get("realSymbolicOutput") else 3


if __name__ == "__main__":
    sys.exit(main())
