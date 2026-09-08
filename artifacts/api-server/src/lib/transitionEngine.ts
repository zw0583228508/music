/**
 * Transition Engine (PR-08).
 *
 * Plans what happens at every section boundary — fills, pickups, runs, pushes,
 * swells, chokes, breaks, stops, anticipations, turnarounds, risers, reverses,
 * build-ups, breakdowns and endings — conditioned on source/target energy,
 * section type, harmonic cadence, available instruments, vocal activity and a
 * derived transition strength.
 *
 * Deterministic and pure. Reads the section/phrase plan (PR-05), the global
 * plan (PR-04) and the musical map (PR-01/03).
 */
import { createHash } from "node:crypto";
import type {
  GlobalArrangementPlan,
  SectionPhrasePlan,
  SongModelData,
  SongModelMusicalMap,
  TransitionDevice,
  TransitionDevicePlan,
  TransitionPlan,
  TransitionPlanSet,
} from "@workspace/db";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

export const TRANSITION_PLAN_VERSION = "1.0" as const;
const METHOD = "transition-engine/v1";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;

// ---------------------------------------------------------------------------

function barSeconds(songModel: SongModelData, bar: number, totalBars: number): number {
  const explicit = (songModel.bars ?? []).find((b) => b.bar === bar);
  if (explicit) return explicit.start;
  const duration = songModel.audio?.durationSeconds ?? totalBars * 2;
  return ((bar - 1) / Math.max(1, totalBars)) * duration;
}

function nearestCadence(
  map: SongModelMusicalMap,
  atBar: number,
): SongModelMusicalMap["harmony"]["cadences"][number] | undefined {
  if (map.harmony.status === "not_available") return undefined;
  return map.harmony.cadences.find((cadence) => Math.abs(cadence.atBar - atBar) <= 1);
}

function harmonicApproach(
  cadence: ReturnType<typeof nearestCadence>,
): TransitionPlan["harmonicApproach"] {
  if (!cadence) return "static";
  if (cadence.kind === "authentic" || cadence.kind === "half") return "dominant_prep";
  if (cadence.kind === "plagal") return "plagal";
  if (cadence.kind === "deceptive") return "chromatic";
  return "none";
}

function familiesForBoundary(
  sectionPlan: SectionPhrasePlan,
  fromName: string,
  toName: string,
): Set<string> {
  const from = sectionPlan.sections.find((s) => s.sectionName === fromName);
  const to = sectionPlan.sections.find((s) => s.sectionName === toName);
  return new Set([
    ...(from?.activeInstrumentFamilies ?? []),
    ...(to?.activeInstrumentFamilies ?? []),
  ]);
}

// ---------------------------------------------------------------------------
// Device selection
// ---------------------------------------------------------------------------

