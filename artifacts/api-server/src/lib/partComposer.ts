/**
 * Part Composer contract (PR-09).
 *
 * `buildPartComposerPlan()` enumerates the parts to compose for an arrangement
 * (one per active instrument-role per section, plus per-boundary transitions and
 * intro/ending), with deterministic seeds and a dependency order (foundation →
 * harmony → melodic → fills/transitions).
 *
 * `buildPartGenerationRequest()` packs one task into a self-contained
 * `PartGenerationRequest`: the plan layers plus **previous + current + next**
 * bar windows of chords / melody / bass, so a generator never composes a part
 * in isolation.
 */
import { createHash } from "node:crypto";
import type {
  ChordHarmonyEvent,
  GlobalArrangementPlan,
  InstrumentArrangementRole,
  OrchestrationBudgetWindow,
  PartComposerPlan,
  PartTask,
  PhrasePlan,
  SectionPhrasePlan,
  SectionPlan,
  SongModelData,
  SongModelMusicalMap,
  TransitionPlan,
} from "@workspace/db";
import { getInstrumentDefinition } from "./musicEngines";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";

export const PART_COMPOSER_PLAN_VERSION = "1.0" as const;
const METHOD = "part-composer/v1";

// ---------------------------------------------------------------------------
// role/instrument → task
// ---------------------------------------------------------------------------

function taskFor(
  role: InstrumentArrangementRole,
  instrument: string,
  sectionFunction: SectionPlan["function"],
  style: string,
): PartTask | null {
  const guitar = /electric|dist|lead/i.test(style) ? "ELECTRIC_GUITAR" : "ACOUSTIC_GUITAR";
  const keysTask = instrument === "piano" ? "PIANO" : "KEYS";
  switch (role) {
    case "LEAD":
      // A sung lead is not composed here; an instrumental lead is.
      if (sectionFunction !== "instrumental") return null;
      return instrument === "strings" ? "STRINGS"
        : instrument === "brass" ? "BRASS"
        : instrument === "winds" ? "WOODWINDS"
        : instrument === "guitar" ? (guitar as PartTask)
        : (keysTask as PartTask);
    case "GROOVE":
    case "FOUNDATION":
      return instrument === "percussion" ? "PERCUSSION" : "DRUMS";
    case "BASS":
      return "BASS";
    case "RHYTHMIC_HARMONY":
    case "HARMONIC_BED":
      return instrument === "guitar" ? (guitar as PartTask)
        : instrument === "strings" ? "STRINGS"
        : (keysTask as PartTask);
    case "OSTINATO":
      return "OSTINATO";
    case "COUNTER_MELODY":
      return "COUNTER_MELODY";
    case "CALL_RESPONSE":
      return "CALL_RESPONSE";
    case "PAD":
      return "PAD";
    case "ACCENT":
    case "FILL":
      return instrument === "percussion" ? "PERCUSSION" : "FILL";
    case "CLIMAX_LAYER":
      return instrument === "brass" ? "BRASS"
        : instrument === "strings" ? "STRINGS"
        : instrument === "drums" ? "DRUMS"
        : (keysTask as PartTask);
    default:
      return null;
  }
}

/** Dependency tier — lower composes first. */
const TASK_TIER: Record<PartTask, number> = {
  DRUMS: 0, PERCUSSION: 1, BASS: 1,
  PIANO: 2, KEYS: 2, ACOUSTIC_GUITAR: 2, ELECTRIC_GUITAR: 2, OSTINATO: 2,
  STRINGS: 3, BRASS: 3, WOODWINDS: 3, PAD: 3,
  COUNTER_MELODY: 4, CALL_RESPONSE: 4,
  FILL: 5, TRANSITION: 5, INTRO: 5, ENDING: 5,
};

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

function seedFor(songModel: SongModelData, taskId: string): number {
  const digest = createHash("sha256")
    .update(`${songModel.fusion?.selectedProvider ?? ""}:${taskId}:${songModel.musicalMap?.inputsDigestSha256 ?? ""}`)
    .digest();
  return digest.readUInt32BE(0);
}

export function partComposerPlanInputsDigest(
  songModel: SongModelData,
  sectionPlan: SectionPhrasePlan,
  transitions: TransitionPlan[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sectionPlanDigest: sectionPlan.inputsDigestSha256,
      roleAssignments: sectionPlan.roleAssignments.map((r) => [r.sectionName, r.instrument, r.role]),
      transitions: transitions.map((t) => [t.id, t.kind, t.devices.length]),
    }))
    .digest("hex");
}

