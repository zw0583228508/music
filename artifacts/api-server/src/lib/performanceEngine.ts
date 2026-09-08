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
  PerformanceStyle,
  PhrasePlan,
  StyleProfile,
} from "@workspace/db";
import { LEGATO_TOLERANCE_SECONDS } from "./musicalConstraints";

export const PERFORMANCE_ENGINE = "PERFORMANCE_ENGINE_V2" as const;
const MAX_DECISION_SAMPLE = 64;

// ---------------------------------------------------------------------------
// Style -> performance (PR-23)
// ---------------------------------------------------------------------------

const MELODIC_ROLES: ReadonlySet<string> = new Set(["LEAD", "COUNTER_MELODY", "CALL_RESPONSE"]);
const SUSTAINING_FAMILIES: ReadonlySet<string> = new Set(["strings", "brass", "winds", "voice"]);

/**
 * The performance-relevant slice of a resolved StyleProfile. Only dimensions
 * the profile actually evidences are carried, each with its provenance, so
 * the evidence can say *why* a bass sits behind the beat. Absent stays absent:
 * the engine then behaves exactly as V1 for that parameter.
 */
export function performanceStyleFromProfile(profile: StyleProfile | null | undefined): PerformanceStyle {
  const style: PerformanceStyle = {};
  if (!profile) return style;
  const dims = profile.dimensions as Record<string, { value: unknown; provenance: string } | undefined>;
  const sources: NonNullable<PerformanceStyle["sources"]> = [];
  const take = <K extends keyof PerformanceStyle>(key: K, dimension: string, accept: (value: unknown) => PerformanceStyle[K] | undefined) => {
    const dim = dims[dimension];
    if (!dim) return;
    const value = accept(dim.value);
    if (value === undefined) return;
    style[key] = value;
    sources.push({ dimension, value: value as string | number, provenance: dim.provenance });
  };
  const oneOf = <T extends string>(...allowed: T[]) => (value: unknown): T | undefined =>
    typeof value === "string" && (allowed as string[]).includes(value) ? (value as T) : undefined;
  take("swingRatio", "swingRatio", (v) => (typeof v === "number" && v >= 0.5 && v <= 0.8 ? v : undefined));
  take("microtiming", "microtiming", oneOf("quantized", "on_top", "behind", "ahead", "loose"));
  take("dynamics", "dynamics", oneOf("narrow", "moderate", "wide"));
  take("melodicOrnamentation", "melodicOrnamentation", oneOf("none", "light", "moderate", "heavy"));
  take("bassAttackPosition", "bassAttackPosition", oneOf("on_the_beat", "anticipated", "laid_back", "sustained"));
  take("fillFrequency", "fillFrequency", oneOf("rare", "moderate", "frequent"));
  take("articulationLanguage", "articulationLanguage", (v) => (typeof v === "string" && v.trim() ? v : undefined));
  if (sources.length) style.sources = sources;
  return style;
}

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
  /** PR-23: the instrument's playable range, so ornaments never leave it. */
  playableRange?: { min: number; max: number };
  /**
   * The instrument definition's articulation names. When given, the engine
   * never emits an articulation the instrument cannot map — a bow change on a
   * plucked bass is not a performance decision, it is a rendering error.
   */
  articulationVocabulary?: string[];
  /**
   * The instrument's polyphony limit. At 1, humanised lengths are clamped so
   * no note sustains past the next onset by more than the legato tolerance:
   * a performance must never break a constraint the composition satisfied.
   */
  maxSimultaneousNotes?: number;
  /**
   * PR-23: performance style resolved from the project's StyleProfile. When
   * absent, every parameter keeps its V1 default and the output is identical
   * to V1 -- supplying even an empty style enables the V2 behaviours (phrase
   * dynamics, legato/staccato articulation, keyswitch resolution).
   */
  performanceStyle?: PerformanceStyle;
  /**
   * PR-23: the track's articulation map (TrackMappingMetadata.articulationMap
   * or InstrumentDefinition.directiveMappings): articulation name -> keyswitch
   * note or renderer label. Numeric entries become `keyswitch` on the event,
   * which the VST3 worker plays as a short lead note.
   */
  articulationMap?: Record<string, string | number>;
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
  // The bass lives in the strings definition family but is plucked, exactly
  // the confusion the constraint engine already corrects for (PR-16). Without
  // this it inherits the bowed profile's legato lengthening and every note
  // overlaps the next; the finger-bass profile below was unreachable.
  const plucked = /bass/i.test(input.instrument);
  const profile = plucked ? FAMILY_PROFILES.bass : profileFor(family);
  const beatsPerBar = Number((input.meter ?? "4/4").split("/")[0]) || 4;
  const beatSeconds = 60 / Math.max(1, input.tempoBpm);
  const barSeconds = input.barSeconds ?? beatSeconds * beatsPerBar;
  const style = input.performanceStyle;
  const v2 = style !== undefined;
  const swing = (input.groove ?? "").includes("swing") || (style?.swingRatio ?? 0.5) > 0.5;
  // V1 swung every offbeat to the triplet point; a style names the ratio.
  const swingRatio = style?.swingRatio ?? 2 / 3;
  const rubato = input.groove === "rubato";
  const [dynStart, dynEnd] = dynamicRamp(input.dynamicShape);
  // Dynamics width: how much metrical accent and dynamic shape move velocity.
  const accentDepthScale = style?.dynamics === "narrow" ? 0.6 : style?.dynamics === "wide" ? 1.35 : 1;
  const [rangeFloor, rangeSpan] = style?.dynamics === "narrow" ? [0.82, 0.3]
    : style?.dynamics === "wide" ? [0.65, 0.6] : [0.75, 0.45];
  // Microtiming: where the player sits relative to the grid, and how loosely.
  const microFeelMs = style?.microtiming === "behind" ? 8 : style?.microtiming === "ahead" ? -6 : 0;
  const microJitterScale = style?.microtiming === "quantized" ? 0.1 : style?.microtiming === "loose" ? 1.6 : 1;
  const microFeelScale = style?.microtiming === "quantized" ? 0.2 : 1;

  const source = [...input.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const songEnd = Math.max(0.001, ...source.map((n) => n.start + n.duration));

  const notes: MusicalNote[] = [];
  const cc: ControlEvent[] = [];
  const articulations: ArticulationEvent[] = [];
  const vocabulary = input.articulationVocabulary;
  const pushArticulation = (event: ArticulationEvent) => {
    if (!vocabulary || vocabulary.includes(event.name)) articulations.push(event);
  };
  const decisions: PerformanceDecision[] = [];
  const added = { ghostNotes: 0, flams: 0, strumSpreadNotes: 0, breathGaps: 0, ornaments: 0, fills: 0, keyswitches: 0 };
  const ccCurves: string[] = [];
  const offsets: number[] = [];
  const phraseAt = (time: number): PhrasePlan | undefined => {
    if (!input.phrases?.length || barSeconds <= 0) return undefined;
    const bar = Math.floor(time / barSeconds) + 1;
    return input.phrases.find((p) => bar >= p.startBar && bar <= p.endBar);
  };
  // Phrase-role dynamics (V2): a pickup or opening starts a touch under, a
  // cadence tapers, a fill leans in. Applied on top of the phrase arc.
  const phraseRoleGain = (time: number): number => {
    if (!v2) return 1;
    const phrase = phraseAt(time);
    if (!phrase) return 1;
    const span = Math.max(1, phrase.endBar - phrase.startBar + 1) * barSeconds;
    const position = clamp((time - (phrase.startBar - 1) * barSeconds) / span, 0, 1);
    if (phrase.role === "pickup" || phrase.role === "opening") return position < 0.25 ? 0.94 : 1;
    if (phrase.role === "cadence") return position > 0.75 ? 0.9 : 1;
    if (phrase.role === "fill") return 1.05;
    return 1;
  };

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
    let offsetMs = (profile.feelMs + (ROLE_FEEL_MS[input.role] ?? 0)) * microFeelScale + microFeelMs;
    reasons.push(`${family} feel ${profile.feelMs}ms`, `${input.role} feel ${ROLE_FEEL_MS[input.role] ?? 0}ms`);
    if (style?.microtiming) reasons.push(`microtiming ${style.microtiming}`);
    if (plucked && style?.bassAttackPosition) {
      // Where the bassist places the attack against the kick.
      const bassMs = style.bassAttackPosition === "anticipated" ? -12
        : style.bassAttackPosition === "laid_back" ? 14 : 0;
      offsetMs += bassMs;
      reasons.push(`bass attack ${style.bassAttackPosition}`);
    }
    if (swing && Math.abs(fraction - 0.5) < 0.08) {
      offsetMs += beatSeconds * 1000 * (swingRatio - 0.5);
      reasons.push("swung offbeat");
      if (style?.swingRatio !== undefined) reasons.push(`swing ratio ${swingRatio.toFixed(2)}`);
    }
    if (rubato && arc > 0) {
      offsetMs += (1 - arc) * 12;
      reasons.push("rubato phrase breathing");
    }
    // Tighter on strong beats; looser off the grid.
    const jitterScale = profile.jitterMs * (0.4 + (1 - weight) * 0.9) * microJitterScale;
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
      const accent = 1 - profile.accentDepth * accentDepthScale * (1 - weight);
      let velocity = (note.velocity || 90) * accent;
      velocity *= rangeFloor + dynamicLevel * rangeSpan;
      velocity *= 0.9 + arc * 0.2;
      velocity *= phraseRoleGain(anchor.start);
      if (family === "drums") {
        // Kick/snare carry the accent; hats sit under them.
        if (note.pitch === 42 || note.pitch === 44 || note.pitch === 46) velocity *= 0.72;
        if (note.pitch === 36 || note.pitch === 38) velocity *= 1.08;
      }
      velocity += seededUnit(seed, `${note.id}:v`) * 4;
      const performedVelocity = midi(velocity);

      // --- length -----------------------------------------------------
      let duration = note.duration * profile.lengthFactor;
      if (plucked && style?.bassAttackPosition === "sustained") duration *= 1.15;
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
      pushArticulation({ time: loudest.start, name: "flam", intensity: 0.6 });
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
      pushArticulation({
        time: Number(((phrase.startBar - 1) * barSeconds).toFixed(3)),
        name: family === "strings" && !plucked ? "bow_change" : "attack",
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
    pushArticulation({ time: 0, name: "palm_mute", intensity: 0.4 });
  }
  if (family === "keys") {
    // Sustain pedal follows the harmonic rhythm, lifted on the beat.
    for (let t = 0; t <= songEnd; t += beatSeconds * beatsPerBar) {
      cc.push({ controller: 64, time: Number(t.toFixed(3)), value: 0 });
      cc.push({ controller: 64, time: Number((t + 0.03).toFixed(3)), value: 100 });
    }
    ccCurves.push("CC64 sustain pedal per bar");
  }

  // --- V2: ornaments, fills, articulation language, keyswitches -------------
  if (v2) {
    const phrases = input.phrases ?? [];
    const minPitch = input.playableRange?.min ?? 0;
    const maxPitch = input.playableRange?.max ?? 127;

    // Ornaments for melodic roles: a grace note from below into the phrase
    // peak (light), also into the phrase's first note (moderate), and a
    // slide-in to the phrase's last note (heavy). Deterministic, in range,
    // and short enough that the monophony clamp keeps the line playable.
    const ornamentation = style?.melodicOrnamentation ?? "none";
    if (ornamentation !== "none" && MELODIC_ROLES.has(input.role) && phrases.length) {
      for (const phrase of phrases) {
        const start = (phrase.startBar - 1) * barSeconds;
        const end = phrase.endBar * barSeconds;
        const inPhrase = notes.filter((n) => n.start >= start && n.start < end && !n.id.includes("-grace"));
        if (!inPhrase.length) continue;
        const targets: MusicalNote[] = [inPhrase.reduce((best, n) => (n.pitch > best.pitch ? n : best), inPhrase[0])];
        if (ornamentation !== "light") targets.push(inPhrase[0]);
        if (ornamentation === "heavy") targets.push(inPhrase[inPhrase.length - 1]);
        for (const target of new Set(targets)) {
          const gracePitch = target.pitch - 2;
          if (gracePitch < minPitch || target.start < 0.07) continue;
          notes.push({
            id: `${target.id}-grace`,
            start: Number((target.start - 0.06).toFixed(4)),
            duration: 0.05,
            pitch: gracePitch,
            velocity: midi(target.velocity * 0.7),
          });
          added.ornaments += 1;
        }
      }
      if (added.ornaments) ccCurves.push(`ornaments ${ornamentation}`);
    }

    // Drum fills into phrase boundaries: four sixteenths on the beat before a
    // phrase, rising into it. Frequency decides which boundaries earn one.
    if (family === "drums" && input.role === "GROOVE" && style?.fillFrequency && phrases.length) {
      const wants = (phrase: PhrasePlan): boolean =>
        style.fillFrequency === "rare" ? phrase.role === "fill"
          : style.fillFrequency === "moderate" ? phrase.role === "fill" || phrase.role === "cadence"
            : phrase.role === "fill" || phrase.role === "cadence" || phrase.entersFamilies.length > 0;
      const fillPitches = [38, 45, 43, 41];
      for (const phrase of phrases) {
        if (!wants(phrase)) continue;
        const phraseStart = (phrase.startBar - 1) * barSeconds;
        const fillStart = phraseStart - beatSeconds;
        if (fillStart < 0) continue;
        for (let i = 0; i < 4; i += 1) {
          notes.push({
            id: `${phrase.id}-fill-${i}`,
            start: Number((fillStart + (i * beatSeconds) / 4).toFixed(4)),
            duration: 0.08,
            pitch: fillPitches[i],
            velocity: 70 + i * 13,
          });
        }
        added.fills += 1;
      }
    }

    // Articulation language for sustaining lines: legato at phrase starts
    // when the line is connected; staccato once per phrase when most of its
    // notes are detached. Both go through the vocabulary gate.
    if (SUSTAINING_FAMILIES.has(family) && !plucked && phrases.length) {
      for (const phrase of phrases) {
        const start = (phrase.startBar - 1) * barSeconds;
        const end = phrase.endBar * barSeconds;
        const inPhrase = notes.filter((n) => n.start >= start && n.start < end).sort((a, b) => a.start - b.start);
        if (inPhrase.length < 2) continue;
        let detached = 0;
        for (let i = 0; i + 1 < inPhrase.length; i += 1) {
          const ioi = inPhrase[i + 1].start - inPhrase[i].start;
          if (ioi > 0 && inPhrase[i].duration < ioi * 0.35) detached += 1;
        }
        const ratio = detached / (inPhrase.length - 1);
        pushArticulation({ time: Number(start.toFixed(3)), name: ratio >= 0.6 ? "staccato" : "legato", intensity: 0.5 });
      }
    }

    // Keyswitches: resolve articulation names through the track's map so the
    // renderer plays them, not just reads them.
    if (input.articulationMap) {
      for (let i = 0; i < articulations.length; i += 1) {
        const mapped = input.articulationMap[articulations[i].name];
        const key = typeof mapped === "number" ? mapped : typeof mapped === "string" && /^\d+$/.test(mapped) ? Number(mapped) : undefined;
        if (key !== undefined && key >= 0 && key <= 127 && articulations[i].keyswitch === undefined) {
          articulations[i] = { ...articulations[i], keyswitch: key };
          added.keyswitches += 1;
        }
      }
    }
    void maxPitch;
  }

  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  cc.sort((a, b) => a.time - b.time || a.controller - b.controller);
  articulations.sort((a, b) => a.time - b.time);

  const meanOffset = offsets.length ? offsets.reduce((s, v) => s + v, 0) / offsets.length : 0;
  const variance = offsets.length
    ? offsets.reduce((s, v) => s + (v - meanOffset) ** 2, 0) / offsets.length
    : 0;

  if (input.maxSimultaneousNotes === 1) {
    // Monophonic instrument: a humanised tail may lap the next onset by the
    // legato tolerance and no more. Same rule the constraint engine and the
    // provider contract validator apply, so what is performed still passes.
    notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    for (let index = 0; index + 1 < notes.length; index += 1) {
      const limit = notes[index + 1].start + LEGATO_TOLERANCE_SECONDS - notes[index].start;
      if (notes[index].duration > limit) {
        notes[index] = { ...notes[index], duration: Number(Math.max(0.02, limit).toFixed(4)) };
      }
    }
  }

  return {
    notes,
    cc,
    articulations,
    evidence: {
      version: "1.0",
      engine: PERFORMANCE_ENGINE,
      engineVersion: v2 ? "2.0" : "1.0",
      seed,
      family,
      profile: profile.id,
      meanTimingOffsetMs: Number(meanOffset.toFixed(2)),
      timingStdMs: Number(Math.sqrt(variance).toFixed(2)),
      addedEvents: v2
        ? added
        : { ghostNotes: added.ghostNotes, flams: added.flams, strumSpreadNotes: added.strumSpreadNotes, breathGaps: added.breathGaps },
      ccCurves,
      ...(v2 ? { styleInputs: style?.sources ?? [] } : {}),
      decisions,
    },
  };
}
