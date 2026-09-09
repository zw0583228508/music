# Wave Q — Corpus profile of the admitted PDMX MIDI

**Status: complete. A full pass over every admitted file — 222,820 of 222,820,
0 parse failures. Nothing here is sampled, estimated or extrapolated.**

Evidence: `docs/evidence/corpus-profile.json`.
Code: `artifacts/api-server/src/lib/corpusProfile.ts`,
`artifacts/api-server/src/lib/arrangerTaskTypes.ts`,
`artifacts/api-server/src/lib/nearDuplicate.ts`,
runner `artifacts/api-server/scripts/profile-corpus.mjs`.
Per-work records: `.corpus-data/corpus-profile/works.ndjson` (git-ignored, one
`WorkProfile` per line, 222,820 lines).

PR-53 measured a 5,000-score sample and found that 9 % of PDMX scores yield an
arranger task. That number stood behind the from-scratch-vs-foundation
decision. This document replaces it with the whole corpus, and with fifteen
task types instead of one.

---

## 0. What was run

| | |
| --- | --- |
| Source | Zenodo record 15571083 (PDMX), `no_license_conflict` subset |
| Dataset digest | `48db5562…` · rights digest `97b7c795…` |
| CSV rows | 254,077 |
| Admitted by **our** licence gate | 222,856 |
| Admitted by the **authors'** `no_license_conflict.txt` | 222,856 |
| Intersection — the admitted corpus | **222,856** |
| MIDI files on disk | 254,035 |
| Admitted **with a file** | **222,820** (36 admitted rows have no `.mid`) |
| Profiled | **222,820** · parse failures **0** |
| Throughput | 473.8 s over 10 worker threads — 470 files/s, 4,658 worker-CPU-seconds; 578 s wall including dedup |
| Tokenizer | `ARRANGER_REMI_v1_3cfd16b3_386`, bar cap 512 |

**Determinism.** The full pass was run twice from a clean bundle. The two
evidence documents are identical field-for-field apart from `ranAt` and the
timing block — same 222,820 records, same 3,313,967 tasks, same 34,187
duplicate groups. Ordering is by SHA-256 of the work id, so a `--sample N` run
is a deterministic prefix of the same order.

Because the full pass costs ten minutes, **no sampling was needed** and none
was used. The `--sample` path exists and reports itself in the evidence, but
every number below has *n = 222,820*.

---

## 1. The five answers the plan asked for

| Question | Answer (measured) |
| --- | --- |
| **How many usable multitrack works exist?** | **20,638** works are multitrack (9.26 % of 222,820). After near-duplicate collapse, **19,588** independent multitrack works remain. 20,484 of the 20,638 yield at least one task. |
| **How many training tasks can be produced?** | **3,313,967** across 16 task types from 215,763 works — of which **1,347,597** come from multitrack works and 1,966,370 from solo scores. After collapsing duplicate groups: **2,688,993** (1,310,148 multitrack). Capped at 4 per (work, type): 2,155,379 raw, 1,630,222 deduplicated. |
| **How many per instrument family?** | keys 2,221,121 · strings 334,313 · reed 296,105 · pipe 284,742 · brass 272,806 · drums 256,470 · ensemble 173,803 · bass 131,209 · guitar 107,935 · organ 81,677 · chromatic_perc 67,316 · synth 55,463 · ethnic 8,546 · percussive 4,604 · sfx 426. Restricted to the nine types that **require** a multitrack score, the ordering flattens: keys 280,354 · strings 166,426 · reed 165,120 · drums 164,392 · brass 149,624 · pipe 146,268 · bass 77,314 (full table in §4). |
| **How many per genre family?** | unknown 2,112,944 · classical 800,391 · folk 97,827 · soundtrack 90,240 · rock 87,263 · pop 49,110 · jazz_blues 21,945 · electronic 14,815 · world 12,426 · rnb_funk_soul 9,592 · hiphop 6,637 · religious 5,780 · country 3,096 · other 1,901. **74 % of works carry no genre at all** (`genres = NA`). |
| **How many whole-form tasks?** | **39,136**, from **14,986** works — one per (work, family) over pieces of 16–128 bars. This is the only task type in the set whose target is an entire piece. |
| **What is missing?** | §7. |

