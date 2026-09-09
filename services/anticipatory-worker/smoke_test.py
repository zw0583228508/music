"""
Build-time smoke for the Anticipatory Music Transformer worker.

A container that starts is a container whose pinned model wrote notes for a
held-out instrument of a real multitrack MIDI. The MIDI is synthesised here
with mido (three instruments, eight 4/4 bars at 100 BPM: a piano chord bed, a
bassline, a drum pulse) so the image carries no dataset content. The bass is
held out over bars 2–4 and the model must write it; the exact `infill` path
the HTTP route uses is exercised and a marker is written for `/health`.

With `AMT_SMOKE_STUB=1` the model is replaced by a random-logit stub: that
proves the MIDI → events → window → decode plumbing without weights, and is
what the local dry run uses. The image build never sets it.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

import mido

import amt_infer


def synth_multitrack(path: Path, bars: int = 8, tpq: int = 480, bpm: int = 100) -> None:
    mid = mido.MidiFile(ticks_per_beat=tpq)
    meta = mido.MidiTrack()
    meta.append(mido.MetaMessage("set_tempo", tempo=int(60e6 / bpm), time=0))
    meta.append(mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0))
    mid.tracks.append(meta)

    def track(channel: int, program: int, events: list[tuple[int, int, int, int]]) -> None:
        t = mido.MidiTrack()
        t.append(mido.Message("program_change", channel=channel, program=program, time=0))
        msgs = []
        for start, end, pitch, vel in events:
            msgs.append((start, 1, pitch, vel))
            msgs.append((end, 0, pitch, 0))
        msgs.sort()
        prev = 0
        for tick, on, pitch, vel in msgs:
            t.append(mido.Message("note_on" if on else "note_off", channel=channel, note=pitch, velocity=vel, time=tick - prev))
            prev = tick
        mid.tracks.append(t)

    prog = [(60, 64, 67), (57, 60, 64), (53, 57, 60), (55, 59, 62)]
    roots = [36, 33, 29, 31]
    keys, bass, drums = [], [], []
    for bar in range(bars):
        t0 = bar * 4 * tpq
        for p in prog[bar % 4]:
            keys.append((t0, t0 + 4 * tpq, p, 80))
        r = roots[bar % 4]
        bass.append((t0, t0 + 2 * tpq, r, 90))
        bass.append((t0 + 2 * tpq, t0 + 4 * tpq, r + 7, 90))
        for beat in range(4):
            tb = t0 + beat * tpq
            drums.append((tb, tb + 120, 36 if beat % 2 == 0 else 38, 100))
            drums.append((tb, tb + 60, 42, 70))
            drums.append((tb + tpq // 2, tb + tpq // 2 + 60, 42, 60))
    track(0, 0, keys)
    track(1, 33, bass)
    track(9, 0, drums)
    mid.save(str(path))


class _StubModel:
    """Random logits with the real vocabulary shape; proves the plumbing only."""

    def __init__(self) -> None:
        import torch

        self.device = torch.device("cpu")
        self.config = type("C", (), {"vocab_size": 55030})()

    def __call__(self, input_tokens):
        import torch

        logits = torch.randn(input_tokens.shape[0], input_tokens.shape[1], self.config.vocab_size)
        return type("O", (), {"logits": logits})()


def main() -> int:
    stub = os.environ.get("AMT_SMOKE_STUB") == "1"
    tmp = Path(tempfile.mkdtemp(prefix="amt-smoke-"))
    midi = tmp / "smoke.mid"
    synth_multitrack(midi)
    ident = None
    if not stub:
        ident = amt_infer.identity()
        if not ident["healthy"]:
            print(json.dumps({"stage": "identity", "identity": ident}, indent=2))
            return 2
    common = dict(
        target_inst=33, start_measure=2, n_measures=int(os.environ.get("AMT_SMOKE_BARS", "2")),
        seed=int(os.environ.get("AMT_SMOKE_SEED", "7")), max_events=int(os.environ.get("AMT_SMOKE_MAX_EVENTS", "48")),
        model=_StubModel() if stub else None,
    )
    # The gate is the request default — the accompaniment framing, unmasked —
    # because that is what the tournament calls and a container whose default
    # writes nothing is not a container worth starting. The masked decode is
    # run alongside and recorded: it is the configuration the evidence shows
    # failing, and keeping it in the marker keeps that honest.
    result = amt_infer.infill(str(midi), **common)
    unmasked_run = amt_infer.infill(str(midi), mask_instrument=False, **common)
    marker = {
        "stub": stub,
        "gate": "request defaults: mask_instrument=True, allow_rest=True, forbid_duplicate=True",
        "unmaskedComparison": {
            "params": "mask_instrument=False",
            "note": "on real music this returns nothing for the held-out instrument and dozens of off-target events; kept in the marker so the container carries the finding",
            "inference": unmasked_run.get("inference"),
            "output": {k: v for k, v in (unmasked_run.get("output") or {}).items() if k != "notes"},
            "definitionOfDone": unmasked_run.get("definitionOfDone"),
        },
        "identity": {k: ident[k] for k in ("model", "revision", "modelSafetensorsVerified", "vocabVerified", "runtimePinned", "runtime")} if ident else None,
        "task": result.get("task"),
        "request": result.get("request"),
        "inference": result.get("inference"),
        "output": {k: v for k, v in (result.get("output") or {}).items() if k != "notes"},
        "definitionOfDone": result.get("definitionOfDone"),
        "failure": result.get("failure"),
    }
    out = Path(os.environ.get("AMT_SMOKE_MARKER", "/app/smoke-marker.json"))
    out.write_text(json.dumps(marker, indent=2))
    print(json.dumps(marker, indent=2))
    dod = result.get("definitionOfDone") or {}
    if stub:
        # Random logits prove the plumbing, not the music: the pipeline must run
        # the sampler and refuse nothing. Notes are the real smoke's job.
        return 0 if (dod.get("realModelInference") and not result.get("failure")) else 3
    return 0 if dod.get("realSymbolicOutput") else 3


if __name__ == "__main__":
    sys.exit(main())
