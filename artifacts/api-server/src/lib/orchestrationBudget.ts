/**
 * Orchestration Budget Engine (PR-06).
 *
 * Teaches the arranger not to play too much at once. For every planning window
 * it produces density / melodic / rhythmic / harmonic / register / spectral /
 * attention budgets driven by how much the lead is holding the listener, and a
 * per-bar register-occupancy map that flags overcrowding and prescribes the
 * fix (drop an octave, raise an octave, simplify, thin the voicing).
 *
 * Deterministic and pure. Reads the section/phrase plan (PR-05) and the vocal
 * arrangement-space map (PR-03).
 */
import { createHash } from "node:crypto";
import type {
  OrchestrationBudgetPlan,
  OrchestrationBudgetWindow,
  OrchestrationInstrumentAdjustment,
  RegisterBand,
  RegisterOccupancySpan,
  SectionPhrasePlan,
  SongModelData,
  SongModelMusicalMap,
} from "@workspace/db";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

export const ORCHESTRATION_BUDGET_VERSION = "1.0" as const;
const METHOD = "orchestration-budget-engine/v1";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

const REGISTER_ORDER: RegisterBand[] = ["low", "low_mid", "mid", "upper_mid", "high"];

const FAMILY_BAND: Record<string, RegisterBand> = {
  bass: "low", drums: "low_mid", percussion: "mid", keys: "mid",
  guitar: "mid", synth: "mid", pads: "upper_mid", strings: "upper_mid",
  brass: "upper_mid", winds: "high", vocals: "mid",
};

/** How freely an instrument can shift register when its band is crowded. */
const REGISTER_FLEXIBILITY: Record<string, number> = {
  keys: 0.9, strings: 0.9, synth: 0.8, pads: 0.7, guitar: 0.7,
  brass: 0.5, winds: 0.5, percussion: 0.3, drums: 0.1, bass: 0.2, vocals: 0,
};

// ---------------------------------------------------------------------------
// Budget windows
// ---------------------------------------------------------------------------

type WindowSeed = {
  id: string;
  startBar: number;
  endBar: number;
  vocalAttention: number;
  counterMelodyBudget: number;
  fillBudget: number;
  padBudget: number;
};

function seedWindows(
  map: SongModelMusicalMap,
  plan: SectionPhrasePlan,
): WindowSeed[] {
  if (map.arrangementSpace.status !== "not_available" && map.arrangementSpace.windows.length) {
    return map.arrangementSpace.windows.map((window, index) => {
      const activity = map.vocals.phrases.find(
        (phrase) => phrase.start < window.end && phrase.end > window.start,
      )?.activity ?? 0;
      const vocalAttention =
        window.vocalDensity === "none"
          ? 0.1
          : window.vocalDensity === "low"
            ? 0.4
            : window.vocalDensity === "medium"
              ? 0.7
              : Math.max(0.75, activity);
      return {
        id: window.id || `budget-${index + 1}`,
        startBar: window.bars[0] ?? 1,
        endBar: window.bars[window.bars.length - 1] ?? window.bars[0] ?? 1,
        vocalAttention: round3(clamp01(vocalAttention)),
        counterMelodyBudget: window.counterMelodyBudget,
        fillBudget: window.fillBudget,
        padBudget: window.padBudget,
      };
    });
  }
  // No verified vocal space: fall back to phrase windows with a neutral
  // attention level from the section's melodic activity.
  return plan.phrases.map((phrase, index) => {
    const section = plan.sections.find((s) => s.sectionName === phrase.sectionName);
    const vocalAttention = section
      ? clamp01(0.3 + section.melodicActivity * 0.5)
      : 0.5;
    return {
      id: phrase.id || `budget-${index + 1}`,
      startBar: phrase.startBar,
      endBar: phrase.endBar,
      vocalAttention: round3(vocalAttention),
      counterMelodyBudget: round3(clamp01(0.3 * (1 - vocalAttention))),
      fillBudget: round3(clamp01(0.2 * (1 - vocalAttention))),
      padBudget: 0.5,
    };
  });
}