function selectDevices(
  kind: TransitionPlan["kind"],
  strength: number,
  approachStart: number,
  atBar: number,
  families: Set<string>,
  toRole: string,
  isFinalSection: boolean,
  style: string,
  isRepeat: boolean,
): TransitionDevicePlan[] {
  const devices: TransitionDevicePlan[] = [];
  const has = (family: string) => families.has(family);
  const lastBar = atBar - 1;
  const push = (
    device: TransitionDevice, instrument: string,
    startBar: number, endBar: number, intensity: number, rationale: string,
  ) => {
    if (endBar < approachStart || startBar > lastBar) return;
    devices.push({
      device, instrument,
      startBar: Math.max(approachStart, startBar),
      endBar: Math.min(lastBar, endBar),
      intensity: round3(clamp01(intensity)),
      rationale,
    });
  };

  if (isFinalSection || toRole === "outro") {
    push("ending_hit", has("drums") ? "drums" : "keys", lastBar, lastBar, 0.9,
      "Mark the end of the song.");
    if (style === "ballad" || style === "acoustic" || style === "orchestral") {
      push("ritardando", "ensemble", approachStart, lastBar, 0.6,
        "Slow into the final cadence.");
    }
    return devices;
  }

  if (isRepeat && kind === "continue") {
    push("turnaround", has("keys") ? "keys" : has("guitar") ? "guitar" : "bass",
      lastBar, lastBar, 0.4 + strength * 0.3,
      "Harmonic turnaround back into the repeated section.");
  }

  switch (kind) {
    case "build": {
      if (has("drums")) {
        push("drum_fill", "drums", lastBar, lastBar, 0.55 + strength * 0.4,
          "Drum fill lifts into the next section.");
        if (strength > 0.5) {
          push("cymbal_swell", "drums", approachStart, lastBar, 0.4 + strength * 0.4,
            "Crescendo cymbal swell under the build.");
        }
      }
      if (has("bass")) {
        push("bass_pickup", "bass", lastBar, lastBar, 0.5 + strength * 0.3,
          "Bass pickup walks into the downbeat.");
      }
      if (has("strings")) {
        push("string_run", "strings", lastBar, lastBar, 0.4 + strength * 0.4,
          "Ascending string run into the section.");
      } else if (has("keys")) {
        push("keys_pickup", "keys", lastBar, lastBar, 0.35 + strength * 0.35,
          "Keyboard pickup phrase into the downbeat.");
      } else if (has("guitar")) {
        push("guitar_pickup", "guitar", lastBar, lastBar, 0.35 + strength * 0.35,
          "Guitar pickup into the downbeat.");
      }
      if (has("brass") && strength > 0.55) {
        push("brass_push", "brass", lastBar, lastBar, 0.5 + strength * 0.4,
          "Brass push accents the arrival.");
      }
      if ((has("synth") || has("pads")) && strength > 0.4) {
        push("riser", has("synth") ? "synth" : "pads", approachStart, lastBar,
          0.4 + strength * 0.5, "Riser sweeps up to the drop.");
        if (strength > 0.7) {
          push("reverse", has("synth") ? "synth" : "pads", lastBar, lastBar, 0.5,
            "Reverse swell resolves on the downbeat.");
        }
      }
      if (strength > 0.75 && toRole === "chorus") {
        push("build_up", "ensemble", approachStart, lastBar, strength,
          "Full-ensemble build into the chorus.");
      }
      break;
    }
    case "drop": {
      if (has("drums")) {
        push("cymbal_choke", "drums", lastBar, lastBar, 0.4 + strength * 0.3,
          "Choke the cymbal to clear space for the drop.");
      }
      push("break", "ensemble", lastBar, lastBar, 0.4 + strength * 0.4,
        "Short break before the quieter section.");
      if (strength > 0.6) {
        push("breakdown", "ensemble", approachStart, lastBar, strength,
          "Strip the arrangement back into the breakdown.");
      }
      break;
    }
    case "break": {
      push("stop", "ensemble", lastBar, lastBar, 0.6 + strength * 0.3,
        "Full stop, then the target section enters.");
      push("anticipation", has("bass") ? "bass" : "keys", lastBar, lastBar,
        0.4 + strength * 0.3, "Anticipation note pulls into the downbeat.");
      break;
    }
    case "continue":
    default: {
      if (strength > 0.25) {
        if (has("bass")) {
          push("bass_pickup", "bass", lastBar, lastBar, 0.25 + strength * 0.3,
            "Subtle bass pickup keeps the flow.");
        } else if (has("keys")) {
          push("keys_pickup", "keys", lastBar, lastBar, 0.25 + strength * 0.3,
            "Subtle keyboard pickup keeps the flow.");
        }
        if (has("drums") && strength > 0.4) {
          push("drum_fill", "drums", lastBar, lastBar, 0.3 + strength * 0.2,
            "Light fill marks the section change.");
        }
      }
      break;
    }
  }
  return devices;
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function transitionPlanInputsDigest(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan,
  sectionPlan: SectionPhrasePlan,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sectionTargets: globalPlan.sectionTargets,
      grooveStrategy: globalPlan.grooveStrategy,
      style: globalPlan.style,
      sectionPlanDigest: sectionPlan.inputsDigestSha256,
      cadences: songModel.musicalMap?.harmony.cadences ?? null,
      transitions: songModel.musicalMap?.structure.transitions ?? null,
      vocals: songModel.musicalMap?.vocals.phrases.map((p) => [p.start, p.end]) ?? null,
    }))
    .digest("hex");
}

