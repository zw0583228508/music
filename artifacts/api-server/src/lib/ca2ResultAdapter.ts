/**
 * Composer's Assistant 2 — result adapter (Wave Q — Model Discovery, item 10).
 *
 * The platform half of the CA2 adapter. The worker (`services/composers-assistant-worker`)
 * returns notes in **quarter-note time** relative to the song start, plus the
 * task it actually performed and its own account of what it received. This
 * converts that into the platform's `MusicalNote[]` in **seconds**, attaches
 * the `ProviderAccount` PR-56 requires, and refuses anything that does not
 * verify as the pinned model.
 *
 * It deliberately applies **no musical constraint**. Range, polyphony, the Q-04
 * plan, the vocal-space pass and locked material are the platform's
 * `contextAwareComposer` passes, so CA2 is judged after the same enforcement as
 * every other provider — that is what makes a tournament fair.
 */
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";
import {
  CA2_POST_GENERATION_ENFORCEMENTS,
  describeInformationLoss,
  projectV2ForComposersAssistant2,
  type ProviderAccount,
  type SymbolicGenerationResult,
} from "./symbolicGenerationProvider";

export const CA2_PROVIDER_ID = "COMPOSERS_ASSISTANT_2";
/** The only weights this adapter accepts output from. */
export const CA2_LARGE_MODEL_SHA256 = "297bccb173b4497a3c3b6007422506dced88fd9f99f5c8a18481dedd9667d530";
export const CA2_RELEASE_TAG = "v2.1.0";

/** One note as the worker emits it. */
export type Ca2WorkerNote = {
  measure: number;
  pitch: number;
  startQn: number;
  endQn: number;
  velocity: number;
  isDrum: boolean;
};

/** The subset of the worker's response this adapter reads. */
export type Ca2WorkerResult = {
  provider: string;
  seed: number;
  failure?: string;
  task?: {
    targetTrack: number;
    targetInst: number;
    measureSlice: [number, number];
    maskLocations: number;
    heldOutHumanNotes: number;
  };
  inference?: { seconds: number; outputTokens: number; device: string };
  output?: { generatedNotes: number; notes: Ca2WorkerNote[] };
  /** From `/health`, forwarded by the caller. */
  identity?: { modelBinVerified?: boolean; modelBinSha256Expected?: string; release?: string };
  definitionOfDone?: { realSymbolicOutput: boolean; verdict: string };
};

export type Ca2AdaptOptions = {
  /** Beats per minute the song runs at; converts quarter-note time to seconds. */
  tempoBpm: number;
  /** Absolute seconds of quarter-note 0. Defaults to 0. */
  originSeconds?: number;
  /** Stable id prefix so notes are traceable to the run. */
  idPrefix?: string;
};

/** Why a worker result may not become a candidate, or null when it may. */
export function ca2ResultRefusal(result: Ca2WorkerResult): string | null {
  if (result.provider !== CA2_PROVIDER_ID) return `result is from ${result.provider}, not ${CA2_PROVIDER_ID}`;
  if (result.failure) return `worker reported failure: ${result.failure}`;
  if (result.identity) {
    if (result.identity.modelBinVerified === false) return "worker could not verify the model checksum";
    if (result.identity.modelBinSha256Expected && result.identity.modelBinSha256Expected !== CA2_LARGE_MODEL_SHA256) {
      return `worker is pinned to ${result.identity.modelBinSha256Expected.slice(0, 12)}…, not the audited ${CA2_LARGE_MODEL_SHA256.slice(0, 12)}…`;
    }
    if (result.identity.release && result.identity.release !== CA2_RELEASE_TAG) {
      return `worker release ${result.identity.release} is not the audited ${CA2_RELEASE_TAG}`;
    }
  }
  if (!result.task || !result.output) return "result carries no task or no output";
  if (!Array.isArray(result.output.notes)) return "result output has no notes array";
  return null;
}

