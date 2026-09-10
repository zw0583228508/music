/**
 * Golden pin for the reference part composer (Brain B-00, D5).
 *
 * The composer was split mechanically into `composer/*` modules. This test
 * proves the split changed nothing: every part request of the nine synthetic
 * benchmark Song Models is composed and digested, and the digests must match
 * the fixture recorded before the split.
 *
 * Two levels are pinned:
 *   - `composer`: sha256 over the notes of every PartGenerationRequest the
 *     part plan produces — the composer alone, independent of the orchestrator.
 *   - `orchestration`: note count + sha256 of the canonical JSON of each
 *     candidate's shipped trackModels through `orchestrateArrangement`.
 *
 * Re-pin only with `B00_WRITE_GOLDEN=1` and a reason in the commit message;
 * a silent re-pin is the failure mode this test exists to prevent.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "./benchmarkCorpus";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest } from "./partComposer";

const NOW = new Date(0);
/** The bundle runs from `.tmp-tests`; the fixture lives next to the source. Walk up to the api-server package. */
export function apiServerRoot(): string {
  let current = resolve(process.cwd());
  for (;;) {
    const candidate = join(current, "artifacts", "api-server");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (existsSync(join(current, "package.json")) && existsSync(join(current, "src", "lib"))) return current;
    const parent = dirname(current);
    if (parent === current) throw new Error(`api-server root not found above ${process.cwd()}`);
    current = parent;
  }
}
const FIXTURE = join(apiServerRoot(), "src", "lib", "__fixtures__", "reference-part-composer.golden.json");

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((k) => record[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(",")}}`;
}

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

type GoldenCase = {
  id: string;
  composer: { tasks: number; notes: number; digest: string };
  orchestration: Array<{ candidateId: string; strategy: string; noteCount: number; tracks: string[]; digest: string }>;
};

export function composerDigest(spec: (typeof BENCHMARK_CORPUS)[number]): GoldenCase["composer"] {
  const model = buildBenchmarkSongModel(spec);
  const globalPlan = deriveGlobalArrangementPlan(model, { now: NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: NOW });
  const orchestrationBudget = deriveOrchestrationBudget(model, sectionPlan, { now: NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: NOW });
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitionPlan.transitions, { now: NOW });
  const layers = { globalPlan, sectionPlan, budgetWindows: orchestrationBudget.windows, transitions: transitionPlan.transitions };
  const tempoBpm = model.tempoMap[0].bpm;
  const meter = model.meterMap[0].meter;
  const perTask: string[] = [];
  let notes = 0;
  for (const task of partPlan.tasks) {
    const request = buildPartGenerationRequest(model, task, layers, []);
    const composed = composeReferencePart(request, { tempoBpm, meter });
    notes += composed.length;
    perTask.push(`${task.id}:${sha(stableStringify(composed))}`);
  }
  return { tasks: partPlan.tasks.length, notes, digest: sha(perTask.join("\n")) };
}

export function orchestrationDigest(spec: (typeof BENCHMARK_CORPUS)[number]): GoldenCase["orchestration"] {
  const model = buildBenchmarkSongModel(spec);
  const result = orchestrateArrangement({ songModel: model, candidateCount: 3, render: false, now: NOW });
  return result.candidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    strategy: candidate.strategy,
    noteCount: candidate.noteCount,
    tracks: candidate.trackModels.map((t) => t.instrument),
    digest: sha(stableStringify(candidate.trackModels.map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role,
      notes: t.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
      cc: t.cc, articulations: t.articulations,
    })))),
  }));
}

function currentGolden(): GoldenCase[] {
  return BENCHMARK_CORPUS.map((spec) => ({
    id: spec.id,
    composer: composerDigest(spec),
    orchestration: orchestrationDigest(spec),
  }));
}

test("the reference part composer produces byte-identical parts to the golden fixture", () => {
  const current = currentGolden();
  if (process.env.B00_WRITE_GOLDEN === "1") {
    writeFileSync(FIXTURE, `${JSON.stringify({
      recordedAt: "RE-PINNED at the B-24 merge: the performance engine's timing and velocity jitter are seeded from the music (family, role, onset, pitch) instead of from the note id, because ids are built as part-<sectionName>-<instrument>-<role> and a producer renaming a section moved every onset; and clampPolyphony now judges a held note against the real start of the earliest note in an onset group instead of that group's value rounded to whole milliseconds, which had let a 30.1 ms overlap pass a 30 ms tolerance. Note counts are unchanged for every case (921 / 938 / 1304 on pop-full); only the performed timing and velocity moved, so every digest moved with them. " +
        "composer digests and shipped-note digests recorded on main 39aad30 before the B-00 composer split, " +
        "orchestration noteCount re-pinned after B-00 D1; RE-PINNED at the B-01 merge (planners v1.1: arc targets, sung-by-default, " +
        "mix/ensemble excluded, operators) - every part request changed, so every digest changed; the split itself was verified " +
        "byte-identical at 39aad30 -> B-00. RE-PINNED again at the B-03 merge: instrument definitions now come from " +
        "sourced profiles (ranges, polyphony and leap limits from the GM table, e.g. strings leap 10 -> 24; keys never a kit), " +
        "which changes the constraints every part is composed under. A future digest change must again name its cause here. " +
        "RE-PINNED again at the B-02 merge (rebased over B-03 and B-10) (harmony realisation, base a751796): the four chordal writers " +
        "(bass line planned first, keys / strings / brass voicings solved per role against it) replaced the root-position stacks " +
        "and the root-nearest-40 bass; the composer honours partWindow (sustained and rhythmic parts stop at their exit bar); " +
        "chord tones are read through chordSymbols.ts (identical for this corpus's maj / min / 7 / m7 symbols) - so every " +
        "case's composer digest changed and every shipped-note digest with it; the rhythm, transition and counter-melody writers " +
        "are untouched. A future digest change must again name its cause here. " +
        "RE-PINNED again at the B-04 merge (rebased over B-02, B-03, B-10) (groove + transitions): the composer's bar is now numerator x one " +
        "denominator unit (the 7/8 case's parts fall inside their sections, so every 7/8 digest changed), the drum kit / percussion / " +
        "ostinato read the GroovePlan (meter templates, tempo-capped hats, shared anticipations, fills from the vocabulary, the ending), " +
        "and the performance engine accents per meter, pedals on chord onsets, ghosts on weak positions and broadens cadences - so every " +
        "shipped-note digest changed; the harmony writers (B-02) are untouched, so a 4/4 case's bass / keys / strings composer digests " +
        "changed only where the whole-part digest includes the kit. A future digest change must again name its cause here. " +
        "RE-PINNED again at the B-18 merge (the brief read like a musician). Five of the nine cases moved, for two named causes. " +
        "(1) Approach tones (R-1b P1-6): the bass now takes them from the mode's own scale " +
        "(harmonyPlan/styleParams.approachToneChoice) instead of the union of every pitch class any chord of the song uses. " +
        "That union is what admitted an Ab under Dm and a B natural under Bb in an F major ballad; the old test was " +
        "`chromaticApproach || scale.has(pc) || Math.abs(p - target) === 2`, with a fallback to any non-chord tone. " +
        "This moved ballad-piano-vocal, ethnic-vocal and cinematic-midi (all `intimate` -> mode-restricted) and " +
        "acoustic-demo's shipped notes only - the note count is identical in all four, because the same approaches are " +
        "written from admissible notes. The chromatic styles (pop / band / electronic / jazz aesthetics) state no offset " +
        "preference and no mode restriction, so pop-full, rock-full, dance-full and orchestral-midi are byte-identical. " +
        "(2) Groove without a brief (R-1b P1-3): jazz-full is the only case whose *plan* changed. Its 24 chords are a " +
        "ii-V vocabulary with sevenths, which `inferStyleFromSong` reads as a jazz standard, and a jazz standard forbids " +
        "`four_on_floor`; the map's tempo band (132 BPM, no measured syncopation) used to answer `four_on_floor`. The " +
        "measured rhythm is not swung either, so the plan writes `steady_pulse` and records why in " +
        "`styleDecisions.grooveReason` - 16 fewer composed notes (988 -> 972), all of them kit. That new bass " +
        "line then wrote two approach notes that are the major third of the minor chord they sound over (an E " +
        "natural over Cm7, which B-05c's harmony critic grades `major`); `approachToneChoice` now refuses that " +
        "note in every style, chromatic idioms included, which is the second thing that moved jazz-full's digest " +
        "and takes its harmony score from 78.4 back to 89.2. Note count unchanged (972). " +
        "RE-PINNED again inside B-18, one cause: a chromatic style now reads the mode as a *preference*. " +
        "`approachToneChoice` computed the mode's approach set only for a `modeOnly` vocabulary, so the " +
        "chromatic vocabulary (pop / band / electronic / jazz aesthetics) consulted no mode at all and took the " +
        "first admissible pitch - a half step from the target - even where the mode already offered a step into " +
        "it. It now looks inside the mode first and falls back to any non-chord tone only when the mode offers " +
        "nothing, which is what `allowOutOfMode` was always documented to mean. Measured on jazz-full: the bass " +
        "approached G through F sharp twice per section with F natural admissible; the harmony dimension grades " +
        "an out-of-chord-mode approach `minor` in any style, and jazz-full goes 89.2 -> 96.4 with both " +
        "`approach_tone_wrong_mode` findings gone and `outOfKeyShare` 0. pop-full, rock-full, dance-full and " +
        "jazz-full moved, note counts identical in all four (the same approaches are written from admissible " +
        "notes); the mode-restricted cases (ballad-piano-vocal, acoustic-demo, orchestral-midi, ethnic-vocal, " +
        "cinematic-midi) are byte-identical, and so is every case's section plan - the per-family role rule that " +
        "went in with this re-pin only fires where a brief named a family's level, which no corpus case does. " +
        "A future digest change must again name its cause here. " +
        "RE-PINNED again at the B-13 merge (one playability truth, one groove for every part, base 30041f5): every harmony writer " +
        "now takes its onsets from the shared GroovePlan instead of subdividing the analysed chord span - the bass from " +
        "bassRhythmFor (kick/bass relation, shared anticipations, approach tones, pedal, held ending), keys / guitar / strings / " +
        "pads from compingRhythmFor on the texture the candidate strategy asks for (sustained bed, block chords, arpeggio) - and " +
        "the analysed chord onsets are read as the beat or the 8th they state (chordEventsIn's grid), so every composer digest " +
        "changed on every case. The shipped-note digests changed with them and for three more reasons: the strategy no longer " +
        "thins a part by an evenly spaced stride (texture instead of deletion), the performance engine performs each section with " +
        "its own role and dynamic shape instead of the first section's, and the playability repair reads a rolled or staggered " +
        "chord as one gesture so a bed keeps its voices. A future digest change must again name its cause here. " +
        "RE-PINNED again at the second reconciliation of B-13 with B-18, one cause in `composer/harmonyParts.writeBassLine`: " +
        "the bass's approach tone is written where the bass *planner* writes its own - on the last beat of the chord it is " +
        "leaving (`realiseBassLine`: `e - beatSeconds`) - instead of on whichever groove onset happened to be the last " +
        "before the change, and its pitch now comes from B-18's `approachToneChoice` instead of the copy of the pre-B-18 " +
        "rule (`chromaticApproach || scale.has(pc) || a whole tone`) that lived in this writer. The two were one defect: " +
        "with B-18 reading a jazz standard's own convention instead of the tempo map, jazz-full's bass plays beats 1 and 3, " +
        "so the promoted onset sat a beat and a half from the arrival and sounded a third of the chord - and, chosen by the " +
        "old rule, it could be the major third of the minor chord it sounded over (B natural under Gm7, E natural under " +
        "Cm7). B-05c's harmony dimension graded jazz-full's bass at chord-tone share 0.878 with a major `clash_share`; it " +
        "is 0.952 with no major finding, and the owner's song keeps all eight of its approaches into the chord the bass " +
        "states (`brainB02Harmony`), now led into from a beat away instead of from the middle of the chord. Seven of the " +
        "nine cases moved, composer and shipped digests together: pop-full 906 -> 907, rock-full 781 -> 783, dance-full " +
        "788 -> 789, orchestral-midi 413 -> 414 and ethnic-vocal 227 -> 228 gain the approach notes the groove had no " +
        "onset for; acoustic-demo's count is unchanged at 380 and only its digest moved; jazz-full goes 1202 -> 1365, " +
        "most of it B-18's own groove reading for a jazz standard, which this writer now plays through. " +
        "ballad-piano-vocal and cinematic-midi are byte-identical - `brainB02Evidence` measures zero bass approaches on " +
        "both, so there was nothing here to move. The section plans, the kit, the comping and the counter-melody are " +
        "untouched. A future digest change must again name its cause here.",
      cases: current,
    }, null, 2)}\n`);
    return;
  }
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: GoldenCase[] };
  assert.equal(current.length, golden.cases.length, "same corpus size");
  for (const [index, expected] of golden.cases.entries()) {
    const actual = current[index];
    assert.equal(actual.id, expected.id);
    assert.deepEqual(actual.composer, expected.composer, `${expected.id}: composer output changed`);
  }
});

test("the orchestrated candidates' shipped notes match the golden fixture", () => {
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: GoldenCase[] };
  if (process.env.B00_WRITE_GOLDEN === "1") return;
  for (const expected of golden.cases) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === expected.id)!;
    assert.deepEqual(orchestrationDigest(spec), expected.orchestration, `${expected.id}: shipped notes changed`);
  }
});
