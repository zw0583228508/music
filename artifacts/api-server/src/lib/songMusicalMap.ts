/**
 * Canonical Song Model V2 — derived musical map.
 *
 * `deriveMusicalMap()` turns the raw analysis evidence already on a Song Model
 * (chords, melody, beats, sections, energy, dynamics, stems, vocal
 * intelligence) into the analytical layer the Arrangement Brain reads:
 * harmonic rhythm / cadences / tension, melodic phrases / motifs / contour,
 * groove / syncopation / subdivisions, section-aligned energy and dynamics,
 * subphrases / transitions / climax candidates, and an abstract style
 * fingerprint.
 *
 * Principles (identical to the rest of the Song Model contract):
 *   - Deterministic. Same evidence in -> byte-identical map out (modulo the
 *     `derivedAt` metadata timestamp, which is excluded from `inputsDigestSha256`).
 *   - Never fabricates. A group whose inputs are missing is `not_available`
 *     with a `reason` and an empty payload.
 *   - Provenanced. Every group records `derivedFrom` and a versioned `method`.
 *   - Timeline-consistent. Bar spans and time ranges are emitted without
 *     `coordinates`; `canonicalizeSongModelCoordinates` fills and checks them
 *     against the tempo and meter maps, exactly as for `vocalIntelligence`.
 */
import { createHash } from "node:crypto";
import type {
  ChordHarmonyEvent,
  SongModelData,
  SongModelMusicalMap,
} from "@workspace/db";
import { createCanonicalTimeline } from "./canonicalTimeline";

export const MUSICAL_MAP_VERSION = "2.2" as const;

type Timeline = ReturnType<typeof createCanonicalTimeline>;

type DeriveOptions = { now?: Date };

// ---------------------------------------------------------------------------
// Small music-theory helpers (self-contained; not shared with musicEngines).
// ---------------------------------------------------------------------------

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};

