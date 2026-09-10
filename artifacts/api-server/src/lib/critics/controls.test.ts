/**
 * The control harness as a test (B-05a):
 *  - the audit's Appendix A probes as fixtures (drums-only, random-pitch);
 *  - determinism: the same input yields byte-identical reports;
 *  - the null control: no clean anchor gets a blocking observation from any
 *    dimension, and every dimension's score is backed by observations;
 *  - the ledger: `dimensions/controlLedger.ts` must equal what the harness
 *    derives now (set B05A_WRITE_LEDGER=1 to regenerate it and the evidence
 *    JSON; B05A_ALL_SEVERITIES=1 runs severities 1–3 into the evidence).
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { BENCHMARK_CORPUS } from "../benchmarkCorpus";
import { ALL_DIMENSIONS, DIMENSION_NAMES, evaluateAllDimensions } from "./dimensions/index";
import { anchors, CLEAN_ANCHOR_IDS, probeAnchor } from "./dimensions/anchors";
import { CONTROL_LEDGER, CONTROL_LEDGER_VERSION } from "./dimensions/controlLedger";
import { SEVERITY_PENALTY, scoreFromObservations } from "./dimensions/shared";
import { CLAIMED_CONTROLS, CONTROL_HARNESS_VERSION, LEDGER_SEVERITY, renderLedgerSource, runControlHarness, summariseLedger } from "./controls";

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

const LEDGER_PATH = resolve(repoRoot(), "artifacts/api-server/src/lib/critics/dimensions/controlLedger.ts");
const EVIDENCE_PATH = resolve(repoRoot(), "docs/evidence/brain-b05a-critic-controls.json");
const WRITE = process.env.B05A_WRITE_LEDGER === "1";
const ALL_SEVERITIES = process.env.B05A_ALL_SEVERITIES === "1";

test("audit Appendix A, Probe 5: a drums-only arrangement is blocked by the orchestration dimension in every planned section", () => {
  const spec = BENCHMARK_CORPUS.find((c) => c.id === "pop-full")!;
  const reference = anchors(["pop-full"])[0];
  const probe = probeAnchor(spec, "drums_only");
  assert.deepEqual(probe.input.trackModels.map((t) => t.id), ["drums-groove"], "the probe composer leaves one drum track");
  const orchestration = ALL_DIMENSIONS.find((d) => d.dimension === "orchestration")!;
  const before = orchestration.evaluate(reference.input);
  const after = orchestration.evaluate(probe.input);
  const blocking = after.observations.filter((o) => o.severity === "blocking");
  assert.ok(blocking.length >= 4, `blocking observations: ${blocking.length}`);
  assert.ok(blocking.every((o) => o.kind === "planned_family_silent"));
  const sections = new Set(blocking.map((o) => o.location.sectionName));
  assert.ok(sections.has("Verse") && sections.has("Chorus"), [...sections].join(","));
  assert.ok(blocking.some((o) => o.evidence.instrument === "bass" && o.evidence.taskPlanned === true && o.suspectedOrigin === "compose"));
  assert.equal(after.summary.score0to100, 0);
  assert.equal(before.summary.score0to100, 100);
  console.log(`PROBE5 drums-only pop-full: orchestration ${before.summary.score0to100} -> ${after.summary.score0to100}, ${blocking.length} blocking observations across ${sections.size} sections`);
});

test("audit Appendix A, Probe 1: the random-pitch composer is blocked by harmony on every case; voiceLeading is not its detector (recorded)", () => {
  // Recalibrated at the merge: before B-00/B-01/B-03 this test also required
  // voiceLeading to flag major on >= 2 of the 4 cases (it did on 4/8 anchors,
  // via crossings and lost common tones). On the new anchors the reference
  // bass itself carries minor `bass_leaps` and the beds parallel perfects, so
  // a random line with steps <= 7 is *smoother* than the reference and
  // voiceLeading scores it higher on 6/8 anchors (pop 78 -> 91, rock 81 -> 97).
  // That is a real limit, not an anchor artefact: voiceLeading hears motion,
  // not pitch sense. The claim is withdrawn from CLAIMED_CONTROLS and the
  // response is logged here; harmony (clash_share blocking) carries the probe.
  const rows: string[] = [];
  let harmonyBlocking = 0;
  let voiceLeadingFlagged = 0;
  const cases = ["pop-full", "rock-full", "dance-full", "jazz-full"];
  for (const id of cases) {
    const spec = BENCHMARK_CORPUS.find((c) => c.id === id)!;
    const reference = anchors([id])[0];
    const probe = probeAnchor(spec, "random_pitch");
    const harmony = ALL_DIMENSIONS.find((d) => d.dimension === "harmony")!;
    const voiceLeading = ALL_DIMENSIONS.find((d) => d.dimension === "voiceLeading")!;
    const h0 = harmony.evaluate(reference.input);
    const h1 = harmony.evaluate(probe.input);
    const v0 = voiceLeading.evaluate(reference.input);
    const v1 = voiceLeading.evaluate(probe.input);
    const hBlocking = h1.observations.filter((o) => o.severity === "blocking" && o.kind === "clash_share");
    if (hBlocking.length) harmonyBlocking += 1;
    assert.ok(h1.summary.score0to100! <= 40, `${id}: harmony ${h1.summary.score0to100}`);
    assert.ok(h0.summary.score0to100! - h1.summary.score0to100! >= 50, `${id}: harmony drop`);
    const vMajor = v1.observations.filter((o) => o.severity === "major" || o.severity === "blocking");
    if (vMajor.length && v1.summary.score0to100! < v0.summary.score0to100!) voiceLeadingFlagged += 1;
    rows.push(`${id}: harmony ${h0.summary.score0to100}->${h1.summary.score0to100} (${hBlocking.length} blocking clash_share), voiceLeading ${v0.summary.score0to100}->${v1.summary.score0to100} (${vMajor.map((o) => o.kind).join(",") || "no major"})`);
  }
  console.log("PROBE1 random-pitch:\n  " + rows.join("\n  "));
  console.log(`PROBE1 voiceLeading flags major/blocking with a score drop on ${voiceLeadingFlagged}/${cases.length} cases (not asserted: a random line with steps <= 7 is smoother than the reference bass)`);
  assert.equal(harmonyBlocking, cases.length, "harmony blocks the random-pitch composer on every case");
});

test("determinism: the same input yields identical reports", () => {
  const anchor = anchors(["rock-full"])[0];
  const a = JSON.stringify(evaluateAllDimensions(anchor.input));
  const again = { ...anchor.input, trackModels: anchor.input.trackModels.map((t) => ({ ...t, notes: t.notes.map((n) => ({ ...n })) })) };
  const b = JSON.stringify(evaluateAllDimensions(again));
  assert.equal(a, b);
});

test("null control: clean anchors get no blocking observation; every score is backed by its observations; no literal confidence", () => {
  for (const anchor of anchors(CLEAN_ANCHOR_IDS)) {
    for (const report of evaluateAllDimensions(anchor.input)) {
      const blocking = report.observations.filter((o) => o.severity === "blocking");
      assert.equal(blocking.length, 0, `${anchor.id}/${report.dimension}: ${blocking.map((o) => o.id).join(",")}`);
      if (report.applicable) {
        assert.equal(report.summary.score0to100, scoreFromObservations(report.observations, anchor.input.songModel.bars.length));
        assert.ok(report.observations.length > 0, `${report.dimension} reports a score with no observation behind it`);
      } else {
        assert.equal(report.summary.score0to100, null);
      }
      for (const o of report.observations) {
        assert.ok(o.confidence >= 0 && o.confidence <= 0.95, `${o.id} confidence ${o.confidence}`);
        assert.ok(o.originConfidence >= 0 && o.originConfidence <= 0.95);
        assert.ok(o.id.startsWith(`${report.dimension}:${o.kind}:`));
        if (o.severity !== "info") assert.ok(o.recommendedRepair, `${o.id} has no repair`);
        assert.ok(Object.keys(o.evidence).length > 0);
      }
      assert.equal(report.summary.controlStatus, CONTROL_LEDGER[report.dimension]?.status ?? "uncalibrated");
    }
  }
  assert.equal(SEVERITY_PENALTY.info, 0);
});

test("the ledger is derived from the harness and the evidence is written from the same run", { timeout: 20 * 60 * 1000 }, () => {
  const severities = ALL_SEVERITIES ? ([1, 2, 3] as const) : ([LEDGER_SEVERITY] as const);
  const started = Date.now();
  const result = runControlHarness({ severities });
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1));
  const ledgerRows = result.table.filter((r) => !r.control.includes("@") || r.control.endsWith(`@${LEDGER_SEVERITY}`));
  assert.ok(result.items.length > 100, `items ${result.items.length}`);
  for (const d of DIMENSION_NAMES) assert.ok(result.ledger[d], `ledger entry for ${d}`);
  const source = renderLedgerSource(result.ledger, CONTROL_HARNESS_VERSION);
  console.log(`HARNESS ${result.items.length} items over ${result.anchors.length} anchors in ${seconds}s`);
  console.log("LEDGER\n  " + summariseLedger(result.ledger).join("\n  "));
  if (WRITE) {
    writeFileSync(LEDGER_PATH, source, "utf8");
    mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
    // Per-item results are sampled (25 items, evenly spaced): the detection
    // table, ledger and anchor reports are the record; the items are
    // regenerated by this harness in seconds.
    const SAMPLE = 25;
    const stride = Math.max(1, Math.floor(result.items.length / SAMPLE));
    const sample = result.items.filter((_, i) => i % stride === 0).slice(0, SAMPLE);
    const evidence = {
      version: CONTROL_HARNESS_VERSION,
      generatedAt: new Date().toISOString(),
      recalibratedAtMerge: "onto main with B-00 (shipped-notes score, composer split), B-01 (ArrangementArc: drums enter at the chorus, bass thinned in quiet sections, chorus 2 developed, keys in every section, ensemble/mix not a family) and B-03 (instrument profiles); see the PR-B05a tracker entry",
      method: "every critic dimension over every anchor x control; detected = score drop >= 1 and a located non-info observation new or upgraded on the damaged tracks; rate with exact Clopper-Pearson 95 % interval; a control whose damage leaves an anchor unchanged skips that anchor",
      ledgerRule: "gated: strongest claimed control >= 0.90 with CI lower >= 0.60 and no blocking observation on a clean anchor; informing: >= 0.50; demoted: measured (n >= 5) and < 0.50; uncalibrated: no claimed control measurable",
      ledgerSeverity: LEDGER_SEVERITY,
      severitiesRun: [...severities],
      seeds: [1],
      runtimeSeconds: seconds,
      claimedControls: CLAIMED_CONTROLS,
      anchors: result.anchors,
      controls: result.controls,
      ledger: result.ledger,
      ledgerSummary: summariseLedger(result.ledger),
      table: result.table,
      anchorReports: result.anchorReports,
      itemsOmitted: { count: result.items.length, reason: "per-item results are regenerated by the controls harness (B05A_WRITE_LEDGER=1); the detection table, ledger and anchor reports above are the record", sample },
    };
    writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n", "utf8");
    console.log(`wrote ${LEDGER_PATH} and ${EVIDENCE_PATH}`);
  } else {
    const committed = readFileSync(LEDGER_PATH, "utf8").replace(/\r\n/g, "\n");
    assert.equal(committed, source, "dimensions/controlLedger.ts is stale: run with B05A_WRITE_LEDGER=1");
    assert.equal(CONTROL_LEDGER_VERSION, CONTROL_HARNESS_VERSION);
    for (const d of DIMENSION_NAMES) assert.deepEqual(CONTROL_LEDGER[d], result.ledger[d]);
  }
  void ledgerRows;
});
