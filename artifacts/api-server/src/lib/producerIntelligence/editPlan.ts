/**
 * Edit-request interpretation (Wave U, PR-U1).
 *
 * "הפזמון השני עמוס מדי", "the last chorus still doesn't feel like a climax",
 * "make the violins more Jewish" → a structured EditPlan: a scope on the
 * existing PR-17 lock / regeneration vocabulary, an intent, what to preserve
 * (as `ArrangementLock`s), what to modify (as `RegenerationScope`s), and the
 * durable brief deltas so a later full regeneration honours the edit too.
 *
 * Reuses the deterministic intent extractor and `planPartialRegeneration`;
 * invents no new scope types.
 */
import { createHash } from "node:crypto";
import type {
  ArrangementLockSet,
  ArrangementPlan,
  BriefDelta,
  EditPlan,
  EditPlanIntent,
  IntentSectionRef,
  ProductionBrief,
} from "@workspace/db";
import { planPartialRegeneration, type ProducerIntent } from "../regenerationLocks";
import { resolveSectionRef, type SectionLike } from "./briefCompiler";
import { phrases, replyLanguage } from "./producerLanguage";
import { extractUserIntentSync } from "./intentExtraction";
import { instrumentFamily, lookupWord } from "./vocabulary";

export const EDIT_PLAN_VERSION = "1.0" as const;
const METHOD = "edit-plan/v1";

export type EditPlanContext = Pick<ArrangementPlan, "globalPlan" | "sectionPlan"> & { locks?: ArrangementLockSet };

const FAMILY_ALIASES: Record<string, string> = { synths: "synth", pad: "pads", piano: "keys", vocal: "vocals" };
const canonical = (family: string): string => FAMILY_ALIASES[family] ?? family;

const GROOVE_WORDS = /\b(groove|swing|shuffle|straighter|straight|syncopat\w*|rhythm|pocket|feel)\b|גרוב|סווינג|קצב|מקצב/iu;
const HARMONY_WORDS = /\b(chords?|harmon\w*|reharm\w*|voicings?|key\s+change|modulat\w*)\b|אקורד|הרמוני|מודולצי|ווייסינג/iu;
const BAR_RANGE = /\b(?:bars?|תיבות|תיבה)\s+(\d{1,3})\s*[-–]\s*(\d{1,3})/iu;

