/**
 * Adversarial critic — instrument reality (Brain B-05b).
 *
 * Parts a player would refuse or resent. Two tiers:
 *   - impossible: the calibrated constraint engine's errors (range, polyphony,
 *     hand span, leap, breath, re-articulation) - reused, never re-derived;
 *   - possible but not idiomatic: a string bed parked at MIDI 79-91 for a
 *     section, brass with no breathing room, a plucked bass held past its
 *     decay, endless sustains, cluster voicings on keys, a part living at the
 *     extreme of its range for a whole section - and an instrument whose
 *     definition resolved to another family (a keys part that became a kit).
 */
import { checkArrangementConstraints } from "../../musicalConstraints";
import { roleWindowForDefinition } from "../dimensions/register";
import { plannedRolesFor, roleInSectionFor } from "../dimensions/shared";
import type { CriticDimensionReport, CriticInput, CriticObservation } from "../types";
import {
  barAt, barSpan, buildReport, cellCoverage, clustersOf, confidenceFromEvidence, effectPast, longestUnbrokenRun,
  makeObservation, mean, notApplicable, prepare, type ControlStatus,
} from "./shared";

export const INSTRUMENT_REALITY_DIMENSION = "adversarial.instrumentReality" as const;
export const INSTRUMENT_REALITY_VERSION = "ADVERSARIAL_INSTRUMENT_REALITY_v1" as const;

export const INSTRUMENT_REALITY_KINDS = [
  "physically_unplayable", "outside_comfortable_range", "definition_family_mismatch", "string_bed_too_high",
  "sustained_extreme_register", "endless_sustain", "brass_no_breathing_room", "bass_sustain_beyond_decay",
  "keyboard_cluster_voicing",
] as const;

/**
 * How high a string section may sit for a whole section is **not a constant**
 * (B-26, the lead's F15 ruling).
 *
 * Until B-26 this rule compared a bed's mean pitch to a flat 79 while the
 * `register` dimension asked `instrumentProfile.roleRegisterFor` — which gives
 * a violin section 60-79 as a PAD and **67-91** as a CLIMAX_LAYER. The two
 * disagreed, and the disagreement was visible: `orchestral-midi`'s
 * `strings-climax_layer` averages MIDI 79.93 in the Chorus, which the profile
 * allows for a climax layer and this rule refused, so `register` scored 100 on
 * an arrangement the adversarial critic called too high. A climax layer is
 * *supposed* to sit above a bed. Two sources of truth for one musical claim —
 * the third recurrence of the program's standing bug — so the constant is gone
 * and the rule asks the same function the dimension asks.
 *
 * What is *not* changed: the shape of the claim. The rule still reads the
 * section's **mean** pitch, because a bed whose mean sits at its own role
 * ceiling has half its notes above it for the whole section, which is what an
 * arranger hears as "parked up there". For a PAD the profile's ceiling is 79,
 * exactly the constant it replaces, so the owner's own `strings-pad` at mean
 * 80.00 still fires — that one is the writer's problem, and F15 says so.
 */
const MIN_SECTION_BARS = 4;
/** Share of the playable range at either extreme that counts as "the extreme". */
const EXTREME_SHARE = 0.1;
const EXTREME_MIN_BARS = 8;
/** Sustain lengths a player resents (seconds), by family. */
const RESENTED_SUSTAIN: Record<string, number> = { brass: 6, winds: 6, voice: 6, keys: 8, guitar: 6, strings: 16, synth: 24 };
/** Brass and winds must find a rest of this length inside this many seconds. */
const BREATH_REST_SECONDS = 0.4;
const BREATH_RUN_SECONDS = 12;
/** A plucked bass note has decayed by then. */
const BASS_DECAY_SECONDS = 5;
/** Notes within this span on a keyboard are a cluster, not a voicing. */
const CLUSTER_SPAN = 5;
const CLUSTER_NOTES = 4;
const MIN_NOTES = 8;
const COMFORT_SHARE = 0.5;

