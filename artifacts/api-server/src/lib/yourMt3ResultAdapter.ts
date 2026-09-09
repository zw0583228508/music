/**
 * YourMT3+ — result adapter and registration proposal (PR-83, stream C).
 *
 * The platform half of the transcription adapter. The worker
 * (`services/yourmt3-worker`) returns notes in seconds with a General MIDI
 * program and a drum flag; this turns that into the shape
 * `analysisProviders.TranscriptionAnalysisResult` already speaks, attaches
 * provenance, and refuses anything that does not verify as the pinned
 * checkpoint.
 *
 * Three things it deliberately does **not** do.
 *
 *  1. **It does not change default routing.** `proposeYourMt3Registration`
 *     returns a *proposal* — a plain object describing what a registration
 *     would look like and what still blocks it. Promotion needs a benchmark
 *     the owner accepts and a licence answer this stream cannot give, and
 *     writing a router entry here would quietly grant both.
 *  2. **It does not apply musical constraint.** No quantisation, no key
 *     snapping, no minimum duration beyond dropping degenerate notes. The
 *     analysis reconciliation passes do that after, for every provider alike.
 *  3. **It does not collapse instruments.** The platform's melody shape has no
 *     program field, so a naive adapter silently throws away the one thing
 *     YourMT3 is better at than Basic Pitch. Instead the notes are returned
 *     grouped per instrument, and the flat `MelodyNote[]` the existing
 *     `TranscriptionAnalysisResult` wants is derived from the group a caller
 *     asks for — with the loss recorded, not hidden.
 */
import type { SongModelData } from "@workspace/db";
import { amtInstrumentClass, type AmtNote } from "./amtBenchmark";
import type { TranscriptionAnalysisResult } from "./analysisProviders";
import type { YourMt3Identity, YourMt3TranscribeResult, YourMt3WorkerNote } from "./yourMt3Client";

type MelodyNote = SongModelData["melody"][number];
type ProviderProvenance = SongModelData["providerProvenance"][number];

export const YOUR_MT3_PROVIDER_ID = "YOUR_MT3" as const;
/** The only weights this adapter accepts output from. */
export const YOUR_MT3_MODEL_REPO = "mimbres/YourMT3";
export const YOUR_MT3_MODEL_REVISION = "e45ebd70398682d54b7bb1901a5216e18f3b1824";
export const YOUR_MT3_CODE_REVISION = "5e66c1ea173a8186e0d20432b841d3180cc015b5";
/** `logs/2024/mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b80_ps2/checkpoints/model.ckpt` */
export const YOUR_MT3_MOE_SHA256 = "7427055b51c3c8c86f6a35493cf0741d8db29186052055b59193590a82e6ec01";

/**
 * A note the platform can reason about: seconds, pitch, instrument, and a
 * provenance-bearing id. It is deliberately *not* a `MelodyNote` — the melody
 * shape has no instrument field, and widening it here would be the exact
 * silent loss this adapter exists to make visible.
 */
export type TranscribedNote = {
  id: string;
  start: number;
  end: number;
  duration: number;
  pitch: number;
  velocity: number;
  /** The model's own confidence, when it reports one. YourMT3 does not, so this is 1 by construction and says so in the account. */
  confidence: number;
  source: string;
  /** General MIDI program 0-127; meaningless when `isDrum`. */
  program: number;
  isDrum: boolean;
  /** The platform's GM family bucket — `keys`, `bass`, `drums`, … */
  instrumentClass: string;
};

export type YourMt3AdaptOptions = {
  /** Stable id prefix so every note is traceable to the run that made it. */
  idPrefix?: string;
  /** Seconds to add to every onset, when the clip is a window of a longer song. */
  originSeconds?: number;
  /** Notes shorter than this are decoder noise rather than performance. Default 10 ms. */
  minimumDurationSeconds?: number;
};

