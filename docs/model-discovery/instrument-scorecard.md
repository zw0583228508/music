# Instrument scorecard — what each arm is good at, family by family

Wave Q — Model Discovery, Workstream K. PR-61.

Evidence: `docs/evidence/instrument-scorecard.json` (every number below) ·
per-family tables: [`instrument-scorecard.tables.md`](./instrument-scorecard.tables.md)
(machine-written by the same run) · source: `docs/evidence/model-tournament-live.json`
(run `4fac41bee93e`, 180 entries, 12 tasks × 5 arms × 3 seeds, PR-59).

Regenerate:

```
cd artifacts/api-server && node scripts/instrument-scorecard.mjs \
  --in docs/evidence/model-tournament-live.json
```

The tournament reports one scorecard per arm. That average hides the question
the architecture decision actually asks: **is one model good at everything, or
is each arm good somewhere and weak elsewhere?** This is the same 180 entries
cut per instrument family × arm.

Two columns are computed here rather than read from the tournament: the
**idiomatic register share** (share of notes inside the instrument's *standard*
range in `GM_REFERENCE`, from pitches recovered out of the entry MIDIs) and
**playability under the calibrated judge** — the same parts re-judged by the
PR-61 judge, because the tournament's stored `playabilityErrors` came from
judge 1.0, whose false-positive rate on human parts is measured in
[`judge-calibration.md`](./judge-calibration.md).

## The score matrix (proxy score, mean of 6 entries per cell)

| family | GM | HUMAN | REFERENCE | CONTEXT_AWARE | CA2 | CA2+CTX | best machine |
| --- | --- | --- | --- | --- | --- | --- | --- |
| bass | 34, 39 | 88.0 | 45.2 | 45.2 | **79.8** | **79.8** | CA2 (tie) |
| brass | 57, 58 | 65.1 | **66.9** | **66.9** | 51.2 | 53.0 | REFERENCE (tie) |
| keys | 0 | 100.0 | 66.4 | 64.3 | **76.3** | 76.1 | CA2 |
| organ | 19, 23 | 100.0 | 65.6 | 69.2 | 85.1 | **88.9** | CA2+CTX |
| reed | 64, 65 | 94.0 | 66.3 | 76.0 | **87.6** | 87.1 | CA2 |
| strings | 40 | 95.2 | **67.4** | 66.0 | 58.1 | 56.2 | REFERENCE |
| **mean over families** | | **90.4** | 63.0 | 64.6 | 73.0 | **73.5** | |

## Playability: most of the gap in PR-59 was the judge, not the parts

| family | arm | errors/entry, judge 1.0 | errors/entry, calibrated judge |
| --- | --- | --- | --- |
| brass | HUMAN | 2.50 | **0** |
| brass | CA2 | 2.67 | **0** |
| brass | CA2+CTX | 1.00 | **0** |
| reed | HUMAN | 0.50 | **0** |
| reed | CA2 / CA2+CTX | 0.50 | **0** |
| reed | REFERENCE | 0.50 | **0.50** |
| every other family × arm | | 0 | 0 |

Re-judged from the recovered notes, **one** playability error in the whole live
tournament survives calibration, and it belongs to the platform's own
`REFERENCE_PART_COMPOSER`: on the soprano-sax task (GM 64) it writes one of its
four notes below the soprano sax's floor — 0.5 errors per entry and an idiomatic
register share of 0.875, the only sub-0.99 register figure in the run. PR-59's
headline that "CA2 makes three times the reference's playability errors" does
not survive the calibration: those were the brass breath and polyphony rules
that flagged real human trombone and tuba parts at the same rate (2.50 for the
human, 2.67 for CA2).

**What that changes.** Playability is no longer a discriminator between the
arms on this population, so the design question has to be argued on register,
harmony, density and coverage — which is what the rest of this page does.

## What each family says

- **bass** (GM 34, 39) — CA2 79.8 vs the platform composers' 45.2. The
  platform arms play 56 % of bars at 2.6 octaves below the human's onset
  density (log2 −2.63) and only chord tones (chord-tone share 1.00 exactly);
  CA2 covers every bar at the human's density (+0.33) with a human-like
  chord-tone share (0.79 vs 0.82) — but repeats the previous bar verbatim in
  71 % of bars (human: 52 %; this is a bass line, where repetition is the
  idiom) and wins half its cells against the human, which the tournament flags
  as judge-suspect.
- **brass** (GM 57, 58) — the one family where the platform's composers lead
  (66.9 vs 53.0), and they lead by *not writing much*: coverage 0.38, density
  1.9 octaves under the human. CA2 fills every bar but its chord-tone share
  collapses to 0.54 (human 0.81) and it clashes with the context 14 % of
  sounding time. A thin correct part out-scoring a full wrong one is a real
  property of this judge, and worth remembering before reading brass as a
  platform strength.