export function interpretEditRequest(
  text: string,
  brief: ProductionBrief,
  plan: EditPlanContext,
  options: { now?: Date } = {},
): EditPlan {
  const now = options.now ?? new Date();
  const intent = extractUserIntentSync(text, { now });
  const sections: SectionLike[] = (plan.globalPlan?.sectionTargets ?? [])
    .map((t) => ({ name: t.sectionName, startBar: t.startBar, endBar: t.endBar }))
    .sort((a, b) => a.startBar - b.startBar);
  const instruments = [...new Set([
    ...(plan.globalPlan?.instrumentPalette ?? []).map((p) => canonical(p.role)),
    ...(plan.sectionPlan?.roleAssignments ?? []).map((r) => canonical(r.instrument)),
  ])].filter((f) => f !== "vocals" && f !== "fx");

  // --- scope ---------------------------------------------------------------
  const sectionRef: IntentSectionRef | undefined = intent.sectionRequests[0]?.section;
  const sectionNames = sectionRef ? resolveSectionRef(sectionRef, sections) : [];
  const namedFamilies = [...new Set([
    ...intent.inferences.filter((i) => i.slot === "instrument").map((i) => canonical(instrumentFamily(i.value))),
    ...intent.constraints
      .map((c) => lookupWord(c.subject))
      .filter((e): e is NonNullable<typeof e> => !!e && e.slot === "instrument")
      .map((e) => canonical(instrumentFamily(e.value))),
  ])];
  const keptFamilies = intent.constraints
    .filter((c) => c.kind === "keep")
    .map((c) => lookupWord(c.subject))
    .filter((e): e is NonNullable<typeof e> => !!e && e.slot === "instrument")
    .map((e) => canonical(instrumentFamily(e.value)));
  const removedFamilies = intent.constraints
    .filter((c) => c.kind === "avoid")
    .map((c) => lookupWord(c.subject))
    .filter((e): e is NonNullable<typeof e> => !!e && e.slot === "instrument")
    .map((e) => canonical(instrumentFamily(e.value)));
  const requiredFamilies = intent.constraints
    .filter((c) => c.kind === "require")
    .map((c) => lookupWord(c.subject))
    .filter((e): e is NonNullable<typeof e> => !!e && e.slot === "instrument")
    .map((e) => canonical(instrumentFamily(e.value)));
  const focusFamily = namedFamilies.find((f) => !keptFamilies.includes(f));
  const barRange = BAR_RANGE.exec(text);
  const evidence = [
    ...intent.inferences.flatMap((i) => i.evidence),
    ...intent.constraints.map((c) => c.statement),
  ];

  // --- intent ----------------------------------------------------------------
  const has = (slot: string, value?: string) =>
    intent.inferences.some((i) => i.slot === slot && (value === undefined || i.value === value));
  const constraint = (kind: string, subject?: string) =>
    intent.constraints.some((c) => c.kind === kind && (subject === undefined || c.subject === subject));

  let editIntent: EditPlanIntent = "unclear";
  if (constraint("require", "climax") || (has("energy", "high") && sectionRef?.ordinal === "last")) editIntent = "raise_climax";
  else if (constraint("limit", "dense") || constraint("avoid", "dense") || constraint("limit", "everything") || has("density", "sparse")) editIntent = "reduce_density";
  else if (constraint("limit", "sparse") || has("density", "dense")) editIntent = "raise_density";
  else if (constraint("limit", "high") || has("energy", "low")) editIntent = "lower_energy";
  else if (has("energy", "high") || constraint("limit", "low")) editIntent = "raise_energy";
  else if (focusFamily && (has("tradition") || has("mood"))) editIntent = "change_ornamentation";
  else if (removedFamilies.length) editIntent = "remove_instrument";
  else if (requiredFamilies.length) {
    editIntent = requiredFamilies.some((f) => !instruments.includes(f)) ? "add_instrument" : "regenerate_part";
  } else if (GROOVE_WORDS.test(text) && !focusFamily) editIntent = "change_groove";
  else if (HARMONY_WORDS.test(text)) editIntent = "change_harmony";
  else if (focusFamily && has("production_feel")) editIntent = "change_aesthetic";
  else if (focusFamily && namedFamilies.length && intent.inferences.some((i) => i.slot === "instrument" && /more|יותר|עוד/iu.test(i.evidence.join(" ")))) editIntent = "feature_instrument";
  else if (has("production_feel") || has("mood")) editIntent = "change_aesthetic";
  else if (keptFamilies.length && !focusFamily) editIntent = "keep";
  else if (focusFamily) editIntent = "regenerate_part";

  // --- scope kind -------------------------------------------------------------
  const scope: EditPlan["scope"] = barRange
    ? { kind: "phrase", startBar: Number(barRange[1]), endBar: Number(barRange[2]), ...(sectionNames[0] ? { sectionName: sectionNames[0] } : {}), ...(focusFamily ? { instrument: focusFamily } : {}) }
    : focusFamily && editIntent !== "add_instrument" && editIntent !== "remove_instrument"
      ? { kind: "track", instrument: focusFamily, ...(sectionNames[0] ? { sectionName: sectionNames[0] } : {}) }
      : sectionNames.length
        ? { kind: "section", sectionName: sectionNames[0] }
        : { kind: "global" };

  // --- locks and regeneration scopes via PR-17 ---------------------------------
  const producerIntents: ProducerIntent[] = [];
  for (const family of keptFamilies) {
    producerIntents.push({ kind: "keep", instrument: family, ...(sectionNames[0] && editIntent !== "keep" ? {} : {}) });
  }
  if (editIntent !== "keep" && editIntent !== "unclear") {
    const targetSections = sectionNames.length ? sectionNames : [undefined];
    for (const sectionName of targetSections) {
      if (editIntent === "remove_instrument") {
        for (const family of removedFamilies) producerIntents.push({ kind: "remove", instrument: family, ...(sectionName ? { sectionName } : {}) });
      } else if (editIntent === "add_instrument") {
        for (const family of requiredFamilies) producerIntents.push({ kind: "regenerate", instrument: family, ...(sectionName ? { sectionName } : {}) });
      } else if (scope.kind === "phrase") {
        producerIntents.push({ kind: "regenerate", ...(focusFamily ? { instrument: focusFamily } : {}), ...(sectionName ? { sectionName } : {}), startBar: scope.startBar, endBar: scope.endBar });
      } else if (scope.kind === "track" && focusFamily) {
        producerIntents.push({ kind: "regenerate", instrument: focusFamily, ...(sectionName ? { sectionName } : {}) });
      } else {
        producerIntents.push({ kind: "regenerate", ...(sectionName ? { sectionName } : {}) });
      }
    }
    // A section-scoped edit freezes every other section; a track-scoped edit
    // freezes every other instrument. Explicit locks, on existing scopes.
    if (scope.kind === "section" || (scope.kind === "track" && sectionNames.length)) {
      for (const s of sections) if (!sectionNames.includes(s.name)) producerIntents.push({ kind: "keep", sectionName: s.name });
    }
    if (scope.kind === "track" && focusFamily) {
      for (const family of instruments) if (family !== focusFamily && !keptFamilies.includes(family)) producerIntents.push({ kind: "keep", instrument: family });
    }
  }
  const { locks, requested } = planPartialRegeneration({
    intents: producerIntents,
    instruments: [...new Set([...instruments, ...requiredFamilies])],
    sections: sections.map((s) => ({ sectionName: s.name, startBar: s.startBar, endBar: s.endBar })),
    phrases: plan.sectionPlan?.phrases,
    now,
  });

  // --- durable brief deltas ----------------------------------------------------
  const briefDeltas: BriefDelta[] = [];
  const rationaleText = `edit: "${text.trim()}"`;
  const sectionDelta = (patch: Omit<Extract<BriefDelta, { kind: "section_intention" }>, "kind" | "section" | "rationale">) => {
    if (sectionRef) briefDeltas.push({ kind: "section_intention", section: sectionRef, ...patch, rationale: rationaleText });
  };
  switch (editIntent) {
    case "reduce_density":
      if (sectionRef) sectionDelta({ densityBias: -0.35 });
      else briefDeltas.push({ kind: "decision", scope: { kind: "global" }, topic: "density", statement: "reduce density", value: "sparse", strength: "hard", rationale: rationaleText });
      break;
    case "raise_density":
      if (sectionRef) sectionDelta({ densityBias: 0.35 });
      else briefDeltas.push({ kind: "decision", scope: { kind: "global" }, topic: "density", statement: "raise density", value: "dense", strength: "hard", rationale: rationaleText });
      break;
    case "raise_climax":
      if (sectionRef) sectionDelta({ climax: "primary", energyBias: 0.3 });
      else briefDeltas.push({ kind: "decision", scope: { kind: "global" }, topic: "climax", statement: "needs a clear climax", strength: "hard", rationale: rationaleText });
      break;
    case "raise_energy":
      if (sectionRef) sectionDelta({ energyBias: 0.3 });
      else briefDeltas.push({ kind: "decision", scope: { kind: "global" }, topic: "energy", statement: "raise energy", value: "high", strength: "hard", rationale: rationaleText });
      break;
    case "lower_energy":
      if (sectionRef) sectionDelta({ energyBias: -0.3 });
      else briefDeltas.push({ kind: "decision", scope: { kind: "global" }, topic: "energy", statement: "lower energy", value: "low", strength: "hard", rationale: rationaleText });
      break;
    case "change_ornamentation": {
      const flavour = intent.inferences.find((i) => i.slot === "tradition" || i.slot === "mood");
      briefDeltas.push({
        kind: "decision", scope: { kind: "track", instrument: focusFamily!, ...(sectionNames[0] ? { sectionName: sectionNames[0] } : {}) },
        topic: "ornamentation", statement: `${focusFamily}: ${flavour?.value ?? "more"} ornamentation`,
        dimension: "melodicOrnamentation", value: "heavy", strength: "hard", rationale: rationaleText,
      });
      if (flavour?.slot === "tradition") {
        briefDeltas.push({ kind: "decision", scope: { kind: "track", instrument: focusFamily! }, topic: "style_dimension", statement: `${focusFamily}: ${flavour.value} articulation language`, dimension: "articulationLanguage", value: flavour.value, strength: "hard", rationale: rationaleText });
      }
      break;
    }
    case "add_instrument":
      if (sectionRef) sectionDelta({ add: requiredFamilies });
      else briefDeltas.push({ kind: "instrumentation", add: requiredFamilies, rationale: rationaleText });
      break;
    case "remove_instrument":
      if (sectionRef) sectionDelta({ remove: removedFamilies });
      else briefDeltas.push({ kind: "instrumentation", remove: removedFamilies, rationale: rationaleText });
      break;
    case "feature_instrument":
      if (sectionRef) sectionDelta({ add: [focusFamily!] });
      else briefDeltas.push({ kind: "instrumentation", feature: [focusFamily!], rationale: rationaleText });
      break;
    case "change_aesthetic": {
      const word = intent.inferences.find((i) => i.slot === "production_feel" || i.slot === "mood");
      if (sectionRef && word) sectionDelta({ character: [word.value] });
      else if (word) briefDeltas.push({ kind: "decision", scope: focusFamily ? { kind: "track", instrument: focusFamily } : { kind: "global" }, topic: "aesthetic", statement: `${focusFamily ?? "overall"}: ${word.value}`, value: word.value, strength: "soft", rationale: rationaleText });
      break;
    }
    case "change_groove":
      briefDeltas.push({ kind: "decision", scope: sectionNames[0] ? { kind: "section", sectionName: sectionNames[0] } : { kind: "global" }, topic: "groove", statement: text.trim(), strength: "soft", rationale: rationaleText });
      break;
    case "change_harmony":
      briefDeltas.push({ kind: "decision", scope: sectionNames[0] ? { kind: "section", sectionName: sectionNames[0] } : { kind: "global" }, topic: "harmony", statement: text.trim(), strength: "soft", rationale: rationaleText });
      break;
    case "keep":
      for (const family of keptFamilies) briefDeltas.push({ kind: "decision", scope: { kind: "track", instrument: family }, topic: "instrumentation", statement: `keep ${family}`, value: family, strength: "hard", rationale: rationaleText });
      break;
    default:
      break;
  }

  // The rationale is what the producer reads, so it is written in their language
  // (PR-36); the words it quotes are theirs and are never translated.
  const P = phrases(replyLanguage(text));
  const scopeText = scope.kind === "global" ? P.editScopeWholeArrangement
    : scope.kind === "section" ? P.editScopeSection(scope.sectionName ?? "")
      : scope.kind === "track" ? P.scopeTrack(scope.instrument ?? "", scope.sectionName ?? null)
        : P.editScopeBars(scope.startBar ?? 0, scope.endBar ?? 0, scope.instrument ?? null);
  const unresolvedSection = sectionRef && !sectionNames.length;
  const rationale = editIntent === "unclear"
    ? P.editUnclear(text.trim())
    : P.editRationale(
        P.editIntentName(editIntent),
        scopeText,
        requested.length,
        locks.locks.length,
        unresolvedSection ? sectionRef!.function : null,
        evidence.map((e) => `"${e}"`).join(", ") || P.evidenceNone,
      );
  const confidence = editIntent === "unclear" ? 0.2 : unresolvedSection ? 0.45 : sectionRef || focusFamily ? 0.85 : 0.65;

  return {
    version: EDIT_PLAN_VERSION,
    derivedAt: now.toISOString(),
    inputsDigestSha256: createHash("sha256").update(JSON.stringify({
      text, briefDigest: brief.inputsDigestSha256, sections: sections.map((s) => s.name), instruments,
    })).digest("hex"),
    method: METHOD,
    rawText: text,
    scope,
    intent: editIntent,
    preserve: locks.locks,
    modify: requested,
    briefDeltas,
    rationale,
    evidence,
    confidence,
  };
}
