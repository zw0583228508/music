/**
 * The seeded defect corpus for Brain B-06 (repair with origin layer and
 * backtracking) — test input, not production code.
 *
 * Each entry injects **one** defect into an otherwise ordinary run of
 * `orchestrateArrangement` and records what the repair stage did with it. Two
 * ways of injecting, and the difference matters when reading the results:
 *
 *  - `plan`: the defect is a *plan decision*, stated through the same
 *    `plannerHints` a production brief uses ("the chorus is a bed", "the
 *    climax is marked mp"). The notes are then a faithful realisation of a bad
 *    plan, so a repair can only work by reopening the layer that decided it —
 *    a recompose from the same plan writes the same notes. This is the case
 *    the stream's gate is about.
 *  - `notes`: the defect is in the notes the repair stage receives, whatever
 *    wrote them, injected by wrapping the reference composer (the R-1b
 *    defects that are produced downstream of the plan — the bed collapsed to
 *    one voice, the harmony parts off the grid, the bed two octaves up). The
 *    wrapper corrupts **every** call, including the repair's recompose, so
 *    these can only be repaired by a plan change that moves the notes out of
 *    the defect — never by "stop injecting it". Where no plan lever reaches
 *    them, that is the honest answer and the row says so.
 *
 * The five defects R-1b's musical attack asks a repair loop to fix are all
 * here (`R1B_DEFECTS`), beside the four the DAG names for B-06 (wrong
 * register, muddy stack, empty chorus, early climax) as far as the plan can
 * state them.
 */
import type { CriticRepairLoopResult, MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import type { GlobalPlannerHints } from "../globalArrangementPlanner";
import type { SectionPlannerHints } from "../sectionPhrasePlanner";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel } from "../benchmarkCorpus";
import { orchestrateArrangement, type OrchestratedCandidate, type OrchestrateInput, type PartComposerFn } from "../arrangementOrchestrator";
import { composeReferencePart } from "../referencePartComposer";
import { rachemNaSongModel } from "./rachemNaSongModelV3";

export type DefectSeeding = "plan" | "notes";

export type SeededDefect = {
  id: string;
  /** What a musician would say is wrong. */
  description: string;
  /** The anchor to seed it on: a benchmark corpus id, or `rachem-na` for the owner's fixture. */
  song: string;
  seeding: DefectSeeding;
  /** The layer whose decision causes it — what the repair stage has to name. */
  expectedLayer: string;
  /** Observation kinds that are the defect (an id contains `:<kind>:`). */
  kinds: string[];
  hints?: { global?: GlobalPlannerHints; section?: SectionPlannerHints };
  corrupt?: (notes: MusicalNote[], request: { instrument: string; sectionName: string }) => MusicalNote[];
  /** The R-1b finding this defect stands for, when it stands for one. */
  r1b?: string;
  /**
   * Set when the defect is a control the stage is expected *not* to repair,
   * with the reason. The corpus then asserts that it was not claimed.
   */
  negativeControl?: string;
};

/** Keep only the highest note at each onset: a chord bed collapsed to one line (R-1b P0-1's shipped result). */
export function collapseToTopVoice(notes: readonly MusicalNote[]): MusicalNote[] {
  const byOnset = new Map<number, MusicalNote>();
  for (const note of notes) {
    const key = Math.round(note.start * 200);
    const kept = byOnset.get(key);
    if (!kept || note.pitch > kept.pitch) byOnset.set(key, note);
  }
  return [...byOnset.values()].sort((a, b) => a.start - b.start);
}

const isBed = (instrument: string) => instrument === "keys" || instrument === "strings" || instrument === "guitar" || instrument === "synth";

