"""
Anticipatory Music Transformer inference core (Wave Q — Model Discovery, round 2).

One implementation shared by the HTTP worker, the build-time smoke and any
scratch probe, so the "hold out one instrument over a bar window and let the
model write it" rule exists exactly once.

Pinned identity — a container that cannot verify these is not this model:
  checkpoint   stanford-crfm/music-large-800k @ e206a88d…  model.safetensors  sha256 83fb8b95…
  code         github.com/jthickstun/anticipation @ af373979…  (module shas below)

What the model is: a 780M-parameter GPT-2 (36 layers, d 1280, 20 heads, 1024
context) over an arrival-time event vocabulary — every note is three tokens
(onset at 10 ms, duration at 10 ms, instrument×128+pitch) — trained with
*anticipation*: control events are interleaved into the stream up to DELTA =
5 s before the events they constrain, so a model can be conditioned on notes
that happen later in the piece.

How our task maps onto it — the accompaniment framing, inverted. Upstream
generates the *event* stream while *controls* are the parts it is given. So:

  event stream  the held-out instrument's own line outside the window
                (rest-padded up to the window; its notes after the window
                become controls, as upstream does for any prompt's future)
  controls      every other instrument, everywhere

The model then samples events until it passes the end of the window, and what
it writes is the held-out part. Nothing is masked: the instrument comes out of
the split, not out of a token the model read, and `offTargetEventsDropped`
records any event that still belongs to someone else.

The three deploys before this one put the *whole band* in the event prompt and
tried to recover the task with an instrument mask on the note slot. It does
not work, and the numbers are kept in `_instrument_mask` because they are the
finding: unmasked the model wrote 9–26 events on a real PDMX score and not one
of them for the held-out instrument (it was still writing the band); masked it
stacked up to 124 notes on a single onset, because overriding its instrument
choice leaves its intent at that onset unsatisfied and time never advances.
`mask_instrument` survives as a request switch so the evidence can show it.

Licence position (Global Model Registry): code and weights Apache-2.0; the
training corpus (Lakh MIDI + MetaMIDI + FMA transcripts + 450k transcribed
commercial records) is not cleared at the level of the underlying works, so
this is RESEARCH_ONLY — a shadow challenger and a benchmark line, never
routed to a user, its outputs reviewed and never trained on without counsel.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

PROVIDER = "ANTICIPATORY_MUSIC_TRANSFORMER"
MODEL_ID = "stanford-crfm/music-large-800k"
MODEL_REVISION = "e206a88d4658661c2757573eae724d5b27213824"
MODEL_SAFETENSORS_SHA256 = "83fb8b9546eacce77a90bb10006b3f569ba342361dce046d078cf2429975e09f"
MODEL_SAFETENSORS_BYTES = 3120598456
MODEL_CONFIG_SHA256 = "2ece2a78b4d9b48aca5dbc36e15779520e540ddec7eedf524dcdfa276b9a5046"
ANTICIPATION_COMMIT = "af37397922665a0fb8d474d7988b0f3755a38d45"
# sha256 of the git blobs (LF line endings, as pip installs them from the
# commit). The first deploy failed on shas taken from a Windows checkout that
# had been CRLF-converted — recorded in the evidence, and the reason these
# come from `git cat-file -p HEAD:anticipation/<file>`.
ANTICIPATION_MODULE_SHA256 = {
    "config.py": "5765aecff71fe107108d14c02cdc675dbf5a12538d287eab349fb71d373f2f3c",
    "convert.py": "3383f80572bf2e4b85672936a490effe4f1b669ea79b49e6ebd3bacb7dc6f3b6",
    "ops.py": "929a6da4d86e7ecfa3255fb1ee7524600509ed0f885c8473b64233a46c9d1f78",
    "sample.py": "17d98e828a5687cea623570d085828e91a978fe38bb949270467c8027d920718",
    "vocab.py": "a8d6c1b376e0be396a1185e3e9bb74891851400da06d9c5c9d29bd835c0368c7",
}
EXPECTED_VOCAB_SIZE = 55028  # anticipation.vocab.VOCAB_SIZE; the checkpoint's embedding has 55030 rows, two never sampled
EXPECTED_TRANSFORMERS = "4.32.1"
DRUMS = 128

MODEL_DIR = Path(os.environ.get("AMT_MODEL_DIR", "/app/model"))
# The model sees at most 341 events; 20 s of history is more than it can use
# in dense music and enough for it to settle in sparse music. Everything must
# fit under the vocabulary's 100 s clock, so the lookahead is short.
HISTORY_SECONDS = float(os.environ.get("AMT_HISTORY_SECONDS", "20"))
LOOKAHEAD_SECONDS = float(os.environ.get("AMT_LOOKAHEAD_SECONDS", "8"))
DEFAULT_VELOCITY = 80

RECEIVED = [
    "siblingParts.notes (the other instruments inside the window, as anticipated controls; before and after it, as prompt and later controls)",
    "instrument (the held-out GM program, enforced by an instrument mask on the note slot)",
    "candidateStrategy.seed (torch.manual_seed before sampling)",
]
APPROXIMATED = [
    "section → bare bar window in seconds under the file's first tempo and first time signature",
    "tracks sharing a GM program are one instrument to this model — the held-out part is the program, not the track",
    "velocity: the model has no velocity token; every generated note is emitted at a constant velocity",
    "tempo changes inside the file are flattened to the first tempo so bar numbers mean the same thing to every provider",
    "hardConstraints.polyphony / range → none sent (enforce after)",
]
UNSUPPORTED = [
    "styleGrammar", "harmonyPlan", "vocalAttentionMap", "motifMemory",
    "previousSectionSummary", "nextSectionIntent", "role", "phrases", "productionBriefRef",
    "songModel.chords (no harmony token; chords are implicit in the control notes)",
]


def sha256_file(path: Path, block: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(block)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _anticipation_dir() -> Path | None:
    spec = importlib.util.find_spec("anticipation")
    if spec is None or not spec.origin:
        return None
    return Path(spec.origin).resolve().parent


def verify_code() -> dict[str, Any]:
    """The upstream package is pinned by commit; the modules that decide the
    vocabulary and the decode are re-hashed here so a silent upgrade is caught."""
    directory = _anticipation_dir()
    if directory is None:
        return {"present": False, "verified": False, "modules": {}}
    modules = {}
    for name, expected in ANTICIPATION_MODULE_SHA256.items():
        path = directory / name
        actual = sha256_file(path) if path.is_file() else None
        modules[name] = {"expected": expected, "actual": actual, "ok": actual == expected}
    return {"present": True, "verified": all(m["ok"] for m in modules.values()), "modules": modules, "commit": ANTICIPATION_COMMIT}


_WEIGHTS_VERIFIED: bool | None = None


def verify_weights(force: bool = False) -> bool:
    """3.1 GB hashes in ~10 s; the result is cached per process after the first check."""
    global _WEIGHTS_VERIFIED
    if _WEIGHTS_VERIFIED is None or force:
        path = MODEL_DIR / "model.safetensors"
        _WEIGHTS_VERIFIED = path.is_file() and path.stat().st_size == MODEL_SAFETENSORS_BYTES and sha256_file(path) == MODEL_SAFETENSORS_SHA256
    return _WEIGHTS_VERIFIED


def identity() -> dict[str, Any]:
    """What `/health` reports. Verified, not assumed."""
    import torch
    import transformers

    cfg_path = MODEL_DIR / "config.json"
    cfg = json.loads(cfg_path.read_text()) if cfg_path.is_file() else {}
    cfg_ok = cfg_path.is_file() and sha256_file(cfg_path) == MODEL_CONFIG_SHA256
    weights_ok = verify_weights()
    code = verify_code()
    vocab_ok = False
    if code["present"]:
        from anticipation.vocab import VOCAB_SIZE  # noqa: E402
        vocab_ok = VOCAB_SIZE == EXPECTED_VOCAB_SIZE and cfg.get("vocab_size", 0) >= VOCAB_SIZE
    cuda = torch.cuda.is_available()
    return {
        "provider": PROVIDER,
        "model": MODEL_ID,
        "revision": MODEL_REVISION,
        "modelSafetensorsSha256Expected": MODEL_SAFETENSORS_SHA256,
        "modelSafetensorsVerified": weights_ok,
        "configSha256Verified": cfg_ok,
        "config": {k: cfg.get(k) for k in ("architectures", "n_layer", "n_embd", "n_head", "n_positions", "vocab_size", "transformers_version", "model_type")},
        "code": {"commit": ANTICIPATION_COMMIT, "verified": code["verified"]},
        "vocabSize": EXPECTED_VOCAB_SIZE,
        "vocabVerified": vocab_ok,
        "runtime": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "cuda": cuda,
            "device": torch.cuda.get_device_name(0) if cuda else "cpu",
        },
        "runtimePinned": transformers.__version__ == EXPECTED_TRANSFORMERS,
        "licence": {
            "code": "Apache-2.0 (repository LICENSE.txt, read verbatim)",
            "weights": "Apache-2.0 (Hugging Face model card front matter, read verbatim)",
            "trainingData": "Lakh MIDI + MetaMIDI + FMA transcripts + 450k transcribed commercial records (model card) — underlying works not cleared",
            "classification": "RESEARCH_ONLY — shadow challenger / benchmark; never routed to users; outputs reviewed, never trained on without counsel",
        },
        "healthy": bool(weights_ok and cfg_ok and vocab_ok and code["verified"] and transformers.__version__ == EXPECTED_TRANSFORMERS),
    }


_MODEL = None


def _load():
    global _MODEL
    if _MODEL is None:
        import torch
        from transformers import AutoModelForCausalLM

        if not verify_weights():
            raise RuntimeError("model.safetensors does not match the pinned sha256; refusing to load")
        if not verify_code()["verified"]:
            raise RuntimeError("the anticipation package does not match the pinned module shas; refusing to load")
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _MODEL = AutoModelForCausalLM.from_pretrained(str(MODEL_DIR)).to(device).eval()
    return _MODEL


# ---------------------------------------------------------------------------
# MIDI → events under one tempo, with bar arithmetic
# ---------------------------------------------------------------------------

def read_timebase(path: str) -> dict[str, Any]:
    """The first tempo and first time signature *by time*, as the platform's parser takes them."""
    import mido

    mid = mido.MidiFile(path)
    tempo = None
    ts = None
    tempo_count = 0
    signatures = set()
    for msg in mido.merge_tracks(mid.tracks):
        if msg.type == "set_tempo":
            tempo_count += 1
            if tempo is None:
                tempo = msg.tempo
        elif msg.type == "time_signature":
            signatures.add((msg.numerator, msg.denominator))
            if ts is None:
                ts = (msg.numerator, msg.denominator)
    tempo = tempo or 500000
    ts = ts or (4, 4)
    bpm = 60e6 / tempo
    quarters_per_bar = ts[0] * (4.0 / ts[1])
    return {
        "ticksPerQuarter": mid.ticks_per_beat,
        "tempoUs": tempo,
        "bpm": bpm,
        "tempoEvents": tempo_count,
        "timeSignature": {"numerator": ts[0], "denominator": ts[1]},
        "distinctTimeSignatures": len(signatures),
        "barSeconds": quarters_per_bar * tempo / 1e6,
        "quartersPerBar": quarters_per_bar,
        "lengthSeconds": mid.length,
    }


