/**
 * Song Model correction rules (PR-32).
 *
 * The editor is where a producer turns an analysis into the truth for their
 * project. Two rules live here so the route stays thin and the rules stay
 * tested:
 *
 *  - a submitted value that merely *confirms* a low-confidence estimate is a
 *    correction: the producer looked and agreed, which is exactly what the
 *    estimate was missing;
 *  - a corrected or confirmed field is authoritative: confidence 1 for that
 *    field, and the model's confidence is recomputed the way the analyzer
 *    computes it (mean over fields that carry evidence). Provider output stays
 *    in provenance either way.
 */
import type { SongModelData, SongModelField } from "@workspace/db";
import { formatChordSymbol, inversionOf, parseChordSymbol, parseKey, romanNumeralFor } from "./harmonyEngine";
import { CANONICAL_PPQ, buildMeterAwareEvidence, createCanonicalTimeline } from "./canonicalTimeline";

export type CorrectionField = "bpm" | "key" | "meter" | "sections" | "chords";

/** One line of a producer's chord sheet, in seconds. */
export type ChordSheetEntry = { start: number; end: number; symbol: string };

export type CorrectionInput = {
  bpm?: number;
  key?: string;
  meter?: string;
  sections?: Array<{ name: string; startBar: number; endBar: number }>;
  chords?: readonly ChordSheetEntry[];
};

const STATUS_FIELD: Record<CorrectionField, SongModelField> = { bpm: "tempo", key: "key", meter: "meter", sections: "sections", chords: "harmony" };

export function sectionsDiffer(model: Pick<SongModelData, "sections">, sections: CorrectionInput["sections"]): boolean {
  if (!sections) return false;
  const shape = (list: Array<{ name: string; startBar: number; endBar: number }>) => JSON.stringify(list.map(({ name, startBar, endBar }) => ({ name, startBar, endBar })));
  return shape(sections) !== shape(model.sections);
}

/**
 * Which fields this correction touches: changed values, plus values that
 * confirm a `low_confidence` estimate.
 */
export function correctionFields(model: Pick<SongModelData, "tempoMap" | "keyMap" | "meterMap" | "sections" | "fieldStatus">, correction: CorrectionInput): CorrectionField[] {
  // A confirmed value touches the field when it settles an estimate or a contest, even if it repeats the estimate.
  const lowConfidence = (field: CorrectionField) => {
    const status = model.fieldStatus?.[STATUS_FIELD[field]]?.status;
    return status === "low_confidence" || status === "contested";
  };
  const touched: CorrectionField[] = [];
  if (correction.bpm !== undefined && (correction.bpm !== model.tempoMap[0]?.bpm || lowConfidence("bpm"))) touched.push("bpm");
  if (correction.key !== undefined && (correction.key !== model.keyMap[0]?.key || lowConfidence("key"))) touched.push("key");
  if (correction.meter !== undefined && (correction.meter !== model.meterMap[0]?.meter || lowConfidence("meter"))) touched.push("meter");
  if (correction.sections !== undefined && (sectionsDiffer(model, correction.sections) || lowConfidence("sections"))) touched.push("sections");
  // A supplied chord sheet always replaces the model's chords: it is the
  // producer's harmony, not a confirmation of the analyzer's.
  if (correction.chords !== undefined) touched.push("chords");
  return touched;
}

/**
 * A producer's chord sheet as Song Model chord events. Symbols go through the
 * platform's parser (plain, MIREX or slash); `N`/unparsable lines are dropped,
 * never guessed; roman numerals follow the key the model carries (or the key
 * confirmed in the same correction) and read "?" when no key is known.
 * Entries are sorted, clamped to the audio, and empty spans are dropped.
 */
export function chordSheetToEvents(
  sheet: readonly ChordSheetEntry[],
  key: string | undefined,
  durationSeconds: number | undefined,
): SongModelData["chords"] {
  const centre = key ? parseKey(key) : null;
  const limit = durationSeconds && durationSeconds > 0 ? durationSeconds : Number.POSITIVE_INFINITY;
  const events: SongModelData["chords"] = [];
  for (const line of [...sheet].sort((a, b) => a.start - b.start)) {
    const parsed = parseChordSymbol(line.symbol);
    if (!parsed) continue;
    const start = Math.max(0, line.start);
    const end = Math.min(limit, line.end);
    if (!(end > start + 1e-3)) continue;
    const inversion = Math.max(0, inversionOf(parsed.root, parsed.quality, parsed.bass));
    events.push({
      start: Number(start.toFixed(4)),
      end: Number(end.toFixed(4)),
      symbol: formatChordSymbol(parsed.root, parsed.quality, parsed.bass),
      roman: romanNumeralFor(parsed.root, parsed.quality, inversion, centre) ?? "?",
      confidence: 1,
      root: formatChordSymbol(parsed.root, "maj", parsed.root),
      quality: parsed.quality,
      inversion,
      bass: formatChordSymbol(parsed.bass, "maj", parsed.bass),
    });
  }
  return events;
}

/** A structure that is only a local sketch may be re-cut; a verified one keeps its section count. */
export function sectionCountMayChange(model: Pick<SongModelData, "sections" | "fieldStatus">): boolean {
  return model.sections.length === 0 || model.fieldStatus?.sections?.status === "low_confidence";
}

/**
 * Beats and bars are a function of tempo and meter. When the producer verifies
 * either, the grid the analyzer tracked (or sketched) no longer describes the
 * timeline they declared, and the canonical validator rightly rejects it. The
 * grid is therefore re-derived from the verified maps over the song duration,
 * on canonical ticks so every beat time round-trips exactly. Nothing to do when
 * neither field was touched or the model has no duration.
 */
export function regridTimeline(
  model: Pick<SongModelData, "tempoMap" | "meterMap" | "audio">,
  fields: readonly CorrectionField[],
): Partial<Pick<SongModelData, "beats" | "bars">> {
  if (!fields.includes("bpm") && !fields.includes("meter")) return {};
  const durationSeconds = model.audio?.durationSeconds ?? 0;
  if (!(durationSeconds > 0) || !model.tempoMap.length || !model.meterMap.length) return {};
  const timeline = createCanonicalTimeline(model.tempoMap, model.meterMap);
  const finalTick = timeline.secondsToTick(durationSeconds);
  const grid = buildMeterAwareEvidence(
    CANONICAL_PPQ,
    finalTick,
    model.meterMap.map((change) => ({ tick: timeline.barToTick(change.bar), meter: change.meter })),
    timeline.tickToSeconds,
  );
  return {
    beats: grid.beats.filter((beat) => beat.time < durationSeconds),
    bars: grid.bars,
  };
}

/** Verified fields carry confidence 1; the model confidence is the analyzer's rule over fields with evidence. */
export function verifiedConfidence(confidenceByField: SongModelData["confidenceByField"], fields: readonly CorrectionField[]): { confidenceByField: SongModelData["confidenceByField"]; confidence: number } {
  const next = {
    ...confidenceByField,
    ...(fields.includes("bpm") ? { tempo: 1 } : {}),
    ...(fields.includes("key") ? { key: 1 } : {}),
    ...(fields.includes("meter") ? { meter: 1 } : {}),
    ...(fields.includes("sections") ? { structure: 1 } : {}),
    ...(fields.includes("chords") ? { harmony: 1 } : {}),
  };
  const withEvidence = Object.values(next).filter((value): value is number => typeof value === "number" && value > 0);
  const confidence = Number((withEvidence.reduce((sum, value) => sum + value, 0) / Math.max(1, withEvidence.length)).toFixed(4));
  return { confidenceByField: next, confidence };
}
