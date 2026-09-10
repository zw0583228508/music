/**
 * Positive-control harness for the critic dimensions (B-05a).
 *
 * Runs every dimension over every anchor × control and emits the detection
 * table: for each (dimension, control) the number of applicable items, how
 * many the dimension detected (score dropped and a located observation
 * appeared — `detect` in `dimensions/anchors.ts`), the rate, its exact
 * Clopper–Pearson 95 % interval (`listeningSensitivity.exactBinomialCi`) and
 * the mean score drop. Controls are the PR-77 symbolic corruption families
 * (one part at a time, `family@severity`) and the purpose-built arrangement
 * worsenings; a control may name a preparation (`+develop_chorus_2`) when the
 * reference composer already sits at the floor of the dimension being tested.
 *
 * The ledger (`dimensions/controlLedger.ts`) is derived from this table and
 * nothing else. **B-05c: the derivation itself now lives in one place** —
 * `critics/sensitivity.ts`, whose thresholds are `SENSITIVITY_GATE`'s own, so
 * this harness, `critics/adversarial/controls.ts` and B-08's
 * `positiveControlLedger.ts` read one rule instead of three (R-1a P1-3). Under
 * that rule a prepared control (`control+preparation` — one that writes the
 * gesture it then erases) can inform but never gate, and a dimension needs two
 * independent claimed transforms to gate.
 * "Claimed" means the dimension's author says it should hear that damage; the
 * table still reports every control against every dimension, so the reviewer
 * can see cross-sensitivity and what a dimension hears that it did not claim.
 *
 * Program charter rule 3: the ledger is what lets a dimension gate; B-05c's
 * `critics/rank.ts` and the judge read it, and nothing else may write it.
 */
import { CORRUPTION_FAMILIES, CORRUPTION_FAMILY_NAMES, type CorruptionFamily, type CorruptionSeverity } from "../symbolicCorruptions";
import { exactBinomialCi } from "../listeningSensitivity";
import { deriveStatus, SENSITIVITY_RULE, type TransformMeasurement } from "./sensitivity";
import type { CriticDimensionReport } from "./types";
import { ALL_DIMENSIONS, DIMENSION_NAMES } from "./dimensions/index";
import {
  anchors,
  applyFamilyCorruption,
  applyPreparation,
  applyPurposeBuilt,
  CLEAN_ANCHOR_IDS,
  DEFECT_ANCHOR_REASONS,
  detect,
  eligibleParts,
  FIXED_ANCHOR_DEFECTS,
  PREPARATIONS,
  PREPARED_CONTROLS,
  PURPOSE_BUILT,
  PURPOSE_BUILT_ANCHOR_IDS,
  PURPOSE_BUILT_NAMES,
  type Anchor,
  type Worsened,
} from "./dimensions/anchors";
import type { LedgerEntry } from "./sensitivity";

/**
 * v3 (B-05c): one shared sensitivity rule (`critics/sensitivity.ts`), prepared
 * controls never gate, two independent transforms required, `minTrials` raised
 * from 5 to `SENSITIVITY_GATE.minVotesPerRung`. The anchor set gains four
 * purpose-built transforms so the dimensions that should gate can earn a
 * second, independent one instead of losing their status to the new clause.
 */
export const CONTROL_HARNESS_VERSION = "B05C_CONTROLS_v3" as const;

/**
 * Controls each dimension claims to hear. The table measures every control
 * regardless. Recalibrated at the merge: voiceLeading no longer claims
 * `random_pitch` (measured 2/8 — a random line with steps ≤ 7 is smoother
 * than the reference bass, so voiceLeading scores it *higher*; harmony catches
 * the probe); groove claims the drum-fill erasure on its own and on the
 * prepared anchors; transitions claims the prepared erasure too.
 */
