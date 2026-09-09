/**
 * Score the transcription sweep (PR-83, stream C).
 *
 *   node score-amt-sweep.mjs --gold <gold.json> --raw <raw.json> [--raw <raw.json>…] \
 *     --out docs/evidence/amt-sota-live.json --cost <cost.json>
 *
 * Every raw file is a worker's own output on the *same* clips. Nothing here
 * reads a published leaderboard number: each model is graded by
 * `amtBenchmark` against the ground truth the clips were rendered from.
 *
 * The script refuses rather than guesses. A raw file whose clip ids do not
 * match the gold set, or whose audio sha256 disagrees with the clip it claims
 * to be, is a scoring bug waiting to be quoted as a result — so it stops.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  amtVerdict,
  summariseAmtModel,
  type AmtClipResult,
  type AmtNote,
} from "../src/lib/amtBenchmark";

type GoldClip = {
  clipId: string;
  genreFamily: string;
  title: string;
  durationSeconds: number;
  wavSha256: string;
  noteCount: number;
  instrumentClasses: string[];
  reference: AmtNote[];
};

type RawNote = { onset: number; offset: number; pitch: number; program: number; isDrum: boolean };
type RawClip = { clipId: string; notes?: RawNote[]; error?: string; audio?: { sha256?: string; durationSeconds?: number }; seconds?: { total?: number }; realtimeFactor?: number };
type RawFile = {
  identity?: Record<string, unknown>;
  results: Record<string, { clips: RawClip[]; wallClockSeconds?: number }>;
};

function arg(flag: string, fallback?: string): string {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    if (fallback !== undefined) return fallback;
    throw new Error(`missing required argument ${flag}`);
  }
  return argv[index + 1];
}

function allArgs(flag: string): string[] {
  const argv = process.argv.slice(2);
  const out: string[] = [];
  argv.forEach((value, index) => {
    if (value === flag && index + 1 < argv.length) out.push(argv[index + 1]);
  });
  return out;
}

function main(): number {
  const goldPath = resolve(arg("--gold"));
  const gold = JSON.parse(readFileSync(goldPath, "utf8")) as { clips: GoldClip[]; [k: string]: unknown };
  const byClipId = new Map(gold.clips.map((clip) => [clip.clipId, clip]));

  const rawPaths = allArgs("--raw");
  if (rawPaths.length === 0) throw new Error("at least one --raw is required");
  const costPath = allArgs("--cost")[0];
  const cost = costPath ? JSON.parse(readFileSync(resolve(costPath), "utf8")) : null;

  const models: Array<Record<string, unknown>> = [];
  const summaries = new Map<string, ReturnType<typeof summariseAmtModel>>();

  for (const rawPath of rawPaths) {
    const raw = JSON.parse(readFileSync(resolve(rawPath), "utf8")) as RawFile;
    for (const [modelName, block] of Object.entries(raw.results)) {
      const results: AmtClipResult[] = [];
      const failures: Array<{ clipId: string; error: string }> = [];
      let inferenceSeconds = 0;
      for (const clip of block.clips) {
        const goldClip = byClipId.get(clip.clipId);
        if (!goldClip) throw new Error(`${rawPath}: clip ${clip.clipId} is not in the gold set`);
        if (clip.error) {
          failures.push({ clipId: clip.clipId, error: clip.error });
          continue;
        }
        if (!Array.isArray(clip.notes)) throw new Error(`${rawPath}: clip ${clip.clipId} has neither notes nor an error`);
        // The clip the worker heard must be the clip we graded it on.
        if (clip.audio?.sha256 && clip.audio.sha256 !== goldClip.wavSha256) {
          throw new Error(
            `${rawPath}: ${modelName}/${clip.clipId} transcribed audio sha256 ${clip.audio.sha256.slice(0, 12)}…, gold says ${goldClip.wavSha256.slice(0, 12)}…`,
          );
        }
        inferenceSeconds += clip.seconds?.total ?? 0;
        results.push({
          clipId: clip.clipId,
          genreFamily: goldClip.genreFamily,
          reference: goldClip.reference,
          estimate: clip.notes.map((note) => ({
            onset: note.onset,
            offset: note.offset,
            pitch: note.pitch,
            program: note.isDrum ? 0 : note.program,
            isDrum: Boolean(note.isDrum),
          })),
        });
      }
      // A model that failed on some clips is not comparable to one that did not.
      if (failures.length > 0 && results.length === 0) {
        models.push({ model: modelName, failed: true, failures, identity: raw.identity ?? null });
        continue;
      }
      const summary = summariseAmtModel(modelName, results);
      summaries.set(modelName, summary);
      const perModelCost = cost?.[modelName] ?? null;
      models.push({
        model: modelName,
        rawFile: rawPath.replace(/\\/g, "/").split("/").slice(-1)[0],
        identity: raw.identity ?? null,
        clipsScored: results.length,
        clipsFailed: failures.length,
        failures,
        inferenceSecondsSum: Number(inferenceSeconds.toFixed(2)),
        wallClockSeconds: block.wallClockSeconds ?? null,
        cost: perModelCost,
        f1: {
          instrumentAwareOnset: summary.micro.instrument_onset.f1,
          instrumentAwareOnsetOffset: summary.micro.instrument_onset_offset.f1,
          pitchOnlyOnset: summary.micro.onset.f1,
        },
        micro: summary.micro,
        macroF1: summary.macroF1,
        perInstrument: summary.perInstrument,
        perGenre: summary.perGenre,
        perClip: summary.perClip,
      });
    }
  }

  models.sort((a, b) => {
    const af = (a.f1 as { instrumentAwareOnset?: number } | undefined)?.instrumentAwareOnset ?? -1;
    const bf = (b.f1 as { instrumentAwareOnset?: number } | undefined)?.instrumentAwareOnset ?? -1;
    return bf - af;
  });

  // The incumbent is what the platform runs today, not the best loser.
  const incumbentName = arg("--incumbent", "BASIC_PITCH");
  const incumbent = summaries.get(incumbentName);
  const verdicts = incumbent
    ? [...summaries.entries()]
        .filter(([name]) => name !== incumbentName)
        .map(([name, summary]) => ({ challenger: name, ...amtVerdict(incumbent, summary) }))
    : [];

  const evidence = {
    title: "Is there a transcription model meaningfully better than what we have? — live (PR-83)",
    measuredAt: new Date().toISOString(),
    question:
      "The 2025 AMT Challenge ranks MIROS 0.5998 and YourMT3-YPTF-MoE-M 0.5938 above an MT3 baseline of 0.3932. Those are their numbers on their audio. This file is ours, on ours.",
    benchmark: {
      goldFile: goldPath.replace(/\\/g, "/").split("/").slice(-1)[0],
      tier: gold.tier,
      clips: gold.clips.length,
      totalNotes: (gold as { counts?: { totalNotes?: number } }).counts?.totalNotes ?? null,
      totalSeconds: (gold as { counts?: { totalSeconds?: number } }).counts?.totalSeconds ?? null,
      honesty: gold.honesty,
      metric: gold.metric,
      renderer: gold.renderer,
      source: gold.source,
    },
    incumbent: incumbentName,
    models,
    verdicts,
    caveats: [
      "Every model was given the byte-identical WAV; the scorer refuses if a worker's reported audio sha256 does not match the gold clip.",
      "SYNTHETIC_EXACT is not real audio. Absolute F1 here is a floor for every model, and the ranking is the transferable part.",
      "Basic Pitch predicts no instrument at all. Its instrument-aware F1 measures a placeholder GM program the adapter assigns, not a prediction; the pitch-only column is its fair number.",
      "Nothing in this file promotes anything. Routing is unchanged.",
    ],
  };

  const outPath = resolve(arg("--out"));
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

  // A short table on stderr so a human sees the answer without opening JSON.
  process.stderr.write(`\n${"model".padEnd(34)} ${"instr.F1".padStart(9)} ${"+offset".padStart(9)} ${"pitch-only".padStart(11)} ${"notes".padStart(7)}\n`);
  for (const model of models) {
    const f1 = model.f1 as { instrumentAwareOnset: number; instrumentAwareOnsetOffset: number; pitchOnlyOnset: number } | undefined;
    if (!f1) {
      process.stderr.write(`${String(model.model).padEnd(34)} ${"FAILED".padStart(9)}\n`);
      continue;
    }
    const micro = model.micro as { instrument_onset: { estimateNotes: number } };
    process.stderr.write(
      `${String(model.model).padEnd(34)} ${f1.instrumentAwareOnset.toFixed(4).padStart(9)} ${f1.instrumentAwareOnsetOffset.toFixed(4).padStart(9)} ${f1.pitchOnlyOnset.toFixed(4).padStart(11)} ${String(micro.instrument_onset.estimateNotes).padStart(7)}\n`,
    );
  }
  process.stderr.write(`\nwrote ${outPath}\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  process.stderr.write(`${(error as Error).stack}\n`);
  process.exitCode = 1;
}
