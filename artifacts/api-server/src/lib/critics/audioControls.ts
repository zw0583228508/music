/**
 * Positive-control harness for the **audio** critic dimensions (Brain B-07).
 *
 * The B-05a harness (`controls.ts`) worsens an arrangement's notes and asks
 * whether a symbolic dimension notices. This one worsens the arrangement (or,
 * for the two defects that live in the render itself, the render), **renders
 * both versions with the evaluation renderer** and asks whether an audio
 * dimension notices in the audio. It is the only thing that may set an audio
 * dimension's `controlStatus`: `audioControlLedger.ts` is generated from this
 * run and nothing else, and `audioControls.test.ts` fails when the committed
 * ledger disagrees with a regeneration.
 *
 * The rule is not this module's. It is the program's one sensitivity rule,
 * `critics/sensitivity.ts` (B-05c) — the same `SENSITIVITY_RULE`,
 * `transformGates` and `deriveStatus` the symbolic ledger, the adversarial
 * ledger and B-08 use, so the ledgers can be read together and a change to the
 * listening gate moves all of them at once. This module measures; it does not
 * decide. In particular it does **not** restate the thresholds: a dimension is
 * `gated` only when **two independent, non-prepared** claimed controls each
 * clear the gate on at least `SENSITIVITY_RULE.minTrials` anchors and no clean
 * anchor is blocked, and every non-gated dimension carries the `reason` the
 * shared rule wrote for it.
 *
 * The controls are the four the B-07 brief names — stack two parts in one
 * octave, flatten the velocities, boost the sub-bass, clip a stem — plus the
 * five the R-1 musical review says a listener hears and no critic on the
 * production path did: a bed reduced to one line, a climax with an empty
 * middle, harmony written against a different clock from the kit, an arrival
 * thinner than its setup, and a section that falls silent.
 *
 * `clip_stem` is deliberately a **render**-level control: no arrangement of
 * notes can clip a stem that the evaluation renderer normalises, and
 * `audioDynamics.clipped_stem` exists to catch a render defect (origin
 * `render`), so the control has to damage the render. Every other control
 * damages the notes and lets the renderer do what it always does.
 */
import type { MusicalNote, TrackModel } from "@workspace/db";
import { exactBinomialCi } from "../listeningSensitivity";
import type { CriticDimensionReport, CriticInput } from "./types";
import { SEVERITY_ORDER } from "./types";
import { ALL_AUDIO_DIMENSIONS, AUDIO_DIMENSION_NAMES } from "./dimensions/audioDimensions";
import type { AudioCriticInput } from "./dimensions/audioShared";
import { buildContext, type CriticContext, type PartInfo } from "./dimensions/shared";
import { anchors, type Anchor } from "./dimensions/anchors";
import {
  EVALUATION_FAMILIES,
  renderEvaluation,
  type EvaluationFamily,
  type EvaluationRender,
  type EvaluationRenderOptions,
} from "../evaluationRender";
import { audioRenderLike } from "../evaluationCritique";
import { deriveStatus, SENSITIVITY_RULE, type LedgerEntry, type TransformMeasurement } from "./sensitivity";

export const AUDIO_CONTROL_HARNESS_VERSION = "B07_AUDIO_CONTROLS_v1" as const;

/**
 * Anchors the harness renders: the eight clean B-05a anchors (the ninth,
 * ethnic-vocal, carries a known composer defect whose parts overflow the song,
 * so it cannot serve as a null control). Eight is not an arbitrary number: the
 * shared gate needs a 95 % exact-binomial lower bound of 0.6, and 8/8 is the
 * smallest run that reaches it (7/7 gives 0.59) — and it is also
 * `SENSITIVITY_RULE.minTrials`. A dimension can therefore be `gated` here only
 * by catching **two** independent claimed controls on every one of the eight.
 */
export const AUDIO_ANCHOR_IDS: readonly string[] = [
  "pop-full", "ballad-piano-vocal", "rock-full", "dance-full",
  "acoustic-demo", "orchestral-midi", "jazz-full", "cinematic-midi",
];

