/**
 * Transition realisation (Brain B-04): each of the eighteen transition devices
 * the transition engine plans becomes a concrete gesture per instrument
 * family, or says why it does not apply to that family.
 *
 * Before this the eighteen devices reduced to one three-note figure for an
 * `ensemble` piano that B-01 then removed; `riser`, `cymbal_swell`, `stop`,
 * `ritardando`, `turnaround` changed nothing audible. Now:
 *
 *   device          drums                     bass                 keys / guitar            strings / pads / synth        brass / winds
 *   drum_fill       groove-plan fill          -                    -                        -                             -
 *   bass_pickup     -                         stepwise approach    -                        -                             -
 *   keys_pickup     -                         -                    scalar pickup to top     -                             -
 *   guitar_pickup   -                         -                    scalar pickup to top     -                             -
 *   string_run      -                         -                    -                        run to the target's top voice -
 *   brass_push      -                         -                    -                        -                             two stabs into the bar line
 *   cymbal_swell    crash roll + CC11 ramp    -                    -                        -                             -
 *   cymbal_choke    choked crash, hats stop   -                    -                        -                             -
 *   break           rest (last pulse)         rest                 rest                     rest                          rest
 *   stop            stab on the last "and"    stab + rest          stab + rest              stab + rest                   stab + rest
 *   anticipation    (kick per groove plan)    target root early    target chord early       target chord early            -
 *   turnaround      -                         V of the target      V7 voicing of the target -                             -
 *   riser           -                         -                    -                        rising line + CC11 ramp       -
 *   reverse         -                         -                    -                        swell into the downbeat       -
 *   build_up        groove-plan snare build   -                    -                        CC11 crescendo                CC11 crescendo
 *   breakdown       kick-only bars            plays on             rests                    rests                         rests
 *   ending_hit      groove-plan ending        held root            held chord               held chord                    held chord
 *   ritardando      tempo events + warp       tempo events + warp  tempo events + warp      tempo events + warp           tempo events + warp
 *
 * The gestures are absolute-time notes, control events, rest windows and thin
 * bars that a family's writer applies to its own bars; `ritardando` is a tempo
 * map plus a time warp the performance engine's agogics can apply. Nothing
 * here writes notes on its own: the drum writer, the bass / keys / strings
 * writers (B-02) and the FILL / TRANSITION tasks call in.
 */
import type { ChordHarmonyEvent, ControlEvent, TransitionDevice, TransitionDevicePlan, TransitionPlan } from "@workspace/db";
import { canonicalFamily } from "./arrangementArc";
import type { BarTiming, ComposeFrame } from "./composer/frame";
import { chordPitchClasses, rootPitchClass } from "./composer/harmonyParts";
import { voiceNear } from "./composer/registers";

export type FamilyKey = "drums" | "percussion" | "bass" | "keys" | "guitar" | "strings" | "pads" | "synth" | "brass" | "winds" | "voice" | "unknown";

/** The family a part's instrument name settles (`keys`, `piano`, `strings`, `pads`, ...). */
export function familyOfInstrument(instrument: string): FamilyKey {
  const family = canonicalFamily(instrument);
  const known: FamilyKey[] = ["drums", "percussion", "bass", "keys", "guitar", "strings", "pads", "synth", "brass", "winds", "voice"];
  if ((known as string[]).includes(family)) return family as FamilyKey;
  if (/piano|organ|rhodes|key/i.test(instrument)) return "keys";
  if (/pad/i.test(instrument)) return "pads";
  return "unknown";
}

export type GestureNote = { start: number; duration: number; pitch: number; velocity: number; id: string };
export type RestWindow = { start: number; end: number; reason: string };
export type TempoEvent = { time: number; bpm: number };
export type TimeWarp = { start: number; end: number; /** Fractional slowdown reached at `end` (0.2 = 20 % slower). */ slowdown: number };

export type TransitionGesture = {
  transitionId: string;
  device: TransitionDevice;
  /** The instrument the plan named for the device. */
  plannedInstrument: string;
  family: FamilyKey;
  /** False when the device has no gesture for this family; `reason` says why. */
  applies: boolean;
  reason: string;
  notes: GestureNote[];
  cc: ControlEvent[];
  restWindows: RestWindow[];
  /** Bars in which the family plays a stripped version (drums: kick only; harmony: nothing). */
  thinBars: number[];
  tempoEvents: TempoEvent[];
  timeWarp: TimeWarp | null;
};

