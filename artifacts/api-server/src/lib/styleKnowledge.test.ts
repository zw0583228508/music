import assert from "node:assert/strict";
import test from "node:test";
import { STYLE_FIELDS, STYLE_LEVELS, STYLE_PATHS } from "./styleGrammar";
import {
  STYLE_KNOWLEDGE_ENTRIES,
  knowledgeChain,
  knowledgeEntryById,
  unknownLevels,
  validateKnowledgeEntry,
  type StyleKnowledgeEntry,
} from "./styleKnowledge";
import { rankKnowledge, styleCandidatesFromKnowledge } from "./styleResolver";

test("every knowledge entry validates against the contract: real fields, right level, vocabulary values, confidence in (0, 1], a why per value", () => {
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) {
    const issues = validateKnowledgeEntry(entry, STYLE_KNOWLEDGE_ENTRIES);
    assert.deepEqual(issues, [], `${entry.id}: ${issues.map((i) => `${i.path ?? ""} ${i.message}`).join(" | ")}`);
  }
  const ids = STYLE_KNOWLEDGE_ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
});

test("the validator catches what a careless entry would smuggle in", () => {
  const bad = {
    id: "Bad Entry",
    label: { en: "bad", he: "" },
    extends: "nowhere",
    match: { requires: [] },
    levels: Object.fromEntries(STYLE_LEVELS.map((l) => [l, "unknown"])),
    basis: "",
    coverage: "sketch",
  } as unknown as StyleKnowledgeEntry;
  const issues = validateKnowledgeEntry(bad, STYLE_KNOWLEDGE_ENTRIES).map((i) => i.message);
  assert.ok(issues.some((m) => /snake_case/.test(m)));
  assert.ok(issues.some((m) => /extends unknown entry/.test(m)));
  assert.ok(issues.some((m) => /requires/.test(m)));
  assert.ok(issues.some((m) => /every level unknown/.test(m)));

  const wrongLevel = {
    ...knowledgeEntryById("rock")!,
    id: "rock_wrong",
    levels: { ...knowledgeEntryById("rock")!.levels, era: { "groove.family": { value: "backbeat", confidence: 0.5, why: "x" } } },
  } as StyleKnowledgeEntry;
  assert.ok(validateKnowledgeEntry(wrongLevel).some((i) => /belongs to level rhythmic, not era/.test(i.message)));

  const badValue = {
    ...knowledgeEntryById("rock")!,
    id: "rock_bad_value",
    levels: { ...knowledgeEntryById("rock")!.levels, rhythmic: { "groove.family": { value: "groovy", confidence: 0.5, why: "x" } } },
  } as StyleKnowledgeEntry;
  assert.ok(validateKnowledgeEntry(badValue).some((i) => /is not one of/.test(i.message)));

  const badConfidence = {
    ...knowledgeEntryById("rock")!,
    id: "rock_bad_confidence",
    levels: { ...knowledgeEntryById("rock")!.levels, rhythmic: { "groove.family": { value: "backbeat", confidence: 1.4, why: "x" } } },
  } as StyleKnowledgeEntry;
  assert.ok(validateKnowledgeEntry(badConfidence).some((i) => /not in \(0, 1\]/.test(i.message)));
});

test("the families the platform meets are covered, the owner's world is marked as his, and every entry leaves the era unknown", () => {
  const ids = new Set(STYLE_KNOWLEDGE_ENTRIES.map((e) => e.id));
  for (const id of ["chassidic_ballad", "mizrahi_pop", "pop_ballad", "singer_songwriter_acoustic", "rock", "edm_dance", "jazz_standard", "orchestral_cinematic", "gospel", "bossa_latin", "hip_hop_rnb"]) {
    assert.ok(ids.has(id), `${id} exists`);
  }
  assert.equal(knowledgeEntryById("chassidic_ballad")!.coverage, "owner_world");
  assert.deepEqual(knowledgeChain(knowledgeEntryById("chassidic_ballad")!, STYLE_KNOWLEDGE_ENTRIES).map((e) => e.id), ["ballad", "chassidic_ballad"]);
  // Unknown stays unknown: nobody can tell the era from the tradition alone, and the data says so.
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) assert.equal(entry.levels.era, "unknown", `${entry.id} does not guess an era`);
  const sketch = knowledgeEntryById("chassidic_simcha_dance")!;
  assert.equal(sketch.coverage, "sketch");
  assert.ok(unknownLevels(sketch, STYLE_KNOWLEDGE_ENTRIES).includes("performance"));
});

test("matching walks genre → tradition: the owner's brief reaches the chassidic ballad, a jazz ballad the jazz standard, a fast hasidic brief the simcha dance, an unknown world nothing", () => {
  const t = (slot: string, term: string) => ({ slot: slot as "genre", term });
  assert.equal(rankKnowledge([t("genre", "ballad"), t("tradition", "hasidic"), t("word", "energy=low")])[0].id, "chassidic_ballad");
  assert.equal(rankKnowledge([t("genre", "ballad")])[0].id, "ballad");
  assert.equal(rankKnowledge([t("genre", "jazz"), t("genre", "ballad")])[0].id, "jazz_standard", "a family entry beats a generic form on a tie");
  assert.equal(rankKnowledge([t("tradition", "hasidic"), t("scene", "wedding")])[0].id, "chassidic_simcha_dance");
  assert.equal(rankKnowledge([t("genre", "pop"), t("genre", "ballad")])[0].id, "pop_ballad");
  assert.equal(rankKnowledge([t("genre", "polka")]).length, 0, "an unknown world matches nothing rather than the nearest thing");
  assert.equal(rankKnowledge([]).length, 0);
});

test("a child entry overrides its parent path by path and keeps the parent's other values", () => {
  const values = styleCandidatesFromKnowledge(knowledgeEntryById("chassidic_ballad")!);
  const byPath = new Map<string, unknown[]>();
  for (const c of values) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c.value]);
  assert.deepEqual(byPath.get("groove.family"), ["straight"], "the child's single value replaces the parent's");
  assert.deepEqual(byPath.get("arrangement.familyPriority")?.length, 2, "a bimodal convention keeps both alternatives");
  assert.ok(byPath.has("strings.articulation"), "the parent's value survives where the child is silent");
  assert.ok(values.every((c) => c.provenance === "template" && c.sourceRefs?.[0].startsWith("knowledge:")));
});

test("every consumed contract field is filled by at least one entry, so the consumers have something to read", () => {
  const filled = new Set<string>();
  for (const entry of STYLE_KNOWLEDGE_ENTRIES) for (const c of styleCandidatesFromKnowledge(entry)) filled.add(c.path);
  const consumedButNeverFilled = STYLE_PATHS.filter((p) => STYLE_FIELDS[p].consumers.length > 0 && !filled.has(p));
  // Measured-only and brief-only fields are legitimately never in a knowledge entry.
  const allowed = new Set(["groove.microtimingMs", "groove.onsetsPerBeat", "groove.feltPulse", "arrangement.globalDynamic", "arrangement.globalTexture", "melodic.ornamentDensity", "identity.knowledgeEntry"]);
  assert.deepEqual(consumedButNeverFilled.filter((p) => !allowed.has(p)), []);
});
