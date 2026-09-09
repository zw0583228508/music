# MUSIC_REWARD_MODEL_V0 — a pretrained critic, and the tests that would expose it

Wave Q, PR-77 (`music-reward-model-v0`). Evidence:
`docs/evidence/preference-pairs-manifest.json`,
`docs/evidence/music-reward-model-v0.json`. Code: `symbolicCorruptions.ts`,
`rewardModelV0.ts`, `scripts/build-preference-pairs.mjs`,
`scripts/train-reward-model-v0.mjs`.

## 1. What it is, and what it is not

The decision pack (§10b) puts it in one line: **a reward model trained on
synthetic degradations is a pretrained critic, not the truth.** V0 is that
critic: a pairwise logistic model over hand-crafted features, trained to
prefer a human-written part over a musically damaged copy of it, in the
part's real ensemble context. It has never seen a human preference between
two real candidates. Humans define the top of the scale; this model only
knows the bottom.

**The trap.** A critic trained on (original, corrupted) pairs can reach high
accuracy by recognising *the corruption generator* — the fingerprint of the
code that damaged the part — rather than anything a listener would call
music. Such a critic would score perfectly on its own test split, fail on any
damage it had not seen, and be worse than useless as a training target: a
generator optimised against it would learn to avoid the fingerprint and
nothing else. This stream was built to make that trap testable, not to claim
it was avoided.

## 2. Design

### 2.1 The corruption library (`symbolicCorruptions.ts`)

Nineteen families, each breaking one named musical property of **one target
part inside its real ensemble** (the context tracks are never touched), at
three graded severities, deterministic in a seed. None is a noise-like
artefact: every corrupted part is a plausible MIDI part on the same
instrument, in the same bars.

| family | breaks | what a listener loses | severity 1 / 2 / 3 |
| --- | --- | --- | --- |
| `pitch_shift_in_key` | melodic line | notes moved to other scale degrees of the *context's* key | 15 / 35 / 60 % of notes |
| `pitch_shift_out_of_key` | harmony | notes moved a semitone out of the key | 10 / 25 / 50 % |
| `chord_tone_to_non_chord_tone` | harmony | chord tones of the shared estimated chord become diatonic non-chord tones | 20 / 40 / 70 % of chord-tone notes |
| `octave_displacement` | register | a run of bars moved an octave (two at 3) | 25 / 50 / 75 % of bars |
| `leap_injection` | voice leading | steps become leaps of a sixth–seventh onto a scale tone | 20 / 40 / 70 % of steps |
| `parallel_doubling` † | voice leading | bars replaced by a context line at the unison/octave | 35 / 60 / 100 % of bars |
| `onset_jitter` | rhythm | onsets pushed off the grid | 30 / 50 / 70 % of onsets, ≤ ⅛ / ¼ / ½ beat |
| `quantisation_coarsening` | rhythm | onsets snapped to the beat / half-bar / bar | grid |
| `syncopation_removal` † | rhythm | off-beat onsets moved onto beats | 40 / 70 / 100 % |
| `density_thinning` | density | notes removed | 30 / 50 / 70 % |
| `density_doubling` | density | notes subdivided into repeated halves | 30 / 60 / 100 % |
| `bar_copy_repetition` | development | bars overwritten by the bar before | ⅓ / ⅔ / all bars = bar 1 |
| `phrase_shift` | phrase | the part shifted late against the ensemble | 1 / 2 / 3 beats |
| `motif_destruction` † | motif | returns of the part's four-note cells rewritten in key | 50 / 75 / 100 % of returns |
| `cross_part_clash` | consonance | notes moved a semitone from a sounding context note | 15 / 30 / 50 % |
| `role_inversion` | instrumentation role | the part transposed to the other side of the ensemble | past the quartile / clear / an octave beyond |
| `section_swap` † | continuity | blocks of bars exchanged while the ensemble stays | 2-bar blocks / halves / reversed |
| `dynamics_flattening` | dynamics | velocities compressed / flat / inverted | — |
| `duration_overhang` † | harmonic rhythm | notes held across the next chord change | 30 / 50 / 80 % of such notes, ½ / 1 / 2 beats |