const FAMILY_WORDS: Array<[RegExp, string]> = [
  [/drum|perc|kit/i, "drums"],
  [/bass/i, "bass"],
  [/piano|keys|keyboard|organ|rhodes|wurli|clav/i, "keys"],
  [/violin|viola|cello|string/i, "strings"],
  [/trumpet|trombone|horn|tuba|brass/i, "brass"],
  [/flute|clarinet|oboe|bassoon|sax|wind|reed/i, "winds"],
  [/guitar/i, "guitar"],
  [/synth|pad|lead/i, "synth"],
  [/voice|vocal|choir/i, "voice"],
];

function namedFamily(instrument: string): string | null {
  for (const [re, family] of FAMILY_WORDS) if (re.test(instrument)) return family;
  return null;
}

export function critiqueInstrumentReality(input: CriticInput, options: { controlStatus?: ControlStatus } = {}): CriticDimensionReport {
  const prep = prepare(input);
  if ("reason" in prep) return notApplicable(INSTRUMENT_REALITY_DIMENSION, INSTRUMENT_REALITY_VERSION, prep.reason, options.controlStatus);
  const { grid, sections, parts } = prep;
  const observations: CriticObservation[] = [];
  const obs = (draft: Parameters<typeof makeObservation>[0]) => observations.push(makeObservation(draft, sections));

  // Tempo from the Song Model, else from the bar grid itself - never a default.
  const firstSpan = grid.bars[0];
  const tempoBpm = input.songModel.tempoMap?.[0]?.bpm ?? 60 / ((firstSpan.end - firstSpan.start) / firstSpan.beats);

  // Tier 1: the calibrated engine.
  const report = checkArrangementConstraints(
    parts.map((p) => ({
      id: p.id, instrument: p.track.instrument, role: p.track.role, instrumentDefinition: p.track.instrumentDefinition,
      notes: p.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
      articulations: p.track.articulations,
    })),
    { tempoBpm },
  );
  for (const track of report.byTrack) {
    const byCode = new Map<string, typeof track.violations>();
    for (const v of track.violations.filter((x) => x.severity === "error")) {
      const list = byCode.get(v.code) ?? [];
      list.push(v);
      byCode.set(v.code, list);
    }
    for (const [code, list] of [...byCode.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const bars = list.map((v) => barAt(grid, v.startSeconds));
      obs({
        dimension: INSTRUMENT_REALITY_DIMENSION, kind: "physically_unplayable", severity: "blocking",
        startBar: Math.min(...bars), endBar: Math.max(...list.map((v) => barAt(grid, v.endSeconds ?? v.startSeconds))), trackIds: [track.trackId],
        evidence: { constraintCode: code, violations: list.length, family: list[0].family, example: list[0].message, engineFeasible: track.feasible },
        confidence: confidenceFromEvidence(list.length, 1, 1),
        repair: { operation: "fix_playability", detail: list[0].suggestedFix },
      });
    }
    const warnings = track.violations.filter((x) => x.severity === "warning" && x.code === "outside_comfortable_range");
    const part = parts.find((p) => p.id === track.trackId);
    if (part && part.notes.length >= MIN_NOTES) {
      const share = warnings.length / part.notes.length;
      if (share >= COMFORT_SHARE) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "outside_comfortable_range", severity: "minor",
          startBar: part.activeBars[0], endBar: part.activeBars[part.activeBars.length - 1], trackIds: [part.id],
          evidence: { outsideComfortableShare: share, notes: part.notes.length, comfortableMin: part.track.instrumentDefinition.comfortableRange.min, comfortableMax: part.track.instrumentDefinition.comfortableRange.max },
          confidence: confidenceFromEvidence(part.notes.length, MIN_NOTES, effectPast(share, COMFORT_SHARE, 1)),
          repair: { operation: "move_register", detail: "Most of the part sits outside the comfortable register; move it by an octave or give the material to an instrument that lives there." },
        });
      }
    }
  }

  for (const part of parts) {
    const def = part.track.instrumentDefinition;
    const first = part.activeBars[0];
    const last = part.activeBars[part.activeBars.length - 1];
    const isBass = /bass/i.test(`${part.track.instrument} ${def.id}`);

    // Definition family mismatch: the name says one instrument, the definition another.
    const named = namedFamily(part.track.instrument);
    const resolved = isBass && def.id === "bass" ? "bass" : def.family;
    if (named && named !== resolved && !(named === "bass" && def.id === "bass") && !(named === "synth" && def.family === "keys")) {
      obs({
        dimension: INSTRUMENT_REALITY_DIMENSION, kind: "definition_family_mismatch", severity: "blocking",
        startBar: first, endBar: last, trackIds: [part.id],
        evidence: { instrument: part.track.instrument, namedFamily: named, definitionId: def.id, definitionFamily: def.family, notes: part.notes.length },
        confidence: confidenceFromEvidence(part.notes.length, 1, 1),
        repair: { operation: "resolve_definition", detail: `"${part.track.instrument}" resolved to the ${def.id} definition (${def.family}); it will be constrained, performed and rendered as that instrument. Resolve the definition by name, not by role.` },
      });
    }

    if (part.percussion) continue;

    // Idiom tier, per section.
    for (const section of sections) {
      const bars = part.activeBars.filter((b) => b >= section.startBar && b <= section.endBar);
      if (bars.length < MIN_SECTION_BARS) continue;
      const notes = bars.flatMap((b) => part.byBar.get(b)!);
      const meanPitch = mean(notes.map((n) => n.pitch));
      const seconds = barSpan(grid, bars[bars.length - 1]).end - barSpan(grid, bars[0]).start;
      // B-26 / F15: the ceiling is the one this part's own profile gives it in
      // the role it holds *here*, read through the register dimension's own
      // function. A PAD violin section still answers 79; a CLIMAX_LAYER
      // answers 91 and is allowed to sit where a pad may not.
      const roleHere = roleInSectionFor(plannedRolesFor(input.plan, part.track.instrument), section.name, part.track.role);
      const ceiling = roleWindowForDefinition(def, roleHere, { min: def.comfortableRange.min, max: def.comfortableRange.max }).hi;
      if (def.family === "strings" && !isBass && meanPitch >= ceiling) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "string_bed_too_high", severity: "major",
          startBar: bars[0], endBar: bars[bars.length - 1], trackIds: [part.id],
          evidence: {
            meanPitch, minPitch: Math.min(...notes.map((n) => n.pitch)), maxPitch: Math.max(...notes.map((n) => n.pitch)),
            bars: bars.length, seconds, threshold: ceiling, role: roleHere,
            ceilingSource: roleWindowForDefinition(def, roleHere, { min: def.comfortableRange.min, max: def.comfortableRange.max }).source,
          },
          confidence: confidenceFromEvidence(bars.length, MIN_SECTION_BARS, effectPast(meanPitch, ceiling - 1, ceiling + 6)),
          repair: { operation: "lower_string_bed", detail: `The string bed averages MIDI ${Math.round(meanPitch)} for ${bars.length} bars against a ${roleHere} ceiling of ${ceiling}; a section pad belongs an octave lower (violas/celli on the bed, violins only for the top line).` },
          attribution: { layer: "register", planExplains: 0 },
        });
        continue;
      }
      const span = def.playableRange.max - def.playableRange.min;
      const top = def.playableRange.max - span * EXTREME_SHARE;
      const bottom = def.playableRange.min + span * EXTREME_SHARE;
      if (bars.length >= EXTREME_MIN_BARS && (meanPitch >= top || meanPitch <= bottom)) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "sustained_extreme_register", severity: "minor",
          startBar: bars[0], endBar: bars[bars.length - 1], trackIds: [part.id],
          evidence: { meanPitch, playableMin: def.playableRange.min, playableMax: def.playableRange.max, bars: bars.length, extreme: meanPitch >= top ? "top" : "bottom" },
          confidence: confidenceFromEvidence(bars.length, EXTREME_MIN_BARS, effectPast(meanPitch >= top ? meanPitch - top : bottom - meanPitch, 0, span * EXTREME_SHARE)),
          repair: { operation: "move_register", detail: `${part.id} lives at the ${meanPitch >= top ? "top" : "bottom"} of its range for ${bars.length} bars; the extreme is for a moment, not a section.` },
          attribution: { layer: "register", planExplains: 0 },
        });
      }
    }

    // Endless sustains.
    const limit = isBass ? null : RESENTED_SUSTAIN[def.family] ?? null;
    if (limit !== null) {
      const long = part.notes.filter((n) => n.duration >= limit);
      if (long.length) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "endless_sustain", severity: long.length >= 4 ? "major" : "minor",
          startBar: barAt(grid, long[0].start), endBar: barAt(grid, Math.max(...long.map((n) => n.start + n.duration)) - 0.05), trackIds: [part.id],
          evidence: { notesAtOrBeyondLimit: long.length, limitSeconds: limit, longestSeconds: Math.max(...long.map((n) => n.duration)), family: def.family },
          confidence: confidenceFromEvidence(long.length, 2, effectPast(Math.max(...long.map((n) => n.duration)), limit, limit * 2)),
          repair: { operation: "rearticulate", detail: `${part.id} holds notes for up to ${Math.round(Math.max(...long.map((n) => n.duration)))} s; re-bow, re-attack or re-voice at phrase boundaries (a ${def.family} player will).` },
        });
      }
    }

    // Brass / winds with no breathing room.
    if (def.family === "brass" || def.family === "winds") {
      const run = longestUnbrokenRun(part.notes, BREATH_REST_SECONDS);
      if (run.seconds >= BREATH_RUN_SECONDS) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "brass_no_breathing_room", severity: "major",
          startBar: barAt(grid, run.start), endBar: barAt(grid, run.start + run.seconds - 0.05), trackIds: [part.id],
          evidence: { longestRunWithoutRestSeconds: run.seconds, restSeconds: BREATH_REST_SECONDS, limitSeconds: BREATH_RUN_SECONDS },
          confidence: confidenceFromEvidence(1, 1, effectPast(run.seconds, BREATH_RUN_SECONDS, BREATH_RUN_SECONDS * 2)),
          repair: { operation: "write_breaths", detail: `${part.id} plays ${Math.round(run.seconds)} s without a ${BREATH_REST_SECONDS}-second rest; phrase it in 2-4 bar breaths or split it across the section.` },
        });
      }
    }

    // Plucked bass held past its decay.
    if (isBass) {
      const long = part.notes.filter((n) => n.duration >= BASS_DECAY_SECONDS);
      if (long.length) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "bass_sustain_beyond_decay", severity: "minor",
          startBar: barAt(grid, long[0].start), endBar: barAt(grid, Math.max(...long.map((n) => n.start + n.duration)) - 0.05), trackIds: [part.id],
          evidence: { notesBeyondDecay: long.length, decaySeconds: BASS_DECAY_SECONDS, longestSeconds: Math.max(...long.map((n) => n.duration)) },
          confidence: confidenceFromEvidence(long.length, 2, effectPast(Math.max(...long.map((n) => n.duration)), BASS_DECAY_SECONDS, BASS_DECAY_SECONDS * 2)),
          repair: { operation: "rearticulate", detail: "A plucked bass note is gone after a few seconds; re-strike on the chord's half or write the pattern the groove asks for." },
        });
      }
    }

    // Cluster voicings on keys / guitar.
    if (def.family === "keys" || def.family === "guitar") {
      const clusters = clustersOf(part.notes).filter((c) => {
        const pitches = [...new Set(c.map((n) => n.pitch))];
        if (pitches.length < CLUSTER_NOTES) return false;
        pitches.sort((a, b) => a - b);
        for (let i = 0; i + CLUSTER_NOTES - 1 < pitches.length; i += 1) {
          if (pitches[i + CLUSTER_NOTES - 1] - pitches[i] <= CLUSTER_SPAN) return true;
        }
        return false;
      });
      if (clusters.length) {
        obs({
          dimension: INSTRUMENT_REALITY_DIMENSION, kind: "keyboard_cluster_voicing", severity: "minor",
          startBar: barAt(grid, clusters[0][0].start), endBar: barAt(grid, clusters[clusters.length - 1][0].start), trackIds: [part.id],
          evidence: { clusterVoicings: clusters.length, spanSemitones: CLUSTER_SPAN, notesInCluster: CLUSTER_NOTES },
          confidence: confidenceFromEvidence(clusters.length, 2, 1),
          repair: { operation: "revoice", detail: `${clusters.length} voicing(s) put ${CLUSTER_NOTES} notes inside ${CLUSTER_SPAN} semitones; open the voicing or drop the doubled tone.` },
        });
      }
    }
  }

  return buildReport({
    dimension: INSTRUMENT_REALITY_DIMENSION, version: INSTRUMENT_REALITY_VERSION, observations,
    coverage: cellCoverage(parts, grid), controlStatus: options.controlStatus,
  });
}
