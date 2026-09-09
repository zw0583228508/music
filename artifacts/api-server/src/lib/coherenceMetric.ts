/**
 * Whole-song coherence metric (Wave Q — Workstream J, long-form musical
 * intelligence).
 *
 * The tournament's judge (`partJudge.ts`) scores one 8-bar window. A window
 * can be perfect and the song still sound like twenty windows pasted
 * together: a part that vanishes and returns for no reason, a register that
 * jumps exactly where the generator's context ended, motifs that never come
 * back, a density that ignores the section plan. This metric measures those
 * things over a whole piece, so a multi-window output can be judged on what
 * 8-bar judging cannot see.
 *
 * Components (each 0..100, `null` when the piece is too short to measure it):
 *
 *  - **seamArtefacts** — the "pasted windows" signature. Per track, bar-to-bar
 *    jumps in register, density, pitch-class content, melodic leap across the
 *    bar line, and notes cut exactly at the bar line, measured at the
 *    `windowBars` grid lines versus at every other bar line. A control grid
 *    offset by half a window says how much of the jump is ordinary phrase
 *    structure (human music also changes at bar 8) rather than a seam.
 *  - **harmonicAgreement** — how much each track's pitch-class content agrees
 *    with the rest of the ensemble, bar by bar.
 *  - **instrumentationContinuity** — re-entries after an absence that neither
 *    a section boundary nor another track's entry or exit explains.
 *  - **trajectorySmoothness** — roughness of the ensemble register and density
 *    trajectories inside sections, and, when a section plan is given, rank
 *    agreement between planned and measured section density.
 *  - **motifRecurrence** — the share of each section's four-note melodic cells
 *    already heard in an earlier section (from `formSegmentation`).
 *
 * The score's calibration constants were set after one look at the human
 * distribution on real PDMX scores and before any synthetic comparison; the
 * separation they achieve is measured in `docs/evidence/coherence-metric-live.json`,
 * not asserted here.
 */
import {
  computeBarFeatures,
  fractionalBar,
  segmentForm,
  timeAtFractionalBar,
  type BarFeatures,
  type FormAnalysis,
  type FormInput,
  type FormOptions,
  type FormTrack,
} from "./formSegmentation";

export const COHERENCE_METRIC_VERSION = "COHERENCE_METRIC_v1" as const;

export type SectionPlanTarget = {
  startBar: number;
  /** Exclusive. */
  endBar: number;
  /** Planned density, 0..1 (the planners' `SectionTarget.density`). */
  density: number;
};

export type CoherenceOptions = {
  /** The generator's window, in bars: where seams would be. */
  windowBars?: number;
  /** A form already computed for this piece; computed here when absent. */
  form?: FormAnalysis;
  formOptions?: FormOptions;
  /** The section plan the arrangement was written against, if any. */
  plan?: SectionPlanTarget[];
};

export type SeamStatistic = {
  /** Mean jump at window-grid bar lines. */
  seam: number | null;
  /** Mean jump at the half-window offset grid (ordinary phrase structure). */
  control: number | null;
  /** Mean jump at every other bar line. */
  other: number | null;
  /** log2(seam / other); 0 = no seam effect, 1 = twice the jump at seams. */
  seamIndex: number | null;
  controlIndex: number | null;
};

export type SeamStatisticName = "register" | "density" | "pitchClasses" | "leap" | "cut";

export type TrackSeamReport = {
  id: string;
  family: string;
  seamIndex: number | null;
  controlIndex: number | null;
  excess: number | null;
  statistics: Record<SeamStatisticName, SeamStatistic>;
};

export type SeamArtefacts = {
  score: number | null;
  /** Mean seam index across tracks (each track: mean across its statistics). */
  seamIndex: number | null;
  /** Mean control index — the same measure on the offset grid. */
  controlIndex: number | null;
  /** Mean over tracks of (seamIndex − controlIndex): what the window grid has that phrase structure does not. */
  excess: number | null;
  /** The worst track's excess. One pasted part is enough to break an arrangement. */
  worstExcess: number | null;
  worstTrack: string | null;
  /** Pooled statistics over all measured tracks, for reading. */
  statistics: Record<SeamStatisticName, SeamStatistic>;
  perTrack: TrackSeamReport[];
  tracksMeasured: number;
  seamsMeasured: number;
};