def normalize_tempo(path: str, tempo_us: int):
    """A copy of the file whose every set_tempo is the first tempo, so that
    seconds are ticks × one constant — the tournament's time base."""
    import mido

    src = mido.MidiFile(path)
    out = mido.MidiFile(ticks_per_beat=src.ticks_per_beat, type=src.type)
    for track in src.tracks:
        t = mido.MidiTrack()
        for msg in track:
            if msg.type == "set_tempo":
                t.append(mido.MetaMessage("set_tempo", tempo=tempo_us, time=msg.time))
            else:
                t.append(msg)
        out.tracks.append(t)
    return out


def _instr_of(note_token: int) -> int:
    from anticipation.vocab import NOTE_OFFSET
    return (note_token - NOTE_OFFSET) // 128


def _triplets(tokens: list[int]):
    return zip(tokens[0::3], tokens[1::3], tokens[2::3])


# ---------------------------------------------------------------------------
# Instrument-constrained anticipatory sampling
# ---------------------------------------------------------------------------

def _instrument_mask(vocab_rows: int, instr: int, device, allow_rest: bool, mask_instrument: bool):
    """The note slot's mask, added to the third token of an event, where
    `sample.safe_logits` has already left nothing alive but the note block and
    `REST`.

    Four deploys and two four-way sweeps on the same real PDMX task settled
    what this is for. **Before** the event stream was split by instrument (the
    whole band was in the prompt), the mask was destructive: the model kept
    meaning to write other instruments, we kept overriding its choice, its
    intent at that onset was never satisfied and time never advanced — 48 to
    124 notes stacked on a single onset, in all four rest/duplicate
    combinations. **After** the split, the same mask is benign and necessary:
    88 notes over 53 distinct onsets across all eight bars, deepest stack 2,
    nothing off-target.

    It is necessary because unmasked the model *still* writes the other
    instruments even though every one of them is already an anticipated
    control: 57 and 99 off-target events on that task, and **zero** notes for
    the held-out one. That is the honest measure of this model's fit — it has
    no instrument conditioning of any kind, so the part it writes is decided
    by our harness (which stream each note goes in, plus this mask) and never
    by anything it read. `mask_instrument` stays a request switch so the
    evidence can keep showing it.
    """
    import torch
    from anticipation.config import MAX_PITCH
    from anticipation.vocab import NOTE_OFFSET, REST

    if not mask_instrument:
        mask = torch.zeros((vocab_rows,), device=device)
        if not allow_rest:
            mask[REST] = -float("inf")
        return mask
    mask = torch.full((vocab_rows,), -float("inf"), device=device)
    lo = NOTE_OFFSET + instr * MAX_PITCH
    mask[lo:lo + MAX_PITCH] = 0.0
    if allow_rest:
        mask[REST] = 0.0
    return mask


