/**
 * Persistent producer conversation (Wave U, PR-U2).
 *
 * The user starts with free text, not a form. Every turn is persisted per
 * project and changes musical state through PR-U1's pure modules only:
 *
 *   intake / refinement  text → extractUserIntent → resolveStyleProfile
 *                        → planClarifications → compileProductionBrief
 *                        (a new brief version; the producer replies with a
 *                        one-paragraph reading + ≤2 information-gain questions)
 *   answers              chosen ClarificationOptions → their BriefDeltas
 *                        → a new brief version
 *   edit request         interpretEditRequest against the current brief and
 *                        the latest plan → an EditPlan (returned, never
 *                        executed here) + durable, scoped decisions
 *   question             explainDecision from the latest plan's own evidence
 *
 * Nothing here writes notes and nothing regenerates; PR-U5 wires the plans to
 * regeneration. The store is injectable so the logic is testable without a
 * database; `producerChatDbStore.ts` is the Drizzle implementation.
 */
import type {
  ArrangementPlan,
  BriefDelta,
  ClarificationAnswer,
  ClarificationQuestion,
  EditPlan,
  IntentReference,
  PlanExplanation,
  ProducerBriefDecision,
  ProducerChatTurnKind,
  ProducerChatTurnRole,
  ProducerChatTurnStructured,
  ProducerDecisionScope,
  ProducerDecisionTopic,
  ProductionBrief,
  SongModelData,
  StyleDimensionName,
  StyleProfile,
  UserIntent,
} from "@workspace/db";
import { deriveOrchestrationBudget } from "./orchestrationBudget";
import { deriveTransitionPlan } from "./transitionEngine";
import { activeDecisions, compileProductionBrief } from "./producerIntelligence/briefCompiler";
import { applyBriefToPlans } from "./producerIntelligence/briefToPlanner";
import { planClarifications } from "./producerIntelligence/clarification";
import { generateArrangementConcepts } from "./producerIntelligence/conceptGenerator";
import { interpretEditRequest, type EditPlanContext } from "./producerIntelligence/editPlan";
import { explainDecision, type ExplainContext } from "./producerIntelligence/explain";
import {
  extractUserIntent,
  extractUserIntentSync,
  type IntentLanguageModel,
} from "./producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "./producerIntelligence/styleResolution";
import { describeUnderstanding, intentDelta, type IntentDelta } from "./producerIntelligence/understanding";
import { instrumentFamily, lookupWord } from "./producerIntelligence/vocabulary";

// ---------------------------------------------------------------------------
// Records and store contract
// ---------------------------------------------------------------------------

export type ProducerBriefRecord = {
  id: string;
  projectId: string;
  version: number;
  intent: UserIntent;
  styleProfile: StyleProfile;
  brief: ProductionBrief;
  answers: ClarificationAnswer[];
  inputsDigestSha256: string;
  createdAt: string;
};

export type ProducerChatTurnRecord = {
  id: string;
  projectId: string;
  briefId: string | null;
  role: ProducerChatTurnRole;
  text: string;
  structured: ProducerChatTurnStructured | null;
  createdAt: string;
};

export type ProducerBriefDecisionRecord = {
  id: string;
  projectId: string;
  briefId: string;
  decisionId: string;
  decision: ProducerBriefDecision;
  delta: BriefDelta | null;
  supersededBy: string | null;
  createdAt: string;
};

export type ProducerChatStore = {
  currentBrief(projectId: string): Promise<ProducerBriefRecord | null>;
  insertBrief(record: ProducerBriefRecord): Promise<void>;
  insertTurns(records: ProducerChatTurnRecord[]): Promise<void>;
  /** Oldest → newest within the page; `before` is a turn id (exclusive). */
  listTurns(projectId: string, page: { limit: number; before?: string }): Promise<{ turns: ProducerChatTurnRecord[]; hasMore: boolean }>;
  /** Every decision row, oldest first (superseded ones included). */
  listDecisions(projectId: string): Promise<ProducerBriefDecisionRecord[]>;
  insertDecisions(records: ProducerBriefDecisionRecord[]): Promise<void>;
  markSuperseded(projectId: string, rowId: string, supersededBy: string): Promise<void>;
  loadSongModel(projectId: string): Promise<{ version: number; model: SongModelData } | null>;
  loadLatestArrangementPlan(projectId: string): Promise<ArrangementPlan | null>;
  /** Run `fn` atomically where the backend can; the in-memory store just calls it. */
  transaction<T>(fn: (store: ProducerChatStore) => Promise<T>): Promise<T>;
};