export type CoherenceReport = {
  version: typeof COHERENCE_METRIC_VERSION;
  barCount: number;
  trackCount: number;
  windowBars: number;
  score: number | null;
  components: {
    seamArtefacts: SeamArtefacts & { weight: number };
    harmonicAgreement: {
      score: number | null;
      meanOverlap: number | null;
      worstOverlap: number | null;
      worstTrack: string | null;
      perTrack: Array<{ id: string; overlap: number; bars: number }>;
      weight: number;
    };
    instrumentationContinuity: {
      score: number | null;
      reentries: number;
      unexplained: number;
      explainedByBoundary: number;
      explainedByEnsemble: number;
      unexplainedPer32Bars: number | null;
      weight: number;
    };
    trajectorySmoothness: {
      score: number | null;
      registerRoughness: number | null;
      densityRoughness: number | null;
      planAdherence: { spearman: number; sections: number } | null;
      weight: number;
    };
    motifRecurrence: { score: number | null; meanQuotedShare: number | null; crossSectionRecurrence: number | null; weight: number };
  };
  form: { formString: string; sections: number; repeatedSectionShare: number; diagonalRepeatShare: number };
  limits: string[];
};

/**
 * Calibration, set on one look at 100 human multitrack PDMX scores (≥ 3
 * tracks, ≥ 32 bars) before any synthetic comparison: seam excess had median
 * 0.02 and p90 0.34; harmonic overlap median 0.42 (p10 0.26, p90 0.55);
 * roughness median ≈ 0.7; mean quoted share median 0.125 (p75 0.25).
 */
export const CALIBRATION = {
  /**
   * Blended seam excess (½ mean over tracks + ½ worst track, log2 ratio) at
   * which the seam score reaches 0. The blend had human median ≈ 0.25 and
   * p90 ≈ 1.1.
   */
  seamExcessAtZero: 1.5,
  /** Harmonic overlap mapped linearly from this (score 0) … */
  overlapAtZero: 0.15,
  /** … to this (score 100). */
  overlapAtFull: 0.55,
  /** Roughness (mean |Δ| / std) at which smoothness reaches 0. */
  roughnessAtZero: 2.0,
  /** Mean quoted share at which motif recurrence reaches 100. */
  quotedShareAtFull: 0.25,
  /** Minimum absence, in bars, for a return to count as a re-entry. */
  minAbsenceBars: 2,
} as const;

export const WEIGHTS = {
  seamArtefacts: 0.35,
  harmonicAgreement: 0.2,
  instrumentationContinuity: 0.15,
  trajectorySmoothness: 0.15,
  motifRecurrence: 0.15,
} as const;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const round = (v: number | null, digits = 4): number | null => (v === null ? null : Number(v.toFixed(digits)));
const mean = (values: readonly number[]): number | null => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const std = (values: readonly number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values) ?? 0;
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length);
};

const EPS = 1e-3;
const logRatio = (a: number | null, b: number | null): number | null =>
  a === null || b === null ? null : Math.log2((a + EPS) / (b + EPS));

type LineCategory = "seam" | "control" | "other";

function lineCategory(bar: number, windowBars: number): LineCategory {
  if (bar % windowBars === 0) return "seam";
  if (windowBars >= 4 && windowBars % 2 === 0 && bar % windowBars === windowBars / 2) return "control";
  return "other";
}

// ---------------------------------------------------------------------------
// Seam artefacts
// ---------------------------------------------------------------------------

type Jumps = Record<LineCategory, number[]>;
const emptyJumps = (): Jumps => ({ seam: [], control: [], other: [] });

/** Fewer observations than this on a grid, and the ratio is noise, not a seam. */
const MIN_SEAM_SAMPLES = 3;
const MIN_OTHER_SAMPLES = 6;