def _add_token(model, z, tokens, top_p, current_time, note_mask_for, stats):
    """One event (time, duration, note). `note_mask_for(onset)` builds the note
    slot's mask once the onset has been sampled, so a duplicate ban can depend
    on it."""
    import torch
    import torch.nn.functional as F
    from anticipation import ops, sample
    from anticipation.vocab import TIME_OFFSET

    history = tokens.copy()
    lookback = max(len(tokens) - 1017, 0)
    history = history[lookback:]
    offset = ops.min_time(history, seconds=False)
    history[::3] = [tok - offset for tok in history[::3]]

    new_token = []
    with torch.no_grad():
        for i in range(3):
            input_tokens = torch.tensor(z + history + new_token).unsqueeze(0).to(model.device)
            logits = model(input_tokens).logits[0, -1]
            stats["forwardPasses"] += 1
            stats["maxContext"] = max(stats["maxContext"], int(input_tokens.shape[1]))
            idx = input_tokens.shape[1] - 1
            logits = sample.safe_logits(logits, idx)
            if i == 0:
                logits = sample.future_logits(logits, current_time - offset)
            elif i == 2:
                logits = sample.instr_logits(logits, tokens)
                logits = logits + note_mask_for(new_token[0] - TIME_OFFSET + offset)
            logits = sample.nucleus(logits, top_p)
            probs = F.softmax(logits, dim=-1)
            token = torch.multinomial(probs, 1)
            new_token.append(int(token))
    new_token[0] += offset
    return new_token


