/**
 * Tournament providers (Wave Q — Model Discovery, items 13–15).
 *
 * The arms of the model tournament, each answering the same `TournamentTask`
 * with notes in absolute seconds:
 *
 *  - HUMAN_ORIGIN_REFERENCE      the score's own part. The anchor: a judge
 *                                that ranks a machine above it is suspect.
 *  - REFERENCE_PART_COMPOSER     the platform's deterministic composer, fed by
 *                                the real planners over a Song Model built
 *                                from the task.
 *  - CONTEXT_AWARE_ARRANGER      the same, then the V2 context passes with the
 *                                context tracks as siblings, the Q-04 harmony
 *                                plan and the Q-02 grammar — the `contextAware`
 *                                path exactly.
 *  - COMPOSERS_ASSISTANT_2       real inference on the deployed worker, raw.
 *  - COMPOSERS_ASSISTANT_2+CTX   the same inference, then the platform's
 *                                context passes — CA2 "as it would ship".
 *
 * The two CA2 arms share one inference per (task, seed): the comparison is
 * about the passes, not about sampling twice.
 */
import type { InstrumentArrangementRole, MusicalNote, PartTask } from "@workspace/db";
import { harmonyPlanFor, styleGrammarFor } from "./arrangementOrchestrator";
import { adaptCa2Result } from "./ca2ResultAdapter";
import { ca2Infill, type Ca2Endpoint, type Ca2Health } from "./composersAssistantClient";
import { composeWithContext, type ContextAwareResult } from "./contextAwareComposer";
import { buildPartGenerationRequest, planPartComposition, type PartGenerationRequest } from "./partComposer";
import { upgradePartGenerationRequest, type PartGenerationRequestV2 } from "./partGenerationContextV2";
import { PLATFORM_INSTRUMENT } from "./partJudge";
import { composeReferencePart } from "./referencePartComposer";
import type { ProviderAccount } from "./symbolicGenerationProvider";
import { songModelFromTask, toAbsoluteTime, toWindowTime } from "./tournamentSongModel";
import type { TournamentTask } from "./tournamentTask";

export const HUMAN_SUT = "HUMAN_ORIGIN_REFERENCE";
export const REFERENCE_SUT = "REFERENCE_PART_COMPOSER";
export const CONTEXT_AWARE_SUT = "CONTEXT_AWARE_ARRANGER";
export const CA2_SUT = "COMPOSERS_ASSISTANT_2";
export const CA2_CONTEXT_SUT = "COMPOSERS_ASSISTANT_2+CTX";

export type TournamentProviderResult = {
  notes: MusicalNote[];
  account: ProviderAccount | null;
  inferenceSeconds: number | null;
  failure: string | null;
  /** What the context passes did, when they ran. */
  passes?: ContextAwareResult["passes"];
};

export interface TournamentProvider {
  readonly id: string;
  readonly kind: "human" | "platform" | "model";
  generate(task: TournamentTask, seed: number): Promise<TournamentProviderResult>;
}

const PART_TASK: Record<string, PartTask> = {
  drums: "DRUMS", keys: "PIANO", organ: "KEYS", chromatic_perc: "KEYS", guitar: "ACOUSTIC_GUITAR",
  bass: "BASS", strings: "STRINGS", ensemble: "PAD", brass: "BRASS", reed: "WOODWINDS", pipe: "WOODWINDS", synth: "PAD",
};

/**
 * The request the platform would build for this part: real Song Model, real
 * planners, the target injected as the task. Shared by every platform arm and
 * by the CA2 account, so the dispositions describe the same context.
 */
export function platformRequestFor(task: TournamentTask, seed: number): {
  request: PartGenerationRequest;
  v2: PartGenerationRequestV2;
  meter: string;
} {
  const songModel = songModelFromTask(task);
  const { layers } = planPartComposition(songModel, { now: new Date(0) });
  const section = layers.sectionPlan.sections[0];
  if (!section) throw new Error("the section planner produced no section for the tournament window");
  const platform = PLATFORM_INSTRUMENT[task.targetFamily] ?? PLATFORM_INSTRUMENT.keys;
  const target = {
    id: `tournament-${task.id}-${seed}`,
    task: PART_TASK[task.targetFamily] ?? "KEYS",
    sectionName: section.sectionName,
    instrument: platform.instrument,
    role: platform.role as InstrumentArrangementRole,
    startBar: 1,
    endBar: task.bars.length,
    seed,
    dependsOn: [] as string[],
  };
  const siblings = task.contextTracks.map((t) => {
    const p = PLATFORM_INSTRUMENT[t.family] ?? { instrument: t.family, role: "HARMONIC_BED" };
    const notes = t.notes.map((n) => toWindowTime(n, task)).filter((n): n is MusicalNote => n !== null);
    return { instrument: p.instrument, role: p.role, notes };
  });
  const request = buildPartGenerationRequest(
    songModel, target, layers,
    siblings.map((s) => ({ instrument: s.instrument, role: s.role, noteCount: s.notes.length })),
  );
  const meter = `${task.meter.numerator}/${task.meter.denominator}`;
  const v2 = upgradePartGenerationRequest(request, {
    siblings,
    window: { start: 0, end: Number((task.bars.length * task.barSeconds).toFixed(4)) },
    candidateCount: 3,
    harmonyPlan: harmonyPlanFor(songModel),
    styleGrammar: styleGrammarFor(songModel, task.tempoBpm, meter, task.id),
  });
  return { request, v2, meter };
}

