/**
 * Build the SYNTHETIC_EXACT transcription benchmark (PR-83, stream C).
 *
 *   node --experimental-strip-types (or the esbuild bundle) build-amt-benchmark.ts \
 *     --pdmx <dir> --out <dir> [--clips 12] [--seconds 30]
 *
 * Admitted PDMX multitrack scores → one 16 kHz mono WAV each through the
 * platform's deterministic reference synth, with the notes that were rendered
 * kept verbatim as ground truth. The MIDI *is* the truth, so this tier needs
 * no annotator and carries no alignment error — and its timbre is synthetic,
 * which the sweep says out loud everywhere it reports a number.
 *
 * Selection walks genre families round-robin rather than taking the first N
 * rows, because PDMX sorted by path is not a music corpus, it is an alphabet.
 */
import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import { buildBenchmarkClip, amtInstrumentClass, type AmtNote } from "../src/lib/amtBenchmark";
import { csvHeaderIndex, csvRowToMetadataRow, headerRefusalReason, parseCsvLine } from "../src/lib/pdmxCsv";
import { classifyPdmxGenre } from "../src/lib/pdmxGenre";
import { pdmxRefusalReason, PDMX_SOURCE } from "../src/lib/pdmxIngest";

type Args = { pdmx: string; out: string; clips: number; seconds: number };

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback?: string): string => {
    const index = argv.indexOf(flag);
    if (index === -1 || index + 1 >= argv.length) {
      if (fallback !== undefined) return fallback;
      throw new Error(`missing required argument ${flag}`);
    }
    return argv[index + 1];
  };
  return {
    pdmx: resolve(get("--pdmx")),
    out: resolve(get("--out")),
    clips: Number(get("--clips", "12")),
    seconds: Number(get("--seconds", "30")),
  };
}

type Candidate = {
  id: string;
  title: string;
  midiPath: string;
  genreFamily: string;
  tracks: number;
  programs: number[];
};

