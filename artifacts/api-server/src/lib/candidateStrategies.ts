/**
 * Candidate Generation Engine (PR-10).
 *
 * "Never accept the first attempt." For each significant decision the studio
 * generates several candidates — but not from random seeds. Each candidate is
 * steered by a named strategy so the Music Critic (PR-11) chooses between
 * genuinely different ideas:
 *
 *   A conservative · B rhythmic · C melodic · D sparse · E adventurous
 *
 * This module produces the deterministic per-candidate / per-part steering.
 * The post-generation near-duplicate guard lives in `candidateDiversity.ts`.
 */
import { createHash } from "node:crypto";
import type {
  CandidateGenerationPlan,
  CandidateStrategyId,
  PartComposerPlan,
  PartTask,
  SongModelData,
} from "@workspace/db";
import { planPartComposition } from "./partComposer";

export const CANDIDATE_GENERATION_PLAN_VERSION = "1.0" as const;
const METHOD = "candidate-generation-engine/v1";

export type CandidateStrategyProfile = {
  id: CandidateStrategyId;
  label: string;
  description: string;
  bias: {
    /** Global multiplier on planned part density. */
    densityMultiplier: number;
    /** -1 (straighter) .. 1 (more syncopated). */
    syncopationBias: number;
    /** 0..1 chance a counter-melody / call-response part is emphasised. */
    counterMelodyEmphasis: number;
    /** 0..1 fill frequency. */
    fillFrequency: number;
    /** 0..1 harmonic risk (extensions, reharmonisation, passing chords). */
    harmonicAdventurousness: number;
    /** 0..1 register spread across the arrangement. */
    registerSpread: number;
    /** -1 fewer families, 0 same, +1 more. */
    orchestrationSizeDelta: number;
    /** 0..1 performance/velocity humanisation. */
    velocityHumanization: number;
  };
};

export const CANDIDATE_STRATEGIES: Record<CandidateStrategyId, CandidateStrategyProfile> = {
  conservative: {
    id: "conservative",
    label: "A · conservative",
    description: "Idiomatic, safe voicings; nothing calls attention to itself.",
    bias: {
      densityMultiplier: 0.95, syncopationBias: -0.2, counterMelodyEmphasis: 0.15,
      fillFrequency: 0.3, harmonicAdventurousness: 0.1, registerSpread: 0.45,
      orchestrationSizeDelta: 0, velocityHumanization: 0.4,
    },
  },
  rhythmic: {
    id: "rhythmic",
    label: "B · rhythmic",
    description: "Groove-forward: tighter drums/bass lock, syncopated comping, more fills.",
    bias: {
      densityMultiplier: 1.1, syncopationBias: 0.6, counterMelodyEmphasis: 0.2,
      fillFrequency: 0.7, harmonicAdventurousness: 0.15, registerSpread: 0.45,
      orchestrationSizeDelta: 0, velocityHumanization: 0.55,
    },
  },
  melodic: {
    id: "melodic",
    label: "C · melodic",
    description: "Foreground counter-melodies and call-and-response around the lead.",
    bias: {
      densityMultiplier: 1.0, syncopationBias: 0.1, counterMelodyEmphasis: 0.85,
      fillFrequency: 0.4, harmonicAdventurousness: 0.35, registerSpread: 0.6,
      orchestrationSizeDelta: 0, velocityHumanization: 0.5,
    },
  },
  sparse: {
    id: "sparse",
    label: "D · sparse",
    description: "Fewer instruments, more space; the lead carries the section.",
    bias: {
      densityMultiplier: 0.6, syncopationBias: -0.1, counterMelodyEmphasis: 0.05,
      fillFrequency: 0.15, harmonicAdventurousness: 0.1, registerSpread: 0.35,
      orchestrationSizeDelta: -1, velocityHumanization: 0.35,
    },
  },
  adventurous: {
    id: "adventurous",
    label: "E · adventurous",
    description: "Bolder harmony, wider register, extra colour layers and gestures.",
    bias: {
      densityMultiplier: 1.2, syncopationBias: 0.4, counterMelodyEmphasis: 0.7,
      fillFrequency: 0.6, harmonicAdventurousness: 0.85, registerSpread: 0.85,
      orchestrationSizeDelta: 1, velocityHumanization: 0.65,
    },
  },
};

const STRATEGY_ORDER: CandidateStrategyId[] = [
  "conservative", "rhythmic", "melodic", "sparse", "adventurous",
];

/** The strategy ids to use for `count` candidates (always distinct, ordered). */
export function candidateStrategySet(count: number): CandidateStrategyId[] {
  const n = Math.max(1, Math.min(STRATEGY_ORDER.length, Math.round(count)));
  if (n === STRATEGY_ORDER.length) return [...STRATEGY_ORDER];
  if (n === 1) return ["conservative"];
  if (n === 2) return ["conservative", "adventurous"];
  if (n === 3) return ["conservative", "melodic", "adventurous"];
  return ["conservative", "rhythmic", "melodic", "sparse"];
}