const SEEDED: SeededDefect[] = [
  {
    id: "arrival_thinner_than_setup",
    description: "the chorus is planned as a bed under a verse planned full: the arrival is thinner than its own setup",
    song: "pop-full", seeding: "plan", expectedLayer: "arc",
    kinds: ["louder_section_thinner", "quieter_section_denser"],
    hints: { global: { textureLevels: { Chorus: "bed", "Verse 2": "full" } } },
    r1b: "P0-4 (the first chorus is thinner and quieter than the verse before it)",
  },
  {
    id: "climax_planned_thin",
    description: "the section the arc calls the climax is marked mp and planned as a bed while a verse is marked f: the repeat then differs from its first statement by dynamics alone",
    song: "pop-full", seeding: "plan", expectedLayer: "form",
    kinds: ["development_by_dynamics_only"],
    hints: { global: { textureLevels: { "Chorus 2": "bed" }, sectionDynamics: { "Chorus 2": "mp", Verse: "f" } } },
    r1b: "the DAG's \"early climax\" seeded defect",
  },
  {
    id: "tutti_everywhere",
    description: "every section planned tutti: the ensemble never changes, so the arrival has nowhere to go",
    song: "pop-full", seeding: "plan", expectedLayer: "arc",
    kinds: ["ensemble_never_changes", "climax_misplaced"],
    hints: { global: { textureLevels: { Intro: "tutti", Verse: "tutti", Chorus: "tutti", "Verse 2": "tutti", "Chorus 2": "tutti", Outro: "tutti" } } },
  },
  {
    id: "repeat_no_development",
    description: "the second chorus is planned exactly as the first: a repeat with nothing developed",
    song: "pop-full", seeding: "plan", expectedLayer: "form",
    kinds: ["repeat_without_development", "recurrence_is_copy_only", "section_note_copy"],
    hints: { global: { textureLevels: { Chorus: "full", "Chorus 2": "full" } } },
  },
  {
    id: "bed_single_voice",
    description: "the sustained bed arrives at the repair stage as one line: every chord reduced to its top voice",
    song: "pop-full", seeding: "notes", expectedLayer: "compose",
    kinds: ["bed_single_voice", "bed_thin_voicing"],
    corrupt: (notes, request) => (isBed(request.instrument) ? collapseToTopVoice(notes) : [...notes]),
    r1b: "P0-1 (the string bed ships as a single voice)",
  },
  {
    id: "owner_bed_single_voice",
    description: "the owner's song with its harmony bed collapsed to one line, as the perform -> playability cascade delivers it today",
    song: "rachem-na", seeding: "notes", expectedLayer: "compose",
    kinds: ["bed_single_voice", "bed_thin_voicing"],
    corrupt: (notes, request) => (isBed(request.instrument) ? collapseToTopVoice(notes) : [...notes]),
    r1b: "P0-1 on the owner's song",
  },
  {
    id: "bed_two_octaves_up",
    description: "the bed arrives two octaves above the band the plan gave it: out of its planned band, out of its comfortable range, on top of the singer",
    song: "pop-full", seeding: "notes", expectedLayer: "compose",
    kinds: ["part_outside_planned_band", "part_outside_comfortable_range"],
    corrupt: (notes, request) => (isBed(request.instrument) ? notes.map((n) => ({ ...n, pitch: Math.min(108, n.pitch + 24) })) : [...notes]),
    r1b: "P0-1 (the climax is all treble: strings at MIDI 89-92)",
  },
  {
    id: "off_grid_harmony",
    description: "every harmony onset displaced 130 ms from the grid the kit plays on",
    song: "pop-full", seeding: "notes", expectedLayer: "compose",
    kinds: ["off_grid"],
    negativeControl: "no critic on this path emits an `off_grid` observation for it: the groove dimension measures the harmony onsets against the chord grid those writers already follow, so displacing both leaves nothing to see. A stage that is never told about a defect cannot repair it, and must not claim to.",
    corrupt: (notes, request) => (isBed(request.instrument) ? notes.map((n) => ({ ...n, start: n.start + 0.13 })) : [...notes]),
    r1b: "P0-2 (the harmony parts are off the beat; the kit is on it)",
  },
];

export const DEFECT_CORPUS: readonly SeededDefect[] = Object.freeze(SEEDED);

/** The five defects R-1b's musical attack says a repair loop should be able to fix, and the corpus entry that stands for each. */
export const R1B_DEFECTS: ReadonlyArray<{ finding: string; defectId: string }> = Object.freeze([
  { finding: "single-voice bed", defectId: "bed_single_voice" },
  { finding: "off-grid harmony", defectId: "off_grid_harmony" },
  { finding: "arrival thinner than setup", defectId: "arrival_thinner_than_setup" },
  { finding: "climax all treble", defectId: "bed_two_octaves_up" },
  { finding: "unrealised transitions", defectId: "owner_bed_single_voice" },
]);

export function songModelFor(song: string): SongModelData {
  if (song === "rachem-na") return rachemNaSongModel();
  const spec = BENCHMARK_CORPUS.find((c) => c.id === song);
  if (!spec) throw new Error(`no anchor named ${song}`);
  return buildBenchmarkSongModel(spec);
}

export type DefectRun = {
  defect: SeededDefect;
  candidate: OrchestratedCandidate;
  repair: CriticRepairLoopResult | null;
  /** The notes the repair stage started from (a run of the same seed with the stage switched off). */
  control: OrchestratedCandidate;
};

/**
 * One seeded defect through the production orchestrator, twice: once with the
 * repair stage off (the control — what the defect looks like untouched) and
 * once with it on. Deterministic: `now` is pinned and the composer wrapper is
 * a pure function of the request.
 */
