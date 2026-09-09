/**
 * Planning supervision vs the platform's own derivers (PR-78).
 *
 * The platform plans from a Song Model — sections, an energy curve, chords,
 * a melody, beats and stems — through `deriveGlobalArrangementPlan`,
 * `deriveSectionPhrasePlan` and `deriveTransitionPlan`. A human score has
 * none of those fields, so this module **builds a Song Model from the score**
 * (with the section names and the per-bar energy proxy the extractor
 * computed) and runs the derivers on it. The comparison then asks: on the
 * same human piece, where does the platform's rule agree with what the human
 * did, and where does it not?
 *
 * Read the numbers with their construction in mind:
 *
 *  - **energy** — the Song Model's energy curve *is* the extractor's per-bar
 *    proxy, so the planner's section energy is a bar-weighted mean of the same
 *    quantity. Agreement is expected and says only that the plumbing works.
 *  - **density** — the planner's density is melody + bass onsets per bar
 *    (`rhythm.rhythmicDensity`) over the section maximum; the human's is
 *    all-family onsets. Disagreement here is a real difference of definition.
 *  - **families** — the section planner keeps 2…N palette families by
 *    planned energy in tier order (drums, bass, keys, guitar, …), and the
 *    palette itself seeds drums + bass + keys for any medium/dense stem set.
 *    Comparing with the families the human actually used is the substantive
 *    test of the rule.
 *  - **novelty** — the planner's is |Δenergy| × 0.6 + 0.4 × (role changed);
 *    the human's is 1 − aligned self-similarity to the previous section.
 *  - **roles** — the planner classifies by section *name*, and the names come
 *    from the extractor's heuristic, so role agreement is 1 by construction
 *    and is not reported as a finding.
 */
import type { SongModelData, TransitionPlan } from "@workspace/db";
import { estimateChords, type BarSpan, type ChordCandidateNote } from "./chordsFromNotes";
import { fractionalBar, skylineMelody, type FormInput } from "./formSegmentation";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveMusicalMap } from "./songMusicalMap";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveTransitionPlan } from "./transitionEngine";
import { platformFamilyOf, type PlanningSupervision } from "./planningSupervision";

export const PLANNING_AGREEMENT_VERSION = "PLANNING_AGREEMENT_v1" as const;

const round = (v: number, d = 4): number => Number(v.toFixed(d));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (values: readonly number[]): number => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

function pearson(a: readonly number[], b: readonly number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i += 1) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? round(cov / Math.sqrt(va * vb)) : null;
}

/** Beats per bar of a "n/d" metre; 4 when unreadable. */
export function beatsPerBar(metre: string): number {
  const [n, d] = metre.split("/").map(Number);
  return n > 0 && d > 0 ? n * (4 / d) : 4;
}

/** Per-bar energy in the extractor's own terms: cbrt(onsets × velocity × register width), each ÷ piece max. */
export function perBarEnergy(input: FormInput): number[] {
  const barCount = input.barStarts.length;
  const onsets = new Array<number>(barCount).fill(0);
  const velocity = new Array<number>(barCount).fill(0);
  const low = new Array<number>(barCount).fill(Infinity);
  const high = new Array<number>(barCount).fill(-Infinity);
  for (const track of input.tracks) {
    for (const note of track.notes) {
      if (note.start >= input.end) continue;
      const bar = Math.min(barCount - 1, Math.floor(fractionalBar(input, note.start)));
      onsets[bar] += 1;
      velocity[bar] += note.velocity;
      if (!track.isPercussion) { low[bar] = Math.min(low[bar], note.pitch); high[bar] = Math.max(high[bar], note.pitch); }
    }
  }
  const width = onsets.map((_, b) => (high[b] >= low[b] ? Math.max(12, high[b] - low[b]) : 12));
  const maxOnsets = Math.max(1e-9, ...onsets);
  const maxVelocity = Math.max(1e-9, ...onsets.map((n, b) => (n ? velocity[b] / n : 0)));
  const maxWidth = Math.max(12, ...width);
  return onsets.map((n, b) => round(Math.cbrt(clamp01(n / maxOnsets) * clamp01((n ? velocity[b] / n : 0) / maxVelocity) * clamp01(width[b] / maxWidth)), 3));
}