export class ProducerChatError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) {
    super(message);
    this.name = "ProducerChatError";
  }
}

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

export type PlanSource = "arrangement" | "derived" | "none";

export type ProducerBriefState = {
  briefRecordId: string;
  version: number;
  brief: ProductionBrief;
  intent: UserIntent;
  styleProfile: StyleProfile;
  /** Open questions worth asking now. */
  clarifications: ClarificationQuestion[];
  decisions: ProducerBriefDecisionRecord[];
  concepts: ReturnType<typeof generateArrangementConcepts>;
  songModelVersion: number | null;
  planSource: PlanSource;
  createdAt: string;
};

export type ProducerTurnOutcome = {
  kind: ProducerChatTurnKind;
  turnId: string;
  producerTurnId: string;
  reply: string;
  editPlan?: EditPlan;
  explanation?: PlanExplanation;
  state: ProducerBriefState;
};

export type IntakeReference = Pick<IntentReference, "kind" | "label" | "aspect">;

export type ProducerAnswerInput = { questionId: string; answerId?: string; freeText?: string };

export type SupersedeDecisionInput = {
  scope: ProducerDecisionScope;
  topic: ProducerDecisionTopic;
  statement: string;
  strength: "hard" | "soft";
  dimension?: ProducerBriefDecision["dimension"];
  value?: ProducerBriefDecision["value"];
  rationale?: string;
};

export type ProducerChatServiceOptions = {
  intentModel?: IntentLanguageModel;
  now?: () => Date;
  newId?: () => string;
};

/** Every StyleDimensionName, checked complete against the contract at compile time. */
const STYLE_DIMENSION_NAME_SET = {
  tradition: true, genre: true, subgenre: true, scene: true, era: true, productionSchool: true,
  ensembleType: true, grooveFamily: true, harmonicLanguage: true, melodicLanguage: true,
  articulationLanguage: true, soundAesthetic: true, tempoBehavior: true, swingRatio: true,
  microtiming: true, subdivisionVocabulary: true, kickSnareLanguage: true, bassAttackPosition: true,
  chordRhythm: true, chordExtensions: true, harmonicRhythm: true, passingChordDensity: true,
  melodicOrnamentation: true, phraseLength: true, pickupBehavior: true, cadenceLanguage: true,
  callAndResponse: true, registerTendencies: true, voicingWidth: true, doublingRules: true,
  articulations: true, fillFrequency: true, transitionLanguage: true, instrumentationHierarchy: true,
  dynamics: true, roomSize: true, saturation: true, stereoAesthetic: true,
} satisfies Record<StyleDimensionName, true>;

export const STYLE_DIMENSION_NAMES = Object.keys(STYLE_DIMENSION_NAME_SET) as StyleDimensionName[];

export function isStyleDimensionName(value: string): value is StyleDimensionName {
  return Object.prototype.hasOwnProperty.call(STYLE_DIMENSION_NAME_SET, value);
}

// ---------------------------------------------------------------------------
// Classification of a chat turn
// ---------------------------------------------------------------------------

const QUESTION_EN = /^\s*(?:why|how come|what(?:'s| is| are)?|where(?:'s| is| are)?|which|explain|is there|are there)(?![\p{L}])/iu;
const QUESTION_HE = /^\s*(?:למה|מדוע|איך|מה|מהו|מהי|איפה|היכן|האם)(?![\p{L}])/u;
const QUESTION_TAIL = /\?\s*$/u;
const EDIT_VERBS = /\b(?:make|change|turn|redo|re-do|regenerate|rewrite|replace|fix|add|remove|drop|mute|keep|leave|bring|put|open|thin|thicken|raise|lower|reduce|boost)\b|(?<![\p{L}])ו?(?:תעשה|תעשו|תשנה|תשנו|תחליף|תחליפו|תתקן|תתקנו|תוריד|תורידו|תוסיף|תוסיפו|תכניס|תכניסו|תשאיר|תשאירו|תשתיק|תפתח|תפתחו|תסגור|תסגרו|תרים|תנמיך)(?![\p{L}])/iu;
const COMPARATIVE = /\b(?:more|less|fewer|bigger|smaller|stronger|softer|louder|quieter|busier|too)\b|(?<![\p{L}])(?:יותר|פחות|עוד|מדי)(?![\p{L}])/iu;
const WHOLE_SONG = /\b(?:whole|entire|throughout the|all over the|everywhere in the)\s+(?:song|track|arrangement|piece)\b|\beverywhere\b|(?<![\p{L}])(?:בכל|כל|לאורך כל)\s+ה?(?:שיר|עיבוד|קטע)(?![\p{L}])/iu;

