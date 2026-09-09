# Harmony engine — chords, inversions and a key that is allowed to be contested (PR-85, ANALYSIS ENGINE wave, stream E)

**Status: built, measured on two disjoint synthetic splits and on the owner's real upload; not wired into `sourceAnalyzer.ts`; the chord model it measures is RESEARCH_ONLY.**

The question this stream was given: can the platform tell `C` from `Am/C` from `C6` from `F/C`, and can it carry a key that two analyses disagree about instead of dying for want of one? The answer, in one line: **the engine can make those distinctions when the evidence is clean, the key contract works, and on real chord recognition the ensemble does not beat the best single chord model on the root — it ties it, adds a little on the full symbol, and is the only arm that says anything about inversions, which it gets mostly wrong because its bass witness is a low-passed mix, not a bass stem.**

Everything below is measured. Section 7 separates what the measurements establish from what they do not.

---

## 1. What was built

| Piece | Where | What it does |
| --- | --- | --- |
| `harmonyEngine.ts` | `artifacts/api-server/src/lib/` | Per-segment fusion of five kinds of evidence — chord-model opinions (weighted by `providerReliability.ts`), a bass track, melody notes, chroma, and the local key — into a chord with root, quality, bass, inversion, roman numeral, confidence, margin and its alternates; `keyReconciliation()` returning **`agreed` / `contested` (both candidates, relation, discriminating pitch classes) / `unknown`**; a tonal-centre timeline with tonicization vs modulation; a stated smoothing rule. |
| `harmonyGold.ts` | same | `SYNTHETIC_EXACT/1.0`: an exact chord, inversion and key reference read from a MIDI file's own sounding notes and key-signature events. A span is admitted only when its pitch-class set is exactly one chord template's tone set; everything else is excluded, not guessed. |
| `harmonyMetrics.ts` | same | Time-weighted MIREX-style scores: root, maj/min, full symbol, **inversion-bass on its own**, boundary F1, key strict and the MIREX related-key credit **reported apart**. Abstentions are never scored correct and never dropped: every accuracy is given `onCovered` and `onReference`. |
| `services/harmony-acr-worker` | Modal | BTC (ISMIR 2019) major/minor and 170-class large vocabulary, librosa CQT chroma + Krumhansl key, pYIN over a low-passed copy of the mix as a bass tracker, librosa beats. **RESEARCH_ONLY**: MIT code, weights with no separate terms, but trained on unlicensed commercial audio. Chordino/autochord (GPL via the Vamp plugin), madmom and Sheet Sage (NC weights) and Essentia (AGPL) were audited and not deployed — reasons in `modal_app.py`. |
| `scripts/harmony-tournament.mjs` | `artifacts/api-server/scripts/` | Draws PDMX works (rights-admitted by both our gate and the authors' subset) with an exact reference, renders them with `referenceRenderWorker`, runs the worker, scores seven arms. `--split dev` draws a disjoint second set by the same rule. |
| `scripts/harmony-real-upload.mjs` | same | The engine on one real upload's worker evidence plus the platform's own key observations. |

## 2. The corpus, and why the numbers are optimistic

- 254,077 PDMX rows → 222,856 admitted by our rights gate → 39,975 also in the authors' `no_license_conflict` subset with ≥ 2 tracks → 772 scanned → **48 carry an exact reference** (≥ 12 exact chords, ≥ 45 % of analysed time exact, 40–300 s) → **12 test works** and **12 disjoint dev works**, spread over genres.
- Only works whose harmony is stated in sustained block chords survive the exactness rule. Arpeggiated, contrapuntal and ornamented writing — harder for every system — is excluded. **Absolute numbers are optimistic; comparisons between arms are not.**
- The audio is `REFERENCE_SYNTH_V1`: band-limited oscillators, no room, no mastering, no singer, no drums bleeding into the low mids. Every arm scores better here than on a record.
- The reference clips to 90 s per work; 12 clips ≈ 896 s of scored reference on test, 548 s on dev.

## 3. Test split — scored once, with the engine's defaults

Time-weighted, on the whole reference (`onReference`). "with bass" is the inversion-bass score: of the reference time whose bass is **not** the root (230 s of 896 on test), the share where the bass was named right. `false inv.` is estimated-inversion time where the reference had none.

| arm | coverage | root | root + maj/min | full symbol | with bass | false inv. (s) | boundary F1 | key strict / MIREX |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| BTC major/minor, raw | 1.000 | **0.786** | **0.775** | 0.472 | 0 | 0 | **0.492** | — |
| BTC large-vocabulary, raw | 0.998 | 0.774 | 0.770 | 0.483 | 0 | 0 | 0.472 | — |
| engine: chroma only | 0.791 | 0.630 | 0.630 | 0.209 | 0 | 0 | 0.429 | 0.667 / 0.742 |
| engine: chroma + bass track | 0.859 | 0.614 | 0.610 | 0.276 | 0.033 | 6.4 | 0.424 | 0.667 / 0.742 |
| engine over BTC major/minor | 1.000 | 0.787 | 0.777 | 0.472 | 0 | 0 | 0.494 | 0.667 / 0.742 |
| engine over BTC large-voca | 0.998 | 0.775 | 0.771 | 0.474 | 0 | 0 | 0.492 | 0.667 / 0.742 |
| **ENSEMBLE** (all of it) | 0.998 | 0.773 | 0.770 | **0.489** | **0.046** | 11.7 | 0.481 | 0.667 / 0.742 |

Ensemble against the best single arm (BTC major/minor): root **−0.014**, maj/min −0.006, full symbol **+0.017**, inversions +0.046 (from zero), boundary F1 −0.012.

**The engine does not beat the chord model on the root.** Where the previous session left it (`ranAt` 2026-09-09T20:04Z, same provider evidence): root 0.611 at coverage 0.797. Two changes, both decided on the dev split, took it to 0.773 at 0.998: the root and the rest of the symbol are now decided in two stages under two weightings (the chord models carry 0.85 of the root decision; chroma, bass and melody keep their balanced weights for quality and bass), and a short segment that keeps its neighbour's root is joined as a flicker rather than protected as a chord change.

**The C / Am/C / C6 / F/C cases.** With clean evidence — one bar of chroma, a C in the bass, a duration-weighted melody — the engine names `C`, `Am/C` (inversion 1), `C6` (with `Am7/C` recorded as the identical-set alternate) and `F/C` (inversion 2), and with no bass evidence it says `bassUnknown` rather than assuming root position (`harmonyEngine.test.ts`). On the corpus, those distinctions are exactly where the arms differ: the raw chord models never claim an inversion (0 on 230 s of inverted reference), the ensemble claims the right one on 4.6 % of that time and the wrong one on 11.7 s of root-position time. Section 5 says why.

## 4. Dev split — where every constant was chosen

Twelve works disjoint from the test split, drawn by the same rule after it (`heldOutTestIds` in the evidence). Provider evidence recorded live (`.tmp-harmony/dev/providers.json`, 2026-09-10); scoring re-run offline.

**Root-weight sweep** (`rootProviderWeight`, the share of the root decision given to the chord models; the balanced fusion the engine started with is 0.5):

| weight | coverage | root | full symbol | with bass | false inv. (s) | refused (s) |
| --- | --- | --- | --- | --- | --- | --- |
| 0.50 | 0.988 | 0.8229 | 0.578 | 0.116 | 11.4 | 13.7 |
| 0.65 | 0.994 | 0.8253 | 0.578 | 0.120 | 11.4 | 12.0 |
| 0.75 | 0.997 | 0.8268 | 0.578 | 0.119 | 12.3 | 7.6 |
| **0.85** | 0.998 | 0.8270 | 0.578 | 0.119 | 12.5 | 6.0 |
| 0.95 | 0.998 | 0.8270 | 0.578 | 0.119 | 12.5 | 5.7 |
| 1.00 | 0.998 | 0.8272 | 0.578 | 0.119 | 12.5 | 7.8 |

Best single arm on dev: BTC large-vocabulary raw, root **0.8279**. Rule, stated before the sweep: primary metric root-on-reference, pick the smallest weight within 0.001 of the best. Chosen **0.85**. At no weight does the ensemble beat the model; the weight buys coverage (refused time 13.7 s → 6 s), not a better root.

**Same-root flicker join** (at 0.85): ENSEMBLE boundary F1 0.298 → **0.446** (precision 0.18 → 0.32, recall 0.83 → 0.77), full symbol 0.578 → **0.587**, false inversions 12.5 s → 10.7 s, root unchanged at 0.827. The raw arms are untouched by construction. After it, dev ENSEMBLE vs BTC large-voca raw: root −0.001, full symbol +0.019, with bass 0.115 vs 0, boundary F1 0.446 vs 0.448.

## 5. Two diagnostics that say why

**Provider agreement.** Over the reference time, the two BTC vocabularies name the same root 93.4 % of the time on dev (92.5 % on test). There, both are right 85.4 % (81.3 %) and the ensemble 85.3 % (81.2 %) — it neither adds nor subtracts. On the split time — 6.6 % (7.5 %) — the large vocabulary is right 47.5 % on dev and 32.4 % on test, the major/minor model 31.6 % and 49.6 %, and the ensemble follows the large vocabulary both times (47.3 %, 32.4 %) because `providerReliability.ts` rates `SHEETSAGE` 0.7 and `CHROMA` 0.5 on chords. Chroma and the bass track do not pick the better model on the split time; **an ensemble of these witnesses has no room to beat its best member on the root.**

**Bass tracker.** Where the reference bass is not the root, the heaviest pYIN pitch class equals the reference bass on **26.8 %** of tracked time on dev and **18.4 %** on test, and equals the chord's *root* on 41.5 % / 44.8 %: the low-passed mix hears the root more often than the bass. Inversion accuracy (0.046 test, 0.115 dev) and the false inversions (11.7 s, 10.7 s) are both bounded by this witness. The engine already halves any reading whose bass the chroma never states; that keeps `Cmaj7/B` off a walking bass, and cannot make a wrong bass note right. **The fix is a separated bass stem (stream B), not a fusion rule.**

## 6. Key

- **Corpus.** Strict key accuracy 0.667 on test (8/12) and 0.5 on dev (6/12), identical for every engine arm and for the worker's own Krumhansl key, because both key witnesses in the worker (Krumhansl over chroma, Krumhansl over BTC's chord sequence) read the same audio. Every miss is the relative minor (F major → D minor, C major → A minor, A♭ major → F minor) or the dominant (C major → G major). MIREX-weighted 0.742 / 0.70, reported apart and never mixed in.
- **The contested path never fired on synthetic audio** (0 of 24 clips): the two witnesses agree with each other even when both are wrong. It is exercised by the unit tests and by the real upload.
- **The owner's upload** (`3108652e…`, 4:19, the platform's own FLAC proxy decoded to mono 22.05 kHz; `docs/evidence/harmony-real-upload-live.json`). The Song Model today carries `contested`: E♭ major 0.345 (`TRANSCRIPTION_KEY_V1`) vs G minor 0.32 (`LOCAL_SIGNAL_ANALYZER_V1`). Given those two observations **plus** the worker's chroma key (G minor, 0.74, margin 0.44) and the key implied by BTC's own chord sequence (G minor, 0.65), `keyReconciliation` returns **`agreed` G minor**, score 1.063 from three independent witnesses against 0.345, margin 0.718, confidence 0.514. The chords agree: `Gm` 44 s, `Cm` 33 s, roman numerals `i` 84 s, `iv` 23 s, `v` 13 s; both BTC vocabularies' most frequent chord is `G:min` (57–62 s). The tonal-centre timeline also shows ~58 s in C♯ minor / E major (`A♭m`, `C♯m/E`, `F♯`, `E` chords) — a distant stretch the global contest cannot express at all. 220 chords, coverage 0.96, 67 abstentions (5 s, mostly major-vs-minor splits on a single beat), 11 slash chords (20 s), bass unknown for 64 s. **No human has checked these chords; this is what the engine says, not what the song is.**

