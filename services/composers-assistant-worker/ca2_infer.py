"""
Composer's Assistant 2 inference core (Wave Q — Model Discovery).

One implementation shared by the HTTP worker, the build-time smoke and the
local script, so the w/d/N/D decode rule exists exactly once. No REAPER module
is imported anywhere in this path.

Pinned identity — a container that cannot verify these is not this model:
  release zip  composers.assistant.v.2.1.0.zip  sha256 2a17d0b1…
  large model  finetuned_epoch_49_0/model/pytorch_model.bin  sha256 297bccb1…
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

RELEASE_TAG = "v2.1.0"
RELEASE_ZIP_URL = (
    "https://github.com/m-malandro/composers-assistant-REAPER/releases/download/v2.1.0/"
    "composers.assistant.v.2.1.0.zip"
)
RELEASE_ZIP_SHA256 = "2a17d0b12f17a5fc85f8d54c441e9a2d68b53e828115083942709aa676fac0b0"
LARGE_MODEL_BIN_SHA256 = "297bccb173b4497a3c3b6007422506dced88fd9f99f5c8a18481dedd9667d530"
LARGE_MODEL_CONFIG_SHA256 = None  # filled from the build-time verify; see model_manifest.json
EXPECTED_VOCAB_SIZE = 1944
EXPECTED_TRANSFORMERS = "4.31.0"

VENDOR_DIR = Path(os.environ.get("CA2_VENDOR_DIR", "/app/vendor/composers_assistant_v2"))
MODEL_DIR = Path(
    os.environ.get(
        "CA2_MODEL_DIR",
        str(VENDOR_DIR / "models_permuted_labels" / "unjoined" / "infill" / "finetuned_epoch_49_0" / "model"),
    )
)


def sha256_file(path: Path, block: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            b = f.read(block)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def _import_vendor():
    """Import the release's own Python from the pinned tree, exactly once."""
    if str(VENDOR_DIR) not in sys.path:
        sys.path.insert(0, str(VENDOR_DIR))
    # constants.py resolves model paths relative to the CWD.
    os.chdir(VENDOR_DIR)
    import midisong as ms  # noqa: E402
    import constants as cs  # noqa: E402
    import encoding_functions as enc  # noqa: E402
    import preprocessing_functions as pre  # noqa: E402
    import unjoined_vocab_tokenizer as ujt  # noqa: E402
    import nn_str_functions as nns  # noqa: E402
    return ms, cs, enc, pre, ujt, nns


def identity() -> dict[str, Any]:
    """What `/health` reports. Verified, not assumed."""
    import torch
    import transformers

    bin_path = MODEL_DIR / "pytorch_model.bin"
    cfg_path = MODEL_DIR / "config.json"
    bin_ok = bin_path.is_file() and sha256_file(bin_path) == LARGE_MODEL_BIN_SHA256
    cfg = json.loads(cfg_path.read_text()) if cfg_path.is_file() else {}
    ms, cs, enc, pre, ujt, nns = _import_vendor()
    tok = ujt.UnjoinedTokenizer("unjoined_include_note_duration_commands")
    vocab_ok = tok.vocab_size() == EXPECTED_VOCAB_SIZE == cfg.get("vocab_size")
    return {
        "provider": "COMPOSERS_ASSISTANT_2",
        "release": RELEASE_TAG,
        "releaseZipSha256": RELEASE_ZIP_SHA256,
        "modelBinSha256Expected": LARGE_MODEL_BIN_SHA256,
        "modelBinVerified": bin_ok,
        "config": {k: cfg.get(k) for k in ("architectures", "num_layers", "num_decoder_layers", "d_model", "d_ff", "num_heads", "vocab_size", "torch_dtype", "transformers_version")},
        "vocabSize": tok.vocab_size(),
        "vocabVerified": vocab_ok,
        "runtime": {
            "python": sys.version.split()[0],
            "torch": torch.__version__,
            "transformers": transformers.__version__,
            "cuda": torch.cuda.is_available(),
        },
        "runtimePinned": transformers.__version__ == EXPECTED_TRANSFORMERS,
        "licence": {
            "code": "MIT (repository LICENSE)",
            "weights": "MIT (in-release license.txt; no rights claimed on outputs per disclaimer.txt)",
            "trainingData": "PD/CC0/CC-BY/permitted MIDI per disclaimer.txt; Mutopia-dominated per acknowledgments.html",
            "classification": "SHIP_CLEARED (public evidence; not lawyer-reviewed)",
        },
        "healthy": bool(bin_ok and vocab_ok and transformers.__version__ == EXPECTED_TRANSFORMERS),
    }


