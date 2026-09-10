/**
 * The audio dimensions' positive controls (Brain B-07 D2).
 *
 * This suite runs the whole harness — eight rendered anchors × every control,
 * both versions rendered with the evaluation renderer — and holds three things:
 *
 *   1. the committed ledger (`dimensions/audioControlLedger.ts`) is exactly
 *      what a regeneration produces, so a `controlStatus` cannot be typed by
 *      hand and cannot go stale without this failing;
 *   2. the null test: no audio dimension raises a blocking observation on a
 *      clean anchor's own render;
 *   3. the negative control: snapping every pitched part to the beat grid makes
 *      `audioRhythm`'s findings go away, which is what isolates the cause of
 *      the off-grid findings it raises on the clean anchors — it is the
 *      composer's chord-relative placement, not the detector inventing flams.
 *
 * It is slow (it renders roughly a hundred four-minute arrangements). That is
 * the price of a control measured on audio rather than on a note table.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIO_ANCHOR_IDS,
  AUDIO_CLAIMED_CONTROLS,
  AUDIO_CONTROL_HARNESS_VERSION,
  AUDIO_CONTROL_NAMES,
  MIN_ITEMS_FOR_STATUS,
  renderAudioLedgerSource,
  runAudioControlHarness,
  type AudioHarnessResult,
} from "./audioControls";
import { AUDIO_CONTROL_LEDGER, AUDIO_CONTROL_LEDGER_VERSION } from "./dimensions/audioControlLedger";
import { AUDIO_DIMENSION_NAMES } from "./dimensions/audioDimensions";

let cached: AudioHarnessResult | null = null;
function harness(): AudioHarnessResult {
  if (!cached) cached = runAudioControlHarness();
  return cached;
}

/** The committed ledger module, when this test can see the source tree. */
function committedLedgerSource(): string | null {
  for (const base of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    for (const candidate of [
      join(base, "dimensions", "audioControlLedger.ts"),
      join(base, "src", "lib", "critics", "dimensions", "audioControlLedger.ts"),
    ]) {
      try { return readFileSync(candidate, "utf8"); } catch { /* next */ }
    }
  }
  return null;
}

test("the ledger is generated, not typed: a regeneration reproduces the committed file", (t) => {
  const run = harness();
  assert.equal(run.version, AUDIO_CONTROL_HARNESS_VERSION);
  assert.deepEqual(
    Object.keys(run.ledger).sort(),
    [...AUDIO_DIMENSION_NAMES].sort(),
    "every audio dimension has a ledger row");

  // The status each dimension reports at runtime is the status in the ledger.
  for (const dimension of AUDIO_DIMENSION_NAMES) {
    assert.ok(AUDIO_CONTROL_LEDGER[dimension], `${dimension} is missing from the committed ledger`);
    assert.equal(AUDIO_CONTROL_LEDGER[dimension].status, run.ledger[dimension].status,
      `${dimension}: committed ${AUDIO_CONTROL_LEDGER[dimension].status}, measured ${run.ledger[dimension].status}`);
    assert.equal(AUDIO_CONTROL_LEDGER[dimension].strongestControl, run.ledger[dimension].strongestControl);
    assert.equal(AUDIO_CONTROL_LEDGER[dimension].detectionRate, run.ledger[dimension].detectionRate);
    assert.equal(AUDIO_CONTROL_LEDGER[dimension].n, run.ledger[dimension].n);
  }

  const source = committedLedgerSource();
  if (!source) return t.diagnostic("the committed ledger source was not readable from here; the per-row comparison above still ran");
  assert.equal(
    source.replace(/\r\n/g, "\n"),
    renderAudioLedgerSource(run.ledger, AUDIO_CONTROL_LEDGER_VERSION).replace(/\r\n/g, "\n"),
    "regenerate dimensions/audioControlLedger.ts with renderAudioLedgerSource; it must not be edited by hand");
});

test("the null test: no audio dimension blocks a clean anchor's own render", () => {
  const run = harness();
  assert.equal(run.anchors.length, AUDIO_ANCHOR_IDS.length, "every anchor rendered");
  const blocking = run.anchorReports.filter((r) => r.blocking > 0);
  assert.deepEqual(blocking.map((r) => `${r.anchorId}/${r.dimension}: ${r.kinds.join(",")}`), [],
    "a dimension that blocks undamaged output cannot gate anything");
  for (const report of run.anchorReports) {
    if (!report.applicable) continue;
    assert.ok(report.score !== null, `${report.anchorId}/${report.dimension} scored`);
  }
});

