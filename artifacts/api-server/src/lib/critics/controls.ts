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
 * nothing else: a dimension's `controlStatus` is
 *   gated        strongest claimed control detected ≥ 90 % with CI lower bound
 *                ≥ 60 %, and no blocking observation on any clean anchor;
 *   informing    strongest claimed control ≥ 50 %;
 *   demoted      claimed controls measured (n ≥ 5) and none reaches 50 %;
 *   uncalibrated no claimed control could be measured on the anchors.
 * "Claimed" means the dimension's author says it should hear that damage; the
 * table still reports every control against every dimension, so the reviewer
 * can see cross-sensitivity and what a dimension hears that it did not claim.
 *
 * Program charter rule 3: none of this makes a dimension gate anything today —
 * B-00 / B-06 read the ledger when they wire the critics in.
 */
import { CORRUPTION_FAMILIES, CORRUPTION_FAMILY_NAMES, type CorruptionFamily, type CorruptionSeverity } from "../symbolicCorruptions";
import { exactBinomialCi } from "../listeningSensitivity";
import type { CriticDimensionReport, ControlStatus } from "./types";
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
  PREPARATIONS,
  PURPOSE_BUILT,
  PURPOSE_BUILT_ANCHOR_IDS,
  PURPOSE_BUILT_NAMES,
  type Anchor,
  type Worsened,
} from "./dimensions/anchors";
import type { LedgerEntry } from "./dimensions/controlLedger";

export const CONTROL_HARNESS_VERSION = "B05A_CONTROLS_v1" as const;