function statisticFrom(jumps: Jumps): SeamStatistic {
  const seam = jumps.seam.length >= MIN_SEAM_SAMPLES ? mean(jumps.seam) : null;
  const control = jumps.control.length >= MIN_SEAM_SAMPLES ? mean(jumps.control) : null;
  const other = jumps.other.length >= MIN_OTHER_SAMPLES ? mean(jumps.other) : null;
  return {
    seam: round(seam), control: round(control), other: round(other),
    seamIndex: round(logRatio(seam, other)),
    controlIndex: round(logRatio(control, other)),
  };
}

function pcsDistance(a: readonly number[], b: readonly number[]): number {
  let overlap = 0;
  for (let i = 0; i < 12; i += 1) overlap += Math.min(a[i], b[i]);
  return 1 - overlap;
}

/** Highest pitch at each onset of one track: its line, for leap measurement. */
function trackLine(track: FormTrack): Array<{ start: number; pitch: number }> {
  const byOnset = new Map<number, { start: number; pitch: number }>();
  for (const note of track.notes) {
    const key = Number(note.start.toFixed(6));
    const existing = byOnset.get(key);
    if (!existing || note.pitch > existing.pitch) byOnset.set(key, { start: note.start, pitch: note.pitch });
  }
  return [...byOnset.values()].sort((a, b) => a.start - b.start);
}

type StatJumps = Record<SeamStatisticName, Jumps>;
const emptyStatJumps = (): StatJumps => ({ register: emptyJumps(), density: emptyJumps(), pitchClasses: emptyJumps(), leap: emptyJumps(), cut: emptyJumps() });

function summariseStats(stats: StatJumps): { statistics: Record<SeamStatisticName, SeamStatistic>; seamIndex: number | null; controlIndex: number | null } {
  const statistics = {
    register: statisticFrom(stats.register),
    density: statisticFrom(stats.density),
    pitchClasses: statisticFrom(stats.pitchClasses),
    leap: statisticFrom(stats.leap),
    cut: statisticFrom(stats.cut),
  };
  const seamIndices = Object.values(statistics).map((s) => s.seamIndex).filter((v): v is number => v !== null);
  const controlIndices = Object.values(statistics).map((s) => s.controlIndex).filter((v): v is number => v !== null);
  return { statistics, seamIndex: mean(seamIndices), controlIndex: mean(controlIndices) };
}

