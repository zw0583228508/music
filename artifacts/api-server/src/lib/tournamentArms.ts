/**
 * Tournament arms added by PR-74 (Wave Q — Model Discovery, experiments A + B).
 *
 *  - COMPOSERS_ASSISTANT_2+PREFIX       the same CA2 inference as the raw arm
 *                                       would make, except that the request
 *                                       carries CA2's own instructions derived
 *                                       from the task's `PartGenerationRequestV2`
 *                                       by `expressV2InCa2Vocabulary()` — the
 *                                       $0 falsifier the conditioning study
 *                                       (PR-64) asked for.
 *  - COMPOSERS_ASSISTANT_2+PREFIX+CTX   the same inference, then the platform's
 *                                       context passes. Shares one inference with
 *                                       +PREFIX per (task, seed).
 *  - COMPOSERS_ASSISTANT_2+CTX(routed)  the raw arm's inference (shared with the
 *                                       existing raw / +CTX arms through their
 *                                       own cache), with the context passes
 *                                       applied or not per instrument family, as
 *                                       decided by a rule learned from earlier
 *                                       tournaments (`contextRouting.ts`).
 *
 * Every arm accounts for what it sent, what the worker applied or refused,
 * and — for the prefix arms — whether the output obeyed each instruction
 * (`controlAccuracy.ts`). Nothing here edits the existing arms or the judge.
 */
import type { MusicalNote } from "@workspace/db";
import { adaptCa2Result, type Ca2WorkerResult } from "./ca2ResultAdapter";
import { ca2Infill, type Ca2Endpoint, type Ca2Health, type Ca2WireInstruction, type Ca2WireInstructions } from "./composersAssistantClient";
import { expressV2InCa2Vocabulary, type Ca2PrefixExpression } from "./conditioningMap";
import { composeWithContext, type ContextAwareResult } from "./contextAwareComposer";
import { routeContext, type ContextRoutingRule } from "./contextRouting";
import { checkControls, summariseControls, type ControlAccuracyRow, type ControlCheck, type MeasurementWindow, type SentInstruction } from "./controlAccuracy";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";
import type { ProviderAccount } from "./symbolicGenerationProvider";
import { platformRequestFor, type TournamentProvider, type TournamentProviderResult } from "./tournamentProviders";
import { toAbsoluteTime, toWindowTime } from "./tournamentSongModel";
import type { TournamentTask } from "./tournamentTask";

export const CA2_PREFIX_SUT = "COMPOSERS_ASSISTANT_2+PREFIX";
export const CA2_PREFIX_CONTEXT_SUT = "COMPOSERS_ASSISTANT_2+PREFIX+CTX";
export const CA2_ROUTED_SUT = "COMPOSERS_ASSISTANT_2+CTX(routed)";

// ---------------------------------------------------------------------------
// From the expression to the wire
// ---------------------------------------------------------------------------

const TOKEN = /;<instruction_(\d+)>(?:;[ND]:(\d+))?/g;

/** Parse CA2 instruction tokens (`;<instruction_47>;N:60…`) into wire items. */
export function parseInstructionTokens(tokens: string): Ca2WireInstruction[] {
  const out: Ca2WireInstruction[] = [];
  for (const m of tokens.matchAll(TOKEN)) {
    const id = Number(m[1]);
    out.push(m[2] === undefined ? { id } : { id, note: Number(m[2]) });
  }
  return out;
}

export type WirePlan = {
  wire: Ca2WireInstructions;
  /** Every instruction sent, flattened — the list the control check reads. */
  sent: SentInstruction[];
  /** Parts of the expression the worker has no field for; listed, never pretended. */
  notSentOnWire: Array<{ field: string; why: string }>;
};

