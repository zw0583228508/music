# Melody and bass specialist paths — a separated stem, three pitch trackers, and the gate that decides what the Song Model gets

ANALYSIS ENGINE wave, Stream G. PR-88.

Evidence: `docs/evidence/melody-bass-paths-live.json` (every number below) ·
code: `artifacts/api-server/src/lib/melodyBassPaths.ts` (+ 20 tests),
`services/melody-bass-worker/` (the Modal worker), `sourceAnalyzer.ts` (the
flag) · runner: `artifacts/api-server/scripts/run-melody-bass-paths.mjs`.

## Why

The honest gap recorded on every Song Model built from a real upload: **Basic
Pitch on a full mix is not a melodic line.** The owner's upload
(`3108652e…`) produced 1,769 transcribed events and `melody: not_available`,
because the canonical fusion (`fuseCanonicalNotes`) admits a note from a sole
provider only at note × result × reliability ≥ 0.85, and a polyphonic
transcription of everything that sounds never gets there — nor should it. This
stream builds the specialist alternative the gap names — *separate a vocal or
lead stem first, or configure a second transcription provider* — and
**measures it** on exact truth before anyone trusts it.

## What was built

- **`services/melody-bass-worker`** — one isolated CPU image on Modal
  (`https://windot100--melody-bass-worker-endpoint.modal.run`, dedicated bearer
  token in the Modal secret `melody-bass-worker-token`): **htdemucs** 4-stem
  separation + **pYIN** (librosa), **CREPE** (torchcrepe full, Viterbi) and
  **Basic Pitch** (the same ICASSP-2022 ONNX checkpoint the live worker
  attests) on the requested stems, in a melody (80–1100 Hz) or bass
  (32–400 Hz) register. Every weight is fetched at build and verified against
  the full sha256 in `model_manifest.json` (demucs itself checks 8 hex
  characters); a synthesised two-part smoke must pass for the image to exist;
  `/health` re-hashes everything on every call (image
  `sha256:8b7b76c3…`, 19 checks). The worker returns *evidence* only —
  frame-level f0 + confidence per tracker, Basic Pitch events, per-stem RMS.
- **`melodyBassPaths.ts`** — every musical decision, unit-tested against
  exact truth: frame → note segmentation (voicing threshold, median filter,
  sustained-change rule, minimum duration 60/80 ms, same-pitch gap merge);
  polyphonic events → one line (highest for a lead, lowest for a bass);
  **onset-informed splitting** (a tracked note is cut where Basic Pitch heard
  an onset on the same pitch — the re-articulation no f0 tracker can see);
  octave repair (fold into the register; shift an isolated ≥ 11-semitone leap
  that both neighbours contradict; both counted); **fusion across trackers
  that never averages a disagreement** (confirmed ≥ 0.85, contested ≤ 0.4 and
  recorded, unsupported ≤ 0.5; result confidence = the agreement rate);
  scorers (note F1 at onset 50 ms / onset+pitch / +offset, voicing, frame
  pitch and chroma, octave-error rate); and `canonicalMelodyAcceptance`, which
  runs a candidate line through the *real* gate — `fuseCanonicalNotes` alone
  and beside the live full-mix Basic Pitch result — and `validateMelody`.
- **The flag.** `MELODY_STEM_PATH_V1=true` makes `analyzeProjectSource` run the
  stem path on a fresh lease after the provider round and push its line as one
  more `TranscriptionAnalysisResult` (`providerId: MELODY_STEM_PATH_V1`,
  reliability 0.72 in `providerReliability.ts` and the fusion table). Unset,
  the block is never reached. Bass evidence is measured but **not** wired into
  the Song Model's bass field.

## Method

- **Truth: ANALYSIS_GOLD_V1 SYNTHETIC_EXACT** (Stream H, PR-81), the composed
  works: 24 works rendered stem by stem by the platform's deterministic
  renderer, every note known. The melody truth is the highest-lying pitched
  non-bass track (role recorded per work: trumpet, flute, violin, fiddle,
  clarinet, synth lead, voice-line), overlapping tails trimmed to the next
  onset; the bass truth is the bass track. **3 refused** by rule (no bass
  track; a lead more than 25 % polyphonic ×2) → **21 works**, 37–79 s, 54–211
  melody notes and 16–288 bass notes each. Tiers never mixed: the owner's
  two uploads are PROFESSIONAL_REAL_WORLD, no truth, outputs only.
