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
import { phrases, type ProducerLanguage } from "./producerLanguage";
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

function worldPhrase(intent: UserIntent, profile: StyleProfile, language: ProducerLanguage): string | null {
  const { list } = phrases(language);
  const P = phrases(language);
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
  if (words.length) parts.push(P.worldPrefix(words.join(" ")));
  if (scene) parts.push(P.sceneSuffix(scene));
  if (ensemble) parts.push(P.ensembleSuffix(ensemble.replace(/_/g, " ")));
  const feels = intent.inferences
    .filter((i) => i.scope.kind === "global" && (i.slot === "production_feel" || i.slot === "mood") && i.provenance === "stated")
    .map((i) => i.value.replace(/_/g, " "));
  if (feels.length) parts.push(P.feelPrefix(list([...new Set(feels)])));
  const tempo = intent.inferences.find((i) => i.scope.kind === "global" && (i.slot === "tempo_bpm" || i.slot === "tempo_feel"));
  if (tempo) parts.push(tempo.slot === "tempo_bpm" ? P.bpm(tempo.value) : P.tempoFeel(tempo.value));
  return parts.length ? parts.join(", ") : null;
}

/**
 * What research added (PR-U3): the dimensions the profile holds with
 * provenance `researched`, named with their providers. Each is a brief
 * decision, so the sentence still says nothing the data does not contain.
 */
function researchPhrase(profile: StyleProfile, language: ProducerLanguage): string | null {
  const { list } = phrases(language);
  const researched = (Object.entries(profile.dimensions) as Array<[string, StyleProfile["dimensions"][keyof StyleProfile["dimensions"]]]>)
    .filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1]?.provenance === "researched")
    .map(([name, dim]) => `${name.replace(/([A-Z])/g, " $1").toLowerCase()} ${Array.isArray(dim.value) ? dim.value.join("/") : String(dim.value).replace(/_/g, " ")}`);
  if (!researched.length || !profile.research) return null;
  return phrases(language).researchSentence(
    profile.research.world.join(", ").replace(/\b\w+=/g, ""),
    profile.research.providers.join(", "),
    list(researched),
  );
}

function constraintPhrase(constraints: IntentConstraint[], language: ProducerLanguage): string | null {
  const { list, quote, constraintVerb } = phrases(language);
  const global = constraints.filter((c) => c.scope.kind === "global");
  if (!global.length) return null;
  const grouped = new Map<string, string[]>();
  for (const c of global) grouped.set(constraintVerb(c.kind), [...(grouped.get(constraintVerb(c.kind)) ?? []), `${c.subject} (${quote(c.statement)})`]);
  return [...grouped].map(([v, items]) => `${v}: ${list(items)}`).join("; ");
}

function instrumentsPhrase(inferences: IntentInference[], language: ProducerLanguage): string | null {
  const { list, instrumentsNamed } = phrases(language);
  const named = inferences.filter((i) => i.slot === "instrument" && i.scope.kind === "global");
  if (!named.length) return null;
  const seen = new Set<string>();
  const items: string[] = [];
  for (const i of named) {
    const family = instrumentFamily(i.value);
    const label = family === i.value ? family : `${i.value} → ${family}`;
    if (!seen.has(label)) { seen.add(label); items.push(label); }
  }
  return instrumentsNamed(list(items));
}

function sectionPhrase(brief: ProductionBrief, language: ProducerLanguage): string | null {
  const { list } = phrases(language);
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

function referencePhrase(references: IntentReference[], language: ProducerLanguage): string | null {
  const { list, referencesNamed } = phrases(language);
  if (!references.length) return null;
  return referencesNamed(list(references.map((r) => `${r.label}${r.aspect ? ` (${r.aspect})` : ""}`)));
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
  // Answer in the language the producer wrote in. PR-U1 detected it already.
  const language = intent.language;
  const P = phrases(language);
  const { list, quote } = P;
  const sentences: string[] = [];
  const nothingRead = !intent.inferences.length && !intent.constraints.length && !intent.references.length;

  if (delta) {
    const added: string[] = [];
    const world = delta.inferences.filter((i) => i.scope.kind === "global" && i.provenance === "stated")
      .map((i) => `${i.slot.replace(/_/g, " ")} ${i.value.replace(/_/g, " ")} (${quote(i.evidence[0] ?? "")})`);
    if (world.length) added.push(list(world));
    const constraints = constraintPhrase(delta.constraints, language);
    if (constraints) added.push(constraints);
    const refs = referencePhrase(delta.references, language);
    if (refs) added.push(refs);
    const sectionWishes = [
      ...delta.inferences.filter((i) => i.scope.kind === "section")
        .map((i) => `${i.slot.replace(/_/g, " ")} ${i.value.replace(/_/g, " ")} for the ${sectionRefLabel(i.scope)}`),
      ...delta.constraints.filter((c) => c.scope.kind === "section")
        .map((c) => `${quote(c.statement)} for the ${sectionRefLabel(c.scope)}`),
    ];
    if (sectionWishes.length) added.push(P.sectionWishes(list([...new Set(sectionWishes)])));
    if (!added.length) {
      sentences.push(P.nothingNewRead);
      if (delta.unresolvedTerms.length) sentences.push(P.didNotUnderstand(list(delta.unresolvedTerms.map(quote))));
      sentences.push(P.tellMeMore);
      return sentences.join(" ");
    }
    sentences.push(P.addedToBrief(input.version, added.join("; ")));
  } else if (nothingRead) {
    sentences.push(P.noDirectionYet);
    if (intent.unresolvedTerms.length) sentences.push(P.didNotUnderstand(list(intent.unresolvedTerms.map(quote))));
    sentences.push(P.tellMeHow);
    return sentences.join(" ");
  } else {
    sentences.push(P.hereIsHowIReadIt(worldPhrase(intent, profile, language)));
    const constraints = constraintPhrase(intent.constraints, language);
    if (constraints) sentences.push(P.boundaries(constraints));
    const instruments = instrumentsPhrase(intent.inferences, language);
    if (instruments) sentences.push(`${instruments[0].toUpperCase()}${instruments.slice(1)}.`);
    const refs = referencePhrase(intent.references, language);
    if (refs) sentences.push(`${refs[0].toUpperCase()}${refs.slice(1)}.`);
    const research = researchPhrase(profile, language);
    if (research) sentences.push(`${research}.`);
  }

  const sections = sectionPhrase(brief, language);
  if (sections) sentences.push(P.perSection(sections));
  if (brief.unresolvedSectionRequests.length) {
    const wishes = brief.unresolvedSectionRequests.map((r) => quote(r.text));
    sentences.push(hasSongModel
      ? P.couldNotPlace(list(wishes), brief.sectionNames.join(", ") || "none")
      : P.keptForAnalysis(list(wishes)));
  }
  if (brief.instrumentation.excludedFamilies.length) {
    sentences.push(P.excludedFromPalette(list(brief.instrumentation.excludedFamilies)));
  }
  if (intent.unresolvedTerms.length && !delta) {
    sentences.push(P.didNotUnderstandSayAgain(list(intent.unresolvedTerms.map(quote))));
  }
  if (brief.productionAesthetic.plannerAesthetic) {
    sentences.push(P.productionAesthetic(brief.productionAesthetic.plannerAesthetic.replace(/_/g, " ")));
  }

  const paragraph = sentences.join(" ");
  if (!questions.length) return paragraph;
  return `${paragraph}\n\n${P.questionsLead(questions.length)} ${questions.map((q) => questionText(q, language)).join(" ")}`;
}