def generate_instrument(model, start_time: float, end_time: float, inputs: list[int], instr: int,
                        controls: list[int] | None = None,
                        top_p: float = 0.98, max_events: int = 400, allow_rest: bool = True,
                        forbid_duplicate: bool = True, mask_instrument: bool = True) -> tuple[list[int], dict[str, Any]]:
    """`anticipation.sample.generate`, in the framing the paper actually
    supports, plus a cap.

    `inputs` is the **held-out instrument's own line** — the event stream the
    model is continuing. `controls` is **every other instrument**, anticipated.
    That split is the whole trick, and getting it wrong is what the first three
    deploys got wrong: they put the entire band in the event prompt, so the
    model went on writing the entire band. Unmasked it then wrote 9–26 events
    on a real PDMX score and *not one of them* for the held-out instrument;
    masked, it stacked up to 124 notes on a single onset because we kept
    overriding the instrument it meant to write and time never advanced.

    Returns the generated **note** events (absolute time, in the translated
    frame) and sampling statistics. Rests are fed back into the model's context
    — they are part of the sequence it is continuing — but they are not notes
    and are not returned."""
    import math

    import torch

    from anticipation import ops
    from anticipation.config import DELTA, TIME_RESOLUTION
    from anticipation.vocab import ANTICIPATE, ATIME_OFFSET, AUTOREGRESS, CONTROL_OFFSET, REST, TIME_OFFSET

    delta = DELTA * TIME_RESOLUTION
    start = int(TIME_RESOLUTION * start_time)
    end = int(TIME_RESOLUTION * end_time)

    # The event stream: the held-out instrument before the window, rest-padded
    # up to it. Its own notes *after* the window become controls, exactly as
    # upstream turns a prompt's future into controls.
    prompt = ops.pad(ops.clip(inputs, 0, start, clip_duration=False, seconds=False), start) if inputs else ops.pad([], start)
    future = ops.clip(inputs, start + 1, ops.max_time(inputs, seconds=False), clip_duration=False, seconds=False) if inputs else []
    # The controls: every other instrument, over the whole prepared span.
    control_tokens = [CONTROL_OFFSET + token for token in (controls or [])] + [CONTROL_OFFSET + token for token in future]
    z = [ANTICIPATE] if len(control_tokens) > 0 else [AUTOREGRESS]
    tokens, controls = ops.anticipate(prompt, ops.sort(control_tokens))
    current_time = ops.max_time(prompt, seconds=False)

    stats = {
        "mode": "anticipate" if z[0] == ANTICIPATE else "autoregress",
        "promptEvents": len(ops.unpad(prompt)) // 3,
        "promptEventsNote": "the held-out instrument's own notes before the window; rests padding it are not counted",
        "controlEvents": len(control_tokens) // 3,
        "controlEventsFromOtherInstruments": len(controls or []) // 3,
        "controlEventsFromTargetAfterWindow": len(future) // 3,
        "promptTokens": len(prompt),
        "historyTruncatedToMarkovWindow": len(prompt) > 1017,
        "forwardPasses": 0,
        "maxContext": 0,
        "generatedEvents": 0,
        "restEvents": 0,
        "duplicatesBlocked": 0,
        "allowRest": allow_rest,
        "forbidDuplicate": forbid_duplicate,
        "maskInstrument": mask_instrument,
        "truncatedByEventCap": False,
    }
    base_mask = _instrument_mask(model.config.vocab_size, instr, model.device, allow_rest, mask_instrument)
    # Keyed by the raw note token, so the duplicate ban means the same thing
    # masked (one instrument) and unmasked (any instrument).
    notes_at: dict[int, set[int]] = {}

    def note_mask_for(onset: int):
        """The base mask, minus the exact notes already written at this onset.
        `REST` (when allowed) is never banned, so the row can never be all
        -inf and softmax can never see a NaN."""
        seen = notes_at.get(onset)
        if not forbid_duplicate or not seen:
            return base_mask
        mask = base_mask.clone()
        for token in seen:
            mask[token] = -float("inf")
        if bool(torch.isinf(mask).all()):
            return base_mask  # nothing left to sample: let it repeat rather than crash
        stats["duplicatesBlocked"] += len(seen)
        return mask

    if controls:
        atime, adur, anote = controls[0:3]
        anticipated_tokens = controls[3:]
        anticipated_time = atime - ATIME_OFFSET
    else:
        anticipated_time = math.inf

    generated: list[int] = []
    while True:
        while current_time >= anticipated_time - delta:
            tokens.extend([atime, adur, anote])
            if len(anticipated_tokens) > 0:
                atime, adur, anote = anticipated_tokens[0:3]
                anticipated_tokens = anticipated_tokens[3:]
                anticipated_time = atime - ATIME_OFFSET
            else:
                anticipated_time = math.inf

        new_token = _add_token(model, z, tokens, top_p, max(start, current_time), note_mask_for, stats)
        new_time = new_token[0] - TIME_OFFSET
        if new_time >= end:
            break
        # A rest stays in the model's context (it is part of the sequence it is
        # continuing) but is not a note and is not returned.
        is_rest = new_token[2] == REST
        tokens.extend(new_token)
        if is_rest:
            stats["restEvents"] += 1
        else:
            generated.extend(new_token)
            stats["generatedEvents"] += 1
            notes_at.setdefault(new_time, set()).add(new_token[2])
        assert new_time - current_time >= 0
        current_time = new_time
        if stats["generatedEvents"] + stats["restEvents"] >= max_events:
            stats["truncatedByEventCap"] = True
            break

    return generated, stats