export type RealisationContext = {
  timing: BarTiming;
  /** Absolute seconds of bar 1's downbeat. */
  origin: number;
  /** The section the device leaves (its last bar is `atBar - 1`). */
  fromSection: { startBar: number; endBar: number };
  lo: number;
  hi: number;
  baseVelocity: number;
  /** The chord sounding at the end of the departing section, when known. */
  chordBefore: ChordHarmonyEvent | null;
  /** The first chord of the arriving section, when known. */
  chordAfter: ChordHarmonyEvent | null;
  idPrefix: string;
};

const r4 = (v: number) => Number(v.toFixed(4));

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MIXOLYDIAN = [0, 2, 4, 5, 7, 9, 10];
const DIMINISHED = [0, 2, 3, 5, 6, 8, 9];

/** A scale that fits the chord: major / natural minor / mixolydian for a dominant / whole-half for a diminished chord. */
export function scaleFor(chord: ChordHarmonyEvent | null): { root: number; degrees: number[] } {
  if (!chord) return { root: 0, degrees: MAJOR };
  const root = rootPitchClass(chord.root ?? chord.symbol);
  const q = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b]?/, "")).toLowerCase();
  const degrees = q.includes("dim") ? DIMINISHED
    : q.startsWith("m") && !q.startsWith("maj") ? MINOR
    : /7|9|11|13/.test(q) && !q.includes("maj") ? MIXOLYDIAN
    : MAJOR;
  return { root, degrees };
}

/** The chord's highest voice as a pitch class near the top of the register (the third when there is one, else the fifth). */
function topVoicePc(chord: ChordHarmonyEvent | null): number {
  const pcs = chord ? chordPitchClasses(chord) : [0, 4, 7];
  return pcs[1] ?? pcs[0];
}

/** Ascending scale steps ending on `targetPitch`, `count` notes long. */
function runInto(targetPitch: number, count: number, scale: { root: number; degrees: number[] }, lo: number, hi: number): number[] {
  const out: number[] = [];
  let pitch = targetPitch;
  out.unshift(pitch);
  while (out.length < count) {
    // Step down the scale from the current pitch.
    let next = pitch - 1;
    while (!scale.degrees.includes((((next - scale.root) % 12) + 12) % 12)) next -= 1;
    pitch = next;
    out.unshift(pitch);
  }
  return out.map((p) => Math.max(lo, Math.min(hi, p)));
}

const empty = (transition: TransitionPlan, device: TransitionDevicePlan, family: FamilyKey, reason: string, applies = false): TransitionGesture => ({
  transitionId: transition.id, device: device.device, plannedInstrument: device.instrument, family, applies, reason,
  notes: [], cc: [], restWindows: [], thinBars: [], tempoEvents: [], timeWarp: null,
});

/**
 * Realise one planned device for one family. Times are absolute seconds. The
 * departing section's last bar is `transition.atBar - 1`; `device.startBar`
 * and `device.endBar` bound multi-bar devices (swell, riser, build, breakdown,
 * ritardando).
 */
