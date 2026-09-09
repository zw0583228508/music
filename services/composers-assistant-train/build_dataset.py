"""
Build a CA2-format infill dataset from admitted PDMX works
(Wave Q — Model Discovery, PR-63).

    CA2_VENDOR_DIR=<extracted Scripts/composers_assistant_v2> python build_dataset.py \
        --pdmx-dir <repo>/.pdmx-data --rights-basis <repo>/.training-data/rights-basis.json \
        --out <repo>/.training-data/<name> [--max-examples 256] [--window 8] [--seed 7]

Every example is built by CA2's own code — `preprocessing_functions.
load_and_clean_midisongbymeasure_from_midi_path` for the song, `encoding_functions.
encode_midisongbymeasure_with_masks` (or `nn_training_functions.val_test_infill_encode`)
for the strings, `UnjoinedTokenizer` for the ids — so the LoRA sees exactly what
the pretrained model saw. The task shape is the tournament's: one target track,
N consecutive measures masked, every other track as context.

Refusals, in order: work not in the rights basis → never loaded; byte-identical
file → skipped; CA2 near-duplicate (the transposition-invariant onset chromagram
over all 12 keys) → skipped; fewer than two tracks after CA2 cleaning → skipped;
any string over MAX_LEN → the example is dropped, never truncated.
"""
from __future__ import annotations

import argparse
import collections
import contextlib
import copy
import hashlib
import io
import json
import os
import random
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import ca2_pins  # noqa: E402
import training_manifest as tm  # noqa: E402

VARIANTS = ("plain", "ranges", "full")


def midi_track_count(path: Path) -> int:
    """MThd ntrks — a 14-byte read that skips the 91 % of PDMX that is single-part."""
    with path.open("rb") as f:
        head = f.read(14)
    if len(head) < 14 or head[:4] != b"MThd":
        return 0
    return struct.unpack(">H", head[10:12])[0]


def iter_admitted_files(pdmx_dir: Path, admitted: set[str], pdmx_id):
    root = pdmx_dir / "mid"
    for folder, _dirs, files in os.walk(root):
        _dirs.sort()
        for name in sorted(files):
            if not name.endswith(".mid"):
                continue
            wid = pdmx_id(name)
            if wid and wid in admitted:
                yield wid, Path(folder) / name


def pdmx_id_from_name(name: str):
    stem = name[:-4] if name.endswith(".mid") else name
    return stem if len(stem) >= 20 and stem.isalnum() else None


def dedupe_strings(v, S) -> list[str]:
    """CA2's dedupe_and_filter_midi_files_functions: the pitched onset chromagram in all 12 keys, hashed."""
    ms = v["ms"]
    song = ms.MidiSong.from_MidiSongByMeasure(copy.copy(S), consume_calling_song=True)
    out = []
    for _ in range(12):
        out.append(hashlib.sha256(song.to_deduping_str().encode("utf-8")).hexdigest())
        song.transpose(1)
    return out


def track_measure_note_counts(S, tr_i: int, st: int, end: int) -> list[int]:
    return [len(S.tracks[tr_i].tracks_by_measure[m].note_ons) for m in range(st, end)]


