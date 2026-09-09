/**
 * Anticipatory Music Transformer — the projection of `PartGenerationRequestV2`
 * (Wave Q — Model Discovery, round 2). Declared before any adapter runs, in
 * the shape PR-56 fixed for every external model, so the account the
 * tournament records is what the contract promised and not a per-run story.
 *
 * What the model can be told, from its own source (`anticipation` at commit
 * af373979…): a stream of (onset, duration, instrument×128+pitch) events, a
 * parallel stream of *anticipated controls* in the same shape that the model
 * sees up to 5 s ahead of the events they constrain, and nothing else. There
 * is no instrument-role, section, chord, style or velocity token; the held-out
 * instrument is fixed by the worker's instrument mask on the note slot, not by
 * a token the model reads.
 */
import type { PartGenerationRequestV2 } from "./partGenerationContextV2";
import { completeDispositions, type FieldDisposition } from "./symbolicGenerationProvider";

export function projectV2ForAnticipatoryMusicTransformer(request: PartGenerationRequestV2): FieldDisposition[] {
  const hasSiblings = request.siblingParts.some((p) => p.notes.length > 0);
  const partial: FieldDisposition[] = [
    { field: "siblingParts.notes", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings
        ? { as: "anticipated control events inside the window; prompt events before it; later controls after it" }
        : { reason: "no sibling notes were available to give" }) } as FieldDisposition,
    { field: "instrument", status: "approximated", as: "which stream each note is put in: the held-out program's own line becomes the event stream the model continues, every other instrument becomes anticipated controls", lost: "the model has no instrument-conditioning token — the part it writes follows from the split, not from anything it read, and it may still stray (the account counts off-target events); tracks sharing a program are one instrument to it" },
    { field: "candidateStrategy.seed", status: "received", as: "torch.manual_seed before sampling" },
    { field: "songModel.chords", status: "approximated", as: "implicit in the control events", lost: "chord symbols, roman numerals and harmonic function — no harmony token exists" },
    { field: "songModel.melody", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings ? { as: "a control instrument, if the melody is one of the sibling parts" } : { reason: "no melody track present" }) } as FieldDisposition,
    { field: "songModel.bass", status: hasSiblings ? "received" : "unsupported",
      ...(hasSiblings ? { as: "a control instrument, if the bass is one of the sibling parts" } : { reason: "no bass track present" }) } as FieldDisposition,
    { field: "section", status: "approximated", as: "the bar window in seconds under the file's first tempo and first time signature", lost: "the section's name, role, energy and density targets; tempo changes inside the file (flattened)" },
    { field: "hardConstraints.range", status: "unsupported", reason: "no range token; the mask constrains the instrument, not the pitch — enforce after generation" },
    { field: "hardConstraints.polyphony", status: "unsupported", reason: "no polyphony token; enforce after generation" },
    { field: "softConstraints", status: "unsupported", reason: "no density, step/leap or rhythm controls exist — only nucleus sampling's top_p" },
    { field: "phrases", status: "unsupported", reason: "no phrase token; the unit is the 10 ms event" },
    { field: "styleGrammar", status: "unsupported", reason: "no token for swing, microtiming, harmonic rhythm or any grammar rule" },
    { field: "harmonyPlan", status: "unsupported", reason: "no voicing or harmony-plan token; the Q-04 plan can only be enforced after generation" },
    { field: "vocalAttentionMap", status: "unsupported", reason: "no notion of a lead voice to stay out of; a vocal is at best one more control instrument" },
    { field: "motifMemory", status: "unsupported", reason: "no motif or thematic token" },
    { field: "previousSectionSummary", status: "approximated", as: "up to 20 s of the score before the window as prompt events (at most 341 events survive the 1024-token context)", lost: "the summary's role, energy, density and chord list; anything the Markov window drops" },
    { field: "nextSectionIntent", status: "approximated", as: "up to 8 s of the score after the window as anticipated controls", lost: "the intent's energy, novelty and approach; everything past 8 s" },
    { field: "role", status: "unsupported", reason: "the model knows the instrument's program, not its arranging role" },
    { field: "lockedMaterial", status: "approximated", as: "every note of the held-out instrument outside the window is kept verbatim", lost: "locks finer than the whole instrument × window" },
    { field: "productionBriefRef", status: "unsupported", reason: "no free-text or brief conditioning" },
  ];
  return completeDispositions(partial);
}

/** The constraints any AMT output must pass through before it is a candidate. */
export const AMT_POST_GENERATION_ENFORCEMENTS = [
  "playable range clamp (instrument definition) — the model was told the instrument, never its range",
  "maxSimultaneousNotes ceiling",
  "harmony-plan re-voicing (Q-04) — no harmony input, so the plan can only be applied afterwards",
  "vocal-space pass — no lead-voice notion",
  "locked material restored byte for byte",
] as const;