export const CLAIMED_CONTROLS: Record<string, string[]> = {
  harmony: ["chord_tone_to_non_chord_tone@3", "pitch_shift_out_of_key@3", "cross_part_clash@3", "duration_overhang@3", "random_pitch", "parallel_perfect_motion"],
  voiceLeading: ["parallel_doubling@3", "bass_roots_only_leaps", "parallel_perfect_motion"],
  melodyAndCounterline: ["top_line_into_vocal_register", "top_line_erratic", "counterline_into_bed_register"],
  motifRecurrenceAndDevelopment: ["motif_destruction@3", "random_pitch", "homorhythm"],
  groove: ["onset_jitter@3", "quantisation_coarsening@3", "phrase_shift@3", "erase_drum_fills", "erase_boundary_events+realise_boundaries", "displace_backbeat", "unlock_bass_from_kick"],
  rhythmicInteraction: ["homorhythm", "parallel_doubling@3", "unlock_bass_from_kick"],
  orchestration: ["drums_only", "silence_planned_family", "tutti_everywhere"],
  idiomaticity: ["piano_wide_voicing", "brass_hold_forever", "density_doubling@3", "parallel_perfect_motion"],
  register: ["strings_up_two_octaves", "octave_displacement@3", "role_inversion@3", "top_line_into_vocal_register", "counterline_into_bed_register"],
  density: ["piano_one_note_per_bar", "chorus_thinner_than_verse", "density_thinning@3", "tutti_everywhere", "arrival_thinned_and_softened", "strip_bed_to_top_voice"],
  transitions: ["erase_boundary_events", "erase_boundary_events+realise_boundaries", "section_swap@3"],
  repetitionVsVariation: ["bar_copy_repetition@3", "chorus_copy", "chorus_copy+develop_chorus_2"],
  sectionDevelopment: ["chorus_copy+develop_chorus_2", "section_swap@3", "arrival_thinned_and_softened"],
  playability: ["octave_displacement@3", "bass_roots_only_leaps", "strings_up_two_octaves", "piano_wide_voicing"],
  performanceRealisation: ["velocity_flatten_all", "dynamics_flattening@3", "strip_cc_and_quantise", "arrival_thinned_and_softened"],
  emotionalArcAndTension: ["swap_climax_with_quietest", "flatten_arc", "arrival_thinned_and_softened"],
};

export const LEDGER_SEVERITY: CorruptionSeverity = 3;
export const DEFAULT_SEEDS: readonly number[] = [1];

export type ControlItem = {
  control: string;
  anchorId: string;
  detail: string;
  /** Per dimension: detected, score before/after, new observation kinds. */
  results: Record<string, { detected: boolean; before: number | null; after: number | null; kinds: string[] }>;
};

export type TableRow = {
  dimension: string;
  control: string;
  claimed: boolean;
  n: number;
  detected: number;
  rate: number | null;
  ci95: [number, number] | null;
  meanScoreDrop: number | null;
};

export type HarnessResult = {
  version: typeof CONTROL_HARNESS_VERSION;
  anchors: Array<{ id: string; genre: string; composer: string; tracks: string[]; notes: number; clean: boolean; purposeBuilt: boolean; defectReason: string | null; fixedDefect: string | null }>;
  controls: Array<{ control: string; kind: "family" | "purpose_built"; description: string; prepare: string | null }>;
  items: ControlItem[];
  table: TableRow[];
  ledger: Record<string, LedgerEntry>;
  anchorReports: Array<{ anchorId: string; dimension: string; score: number | null; applicable: boolean; blocking: number; major: number; minor: number; kinds: string[] }>;
};

export type HarnessOptions = {
  anchorIds?: readonly string[];
  severities?: readonly CorruptionSeverity[];
  seeds?: readonly number[];
  /** Skip the symbolic corruption families (purpose-built only). */
  familiesOff?: boolean;
  /** Progress callback (item count). */
  onProgress?: (done: number, total: number) => void;
};

export function controlName(family: CorruptionFamily, severity: CorruptionSeverity): string {
  return `${family}@${severity}`;
}

export function parseControl(name: string): { base: string; prepare: string | null; family: CorruptionFamily | null; severity: CorruptionSeverity | null } {
  const [withSeverity, prepare = null] = name.split("+");
  const [base, sev] = withSeverity.split("@");
  const family = (CORRUPTION_FAMILY_NAMES as readonly string[]).includes(base) ? (base as CorruptionFamily) : null;
  return { base, prepare, family, severity: sev ? (Number(sev) as CorruptionSeverity) : null };
}

const reportCache = new WeakMap<object, CriticDimensionReport[]>();
function evaluateAll(input: Anchor["input"]): CriticDimensionReport[] {
  const cached = reportCache.get(input);
  if (cached) return cached;
  const reports = ALL_DIMENSIONS.map((d) => d.evaluate(input));
  reportCache.set(input, reports);
  return reports;
}