def encode_variant(v, S, variant: str, target_track: int, st: int, end: int):
    enc, nnt = v["enc"], v["nnt"]
    masks = [(target_track, m) for m in range(st, end) if S.tracks[target_track].tracks_by_measure[m].note_ons]
    if variant == "plain":
        # Exactly the worker's inference call (ca2_infer.infill): heads for empty
        # masked measures, loudness overridden so the target's dynamics are not
        # leaked through ;M:, no instructions of any kind.
        velocity_overrides = {m: enc.DYNAMICS_DEFAULTS[5] for m in range(st, end)}
        return masks, enc.encode_midisongbymeasure_with_masks(
            S, mask_locations=[(target_track, m) for m in range(st, end)], measure_slice=(st, end),
            include_heads_for_empty_masked_measures=True,
            track_measure_commands=collections.defaultdict(str),
            explicit_rhythmic_conditioning_locations=None, rhythmic_conditioning_type=None,
            return_labels_too=True, extra_id_st=0, extra_id_max=255,
            velocity_overrides=velocity_overrides, commands_at_end=collections.defaultdict(str),
        )
    if variant == "ranges":
        # The worker's call plus CA2's strict lowest/highest-note instruction per
        # masked track-measure (nn_training_functions.val_test_infill_encode).
        cmds = collections.defaultdict(str)
        for T in masks:
            tr_i, m_i = T
            pr = S.pitch_range(tr_i=tr_i, measures=[m_i])
            if pr is not None:
                lo, hi = pr
                is_drum = S.tracks[tr_i].is_drum
                cmds[T] += enc.instruction_str(lo, enc.ENCODING_INSTRUCTION_LOWEST_NOTE_STRICT, is_drum=is_drum)
                cmds[T] += enc.instruction_str(hi, enc.ENCODING_INSTRUCTION_HIGHEST_NOTE_STRICT, is_drum=is_drum)
        return masks, enc.encode_midisongbymeasure_with_masks(
            S, mask_locations=masks, measure_slice=(st, end),
            include_heads_for_empty_masked_measures=False, track_measure_commands=cmds,
            explicit_rhythmic_conditioning_locations=None, rhythmic_conditioning_type=None,
            return_labels_too=True, extra_id_st=0, extra_id_max=255, commands_at_end=collections.defaultdict(str),
        )
    if variant == "full":
        # CA2's own validation/test example, verbatim: every instruction family on.
        return masks, nnt.val_test_infill_encode(
            S=S, mask_locations=masks, measure_slice=(st, end),
            include_no_octave_shift_instructions=True, include_hi_lo_note_instructions_per_track_measure=True,
            do_rhythm_conditioning=True, rhythmic_conditioning_type="n_pitch_classes_and_n_notes", return_labels_too=True,
        )
    raise ValueError(variant)


