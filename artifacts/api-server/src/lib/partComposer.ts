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
 *
 * Brain B-01: a LEAD family in a sung section keeps its harmonic-bed task
 * instead of writing nothing; `ensemble` pickups are given to a real family of
 * the section; a family with no instrument definition is excluded with a
 * reason rather than silently becoming a piano; and every request carries the
 * arc's intent and the form memory (occurrence, previous occurrence, operator).
 */
import { createHash } from "node:crypto";
import type {
  ArcDynamicMarking,
  ArcTensionRole,
  ArcTextureLevel,
  ChordHarmonyEvent,
  CritiqueFinding,
  GlobalArrangementPlan,
  InstrumentArrangementRole,
  MusicalNote,
  OrchestrationBudgetWindow,
  PartComposerPlan,
  PartTask,
  PhrasePlan,
  PreviousOccurrenceSummary,
  SectionDevelopmentOperator,
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
import { canonicalFamily, isNonFamilyHint, NON_FAMILY_HINT_REASONS } from "./arrangementArc";

/** "1.1" since Brain B-01 (LEAD-in-sung-section, ensemble / mix resolution). */
export const PART_COMPOSER_PLAN_VERSION = "1.1" as const;
const METHOD = "part-composer/v1.1";

// ---------------------------------------------------------------------------
// role/instrument → task
// ---------------------------------------------------------------------------

/** The accompaniment task a family plays when it is not leading. */
function bedTaskFor(instrument: string, style: string): PartTask {
  const guitar = /electric|dist|lead/i.test(style) ? "ELECTRIC_GUITAR" : "ACOUSTIC_GUITAR";
  const family = canonicalFamily(instrument);
  return family === "guitar" ? (guitar as PartTask)
    : family === "strings" ? "STRINGS"
    : family === "pads" || family === "synth" ? "PAD"
    : family === "brass" ? "BRASS"
    : family === "winds" ? "WOODWINDS"
    : instrument === "piano" ? "PIANO" : "KEYS";
}

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
      // A sung lead is not composed here. An instrumental lead is; and a
      // family marked LEAD in a sung section (a plan from before B-01, or a
      // caller's own plan) still plays its harmonic bed rather than nothing -
      // the owner's piano was silent for whole sections because of this null.
      if (sectionFunction !== "instrumental") return bedTaskFor(instrument, style);
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

/**
 * A family whose instrument definition is the piano fallback although it is
 * not a keyboard: writing it would silently put a piano where the plan says
 * `winds` (or `ensemble`, or `mix`). B-03 owns real profiles; until then such
 * a part is excluded with its reason, never faked.
 */
function lacksDefinition(instrument: string, role: InstrumentArrangementRole): boolean {
  const family = canonicalFamily(instrument);
  if (family === "keys") return false;
  try {
    return getInstrumentDefinition(instrument, NAMED_FAMILIES.has(family) ? "" : role).id === "piano";
  } catch {
    return true;
  }
}

export function buildPartComposerPlan(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan,
  sectionPlan: SectionPhrasePlan,
  transitions: TransitionPlan[],
  options: { now?: Date } = {},
): PartComposerPlan {
  const tasks: PartComposerPlan["tasks"] = [];
  const decisions: NonNullable<PartComposerPlan["decisions"]> = [];
  const idsBySectionTier = new Map<string, string[]>();
  const sectionByName = new Map(sectionPlan.sections.map((s) => [s.sectionName, s]));

  /**
   * The pre-B-01 plan gave intro chords, ending hits and transition pickups to
   * an instrument called `ensemble`, which resolved to a piano nobody planned.
   * Handing the figure to a real family of the section instead put it on top
   * of that family's own chord at the same instant and broke its polyphony
   * (measured: the keys track failed the runner's contract). Until stream
   * B-04 realises transition devices per family, the figure is left out and
   * the decision is recorded; the drum fill still marks the boundary.
   */
  const ensembleCarrier = (id: string, sectionNames: string[]): string | null => {
    const sectionName = sectionNames[0];
    const active = sectionByName.get(sectionName)?.activeInstrumentFamilies ?? [];
    decisions.push({
      kind: "excluded_no_definition", sectionName, instrument: "ensemble",
      reason: `${id}: "ensemble" is not an instrument and would resolve to a piano; the families of "${sectionName}" (${active.join(", ") || "none"}) already state the harmony there and cannot also play the figure within their polyphony - left out until transition devices are realised per family (B-04)`,
    });
    return null;
  };

  for (const section of sectionPlan.sections) {
    const roles = sectionPlan.roleAssignments.filter((r) => r.sectionName === section.sectionName);
    for (const assignment of roles) {
      if (isNonFamilyHint(assignment.instrument)) {
        decisions.push({
          kind: "excluded_non_family", sectionName: section.sectionName, instrument: assignment.instrument,
          reason: NON_FAMILY_HINT_REASONS[canonicalFamily(assignment.instrument)],
        });
        continue;
      }
      if (lacksDefinition(assignment.instrument, assignment.role)) {
        decisions.push({
          kind: "excluded_no_definition", sectionName: section.sectionName, instrument: assignment.instrument,
          reason: `no instrument definition for "${assignment.instrument}": it would silently resolve to a piano (instrument profiles are stream B-03)`,
        });
        continue;
      }
      const task = taskFor(assignment.role, assignment.instrument, section.function, globalPlan.style);
      if (!task) continue;
      const leadKeptAsBed = assignment.role === "LEAD" && section.function !== "instrumental";
      const role: InstrumentArrangementRole = leadKeptAsBed ? "HARMONIC_BED" : assignment.role;
      if (leadKeptAsBed) {
        decisions.push({
          kind: "lead_kept_as_bed", sectionName: section.sectionName, instrument: assignment.instrument,
          reason: `LEAD in a sung section (${section.leadRoleSource ?? "plan"}): the family keeps its ${task} bed task instead of writing nothing`,
        });
      }
      const id = `part-${section.sectionName}-${assignment.instrument}-${assignment.role}`
        .replace(/\s+/g, "_");
      const tierKey = `${section.sectionName}:${TASK_TIER[task]}`;
      idsBySectionTier.set(tierKey, [...(idsBySectionTier.get(tierKey) ?? []), id]);
      tasks.push({
        id,
        task,
        sectionName: section.sectionName,
        instrument: assignment.instrument,
        role,
        startBar: assignment.entryBar,
        endBar: assignment.exitBar,
        seed: seedFor(songModel, id),
        dependsOn: [],
      });
    }
    if (section.function === "intro") {
      const id = `part-${section.sectionName}-intro`.replace(/\s+/g, "_");
      const carrier = ensembleCarrier(id, [section.sectionName]);
      if (carrier) {
        tasks.push({
          id, task: "INTRO", sectionName: section.sectionName, instrument: carrier,
          role: "TRANSITION", startBar: section.startBar, endBar: section.endBar,
          seed: seedFor(songModel, id), dependsOn: [],
        });
      }
    }
    if (section.function === "outro") {
      const id = `part-${section.sectionName}-ending`.replace(/\s+/g, "_");
      const carrier = ensembleCarrier(id, [section.sectionName]);
      if (carrier) {
        tasks.push({
          id, task: "ENDING", sectionName: section.sectionName, instrument: carrier,
          role: "TRANSITION", startBar: section.startBar, endBar: section.endBar,
          seed: seedFor(songModel, id), dependsOn: [],
        });
      }
    }
  }

  for (const transition of transitions) {
    if (transition.devices.length === 0) continue;
    const id = `part-transition-${transition.id}`;
    // The pickup belongs to a family that is playing where it lands.
    const carrier = ensembleCarrier(id, [transition.toSection, transition.fromSection]);
    if (!carrier) continue;
    tasks.push({
      id, task: "TRANSITION", sectionName: transition.toSection, instrument: carrier,
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
    ...(decisions.length ? { decisions } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hard rule: a planned family that produced no notes in a mandatory section
// ---------------------------------------------------------------------------

/** Section functions in which a planned family must be heard. */
const MANDATORY_FUNCTIONS = new Set<SectionPlan["function"]>(["verse", "prechorus", "chorus", "bridge"]);

/**
 * Pure hard-rule check (Brain B-01): every family the section plan keeps
 * active in a verse / pre-chorus / chorus / bridge, and for which the part plan
 * emitted at least one task, must have written at least one note whose onset
 * falls inside that section. A family the part plan excluded with a reason is
 * reported as a warning (the plan said so), a tasked family with zero notes as
 * an error. The orchestrator wiring of this finding belongs to stream B-00;
 * this function is the rule and its test.
 */
export function silentPlannedFamilyFindings(
  songModel: SongModelData,
  plan: { sectionPlan: SectionPhrasePlan; partComposerPlan?: PartComposerPlan },
  trackModels: ReadonlyArray<{ instrument: string; notes: ReadonlyArray<Pick<MusicalNote, "start">> }>,
): CritiqueFinding[] {
  const findings: CritiqueFinding[] = [];
  const totalBars = Math.max(1, plan.sectionPlan.sections.at(-1)?.endBar ?? 1);
  const tasks = plan.partComposerPlan?.tasks ?? [];
  const excluded = plan.partComposerPlan?.decisions?.filter((d) => d.kind.startsWith("excluded")) ?? [];
  for (const section of plan.sectionPlan.sections) {
    if (!MANDATORY_FUNCTIONS.has(section.function)) continue;
    const start = barBounds(songModel, section.startBar, totalBars).start;
    const end = barBounds(songModel, section.endBar, totalBars).end;
    for (const family of section.activeInstrumentFamilies) {
      const canonical = canonicalFamily(family);
      const tasked = tasks.some((t) => t.sectionName === section.sectionName && canonicalFamily(t.instrument) === canonical);
      const exclusion = excluded.find((d) => d.sectionName === section.sectionName && canonicalFamily(d.instrument) === canonical);
      if (!tasked) {
        findings.push({
          dimension: "hardRule", severity: "warning", sectionName: section.sectionName, instrument: family,
          startBar: section.startBar, endBar: section.endBar,
          message: exclusion
            ? `Planned family "${family}" is excluded from "${section.sectionName}": ${exclusion.reason}.`
            : `Planned family "${family}" has no part task in "${section.sectionName}".`,
        });
        continue;
      }
      const notes = trackModels
        .filter((t) => canonicalFamily(t.instrument) === canonical)
        .reduce((sum, t) => sum + t.notes.filter((n) => n.start >= start - 1e-6 && n.start < end - 1e-6).length, 0);
      if (notes === 0) {
        findings.push({
          dimension: "hardRule", severity: "error", sectionName: section.sectionName, instrument: family,
          startBar: section.startBar, endBar: section.endBar,
          message: `Planned family "${family}" produced zero notes in mandatory section "${section.sectionName}".`,
        });
      }
    }
  }
  return findings;
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
  /**
   * Brain B-01: the bars this part actually covers (a family may enter after
   * the section starts or leave before it ends). `section.startBar/endBar`
   * remain the section's bounds. A composer that ignores this window writes
   * the whole section - which is what the reference composer still does.
   */
  partWindow: { startBar: number; endBar: number };
  /** Brain B-01: the arc's intent for this section, so a generator can shape rather than fill. */
  arcIntent: {
    dynamic: ArcDynamicMarking;
    /** 0..1 intended level (= `section.energy`). */
    level: number;
    texture: ArcTextureLevel;
    tensionRole: ArcTensionRole;
  } | null;
  /**
   * Brain B-01: form memory. Which statement of this section function this is,
   * what the previous statement said, and the development operator the arc
   * chose for this repeat. The reference composer does not realise operators
   * yet (INTEGRATED-pending); the plan-level effects (added layer, register
   * band, counter-line / comping roles) already reach it through the roles.
   */
  formMemory: {
    occurrenceIndex: number;
    occurrenceCount: number;
    developmentOperator: SectionDevelopmentOperator;
    previousOccurrenceSummary: PreviousOccurrenceSummary | null;
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
    partWindow: {
      startBar: Math.max(currentStart, Math.min(currentEnd, target.startBar)),
      endBar: Math.max(currentStart, Math.min(currentEnd, target.endBar)),
    },
    arcIntent: section.intendedDynamic && section.textureLevel && section.tensionRole
      ? {
          dynamic: section.intendedDynamic,
          level: section.energy,
          texture: section.textureLevel,
          tensionRole: section.tensionRole,
        }
      : null,
    formMemory: {
      occurrenceIndex: section.occurrenceIndex ?? 0,
      occurrenceCount: section.occurrenceCount ?? 1,
      developmentOperator: section.developmentOperator ?? "identity",
      previousOccurrenceSummary: section.previousOccurrenceSummary ?? null,
    },
  };
}

/**
 * Families whose name settles the instrument on its own. `getInstrumentDefinition`
 * consults the role only when the name names no family, but its family-word
 * list has no keyboard word, so "keys" in a RHYTHMIC_HARMONY role resolved to
 * the *drum kit* (range 35-81, four voices) and the piano part was composed
 * and constrained as a kit. For a named family the role is withheld here; the
 * one-line fix in `musicEngines.ts` (`FAMILY_WORDS` + key / piano / organ)
 * belongs to stream B-03 and is listed in the B-01 report.
 */
const NAMED_FAMILIES = new Set(["keys", "guitar", "bass", "drums", "percussion", "strings", "pads", "synth", "brass", "winds"]);

function safeDefinition(instrument: string, role: InstrumentArrangementRole) {
  try {
    return getInstrumentDefinition(instrument, NAMED_FAMILIES.has(canonicalFamily(instrument)) ? "" : role);
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