async function scanCsv(csvPath: string, wanted: number): Promise<{ candidates: Candidate[]; rowsRead: number; refused: number }> {
  const stream = createInterface({ input: createReadStream(csvPath, { encoding: "utf8" }), crlfDelay: Infinity });
  let index: Map<string, number> | null = null;
  const byGenre = new Map<string, Candidate[]>();
  let rowsRead = 0;
  let refused = 0;
  // Enough per family to survive MIDI files that fail to parse or turn out to
  // be single-instrument once the notes are read.
  const perFamilyCap = Math.max(8, wanted);
  for await (const line of stream) {
    if (!index) {
      index = csvHeaderIndex(line);
      const refusal = headerRefusalReason(index);
      if (refusal) throw new Error(`PDMX.csv header: ${refusal}`);
      continue;
    }
    if (!line.trim()) continue;
    rowsRead += 1;
    const row = csvRowToMetadataRow(parseCsvLine(line), index);
    if (!row) { refused += 1; continue; }
    if (pdmxRefusalReason(row)) { refused += 1; continue; }
    // A transcription benchmark needs more than one instrument sounding, and
    // more than one *distinct* GM program: two piano tracks are one timbre.
    const programs = [...new Set(row.trackPrograms ?? [])];
    if ((row.n_tracks ?? 0) < 2 || programs.length < 2) { refused += 1; continue; }
    if (!row.midiPath) { refused += 1; continue; }
    const genreFamily = classifyPdmxGenre(row).primary;
    const bucket = byGenre.get(genreFamily) ?? [];
    if (bucket.length >= perFamilyCap) continue;
    bucket.push({
      id: row.id,
      title: row.title?.trim() || row.id,
      midiPath: row.midiPath,
      genreFamily,
      tracks: row.n_tracks ?? 0,
      programs,
    });
    byGenre.set(genreFamily, bucket);
  }
  // Round-robin across families, skipping `unlabelled` until the labelled
  // families are exhausted: an unlabelled row is a row we cannot report a
  // per-genre number for.
  const families = [...byGenre.keys()].sort((a, b) =>
    a === "unlabelled" ? 1 : b === "unlabelled" ? -1 : a.localeCompare(b),
  );
  const candidates: Candidate[] = [];
  for (let depth = 0; depth < perFamilyCap; depth += 1) {
    for (const family of families) {
      const entry = byGenre.get(family)![depth];
      if (entry) candidates.push(entry);
    }
  }
  return { candidates, rowsRead, refused };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const csvPath = join(args.pdmx, "PDMX.csv");
  // The CSV's `mid` column is `./mid/<a>/<b>/<id>.mid`, and the archive
  // extracted with its own `mid/` root inside the data directory.
  const midiRoot = join(args.pdmx, "mid");
  mkdirSync(join(args.out, "audio"), { recursive: true });

  process.stderr.write(`scanning ${csvPath}\n`);
  const { candidates, rowsRead, refused } = await scanCsv(csvPath, args.clips);
  process.stderr.write(`${rowsRead} rows, ${refused} refused, ${candidates.length} multitrack candidates\n`);

  const clips: Array<Record<string, unknown>> = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const candidate of candidates) {
    if (clips.length >= args.clips) break;
    const path = join(midiRoot, candidate.midiPath.replace(/^\.\//, ""));
    let reference: AmtNote[];
    let clip: ReturnType<typeof buildBenchmarkClip>;
    try {
      clip = buildBenchmarkClip(readFileSync(path), { maxSeconds: args.seconds });
      reference = clip.reference;
    } catch (error) {
      skipped.push({ id: candidate.id, reason: `${(error as Error).message}` });
      continue;
    }
    // The CSV's track count is a score-editor count. What matters is how many
    // instrument classes actually sound inside the window we rendered.
    if (clip.instrumentClasses.length < 2) {
      skipped.push({ id: candidate.id, reason: `only ${clip.instrumentClasses.join(",")} sounds in the first ${args.seconds}s` });
      continue;
    }
    if (reference.length < 20) {
      skipped.push({ id: candidate.id, reason: `only ${reference.length} notes in the window` });
      continue;
    }
    const clipId = `pdmx-${candidate.id.slice(0, 12)}`;
    writeFileSync(join(args.out, "audio", `${clipId}.wav`), clip.wav);
    clips.push({
      clipId,
      pdmxId: candidate.id,
      title: candidate.title,
      genreFamily: candidate.genreFamily,
      midiPath: candidate.midiPath,
      durationSeconds: clip.durationSeconds,
      sampleRate: clip.sampleRate,
      wavSha256: clip.wavSha256,
      wavBytes: clip.wav.length,
      noteCount: reference.length,
      voices: clip.voices,
      instrumentClasses: clip.instrumentClasses,
      perInstrumentNoteCount: Object.fromEntries(
        clip.instrumentClasses.map((c) => [c, reference.filter((n) => amtInstrumentClass(n) === c).length]),
      ),
      reference,
    });
    process.stderr.write(
      `  ${clipId}  ${candidate.genreFamily.padEnd(20)} ${String(reference.length).padStart(5)} notes  ${clip.instrumentClasses.join("+")}\n`,
    );
  }

  const gold = {
    schema: "amt-benchmark/1",
    tier: "SYNTHETIC_EXACT",
    builtAt: new Date().toISOString(),
    honesty: [
      "Ground truth is exact: the reference notes are the same array handed to the synth, so there is no alignment and no annotator.",
      "Timbre is NOT real. REFERENCE_SYNTH_V1 is band-limited oscillators plus filtered noise; every model measured here was trained on sampled or recorded instruments, so this audio is out of distribution for all of them.",
      "Therefore absolute F1 on this tier is a floor, not a production estimate. What transfers is the RANKING, and only because every model is given the byte-identical WAV (sha256 recorded per clip).",
      "This tier cannot answer 'how good will this be on a user's recording'. Answering that needs real audio with human-verified notes, which this stream did not have and did not fabricate.",
    ],
    source: {
      dataset: PDMX_SOURCE.name,
      record: PDMX_SOURCE.record,
      subset: PDMX_SOURCE.subset,
      rights: "Per-work public-domain admission by pdmxIngest.pdmxRefusalReason; the dataset's CC-BY-4.0 covers the compilation, not the works.",
    },
    renderer: { name: "REFERENCE_SYNTH_V1", sampleRate: clips[0]?.sampleRate ?? null, channels: 1, bitDepth: 16 },
    window: { maxSeconds: args.seconds },
    metric: {
      onsetToleranceSeconds: 0.05,
      offsetRule: "later of 50 ms or 20 % of the reference note's duration (mir_eval default; the 2025 AMT Challenge's rule)",
      instrumentAware: "match requires the same drum flag and the same GM family (arrangerRemi.familyOf), not the same GM program number",
      matching: "maximum bipartite matching (Kuhn), as mir_eval.transcription does it",
    },
    counts: {
      rowsRead,
      refusedByRightsOrShape: refused,
      candidates: candidates.length,
      clips: clips.length,
      totalNotes: clips.reduce((sum, c) => sum + (c.noteCount as number), 0),
      totalSeconds: Number(clips.reduce((sum, c) => sum + (c.durationSeconds as number), 0).toFixed(2)),
    },
    skipped,
    clips,
  };
  const goldPath = join(args.out, "amt-benchmark-gold.json");
  const body = `${JSON.stringify(gold, null, 2)}\n`;
  writeFileSync(goldPath, body);
  process.stderr.write(
    `\nwrote ${clips.length} clips (${gold.counts.totalNotes} notes, ${gold.counts.totalSeconds}s) to ${goldPath}\n` +
      `gold sha256 ${createHash("sha256").update(body).digest("hex")}\n`,
  );
  return clips.length > 0 ? 0 : 1;
}

main().then(
  (code) => { process.exitCode = code; },
  (error) => { process.stderr.write(`${(error as Error).stack}\n`); process.exitCode = 1; },
);