/**
 * Worker notes to platform notes. Quarter-note time × (60 / bpm) = seconds.
 * A note that ends before it starts, or lies outside 0..127, is dropped and
 * counted — the worker's decode should never emit one, so a non-zero count is
 * itself a finding.
 */
export function ca2NotesToMusicalNotes(
  notes: readonly Ca2WorkerNote[],
  options: Ca2AdaptOptions,
): { notes: MusicalNote[]; dropped: number } {
  const secondsPerQn = 60 / Math.max(1, options.tempoBpm);
  const origin = options.originSeconds ?? 0;
  const prefix = options.idPrefix ?? "ca2";
  let dropped = 0;
  const out: MusicalNote[] = [];
  notes.forEach((note, index) => {
    const duration = (note.endQn - note.startQn) * secondsPerQn;
    if (!(duration > 0) || note.pitch < 0 || note.pitch > 127) {
      dropped += 1;
      return;
    }
    out.push({
      id: `${prefix}-${note.measure}-${index}`,
      start: Number((origin + note.startQn * secondsPerQn).toFixed(4)),
      duration: Number(duration.toFixed(4)),
      pitch: Math.round(note.pitch),
      velocity: Math.max(1, Math.min(127, Math.round(note.velocity))),
    });
  });
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notes: out, dropped };
}

/** A few numbers that say whether the output is music or a stuck token. */
export function ca2OutputDiagnostics(notes: readonly Ca2WorkerNote[]): {
  noteCount: number;
  distinctPitches: number;
  pitchRange: [number, number] | null;
  measuresWithNotes: number;
  /** True when every note is one pitch — a repetition collapse, not a part. */
  singlePitch: boolean;
} {
  const pitches = new Set(notes.map((n) => n.pitch));
  return {
    noteCount: notes.length,
    distinctPitches: pitches.size,
    pitchRange: notes.length ? [Math.min(...pitches), Math.max(...pitches)] : null,
    measuresWithNotes: new Set(notes.map((n) => n.measure)).size,
    singlePitch: notes.length > 0 && pitches.size === 1,
  };
}

/**
 * The full adaptation: refuse, convert, account. The account's dispositions
 * come from the same projection PR-56 declared, so what the tournament records
 * is what the contract promised — not a per-run story.
 */
export function adaptCa2Result(
  result: Ca2WorkerResult,
  request: PartGenerationRequestV2,
  options: Ca2AdaptOptions,
): SymbolicGenerationResult | { refusal: string } {
  const refusal = ca2ResultRefusal(result);
  if (refusal) return { refusal };
  const converted = ca2NotesToMusicalNotes(result.output!.notes, options);
  const dispositions = projectV2ForComposersAssistant2(request);
  const diagnostics = ca2OutputDiagnostics(result.output!.notes);
  const account: ProviderAccount = {
    providerId: CA2_PROVIDER_ID,
    modelRevision: `${CA2_RELEASE_TAG}:${CA2_LARGE_MODEL_SHA256.slice(0, 12)}`,
    dispositions,
    enforced: [
      // Nothing is enforced here by design; the platform passes do it after.
      ...CA2_POST_GENERATION_ENFORCEMENTS.map((constraint) => ({ constraint, affected: 0 })),
      { constraint: "dropped malformed worker notes (non-positive duration or pitch outside 0..127)", affected: converted.dropped },
    ],
    informationLoss:
      describeInformationLoss(dispositions) +
      (diagnostics.singlePitch
        ? ` Diagnostics: the output is a single pitch (${diagnostics.pitchRange?.[0]}) across ${diagnostics.measuresWithNotes} measure(s) — a repetition collapse, not a voiced part.`
        : ` Diagnostics: ${diagnostics.distinctPitches} distinct pitches over ${diagnostics.measuresWithNotes} measure(s).`),
    inferenceSeconds: result.inference?.seconds ?? null,
    seed: result.seed,
  };
  return { notes: converted.notes, account };
}