- **Arms**, same audio, same lease surface (own asset server on :5016 behind
  a quick tunnel), same judge:
  - `FULL_MIX_BASIC_PITCH` — the platform's live path, called through
    `runAnalysisProviders` exactly as `sourceAnalyzer` calls it; its
    `fuseCanonicalNotes` output is today's melody. **The baseline.**
  - `SEPARATED` — htdemucs on the mix → `vocals` and `other` in the melody
    register, `bass` in the bass register; the melody stem is chosen without
    truth (`vocals` when above −40 dBFS and within 12 dB of `other`, else
    `other`). On these instrumental works the rule picked `other` 21/21
    (vocal stem −65 dBFS).
  - `ORACLE_STEM` — the *true* lead and bass stems straight into the trackers:
    separation error removed, the tracker chain alone.
  - `MIX_TRACKERS` — the trackers on the unseparated mix, register-limited:
    is the stem what matters?
- **Metrics:** one-to-one greedy onset matching at 50 ms; onset+pitch requires
  the exact MIDI pitch; offset within max(50 ms, 20 % of the true duration);
  voicing and pitch on a 10 ms grid; octave error = onset-matched pairs off by
  exactly 12 or 24 semitones; and **acceptance under the canonical gate**:
  notes admitted with the path as sole provider, notes admitted beside the
  live full-mix result, `melody: detected` or not, `validateMelody` errors.
- **Variant sweep.** The raw evidence is cached, so the same frames were fused
  under eight variants (anchor order, tracker subset, onset split) at no cost.
  The library defaults are the measured winners — *on these 21 works; there
  is no held-out set*.

## Results — melody (21 works, means)