export function runDefect(defect: SeededDefect, options: { maxPasses?: number } = {}): DefectRun {
  const songModel = songModelFor(defect.song);
  const timing = {
    tempoBpm: songModel.tempoMap[0]?.bpm ?? 120,
    meter: songModel.meterMap?.[0]?.meter ?? "4/4",
  };
  const composeParts: PartComposerFn | undefined = defect.corrupt
    ? (request) => defect.corrupt!(composeReferencePart(request, timing), { instrument: request.instrument, sectionName: request.section.sectionName })
    : undefined;
  const base: OrchestrateInput = {
    songModel, candidateCount: 1, render: false, now: new Date(0),
    ...(defect.hints ? { plannerHints: defect.hints } : {}),
    ...(composeParts ? { composeParts, composerName: "B06_SEEDED_DEFECT_COMPOSER" } : {}),
  };
  const control = orchestrateArrangement({ ...base, repairMaxPasses: 0 }).candidates[0];
  const repaired = orchestrateArrangement({ ...base, repairMaxPasses: options.maxPasses ?? 5 }).candidates[0];
  return { defect, candidate: repaired, repair: repaired.repair, control };
}

const matchesKind = (id: string, kinds: readonly string[]) => kinds.some((kind) => id.includes(`:${kind}:`));

export type DefectRow = {
  id: string;
  description: string;
  song: string;
  seeding: DefectSeeding;
  r1b: string | null;
  negativeControl: string | null;
  expectedLayer: string;
  /** Layers the plan named for this defect's own observations (empty when it named none). */
  layersNamed: string[];
  layerCorrect: boolean;
  /** The defect's observations before the stage ran, and how many of them it removed. */
  present: number;
  resolved: number;
  fixed: boolean;
  /** Every accepted pass kept its scope: verified inside the loop, restated here. */
  outsideScopePreserved: boolean;
  judgeWorse: boolean;
  burdenBefore: number;
  burdenAfter: number;
  acceptedPasses: number;
  rejectedPasses: number;
  /** Passes that changed neither the plan nor the notes; none of them may count as a repair. */
  noOpPasses: number;
  layersReopened: string[];
  /** Why the defect was not repaired, in the stage's own words. */
  reasons: string[];
};

/** What the stage did with one seeded defect, as a row of the corpus table. */
export function measureDefect(run: DefectRun): DefectRow {
  const repair = run.repair;
  const passes = repair?.passes ?? [];
  const plan = repair?.repairPlan ?? null;
  const delta = repair?.observationDelta ?? { resolved: [], introduced: [], persisted: [] };
  const kinds = run.defect.kinds;
  const present = [...delta.resolved, ...delta.persisted].filter((id) => matchesKind(id, kinds));
  const resolved = delta.resolved.filter((id) => matchesKind(id, kinds));
  const layersNamed = [...new Set(
    (plan?.operations ?? [])
      .filter((operation) => operation.targets.some((id) => matchesKind(id, kinds)))
      .map((operation) => operation.layer as string),
  )].sort();
  const accepted = passes.filter((p) => p.accepted === true);
  const rejected = passes.filter((p) => p.accepted === false);
  const reasons = [
    ...rejected.map((p) => `${p.layer}.${p.operation}: ${p.rejectionReason ?? "rejected"}`),
    ...(plan?.deferred ?? [])
      .filter((d) => d.observationIds.some((id) => matchesKind(id, kinds)))
      .map((d) => `deferred: ${d.reason}`),
  ];
  return {
    id: run.defect.id,
    description: run.defect.description,
    song: run.defect.song,
    seeding: run.defect.seeding,
    r1b: run.defect.r1b ?? null,
    negativeControl: run.defect.negativeControl ?? null,
    expectedLayer: run.defect.expectedLayer,
    layersNamed,
    layerCorrect: layersNamed.includes(run.defect.expectedLayer),
    present: present.length,
    resolved: resolved.length,
    fixed: present.length > 0 && resolved.length === present.length,
    // Every accepted pass ran `notesOutsideScopePreserved` in the executor and
    // would have been rejected as a scope violation otherwise.
    outsideScopePreserved: !rejected.some((p) => (p.rejectionReason ?? "").startsWith("scope violation")),
    judgeWorse: (repair?.criticAfter?.burden ?? 0) > (repair?.criticBefore?.burden ?? 0) + 1e-6 ||
      (repair?.criticAfter?.blocking ?? 0) > (repair?.criticBefore?.blocking ?? 0),
    burdenBefore: repair?.criticBefore?.burden ?? 0,
    burdenAfter: repair?.criticAfter?.burden ?? 0,
    acceptedPasses: accepted.length,
    rejectedPasses: rejected.length,
    noOpPasses: passes.filter((p) => p.attempted && !p.attempted.planChanged && !p.attempted.notesChanged).length,
    layersReopened: [...new Set(accepted.map((p) => p.layer as string))].sort(),
    reasons,
  };
}

/** The whole corpus, measured. */
export function measureCorpus(corpus: readonly SeededDefect[] = DEFECT_CORPUS, options: { maxPasses?: number } = {}): DefectRow[] {
  return corpus.map((defect) => measureDefect(runDefect(defect, options)));
}

/** Notes of every track, keyed by instrument — for the byte-identity checks. */
export function notesByInstrument(trackModels: readonly TrackModel[]): Record<string, MusicalNote[]> {
  return Object.fromEntries(trackModels.map((track) => [track.instrument, track.notes]));
}