export function measureSeamArtefacts(input: FormInput, features: readonly BarFeatures[], windowBars: number): SeamArtefacts {
  const barCount = input.barStarts.length;
  const pooled = emptyStatJumps();
  const perTrack: TrackSeamReport[] = [];
  const seamLines = new Set<number>();

  input.tracks.forEach((track, t) => {
    const onsetBars = features.filter((f) => f.perTrack[t].onsets > 0).length;
    if (onsetBars < 8) return;
    const stats = emptyStatJumps();

    for (let b = 1; b < barCount; b += 1) {
      const before = features[b - 1].perTrack[t];
      const after = features[b].perTrack[t];
      const category = lineCategory(b, windowBars);
      if (category === "seam") seamLines.add(b);
      if (before.onsets > 0 || after.onsets > 0) {
        stats.density[category].push(Math.abs(Math.log1p(after.onsets) - Math.log1p(before.onsets)));
      }
      if (!track.isPercussion && before.registerMean !== null && after.registerMean !== null) {
        stats.register[category].push(Math.abs(after.registerMean - before.registerMean) / 12);
        stats.pitchClasses[category].push(pcsDistance(before.pcs, after.pcs));
      }
    }

    // Melodic leap across each bar line the line crosses.
    if (!track.isPercussion) {
      const line = trackLine(track);
      for (let i = 1; i < line.length; i += 1) {
        const from = fractionalBar(input, line[i - 1].start);
        const to = fractionalBar(input, line[i].start);
        if (to - from > 2) continue;
        const firstLine = Math.floor(from) + 1;
        const lastLine = Math.floor(to);
        if (lastLine < firstLine || firstLine >= barCount) continue;
        // A pair crossing several lines is attributed to the strongest category it crosses.
        let category: LineCategory = "other";
        for (let b = firstLine; b <= Math.min(lastLine, barCount - 1); b += 1) {
          const c = lineCategory(b, windowBars);
          if (c === "seam") { category = "seam"; break; }
          if (c === "control") category = "control";
        }
        stats.leap[category].push(Math.abs(line[i].pitch - line[i - 1].pitch));
      }
    }

    // Notes that end exactly on a bar line versus notes that cross it.
    const cuts: Record<LineCategory, { cut: number; crossing: number }> = {
      seam: { cut: 0, crossing: 0 }, control: { cut: 0, crossing: 0 }, other: { cut: 0, crossing: 0 },
    };
    for (const note of track.notes) {
      const from = fractionalBar(input, note.start);
      const to = fractionalBar(input, note.end);
      for (let b = Math.floor(from) + 1; b <= Math.floor(to + 0.02) && b < barCount; b += 1) {
        if (from > b - 0.02) continue;
        const category = lineCategory(b, windowBars);
        if (Math.abs(to - b) <= 0.02) cuts[category].cut += 1;
        else if (to > b + 0.02) cuts[category].crossing += 1;
      }
    }
    for (const category of ["seam", "control", "other"] as const) {
      const { cut, crossing } = cuts[category];
      if (cut + crossing > 0) stats.cut[category].push(cut / (cut + crossing));
    }

    for (const name of Object.keys(stats) as SeamStatisticName[]) {
      for (const category of ["seam", "control", "other"] as const) pooled[name][category].push(...stats[name][category]);
    }
    const summary = summariseStats(stats);
    const trackExcess = summary.seamIndex === null
      ? null
      : summary.controlIndex === null ? summary.seamIndex : summary.seamIndex - summary.controlIndex;
    perTrack.push({
      id: track.id,
      family: track.family,
      seamIndex: round(summary.seamIndex),
      controlIndex: round(summary.controlIndex),
      excess: round(trackExcess),
      statistics: summary.statistics,
    });
  });

  const pooledSummary = summariseStats(pooled);
  const trackExcesses = perTrack.map((tr) => tr.excess).filter((v): v is number => v !== null);
  const measurable = perTrack.length > 0 && seamLines.size >= 2 && trackExcesses.length > 0;
  const excess = measurable ? mean(trackExcesses) : null;
  const worstIndex = trackExcesses.length ? trackExcesses.indexOf(Math.max(...trackExcesses)) : -1;
  const worstExcess = worstIndex >= 0 ? trackExcesses[worstIndex] : null;
  const worstTrack = worstIndex >= 0 ? perTrack.filter((tr) => tr.excess !== null)[worstIndex].id : null;
  // Half the mean, half the worst: a whole ensemble of mild seams and one
  // badly pasted part are both what this component exists to catch.
  const scored = excess === null || worstExcess === null ? null : 0.5 * excess + 0.5 * worstExcess;
  const score = scored === null ? null : 100 * clamp01(1 - Math.max(0, scored) / CALIBRATION.seamExcessAtZero);
  return {
    score: round(score, 2),
    seamIndex: round(mean(perTrack.map((tr) => tr.seamIndex).filter((v): v is number => v !== null))),
    controlIndex: round(mean(perTrack.map((tr) => tr.controlIndex).filter((v): v is number => v !== null))),
    excess: round(excess),
    worstExcess: round(worstExcess),
    worstTrack,
    statistics: pooledSummary.statistics,
    perTrack,
    tracksMeasured: perTrack.length,
    seamsMeasured: seamLines.size,
  };
}

// ---------------------------------------------------------------------------
// Harmonic agreement
// ---------------------------------------------------------------------------