/** Why a worker result may not become platform evidence, or null when it may. */
export function yourMt3ResultRefusal(result: YourMt3TranscribeResult): string | null {
  if (!result || typeof result !== "object") return "result is not an object";
  if (!Array.isArray(result.notes)) return "result carries no notes array";
  const identity: YourMt3Identity | undefined = result.identity;
  if (identity) {
    if (identity.provider && identity.provider !== YOUR_MT3_PROVIDER_ID) {
      return `worker serves ${identity.provider}, not ${YOUR_MT3_PROVIDER_ID}`;
    }
    if (identity.modelRevision && identity.modelRevision !== YOUR_MT3_MODEL_REVISION) {
      return `worker model revision ${identity.modelRevision.slice(0, 12)} is not the audited ${YOUR_MT3_MODEL_REVISION.slice(0, 12)}`;
    }
    if (identity.codeRevision && identity.codeRevision !== YOUR_MT3_CODE_REVISION) {
      return `worker code revision ${identity.codeRevision.slice(0, 12)} is not the audited ${YOUR_MT3_CODE_REVISION.slice(0, 12)}`;
    }
    if (identity.checkpoints && identity.checkpoints.verified === false) {
      return "worker could not verify its checkpoint checksums";
    }
    const moe = identity.checkpoints?.checkpoints?.["YPTF.MoE+Multi"];
    if (moe?.sha256 && moe.sha256 !== YOUR_MT3_MOE_SHA256) {
      return `worker's YPTF.MoE+Multi checkpoint hashes to ${moe.sha256.slice(0, 12)}…, not the audited ${YOUR_MT3_MOE_SHA256.slice(0, 12)}…`;
    }
  }
  return null;
}

/** Worker notes → the benchmark's note shape, so the metric module can grade them unchanged. */
export function yourMt3NotesToAmtNotes(notes: readonly YourMt3WorkerNote[]): AmtNote[] {
  return notes.map((note) => ({
    onset: note.onset,
    offset: note.offset,
    pitch: note.pitch,
    program: note.isDrum ? 0 : note.program,
    isDrum: Boolean(note.isDrum),
  }));
}

/**
 * Worker notes → platform notes, keeping the instrument.
 *
 * Degenerate notes are dropped and counted rather than silently kept: a
 * zero-length note is a decoder artefact, and one that survives into a Song
 * Model becomes a click in an export.
 */
export function yourMt3NotesToTranscribedNotes(
  notes: readonly YourMt3WorkerNote[],
  options: YourMt3AdaptOptions = {},
): { notes: TranscribedNote[]; droppedDegenerate: number } {
  const prefix = options.idPrefix ?? "yourmt3";
  const origin = options.originSeconds ?? 0;
  const minimum = options.minimumDurationSeconds ?? 0.01;
  const out: TranscribedNote[] = [];
  let droppedDegenerate = 0;
  for (const note of notes) {
    const duration = note.offset - note.onset;
    if (!Number.isFinite(duration) || duration < minimum) {
      droppedDegenerate += 1;
      continue;
    }
    const program = note.isDrum ? 0 : note.program;
    const start = Number((note.onset + origin).toFixed(6));
    out.push({
      id: `${prefix}:${out.length}`,
      start,
      end: Number((note.offset + origin).toFixed(6)),
      duration: Number(duration.toFixed(6)),
      pitch: note.pitch,
      // The model emits no dynamics; a fabricated velocity would read as
      // performance data downstream. 80 is the platform's neutral default and
      // is recorded as "not measured" in the account below.
      velocity: 80,
      // YourMT3 emits no per-note confidence. Reporting anything but 1 would
      // be inventing a number; the account says it was not measured.
      confidence: 1,
      source: YOUR_MT3_PROVIDER_ID,
      program,
      isDrum: Boolean(note.isDrum),
      instrumentClass: amtInstrumentClass({ program, isDrum: Boolean(note.isDrum) }),
    });
  }
  out.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  return { notes: out, droppedDegenerate };
}

export type YourMt3Adaptation = {
  providerId: typeof YOUR_MT3_PROVIDER_ID;
  version: string;
  /** Every note, with its instrument. This is the output that is worth having. */
  notes: TranscribedNote[];
  /** Notes grouped by the platform's GM family bucket. */
  byInstrumentClass: Array<{ instrumentClass: string; notes: TranscribedNote[] }>;
  /**
   * The flat shape `TranscriptionAnalysisResult.notes` declares today. It
   * cannot carry an instrument, so producing it is lossy — see `informationLoss`.
   */
  melody: MelodyNote[];
  provenance: ProviderProvenance;
  account: {
    workerNotes: number;
    adaptedNotes: number;
    droppedDegenerate: number;
    instrumentClasses: string[];
    /** Wall-clock seconds the worker reported for this clip. */
    inferenceSeconds: number | null;
    realtimeFactor: number | null;
    informationLoss: string[];
    identity: YourMt3Identity | null;
  };
};