export function buildPartComposerPlan(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan,
  sectionPlan: SectionPhrasePlan,
  transitions: TransitionPlan[],
  options: { now?: Date } = {},
): PartComposerPlan {
  const tasks: PartComposerPlan["tasks"] = [];
  const idsBySectionTier = new Map<string, string[]>();

  for (const section of sectionPlan.sections) {
    const roles = sectionPlan.roleAssignments.filter((r) => r.sectionName === section.sectionName);
    for (const assignment of roles) {
      const task = taskFor(assignment.role, assignment.instrument, section.function, globalPlan.style);
      if (!task) continue;
      const id = `part-${section.sectionName}-${assignment.instrument}-${assignment.role}`
        .replace(/\s+/g, "_");
      const tierKey = `${section.sectionName}:${TASK_TIER[task]}`;
      idsBySectionTier.set(tierKey, [...(idsBySectionTier.get(tierKey) ?? []), id]);
      tasks.push({
        id,
        task,
        sectionName: section.sectionName,
        instrument: assignment.instrument,
        role: assignment.role,
        startBar: assignment.entryBar,
        endBar: assignment.exitBar,
        seed: seedFor(songModel, id),
        dependsOn: [],
      });
    }
    if (section.function === "intro") {
      const id = `part-${section.sectionName}-intro`.replace(/\s+/g, "_");
      tasks.push({
        id, task: "INTRO", sectionName: section.sectionName, instrument: "ensemble",
        role: "TRANSITION", startBar: section.startBar, endBar: section.endBar,
        seed: seedFor(songModel, id), dependsOn: [],
      });
    }
    if (section.function === "outro") {
      const id = `part-${section.sectionName}-ending`.replace(/\s+/g, "_");
      tasks.push({
        id, task: "ENDING", sectionName: section.sectionName, instrument: "ensemble",
        role: "TRANSITION", startBar: section.startBar, endBar: section.endBar,
        seed: seedFor(songModel, id), dependsOn: [],
      });
    }
  }

  for (const transition of transitions) {
    if (transition.devices.length === 0) continue;
    const id = `part-transition-${transition.id}`;
    tasks.push({
      id, task: "TRANSITION", sectionName: transition.toSection, instrument: "ensemble",
      role: "TRANSITION",
      startBar: Math.max(1, transition.atBar - transition.approachBars),
      endBar: transition.atBar,
      seed: seedFor(songModel, id), dependsOn: [],
    });
  }

  // Wire dependencies: within a section, each task depends on every task in a
  // strictly lower tier of the same section.
  const bySection = new Map<string, typeof tasks>();
  for (const task of tasks) {
    bySection.set(task.sectionName, [...(bySection.get(task.sectionName) ?? []), task]);
  }
  for (const task of tasks) {
    const peers = bySection.get(task.sectionName) ?? [];
    task.dependsOn = peers
      .filter((peer) => peer.id !== task.id && TASK_TIER[peer.task] < TASK_TIER[task.task])
      .map((peer) => peer.id);
  }
  tasks.sort((a, b) =>
    TASK_TIER[a.task] - TASK_TIER[b.task] ||
    a.sectionName.localeCompare(b.sectionName) ||
    a.id.localeCompare(b.id));

  return {
    version: PART_COMPOSER_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: partComposerPlanInputsDigest(songModel, sectionPlan, transitions),
    method: METHOD,
    tasks,
  };
}

// ---------------------------------------------------------------------------
// Full request
// ---------------------------------------------------------------------------

export type PartBarContext = {
  startBar: number;
  endBar: number;
  chords: ChordHarmonyEvent[];
  melody: SongModelData["melody"];
  bass: NonNullable<SongModelData["bass"]>;
};

export type PartGenerationRequest = {
  task: PartTask;
  taskId: string;
  seed: number;
  instrument: string;
  role: InstrumentArrangementRole;
  section: SectionPlan;
  phrases: PhrasePlan[];
  globalPlan: GlobalArrangementPlan;
  budgetWindows: OrchestrationBudgetWindow[];
  transitions: TransitionPlan[];
  context: {
    previousBars: PartBarContext;
    currentBars: PartBarContext;
    nextBars: PartBarContext;
  };
  existingParts: Array<{ instrument: string; role: string; noteCount: number }>;
  styleFingerprint: SongModelMusicalMap["styleFingerprint"];
  constraints: {
    playableRange: { min: number; max: number };
    comfortableRange: { min: number; max: number };
    maxLeap: number;
    maxSimultaneousNotes: number;
    minNoteDuration: number;
    physicalRules: string[];
  };
};

const CONTEXT_BARS = 2;

function barBounds(songModel: SongModelData, bar: number, totalBars: number): { start: number; end: number } {
  const explicit = (songModel.bars ?? []).find((b) => b.bar === bar);
  if (explicit) return { start: explicit.start, end: explicit.end };
  const duration = songModel.audio?.durationSeconds ?? totalBars * 2;
  const per = duration / Math.max(1, totalBars);
  return { start: (bar - 1) * per, end: bar * per };
}

function sliceContext(
  songModel: SongModelData,
  startBar: number,
  endBar: number,
  totalBars: number,
): PartBarContext {
  const lo = Math.max(1, startBar);
  const hi = Math.max(lo, endBar);
  const from = barBounds(songModel, lo, totalBars).start;
  const to = barBounds(songModel, hi, totalBars).end;
  const within = <T extends { start: number; end: number }>(items: T[]): T[] =>
    items.filter((item) => item.end > from + 1e-6 && item.start < to - 1e-6);
  return {
    startBar: lo,
    endBar: hi,
    chords: within(songModel.chords ?? []),
    melody: within(songModel.melody ?? []),
    bass: within(songModel.bass ?? []),
  };
}

