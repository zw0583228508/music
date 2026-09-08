/**
 * The producer's reply text (Wave U, PR-U2): a one-paragraph reading of what
 * the user asked for, built only from the extracted intent, the resolved
 * profile and the compiled brief — every phrase quotes the user's own words
 * or names a brief decision. No model writes this; it cannot say anything the
 * data does not contain.
 */
import type {
  ClarificationQuestion,
  IntentConstraint,
  IntentInference,
  IntentReference,
  ProducerBriefDecision,
  ProductionBrief,
  StyleProfile,
  UserIntent,
} from "@workspace/db";
import { activeDecisions } from "./briefCompiler";
import { instrumentFamily } from "./vocabulary";

export type IntentDelta = {
  inferences: IntentInference[];
  constraints: IntentConstraint[];
  references: IntentReference[];
  unresolvedTerms: string[];
};

const scopeKey = (scope: IntentInference["scope"]): string => JSON.stringify(scope);

/** Items in `next` that `previous` did not have (by slot/value/scope, kind/subject/scope, label). */
export function intentDelta(previous: UserIntent | null, next: UserIntent): IntentDelta {
  if (!previous) {
    return {
      inferences: next.inferences, constraints: next.constraints,
      references: next.references, unresolvedTerms: next.unresolvedTerms,
    };
  }
  const hadInference = new Set(previous.inferences.map((i) => `${i.slot}|${i.value}|${scopeKey(i.scope)}`));
  const hadConstraint = new Set(previous.constraints.map((c) => `${c.kind}|${c.subject}|${scopeKey(c.scope)}`));
  const hadReference = new Set(previous.references.map((r) => r.label.toLowerCase()));
  const hadTerm = new Set(previous.unresolvedTerms);
  return {
    inferences: next.inferences.filter((i) => !hadInference.has(`${i.slot}|${i.value}|${scopeKey(i.scope)}`)),
    constraints: next.constraints.filter((c) => !hadConstraint.has(`${c.kind}|${c.subject}|${scopeKey(c.scope)}`)),
    references: next.references.filter((r) => !hadReference.has(r.label.toLowerCase())),
    unresolvedTerms: next.unresolvedTerms.filter((t) => !hadTerm.has(t)),
  };
}

const quote = (s: string): string => `"${s.trim()}"`;
const list = (items: string[]): string =>
  items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

function worldPhrase(intent: UserIntent, profile: StyleProfile): string | null {
  const d = profile.dimensions;
  const pick = (name: keyof StyleProfile["dimensions"]): string | null => {
    const dim = d[name];
    return dim && (dim.provenance === "stated" || dim.provenance === "inferred") && typeof dim.value === "string" ? dim.value : null;
  };
  const era = pick("era");
  const tradition = pick("tradition");
  const genre = pick("genre");
  const scene = pick("scene");
  const ensemble = pick("ensembleType");
  const words = [era, tradition, genre].filter((w): w is string => !!w);
  const parts: string[] = [];
  if (words.length) parts.push(`a ${words.join(" ")}`);
  if (scene) parts.push(`${scene} scene`);
  if (ensemble) parts.push(`${ensemble.replace(/_/g, " ")} ensemble`);
  const feels = intent.inferences
    .filter((i) => i.scope.kind === "global" && (i.slot === "production_feel" || i.slot === "mood") && i.provenance === "stated")
    .map((i) => i.value.replace(/_/g, " "));
  if (feels.length) parts.push(`feel: ${list([...new Set(feels)])}`);
  const tempo = intent.inferences.find((i) => i.scope.kind === "global" && (i.slot === "tempo_bpm" || i.slot === "tempo_feel"));
  if (tempo) parts.push(tempo.slot === "tempo_bpm" ? `${tempo.value} bpm` : `${tempo.value} tempo`);
  return parts.length ? parts.join(", ") : null;
}

function constraintPhrase(constraints: IntentConstraint[]): string | null {
  const global = constraints.filter((c) => c.scope.kind === "global");
  if (!global.length) return null;
  const verb: Record<IntentConstraint["kind"], string> = { avoid: "ruled out", limit: "keep in check", keep: "keep", require: "must have" };
  const grouped = new Map<string, string[]>();
  for (const c of global) grouped.set(verb[c.kind], [...(grouped.get(verb[c.kind]) ?? []), `${c.subject} (${quote(c.statement)})`]);
  return [...grouped].map(([v, items]) => `${v}: ${list(items)}`).join("; ");
}

function instrumentsPhrase(inferences: IntentInference[]): string | null {
  const named = inferences.filter((i) => i.slot === "instrument" && i.scope.kind === "global");
  if (!named.length) return null;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const i of named) {
    const family = instrumentFamily(i.value);
    const label = family === i.value ? family : `${i.value} → ${family}`;
    if (!seen.has(label)) { seen.add(label); items.push(label); }
  }
  return `instruments named: ${list(items)}`;
}

function sectionPhrase(brief: ProductionBrief): string | null {
  const decisions = new Map(activeDecisions(brief).map((d) => [d.id, d] as const));
  const lines: string[] = [];
  for (const intention of brief.sectionIntentions) {
    const own = intention.decisionIds
      .map((id) => decisions.get(id))
      .filter((d): d is ProducerBriefDecision => !!d)
      .map((d) => d.statement.replace(new RegExp(`^${intention.sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`), ""));
    if (!own.length) continue;
    lines.push(`${intention.sectionName}: ${list([...new Set(own)])}`);
  }
  return lines.length ? lines.join("; ") : null;
}

