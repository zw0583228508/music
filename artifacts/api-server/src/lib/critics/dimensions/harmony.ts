/**
 * Harmony dimension (B-05a): chord-tone fit of every pitched part against the
 * Song Model's chords at the real harmonic rhythm.
 *
 * Every note is weighed by how long it sounds under each chord. Non-chord
 * tones are classified from their own part's context — passing, neighbour,
 * suspension, anticipation, appoggiatura — and only the remainder is a clash.
 * Clashes are located per part and section; the bass is additionally asked to
 * state chord tones (a bass that leaves the chord is a harmony defect even
 * when an upper voice may pass through).
 *
 * Suspected origin: the chords are given, so a part that leaves them is a
 * composition defect (`compose`). When the clashes sit on notes that *started*
 * under the previous chord the failure is duration, not pitch
 * (`overhang_across_chord_change`, still `compose`). When the chord timeline
 * itself is low-confidence the plan's harmony is the likelier culprit
 * (`harmony`), and the origin confidence says how much that doubt weighs.
 */
import type { CriticDimension, CriticInput } from "../types";
import {
  buildContext,
  buildReport,
  confidenceFromCount,
  mean,
  notApplicable,
  onsetClusters,
  round,
  severityFromShare,
  type ChordInfo,
  type CriticContext,
  type NoteRef,
  type ObservationDraft,
  type PartInfo,
} from "./shared";

export const HARMONY_DIMENSION = "harmony";
export const HARMONY_VERSION = "1.0";

export type NonChordToneClass = "passing" | "neighbour" | "suspension" | "anticipation" | "appoggiatura" | "clash";

export type NoteHarmonyReading = {
  note: NoteRef;
  chord: ChordInfo;
  chordTone: boolean;
  cls: NonChordToneClass | "chord_tone";
  /** Seconds the note sounds under its dominant chord. */
  weight: number;
  overhang: boolean;
  outOfKey: boolean;
};

const STEP = 2;

function nearestInCluster(cluster: NoteRef[] | undefined, pitch: number): NoteRef | null {
  if (!cluster || !cluster.length) return null;
  let best: NoteRef | null = null;
  for (const n of cluster) if (!best || Math.abs(n.pitch - pitch) < Math.abs(best.pitch - pitch)) best = n;
  return best;
}

/** Classify every note of a part against the chords it sounds under. */
export function readPartHarmony(context: CriticContext, part: PartInfo): NoteHarmonyReading[] {
  const clusters = onsetClusters(part.notes);
  const out: NoteHarmonyReading[] = [];
  for (let c = 0; c < clusters.length; c += 1) {
    const prevCluster = clusters[c - 1];
    const nextCluster = clusters[c + 1];
    for (const note of clusters[c]) {
      const overlapping = context.chordsOverlapping(note.start, note.end);
      if (!overlapping.length) continue;
      const dominant = overlapping.reduce((a, b) => (b.overlap > a.overlap ? b : a));
      const chord = dominant.chord;
      const chordTone = chord.pitchClasses.has(note.pc);
      const outOfKey = Boolean(context.keyPcs && !context.keyPcs.has(note.pc) && !chordTone);
      const overhang = note.start < chord.start - 1e-3;
      if (chordTone) {
        out.push({ note, chord, chordTone: true, cls: "chord_tone", weight: dominant.overlap, overhang: false, outOfKey: false });
        continue;
      }
      const prev = nearestInCluster(prevCluster, note.pitch);
      const next = nearestInCluster(nextCluster, note.pitch);
      const nextChordTone = next ? (context.chordAt(next.start)?.pitchClasses.has(next.pc) ?? false) : false;
      const nextChord = context.chords[chord.index + 1];
      let cls: NonChordToneClass = "clash";
      if (prev && next && Math.abs(note.pitch - prev.pitch) <= STEP && Math.abs(next.pitch - note.pitch) <= STEP &&
        Math.sign(note.pitch - prev.pitch) === Math.sign(next.pitch - note.pitch) && nextChordTone) {
        cls = "passing";
      } else if (prev && next && Math.abs(note.pitch - prev.pitch) <= STEP && next.pitch === prev.pitch) {
        cls = "neighbour";
      } else if (prev && prev.pitch === note.pitch && next && note.pitch - next.pitch > 0 &&
        note.pitch - next.pitch <= STEP && nextChordTone &&
        (context.chordAt(prev.start)?.pitchClasses.has(prev.pc) ?? false)) {
        cls = "suspension";
      } else if (nextChord && nextChord.pitchClasses.has(note.pc) && note.end >= chord.end - 1e-3 &&
        note.start >= chord.end - note.beatSeconds) {
        cls = "anticipation";
      } else if (prev && next && Math.abs(note.pitch - prev.pitch) > STEP && Math.abs(next.pitch - note.pitch) <= STEP && nextChordTone &&
        note.duration <= note.beatSeconds) {
        cls = "appoggiatura";
      }
      out.push({ note, chord, chordTone: false, cls, weight: dominant.overlap, overhang, outOfKey });
    }
  }
  return out;
}