function itemFor(control: string, anchor: Anchor, worsened: Worsened): ControlItem {
  const results: ControlItem["results"] = {};
  for (const dimension of ALL_DIMENSIONS) {
    const d = detect(dimension, anchor.input, worsened);
    results[dimension.dimension] = {
      detected: d.detected,
      before: d.before.summary.score0to100,
      after: d.after.summary.score0to100,
      kinds: [...new Set(d.newObservations.map((o) => o.kind))].sort(),
    };
  }
  return { control, anchorId: anchor.id, detail: worsened.detail, results };
}

export function runControlHarness(options: HarnessOptions = {}): HarnessResult {
  const severities = options.severities ?? [LEDGER_SEVERITY];
  const seeds = options.seeds ?? DEFAULT_SEEDS;
  const baseAnchors = anchors(options.anchorIds);
  const items: ControlItem[] = [];
  const controls: HarnessResult["controls"] = [];

  // Plan the work so progress can be reported.
  type Job = () => ControlItem | null;
  const jobs: Job[] = [];
  if (!options.familiesOff) {
    for (const family of CORRUPTION_FAMILY_NAMES) {
      for (const severity of severities) {
        const name = controlName(family, severity);
        controls.push({ control: name, kind: "family", description: `${CORRUPTION_FAMILIES[family].description} (${CORRUPTION_FAMILIES[family].severity})`, prepare: null });
        for (const anchor of baseAnchors) {
          for (const part of eligibleParts(anchor, family)) {
            for (const seed of seeds) {
              jobs.push(() => {
                const worsened = applyFamilyCorruption(anchor, part.id, family, severity, seed);
                return worsened ? itemFor(name, anchor, worsened) : null;
              });
            }
          }
        }
      }
    }
  }
  const purposeControls = [...PURPOSE_BUILT_NAMES, ...Object.keys(PREPARED_CONTROLS).sort().flatMap((prep) => PREPARED_CONTROLS[prep].map((c) => `${c}+${prep}`))];
  for (const name of purposeControls) {
    const { base, prepare } = parseControl(name);
    controls.push({ control: name, kind: "purpose_built", description: PURPOSE_BUILT[base].description + (prepare ? ` — applied to an anchor prepared by ${prepare}: ${PREPARATIONS[prepare].description}` : ""), prepare });
    for (const anchor of baseAnchors.filter((a) => PURPOSE_BUILT_ANCHOR_IDS.includes(a.id))) {
      jobs.push(() => {
        const prepared = prepare ? applyPreparation(anchor, prepare) : anchor;
        if (!prepared) return null;
        const worsened = applyPurposeBuilt(prepared, base);
        return worsened ? itemFor(name, prepared, worsened) : null;
      });
    }
  }

  jobs.forEach((job, index) => {
    const item = job();
    if (item) items.push(item);
    options.onProgress?.(index + 1, jobs.length);
  });

  const table = buildTable(items, controls.map((c) => c.control));
  const anchorReports: HarnessResult["anchorReports"] = [];
  for (const anchor of baseAnchors) {
    for (const report of evaluateAll(anchor.input)) {
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
  }
  const ledger = deriveLedger(table, anchorReports);
  return {
    version: CONTROL_HARNESS_VERSION,
    anchors: baseAnchors.map((a) => ({
      id: a.id, genre: a.genre, composer: a.composer, tracks: a.input.trackModels.map((t) => t.id),
      notes: a.input.trackModels.reduce((s, t) => s + t.notes.length, 0),
      clean: CLEAN_ANCHOR_IDS.includes(a.id), purposeBuilt: PURPOSE_BUILT_ANCHOR_IDS.includes(a.id), defectReason: DEFECT_ANCHOR_REASONS[a.id] ?? null, fixedDefect: FIXED_ANCHOR_DEFECTS[a.id] ?? null,
    })),
    controls,
    items,
    table,
    ledger,
    anchorReports,
  };
}

export function buildTable(items: readonly ControlItem[], controlOrder: readonly string[]): TableRow[] {
  const rows: TableRow[] = [];
  for (const dimension of DIMENSION_NAMES) {
    const claimed = new Set(CLAIMED_CONTROLS[dimension] ?? []);
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

/** B-05c: the shared rule's `minTrials`, kept as a named export for the tests that assert the rule is one rule. */
export const MIN_ITEMS_FOR_STATUS = SENSITIVITY_RULE.minTrials;

/** A control that names a preparation writes the gesture it then erases; it can inform, never gate. */
export const isPreparedControl = (control: string): boolean => control.includes("+");

export function deriveLedger(table: readonly TableRow[], anchorReports: HarnessResult["anchorReports"]): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  for (const dimension of DIMENSION_NAMES) {
    const clean = anchorReports.filter((r) => r.dimension === dimension && CLEAN_ANCHOR_IDS.includes(r.anchorId));
    const cleanBlocking = clean.length ? Number((clean.filter((r) => r.blocking > 0).length / clean.length).toFixed(4)) : null;
    const measurements: TransformMeasurement[] = table
      .filter((r) => r.dimension === dimension)
      .map((r) => ({ control: r.control, claimed: r.claimed, prepared: isPreparedControl(r.control), n: r.n, detected: r.detected, rate: r.rate, ci95: r.ci95 }));
    ledger[dimension] = deriveStatus({ dimension, measurements, cleanAnchorBlockingRate: cleanBlocking });
  }
  return ledger;
}

/** The TypeScript source of `dimensions/controlLedger.ts` for a ledger. */
export function renderLedgerSource(ledger: Record<string, LedgerEntry>, ledgerVersion: string): string {
  const entries = Object.keys(ledger).sort().map((dimension) => {
    const e = ledger[dimension];
    return `  ${dimension}: { status: ${JSON.stringify(e.status)}, strongestControl: ${JSON.stringify(e.strongestControl)}, detectionRate: ${e.detectionRate}, ci95: ${e.ci95 ? `[${e.ci95[0]}, ${e.ci95[1]}]` : "null"}, n: ${e.n}, cleanAnchorBlockingRate: ${e.cleanAnchorBlockingRate}, gatingTransforms: ${JSON.stringify(e.gatingTransforms)}, reason: ${JSON.stringify(e.reason)} },`;
  });
  return [
    "/**",
    " * Control ledger — GENERATED by `critics/controls.ts` (`renderLedgerSource`).",
    " * Do not edit by hand: `controls.test.ts` regenerates the table from the",
    " * anchors × controls run and fails when this file disagrees with it, so a",
    " * dimension's `controlStatus` can only come from a measured detection rate.",
    " *",
    ` * Derived from severity ${LEDGER_SEVERITY} of every corruption family, seed(s) ${DEFAULT_SEEDS.join(",")},`,
    " * and every purpose-built worsening, over the eight in-song benchmark anchors",
    " * (ethnic-vocal overflows the song; the owner's song is an anchor but not a",
    " * control target — see `dimensions/anchors.ts`).",
    " *",
    " * The status rule is `critics/sensitivity.ts` — the one rule shared with the",
    " * adversarial harness and B-08's ledger. `gatingTransforms` names the",
    " * independent, non-prepared transforms that earned a `gated` status;",
    " * `reason` says why a dimension is not gated.",
    " */",
    "import type { LedgerEntry } from \"../sensitivity\";",
    "",
    "export type { LedgerEntry };",
    "",
    `export const CONTROL_LEDGER_VERSION = ${JSON.stringify(ledgerVersion)} as const;`,
    "",
    "export const CONTROL_LEDGER: Record<string, LedgerEntry> = {",
    ...entries,
    "};",
    "",
  ].join("\n");
}

/** Compact summary for the tracker and the final report. */
export function summariseLedger(ledger: Record<string, LedgerEntry>): string[] {
  return Object.keys(ledger).sort().map((d) => {
    const e = ledger[d];
    const strongest = e.strongestControl ? ` (${e.strongestControl} ${Math.round((e.detectionRate ?? 0) * 100)} % [${e.ci95?.[0]}, ${e.ci95?.[1]}], n=${e.n})` : "";
    const gates = e.gatingTransforms.length ? ` gated by ${e.gatingTransforms.join(" + ")}` : ` — ${e.reason}`;
    return `${d}: ${e.status}${strongest}${gates}`;
  });
}
