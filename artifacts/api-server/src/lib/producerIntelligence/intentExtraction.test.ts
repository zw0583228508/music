import assert from "node:assert/strict";
import test from "node:test";
import {
  USER_INTENT_VERSION,
  extractUserIntent,
  extractUserIntentSync,
  intentForSection,
  type IntentLanguageModel,
} from "./intentExtraction";

const NOW = new Date("2026-01-01T00:00:00.000Z");
const PROVENANCES = new Set(["stated", "inferred", "default", "researched"]);

test("extraction never fabricates: empty or unrelated text yields nothing", () => {
  for (const text of ["", "   ", "please send me the file tomorrow morning"]) {
    const intent = extractUserIntentSync(text, { now: NOW });
    assert.equal(intent.version, USER_INTENT_VERSION);
    assert.deepEqual(intent.inferences, [], `no inferences for ${JSON.stringify(text)}`);
    assert.deepEqual(intent.constraints, []);
    assert.deepEqual(intent.references, []);
    assert.equal(intent.confidence, 0);
  }
});

test("every extracted field carries provenance, confidence and verbatim evidence", () => {
  const text = "a quiet acoustic ballad with piano and cello, not too poppy, like Leonard Cohen";
  const intent = extractUserIntentSync(text, { now: NOW });
  assert.ok(intent.inferences.length >= 5);
  for (const inference of intent.inferences) {
    assert.ok(PROVENANCES.has(inference.provenance));
    assert.ok(inference.confidence > 0 && inference.confidence <= 1);
    assert.ok(inference.evidence.length > 0, `${inference.slot}=${inference.value} has evidence`);
    for (const span of inference.evidence) {
      assert.ok(text.toLowerCase().includes(span.toLowerCase()), `"${span}" is verbatim in the text`);
    }
  }
  for (const constraint of intent.constraints) {
    assert.ok(PROVENANCES.has(constraint.provenance));
    assert.ok(text.toLowerCase().includes(constraint.statement.toLowerCase()));
  }
  assert.equal(intent.language, "en");
});

test("negations become constraints, never styles (English and Hebrew)", () => {
  for (const text of ["not too poppy, 80s feel", "לא פופית מדי, תחושה של שנות ה-80"]) {
    const intent = extractUserIntentSync(text, { now: NOW });
    const avoid = intent.constraints.find((c) => c.kind === "avoid");
    assert.ok(avoid, `${text}: an avoid constraint exists`);
    assert.equal(avoid!.subject, "pop");
    assert.equal(avoid!.scope.kind, "global");
    assert.equal(
      intent.inferences.some((i) => i.slot === "genre_word" && i.value === "pop"),
      false,
      `${text}: "pop" is not read as a genre`,
    );
    assert.ok(intent.inferences.some((i) => i.slot === "era" && i.value === "1980s"), `${text}: the era is still read`);
  }
});

test("section-scoped requests attach to the right section, with ordinals in both languages", () => {
  for (const text of [
    "the second chorus is too busy, last chorus more cinematic",
    "הפזמון השני עמוס מדי, הפזמון האחרון יותר קולנועי",
  ]) {
    const intent = extractUserIntentSync(text, { now: NOW });
    assert.equal(intent.sectionRequests.length, 2, text);
    const [second, last] = intent.sectionRequests;
    assert.deepEqual(second.section, { function: "chorus", ordinal: 2 });
    assert.deepEqual(last.section, { function: "chorus", ordinal: "last" });

    const busy = intent.constraints.find((c) => c.subject === "dense");
    assert.ok(busy && busy.kind === "limit", `${text}: "too busy" is a limit on density`);
    assert.deepEqual(busy!.scope, { kind: "section", section: { function: "chorus", ordinal: 2 } });

    const cinematic = intent.inferences.find((i) => i.value === "cinematic");
    assert.ok(cinematic, `${text}: cinematic is read`);
    assert.deepEqual(cinematic!.scope, { kind: "section", section: { function: "chorus", ordinal: "last" } });
    assert.equal(intentForSection(intent, { function: "chorus", ordinal: "last" }).inferences[0]?.value, "cinematic");
    assert.equal(intentForSection(intent, { function: "chorus", ordinal: 2 }).constraints[0]?.subject, "dense");
    assert.equal(intentForSection(intent, { function: "verse", ordinal: 1 }).inferences.length, 0);
  }
});

test("derived inferences are marked inferred and point at the word that licensed them", () => {
  const intent = extractUserIntentSync("a ballad", { now: NOW });
  const stated = intent.inferences.find((i) => i.slot === "genre_word");
  const derived = intent.inferences.find((i) => i.slot === "tempo_feel");
  assert.equal(stated?.provenance, "stated");
  assert.equal(derived?.provenance, "inferred");
  assert.equal(derived?.value, "slow");
  assert.deepEqual(derived?.evidence, ["ballad"]);
  assert.ok(derived!.confidence < stated!.confidence);
});

