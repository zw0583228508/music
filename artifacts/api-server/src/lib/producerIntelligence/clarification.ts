/**
 * Clarification planning (Wave U, PR-U1).
 *
 * Detects ambiguities in the intent + style profile that would *materially*
 * change the arrangement, scores each question's information gain, and returns
 * at most the top two above a threshold. Every answer option carries the
 * concrete brief deltas it would cause, so answering is a pure data operation.
 *
 * The detectors are tradition-agnostic. The owner's example — "old Hasidic"
 * could mean the 90s wedding-band sound, the yeshiva / niggun world, or the
 * traditional orchestral one — is one instance of a general shape: a named
 * tradition with a vague era and no ensemble, school or scene. The three
 * worlds offered are archetypes any tradition has (band recordings of the
 * era / communal vocal world / arranged-orchestral tradition); PR-U3's
 * `worldsFor` rewords them for the traditions its vocabulary knows — same
 * ids, same deltas — and a caller may still pass its own `worldsFor`.
 *
 * PR-U3 also adds the questions research raised: a finding the agent was not
 * sure enough to assert is offered here as an option, scored like any other
 * question, so the ≤2 rule holds across both kinds.
 */
import type {
  BriefDelta,
  ClarificationAnswer,
  ClarificationOption,
  ClarificationQuestion,
  StyleDimensionName,
  StyleProfile,
  UserIntent,
} from "@workspace/db";
import { researchQuestions, worldWordingFor } from "./styleResearch";

export const CLARIFICATION_THRESHOLD = 0.4;
export const MAX_CLARIFICATIONS = 2;

export type ClarificationOptions = {
  threshold?: number;
  max?: number;
  /** Tradition-specific worlds (label + deltas); null keeps the generic archetypes. */
  worldsFor?: (tradition: string) => ClarificationOption[] | null;
};

const VAGUE_ERAS = new Set(["old", "vintage", "classic", "traditional"]);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

const dim = (
  dimension: StyleDimensionName,
  value: string,
  confidence: number,
  rationale: string,
): BriefDelta => ({ kind: "set_dimension", dimension, value, confidence, rationale });

/** The three archetypal worlds a tradition + vague era can mean. */
export function genericWorlds(tradition: string): ClarificationOption[] {
  return [
    {
      id: "era_band",
      label: `The band recordings of that era (the wedding / party-band ${tradition} sound)`,
      labelHe: `הצליל של להקות התקופה (להקת חתונות / אירועים ${tradition})`,
      description: "A full band as it was recorded then: rhythm section, keys, horns or strings, produced sound.",
      briefDeltas: [
        dim("ensembleType", "band", 0.8, "chosen world: band recordings of the era"),
        dim("productionSchool", "era_band_recordings", 0.7, "chosen world: band recordings of the era"),
        dim("soundAesthetic", "produced", 0.6, "chosen world: band recordings of the era"),
      ],
    },
    {
      id: "communal_vocal",
      label: `The communal singing world (informal, vocal-led — e.g. a yeshiva / niggun setting)`,
      labelHe: `עולם השירה בציבור (לא פורמלי, מובל בקול — ישיבה / ניגון)`,
      description: "Voices lead; a small acoustic accompaniment follows the singing rather than driving it.",
      briefDeltas: [
        dim("ensembleType", "vocal_led_small", 0.8, "chosen world: communal singing"),
        dim("soundAesthetic", "raw_intimate", 0.7, "chosen world: communal singing"),
        dim("roomSize", "small", 0.5, "chosen world: communal singing"),
        { kind: "vocal_space", underLead: "tight", gapFill: "sparse", rationale: "voices lead in the communal world" },
      ],
    },
    {
      id: "arranged_orchestral",
      label: `The traditional arranged / orchestral ${tradition} sound`,
      labelHe: `הצליל המסורתי המעובד / התזמורתי`,
      description: "Written arrangements: sections in doublings, wide dynamics, a formal sound.",
      briefDeltas: [
        dim("ensembleType", "orchestral", 0.8, "chosen world: arranged / orchestral"),
        dim("doublingRules", "orchestral", 0.7, "chosen world: arranged / orchestral"),
        dim("dynamics", "wide", 0.6, "chosen world: arranged / orchestral"),
        dim("soundAesthetic", "arranged", 0.6, "chosen world: arranged / orchestral"),
      ],
    },
  ];
}

/**
 * The archetypal worlds in the tradition's own words, when PR-U3's world
 * vocabulary has them (hasidic, klezmer); null — the generic wording — when
 * it does not. Only labels and descriptions change: ids and deltas are the
 * generic ones, so an answer means the same thing whichever wording was shown.
 */
export function worldsFor(tradition: string): ClarificationOption[] | null {
  const wording = worldWordingFor(tradition);
  if (!wording) return null;
  return genericWorlds(tradition).map((option) => ({ ...option, ...(wording[option.id] ?? {}) }));
}