_MODEL = None
_TOK = None


def _load():
    global _MODEL, _TOK
    if _MODEL is None:
        import torch
        import transformers

        bin_path = MODEL_DIR / "pytorch_model.bin"
        actual = sha256_file(bin_path)
        if actual != LARGE_MODEL_BIN_SHA256:
            raise RuntimeError(f"checksum mismatch: {actual} != {LARGE_MODEL_BIN_SHA256}; refusing to load")
        ms, cs, enc, pre, ujt, nns = _import_vendor()
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _MODEL = transformers.T5ForConditionalGeneration.from_pretrained(str(MODEL_DIR)).to(device).eval()
        _TOK = ujt.UnjoinedTokenizer("unjoined_include_note_duration_commands")
    return _MODEL, _TOK


# ---------------------------------------------------------------------------
# Instructions (PR-74): CA2's own control channel, sent exactly as trained
# ---------------------------------------------------------------------------

# The order the fine-tuning data builder appended at-end instructions in
# (nn_training_functions._build_finetune_train_data_infill) and the order the
# REAPER client sends them in (rpr_ca_functions.get_user_commands_for_nn_input_str).
# The model saw them in this order; a caller's order is normalised to it.
AT_END_ORDER = (
    "vert_note_onset_density",
    "vert_note_onset_n_pitch_classes_on_avg",
    "horiz_note_onset_density",
    "horiz_note_onset_density_diversity_percentage",
    "horiz_note_onset_irregularity",
    "pitch_step_prob",
    "pitch_leap_prob",
    "lowest_note_strict",
    "highest_note_strict",
    "lowest_note_loose",
    "highest_note_loose",
)
# Per masked cell: the octave-independence marker, then note bounds.
PER_CELL_ORDER = (
    "is_not_octave_same",
    "lowest_note_strict",
    "highest_note_strict",
    "lowest_note_loose",
    "highest_note_loose",
)
NOTE_BOUND_NAMES = frozenset(("lowest_note_strict", "highest_note_strict", "lowest_note_loose", "highest_note_loose"))
# id 0 is the at-end separator the encoder inserts itself; 40–44 are the
# rhythmic-conditioning encodings, which need placeholders built from a kept
# rhythm the encoder computes from labels — not an instruction a caller sends.
ENCODER_OWNED_IDS = frozenset((0, 40, 41, 42, 43, 44))
INSTRUCTION_ID_RANGE = 512
TRAINED_INSTRUCTION_IDS = 49
LOUDNESS_LEVELS = 8
DEFAULT_LOUDNESS_LEVEL = 5


def _parse_instruction_item(item: Any) -> tuple[int | None, int | None, str | None]:
    """(id, note, error). Accepts an int id, `{"id", "note"?}`, or the encoded token string."""
    import re

    if isinstance(item, bool):
        return None, None, "boolean is not an instruction"
    if isinstance(item, int):
        return item, None, None
    if isinstance(item, dict):
        raw = item.get("id")
        if not isinstance(raw, int) or isinstance(raw, bool):
            return None, None, "object needs an integer `id`"
        note = item.get("note")
        if note is not None and (not isinstance(note, int) or isinstance(note, bool)):
            return None, None, "`note` must be an integer when given"
        return raw, note, None
    if isinstance(item, str):
        m = re.fullmatch(r";?<instruction_(\d+)>(?:;[ND]:(\d+))?", item.strip())
        if not m:
            return None, None, "string is not an encoded instruction token"
        return int(m.group(1)), int(m.group(2)) if m.group(2) else None, None
    return None, None, f"unsupported item type {type(item).__name__}"