/** What of a `Ca2PrefixExpression` this arm can put on the wire today. */
export function wireFromExpression(expression: Ca2PrefixExpression): WirePlan {
  const atEnd = parseInstructionTokens(expression.commandsAtEnd);
  const perCell = parseInstructionTokens(expression.trackMeasureCommands);
  const notSentOnWire: WirePlan["notSentOnWire"] = [];
  if (expression.guideTracks.length) {
    notSentOnWire.push({ field: `guideTracks (${expression.guideTracks.map((g) => g.purpose).join(", ")})`, why: "the worker takes the MIDI as-is; adding a synthetic guide track means rewriting the score, which this arm does not do" });
  }
  if (expression.unmaskedBars.length) {
    notSentOnWire.push({ field: "unmaskedBars", why: "the tournament masks the whole window by construction; partial masks are not a tournament task" });
  }
  if (expression.contextBars.before || expression.contextBars.after) {
    notSentOnWire.push({ field: "contextBars", why: "the worker's measure_slice is the task window; the neighbouring bars are not widened into the slice" });
  }
  return {
    wire: { atEnd, perCell, loudness: expression.loudnessLevels },
    sent: [...atEnd, ...perCell],
    notSentOnWire,
  };
}

/** The measurement window of a task on CA2's quarter-note clock. */
export function measurementWindowFor(task: TournamentTask): MeasurementWindow {
  return {
    start: task.window.start,
    secondsPerQuarter: 60 / task.tempoBpm,
    quartersPerBar: (task.meter.numerator * 4) / task.meter.denominator,
    bars: task.bars.length,
  };
}

const pitchedContexts = (task: TournamentTask): MusicalNote[][] =>
  task.contextTracks.filter((t) => !t.isPercussion).map((t) => t.notes);

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type PrefixAccount = ProviderAccount & {
  prefix: {
    /** Fields the expression carried, and as what. */
    expressed: Ca2PrefixExpression["expressed"];
    /** Fields the expression could not carry. */
    omitted: Ca2PrefixExpression["omitted"];
    notSentOnWire: WirePlan["notSentOnWire"];
    wire: Ca2WireInstructions;
    workerApplied: string[] | null;
    workerRefused: Array<{ item: unknown; why: string }> | null;
    inputTokens: number | null;
    inputSha256: string | null;
    /** Per instruction: requested vs realised on *this arm's* output. */
    controls: ControlCheck[];
  };
};

export type RoutedAccount = ProviderAccount & {
  routing: { family: string; decision: "on" | "off"; basis: string; seenInLearning: boolean };
};

function applyContext(task: TournamentTask, v2: PartGenerationRequestV2, absoluteNotes: readonly MusicalNote[]): ContextAwareResult {
  const base = absoluteNotes.map((n) => toWindowTime(n, task)).filter((n): n is MusicalNote => n !== null);
  const result = composeWithContext(v2, base, { beatSeconds: task.beatSeconds });
  return { ...result, notes: result.notes.map((n) => toAbsoluteTime(n, task)) };
}

// ---------------------------------------------------------------------------
// The prefix arms
// ---------------------------------------------------------------------------