function budgetWindow(
  seed: WindowSeed,
  plan: SectionPhrasePlan,
  occupancyByBar: Map<number, number>,
): OrchestrationBudgetWindow {
  const va = seed.vocalAttention;
  const meanOccupancy = (() => {
    const values: number[] = [];
    for (let bar = seed.startBar; bar <= seed.endBar; bar += 1) {
      values.push(occupancyByBar.get(bar) ?? 0);
    }
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  })();

  const budgets = {
    totalDensity: round3(clamp01(1 - 0.5 * va)),
    melodic: round3(clamp01(seed.counterMelodyBudget || (1 - va) * 0.4)),
    rhythmic: round3(clamp01(0.7 - 0.3 * va)),
    harmonic: round3(clamp01(0.65 - 0.15 * va)),
    register: round3(clamp01(1 - meanOccupancy)),
    spectral: round3(clamp01(1 - meanOccupancy * 0.8 - va * 0.15)),
    attention: round3(clamp01(1 - va)),
  };

  // Which section owns this window (for the role list).
  const section = plan.sections.find(
    (s) => s.startBar <= seed.startBar && s.endBar >= seed.endBar,
  ) ?? plan.sections.find(
    (s) => s.endBar >= seed.startBar && s.startBar <= seed.endBar,
  );
  const roles = section
    ? plan.roleAssignments.filter((r) => r.sectionName === section.sectionName)
    : [];

  const instrumentAdjustments: OrchestrationInstrumentAdjustment[] = roles.map((role) => {
    let densityMultiplier = 1;
    let registerShift = 0;
    let note = "unchanged";
    if (role.role === "LEAD") {
      densityMultiplier = 1;
      note = "lead — unchanged";
    } else if (["HARMONIC_BED", "RHYTHMIC_HARMONY", "PAD", "OSTINATO"].includes(role.role)) {
      densityMultiplier = round3(clamp01(1 - 0.45 * va));
      note = va > 0.5 ? "duck under the vocal" : "hold";
    } else if (["COUNTER_MELODY", "FILL", "CALL_RESPONSE", "ACCENT"].includes(role.role)) {
      densityMultiplier = round3(clamp01(0.25 + 1.1 * (1 - va)));
      note = va < 0.3 ? "open up in the vocal gap" : "stay out of the way";
    } else if (role.role === "CLIMAX_LAYER") {
      densityMultiplier = round3(clamp01(0.9 + 0.2 * (1 - va)));
      note = "climax layer";
    } else {
      note = "foundation — unchanged";
    }
    // If this instrument sits in an overcrowded band, nudge it out of the way.
    if (budgets.register < 0.25 && REGISTER_FLEXIBILITY[role.instrument] >= 0.7) {
      registerShift = role.register === "mid" || role.register === "low_mid" ? -12 : 12;
      note = `${note}; shift ${registerShift > 0 ? "up" : "down"} an octave to clear the register`;
    }
    return {
      instrument: role.instrument,
      densityMultiplier,
      registerShift,
      note,
    };
  });

  return {
    id: seed.id,
    startBar: seed.startBar,
    endBar: seed.endBar,
    vocalAttention: va,
    budgets,
    instrumentAdjustments,
  };
}

// ---------------------------------------------------------------------------
// Register occupancy
// ---------------------------------------------------------------------------

function coalesce(
  perBar: RegisterOccupancySpan[],
): RegisterOccupancySpan[] {
  const out: RegisterOccupancySpan[] = [];
  for (const span of perBar) {
    const previous = out[out.length - 1];
    const key = (s: RegisterOccupancySpan) =>
      JSON.stringify([s.occupancy, s.overcrowdedBands, s.resolutions]);
    if (previous && previous.endBar + 1 === span.startBar && key(previous) === key(span)) {
      previous.endBar = span.endBar;
      continue;
    }
    out.push({ ...span });
  }
  return out;
}