const ERA_WORLDS: ClarificationOption[] = [
  {
    id: "electronic_era",
    label: "The synth / electronic side of that decade",
    labelHe: "הצד האלקטרוני / הסינתיסייזרים של העשור",
    description: "Programmed drums, synth basses and pads, produced sound.",
    briefDeltas: [
      dim("soundAesthetic", "electronic", 0.8, "chosen world: electronic side of the decade"),
      dim("ensembleType", "synth_band", 0.7, "chosen world: electronic side of the decade"),
    ],
  },
  {
    id: "band_era",
    label: "The band / rock side of that decade",
    labelHe: "הצד הלהקתי / רוק של העשור",
    description: "Drums, bass, guitars and keys played as a band.",
    briefDeltas: [
      dim("soundAesthetic", "band", 0.8, "chosen world: band side of the decade"),
      dim("ensembleType", "band", 0.7, "chosen world: band side of the decade"),
    ],
  },
  {
    id: "acoustic_era",
    label: "The acoustic singer-songwriter side of that decade",
    labelHe: "הצד האקוסטי / יוצרים-מבצעים של העשור",
    description: "A voice with a small acoustic ensemble.",
    briefDeltas: [
      dim("soundAesthetic", "acoustic", 0.8, "chosen world: acoustic side of the decade"),
      dim("ensembleType", "small_acoustic", 0.7, "chosen world: acoustic side of the decade"),
    ],
  },
];

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

type Detector = (intent: UserIntent, profile: StyleProfile, options: ClarificationOptions) => ClarificationQuestion | null;

const hasReferences = (intent: UserIntent): boolean => intent.references.length > 0;
const namedInstruments = (intent: UserIntent): number =>
  new Set(intent.inferences.filter((i) => i.slot === "instrument").map((i) => i.value)).size;

const worldOfTradition: Detector = (intent, profile, options) => {
  const d = profile.dimensions;
  if (!d.tradition) return null;
  const eraVague = !d.era || VAGUE_ERAS.has(String(d.era.value));
  if (!eraVague) return null;
  if (d.ensembleType || d.productionSchool || d.scene) return null;
  let gain = 0.85;
  if (hasReferences(intent)) gain -= 0.25;
  if (namedInstruments(intent) >= 2) gain -= 0.15;
  if (d.soundAesthetic) gain -= 0.1;
  const tradition = String(d.tradition.value);
  const options_ = (options.worldsFor ?? worldsFor)(tradition) ?? genericWorlds(tradition);
  const eraWord = d.era ? String(d.era.value) : "";
  return {
    id: "world_of_tradition",
    question: `When you say ${eraWord ? `${eraWord} ` : ""}${tradition}, which world do you mean?`,
    questionHe: `כשאתה אומר ${tradition}${eraWord ? ` ${eraWord}` : ""}, לאיזה עולם אתה מתכוון?`,
    informationGain: round3(clamp01(gain)),
    settlesDimensions: ["ensembleType", "productionSchool", "soundAesthetic"],
    trigger: {
      reason: "a named tradition with a vague or missing era and no ensemble, school or scene: each world implies a different band, sound and dynamics",
      sourceRefs: [...(d.tradition.sourceRefs ?? []), ...(d.era?.sourceRefs ?? [])],
    },
    options: options_,
    allowFreeText: true,
  };
};

const eraWithoutWorld: Detector = (intent, profile) => {
  const d = profile.dimensions;
  if (!d.era || !/^\d{4}s$/.test(String(d.era.value))) return null;
  if (d.genre || d.tradition || d.soundAesthetic || d.ensembleType) return null;
  let gain = 0.55;
  if (hasReferences(intent)) gain -= 0.2;
  if (namedInstruments(intent) >= 2) gain -= 0.15;
  return {
    id: "era_without_world",
    question: `${d.era.value} — which side of that decade?`,
    questionHe: `${d.era.value} — איזה צד של העשור?`,
    informationGain: round3(clamp01(gain)),
    settlesDimensions: ["soundAesthetic", "ensembleType"],
    trigger: {
      reason: "a decade alone spans electronic, band and acoustic worlds with different palettes",
      sourceRefs: d.era.sourceRefs ?? [],
    },
    options: ERA_WORLDS,
    allowFreeText: true,
  };
};