export type Ca2PrefixProviderOptions = {
  endpoint: Ca2Endpoint;
  health: Ca2Health;
  loadMidi: (task: TournamentTask) => Promise<Uint8Array>;
  temperature?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

type PrefixInference = {
  notes: MusicalNote[];
  account: PrefixAccount | null;
  inferenceSeconds: number | null;
  failure: string | null;
  v2: PartGenerationRequestV2;
  plan: WirePlan;
};

/**
 * Both prefix arms over one shared inference per (task, seed). The
 * instructions come from `expressV2InCa2Vocabulary(v2)` unchanged — the
 * arm sends what the map says, it does not tune what the map says.
 */
export function createCa2PrefixProviders(options: Ca2PrefixProviderOptions): { prefix: TournamentProvider; prefixWithContext: TournamentProvider } {
  const cache = new Map<string, Promise<PrefixInference>>();

  const infer = (task: TournamentTask, seed: number): Promise<PrefixInference> => {
    const key = `${task.id}:${seed}`;
    let pending = cache.get(key);
    if (!pending) {
      pending = (async () => {
        const { v2 } = platformRequestFor(task, seed);
        const expression = expressV2InCa2Vocabulary(v2);
        const plan = wireFromExpression(expression);
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
              instructions: plan.wire,
            },
            options.health,
            options.fetchImpl ? { fetchImpl: options.fetchImpl } : {},
          );
          const adapted = adaptCa2Result(result, v2, { tempoBpm: task.tempoBpm, originSeconds: 0, idPrefix: `ca2p-${seed}` });
          if ("refusal" in adapted) {
            return { notes: [], account: null, inferenceSeconds: result.inference?.seconds ?? null, failure: adapted.refusal, v2, plan };
          }
          const account = prefixAccountFor(adapted.account, CA2_PREFIX_SUT, expression, plan, result, task, adapted.notes);
          return { notes: adapted.notes, account, inferenceSeconds: adapted.account.inferenceSeconds, failure: null, v2, plan };
        } catch (error) {
          return { notes: [], account: null, inferenceSeconds: null, failure: error instanceof Error ? error.message : String(error), v2, plan };
        }
      })();
      cache.set(key, pending);
    }
    return pending;
  };

  const prefix: TournamentProvider = {
    id: CA2_PREFIX_SUT,
    kind: "model",
    async generate(task, seed) {
      const { notes, account, inferenceSeconds, failure } = await infer(task, seed);
      return { notes, account, inferenceSeconds, failure };
    },
  };
  const prefixWithContext: TournamentProvider = {
    id: CA2_PREFIX_CONTEXT_SUT,
    kind: "model",
    async generate(task, seed) {
      const base = await infer(task, seed);
      if (base.failure) return { notes: [], account: base.account, inferenceSeconds: base.inferenceSeconds, failure: base.failure };
      const result = applyContext(task, base.v2, base.notes);
      const account: PrefixAccount | null = base.account
        ? {
            ...base.account,
            providerId: CA2_PREFIX_CONTEXT_SUT,
            enforced: [
              ...base.account.enforced,
              ...result.passes.map((pass) => ({ constraint: `context pass ${pass.id}: ${pass.note}`, affected: pass.changed })),
            ],
            prefix: {
              ...base.account.prefix,
              // Re-measured after the passes: what the listener would hear.
              controls: checkControls(base.plan.sent, base.plan.wire.loudness as number[], result.notes, measurementWindowFor(task), pitchedContexts(task)),
            },
          }
        : null;
      return { notes: result.notes, account, inferenceSeconds: base.inferenceSeconds, failure: null, passes: result.passes };
    },
  };
  return { prefix, prefixWithContext };
}

function prefixAccountFor(
  base: ProviderAccount,
  providerId: string,
  expression: Ca2PrefixExpression,
  plan: WirePlan,
  result: Ca2WorkerResult,
  task: TournamentTask,
  notes: readonly MusicalNote[],
): PrefixAccount {
  const worker = result.account?.instructions;
  return {
    ...base,
    providerId,
    prefix: {
      expressed: expression.expressed,
      omitted: expression.omitted,
      notSentOnWire: plan.notSentOnWire,
      wire: plan.wire,
      workerApplied: worker ? worker.applied.map((a) => a.token) : null,
      workerRefused: worker ? worker.refused : null,
      inputTokens: result.request?.inputTokens ?? null,
      inputSha256: result.request?.inputSha256 ?? null,
      controls: checkControls(plan.sent, plan.wire.loudness as number[], notes, measurementWindowFor(task), pitchedContexts(task)),
    },
  };
}

// ---------------------------------------------------------------------------
// The routed arm
// ---------------------------------------------------------------------------

/**
 * `COMPOSERS_ASSISTANT_2+CTX(routed)`: the raw arm's own result (its cache
 * makes this free), then the passes only where the learned rule says so.
 */
export function createRoutedContextProvider(options: { raw: TournamentProvider; rule: ContextRoutingRule }): TournamentProvider {
  return {
    id: CA2_ROUTED_SUT,
    kind: "model",
    async generate(task, seed): Promise<TournamentProviderResult> {
      const base = await options.raw.generate(task, seed);
      const route = routeContext(options.rule, task.targetFamily);
      const routing: RoutedAccount["routing"] = { family: task.targetFamily, decision: route.decision, basis: route.basis, seenInLearning: route.seen };
      if (base.failure) {
        return { notes: [], account: base.account ? { ...base.account, providerId: CA2_ROUTED_SUT, routing } as RoutedAccount : null, inferenceSeconds: base.inferenceSeconds, failure: base.failure };
      }
      if (!route.apply) {
        const account: RoutedAccount | null = base.account ? { ...base.account, providerId: CA2_ROUTED_SUT, routing } : null;
        return { notes: base.notes.map((n) => ({ ...n })), account, inferenceSeconds: base.inferenceSeconds, failure: null };
      }
      const { v2 } = platformRequestFor(task, seed);
      const result = applyContext(task, v2, base.notes);
      const account: RoutedAccount | null = base.account
        ? {
            ...base.account,
            providerId: CA2_ROUTED_SUT,
            enforced: [
              ...base.account.enforced,
              ...result.passes.map((pass) => ({ constraint: `context pass ${pass.id}: ${pass.note}`, affected: pass.changed })),
            ],
            routing,
          }
        : null;
      return { notes: result.notes, account, inferenceSeconds: base.inferenceSeconds, failure: null, passes: result.passes };
    },
  };
}