def plan_instructions(spec: dict[str, Any] | None, n_measures: int, is_drum: bool, enc) -> dict[str, Any]:
    """
    Validate a caller's instructions and render them with CA2's own
    `instruction_str`, so what reaches the encoder is exactly what the release
    renders for its REAPER client — same ids, same `;N:`/`;D:` bound syntax,
    same order as the fine-tuning data. Nothing is invented: an id the model
    never saw (49–511), an encoder-owned id, a duplicate kind, a bound without
    a pitch, or a loudness list of the wrong length is refused and *listed*,
    never silently dropped.

    `spec` = {"atEnd": [...], "perCell": [...], "loudness": int | [int]}; each
    item an int id, {"id", "note"?}, or the encoded token string.
    """
    applied: list[dict[str, Any]] = []
    refused: list[dict[str, Any]] = []
    rendered: dict[str, dict[str, str]] = {"atEnd": {}, "perCell": {}}
    if spec is None:
        spec = {}
    if not isinstance(spec, dict):
        return {"commandsAtEnd": "", "trackMeasureCommands": "", "loudnessLevels": [DEFAULT_LOUDNESS_LEVEL] * n_measures,
                "applied": [], "refused": [{"item": spec, "why": "instructions must be a JSON object"}], "loudnessSource": "default level 5"}
    id_to_measurement = enc._INSTRUCTION_TO_MEASUREMENT_DICT

    for placement, order in (("atEnd", AT_END_ORDER), ("perCell", PER_CELL_ORDER)):
        items = spec.get(placement) or []
        if not isinstance(items, list):
            refused.append({"item": items, "why": f"`{placement}` must be a list"})
            continue
        for item in items:
            iid, note, err = _parse_instruction_item(item)
            if err:
                refused.append({"item": item, "why": err})
                continue
            if not (0 <= iid < INSTRUCTION_ID_RANGE):
                refused.append({"item": item, "why": f"id {iid} outside the 512-id instruction range"})
                continue
            if iid in ENCODER_OWNED_IDS:
                refused.append({"item": item, "why": f"id {iid} is owned by the encoder (separator / rhythmic conditioning), not a caller instruction"})
                continue
            if iid >= TRAINED_INSTRUCTION_IDS:
                refused.append({"item": item, "why": f"id {iid} is a spare id the released fine-tune never saw; sending it would be noise"})
                continue
            name, value = id_to_measurement[iid]
            if name not in order:
                refused.append({"item": item, "why": f"{name} is {'an at-end' if placement == 'perCell' else 'a per-cell'} instruction in training; not accepted under `{placement}`"})
                continue
            if name in rendered[placement]:
                refused.append({"item": item, "why": f"a second {name} under `{placement}`; one per kind"})
                continue
            if name in NOTE_BOUND_NAMES:
                if note is None or not (0 <= note <= 127):
                    refused.append({"item": item, "why": f"{name} needs a `note` 0..127"})
                    continue
                token = enc.instruction_str(note, name, is_drum=is_drum)
                applied.append({"id": iid, "name": name, "note": note, "placement": placement, "token": token})
            else:
                token = enc.instruction_str(value, name)
                applied.append({"id": iid, "name": name, "bin": value, "placement": placement, "token": token})
            rendered[placement][name] = token

    at_end = "".join(rendered["atEnd"][n] for n in AT_END_ORDER if n in rendered["atEnd"])
    per_cell = "".join(rendered["perCell"][n] for n in PER_CELL_ORDER if n in rendered["perCell"])

    levels = [DEFAULT_LOUDNESS_LEVEL] * n_measures
    source = "default level 5 (no loudness given)"
    loud = spec.get("loudness")
    if loud is not None:
        if isinstance(loud, int) and not isinstance(loud, bool):
            loud = [loud] * n_measures
        if not isinstance(loud, list) or len(loud) != n_measures:
            refused.append({"item": spec.get("loudness"), "why": f"loudness must be an int or a list of {n_measures} ints (one per masked measure)"})
        elif any(isinstance(v, bool) or not isinstance(v, int) or not (0 <= v < LOUDNESS_LEVELS) for v in loud):
            refused.append({"item": spec.get("loudness"), "why": "each loudness level must be an int 0..7 (;M: level)"})
        else:
            levels = list(loud)
            source = "caller ;M: levels → DYNAMICS_DEFAULTS velocities"
    return {
        "commandsAtEnd": at_end,
        "trackMeasureCommands": per_cell,
        "loudnessLevels": levels,
        "loudnessSource": source,
        "applied": applied,
        "refused": refused,
        "order": "at-end and per-cell tokens re-ordered to the fine-tuning builder's order (nn_training_functions / rpr_ca_functions)",
    }