export function measureHarmonicAgreement(
  input: FormInput,
  features: readonly BarFeatures[],
): { meanOverlap: number | null; worstOverlap: number | null; worstTrack: string | null; perTrack: Array<{ id: string; overlap: number; bars: number }> } {
  const byTrack = new Map<number, number[]>();
  for (const f of features) {
    const pitched = f.perTrack
      .map((tr, t) => ({ tr, t }))
      .filter(({ tr, t }) => !input.tracks[t].isPercussion && tr.onsets > 0 && tr.pcs.some((v) => v > 0));
    if (pitched.length < 2) continue;
    for (const { tr, t } of pitched) {
      const others = new Array<number>(12).fill(0);
      for (const o of pitched) if (o.t !== t) o.tr.pcs.forEach((v, i) => { others[i] += v; });
      const total = others.reduce((a, b) => a + b, 0);
      if (total <= 0) continue;
      let overlap = 0;
      for (let i = 0; i < 12; i += 1) overlap += Math.min(tr.pcs[i], others[i] / total);
      byTrack.set(t, [...(byTrack.get(t) ?? []), overlap]);
    }
  }
  // A track heard in fewer than eight shared bars is not measured on its own.
  const perTrack = [...byTrack.entries()]
    .filter(([, values]) => values.length >= 8)
    .map(([t, values]) => ({ id: input.tracks[t].id, overlap: Number((mean(values) ?? 0).toFixed(4)), bars: values.length }));
  const all = [...byTrack.values()].flat();
  const worst = perTrack.length ? perTrack.reduce((a, b) => (b.overlap < a.overlap ? b : a)) : null;
  return {
    meanOverlap: round(mean(all)),
    worstOverlap: worst ? worst.overlap : null,
    worstTrack: worst ? worst.id : null,
    perTrack,
  };
}

// ---------------------------------------------------------------------------
// Instrumentation continuity
// ---------------------------------------------------------------------------

/**
 * A re-entry is explained by a section boundary only when the boundaries were
 * given by the caller (a form or plan the arrangement was written against).
 * A form computed from the same notes would put a boundary exactly where a
 * part glitches back in — the glitch would explain itself — so with an
 * internally computed form only the rest of the ensemble can explain it.
 */
export function measureInstrumentationContinuity(
  input: FormInput,
  features: readonly BarFeatures[],
  boundaryBars: ReadonlySet<number>,
): Omit<CoherenceReport["components"]["instrumentationContinuity"], "weight"> {
  const barCount = features.length;
  const boundaries = boundaryBars;
  let reentries = 0;
  let unexplained = 0;
  let explainedByBoundary = 0;
  let explainedByEnsemble = 0;

  input.tracks.forEach((_track, t) => {
    let everActive = false;
    let absence = 0;
    for (let b = 0; b < barCount; b += 1) {
      const active = features[b].activity[t] === 1;
      if (active) {
        if (everActive && absence >= CALIBRATION.minAbsenceBars) {
          reentries += 1;
          const nearBoundary = boundaries.has(b) || boundaries.has(b - 1) || boundaries.has(b + 1);
          const ensembleMoves = features[b].activity.some((v, other) => other !== t && v !== features[b - 1].activity[other]);
          if (nearBoundary) explainedByBoundary += 1;
          else if (ensembleMoves) explainedByEnsemble += 1;
          else unexplained += 1;
        }
        everActive = true;
        absence = 0;
      } else if (everActive) {
        absence += 1;
      }
    }
  });

  const score = barCount === 0 ? null : 100 * (1 - (reentries ? unexplained / reentries : 0));
  return {
    score: round(score, 2),
    reentries,
    unexplained,
    explainedByBoundary,
    explainedByEnsemble,
    unexplainedPer32Bars: barCount ? round((unexplained * 32) / barCount) : null,
  };
}

// ---------------------------------------------------------------------------
// Trajectory smoothness
// ---------------------------------------------------------------------------

function spearman(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length;
  if (n < 3 || b.length !== n) return null;
  const ranks = (values: readonly number[]): number[] => {
    const order = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
    const out = new Array<number>(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && order[j + 1].v === order[i].v) j += 1;
      const rank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k += 1) out[order[k].i] = rank;
      i = j + 1;
    }
    return out;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = (mean(ra) ?? 0);
  const mb = (mean(rb) ?? 0);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