---

## 2. Ensembles — what the corpus actually contains

| Class | Works | Share |
| --- | --- | --- |
| multitrack (≥ 2 pitched families, or ≥ 1 pitched + drums) | **20,638** | 9.26 % |
| solo (one family; two piano hands count as one) | 202,131 | 90.7 % |
| empty (no notes) | 51 | 0.02 % |

This confirms PR-53's 9 % on the full corpus rather than on 5,000 files —
**PDMX is solo sheet music with a 9 % multitrack tail**, and the tail is what
an arrangement model can learn from.

Inside the multitrack tail:

| | min | p10 | p50 | p90 | max | mean |
| --- | --- | --- | --- | --- | --- | --- |
| families per work | 2 | 2 | 2 | 5 | 12 | 2.94 |
| tracks per work | 1 | 2 | 4 | 13 | 66 | 6.12 |
| bars per work | 1 | 16 | 52 | 161 | 512 (cap) | 75.9 |
| ARRANGER_REMI tokens | 63 | 768 | 3,470 | 17,693 | 189,572 | 7,328 |

**Half of the multitrack corpus is a duo.** The median multitrack work has two
families; the p90 is five.

Family presence (works in which a family sounds):

| family | all works | multitrack works |
| --- | --- | --- |
| keys | 198,554 | 14,712 |
| pipe | 9,270 | 6,199 |
| strings | 9,030 | 6,366 |
| ensemble | 9,248 | 3,220 |
| brass | 7,513 | 5,512 |
| reed | 7,285 | 5,913 |
| drums | 5,590 | 5,007 |
| synth | 4,075 | 4,036 |
| organ | 3,412 | 2,392 |
| guitar | 3,365 | 2,294 |
| bass | 2,976 | 2,745 |
| chromatic_perc | 2,026 | 1,878 |
| ethnic | 251 | 205 |
| percussive | 156 | 142 |
| sfx | 24 | 23 |

**Bass and guitar are the thin families** — 2,745 and 2,294 multitrack works,
against keys' 14,712. PR-53 said "bass and guitar thin" from a sample; the full
corpus puts numbers on it. Drums appear in 5,007 multitrack works, more than
PR-53's sample suggested.

Ensemble diversity: **1,414 distinct family combinations** among multitrack
works, but an effective count (2^entropy) of only **97.2** — the distribution
is dominated by a handful of duos. The top combinations:

| ensemble | works |
| --- | --- |
| keys + synth | 3,333 |
| keys + strings | 1,605 |
| keys + ensemble | 1,441 |
| keys + pipe | 1,222 |
| keys + organ | 757 |
| brass + reed | 634 |
| keys + reed | 409 |
| brass + reed + pipe | 367 |
| keys + organ + pipe | 366 |
| strings + pipe | 339 |
| drums + brass + reed + pipe | 328 |

`keys + synth` at the top is largely a notation artefact — a second staff
exported on a synth-pad program — not a real two-instrument arrangement. A
full band (`drums + keys + guitar + bass + brass + reed`) appears 101 times.

---

## 3. Musical shape

**Metre.** Dominant metres over all works: 4/4 87,488 · 6/8 39,561 ·
2/2 25,972 · 2/4 24,259 · 3/4 23,527. Among multitrack works 4/4 dominates
harder (12,656 of 20,638) with 3/4 second (2,775).

Four numbers here are a **warning about the tokenizer grid**, not about the
music:

| | works | share |
| --- | --- | --- |
| metre changes at least once | 131,345 | 59 % |
| first metre is **not** the dominant metre | **103,469** | **46 %** |
| first bar is a pickup (anacrusis exported as a metre change) | 97,691 | 44 % |
| metre had to be approximated by the tokenizer | 96,660 | 43 % |

`toGridNotes` lays every work on a grid derived from its **first** time
signature. For 46 % of the corpus that first signature covers a minority of
the piece — usually because the anacrusis was exported as a one-bar metre
change. Bar numbers for those works are off by the pickup, and the grid is
wrong for the rest of the piece where the change is real. PR-59's tournament
already refused tasks from files with a metre change for exactly this reason.
**This is the largest single data-quality defect in the corpus and it is ours,
not PDMX's** — §7.

