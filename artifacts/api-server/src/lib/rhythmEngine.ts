/**
 * The rhythm engine: several beat trackers in, one reconciled reading out, with
 * a status per field.
 *
 * This is not a leaderboard and not a voting booth. Three rules shape it:
 *
 *  1. **Never average.** Every value this module returns is some provider's
 *     actual output, verbatim. 120 and 60 do not reconcile to 90; one of them
 *     is the tactus and the other is a metrical level of it, and picking the
 *     wrong one is a musical error while picking the average is not even a
 *     musical statement. The only values not taken verbatim from a provider are
 *     the derived tempo *map*, which is computed from the selected provider's
 *     own beat grid and says so, and the metre, which is read off the selected
 *     provider's own beats and downbeats.
 *
 *  2. **A status per field, not per response.** A tracker can be certain about
 *     the beat and wrong about the bar. `agreed` means at least two independent
 *     providers said the same thing; `contested` means they did not, or only one
 *     spoke; `unknown` means nobody produced a usable value. The Arrangement
 *     Brain is entitled to lean on `agreed` and obliged to ask about
 *     `contested`.
 *
 *  3. **Name the disagreement.** "The providers disagreed" is not useful.
 *     Half/double tempo, 3/4-vs-6/8, a pickup bar shifting the whole downbeat
 *     grid by one beat, and drift on rubato are four different musical
 *     situations with four different repairs, and this module reports which one
 *     it is looking at.
 *
 * Where audio evidence is available (an onset-strength envelope from the
 * analysis worker), the resolver uses it: onset density at candidate beat
 * positions and autocorrelation of the envelope at candidate periods settle
 * half/double far better than any prior. Without it the resolver still works,
 * but says so in its rationale and is much more willing to return `contested`.
 */

export const BEAT_TOLERANCE_SECONDS = 0.07;

/**
 * Adapt the platform's existing `rhythmEvidence` to this engine's input.
 *
 * `runAnalysisProviders` already collects MADMOM and BEAT_THIS into
 * `AnalysisProviderResults.rhythmEvidence`; this is the whole bridge. Typed
 * structurally rather than against `analysisProviders.ts` so the engine stays
 * importable from a test with no database stub and no provider machinery.
 *
 * A provider's own `tempoBpm` is carried through but is **not** what the engine
 * reconciles on: the beat grid is the evidence, and a tempo is a reading of it.
 * An empty downbeat array becomes `null` — "this tracker has no bar lines to
 * offer" and "this tracker offers zero bar lines" are the same fact, and both
 * must reach the engine as `unknown` rather than as an empty agreement.
 */
export function observationsFromRhythmEvidence(
  evidence: ReadonlyArray<{
    provider: string;
    beats: readonly number[];
    downbeats?: readonly number[] | null;
    tempoBpm?: number | null;
  }>,
): ProviderRhythmObservation[] {
  const seen = new Set<string>();
  const observations: ProviderRhythmObservation[] = [];
  for (const item of evidence) {
    // One observation per provider: the same tracker answering twice is not
    // corroboration, and letting it in would manufacture an `agreed`.
    if (!item.provider || seen.has(item.provider)) continue;
    if (!Array.isArray(item.beats) || item.beats.length < 2) continue;
    seen.add(item.provider);
    observations.push({
      provider: item.provider,
      beats: [...item.beats].sort((a, b) => a - b),
      downbeats: item.downbeats && item.downbeats.length
        ? [...item.downbeats].sort((a, b) => a - b)
        : null,
      tempoBpm: item.tempoBpm ?? null,
      meter: null,
    });
  }
  return observations;
}

/**
 * A reading that has a tempo and no beat grid — the platform's own
 * `LOCAL_SIGNAL_ANALYZER_V1` is one. It enters the engine as an observation
 * with an empty grid: it can name a metrical level (64.8 against a grid at
 * 129.6 is the half level) and it can never corroborate beat positions.
 */
export function tempoOnlyObservation(
  provider: string,
  tempoBpm: number,
  confidence?: number,
): ProviderRhythmObservation {
  return { provider, beats: [], downbeats: null, tempoBpm, meter: null, confidence };
}

export type ProviderRhythmObservation = {
  provider: string;
  /** Beat times in seconds, ascending. */
  beats: readonly number[];
  /** Downbeat times in seconds, or null when the provider has no downbeat model. */
  downbeats: readonly number[] | null;
  /** The provider's own tempo reading, if it published one. */
  tempoBpm?: number | null;
  /** The provider's own metre reading, if it published one. */
  meter?: string | null;
  confidence?: number;
};

/** A compact onset-strength curve; see `services/rhythm-tournament-worker`. */
export type OnsetEnvelope = {
  frameRateHz: number;
  strengths: readonly number[];
  startSeconds?: number;
};

export type RhythmEvidence = {
  observations: readonly ProviderRhythmObservation[];
  onsetEnvelope?: OnsetEnvelope | null;
  durationSeconds?: number;
  tolerance?: number;
};

export type FieldStatus = "agreed" | "contested" | "unknown";

export type ReconciledField<T> = {
  value: T | null;
  status: FieldStatus;
  /** Providers whose output supports `value`. */
  providers: string[];
  /** Providers that said something else, and what. */
  dissenting: Array<{ provider: string; value: string }>;
  /** Why this value, in one sentence a human can check. */
  rationale: string;
  /**
   * Every reading that is still on the table, when the field is contested
   * between readings that are each some provider's verbatim output. The first
   * entry is the one `value` carries — the reading the evidence leans to — and
   * the rest are the alternatives a producer may pick instead. Present only
   * when there is more than one; a field with one reading has no candidates.
   *
   * This is the contested-key pattern (PR-86) applied to tempo: 64.8 and 129.6
   * are both carried, neither is averaged, and the platform does not pretend
   * that onset statistics settle which one the song is *felt* in.
   */
  candidates?: Array<{ value: T; providers: string[]; note: string }>;
};