- **keys** (GM 0) — the human scores a clean 100. CA2 76.3 leads the machines
  on density (−0.38 vs the platform arms' −3.18, i.e. the platform writes
  about a tenth of the human's notes) and on clash (0.02). No arm out-scores
  the human on a single keys cell.
- **organ** (GM 19, 23) — CA2+CTX 88.9, the best machine cell in the run;
  chord-tone share 0.95 against the human's 0.81, clash 0.01, full coverage.
  The +CTX passes add 3.9 points here, the largest +CTX effect in the run.
- **reed** (GM 64, 65) — CA2 87.6, and the platform's REFERENCE arm is the only
  arm in the tournament with a surviving playability error (above).
  CONTEXT_AWARE (76.0) beats REFERENCE (66.3) here purely by staying in range.
- **strings** (GM 40) — the only family where CA2 is beaten by both platform
  arms (58.1 vs 67.4), and where CA2's clash is highest (0.12–0.15 vs the
  human's 0.06). The platform arms again win thin: coverage 0.31, density
  −4.18 (about 1/18 of the human's onsets). Neither behaviour is close to the
  human, which scores 95.2.

## The design question: one model for everything, or a global arranger plus instrument experts?

Priced from the same numbers, as an oracle router that picks the best arm per
family with hindsight:

| | value |
| --- | --- |
| best single machine arm | CA2+CTX, **73.50** (mean over families) |
| per-family oracle | **77.81** |
| **router gain** | **+4.31 points** |
| families where the best arm is not CA2+CTX | brass (REFERENCE, +13.85), strings (REFERENCE, +11.27), keys (CA2, +0.15), reed (CA2, +0.55) |
| playability | no gain: 0 errors/entry for both, under the calibrated judge |

**The reading.** The +4.31 points are not spread over six families — 25.1 of the
25.8 total gain comes from **two** families (brass and strings), and in both of
them the winning arm is the platform's *thin* composer, which wins by writing
2–4 notes where the human writes forty. That is not evidence that an
instrument-expert adapter would help; it is evidence that **this judge rewards
abstention in families where CA2 writes badly**. The keys and reed "gains"
(+0.15, +0.55) are noise on 6 entries.

So the honest form of the answer is:

1. **The per-family differences are real and large** — CA2 spans 51.2 (brass)
   to 87.6 (reed), a 36-point range within one model. One model is *not*
   uniformly good, and a global model with no instrument knowledge would be
   judged on its worst families.
2. **But nothing here measures an adapter.** The oracle router is an upper
   bound obtained by choosing between two behaviours (full-but-wrong,
   thin-but-safe), not by any instrument expertise. It says at most: a design
   that could route away from CA2 on brass and strings would gain up to 4.3
   proxy points on this task set.
3. **The failure modes are family-shaped, which is the argument that survives.**
   CA2's weakness on brass and strings is *harmonic* (chord-tone share 0.54,
   clash 0.12–0.15) and its weakness on bass is *repetition* (0.71). The
   platform composers' weakness is the same everywhere: density 1.7–4.2
   octaves under the human, coverage 0.31–0.63. A global arranger that fixed
   density and an instrument-conditioned head that fixed harmony per family
   would address different halves of this table — which is the first real
   argument for the split design, and it rests on 12 tasks.
4. **Nothing about playability supports the split** — after calibration the
   arms are indistinguishable there (0 errors/entry everywhere but one cell).

## Honest limits

- **6 families, 2 tasks each, 3 seeds: 6 entries per cell.** Differences under
  ~5 points are inside task-to-task spread. Every "gain" of 0.15–0.55 above is
  noise and is labelled as such.
- **All twelve tasks are classical/early-music scores** (what PDMX's cleared
  multitrack share is). Nothing here speaks to pop, dance or Mizrahi material,
  and drums, guitar, pipe and synth families are absent from the run entirely.
- **The proxy judge decides these numbers and the blind pairs are unrated.** A
  family the judge misreads misreads every arm alike, so the ranking *within*
  a family is steadier than the level.
- **The re-judged playability column** comes from notes recovered out of the
  entry MIDIs by GM program and note count; 18 of 180 entries fell back to the
  last track carrying the program (`midiRecovery.ambiguous`), and the seconds
  come from each MIDI's own first tempo. It is a re-judgement of what was
  written, not a re-run of the tournament.
- **The oracle router has hindsight on the same tasks it is scored on.** It is
  an upper bound, not a routing policy, and no adapter exists to compare it to.