export type ScoreModelOptions = {
  bpm?: number;
  /** Per-bar seconds are uniform: the platform timeline follows one metre, as the admitted works do. */
  metre?: string;
  now?: Date;
};

/**
 * A Canonical Song Model V2 built from a score and its extracted plan. Every
 * field is filled from the notes or left empty and stated; nothing is
 * invented. Sections carry the extractor's names (so the planner's role
 * classifier sees them) and its energy.
 */
export function songModelFromScore(input: FormInput, plan: PlanningSupervision, options: ScoreModelOptions = {}): SongModelData {
  const bpm = options.bpm && options.bpm >= 20 && options.bpm <= 400 ? options.bpm : 120;
  const metre = options.metre ?? (plan.checks.metre.dominant === "unknown" ? "4/4" : plan.checks.metre.dominant);
  const beats = beatsPerBar(metre);
  const secondsPerBar = beats * (60 / bpm);
  const barCount = input.barStarts.length;
  const duration = barCount * secondsPerBar;
  const seconds = (t: number): number => fractionalBar(input, Math.min(t, input.end)) * secondsPerBar;

  const melody = skylineMelody(input).map((n) => ({
    start: round(seconds(n.start), 4), end: round(Math.max(seconds(n.start) + 0.01, seconds(n.end)), 4), pitch: n.pitch, velocity: 90, confidence: 0.8, source: "score",
  }));
  // Bass evidence: the bass family when the score has one, else the family with the lowest register centre.
  const pitchedFamilies = plan.families.filter((f) => f !== "drums");
  const centreOf = (family: string): number => {
    const notes = input.tracks.filter((t) => t.family === family && !t.isPercussion).flatMap((t) => t.notes);
    return notes.length ? mean(notes.map((n) => n.pitch)) : Infinity;
  };
  const bassFamily = pitchedFamilies.includes("bass") ? "bass" : pitchedFamilies.sort((a, b) => centreOf(a) - centreOf(b))[0] ?? null;
  const bass = bassFamily
    ? input.tracks.filter((t) => t.family === bassFamily).flatMap((t) => t.notes).sort((a, b) => a.start - b.start)
        .map((n) => ({ start: round(seconds(n.start), 4), end: round(Math.max(seconds(n.start) + 0.01, seconds(n.end)), 4), pitch: n.pitch, confidence: 0.8, provider: "score" }))
    : [];

  const chordNotes: ChordCandidateNote[] = input.tracks.filter((t) => !t.isPercussion).flatMap((t) => t.notes)
    .map((n) => ({ start: seconds(n.start), end: Math.max(seconds(n.start) + 0.01, seconds(n.end)), pitch: n.pitch }));
  const spans: BarSpan[] = Array.from({ length: barCount }, (_, i) => ({ bar: i, start: i * secondsPerBar, end: (i + 1) * secondsPerBar }));
  const chords = estimateChords(chordNotes, spans).map((c) => ({
    start: round(c.start, 4), end: round(c.end, 4), symbol: c.symbol, roman: "", confidence: c.confidence, root: c.root, quality: c.quality,
  }));

  const energy = perBarEnergy(input);
  const bars = spans.map((s) => ({ bar: s.bar + 1, start: round(s.start, 4), end: round(s.end, 4), beats, confidence: 1 }));
  const beatList = spans.flatMap((s) => Array.from({ length: Math.max(1, Math.round(beats)) }, (_, k) => ({
    time: round(s.start + (k * secondsPerBar) / Math.max(1, Math.round(beats)), 4), beat: k + 1, bar: s.bar + 1, confidence: 1,
  })));
  const stems = plan.families.map((family) => ({ name: family, role: platformFamilyOf(family), source: "score", channels: 1, confidence: 1 }));

  const model: SongModelData = {
    contractVersion: "2.0",
    timebase: { ppq: 960, originSeconds: 0, coordinateSystem: "seconds+ticks" },
    audio: {
      name: `${plan.workId}.mid`, contentType: "audio/midi", size: 0, durationSeconds: round(duration, 4), sampleRate: 44_100, channels: 1,
      proxyObjectPath: null, proxyContentType: null, analysisStartSeconds: 0, analysisDurationSeconds: round(duration, 4), analysisCoverage: "full",
    },
    analysisStartSeconds: 0, analysisDurationSeconds: round(duration, 4), analysisCoverage: 1,
    tempoMap: [{ time: 0, bpm, confidence: 0.9 }],
    meterMap: [{ bar: 1, meter: metre, confidence: 0.9 }],
    keyMap: [{ time: 0, key: plan.key ?? "C major", confidence: plan.key ? (plan.keyConfidence ?? 0.5) : 0 }],
    melody, bass, chords,
    sections: plan.sectionPlans.map((sp) => ({ name: sp.sectionName, startBar: sp.startBar, endBar: sp.endBar, energy: sp.energy })),
    energy, beats: beatList, bars,
    dynamics: [], waveform: [], stems, sourceStems: [],
    lyrics: [], confidenceByField: {}, providerProvenance: [],
    validation: { status: "accepted", issues: [] },
    fusion: { selectedProvider: "score", confidence: 1, decisions: [] },
  };
  model.musicalMap = deriveMusicalMap(model, { now: options.now });
  return model;
}