// ---------------------------------------------------------------------------
// Control-accuracy tables over a finished run
// ---------------------------------------------------------------------------

export type ControlAccuracyTable = {
  /** Per arm, per instruction kind. The prefix arm was asked; the others were not — they are the baseline. */
  byArm: Array<{ providerId: string; asked: boolean; rows: ControlAccuracyRow[] }>;
  /** Per family × arm: overall hit rate over every measurable check. */
  byFamily: Array<{ family: string; providerId: string; measurable: number; hits: number; hitRate: number | null }>;
  cells: number;
  note: string;
};

type EntryLike = {
  taskId: string; seed: number; providerId: string; failure: string | null;
  account: ProviderAccount | null; notes: readonly MusicalNote[];
};

/**
 * Re-measure every arm's output in each (task, seed) cell against the
 * instructions the prefix arm sent in that cell. `askedArms` are the arms
 * whose request carried the instructions; every other arm is a baseline that
 * happened to be measured against the same bins.
 */
export function controlAccuracyTable(
  entries: readonly EntryLike[],
  tasks: readonly TournamentTask[],
  askedArms: readonly string[] = [CA2_PREFIX_SUT, CA2_PREFIX_CONTEXT_SUT],
): ControlAccuracyTable {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const sentByCell = new Map<string, { sent: SentInstruction[]; loudness: number[] }>();
  for (const e of entries) {
    if (e.providerId !== askedArms[0] || !e.account) continue;
    const prefix = (e.account as PrefixAccount).prefix;
    if (!prefix) continue;
    sentByCell.set(`${e.taskId}:${e.seed}`, { sent: [...(prefix.wire.atEnd ?? []), ...(prefix.wire.perCell ?? [])], loudness: (prefix.wire.loudness as number[]) ?? [] });
  }
  const checksByArm = new Map<string, ControlCheck[]>();
  const byFamilyArm = new Map<string, { family: string; providerId: string; measurable: number; hits: number }>();
  for (const e of entries) {
    const cell = sentByCell.get(`${e.taskId}:${e.seed}`);
    const task = taskById.get(e.taskId);
    if (!cell || !task || e.failure) continue;
    const checks = checkControls(cell.sent, cell.loudness, e.notes, measurementWindowFor(task), pitchedContexts(task));
    checksByArm.set(e.providerId, [...(checksByArm.get(e.providerId) ?? []), ...checks]);
    const key = `${task.targetFamily}|${e.providerId}`;
    const agg = byFamilyArm.get(key) ?? { family: task.targetFamily, providerId: e.providerId, measurable: 0, hits: 0 };
    for (const c of checks) if (c.hit !== null) { agg.measurable += 1; if (c.hit) agg.hits += 1; }
    byFamilyArm.set(key, agg);
  }
  return {
    byArm: [...checksByArm.entries()].map(([providerId, checks]) => ({ providerId, asked: askedArms.includes(providerId), rows: summariseControls(checks) })),
    byFamily: [...byFamilyArm.values()].map((a) => ({ ...a, hitRate: a.measurable ? Number((a.hits / a.measurable).toFixed(4)) : null })),
    cells: sentByCell.size,
    note: "Every arm's output is measured against the bins the +PREFIX request carried in the same (task, seed) cell. Only the arms marked `asked` received them; the rest are the no-instruction baseline. Loudness has no realised value (CA2 emits no velocities).",
  };
}
