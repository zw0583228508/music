/**
 * Canonical adapter layer for symbolic generation models (Wave Q — Model
 * Discovery, item 10).
 *
 * Every external model that writes notes enters the platform through this one
 * contract, so the tournament compares like with like and so a model can never
 * be presented as understanding more than it was given. The input is a
 * projection of `PartGenerationRequestV2`; the output is `MusicalNote[]` plus
 * an **honest account of the projection**:
 *
 *  - `received`   — the fields the model actually consumed;
 *  - `unsupported`— the fields it has no way to accept, listed by name;
 *  - `enforced`   — constraints applied to its output after generation;
 *  - `informationLoss` — a plain statement of what the model never saw.
 *
 * The account is not optional and cannot be empty for a model that ignores
 * part of the request. A model that "supports StyleGrammar" by silently
 * dropping it is exactly the misrepresentation this layer exists to prevent.
 */
import type { MusicalNote } from "@workspace/db";
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";

/** Every field of the V2 request a model could, in principle, be given. */
export const V2_CONTEXT_FIELDS = [
  "songModel.chords",
  "songModel.melody",
  "songModel.bass",
  "section",
  "phrases",
  "siblingParts.notes",
  "styleGrammar",
  "harmonyPlan",
  "vocalAttentionMap",
  "motifMemory",
  "previousSectionSummary",
  "nextSectionIntent",
  "instrument",
  "role",
  "hardConstraints.range",
  "hardConstraints.polyphony",
  "softConstraints",
  "lockedMaterial",
  "candidateStrategy.seed",
  "productionBriefRef",
] as const;

export type V2ContextField = (typeof V2_CONTEXT_FIELDS)[number];

/** How a field reached the model, if at all. */
export type FieldDisposition =
  | { field: V2ContextField; status: "received"; as: string }
  | { field: V2ContextField; status: "approximated"; as: string; lost: string }
  | { field: V2ContextField; status: "unsupported"; reason: string };

export type PostGenerationEnforcement = {
  constraint: string;
  /** How many notes it changed or removed. Zero is a result. */
  affected: number;
};

export type ProviderAccount = {
  providerId: string;
  /** The exact model revision / checksum this output came from. */
  modelRevision: string;
  dispositions: FieldDisposition[];
  enforced: PostGenerationEnforcement[];
  /** One paragraph, in words, of what the model never saw. Never empty when anything is unsupported. */
  informationLoss: string;
  inferenceSeconds: number | null;
  seed: number | null;
};

export type SymbolicGenerationResult = {
  notes: MusicalNote[];
  account: ProviderAccount;
};

export interface SymbolicGenerationProvider {
  readonly id: string;
  /** Static: what this model can and cannot be given. Used to build the account before any call. */
  project(request: PartGenerationRequestV2): FieldDisposition[];
  /** Real inference. Must return an account whose dispositions match `project()`. */
  generate(request: PartGenerationRequestV2, options?: { seed?: number }): Promise<SymbolicGenerationResult>;
}

/** The fields a projection left out, for the account and for the tests. */
export const unsupportedFields = (dispositions: readonly FieldDisposition[]): V2ContextField[] =>
  dispositions.filter((d) => d.status === "unsupported").map((d) => d.field);

/**
 * Every V2 field must be accounted for, one way or another. A projection that
 * is silent about a field is treated as having dropped it, and this says so.
 */
export function completeDispositions(partial: readonly FieldDisposition[]): FieldDisposition[] {
  const seen = new Set(partial.map((d) => d.field));
  const missing: FieldDisposition[] = V2_CONTEXT_FIELDS
    .filter((f) => !seen.has(f))
    .map((field) => ({ field, status: "unsupported", reason: "not mentioned by the adapter's projection — treated as dropped" }));
  return [...partial, ...missing];
}