function referencePhrase(references: IntentReference[]): string | null {
  if (!references.length) return null;
  return `references: ${list(references.map((r) => `${r.label}${r.aspect ? ` (${r.aspect})` : ""}`))}`;
}

function sectionRefLabel(scope: IntentInference["scope"]): string {
  if (scope.kind !== "section") return "";
  const { function: fn, ordinal } = scope.section;
  return ordinal === "all" ? fn : ordinal === "last" ? `last ${fn}` : `${fn} ${ordinal}`;
}

function questionText(q: ClarificationQuestion, language: UserIntent["language"]): string {
  const he = language === "he";
  const question = he && q.questionHe ? q.questionHe : q.question;
  const options = q.options.map((o, i) => `(${String.fromCharCode(97 + i)}) ${he && o.labelHe ? o.labelHe : o.label}`);
  return `${question} ${options.join(" ")}`;
}

export type UnderstandingInput = {
  intent: UserIntent;
  profile: StyleProfile;
  brief: ProductionBrief;
  /** Open questions worth asking now (≤2, already scored). */
  questions: ClarificationQuestion[];
  hasSongModel: boolean;
  /** For refinement turns: only what this turn added is described. */
  delta?: IntentDelta;
  version: number;
};

/** The producer's reading. First paragraph: what was understood; second: the questions. */
export function describeUnderstanding(input: UnderstandingInput): string {
  const { intent, profile, brief, questions, hasSongModel, delta } = input;
  const sentences: string[] = [];
  const nothingRead = !intent.inferences.length && !intent.constraints.length && !intent.references.length;

  if (delta) {
    const added: string[] = [];
    const world = delta.inferences.filter((i) => i.scope.kind === "global" && i.provenance === "stated")
      .map((i) => `${i.slot.replace(/_/g, " ")} ${i.value.replace(/_/g, " ")} (${quote(i.evidence[0] ?? "")})`);
    if (world.length) added.push(list(world));
    const constraints = constraintPhrase(delta.constraints);
    if (constraints) added.push(constraints);
    const refs = referencePhrase(delta.references);
    if (refs) added.push(refs);
    const sectionWishes = [
      ...delta.inferences.filter((i) => i.scope.kind === "section")
        .map((i) => `${i.slot.replace(/_/g, " ")} ${i.value.replace(/_/g, " ")} for the ${sectionRefLabel(i.scope)}`),
      ...delta.constraints.filter((c) => c.scope.kind === "section")
        .map((c) => `${quote(c.statement)} for the ${sectionRefLabel(c.scope)}`),
    ];
    if (sectionWishes.length) added.push(`section wishes: ${list([...new Set(sectionWishes)])}`);
    if (!added.length) {
      sentences.push("I could not read a new musical direction from that, so the brief is unchanged.");
      if (delta.unresolvedTerms.length) sentences.push(`I did not understand ${list(delta.unresolvedTerms.map(quote))}.`);
      sentences.push("Tell me about the feel, an era, artists or songs, or the instruments you hear, and I will fold it in.");
      return sentences.join(" ");
    }
    sentences.push(`Added to the brief (v${input.version}): ${added.join("; ")}.`);
  } else if (nothingRead) {
    sentences.push("I could not read a musical direction from that yet.");
    if (intent.unresolvedTerms.length) sentences.push(`I did not understand ${list(intent.unresolvedTerms.map(quote))}.`);
    sentences.push("Tell me how you want the arrangement to feel — write however is comfortable, mention artists, songs or eras, or upload a reference.");
    return sentences.join(" ");
  } else {
    const world = worldPhrase(intent, profile);
    sentences.push(world ? `Here is how I read it: ${world}.` : "Here is how I read it.");
    const constraints = constraintPhrase(intent.constraints);
    if (constraints) sentences.push(`Boundaries — ${constraints}.`);
    const instruments = instrumentsPhrase(intent.inferences);
    if (instruments) sentences.push(`${instruments[0].toUpperCase()}${instruments.slice(1)}.`);
    const refs = referencePhrase(intent.references);
    if (refs) sentences.push(`${refs[0].toUpperCase()}${refs.slice(1)}.`);
  }

  const sections = sectionPhrase(brief);
  if (sections) sentences.push(`Per section — ${sections}.`);
  if (brief.unresolvedSectionRequests.length) {
    const wishes = brief.unresolvedSectionRequests.map((r) => quote(r.text));
    sentences.push(hasSongModel
      ? `I could not place ${list(wishes)} on this song's sections (${brief.sectionNames.join(", ") || "none"}); it is kept, not guessed.`
      : `${list(wishes)} is kept for when the song is analysed; there is no Song Model to place it on yet.`);
  }
  if (brief.instrumentation.excludedFamilies.length) {
    sentences.push(`Excluded from the palette: ${list(brief.instrumentation.excludedFamilies)}.`);
  }
  if (intent.unresolvedTerms.length && !delta) {
    sentences.push(`I did not understand ${list(intent.unresolvedTerms.map(quote))} — say it another way and I will pick it up.`);
  }
  if (brief.productionAesthetic.plannerAesthetic) {
    sentences.push(`Production aesthetic for the planners: ${brief.productionAesthetic.plannerAesthetic.replace(/_/g, " ")}.`);
  }

  const paragraph = sentences.join(" ");
  if (!questions.length) return paragraph;
  const lead = questions.length === 1
    ? "One thing would change the arrangement materially:"
    : "Two things would change the arrangement materially:";
  return `${paragraph}\n\n${lead} ${questions.map((q) => questionText(q, intent.language)).join(" ")}`;
}