**Tempo.** 154,842 works (69 %) sit in 120–139 bpm, which is mostly the
notation default of 120 rather than a musical fact; 19,749 works (8.9 %) have
more than one tempo. Tempo is close to uninformative in this corpus.

**Key.** G major 48,484 · D major 45,356 · A major 20,972 · C major 16,215 ·
F major 14,191 · E minor 12,459 · A minor 11,015. 168,593 major against
53,111 minor; 1,116 works too thin for the estimator, which refuses rather
than guesses. The G/D/A concentration is the signature of fiddle and folk
lead-sheet repertoire, not of the classical share.

**Harmony** (`chordsFromNotes` per bar, pitched notes only):

| | p10 | p50 | p90 | mean |
| --- | --- | --- | --- | --- |
| distinct chord symbols, all works | 2 | 4 | 9 | 5.17 |
| distinct chord symbols, multitrack | 3 | 7 | 18 | 9.08 |
| chord-change rate, all works | 0.333 | 0.778 | 1 | 0.713 |
| chord-change rate, multitrack | 0.515 | 0.818 | 1 | 0.776 |
| share of bars given a chord at all | 0.116 | 0.333 | 0.640 | 0.357 |

The last row matters for every downstream harmony feature: **the estimator
names a chord in only a third of bars at the median**, because it refuses a bar
that does not support one (single-line melody, arpeggio spread across bars).
Any conditioning on chords must survive two thirds of the bars being unlabelled.

**Note density** (notes per bar, median over works where the family sounds):
drums 8.18 · guitar 6.33 · strings 6.12 · ensemble 7.50 · brass 5.92 ·
reed 5.80 · pipe 5.06 · organ 4.22 · keys 4.00 · synth 4.00 · bass 3.56 ·
chromatic_perc 3.88 · ethnic 3.91 · percussive 2.15.

**Phrase-length proxy** (rest-delimited runs, median in beats): 23.96 for
multitrack works, 35.5 for the melody family, 72 over all works. These are
**too long to be phrases** — a run only ends at a rest of a quarter note or
more, and continuous keyboard textures never rest. Read the proxy as "how long
this part plays without breathing", not as phrase length; §7.

**Melody family** (highest-register pitched family sounding in ≥ half the
bars, only defined when ≥ 2 pitched families exist): keys 6,085 ·
pipe 3,555 · strings 2,488 · reed 1,717 · ensemble 1,689 · organ 1,615 ·
brass 946 · chromatic_perc 843 · guitar 568 · synth 254.

**Genre.** 164,347 works (74 %) are `NA`. Of the labelled ones, classical
42,103 dwarfs everything else. Restricted to multitrack works the labelled
picture is: classical 9,150 · unknown 8,291 · soundtrack 781 · folk 683 ·
rock 619 · pop 437 · jazz_blues 152 · electronic 125 · world 100 ·
hiphop 95 · rnb_funk_soul 84 · religious 75 · country 27 · other 19.

**There are 3,197 labelled non-classical multitrack works in the entire
admitted corpus**, and none of them is labelled Mizrahi or Israeli. PR-59's
"the pop/dance/Mizrahi question is untouched" is not a gap in that experiment —
it is a property of the corpus.

**Cross-check.** The CSV's own `n_tracks` column agrees with our parsed
note-carrying track count on 189,895 works and differs on 32,925 (14.8 %) —
expected, since we count tracks that actually carry notes and PDMX counts
staves.

---

## 4. Task types and their real yield

`arrangerTaskTypes.ts` defines sixteen types over one representation: a task is
two disjoint sets of **cells**, a cell being one (bar, family). The *context* is
what the model sees; the *target* is what it must write, and **the target is
always the human's own notes** — nothing is synthesised, and a score that does
not satisfy a type's rule yields nothing for that type. `extractArrangerTasks`
in `arrangerTaskExtraction.ts` is untouched; this is additive.