test("every claimed control was actually measurable, so no status rests on too little", () => {
  const run = harness();
  for (const [dimension, controls] of Object.entries(AUDIO_CLAIMED_CONTROLS)) {
    for (const control of controls) {
      assert.ok(AUDIO_CONTROL_NAMES.includes(control), `${dimension} claims an unknown control "${control}"`);
      const row = run.table.find((r) => r.dimension === dimension && r.control === control)!;
      assert.ok(row, `${dimension} × ${control} is missing from the table`);
      assert.ok(row.claimed, `${dimension} × ${control} should be marked claimed`);
      assert.ok(row.n >= MIN_ITEMS_FOR_STATUS,
        `${dimension} × ${control} was measurable on only ${row.n} anchor(s); a status may not rest on that`);
    }
  }
  // A status is only ever the strongest claimed control's rate.
  for (const dimension of AUDIO_DIMENSION_NAMES) {
    const entry = run.ledger[dimension];
    if (entry.status === "uncalibrated") { assert.equal(entry.strongestControl, null); continue; }
    const row = run.table.find((r) => r.dimension === dimension && r.control === entry.strongestControl)!;
    assert.equal(row.rate, entry.detectionRate);
    assert.ok(row.claimed, `${dimension}'s status rests on ${entry.strongestControl}, which it must claim`);
    if (entry.status === "gated") {
      assert.ok(entry.detectionRate! >= 0.9 && entry.ci95![0] >= 0.6 && entry.cleanAnchorBlockingRate === 0);
    }
  }
});

test("each dimension catches at least one of its own controls on every anchor it was measured on", () => {
  const run = harness();
  const summary: string[] = [];
  for (const dimension of AUDIO_DIMENSION_NAMES) {
    const claimed = run.table.filter((r) => r.dimension === dimension && r.claimed && r.n > 0);
    const best = [...claimed].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
    summary.push(`${dimension}: ${best ? `${best.control} ${best.detected}/${best.n}` : "no measurable control"}`);
    assert.ok(best && (best.rate ?? 0) >= 0.5,
      `${dimension} has no control it detects at least half the time; it may not inform anything (${claimed.map((r) => `${r.control} ${r.detected}/${r.n}`).join(", ")})`);
  }
  assert.ok(summary.length === AUDIO_DIMENSION_NAMES.length);
});

/**
 * The negative control. `audioRhythm` raises `off_grid_against_kit` on all
 * eight *clean* anchors (minor on seven, major on rock-full) — the same defect
 * the R-1 musical review located on the owner's song, where the harmony writers
 * place their hits at chord-relative subdivisions while the kit is written
 * bar-relative. Charter rule 3 says a cause may be named only after a control
 * isolates it, so this control snaps every pitched part onto the beat grid and
 * asks whether the findings go away.
 *
 * They go away on five of the eight, and they do not on three. That is a
 * partial isolation and it is reported as one: the test holds the majority
 * result and names the three anchors where the cause is still open, rather
 * than asserting an isolation the measurement does not support. The likely
 * reason those three survive is that the kit's own onsets are not the beat
 * grid either (B-04 writes anticipations, ghosts and swung eighths), so
 * snapping the harmony to the beat can move it *away* from the kit.
 */
test("the negative control: snapping the parts to the grid removes audioRhythm's findings on most anchors, and the exceptions are named", (t) => {
  const run = harness();
  const rows = run.items.filter((i) => i.control === "align_to_kit" && i.results["audioRhythm"]);
  assert.ok(rows.length >= 6, `the alignment control ran on ${rows.length} anchor(s)`);
  const survived = rows.filter((row) => row.results["audioRhythm"].detected);
  assert.ok(survived.length <= rows.length / 2,
    `snapping the pitched parts onto the beat grid still looks like damage to audioRhythm on ${survived.length}/${rows.length} anchors ` +
    `(${survived.map((r) => r.anchorId).join(", ")}). Above half, the off-grid findings on the clean anchors are not explained by ` +
    "chord-relative placement at all and the dimension should not inform anything.");
  t.diagnostic(
    `align_to_kit: findings removed on ${rows.length - survived.length}/${rows.length} anchors; still raised on ` +
    `${survived.map((r) => r.anchorId).join(", ") || "none"} — on those the cause of audioRhythm's clean-anchor findings is not isolated.`);
});