def encode_request(S, enc, *, target_track: int, start_measure: int, end: int, plan: dict[str, Any] | None) -> str:
    """
    The encoder call, in one place. With `plan=None` this is exactly the
    pre-PR-74 request: empty commands, every masked measure at loudness level
    5. With a plan, the per-cell tokens go after every masked cell's head and
    the at-end tokens into the masked track's at-end block — the two places
    `encode_midisongbymeasure_with_masks` was trained to read them.
    """
    measures = range(start_measure, end)
    masks = [(target_track, m) for m in measures]
    levels = plan["loudnessLevels"] if plan else [DEFAULT_LOUDNESS_LEVEL] * len(masks)
    velocity_overrides = {m: enc.DYNAMICS_DEFAULTS[levels[i]] for i, m in enumerate(measures)}
    track_measure_commands = collections.defaultdict(str)
    commands_at_end = collections.defaultdict(str)
    if plan:
        for m in measures:
            track_measure_commands[(target_track, m)] = plan["trackMeasureCommands"]
        commands_at_end[target_track] = plan["commandsAtEnd"]
    input_str, _labels = enc.encode_midisongbymeasure_with_masks(
        S, mask_locations=masks, measure_slice=(start_measure, end),
        include_heads_for_empty_masked_measures=True,
        track_measure_commands=track_measure_commands,
        explicit_rhythmic_conditioning_locations=None, rhythmic_conditioning_type=None,
        return_labels_too=True, extra_id_st=0, extra_id_max=255,
        velocity_overrides=velocity_overrides, commands_at_end=commands_at_end,
    )
    return input_str


def _vel(qn_in_measure: float, low: int = 105, high: int = 115) -> int:
    """CA2's metrical-accent default velocities (rpr_ca_functions.get_vel), 4/4 pattern."""
    vels = {0: low, 1: round(2 * low / 3 + high / 3), 2: round(low / 3 + 2 * high / 3), 3: high}
    q = round(qn_in_measure, 4)
    if abs(q - 0) < 1e-3 or abs(q - 4) < 1e-3:
        return vels[3]
    if abs(q - 2) < 1e-3 or abs(q - 6) < 1e-3:
        return vels[2]
    if q in (1, 3, 5, 7):
        return vels[1]
    return vels[0]