test("references are captured; a vocabulary-only 'like a ballad' is a description, not a reference", () => {
  const withRef = extractUserIntentSync("something like Leonard Cohen, with the drums of \"Hallelujah\"", { now: NOW });
  assert.ok(withRef.references.some((r) => r.label === "Leonard Cohen"));
  const song = withRef.references.find((r) => r.kind === "song");
  assert.equal(song?.label, "Hallelujah");
  assert.equal(extractUserIntentSync("like a ballad", { now: NOW }).references.length, 0);
});

test("unknown 'more X' targets are surfaced, not guessed", () => {
  const intent = extractUserIntentSync("more shwoosh in the chorus", { now: NOW });
  assert.deepEqual(intent.unresolvedTerms, ["shwoosh"]);
  assert.equal(intent.inferences.length, 0);
  assert.equal(intent.sectionRequests.length, 1);
});

test("keep, add and remove are told apart, including Hebrew verbs with a glued conjunction", () => {
  const en = extractUserIntentSync("keep the drums, add strings, remove the synth", { now: NOW });
  assert.deepEqual(
    en.constraints.map((c) => [c.kind, c.subject]),
    [["keep", "drums"], ["require", "strings"], ["avoid", "synth"]],
  );
  const he = extractUserIntentSync("תוסיף מיתרים בפזמון האחרון ותשאיר את התופים, בלי סינת'", { now: NOW });
  assert.ok(he.constraints.some((c) => c.kind === "require" && c.subject === "strings"));
  assert.ok(he.constraints.some((c) => c.kind === "keep" && c.subject === "drums"));
  assert.ok(he.constraints.some((c) => c.kind === "avoid" && c.subject === "synth"));
  assert.equal(he.inferences.some((i) => i.slot === "instrument" && i.value === "synth"), false);
});

test("Hebrew tradition, era and instruments are read with their confidence", () => {
  const intent = extractUserIntentSync("שיר חסידי ישן עם קלרינט ותופים", { now: NOW });
  const bySlot = Object.fromEntries(intent.inferences.map((i) => [`${i.slot}:${i.value}`, i]));
  assert.equal(bySlot["tradition:hasidic"]?.provenance, "stated");
  assert.equal(bySlot["era:old"]?.value, "old");
  assert.ok(bySlot["era:old"]!.confidence < bySlot["tradition:hasidic"]!.confidence, "'old' is vaguer than a named tradition");
  assert.ok(bySlot["instrument:clarinet"] && bySlot["instrument:drums"]);
  assert.equal(intent.language, "he");
});

test("the digest covers the text and caller references, not the timestamp", () => {
  const a = extractUserIntentSync("cinematic", { now: NOW });
  const b = extractUserIntentSync("cinematic", { now: new Date("2027-01-01T00:00:00.000Z") });
  assert.equal(a.inputsDigestSha256, b.inputsDigestSha256);
  assert.notEqual(a.derivedAt, b.derivedAt);
  const c = extractUserIntentSync("cinematic", { now: NOW, references: [{ kind: "song", label: "X" }] });
  assert.notEqual(a.inputsDigestSha256, c.inputsDigestSha256);
  assert.equal(c.references[0].label, "X");
});

test("an injected model cannot add what the text does not contain", async () => {
  const text = "a warm song for a wedding";
  const model: IntentLanguageModel = {
    id: "fake-llm",
    complete: async () => ({
      inferences: [
        { slot: "instrument", value: "trumpet", confidence: 0.95, evidence: ["trumpet"] },
        { slot: "mood", value: "joyful", confidence: 0.95, evidence: ["for a wedding"] },
        { slot: "nonsense", value: "x", confidence: 1, evidence: ["warm"] },
      ],
      constraints: [{ kind: "avoid", subject: "drums", statement: "no drums here" }],
      references: [{ kind: "artist", label: "Someone", evidence: "not in text" }],
    }),
  };
  const intent = await extractUserIntent(text, { llm: model, now: NOW });
  assert.equal(intent.method, "intent-extraction/v1+fake-llm");
  assert.equal(intent.inferences.some((i) => i.value === "trumpet"), false, "fabricated evidence is rejected");
  const joyful = intent.inferences.find((i) => i.value === "joyful");
  assert.ok(joyful, "verbatim-backed model inference is kept");
  assert.equal(joyful!.provenance, "inferred");
  assert.ok(joyful!.confidence <= 0.85, "model confidence is capped");
  assert.equal(intent.inferences.some((i) => (i.slot as string) === "nonsense"), false);
  assert.equal(intent.constraints.length, 0, "a constraint without a verbatim statement is dropped");
  assert.equal(intent.references.length, 0);
  // Deterministic readings survive untouched.
  assert.ok(intent.inferences.some((i) => i.slot === "mood" && i.value === "warm" && i.provenance === "stated"));
  assert.ok(intent.inferences.some((i) => i.slot === "scene" && i.value === "wedding"));
});

test("a failing model falls back to the deterministic result", async () => {
  const model: IntentLanguageModel = { id: "broken", complete: async () => { throw new Error("offline"); } };
  const withModel = await extractUserIntent("a cinematic ballad", { llm: model, now: NOW });
  const without = extractUserIntentSync("a cinematic ballad", { now: NOW });
  assert.deepEqual(withModel, without);
});