/** The full adaptation: refuse, convert, account. Throws on a refusal rather than returning half a result. */
export function adaptYourMt3Result(
  result: YourMt3TranscribeResult,
  options: YourMt3AdaptOptions & { melodyInstrumentClass?: string } = {},
): YourMt3Adaptation {
  const refusal = yourMt3ResultRefusal(result);
  if (refusal) throw new Error(`YourMT3 result refused: ${refusal}`);
  const { notes, droppedDegenerate } = yourMt3NotesToTranscribedNotes(result.notes, options);

  const grouped = new Map<string, TranscribedNote[]>();
  for (const note of notes) {
    const bucket = grouped.get(note.instrumentClass);
    if (bucket) bucket.push(note);
    else grouped.set(note.instrumentClass, [note]);
  }
  const byInstrumentClass = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([instrumentClass, group]) => ({ instrumentClass, notes: group }));

  // Which class becomes the flat melody: the caller's choice, else the most
  // populated non-drum class. Drums are never a melody.
  const requested = options.melodyInstrumentClass;
  const melodySource =
    (requested ? byInstrumentClass.find((g) => g.instrumentClass === requested) : undefined) ??
    byInstrumentClass.find((g) => g.instrumentClass !== "drums") ??
    byInstrumentClass[0];
  const melody: MelodyNote[] = (melodySource?.notes ?? []).map((note) => ({
    start: note.start,
    end: note.end,
    pitch: note.pitch,
    velocity: note.velocity,
    confidence: note.confidence,
    source: note.source,
  }));

  const informationLoss: string[] = [
    "velocity is not measured by this model; every note carries the platform's neutral 80",
    "the model reports no per-note confidence; every note carries 1, which means 'not measured', not 'certain'",
    "the melody shape has no id field, so the traceable per-note ids survive only on `notes`/`byInstrumentClass`",
  ];
  if (melodySource && notes.length > melody.length) {
    informationLoss.push(
      `the flat melody shape carries only the ${melodySource.instrumentClass} notes (${melody.length} of ${notes.length}); the other ${byInstrumentClass.length - 1} instrument class(es) exist only on \`notes\`/\`byInstrumentClass\``,
    );
  }
  if (droppedDegenerate > 0) {
    informationLoss.push(`${droppedDegenerate} note(s) shorter than the minimum duration were dropped as decoder artefacts`);
  }

  const identity = result.identity ?? null;
  const verified = identity?.checkpoints?.verified === true;
  return {
    providerId: YOUR_MT3_PROVIDER_ID,
    version: `${result.variant}@${(identity?.modelRevision ?? YOUR_MT3_MODEL_REVISION).slice(0, 12)}`,
    notes,
    byInstrumentClass,
    melody,
    provenance: {
      capability: "transcription",
      provider: YOUR_MT3_PROVIDER_ID,
      version: `${result.variant}@${(identity?.modelRevision ?? YOUR_MT3_MODEL_REVISION).slice(0, 12)}`,
      // A result whose checkpoints the container could not verify is evidence
      // of a run, not evidence of a model. It is never "ready".
      status: verified ? "ready" : "fallback",
    },
    account: {
      workerNotes: result.notes.length,
      adaptedNotes: notes.length,
      droppedDegenerate,
      instrumentClasses: byInstrumentClass.map((g) => g.instrumentClass),
      inferenceSeconds: result.seconds?.total ?? null,
      realtimeFactor: result.realtimeFactor ?? null,
      informationLoss,
      identity,
    },
  };
}

/**
 * The adaptation narrowed to the shape `analysisProviders` already declares.
 *
 * This exists so "`analysisProviders.ts`-compatible" is a compile-time fact
 * rather than a claim in a document: the return type is
 * `TranscriptionAnalysisResult` verbatim, so if that type moves, this breaks.
 *
 * It is intentionally the *lossy* view — `TranscriptionAnalysisResult.notes`
 * is a flat `MelodyNote[]` with no instrument — and nothing in the pipeline
 * calls it yet. Use `adaptYourMt3Result` and read `byInstrumentClass` when you
 * want what the model actually produced.
 */
