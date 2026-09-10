/**
 * Brain B-12b invariant: one style contract (B-09).
 *
 *   - a genre the knowledge base does not know yields `unknown` grammar
 *     values (nothing invented) and at most three questions;
 *   - a brief that has answered every question the resolver asks yields no
 *     further question (a fixpoint within a few rounds);
 *   - the same brief and Song Model resolve to the identical grammar, twice,
 *     and through the planner hints.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { compileProductionBrief } from "../producerIntelligence/briefCompiler";
import { briefPlannerHints } from "../producerIntelligence/briefToPlanner";
import { extractUserIntentSync } from "../producerIntelligence/intentExtraction";
import { resolveStyleProfile } from "../producerIntelligence/styleResolution";
import { STYLE_PATHS, getStyleValue } from "../styleGrammar";
import { MAX_STYLE_QUESTIONS, answerStyleQuestion, resolveStyle, type ResolveStyleInput, type StyleResolution } from "../styleResolver";
import { NOW, stableStringify, type Violation } from "./analysis";
import { recordEvidence, seedsUpTo, summarizeOutcomes, type SeedOutcome } from "./evidence";
import { generateSongModel, makeRng } from "./generators";

const SEEDS = seedsUpTo(20, 1700);
const describe = (violations: Violation[]) => violations.slice(0, 4).map((v) => `${v.code}: ${v.detail}`).join(" | ");

/**
 * Genres offered to the 14-entry knowledge base (B-09's honest limits name
 * several as missing). Two of them - "grunge" and "trance" - do resolve, to
 * `rock` and `edm_dance`, and that is a correct reading, not a defect: the
 * suite therefore splits the list by what the resolver actually matched and
 * holds the unknown-genre invariant over the genres that really are unknown,
 * while the matched ones serve as the resolver's positive control (a base that
 * matched nothing at all would make the null result meaningless).
 */
const UNKNOWN_GENRES = [
  "klezmer", "reggae", "funk", "country", "blues", "flamenco", "tango", "polka", "bluegrass", "ska",
  "grunge", "trance", "dubstep", "afrobeat", "fado", "zydeco", "chanson", "cumbia", "baroque", "rembetiko",
];
const KNOWN_TEXTS = [
  "intimate ballad; piano, soft strings, gentle bass, light percussion; big final chorus",
  "upbeat pop; drums, bass, keys, guitar; radio-ready",
  "rock band; drums, bass, electric guitar; raw and loud",
  "jazz standard; piano trio; swinging",
  "cinematic orchestral score; strings, brass, percussion; huge climax",
  "edm dance track; four on the floor; synths",
  "singer-songwriter acoustic; guitar and voice",
  "gospel; choir, organ, drums",
  "bossa nova; nylon guitar, soft percussion",
  "hip-hop; heavy drums, sub bass, sparse keys",
];

function briefFor(text: string, model: ReturnType<typeof generateSongModel>["model"]) {
  const intent = extractUserIntentSync(text, { now: NOW });
  const profile = resolveStyleProfile(intent, { now: NOW });
  return compileProductionBrief(intent, profile, model, [], { now: NOW });
}

const songFacts = (model: ReturnType<typeof generateSongModel>["model"]) => ({ tempoBpm: model.tempoMap[0].bpm, meter: model.meterMap[0].meter, key: model.keyMap[0].key });

const grammarDigest = (r: StyleResolution) => stableStringify({ g: r.grammar, q: r.questions.map((q) => q.id), k: r.knowledge.entry, d: r.inputsDigestSha256 });