export type DisagreementFamily =
  | "half_double_tempo"
  | "triple_duple_meter"
  | "pickup_phase"
  | "drift"
  | "beat_grid_mismatch"
  | "downbeat_absent";

export type RhythmDisagreement = {
  family: DisagreementFamily;
  providers: string[];
  detail: string;
  /** How it was settled, or why it could not be. */
  resolution: string;
  resolved: boolean;
  /** Extra numbers the family carries: the ratio, the beat shift, the horizon. */
  evidence: Record<string, number | string | null>;
};

export type ReconciledRhythm = {
  version: "1.0";
  tempo: ReconciledField<number>;
  tempoMap: ReconciledField<Array<{ time: number; bpm: number }>>;
  beatGrid: ReconciledField<number[]>;
  downbeats: ReconciledField<number[]>;
  meter: ReconciledField<string>;
  disagreements: RhythmDisagreement[];
  contestedFields: string[];
  /** Which provider's beat grid was adopted, if any. */
  selectedProvider: string | null;
  /** True when an onset envelope was available to settle metrical questions. */
  usedAudioEvidence: boolean;
};

const round = (value: number, places = 4): number => Number(value.toFixed(places));

const unknownField = <T>(rationale: string): ReconciledField<T> => ({
  value: null, status: "unknown", providers: [], dissenting: [], rationale,
});

// ---------------------------------------------------------------------------
// Grid comparison
// ---------------------------------------------------------------------------

/** Fraction of `a`'s events that have a partner in `b` within `tolerance`. */
export function gridAgreement(
  a: readonly number[],
  b: readonly number[],
  tolerance = BEAT_TOLERANCE_SECONDS,
): number {
  if (!a.length || !b.length) return 0;
  let matched = 0;
  let j = 0;
  for (const time of a) {
    while (j + 1 < b.length && Math.abs(b[j + 1] - time) < Math.abs(b[j] - time)) j += 1;
    if (Math.abs(b[j] - time) <= tolerance) matched += 1;
  }
  return matched / a.length;
}

/** Median inter-beat interval; robust to a dropped beat in a way the mean is not. */
export function medianInterval(beats: readonly number[]): number | null {
  if (beats.length < 2) return null;
  const intervals = [];
  for (let i = 1; i < beats.length; i += 1) {
    const delta = beats[i] - beats[i - 1];
    if (delta > 0 && Number.isFinite(delta)) intervals.push(delta);
  }
  if (!intervals.length) return null;
  intervals.sort((x, y) => x - y);
  return intervals[Math.floor(intervals.length / 2)];
}

export const tempoOf = (beats: readonly number[]): number | null => {
  const interval = medianInterval(beats);
  return interval && interval > 0 ? round(60 / interval, 4) : null;
};

/**
 * The metrical relationship between two beat grids, or null if there is none.
 *
 * Returns the ratio of a's period to b's: 2 means a's beats are twice as long
 * (a is reading half time). Only the relationships music actually uses are
 * considered — a 1.37 ratio is not a metrical relationship, it is two trackers
 * that disagree about the piece.
 */
export function metricalRatio(a: readonly number[], b: readonly number[]): number | null {
  const pa = medianInterval(a);
  const pb = medianInterval(b);
  if (!pa || !pb) return null;
  const ratio = pa / pb;
  for (const candidate of [2, 1 / 2, 3, 1 / 3, 3 / 2, 2 / 3]) {
    if (Math.abs(ratio / candidate - 1) <= 0.06) return candidate;
  }
  return Math.abs(ratio - 1) <= 0.06 ? 1 : null;
}

// ---------------------------------------------------------------------------
// Audio evidence
// ---------------------------------------------------------------------------

const envelopeAt = (envelope: OnsetEnvelope, seconds: number): number => {
  const start = envelope.startSeconds ?? 0;
  const index = Math.round((seconds - start) * envelope.frameRateHz);
  if (index < 0 || index >= envelope.strengths.length) return 0;
  return envelope.strengths[index];
};

/**
 * How well a beat grid explains the onsets: the mean onset strength in a small
 * window around each beat, divided by the mean strength everywhere.
 *
 * A tactus grid sits on the onsets. A half-time grid sits on half of them and
 * scores the same *per beat* — which is exactly why this alone cannot settle
 * half/double, and why `beatSalience` is only one of three signals below.
 */
export function beatSalience(beats: readonly number[], envelope: OnsetEnvelope): number {
  if (!beats.length || !envelope.strengths.length) return 0;
  const window = Math.max(1, Math.round(0.05 * envelope.frameRateHz));
  let onBeat = 0;
  for (const beat of beats) {
    let best = 0;
    for (let offset = -window; offset <= window; offset += 1) {
      best = Math.max(best, envelopeAt(envelope, beat + offset / envelope.frameRateHz));
    }
    onBeat += best;
  }
  const overall = envelope.strengths.reduce((sum, v) => sum + v, 0) / envelope.strengths.length;
  return overall > 0 ? round(onBeat / beats.length / overall, 4) : 0;
}

/**
 * The share of substantial onsets that a grid actually covers.
 *
 * This is the signal that separates 60 from 120: both grids sit on onsets, but
 * a half-time grid leaves every other onset unexplained. A tactus grid covers
 * nearly all of them; a double-time grid covers all of them and then some empty
 * positions besides, which `beatSalience` penalises.
 */