† held out of training entirely (§3, gate b). Pitch/harmony families are not
applied to a drum-kit part. A family that finds nothing to damage (a
flat-velocity part, a part with no recurring cell) reports `applicable:
false` and no pair is made — never an "original vs identical" pair.

Listening Benchmark V2's small set of listening controls is meant to be
drawn from this superset later; nothing here depends on it.

### 2.2 Pairs (`scripts/build-preference-pairs.mjs`)

Admitted PDMX works (our licence gate ∩ the authors' `no_license_conflict`
subset) in SHA-256 order of the work id; PDMX.csv `n_tracks ≥ 2` as a
pre-filter; the first N whose MIDI is multitrack by PR-65's definition. Each
work is re-cut on its **dominant metre** (PR-75) so pickup-bar files are not
refused. Per work: up to two eight-bar tournament tasks (a random aligned
window per program) and one whole-section task from `formSegmentation`
(8–32 bars). Work-level 90/5/5 `hashSplit`, made group-aware over
near-duplicate groups. **Train and val see only the 14 training families;
test sees all 19** — the five held-out families exist nowhere but in test.
Only features, ids and counts leave the script; no MIDI is written.

### 2.3 Features (`rewardModelV0.ts`, `REWARD_FEATURES_v0`, 52 features)

- **judge (10)** — judge 1.1's playability errors, range and register shares,
  chord-tone share, coverage, bar repetition, context clash, distinct
  pitches, collapse flag. **Excluded on purpose:** `densityLogRatio`,
  `intervalDistance` and `score`, because they compare against the human
  part — in a preference pair the original *is* that anchor, and a critic
  that scored distance-to-anchor would be perfect and useless.
- **coherence (10)** — `COHERENCE_METRIC_v1` on context + candidate over the
  window: composite, harmonic overlap (ensemble, candidate track, worst), the
  candidate's seam excess, unexplained re-entries, register and density
  roughness, motif quoted share.
- **stats (32)** — the candidate in its context: key-scale share (key read
  from the *context*), step/leap shares, direction changes, parallel perfect
  motion against context lines, register offset and above-top/below-bottom
  shares, grid offset, on/off-beat shares, onsets per bar and their
  variation, density vs the context, duration, chord-change overhang and
  hit shares, in-part motif recurrence, bar-to-bar continuity and the
  midpoint jump, velocity spread and downbeat accent, phrase starts on bar
  lines, rest share, pitch-class entropy, empty bars, note count.

The model: logistic regression on standardised feature differences with no
bias, so P(A ≻ B) + P(B ≻ A) = 1 by construction; full-batch Adam, fixed
steps, no sampling, no shuffling — deterministic and versioned by the
feature manifest digest.

## 3. The gates (`rewardModelGate`)

All six are reported; none may be skipped:

- **(a)** in-distribution accuracy per family × severity on the test split
  (work-level, group-aware);
- **(b)** **held-out-family accuracy** — the five families the critic never
  saw. This is the generator-recognition test: a critic that learned the
  generator has no reason to prefer the original under damage it never met;
- **(c)** the calibration curve — mean P(original ≻ corrupted) must rise
  with severity;
- **(d)** **Human-vs-AI with no synthetic corruption**: on the three
  tournaments' entries (classical, global, challenger), does the critic put
  `HUMAN_ORIGIN_REFERENCE` above every machine arm, per family;
- **(e)** agreement with the owner's blind votes, with n and a two-sided
  binomial p;
- **(f)** ablations — without the judge features, without the coherence
  features, without the statistics; and each group alone.

**The rule in code:** V0 may be used for *ranking or filtering* only if
(b) ≥ 0.80, (c) is monotone, and (d) puts the human above every arm in every
report. It may **never** be a training target, whatever the numbers say.

## 4. What the run said