export type SectionAgreementRow = {
  section: string;
  human: { energy: number; density: number; novelty: number; families: string[]; transitionIn: TransitionPlan["kind"] | null };
  platform: { energy: number; density: number; novelty: number; families: string[]; transitionIn: TransitionPlan["kind"] | null };
  familyJaccard: number;
  plannerAddsFamilies: string[];
  plannerDropsFamilies: string[];
};

export type PlannerAgreement = {
  version: typeof PLANNING_AGREEMENT_VERSION;
  workId: string;
  sections: number;
  rows: SectionAgreementRow[];
  energy: { meanAbsDiff: number; pearson: number | null };
  density: { meanAbsDiff: number; pearson: number | null };
  novelty: { meanAbsDiff: number; pearson: number | null };
  families: {
    meanJaccard: number;
    /** Share of sections whose platform family set equals the human's (after mapping). */
    exactMatchShare: number;
    /** Share of sections where the planner keeps every family the human used. */
    plannerCoversHumanShare: number;
    /** Families the planner put in that the human never used anywhere in the piece, with counts over sections. */
    addedNeverUsed: Record<string, number>;
    humanFamiliesPerSection: number;
    platformFamiliesPerSection: number;
  };
  climaxAgrees: boolean;
  orchestrationStrategy: { human: string; platform: string; agrees: boolean };
  transitions: { compared: number; kindAgreementShare: number | null };
  palette: string[];
  notes: string[];
};