export function onsetCoverage(
  beats: readonly number[],
  envelope: OnsetEnvelope,
  tolerance = BEAT_TOLERANCE_SECONDS,
): number {
  const start = envelope.startSeconds ?? 0;
  const strengths = envelope.strengths;
  if (!strengths.length || beats.length < 2) return 0;
  const sorted = [...strengths].sort((a, b) => b - a);
  // "Substantial" = above the 80th percentile of frame strength, but never
  // within a whisker of the noise floor. Without that second clause a sparse
  // piece — most of whose frames are near-silent — puts its 80th percentile at
  // the floor itself, and every frame becomes "substantial".
  const threshold = Math.max(sorted[Math.floor(sorted.length * 0.2)] || 0, 0.15 * (sorted[0] ?? 0));
  let peaks = 0;
  let covered = 0;
  for (let i = 1; i < strengths.length - 1; i += 1) {
    if (strengths[i] < threshold) continue;
    // A *strict* rise into the frame. A plateau is not an onset, and counting
    // every frame of a flat passage as one inflates the denominator until a
    // perfectly good beat grid looks like it explains nothing.
    if (!(strengths[i] > strengths[i - 1] && strengths[i] >= strengths[i + 1])) continue;
    peaks += 1;
    const time = start + i / envelope.frameRateHz;
    let nearest = Infinity;
    for (const beat of beats) {
      const distance = Math.abs(beat - time);
      if (distance < nearest) nearest = distance;
      if (beat > time + 1) break;
    }
    if (nearest <= tolerance * 1.5) covered += 1;
  }
  return peaks ? round(covered / peaks, 4) : 0;
}

/** Autocorrelation of the onset envelope at one lag, in seconds. */
export function envelopeAutocorrelation(envelope: OnsetEnvelope, lagSeconds: number): number {
  const lag = Math.round(lagSeconds * envelope.frameRateHz);
  const strengths = envelope.strengths;
  if (lag <= 0 || lag >= strengths.length) return 0;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let i = 0; i + lag < strengths.length; i += 1) {
    numerator += strengths[i] * strengths[i + lag];
    leftEnergy += strengths[i] * strengths[i];
    rightEnergy += strengths[i + lag] * strengths[i + lag];
  }
  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? round(numerator / denominator, 4) : 0;
}

// ---------------------------------------------------------------------------
// Clustering providers by beat grid
// ---------------------------------------------------------------------------

export type GridCluster = {
  members: ProviderRhythmObservation[];
  /** The member whose grid is closest to the others; its output is used verbatim. */
  representative: ProviderRhythmObservation;
  periodSeconds: number;
  tempoBpm: number;
};

