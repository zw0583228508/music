#!/usr/bin/env node
/**
 * Brain B-02 - regenerate docs/evidence/brain-b02-harmony-realisation.json measurements.
 *
 *   node scripts/brain-b02-harmony-evidence.mjs [--out <file>] [--before <capture.json>]
 *
 * With --before, the document folds in a capture of the same builder taken at
 * the base commit (before / after / deltas from one metric implementation).
 *
 * Bundles src/lib/brainB02Evidence.ts with esbuild (Windows-safe, like the
 * other scripts here) and runs it: the owner's song fixture through the
 * planners and the orchestrator with and without the brief, plus the nine
 * synthetic benchmark cases. Pure TypeScript, no database. Prints the JSON
 * document to stdout or writes it to --out.
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(here, "..");
const args = process.argv.slice(2);
const argValue = (flag) => { const at = args.indexOf(flag); return at >= 0 ? args[at + 1] : undefined; };
const out = argValue("--out");
const beforePath = argValue("--before");

// `.tmp-tests` is git-ignored at the repo root; the bundle is removed after the run anyway.
const bundleDir = resolve(packageDir, "..", "..", ".tmp-tests");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, `brain-b02-harmony-evidence-${process.pid}.mjs`);
await build({
  entryPoints: [join(packageDir, "src", "lib", "brainB02Evidence.ts")],
  bundle: true, platform: "node", format: "esm", outfile: bundlePath, logLevel: "warning",
  alias: { "@workspace/db": join(packageDir, "src", "lib", "musicProviders.testDbStub.ts") },
});
try {
  const run = spawnSync(process.execPath, [bundlePath], {
    encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env },
  });
  if (run.status !== 0) {
    process.stderr.write(run.stderr);
    process.exit(run.status ?? 1);
  }
  let text = run.stdout;
  if (beforePath) {
    const before = JSON.parse(readFileSync(resolve(beforePath), "utf8"));
    const after = JSON.parse(run.stdout);
    text = `${JSON.stringify(foldBeforeAfter(before, after), null, 2)}\n`;
  }
  if (out) {
    writeFileSync(resolve(out), text);
    process.stderr.write(`wrote ${resolve(out)} (${text.length} bytes)\n`);
  } else {
    process.stdout.write(text);
  }
} finally {
  rmSync(bundlePath, { force: true });
}
void pathToFileURL;

/** The document: before / after / deltas, per case and for the owner's song. */
function foldBeforeAfter(before, after) {
  const r3 = (v) => (typeof v === "number" ? Number(v.toFixed(3)) : v);
  const delta = (a, b) => (typeof a === "number" && typeof b === "number" ? r3(b - a) : null);
  const totals = Object.fromEntries(Object.keys(after.totals).map((k) => [k, { before: before.totals[k] ?? null, after: after.totals[k], delta: delta(before.totals[k], after.totals[k]) }]));
  const composedKeys = ["meanMotionPerVoice", "commonToneShare", "parallelPerfect", "rootPositionShare", "meanShapesPerChordSymbol", "bassMaxLeap", "bassLeapsOverLimit", "bassOverlapsIntoNextChord", "bassChangesLandingOnRoot", "bassApproachedByStep", "bassApproachShare", "bassContraryShare", "slashChordsUnderBass", "slashBassHonoured"];
  const repairKeys = ["leapFolds", "bassLeapFolds", "rangeFolds", "polyphonyReleases", "dropped", "durationLengthened"];
  const perCase = (b, a) => ({
    id: a.id,
    composed: Object.fromEntries(composedKeys.map((k) => [k, { before: b?.composed?.[k] ?? null, after: a.composed[k], delta: delta(b?.composed?.[k], a.composed[k]) }])),
    playabilityRepair: Object.fromEntries(repairKeys.map((k) => [k, { before: b?.shipped?.playabilityRepair?.[k] ?? null, after: a.shipped.playabilityRepair[k] }])),
    repairPerTrack: { before: b?.shipped?.playabilityRepair?.perTrack ?? null, after: a.shipped.playabilityRepair.perTrack },
    adversarial: {
      professionalWouldChange: { before: b?.shipped?.adversarial?.professionalWouldChange ?? null, after: a.shipped.adversarial.professionalWouldChange },
      machineMade: { before: b?.shipped?.adversarial?.machineMade ?? null, after: a.shipped.adversarial.machineMade },
    },
    selected: { before: b?.shipped?.selected ?? null, after: a.shipped.selected },
    hardRuleErrors: { before: b?.shipped?.hardRuleErrors ?? null, after: a.shipped.hardRuleErrors },
    tracks: { before: b?.shipped?.tracks ?? null, after: a.shipped.tracks },
  });
  const corpusWeighted = (doc) => {
    let held = 0; let motion = 0; let changes = 0;
    for (const c of doc.corpus) { if (c.composed.commonToneShare === null) continue; held += c.composed.commonToneShare * c.composed.chordChanges; motion += c.composed.meanMotionPerVoice * c.composed.chordChanges; changes += c.composed.chordChanges; }
    return { commonToneShare: r3(held / changes), meanMotionPerVoice: r3(motion / changes), chordChanges: changes };
  };
  return {
    title: "Brain B-02: harmony as voicing, not labels - before / after on the nine synthetic benchmark cases and the owner's song",
    date: new Date().toISOString().slice(0, 10),
    stream: "B-02 (harmony & voice-leading specialist)",
    baseCommit: "a751796 (origin/main: B-00 composer split, B-01 arc, B-05b critics)",
    regenerate: "cd artifacts/api-server && node scripts/brain-b02-harmony-evidence.mjs --before <capture at the base commit> --out ../../docs/evidence/brain-b02-harmony-realisation.json   (the before capture is the same builder run at a751796 with only chordSymbols.ts added; kept under raw.before here)",
    method: {
      composed: "per part request of the part plan, composed by the reference composer with no siblings (as the orchestrator composes today): chordal parts - clusters at one onset, successive clusters under different chords compared voice by voice (sorted, min voice count): motion per voice in semitones, common-tone share (a voice keeping a pitch the previous cluster had), parallel perfect intervals (a pair keeping a fifth / octave in similar motion), root-position share (lowest pitch class = root), voicing shapes per chord symbol; bass parts - max leap, leaps over the definition's maxLeap, notes lapping the next chord event, approach share (the B-05b definition: a step into the new root from a note not in the chord being left), contrary motion against the keys' top voice at chord changes, slash chords honoured",
      shipped: "orchestrateArrangement (render off; one candidate on the corpus, two on the owner's song with the brief's planner hints): the orchestrator's own playabilityRepairs per track, and the B-05b adversarial professionalWouldChange / machineMade reports on the shipped trackModels",
      caveats: [
        "shipped numbers include the performance stage (legato lengthening, releases) and the repair's start-sorted leap rule; composed numbers are the composer alone",
        "the keys track of the owner's song resolves to the drum-kit definition (musicEngines FAMILY_WORDS, B-03) at repair time, so its range folds measure the wrong definition, not the voicing",
        "no sibling notes reach the composer from the orchestrator yet (lead wiring); the keys voice above a re-planned bass skeleton identical to the bass writer's",
      ],
    },
    totals,
    corpusWeighted: { before: corpusWeighted(before), after: corpusWeighted(after) },
    corpus: after.corpus.map((a) => perCase(before.corpus.find((c) => c.id === a.id), a)),
    owner: {
      ...perCase(before.owner, after.owner),
      brief: after.owner.brief,
      bySection: Object.fromEntries(Object.keys(after.owner.bySection).map((name) => [name, {
        before: before.owner.bySection[name] ?? null, after: after.owner.bySection[name],
      }])),
    },
    raw: { before, after },
  };
}