export function measureTrajectorySmoothness(
  features: readonly BarFeatures[],
  form: FormAnalysis,
  plan: SectionPlanTarget[] | undefined,
): Omit<CoherenceReport["components"]["trajectorySmoothness"], "weight"> {
  const boundaries = new Set(form.sections.slice(1).map((s) => s.startBar));
  const registers = features.map((f) => f.registerMean);
  const densities = features.map((f) => Math.log1p(f.onsets));

  const roughness = (series: ReadonlyArray<number | null>): number | null => {
    const present = series.filter((v): v is number => v !== null);
    if (present.length < 8) return null;
    const spread = std(present);
    const deltas: number[] = [];
    for (let b = 1; b < series.length; b += 1) {
      if (boundaries.has(b)) continue;
      const before = series[b - 1];
      const after = series[b];
      if (before === null || after === null) continue;
      deltas.push(Math.abs(after - before));
    }
    const m = mean(deltas);
    if (m === null) return null;
    return spread > 1e-9 ? m / spread : 0;
  };
  const registerRoughness = roughness(registers);
  const densityRoughness = roughness(densities);
  const roughnessValues = [registerRoughness, densityRoughness].filter((v): v is number => v !== null);
  const roughnessScore = roughnessValues.length
    ? 100 * clamp01(1 - (mean(roughnessValues) ?? 0) / CALIBRATION.roughnessAtZero)
    : null;

  let planAdherence: { spearman: number; sections: number } | null = null;
  if (plan && plan.length >= 3) {
    const measured = plan.map((target) => {
      const slice = features.slice(Math.max(0, target.startBar), Math.min(features.length, target.endBar));
      return mean(slice.map((f) => f.onsets)) ?? 0;
    });
    const rho = spearman(plan.map((t) => t.density), measured);
    if (rho !== null) planAdherence = { spearman: Number(rho.toFixed(4)), sections: plan.length };
  }
  const parts = [roughnessScore, planAdherence ? 50 * (1 + planAdherence.spearman) : null].filter((v): v is number => v !== null);
  return {
    score: round(mean(parts), 2),
    registerRoughness: round(registerRoughness),
    densityRoughness: round(densityRoughness),
    planAdherence,
  };
}

// ---------------------------------------------------------------------------
// The metric
// ---------------------------------------------------------------------------

export function measureCoherence(input: FormInput, options: CoherenceOptions = {}): CoherenceReport {
  const windowBars = options.windowBars ?? 8;
  const limits: string[] = [
    "calibration constants were set on the human distribution of real PDMX scores, not fitted to the synthetic contrast",
  ];
  const barCount = input.barStarts.length;
  const features = computeBarFeatures(input);
  const form = options.form ?? segmentForm(input, options.formOptions);

  const seam = measureSeamArtefacts(input, features, windowBars);
  if (seam.score === null) limits.push(`seam artefacts not measurable: ${seam.tracksMeasured} tracks with ≥ 8 playing bars, ${seam.seamsMeasured} window lines`);

  const harmonic = measureHarmonicAgreement(input, features);
  const overlapToScore = (overlap: number): number =>
    100 * clamp01((overlap - CALIBRATION.overlapAtZero) / (CALIBRATION.overlapAtFull - CALIBRATION.overlapAtZero));
  // As with seams: half the ensemble mean, half the least agreeing part.
  const harmonicScore = harmonic.meanOverlap === null
    ? null
    : harmonic.worstOverlap === null
      ? overlapToScore(harmonic.meanOverlap)
      : 0.5 * overlapToScore(harmonic.meanOverlap) + 0.5 * overlapToScore(harmonic.worstOverlap);
  if (harmonicScore === null) limits.push("harmonic agreement needs two pitched tracks sounding in the same bar");

  const givenBoundaries = new Set<number>([
    ...(options.form ? options.form.sections.slice(1).map((s) => s.startBar) : []),
    ...(options.plan ? options.plan.slice(1).map((t) => t.startBar) : []),
  ]);
  const continuity = measureInstrumentationContinuity(input, features, givenBoundaries);
  if (!options.form && !options.plan) limits.push("no form or plan given: a re-entry is explained only by the rest of the ensemble moving with it");
  const trajectory = measureTrajectorySmoothness(features, form, options.plan);
  if (!options.plan) limits.push("no section plan given: trajectory smoothness is roughness only, plan adherence not measured");

  const quoted = form.motifs.meanQuotedShare;
  const motifScore = quoted === null ? null : 100 * clamp01(quoted / CALIBRATION.quotedShareAtFull);
  if (motifScore === null) limits.push("motif recurrence needs at least two sections");

  const components: CoherenceReport["components"] = {
    seamArtefacts: { ...seam, weight: WEIGHTS.seamArtefacts },
    harmonicAgreement: { score: round(harmonicScore, 2), ...harmonic, weight: WEIGHTS.harmonicAgreement },
    instrumentationContinuity: { ...continuity, weight: WEIGHTS.instrumentationContinuity },
    trajectorySmoothness: { ...trajectory, weight: WEIGHTS.trajectorySmoothness },
    motifRecurrence: { score: round(motifScore, 2), meanQuotedShare: quoted, crossSectionRecurrence: form.motifs.crossSectionRecurrence, weight: WEIGHTS.motifRecurrence },
  };

  let weighted = 0;
  let weightSum = 0;
  for (const component of Object.values(components)) {
    if (component.score === null) continue;
    weighted += component.score * component.weight;
    weightSum += component.weight;
  }
  return {
    version: COHERENCE_METRIC_VERSION,
    barCount,
    trackCount: input.tracks.length,
    windowBars,
    score: weightSum > 0 ? Number((weighted / weightSum).toFixed(2)) : null,
    components,
    form: {
      formString: form.formString,
      sections: form.sections.length,
      repeatedSectionShare: form.repeatedSectionShare,
      diagonalRepeatShare: form.diagonalRepeatShare,
    },
    limits,
  };
}