/** Controls each dimension claims to hear. The table measures every control regardless. */
export const CLAIMED_CONTROLS: Record<string, string[]> = {
  harmony: ["chord_tone_to_non_chord_tone@3", "pitch_shift_out_of_key@3", "cross_part_clash@3", "duration_overhang@3", "random_pitch"],
  voiceLeading: ["parallel_doubling@3", "bass_roots_only_leaps", "random_pitch"],
  melodyAndCounterline: ["top_line_into_vocal_register", "top_line_erratic"],
  motifRecurrenceAndDevelopment: ["motif_destruction@3", "random_pitch", "homorhythm"],
  groove: ["onset_jitter@3", "quantisation_coarsening@3", "phrase_shift@3", "erase_boundary_events"],
  rhythmicInteraction: ["homorhythm", "parallel_doubling@3"],
  orchestration: ["drums_only", "silence_planned_family", "tutti_everywhere"],
  idiomaticity: ["piano_wide_voicing", "brass_hold_forever", "density_doubling@3"],
  register: ["strings_up_two_octaves", "octave_displacement@3", "role_inversion@3", "top_line_into_vocal_register"],
  density: ["piano_one_note_per_bar", "chorus_thinner_than_verse", "density_thinning@3", "tutti_everywhere"],
  transitions: ["erase_boundary_events", "section_swap@3"],
  repetitionVsVariation: ["bar_copy_repetition@3", "chorus_copy", "chorus_copy+develop_chorus_2"],
  sectionDevelopment: ["chorus_copy+develop_chorus_2", "section_swap@3"],
  playability: ["octave_displacement@3", "bass_roots_only_leaps", "strings_up_two_octaves", "piano_wide_voicing"],
  performanceRealisation: ["velocity_flatten_all", "dynamics_flattening@3", "strip_cc_and_quantise"],
  emotionalArcAndTension: ["swap_climax_with_quietest", "flatten_arc"],
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
  anchors: Array<{ id: string; genre: string; composer: string; tracks: string[]; notes: number; clean: boolean; purposeBuilt: boolean; defectReason: string | null }>;
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
  const purposeControls = [...PURPOSE_BUILT_NAMES, ...Object.keys(PREPARATIONS).sort().flatMap((prep) => ["chorus_copy"].map((c) => `${c}+${prep}`))];
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
      clean: CLEAN_ANCHOR_IDS.includes(a.id), purposeBuilt: PURPOSE_BUILT_ANCHOR_IDS.includes(a.id), defectReason: DEFECT_ANCHOR_REASONS[a.id] ?? null,
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

export const MIN_ITEMS_FOR_STATUS = 5;

export function deriveLedger(table: readonly TableRow[], anchorReports: HarnessResult["anchorReports"]): Record<string, LedgerEntry> {
  const ledger: Record<string, LedgerEntry> = {};
  for (const dimension of DIMENSION_NAMES) {
    const clean = anchorReports.filter((r) => r.dimension === dimension && CLEAN_ANCHOR_IDS.includes(r.anchorId));
    const cleanBlocking = clean.length ? Number((clean.filter((r) => r.blocking > 0).length / clean.length).toFixed(4)) : null;
    const claimed = table.filter((r) => r.dimension === dimension && r.claimed && r.n >= MIN_ITEMS_FOR_STATUS && r.rate !== null);
    if (!claimed.length) {
      ledger[dimension] = { status: "uncalibrated", strongestControl: null, detectionRate: null, ci95: null, n: 0, cleanAnchorBlockingRate: cleanBlocking };
      continue;
    }
    const strongest = [...claimed].sort((a, b) => (b.rate! - a.rate!) || (b.ci95![0] - a.ci95![0]) || a.control.localeCompare(b.control))[0];
    let status: ControlStatus;
    if (strongest.rate! >= 0.9 && strongest.ci95![0] >= 0.6 && cleanBlocking === 0) status = "gated";
    else if (strongest.rate! >= 0.5) status = "informing";
    else status = "demoted";
    ledger[dimension] = {
      status,
      strongestControl: strongest.control,
      detectionRate: strongest.rate,
      ci95: strongest.ci95,
      n: strongest.n,
      cleanAnchorBlockingRate: cleanBlocking,
    };
  }
  return ledger;
}

/** The TypeScript source of `dimensions/controlLedger.ts` for a ledger. */
export function renderLedgerSource(ledger: Record<string, LedgerEntry>, ledgerVersion: string): string {
  const entries = Object.keys(ledger).sort().map((dimension) => {
    const e = ledger[dimension];
    return `  ${dimension}: { status: ${JSON.stringify(e.status)}, strongestControl: ${JSON.stringify(e.strongestControl)}, detectionRate: ${e.detectionRate}, ci95: ${e.ci95 ? `[${e.ci95[0]}, ${e.ci95[1]}]` : "null"}, n: ${e.n}, cleanAnchorBlockingRate: ${e.cleanAnchorBlockingRate} },`;
  });
  return [
    "/**",
    " * Control ledger — GENERATED by `critics/controls.ts` (`renderLedgerSource`).",
    " * Do not edit by hand: `controls.test.ts` regenerates the table from the",
    " * anchors × controls run and fails when this file disagrees with it, so a",
    " * dimension's `controlStatus` can only come from a measured detection rate.",
    " *",
    ` * Derived from severity ${LEDGER_SEVERITY} of every corruption family, seed(s) ${DEFAULT_SEEDS.join(",")},`,
    " * and every purpose-built worsening, over the nine benchmark anchors.",
    " */",
    "import type { ControlStatus } from \"../types\";",
    "",
    "export type LedgerEntry = {",
    "  status: ControlStatus;",
    "  /** The control with the highest detection rate among the dimension's claimed controls. */",
    "  strongestControl: string | null;",
    "  detectionRate: number | null;",
    "  ci95: [number, number] | null;",
    "  n: number;",
    "  /** Blocking observations raised on clean anchors, per anchor evaluated. */",
    "  cleanAnchorBlockingRate: number | null;",
    "};",
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
    return `${d}: ${e.status}${e.strongestControl ? ` (${e.strongestControl} ${Math.round((e.detectionRate ?? 0) * 100)} % [${e.ci95?.[0]}, ${e.ci95?.[1]}], n=${e.n})` : ""}`;
  });
}
