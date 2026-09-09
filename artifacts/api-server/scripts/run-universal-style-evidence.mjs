/**
 * Run the universal style pipeline on the whole corpus and write the evidence
 * (Wave Q, Q-02 — PR-66).
 *
 *   node scripts/run-universal-style-evidence.mjs
 *
 * For every description: the parsed representation, which fields stayed
 * unknown, the clarification questions, the grammar rules and the arrangement
 * instructions. Then the honest arithmetic — how much of the representation
 * the deterministic parser resolves on its own, how much the seed reasoning
 * provider adds, and how much is still nobody's knowledge.
 *
 * No model is called anywhere in this run. Everything here is the parser plus
 * the cited seed; the numbers are the floor an LLM reasoning provider would
 * have to beat, not a claim about how well the system knows music.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `universal-style-evidence-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./universal-style-evidence-entry.ts")],
  outfile: bundlePath,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const mod = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const {
  decomposeStyle, decomposeStyleDeterministic, listFields, resolutionShare,
  validateSeed, FIELD_REGISTRY, SEED_STYLE_KNOWLEDGE, STYLE_CORPUS, UNIVERSAL_STYLE_PARSER,
} = mod;

const seedProblems = validateSeed();
if (seedProblems.length) {
  console.error("the seed is inconsistent; refusing to write evidence:\n" + seedProblems.join("\n"));
  process.exit(1);
}

const NOW = new Date("2026-09-09T00:00:00.000Z");
const round = (n, d = 3) => Number(n.toFixed(d));
const mean = (xs) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

const rows = [];
for (const entry of STYLE_CORPUS) {
  const before = decomposeStyleDeterministic(entry.description, NOW);
  const result = await decomposeStyle(entry.description, { now: NOW, maxQuestions: 5 });
  const fields = listFields(result.style);
  const basisByPath = Object.fromEntries(fields.map((f) => [f.path, f.field.basis]));
  const parserResolved = new Set(
    listFields(before.style).filter((f) => f.field.basis !== "unknown").map((f) => f.path),
  );

  rows.push({
    id: entry.id,
    kind: entry.kind,
    area: entry.area,
    description: entry.description,
    language: result.style.language,
    tags: result.style.identity.tags.value ?? [],
    regions: result.style.identity.region.value ?? [],
    era: result.style.identity.era.value,
    unrecognisedWords: result.style.unrecognised,
    representation: {
      basisByPath,
      resolvedByParser: [...parserResolved],
      resolvedBySeed: fields.filter((f) => f.field.basis === "evidence").map((f) => f.path),
      unknown: fields.filter((f) => f.field.basis === "unknown").map((f) => f.path),
      hypotheses: result.style.hypotheses,
      contested: result.synthesis.contested,
      ensemble: (result.style.ensemble.value ?? []).map((m) => ({
        instrument: m.instrument, family: m.family, gm: m.gm, role: m.role, styleTags: m.styleTags, recognised: m.recognised,
      })),
      pitchSystem: result.style.harmony.pitchSystem.value
        ? {
            id: result.style.harmony.pitchSystem.value.id,
            name: result.style.harmony.pitchSystem.value.name,
            kind: result.style.harmony.pitchSystem.value.kind,
            pitchClasses: result.style.harmony.pitchSystem.value.pitchClasses,
            microtonal: result.style.harmony.pitchSystem.value.microtonal,
            hypothesis: result.style.harmony.pitchSystem.value.hypothesis,
            caveat: result.style.harmony.pitchSystem.value.caveat,
            basis: result.style.harmony.pitchSystem.basis,
          }
        : null,
    },
    seedNotesApplied: result.synthesis.appliedNotes.map((n) => `${n.id} (${n.matchedOn.join(", ")})`),
    clarificationQuestions: result.questions.map((q) => ({
      id: q.id, path: q.path, reason: q.reason, priority: q.priority, question: q.question.en, currentAssumption: q.currentAssumption,
    })),
    grammar: {
      slotStatus: result.grammarSlot.status,
      ruleCount: result.grammar.rules.length,
      rules: result.grammar.rules.map((r) => ({ id: r.id, weight: r.weight, basis: r.basis, hypothesis: r.hypothesis, description: r.description, directive: r.directive })),
      omittedCount: result.grammar.omitted.length,
      omitted: result.grammar.omitted,
      caveat: result.grammar.basis.caveat,
    },
    instructions: {
      sectionTargets: result.instructions.sectionTargets,
      paletteSize: result.instructions.palette.length,
      palette: result.instructions.palette.map((p) => `${p.instrument} → ${p.role} (${p.gmFamily}${p.gmProgram === null ? "" : ` #${p.gmProgram}`})`),
      roles: result.instructions.roles.map((r) => ({
        role: r.role, arrangementRole: r.arrangementRole, instruments: r.instruments, register: r.register,
        density: r.density, rhythmicActivity: r.rhythmicActivity, melodicActivity: r.melodicActivity,
        voicingStrategy: r.voicingStrategy, articulationFamily: r.articulationFamily, interactionWithLead: r.interactionWithLead,
        constraints: r.constraints, styleTags: r.styleTags, basis: r.basis, confidence: r.confidence, unknowns: r.unknowns,
      })),
      caveat: result.instructions.caveat,
    },
    share: {
      afterParserOnly: before.share,
      afterSeed: result.share,
    },
  });
}

const fieldCount = FIELD_REGISTRY.length;
const summarise = (subset) => ({
  descriptions: subset.length,
  meanParserOnlyResolvedShare: mean(subset.map((r) => 1 - r.share.afterParserOnly.unknownShare)),
  meanDeterministicShare: mean(subset.map((r) => r.share.afterSeed.deterministicShare)),
  meanSeedEvidenceShare: mean(subset.map((r) => r.share.afterSeed.reasoningShare)),
  meanUnknownShare: mean(subset.map((r) => r.share.afterSeed.unknownShare)),
  meanRules: mean(subset.map((r) => r.grammar.ruleCount)),
  meanQuestions: mean(subset.map((r) => r.clarificationQuestions.length)),
  meanPaletteSize: mean(subset.map((r) => r.instructions.paletteSize)),
  grammarUnavailable: subset.filter((r) => r.grammar.slotStatus !== "available").map((r) => r.id),
  withUnrecognisedWords: subset.filter((r) => r.unrecognisedWords.length).map((r) => r.id),
});

// Per-field: how often each field is resolved at all, and by whom.
const perField = FIELD_REGISTRY.map((spec) => {
  const bases = rows.map((r) => r.representation.basisByPath[spec.path]);
  const share = (b) => round(bases.filter((x) => x === b).length / bases.length);
  return {
    path: spec.path,
    consequence: spec.consequence,
    userStated: share("user_stated"),
    inferred: share("inferred"),
    evidence: share("evidence"),
    unknown: share("unknown"),
  };
});

const neverResolved = perField.filter((f) => f.unknown === 1).map((f) => f.path);
const consequentialAndOftenUnknown = perField
  .filter((f) => f.consequence >= 0.6 && f.unknown >= 0.3)
  .map((f) => `${f.path} (consequence ${f.consequence}, unknown in ${Math.round(f.unknown * 100)}% of descriptions)`);

const evidence = {
  title: "Universal style intelligence: any style description in the world, decomposed into actionable features (Wave Q, Q-02 — PR-66)",
  date: "2026-09-09",
  what: [
    "A style description — in any words, in English or Hebrew, including combinations nobody programmed for — is decomposed into a representation of measurable musical features, and from there into StyleGrammar rules and per-role arrangement instructions.",
    "There is no genre list on the path. Genre words are free tags; a word no lexicon knows is still kept as a tag, flagged unrecognised, and asked about rather than guessed at.",
    "Every field carries value + confidence + basis (user_stated | inferred | evidence | unknown) + its sources. An unknown is an explicit unknown, never a default dressed up as knowledge.",
    "No model writes notes and no model runs in this evidence at all: the run below is the deterministic parser plus a cited seed of style knowledge. The reasoning-provider interface exists so an LLM can fill inferred/evidence fields later — through the same claim merge, which cannot override the user and cannot hold a note sequence.",
  ],
  method: {
    parser: UNIVERSAL_STYLE_PARSER,
    reasoningProvider: "seed-style-knowledge/v1 (deterministic, rule-based, over a cited seed — a seed, not a genre database)",
    seedNotes: SEED_STYLE_KNOWLEDGE.length,
    fieldsInRepresentation: fieldCount,
    corpusSize: STYLE_CORPUS.length,
    llmCalls: 0,
    determinism: "the same description gives the same decomposition; asserted in universalStyle.test.ts",
  },
  honestly: {
    whatThisIsNot: [
      "Not a measurement of how well the system knows music: the seed is a few dozen worlds, deliberately small, and most of the world is not in it.",
      "Not a claim that the seed's claims are right. Each is a cited, confidence-weighted generalisation about a tradition; where a claim is an approximation of a richer practice (a raga as a scale, a maqam at 24-TET, one written form of a qeñet) it is marked a hypothesis and the clarification step asks before a composer leans on it.",
      "Not an arrangement. Nothing here writes a note; the output is instructions the existing composers read.",
    ],
    knownGaps: [
      "Fields never resolved by parser or seed on this corpus are listed below; they are the reasoning provider's job.",
      "The seed's coverage is uneven: a well-documented commercial style resolves far more fields than a tradition the seed only knows the ensemble of.",
      "A pitch system outside the lexicon comes back unknown rather than approximated — correct, and it means whole traditions produce no pitch-system rule.",
    ],
  },
  results: {
    overall: summarise(rows),
    real: summarise(rows.filter((r) => r.kind === "real")),
    novel: summarise(rows.filter((r) => r.kind === "novel")),
    perField,
    neverResolvedOnThisCorpus: neverResolved,
    consequentialAndOftenUnknown,
  },
  descriptions: rows,
};

const outPath = join(repoRoot, "docs/evidence/universal-style-live.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

const o = evidence.results.overall;
console.log(`${STYLE_CORPUS.length} descriptions (${evidence.results.real.descriptions} real, ${evidence.results.novel.descriptions} novel), ${fieldCount} fields each`);
console.log(`parser alone resolves ${Math.round(o.meanParserOnlyResolvedShare * 100)}% of fields on average`);
console.log(`after the seed: ${Math.round(o.meanDeterministicShare * 100)}% stated/inferred from the text, ${Math.round(o.meanSeedEvidenceShare * 100)}% from the seed, ${Math.round(o.meanUnknownShare * 100)}% still unknown`);
console.log(`mean ${o.meanRules} grammar rules, ${o.meanQuestions} clarification questions, ${o.meanPaletteSize} instruments per description`);
if (o.grammarUnavailable.length) console.log(`no grammar at all for: ${o.grammarUnavailable.join(", ")}`);
console.log(`wrote ${outPath}`);
