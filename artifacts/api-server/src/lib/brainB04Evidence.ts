/**
 * Brain B-04 evidence generator (not a test; run through
 * `scripts/brain-b04-groove-evidence.mjs`, or bundle and run directly).
 *
 * Measures what the stream claims to change, on the nine synthetic benchmark
 * cases plus the owner's song fixture:
 *   - interlocking: kick/bass onset agreement per section (composed notes,
 *     30 ms tolerance), and percussion / ostinato against the kick;
 *   - hat subdivision rate per case (strikes per second) - the tempo-awareness
 *     claim;
 *   - meter correctness: composer bar length vs the Song Model's bar, and any
 *     kit onset falling on a beat the bar does not have;
 *   - the adversarial critic's `machineMade`, `causality` and `arbitrariness`
 *     penalties on the orchestrated (performed, repaired) single candidate;
 *   - playability-repair counts of that candidate.
 *
 * `B04_MODE=before` was run against `a751796` (main before this stream) to
 * produce the "before" half embedded in
 * `docs/evidence/brain-b04-groove-and-transitions.json`; the same module
 * produces the "after" half. Prints one JSON document to stdout.
 */
import type { MusicalNote, SongModelData, TrackModel } from "@workspace/db";
import { BENCHMARK_CORPUS, buildBenchmarkSongModel, type BenchmarkCase } from "./benchmarkCorpus";
import { rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";
import { orchestrateArrangement } from "./arrangementOrchestrator";
import { composeReferencePart } from "./referencePartComposer";
import { deriveGlobalArrangementPlan } from "./globalArrangementPlanner";
import { deriveSectionPhrasePlan } from "./sectionPhrasePlanner";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { buildPartComposerPlan, buildPartGenerationRequest, type PartGenerationRequest } from "./partComposer";
import { critiqueMachineMade } from "./critics/adversarial/machineMade";
import { critiqueCausality } from "./critics/adversarial/causality";
import { critiqueArbitrariness } from "./critics/adversarial/arbitrariness";
import { penaltyOf } from "./critics/adversarial/shared";
import type { CriticInput } from "./critics/types";
import { readFileSync } from "node:fs";
import { barTiming, type ComposeFrame } from "./composer/frame";
import { registerBounds, voiceNear } from "./composer/registers";
import { rootPitchClass } from "./composer/harmonyParts";
import { barsOf, bassRhythmFor, compingRhythmFor, grooveOf } from "./composer/rhythmParts";
import { deriveGroovePlan } from "./groovePlan";
import { inRest, transitionGesturesFor, type FamilyKey } from "./transitionRealisation";

export const B04_EVIDENCE_NOW = new Date("2026-09-10T00:00:00.000Z");
const TOLERANCE = 0.03;
const r3 = (v: number) => Number(v.toFixed(3));

export type ComposedPart = { request: PartGenerationRequest; notes: MusicalNote[] };

export type ComposedSong = {
  id: string;
  model: SongModelData;
  tempoBpm: number;
  meter: string;
  parts: ComposedPart[];
  layers: ReturnType<typeof layersFor>;
};

function layersFor(model: SongModelData) {
  const globalPlan = deriveGlobalArrangementPlan(model, { now: B04_EVIDENCE_NOW });
  const sectionPlan = deriveSectionPhrasePlan(model, globalPlan, { now: B04_EVIDENCE_NOW });
  const budget = deriveOrchestrationBudget(model, sectionPlan, { now: B04_EVIDENCE_NOW });
  const transitionPlan = deriveTransitionPlan(model, globalPlan, sectionPlan, { now: B04_EVIDENCE_NOW });
  const partPlan = buildPartComposerPlan(model, globalPlan, sectionPlan, transitionPlan.transitions, { now: B04_EVIDENCE_NOW });
  return { globalPlan, sectionPlan, budgetWindows: budget.windows, transitions: transitionPlan.transitions, transitionPlan, partPlan };
}

/** Every part of a Song Model composed by the reference composer, with its request. */
export function composeSong(id: string, model: SongModelData): ComposedSong {
  const layers = layersFor(model);
  const tempoBpm = model.tempoMap[0].bpm;
  const meter = model.meterMap[0].meter;
  const parts = layers.partPlan.tasks.map((task) => {
    const request = buildPartGenerationRequest(model, task, layers, []);
    return { request, notes: composeReferencePart(request, { tempoBpm, meter }) };
  });
  return { id, model, tempoBpm, meter, parts, layers };
}

export function corpusSongs(): ComposedSong[] {
  const songs = BENCHMARK_CORPUS.map((spec) => composeSong(spec.id, buildBenchmarkSongModel(spec)));
  songs.push(composeSong("owner-rachem-na", rachemNaSongModel()));
  return songs;
}

/** The corpus specs re-metred, so every non-4/4 meter has corpus-like models. */
export function meterVariants(): Array<{ base: string; meter: string; spec: BenchmarkCase }> {
  const out: Array<{ base: string; meter: string; spec: BenchmarkCase }> = [];
  const pairs: Array<[string, string]> = [["pop-full", "3/4"], ["pop-full", "6/8"], ["rock-full", "5/4"], ["jazz-full", "7/8"], ["ballad-piano-vocal", "6/8"], ["dance-full", "7/8"], ["acoustic-demo", "5/4"]];
  for (const [base, meter] of pairs) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === base)!;
    out.push({ base, meter, spec: { ...spec, id: `${base}@${meter.replace("/", "-")}`, meter } });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metrics on composed parts
// ---------------------------------------------------------------------------

function onsetsOf(notes: readonly MusicalNote[], filter?: (n: MusicalNote) => boolean): number[] {
  const set = new Set<number>();
  for (const n of notes) if (!filter || filter(n)) set.add(Math.round(n.start * 1000));
  return [...set].sort((a, b) => a - b).map((ms) => ms / 1000);
}

function matched(a: number[], b: number[]): number {
  let count = 0;
  for (const t of a) if (b.some((u) => Math.abs(u - t) <= TOLERANCE)) count += 1;
  return count;
}

export type InterlockRow = {
  song: string; section: string; role: string | null;
  kicks: number; bassOnsets: number;
  /** Share of kick onsets that a bass onset coincides with. */
  kickToBass: number | null;
  /** Share of bass onsets that a kick coincides with. */
  bassToKick: number | null;
  /** Share of percussion onsets that land on a kick, snare or hat onset of the kit. */
  percussionOnKit: number | null;
  /** Share of ostinato onsets that coincide with a bass or kit onset. */
  ostinatoOnRhythmSection: number | null;
};

export function interlocking(song: ComposedSong, planRelation?: (sectionName: string) => string | null): InterlockRow[] {
  const rows: InterlockRow[] = [];
  for (const section of song.layers.sectionPlan.sections) {
    const of = (task: string) => song.parts.filter((p) => p.request.task === task && p.request.section.sectionName === section.sectionName).flatMap((p) => p.notes);
    const drums = of("DRUMS");
    const bass = of("BASS");
    const percussion = of("PERCUSSION");
    const ostinato = of("OSTINATO");
    if (!drums.length && !bass.length) continue;
    const kicks = onsetsOf(drums, (n) => n.pitch === 36 || n.pitch === 35);
    const kit = onsetsOf(drums);
    const bassOn = onsetsOf(bass);
    const perc = onsetsOf(percussion);
    const ost = onsetsOf(ostinato);
    const rhythmSection = onsetsOf([...drums, ...bass]);
    rows.push({
      song: song.id, section: section.sectionName, role: planRelation ? planRelation(section.sectionName) : null,
      kicks: kicks.length, bassOnsets: bassOn.length,
      kickToBass: kicks.length && bassOn.length ? r3(matched(kicks, bassOn) / kicks.length) : null,
      bassToKick: kicks.length && bassOn.length ? r3(matched(bassOn, kicks) / bassOn.length) : null,
      percussionOnKit: perc.length && kit.length ? r3(matched(perc, kit) / perc.length) : null,
      ostinatoOnRhythmSection: ost.length && rhythmSection.length ? r3(matched(ost, rhythmSection) / ost.length) : null,
    });
  }
  return rows;
}

export function hatRates(song: ComposedSong): { song: string; tempoBpm: number; meter: string; maxHatStrikesPerSecond: number | null; hatSubdivisionsPerBeat: number | null } {
  const drums = song.parts.filter((p) => p.request.task === "DRUMS").flatMap((p) => p.notes);
  const hats = onsetsOf(drums, (n) => n.pitch === 42 || n.pitch === 44 || n.pitch === 46 || n.pitch === 51);
  if (hats.length < 4) return { song: song.id, tempoBpm: song.tempoBpm, meter: song.meter, maxHatStrikesPerSecond: null, hatSubdivisionsPerBeat: null };
  let minGap = Infinity;
  for (let i = 1; i < hats.length; i += 1) minGap = Math.min(minGap, hats[i] - hats[i - 1]);
  const quarter = 60 / song.tempoBpm;
  return {
    song: song.id, tempoBpm: song.tempoBpm, meter: song.meter,
    maxHatStrikesPerSecond: r3(1 / minGap),
    hatSubdivisionsPerBeat: r3(quarter / minGap),
  };
}

export type MeterCheck = {
  song: string; meter: string; tempoBpm: number;
  songBarSeconds: number;
  /** Notes of any part whose onset falls outside the Song Model's bars of the part's own section. */
  notesOutsideSection: number; notes: number;
  kitOnsetsOutsideBar: number; kitOnsets: number;
  /** Beats (denominator units) of the template kicks and snares (ids `k<bar>-<unit>` / `s<bar>-<unit>`; fills, ghosts and endings excluded). */
  snareBeats: number[]; kickBeats: number[];
  familiesSilentInLaterSections: string[];
};

/** Bar length and kit placement checks for one composed song, read from the notes against the Song Model's bars. */
export function meterCheck(song: ComposedSong): MeterCheck {
  const bars = song.model.bars;
  const bar0 = bars[0];
  const songBar = bar0.end - bar0.start;
  const [num, den] = song.meter.split("/").map(Number);
  const unit = (60 / song.tempoBpm) * (4 / den);
  const drums = song.parts.filter((p) => p.request.task === "DRUMS").flatMap((p) => p.notes);
  let outsideSection = 0;
  let total = 0;
  for (const part of song.parts) {
    const start = bars.find((b) => b.bar === part.request.section.startBar)?.start ?? 0;
    const end = bars.find((b) => b.bar === part.request.section.endBar)?.end ?? Infinity;
    for (const n of part.notes) {
      total += 1;
      if (n.start < start - 1e-3 || n.start >= end + 1e-3) outsideSection += 1;
    }
  }
  let outside = 0;
  const snareBeats = new Set<number>();
  const kickBeats = new Set<number>();
  for (const n of drums) {
    let pos = ((n.start % songBar) + songBar) % songBar / unit;
    if (pos > num - 0.02) pos = 0;
    if (pos >= num - 0.01) outside += 1;
    if (n.pitch === 38 && /-s\d+-[\d.]+$/.test(n.id)) snareBeats.add(Math.round(pos * 4) / 4);
    if (n.pitch === 36 && /-k\d+-[\d.]+$/.test(n.id)) kickBeats.add(Math.round(pos * 4) / 4);
  }
  const sections = song.layers.sectionPlan.sections;
  const silent: string[] = [];
  for (const section of sections.slice(1)) {
    for (const part of song.parts.filter((p) => p.request.section.sectionName === section.sectionName)) {
      if (["BASS", "KEYS", "PIANO", "DRUMS"].includes(part.request.task) && part.notes.length === 0) silent.push(`${section.sectionName}:${part.request.task}`);
    }
  }
  return {
    song: song.id, meter: song.meter, tempoBpm: song.tempoBpm,
    songBarSeconds: r3(songBar),
    notesOutsideSection: outsideSection, notes: total,
    kitOnsetsOutsideBar: outside, kitOnsets: drums.length,
    snareBeats: [...snareBeats].sort((a, b) => a - b), kickBeats: [...kickBeats].sort((a, b) => a - b),
    familiesSilentInLaterSections: silent,
  };
}

// ---------------------------------------------------------------------------
// Orchestrated (performed) candidate: adversarial penalties + repairs
// ---------------------------------------------------------------------------

export type OrchestratedMeasure = {
  song: string; tracks: Array<{ id: string; notes: number }>; noteCount: number;
  machineMade: { score: number | null; penalty: number; kinds: string[] };
  causality: { score: number | null; penalty: number; kinds: string[] };
  arbitrariness: { score: number | null; penalty: number; kinds: string[] };
  playabilityRepairs: { tracks: number; rangeFolds: number; leapFolds: number; polyphonyReleases: number; durationLengthened: number; dropped: number };
  feasible: boolean;
  hardRuleReasons: string[];
};

export function orchestratedMeasure(id: string, model: SongModelData): OrchestratedMeasure {
  const result = orchestrateArrangement({ songModel: model, candidateCount: 1, render: false, now: B04_EVIDENCE_NOW });
  const candidate = result.candidates[0];
  const input: CriticInput = { songModel: model, plan: result.plan, trackModels: candidate.trackModels };
  const summarise = (report: ReturnType<typeof critiqueMachineMade>) => ({
    score: report.summary.score0to100, penalty: penaltyOf(report.observations),
    kinds: report.observations.map((o) => `${o.kind}[${o.severity}]@${o.location.startBar}-${o.location.endBar}:${o.location.trackIds.join("+")}`),
  });
  const repairs = candidate.playabilityRepairs;
  const sum = (key: "rangeFolds" | "leapFolds" | "polyphonyReleases" | "durationLengthened" | "dropped") => repairs.reduce((s, r) => s + r[key], 0);
  return {
    song: id,
    tracks: candidate.trackModels.map((t: TrackModel) => ({ id: t.id, notes: t.notes.length })),
    noteCount: candidate.noteCount,
    machineMade: summarise(critiqueMachineMade(input)),
    causality: summarise(critiqueCausality(input)),
    arbitrariness: summarise(critiqueArbitrariness(input)),
    playabilityRepairs: { tracks: repairs.length, rangeFolds: sum("rangeFolds"), leapFolds: sum("leapFolds"), polyphonyReleases: sum("polyphonyReleases"), durationLengthened: sum("durationLengthened"), dropped: sum("dropped") },
    feasible: candidate.hardRule.feasible,
    hardRuleReasons: candidate.hardRule.reasons,
  };
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function baseMeasures() {
  const songs = corpusSongs();
  const variants = meterVariants().map((v) => composeSong(v.spec.id, buildBenchmarkSongModel(v.spec)));
  const interlock = songs.flatMap((s) => interlocking(s));
  const mean = (values: Array<number | null>) => {
    const xs = values.filter((v): v is number => v !== null);
    return xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const orchestrated = [
    ...BENCHMARK_CORPUS.map((spec) => orchestratedMeasure(spec.id, buildBenchmarkSongModel(spec))),
    orchestratedMeasure("owner-rachem-na", rachemNaSongModel()),
  ];
  return {
    songs: songs.map((s) => ({
      id: s.id, tempoBpm: s.tempoBpm, meter: s.meter, style: s.layers.globalPlan.style, groove: s.layers.globalPlan.grooveStrategy,
      tasks: s.parts.length, notes: s.parts.reduce((n, p) => n + p.notes.length, 0),
      roles: [...new Set(s.parts.map((p) => `${p.request.instrument}:${p.request.role}:${p.request.task}`))].sort(),
    })),
    interlocking: {
      rows: interlock,
      meanKickToBass: mean(interlock.map((r) => r.kickToBass)),
      meanBassToKick: mean(interlock.map((r) => r.bassToKick)),
      meanPercussionOnKit: mean(interlock.map((r) => r.percussionOnKit)),
      meanOstinatoOnRhythmSection: mean(interlock.map((r) => r.ostinatoOnRhythmSection)),
    },
    hatRates: songs.map(hatRates),
    meter: { corpus: songs.map(meterCheck), variants: variants.map(meterCheck) },
    orchestrated,
    adversarialTotals: {
      machineMadePenalty: r3(orchestrated.reduce((s, o) => s + o.machineMade.penalty, 0)),
      causalityPenalty: r3(orchestrated.reduce((s, o) => s + o.causality.penalty, 0)),
      arbitrarinessPenalty: r3(orchestrated.reduce((s, o) => s + o.arbitrariness.penalty, 0)),
      playabilityRepairTracks: orchestrated.reduce((s, o) => s + o.playabilityRepairs.tracks, 0),
      leapFolds: orchestrated.reduce((s, o) => s + o.playabilityRepairs.leapFolds, 0),
      polyphonyReleases: orchestrated.reduce((s, o) => s + o.playabilityRepairs.polyphonyReleases, 0),
      feasible: orchestrated.filter((o) => o.feasible).length,
    },
  };
}

// ---------------------------------------------------------------------------
// After-only measures (they read the GroovePlan, which the "before" tree lacks)
// ---------------------------------------------------------------------------

/** The compose frame of a part, built the way `composeReferencePart` builds it (origin 0, no push). */
export function frameOf(song: ComposedSong, part: ComposedPart): ComposeFrame {
  const timing = barTiming(song.tempoBpm, song.meter);
  const request = part.request;
  return {
    request, ...timing, origin: 0,
    startSeconds: (request.section.startBar - 1) * timing.barSeconds, endSeconds: request.section.endBar * timing.barSeconds,
    ...registerBounds(request), chords: request.context.currentBars.chords, seed: request.seed,
    density: request.section.density, energy: request.section.energy, baseVelocity: 52 + request.section.energy * 55, push: () => {},
  };
}

/**
 * A bass written on `bassRhythmFor` with the reference composer's pitch logic
 * (root near MIDI 40, chord tones around it, a stepwise approach into the next
 * root) - what B-02's writer gets by calling the rhythm. A test-local writer,
 * not the shipped one.
 */
export function bassOnRhythm(frame: ComposeFrame): MusicalNote[] {
  const { lo, hi } = frame;
  const onsets = bassRhythmFor(frame);
  const notes: MusicalNote[] = [];
  onsets.forEach((o, index) => {
    const chord = o.anticipates ?? o.chord;
    if (!chord) return;
    const pc = rootPitchClass(chord.root ?? chord.symbol);
    const root = voiceNear(pc, 40, lo, hi);
    let pitch = root;
    if (o.figure === "fifth") pitch = voiceNear((pc + 7) % 12, root, lo, hi);
    else if (o.figure === "octave") pitch = root + 12 <= hi ? root + 12 : root;
    else if (o.figure === "approach") {
      const next = onsets[index + 1]?.chord ?? o.anticipates;
      const target = next ? voiceNear(rootPitchClass(next.root ?? next.symbol), root, lo, hi) : root;
      pitch = Math.max(lo, Math.min(hi, target > root ? target - 1 : target === root ? root : target + 1));
    }
    const nextStart = onsets[index + 1]?.start ?? o.start + o.duration;
    notes.push({ id: `b${index}`, start: o.start, duration: Math.max(0.05, Math.min(o.duration, nextStart - o.start - 0.001)), pitch, velocity: Math.round(frame.baseVelocity + o.crescendo + (o.figure === "root" ? 8 : -4)) });
  });
  return notes;
}

export type PlanInterlockRow = { song: string; section: string; relation: string; kicks: number; bassOnsets: number; kickToBass: number | null; bassToKick: number | null };

/** Kick onsets of the shipped kit against the bass rhythm the plan hands the bass writer. */
export function planInterlocking(song: ComposedSong): PlanInterlockRow[] {
  const rows: PlanInterlockRow[] = [];
  for (const section of song.layers.sectionPlan.sections) {
    const drums = song.parts.find((p) => p.request.task === "DRUMS" && p.request.section.sectionName === section.sectionName);
    const bass = song.parts.find((p) => p.request.task === "BASS" && p.request.section.sectionName === section.sectionName);
    if (!drums || !bass || !drums.notes.length) continue;
    const frame = frameOf(song, bass);
    const groove = grooveOf(frame);
    // Fill kicks are a gesture, not the groove: the plan does not ask the bass to double them. And the
    // comparison runs over the bass's own arc window (the arc may have the bass leave before the kit does).
    const windowStart = (bass.request.partWindow.startBar - 1) * frame.barSeconds;
    const windowEnd = bass.request.partWindow.endBar * frame.barSeconds;
    const kicks = onsetsOf(drums.notes, (n) => n.pitch === 36 && !n.id.includes("-fill") && n.start >= windowStart - 1e-3 && n.start < windowEnd - 1e-3);
    const bassOn = onsetsOf(bassRhythmFor(frame).map((o) => ({ start: o.start })) as MusicalNote[]);
    rows.push({
      song: song.id, section: section.sectionName, relation: groove.kickBass.value, kicks: kicks.length, bassOnsets: bassOn.length,
      kickToBass: kicks.length && bassOn.length ? r3(matched(kicks, bassOn) / kicks.length) : null,
      bassToKick: kicks.length && bassOn.length ? r3(matched(bassOn, kicks) / bassOn.length) : null,
    });
  }
  return rows;
}

export type AnticipationRow = { song: string; section: string; slots: number; agreed: number; kickAnticipates: boolean; notes: string[] };

/**
 * On every planned anticipation slot of a section: does the kit push (when
 * the plan says the kick joins), does the bass rhythm push, does the comping
 * rhythm push, does the ostinato (when one exists) push? A slot agrees when
 * every applicable part does.
 */
export function anticipationAgreement(song: ComposedSong): AnticipationRow[] {
  const rows: AnticipationRow[] = [];
  for (const section of song.layers.sectionPlan.sections) {
    const drums = song.parts.find((p) => p.request.task === "DRUMS" && p.request.section.sectionName === section.sectionName);
    const bass = song.parts.find((p) => p.request.task === "BASS" && p.request.section.sectionName === section.sectionName);
    const ostinato = song.parts.find((p) => p.request.task === "OSTINATO" && p.request.section.sectionName === section.sectionName);
    const anchor = drums ?? bass;
    if (!anchor) continue;
    const frame = frameOf(song, anchor);
    const groove = grooveOf(frame);
    const kickJoins = !!drums && drums.notes.length > 0 && groove.anticipations.value.kickAnticipates;
    const bassRhythm = bass ? bassRhythmFor(frameOf(song, bass)) : null;
    const comping = compingRhythmFor(frame, "rhythmic");
    const { outgoing } = transitionGesturesFor(frame, "drums");
    const rests = outgoing.flatMap((g) => g.restWindows);
    const thin = new Set(outgoing.flatMap((g) => g.thinBars));
    const row: AnticipationRow = { song: song.id, section: section.sectionName, slots: 0, agreed: 0, kickAnticipates: kickJoins, notes: [] };
    const has = (times: number[], t: number) => times.some((x) => Math.abs(x - t) <= 0.03);
    for (const b of barsOf(frame, groove)) {
      for (const s of b.slots) {
        row.slots += 1;
        if (inRest(rests, s.time) || thin.has(b.bar)) {
          // Every part rests or thins here by the same directive: agreement by construction.
          row.agreed += 1;
          continue;
        }
        const checks: Array<[string, boolean]> = [];
        if (kickJoins) checks.push(["kit", has(drums!.notes.filter((n) => n.pitch === 36).map((n) => n.start), s.time)]);
        // The bass answers only inside its own arc window (it may leave the section before the kit does).
        const bassPlaysHere = !!bass && b.bar >= bass.request.partWindow.startBar && b.bar <= bass.request.partWindow.endBar;
        if (bassRhythm && bassPlaysHere) checks.push(["bass rhythm", has(bassRhythm.map((o) => o.start), s.time)]);
        checks.push(["comping rhythm", has(comping.map((o) => o.start), s.time)]);
        if (ostinato && ostinato.notes.length) checks.push(["ostinato", has(ostinato.notes.map((n) => n.start), s.time)]);
        const failed = checks.filter(([, ok]) => !ok).map(([name]) => name);
        if (!failed.length) row.agreed += 1;
        else row.notes.push(`bar ${b.bar} unit ${s.unit}: ${failed.join(", ")} missing the push`);
      }
    }
    if (row.slots) rows.push(row);
  }
  return rows;
}

/** The transition devices of the corpus, realised per family: how many gestures each device produces and for whom. */
export function transitionGestureTable(songs: ComposedSong[]) {
  const table = new Map<string, { planned: number; realisedFor: Record<string, number>; notApplicable: number }>();
  const families: FamilyKey[] = ["drums", "bass", "keys", "guitar", "strings", "pads", "synth", "brass", "winds"];
  for (const song of songs) {
    for (const part of song.parts) {
      const frame = frameOf(song, part);
      for (const family of families) {
        const { outgoing } = transitionGesturesFor(frame, family);
        for (const g of outgoing) {
          const row = table.get(g.device) ?? { planned: 0, realisedFor: {}, notApplicable: 0 };
          if (family === "drums") row.planned += 1;
          if (g.applies) row.realisedFor[family] = (row.realisedFor[family] ?? 0) + 1;
          else if (family === "drums") row.notApplicable += 1;
          table.set(g.device, row);
        }
      }
    }
  }
  return Object.fromEntries([...table.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function afterMeasures() {
  const base = baseMeasures();
  const songs = corpusSongs();
  const planRows = songs.flatMap(planInterlocking);
  const byRelation = (relation: string) => {
    const rows = planRows.filter((r) => r.relation === relation && r.kickToBass !== null);
    return { sections: rows.length, meanKickToBass: rows.length ? r3(rows.reduce((a, r) => a + r.kickToBass!, 0) / rows.length) : null, minKickToBass: rows.length ? Math.min(...rows.map((r) => r.kickToBass!)) : null };
  };
  const anticipation = songs.flatMap(anticipationAgreement);
  const slots = anticipation.reduce((a, r) => a + r.slots, 0);
  const agreed = anticipation.reduce((a, r) => a + r.agreed, 0);
  const plans = songs.map((song) => {
    const plan = deriveGroovePlan(song.model, { globalPlan: song.layers.globalPlan, sectionPlan: song.layers.sectionPlan, transitions: song.layers.transitions }, { tempoBpm: song.tempoBpm, meter: song.meter, now: B04_EVIDENCE_NOW });
    return {
      song: song.id, inputsDigest: plan.inputsDigestSha256,
      sections: plan.sections.map((s) => ({
        name: s.sectionName, bars: `${s.startBar}-${s.endBar}`, grouping: s.meter.grouping.value.join("+"),
        pulse: `${s.pulse.value} (${s.pulse.source}: ${s.pulse.reason})`, subdivision: `${s.subdivision.value} (${s.subdivision.source}: ${s.subdivision.reason})`,
        ceiling: s.densityCeiling.value, kick: s.kit.kick, snare: s.kit.snare, kickBass: `${s.kickBass.value} (${s.kickBass.source})`,
        anticipations: `${s.anticipations.value.units.join(",")} ${s.anticipations.value.when}${s.anticipations.value.kickAnticipates ? " +kick" : ""}`,
        comping: `${s.comping.rhythmic.value} / bed ${s.comping.bed.value}${s.comping.rhythmic.source === "operator" ? " (operator)" : ""}`,
        fills: s.fills.placements.map((p) => `${p.bar}:${p.kind}x${p.lengthUnits}@${p.intensity}(${p.source})`),
        approach: s.approach.value ? `${s.approach.value.bars} bars, hats ${s.approach.value.hatStepUnits}u, +${s.approach.value.crescendo}` : null,
        swing: s.swing.value, ending: s.ending.value, continuity: s.continuity.note, digest: s.digest.slice(0, 12),
      })),
    };
  });
  return {
    ...base,
    groovePlans: plans,
    planInterlocking: { rows: planRows, lock: byRelation("lock"), complement: byRelation("complement"), pedal: byRelation("pedal") },
    anticipationAgreement: { slots, agreed, rate: slots ? r3(agreed / slots) : null, disagreements: anticipation.filter((r) => r.agreed < r.slots).map((r) => ({ song: r.song, section: r.section, notes: r.notes })) },
    transitionGestures: transitionGestureTable(songs),
  };
}

export type B04Before = ReturnType<typeof baseMeasures> & { mode: string; generatedAt: string };

export function buildB04Evidence(before: B04Before | null, options: { now?: Date } = {}) {
  const after = afterMeasures();
  const delta = (key: keyof ReturnType<typeof baseMeasures>["adversarialTotals"]) => before ? r3(after.adversarialTotals[key] - before.adversarialTotals[key]) : null;
  return {
    title: "Brain B-04 - one groove, shared; transitions that happen: before / after on the nine synthetic cases + the owner's song fixture",
    generatedAt: (options.now ?? new Date()).toISOString(),
    method: [
      "composeSong: every part of each Song Model composed by the reference composer through the real planners (fixed now); orchestratedMeasure: orchestrateArrangement(candidateCount 1, render false) and the adversarial machineMade / causality / arbitrariness penalties on the shipped (performed, repaired) notes.",
      "'before' = the same measurement module run against a pristine checkout of a751796 (main before this stream); 'after' = this branch.",
      "planInterlocking compares the shipped kit's kicks with the bass rhythm the plan hands the bass writer (bassRhythmFor); interlocking compares the kit with the shipped bass, which B-02's writer still composes (unwired).",
    ],
    before,
    after,
    deltas: before ? {
      machineMadePenalty: delta("machineMadePenalty"), causalityPenalty: delta("causalityPenalty"), arbitrarinessPenalty: delta("arbitrarinessPenalty"),
      leapFolds: after.adversarialTotals.leapFolds - before.adversarialTotals.leapFolds,
      polyphonyReleases: after.adversarialTotals.polyphonyReleases - before.adversarialTotals.polyphonyReleases,
      shippedKickToBass: [before.interlocking.meanKickToBass, after.interlocking.meanKickToBass],
      planKickToBassLock: after.planInterlocking.lock.meanKickToBass,
      hatMaxStrikesPerSecond: Object.fromEntries(after.hatRates.map((h) => [h.song, [before.hatRates.find((b) => b.song === h.song)?.maxHatStrikesPerSecond ?? null, h.maxHatStrikesPerSecond]])),
      sevenEightNotesOutsideSection: [before.meter.corpus.find((m) => m.meter === "7/8")?.notesOutsideSection ?? null, after.meter.corpus.find((m) => m.meter === "7/8")?.notesOutsideSection ?? null],
      meterVariantsCorrect: after.meter.variants.filter((m) => m.notesOutsideSection === 0 && m.kitOnsetsOutsideBar === 0).length + "/" + after.meter.variants.length + " (before: " + before.meter.variants.filter((m) => m.notesOutsideSection === 0 && m.familiesSilentInLaterSections.length === 0).length + "/" + before.meter.variants.length + ")",
    } : null,
    honestLimits: [
      "Nothing here was rendered or listened to; every number is symbolic.",
      "The shipped bass, keys, guitar, strings and pad parts are still written by composer/harmonyParts.ts (stream B-02): bassRhythmFor / compingRhythmFor / GrooveOnset.crescendo / endingGestureFor / entryGestureFor are exported and tested but reach the shipped notes only when B-02 calls them (one line each). The shipped kick/bass agreement therefore stays at its pre-B-04 value; the plan-level agreement is what the wiring buys.",
      "climax_not_prepared remains on five cases whose approach bars have no kit (the arc's lift sections are bass + keys); the plan carries the approach crescendo and every-bar anticipations for those bars, unrealised until B-02 wires the rhythm.",
      "machineMade rose on ethnic-vocal because the 7/8 meter fix makes the keys play in all three sections (before: silent in two); the identical_voicing_shape / no_rests findings it now reports are B-02's voicing, not the groove.",
      "ritardando is a tempo map + a time warp on the gesture and an `agogics` input on the performance engine; the orchestrator does not pass it yet (one line), and the production export refuses a tempo map with more than one segment - so a ritardando reaches the export only through the warped note onsets once wired, never as a tempo event.",
      "The orchestrator does not persist the GroovePlan on the ArrangementPlan yet (`plan.groovePlan = deriveGroovePlan(...)`, one line, B-00/B-11); every part derives the identical section from its request, which the parity test proves.",
      "The 5 pre-existing failures in critics/adversarial/adversarial.test.ts on a751796 (fighting positive control on pop-full, the source gate, silent LEAD keys, keys-as-drum-kit on dance-full, 'rejected on several axes') are unchanged by this stream.",
      "Groove rules (pulse per style, ceilings 7.5 / 9 strikes per second, swing 0.67 / 0.62 / 0.56 by tempo, fill vocabularies) are musical judgement written as constants, not fitted to human material.",
    ],
  };
}

if (process.env.B04_MODE === "after") {
  const beforePath = process.env.B04_BEFORE_JSON;
  const before = beforePath ? (JSON.parse(readFileSync(beforePath, "utf8")) as B04Before) : null;
  process.stdout.write(JSON.stringify(buildB04Evidence(before), null, 2));
}

if (process.env.B04_MODE === "before") {
  process.stdout.write(JSON.stringify({ mode: "before", generatedAt: new Date().toISOString(), ...baseMeasures() }, null, 2));
}