export function realiseDevice(
  device: TransitionDevicePlan,
  transition: TransitionPlan,
  family: FamilyKey,
  ctx: RealisationContext,
): TransitionGesture {
  const { timing, origin } = ctx;
  const unit = timing.beatSeconds;
  const n = timing.meter.numerator;
  const lastBar = transition.atBar - 1;
  const lastBarStart = origin + (lastBar - 1) * timing.barSeconds;
  const boundary = origin + (transition.atBar - 1) * timing.barSeconds;
  const windowStart = origin + (Math.max(ctx.fromSection.startBar, device.startBar) - 1) * timing.barSeconds;
  const intensity = Math.max(0, Math.min(1, device.intensity));
  const vel = (offset: number) => Math.max(1, Math.min(127, Math.round(ctx.baseVelocity + offset)));
  const id = (suffix: string) => `${ctx.idPrefix}-${transition.id}-${device.device}-${suffix}`;
  const gesture = (partial: Partial<TransitionGesture>, reason: string): TransitionGesture => ({
    ...empty(transition, device, family, reason, true), ...partial,
  });
  const lastPulseStart = lastBarStart + timing.meter.pulses[timing.meter.pulses.length - 1] * unit;
  const lastPulseUnits = n - timing.meter.pulses[timing.meter.pulses.length - 1];
  const stopTime = boundary - 0.5 * unit * (timing.meter.denominator >= 8 ? 2 : 1);
  const target = ctx.chordAfter ?? ctx.chordBefore;
  const targetRoot = target ? rootPitchClass(target.root ?? target.symbol) : 0;
  const harmonic: ReadonlySet<FamilyKey> = new Set(["keys", "guitar", "strings", "pads", "synth", "brass", "winds"]);
  const pitched = family !== "drums" && family !== "percussion";

  switch (device.device) {
    case "drum_fill":
      return empty(transition, device, family, family === "drums"
        ? "realised through the groove plan's fill placement in this bar (the vocabulary decides the figure)"
        : "a drum fill is the kit's gesture");
    case "build_up":
      if (family === "drums") return empty(transition, device, family, "realised through the groove plan's snare-build placement");
      if (harmonic.has(family) && family !== "keys" && family !== "guitar") {
        const cc: ControlEvent[] = [];
        const steps = 8;
        for (let i = 0; i <= steps; i += 1) {
          const t = windowStart + ((boundary - windowStart) * i) / steps;
          cc.push({ controller: 11, time: r4(t), value: Math.round(60 + (67 * i * intensity) / steps) });
        }
        return gesture({ cc }, `CC11 crescendo over bars ${device.startBar}-${device.endBar} into ${transition.toSection}`);
      }
      return empty(transition, device, family, `${family} builds through the groove (anticipations + density), not a separate gesture`);
    case "cymbal_swell": {
      if (family !== "drums") return empty(transition, device, family, "a cymbal swell is the kit's gesture");
      const notes: GestureNote[] = [];
      const step = unit * (timing.meter.denominator >= 8 ? 1 : 0.5);
      const count = Math.max(1, Math.round((boundary - windowStart) / step));
      for (let i = 0; i < count; i += 1) {
        const t = windowStart + i * step;
        notes.push({ start: r4(t), duration: r4(step * 0.9), pitch: 49, velocity: Math.round(26 + (vel(6) - 26) * (i / Math.max(1, count - 1)) * intensity), id: id(`roll${i}`) });
      }
      const cc: ControlEvent[] = [
        { controller: 11, time: r4(windowStart), value: 40 },
        { controller: 11, time: r4(boundary - 0.01), value: Math.round(80 + 47 * intensity) },
      ];
      return gesture({ notes, cc }, `crash roll from bar ${device.startBar} rising into ${transition.toSection}; the downbeat crash is the arriving section's`);
    }
    case "cymbal_choke": {
      if (family !== "drums") return empty(transition, device, family, "a choke is the kit's gesture");
      const t = lastPulseStart;
      return gesture({
        notes: [{ start: r4(t), duration: 0.06, pitch: 49, velocity: vel(8), id: id("choke") }],
        restWindows: [{ start: r4(t + 0.02), end: r4(boundary), reason: "choked cymbal: the hats stop with it" }],
      }, `choked crash on the last pulse of bar ${lastBar}`);
    }
    case "break":
      return gesture({
        restWindows: [{ start: r4(lastPulseStart - 0.001), end: r4(boundary), reason: `break: every part rests for the last ${lastPulseUnits} unit(s) of bar ${lastBar}` }],
      }, `rest over the last pulse of bar ${lastBar}`);
    case "stop": {
      const notes: GestureNote[] = family === "drums"
        ? [
          { start: r4(stopTime), duration: 0.12, pitch: 36, velocity: vel(12), id: id("stab-k") },
          { start: r4(stopTime), duration: 0.12, pitch: 38, velocity: vel(10), id: id("stab-s") },
          { start: r4(stopTime), duration: 0.3, pitch: 49, velocity: vel(8), id: id("stab-c") },
        ]
        : pitched && target
          ? chordPitchClasses(target).slice(0, family === "bass" ? 1 : 3).map((pc, i) => ({
            start: r4(stopTime), duration: r4(unit * 0.4), pitch: voiceNear(pc, (ctx.lo + ctx.hi) / 2 + i * 4, ctx.lo, ctx.hi), velocity: vel(10 - i * 2), id: id(`stab${i}`),
          }))
          : [];
      return gesture({
        notes,
        restWindows: [
          { start: r4(lastPulseStart - 0.001), end: r4(stopTime - 0.001), reason: "stop: nothing between the last pulse and the stab" },
          { start: r4(stopTime + 0.05), end: r4(boundary), reason: "stop: silence after the stab until the downbeat" },
        ],
      }, `everything ends on the last "and" of bar ${lastBar} with a stab, then a rest into ${transition.toSection}`);
    }
    case "breakdown": {
      const bars: number[] = [];
      for (let b = Math.max(ctx.fromSection.startBar, device.startBar); b <= Math.min(lastBar, device.endBar); b += 1) bars.push(b);
      if (family === "drums") return gesture({ thinBars: bars }, `kick only over bars ${bars[0]}-${bars[bars.length - 1]}`);
      if (family === "bass") return empty(transition, device, family, "the bass plays on through a breakdown");
      return gesture({ thinBars: bars, restWindows: [{ start: r4(windowStart), end: r4(boundary), reason: "breakdown: the harmony strips out" }] }, `rests over bars ${bars[0]}-${bars[bars.length - 1]}`);
    }
    case "bass_pickup": {
      if (family !== "bass") return empty(transition, device, family, "a bass pickup is the bass's gesture");
      if (!target) return empty(transition, device, family, "no target chord to approach");
      const root = voiceNear(targetRoot, 40, ctx.lo, ctx.hi);
      const from = ctx.chordBefore ? voiceNear(rootPitchClass(ctx.chordBefore.root ?? ctx.chordBefore.symbol), root, ctx.lo, ctx.hi) : root - 3;
      const ascending = from <= root;
      const steps = intensity >= 0.6 ? [3, 2, 1] : [2, 1];
      const notes = steps.map((s, i) => ({
        start: r4(boundary - (steps.length - i) * unit * 0.5),
        duration: r4(unit * 0.45),
        pitch: Math.max(ctx.lo, Math.min(ctx.hi, ascending ? root - s : root + s)),
        velocity: vel(2 + i * 3),
        id: id(`p${i}`),
      }));
      return gesture({ notes }, `${ascending ? "rising" : "falling"} stepwise approach into the ${target.symbol} root at bar ${transition.atBar}`);
    }
    case "keys_pickup":
    case "guitar_pickup": {
      if (family !== "keys" && family !== "guitar") return empty(transition, device, family, `${device.device} belongs to ${device.device.split("_")[0]}`);
      const scale = scaleFor(target);
      const top = voiceNear(topVoicePc(target), ctx.hi - 7, ctx.lo, ctx.hi);
      const pitches = runInto(top, 3, scale, ctx.lo, ctx.hi);
      const notes = pitches.map((p, i) => ({
        start: r4(boundary - (pitches.length - i) * unit * 0.5),
        duration: r4(unit * 0.45),
        pitch: p,
        velocity: vel(i * 4),
        id: id(`p${i}`),
      }));
      return gesture({ notes }, `three-note scalar pickup up to the ${target?.symbol ?? "target"} top voice at bar ${transition.atBar}`);
    }
    case "string_run": {
      if (family !== "strings") return empty(transition, device, family, "a string run is the strings' gesture");
      const scale = scaleFor(target);
      const top = voiceNear(topVoicePc(target), ctx.hi - 5, ctx.lo, ctx.hi);
      const count = intensity >= 0.6 ? 8 : 4;
      const span = lastPulseUnits * unit;
      const pitches = runInto(top, count, scale, ctx.lo, ctx.hi);
      const notes = pitches.map((p, i) => ({
        start: r4(boundary - span + (span * i) / count),
        duration: r4((span / count) * 0.95),
        pitch: p,
        velocity: vel(-6 + i * 2),
        id: id(`r${i}`),
      }));
      return gesture({ notes }, `${count}-note run over the last pulse of bar ${lastBar} up to the ${target?.symbol ?? "target"} top voice`);
    }
    case "brass_push": {
      if (family !== "brass" && family !== "winds") return empty(transition, device, family, "a brass push is the brass's gesture");
      const pcs = target ? chordPitchClasses(target) : [0, 4, 7];
      const notes: GestureNote[] = [
        { start: r4(boundary - unit), duration: r4(unit * 0.4), pitch: voiceNear(pcs[2] ?? pcs[0], (ctx.lo + ctx.hi) / 2, ctx.lo, ctx.hi), velocity: vel(10), id: id("s0") },
        { start: r4(stopTime), duration: r4(unit * 0.4), pitch: voiceNear(pcs[0], (ctx.lo + ctx.hi) / 2 + 3, ctx.lo, ctx.hi), velocity: vel(14), id: id("s1") },
      ];
      return gesture({ notes }, `two stabs on the last pulse and its "and" into bar ${transition.atBar}`);
    }
    case "anticipation": {
      if (!pitched || family === "brass" || family === "winds") return empty(transition, device, family, family === "drums" ? "the kick anticipates per the groove plan" : "no anticipation gesture for this family");
      if (!target) return empty(transition, device, family, "no target chord to anticipate");
      const pcs = chordPitchClasses(target);
      const voices = family === "bass" ? [pcs[0]] : pcs.slice(0, 3);
      const notes = voices.map((pc, i) => ({
        start: r4(stopTime),
        duration: r4(unit * 1.5),
        pitch: family === "bass" ? voiceNear(pc, 40, ctx.lo, ctx.hi) : voiceNear(pc, (ctx.lo + ctx.hi) / 2 + i * 4, ctx.lo, ctx.hi),
        velocity: vel(6 - i * 2),
        id: id(`a${i}`),
      }));
      return gesture({ notes }, `${target.symbol} arrives on the last "and" of bar ${lastBar}, tied over the bar line`);
    }
    case "turnaround": {
      if (family !== "keys" && family !== "guitar" && family !== "bass") return empty(transition, device, family, "a turnaround is a comping / bass gesture");
      if (!target) return empty(transition, device, family, "no target chord to turn around to");
      const minorTarget = /m(?!aj)/.test((target.quality ?? target.symbol.replace(/^[A-Ga-g][#b]?/, "")).toLowerCase());
      // V of the target (bVII in a minor / modal setting).
      const approachRoot = minorTarget && intensity < 0.6 ? (targetRoot + 10) % 12 : (targetRoot + 7) % 12;
      const approachPcs = minorTarget && intensity < 0.6
        ? [approachRoot, (approachRoot + 4) % 12, (approachRoot + 7) % 12]
        : [approachRoot, (approachRoot + 4) % 12, (approachRoot + 10) % 12, (approachRoot + 7) % 12];
      const half = lastBarStart + Math.floor(n / 2) * unit;
      const notes: GestureNote[] = family === "bass"
        ? [{ start: r4(half), duration: r4((boundary - half) * 0.9), pitch: voiceNear(approachRoot, 40, ctx.lo, ctx.hi), velocity: vel(6), id: id("v") }]
        : approachPcs.slice(0, 3).map((pc, i) => ({
          start: r4(half), duration: r4((boundary - half) * 0.9), pitch: voiceNear(pc, (ctx.lo + ctx.hi) / 2 + i * 3, ctx.lo, ctx.hi), velocity: vel(4 - i * 2), id: id(`v${i}`),
        }));
      return gesture({
        notes,
        restWindows: [{ start: r4(half - 0.001), end: r4(boundary), reason: "turnaround: the approach chord replaces the comping in the second half of the bar" }],
      }, `${minorTarget && intensity < 0.6 ? "bVII" : "V"} of ${target.symbol} over the second half of bar ${lastBar}`);
    }
    case "riser": {
      if (family !== "pads" && family !== "synth" && family !== "strings") return empty(transition, device, family, "a riser is a pad / synth / strings gesture");
      const scale = scaleFor(target);
      const top = voiceNear(topVoicePc(target), ctx.hi - 3, ctx.lo, ctx.hi);
      const step = unit * (timing.meter.denominator >= 8 ? 1 : 0.5);
      const count = Math.max(2, Math.round((boundary - windowStart) / step));
      const pitches = runInto(top, count, scale, ctx.lo, ctx.hi);
      const notes = pitches.map((p, i) => ({ start: r4(windowStart + i * step), duration: r4(step * 1.1), pitch: p, velocity: vel(-10 + Math.round(14 * i / count)), id: id(`up${i}`) }));
      const cc: ControlEvent[] = [{ controller: 11, time: r4(windowStart), value: 40 }, { controller: 11, time: r4(boundary - 0.01), value: 127 }];
      return gesture({ notes, cc }, `rising line over bars ${device.startBar}-${lastBar} into the ${target?.symbol ?? "target"} top voice, CC11 40 → 127`);
    }
    case "reverse": {
      if (family !== "pads" && family !== "synth" && family !== "strings") return empty(transition, device, family, "a reverse swell is a pad / synth / strings gesture");
      const start = lastPulseStart;
      const notes: GestureNote[] = [{ start: r4(start), duration: r4(boundary - start), pitch: voiceNear(targetRoot, (ctx.lo + ctx.hi) / 2, ctx.lo, ctx.hi), velocity: vel(4), id: id("rev") }];
      const cc: ControlEvent[] = [{ controller: 11, time: r4(start), value: 8 }, { controller: 11, time: r4(boundary - 0.01), value: 120 }];
      return gesture({ notes, cc }, `swell from silence into the downbeat of bar ${transition.atBar}`);
    }
    case "ending_hit":
      return empty(transition, device, family, family === "drums"
        ? "realised through the groove plan's ending (crash + kick held over the song's last bar)"
        : "realised by the family's ending gesture (held final chord / root)");
    case "ritardando": {
      const slowdown = Math.min(0.3, 0.1 + 0.2 * intensity);
      const events: TempoEvent[] = [];
      const steps = 4;
      for (let i = 0; i <= steps; i += 1) {
        const t = windowStart + ((boundary - windowStart) * i) / steps;
        events.push({ time: r4(t), bpm: Number((timing.tempoBpm * (1 - (slowdown * i) / steps)).toFixed(2)) });
      }
      return gesture({ tempoEvents: events, timeWarp: { start: r4(windowStart), end: r4(boundary), slowdown: Number(slowdown.toFixed(3)) } },
        `tempo eases ${Math.round(slowdown * 100)} % over bars ${device.startBar}-${lastBar} (tempo events for the map; the warp for the performance layer)`);
    }
    default:
      return empty(transition, device, family, `no gesture defined for ${device.device}`);
  }
}

// ---------------------------------------------------------------------------
// From a compose frame
// ---------------------------------------------------------------------------

function contextFromFrame(frame: ComposeFrame, transition: TransitionPlan): RealisationContext {
  const { request } = frame;
  const boundary = frame.origin + (transition.atBar - 1) * frame.barSeconds;
  const before = [...frame.chords].reverse().find((c) => c.start < boundary - 1e-6) ?? frame.chords.at(-1) ?? null;
  const after = request.context.nextBars.chords.find((c) => c.end > boundary + 1e-6)
    ?? frame.chords.find((c) => c.start >= boundary - 1e-6)
    ?? null;
  return {
    timing: frame,
    origin: frame.origin,
    fromSection: { startBar: request.section.startBar, endBar: request.section.endBar },
    lo: frame.lo, hi: frame.hi, baseVelocity: frame.baseVelocity,
    chordBefore: before, chordAfter: after,
    idPrefix: "tr",
  };
}

/**
 * The gestures the section's transitions ask of this family: `outgoing` for
 * the transition that leaves the section (its last bars), `incoming` for the
 * one that arrives (the section's first bar; the drum writer's downbeat crash
 * reads the groove plan instead).
 */
export function transitionGesturesFor(frame: ComposeFrame, family: FamilyKey = familyOfInstrument(frame.request.instrument)): { outgoing: TransitionGesture[]; incoming: TransitionGesture[] } {
  const name = frame.request.section.sectionName;
  const outgoing: TransitionGesture[] = [];
  const incoming: TransitionGesture[] = [];
  for (const transition of frame.request.transitions) {
    if (transition.fromSection === name && transition.toSection !== name) {
      const ctx = contextFromFrame(frame, transition);
      for (const device of transition.devices) outgoing.push(realiseDevice(device, transition, family, ctx));
    } else if (transition.toSection === name && transition.fromSection !== name) {
      const ctx = contextFromFrame(frame, transition);
      for (const device of transition.devices) incoming.push({ ...realiseDevice(device, transition, family, ctx), notes: [], cc: [], restWindows: [] });
    }
  }
  return { outgoing, incoming };
}

/** True when `time` falls inside any rest window. */
export function inRest(windows: readonly RestWindow[], time: number): boolean {
  return windows.some((w) => time >= w.start - 1e-3 && time < w.end - 1e-3);
}

export type EndingGesture = {
  /** Absolute seconds of the song's last bar. */
  barStart: number;
  barEnd: number;
  chord: ChordHarmonyEvent | null;
  kind: "held_hit" | "thin_out";
  reason: string;
};

/**
 * The song's ending for a pitched family: the last chord held from the final
 * bar's downbeat to the end of the bar. Null unless the frame's section is the
 * song's last (its end bar is the last bar the global plan knows).
 */
export function endingGestureFor(frame: ComposeFrame): EndingGesture | null {
  const { request } = frame;
  const lastBar = Math.max(...request.globalPlan.sectionTargets.map((t) => t.endBar), request.section.endBar);
  if (request.section.endBar < lastBar) return null;
  const barStart = frame.origin + (lastBar - 1) * frame.barSeconds;
  const chord = [...frame.chords].reverse().find((c) => c.start <= barStart + 1e-6) ?? frame.chords.at(-1) ?? null;
  const soft = request.arcIntent ? request.arcIntent.level < 0.45 : request.section.energy < 0.45;
  return {
    barStart: r4(barStart), barEnd: r4(barStart + frame.barSeconds), chord,
    kind: soft ? "thin_out" : "held_hit",
    reason: soft ? "a quiet close: the final chord thins to a held voicing" : "the final chord is struck on the last downbeat and held",
  };
}

export type EntryGesture = {
  /** Absolute seconds of the pickup (the last "and" before the entry bar). */
  start: number;
  entryBarStart: number;
  chord: ChordHarmonyEvent | null;
  reason: string;
};

/**
 * A pickup for a family that enters after its section starts (an arc entry):
 * its first chord anticipated on the last "and" before the entry bar. Null
 * when the part enters with the section.
 */
export function entryGestureFor(frame: ComposeFrame): EntryGesture | null {
  const { request } = frame;
  if (request.partWindow.startBar <= request.section.startBar) return null;
  const entryBarStart = frame.origin + (request.partWindow.startBar - 1) * frame.barSeconds;
  const start = entryBarStart - frame.beatSeconds * (frame.meter.denominator >= 8 ? 1 : 0.5);
  const chord = frame.chords.find((c) => c.end > entryBarStart + 1e-6) ?? null;
  return {
    start: r4(start), entryBarStart: r4(entryBarStart), chord,
    reason: `enters at bar ${request.partWindow.startBar} (arc entry offset ${request.partWindow.startBar - request.section.startBar}); the first chord is anticipated on the "and" before it`,
  };
}

export type PlannedAgogic = { kind: "ritardando"; start: number; end: number; slowdown: number };

/**
 * The song's planned agogics, as the performance engine takes them (Brain
 * B-13): every `ritardando` device in the transition plan, in absolute
 * seconds, with the fractional slowdown `realiseDevice` computes for it.
 *
 * A ritardando is a time warp that is a pure function of time, so every part
 * must receive the same one - which is why it is derived from the plan once,
 * by the orchestrator, and passed to every track's performance, rather than
 * per family. B-04 realised the device (tempo events + warp) but the
 * orchestrator never passed it on: `agogics` had no producer and the owner's
 * song ended on a staccato piano stab a second early (R-1b P1-7).
 */
export function agogicsFor(
  transitions: readonly TransitionPlan[],
  timing: BarTiming,
  origin = 0,
): PlannedAgogic[] {
  const out: PlannedAgogic[] = [];
  for (const transition of transitions) {
    for (const device of transition.devices) {
      if (device.device !== "ritardando") continue;
      const start = origin + (device.startBar - 1) * timing.barSeconds;
      const end = origin + (transition.atBar - 1) * timing.barSeconds;
      if (!(end > start)) continue;
      const intensity = Math.max(0, Math.min(1, device.intensity));
      out.push({
        kind: "ritardando",
        start: r4(start), end: r4(end),
        slowdown: Number(Math.min(0.3, 0.1 + 0.2 * intensity).toFixed(3)),
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}