/** Controls each audio dimension claims to hear. Every control is still measured against every dimension. */
export const AUDIO_CLAIMED_CONTROLS: Record<string, string[]> = {
  audioBalance: ["dominate_one_part", "dominate_by_trim", "boost_sub_bass"],
  audioDynamics: ["flatten_velocities", "silence_a_section", "clip_stem"],
  audioMasking: ["stack_octave", "boost_sub_bass", "thin_bed_to_one_line", "empty_the_middle"],
  audioRhythm: ["shift_harmony_off_grid"],
  audioTransitions: ["thin_the_arrival", "silence_a_section"],
};

/** The shared rule's `minTrials`, re-exported so nothing here restates it. */
export const MIN_ITEMS_FOR_STATUS = SENSITIVITY_RULE.minTrials;

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

export type AudioWorsened = {
  trackModels: TrackModel[];
  renderOptions: EvaluationRenderOptions;
  /** Damage applied to the finished render (the `render`-origin controls). */
  damageRender?: (render: EvaluationRender) => EvaluationRender;
  targetTrackIds: string[];
  detail: string;
};

export type AudioControl = {
  description: string;
  /** `notes` damages the arrangement; `render` damages the render of an undamaged arrangement. */
  kind: "notes" | "render";
  apply(anchor: Anchor, context: CriticContext): AudioWorsened | null;
};

/**
 * Hard-clip one stem of a finished render. It has to be done here, on the
 * samples, and not by raising a family trim: `renderEvaluation` normalises the
 * mix to a 0.95 peak ceiling and applies that same gain to every stem, so a
 * trim change cannot make a stem clip — it makes it *dominate*, which is
 * `audioBalance`'s finding, not `audioDynamics`'. A stem that clips is a
 * render defect (origin `render`), so the control damages the render.
 */
export function clipOneStem(render: EvaluationRender, trackId: string, gain = 6): EvaluationRender {
  return {
    ...render,
    stems: render.stems.map((stem) => {
      if (stem.trackId !== trackId) return stem;
      const samples = new Float32Array(stem.samples.length);
      for (let i = 0; i < samples.length; i += 1) samples[i] = Math.max(-1, Math.min(1, stem.samples[i] * gain));
      return { ...stem, samples, peakDbfs: 0 };
    }),
  };
}

const clampPitch = (p: number): number => Math.max(0, Math.min(127, Math.round(p)));
const clampVelocity = (v: number): number => Math.max(1, Math.min(127, Math.round(v)));

function withNotes(trackModels: readonly TrackModel[], trackId: string, notes: MusicalNote[]): TrackModel[] {
  return trackModels.map((t) => (t.id === trackId ? { ...t, notes } : t));
}

function pitchedParts(context: CriticContext): PartInfo[] {
  return context.parts.filter((p) => !p.percussive && p.track.notes.length > 0);
}

function meanPitch(part: PartInfo): number {
  const notes = part.track.notes;
  return notes.length ? notes.reduce((s, n) => s + n.pitch, 0) / notes.length : 60;
}

/**
 * The boundary at which the plan asks for the biggest rise in energy, and the
 * two sections either side of it. The controls damage *that* arrival, because
 * that is the boundary `audioTransitions` claims to hear: damaging whichever
 * section happens to be loudest measures the harness's choice of section, not
 * the dimension.
 */
function biggestPlannedLift(context: CriticContext): { setup: (typeof context.sections)[number]; arrival: (typeof context.sections)[number] } | null {
  if (context.sections.length < 3) return null;
  let best = -1;
  let bestLift = 0;
  for (let i = 1; i < context.sections.length; i += 1) {
    const previous = context.sections[i - 1];
    const section = context.sections[i];
    if (section.startBar !== previous.endBar + 1) continue;
    const lift = section.energy - previous.energy;
    if (lift > bestLift) { bestLift = lift; best = i; }
  }
  if (best < 1 || bestLift < 0.15) return null;
  return { setup: context.sections[best - 1], arrival: context.sections[best] };
}