export type ChatTurnClass = "question" | "edit" | "refinement";

/**
 * A question is answered from the plan; an edit becomes an EditPlan; anything
 * else refines the intake. A global "make it more cinematic" with no
 * constraint, section or instrument is a refinement: it changes the world the
 * style profile describes, which the intake path models better than a soft
 * decision.
 */
export function classifyChatTurn(text: string, editPlan: EditPlan, intent: UserIntent): ChatTurnClass {
  const trimmed = text.trim();
  if (QUESTION_EN.test(trimmed) || QUESTION_HE.test(trimmed)) return "question";
  if (QUESTION_TAIL.test(trimmed) && !intent.constraints.length && !EDIT_VERBS.test(trimmed)) return "question";
  const hasInstrument = intent.inferences.some((i) => i.slot === "instrument");
  const editLike =
    intent.constraints.length > 0 ||
    intent.sectionRequests.length > 0 ||
    hasInstrument ||
    editPlan.scope.kind === "phrase" ||
    EDIT_VERBS.test(trimmed) ||
    COMPARATIVE.test(trimmed);
  if (!editLike) return "refinement";
  const descriptiveOnly =
    editPlan.scope.kind === "global" &&
    (editPlan.intent === "change_aesthetic" || editPlan.intent === "change_groove" || editPlan.intent === "change_harmony" || editPlan.intent === "unclear") &&
    !intent.constraints.length && !hasInstrument && !intent.sectionRequests.length;
  return descriptiveOnly ? "refinement" : "edit";
}

/**
 * The durable deltas an edit leaves behind. PR-U1's edit plan carries them
 * for the intents it maps; when it maps none (a `regenerate_part` / `unclear`
 * reading of a phrase that still drew a boundary), the user's constraints are
 * kept verbatim as decisions, scoped by the edit plan — or globally when the
 * text says "in the whole song". Nothing stronger than the words is recorded.
 */
export function standingRuleDeltas(text: string, intent: UserIntent, editPlan: EditPlan): BriefDelta[] {
  if (editPlan.briefDeltas.length) return editPlan.briefDeltas;
  const wholeSong = WHOLE_SONG.test(text);
  const sectionName = editPlan.scope.sectionName;
  const scope: ProducerDecisionScope = wholeSong
    ? { kind: "global" }
    : editPlan.scope.kind === "track" && editPlan.scope.instrument
      ? { kind: "track", instrument: editPlan.scope.instrument, ...(sectionName ? { sectionName } : {}) }
      : sectionName
        ? { kind: "section", sectionName }
        : { kind: "global" };
  const rationale = `chat: "${text.trim()}"`;
  const verbs: Record<UserIntent["constraints"][number]["kind"], string> = { avoid: "no", limit: "less", keep: "keep", require: "needs" };
  return intent.constraints.map((constraint): BriefDelta => {
    const entry = lookupWord(constraint.subject);
    const family = entry?.slot === "instrument" ? instrumentFamily(entry.value) : undefined;
    const topic: ProducerDecisionTopic = family ? "instrumentation"
      : entry?.slot === "energy" ? "energy"
        : entry?.slot === "density" ? "density"
          : constraint.subject === "climax" ? "climax"
            : entry?.slot === "mood" || entry?.slot === "production_feel" ? "aesthetic"
              : "other";
    return {
      kind: "decision", scope, topic,
      statement: `${verbs[constraint.kind]} ${constraint.subject} — "${constraint.statement}"`,
      strength: "hard",
      value: family ?? entry?.value ?? constraint.subject,
      rationale,
    };
  });
}

// ---------------------------------------------------------------------------
// Delta → decision mapping (the compiler's own statement conventions)
// ---------------------------------------------------------------------------

const scopeKey = (scope: ProducerDecisionScope): string => JSON.stringify(scope);

/** The decisions in `brief` that applying `delta` produced. */
export function decisionsProducedBy(brief: ProductionBrief, delta: BriefDelta): ProducerBriefDecision[] {
  const producer = brief.producerDecisions.filter((d) => d.createdBy === "producer");
  switch (delta.kind) {
    case "decision":
      return producer.filter((d) => d.topic === delta.topic && scopeKey(d.scope) === scopeKey(delta.scope) && d.statement === delta.statement);
    case "instrumentation":
      return producer.filter((d) => d.topic === "instrumentation" && d.scope.kind === "global" && d.statement === delta.rationale);
    case "vocal_space":
      return producer.filter((d) => d.topic === "vocal_space" && d.statement === delta.rationale);
    case "section_intention":
      return producer.filter((d) => d.scope.kind === "section" && d.statement === `${d.scope.sectionName}: ${delta.rationale}`);
    case "set_dimension":
      return producer.filter((d) => d.topic === "style_dimension" && d.dimension === delta.dimension && d.statement.endsWith(`— ${delta.rationale}`));
    case "exclude_value":
      return producer.filter((d) => d.statement === `no ${delta.value} — ${delta.rationale}`);
    default:
      return [];
  }
}