export function deriveTransitionPlan(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan,
  sectionPlan: SectionPhrasePlan,
  options: { now?: Date } = {},
): TransitionPlanSet {
  const map: SongModelMusicalMap =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel, options);

  const targets = globalPlan.sectionTargets;
  const totalBars = Math.max(1, targets.at(-1)?.endBar ?? 1);
  const transitions: TransitionPlan[] = [];

  for (let i = 0; i < targets.length - 1; i += 1) {
    const from = targets[i];
    const to = targets[i + 1];
    const atBar = to.startBar;
    const delta = to.energy - from.energy;

    const structural = map.structure.status !== "not_available"
      ? map.structure.transitions.find((t) => t.atBar === atBar)
      : undefined;
    const kind: TransitionPlan["kind"] = structural?.kind ??
      (delta > 0.15 ? "build" : delta < -0.15 ? "drop" : Math.abs(delta) <= 0.05 ? "continue" : delta > 0 ? "build" : "drop");

    const cadence = nearestCadence(map, atBar);
    const intoChorus = to.role === "chorus" || to.role === "prechorus";
    const strength = round3(clamp01(
      Math.abs(delta) * 1.3 +
      (cadence ? cadence.strength * 0.25 : 0) +
      (intoChorus ? 0.15 : 0) +
      to.noveltyVsPrevious * 0.2,
    ));

    const approachBars = strength > 0.6 || intoChorus ? Math.min(2, atBar - from.startBar) : 1;
    const approachStart = Math.max(from.startBar, atBar - approachBars);

    const approachStartSec = barSeconds(songModel, approachStart, totalBars);
    const boundarySec = barSeconds(songModel, atBar, totalBars);
    const vocalSafe = map.vocals.status === "not_available" ||
      !map.vocals.phrases.some(
        (phrase) => phrase.end > approachStartSec + 1e-6 && phrase.start < boundarySec - 1e-6,
      );

    const families = familiesForBoundary(sectionPlan, from.sectionName, to.sectionName);
    const isRepeat = from.sectionName.replace(/\d+/g, "").trim().toLowerCase() ===
      to.sectionName.replace(/\d+/g, "").trim().toLowerCase();
    const isFinalSection = i + 1 === targets.length - 1 && to.role === "outro";

    let devices = selectDevices(
      kind, strength, approachStart, atBar, families, to.role,
      isFinalSection, globalPlan.style, isRepeat,
    );
    // If the singer is carrying the transition, keep melodic answers out of it.
    if (!vocalSafe) {
      devices = devices.filter(
        (d) => !["string_run", "keys_pickup", "guitar_pickup", "brass_push", "reverse"].includes(d.device),
      );
    }

    transitions.push({
      id: `trans-${i + 1}`,
      fromSection: from.sectionName,
      toSection: to.sectionName,
      atBar,
      approachBars,
      kind,
      strength,
      harmonicApproach: harmonicApproach(cadence),
      vocalSafe,
      devices,
    });
  }

  return {
    version: TRANSITION_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: transitionPlanInputsDigest(songModel, globalPlan, sectionPlan),
    method: METHOD,
    transitions,
  };
}

export function isTransitionPlanStale(
  songModel: SongModelData,
  globalPlan: GlobalArrangementPlan | undefined,
  sectionPlan: SectionPhrasePlan | undefined,
  plan: TransitionPlanSet | undefined,
): boolean {
  if (!plan || plan.version !== TRANSITION_PLAN_VERSION || !globalPlan || !sectionPlan) return true;
  return plan.inputsDigestSha256 !== transitionPlanInputsDigest(songModel, globalPlan, sectionPlan);
}