def build_examples_for_work(v, tok, S, work_id: str, rel_path: str, *, window: int, per_work: int,
                            variants: tuple[str, ...], rng: random.Random, max_tokens: int, log: dict) -> list[dict]:
    cs, enc = v["cs"], v["enc"]
    enc.transpose_into_acceptable_ranges_TT(S)
    S.sort_tracks_by_inst_and_avg_note_pitch()
    for t in S.tracks:
        t.sort()
    n_measures = S.get_n_measures()
    if len(S.tracks) < 2 or n_measures < window:
        log["skippedTooSmall"] += 1
        return []
    candidates = []
    for tr_i, tr in enumerate(S.tracks):
        for st in range(0, n_measures - window + 1):
            counts = track_measure_note_counts(S, tr_i, st, st + window)
            filled = sum(1 for c in counts if c)
            if filled < window - 1:  # CA2's '1singleinst' rule: fill at least n-1 of n measures
                continue
            others = sum(
                1 for o in range(len(S.tracks)) if o != tr_i
                for m in range(st, st + window) if S.tracks[o].tracks_by_measure[m].note_ons
            )
            if others < window:  # context must be present in the window, not silence
                continue
            candidates.append((tr_i, st, sum(counts)))
    if not candidates:
        log["skippedNoWindow"] += 1
        return []
    rng.shuffle(candidates)
    out, used = [], set()
    for tr_i, st, _ in candidates:
        if len(out) >= per_work:
            break
        if (tr_i, st // window) in used:
            continue
        variant = variants[len(out) % len(variants)] if len(variants) > 1 else variants[0]
        end = st + window
        try:
            with contextlib.redirect_stdout(io.StringIO()):
                masks, (input_str, labels_str) = encode_variant(v, S, variant, tr_i, st, end)
        except Exception as err:  # CA2 raises ValueError for e.g. extra_id overflow
            log["encodeErrors"] += 1
            log.setdefault("encodeErrorSamples", []).append(f"{work_id}: {type(err).__name__}: {err}"[:200])
            continue
        if len(masks) < 2 or not labels_str or (";N:" not in input_str and ";D:" not in input_str):
            log["skippedDegenerate"] += 1
            continue
        input_ids = tok.Encode(input_str)
        label_ids = tok.encode(labels_str)
        if len(input_ids) > cs.MAX_LEN or len(label_ids) > cs.MAX_LEN - 1:
            log["skippedOverMaxLen"] += 1
            continue
        label_ids = label_ids + [tok.eos_id()]
        if len(input_ids) > max_tokens or len(label_ids) > max_tokens:
            log["skippedOverBuilderCap"] += 1
            continue
        if tok.unk_id() in input_ids or tok.unk_id() in label_ids:
            log["skippedUnk"] += 1
            continue
        used.add((tr_i, st // window))
        tr = S.tracks[tr_i]
        out.append({
            "exampleId": hashlib.sha256(f"{work_id}|{variant}|{tr_i}|{st}|{end}".encode()).hexdigest()[:16],
            "workId": work_id,
            "split": tm.split_for_work(work_id),
            "index": -1,
            "variant": variant,
            "sourcePath": rel_path,
            "targetTrack": tr_i,
            "targetInst": 128 if tr.is_drum else int(tr.inst),
            "isDrum": bool(tr.is_drum),
            "measureSlice": [st, end],
            "nMasks": len(masks),
            "tracksAfterClean": len(S.tracks),
            "inputTokens": len(input_ids),
            "labelTokens": len(label_ids),
            "inputStr": input_str,
            "labelsStr": labels_str,
            "inputIds": input_ids,
            "labelIds": label_ids,
        })
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--pdmx-dir", required=True)
    p.add_argument("--rights-basis", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--max-examples", type=int, default=256)
    p.add_argument("--max-works", type=int, default=0, help="0 = no limit")
    p.add_argument("--scan", type=int, default=4000, help="admitted multitrack files to consider, after a seeded shuffle")
    p.add_argument("--window", type=int, default=8)
    p.add_argument("--per-work", type=int, default=2)
    p.add_argument("--variants", default="plain,ranges,full")
    p.add_argument("--max-tokens", type=int, default=ca2_pins.EXPECTED_MAX_LEN, help="builder cap on either side (<= MAX_LEN); a smoke uses a small one")
    p.add_argument("--min-midi-tracks", type=int, default=3, help="MThd ntrks pre-filter (tempo track + parts)")
    p.add_argument("--seed", type=int, default=7)
    a = p.parse_args(argv)

    t0 = time.time()
    variants = tuple(x for x in a.variants.split(",") if x)
    for x in variants:
        if x not in VARIANTS:
            raise SystemExit(f"unknown variant {x}; choose from {VARIANTS}")
    if a.max_tokens > ca2_pins.EXPECTED_MAX_LEN:
        raise SystemExit(f"--max-tokens {a.max_tokens} exceeds MAX_LEN {ca2_pins.EXPECTED_MAX_LEN}")

    basis = tm.load_rights_basis(a.rights_basis)
    admitted = set(basis["admittedWorkIds"])
    v = ca2_pins.import_vendor()
    tok = ca2_pins.load_tokenizer()
    tok_version = ca2_pins.tokenizer_version(tok)
    pre = v["pre"]
    pdmx_dir = Path(a.pdmx_dir).resolve()
    out_dir = Path(a.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"rights basis: {len(admitted)} admitted works (basisDigest {basis['basisDigest'][:16]}…)")
    print("walking corpus…", flush=True)
    files = list(iter_admitted_files(pdmx_dir, admitted, pdmx_id_from_name))
    files.sort()
    rng = random.Random(a.seed)
    rng.shuffle(files)
    print(f"{len(files)} admitted MIDI files; pre-filtering by MThd ntrks >= {a.min_midi_tracks}", flush=True)

    log = collections.Counter()
    seen_bytes: set[str] = set()
    seen_dedupe: set[str] = set()
    examples: list[dict] = []
    works_used: set[str] = set()
    considered = 0
    for work_id, path in files:
        if len(examples) >= a.max_examples or (a.max_works and len(works_used) >= a.max_works):
            break
        if considered >= a.scan:
            break
        if midi_track_count(path) < a.min_midi_tracks:
            log["prefilteredSinglePart"] += 1
            continue
        considered += 1
        tm.assert_work_admitted(work_id, admitted)  # belt and braces: the walk already filtered
        content = hashlib.sha256(path.read_bytes()).hexdigest()
        if content in seen_bytes:
            log["duplicateBytes"] += 1
            continue
        seen_bytes.add(content)
        with contextlib.redirect_stdout(io.StringIO()):
            try:
                S = pre.load_and_clean_midisongbymeasure_from_midi_path(str(path))
            except Exception:
                log["loadErrors"] += 1
                S = None
        if S is None:
            log["loadNone"] += 1
            continue
        if len(S.tracks) < 2:
            log["skippedSingleTrackAfterClean"] += 1
            continue
        keys = dedupe_strings(v, S)
        if any(k in seen_dedupe for k in keys):
            log["duplicateNearEqual"] += 1
            continue
        seen_dedupe.update(keys)
        work_rng = random.Random(f"{a.seed}:{work_id}")
        rel = str(path.relative_to(pdmx_dir)).replace("\\", "/")
        exs = build_examples_for_work(
            v, tok, S, work_id, rel, window=a.window, per_work=a.per_work, variants=variants,
            rng=work_rng, max_tokens=a.max_tokens, log=log,
        )
        exs = exs[: max(0, a.max_examples - len(examples))]
        if exs:
            works_used.add(work_id)
            examples.extend(exs)
        if considered % 100 == 0:
            print(f"  considered {considered}, works {len(works_used)}, examples {len(examples)} ({round(time.time() - t0)} s)", flush=True)

    if not examples:
        raise SystemExit("no examples built; refusing to write an empty dataset")

    # Deterministic order: by split, then work id, then example id; index per split.
    examples.sort(key=lambda e: (("train", "val", "test").index(e["split"]), e["workId"], e["exampleId"]))
    counters = collections.Counter()
    for e in examples:
        e["index"] = counters[e["split"]]
        counters[e["split"]] += 1

    shards = {}
    by_split = collections.defaultdict(list)
    for e in examples:
        by_split[e["split"]].append(e)
    for split in ("train", "val", "test"):
        rows = by_split.get(split, [])
        path = out_dir / f"{split}.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as f:
            for e in rows:
                f.write(tm.canonical_json(e) + "\n")
        shards[split] = {"file": path.name, "examples": len(rows), "sha256": ca2_pins.sha256_file(path), "bytes": path.stat().st_size}

    manifest = tm.build_manifest(
        examples=examples, basis=basis, tokenizer_version=tok_version,
        ca2={
            "release": ca2_pins.RELEASE_TAG, "releaseZipSha256": ca2_pins.RELEASE_ZIP_SHA256,
            "vendoredSourceSha256": ca2_pins.vendored_source_digest(v["dir"]),
            "tokenizerMode": ca2_pins.TOKENIZER_MODE, "vocabSize": tok.vocab_size(), "vocabSha256": ca2_pins.vocab_digest(tok),
            "maxLen": v["cs"].MAX_LEN, "quantize": list(v["cs"].QUANTIZE), "finetuneTask": v["cs"].FINETUNE_TASK,
            "encoder": "encoding_functions.encode_midisongbymeasure_with_masks / nn_training_functions.val_test_infill_encode",
            "loader": "preprocessing_functions.load_and_clean_midisongbymeasure_from_midi_path",
        },
        builder={
            "script": "services/composers-assistant-train/build_dataset.py", "seed": a.seed, "window": a.window,
            "perWork": a.per_work, "variants": list(variants), "maxTokens": a.max_tokens, "scan": a.scan,
            "minMidiTracks": a.min_midi_tracks, "maxExamples": a.max_examples, "maxWorks": a.max_works,
            "admittedFilesInCorpus": len(files), "filesConsidered": considered, "worksUsed": len(works_used),
            "pdmxDir": str(pdmx_dir), "secondsToBuild": round(time.time() - t0, 1),
            "taskShape": "one target track x N consecutive measures masked (tournament shape); mask order ascending by measure, extra_id from 0",
        },
        dedupe={
            "method": "sha256 of file bytes + CA2 dedupe_and_filter_midi_files_functions onset-chromagram string over 12 transpositions (sha256 each); CA2's in-file near-equal track removal (_equality_measure, threshold 0.9) runs inside the loader",
            "duplicateBytes": log["duplicateBytes"], "duplicateNearEqual": log["duplicateNearEqual"],
            "prefilteredSinglePart": log["prefilteredSinglePart"], "loadNone": log["loadNone"], "loadErrors": log["loadErrors"],
            "skippedSingleTrackAfterClean": log["skippedSingleTrackAfterClean"], "skippedTooSmall": log["skippedTooSmall"],
            "skippedNoWindow": log["skippedNoWindow"], "skippedDegenerate": log["skippedDegenerate"],
            "skippedOverMaxLen": log["skippedOverMaxLen"], "skippedOverBuilderCap": log["skippedOverBuilderCap"],
            "skippedUnk": log["skippedUnk"], "encodeErrors": log["encodeErrors"],
        },
        shards=shards,
        built_at=datetime.now(timezone.utc).isoformat(),
    )
    with (out_dir / "manifest.json").open("w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")
    c = manifest["counts"]
    print(json.dumps({
        "examples": c["examples"], "works": c["works"], "perSplit": {k: v_["examples"] for k, v_ in c["perSplit"].items()},
        "perVariant": c["perVariant"], "perTargetInstrument": c["perTargetInstrument"],
        "maxInputTokensSeen": manifest["maxInputTokensSeen"], "maxLabelTokensSeen": manifest["maxLabelTokensSeen"],
        "datasetDigest": manifest["datasetDigest"], "tokenizerVersion": tok_version, "dedupe": manifest["dedupe"],
    }, indent=2))
    print(f"→ {out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