const inBars = (n: MusicalNote, context: CriticContext, startBar: number, endBar: number): boolean => {
  const bar = context.barAt(n.start);
  return bar >= startBar && bar <= endBar;
};

export const AUDIO_CONTROLS: Record<string, AudioControl> = {
  stack_octave: {
    kind: "notes",
    description: "the second pitched part transposed into the first's octave, so two parts occupy one register for the whole song",
    apply: (anchor, context) => {
      const parts = pitchedParts(context).sort((a, b) => meanPitch(a) - meanPitch(b));
      if (parts.length < 2) return null;
      const target = parts[parts.length - 1];
      const host = parts[0];
      const shift = Math.round((meanPitch(host) - meanPitch(target)) / 12) * 12;
      if (shift === 0) return null;
      return {
        trackModels: withNotes(anchor.input.trackModels, target.id, target.track.notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch + shift) }))),
        renderOptions: {},
        targetTrackIds: [target.id, host.id],
        detail: `${target.instrument} transposed ${shift} semitones onto ${host.instrument}`,
      };
    },
  },
  boost_sub_bass: {
    kind: "notes",
    description: "the bass an octave down at full velocity and the next-lowest pitched part an octave down with it: two parts in the sub band",
    apply: (anchor, context) => {
      const parts = pitchedParts(context).sort((a, b) => meanPitch(a) - meanPitch(b));
      if (parts.length < 2) return null;
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      for (const part of parts.slice(0, 2)) {
        models = withNotes(models, part.id, part.track.notes.map((n) => ({ ...n, pitch: clampPitch(n.pitch - 12), velocity: clampVelocity(n.velocity * 1.3) })));
        targets.push(part.id);
      }
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${parts.slice(0, 2).map((p) => p.instrument).join(" and ")} an octave down at 1.3x velocity` };
    },
  },
  flatten_velocities: {
    kind: "notes",
    description: "every note of every part at the arrangement's mean velocity: the plan's dynamic contrast erased at the source",
    apply: (anchor, context) => {
      const all = context.parts.flatMap((p) => p.track.notes);
      if (all.length < 20) return null;
      const mean = clampVelocity(all.reduce((s, n) => s + n.velocity, 0) / all.length);
      return {
        trackModels: anchor.input.trackModels.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n, velocity: mean })) })),
        renderOptions: {},
        targetTrackIds: anchor.input.trackModels.map((t) => t.id),
        detail: `every velocity set to ${mean}`,
      };
    },
  },
  clip_stem: {
    kind: "render",
    description: "one stem of the finished render driven 6x and hard-clipped at +/-1.0: a defect of the render, which no arrangement of notes can cause",
    apply: (anchor, context) => {
      const part = pitchedParts(context)[0];
      if (!part) return null;
      return {
        trackModels: [...anchor.input.trackModels],
        renderOptions: {},
        damageRender: (render) => clipOneStem(render, part.id),
        targetTrackIds: [part.id],
        detail: `${part.instrument} stem driven 6x and clipped`,
      };
    },
  },
  dominate_by_trim: {
    kind: "render",
    description: "one family's render trim raised by 24 dB: the mix balance destroyed by the render rather than by the notes",
    apply: (anchor, context) => {
      const part = pitchedParts(context)[0];
      if (!part) return null;
      const family = (EVALUATION_FAMILIES as readonly string[]).find((f) => part.family === f) as EvaluationFamily | undefined;
      if (!family) return null;
      return {
        trackModels: [...anchor.input.trackModels],
        renderOptions: { familyTrimsDb: { [family]: 24 } as Partial<Record<EvaluationFamily, number>> },
        targetTrackIds: [part.id],
        detail: `${family} trimmed +24 dB in the render`,
      };
    },
  },
  align_to_kit: {
    kind: "notes",
    description: "NEGATIVE control: every pitched note snapped to the nearest beat of the composer's grid. Nothing should be detected; audioRhythm's score should RISE, which is what isolates the cause of the off-grid findings on the clean anchors",
    apply: (anchor, context) => {
      const parts = pitchedParts(context);
      if (!parts.length || !context.bars.length) return null;
      const beats: number[] = [];
      for (const bar of context.bars) {
        for (let b = 0; b < bar.beats; b += 1) beats.push(bar.start + b * bar.beatSeconds);
      }
      if (beats.length < 4) return null;
      const snap = (t: number): number => {
        let best = beats[0];
        for (const b of beats) if (Math.abs(t - b) < Math.abs(t - best)) best = b;
        return Number(best.toFixed(4));
      };
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      for (const part of parts) {
        models = withNotes(models, part.id, part.track.notes.map((n) => ({ ...n, start: snap(n.start) })));
        targets.push(part.id);
      }
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${parts.length} pitched part(s) snapped to the beat grid` };
    },
  },
  thin_bed_to_one_line: {
    kind: "notes",
    description: "every chord of the bed reduced to its top voice - what perform -> playability repair did to the owner's string bed",
    apply: (anchor, context) => {
      const bed = context.parts.find((p) => !p.percussive && /HARMONIC_BED|PAD/i.test(p.role) && p.track.notes.length >= 8)
        ?? context.parts.find((p) => !p.percussive && /RHYTHMIC_HARMONY/i.test(p.role) && p.track.notes.length >= 8);
      if (!bed) return null;
      const byOnset = new Map<number, MusicalNote[]>();
      for (const n of bed.track.notes) {
        const key = Math.round(n.start * 50);
        byOnset.set(key, [...(byOnset.get(key) ?? []), n]);
      }
      const kept: MusicalNote[] = [];
      let dropped = 0;
      for (const group of byOnset.values()) {
        const top = [...group].sort((a, b) => b.pitch - a.pitch)[0];
        kept.push(top);
        dropped += group.length - 1;
      }
      if (dropped < 4) return null;
      return {
        trackModels: withNotes(anchor.input.trackModels, bed.id, kept.sort((a, b) => a.start - b.start)),
        renderOptions: {},
        targetTrackIds: [bed.id],
        detail: `${bed.instrument}: ${dropped} lower voice(s) removed, ${kept.length} kept`,
      };
    },
  },
  empty_the_middle: {
    kind: "notes",
    description: "in the loudest planned section, every pitched note between G3 and G5 moved an octave out - the climax split between the bottom and the top",
    apply: (anchor, context) => {
      const pair = biggestPlannedLift(context);
      if (!pair) return null;
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      let moved = 0;
      for (const part of pitchedParts(context)) {
        const notes = part.track.notes.map((n) => {
          if (!inBars(n, context, pair.arrival.startBar, pair.arrival.endBar)) return n;
          if (n.pitch < 55 || n.pitch > 79) return n;
          moved += 1;
          return { ...n, pitch: clampPitch(n.pitch + (n.pitch >= 67 ? 12 : -12)) };
        });
        if (notes.some((n, i) => n !== part.track.notes[i])) {
          models = withNotes(models, part.id, notes);
          targets.push(part.id);
        }
      }
      if (moved < 6) return null;
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${moved} note(s) moved out of G3-G5 in ${pair.arrival.name}` };
    },
  },
  shift_harmony_off_grid: {
    kind: "notes",
    description: "every pitched part delayed 110 ms while the kit stays where it is - the harmony written against a different clock",
    apply: (anchor, context) => {
      const parts = pitchedParts(context);
      if (!parts.length) return null;
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      for (const part of parts) {
        models = withNotes(models, part.id, part.track.notes.map((n) => ({ ...n, start: Number((n.start + 0.11).toFixed(4)) })));
        targets.push(part.id);
      }
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${parts.length} pitched part(s) delayed 110 ms against the kit` };
    },
  },
  thin_the_arrival: {
    kind: "notes",
    description: "the loudest planned section stripped to its two quietest parts at half velocity - an arrival thinner than the section that set it up",
    apply: (anchor, context) => {
      const pair = biggestPlannedLift(context);
      if (!pair) return null;
      const parts = context.parts.filter((p) => p.track.notes.length > 0);
      if (parts.length < 3) return null;
      const keep = new Set(parts.slice(-2).map((p) => p.id));
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      let removed = 0;
      for (const part of parts) {
        const notes = part.track.notes
          .filter((n) => {
            const inside = inBars(n, context, pair.arrival.startBar, pair.arrival.endBar);
            if (!inside) return true;
            if (keep.has(part.id)) return true;
            removed += 1;
            return false;
          })
          .map((n) => (inBars(n, context, pair.arrival.startBar, pair.arrival.endBar) ? { ...n, velocity: clampVelocity(n.velocity * 0.5) } : n));
        models = withNotes(models, part.id, notes);
        targets.push(part.id);
      }
      if (removed < 4) return null;
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${removed} note(s) removed from ${pair.arrival.name}, the rest at half velocity` };
    },
  },
  silence_a_section: {
    kind: "notes",
    description: "every note of the loudest planned section deleted: a hole in the middle of the song",
    apply: (anchor, context) => {
      const pair = biggestPlannedLift(context);
      if (!pair) return null;
      let models = anchor.input.trackModels as TrackModel[];
      const targets: string[] = [];
      let removed = 0;
      for (const part of context.parts) {
        const notes = part.track.notes.filter((n) => {
          const inside = inBars(n, context, pair.arrival.startBar, pair.arrival.endBar);
          if (inside) removed += 1;
          return !inside;
        });
        models = withNotes(models, part.id, notes);
        targets.push(part.id);
      }
      if (removed < 10) return null;
      return { trackModels: models, renderOptions: {}, targetTrackIds: targets, detail: `${pair.arrival.name} emptied (${removed} notes)` };
    },
  },
  dominate_one_part: {
    kind: "notes",
    description: "one pitched part at velocity 127 and every other part at velocity 20: one instrument over an inaudible band",
    apply: (anchor, context) => {
      const parts = context.parts.filter((p) => p.track.notes.length > 0);
      if (parts.length < 3) return null;
      const loud = pitchedParts(context)[0];
      if (!loud) return null;
      let models = anchor.input.trackModels as TrackModel[];
      for (const part of parts) {
        models = withNotes(models, part.id, part.track.notes.map((n) => ({ ...n, velocity: part.id === loud.id ? 127 : 20 })));
      }
      return { trackModels: models, renderOptions: {}, targetTrackIds: parts.map((p) => p.id), detail: `${loud.instrument} at 127, everything else at 20` };
    },
  },
};

export const AUDIO_CONTROL_NAMES: readonly string[] = Object.keys(AUDIO_CONTROLS).sort();

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type AudioControlItem = {
  control: string;
  anchorId: string;
  detail: string;
  results: Record<string, { detected: boolean; before: number | null; after: number | null; kinds: string[] }>;
};

export type AudioTableRow = {
  dimension: string;
  control: string;
  claimed: boolean;
  n: number;
  detected: number;
  rate: number | null;
  ci95: [number, number] | null;
  meanScoreDrop: number | null;
};

export type AudioHarnessResult = {
  version: typeof AUDIO_CONTROL_HARNESS_VERSION;
  renderer: string;
  sampleRate: number;
  anchors: Array<{ id: string; genre: string; tracks: string[]; notes: number; durationSeconds: number; renderMs: number; spectrum: Record<string, number> }>;
  controls: Array<{ control: string; kind: "notes" | "render"; description: string }>;
  items: AudioControlItem[];
  table: AudioTableRow[];
  ledger: Record<string, LedgerEntry>;
  /** The null test: every dimension's report on each anchor's own, undamaged render. */
  anchorReports: Array<{ anchorId: string; dimension: string; score: number | null; applicable: boolean; blocking: number; major: number; minor: number; kinds: string[] }>;
};

export type AudioHarnessOptions = {
  anchorIds?: readonly string[];
  controls?: readonly string[];
  sampleRate?: number;
  onProgress?: (done: number, total: number, label: string) => void;
};

function criticInputFor(anchor: Anchor, trackModels: TrackModel[], render: EvaluationRender): AudioCriticInput {
  return { ...anchor.input, trackModels, render: audioRenderLike(render) };
}

function evaluateAll(input: AudioCriticInput): CriticDimensionReport[] {
  return ALL_AUDIO_DIMENSIONS.map((d) => d.evaluate(input));
}

/**
 * Detection, the same rule as B-05a: the dimension's score drops by at least a
 * point **and** a non-info observation appears that was not there before (or
 * grew more severe) on a track the control damaged.
 */
export function detectAudio(
  before: CriticDimensionReport,
  after: CriticDimensionReport,
  targetTrackIds: readonly string[],
  allTrackIds: readonly string[],
): { detected: boolean; scoreDrop: number | null; kinds: string[] } {
  const previous = new Map(before.observations.map((o) => [o.id, o.severity]));
  const targets = new Set(targetTrackIds);
  const whole = allTrackIds.every((id) => targets.has(id));
  const fresh = after.observations.filter((o) => {
    if (o.severity === "info") return false;
    const onTarget = whole || o.location.trackIds.length === 0 || o.location.trackIds.some((id) => targets.has(id));
    if (!onTarget) return false;
    const was = previous.get(o.id);
    return was === undefined || SEVERITY_ORDER[o.severity] > SEVERITY_ORDER[was];
  });
  const scoreDrop = before.summary.score0to100 !== null && after.summary.score0to100 !== null
    ? Number((before.summary.score0to100 - after.summary.score0to100).toFixed(2))
    : null;
  return {
    detected: scoreDrop !== null && scoreDrop >= 1 && fresh.length > 0,
    scoreDrop,
    kinds: [...new Set(fresh.map((o) => o.kind))].sort(),
  };
}

export function runAudioControlHarness(options: AudioHarnessOptions = {}): AudioHarnessResult {
  const anchorIds = options.anchorIds ?? AUDIO_ANCHOR_IDS;
  const controlNames = options.controls ?? AUDIO_CONTROL_NAMES;
  const sampleRate = options.sampleRate;
  const base = anchors(anchorIds);
  const total = base.length * (1 + controlNames.length);
  let done = 0;
  const step = (label: string) => { done += 1; options.onProgress?.(done, total, label); };

  const items: AudioControlItem[] = [];
  const anchorReports: AudioHarnessResult["anchorReports"] = [];
  const anchorRows: AudioHarnessResult["anchors"] = [];

  for (const anchor of base) {
    const context = buildContext(anchor.input);
    const cleanRender = renderEvaluation(anchor.input.trackModels, sampleRate ? { sampleRate } : {});
    step(`${anchor.id}: clean render`);
    const cleanInput = criticInputFor(anchor, anchor.input.trackModels, cleanRender);
    const cleanReports = evaluateAll(cleanInput);
    anchorRows.push({
      id: anchor.id,
      genre: anchor.genre,
      tracks: anchor.input.trackModels.map((t) => t.id),
      notes: anchor.input.trackModels.reduce((s, t) => s + t.notes.length, 0),
      durationSeconds: cleanRender.durationSeconds,
      renderMs: cleanRender.elapsedMs,
      spectrum: { sub150: cleanRender.spectrum.sub150, low2k: cleanRender.spectrum.low2k, presence5k: cleanRender.spectrum.presence5k, air: cleanRender.spectrum.air },
    });
    for (const report of cleanReports) {
      anchorReports.push({
        anchorId: anchor.id,
        dimension: report.dimension,
        score: report.summary.score0to100,
        applicable: report.applicable,
        blocking: report.observations.filter((o) => o.severity === "blocking").length,
        major: report.observations.filter((o) => o.severity === "major").length,
        minor: report.observations.filter((o) => o.severity === "minor").length,
        kinds: [...new Set(report.observations.filter((o) => o.severity !== "info").map((o) => o.kind))].sort(),
      });
    }
    const beforeByDimension = new Map(cleanReports.map((r) => [r.dimension, r]));

    for (const name of controlNames) {
      const control = AUDIO_CONTROLS[name];
      if (!control) throw new Error(`unknown audio control "${name}"`);
      const worsened = control.apply(anchor, context);
      if (!worsened) { step(`${anchor.id}: ${name} (not applicable)`); continue; }
      const plain = renderEvaluation(worsened.trackModels, { ...(sampleRate ? { sampleRate } : {}), ...worsened.renderOptions });
      const worsenedRender = worsened.damageRender ? worsened.damageRender(plain) : plain;
      step(`${anchor.id}: ${name}`);
      const afterReports = evaluateAll(criticInputFor(anchor, worsened.trackModels, worsenedRender));
      const allIds = worsened.trackModels.map((t) => t.id);
      const results: AudioControlItem["results"] = {};
      for (const after of afterReports) {
        const before = beforeByDimension.get(after.dimension)!;
        const d = detectAudio(before, after, worsened.targetTrackIds, allIds);
        results[after.dimension] = {
          detected: d.detected,
          before: before.summary.score0to100,
          after: after.summary.score0to100,
          kinds: d.kinds,
        };
      }
      items.push({ control: name, anchorId: anchor.id, detail: worsened.detail, results });
    }
  }

  const table = buildAudioTable(items, controlNames);
  return {
    version: AUDIO_CONTROL_HARNESS_VERSION,
    renderer: anchorRows.length ? "LISTENING_SYNTH_V2" : "none",
    sampleRate: sampleRate ?? 44_100,
    anchors: anchorRows,
    controls: controlNames.map((c) => ({ control: c, kind: AUDIO_CONTROLS[c].kind, description: AUDIO_CONTROLS[c].description })),
    items,
    table,
    ledger: deriveAudioLedger(table, anchorReports),
    anchorReports,
  };
}

export function buildAudioTable(items: readonly AudioControlItem[], controlOrder: readonly string[]): AudioTableRow[] {
  const rows: AudioTableRow[] = [];
  for (const dimension of AUDIO_DIMENSION_NAMES) {
    const claimed = new Set(AUDIO_CLAIMED_CONTROLS[dimension] ?? []);
    for (const control of controlOrder) {
      const relevant = items.filter((i) => i.control === control && i.results[dimension] && i.results[dimension].before !== null && i.results[dimension].after !== null);
      const n = relevant.length;
      const detected = relevant.filter((i) => i.results[dimension].detected).length;
      const drops = relevant.map((i) => (i.results[dimension].before as number) - (i.results[dimension].after as number));
      rows.push({
        dimension,
        control,
        claimed: claimed.has(control),
        n,
        detected,
        rate: n ? Number((detected / n).toFixed(4)) : null,
        ci95: n ? exactBinomialCi(detected, n) : null,
        meanScoreDrop: n ? Number((drops.reduce((a, b) => a + b, 0) / n).toFixed(2)) : null,
      });
    }
  }
  return rows;
}

/**
 * No audio control prepares its anchor: every one of them damages material the
 * composer actually wrote (or the render of it) and none writes the gesture it
 * then erases, so none is barred from gating by the shared rule's prepared
 * clause. The B-05a preparation syntax (`control+preparation`) is honoured
 * anyway, so a prepared audio control added later is read the same way as a
 * prepared symbolic one.
 */
export const isPreparedAudioControl = (control: string): boolean => control.includes("+");

/** One table row as the shared rule reads it — the shape `transformGates` and `deriveStatus` take. */
export function audioMeasurement(row: AudioTableRow): TransformMeasurement {
  return { control: row.control, claimed: row.claimed, prepared: isPreparedAudioControl(row.control), n: row.n, detected: row.detected, rate: row.rate, ci95: row.ci95 };
}

/**
 * The audio ledger, derived by the program's one sensitivity rule
 * (`critics/sensitivity.ts`). Every threshold, `minTrials`, the
 * two-independent-transforms requirement and the wording of `reason` come from
 * there; this function only turns the measured table into the measurements the
 * rule reads.
 */
export function deriveAudioLedger(
  table: readonly AudioTableRow[],
  anchorReports: AudioHarnessResult["anchorReports"],
): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  for (const dimension of AUDIO_DIMENSION_NAMES) {
    const clean = anchorReports.filter((r) => r.dimension === dimension);
    const cleanBlocking = clean.length ? Number((clean.filter((r) => r.blocking > 0).length / clean.length).toFixed(4)) : null;
    const measurements: TransformMeasurement[] = table.filter((r) => r.dimension === dimension).map(audioMeasurement);
    ledger[dimension] = deriveStatus({ dimension, measurements, cleanAnchorBlockingRate: cleanBlocking });
  }
  return ledger;
}

/** The TypeScript source of `dimensions/audioControlLedger.ts` for a ledger. */
export function renderAudioLedgerSource(ledger: Record<string, LedgerEntry>, ledgerVersion: string): string {
  const entries = Object.keys(ledger).sort().map((dimension) => {
    const e = ledger[dimension];
    return `  ${dimension}: { status: ${JSON.stringify(e.status)}, strongestControl: ${JSON.stringify(e.strongestControl)}, detectionRate: ${e.detectionRate}, ci95: ${e.ci95 ? `[${e.ci95[0]}, ${e.ci95[1]}]` : "null"}, n: ${e.n}, cleanAnchorBlockingRate: ${e.cleanAnchorBlockingRate}, gatingTransforms: ${JSON.stringify(e.gatingTransforms)}, reason: ${JSON.stringify(e.reason)} },`;
  });
  return [
    "/**",
    " * Audio control ledger — GENERATED by `critics/audioControls.ts` (`renderAudioLedgerSource`).",
    " * Do not edit by hand: `audioControls.test.ts` regenerates the table from the",
    " * rendered anchors × controls run and fails when this file disagrees with it,",
    " * so an audio dimension's `controlStatus` can only come from a measured",
    " * detection rate on rendered audio.",
    " *",
    ` * Derived from ${AUDIO_ANCHOR_IDS.length} rendered anchors (${AUDIO_ANCHOR_IDS.join(", ")}) ×`,
    ` * ${AUDIO_CONTROL_NAMES.length} controls, both versions rendered with the evaluation renderer.`,
    " *",
    " * The status rule is `critics/sensitivity.ts` — the one rule shared with the",
    " * symbolic ledger, the adversarial harness and B-08's ledger. `gatingTransforms`",
    " * names the independent, non-prepared controls that earned a `gated` status;",
    " * `reason` says why a dimension is not gated.",
    " */",
    "import type { LedgerEntry } from \"../sensitivity\";",
    "",
    "export type { LedgerEntry };",
    "",
    `export const AUDIO_CONTROL_LEDGER_VERSION = ${JSON.stringify(ledgerVersion)} as const;`,
    "",
    "export const AUDIO_CONTROL_LEDGER: Record<string, LedgerEntry> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/** Compact summary for the tracker and the final report. */
export function summariseAudioLedger(ledger: Record<string, LedgerEntry>): string[] {
  return Object.keys(ledger).sort().map((d) => {
    const e = ledger[d];
    const strongest = e.strongestControl ? ` (${e.strongestControl} ${Math.round((e.detectionRate ?? 0) * 100)} % [${e.ci95?.[0]}, ${e.ci95?.[1]}], n=${e.n})` : "";
    const gates = e.status === "gated" ? ` gated by ${e.gatingTransforms.join(" + ")}` : ` — ${e.reason}`;
    return `${d}: ${e.status}${strongest}${gates}`;
  });
}

export type { CriticInput };