/** Group providers whose beat grids agree; a group of one is still a group. */
export function clusterByGrid(
  observations: readonly ProviderRhythmObservation[],
  tolerance = BEAT_TOLERANCE_SECONDS,
): GridCluster[] {
  const usable = observations.filter((o) => o.beats.length >= 2);
  const clusters: ProviderRhythmObservation[][] = [];
  for (const observation of usable) {
    const target = clusters.find((cluster) =>
      cluster.every((member) =>
        gridAgreement(member.beats, observation.beats, tolerance) >= 0.7 &&
        gridAgreement(observation.beats, member.beats, tolerance) >= 0.7));
    if (target) target.push(observation);
    else clusters.push([observation]);
  }
  return clusters
    .map((members) => {
      // The representative is the member with the highest mean agreement to the
      // rest, so the grid we hand on is a real provider's grid and the most
      // central one available — never a blend.
      const representative = members.reduce((best, candidate) => {
        const score = (member: ProviderRhythmObservation) =>
          members.reduce((sum, other) =>
            sum + (other === member ? 0 : gridAgreement(member.beats, other.beats, tolerance)), 0);
        return score(candidate) > score(best) ? candidate : best;
      }, members[0]);
      const period = medianInterval(representative.beats) ?? 0;
      return {
        members: [...members].sort((a, b) => a.provider.localeCompare(b.provider)),
        representative,
        periodSeconds: round(period, 5),
        tempoBpm: period > 0 ? round(60 / period, 4) : 0,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || a.tempoBpm - b.tempoBpm);
}

// ---------------------------------------------------------------------------
// Beats per bar, from a provider's own output
// ---------------------------------------------------------------------------

/** How many of a provider's own beats fall in each of its own bars. */
export function beatsPerBarOf(observation: ProviderRhythmObservation): number | null {
  const { beats, downbeats } = observation;
  if (!downbeats || downbeats.length < 2 || beats.length < 2) return null;
  const counts: number[] = [];
  for (let i = 1; i < downbeats.length; i += 1) {
    const count = beats.filter((b) => b >= downbeats[i - 1] - 1e-6 && b < downbeats[i] - 1e-6).length;
    if (count > 0) counts.push(count);
  }
  if (!counts.length) return null;
  const tally = new Map<number, number>();
  for (const count of counts) tally.set(count, (tally.get(count) ?? 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/**
 * The metre a beats-per-bar count implies.
 *
 * 6 beats to a bar is written 6/8 only when they group in threes; at the tactus
 * level a 6/8 bar is *two* beats, so a provider reporting 6 beats per bar is
 * reporting 6/4 or a 6/8 read at the eighth. We write the simple reading and let
 * `triple_duple_meter` carry the ambiguity rather than silently picking one.
 */
export function meterFromBeatsPerBar(beatsPerBar: number): string | null {
  if (!Number.isInteger(beatsPerBar) || beatsPerBar < 2 || beatsPerBar > 12) return null;
  return `${beatsPerBar}/4`;
}

// ---------------------------------------------------------------------------
// Disagreement families
// ---------------------------------------------------------------------------

/**
 * Which of two grids is the tactus, when they stand in a 2:1 (or 3:1) relation.
 *
 * Three signals, in this order of authority:
 *
 *  1. **Onset coverage.** The half-time grid leaves every other onset
 *     unexplained. This is the strongest signal and the one that actually
 *     distinguishes the two, because both grids have equal onset *salience*.
 *  2. **Envelope autocorrelation at the two periods.** The pulse the music
 *     repeats at correlates with itself; a metrical level nobody plays does not.
 *  3. **A perceptual tempo prior centred near 120 BPM.** Used only as a
 *     tiebreak, and always named as such, because a prior is a statement about
 *     music in general and not about this piece.
 */
export function resolveHalfDouble(
  fast: GridCluster,
  slow: GridCluster,
  envelope: OnsetEnvelope | null | undefined,
): { winner: GridCluster; reason: string; margin: number; signals: Record<string, number> } {
  const preference = (cluster: GridCluster): number => {
    // The prior: |log2(tempo/120)| — cheap, symmetric, and honest about being a prior.
    const distance = Math.abs(Math.log2((cluster.tempoBpm || 1) / 120));
    return Math.max(0, 1 - distance / 2);
  };
  const signals: Record<string, number> = {
    fastTempoBpm: fast.tempoBpm,
    slowTempoBpm: slow.tempoBpm,
    fastPrior: round(preference(fast)),
    slowPrior: round(preference(slow)),
  };
  if (envelope && envelope.strengths.length) {
    const fastCoverage = onsetCoverage(fast.representative.beats, envelope);
    const slowCoverage = onsetCoverage(slow.representative.beats, envelope);
    const fastSalience = beatSalience(fast.representative.beats, envelope);
    const slowSalience = beatSalience(slow.representative.beats, envelope);
    const fastAuto = envelopeAutocorrelation(envelope, fast.periodSeconds);
    const slowAuto = envelopeAutocorrelation(envelope, slow.periodSeconds);
    Object.assign(signals, {
      fastOnsetCoverage: fastCoverage, slowOnsetCoverage: slowCoverage,
      fastBeatSalience: fastSalience, slowBeatSalience: slowSalience,
      fastAutocorrelation: fastAuto, slowAutocorrelation: slowAuto,
    });
    // Coverage decides unless it is close; salience keeps a double-time grid
    // that covers everything from winning on coverage alone.
    const coverageMargin = fastCoverage - slowCoverage;
    if (Math.abs(coverageMargin) >= 0.12) {
      const winner = coverageMargin > 0 ? fast : slow;
      const loser = coverageMargin > 0 ? slow : fast;
      return {
        winner,
        margin: round(Math.abs(coverageMargin)),
        signals,
        reason: `onset coverage: ${winner.representative.provider}'s grid at ${winner.tempoBpm} BPM ` +
          `explains ${Math.round(Math.max(fastCoverage, slowCoverage) * 100)}% of the substantial onsets ` +
          `against ${Math.round(Math.min(fastCoverage, slowCoverage) * 100)}% for ${loser.tempoBpm} BPM`,
      };
    }
    const autoMargin = fastAuto - slowAuto;
    if (Math.abs(autoMargin) >= 0.08) {
      const winner = autoMargin > 0 ? fast : slow;
      return {
        winner,
        margin: round(Math.abs(autoMargin)),
        signals,
        reason: `onset-envelope autocorrelation is stronger at ${winner.periodSeconds}s ` +
          `(${Math.max(fastAuto, slowAuto)}) than at the alternative (${Math.min(fastAuto, slowAuto)})`,
      };
    }
    const salienceMargin = fastSalience - slowSalience;
    if (Math.abs(salienceMargin) >= 0.25) {
      const winner = salienceMargin > 0 ? fast : slow;
      return {
        winner,
        margin: round(Math.abs(salienceMargin)),
        signals,
        reason: `onset strength on the beat favours ${winner.tempoBpm} BPM`,
      };
    }
  }
  const winner = preference(fast) >= preference(slow) ? fast : slow;
  return {
    winner,
    margin: round(Math.abs(preference(fast) - preference(slow))),
    signals,
    reason: envelope
      ? `audio evidence was inconclusive; fell back to the perceptual tempo prior near 120 BPM, which favours ${winner.tempoBpm} BPM`
      : `no onset envelope was supplied, so only the perceptual tempo prior near 120 BPM was available; it favours ${winner.tempoBpm} BPM`,
  };
}

/**
 * A constant beat-index offset between two providers' downbeat sets on a shared
 * beat grid — the pickup signature.
 *
 * Returns the shift in beats, or null when the two disagree in a way a single
 * rotation cannot explain (which is a different, worse problem).
 */
export function downbeatPhaseShift(
  beats: readonly number[],
  left: readonly number[],
  right: readonly number[],
  tolerance = BEAT_TOLERANCE_SECONDS,
): number | null {
  const indexOf = (time: number): number | null => {
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let i = 0; i < beats.length; i += 1) {
      const distance = Math.abs(beats[i] - time);
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return bestDistance <= tolerance ? best : null;
  };
  const leftIndices = left.map(indexOf).filter((i): i is number => i !== null);
  const rightIndices = right.map(indexOf).filter((i): i is number => i !== null);
  if (leftIndices.length < 2 || rightIndices.length < 2) return null;
  const shifts = new Map<number, number>();
  for (const l of leftIndices) {
    let nearest: number | null = null;
    for (const r of rightIndices) {
      if (nearest === null || Math.abs(r - l) < Math.abs(nearest - l)) nearest = r;
    }
    if (nearest !== null) shifts.set(nearest - l, (shifts.get(nearest - l) ?? 0) + 1);
  }
  const ranked = [...shifts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [shift, support] = ranked[0];
  return support / leftIndices.length >= 0.8 ? shift : null;
}

/** The time up to which two beat grids still agree; the drift horizon. */
export function agreementHorizon(
  a: readonly number[],
  b: readonly number[],
  tolerance = BEAT_TOLERANCE_SECONDS,
): number | null {
  if (!a.length || !b.length) return null;
  let last: number | null = null;
  for (const time of a) {
    let nearest = Infinity;
    for (const other of b) {
      const distance = Math.abs(other - time);
      if (distance < nearest) nearest = distance;
      if (other > time + 1) break;
    }
    if (nearest > tolerance) return last;
    last = time;
  }
  return last;
}

/**
 * Choose the downbeat phase using the audio, when two providers rotate the bar
 * differently on the same beat grid.
 *
 * A downbeat carries more onset weight than the other beats of the bar in most
 * music. That is a tendency, not a law, so a small margin returns null and the
 * field stays contested rather than being decided by a coin toss with a
 * rationale attached.
 */
export function resolveDownbeatPhase(
  candidates: Array<{ provider: string; downbeats: readonly number[] }>,
  envelope: OnsetEnvelope | null | undefined,
): { provider: string; margin: number; salience: Record<string, number> } | null {
  if (candidates.length < 2 || !envelope || !envelope.strengths.length) return null;
  const salience: Record<string, number> = {};
  for (const candidate of candidates) {
    salience[candidate.provider] = beatSalience(candidate.downbeats, envelope);
  }
  const ranked = [...candidates].sort((a, b) => salience[b.provider] - salience[a.provider]);
  const margin = round(salience[ranked[0].provider] - salience[ranked[1].provider]);
  return margin >= 0.15 ? { provider: ranked[0].provider, margin, salience } : null;
}

// ---------------------------------------------------------------------------
// The tempo map
// ---------------------------------------------------------------------------

/**
 * A tempo map from one provider's own beat grid.
 *
 * Local tempo is the median of a five-beat window of inter-beat intervals: long
 * enough that one jittery beat does not become a tempo change, short enough that
 * a real rubato still shows. Points are emitted only where the tempo actually
 * moves by more than 1 %, so a steady piece gets one entry rather than four
 * hundred identical ones.
 */
export function tempoMapFromBeats(beats: readonly number[]): Array<{ time: number; bpm: number }> {
  if (beats.length < 3) return [];
  const window = 5;
  const points: Array<{ time: number; bpm: number }> = [];
  for (let i = 0; i < beats.length - 1; i += 1) {
    const from = Math.max(0, i - Math.floor(window / 2));
    const to = Math.min(beats.length - 1, from + window);
    const intervals: number[] = [];
    for (let j = from + 1; j <= to; j += 1) intervals.push(beats[j] - beats[j - 1]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    if (!(median > 0)) continue;
    const bpm = round(60 / median, 3);
    const previous = points[points.length - 1];
    if (!previous || Math.abs(bpm - previous.bpm) / previous.bpm > 0.01) {
      points.push({ time: round(beats[i], 5), bpm });
    }
  }
  if (points.length && points[0].time !== 0) points[0] = { ...points[0], time: 0 };
  return points;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/**
 * Reconcile several providers' rhythm readings into one, with a status per field.
 *
 * The shape of the algorithm:
 *   1. Cluster providers by beat grid. Clusters that stand in a metrical
 *      relation to each other are a half/double disagreement; clusters that do
 *      not are a plain mismatch.
 *   2. Resolve the metrical relation with audio evidence, and adopt the winning
 *      cluster's representative grid **verbatim**.
 *   3. On that grid, reconcile the downbeats: absent, agreeing, or rotated
 *      (the pickup family).
 *   4. Read the metre off the adopted beats and downbeats, and reconcile it
 *      against what the providers themselves claimed (the 3/4-vs-6/8 family).
 *   5. Check drift: how far into the clip the providers still agree.
 */
export function reconcileRhythm(evidence: RhythmEvidence): ReconciledRhythm {
  const tolerance = evidence.tolerance ?? BEAT_TOLERANCE_SECONDS;
  const envelope = evidence.onsetEnvelope ?? null;
  const usable = evidence.observations.filter((o) => o.beats.length >= 2);
  // Readings with a tempo and no beat grid — the platform's own onset-envelope
  // estimator is one. They cannot corroborate beat positions, but they can
  // name a metrical level, and a level named is a level carried.
  const tempoOnly = evidence.observations.filter((o) =>
    o.beats.length === 0 && typeof o.tempoBpm === "number" && o.tempoBpm > 0);
  const disagreements: RhythmDisagreement[] = [];

  if (!usable.length) {
    const rationale = evidence.observations.length
      ? "Every provider returned fewer than two beats; there is no grid to reconcile."
      : "No provider returned a rhythm observation.";
    const tempoOnlyCandidates = tempoOnly.map((o) => ({
      value: o.tempoBpm as number,
      providers: [o.provider],
      note: "tempo-only reading with no beat grid; nothing corroborates it",
    }));
    return {
      version: "1.0",
      tempo: tempoOnlyCandidates.length
        ? {
            value: tempoOnlyCandidates[0].value,
            status: "contested",
            providers: [tempoOnlyCandidates[0].providers[0]],
            dissenting: tempoOnlyCandidates.slice(1).map((c) => ({ provider: c.providers[0], value: `${c.value} BPM` })),
            rationale: `${rationale} ${tempoOnlyCandidates[0].providers[0]} read ${tempoOnlyCandidates[0].value} BPM ` +
              "without a beat grid; carried verbatim and uncorroborated.",
            ...(tempoOnlyCandidates.length > 1 ? { candidates: tempoOnlyCandidates } : {}),
          }
        : unknownField(rationale),
      tempoMap: unknownField(rationale),
      beatGrid: unknownField(rationale),
      downbeats: unknownField(rationale),
      meter: unknownField(rationale),
      disagreements: [],
      contestedFields: [],
      selectedProvider: null,
      usedAudioEvidence: Boolean(envelope?.strengths.length),
    };
  }

  const clusters = clusterByGrid(usable, tolerance);
  let selected = clusters[0];
  let gridRationale: string;
  let gridStatus: FieldStatus;
  /** How the metrical-level dispute, if any, was leaned — for the tempo rationale. */
  let tempoLean: string | null = null;

  if (clusters.length === 1) {
    gridStatus = selected.members.length >= 2 ? "agreed" : "contested";
    gridRationale = selected.members.length >= 2
      ? `${selected.members.map((m) => m.provider).join(" and ")} produced the same beat grid within ${tolerance * 1000} ms; ` +
        `${selected.representative.provider}'s grid is used verbatim.`
      : `Only ${selected.representative.provider} produced a beat grid, so nothing corroborates it.`;
  } else {
    const [first, second] = clusters;
    const ratio = metricalRatio(first.representative.beats, second.representative.beats);
    if (ratio !== null && ratio !== 1) {
      const fast = first.periodSeconds <= second.periodSeconds ? first : second;
      const slow = fast === first ? second : first;
      const outcome = resolveHalfDouble(fast, slow, envelope);
      selected = outcome.winner;
      const decisive = outcome.margin >= (envelope?.strengths.length ? 0.12 : 0.25);
      gridStatus = decisive ? "agreed" : "contested";
      tempoLean = decisive
        ? `The audio leans to ${selected.tempoBpm} BPM (${outcome.reason}) and that grid is adopted for the beat positions`
        : `The audio did not settle it (${outcome.reason}; margin ${outcome.margin}), so ${selected.tempoBpm} BPM is carried first only as the lean`;
      gridRationale =
        `${fast.members.map((m) => m.provider).join("/")} read ${fast.tempoBpm} BPM and ` +
        `${slow.members.map((m) => m.provider).join("/")} read ${slow.tempoBpm} BPM — a ` +
        `${ratio > 1 ? ratio : round(1 / ratio, 3)}:1 metrical relation, not a numeric dispute. ` +
        `Resolved by ${outcome.reason}. ${selected.representative.provider}'s grid is adopted verbatim; ` +
        `no averaged grid is produced.`;
      disagreements.push({
        family: ratio === 2 || ratio === 1 / 2 ? "half_double_tempo" : "triple_duple_meter",
        providers: [...fast.members, ...slow.members].map((m) => m.provider).sort(),
        detail: `${fast.tempoBpm} BPM against ${slow.tempoBpm} BPM (ratio ${round(fast.periodSeconds / slow.periodSeconds, 3)}).`,
        resolution: decisive
          ? `Adopted ${selected.tempoBpm} BPM — ${outcome.reason}.`
          : `Left contested: ${outcome.reason}, but the margin (${outcome.margin}) is too small to call.`,
        resolved: decisive,
        evidence: { ...outcome.signals, ratio, margin: outcome.margin },
      });
    } else {
      gridStatus = "contested";
      const alternatives = clusters
        .map((cluster) => `${cluster.members.map((m) => m.provider).join("/")} at ${cluster.tempoBpm} BPM`)
        .join("; ");
      // Two grids at the same level that do not line up — 130.4 against 129.2
      // over four minutes — are not two readings of the metrical level; they
      // are one level and a positional drift. Saying "no metrical relation"
      // about them would be false, and it would put a 129.2 "candidate"
      // beside a 130.4 one as if a producer had a level to choose there.
      const sameLevel = ratio === 1;
      gridRationale = sameLevel
        ? `The providers read the same metrical level but their grids do not line up within ${tolerance * 1000} ms ` +
          `for most of the clip (${alternatives}). The largest cluster's grid is reported, unaveraged; ` +
          `the others are positional dissent, not another tempo.`
        : `The providers' grids stand in no metrical relation to one another (${alternatives}). ` +
          `The largest cluster's grid is reported, unaveraged, but nothing corroborates it.`;
      disagreements.push({
        family: "beat_grid_mismatch",
        providers: usable.map((o) => o.provider).sort(),
        detail: alternatives,
        resolution: sameLevel
          ? "Not resolved: the same level, grids that drift apart, and no majority beyond the largest cluster. The field is contested."
          : "Not resolved: no metrical relation and no majority. The field is contested.",
        resolved: false,
        evidence: { clusters: clusters.length, sameLevel: sameLevel ? 1 : 0 },
      });
    }
  }

  const beats = [...selected.representative.beats];
  const supporters = selected.members.map((m) => m.provider);
  const dissenters = clusters
    .filter((cluster) => cluster !== selected)
    .flatMap((cluster) => cluster.members.map((m) => ({
      provider: m.provider,
      value: `${round(60 / (medianInterval(m.beats) || 1), 2)} BPM grid`,
    })));

  // --- drift -------------------------------------------------------------
  const duration = evidence.durationSeconds ?? beats[beats.length - 1];
  let driftedEarly = false;
  for (const other of usable) {
    if (other === selected.representative) continue;
    if (metricalRatio(selected.representative.beats, other.beats) !== 1) continue;
    const horizon = agreementHorizon(selected.representative.beats, other.beats, tolerance);
    if (horizon !== null && duration > 0 && horizon < duration * 0.8) {
      driftedEarly = true;
      disagreements.push({
        family: "drift",
        providers: [selected.representative.provider, other.provider].sort(),
        detail: `${selected.representative.provider} and ${other.provider} agree until ${round(horizon, 2)} s ` +
          `of ${round(duration, 2)} s, then separate by more than ${tolerance * 1000} ms.`,
        resolution:
          "Not averaged. The adopted grid is one provider's; the horizon is reported so a caller " +
          "can trust the opening and re-ask about the tail, which is what rubato actually requires.",
        resolved: false,
        evidence: { horizonSeconds: round(horizon, 3), durationSeconds: round(duration, 3),
          horizonShare: round(horizon / duration, 3) },
      });
    }
  }

  const beatGrid: ReconciledField<number[]> = {
    value: beats,
    status: driftedEarly && gridStatus === "agreed" ? "contested" : gridStatus,
    providers: supporters,
    dissenting: dissenters,
    rationale: driftedEarly
      ? `${gridRationale} Downgraded to contested: the providers stop agreeing before the clip ends.`
      : gridRationale,
  };

  // --- tempo -------------------------------------------------------------
  //
  // A tempo is a reading of a beat grid, and when the providers offered more
  // than one grid there is more than one reading. The engine leans — with the
  // audio when it can — and adopts one grid for the beat *positions*, but it
  // does not pick the tactus for the producer: every level offered is carried
  // as a candidate, verbatim from the provider that offered it, and the field
  // is `contested` until a producer confirms one. Whether a song is felt in
  // 64.8 or 129.6 is not a statistic about onsets; it is what the musicians
  // meant, and the contested-key rule (PR-86) applies unchanged.
  const tempoBpm = tempoOf(beats);
  // Only clusters at a *different* metrical level are candidates. A cluster at
  // the same level whose grid merely fails to line up is positional dissent
  // (listed in `dissenting`), not a second tempo for a producer to choose.
  const otherLevels = clusters.filter((cluster) =>
    cluster !== selected &&
    metricalRatio(selected.representative.beats, cluster.representative.beats) !== 1);
  const tempoCandidates = [selected, ...otherLevels]
    .map((cluster) => ({
      value: tempoOf(cluster.representative.beats),
      providers: cluster.members.map((m) => m.provider),
      note: cluster === selected
        ? `the lean; ${cluster.representative.provider}'s grid is the one adopted for beat positions`
        : `alternative metrical level; ${cluster.representative.provider}'s grid would replace the adopted one if confirmed`,
    }))
    .filter((candidate): candidate is { value: number; providers: string[]; note: string } =>
      candidate.value !== null);
  // A tempo-only reading joins the candidates when it names a metrical level
  // of the adopted grid that no grid-bearing provider offered. 64.8 against a
  // grid at 129.6 is the half level, and the half level is a reading of the
  // same beats, not a wrong answer — so it is carried, verbatim, and the
  // question goes to the producer. A reading in no metrical relation to the
  // grid is listed as dissent: it is a different claim about the piece.
  const tempoOnlySupport: string[] = [];
  const tempoOnlyDissent: Array<{ provider: string; value: string }> = [];
  const tempoOnlyLevels: string[] = [];
  for (const reading of tempoOnly) {
    const bpm = reading.tempoBpm as number;
    const level = tempoBpm ? metricalRatio([0, 60 / bpm], [0, 60 / tempoBpm]) : null;
    if (level === 1) {
      tempoOnlySupport.push(reading.provider);
    } else if (level !== null) {
      const already = tempoCandidates.some((c) => Math.abs(Math.log2(c.value / bpm)) < 0.085);
      if (!already) {
        tempoCandidates.push({
          value: bpm,
          providers: [reading.provider],
          note: `tempo-only reading with no beat grid, at ${level > 1 ? `1/${level}` : `${round(1 / level, 2)}×`} the adopted grid's tempo; ` +
            "it names a metrical level and cannot corroborate beat positions",
        });
      }
      tempoOnlyLevels.push(`${reading.provider} read ${bpm} BPM with no beat grid, the ${level > 1 ? "slower" : "faster"} level (ratio ${round(1 / level, 3)}) of the adopted grid`);
      disagreements.push({
        family: level === 2 || level === 1 / 2 ? "half_double_tempo" : "triple_duple_meter",
        providers: [reading.provider, ...supporters].sort(),
        detail: `${bpm} BPM (${reading.provider}, tempo only) against ${tempoBpm} BPM (${supporters.join("/")}, beat grid).`,
        resolution:
          "Left contested. A tempo without a beat grid cannot be tested against the onsets the way two grids can; " +
          "both levels are carried as candidates and a producer confirms which the song is felt in.",
        resolved: false,
        evidence: { ratio: round(1 / level, 4), tempoOnlyBpm: bpm, gridBpm: tempoBpm },
      });
    } else {
      tempoOnlyDissent.push({
        provider: reading.provider,
        value: `${bpm} BPM, no beat grid, no metrical relation to the adopted grid`,
      });
    }
  }
  const contestedTempo = tempoCandidates.length > 1;
  let tempoRationale: string;
  if (contestedTempo) {
    const levels = tempoCandidates.map((c) => `${c.value} BPM (${c.providers.join("/")})`).join(" and ");
    const how = tempoLean
      ? `${tempoLean}`
      : otherLevels.length === 0
        ? `${supporters.join(" and ")} agree on the beat grid at ${tempoBpm} BPM; ${tempoOnlyLevels.join("; ")}`
        : "They stand in no metrical relation and nothing corroborates the first";
    tempoRationale =
      `${tempoCandidates.length} metrical levels were offered: ${levels}. ${how}. ` +
      "Every level is carried as a candidate and none is averaged; the tempo stays contested until a " +
      "producer confirms which level the song is felt in.";
  } else {
    tempoRationale =
      `Median inter-beat interval of ${selected.representative.provider}'s adopted grid. ` +
      (tempoOnlySupport.length
        ? `${tempoOnlySupport.join(" and ")} read the same level without a beat grid. `
        : "") +
      "No provider read a different metrical level.";
  }
  const tempo: ReconciledField<number> = {
    value: tempoBpm,
    status: contestedTempo ? "contested" : beatGrid.status,
    providers: [...supporters, ...tempoOnlySupport],
    dissenting: [...dissenters, ...tempoOnlyDissent],
    rationale: tempoRationale,
    ...(contestedTempo ? { candidates: tempoCandidates } : {}),
  };

  const points = tempoMapFromBeats(beats);
  const tempoMap: ReconciledField<Array<{ time: number; bpm: number }>> = {
    value: points.length ? points : null,
    status: points.length ? tempo.status : "unknown",
    providers: supporters,
    dissenting: dissenters,
    rationale: points.length
      ? `Derived from ${selected.representative.provider}'s own beat grid (five-beat median window); ` +
        `it is that provider's timing, not a blend of several.`
      : "Too few beats to describe how the tempo moves.",
  };

  // --- downbeats ---------------------------------------------------------
  const withDownbeats = usable.filter((o) => o.downbeats && o.downbeats.length >= 2);
  let downbeats: ReconciledField<number[]>;
  if (!withDownbeats.length) {
    downbeats = unknownField(
      `No provider returned downbeats (${usable.map((o) => o.provider).join(", ")} track beats only).`,
    );
    disagreements.push({
      family: "downbeat_absent",
      providers: usable.map((o) => o.provider).sort(),
      detail: "No contender in this run has a downbeat model.",
      resolution: "Reported as unknown rather than assumed to be every fourth beat.",
      resolved: false,
      evidence: {},
    });
  } else {
    // Only providers on the adopted grid may speak about its bars: a downbeat
    // set from a half-time grid is not a rotation of this one, it is a different
    // reading of the piece, and it was already accounted for above.
    const onGrid = withDownbeats.filter((o) =>
      gridAgreement(o.beats, beats, tolerance) >= 0.7 || o === selected.representative);
    const speakers = onGrid.length ? onGrid : withDownbeats;
    const phasePairs: Array<{ left: string; right: string; shift: number }> = [];
    for (let i = 0; i < speakers.length; i += 1) {
      for (let j = i + 1; j < speakers.length; j += 1) {
        const shift = downbeatPhaseShift(beats, speakers[i].downbeats!, speakers[j].downbeats!, tolerance);
        if (shift !== null && shift !== 0) {
          phasePairs.push({ left: speakers[i].provider, right: speakers[j].provider, shift });
        }
      }
    }
    const preferred = speakers.find((o) => o === selected.representative) ?? speakers[0];
    if (phasePairs.length) {
      const resolution = resolveDownbeatPhase(
        speakers.map((o) => ({ provider: o.provider, downbeats: o.downbeats! })), envelope);
      const winner = resolution
        ? speakers.find((o) => o.provider === resolution.provider) ?? preferred
        : preferred;
      const shift = phasePairs[0].shift;
      disagreements.push({
        family: "pickup_phase",
        providers: [...new Set(phasePairs.flatMap((p) => [p.left, p.right]))].sort(),
        detail: `The same beat grid, the bar started ${Math.abs(shift)} beat(s) apart: ` +
          phasePairs.map((p) => `${p.left} vs ${p.right} by ${p.shift}`).join(", ") +
          ". This is the anacrusis signature — one reading treats the opening beats as a pickup, the other as a full bar.",
        resolution: resolution
          ? `Adopted ${winner.provider}'s phase: its downbeats carry ${resolution.margin} more onset weight than the alternative.`
          : "Left contested. Onset weight did not separate the two phases, and a downbeat guessed from a coin toss " +
            "shifts every bar line in the arrangement.",
        resolved: Boolean(resolution),
        evidence: { shiftBeats: shift, ...(resolution?.salience ?? {}),
          margin: resolution?.margin ?? null },
      });
      downbeats = {
        value: [...winner.downbeats!],
        status: resolution ? "contested" : "contested",
        providers: [winner.provider],
        dissenting: speakers.filter((o) => o !== winner)
          .map((o) => ({ provider: o.provider, value: `first downbeat at ${round(o.downbeats![0], 3)} s` })),
        rationale: resolution
          ? `Providers rotated the bar by ${Math.abs(shift)} beat(s). ${winner.provider}'s phase carries more onset ` +
            `weight and is adopted verbatim, but a rotation this consequential stays flagged for review.`
          : `Providers rotated the bar by ${Math.abs(shift)} beat(s) and the audio did not separate them. ` +
            `${winner.provider}'s reading is reported unchanged; no third phase was invented.`,
      };
    } else {
      const agreeing = speakers.filter((o) =>
        gridAgreement(o.downbeats!, preferred.downbeats!, tolerance) >= 0.8);
      downbeats = {
        value: [...preferred.downbeats!],
        status: agreeing.length >= 2 ? "agreed" : "contested",
        providers: agreeing.length >= 2 ? agreeing.map((o) => o.provider).sort() : [preferred.provider],
        dissenting: speakers.filter((o) => !agreeing.includes(o))
          .map((o) => ({ provider: o.provider, value: `${o.downbeats!.length} downbeats` })),
        rationale: agreeing.length >= 2
          ? `${agreeing.map((o) => o.provider).join(" and ")} placed the bar lines together; ` +
            `${preferred.provider}'s downbeats are used verbatim.`
          : `Only ${preferred.provider} placed bar lines on the adopted grid, so nothing corroborates them.`,
      };
    }
  }

  // --- metre -------------------------------------------------------------
  let meter: ReconciledField<string>;
  const derived = new Map<string, string>();
  for (const observation of usable) {
    const perBar = beatsPerBarOf(observation);
    const label = perBar !== null ? meterFromBeatsPerBar(perBar) : null;
    if (label) derived.set(observation.provider, label);
    else if (observation.meter) derived.set(observation.provider, observation.meter);
  }
  if (!derived.size) {
    meter = unknownField("No provider produced enough downbeats to count beats to a bar.");
  } else {
    const tally = new Map<string, string[]>();
    for (const [provider, label] of derived) {
      tally.set(label, [...(tally.get(label) ?? []), provider]);
    }
    const ranked = [...tally.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const [best, backers] = ranked[0];
    const contestedByTriple = ranked.length > 1 && ranked.some(([label]) =>
      (best === "3/4" && label === "6/8") || (best === "6/8" && label === "3/4") ||
      (best === "3/4" && label === "2/4") || (best === "2/4" && label === "3/4"));
    if (contestedByTriple) {
      disagreements.push({
        family: "triple_duple_meter",
        providers: [...derived.keys()].sort(),
        detail: ranked.map(([label, who]) => `${who.join("/")}: ${label}`).join("; ") +
          ". A 3/4 bar and a 6/8 bar are the same length in quarters and differ only in how the beats group, " +
          "so the bar lines can agree while the beat count does not.",
        resolution: backers.length > 1
          ? `Reported as ${best}, which more providers derived from their own beats and bars.`
          : "Left contested: each reading has one backer and neither is a rounding error of the other.",
        resolved: backers.length > 1,
        evidence: { readings: ranked.length },
      });
    }
    meter = {
      value: best,
      status: backers.length >= 2 && !contestedByTriple ? "agreed" : "contested",
      providers: [...backers].sort(),
      dissenting: ranked.slice(1).flatMap(([label, who]) => who.map((provider) => ({ provider, value: label }))),
      rationale: backers.length >= 2
        ? `Counted from each provider's own beats and bars; ${backers.join(" and ")} counted ${best}.`
        : `Only ${backers.join("")} produced a countable bar, so ${best} is uncorroborated.`,
    };
  }

  const fields: Array<[string, ReconciledField<unknown>]> = [
    ["tempo", tempo], ["tempoMap", tempoMap], ["beatGrid", beatGrid],
    ["downbeats", downbeats], ["meter", meter],
  ];
  return {
    version: "1.0",
    tempo,
    tempoMap,
    beatGrid,
    downbeats,
    meter,
    disagreements,
    contestedFields: fields.filter(([, field]) => field.status !== "agreed").map(([name]) => name),
    selectedProvider: selected.representative.provider,
    usedAudioEvidence: Boolean(envelope?.strengths.length),
  };
}
