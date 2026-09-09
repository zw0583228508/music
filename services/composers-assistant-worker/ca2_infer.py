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
    start_measure: int | None = None,
    n_measures: int = 8,
    seed: int = 7,
    max_new_tokens: int = 1200,
    temperature: float = 1.0,
    top_p: float = 0.85,
) -> dict[str, Any]:
    """
    Real musical input -> real inference -> real symbolic output.

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

    if target_track is None:
        pitched = [t for t in tracks if not t["isDrum"]] or tracks
        target_track = max(pitched, key=lambda t: t["noteOns"])["index"]
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

    velocity_overrides = {m: enc.DYNAMICS_DEFAULTS[5] for m in range(start_measure, end)}
    input_str, _labels = enc.encode_midisongbymeasure_with_masks(
        S, mask_locations=masks, measure_slice=(start_measure, end),
        include_heads_for_empty_masked_measures=True,
        track_measure_commands=collections.defaultdict(str),
        explicit_rhythmic_conditioning_locations=None, rhythmic_conditioning_type=None,
        return_labels_too=True, extra_id_st=0, extra_id_max=255,
        velocity_overrides=velocity_overrides, commands_at_end=collections.defaultdict(str),
    )
    M, tok = _load()
    ids = tok.Encode(input_str)
    out["request"] = {"inputTokens": len(ids), "maxLen": cs.MAX_LEN, "vocabSize": tok.vocab_size(), "inputHead": input_str[:200]}
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
    out["account"] = {
        "received": ["siblingParts.notes (unmasked tracks)", "instrument (;I:)", "candidateStrategy.seed"],
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