/** Re-apply explicit supersessions that recompiling cannot know about. */
function applySupersessions(brief: ProductionBrief, rows: ProducerBriefDecisionRecord[]): ProductionBrief {
  const explicit = new Map<string, string[]>();
  for (const row of rows) {
    if (row.decision.supersedes.length) explicit.set(row.decisionId, row.decision.supersedes);
  }
  if (!explicit.size) return brief;
  return {
    ...brief,
    producerDecisions: brief.producerDecisions.map((d) => {
      const extra = explicit.get(d.id);
      return extra ? { ...d, supersedes: [...new Set([...d.supersedes, ...extra])] } : d;
    }),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

type CompiledVersion = {
  record: ProducerBriefRecord;
  questions: ClarificationQuestion[];
  newDecisions: ProducerBriefDecisionRecord[];
  unchanged: boolean;
  songModel: { version: number; model: SongModelData } | null;
  delta: IntentDelta;
};

const fallbackId = (): string => `pc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function createProducerChatService(store: ProducerChatStore, options: ProducerChatServiceOptions = {}) {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? fallbackId;

  const providedReferences = (intent: UserIntent | undefined): IntakeReference[] =>
    (intent?.references ?? []).filter((r) => !r.evidence).map(({ kind, label, aspect }) => ({ kind, label, ...(aspect ? { aspect } : {}) }));

  /**
   * Compile the next brief version from the cumulative intake text, the
   * answers so far and every active chat decision (+ this turn's new deltas).
   */
  async function compileVersion(
    tx: ProducerChatStore,
    projectId: string,
    input: {
      previous: ProducerBriefRecord | null;
      text: string;
      references: IntakeReference[];
      answers: ClarificationAnswer[];
      newDeltas: BriefDelta[];
      /** Decision ids the new deltas explicitly supersede (API supersede). */
      supersedes?: string[];
      /** Decision rows whose deltas must not be applied any more. */
      excludeRowIds?: string[];
      briefRecordId?: string;
    },
  ): Promise<CompiledVersion> {
    const at = now();
    const songModel = await tx.loadSongModel(projectId);
    const intent = await extractUserIntent(input.text, { llm: options.intentModel, references: input.references, now: at });
    const profile = resolveStyleProfile(intent, { now: at });
    const rows = await tx.listDecisions(projectId);
    const excluded = new Set(input.excludeRowIds ?? []);
    const activeRows = rows.filter((r) => !r.supersededBy && !excluded.has(r.id));
    const deltas = [
      ...activeRows.map((r) => r.delta).filter((d): d is BriefDelta => !!d),
      ...input.newDeltas,
    ];
    const compiled = compileProductionBrief(intent, profile, songModel?.model, input.answers, {
      now: at,
      deltas,
      decisions: rows.map((r) => r.decision),
    });
    const briefRecordId = input.briefRecordId ?? newId();
    const version = (input.previous?.version ?? 0) + 1;
    const knownActive = new Set(activeRows.map((r) => r.decisionId));
    const newDecisions: ProducerBriefDecisionRecord[] = [];
    for (const delta of input.newDeltas) {
      for (const decision of decisionsProducedBy(compiled, delta)) {
        if (knownActive.has(decision.id) || newDecisions.some((r) => r.decisionId === decision.id)) continue;
        const supersedes = [...new Set([...decision.supersedes, ...(input.supersedes ?? [])])];
        newDecisions.push({
          id: newId(), projectId, briefId: briefRecordId, decisionId: decision.id,
          decision: { ...decision, supersedes }, delta, supersededBy: null, createdAt: at.toISOString(),
        });
      }
    }
    const brief = applySupersessions(compiled, [...rows, ...newDecisions]);
    const questions = planClarifications(intent, profile).filter((q) => brief.openQuestionIds.includes(q.id));
    const delta = intentDelta(input.previous?.intent ?? null, intent);
    // A turn that read nothing new, decided nothing and answered nothing
    // leaves the current version in place (the transcript still records it).
    const nothingRead = !delta.inferences.length && !delta.constraints.length && !delta.references.length;
    const sameAnswers = JSON.stringify(input.previous?.answers ?? []) === JSON.stringify(input.answers);
    const unchanged = !!input.previous && nothingRead && newDecisions.length === 0 && sameAnswers && excluded.size === 0;
    return {
      record: {
        id: briefRecordId, projectId, version, intent, styleProfile: profile, brief,
        answers: input.answers, inputsDigestSha256: brief.inputsDigestSha256, createdAt: at.toISOString(),
      },
      questions,
      newDecisions,
      unchanged,
      songModel,
      delta,
    };
  }

  async function planContextFor(
    tx: ProducerChatStore,
    projectId: string,
    brief: ProductionBrief,
    songModel: SongModelData | undefined,
  ): Promise<{ context: ExplainContext & EditPlanContext; source: PlanSource }> {
    const plan = await tx.loadLatestArrangementPlan(projectId);
    if (plan?.globalPlan && plan.sectionPlan) {
      return {
        context: {
          globalPlan: plan.globalPlan, sectionPlan: plan.sectionPlan,
          orchestrationBudget: plan.orchestrationBudget, transitionPlan: plan.transitionPlan, brief,
        },
        source: "arrangement",
      };
    }
    if (songModel) {
      // No arrangement yet: plan (not compose) from the song model with the
      // brief's hints, so edits and explanations reason over real sections.
      const at = now();
      const { globalPlan, sectionPlan } = applyBriefToPlans(songModel, brief, { now: at });
      const orchestrationBudget = deriveOrchestrationBudget(songModel, sectionPlan, { now: at });
      const transitionPlan = deriveTransitionPlan(songModel, globalPlan, sectionPlan, { now: at });
      return { context: { globalPlan, sectionPlan, orchestrationBudget, transitionPlan, brief }, source: "derived" };
    }
    return { context: { brief }, source: "none" };
  }

  async function stateFor(tx: ProducerChatStore, record: ProducerBriefRecord, songModel: { version: number } | null, planSource: PlanSource): Promise<ProducerBriefState> {
    const decisions = await tx.listDecisions(record.projectId);
    const questions = planClarifications(record.intent, record.styleProfile).filter((q) => record.brief.openQuestionIds.includes(q.id));
    return {
      briefRecordId: record.id, version: record.version, brief: record.brief, intent: record.intent,
      styleProfile: record.styleProfile, clarifications: questions, decisions,
      concepts: generateArrangementConcepts(record.brief, { now: now() }),
      songModelVersion: songModel?.version ?? null, planSource, createdAt: record.createdAt,
    };
  }

  function turnPair(
    projectId: string,
    briefId: string | null,
    userText: string,
    reply: string,
    structured: ProducerChatTurnStructured,
  ): [ProducerChatTurnRecord, ProducerChatTurnRecord] {
    const at = now();
    const later = new Date(at.getTime() + 1);
    return [
      { id: newId(), projectId, briefId, role: "user", text: userText, structured: null, createdAt: at.toISOString() },
      { id: newId(), projectId, briefId, role: "producer", text: reply, structured, createdAt: later.toISOString() },
    ];
  }

  async function persistVersion(tx: ProducerChatStore, compiled: CompiledVersion, previous: ProducerBriefRecord | null): Promise<ProducerBriefRecord> {
    if (compiled.unchanged && previous) return previous;
    await tx.insertBrief(compiled.record);
    if (compiled.newDecisions.length) await tx.insertDecisions(compiled.newDecisions);
    return compiled.record;
  }

  async function runIntake(
    tx: ProducerChatStore,
    projectId: string,
    text: string,
    references: IntakeReference[],
    kind: "intake" | "refinement",
  ): Promise<ProducerTurnOutcome> {
    const previous = await tx.currentBrief(projectId);
    const cumulative = previous ? `${previous.intent.rawText}\n${text.trim()}` : text.trim();
    const compiled = await compileVersion(tx, projectId, {
      previous, text: cumulative,
      references: [...providedReferences(previous?.intent), ...references],
      answers: previous?.answers ?? [], newDeltas: [],
    });
    const record = await persistVersion(tx, compiled, previous);
    const reply = describeUnderstanding({
      intent: compiled.record.intent, profile: compiled.record.styleProfile, brief: compiled.record.brief,
      questions: compiled.questions, hasSongModel: !!compiled.songModel, version: record.version,
      ...(previous ? { delta: compiled.delta } : {}),
    });
    const [userTurn, producerTurn] = turnPair(projectId, record.id, text, reply, {
      kind, briefVersion: record.version, intentDelta: compiled.delta, clarifications: compiled.questions,
      intentMethod: compiled.record.intent.method,
    });
    await tx.insertTurns([userTurn, producerTurn]);
    const planSource = compiled.songModel ? "derived" : "none";
    return { kind, turnId: userTurn.id, producerTurnId: producerTurn.id, reply, state: await stateFor(tx, record, compiled.songModel, planSource) };
  }

  return {
    async intake(projectId: string, input: { text: string; references?: IntakeReference[] }): Promise<ProducerTurnOutcome> {
      if (!input.text.trim()) throw new ProducerChatError(400, "Tell me something about the arrangement first");
      return store.transaction((tx) => runIntake(tx, projectId, input.text, input.references ?? [], "intake"));
    },

    async answer(projectId: string, input: { answers: ProducerAnswerInput[] }): Promise<ProducerTurnOutcome> {
      return store.transaction(async (tx) => {
        const previous = await tx.currentBrief(projectId);
        if (!previous) throw new ProducerChatError(409, "No production brief yet — start with intake");
        const open = planClarifications(previous.intent, previous.styleProfile).filter((q) => previous.brief.openQuestionIds.includes(q.id));
        const answers: ClarificationAnswer[] = [];
        const freeTexts: string[] = [];
        for (const a of input.answers) {
          const question = open.find((q) => q.id === a.questionId);
          if (!question) throw new ProducerChatError(400, `Unknown or already answered question "${a.questionId}" (open: ${open.map((q) => q.id).join(", ") || "none"})`);
          if (a.answerId) {
            if (!question.options.some((o) => o.id === a.answerId)) throw new ProducerChatError(400, `Question "${a.questionId}" has no option "${a.answerId}"`);
            answers.push({ questionId: a.questionId, optionId: a.answerId });
          } else if (a.freeText?.trim()) {
            if (!question.allowFreeText) throw new ProducerChatError(400, `Question "${a.questionId}" takes one of its options`);
            answers.push({ questionId: a.questionId, freeText: a.freeText.trim() });
            freeTexts.push(a.freeText.trim());
          } else {
            throw new ProducerChatError(400, `Answer "${a.questionId}" with an answerId or freeText`);
          }
        }
        if (!answers.length) throw new ProducerChatError(400, "No answers given");
        // Free text is also fed back through intent extraction (PR-U1's note).
        const cumulative = freeTexts.length ? `${previous.intent.rawText}\n${freeTexts.join("\n")}` : previous.intent.rawText;
        const compiled = await compileVersion(tx, projectId, {
          previous, text: cumulative, references: providedReferences(previous.intent),
          answers: [...previous.answers.filter((p) => !answers.some((a) => a.questionId === p.questionId)), ...answers],
          newDeltas: [],
        });
        const record = await persistVersion(tx, compiled, previous);
        const chosen = answers.map((a) => {
          const q = open.find((x) => x.id === a.questionId)!;
          const option = a.optionId ? q.options.find((o) => o.id === a.optionId) : undefined;
          const settles = option ? [...new Set(option.briefDeltas.filter((d) => d.kind === "set_dimension").map((d) => (d as { dimension: string }).dimension))] : [];
          return option
            ? `${option.label}${settles.length ? ` — settles ${settles.join(", ")}` : ""}`
            : `"${a.freeText}" (noted as a soft decision and read as intake)`;
        });
        const remaining = compiled.questions;
        const reply = [
          `Understood: ${chosen.join("; ")}. Brief updated to v${record.version}.`,
          remaining.length ? `Still open: ${remaining.map((q) => q.question).join(" ")}` : "No further questions — the brief is ready to plan from.",
        ].join(" ");
        const userText = answers.map((a) => {
          const q = open.find((x) => x.id === a.questionId)!;
          const option = a.optionId ? q.options.find((o) => o.id === a.optionId) : undefined;
          return option ? `${q.question} → ${option.label}` : `${q.question} → ${a.freeText}`;
        }).join("\n");
        const [userTurn, producerTurn] = turnPair(projectId, record.id, userText, reply, {
          kind: "answers", briefVersion: record.version, answers, clarifications: remaining, intentDelta: compiled.delta,
          intentMethod: compiled.record.intent.method,
        });
        await tx.insertTurns([userTurn, producerTurn]);
        return { kind: "answers", turnId: userTurn.id, producerTurnId: producerTurn.id, reply, state: await stateFor(tx, record, compiled.songModel, compiled.songModel ? "derived" : "none") };
      });
    },

    async chat(projectId: string, input: { text: string }): Promise<ProducerTurnOutcome> {
      const text = input.text.trim();
      if (!text) throw new ProducerChatError(400, "Say something first");
      return store.transaction(async (tx) => {
        const previous = await tx.currentBrief(projectId);
        if (!previous) return runIntake(tx, projectId, text, [], "intake");
        const songModel = await tx.loadSongModel(projectId);
        const { context, source } = await planContextFor(tx, projectId, previous.brief, songModel?.model);
        const at = now();
        const intent = extractUserIntentSync(text, { now: at });
        const editPlan = interpretEditRequest(text, previous.brief, context, { now: at });
        const turnClass = classifyChatTurn(text, editPlan, intent);

        if (turnClass === "question") {
          const explanation = explainDecision(context, text);
          const prefix = source === "derived"
            ? "(Reading the plan derived from the current brief — no arrangement has been generated yet.) "
            : source === "none" ? "(There is no Song Model or arrangement to read yet.) " : "";
          const reply = `${prefix}${explanation.answer}`;
          const [userTurn, producerTurn] = turnPair(projectId, previous.id, text, reply, {
            kind: "explanation", briefVersion: previous.version, explanation, planSource: source,
          });
          await tx.insertTurns([userTurn, producerTurn]);
          return { kind: "explanation", turnId: userTurn.id, producerTurnId: producerTurn.id, reply, explanation, state: await stateFor(tx, previous, songModel, source) };
        }

        if (turnClass === "refinement") return runIntake(tx, projectId, text, [], "refinement");

        const newDeltas = standingRuleDeltas(text, intent, editPlan);
        const compiled = await compileVersion(tx, projectId, {
          previous, text: previous.intent.rawText, references: providedReferences(previous.intent),
          answers: previous.answers, newDeltas,
        });
        if (!compiled.newDecisions.length && intent.sectionRequests.length) {
          // The section could not be matched (no Song Model yet, or no such
          // section): keep the words as a section wish on the intake — the
          // brief lists it under unresolvedSectionRequests and resolves it
          // when the song's sections are known — rather than drop them.
          return runIntake(tx, projectId, text, [], "refinement");
        }
        const record = await persistVersion(tx, compiled, previous);
        const recorded = compiled.newDecisions.map((r) => r.decision);
        const describeScope = (scope: ProducerDecisionScope): string =>
          scope.kind === "global" ? "the whole song"
            : scope.kind === "section" ? `"${scope.sectionName}"`
              : scope.kind === "track" ? `${scope.instrument}${scope.sectionName ? ` in "${scope.sectionName}"` : ""}`
                : `phrase ${scope.phraseId}`;
        const ruleLines = recorded.map((d) => `${d.strength === "hard" ? "Standing rule" : "Preference"} for ${describeScope(d.scope)}: ${d.statement}${d.supersedes.length ? ` (replaces ${d.supersedes.length} earlier decision${d.supersedes.length > 1 ? "s" : ""})` : ""}.`);
        const reply = [
          editPlan.rationale,
          ...ruleLines,
          recorded.length ? `Brief updated to v${record.version}.` : "No durable decision was recorded from this; the plan above is what a regeneration would do.",
          "Nothing is regenerated from chat yet — the plan is returned for the next arrangement.",
        ].join(" ");
        const [userTurn, producerTurn] = turnPair(projectId, record.id, text, reply, {
          kind: "edit", briefVersion: record.version, editPlan, decisionIds: recorded.map((d) => d.id), planSource: source,
        });
        await tx.insertTurns([userTurn, producerTurn]);
        return { kind: "edit", turnId: userTurn.id, producerTurnId: producerTurn.id, reply, editPlan, state: await stateFor(tx, record, compiled.songModel, source) };
      });
    },

    async state(projectId: string): Promise<ProducerBriefState | null> {
      const record = await store.currentBrief(projectId);
      if (!record) return null;
      const songModel = await store.loadSongModel(projectId);
      const plan = await store.loadLatestArrangementPlan(projectId);
      const source: PlanSource = plan?.globalPlan && plan.sectionPlan ? "arrangement" : songModel ? "derived" : "none";
      return stateFor(store, record, songModel, source);
    },

    turns(projectId: string, page: { limit?: number; before?: string } = {}) {
      const limit = Math.max(1, Math.min(200, Math.floor(page.limit ?? 50)));
      return store.listTurns(projectId, { limit, ...(page.before ? { before: page.before } : {}) });
    },

    async supersedeDecision(projectId: string, decisionId: string, replacement: SupersedeDecisionInput): Promise<ProducerTurnOutcome> {
      if (!replacement.statement.trim()) throw new ProducerChatError(400, "A replacement decision needs a statement");
      return store.transaction(async (tx) => {
        const previous = await tx.currentBrief(projectId);
        if (!previous) throw new ProducerChatError(409, "No production brief yet — start with intake");
        const rows = await tx.listDecisions(projectId);
        const row = rows.find((r) => r.decisionId === decisionId && !r.supersededBy);
        const inBrief = activeDecisions(previous.brief).find((d) => d.id === decisionId);
        if (!row && !inBrief) throw new ProducerChatError(404, `No active decision "${decisionId}" in this project`);
        const delta: BriefDelta = {
          kind: "decision", scope: replacement.scope, topic: replacement.topic, statement: replacement.statement.trim(),
          strength: replacement.strength, ...(replacement.dimension ? { dimension: replacement.dimension } : {}),
          ...(replacement.value !== undefined ? { value: replacement.value } : {}),
          rationale: replacement.rationale?.trim() || `supersedes ${decisionId}`,
        };
        const compiled = await compileVersion(tx, projectId, {
          previous, text: previous.intent.rawText, references: providedReferences(previous.intent),
          answers: previous.answers, newDeltas: [delta], supersedes: [decisionId],
          ...(row ? { excludeRowIds: [row.id] } : {}),
        });
        if (!compiled.newDecisions.length) throw new ProducerChatError(409, "The replacement produced no decision in the brief");
        const record = await persistVersion(tx, { ...compiled, unchanged: false }, previous);
        if (row) await tx.markSuperseded(projectId, row.id, compiled.newDecisions[0].id);
        const replaced = row?.decision ?? inBrief!;
        const reply = `Replaced "${replaced.statement}" with "${delta.statement}" (${delta.strength}, ${delta.scope.kind}). Brief updated to v${record.version}.`;
        const [userTurn, producerTurn] = turnPair(projectId, record.id, delta.statement, reply, {
          kind: "supersede", briefVersion: record.version, decisionIds: compiled.newDecisions.map((r) => r.decisionId),
        });
        await tx.insertTurns([userTurn, producerTurn]);
        return { kind: "supersede", turnId: userTurn.id, producerTurnId: producerTurn.id, reply, state: await stateFor(tx, record, compiled.songModel, compiled.songModel ? "derived" : "none") };
      });
    },
  };
}

export type ProducerChatService = ReturnType<typeof createProducerChatService>;

// ---------------------------------------------------------------------------
// In-memory store (tests and the fallback for the service's own unit tests)
// ---------------------------------------------------------------------------

export function createInMemoryProducerChatStore(seed: {
  songModel?: { version: number; model: SongModelData } | null;
  arrangementPlan?: ArrangementPlan | null;
} = {}): ProducerChatStore & { briefs: ProducerBriefRecord[]; turns: ProducerChatTurnRecord[]; decisions: ProducerBriefDecisionRecord[] } {
  const briefs: ProducerBriefRecord[] = [];
  const turns: ProducerChatTurnRecord[] = [];
  const decisions: ProducerBriefDecisionRecord[] = [];
  const byTime = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }) =>
    a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const self: ProducerChatStore & { briefs: ProducerBriefRecord[]; turns: ProducerChatTurnRecord[]; decisions: ProducerBriefDecisionRecord[] } = {
    briefs, turns, decisions,
    async currentBrief(projectId) {
      return briefs.filter((b) => b.projectId === projectId).sort((a, b) => b.version - a.version)[0] ?? null;
    },
    async insertBrief(record) {
      if (briefs.some((b) => b.projectId === record.projectId && b.version === record.version)) throw new Error("duplicate brief version");
      briefs.push(record);
    },
    async insertTurns(records) { turns.push(...records); },
    async listTurns(projectId, page) {
      const all = turns.filter((t) => t.projectId === projectId).sort(byTime);
      const cutoff = page.before ? all.findIndex((t) => t.id === page.before) : all.length;
      const visible = cutoff >= 0 ? all.slice(0, cutoff) : all;
      const slice = visible.slice(Math.max(0, visible.length - page.limit));
      return { turns: slice, hasMore: visible.length > slice.length };
    },
    async listDecisions(projectId) {
      return decisions.filter((d) => d.projectId === projectId).sort(byTime);
    },
    async insertDecisions(records) { decisions.push(...records); },
    async markSuperseded(projectId, rowId, supersededBy) {
      const row = decisions.find((d) => d.projectId === projectId && d.id === rowId);
      if (row) row.supersededBy = supersededBy;
    },
    async loadSongModel() { return seed.songModel ?? null; },
    async loadLatestArrangementPlan() { return seed.arrangementPlan ?? null; },
    async transaction(fn) { return fn(self); },
  };
  return self;
}