const PHYSICAL_RULES: Record<string, string[]> = {
  keys: ["two hands, ~14 semitones each", "no re-strike under ~55 ms"],
  drums: ["four limbs max", "hi-hat state changes ≥ 60 ms apart"],
  guitar: ["6 strings, ~5-fret hand span", "use open strings for wide shapes"],
  bass: ["one line, position shifts cost time", "slides need adjacent frets"],
  strings: ["solo = 1 line / 2-note double stops on adjacent strings", "section = divisi ok"],
  brass: ["breath ~10 s, then recover", "single line, tongued attacks"],
  winds: ["breath ~8 s, then recover", "single line"],
  voice: ["breath ~8 s", "syllable-locked to lyrics"],
  synth: ["patch-dependent; no physical limits"],
};

export function buildPartGenerationRequest(
  songModel: SongModelData,
  target: PartComposerPlan["tasks"][number],
  layers: {
    globalPlan: GlobalArrangementPlan;
    sectionPlan: SectionPhrasePlan;
    budgetWindows: OrchestrationBudgetWindow[];
    transitions: TransitionPlan[];
  },
  existingParts: PartGenerationRequest["existingParts"] = [],
): PartGenerationRequest {
  const totalBars = Math.max(1, layers.globalPlan.sectionTargets.at(-1)?.endBar ?? 1);
  const section = layers.sectionPlan.sections.find((s) => s.sectionName === target.sectionName) ??
    layers.sectionPlan.sections[0];
  const phrases = layers.sectionPlan.phrases.filter((p) => p.sectionName === target.sectionName);
  const definition = safeDefinition(target.instrument, target.role);
  const map = songModel.musicalMap;

  const currentStart = section.startBar;
  const currentEnd = section.endBar;

  return {
    task: target.task,
    taskId: target.id,
    seed: target.seed,
    instrument: target.instrument,
    role: target.role,
    section,
    phrases,
    globalPlan: layers.globalPlan,
    budgetWindows: layers.budgetWindows.filter(
      (w) => w.endBar >= currentStart && w.startBar <= currentEnd,
    ),
    transitions: layers.transitions.filter(
      (t) => t.toSection === target.sectionName || t.fromSection === target.sectionName,
    ),
    context: {
      previousBars: sliceContext(songModel, currentStart - CONTEXT_BARS, currentStart - 1, totalBars),
      currentBars: sliceContext(songModel, currentStart, currentEnd, totalBars),
      nextBars: sliceContext(songModel, currentEnd + 1, currentEnd + CONTEXT_BARS, totalBars),
    },
    existingParts,
    styleFingerprint: map?.styleFingerprint ?? {
      status: "not_available", reason: "no musical map", derivedFrom: [], method: "n/a",
      tempoBand: null, meterFamily: null, harmonicComplexity: null, rhythmicComplexity: null,
      sectionContrast: null, instrumentPaletteHints: [], orchestrationSize: null,
    },
    constraints: {
      playableRange: definition?.playableRange ?? { min: 0, max: 127 },
      comfortableRange: definition?.comfortableRange ?? { min: 0, max: 127 },
      maxLeap: definition?.constraints.maxLeap ?? 24,
      maxSimultaneousNotes: definition?.constraints.maxSimultaneousNotes ?? 8,
      minNoteDuration: definition?.constraints.minNoteDuration ?? 0.05,
      physicalRules: PHYSICAL_RULES[definition?.family ?? ""] ?? [],
    },
  };
}

function safeDefinition(instrument: string, role: InstrumentArrangementRole) {
  try {
    return getInstrumentDefinition(instrument, role);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convenience: build the whole plan from a song model
// ---------------------------------------------------------------------------

export function planPartComposition(
  songModel: SongModelData,
  options: { now?: Date } = {},
): {
  plan: PartComposerPlan;
  layers: {
    globalPlan: GlobalArrangementPlan;
    sectionPlan: SectionPhrasePlan;
    budgetWindows: OrchestrationBudgetWindow[];
    transitions: TransitionPlan[];
  };
} {
  const now = options.now ?? new Date(0);
  const globalPlan = deriveGlobalArrangementPlan(songModel, { now });
  const sectionPlan = deriveSectionPhrasePlan(songModel, globalPlan, { now });
  const budget = deriveOrchestrationBudget(songModel, sectionPlan, { now });
  const transitions = deriveTransitionPlan(songModel, globalPlan, sectionPlan, { now }).transitions;
  return {
    plan: buildPartComposerPlan(songModel, globalPlan, sectionPlan, transitions, { now }),
    layers: { globalPlan, sectionPlan, budgetWindows: budget.windows, transitions },
  };
}