## 7. What this establishes, and what it does not

**Measured and established**
- On rendered block-chord audio, two BTC vocabularies read the root right ≈ 77–83 % of the time, and this ensemble of chroma + bass track + key context around them ties that on the root (−0.001 dev, −0.014 test vs the better model), adds +0.017–0.019 on the full symbol, and is the only arm that names inversions at all — at 4.6–11.5 % accuracy and with more false inversions than true ones on test.
- The two-stage decision and the flicker join were each chosen on the dev split and each moved the test split in the same direction (coverage 0.80 → 0.998, root 0.61 → 0.77, boundary F1 0.30 → 0.48).
- `keyReconciliation` carries a two-way split as `contested` with both candidates and the discriminating pitch classes, and on the owner's upload three witnesses settle the platform's contest to G minor.
- Abstention is informative on test: the provider's root is 0.77 where the ensemble spoke and 0.37 where it refused — but it refused only 5.8 s of 896.

**Not established**
- Any accuracy for real recordings. The corpus is synthetic and block-chord; the owner's upload has no reference.
- That the key result on the owner's upload is *right*: three witnesses agreeing is corroboration, not truth — two of the three are Krumhansl profiles over the same audio.
- That inversions are recoverable from this pipeline. They are not, with a low-passed mix as the bass witness.
- The tonicization/modulation reading. On the owner's upload the timeline reports 48 changes in 4 minutes; many one-bar "modulations" are window noise. The kinds are labelled, not validated.