Fused line = the library default (Basic Pitch anchors; CREPE, split at Basic
Pitch's onsets, and pYIN confirm).

| path | notes / work | onset F1 | onset+pitch P / R / **F1** | +offset F1 | voicing acc. | octave err. | tracker agreement | canonical, sole | canonical, beside full mix (notes · P · R · F1) | `melody: detected` sole / beside |
|---|---|---|---|---|---|---|---|---|---|---|
| **FULL_MIX_BASIC_PITCH** (baseline, raw events) | 654 | — | 0.169 / 0.892 / **0.280** | — | — | — | — | **0 notes** | — | **0 / 21** |
| SEPARATED via `other` | 124 | 0.662 | 0.487 / 0.488 / **0.481** | 0.295 | 0.693 | 0.046 | 0.116 | 0 | 27.8 · 0.835 · 0.195 · 0.310 | 0 / **21** |
| ORACLE_STEM (true lead stem) | 77 | 0.754 | 0.905 / 0.600 / **0.717** | 0.400 | 0.739 | 0.003 | 0.705 | 0 | 19.6 · 0.971 · 0.164 · 0.277 | 0 / **21** |
| MIX_TRACKERS (no separation) | 124 | 0.709 | 0.634 / 0.646 / **0.629** | 0.450 | 0.722 | 0.009 | 0.099 | 0 | 53.2 · 0.695 · 0.311 · 0.422 | 0 / **21** |

Per tracker, onset+pitch F1 (octave-error rate): on the **true stem** CREPE
0.678 (0.001) → **0.710 with onset split** (9 splits / work), pYIN 0.274 (0.070),
Basic Pitch 0.717 (0.003); on the **separated `other` stem** CREPE 0.186
(**0.320**), pYIN 0.036, Basic Pitch 0.481 (0.046); on the **mix** CREPE 0.142,
pYIN 0.001, Basic Pitch 0.629.

Variant sweep, fused onset+pitch F1 / agreement on the true stem: `bp|crepe|pyin+split`
**0.717 / 0.705** (default), `bp|crepe+split` 0.717 / 0.712, `bp|crepe|pyin`
0.717 / 0.629, `crepe|pyin|bp+split` 0.710 / 0.657, `crepe|pyin|bp` 0.678 /
0.634, `pyin|crepe|bp` 0.274 / 0.553. Same order on the separated stem (0.481
vs 0.197 vs 0.036).

What the numbers say:

1. **The tracker chain is sound on a clean lead** (precision 0.905, octave
   errors 0.3 %); its misses are re-articulations and offsets (offset F1 0.40:
   a synth's release tail is not the score's note end).
2. **htdemucs's `other` stem is not a lead stem.** For an instrumental lead
   the separated path (0.481) is *worse* than the register-limited trackers
   on the unseparated mix (0.629): `other` holds the lead *and* the keys and
   guitars, CREPE's octave-error rate on it is 32 %, and Basic Pitch's
   highest-line reduction does the real work in both arms. Separation earns
   its cost for **bass** (below) and, presumably, for a **sung** lead landing
   in `vocals` — which this truth set cannot measure (no sung leads exist in
   it).
3. **The gate, measured.** The stem path's result confidence is the
   trackers' agreement rate (≤ 0.71 even on the true stem), so note × result
   × 0.72 never reaches the sole-provider floor of 0.85: **canonical sole = 0
   on every path** — the same `not_available` as today. Beside the live
   full-mix result, a note both heard at the same onset (30 ms) *and end
   (50 ms)* with the same pitch enters on two votes: **`melody: detected` on
   21/21 works**, but the admitted line is **sparse and clean** — 16–31 % of
   the true notes at 0.70–0.97 precision. The binding constraint is the
   cluster's *end* tolerance (offset F1 0.3–0.45 everywhere). That is a
   property of the gate, reported here, not tuned around.

## Results — bass (21 works, means)

Fused line = the library default (CREPE anchors; pYIN and Basic Pitch confirm;
no onset split). *Evidence* = only tracker-confirmed notes (confidence > 0.5),
what `bassEvidenceFromOutcome` would carry.

| path | notes / work | onset F1 | onset+pitch P / R / **F1** | +offset F1 | voicing acc. | octave err. | agreement | evidence notes · P · R · F1 | works with evidence |
|---|---|---|---|---|---|---|---|---|---|
| FULL_MIX_BASIC_PITCH events as bass | 654 | — | — / — / **0.154** | — | — | — | — | — | — |
| **SEPARATED bass stem** | 59.9 | 0.810 | 0.836 / 0.821 / **0.801** | 0.583 | 0.865 | **0.004** | 0.828 | 49.3 · **0.907** · 0.745 · 0.794 | 21 / 21 |
| ORACLE_STEM (true bass stem) | 58.1 | 0.846 | 0.872 / 0.816 / **0.825** | 0.595 | 0.818 | 0.011 | 0.794 | 45.2 · 0.911 · 0.704 · 0.770 | 21 / 21 |
| MIX_TRACKERS (no separation) | 24.3 | 0.071 | 0.070 / 0.026 / **0.028** | 0.009 | 0.301 | 0.080 | 0.129 | 3.3 · 0.152 · 0.015 · 0.026 | 14 / 21 |

Per tracker on the separated stem: CREPE 0.801 (→ 0.834 with onset split),
pYIN 0.164, Basic Pitch 0.678. Variant sweep: `crepe|pyin|bp` evidence
precision **0.907** / recall 0.745 (default); `crepe|pyin|bp+split` 0.840 /
0.825 (F1 0.828 — more notes, more wrong ones); `crepe|bp` 0.940 / 0.639;
`bp|crepe|pyin` 0.857 / 0.624. The default keeps precision: a bass note nobody
corroborated is a guess, and the split's extra recall came at 7 points of
precision. Separation is decisive for bass: 0.80 with it, 0.03 without,
0.15 for the platform's current full-mix events read as bass.

## Cost

CPU containers (4 cores, 12 GiB, ≈ $0.285 / h at Modal's published rates):
CREPE-full **1.96 s per second of audio per stem**, pYIN 0.20, Basic Pitch
0.01, htdemucs 0.47; a 57-s work through all three stems ≈ 421 s wall. Modal's
150 s HTTP limit is bridged by its own 303 self-redirect. The gold run: 83
paid calls, 18,977 s of container time, **≈ $1.50** (+ $0.04 probe); the owner's
two songs ≈ $0.31. Well under the $10 cap (total below).

## The owner's two uploads (PROFESSIONAL_REAL_WORLD, no truth)

Both songs whole, no excerpt, re-encoded once to 320 kb/s MP3: the
platform's lossless FLAC proxies (45–52 MiB) draw **HTTP 413** from the live
Basic Pitch worker (source limit 25 MiB), and every arm must see the same
bytes. **Found on the way:** the first worker image saved every download as
`source.bin`, and ffmpeg lets that extension outvote content probing — an
ID3-tagged MP3 went to the `bintext` demuxer and came back "could not be
decoded as audio". WAV and FLAC had survived it; the owner's MP3 did not. The
download is now saved without an extension and the build smoke decodes an MP3
under that name (image `sha256:d8579205…`; the gold calls ran on
`8b7b76c3…`, identical code but for the file name).

| | upload 1 `3e728b2c…` ("my demo", 230 s) | upload 2 `3108652e…` (260 s, the PR-86 song) |
|---|---|---|
| **today:** full-mix Basic Pitch events → canonical melody | 1,792 → **0** (`not_available`) | 1,776 → **0** (`not_available`) |
| separated stems, RMS dBFS (drums / bass / other / **vocals**) | −18.5 / −20.8 / −22.1 / **−16.8** | −15.0 / −21.8 / −22.9 / **−15.5** |
| melody stem chosen by the RMS rule | vocals | vocals |
| vocal stem, notes per tracker: CREPE / +split / pYIN / Basic Pitch | 666 / 890 (224 splits) / 378 / 705 (896 raw, 30 octave repairs) | 699 / 1,070 (371 splits) / 251 / 912 (1,182 raw, 35 repairs) |
| fused melody: notes · agreed / contested / unsupported · agreement | 705 · 516 / 111 / 78 · **0.73** | 912 · 626 / 131 / 155 · **0.69** |
| canonical melody, stem path alone | 0 | 0 |
| **canonical melody beside full-mix Basic Pitch** | **179 notes → `melody: detected`** | **162 notes → `melody: detected`** |
| `validateMelody` on the carried line / on the raw fused line | no errors / no errors | no errors / no errors |
| anchor check (beside-full-mix notes: Basic Pitch anchor vs CREPE anchor vs CREPE+split) | 179 vs 84 vs 158 | 162 vs 79 vs 138 |
| bass stem: fused notes · agreement · **carried evidence** | 189 · 0.72 · **137** | 419 · 0.64 · **268** (110 CREPE notes folded down an octave) |
| worker compute (CPU) | 1,890 s in 2 calls (cold separation 373 s) | 1,537 s in 2 calls |

What can be said without truth: both songs carry a strong vocal stem; three
trackers agreed on 516 and 626 notes of it; the disagreement engine's input is
111 and 131 recorded contested regions per song; the flag would turn
`melody: not_available` into `detected` with a line of 179 and 162 notes over
230 and 260 s — about 0.7 notes per second, a sparse skeleton of the 705 and
912 the trackers heard, kept where Basic Pitch on the full mix heard the same
onset, end and pitch. Whether those are *the* sung notes is the owner's
judgement: the honest next step is to render the admitted line against the
song in the Listening Room, not to promote it. The gold-chosen defaults also
carry the most notes here (a consistency check, not a proof). Upload 2's bass
stem folded 110 CREPE notes down an octave — a bass part played high, or
bleed; the fold count is the flag.

Spend for the stream: ≈ $1.50 gold + $0.04 probe + $0.31 owner songs + ≈ $0.10
of calls aborted while fixing the MP3 bug ≈ **$2.0 of the $10 cap** (Modal CPU
rates; an estimate from wall seconds, not a bill).

## Decisions taken here

- Library defaults from the sweep: **melody** `basic_pitch → crepe (+split) → pyin`,
  **bass** `crepe → pyin → basic_pitch`, no split. Reliability weights from the
  same numbers: `MELODY_STEM_PATH_V1` melody **0.72** (the fused line's F1 on a
  clean stem — the tracker chain's number, not a promise about separation),
  `BASS_STEM_PATH_V1` bass **0.80**.
- The stem path enters the analyser **only behind `MELODY_STEM_PATH_V1`**, as an
  additional provider beside Basic Pitch. Nothing is promoted; defaults are
  unchanged.

## Honest limits

- **No sung lead in the truth set.** The path the flag actually takes on a
  real song — the `vocals` stem — is measured here only on the owner's two
  uploads, without truth. The synthetic tier measures the tracker chain
  (oracle) and the separator's failure on instrumental leads; it cannot say
  what CREPE does with vibrato, glides and breath on a real voice.
- **Defaults chosen on the works they were measured on.** 21 works, no
  held-out set; the anchor/split choices are the best of eight variants on
  this data and are stated as such.
- **The gate is the gate.** A sole new provider cannot make a melody
  `detected` under the 0.85 floor with an agreement-rate confidence; the
  measured route to a melody is agreement with Basic Pitch, which admits a
  sparse line (≈ 20 % of true notes). Widening the cluster's end tolerance or
  letting a two-tracker agreement inside one provider count as two votes are
  gate changes with measured consequences — Stream I's disagreement engine,
  not this PR.
- **Offsets are weak everywhere** (F1 0.3–0.6): release tails and legato.
- **Bass evidence is measured, not carried** into the Song Model.
- **CPU cost**: 2 s per audio-second per CREPE pass; a 4-minute song is
  ≈ 10 min per stem. A GPU image would change the cost, not the numbers.
- **Quick tunnel, in-memory leases, 8 CPU containers** — a measurement
  setup, not a production one.