def infill(
    midi_path: str,
    target_track: int | None = None,
    target_inst: int | None = None,
    start_measure: int | None = None,
    n_measures: int = 8,
    seed: int = 7,
    max_new_tokens: int = 1200,
    temperature: float = 1.0,
    top_p: float = 0.85,
    instructions: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Real musical input -> real inference -> real symbolic output.

    `instructions` (optional, PR-74) — CA2's own control channel: at-end
    instruction ids for the masked track, per-cell ids, and per-measure
    loudness levels; see `plan_instructions`. When absent the encoder input is
    byte-identical to the pre-PR-74 worker (empty commands, loudness level 5).

    The target may be named by post-clean track index (`target_track`) or, for
    a tournament that must address the same part across providers that parse
    MIDI differently, by GM program (`target_inst`, 0–127; 128 = drums). CA2
    removes near-equal tracks and re-sorts by instrument and average pitch, so
    an index from another parser means nothing here; a program does.

    Returns notes in quarter-note time plus the account of what the model was
    given, what it was not, and what happened, so a caller can never mistake
    this for more than it is.
    """
    import torch

    ms, cs, enc, pre, ujt, nns = _import_vendor()
    torch.manual_seed(seed)
    out: dict[str, Any] = {"provider": "COMPOSERS_ASSISTANT_2", "seed": seed}

    S = pre.load_and_clean_midisongbymeasure_from_midi_path(midi_path)
    if S is None:
        return {**out, "failure": "CA2 loader returned None for this MIDI"}
    n_measures_total = len(S.get_measure_endpoints()) - 1
    tracks = []
    for ti, tr in enumerate(S.tracks):
        tracks.append({
            "index": ti, "inst": int(tr.inst), "isDrum": bool(getattr(tr, "is_drum", False)),
            "noteOns": sum(len(m.note_ons) for m in tr.tracks_by_measure),
        })
    out["input"] = {"tracksAfterClean": len(tracks), "measures": n_measures_total, "tracks": tracks, "cpq": S.cpq}
    if len(tracks) < 2:
        return {**out, "failure": "fewer than 2 tracks after cleaning: no context to infill against"}

    if target_track is None and target_inst is not None:
        # Resolve by program after CA2's own cleaning; several tracks may share
        # a program (four string-ensemble tracks in a real score), so take the
        # one with the most notes — the part, not a doubling.
        matches = [t for t in tracks if (t["isDrum"] and target_inst == 128) or (not t["isDrum"] and t["inst"] == target_inst)]
        if not matches:
            return {**out, "failure": f"no track with GM program {target_inst} survived CA2 cleaning; present: {sorted({t['inst'] for t in tracks})}"}
        target_track = max(matches, key=lambda t: t["noteOns"])["index"]
        out["targetResolvedBy"] = {"target_inst": target_inst, "candidates": [t["index"] for t in matches]}
    if target_track is None:
        pitched = [t for t in tracks if not t["isDrum"]] or tracks
        target_track = max(pitched, key=lambda t: t["noteOns"])["index"]
    if target_track < 0 or target_track >= len(tracks):
        return {**out, "failure": f"target_track {target_track} out of range 0..{len(tracks) - 1}"}
    if start_measure is None:
        best, best_c = 0, -1
        for st in range(0, max(1, n_measures_total - n_measures + 1)):
            c = sum(len(S.tracks[target_track].tracks_by_measure[m].note_ons)
                    for m in range(st, min(n_measures_total, st + n_measures)))
            if c > best_c:
                best, best_c = st, c
        start_measure = best
    end = min(n_measures_total, start_measure + n_measures)
    masks = [(target_track, m) for m in range(start_measure, end)]
    held_out = sum(len(S.tracks[target_track].tracks_by_measure[m].note_ons) for m in range(start_measure, end))
    out["task"] = {
        "kind": "infill: given every other track, write the target track over the window",
        "targetTrack": target_track, "targetInst": int(S.tracks[target_track].inst),
        "measureSlice": [start_measure, end], "maskLocations": len(masks), "heldOutHumanNotes": held_out,
    }

    is_drum = bool(getattr(S.tracks[target_track], "is_drum", False))
    plan = plan_instructions(instructions, n_measures=end - start_measure, is_drum=is_drum, enc=enc) if instructions is not None else None
    input_str = encode_request(S, enc, target_track=target_track, start_measure=start_measure, end=end, plan=plan)
    M, tok = _load()
    ids = tok.Encode(input_str)
    out["request"] = {
        "inputTokens": len(ids), "maxLen": cs.MAX_LEN, "vocabSize": tok.vocab_size(), "inputHead": input_str[:200],
        "inputTail": input_str[-200:], "inputSha256": hashlib.sha256(input_str.encode()).hexdigest(),
        "instructionsSent": bool(plan and (plan["commandsAtEnd"] or plan["trackMeasureCommands"] or plan["loudnessSource"].startswith("caller"))),
    }
    if len(ids) > cs.MAX_LEN:
        out["warning"] = f"input {len(ids)} tokens exceeds MAX_LEN {cs.MAX_LEN}"

    device = next(M.parameters()).device
    t0 = time.time()
    with torch.no_grad():
        gen = M.generate(
            input_ids=torch.tensor([ids], dtype=torch.long, device=device),
            num_return_sequences=1, do_sample=True, temperature=temperature, top_p=top_p,
            min_length=10, max_new_tokens=max_new_tokens,
            decoder_start_token_id=tok.pad_id(), pad_token_id=tok.pad_id(),
            bos_token_id=tok.bos_id(), eos_token_id=tok.eos_id(), use_cache=True,
        )
    out_ids = [int(x) for x in gen[0][1:]]
    out_str = tok.Decode(out_ids)
    out["inference"] = {"seconds": round(time.time() - t0, 2), "outputTokens": len(out_ids), "device": str(device), "outputHead": out_str[:200]}

    # --- decode: the w/d/N/D rule from rpr_ca_functions, without REAPER ---
    CPQ = ms.extended_lcm(cs.QUANTIZE)
    by_extra = nns.instructions_by_extra_id(out_str)
    MEs = S.get_measure_endpoints()
    notes = []
    for i, m in enumerate(range(start_measure, end)):
        m_start_qn, m_end_qn = MEs[m] / S.cpq, MEs[m + 1] / S.cpq
        cur_qn, cur_dur = 0.0, 0.5
        seen: dict[float, set[int]] = collections.defaultdict(set)
        for ins in by_extra.get(f"<extra_id_{i}>", []):
            if not ins or ins[0] not in "wdND":
                continue
            k, v = ins.split(":")[0], int(ins.split(":")[1])
            if k == "d":
                cur_dur = v / CPQ
            elif k == "w":
                cur_qn += v / CPQ
            else:
                st = m_start_qn + cur_qn
                if st < m_end_qn:
                    en = st + cur_dur
                    if k == "D":
                        en = min(en, m_end_qn)
                    key = round(st, 4)
                    if v not in seen[key]:
                        notes.append({"measure": m, "pitch": v, "startQn": key, "endQn": round(en, 4),
                                      "velocity": _vel(cur_qn), "isDrum": k == "D"})
                        seen[key].add(v)
    out["output"] = {
        "generatedNotes": len(notes),
        "measuresWithNotes": len({n["measure"] for n in notes}),
        "pitchRange": [min(n["pitch"] for n in notes), max(n["pitch"] for n in notes)] if notes else None,
        "notes": notes,
    }
    received = ["siblingParts.notes (unmasked tracks)", "instrument (;I:)", "candidateStrategy.seed"]
    if plan and plan["applied"]:
        received.append("instructions (" + ", ".join(sorted({a["name"] for a in plan["applied"]})) + ")")
    if plan and plan["loudnessSource"].startswith("caller"):
        received.append("loudness (;M: per masked measure)")
    out["account"] = {
        "received": received,
        "instructions": plan if plan is not None else {
            "commandsAtEnd": "", "trackMeasureCommands": "", "loudnessLevels": [DEFAULT_LOUDNESS_LEVEL] * (end - start_measure),
            "loudnessSource": "default level 5 (no `instructions` field)", "applied": [], "refused": [],
        },
        "approximated": ["section → bare measure window", "hardConstraints.polyphony → none sent (enforce after)", "lockedMaterial → whole-cell masks"],
        "unsupported": ["styleGrammar", "harmonyPlan", "vocalAttentionMap", "motifMemory", "previousSectionSummary", "nextSectionIntent", "role", "phrases", "productionBriefRef"],
        "enforcedHere": [],
        "note": "No post-generation constraint is applied inside the worker; the platform's contextAwareComposer passes do that so every provider is judged after the same enforcement.",
    }
    out["definitionOfDone"] = {
        "realMusicalInput": True, "realModelInference": True, "realSymbolicOutput": len(notes) > 0,
        "verdict": "PASS" if notes else "FAIL: model produced no notes",
    }
    return out