Shared rules: ≥ 8 target notes sounding in ≥ half the target bars, ≥ 8 context
notes sounding in ≥ half the context bars, context and target never share a
cell, windows of one type never overlap within a work.

Yield over the full corpus, uncapped:

| type | tasks | from multitrack | from solo | works yielding |
| --- | ---: | ---: | ---: | ---: |
| `phrase_continuation` | 843,179 | 119,827 | 723,352 | 208,384 |
| `masked_bars` | 631,535 | 88,391 | 543,144 | 200,587 |
| `masked_track` | **474,708** | 474,708 | 0 | 20,320 |
| `section_continuation` (16 → 16 bars) | 295,012 | 39,031 | 255,981 | 156,898 |
| `track_completion` | **216,449** | 216,449 | 0 | 18,645 |
| `introduction` | 213,329 | 19,500 | 193,829 | 213,329 |
| `outro` | 208,622 | 18,589 | 190,033 | 208,622 |
| `accompaniment` | **151,988** | 151,988 | 0 | 19,618 |
| `transition` | 57,500 | 29,418 | 28,082 | 27,529 |
| `arrangement_expansion` | **55,786** | 55,786 | 0 | 4,944 |
| `density_transformation` | 44,973 | 13,024 | 31,949 | 17,243 |
| `whole_form` | **39,136** | 39,136 | 0 | 14,986 |
| `texture_development` | **27,043** | 27,043 | 0 | 7,696 |
| `orchestration` | **19,051** | 19,051 | 0 | 3,140 |
| `arrangement_reduction` | **19,051** | 19,051 | 0 | 3,140 |
| `motif_continuation` | **16,605** | 16,605 | 0 | 7,015 |
| **total** | **3,313,967** | **1,347,597** | **1,966,370** | 215,763 |

Bold types require a multitrack score by construction. The nine of them
together are **1,019,817** tasks — the part of the pool that teaches
*arrangement* rather than continuation.

Target-family balance, all types and multitrack-only types:

| family | tasks (all types) | tasks (multitrack-only types) |
| --- | ---: | ---: |
| keys | 2,221,121 | 280,354 |
| strings | 334,313 | 166,426 |
| reed | 296,105 | 165,120 |
| pipe | 284,742 | 146,268 |
| brass | 272,806 | 149,624 |
| drums | 256,470 | 164,392 |
| ensemble | 173,803 | 61,798 |
| bass | 131,209 | 77,314 |
| guitar | 107,935 | 58,836 |
| organ | 81,677 | 41,999 |
| chromatic_perc | 67,316 | 39,001 |
| synth | 55,463 | 33,950 |
| ethnic | 8,546 | 5,079 |
| percussive | 4,604 | 2,730 |
| sfx | 426 | 285 |

A task whose target holds several families (`accompaniment`, `orchestration`,
`arrangement_expansion`) is counted once per family, so these columns sum to
4,296,536 and 1,393,176 target-family incidences respectively, not to the task
totals. On that basis keys takes **51.7 %** of all incidences. **Over the
multitrack-only types the balance is far better** — keys **20.1 %** (280k)
against strings 166k, reed 165k, drums 164k, brass 150k, pipe 146k — because
those types put every other family in the target as often as the keys. Bass
(77k) and guitar (59k) remain the thin end, and ethnic/percussive/sfx are
negligible at any cap.

**Well-formedness.** Every 25th multitrack work in the pass had up to two tasks
per type **materialised into tokens and checked** — the target detokenizes to
exactly the notes the task claims, no target cell leaks into the context, no
context note falls outside its regions. **18,954 tasks checked, 0 malformed**,
across all sixteen types.

**Capping.** Uncapped counts describe supply, not a dataset: one 512-bar piano
work contributes hundreds of `phrase_continuation` windows. At 4 per
(work, type) the pool is 2,155,379 — the number a balanced builder would start
from.

---

## 5. Duplicates

Exact duplicate = SHA-256 of the grid note stream (family, step, pitch,
duration) plus the metre, ignoring velocity and tempo. Near-duplicate =
bar-bigram shingles of (family, eighth-note onset, pitch class), MinHash-64,
LSH 16 bands × 4 rows, estimated Jaccard ≥ 0.5, made transitive by union-find.