// ---------------------------------------------------------------------------
// Synthetic "pasted windows" constructions, for validation
// ---------------------------------------------------------------------------

function xorshift(seed: number): () => number {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** A non-identity permutation of 0..n-1, deterministic in `seed`. */
export function windowPermutation(n: number, seed: number): number[] {
  const perm = Array.from({ length: n }, (_, i) => i);
  if (n < 2) return perm;
  const rand = xorshift(seed);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  if (perm.every((v, i) => v === i)) perm.push(perm.shift() as number);
  return perm;
}

function moveTrackWindows(input: FormInput, track: FormTrack, perm: readonly number[], windowBars: number): FormTrack {
  const fullWindows = perm.length;
  const notes = track.notes.map((note) => {
    const from = fractionalBar(input, note.start);
    const w = Math.floor(from / windowBars);
    if (w >= fullWindows) return { ...note };
    const shift = (perm[w] - w) * windowBars;
    const newStart = from + shift;
    const windowEnd = (perm[w] + 1) * windowBars;
    // A window's generator cannot write past its window: a note that crossed
    // the old window's end is cut at the new one.
    const newEnd = Math.min(fractionalBar(input, note.end) + shift, windowEnd);
    return {
      ...note,
      start: timeAtFractionalBar(input, newStart),
      end: Math.max(timeAtFractionalBar(input, newStart) + 1e-6, timeAtFractionalBar(input, newEnd)),
    };
  });
  return { ...track, notes: notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch) };
}

/**
 * One track's windows shuffled: every other part stays as the human wrote it,
 * so the piece is exactly as coherent as before except for that part.
 */
export function shuffleTrackWindows(
  input: FormInput,
  trackIndex: number,
  windowBars: number,
  seed: number,
): { input: FormInput; permutation: number[] } {
  const fullWindows = Math.floor(input.barStarts.length / windowBars);
  const permutation = windowPermutation(fullWindows, seed);
  return {
    input: {
      ...input,
      tracks: input.tracks.map((track, t) => (t === trackIndex ? moveTrackWindows(input, track, permutation, windowBars) : track)),
    },
    permutation,
  };
}

/**
 * Every track's windows shuffled by the same permutation: each window is
 * internally exactly what the human wrote, across all parts — the case of a
 * generator that writes good windows in no musical order.
 */
export function shuffleEnsembleWindows(input: FormInput, windowBars: number, seed: number): { input: FormInput; permutation: number[] } {
  const fullWindows = Math.floor(input.barStarts.length / windowBars);
  const permutation = windowPermutation(fullWindows, seed);
  return {
    input: { ...input, tracks: input.tracks.map((track) => moveTrackWindows(input, track, permutation, windowBars)) },
    permutation,
  };
}