/** Words for the account, derived from the dispositions so they cannot disagree. */
export function describeInformationLoss(dispositions: readonly FieldDisposition[]): string {
  const dropped = dispositions.filter((d) => d.status === "unsupported");
  const approx = dispositions.filter((d) => d.status === "approximated");
  if (!dropped.length && !approx.length) return "The model received the full V2 context.";
  const parts: string[] = [];
  if (dropped.length) {
    parts.push(`The model never saw: ${dropped.map((d) => d.field).join(", ")}.`);
  }
  if (approx.length) {
    parts.push(
      `Approximated: ${approx
        .map((d) => `${d.field} as ${(d as { as: string }).as} (lost: ${(d as { lost: string }).lost})`)
        .join("; ")}.`,
    );
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Composer's Assistant 2 — the projection, stated before any adapter runs
// ---------------------------------------------------------------------------

/**
 * What CA2 can be told, from its own source: per-track GM instrument (;I:),
 * span masks per (track, measure) (;<extra_id_n>), 512 numeric control
 * instructions (onset density, pitch-class count, step/leap probability,
 * irregularity, strict/loose lowest/highest note), BPM and loudness levels,
 * and the other tracks' notes as context. Nothing else has a token.
 */
export function projectV2ForComposersAssistant2(request: PartGenerationRequestV2): FieldDisposition[] {
  const hasSiblings = request.siblingParts.some((p) => p.notes.length > 0);
  const partial: FieldDisposition[] = [
    { field: "siblingParts.notes", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings ? { as: "the unmasked tracks of the MidiSongByMeasure" } : { reason: "no sibling notes were available to give" }) } as FieldDisposition,
    { field: "instrument", status: "received", as: "per-track ;I:<gm program> token" },
    { field: "hardConstraints.range", status: "received", as: "lowest/highest_note_strict instructions" },
    { field: "hardConstraints.polyphony", status: "approximated", as: "vert_note_onset_density instruction bin (0..4+)", lost: "the exact maxSimultaneousNotes ceiling; enforced after generation instead" },
    { field: "softConstraints", status: "approximated", as: "pitch_step_prob / pitch_leap_prob / horiz_note_onset_density bins", lost: "weights and any constraint outside those measurements" },
    { field: "candidateStrategy.seed", status: "received", as: "torch.manual_seed before generate()" },
    { field: "songModel.chords", status: "approximated", as: "implicit in the sibling tracks' notes", lost: "chord symbols, roman numerals and harmonic function — CA2 has no harmony token" },
    { field: "songModel.melody", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings ? { as: "a context track, if the melody is one of the sibling parts" } : { reason: "no melody track present" }) } as FieldDisposition,
    { field: "songModel.bass", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings ? { as: "a context track, if the bass is one of the sibling parts" } : { reason: "no bass track present" }) } as FieldDisposition,
    { field: "section", status: "approximated", as: "the measure window (measure_slice)", lost: "the section's name, role, energy and density targets" },
    { field: "phrases", status: "unsupported", reason: "CA2 has no phrase token; its unit is the measure" },
    { field: "styleGrammar", status: "unsupported", reason: "no token for swing, microtiming, harmonic rhythm or any grammar rule; only the 512 density/pitch instructions exist" },
    { field: "harmonyPlan", status: "unsupported", reason: "no voicing or harmony-plan token; the Q-04 plan can only be enforced after generation" },
    { field: "vocalAttentionMap", status: "unsupported", reason: "no notion of a lead voice to stay out of; the vocal is at best one more context track" },
    { field: "motifMemory", status: "unsupported", reason: "no motif or thematic token" },
    { field: "previousSectionSummary", status: "unsupported", reason: "nothing outside the measure window is visible" },
    { field: "nextSectionIntent", status: "unsupported", reason: "nothing outside the measure window is visible" },
    { field: "role", status: "unsupported", reason: "CA2 knows the instrument, not the arranging role (lead, pad, counter-melody)" },
    { field: "lockedMaterial", status: "approximated", as: "unmasked measures are kept verbatim", lost: "locks finer than a whole (track, measure) cell" },
    { field: "productionBriefRef", status: "unsupported", reason: "no free-text or brief conditioning" },
  ];
  return completeDispositions(partial);
}

/** The constraints any CA2 output must pass through before it is a candidate. */
export const CA2_POST_GENERATION_ENFORCEMENTS = [
  "playable range clamp (instrument definition)",
  "maxSimultaneousNotes ceiling",
  "harmony-plan re-voicing (Q-04) — CA2 has no harmony input, so the plan can only be applied afterwards",
  "vocal-space pass — CA2 has no lead-voice notion",
  "locked material restored byte for byte",
] as const;