**Candidate causes to test next (not named as causes)**
- Bass witness: replace pYIN-over-mix with a separated bass stem (stream B) and re-score `with bass` on the same splits.
- Split-time root: a third chord model with a different training set, or BTC's per-frame posteriors instead of its argmax, might make the split time decidable; today the ensemble can only follow one model.
- Key: an independent key witness (not Krumhansl over the same chroma) is needed before the corpus key number means anything; the relative-minor misses suggest a mode prior, which is a claim to test, not to code.

## 8. Spend and what is left running

- Modal, this session: one 12-clip dev batch (four cold containers 33–50 s, eight warm 4–7 s, cpu=4, 8 GB) and one run on the owner's 260-s upload (58 s), each followed by the 120-s scale-down idle. **≈ $0.25 estimated from container-seconds**; the previous session's test batch, self-test and image builds were of the same order. The $10 cap was not approached. The Modal dashboard is the metered figure.
- No deployed app: all three `harmony-acr-worker` apps (`ap-B6dK…` from the previous session, `ap-nd7G…` and `ap-uheK…` from this one) were ephemeral `modal run` apps and show `stopped`. Nothing to stop; nothing left billing.

## 9. Re-running

```
# dev split (draws, renders, runs the worker on Modal, scores)
node artifacts/api-server/scripts/harmony-tournament.mjs --split dev
# sweep a constant offline on the dev split
node artifacts/api-server/scripts/harmony-tournament.mjs --split dev --skip-modal --root-provider-weight 0.75 --out .tmp-harmony/dev/w075.json
# the test split, once, with defaults
node artifacts/api-server/scripts/harmony-tournament.mjs --split test --skip-modal
# a real upload: decode the proxy to mono 22.05 kHz WAV into .tmp-harmony/real/, then
MODAL_PROFILE=music-platform python -m modal run services/harmony-acr-worker/modal_app.py::batch --input-dir .tmp-harmony/real --output .tmp-harmony/real/providers.json
node artifacts/api-server/scripts/harmony-real-upload.mjs --stem <wav stem> --key-observations <platform key observations json>
```

Evidence: `docs/evidence/harmony-tournament-live.json` (test), `docs/evidence/harmony-tournament-dev-sweep.json` (dev sweep, diagnostics, before/after), `docs/evidence/harmony-real-upload-live.json` (the owner's upload).
