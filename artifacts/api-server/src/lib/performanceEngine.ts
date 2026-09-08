/**
 * Performance Engine V1 (PR-14).
 *
 * Separates **Composition MIDI** ("C4 in bar 20") from **Performance MIDI**
 * ("exactly when the player strikes it, how hard, how long, with what pedal,
 * and how the hand enters the chord").
 *
 * Humanisation is never `timing += random(-20ms, +20ms)`. Every offset and
 * velocity change is derived from: instrument family, tempo, groove, style,
 * phrase position, metrical position, dynamic shape and musical role — with a
 * small *seeded* jitter scaled by all of the above, so the result is
 * deterministic and auditable.
 */
import type {
  ArticulationEvent,
  ControlEvent,
  InstrumentArrangementRole,
  MusicalNote,
  PerformanceDecision,
  PerformanceEvidence,
  PhrasePlan,
} from "@workspace/db";

export const PERFORMANCE_ENGINE = "PERFORMANCE_ENGINE_V1" as const;
const MAX_DECISION_SAMPLE = 64;

export type PerformanceInput = {
  trackId: string;
  instrument: string;
  family: string;
  role: InstrumentArrangementRole;
  notes: MusicalNote[];
  tempoBpm: number;
  meter?: string;
  /** From the global plan: steady_pulse / syncopated / swing / rubato / ... */
  groove?: string;
  style?: string;
  /** e.g. "mp->f" from the section's role assignment. */
  dynamicShape?: string;
  phrases?: PhrasePlan[];
  seed?: number;
  /** Bar → seconds, so metrical position can be computed. */
  barSeconds?: number;
};

export type PerformedTrack = {
  notes: MusicalNote[];
  cc: ControlEvent[];
  articulations: ArticulationEvent[];
  evidence: PerformanceEvidence;
};

// ---------------------------------------------------------------------------
// Family + role profiles
// ---------------------------------------------------------------------------

type FamilyProfile = {
  id: string;
  /** Base seeded-jitter width, milliseconds. */
  jitterMs: number;
  /** Systematic push (−) / pull (+) in milliseconds. */
  feelMs: number;
  /** How strongly metrical accent shapes velocity, 0..1. */
  accentDepth: number;
  /** Note-length multiplier: <1 detaches, >1 overlaps (legato). */
  lengthFactor: number;
};

const FAMILY_PROFILES: Record<string, FamilyProfile> = {
  drums: { id: "kit-limb", jitterMs: 3.5, feelMs: -2, accentDepth: 0.85, lengthFactor: 1 },
  bass: { id: "finger-bass", jitterMs: 6, feelMs: -3, accentDepth: 0.6, lengthFactor: 0.96 },
  keys: { id: "two-hand-keyboard", jitterMs: 7, feelMs: 0, accentDepth: 0.55, lengthFactor: 1.02 },
  guitar: { id: "pick-and-strum", jitterMs: 9, feelMs: 1, accentDepth: 0.6, lengthFactor: 0.98 },
  strings: { id: "bowed-phrase", jitterMs: 14, feelMs: 5, accentDepth: 0.35, lengthFactor: 1.08 },
  brass: { id: "breath-phrase", jitterMs: 10, feelMs: 3, accentDepth: 0.5, lengthFactor: 1.02 },
  winds: { id: "breath-phrase", jitterMs: 9, feelMs: 3, accentDepth: 0.45, lengthFactor: 1.02 },
  voice: { id: "sung-phrase", jitterMs: 12, feelMs: 4, accentDepth: 0.4, lengthFactor: 1.05 },
  synth: { id: "patch-locked", jitterMs: 2, feelMs: 0, accentDepth: 0.4, lengthFactor: 1 },
};
const profileFor = (family: string): FamilyProfile => FAMILY_PROFILES[family] ?? FAMILY_PROFILES.keys;

/** Roles that drive vs. float. */
const ROLE_FEEL_MS: Partial<Record<InstrumentArrangementRole, number>> = {
  GROOVE: -3, BASS: -2, FOUNDATION: -2, OSTINATO: -1,
  LEAD: 2, COUNTER_MELODY: 3, CALL_RESPONSE: 3,
  PAD: 8, HARMONIC_BED: 5, RHYTHMIC_HARMONY: 0,
  ACCENT: -1, FILL: -2, TRANSITION: -2, CLIMAX_LAYER: 0,
};