# ---------------------------------------------------------------------------
# The task
# ---------------------------------------------------------------------------

def infill(
    midi_path: str,
    target_inst: int | None = None,
    start_measure: int | None = None,
    n_measures: int = 8,
    seed: int = 7,
    top_p: float = 0.98,
    max_events: int = 400,
    allow_rest: bool = True,
    forbid_duplicate: bool = True,
    mask_instrument: bool = True,
    model=None,
) -> dict[str, Any]:
    """
    Real musical input -> real inference -> real symbolic output.

    The target is named by GM program (0–127; 128 = drums), the window by bar
    numbers under the file's first tempo and first time signature — the same
    addressing the tournament task and the CA2 worker use. Notes come back in
    quarter-note time and in seconds, with the bar index of each.
    """
    import torch
    from anticipation import ops
    from anticipation.config import MAX_TIME, TIME_RESOLUTION
    from anticipation.convert import midi_to_events
    from anticipation.vocab import DUR_OFFSET, NOTE_OFFSET, TIME_OFFSET

    torch.manual_seed(seed)
    out: dict[str, Any] = {"provider": PROVIDER, "seed": seed, "model": MODEL_ID, "revision": MODEL_REVISION}

    tb = read_timebase(midi_path)
    out["input"] = {k: tb[k] for k in ("ticksPerQuarter", "bpm", "tempoEvents", "timeSignature", "distinctTimeSignatures", "barSeconds", "lengthSeconds")}
    if tb["distinctTimeSignatures"] > 1:
        return {**out, "failure": "the file changes metre; bar numbers would not mean the same thing to every provider"}

    normalized = normalize_tempo(midi_path, tb["tempoUs"])
    events = midi_to_events(normalized)
    if not events:
        return {**out, "failure": "no note events after conversion"}

    by_instr: dict[int, int] = {}
    for _, _, note in _triplets(events):
        instr = _instr_of(note)
        by_instr[instr] = by_instr.get(instr, 0) + 1
    out["input"]["instruments"] = [{"inst": k, "events": v} for k, v in sorted(by_instr.items())]
    if len(by_instr) < 2:
        return {**out, "failure": "fewer than 2 instruments: no context to write against"}

    if target_inst is None:
        pitched = {k: v for k, v in by_instr.items() if k != DRUMS} or by_instr
        target_inst = max(pitched, key=pitched.get)
    if target_inst not in by_instr:
        return {**out, "failure": f"no notes carry GM program {target_inst}; present: {sorted(by_instr)}"}

    bar_ticks = tb["barSeconds"] * TIME_RESOLUTION
    total_bars = int(tb["lengthSeconds"] / tb["barSeconds"]) + 1

    def target_count(st: int) -> int:
        ws, we = st * bar_ticks, (st + n_measures) * bar_ticks
        return sum(1 for t, _, n in _triplets(events) if _instr_of(n) == target_inst and ws <= (t - TIME_OFFSET) < we)

    if start_measure is None:
        start_measure = max(range(0, max(1, total_bars - n_measures + 1)), key=target_count)
    ws_ticks = start_measure * bar_ticks
    we_ticks = (start_measure + n_measures) * bar_ticks

    # Three streams, split by instrument first and by the window second:
    #   held_out  the target inside the window — removed, and what we score against
    #   own_line  the target outside the window — the event stream the model continues
    #   others    every other instrument, everywhere — the anticipated controls
    held_out: list[int] = []
    own_line: list[int] = []
    others: list[int] = []
    context_in_window = 0
    for t, d, n in _triplets(events):
        tt = t - TIME_OFFSET
        if _instr_of(n) == target_inst:
            if ws_ticks <= tt < we_ticks:
                held_out.extend([t, d, n])
            else:
                own_line.extend([t, d, n])
        else:
            others.extend([t, d, n])
            if ws_ticks <= tt < we_ticks:
                context_in_window += 1
    out["task"] = {
        "kind": "infill: given every other instrument, write the held-out instrument over the window",
        "targetInst": target_inst,
        "measureSlice": [start_measure, start_measure + n_measures],
        "windowSeconds": [round(ws_ticks / TIME_RESOLUTION, 3), round(we_ticks / TIME_RESOLUTION, 3)],
        "heldOutHumanNotes": len(held_out) // 3,
        "contextNotesInWindow": context_in_window,
    }
    if context_in_window == 0:
        return {**out, "failure": "no other instrument plays in the window; there is nothing to arrange against"}

    # Translate so the window sits under the vocabulary's 100 s clock.
    shift = int(max(0, ws_ticks - HISTORY_SECONDS * TIME_RESOLUTION))
    span_end = we_ticks + LOOKAHEAD_SECONDS * TIME_RESOLUTION

    def prepare(tokens: list[int]) -> list[int]:
        return ops.translate(ops.clip(tokens, shift, span_end, clip_duration=False, seconds=False), -shift)

    own_translated = prepare(own_line)
    others_translated = prepare(others)
    start_local = (ws_ticks - shift) / TIME_RESOLUTION
    end_local = (we_ticks - shift) / TIME_RESOLUTION
    if end_local * TIME_RESOLUTION + LOOKAHEAD_SECONDS * TIME_RESOLUTION >= MAX_TIME:
        return {**out, "failure": f"window of {round(end_local - start_local, 1)} s plus context exceeds the model's {MAX_TIME // TIME_RESOLUTION} s clock"}
    out["request"] = {
        "shiftSeconds": round(shift / TIME_RESOLUTION, 3),
        "localWindowSeconds": [round(start_local, 3), round(end_local, 3)],
        "targetOwnLineGiven": len(own_translated) // 3,
        "otherInstrumentEventsGiven": len(others_translated) // 3,
        "historySeconds": HISTORY_SECONDS,
        "lookaheadSeconds": LOOKAHEAD_SECONDS,
    }

    M = model if model is not None else _load()
    t0 = time.time()
    generated, stats = generate_instrument(
        M, start_local, end_local, own_translated, target_inst, controls=others_translated,
        top_p=top_p, max_events=max_events, allow_rest=allow_rest,
        forbid_duplicate=forbid_duplicate, mask_instrument=mask_instrument,
    )
    seconds = round(time.time() - t0, 2)
    parameters = sum(p.numel() for p in M.parameters()) if hasattr(M, "parameters") else None
    out["inference"] = {"seconds": seconds, **stats, "device": str(getattr(M, "device", "cpu")), "topP": top_p, "parameters": parameters}

    notes = []
    off_target = 0
    for t, d, n in _triplets(generated):
        instr = _instr_of(n)
        if instr != target_inst:
            off_target += 1
            continue
        t_abs = (t - TIME_OFFSET + shift) / TIME_RESOLUTION
        dur = max(1, d - DUR_OFFSET) / TIME_RESOLUTION
        pitch = (n - NOTE_OFFSET) - instr * 128
        start_qn = t_abs * tb["bpm"] / 60.0
        notes.append({
            "measure": int(t_abs // tb["barSeconds"]),
            "pitch": pitch,
            "startSec": round(t_abs, 4),
            "endSec": round(t_abs + dur, 4),
            "startQn": round(start_qn, 4),
            "endQn": round(start_qn + dur * tb["bpm"] / 60.0, 4),
            "velocity": DEFAULT_VELOCITY,
            "isDrum": instr == DRUMS,
        })
    notes.sort(key=lambda x: (x["startSec"], x["pitch"]))
    out["output"] = {
        "generatedNotes": len(notes),
        "offTargetEventsDropped": off_target,
        "measuresWithNotes": len({x["measure"] for x in notes}),
        "pitchRange": [min(x["pitch"] for x in notes), max(x["pitch"] for x in notes)] if notes else None,
        "notes": notes,
    }
    out["account"] = {
        "received": RECEIVED,
        "approximated": APPROXIMATED,
        "unsupported": UNSUPPORTED,
        "enforcedHere": [
            "instrument mask on the note slot: only the held-out GM program can be sampled"
            if mask_instrument else
            "no instrument mask: sampled unmasked (upstream's accompaniment framing) and filtered to the held-out GM program afterwards",
            f"REST {'kept available' if allow_rest else 'banned'} — the model's only way of saying 'not here'",
            f"repeat of a pitch already written at the same onset {'banned' if forbid_duplicate else 'allowed'}",
            f"event cap {max_events} (notes + rests)",
        ],
        "note": "No musical constraint is applied inside the worker; the platform's contextAwareComposer passes do that so every provider is judged after the same enforcement.",
    }
    out["definitionOfDone"] = {
        "realMusicalInput": True,
        "realModelInference": stats["forwardPasses"] > 0,
        "realSymbolicOutput": len(notes) > 0,
        "verdict": "PASS" if notes else "FAIL: model produced no notes for the held-out instrument",
    }
    return out


def write_notes_midi(result: dict[str, Any], path: str) -> None:
    """The generated part alone, at the file's tempo, for the evidence folder."""
    import mido

    bpm = result["input"]["bpm"]
    tpq = 480
    mid = mido.MidiFile(ticks_per_beat=tpq)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=int(round(60e6 / bpm)), time=0))
    inst = result["task"]["targetInst"]
    channel = 9 if inst == DRUMS else 0
    track.append(mido.Message("program_change", channel=channel, program=0 if inst == DRUMS else inst, time=0))
    evs = []
    for n in result["output"]["notes"]:
        evs.append((int(round(n["startQn"] * tpq)), 1, n["pitch"]))
        evs.append((int(round(n["endQn"] * tpq)), 0, n["pitch"]))
    evs.sort()
    prev = 0
    for tick, on, pitch in evs:
        track.append(mido.Message("note_on" if on else "note_off", note=pitch, channel=channel, velocity=DEFAULT_VELOCITY if on else 0, time=tick - prev))
        prev = tick
    mid.save(path)