function registerOccupancy(plan: SectionPhrasePlan): {
  spans: RegisterOccupancySpan[];
  occupancyByBar: Map<number, number>;
} {
  const perBar: RegisterOccupancySpan[] = [];
  const occupancyByBar = new Map<number, number>();

  for (const section of plan.sections) {
    const roles = plan.roleAssignments.filter((r) => r.sectionName === section.sectionName);
    const bands: Record<RegisterBand, number> = {
      low: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0,
    };
    for (const role of roles) {
      const band = role.register ?? FAMILY_BAND[role.instrument] ?? "mid";
      bands[band] += 0.35 + role.density * 0.9;
    }
    const overcrowdedBands = REGISTER_ORDER.filter((band) => bands[band] > 1);
    const resolutions: RegisterOccupancySpan["resolutions"] = [];
    for (const band of overcrowdedBands) {
      const inBand = roles
        .filter((r) => (r.register ?? FAMILY_BAND[r.instrument] ?? "mid") === band && r.role !== "LEAD")
        .sort((a, b) =>
          (REGISTER_FLEXIBILITY[b.instrument] ?? 0.3) - (REGISTER_FLEXIBILITY[a.instrument] ?? 0.3),
        );
      const chosen = inBand[0];
      if (!chosen) continue;
      const action: RegisterOccupancySpan["resolutions"][number]["action"] =
        (REGISTER_FLEXIBILITY[chosen.instrument] ?? 0) >= 0.8
          ? band === "high" || band === "upper_mid"
            ? "raise_octave"
            : "drop_octave"
          : chosen.instrument === "guitar" || chosen.instrument === "keys"
            ? "simplify"
            : "thin_voicing";
      resolutions.push({ instrument: chosen.instrument, action, band });
    }
    const occupancy: Partial<Record<RegisterBand, number>> = {};
    let occupancySum = 0;
    for (const band of REGISTER_ORDER) {
      if (bands[band] > 0) {
        occupancy[band] = round3(clamp01(bands[band]));
        occupancySum += clamp01(bands[band]);
      }
    }
    const meanOccupancy = occupancySum / REGISTER_ORDER.length;
    for (let bar = section.startBar; bar <= section.endBar; bar += 1) {
      occupancyByBar.set(bar, meanOccupancy);
      perBar.push({
        startBar: bar,
        endBar: bar,
        occupancy,
        overcrowdedBands,
        resolutions,
      });
    }
  }

  return { spans: coalesce(perBar), occupancyByBar };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function orchestrationBudgetInputsDigest(
  songModel: SongModelData,
  plan: SectionPhrasePlan,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sectionPlanDigest: plan.inputsDigestSha256,
      arrangementSpace: songModel.musicalMap?.arrangementSpace.windows ?? null,
      vocals: songModel.musicalMap?.vocals.phrases.map((p) => [p.phraseId, p.activity]) ?? null,
    }))
    .digest("hex");
}

export function deriveOrchestrationBudget(
  songModel: SongModelData,
  sectionPlan: SectionPhrasePlan,
  options: { now?: Date } = {},
): OrchestrationBudgetPlan {
  const map: SongModelMusicalMap =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel, options);

  const { spans, occupancyByBar } = registerOccupancy(sectionPlan);
  const windows = seedWindows(map, sectionPlan).map((seed) =>
    budgetWindow(seed, sectionPlan, occupancyByBar),
  );

  return {
    version: ORCHESTRATION_BUDGET_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: orchestrationBudgetInputsDigest(songModel, sectionPlan),
    method: METHOD,
    windows,
    registerOccupancy: spans,
  };
}

export function isOrchestrationBudgetStale(
  songModel: SongModelData,
  sectionPlan: SectionPhrasePlan | undefined,
  budget: OrchestrationBudgetPlan | undefined,
): boolean {
  if (!budget || budget.version !== ORCHESTRATION_BUDGET_VERSION || !sectionPlan) return true;
  return budget.inputsDigestSha256 !== orchestrationBudgetInputsDigest(songModel, sectionPlan);
}
