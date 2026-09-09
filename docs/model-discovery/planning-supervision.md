# Planning supervision — the section-level plan a human actually built (Wave Q, PR-78, 2026-09-09)

**Status: measured on the whole admitted corpus.** Every number below comes
from one run of `scripts/extract-planning-supervision.mjs` over every admitted
PDMX file (our licence gate ∩ the authors' `no_license_conflict` subset, read
in place). Evidence: `docs/evidence/planning-supervision.json`. Code:
`artifacts/api-server/src/lib/planningSupervision.ts` (the extractor and the
quality gate, 11 tests) and `planningSupervisionAgreement.ts` (a Song Model
built from a score, the platform's own planners run on it, 4 tests).
Per-work plans: `.corpus-data/planning-supervision/plans.ndjson` (git-ignored).

The decision pack's corrected thesis (§10b) is that the **planner is not the
note generator**: a whole-song planner emits per-section intent and the note
generator writes under it. PR-65 counted 39,136 `whole_form` tasks from
14,986 works and the owner's instruction is that those are raw material for
*planning supervision extracted with quality filters* — not a training set as
it stands. This PR extracts that supervision, measures how much of the raw
material survives each filter and why the rest fails, describes what the
surviving plans look like, checks the platform's own planners against the
human plans, and puts twenty rendered plans in front of a reader so the label
quality can be judged rather than assumed.

---

## 1. What a plan is here

One admitted multitrack score → the **section-level plan as the human built
it**. Sections come from `formSegmentation.ts` (PR-67: Foote novelty over bar
self-similarity, labels A / A' / B by aligned-diagonal similarity, intro/outro
by thinness). For every section the extractor records, and says how:

| field | derivation |
| --- | --- |
| instrument families active | ARRANGER_REMI family per (track, channel); a family counts with ≥ 8 notes in ≥ 2 bars; *active* in a section when it sounds (onset or ≥ 2 % sustain) in ≥ 25 % of its bars — `formSegmentation`'s own rule |
| entries / exits | a family active here and not in the previous section (or never before) *enters* at its first sounding bar; one active here and not in the next section *exits* at the bar after its last sounding bar |
| density | onsets per bar; `densityRel` ÷ the piece's densest section; per family ÷ that family's busiest section and ÷ the busiest (section, family) cell |
| register | pitched notes only: min, max, mean per family and per section; `registerDistribution` = share of pitched onsets in the platform's five bands (boundaries C3 / C4 / C5 / C6) |
| energy | `cbrt(densityRel × velocityRel × registerWidthRel)`, every factor relative to the piece's own maximum, width floored at an octave — a stated proxy, not loudness |
| harmonic rhythm | `chordsFromNotes` per bar (in bar units); chord changes per bar over the named bars; share of bars named at all |
| tension | 0.6 × non-chord-tone share (duration weight outside the named chord's template) + 0.4 × interval-class dissonance (ic1 = 1, ic6 = 0.8, ic2 = 0.5) |
| key | Krumhansl–Kessler over the section's pitched notes (`keyFromNotes`), null when it refuses |
| motif recurrence | share of the section's four-note skyline cells already heard in an earlier section (`formSegmentation.motifs.quotedShare`) |
| novelty vs previous | 1 − aligned-diagonal similarity to the previous section (`segmentSimilarity`) |
| repeat structure | the form string and, per section, which earlier section it repeats or varies and the k-th time its letter is heard |
| transitions | at each boundary: families in / out, Δ density, Δ register centre, Δ energy, a *gap* flag (last bar before the boundary holds < 25 % of the section's mean onsets), and a kind — `break` on a gap, `build` / `drop` at \|Δenergy\| > 0.15, else `continue` |
| function name | a **naming heuristic** onto `SectionPlan.function` (§3), not a detected function |

The neutral schema (`HumanSectionPlan`, 0-based end-exclusive bars as in
`formSegmentation`) carries all of it; two platform-shaped blocks —
`sectionPlans: SectionPlan[]` and `globalTargets.sectionTargets` — carry the
subset the platform's vocabulary can hold, in 1-based inclusive bars and with
family names mapped onto the planners' own (`PLATFORM_FAMILY`: reed and pipe →
winds, organ → keys, chromatic_perc and percussive → percussion, ensemble →
pads, ethnic → guitar, sfx → fx). `renderPlanText` writes the plan the way a
musician would read it. Every plan carries a `derivation` map repeating these
rules in words.

## 2. What a plan captures, and what it cannot

**Captures**, from the notes alone: who plays when (families, entries, exits),
how much (density, per family and total, relative to the piece), where in the
register, how the harmony moves and how tense it is, what returns (letters,
motif cells), how each boundary is crossed, and the whole-piece arc (density
shape, ensemble shape, where the climax sits, whether the last section is the
fullest).

**Cannot capture**, and no filter will conjure it:

- **No producer intent.** A quiet section is quiet; whether it is a
  *breakdown before the drop* or *the composer ran out of ideas* is not in the
  score. The names in §3 are ours.
- **No lyrics, no vocal line.** PDMX is instrumental notation; the platform's
  `vocalAttentionMap` and `arrangementSpace` have no counterpart here, so a
  plan never says "leave room for the voice".
- **No "why".** Entries and exits are events, not decisions: "brass enters
  bar 17" is recorded, "because the melody moved to the trumpet" is not.
- **No sound.** Velocity is a notation export, not a performance; there is no
  mix, no production aesthetic, no groove beyond what the onset grid shows
  (`SectionPlan.groove` is filled with `"unknown"` on purpose).
- **No labelled ground truth for the sections.** The segmentation is
  unsupervised (PR-67). The stability filter measures agreement between two of
  our own feature settings, not agreement with a musician.

## 3. How it maps onto the platform's plan types

| platform field | source in the human plan | fidelity |
| --- | --- | --- |
| `SectionPlan.sectionName` / `GlobalArrangementPlan.sectionTargets[].sectionName` | `"<Function> <index>"` from the naming heuristic | names are ours |
| `function` / `role` | heuristic: intro/outro when `segmentForm`'s opening/closing kind is also thinner than the piece's median section; with ≥ 2 repeated letters the highest-energy one is the **chorus**, the other repeated letters **verses**; a single repeated letter is a **verse** (A A B A = verse–verse–bridge–verse); a unique letter standing alone between repeats is a **bridge**; else **neutral**; `prechorus`, `breakdown`, `instrumental` are never emitted | a vocabulary fit, not a detection |
| `startBar`, `endBar` | 0-based exclusive → 1-based inclusive | exact |
| `energy`, `density`, `tension` | the proxies of §1 | stated proxies |
| `activeInstrumentFamilies`, `inactiveInstrumentFamilies` | active families, mapped | exact within the family map |
| `leadRole` | `instrument:<melody family>` — highest median pitch among pitched families sounding in ≥ half the bars (`arrangerTaskTypes`' rule) — when that family is active here, else `none` | a proxy |
| `registerDistribution` | share of pitched onsets per band | exact |
| `rhythmicActivity` | mean over active families of their density relative to their own busiest section | proxy |
| `melodicActivity` | skyline notes per bar ÷ piece max | proxy |
| `harmonicActivity` | chord changes per bar, clamped | proxy |
| `transitionIn` / `transitionOut` | the transition kind at the boundary | vocabulary fit |
| `noveltyRelativeToPreviousSection` / `noveltyVsPrevious` | 1 − aligned similarity | a different definition from the planner's (\|Δenergy\| × 0.6 + 0.4 × role change) |
| `GlobalArrangementPlan.climax` | the highest-energy section, at its first bar | proxy |
| `orchestrationStrategy` | `globalArrangementPlanner.pickOrchestration`'s rule restated over the human energies | same rule, human input |
| `groove`, `supportingRoles`, `grooveStrategy`, `motifStrategy`, `contrastStrategy`, `productionAesthetic`, `instrumentPalette` priorities | not derived | empty / `"unknown"` |
| `TransitionPlan.kind` | the human transition kind | vocabulary fit; `devices`, `harmonicApproach`, `vocalSafe` not derived |
| `OrchestrationBudgetWindow` | per-section total density and register distribution are the budget's `totalDensity` / `register` inputs; `vocalAttention` has no source | partial |

## 4. Planner V1 — the task spec

**Input** (song-level facts + the plans of the sections written so far):

- song facts: bar count, metre, key, the families in the piece (mapped),
  genre when labelled, the form's letter sequence *up to the current section*
  (the planner may know "this is the second A"), the energy-arc shape is **not**
  given (that is what it must learn to produce);
- for every earlier section: its full `HumanSectionPlan` target vector (§1) —
  function, families active, entries/exits, density, register distribution,
  energy, tension, harmonic rhythm, novelty, motif share;
- position: section index and the total number of sections (the total is a
  song-level fact a producer knows; V1 does not plan the count).

**Target**: the next section's plan — `function` (9-way), active families
(multi-label over the mapped families present in the piece), entries and exits
(per family: enter / stay / leave / stay out), `densityRel`, `energy`,
`tension`, `registerDistribution` (5 shares), `harmonicActivity`,
`noveltyVsPrevious`, `motifQuotedShare`, `transitionIn` kind (4-way), and the
section length in bars (binned 4 / 8 / 12 / 16 / other).

**Loss**: cross-entropy for `function`, transition kind and length bin; binary
cross-entropy per family for the active set and per family for the four-way
entry/stay/leave/out state; L1 on the bounded continuous targets (density,
energy, tension, novelty, motif share, harmonic activity); a Dirichlet-style
KL or simple L1 on the register shares. Weighted so that the continuous block
and the categorical block contribute comparably at initialisation; a work's
sections are one sequence, teacher-forced.

**Metrics** (val and test, work-level split with duplicate groups on one
side, `assignSplitsWithGroups`):

- family-set Jaccard and exact-set accuracy against the human's next section;
  entry/exit F1 (a planner that keeps everyone in forever scores 0 on entries);
- density / energy / tension MAE and Pearson r across sections;
- function accuracy and, more honestly, *repeat-structure* accuracy: did the
  planner predict "a return of A" when the human returned to A;
- arc metrics over whole works, rolled out section by section: climax
  position error, share of works whose predicted arc shape matches the human
  shape, the `coherenceMetric` trajectory component on the predicted density
  curve against the human curve;
- the baselines it must beat: "copy the previous section", "the corpus mean
  per function", and the platform's rule-based `deriveSectionPhrasePlan` (§6
  measures where that rule stands today).

**How a plan drives the note generator.** `PartGenerationRequestV2` already
carries every slot: `section: SectionPlan` (the predicted target in the
platform vocabulary), `globalPlan.sectionTargets` (the whole predicted arc,
which `summarisePreviousSection` and `deriveNextSectionIntent` read to say
*build / sustain / clear_out*), `transitions: TransitionPlan[]` (the predicted
kind), `siblingParts` (what has been written), `motifMemory` (the cells the
predicted `motifQuotedShare` says to bring back), `softConstraints` of kind
`density` / `register` / `texture` carrying the predicted `densityRel` and
`registerDistribution`, and `hardConstraints` for a family the plan holds
*out* (an absent family is a part written silent — the V2 contract's own
reading). The generator (CA2 today) receives the section's density and
register as its controls (long-form study §4, route 1) and the plan prefix
tokens in the vocabulary-extended fine-tune (route 2); the planner never
writes a note, and the critic never becomes the target.

---

## 5. Measured — the filters, the survivors, and why the rest fail

**The run.** Every admitted file: **222,820 of 222,820, 0 parse failures**, in
**221 s** over 10 worker threads (1,007 files/s, 2,127 worker-CPU-seconds;
262 s wall including deduplication, aggregation and the planner comparison).
202,131 are solo (one family), 51 hold no notes, and **20,638 are multitrack** —
exactly PR-65's count, reached by a different code path. Planning 20,638 scores
cost 999 CPU-seconds, **48.4 ms per work**. No sampling was needed and none was
used; the `--sample` path exists and reports itself in the evidence.

**The funnel**, in the order the filters are applied:

| filter | in | removed | out |
| --- | ---: | ---: | ---: |
| ≥ 24 bars | 20,638 | 5,428 | 15,210 |
| ≥ 3 instrument families | 15,210 | 7,948 | 7,262 |
| one dominant metre (≥ 90 % of ticks) | 7,262 | 1,140 | 6,122 |
| ≥ 3 stable sections (F1 ≥ 0.67 under two settings) | 6,122 | 1,294 | 4,828 |
| non-degenerate arc | 4,828 | 154 | 4,674 |
| no near-duplicate leak | 4,674 | 75 | **4,599** |

**4,599 works — 22.3 % of the multitrack corpus — become planning
supervision.** Counted independently rather than in sequence, each filter
rejects: families 12,557, stable sections 8,750, non-degenerate arc 5,491,
bars 5,428, metre 2,942, duplicates 75. The largest single failure combination
is "families alone" (3,999 works), then "bars + families + sections + arc"
together (3,009 works — short two-family fragments that fail everything).

**Why the rest fail, measured:**

- **Fewer than three families (12,557).** 12,477 of them have exactly two;
  72 have one and 8 none once fragments (< 8 notes or < 2 bars) are discarded.
  This is the corpus, not the filter: PR-65 already reported that `keys +
  synth` duos are the most common "ensemble" and are largely a notation
  artefact. A two-family duo has no orchestration decisions to supervise.
- **Under 24 bars (5,428).** Median 16 bars, p90 20 — hymn verses, exercises,
  lead sheets. Too short to hold three sections that differ.
- **No dominant metre (2,942).** Median dominant-metre coverage 0.67. These
  are genuine multi-metre scores, and pickup-bar exports whose bar grid the
  form is cut on still shifts; a plan whose bar numbers mean different lengths
  in different places is not supervision.
- **Unstable sections (8,750 marginal).** 4,894 find fewer than three sections
  under the default setting, 1,297 more lose them under the wider kernel, and
  **2,559 find enough sections both ways but disagree about where they are**
  (their F1 median 0.57, capped at 0.67). Over the 14,447 works eligible for
  the test the F1 median is **0.86**, and among admitted works **0.89** — the
  segmentation is mostly stable, and this filter removes the tail where it is
  not.
- **Degenerate arc (5,491 marginal).** Density spread median 0.04 over a
  median of 2 sections: pieces where nothing changes between sections. Of the
  works that pass, 8,491 pass on both criteria, 6,436 on the density spread
  alone and 220 on a family change alone — the family-change escape hatch is
  small, so this is mostly a density test.
- **Near-duplicates (75).** Fingerprinting the 20,638 multitrack works gives
  680 groups over 1,735 works (520 of them exact-hash groups); only 63 groups
  hold two or more works that pass every other filter, so 75 works are dropped
  as duplicates of an admitted representative. Multitrack PDMX is clean, as
  PR-65 found. The admitted set splits **4,095 / 253 / 251** under
  `assignSplitsWithGroups`, with **0 duplicate groups straddling a split**.

**Against the 39,136 whole-form tasks.** The population PR-65 named —
multitrack works yielding at least one `whole_form` task — now measures
**15,576 works / 40,848 tasks** on the post-PR-75 dominant-metre grid (PR-65
counted 14,986 / 39,136 on the old grid; the grid change moves works in and
out of the 16–128-bar window). Of those 15,576, **3,628 (23.3 %) are admitted
as planning supervision**; the rest fail families (9,458), stable sections
(6,433), arc (3,759), bars (3,343), metre (1,835), duplicates (51). A further
**971 admitted works lie outside that population**, mostly by being longer
than 128 bars. The honest translation of the owner's instruction: **39,136 raw
whole-form tasks correspond to roughly 3,600 works whose plan is worth
learning from — under a tenth of the raw task count, and about a quarter of
the works.**

## 6. Measured — what the surviving plans look like

Over the 4,599 admitted works, their **52,073 sections** and **47,474
boundaries**:

- **Size.** Median **9 sections** per work (mean 11.3, p10 4, p90 21, cap 48),
  median section length **7 bars** (p25 5, p75 10) — shorter and more numerous
  than PR-67's four-sections-per-work median, because these works are longer
  and richer than the corpus average. Median **4 families** per work (p90 7),
  median **3 active families** per section.
- **Form.** Through-composed strings dominate: `A B C D E F G H I J` (the
  ten-letter display cap) 7.2 %, `A B C D` 6.1 %, `A B C D E` 4.4 %, `A B C`
  3.5 %. Verbatim repeats are the minority — `A B B C` 0.5 %, `A B C B` 0.4 %.
  This is PR-67's known bias showing again: where a musician hears A A', the
  label rule sees contrast.
- **Naming.** 48.7 % of works open with an intro-like section, 28.2 % close
  with an outro-like one. Of all sections: **neutral 39.5 %, verse 37.9 %,
  chorus 12.4 %, bridge 4.6 %, intro 3.7 %, outro 1.9 %**. Half the works
  (50.1 %) get a "chorus" and a third (34.1 %) a "bridge" — a statement about
  the repeat structure, not about pop form.
- **Entries and exits — the orchestration question.** **82.0 % of works bring
  in at least one family after the opening section** (median 3 entries after
  the opening, median 2 exits; at the median work, half of all boundaries
  change the family set). By pattern: **entries and exits 53.4 %**, all-in
  then thinning 20.6 %, **all-in and static 15.6 %**, layered entries with no
  exits 10.3 %; **36.3 % are all-in from the first section.** This is a
  sharply different picture from PR-67's, which found the ensemble changing at
  only 25.5 % of boundaries and read the corpus as "mostly all in from bar
  one" — because that measure counted (file track, channel) pairs over every
  work, and this one counts *instrument families* over works that passed a
  three-family, three-section filter. The families that most often enter are
  pipe (3,237 sections), brass (3,073) and reed (2,770); bass enters in only
  1,215 and leaves in 942 — the rhythm section, where there is one, is present
  from the start.
- **The arc.** Density arc **arch 63.5 %**, rise 24.0 %, fall 8.9 %, flat
  0.7 %; ensemble arc rise 38.3 %, arch 30.2 %. The climax sits at median
  position **0.64** of the form and is spread almost evenly across the
  quarters (third quarter 22.0 %, final section 20.6 %, last quarter 20.6 %,
  second quarter 19.6 %, first quarter 17.2 %). Asked directly: **the last
  section is the densest in 17.3 % of works, has the widest register in
  34.1 %, and carries the highest energy in 20.6 %.** A generator that always
  builds to the biggest final section would be wrong about four works in five.
- **Boundaries.** `continue` 65.6 %, `build` 16.8 %, `drop` 13.5 %, `break`
  4.2 %. Two-thirds of section changes in this corpus are not dramatic.
- **Per section.** Density 0.66 of the piece's peak (median), energy 0.78,
  tension 0.12, novelty vs previous 0.37, motif quoted share **0.22** (mean
  0.38, p90 1.0 — restatement is bimodal: a section quotes either almost
  nothing or almost everything), chords named in 50 % of bars, 0.67 chord
  changes per named bar.
- **Per genre** (admitted works, labelled slices): rock 305 of 609 multitrack
  works admitted (50.1 %), electronic 74/146 (50.7 %), jazz 132/265 (49.8 %),
  pop 208/453 (45.9 %), film/game 570/1,261 (45.2 %), hip-hop 56/104 (53.9 %),
  **classical 860/9,300 (9.3 %)** — classical dominates the corpus but is
  mostly two-family piano reductions, so the admitted set is far less
  classical than PDMX is. The one genre whose arc differs: **hip-hop rises
  (42.9 %) more often than it arches (33.9 %) and ends on its densest section
  30.4 % of the time**, against 17.3 % overall. Every non-classical slice is
  small (n = 44–570), so these are indications, not findings.

## 7. Measured — the platform's planners on the same human scores

For the first 300 admitted works in deterministic order, a Canonical Song
Model V2 was built from the score (`songModelFromScore`: the skyline melody,
the lowest family as bass evidence, `chordsFromNotes` chords, a per-bar energy
curve, one stem per family, the extractor's own sections) and
`deriveGlobalArrangementPlan` → `deriveSectionPhrasePlan` →
`deriveTransitionPlan` were run on it. 300 comparisons, **0 errors, 9.3 s**.

| quantity | agreement | reading |
| --- | --- | --- |
| **energy** | MAD median 0.14, mean r **0.935** | the model's energy curve *is* the extractor's proxy — this measures the plumbing, not the planner |
| **density** | MAD median 0.19, mean r **0.737** | the planner's density (melody + bass onsets) tracks the human's all-family density well but is systematically different |
| **novelty** | MAD median 0.20, mean r **0.254** | two different definitions; the planner's energy-delta novelty barely predicts self-similarity novelty |
| **active families** | mean Jaccard **0.41**, exact set match **4.9 %** of sections, planner covers every human family in **19.0 %** | the substantive disagreement |
| **families per section** | human **3.34**, planner **4.33** | the planner writes a bigger band than the human did |
| **climax section** | agrees in **42.3 %** of works | |
| **orchestration strategy** | agrees in **90 %** | inflated: `wave_dynamics → wave_dynamics` alone is 217 of 300 |
| **transition kind** | agreement median **0.60** | |

**The finding.** In **264 of 300 works the platform's planner puts a family
into a section that the human never used anywhere in the piece** — bass in
2,009 sections, keys 1,221, drums 1,190, percussion 570, pads 532, strings
141. That is `buildPalette`'s deliberate rule (it seeds drums + bass + keys for
any medium or dense stem set, because a vocal-plus-piano import is exactly the
case where the studio must supply a band) meeting a corpus of complete scores
that already say what they contain. Both behaviours are right in their own
context, and the consequence is precise: **the rule-based planner is a
reasonable arranger of an under-specified import and a poor imitator of a
finished human arrangement.** A learned planner trained on §5's supervision
would be judged exactly here — family-set Jaccard against 0.41, exact-set
against 4.9 %, entries and exits against a rule that produces almost none.

## 8. The label-quality sample — twenty plans to read

`docs/evidence/planning-supervision.json` → `examplePlans` carries twenty
fully rendered plans (also written to
`.corpus-data/planning-supervision/example-plans.txt`), chosen
deterministically: up to eight of the first admitted works carrying a labelled
non-classical genre, then the first admitted works in SHA-256 order, twenty in
all. They span 30–135 bars, 3–9 families, 4–20 sections, 15 train / 2 val /
3 test, and cover rock, pop, folk, reggae/ska, film/game, wind band and
classical alongside unlabelled works. One in full:

```
Work QmRn4HESqYYP2gTr3atFwr6rSzP2CjiLxTe3phJAavFhEj (folk) — 41 bars, 4/4,
A minor; families: keys, guitar, pipe; form A B B C D D; intro-like opening;
density arc arch, ensemble rise, climax in section 3 of 6
1. Intro [bars 1–4] (A): keys
   density 0.22 of peak (6.0 notes/bar), energy 0.45, tension 0.05,
   register 60–77 (centre 67), G major, chords 0.00 changes/bar over 25 % named bars (Fmaj7)
   opens the piece
2. Verse [bars 5–12] (B): keys + guitar + pipe; guitar enters bar 5, pipe enters bar 9
   density 0.57 of peak (15.9 notes/bar), energy 0.80, tension 0.14,
   register 48–84 (centre 62.9), A minor, chords 1.00 changes/bar over 63 % named bars
   novelty 0.37 vs previous, quotes 14 % of its motif cells from earlier;
   transition in: build (energy +0.35, density +0.36, +guitar/pipe)
3. Verse [bars 13–20] (B, 2nd time): keys + guitar + pipe
   density 1.00 of peak (27.6 notes/bar), energy 0.96, tension 0.19,
   register 48–83 (centre 68.3), C major, chords 0.67 changes/bar over 50 % named bars
   novelty 0.05 vs previous, quotes 20 % of its motif cells from earlier;
   transition in: build (energy +0.15, density +0.42)
…
```

**What reading twenty of them shows.** The good: entries and exits are legible
and musically true ("Intro: keys alone; Verse: guitar enters bar 5, pipe
enters bar 9"); density, register and repeat structure line up with what the
bars contain; the motif-quote share tracks restatement (the second `D` quotes
63 %, the first `B` quotes 14 %). The defects, visible in the same twenty and
each a known limit rather than a surprise:

1. **Through-composed labelling.** A piece a musician would call A A' B A'
   often comes out `A B C D`, and then every section is named "Section n"
   (neutral) because no letter repeats. Roughly 40 % of all sections are
   neutral for this reason.
2. **Over-segmentation of long pieces.** Median 9 sections; some works reach
   the 48-section cap. Where a section is 5 bars long the "plan" is closer to
   a phrase plan.
3. **The transition kind can contradict its own numbers.** A boundary with
   density +0.40 but energy +0.10 is labelled `continue`, because the kind is
   thresholded on energy alone. The numbers beside it are right; the word is
   coarse.
4. **Per-section keys are unstable.** The key differs between sections in
   89.8 % of works — Krumhansl–Kessler over 5–10 bars is not a modulation
   detector, and these per-section keys should be treated as a weak feature.
5. **Chord coverage is half.** Chords are named in a median 50 % of bars, so
   harmonic rhythm and the non-chord-tone half of tension rest on half the
   piece; "no chord" must stay a first-class value, as PR-65 said.
6. **Families are GM families.** A `keys + synth` score is two families to
   this extractor and one instrument to a musician; the ≥ 3-family filter
   removes the worst of it, not all of it.

## 9. Verdict and what is honestly incomplete

**Verdict.** The supervision exists and is far smaller than the raw count
suggested: **4,599 works, 52,073 sections, 47,474 boundaries**, of which 3,628
works overlap the 39,136-task whole-form population. That is enough to train
and evaluate a Planner V1 of the size §4 describes, and not enough to learn
pop or Mizrahi arrangement — 208 pop and 56 hip-hop works carrying a genre
label cannot teach either.

**Incomplete, and stated:**

- **No human has validated a single section boundary or label.** The stability
  filter measures agreement between two of our own settings. A small
  human-labelled set (even 50 works) would turn §6 from "what our segmentation
  says humans do" into "what humans do".
- **No planner has been trained.** §4 is a task spec, not a result; no
  baseline numbers exist for "copy the previous section" or the corpus mean,
  and the metric suite is described, not implemented.
- **The function names are not detections**, and `prechorus`, `breakdown` and
  `instrumental` are never emitted at all.
- **Energy and tension are proxies**, stated in the code and in every plan's
  `derivation`; neither has been checked against a listener.
- **The agreement run is 300 works, not 4,599**, and its energy and role
  columns agree by construction — only density, families, novelty, climax and
  transitions are real comparisons.
- **Nothing was written as a training dataset.** No shards, no tokenised plan
  prefixes; no model has consumed one of these plans. The dataset builder and
  the baselines are the next PR.
- **`OrchestrationBudgetWindow` and `TransitionPlan` are only partly
  reachable** from a score: no vocal attention, no devices, no harmonic
  approach, no groove.
