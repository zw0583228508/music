/**
 * Anticipatory Music Transformer — result adapter (Wave Q — Model Discovery,
 * round 2). The platform half of the AMT adapter, on the CA2 pattern.
 *
 * The worker (`services/anticipatory-worker`) returns notes in quarter-note
 * time and in seconds under the file's first tempo, the task it actually
 * performed, its sampling statistics and its own account. This converts that
 * into the platform's `MusicalNote[]` in **seconds**, attaches the
 * `ProviderAccount` PR-56 requires, and refuses anything that does not verify
 * as the pinned checkpoint.
 *
 * It deliberately applies **no musical constraint**: the platform's
 * `contextAwareComposer` passes do that after, for every provider alike.
 *
 * The provider is RESEARCH_ONLY. This adapter can feed a tournament arm and an
 * evidence file; it must never be reachable from a user-facing route, and the
 * `SHADOW_CHALLENGER` role is the ceiling of what it may be.
 */
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";
import { AMT_POST_GENERATION_ENFORCEMENTS, projectV2ForAnticipatoryMusicTransformer } from "./anticipatoryProjection";
import { describeInformationLoss, type ProviderAccount, type SymbolicGenerationResult } from "./symbolicGenerationProvider";

export const AMT_PROVIDER_ID = "ANTICIPATORY_MUSIC_TRANSFORMER";
/** The only weights this adapter accepts output from. */
export const AMT_MODEL_ID = "stanford-crfm/music-large-800k";
export const AMT_MODEL_REVISION = "e206a88d4658661c2757573eae724d5b27213824";
export const AMT_SAFETENSORS_SHA256 = "83fb8b9546eacce77a90bb10006b3f569ba342361dce046d078cf2429975e09f";

/** One note as the worker emits it. */
export type AmtWorkerNote = {
  measure: number;
  pitch: number;
  startSec: number;
  endSec: number;
  startQn: number;
  endQn: number;
  velocity: number;
  isDrum: boolean;
};

/** The subset of the worker's response this adapter reads. */
export type AmtWorkerResult = {
  provider: string;
  seed: number;
  model?: string;
  revision?: string;
  failure?: string;
  task?: {
    targetInst: number;
    measureSlice: [number, number];
    windowSeconds: [number, number];
    heldOutHumanNotes: number;
    contextNotesInWindow: number;
  };
  inference?: {
    seconds: number;
    mode?: string;
    forwardPasses?: number;
    generatedEvents?: number;
    /** Events the model spent saying "not here"; only possible when `allowRest`. */
    restEvents?: number;
    /** Pitches the decode refused to let it repeat at an onset it had already used. */
    duplicatesBlocked?: number;
    allowRest?: boolean;
    forbidDuplicate?: boolean;
    maskInstrument?: boolean;
    truncatedByEventCap?: boolean;
    historyTruncatedToMarkovWindow?: boolean;
    device: string;
    topP?: number;
  };
  output?: { generatedNotes: number; offTargetEventsDropped?: number; notes: AmtWorkerNote[] };
  /** From `/health`, forwarded by the caller. */
  identity?: { modelSafetensorsVerified?: boolean; modelSafetensorsSha256Expected?: string; revision?: string; model?: string };
  definitionOfDone?: { realSymbolicOutput: boolean; verdict: string };
};

export type AmtAdaptOptions = {
  /** Beats per minute the task runs at; converts quarter-note time to seconds. */
  tempoBpm: number;
  /** Absolute seconds of quarter-note 0. Defaults to 0. */
  originSeconds?: number;
  /** Stable id prefix so notes are traceable to the run. */
  idPrefix?: string;
};

/** Why a worker result may not become a candidate, or null when it may. */
export function amtResultRefusal(result: AmtWorkerResult): string | null {
  if (result.provider !== AMT_PROVIDER_ID) return `result is from ${result.provider}, not ${AMT_PROVIDER_ID}`;
  if (result.failure) return `worker reported failure: ${result.failure}`;
  if (result.identity) {
    if (result.identity.modelSafetensorsVerified === false) return "worker could not verify the checkpoint checksum";
    if (result.identity.modelSafetensorsSha256Expected && result.identity.modelSafetensorsSha256Expected !== AMT_SAFETENSORS_SHA256) {
      return `worker is pinned to ${result.identity.modelSafetensorsSha256Expected.slice(0, 12)}…, not the audited ${AMT_SAFETENSORS_SHA256.slice(0, 12)}…`;
    }
    if (result.identity.revision && result.identity.revision !== AMT_MODEL_REVISION) {
      return `worker revision ${result.identity.revision.slice(0, 12)} is not the audited ${AMT_MODEL_REVISION.slice(0, 12)}`;
    }
    if (result.identity.model && result.identity.model !== AMT_MODEL_ID) {
      return `worker serves ${result.identity.model}, not the audited ${AMT_MODEL_ID}`;
    }
  }
  if (result.model && result.model !== AMT_MODEL_ID) return `result is from ${result.model}, not the audited ${AMT_MODEL_ID}`;
  if (!result.task || !result.output) return "result carries no task or no output";
  if (!Array.isArray(result.output.notes)) return "result output has no notes array";
  return null;
}