const genreConflict: Detector = (_intent, profile) => {
  const conflict = profile.conflicts.find((c) => c.dimension === "genre");
  if (!conflict || conflict.values.length < 2) return null;
  const values = conflict.values.slice(0, 3);
  return {
    id: "genre_conflict",
    question: `Which leads: ${values.join(" or ")}?`,
    questionHe: `מה מוביל: ${values.join(" או ")}?`,
    informationGain: 0.5,
    settlesDimensions: ["genre"],
    trigger: { reason: "more than one genre word was stated; the frame decides the palette and groove", sourceRefs: profile.dimensions.genre?.sourceRefs ?? [] },
    options: values.map((value) => ({
      id: `lead_${value}`,
      label: `${value} leads; the rest is colour`,
      labelHe: `${value} מוביל; השאר צבע`,
      description: `The arrangement is framed as ${value}; other named genres flavour it without redefining it.`,
      briefDeltas: [
        dim("genre", value, 0.9, "chosen as the leading genre"),
        {
          kind: "decision", scope: { kind: "global" }, topic: "style_dimension",
          statement: `${values.filter((v) => v !== value).join(", ")} as colour, not the frame`,
          strength: "soft", rationale: "the other genre words remain as flavour",
        },
      ],
    })),
    allowFreeText: true,
  };
};

const REFERENCE_ASPECTS = ["groove", "sound", "arrangement", "mood"] as const;

const referenceAspect: Detector = (intent) => {
  const ref = intent.references.find((r) => !r.aspect);
  if (!ref) return null;
  return {
    id: `reference_aspect_${ref.id}`,
    question: `What do you want from "${ref.label}"?`,
    questionHe: `מה אתה רוצה לקחת מ-"${ref.label}"?`,
    informationGain: 0.45,
    settlesDimensions: [],
    trigger: { reason: "a reference without a stated aspect could mean its groove, its sound, its arrangement or its mood", sourceRefs: ref.evidence ? [`text:${ref.evidence}`] : [] },
    options: REFERENCE_ASPECTS.map((aspect) => ({
      id: `aspect_${aspect}`,
      label: `Its ${aspect}`,
      labelHe: aspect === "groove" ? "את הגרוב" : aspect === "sound" ? "את הסאונד" : aspect === "arrangement" ? "את העיבוד" : "את האווירה",
      description: `Take only the ${aspect} of the reference; everything else stays this song's own.`,
      briefDeltas: [{
        kind: "decision", scope: { kind: "global" }, topic: "reference",
        statement: `take only the ${aspect} of "${ref.label}"`, strength: "hard",
        rationale: "the producer scoped what the reference contributes",
      }],
    })),
    allowFreeText: true,
  };
};

const DETECTORS: Detector[] = [worldOfTradition, eraWithoutWorld, genreConflict, referenceAspect];

/** Detector questions plus the research agent's, from the profile alone. */
function candidateQuestions(intent: UserIntent, profile: StyleProfile, options: ClarificationOptions): ClarificationQuestion[] {
  return [
    ...DETECTORS.map((detect) => detect(intent, profile, options)).filter((q): q is ClarificationQuestion => q !== null),
    ...researchQuestions(profile),
  ];
}

/**
 * The questions worth asking now: at most `max`, each above `threshold`,
 * highest information gain first.
 */
export function planClarifications(
  intent: UserIntent,
  profile: StyleProfile,
  options: ClarificationOptions = {},
): ClarificationQuestion[] {
  const threshold = options.threshold ?? CLARIFICATION_THRESHOLD;
  const max = options.max ?? MAX_CLARIFICATIONS;
  const questions = candidateQuestions(intent, profile, options)
    .filter((q) => q.informationGain >= threshold)
    .sort((a, b) => b.informationGain - a.informationGain || a.id.localeCompare(b.id));
  return questions.slice(0, max);
}

/** Every question a detector or research would raise, regardless of threshold (for audit). */
export function allClarificationCandidates(
  intent: UserIntent,
  profile: StyleProfile,
  options: ClarificationOptions = {},
): ClarificationQuestion[] {
  return candidateQuestions(intent, profile, options)
    .sort((a, b) => b.informationGain - a.informationGain || a.id.localeCompare(b.id));
}

/**
 * Turn answers into brief deltas. A free-text answer becomes a soft global
 * decision carrying the text; PR-U2 feeds it back through intent extraction.
 */
export function applyClarificationAnswers(
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[] = [],
): { deltas: BriefDelta[]; answered: string[]; unanswered: string[]; sourceRefs: string[] } {
  const deltas: BriefDelta[] = [];
  const answered: string[] = [];
  const sourceRefs: string[] = [];
  for (const question of questions) {
    const answer = answers.find((a) => a.questionId === question.id);
    if (!answer) continue;
    const option = answer.optionId ? question.options.find((o) => o.id === answer.optionId) : undefined;
    if (option) {
      deltas.push(...option.briefDeltas);
      answered.push(question.id);
      sourceRefs.push(`answer:${question.id}/${option.id}`);
    } else if (answer.freeText?.trim()) {
      deltas.push({
        kind: "decision", scope: { kind: "global" }, topic: "other",
        statement: answer.freeText.trim(), strength: "soft",
        rationale: `free-text answer to ${question.id}`,
      });
      answered.push(question.id);
      sourceRefs.push(`answer:${question.id}/free_text`);
    }
  }
  const unanswered = questions.map((q) => q.id).filter((id) => !answered.includes(id));
  return { deltas, answered, unanswered, sourceRefs };
}