/** Run the platform's derivers on `model` and compare them with the human plan. */
export function compareWithPlatformPlanners(plan: PlanningSupervision, model: SongModelData, options: { now?: Date } = {}): PlannerAgreement {
  const globalPlan = deriveGlobalArrangementPlan(model, { now: options.now });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: options.now });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: options.now });
  const humanFamiliesUsed = new Set(plan.platformFamilies);
  const addedNeverUsed: Record<string, number> = {};

  const rows: SectionAgreementRow[] = plan.sectionPlans.map((human, i) => {
    const target = globalPlan.sectionTargets.find((t) => t.sectionName === human.sectionName) ?? globalPlan.sectionTargets[i];
    const derived = sectionPlan.sections.find((s) => s.sectionName === human.sectionName) ?? sectionPlan.sections[i];
    const humanSet = new Set(human.activeInstrumentFamilies);
    const platformSet = new Set(derived?.activeInstrumentFamilies ?? []);
    const union = new Set([...humanSet, ...platformSet]);
    const inter = [...humanSet].filter((f) => platformSet.has(f));
    const adds = [...platformSet].filter((f) => !humanSet.has(f)).sort();
    for (const f of adds) if (!humanFamiliesUsed.has(f)) addedNeverUsed[f] = (addedNeverUsed[f] ?? 0) + 1;
    const humanTransition = i > 0 ? plan.transitions[i - 1].kind : null;
    const platformTransition = i > 0 ? transitionPlan.transitions.find((t) => t.toSection === human.sectionName)?.kind ?? null : null;
    return {
      section: human.sectionName,
      human: { energy: human.energy, density: human.density, novelty: human.noveltyRelativeToPreviousSection, families: [...humanSet].sort(), transitionIn: humanTransition },
      platform: {
        energy: target?.energy ?? 0, density: target?.density ?? 0, novelty: target?.noveltyVsPrevious ?? 0,
        families: [...platformSet].sort(), transitionIn: platformTransition,
      },
      familyJaccard: union.size ? round(inter.length / union.size) : 1,
      plannerAddsFamilies: adds,
      plannerDropsFamilies: [...humanSet].filter((f) => !platformSet.has(f)).sort(),
    };
  });

  const diff = (pick: (r: SectionAgreementRow) => [number, number]) => {
    const pairs = rows.map(pick);
    return { meanAbsDiff: round(mean(pairs.map(([a, b]) => Math.abs(a - b)))), pearson: pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1])) };
  };
  // The first section's novelty is 1 for the planner and 0 for the human by definition; compare from the second on.
  const noveltyRows = rows.slice(1);
  const novelty = noveltyRows.length
    ? { meanAbsDiff: round(mean(noveltyRows.map((r) => Math.abs(r.human.novelty - r.platform.novelty)))), pearson: pearson(noveltyRows.map((r) => r.human.novelty), noveltyRows.map((r) => r.platform.novelty)) }
    : { meanAbsDiff: 0, pearson: null };
  const transitionsCompared = rows.filter((r) => r.human.transitionIn && r.platform.transitionIn);
  const humanClimax = plan.globalTargets.climax?.sectionName ?? null;
  const platformClimax = globalPlan.climax?.sectionName ?? null;
  const humanStrategy = plan.globalTargets.orchestrationStrategy;

  return {
    version: PLANNING_AGREEMENT_VERSION,
    workId: plan.workId,
    sections: rows.length,
    rows,
    energy: diff((r) => [r.human.energy, r.platform.energy]),
    density: diff((r) => [r.human.density, r.platform.density]),
    novelty,
    families: {
      meanJaccard: round(mean(rows.map((r) => r.familyJaccard))),
      exactMatchShare: round(rows.filter((r) => r.familyJaccard === 1).length / Math.max(1, rows.length)),
      plannerCoversHumanShare: round(rows.filter((r) => r.plannerDropsFamilies.length === 0).length / Math.max(1, rows.length)),
      addedNeverUsed,
      humanFamiliesPerSection: round(mean(rows.map((r) => r.human.families.length)), 2),
      platformFamiliesPerSection: round(mean(rows.map((r) => r.platform.families.length)), 2),
    },
    climaxAgrees: humanClimax !== null && humanClimax === platformClimax,
    orchestrationStrategy: { human: humanStrategy, platform: globalPlan.orchestrationStrategy, agrees: humanStrategy === globalPlan.orchestrationStrategy },
    transitions: {
      compared: transitionsCompared.length,
      kindAgreementShare: transitionsCompared.length ? round(transitionsCompared.filter((r) => r.human.transitionIn === r.platform.transitionIn).length / transitionsCompared.length) : null,
    },
    palette: globalPlan.instrumentPalette.map((p) => p.role),
    notes: [
      "energy: the model's energy curve is the extractor's per-bar proxy, so agreement is expected by construction",
      "density: planner = melody + bass onsets per bar over the section maximum; human = all-family onsets over the piece maximum",
      "families: planner keeps 2…N palette families by energy in tier order; palette seeds drums/bass/keys for a medium or dense stem set",
      "roles: classified from the extractor's own section names — agreement by construction, not reported",
    ],
  };
}