/**
 * Worker notes to platform notes. Quarter-note time × (60 / bpm) = seconds —
 * the same rule as the CA2 adapter, so both challengers land on the task's
 * time base identically. A note that ends before it starts, or lies outside
 * 0..127, is dropped and counted.
 */
export function amtNotesToMusicalNotes(
  notes: readonly AmtWorkerNote[],
  options: AmtAdaptOptions,
): { notes: MusicalNote[]; dropped: number } {
  const secondsPerQn = 60 / Math.max(1, options.tempoBpm);
  const origin = options.originSeconds ?? 0;
  const prefix = options.idPrefix ?? "amt";
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
export function amtOutputDiagnostics(notes: readonly AmtWorkerNote[]): {
  noteCount: number;
  distinctPitches: number;
  pitchRange: [number, number] | null;
  measuresWithNotes: number;
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

/** The full adaptation: refuse, convert, account. */
export function adaptAmtResult(
  result: AmtWorkerResult,
  request: PartGenerationRequestV2,
  options: AmtAdaptOptions,
): SymbolicGenerationResult | { refusal: string } {
  const refusal = amtResultRefusal(result);
  if (refusal) return { refusal };
  const converted = amtNotesToMusicalNotes(result.output!.notes, options);
  const dispositions = projectV2ForAnticipatoryMusicTransformer(request);
  const diagnostics = amtOutputDiagnostics(result.output!.notes);
  const sampling = result.inference;
  const samplingNote = sampling
    ? ` Sampling: ${sampling.mode ?? "?"} mode, ${sampling.forwardPasses ?? "?"} forward passes for ${sampling.generatedEvents ?? "?"} note events${sampling.restEvents ? ` and ${sampling.restEvents} rests` : ""}${sampling.truncatedByEventCap ? ", stopped by the event cap" : ""}${sampling.historyTruncatedToMarkovWindow ? ", history truncated to the 341-event window" : ""}.`
    : "";
  const account: ProviderAccount = {
    providerId: AMT_PROVIDER_ID,
    modelRevision: `${AMT_MODEL_ID}@${AMT_MODEL_REVISION.slice(0, 12)}:${AMT_SAFETENSORS_SHA256.slice(0, 12)}`,
    dispositions,
    enforced: [
      {
        constraint: sampling?.maskInstrument
          ? "instrument mask on the note slot (worker): only the held-out GM program could be sampled"
          : "no instrument mask (worker): sampled unmasked in upstream's accompaniment framing, then filtered to the held-out GM program",
        affected: result.output!.offTargetEventsDropped ?? 0,
      },
      {
        constraint: sampling?.allowRest === false
          ? "REST banned at the note slot (worker): the model may not answer 'not here' inside the window"
          : "REST kept available at the note slot (worker): the model may answer 'not here'",
        affected: sampling?.restEvents ?? 0,
      },
      {
        constraint: sampling?.forbidDuplicate === false
          ? "repeat of a pitch at an onset already carrying it: allowed (worker)"
          : "repeat of a pitch at an onset already carrying it: banned (worker) — a second identical note at an identical onset is a decode loop, not a musical decision",
        affected: sampling?.duplicatesBlocked ?? 0,
      },
      ...AMT_POST_GENERATION_ENFORCEMENTS.map((constraint) => ({ constraint, affected: 0 })),
      { constraint: "dropped malformed worker notes (non-positive duration or pitch outside 0..127)", affected: converted.dropped },
    ],
    informationLoss:
      describeInformationLoss(dispositions) +
      (diagnostics.singlePitch
        ? ` Diagnostics: the output is a single pitch (${diagnostics.pitchRange?.[0]}) across ${diagnostics.measuresWithNotes} measure(s) — a repetition collapse, not a voiced part.`
        : ` Diagnostics: ${diagnostics.distinctPitches} distinct pitches over ${diagnostics.measuresWithNotes} measure(s).`) +
      samplingNote,
    inferenceSeconds: result.inference?.seconds ?? null,
    seed: result.seed,
  };
  return { notes: converted.notes, account };
}