type Aggregate = {
  weight: number;
  chordToneWeight: number;
  clashWeight: number;
  overhangClashWeight: number;
  outOfKeyWeight: number;
  notes: number;
  clashNotes: number;
  classes: Record<NonChordToneClass, number>;
  chordConfidence: number[];
};

const emptyAggregate = (): Aggregate => ({
  weight: 0, chordToneWeight: 0, clashWeight: 0, overhangClashWeight: 0, outOfKeyWeight: 0, notes: 0, clashNotes: 0,
  classes: { passing: 0, neighbour: 0, suspension: 0, anticipation: 0, appoggiatura: 0, clash: 0 },
  chordConfidence: [],
});

function add(agg: Aggregate, r: NoteHarmonyReading): void {
  agg.weight += r.weight;
  agg.notes += 1;
  agg.chordConfidence.push(r.chord.confidence);
  if (r.chordTone) agg.chordToneWeight += r.weight;
  else {
    agg.classes[r.cls as NonChordToneClass] += 1;
    if (r.cls === "clash") {
      agg.clashWeight += r.weight;
      agg.clashNotes += 1;
      if (r.overhang) agg.overhangClashWeight += r.weight;
    }
    if (r.outOfKey) agg.outOfKeyWeight += r.weight;
  }
}

export function evaluateHarmony(input: CriticInput) {
  const context = buildContext(input);
  if (!context.chords.length) return notApplicable(HARMONY_DIMENSION, HARMONY_VERSION, context, "the Song Model carries no chord timeline");
  if (!context.pitched.length) return notApplicable(HARMONY_DIMENSION, HARMONY_VERSION, context, "no pitched part to judge against the chords");

  const drafts: ObservationDraft[] = [];
  let examined = 0;
  let total = 0;

  for (const part of context.pitched) {
    const readings = readPartHarmony(context, part);
    total += part.notes.length;
    examined += readings.length;
    if (!readings.length) continue;
    const whole = emptyAggregate();
    for (const r of readings) add(whole, r);
    drafts.push({
      kind: "measured",
      severity: "info",
      location: { startBar: 1, endBar: context.totalBars, trackIds: [part.id] },
      evidence: {
        notesExamined: whole.notes,
        chordToneShare: whole.weight ? whole.chordToneWeight / whole.weight : 0,
        clashShare: whole.weight ? whole.clashWeight / whole.weight : 0,
        outOfKeyShare: whole.weight ? whole.outOfKeyWeight / whole.weight : 0,
        passing: whole.classes.passing,
        neighbour: whole.classes.neighbour,
        suspension: whole.classes.suspension,
        anticipation: whole.classes.anticipation,
        appoggiatura: whole.classes.appoggiatura,
        clash: whole.classes.clash,
        meanChordConfidence: mean(whole.chordConfidence),
      },
      suspectedOrigin: "compose",
      originConfidence: 0,
      recommendedRepair: null,
      confidence: confidenceFromCount(whole.notes, 24),
    });

    for (const section of context.sections) {
      const agg = emptyAggregate();
      for (const r of readings) if (r.note.bar >= section.startBar && r.note.bar <= section.endBar) add(agg, r);
      if (agg.notes < 3 || agg.weight <= 0) continue;
      const chordConf = mean(agg.chordConfidence);
      const location = { startBar: section.startBar, endBar: section.endBar, sectionName: section.name, trackIds: [part.id] };
      const evidenceQuality = 0.5 + 0.5 * chordConf;

      const clashShare = agg.clashWeight / agg.weight;
      const clashSeverity = severityFromShare(clashShare, part.family === "bass" ? [0.06, 0.15, 0.35] : [0.08, 0.2, 0.45]);
      if (clashSeverity) {
        const overhangShare = agg.clashWeight ? agg.overhangClashWeight / agg.clashWeight : 0;
        const overhang = overhangShare >= 0.6;
        const origin = chordConf >= 0.5 ? "compose" : "harmony";
        drafts.push({
          kind: overhang ? "overhang_across_chord_change" : "clash_share",
          severity: clashSeverity,
          location,
          evidence: {
            clashShare, clashNotes: agg.clashNotes, notesExamined: agg.notes,
            chordToneShare: agg.chordToneWeight / agg.weight, overhangShare, meanChordConfidence: chordConf,
            family: part.family,
          },
          suspectedOrigin: origin,
          originConfidence: confidenceFromCount(agg.clashNotes, 6, origin === "compose" ? chordConf : 1 - chordConf),
          recommendedRepair: overhang
            ? { operation: "shorten_or_retie_at_chord_change", scope: "note", detail: `end or re-strike ${part.instrument} notes at the chord changes in ${section.name}` }
            : { operation: "revoice_to_chord_tones", scope: "part", detail: `move ${part.instrument}'s clashing pitches in ${section.name} onto tones of the sounding chord (${Math.round(clashShare * 100)} % of its time clashes)` },
          confidence: confidenceFromCount(agg.notes, 16, evidenceQuality),
        });
      }

      if (context.keyPcs) {
        const outOfKey = agg.outOfKeyWeight / agg.weight;
        const sev = severityFromShare(outOfKey, [0.1, 0.25, 0.5]);
        if (sev) {
          drafts.push({
            kind: "out_of_key_share",
            severity: sev,
            location,
            evidence: { outOfKeyShare: outOfKey, key: context.keyName ?? "", notesExamined: agg.notes },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(agg.notes, 12, evidenceQuality),
            recommendedRepair: { operation: "constrain_to_key", scope: "part", detail: `${part.instrument} in ${section.name} leaves ${context.keyName} for ${Math.round(outOfKey * 100)} % of its sounding time without a chord asking for it` },
            confidence: confidenceFromCount(agg.notes, 16, evidenceQuality),
          });
        }
      }

      if (part.family === "bass") {
        const chordToneShare = agg.chordToneWeight / agg.weight;
        if (chordToneShare < 0.7) {
          drafts.push({
            kind: "bass_leaves_chord",
            severity: chordToneShare < 0.4 ? "major" : "minor",
            location,
            evidence: { chordToneShare, notesExamined: agg.notes },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(agg.notes, 8, evidenceQuality),
            recommendedRepair: { operation: "bass_on_chord_tones", scope: "part", detail: `the bass states chord tones for only ${Math.round(chordToneShare * 100)} % of ${section.name}` },
            confidence: confidenceFromCount(agg.notes, 12, evidenceQuality),
          });
        }
        // Root statement at chord changes: how often the first bass note under a new chord is its root (or the slash bass).
        const changes = context.chords.filter((c) => c.startBar >= section.startBar && c.startBar <= section.endBar);
        let stated = 0;
        let counted = 0;
        for (const chord of changes) {
          const first = part.notes.find((n) => n.start >= chord.start - 0.05 && n.start < chord.end);
          if (!first) continue;
          counted += 1;
          const wanted = chord.tones?.requiredBass ?? chord.rootPc;
          if (wanted !== null && first.pc === wanted) stated += 1;
        }
        if (counted >= 4 && stated / counted < 0.5) {
          drafts.push({
            kind: "bass_rarely_states_root",
            severity: "minor",
            location,
            evidence: { rootStatedShare: stated / counted, chordChanges: counted },
            suspectedOrigin: "compose",
            originConfidence: confidenceFromCount(counted, 6, evidenceQuality),
            recommendedRepair: { operation: "plan_bass_line", scope: "part", detail: `the bass opens only ${stated}/${counted} chords in ${section.name} on the root or slash bass; plan inversions deliberately or state roots` },
            confidence: confidenceFromCount(counted, 8, evidenceQuality),
          });
        }
      }
    }
  }

  return buildReport({
    dimension: HARMONY_DIMENSION,
    version: HARMONY_VERSION,
    context,
    drafts,
    coverage: total ? round(examined / total) : 0,
  });
}

export const harmonyDimension: CriticDimension = {
  dimension: HARMONY_DIMENSION,
  version: HARMONY_VERSION,
  evaluate: evaluateHarmony,
};