| | count | share of 222,820 |
| --- | ---: | ---: |
| exact duplicate groups | 31,529 | — |
| works in an exact duplicate group | 75,028 | **33.7 %** |
| duplicate groups (exact ∪ near) | 34,187 | — |
| works in a group | 96,801 | **43.4 %** |
| **distinct works after collapsing** | **160,206** | 71.9 % |
| works too short to index (signature under 4 shingles) | 1,451 | 0.65 % |

Group sizes: 21,207 pairs, 6,812 triples, 2,898 of four, 1,352 of five, 363 of
ten or more; the largest group has 54 members.

**Multitrack works are far cleaner than the corpus as a whole**: of 20,638,
only 1,720 sit in a duplicate group (8.3 %, against 43.4 % overall), touching
672 groups; **19,588 independent multitrack works survive** as group
representatives.

### Validating the threshold

A near-duplicate measure that is not validated is a guess. PDMX's
`best_path` / `best_arrangement` / `best_unique_arrangement` columns look like
version-group keys and are **not usable as ground truth**: each collapses tens
of thousands of unrelated admitted rows onto one pointer (largest admitted
groups 51,549 / 50,346 / 50,137) and only about half of their small groups even
share a song title. An earlier run of this profile used them and measured a
recall of zero — the columns, not the fingerprint, were wrong.

The signal the table does carry is the song's own identity. Ground truth here:

- **declared** — two admitted works whose normalised `(song_name | composer_name)`
  digests are equal, from title groups of size 2–5 (a group of 276 "Ave Maria"
  rows is a title collision, not a duplicate). Same *song*; possibly a
  genuinely different *arrangement*, which this measure is designed to treat as
  different — so this is a **lower bound**.
- **strict** — declared pairs that *also* share a small PDMX version group: the
  closest the metadata gets to "same arrangement".
- **random** — pairs with different titles and different version groups.

| set | pairs | both indexed | ≥ 0.3 | ≥ 0.5 | ≥ 0.7 | ≥ 0.9 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **strict** (same song + same version group) | 5,679 | 5,600 | **87.8 %** | **86.3 %** | 84.4 % | 82.1 % |
| **declared** (same song, any arrangement) | 46,943 | 46,526 | 58.3 % | 54.1 % | 50.0 % | 46.2 % |
| **random** | 60,000 | 60,000 | **0.0 %** | **0.0 %** | 0.0 % | 0.0 % |

Read: at the operating threshold of 0.5 the measure recovers **86 % of pairs
the metadata calls the same arrangement**, **54 % of pairs that merely share a
song** (the rest being real re-arrangements, which it should not group), and
produces **zero false positives in 60,000 random pairs at every threshold from
0.3 to 0.9**. The recall curve is nearly flat from 0.3 to 0.9, so the threshold
is not a knife edge; 0.5 is chosen for the LSH banding (a pair at 0.5 is found
with p ≈ 0.64, at 0.7 with p ≈ 0.99). 4,429 of the 5,600 strict pairs are
byte-identical grids, which is why that curve barely moves.

Two stated limits: **pitch is exact**, so a transposed re-arrangement is not
grouped; and 1,451 works are too short to index and can only group by exact
hash.

### What this means for the split

`hashSplit(workId)` is a 90/5/5 hash of the work id. Applied naively,
**8,275 duplicate groups would have straddled two splits** — the exact leak the
work-level split was supposed to prevent, and PR-53's stated open risk.
`assignSplitsWithGroups` gives every group the split of its lexicographically
smallest member: **0 groups straddle a split afterwards**, at the cost of moving
11,542 works out of their own hash bucket.

| split | works | multitrack works | tasks | tasks at cap 4 |
| --- | ---: | ---: | ---: | ---: |
| train | 200,545 | 18,555 | 2,984,721 | 1,940,197 |
| val | 11,354 | 1,036 | 166,683 | 108,668 |
| test | 10,921 | 1,047 | 162,563 | 106,514 |