Everything below is from one real run on this machine (git `5e7345b` +
this PR's code; corruption seed 77; no GPU, no cloud, $0).

**Pairs.** 16,000 admitted files scanned, 6,000 multitrack works kept
(5,384 / 309 / 307 train / val / test after 107 near-duplicate groups moved
30 works); 16,907 tasks (11,734 eight-bar windows, 5,173 sections, median
11 bars); **212,090 pairs — 160,748 train, 9,199 val, 42,143 test**, of which
10,379 test pairs are the five held-out families, which appear in no other
split. Build: 360 s wall over 10 workers. Not applicable and refused:
`dynamics_flattening` could not apply 12,678 times (PDMX velocities are
flat) and carries only 2,802 training pairs; `role_inversion` 2,563 (the
inverted register leaves the MIDI range); `chord_tone_to_non_chord_tone`
2,352 (no chords, or a part never on a chord tone).

**The model.** 52 features, 160,748 training differences, 400 Adam steps,
51 s; train accuracy 0.964, val 0.964.

**(a) In-distribution (test split, 31,764 pairs): 0.963.** Every training
family ≥ 0.93 except `role_inversion` 0.875 (0.77 at severity 1) and
`dynamics_flattening` 0.855 — its inverted-accent severity scores **0.565**,
because a velocity-spread feature cannot see an inversion. Windows 0.963,
sections 0.963; per target family 0.96–0.98, drums 0.865.

**(b) Held-out families (10,379 pairs): 0.658 — the gate's 0.80 is not
met.** Three of the five generalise: `syncopation_removal` 0.933,
`motif_destruction` 0.928, `section_swap` 0.883. Two are **below chance —
the critic prefers the damaged part**: `duration_overhang` 0.382 and
`parallel_doubling` 0.226. The weights say why. `s_meanDurationBeatsLog`
(+1.29) and `s_parallelPerfectShare` (+1.26) are among the largest positive
weights: in the training pairs the human part is the one with *longer* notes
and *more* parallel perfect motion, because the training corruptions
(shifts, leaps, thinning, jitter) only ever break those. The critic learned
"long notes and doublings are what the generator leaves alone", which is a
fact about the generator; held across it, a corruption that *adds* length or
doubling is rewarded. That is generator recognition in a legible form.

**(c) Calibration.** Mean P(original ≻ corrupted) by severity: **0.815 →
0.866 → 0.881, monotone**; in-distribution 0.879 → 0.943 → 0.960, held-out
0.617 → 0.627 → 0.643. Fifteen of nineteen families are monotone; the four
that are not are the two anti-generalising families (their curves fall with
severity, as they must), `dynamics_flattening` (severity 3 inverts) and
`phrase_shift` (0.887 / 0.908 / 0.907, flat).

**(d) Human-vs-AI, no corruption anywhere (1,136 tournament entries,
0 failed).** The critic does **not** rank the human above every arm.
Classical (12 tasks × 3 seeds): human beats `COMPOSERS_ASSISTANT_2+CTX`
23/36 (P 0.646) but only ties raw CA2 18/36 and **loses to the platform's own
`REFERENCE_PART_COMPOSER` and `CONTEXT_AWARE_ARRANGER` 15/36 each (P 0.43,
0.46) — 0/6 on bass, keys and strings, 6/6 on brass and reed.** Global (50
tasks): human 103/150 vs CA2+CTX, 84/135 vs REFERENCE and CONTEXT_AWARE, but
60/150 vs raw CA2 (P 0.42); by family the platform composers beat the human
on keys (3/18) and organ, the human wins every strings, brass, reed and
guitar cell against them. Challenger: human beats the Anticipatory Music
Transformer 19/28 and 23/28 (+CTX). The largest weight in the model is
`s_restShare` (−2.83): a part that rests is penalised, and the platform's
composers never rest. Where a human part is sparse — bass, keys — the critic
prefers the machine that fills every bar.

**(e) The owner's votes: 24 of 50 agree (0.48, two-sided p 0.89).** A coin
flip, as expected: per comparison 5/10, 5/10, 5/10, 3/10 (human vs
REFERENCE) and 6/10 (human vs CA2+CTX). The evidence's 49 became 50 in the
live session (one more primary vote after the ratings document was written);
all 50 are scored, none skipped.

**(f) Ablations — which floor carries it.**

| model | in-dist | held-out | overhang | parallel | motif | swap | syncop. | owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| full | 0.963 | 0.658 | 0.38 | 0.23 | 0.93 | 0.88 | 0.93 | 24/50 |
| without judge | 0.944 | 0.614 | 0.35 | 0.20 | 0.87 | 0.78 | 0.94 | 24/50 |
| without coherence | 0.962 | 0.661 | 0.37 | 0.25 | 0.94 | 0.88 | 0.93 | 23/50 |
| without stats | 0.814 | 0.685 | **0.86** | 0.24 | 0.88 | 0.85 | 0.64 | 27/50 |
| judge only | 0.750 | 0.688 | **0.89** | 0.35 | 0.86 | 0.80 | 0.59 | 26/49 |
| coherence only | 0.689 | 0.533 | 0.54 | 0.19 | 0.67 | 0.75 | 0.53 | 27/50 |
| stats only | 0.931 | 0.607 | 0.38 | 0.21 | 0.88 | 0.71 | 0.93 | 24/50 |

The statistics carry in-distribution accuracy (0.931 alone; 0.814 without
them) and are also what anti-generalises: without them `duration_overhang`
goes from 0.38 to 0.86. The judge alone is the weakest in distribution
(0.750) and the best out of it (0.688). Coherence adds almost nothing on
eight-bar windows (0.962 without it). No configuration passes (b), and no
configuration puts the human above every arm on (d). `parallel_doubling` is
below chance for every one of them: nothing in the feature set reads voice
independence as a virtue.

**The gate: FAIL.** `rewardModelGate()` returns `passed: false` with two
reasons — held-out-family accuracy 0.658 < 0.80, and the human part is not
ranked above every machine arm. **V0 may not be used for ranking or
filtering, and could never have been used as a training target.** What it
is good for: a regression harness. The corruption library, the held-out
protocol and the Human-vs-AI test now exist and run in five minutes; the next
critic — whatever its features or its training data — is measured by them
before anybody believes its loss.

**Honest limits.** (1) Every accuracy in (a)–(c) is accuracy at telling a
human part from a damaged copy of *itself*; it says nothing about two real
candidates. (2) The held-out families are still corruptions written by the
same author with the same primitives; passing them would have been evidence
against generator recognition, not proof of musical judgement — and they
were not passed. (3) Gate (d) is the critic's opinion of the tournament
MIDIs; nobody listened here, and the platform composers' wins are partly the
`s_restShare` weight. (4) Gate (e) is one rater on comparisons that were
themselves a coin flip. (5) Dynamics are almost absent from PDMX MIDI, so
the critic knows almost nothing about them. (6) The split is work-level and
group-aware, but one work can contribute a window and a section to the same
split; test tasks are never in train. (7) `parallel_doubling` doubles a
context line at the octave/unison, which real scores do on purpose; the
family's premise — that a *replaced* part is damage — is right, but a critic
cannot see the replacement without the original, and that is the point of
the test.

## 5. What human preference must add

Nothing in this critic models taste, originality, feel, emotional arc or
style authenticity. It can tell a part from a damaged copy of that part; it
cannot tell a good part from a competent one, a fresh idea from a cliché, a
line that breathes from one that merely fits, or a Mizrahi arrangement from
a pop one wearing its scale. Those are the axes on which human raters must
define the top of the scale — the owner first, five independent raters for
Gate C, and `PROFESSIONAL_HUMAN_GOLD` where there is evidence for the label.
A reward model that graduates from V0 does so by being trained on those
votes, with this critic at most as a pre-filter that keeps the obviously
broken out of the rater's queue.