export function toTranscriptionAnalysisResult(
  adaptation: YourMt3Adaptation,
): TranscriptionAnalysisResult {
  return {
    providerId: YOUR_MT3_PROVIDER_ID,
    version: adaptation.version,
    notes: adaptation.melody,
    // Not a model score: YourMT3 emits no confidence. This is the container's
    // verification state expressed as the field's type demands — 1 when the
    // checkpoints hashed correctly, 0 when they did not.
    confidence: adaptation.provenance.status === "ready" ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Registration proposal — a description, not a routing change
// ---------------------------------------------------------------------------

export type ProviderRegistrationProposal = {
  providerId: string;
  capability: "transcription";
  /** What the entry would look like in `analysisProviders`. */
  proposed: {
    urlEnv: string;
    tokenEnv: string;
    defaultVariant: string;
    resultType: "TranscriptionAnalysisResult";
    adapter: string;
  };
  /** What the router should do today. */
  routing: "no_change";
  /** Everything that must be true before `routing` may become anything else. */
  blockers: string[];
  /** What is already true. */
  satisfied: string[];
};

/**
 * What a `YOUR_MT3` registration would look like, and what still blocks it.
 *
 * This function returns data. It does not register anything, and nothing in
 * this module imports the router — a promotion has to be somebody's explicit
 * decision, made against a benchmark, and this stream was not given that grant.
 */
export function proposeYourMt3Registration(evidence: {
  /** Instrument-aware onset F1 measured here, on our benchmark. */
  measuredF1: number;
  /** The incumbent it was measured against, and its F1. */
  incumbent: { name: string; f1: number };
  /** Tier of the benchmark the numbers come from. */
  tier: string;
  /** Has a real-audio, human-verified tier been measured? */
  realAudioTierMeasured: boolean;
  /** Has counsel resolved the code-licence conflict? */
  codeLicenceResolved: boolean;
  /** Have the training-corpus terms been read? */
  trainingDataTermsRead: boolean;
}): ProviderRegistrationProposal {
  const blockers: string[] = [];
  const satisfied: string[] = [];

  if (evidence.measuredF1 > evidence.incumbent.f1) {
    satisfied.push(
      `beats ${evidence.incumbent.name} on our own ${evidence.tier} benchmark (${evidence.incumbent.f1} → ${evidence.measuredF1} instrument-aware onset F1)`,
    );
  } else {
    blockers.push(
      `does not beat ${evidence.incumbent.name} on our own benchmark (${evidence.incumbent.f1} vs ${evidence.measuredF1})`,
    );
  }
  if (evidence.realAudioTierMeasured) satisfied.push("measured on a real-audio tier with human-verified notes");
  else blockers.push(`only measured on ${evidence.tier}; a synthetic-timbre tier cannot predict behaviour on a user's recording`);

  if (evidence.codeLicenceResolved) satisfied.push("code licence resolved by counsel");
  else blockers.push("code licence unresolved: GitHub LICENSE says GPL-3.0, the Hugging Face Space card and the source headers say Apache-2.0");

  if (evidence.trainingDataTermsRead) satisfied.push("training-corpus terms read");
  else blockers.push("training-corpus terms unread (Slakh2100, MAESTRO, MusicNet, RWC-Pop, MIR-ST500, ENST-Drums and others carry different and partly research-only terms)");

  return {
    providerId: YOUR_MT3_PROVIDER_ID,
    capability: "transcription",
    proposed: {
      urlEnv: "YOURMT3_API_URL",
      tokenEnv: "YOURMT3_API_TOKEN",
      // Not the 2025 AMT Challenge's higher-ranked variant. On our own
      // benchmark the 3rd-place `YPTF+Single` beat the 2nd-place
      // `YPTF.MoE+Multi` on instrument-aware F1 (0.2596 vs 0.2414), on
      // pitch-only F1, on recall for both, and on macro F1 — at half the
      // checkpoint size. The published order does not reproduce on our audio,
      // which is the entire reason this platform measures rather than quotes.
      defaultVariant: "YPTF+Single",
      resultType: "TranscriptionAnalysisResult",
      adapter: "yourMt3ResultAdapter.adaptYourMt3Result",
    },
    routing: "no_change",
    blockers,
    satisfied,
  };
}