function parseRootPitchClass(symbol: string): number | null {
  const normalized = symbol.replace("♯", "#").replace("♭", "b").trim();
  const match = /^([A-Ga-g])([#b]?)/.exec(normalized);
  if (!match) return null;
  const key = `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
  const value = NOTE_ROOTS[key];
  return value === undefined ? null : value;
}

/** Distance on the circle of fifths between two pitch classes (0..6). */
function circleOfFifthsDistance(a: number, b: number): number {
  const fifths = (pc: number) => (pc * 7) % 12;
  const raw = Math.abs(fifths(a) - fifths(b)) % 12;
  return Math.min(raw, 12 - raw);
}

/** Rough intrinsic dissonance of a chord quality, 0 (consonant) .. 1. */
function qualityTension(chord: ChordHarmonyEvent): number {
  const quality = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b]?/, ""))
    .toLowerCase();
  let base: number;
  if (quality.includes("dim") || quality.includes("°")) base = 0.72;
  else if (quality.includes("aug") || quality.includes("+")) base = 0.6;
  else if (quality.includes("sus")) base = 0.42;
  else if (/maj7|maj9|Δ/.test(quality)) base = 0.3;
  else if (/m7|min7|-7/.test(quality)) base = 0.35;
  else if (/7|9|11|13/.test(quality)) base = 0.46;
  else if (quality.startsWith("m") && !quality.startsWith("maj")) base = 0.22;
  else base = 0.12;
  base += (chord.extensions?.length ?? 0) * 0.07;
  base += (chord.alterations?.length ?? 0) * 0.12;
  if (typeof chord.inversion === "number" && chord.inversion > 0) base += 0.08;
  return clamp01(base);
}

const clamp01 = (value: number): number =>
  value < 0 ? 0 : value > 1 ? 1 : value;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

// ---------------------------------------------------------------------------
// Timeline / bar geometry
// ---------------------------------------------------------------------------

type BarGeometry = {
  totalBars: number;
  /** [startSeconds, endSeconds) for bar `n` (1-indexed). */
  barBounds: (bar: number) => { start: number; end: number };
};

function buildBarGeometry(model: SongModelData, timeline: Timeline): BarGeometry {
  const explicitBars = (model.bars ?? [])
    .filter((bar) => Number.isFinite(bar.start) && Number.isFinite(bar.end));
  const explicitByBar = new Map(explicitBars.map((bar) => [bar.bar, bar]));
  const sectionMaxBar = (model.sections ?? []).reduce(
    (max, section) => Math.max(max, section.endBar ?? 0),
    0,
  );
  const barMaxBar = explicitBars.reduce((max, bar) => Math.max(max, bar.bar), 0);
  const totalBars = Math.max(1, sectionMaxBar, barMaxBar);

  const barBounds = (bar: number): { start: number; end: number } => {
    const explicit = explicitByBar.get(bar);
    if (explicit) return { start: explicit.start, end: explicit.end };
    try {
      return {
        start: timeline.coordinateAtBar(bar).seconds,
        end: timeline.coordinateAtBar(bar + 1).seconds,
      };
    } catch {
      const duration = model.audio?.durationSeconds ?? 0;
      const perBar = duration > 0 ? duration / totalBars : 2;
      return { start: (bar - 1) * perBar, end: bar * perBar };
    }
  };

  return { totalBars, barBounds };
}

/** Merge consecutive single-bar records that agree on `keyOf` into spans. */
function coalesceBars<T extends Record<string, unknown>>(
  perBar: Array<{ bar: number } & T>,
  keyOf: (record: { bar: number } & T) => string,
): Array<{ startBar: number; endBar: number } & T> {
  const spans: Array<{ startBar: number; endBar: number } & T> = [];
  let runKey: string | null = null;
  for (const record of perBar) {
    const key = keyOf(record);
    const previous = spans[spans.length - 1];
    if (previous && runKey === key && previous.endBar + 1 === record.bar) {
      previous.endBar = record.bar;
      continue;
    }
    const { bar: _bar, ...rest } = record;
    spans.push({
      startBar: record.bar,
      endBar: record.bar,
      ...(rest as unknown as T),
    });
    runKey = key;
  }
  return spans;
}

// ---------------------------------------------------------------------------
// Group builders
// ---------------------------------------------------------------------------

// -- harmony ---------------------------------------------------------------

function deriveHarmony(
  model: SongModelData,
  geometry: BarGeometry,
): SongModelMusicalMap["harmony"] {
  const method = "harmony-map/v1";
  const derivedFrom = ["chords", "sections", "keyMap"];
  const chords = (model.chords ?? [])
    .filter((chord) => Number.isFinite(chord.start) && Number.isFinite(chord.end))
    .sort((a, b) => a.start - b.start);
  if (chords.length === 0) {
    return {
      status: "not_available",
      reason: "No chord evidence is present on the Song Model.",
      derivedFrom, method,
      harmonicRhythm: [], cadences: [], tensionMap: [],
    };
  }
  const meanConfidence = mean(chords.map((chord) => chord.confidence ?? 0));

  // harmonicRhythm: chord onsets per bar, coalesced into spans.
  const perBar: Array<{ bar: number; chordsPerBar: number }> = [];
  for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
    const { start, end } = geometry.barBounds(bar);
    const count = chords.filter(
      (chord) => chord.start >= start - 1e-6 && chord.start < end - 1e-6,
    ).length;
    perBar.push({ bar, chordsPerBar: count });
  }
  const harmonicRhythm = coalesceBars(perBar, (record) =>
    String(record.chordsPerBar),
  );

  // tensionMap: one segment per chord (merged when equal & adjacent).
  const tonic = model.keyMap?.[0]?.key
    ? parseRootPitchClass(model.keyMap[0].key)
    : null;
  const tensionMap: SongModelMusicalMap["harmony"]["tensionMap"] = [];
  for (const chord of chords) {
    let tension = qualityTension(chord);
    if (tonic !== null) {
      const root = parseRootPitchClass(chord.root ?? chord.symbol);
      if (root !== null) {
        tension = clamp01(
          tension + (circleOfFifthsDistance(root, tonic) / 6) * 0.25,
        );
      }
    }
    tension = round3(tension);
    const previous = tensionMap[tensionMap.length - 1];
    if (previous && previous.tension === tension && Math.abs(previous.end - chord.start) < 1e-6) {
      previous.end = chord.end;
    } else {
      tensionMap.push({ start: chord.start, end: chord.end, tension });
    }
  }

  // cadences: classify consecutive chord pairs by roman/function.
  const cadences: SongModelMusicalMap["harmony"]["cadences"] = [];
  const roleOf = (chord: ChordHarmonyEvent): "tonic" | "subdominant" | "dominant" | "submediant" | "other" => {
    const fn = (chord.function ?? "").toLowerCase();
    if (fn) {
      if (fn.includes("tonic")) return "tonic";
      if (fn.includes("dominant")) return "dominant";
      if (fn.includes("subdominant") || fn.includes("predominant")) return "subdominant";
      if (fn.includes("submediant")) return "submediant";
    }
    const roman = (chord.roman ?? "").replace(/[^ivIV]/g, "");
    if (/^(I|i)$/.test(roman)) return "tonic";
    if (/^(V|v)$/.test(roman)) return "dominant";
    if (/^(IV|iv)$/.test(roman)) return "subdominant";
    if (/^(VI|vi)$/.test(roman)) return "submediant";
    return "other";
  };
  for (let index = 1; index < chords.length; index += 1) {
    const from = roleOf(chords[index - 1]);
    const to = roleOf(chords[index]);
    let kind: SongModelMusicalMap["harmony"]["cadences"][number]["kind"] = "none";
    if (from === "dominant" && to === "tonic") kind = "authentic";
    else if (from === "subdominant" && to === "tonic") kind = "plagal";
    else if (from === "dominant" && to === "submediant") kind = "deceptive";
    else if (to === "dominant") kind = "half";
    if (kind === "none") continue;
    const resolutionChord = chords[index];
    let atBar = 1;
    try {
      atBar = createCanonicalTimeline(model.tempoMap, model.meterMap)
        .coordinateAtSeconds(resolutionChord.start).bar;
    } catch {
      for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
        const { start, end } = geometry.barBounds(bar);
        if (resolutionChord.start >= start && resolutionChord.start < end) { atBar = bar; break; }
      }
    }
    const strength = round3(clamp01(
      0.5 +
      0.25 * ((chords[index - 1].confidence ?? 0) + (resolutionChord.confidence ?? 0)) / 2 +
      (kind === "authentic" ? 0.15 : kind === "deceptive" ? -0.1 : 0),
    ));
    cadences.push({
      id: `cad-${index}`,
      kind,
      atBar,
      strength,
      chordIndexes: [index - 1, index],
    });
  }

  return {
    status: meanConfidence < 0.5 ? "low_confidence" : "detected",
    reason: meanConfidence < 0.5
      ? "Chord confidence is low; harmonic-rhythm and cadence detection are approximate."
      : null,
    derivedFrom, method,
    harmonicRhythm, cadences, tensionMap,
  };
}

// -- melody --------------------------------------------------------------

type MelodyNote = SongModelData["melody"][number];

function segmentMelodyPhrases(notes: MelodyNote[]): number[][] {
  if (notes.length === 0) return [];
  const iois: number[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    iois.push(notes[index].start - notes[index - 1].start);
  }
  const gapThreshold = Math.max(0.6, median(iois.filter((v) => v > 0)) * 2.5);
  const phrases: number[][] = [];
  let current: number[] = [0];
  for (let index = 1; index < notes.length; index += 1) {
    const gap = notes[index].start - notes[index - 1].end;
    if (gap > gapThreshold) {
      phrases.push(current);
      current = [index];
    } else {
      current.push(index);
    }
  }
  phrases.push(current);
  return phrases;
}

function contourOf(pitches: number[]): SongModelMusicalMap["melody"]["phrases"][number]["contour"] {
  if (pitches.length < 2) return "flat";
  const lo = Math.min(...pitches);
  const hi = Math.max(...pitches);
  if (hi - lo < 3) return "flat";
  const peakIndex = pitches.indexOf(hi);
  const troughIndex = pitches.indexOf(lo);
  const nearMiddle = (index: number) =>
    index > pitches.length * 0.25 && index < pitches.length * 0.75;
  const firstThird = mean(pitches.slice(0, Math.ceil(pitches.length / 3)));
  const lastThird = mean(pitches.slice(-Math.ceil(pitches.length / 3)));
  if (nearMiddle(peakIndex) && firstThird < hi - 1 && lastThird < hi - 1) return "arch";
  if (nearMiddle(troughIndex) && firstThird > lo + 1 && lastThird > lo + 1) return "valley";
  if (lastThird - firstThird > 2) return "rising";
  if (firstThird - lastThird > 2) return "falling";
  return "mixed";
}

function signatureOf(notes: MelodyNote[]): { intervals: number[]; rhythm: number[] } {
  const window = notes.slice(0, 5);
  const intervals: number[] = [];
  const rhythm: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    intervals.push(window[index].pitch - window[index - 1].pitch);
    const previousDuration = window[index - 1].end - window[index - 1].start;
    const gap = window[index].start - window[index - 1].start;
    rhythm.push(previousDuration > 0 ? Math.round((gap / previousDuration) * 2) / 2 : 1);
  }
  return { intervals, rhythm };
}

function deriveMelody(model: SongModelData): SongModelMusicalMap["melody"] {
  const method = "melody-map/v1";
  const derivedFrom = ["melody"];
  const notes = (model.melody ?? [])
    .filter((note) =>
      Number.isFinite(note.start) && Number.isFinite(note.end) &&
      Number.isInteger(note.pitch))
    .sort((a, b) => a.start - b.start);
  if (notes.length < 4) {
    return {
      status: "not_available",
      reason: "Fewer than four melody notes; phrase and motif analysis is not meaningful.",
      derivedFrom, method,
      phrases: [], motifs: [], melodicDensity: [], range: null, contour: [],
    };
  }

  const phraseGroups = segmentMelodyPhrases(notes);
  const phrases: SongModelMusicalMap["melody"]["phrases"] = phraseGroups.map(
    (indexes, phraseIndex) => {
      const phraseNotes = indexes.map((index) => notes[index]);
      const pitches = phraseNotes.map((note) => note.pitch);
      const start = phraseNotes[0].start;
      const end = phraseNotes[phraseNotes.length - 1].end;
      const highPitch = Math.max(...pitches);
      const peakLocalIndex = pitches.indexOf(highPitch);
      return {
        id: `mph-${phraseIndex + 1}`,
        start,
        end,
        noteIndexes: indexes,
        contour: contourOf(pitches),
        peakNoteIndex: indexes[peakLocalIndex] ?? null,
        density: round3(end > start ? phraseNotes.length / (end - start) : phraseNotes.length),
        range: { lowPitch: Math.min(...pitches), highPitch },
      };
    },
  );

  // motifs: cluster phrases whose leading interval signature matches (exact,
  // transposed, rhythmic, or partially developed).
  const signatures = phraseGroups.map((indexes) =>
    signatureOf(indexes.map((index) => notes[index])),
  );
  const motifs: SongModelMusicalMap["melody"]["motifs"] = [];
  const claimed = new Set<number>();
  for (let i = 0; i < signatures.length; i += 1) {
    if (claimed.has(i) || signatures[i].intervals.length < 2) continue;
    const occurrences: SongModelMusicalMap["melody"]["motifs"][number]["occurrences"] = [
      { phraseId: phrases[i].id, noteIndexes: phraseGroups[i], transposition: 0, variation: "exact" },
    ];
    for (let j = i + 1; j < signatures.length; j += 1) {
      if (claimed.has(j)) continue;
      const a = signatures[i].intervals;
      const b = signatures[j].intervals;
      const len = Math.min(a.length, b.length);
      if (len < 2) continue;
      const sameIntervals = a.slice(0, len).every((value, index) => value === b[index]);
      const matchCount = a.slice(0, len).filter((value, index) => value === b[index]).length;
      const sameRhythm = signatures[i].rhythm.slice(0, len)
        .every((value, index) => value === signatures[j].rhythm[index]);
      const transposition = notes[phraseGroups[j][0]].pitch - notes[phraseGroups[i][0]].pitch;
      let variation: "exact" | "transposed" | "rhythmic" | "developed" | null = null;
      if (sameIntervals && sameRhythm) variation = transposition === 0 ? "exact" : "transposed";
      else if (sameIntervals) variation = "rhythmic";
      else if (matchCount / len >= 0.6) variation = "developed";
      if (!variation) continue;
      claimed.add(j);
      occurrences.push({
        phraseId: phrases[j].id,
        noteIndexes: phraseGroups[j],
        transposition,
        variation,
      });
    }
    if (occurrences.length >= 2) {
      claimed.add(i);
      motifs.push({
        id: `motif-${motifs.length + 1}`,
        label: `Motif ${String.fromCharCode(65 + motifs.length)}`,
        intervalSignature: signatures[i].intervals,
        rhythmSignature: signatures[i].rhythm,
        occurrences,
      });
    }
  }

  // melodicDensity: notes starting per bar.
  const timeline = safeTimeline(model);
  const geometry = buildBarGeometry(model, timeline ?? fallbackTimeline());
  const perBar: Array<{ bar: number; notesPerBar: number }> = [];
  for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
    const { start, end } = geometry.barBounds(bar);
    perBar.push({
      bar,
      notesPerBar: notes.filter((note) => note.start >= start - 1e-6 && note.start < end - 1e-6).length,
    });
  }
  const melodicDensity = coalesceBars(perBar, (record) => String(record.notesPerBar));

  const allPitches = notes.map((note) => note.pitch);
  const contour = downsampleContour(notes, 64);

  return {
    status: "detected",
    reason: null,
    derivedFrom, method,
    phrases, motifs, melodicDensity,
    range: { lowPitch: Math.min(...allPitches), highPitch: Math.max(...allPitches) },
    contour,
  };
}

function downsampleContour(
  notes: MelodyNote[],
  maxPoints: number,
): Array<{ time: number; pitch: number }> {
  if (notes.length <= maxPoints) {
    return notes.map((note) => ({ time: round3(note.start), pitch: note.pitch }));
  }
  const step = notes.length / maxPoints;
  const points: Array<{ time: number; pitch: number }> = [];
  for (let index = 0; index < maxPoints; index += 1) {
    const note = notes[Math.floor(index * step)];
    points.push({ time: round3(note.start), pitch: note.pitch });
  }
  return points;
}

// -- rhythm -------------------------------------------------------------

function deriveRhythm(model: SongModelData): SongModelMusicalMap["rhythm"] {
  const method = "rhythm-map/v1";
  const derivedFrom = ["beats", "melody", "bass"];
  const beats = (model.beats ?? [])
    .filter((beat) => Number.isFinite(beat.time))
    .sort((a, b) => a.time - b.time);
  const onsets = [
    ...(model.melody ?? []).map((note) => note.start),
    ...(model.bass ?? []).map((note) => note.start),
  ].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (beats.length < 4 || onsets.length < 8) {
    return {
      status: "not_available",
      reason: "Insufficient beat grid or note onsets to characterise groove.",
      derivedFrom, method,
      grooveProfile: { subdivision: "straight-8", swingRatio: null, pushPullMs: null },
      syncopation: [], subdivisions: [], rhythmicDensity: [],
    };
  }

  // Beat-relative onset positions (fraction of the beat, 0..1).
  const beatFractions: number[] = [];
  const gridDeviationsMs: number[] = [];
  for (const onset of onsets) {
    let index = 0;
    while (index + 1 < beats.length && beats[index + 1].time <= onset) index += 1;
    const beatStart = beats[index].time;
    const beatEnd = beats[Math.min(index + 1, beats.length - 1)].time;
    const beatLength = beatEnd - beatStart || median(
      beats.slice(1).map((beat, i) => beat.time - beats[i].time),
    );
    if (beatLength <= 0) continue;
    const fraction = (onset - beatStart) / beatLength;
    if (fraction >= 0 && fraction < 1) {
      beatFractions.push(fraction);
      const nearest = Math.round(fraction * 4) / 4;
      gridDeviationsMs.push((fraction - nearest) * beatLength * 1000);
    }
  }

  const near = (target: number, tol: number) =>
    beatFractions.filter((f) => Math.abs(f - target) < tol).length;
  const swingHits = near(0.66, 0.06) + near(0.67, 0.06);
  const straightHits = near(0.5, 0.05);
  const tripletHits = near(0.33, 0.05) + near(0.66, 0.05);
  const sixteenthHits = near(0.25, 0.04) + near(0.75, 0.04);

  let subdivision: SongModelMusicalMap["rhythm"]["grooveProfile"]["subdivision"] = "straight-8";
  let swingRatio: number | null = null;
  if (swingHits > straightHits * 1.3 && swingHits > 3) {
    subdivision = sixteenthHits > swingHits ? "swing-16" : "swing-8";
    swingRatio = round3(0.66 / 0.34);
  } else if (tripletHits > straightHits && tripletHits > 4) {
    subdivision = "triplet";
    swingRatio = 2;
  } else if (sixteenthHits > straightHits && sixteenthHits > 4) {
    subdivision = "straight-16";
  } else if (straightHits <= 2 && beatFractions.length > 8) {
    subdivision = "mixed";
  }
  const pushPullMs = gridDeviationsMs.length ? round3(mean(gridDeviationsMs)) : null;

  const timeline = safeTimeline(model);
  const geometry = buildBarGeometry(model, timeline ?? fallbackTimeline());
  const syncPerBar: Array<{ bar: number; syncopation: number }> = [];
  const subPerBar: Array<{ bar: number; dominant: "quarter" | "eighth" | "sixteenth" | "triplet" }> = [];
  const densPerBar: Array<{ bar: number; onsetsPerBar: number }> = [];
  for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
    const { start, end } = geometry.barBounds(bar);
    const barOnsets = onsets.filter((value) => value >= start - 1e-6 && value < end - 1e-6);
    densPerBar.push({ bar, onsetsPerBar: barOnsets.length });

    const barBeats = beats.filter((beat) => beat.time >= start - 1e-6 && beat.time < end + 1e-6);
    const offbeat = barOnsets.filter((value) => {
      const nearestBeat = barBeats.reduce(
        (best, beat) => (Math.abs(beat.time - value) < Math.abs(best - value) ? beat.time : best),
        barBeats[0]?.time ?? start,
      );
      const beatLen = (end - start) / Math.max(1, barBeats.length);
      return Math.abs(value - nearestBeat) > beatLen * 0.2;
    }).length;
    syncPerBar.push({
      bar,
      syncopation: round3(barOnsets.length ? clamp01(offbeat / barOnsets.length) : 0),
    });

    const barIois = barOnsets.slice(1).map((value, i) => value - barOnsets[i]).filter((v) => v > 0);
    const beatLen = (end - start) / Math.max(1, barBeats.length || 4);
    const m = median(barIois);
    let dominant: "quarter" | "eighth" | "sixteenth" | "triplet" = "quarter";
    if (m > 0) {
      const ratio = m / beatLen;
      if (ratio <= 0.3) dominant = "sixteenth";
      else if (ratio <= 0.4) dominant = "triplet";
      else if (ratio <= 0.7) dominant = "eighth";
    }
    subPerBar.push({ bar, dominant });
  }

  return {
    status: "detected",
    reason: null,
    derivedFrom, method,
    grooveProfile: { subdivision, swingRatio, pushPullMs },
    syncopation: coalesceBars(syncPerBar, (r) => String(r.syncopation)),
    subdivisions: coalesceBars(subPerBar, (r) => r.dominant),
    rhythmicDensity: coalesceBars(densPerBar, (r) => String(r.onsetsPerBar)),
  };
}

// -- energy -------------------------------------------------------------

function sampleWindowMean(samples: number[], duration: number, start: number, end: number): number | null {
  if (!samples.length || duration <= 0) return null;
  const perSecond = samples.length / duration;
  const from = Math.max(0, Math.floor(start * perSecond));
  const to = Math.min(samples.length, Math.ceil(end * perSecond));
  if (to <= from) return null;
  return mean(samples.slice(from, to));
}

function deriveEnergy(
  model: SongModelData,
  geometry: BarGeometry,
): SongModelMusicalMap["energy"] {
  const method = "energy-map/v1";
  const derivedFrom = ["energy", "dynamics", "sections"];
  const energySamples = (model.energy ?? []).filter((v) => Number.isFinite(v));
  const dynamicSamples = (model.dynamics ?? []).filter((v) => Number.isFinite(v));
  const sections = model.sections ?? [];
  if (energySamples.length === 0 && sections.length === 0) {
    return {
      status: "not_available",
      reason: "No energy curve or sections to align an energy map to.",
      derivedFrom, method,
      energyCurve: [], dynamicCurve: [], spectralDensity: [],
    };
  }
  const duration = model.audio?.durationSeconds ?? geometry.barBounds(geometry.totalBars).end;

  const energyPerBar: Array<{ bar: number; energy: number }> = [];
  const dynamicPerBar: Array<{ bar: number; dynamic: number }> = [];
  for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
    const { start, end } = geometry.barBounds(bar);
    const section = sections.find((s) => bar >= s.startBar && bar <= s.endBar);
    const sampled = sampleWindowMean(energySamples, duration, start, end);
    energyPerBar.push({
      bar,
      energy: round3(clamp01(sampled ?? section?.energy ?? 0)),
    });
    const dyn = sampleWindowMean(dynamicSamples, duration, start, end);
    if (dyn !== null) dynamicPerBar.push({ bar, dynamic: round3(clamp01(dyn)) });
  }

  return {
    status: "detected",
    reason: dynamicPerBar.length === 0
      ? "No dynamics curve; dynamicCurve is empty. spectralDensity requires a spectral provider."
      : "spectralDensity requires a spectral provider and is not derived here.",
    derivedFrom, method,
    energyCurve: coalesceBars(energyPerBar, (r) => String(r.energy)),
    dynamicCurve: coalesceBars(dynamicPerBar, (r) => String(r.dynamic)),
    spectralDensity: [],
  };
}

// -- structure --------------------------------------------------------

function deriveStructure(
  model: SongModelData,
  energyGroup: SongModelMusicalMap["energy"],
  harmonyGroup: SongModelMusicalMap["harmony"],
  melodyGroup: SongModelMusicalMap["melody"],
): SongModelMusicalMap["structure"] {
  const method = "structure-map/v1";
  const derivedFrom = ["sections", "energy", "vocalIntelligence", "melody"];
  const sections = (model.sections ?? []).slice().sort((a, b) => a.startBar - b.startBar);
  if (sections.length === 0) {
    return {
      status: "not_available",
      reason: "No structural sections are present on the Song Model.",
      derivedFrom, method,
      subphrases: [], transitions: [], climaxCandidates: [],
    };
  }

  const spaceWindows = model.vocalIntelligence?.arrangementSpace?.status === "detected"
    ? model.vocalIntelligence.arrangementSpace.windows
    : [];

  // subphrases: split each section into 2/4/8-bar units with a heuristic role.
  const subphrases: SongModelMusicalMap["structure"]["subphrases"] = [];
  for (const section of sections) {
    const length = section.endBar - section.startBar + 1;
    const unit = length >= 16 ? 8 : length >= 8 ? 4 : length >= 4 ? 2 : length;
    const unitCount = Math.max(1, Math.ceil(length / unit));
    for (let u = 0; u < unitCount; u += 1) {
      const startBar = section.startBar + u * unit;
      const endBar = Math.min(section.endBar, startBar + unit - 1);
      if (startBar > section.endBar) break;
      const silentTail = spaceWindows.some((w) =>
        w.sections.includes(section.name) &&
        w.bars.some((bar) => bar >= endBar - 1 && bar <= endBar + 1));
      let role: SongModelMusicalMap["structure"]["subphrases"][number]["role"];
      if (u === 0) role = "opening";
      else if (u === unitCount - 1) role = silentTail ? "fill" : "cadence";
      else if (u === unitCount - 2 && unitCount >= 3) role = "response";
      else role = silentTail ? "pickup" : "development";
      subphrases.push({
        id: `sub-${section.name}-${u + 1}`.replace(/\s+/g, "_"),
        sectionName: section.name,
        role,
        startBar,
        endBar,
      });
    }
  }

  // transitions between consecutive sections.
  const energyAt = (bar: number): number => {
    const span = energyGroup.energyCurve.find((s) => bar >= s.startBar && bar <= s.endBar);
    if (span) return span.energy;
    const section = sections.find((s) => bar >= s.startBar && bar <= s.endBar);
    return section?.energy ?? 0;
  };
  const transitions: SongModelMusicalMap["structure"]["transitions"] = [];
  for (let index = 1; index < sections.length; index += 1) {
    const prev = sections[index - 1];
    const next = sections[index];
    const delta = round3(energyAt(next.startBar) - energyAt(prev.endBar));
    const brokenBySilence = spaceWindows.some((w) =>
      w.bars.some((bar) => bar >= prev.endBar && bar <= next.startBar));
    let kind: SongModelMusicalMap["structure"]["transitions"][number]["kind"];
    if (delta > 0.15) kind = "build";
    else if (delta < -0.15) kind = brokenBySilence ? "break" : "drop";
    else if (Math.abs(delta) <= 0.05) kind = "continue";
    else kind = brokenBySilence ? "break" : delta > 0 ? "build" : "drop";
    transitions.push({
      id: `trans-${index}`,
      fromSection: prev.name,
      toSection: next.name,
      atBar: next.startBar,
      energyDelta: delta,
      kind,
    });
  }

  // climax candidates: local energy maxima, weighted by lateness, section
  // naming, harmonic tension and melodic range near the bar.
  const tensionAt = (bar: number, geometry: BarGeometry): number => {
    const { start, end } = geometry.barBounds(bar);
    const overlapping = harmonyGroup.tensionMap.filter(
      (segment) => segment.end > start && segment.start < end,
    );
    return overlapping.length ? Math.max(...overlapping.map((s) => s.tension)) : 0;
  };
  const timeline = safeTimeline(model);
  const geometry = buildBarGeometry(model, timeline ?? fallbackTimeline());
  const totalBars = geometry.totalBars;
  const highPitch = melodyGroup.range?.highPitch ?? null;
  const scored: Array<{ bar: number; score: number; evidence: string[] }> = [];
  for (const section of sections) {
    const midBar = Math.round((section.startBar + section.endBar) / 2);
    const energy = energyAt(midBar);
    const lateness = totalBars > 1 ? section.startBar / totalBars : 0;
    const named = /chorus|hook|drop|climax|final/i.test(section.name) ? 0.15 : 0;
    const tension = tensionAt(midBar, geometry) * 0.15;
    const melodicPeak = highPitch !== null && (model.melody ?? []).some((note) => {
      const { start, end } = geometry.barBounds(midBar);
      return note.pitch >= highPitch - 1 && note.start >= start && note.start < end;
    }) ? 0.1 : 0;
    const score = round3(clamp01(energy * 0.6 + lateness * 0.2 + named + tension + melodicPeak));
    const evidence = [
      `section "${section.name}"`,
      `energy ${energy.toFixed(2)}`,
      `position ${(lateness * 100).toFixed(0)}% through the song`,
    ];
    if (named) evidence.push("section name implies a peak");
    if (melodicPeak) evidence.push("melodic range peak in this section");
    scored.push({ bar: section.startBar, score, evidence });
  }
  const climaxCandidates = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry, index) => ({
      id: `climax-${index + 1}`,
      atBar: entry.bar,
      score: entry.score,
      evidence: entry.evidence,
    }))
    .sort((a, b) => a.atBar - b.atBar);

  return {
    status: "detected",
    reason: null,
    derivedFrom, method,
    subphrases, transitions, climaxCandidates,
  };
}

// -- vocals ---------------------------------------------------------

const REGISTER_BUCKETS: Array<[number, SongModelMusicalMap["vocals"]["registerMap"][number]["register"]]> = [
  [48, "low"],
  [55, "low_mid"],
  [62, "mid"],
  [69, "upper_mid"],
  [Infinity, "high"],
];

function registerOf(pitch: number): SongModelMusicalMap["vocals"]["registerMap"][number]["register"] {
  return REGISTER_BUCKETS.find(([ceiling]) => pitch < ceiling)![1];
}

const overlapSeconds = (
  aStart: number, aEnd: number, bStart: number, bEnd: number,
): number => Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));

function endCadenceOf(pitches: number[], lastNoteDuration: number): SongModelMusicalMap["vocals"]["phrases"][number]["cadence"] {
  if (pitches.length < 2) return "unknown";
  const last = pitches[pitches.length - 1];
  const prev = pitches[pitches.length - 2];
  if (last > prev + 1) return "rising";
  if (last < prev - 1) return "falling";
  if (Math.abs(last - prev) <= 1 && lastNoteDuration >= 0.4) return "sustained";
  return "unknown";
}

function deriveVocals(
  model: SongModelData,
  geometry: BarGeometry,
  timeline: Timeline,
): SongModelMusicalMap["vocals"] {
  const method = "vocals-map/v1";
  const derivedFrom = ["vocalIntelligence", "vocalEvidence", "melody", "energy"];
  const empty = (reason: string): SongModelMusicalMap["vocals"] => ({
    status: "not_available", reason, derivedFrom, method,
    phrases: [], breathWindows: [], silenceWindows: [],
    vocalDensityCurve: [], registerMap: [],
  });

  const vi = model.vocalIntelligence;
  if (!vi || !["detected", "low_confidence"].includes(vi.phrases.status)) {
    return empty("No verified vocal phrases are present on the Song Model.");
  }
  const phraseEvents = vi.phrases.events;
  if (phraseEvents.length === 0) return empty("Vocal phrase evidence is empty.");

  const voiced = model.vocalEvidence?.observedVoicedWindows ?? [];
  const silent = model.vocalEvidence?.observedSilentWindows ?? [];
  const melody = (model.melody ?? []).filter(
    (note) => Number.isFinite(note.start) && Number.isFinite(note.end),
  );
  const alignedByPhrase = new Map<string, number[]>();
  if (vi.melodyAlignment?.status === "aligned") {
    for (const entry of vi.melodyAlignment.alignments) {
      alignedByPhrase.set(entry.phraseId, entry.melodyIndexes);
    }
  }
  const energySamples = (model.energy ?? []).filter((v) => Number.isFinite(v));
  const duration = model.audio?.durationSeconds ?? geometry.barBounds(geometry.totalBars).end;
  const meterNumerator = Number((model.meterMap?.[0]?.meter ?? "4/4").split("/")[0]) || 4;

  const phrases = phraseEvents.map((event) => {
    const span = event.end - event.start;
    const activity = span > 0
      ? clamp01(
          voiced.reduce(
            (sum, window) => sum + overlapSeconds(event.start, event.end, window.start, window.end),
            0,
          ) / span,
        )
      : 0;
    const noteIndexes = alignedByPhrase.get(event.id) ??
      melody
        .map((note, index) => ({ note, index }))
        .filter(({ note }) => overlapSeconds(event.start, event.end, note.start, note.end) > 0)
        .map(({ index }) => index);
    const notes = noteIndexes
      .map((index) => melody[index])
      .filter((note): note is (typeof melody)[number] => Boolean(note))
      .sort((a, b) => a.start - b.start);
    const pitches = notes.map((note) => note.pitch);
    const range = pitches.length
      ? { lowPitch: Math.min(...pitches), highPitch: Math.max(...pitches) }
      : null;
    const peakPitch = pitches.length ? Math.max(...pitches) : null;
    const density = round3(span > 0 ? notes.length / span : notes.length);
    const midEnergy = sampleWindowMean(energySamples, duration, event.start, event.end) ?? 0;
    const rangeSemitones = range ? range.highPitch - range.lowPitch : 0;
    const registerLift = peakPitch !== null ? clamp01((peakPitch - 55) / 34) : 0;
    const emotionalIntensity = round3(clamp01(
      (rangeSemitones / 24) * 0.4 + registerLift * 0.3 + clamp01(midEnergy) * 0.3,
    ));
    let pickup = false;
    try {
      const start = timeline.coordinateAtSeconds(event.start);
      pickup = start.beatInBar >= meterNumerator && start.beatFraction < 0.5;
    } catch {
      pickup = false;
    }
    const lastNote = notes[notes.length - 1];
    return {
      phraseId: event.id,
      start: event.start,
      end: event.end,
      activity: round3(activity),
      density,
      range,
      peakPitch,
      contour: contourOf(pitches),
      cadence: endCadenceOf(pitches, lastNote ? lastNote.end - lastNote.start : 0),
      pickup,
      emotionalIntensity,
    };
  });

  const breathWindows = vi.breaths.status === "detected"
    ? vi.breaths.events.map((event) => ({ id: event.id, start: event.start, end: event.end }))
    : [];
  const silenceWindows = silent
    .filter((window) => window.end - window.start >= 0.3)
    .map((window, index) => ({ id: `sil-${index + 1}`, start: window.start, end: window.end }));

  const densityPerBar: Array<{ bar: number; vocalDensity: number }> = [];
  const registerPerBar: Array<{
    bar: number;
    register: SongModelMusicalMap["vocals"]["registerMap"][number]["register"];
  }> = [];
  for (let bar = 1; bar <= geometry.totalBars; bar += 1) {
    const { start, end } = geometry.barBounds(bar);
    const barLength = end - start;
    const covered = voiced.reduce(
      (sum, window) => sum + overlapSeconds(start, end, window.start, window.end),
      0,
    );
    densityPerBar.push({
      bar,
      vocalDensity: round3(barLength > 0 ? clamp01(covered / barLength) : 0),
    });
    const barPitches = melody
      .filter((note) => note.start >= start - 1e-6 && note.start < end - 1e-6)
      .map((note) => note.pitch);
    if (barPitches.length) {
      registerPerBar.push({ bar, register: registerOf(mean(barPitches)) });
    }
  }

  return {
    status: vi.phrases.status === "low_confidence" ? "low_confidence" : "detected",
    reason: vi.phrases.status === "low_confidence"
      ? "Vocal phrase evidence is low confidence; phrase analytics are approximate."
      : null,
    derivedFrom, method,
    phrases,
    breathWindows,
    silenceWindows,
    vocalDensityCurve: coalesceBars(densityPerBar, (r) => String(r.vocalDensity)),
    registerMap: coalesceBars(registerPerBar, (r) => r.register),
  };
}

// -- arrangementSpace ---------------------------------------------

function densityLevel(activity: number): SongModelMusicalMap["arrangementSpace"]["windows"][number]["vocalDensity"] {
  if (activity < 0.05) return "none";
  if (activity < 0.35) return "low";
  if (activity < 0.7) return "medium";
  return "high";
}

function deriveArrangementSpace(
  model: SongModelData,
  vocals: SongModelMusicalMap["vocals"],
  geometry: BarGeometry,
  timeline: Timeline,
): SongModelMusicalMap["arrangementSpace"] {
  const method = "arrangement-space-map/v1";
  const derivedFrom = ["vocalIntelligence", "vocals", "sections"];
  const empty = (reason: string): SongModelMusicalMap["arrangementSpace"] => ({
    status: "not_available", reason, derivedFrom, method, windows: [],
  });

  if (vocals.status === "not_available" || vocals.phrases.length === 0) {
    return empty("No verified vocal phrases to map arrangement space against.");
  }

  const sections = model.sections ?? [];
  const barsBetween = (start: number, end: number): number[] => {
    try {
      const startBar = timeline.coordinateAtSeconds(start).bar;
      const endBar = timeline.coordinateAtSeconds(Math.max(start, end)).bar;
      return Array.from({ length: endBar - startBar + 1 }, (_, offset) => startBar + offset);
    } catch {
      return [];
    }
  };
  const sectionsOver = (bars: number[]): string[] => {
    if (!bars.length) return [];
    const lo = bars[0];
    const hi = bars[bars.length - 1];
    return sections
      .filter((section) => section.endBar >= lo && section.startBar <= hi)
      .map((section) => section.name);
  };

  type Win = SongModelMusicalMap["arrangementSpace"]["windows"][number];
  const raw: Array<Omit<Win, "id" | "bars" | "sections">> = [];

  // A window per vocal phrase: budgets shrink as the singer is more active.
  for (const phrase of vocals.phrases) {
    raw.push({
      start: phrase.start,
      end: phrase.end,
      vocalDensity: densityLevel(phrase.activity),
      counterMelodyBudget: round3(clamp01(0.35 * (1 - phrase.activity))),
      fillBudget: round3(clamp01(0.15 * (1 - phrase.activity))),
      padBudget: 0.5,
    });
  }

  // A window per inter-phrase gap: the singer is out, so budgets open up,
  // scaled by how much room the gap gives.
  const ordered = [...vocals.phrases].sort((a, b) => a.start - b.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const gapStart = ordered[index - 1].end;
    const gapEnd = ordered[index].start;
    const gap = gapEnd - gapStart;
    if (gap < 0.2) continue;
    const room = clamp01(gap / 2);
    raw.push({
      start: gapStart,
      end: gapEnd,
      vocalDensity: "none",
      counterMelodyBudget: round3(0.55 + 0.35 * room),
      fillBudget: round3(0.4 + 0.55 * room),
      padBudget: round3(0.6 + 0.3 * room),
    });
  }

  const windows: Win[] = raw
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .map((entry, index) => {
      const bars = barsBetween(entry.start, entry.end);
      return { id: `space-${index + 1}`, ...entry, bars, sections: sectionsOver(bars) };
    });

  return { status: "detected", reason: null, derivedFrom, method, windows };
}

// -- styleFingerprint ------------------------------------------------

function deriveStyleFingerprint(
  model: SongModelData,
  harmonyGroup: SongModelMusicalMap["harmony"],
  rhythmGroup: SongModelMusicalMap["rhythm"],
): SongModelMusicalMap["styleFingerprint"] {
  const method = "style-fingerprint/v1";
  const derivedFrom = ["tempoMap", "meterMap", "chords", "sections", "stems", "melody"];
  const bpm = model.tempoMap?.[0]?.bpm ?? null;
  const meter = model.meterMap?.[0]?.meter ?? null;
  const hasCore = bpm !== null && meter !== null;

  const tempoBand: SongModelMusicalMap["styleFingerprint"]["tempoBand"] =
    bpm === null ? null
      : bpm < 76 ? "ballad"
      : bpm < 112 ? "midtempo"
      : bpm <= 160 ? "uptempo"
      : "double-time";

  let meterFamily: string | null = null;
  if (meter) {
    const [num, den] = meter.split("/").map(Number);
    meterFamily = den === 8 && num % 3 === 0 && num > 3 ? "compound" : meter;
  }

  const chords = model.chords ?? [];
  const qualities = new Set(chords.map((c) => (c.quality ?? c.symbol).toLowerCase()));
  const extended = chords.filter((c) =>
    (c.extensions?.length ?? 0) > 0 || (c.alterations?.length ?? 0) > 0 ||
    /7|9|11|13/.test(c.symbol)).length;
  const harmonicComplexity = chords.length
    ? round3(clamp01(
        (qualities.size / 8) * 0.5 + (extended / chords.length) * 0.5,
      ))
    : null;

  const syncMean = rhythmGroup.syncopation.length
    ? mean(rhythmGroup.syncopation.map((s) => s.syncopation))
    : null;
  const subVariety = new Set(rhythmGroup.subdivisions.map((s) => s.dominant)).size;
  const rhythmicComplexity = syncMean === null
    ? null
    : round3(clamp01(syncMean * 0.7 + (subVariety / 4) * 0.3));

  const sectionEnergies = (model.sections ?? []).map((s) => s.energy);
  const sectionContrast = sectionEnergies.length >= 2
    ? round3(clamp01(stddev(sectionEnergies) * 2.5))
    : null;

  const paletteRoles = new Set<string>();
  for (const stem of model.stems ?? []) if (stem.role) paletteRoles.add(stem.role.toLowerCase());
  for (const stem of model.sourceStems ?? []) if (stem.role) paletteRoles.add(stem.role.toLowerCase());
  const instrumentPaletteHints = [...paletteRoles].sort();

  const stemCount = Math.max(
    (model.stems ?? []).length,
    (model.sourceStems ?? []).length,
  );
  const orchestrationSize: SongModelMusicalMap["styleFingerprint"]["orchestrationSize"] =
    stemCount === 0 ? null : stemCount <= 2 ? "sparse" : stemCount <= 5 ? "medium" : "dense";

  return {
    status: hasCore ? "detected" : "low_confidence",
    reason: hasCore ? null : "Tempo or meter missing; fingerprint is partial.",
    derivedFrom, method,
    tempoBand, meterFamily, harmonicComplexity, rhythmicComplexity,
    sectionContrast, instrumentPaletteHints, orchestrationSize,
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function safeTimeline(model: SongModelData): Timeline | null {
  try {
    return createCanonicalTimeline(model.tempoMap, model.meterMap);
  } catch {
    return null;
  }
}

function fallbackTimeline(): Timeline {
  return createCanonicalTimeline([{ time: 0, bpm: 120 }], [{ bar: 1, meter: "4/4" }]);
}

/**
 * Stable digest over the evidence a musical map is derived from. Two Song
 * Models with the same evidence produce the same digest, so a stored map can be
 * detected as stale and re-derived.
 */
export function musicalMapInputsDigest(model: SongModelData): string {
  const evidence = {
    tempoMap: model.tempoMap,
    meterMap: model.meterMap,
    keyMap: model.keyMap,
    melody: model.melody,
    bass: model.bass ?? null,
    chords: model.chords,
    sections: model.sections,
    energy: model.energy,
    beats: model.beats ?? null,
    bars: model.bars ?? null,
    dynamics: model.dynamics ?? null,
    stems: model.stems ?? null,
    sourceStems: model.sourceStems ?? null,
    vocalIntelligence: model.vocalIntelligence ?? null,
  };
  return createHash("sha256")
    .update(JSON.stringify(evidence))
    .digest("hex");
}

/**
 * Derive the full musical map from the evidence already on `model`. Pure and
 * deterministic apart from `derivedAt` (excluded from `inputsDigestSha256`).
 */
export function deriveMusicalMap(
  model: SongModelData,
  options: DeriveOptions = {},
): SongModelMusicalMap {
  const timeline = safeTimeline(model) ?? fallbackTimeline();
  const geometry = buildBarGeometry(model, timeline);

  const harmony = deriveHarmony(model, geometry);
  const melody = deriveMelody(model);
  const rhythm = deriveRhythm(model);
  const energy = deriveEnergy(model, geometry);
  const structure = deriveStructure(model, energy, harmony, melody);
  const styleFingerprint = deriveStyleFingerprint(model, harmony, rhythm);
  const vocals = deriveVocals(model, geometry, timeline);
  const arrangementSpace = deriveArrangementSpace(model, vocals, geometry, timeline);

  return {
    version: MUSICAL_MAP_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: musicalMapInputsDigest(model),
    harmony,
    melody,
    rhythm,
    energy,
    structure,
    styleFingerprint,
    vocals,
    arrangementSpace,
  };
}

/** True when `model.musicalMap` is absent or was derived from stale evidence. */
export function isMusicalMapStale(model: SongModelData): boolean {
  const map = model.musicalMap;
  if (!map || map.version !== MUSICAL_MAP_VERSION) return true;
  return map.inputsDigestSha256 !== musicalMapInputsDigest(model);
}

// ---------------------------------------------------------------------------
// Canonical coordinates
// ---------------------------------------------------------------------------

/**
 * Fill every timed musical-map record with canonical coordinates reconstructed
 * from the tempo and meter maps — the same axes the rest of the Song Model
 * uses. Bar spans map to `[coordinateAtBar(startBar), coordinateAtBar(endBar+1))`;
 * time ranges and points map through `coordinateAtSeconds` / `coordinateAtBar`.
 * A coordinate that cannot be resolved is left off rather than guessed.
 */
export function canonicalizeMusicalMapCoordinates(
  map: SongModelMusicalMap,
  timeline: Timeline,
): SongModelMusicalMap {
  const barRange = (startBar: number, endBar: number) => {
    try {
      return {
        start: timeline.coordinateAtBar(startBar),
        end: timeline.coordinateAtBar(endBar + 1),
      };
    } catch {
      return undefined;
    }
  };
  const secondsRange = (start: number, end: number) => {
    try {
      return {
        start: timeline.coordinateAtSeconds(start),
        end: timeline.coordinateAtSeconds(end),
      };
    } catch {
      return undefined;
    }
  };
  const atBar = (bar: number) => {
    try {
      return timeline.coordinateAtBar(bar);
    } catch {
      return undefined;
    }
  };
  const withBarSpan = <T extends { startBar: number; endBar: number }>(items: T[]): T[] =>
    items.map((item) => ({ ...item, coordinates: barRange(item.startBar, item.endBar) }));

  return {
    ...map,
    harmony: {
      ...map.harmony,
      harmonicRhythm: withBarSpan(map.harmony.harmonicRhythm),
      cadences: map.harmony.cadences.map((cadence) => ({
        ...cadence, coordinates: atBar(cadence.atBar),
      })),
      tensionMap: map.harmony.tensionMap.map((segment) => ({
        ...segment, coordinates: secondsRange(segment.start, segment.end),
      })),
    },
    melody: {
      ...map.melody,
      phrases: map.melody.phrases.map((phrase) => ({
        ...phrase, coordinates: secondsRange(phrase.start, phrase.end),
      })),
      melodicDensity: withBarSpan(map.melody.melodicDensity),
    },
    rhythm: {
      ...map.rhythm,
      syncopation: withBarSpan(map.rhythm.syncopation),
      subdivisions: withBarSpan(map.rhythm.subdivisions),
      rhythmicDensity: withBarSpan(map.rhythm.rhythmicDensity),
    },
    energy: {
      ...map.energy,
      energyCurve: withBarSpan(map.energy.energyCurve),
      dynamicCurve: withBarSpan(map.energy.dynamicCurve),
      spectralDensity: withBarSpan(map.energy.spectralDensity),
    },
    structure: {
      ...map.structure,
      subphrases: withBarSpan(map.structure.subphrases),
      transitions: map.structure.transitions.map((transition) => ({
        ...transition, coordinates: atBar(transition.atBar),
      })),
      climaxCandidates: map.structure.climaxCandidates.map((candidate) => ({
        ...candidate, coordinates: atBar(candidate.atBar),
      })),
    },
    vocals: {
      ...map.vocals,
      phrases: map.vocals.phrases.map((phrase) => ({
        ...phrase, coordinates: secondsRange(phrase.start, phrase.end),
      })),
      breathWindows: map.vocals.breathWindows.map((window) => ({
        ...window, coordinates: secondsRange(window.start, window.end),
      })),
      silenceWindows: map.vocals.silenceWindows.map((window) => ({
        ...window, coordinates: secondsRange(window.start, window.end),
      })),
      vocalDensityCurve: withBarSpan(map.vocals.vocalDensityCurve),
      registerMap: withBarSpan(map.vocals.registerMap),
    },
    arrangementSpace: {
      ...map.arrangementSpace,
      windows: map.arrangementSpace.windows.map((window) => ({
        ...window, coordinates: secondsRange(window.start, window.end),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------

type MapIssue = { code: string; severity: "error" | "warning"; path: string; message: string };

const MAP_STATUSES = ["detected", "low_confidence", "not_available", "conflicting"];
const GROOVE_SUBDIVISIONS = ["straight-8", "straight-16", "swing-8", "swing-16", "triplet", "mixed"];
const CADENCE_KINDS = ["authentic", "plagal", "half", "deceptive", "none"];
const TRANSITION_KINDS = ["build", "drop", "continue", "break"];
const SUBPHRASE_ROLES = ["opening", "development", "response", "cadence", "pickup", "fill"];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const unit = (value: unknown): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
const posInt = (value: unknown): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * Structural validation for a persisted `musicalMap`. The map is derived and
 * canonicalized server-side, so this checks shape, enums, numeric ranges,
 * bar ordering, and the "no fabrication" rule — not every coordinate against
 * the timeline (that is guaranteed by `canonicalizeMusicalMapCoordinates`).
 */
export function validateMusicalMapShape(input: unknown): MapIssue[] {
  const issues: MapIssue[] = [];
  const push = (code: string, path: string, message: string): void => {
    issues.push({ code, severity: "error", path, message });
  };
  if (!isRecord(input)) {
    push("INVALID_MUSICAL_MAP", "musicalMap", "Musical map must be an object.");
    return issues;
  }
  if (input.version !== MUSICAL_MAP_VERSION) {
    push("UNSUPPORTED_MUSICAL_MAP_VERSION", "musicalMap.version",
      `Musical map version must be ${MUSICAL_MAP_VERSION}.`);
  }
  if (typeof input.inputsDigestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.inputsDigestSha256)) {
    push("INVALID_MUSICAL_MAP_DIGEST", "musicalMap.inputsDigestSha256",
      "Musical map must carry a SHA-256 inputs digest.");
  }
  if (typeof input.derivedAt !== "string" || Number.isNaN(Date.parse(input.derivedAt))) {
    push("INVALID_MUSICAL_MAP_TIMESTAMP", "musicalMap.derivedAt",
      "Musical map derivedAt must be an ISO timestamp.");
  }

  const groupNames = [
    "harmony", "melody", "rhythm", "energy", "structure", "styleFingerprint",
    "vocals", "arrangementSpace",
  ] as const;
  const arraysByGroup: Record<string, string[]> = {
    harmony: ["harmonicRhythm", "cadences", "tensionMap"],
    melody: ["phrases", "motifs", "melodicDensity", "contour"],
    rhythm: ["syncopation", "subdivisions", "rhythmicDensity"],
    energy: ["energyCurve", "dynamicCurve", "spectralDensity"],
    structure: ["subphrases", "transitions", "climaxCandidates"],
    styleFingerprint: [],
    vocals: ["phrases", "breathWindows", "silenceWindows", "vocalDensityCurve", "registerMap"],
    arrangementSpace: ["windows"],
  };

  for (const name of groupNames) {
    const group = input[name];
    const path = `musicalMap.${name}`;
    if (!isRecord(group)) {
      push("INVALID_MUSICAL_MAP_GROUP", path, `${name} group must be an object.`);
      continue;
    }
    if (!MAP_STATUSES.includes(String(group.status))) {
      push("INVALID_MUSICAL_MAP_STATUS", `${path}.status`, `${name} status is invalid.`);
    }
    if (!(group.reason === null || typeof group.reason === "string")) {
      push("INVALID_MUSICAL_MAP_REASON", `${path}.reason`, `${name} reason must be a string or null.`);
    }
    if (!Array.isArray(group.derivedFrom) ||
      !group.derivedFrom.every((entry) => typeof entry === "string" && entry.length > 0)) {
      push("INVALID_MUSICAL_MAP_PROVENANCE", `${path}.derivedFrom`,
        `${name} must record the fields it was derived from.`);
    }
    if (typeof group.method !== "string" || group.method.length === 0) {
      push("INVALID_MUSICAL_MAP_METHOD", `${path}.method`, `${name} must record a derivation method.`);
    }
    const populated = group.status === "detected" || group.status === "low_confidence";
    if (!populated) {
      for (const arrayName of arraysByGroup[name]) {
        if (Array.isArray(group[arrayName]) && (group[arrayName] as unknown[]).length > 0) {
          push("FABRICATED_MUSICAL_MAP", `${path}.${arrayName}`,
            `${name} is ${String(group.status)} but carries derived ${arrayName}; the map must not fabricate structure.`);
        }
      }
    }
  }

  if (isRecord(input.harmony)) {
    for (const [index, span] of asArray(input.harmony.harmonicRhythm).entries()) {
      if (!isRecord(span) || !posInt(span.startBar) || !posInt(span.endBar) ||
        (span.endBar as number) < (span.startBar as number) ||
        typeof span.chordsPerBar !== "number" || span.chordsPerBar < 0) {
        push("INVALID_HARMONIC_RHYTHM", `musicalMap.harmony.harmonicRhythm.${index}`,
          "Harmonic-rhythm spans need ordered bars and a non-negative chord count.");
      }
    }
    for (const [index, cadence] of asArray(input.harmony.cadences).entries()) {
      if (!isRecord(cadence) || !CADENCE_KINDS.includes(String(cadence.kind)) ||
        !posInt(cadence.atBar) || !unit(cadence.strength) ||
        !Array.isArray(cadence.chordIndexes)) {
        push("INVALID_CADENCE", `musicalMap.harmony.cadences.${index}`,
          "Cadence needs a known kind, a positive bar, unit strength, and chord indexes.");
      }
    }
    for (const [index, segment] of asArray(input.harmony.tensionMap).entries()) {
      if (!isRecord(segment) || !unit(segment.tension) ||
        typeof segment.start !== "number" || typeof segment.end !== "number" ||
        segment.end <= segment.start) {
        push("INVALID_TENSION_SEGMENT", `musicalMap.harmony.tensionMap.${index}`,
          "Tension segments need an increasing time range and a unit tension.");
      }
    }
  }
  if (isRecord(input.rhythm) && isRecord(input.rhythm.grooveProfile)) {
    if (!GROOVE_SUBDIVISIONS.includes(String(input.rhythm.grooveProfile.subdivision))) {
      push("INVALID_GROOVE_PROFILE", "musicalMap.rhythm.grooveProfile.subdivision",
        "Groove subdivision is invalid.");
    }
  }
  if (isRecord(input.structure)) {
    for (const [index, sub] of asArray(input.structure.subphrases).entries()) {
      if (!isRecord(sub) || !SUBPHRASE_ROLES.includes(String(sub.role)) ||
        !posInt(sub.startBar) || !posInt(sub.endBar) ||
        (sub.endBar as number) < (sub.startBar as number)) {
        push("INVALID_SUBPHRASE", `musicalMap.structure.subphrases.${index}`,
          "Subphrase needs a known role and ordered bars.");
      }
    }
    for (const [index, transition] of asArray(input.structure.transitions).entries()) {
      if (!isRecord(transition) || !TRANSITION_KINDS.includes(String(transition.kind)) ||
        !posInt(transition.atBar) || typeof transition.energyDelta !== "number") {
        push("INVALID_TRANSITION", `musicalMap.structure.transitions.${index}`,
          "Transition needs a known kind, a positive bar, and an energy delta.");
      }
    }
    for (const [index, candidate] of asArray(input.structure.climaxCandidates).entries()) {
      if (!isRecord(candidate) || !posInt(candidate.atBar) || !unit(candidate.score) ||
        !Array.isArray(candidate.evidence)) {
        push("INVALID_CLIMAX_CANDIDATE", `musicalMap.structure.climaxCandidates.${index}`,
          "Climax candidate needs a positive bar, a unit score, and evidence.");
      }
    }
  }
  if (isRecord(input.vocals)) {
    for (const [index, phrase] of asArray(input.vocals.phrases).entries()) {
      if (!isRecord(phrase) || typeof phrase.phraseId !== "string" || !phrase.phraseId ||
        !unit(phrase.activity) || !unit(phrase.emotionalIntensity) ||
        typeof phrase.density !== "number" || phrase.density < 0 ||
        typeof phrase.pickup !== "boolean" ||
        !["rising", "falling", "arch", "valley", "flat", "mixed"].includes(String(phrase.contour)) ||
        !["rising", "falling", "sustained", "unknown"].includes(String(phrase.cadence)) ||
        typeof phrase.start !== "number" || typeof phrase.end !== "number" ||
        phrase.end <= phrase.start) {
        push("INVALID_VOCAL_PHRASE_ANALYTIC", `musicalMap.vocals.phrases.${index}`,
          "Vocal phrase analytic needs a phraseId, unit activity/intensity, a valid contour/cadence, and an increasing span.");
      }
    }
    for (const [index, span] of asArray(input.vocals.registerMap).entries()) {
      if (!isRecord(span) || !posInt(span.startBar) || !posInt(span.endBar) ||
        !["low", "low_mid", "mid", "upper_mid", "high"].includes(String(span.register))) {
        push("INVALID_REGISTER_SPAN", `musicalMap.vocals.registerMap.${index}`,
          "Register span needs ordered bars and a known register.");
      }
    }
  }
  if (isRecord(input.arrangementSpace)) {
    for (const [index, window] of asArray(input.arrangementSpace.windows).entries()) {
      if (!isRecord(window) ||
        !["none", "low", "medium", "high"].includes(String(window.vocalDensity)) ||
        !unit(window.counterMelodyBudget) || !unit(window.fillBudget) || !unit(window.padBudget) ||
        typeof window.start !== "number" || typeof window.end !== "number" ||
        window.end <= window.start ||
        !Array.isArray(window.bars) || !Array.isArray(window.sections)) {
        push("INVALID_ARRANGEMENT_SPACE_WINDOW", `musicalMap.arrangementSpace.windows.${index}`,
          "Arrangement-space window needs a density level, unit budgets, an increasing span, and bar/section arrays.");
      }
    }
  }
  if (isRecord(input.styleFingerprint)) {
    for (const key of ["harmonicComplexity", "rhythmicComplexity", "sectionContrast"] as const) {
      const value = input.styleFingerprint[key];
      if (!(value === null || unit(value))) {
        push("INVALID_STYLE_FINGERPRINT", `musicalMap.styleFingerprint.${key}`,
          `${key} must be null or between 0 and 1.`);
      }
    }
  }

  return issues;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
