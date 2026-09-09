/**
 * Challenger arms for the model tournament (Wave Q — Model Discovery, round 2).
 *
 * A sibling of `tournamentProviders.ts` (which Workstream B owns): the same
 * `TournamentProvider` shape, the same shared-inference-per-(task, seed)
 * pattern as `createCa2Providers`, and the same two arms per model — raw, and
 * the same notes through the platform's context passes.
 *
 *  - ANTICIPATORY_MUSIC_TRANSFORMER      real inference on the deployed
 *                                        anticipatory worker (RESEARCH_ONLY:
 *                                        a shadow challenger, never a route).
 *  - ANTICIPATORY_MUSIC_TRANSFORMER+CTX  the same inference, then the
 *                                        platform's context passes.
 */
import type { MusicalNote } from "@workspace/db";
import { adaptAmtResult } from "./anticipatoryResultAdapter";
import { amtInfill, type AmtEndpoint, type AmtHealth } from "./anticipatoryClient";
import { composeWithContext, type ContextAwareResult } from "./contextAwareComposer";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";
import type { ProviderAccount } from "./symbolicGenerationProvider";
import { toAbsoluteTime, toWindowTime } from "./tournamentSongModel";
import { platformRequestFor, type TournamentProvider } from "./tournamentProviders";
import type { TournamentTask } from "./tournamentTask";

export const AMT_SUT = "ANTICIPATORY_MUSIC_TRANSFORMER";
export const AMT_CONTEXT_SUT = "ANTICIPATORY_MUSIC_TRANSFORMER+CTX";

export type AmtProviderOptions = {
  endpoint: AmtEndpoint;
  health: AmtHealth;
  /** The Standard MIDI File the task came from. The worker holds the window out itself. */
  loadMidi: (task: TournamentTask) => Promise<Uint8Array>;
  topP?: number;
  maxEvents?: number;
  /**
   * Decode switches, passed through to the worker and recorded in every
   * account. The defaults are the configuration the decode sweep chose
   * (docs/evidence/amt-live/decode-sweep-*.json): the model has no instrument
   * conditioning, so without the note-slot mask it writes the other
   * instruments and returns nothing for the held-out one.
   */
  allowRest?: boolean;
  forbidDuplicate?: boolean;
  maskInstrument?: boolean;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

function applyContext(task: TournamentTask, v2: PartGenerationRequestV2, absoluteNotes: readonly MusicalNote[]): ContextAwareResult {
  const base = absoluteNotes.map((n) => toWindowTime(n, task)).filter((n): n is MusicalNote => n !== null);
  const result = composeWithContext(v2, base, { beatSeconds: task.beatSeconds });
  return { ...result, notes: result.notes.map((n) => toAbsoluteTime(n, task)) };
}

type Shared = { notes: MusicalNote[]; account: ProviderAccount | null; inferenceSeconds: number | null; failure: string | null; v2: PartGenerationRequestV2 };

/**
 * Both AMT arms over one shared inference per (task, seed). Whichever arm
 * runs first pays for the inference; the comparison is about the passes.
 */
export function createAmtProviders(options: AmtProviderOptions): { raw: TournamentProvider; withContext: TournamentProvider } {
  const cache = new Map<string, Promise<Shared>>();

  const infer = (task: TournamentTask, seed: number): Promise<Shared> => {
    const key = `${task.id}:${seed}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const { v2 } = platformRequestFor(task, seed);
        try {
          const midi = await options.loadMidi(task);
          const result = await amtInfill(
            options.endpoint,
            {
              midi,
              midiName: `${task.workId}.mid`,
              targetInst: task.targetInst,
              startMeasure: task.barStart,
              nMeasures: task.bars.length,
              seed,
              topP: options.topP ?? 0.98,
              maxEvents: options.maxEvents ?? 400,
              allowRest: options.allowRest ?? true,
              forbidDuplicate: options.forbidDuplicate ?? true,
              maskInstrument: options.maskInstrument ?? true,
            },
            options.health,
            options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
          );
          const adapted = adaptAmtResult(result, v2, { tempoBpm: task.tempoBpm, originSeconds: 0, idPrefix: `amt-${seed}` });
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
    id: AMT_SUT,
    kind: "model",
    async generate(task, seed) {
      const { notes, account, inferenceSeconds, failure } = await infer(task, seed);
      return { notes, account, inferenceSeconds, failure };
    },
  };
  const withContext: TournamentProvider = {
    id: AMT_CONTEXT_SUT,
    kind: "model",
    async generate(task, seed) {
      const base = await infer(task, seed);
      if (base.failure) return { notes: [], account: base.account, inferenceSeconds: base.inferenceSeconds, failure: base.failure };
      const result = applyContext(task, base.v2, base.notes);
      const account: ProviderAccount | null = base.account
        ? {
            ...base.account,
            providerId: AMT_CONTEXT_SUT,
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