const CANDIDATE_LETTERS = ["A", "B", "C", "D", "E"];

function seed(baseSeed: number, parts: string[]): number {
  const digest = createHash("sha256").update(`${baseSeed}:${parts.join(":")}`).digest();
  return digest.readUInt32BE(0);
}

/** How strongly a strategy pushes on a given part task, as a density multiplier. */
function partMultiplier(task: PartTask, bias: CandidateStrategyProfile["bias"]): { multiplier: number; note: string } {
  const rhythmParts = task === "DRUMS" || task === "PERCUSSION" || task === "OSTINATO";
  const melodicParts = task === "COUNTER_MELODY" || task === "CALL_RESPONSE";
  const colourParts = task === "PAD" || task === "STRINGS" || task === "BRASS" || task === "WOODWINDS";
  let multiplier = bias.densityMultiplier;
  const notes: string[] = [];
  if (rhythmParts) {
    multiplier *= 1 + bias.syncopationBias * 0.35 + bias.fillFrequency * 0.15;
    notes.push("rhythmic emphasis");
  }
  if (melodicParts) {
    multiplier *= 0.4 + bias.counterMelodyEmphasis * 1.1;
    notes.push("counter-melody emphasis");
  }
  if (colourParts) {
    multiplier *= 1 + bias.orchestrationSizeDelta * 0.35 + bias.registerSpread * 0.1;
    notes.push("colour layer");
  }
  if (task === "FILL") {
    multiplier *= 0.5 + bias.fillFrequency * 1.2;
    notes.push("fill frequency");
  }
  multiplier = Math.round(Math.max(0, Math.min(2, multiplier)) * 1000) / 1000;
  return { multiplier, note: notes.length ? notes.join(", ") : "baseline" };
}

export function candidateGenerationInputsDigest(
  songModel: SongModelData,
  partPlan: PartComposerPlan,
  strategies: CandidateStrategyId[],
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      partPlanDigest: partPlan.inputsDigestSha256,
      tasks: partPlan.tasks.map((t) => [t.id, t.task]),
      strategies,
    }))
    .digest("hex");
}

export function planCandidateGeneration(
  songModel: SongModelData,
  count = 5,
  options: { now?: Date; baseSeed?: number; partPlan?: PartComposerPlan } = {},
): CandidateGenerationPlan {
  const partPlan = options.partPlan ?? planPartComposition(songModel, options).plan;
  const strategies = candidateStrategySet(count);
  const baseSeed = options.baseSeed ??
    seed(0, [songModel.fusion?.selectedProvider ?? "", partPlan.inputsDigestSha256]);

  const candidates = strategies.map((strategyId, index) => {
    const profile = CANDIDATE_STRATEGIES[strategyId];
    const candidateSeed = seed(baseSeed, [strategyId, String(index)]);
    return {
      candidateId: `cand-${CANDIDATE_LETTERS[index]}`,
      label: profile.label,
      strategy: strategyId,
      seed: candidateSeed,
      parameters: {
        densityMultiplier: profile.bias.densityMultiplier,
        syncopationBias: profile.bias.syncopationBias,
        counterMelodyEmphasis: profile.bias.counterMelodyEmphasis,
        fillFrequency: profile.bias.fillFrequency,
        harmonicAdventurousness: profile.bias.harmonicAdventurousness,
        registerSpread: profile.bias.registerSpread,
        orchestrationSizeDelta: profile.bias.orchestrationSizeDelta,
        velocityHumanization: profile.bias.velocityHumanization,
      },
      partAdjustments: partPlan.tasks.map((taskEntry) => {
        const { multiplier, note } = partMultiplier(taskEntry.task, profile.bias);
        return {
          taskId: taskEntry.id,
          densityMultiplier: multiplier,
          seed: seed(candidateSeed, [taskEntry.id]),
          note,
        };
      }),
    };
  });

  return {
    version: CANDIDATE_GENERATION_PLAN_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: candidateGenerationInputsDigest(songModel, partPlan, strategies),
    method: METHOD,
    baseSeed,
    candidates,
  };
}

export function isCandidateGenerationPlanStale(
  songModel: SongModelData,
  partPlan: PartComposerPlan | undefined,
  plan: CandidateGenerationPlan | undefined,
): boolean {
  if (!plan || plan.version !== CANDIDATE_GENERATION_PLAN_VERSION || !partPlan) return true;
  return plan.inputsDigestSha256 !== candidateGenerationInputsDigest(
    songModel, partPlan, plan.candidates.map((c) => c.strategy),
  );
}