const DYNAMIC_LEVELS: Record<string, number> = {
  pp: 0.35, p: 0.5, mp: 0.62, mf: 0.75, f: 0.88, ff: 1,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function seededUnit(seed: number, key: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16_777_619) >>> 0;
  }
  // −1 .. 1, deterministic.
  return ((h % 20_001) / 10_000) - 1;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const midi = (v: number): number => Math.round(clamp(v, 1, 127));

/** Beat index within the bar (0-based) and the fraction into that beat. */
function metricalPosition(
  timeSeconds: number,
  tempoBpm: number,
  beatsPerBar: number,
): { beatInBar: number; fraction: number } {
  const beat = (timeSeconds * tempoBpm) / 60;
  const beatInBar = Math.floor(beat) % Math.max(1, beatsPerBar);
  return { beatInBar, fraction: beat - Math.floor(beat) };
}

/** Metrical accent weight, 0..1 — downbeat strongest, 16ths weakest. */
function metricalWeight(beatInBar: number, fraction: number, beatsPerBar: number): number {
  const onBeat = fraction < 0.06 || fraction > 0.94;
  if (onBeat) {
    if (beatInBar === 0) return 1;
    if (beatsPerBar === 4 && beatInBar === 2) return 0.82;
    return 0.68;
  }
  if (Math.abs(fraction - 0.5) < 0.06) return 0.46;
  return 0.34;
}

/** Phrase arc: rise to ~70% through the phrase, then ease off. */
function phraseArc(timeSeconds: number, phrases: PhrasePlan[] | undefined, barSeconds: number): number {
  if (!phrases || phrases.length === 0 || barSeconds <= 0) return 0;
  const bar = Math.floor(timeSeconds / barSeconds) + 1;
  const phrase = phrases.find((p) => bar >= p.startBar && bar <= p.endBar);
  if (!phrase) return 0;
  const span = Math.max(1, phrase.endBar - phrase.startBar + 1);
  const position = (bar - phrase.startBar) / span;
  return position <= 0.7 ? position / 0.7 : 1 - (position - 0.7) / 0.3;
}