test("an unknown genre yields unknown grammar values (nothing invented) and at most three questions (20 genres x song facts)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let questionsTotal = 0;
  let unknown = 0;
  const matched: string[] = [];
  for (const [i, seed] of SEEDS.entries()) {
    const genre = UNKNOWN_GENRES[i % UNKNOWN_GENRES.length];
    const { model } = generateSongModel(seed);
    const resolution = resolveStyle({ styleText: genre, song: songFacts(model) });
    const violations: Violation[] = [];
    if (resolution.knowledge.entry !== null) {
      // The antecedent does not hold: this genre is known to the base. Judge it
      // as the control instead - a matched entry must be named, and its values
      // may then come from that entry's template.
      matched.push(`${genre}->${resolution.knowledge.entry}`);
      if (resolution.flags.includes("no_knowledge_entry")) violations.push({ code: "matched_entry_flagged_unknown", detail: `${genre} matched ${resolution.knowledge.entry} yet carries no_knowledge_entry` });
      if (!STYLE_PATHS.some((path) => getStyleValue(resolution.grammar, path)?.provenance === "template")) violations.push({ code: "matched_entry_filled_nothing", detail: `${genre} matched ${resolution.knowledge.entry} and filled no value from its template` });
      outcomes.push({ seed, passed: violations.length === 0, violations, notes: { genre, matchedEntry: resolution.knowledge.entry, unknownPaths: resolution.grammar.unknown.length } });
      questionsTotal += resolution.questions.length;
      continue;
    }
    unknown += 1;
    if (!resolution.flags.includes("no_knowledge_entry")) violations.push({ code: "no_knowledge_flag_missing", detail: `${genre}: flags ${resolution.flags.join(",")}` });
    const genreValue = getStyleValue(resolution.grammar, "identity.genre");
    if (genreValue && genreValue.provenance !== "brief") violations.push({ code: "genre_invented", detail: `${genre}: identity.genre = ${String(genreValue.value)} from ${genreValue.provenance}` });
    // Nothing may come from a template when no entry matched.
    const templated = STYLE_PATHS.filter((path) => getStyleValue(resolution.grammar, path)?.provenance === "template");
    if (templated.length) violations.push({ code: "template_values_without_entry", count: templated.length, detail: `${genre}: ${templated.slice(0, 5).join(", ")} filled from a template although no entry matched` });
    if (resolution.grammar.unknown.length < STYLE_PATHS.length / 2) violations.push({ code: "too_much_known", detail: `${genre}: only ${resolution.grammar.unknown.length} of ${STYLE_PATHS.length} paths unknown` });
    if (resolution.questions.length > MAX_STYLE_QUESTIONS) violations.push({ code: "too_many_questions", detail: `${genre}: ${resolution.questions.length} questions` });
    for (const q of resolution.questions) if (q.options.length < 2) violations.push({ code: "question_without_options", detail: `${genre}: ${q.id} has ${q.options.length} option(s)` });
    questionsTotal += resolution.questions.length;
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { genre, unknownPaths: resolution.grammar.unknown.length, questions: resolution.questions.map((q) => q.path).join(","), flags: resolution.flags.join(",") } });
  }
  const record = summarizeOutcomes({ invariant: "style-unknown-genre", description: "resolveStyle on a genre outside the knowledge base: no entry, the no_knowledge_entry flag, no template-provenance values, at least half the contract unknown, at most 3 questions each with >= 2 options. Genres the base does match are judged as the control instead: the entry is named and its template fills something.", outcomes, extra: { questionsTotal, maxQuestions: MAX_STYLE_QUESTIONS, genresUnknown: unknown, genresMatched: matched } });
  recordEvidence(record);
  t.diagnostic(`unknown genre: ${record.passed}/${SEEDS.length} pass; ${unknown} of ${SEEDS.length} genres are unknown to the base, ${matched.length} matched (${matched.join(", ") || "none"}); ${questionsTotal} questions`);
  assert.ok(unknown >= SEEDS.length / 2, `the invariant is measured on real unknowns (${unknown} of ${SEEDS.length})`);
  assert.ok(matched.length > 0, "and the base does match something, so an `unknown` verdict is a reading and not a constant");
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed} ${o.notes?.genre}: ${describe(o.violations)}`), []);
});

test("a brief that has answered every question yields no further question - the resolver reaches a fixpoint within a few rounds (20 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  let maxRounds = 0;
  let answered = 0;
  for (const [i, seed] of SEEDS.entries()) {
    const rng = makeRng(seed * 31);
    const { model } = generateSongModel(seed);
    const text = KNOWN_TEXTS[i % KNOWN_TEXTS.length];
    let input: ResolveStyleInput = { brief: briefFor(text, model), song: songFacts(model) };
    let resolution = resolveStyle(input);
    const initial = resolution.questions.length;
    let rounds = 0;
    const asked: string[] = [];
    while (resolution.questions.length && rounds < 8) {
      const question = resolution.questions[0];
      const option = rng.pick(question.options);
      asked.push(`${question.path}=${String(option.value)}`);
      input = { ...input, answers: [...(input.answers ?? []).filter((a) => a.path !== question.path), { path: question.path, value: option.value }] };
      resolution = answerStyleQuestion(input, question, option.value);
      // The answer is a stated value now.
      const value = getStyleValue(resolution.grammar, question.path);
      if (!value || value.provenance !== "brief" || stableStringify(value.value) !== stableStringify(option.value)) {
        outcomes.push({ seed, passed: false, violations: [{ code: "answer_not_stated", detail: `${question.path}: answered ${String(option.value)}, grammar carries ${value ? `${String(value.value)} (${value.provenance})` : "nothing"}` }] });
        break;
      }
      rounds += 1;
      answered += 1;
    }
    if (outcomes.some((o) => o.seed === seed)) continue;
    maxRounds = Math.max(maxRounds, rounds);
    const violations: Violation[] = resolution.questions.length ? [{ code: "questions_remain_after_answers", detail: `${text}: after ${rounds} answers (${asked.join("; ")}) still asks ${resolution.questions.map((q) => q.path).join(",")}` }] : [];
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { text, initialQuestions: initial, rounds, asked: asked.join("; ") } });
  }
  const record = summarizeOutcomes({ invariant: "style-fully-specified-no-questions", description: "Answering each question the resolver asks (first question, a seeded option) re-enters as a stated brief value and the question list reaches empty within 8 rounds.", outcomes, extra: { maxRounds, answersGiven: answered } });
  recordEvidence(record);
  t.diagnostic(`fixpoint: ${record.passed}/${SEEDS.length} pass; max ${maxRounds} rounds; ${answered} answers given`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("the same brief and Song Model resolve identically - twice through the resolver and twice through the planner hints (20 seeds)", (t) => {
  const outcomes: SeedOutcome[] = [];
  for (const [i, seed] of SEEDS.entries()) {
    const { model } = generateSongModel(seed);
    const text = KNOWN_TEXTS[(i + 3) % KNOWN_TEXTS.length];
    const brief = briefFor(text, model);
    const violations: Violation[] = [];
    const a = resolveStyle({ brief, song: songFacts(model) });
    const b = resolveStyle({ brief: briefFor(text, model), song: songFacts(model) });
    if (grammarDigest(a) !== grammarDigest(b)) violations.push({ code: "resolver_not_deterministic", detail: `${text}: two resolutions differ` });
    const h1 = briefPlannerHints(brief, { songModel: model });
    const h2 = briefPlannerHints(briefFor(text, model), { songModel: model });
    const digest = (h: ReturnType<typeof briefPlannerHints>) => stableStringify({ grammar: h.global.styleGrammar, template: h.global.arcTemplate, dyn: h.global.globalDynamicSteps, fam: h.global.familyPriority, style: h.style });
    if (digest(h1) !== digest(h2)) violations.push({ code: "hints_not_deterministic", detail: `${text}: two hint derivations differ` });
    if (!h1.global.styleGrammar) violations.push({ code: "hints_without_grammar", detail: `${text}: no grammar on the planner hints` });
    outcomes.push({ seed, passed: violations.length === 0, violations, notes: { text, entry: a.knowledge.entry ?? "none", questions: a.questions.length } });
  }
  const record = summarizeOutcomes({ invariant: "style-deterministic", description: "resolveStyle and briefPlannerHints are pure in (brief, Song Model): identical grammar, questions, knowledge entry and digest on a second call.", outcomes });
  recordEvidence(record);
  t.diagnostic(`determinism: ${record.passed}/${SEEDS.length} pass`);
  assert.deepEqual(outcomes.filter((o) => !o.passed).map((o) => `${o.seed}: ${describe(o.violations)}`), []);
});

test("negative controls: two different briefs resolve differently; a known genre matches an entry; an answered question leaves the list", () => {
  const { model } = generateSongModel(1701);
  const jazz = resolveStyle({ brief: briefFor(KNOWN_TEXTS[3], model), song: songFacts(model) });
  const edm = resolveStyle({ brief: briefFor(KNOWN_TEXTS[5], model), song: songFacts(model) });
  assert.notEqual(grammarDigest(jazz), grammarDigest(edm));
  assert.ok(jazz.knowledge.entry && edm.knowledge.entry && jazz.knowledge.entry !== edm.knowledge.entry, `${jazz.knowledge.entry} vs ${edm.knowledge.entry}`);
  assert.ok(!jazz.flags.includes("no_knowledge_entry"));
  const withQuestions = [jazz, edm, resolveStyle({ brief: briefFor(KNOWN_TEXTS[0], model), song: songFacts(model) })].find((r) => r.questions.length);
  assert.ok(withQuestions, "some brief asks a question");
  const q = withQuestions!.questions[0];
  const answeredRes = answerStyleQuestion({ brief: withQuestions!.grammar === jazz.grammar ? briefFor(KNOWN_TEXTS[3], model) : withQuestions!.grammar === edm.grammar ? briefFor(KNOWN_TEXTS[5], model) : briefFor(KNOWN_TEXTS[0], model), song: songFacts(model) }, q, q.options[0].value);
  assert.ok(!answeredRes.questions.some((x) => x.path === q.path), `${q.path} is no longer asked`);
});