export const humanProvider: TournamentProvider = {
  id: HUMAN_SUT,
  kind: "human",
  async generate(task) {
    return { notes: task.humanTarget.map((n) => ({ ...n })), account: null, inferenceSeconds: 0, failure: null };
  },
};

export const referenceProvider: TournamentProvider = {
  id: REFERENCE_SUT,
  kind: "platform",
  async generate(task, seed) {
    const started = Date.now();
    const { request, meter } = platformRequestFor(task, seed);
    const notes = composeReferencePart(request, { tempoBpm: task.tempoBpm, meter, originSeconds: 0 })
      .map((n) => toAbsoluteTime(n, task));
    return { notes, account: null, inferenceSeconds: (Date.now() - started) / 1000, failure: null };
  },
};

function applyContext(task: TournamentTask, v2: PartGenerationRequestV2, absoluteNotes: readonly MusicalNote[]): ContextAwareResult {
  const base = absoluteNotes.map((n) => toWindowTime(n, task)).filter((n): n is MusicalNote => n !== null);
  const result = composeWithContext(v2, base, { beatSeconds: task.beatSeconds });
  return { ...result, notes: result.notes.map((n) => toAbsoluteTime(n, task)) };
}

export const contextAwareProvider: TournamentProvider = {
  id: CONTEXT_AWARE_SUT,
  kind: "platform",
  async generate(task, seed) {
    const started = Date.now();
    const { request, v2, meter } = platformRequestFor(task, seed);
    const base = composeReferencePart(request, { tempoBpm: task.tempoBpm, meter, originSeconds: 0 })
      .map((n) => toAbsoluteTime(n, task));
    const result = applyContext(task, v2, base);
    return { notes: result.notes, account: null, inferenceSeconds: (Date.now() - started) / 1000, failure: null, passes: result.passes };
  },
};

export type Ca2ProviderOptions = {
  endpoint: Ca2Endpoint;
  health: Ca2Health;
  /** The Standard MIDI File the task came from. CA2 masks the window itself. */
  loadMidi: (task: TournamentTask) => Promise<Uint8Array>;
  temperature?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

/**
 * Both CA2 arms over one shared inference per (task, seed). Order of calls
 * does not matter: whichever arm runs first pays for the inference.
 */
export function createCa2Providers(options: Ca2ProviderOptions): { raw: TournamentProvider; withContext: TournamentProvider } {
  const cache = new Map<string, Promise<{ notes: MusicalNote[]; account: ProviderAccount | null; inferenceSeconds: number | null; failure: string | null; v2: PartGenerationRequestV2 }>>();

  const infer = (task: TournamentTask, seed: number) => {
    const key = `${task.id}:${seed}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const { v2 } = platformRequestFor(task, seed);
        try {
          const midi = await options.loadMidi(task);
          const result = await ca2Infill(
            options.endpoint,
            {
              midi,
              midiName: `${task.workId}.mid`,
              targetInst: task.targetInst,
              startMeasure: task.barStart,
              nMeasures: task.bars.length,
              seed,
              temperature: options.temperature ?? 1.0,
            },
            options.health,
            options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
          );
          const adapted = adaptCa2Result(result, v2, { tempoBpm: task.tempoBpm, originSeconds: 0, idPrefix: `ca2-${seed}` });
          if ("refusal" in adapted) {
            return { notes: [], account: null, inferenceSeconds: result.inference?.seconds ?? null, failure: adapted.refusal, v2 };
          }
          return { notes: adapted.notes, account: adapted.account, inferenceSeconds: adapted.account.inferenceSeconds, failure: null, v2 };
        } catch (error) {
          return { notes: [], account: null, inferenceSeconds: null, failure: error instanceof Error ? error.message : String(error), v2 };
        }
      })();
      cache.set(key, pending);
    }
    return pending;
  };

  const raw: TournamentProvider = {
    id: CA2_SUT,
    kind: "model",
    async generate(task, seed) {
      const { notes, account, inferenceSeconds, failure } = await infer(task, seed);
      return { notes, account, inferenceSeconds, failure };
    },
  };
  const withContext: TournamentProvider = {
    id: CA2_CONTEXT_SUT,
    kind: "model",
    async generate(task, seed) {
      const base = await infer(task, seed);
      if (base.failure) return { notes: [], account: base.account, inferenceSeconds: base.inferenceSeconds, failure: base.failure };
      const result = applyContext(task, base.v2, base.notes);
      const account: ProviderAccount | null = base.account
        ? {
            ...base.account,
            providerId: CA2_CONTEXT_SUT,
            enforced: [
              ...base.account.enforced,
              ...result.passes.map((pass) => ({ constraint: `context pass ${pass.id}: ${pass.note}`, affected: pass.changed })),
            ],
          }
        : null;
      return { notes: result.notes, account, inferenceSeconds: base.inferenceSeconds, failure: null, passes: result.passes };
    },
  };
  return { raw, withContext };
}