/** "mp->f" | "f" | "mf->mp" → [start, end] level in 0..1. */
function dynamicRamp(shape: string | undefined): [number, number] {
  if (!shape) return [0.7, 0.7];
  const [from, to] = shape.split("->").map((s) => s.trim());
  const start = DYNAMIC_LEVELS[from] ?? 0.7;
  const end = DYNAMIC_LEVELS[to ?? from] ?? start;
  return [start, end];
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function applyPerformance(input: PerformanceInput): PerformedTrack {
  const seed = input.seed ?? 1;
  const family = input.family;
  const profile = profileFor(family);
  const beatsPerBar = Number((input.meter ?? "4/4").split("/")[0]) || 4;
  const beatSeconds = 60 / Math.max(1, input.tempoBpm);
  const barSeconds = input.barSeconds ?? beatSeconds * beatsPerBar;
  const swing = (input.groove ?? "").includes("swing");
  const rubato = input.groove === "rubato";
  const [dynStart, dynEnd] = dynamicRamp(input.dynamicShape);

  const source = [...input.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const songEnd = Math.max(0.001, ...source.map((n) => n.start + n.duration));

  const notes: MusicalNote[] = [];
  const cc: ControlEvent[] = [];
  const articulations: ArticulationEvent[] = [];
  const decisions: PerformanceDecision[] = [];
  const added = { ghostNotes: 0, flams: 0, strumSpreadNotes: 0, breathGaps: 0 };
  const ccCurves: string[] = [];
  const offsets: number[] = [];

  // Group simultaneous notes so chords can be rolled/strummed as one gesture.
  const clusters: MusicalNote[][] = [];
  for (const note of source) {
    const open = clusters[clusters.length - 1];
    if (open && Math.abs(open[0].start - note.start) < 0.012) open.push(note);
    else clusters.push([note]);
  }

  for (const cluster of clusters) {
    const anchor = cluster[0];
    const { beatInBar, fraction } = metricalPosition(anchor.start, input.tempoBpm, beatsPerBar);
    const weight = metricalWeight(beatInBar, fraction, beatsPerBar);
    const arc = phraseArc(anchor.start, input.phrases, barSeconds);
    const progress = clamp(anchor.start / songEnd, 0, 1);
    const dynamicLevel = dynStart + (dynEnd - dynStart) * progress;

    // --- timing -------------------------------------------------------
    const reasons: string[] = [];
    let offsetMs = profile.feelMs + (ROLE_FEEL_MS[input.role] ?? 0);
    reasons.push(`${family} feel ${profile.feelMs}ms`, `${input.role} feel ${ROLE_FEEL_MS[input.role] ?? 0}ms`);
    if (swing && Math.abs(fraction - 0.5) < 0.08) {
      offsetMs += beatSeconds * 1000 * (2 / 3 - 0.5);
      reasons.push("swung offbeat");
    }
    if (rubato && arc > 0) {
      offsetMs += (1 - arc) * 12;
      reasons.push("rubato phrase breathing");
    }
    // Tighter on strong beats; looser off the grid.
    const jitterScale = profile.jitterMs * (0.4 + (1 - weight) * 0.9);
    const jitter = seededUnit(seed, `${anchor.id}:t`) * jitterScale;
    offsetMs += jitter;
    reasons.push(`metrical weight ${weight.toFixed(2)}`);
    offsets.push(offsetMs);

    // --- chord gesture (roll / strum / hand offset) ---------------------
    const sorted = [...cluster].sort((a, b) => a.pitch - b.pitch);
    const strumDown = beatInBar % 2 === 0;
    let spreadMs = 0;
    if (cluster.length > 1) {
      if (family === "guitar") {
        spreadMs = 8 + cluster.length * 2.5 + (1 - weight) * 6;
        reasons.push(`${strumDown ? "down" : "up"} strum spread ${spreadMs.toFixed(0)}ms`);
        added.strumSpreadNotes += cluster.length - 1;
      } else if (family === "keys") {
        spreadMs = 4 + cluster.length * 1.8 * (1 - dynamicLevel * 0.5);
        reasons.push(`chord roll ${spreadMs.toFixed(0)}ms`);
        added.strumSpreadNotes += cluster.length - 1;
      } else if (family === "strings" || family === "brass") {
        spreadMs = 3;
      }
    }

    cluster.forEach((note) => {
      const index = sorted.indexOf(note);
      const order = family === "guitar" && !strumDown ? cluster.length - 1 - index : index;
      const gestureMs = spreadMs * (cluster.length > 1 ? order / (cluster.length - 1) : 0);
      // Piano left hand (below C4) leads very slightly.
      const handMs = family === "keys" && note.pitch < 60 ? -4 : 0;
      const start = Math.max(0, note.start + (offsetMs + gestureMs + handMs) / 1000);

      // --- velocity ---------------------------------------------------
      const accent = 1 - profile.accentDepth * (1 - weight);
      let velocity = (note.velocity || 90) * accent;
      velocity *= 0.75 + dynamicLevel * 0.45;
      velocity *= 0.9 + arc * 0.2;
      if (family === "drums") {
        // Kick/snare carry the accent; hats sit under them.
        if (note.pitch === 42 || note.pitch === 44 || note.pitch === 46) velocity *= 0.72;
        if (note.pitch === 36 || note.pitch === 38) velocity *= 1.08;
      }
      velocity += seededUnit(seed, `${note.id}:v`) * 4;
      const performedVelocity = midi(velocity);

      // --- length -----------------------------------------------------
      let duration = note.duration * profile.lengthFactor;
      if (input.role === "PAD" || input.role === "HARMONIC_BED") duration *= 1.06;
      if (input.role === "GROOVE" || family === "drums") duration = Math.min(duration, 0.25);
      duration = Math.max(0.02, duration);

      notes.push({ ...note, start: Number(start.toFixed(4)), duration: Number(duration.toFixed(4)), velocity: performedVelocity });
      if (decisions.length < MAX_DECISION_SAMPLE) {
        decisions.push({
          noteId: note.id,
          timingOffsetMs: Number((offsetMs + gestureMs + handMs).toFixed(2)),
          velocityDelta: performedVelocity - (note.velocity || 90),
          reasons: [...reasons],
        });
      }
    });
  }

  // --- family gestures --------------------------------------------------
  if (family === "drums") {
    // Ghost snares between backbeats, and a flam on the loudest hit.
    const snares = notes.filter((n) => n.pitch === 38).sort((a, b) => a.start - b.start);
    for (let i = 1; i < snares.length; i += 1) {
      const gap = snares[i].start - snares[i - 1].start;
      if (gap > beatSeconds * 1.4) {
        const at = snares[i - 1].start + gap / 2;
        notes.push({
          id: `${snares[i - 1].id}-ghost`, start: Number(at.toFixed(4)),
          duration: 0.06, pitch: 38, velocity: 26,
        });
        added.ghostNotes += 1;
      }
    }
    const loudest = notes.reduce<MusicalNote | null>(
      (best, n) => (n.pitch === 38 && (!best || n.velocity > best.velocity) ? n : best), null,
    );
    if (loudest) {
      notes.push({
        id: `${loudest.id}-flam`, start: Number(Math.max(0, loudest.start - 0.022).toFixed(4)),
        duration: 0.05, pitch: 38, velocity: Math.max(20, Math.round(loudest.velocity * 0.45)),
      });
      added.flams += 1;
      articulations.push({ time: loudest.start, name: "flam", intensity: 0.6 });
    }
  }

  if (family === "strings" || family === "brass" || family === "winds") {
    // CC1 phrase arc + CC11 bow/breath dynamics across the part.
    const step = Math.max(0.25, beatSeconds / 2);
    for (let t = 0; t <= songEnd; t += step) {
      const arc = phraseArc(t, input.phrases, barSeconds);
      const level = dynStart + (dynEnd - dynStart) * clamp(t / songEnd, 0, 1);
      cc.push({ controller: 1, time: Number(t.toFixed(3)), value: midi(40 + arc * 60 + level * 20) });
      cc.push({ controller: 11, time: Number(t.toFixed(3)), value: midi(50 + level * 60 + arc * 15) });
    }
    ccCurves.push("CC1 phrase arc", "CC11 bow/breath dynamics");
    // Bow changes / attacks at phrase starts.
    for (const phrase of input.phrases ?? []) {
      articulations.push({
        time: Number(((phrase.startBar - 1) * barSeconds).toFixed(3)),
        name: family === "strings" ? "bow_change" : "attack",
        intensity: 0.5,
      });
    }
  }

  if (family === "brass" || family === "winds" || family === "voice") {
    // Breathe: shorten the last note before every long rest.
    const ordered = notes.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const gap = ordered[i + 1].start - (ordered[i].start + ordered[i].duration);
      if (gap > 0.3) {
        ordered[i].duration = Math.max(0.05, ordered[i].duration - 0.08);
        added.breathGaps += 1;
      }
    }
  }

  if (family === "guitar" && (input.role === "RHYTHMIC_HARMONY" || input.role === "OSTINATO")) {
    articulations.push({ time: 0, name: "palm_mute", intensity: 0.4 });
  }
  if (family === "keys") {
    // Sustain pedal follows the harmonic rhythm, lifted on the beat.
    for (let t = 0; t <= songEnd; t += beatSeconds * beatsPerBar) {
      cc.push({ controller: 64, time: Number(t.toFixed(3)), value: 0 });
      cc.push({ controller: 64, time: Number((t + 0.03).toFixed(3)), value: 100 });
    }
    ccCurves.push("CC64 sustain pedal per bar");
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  cc.sort((a, b) => a.time - b.time || a.controller - b.controller);
  articulations.sort((a, b) => a.time - b.time);

  const meanOffset = offsets.length ? offsets.reduce((s, v) => s + v, 0) / offsets.length : 0;
  const variance = offsets.length
    ? offsets.reduce((s, v) => s + (v - meanOffset) ** 2, 0) / offsets.length
    : 0;

  return {
    notes,
    cc,
    articulations,
    evidence: {
      version: "1.0",
      engine: PERFORMANCE_ENGINE,
      seed,
      family,
      profile: profile.id,
      meanTimingOffsetMs: Number(meanOffset.toFixed(2)),
      timingStdMs: Number(Math.sqrt(variance).toFixed(2)),
      addedEvents: added,
      ccCurves,
      decisions,
    },
  };
}