The rule is a library function, not a script detail:
`nearDuplicateGroups(fingerprints)` and `assignSplitsWithGroups(ids, groups)`
in `nearDuplicate.ts`, with `fingerprintMidi(parsedMidi, workId)` producing a
fingerprint any dataset builder can compute from a `ParsedMidi`.

---

## 6. What this changes for the foundation decision

PR-53's row in the decision report read *"~20k works, ~150–200k arranger tasks,
keys- and drums-heavy"*. Two of those three are now wrong in the useful
direction:

- **~20k multitrack works** — confirmed exactly: 20,638, of which 19,588 are
  independent after deduplication.
- **~150–200k tasks** — an undercount by roughly a factor of seven. With
  sixteen types the multitrack pool is **1,347,597 tasks** (1,310,148 after
  dedup), of which **1,019,817 come from the nine types that require an
  arrangement to exist**. Even the single type PR-53 measured —
  `masked_track`, the same idea of hiding one family over eight bars — yields
  **474,708** here. The two extractors differ in their window rules
  (`arrangerTaskExtraction.ts` is untouched and its tests still pass), so that
  is a differently-defined count of the same idea rather than a correction of
  PR-53's arithmetic; what it shows is that the supply was read
  conservatively.
- **keys- and drums-heavy** — true of the one original type, much less true
  across the sixteen: on the multitrack-only types keys leads strings, reed,
  drums, brass and pipe by well under a factor of two.

What has **not** changed is the reason A (from scratch) is hard: 19,588
independent multitrack works is a small number of *pieces* however many windows
are cut from them, the ensembles are duos, and 3,197 labelled non-classical
multitrack works cannot teach pop or Mizrahi arrangement. A million tasks from
twenty thousand works is a million views of twenty thousand works.

---

## 7. What is missing, thin, or wrong

1. **The tokenizer grid uses the first metre.** For 103,469 works (46 %) that
   is not the dominant metre, usually because the anacrusis was exported as a
   one-bar metre change; 96,660 works needed metre approximation. Bar indices
   in those works are shifted, and every bar-window task cut from them is cut
   at the wrong place. **This is the highest-value fix in the data factory**
   and it is in `arrangerRemi.ts`, not in PDMX. Nothing in this profile
   corrects for it; the numbers above are what the current tokenizer sees.
2. **No pop, dance or Mizrahi multitrack material.** 3,197 labelled
   non-classical multitrack works, 0 labelled Mizrahi/Israeli, and 74 % of the
   corpus unlabelled. The genre answer to PR-59's open question is that the
   corpus cannot answer it; a second source is required.
3. **Bass 2,745 and guitar 2,294 multitrack works.** A rhythm-section model
   trained here will have seen an order of magnitude less bass and guitar than
   keys. `ethnic` 205, `percussive` 142, `sfx` 23 are not trainable at all.
4. **The phrase proxy measures breathing, not phrasing.** Rest-delimited runs
   give a median of 24 beats for multitrack works — six bars — because
   continuous textures never rest for a quarter note. A real phrase detector
   (cadence + contour + repetition) is future work; the number here should not
   be used as a phrase length.
5. **Chords are named in only a third of bars** at the median. Any chord
   conditioning must treat "no chord" as a first-class value.
6. **Near-duplicates are pitch-exact.** A transposed arrangement of the same
   piece is two works to this measure and to the split. The strict-set recall
   of 86 % is measured against metadata that itself only covers works with a
   title and composer (54 works have neither).
7. **Duplicate groups are transitive.** A~B and B~C put A, B, C in one group,
   which is the right conservative behaviour for a split but inflates the
   largest groups (the 54-member group is a chain, not 54 copies of one score).
8. **Task counts are supply, not a dataset.** No task in this profile was
   written to disk as training data; 18,954 were materialised into tokens for
   the well-formedness check and discarded. Balancing, capping and the actual
   shard writing are the next PR.
9. **`keys + synth` (3,333 works) is the most common "ensemble"** and is
   mostly a notation artefact. A quality filter on what counts as a real second
   instrument would shrink the multitrack count somewhat — this profile applies
   no such filter and says so.
10. **36 admitted rows have no MIDI file**, and 51 admitted files contain no
    notes at all. Both are reported rather than silently dropped.
