#!/usr/bin/env node
/**
 * Structure tournament runner (ANALYSIS ENGINE, Stream F - PR-87).
 *
 * Builds the SYNTHETIC_EXACT tier - forms assembled from real PDMX multitrack
 * sections with boundaries and labels known by construction - renders them
 * with the V2 listening renderer, decodes every piece exactly as the analyzer
 * does (ffmpeg, mono, 8 kHz), runs every structure candidate on that same
 * buffer, sends the same audio to the MSAF Modal worker, scores each candidate
 * and the reconciled answer against the constructed truth, and runs the same
 * candidates over the owner's real uploads (PROFESSIONAL_REAL_WORLD, no truth:
 * outputs and disagreement only). A second SYNTHETIC_EXACT arm scores the same
 * candidates on Stream H's ANALYSIS_GOLD_V1 composed pieces (sections known by
 * construction in truth.json); the two arms are reported side by side, never
 * pooled.
 *
 *   node scripts/run-structure-tournament.mjs \
 *     [--pdmx <dir>] [--works 20] [--msaf run|cached|skip] \
 *     [--gold <analysis-gold-v1 dir>|skip] \
 *     [--real <label>=<audio path> ...] [--real-note "<how the real inputs were obtained>"] \
 *     [--out docs/evidence/structure-tournament-live.json]
 *
 * Tiers are never mixed. Nothing here promotes anything.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const apiRoot = resolve(here, "..");
const repoRoot = resolve(apiRoot, "../..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const flags = (name) => args.flatMap((a, i) => (a === `--${name}` && i + 1 < args.length ? [args[i + 1]] : []));

const pdmxDir = resolve(flag("pdmx", existsSync(join(repoRoot, ".pdmx-data", "PDMX.csv"))
  ? join(repoRoot, ".pdmx-data")
  : join(repoRoot, "../AI-Music-Production-Platform-main/.pdmx-data")));
const worksWanted = Number(flag("works", "20"));
const msafMode = flag("msaf", "run");
const outPath = resolve(flag("out", join(repoRoot, "docs/evidence/structure-tournament-live.json")));
const workDir = resolve(flag("work-dir", join(repoRoot, ".corpus-data/structure-tournament")));
const realNote = flag("real-note", null);
const realInputs = flags("real").map((entry) => {
  const eq = entry.indexOf("=");
  return eq > 0 ? { label: entry.slice(0, eq), path: resolve(entry.slice(eq + 1)) } : { label: basename(entry), path: resolve(entry) };
}).map((input) => (realNote ? { ...input, note: realNote } : input));
const scanLimit = Number(flag("scan", "6000"));
const goldFlag = flag("gold", existsSync(join(repoRoot, ".corpus-data", "analysis-gold-v1"))
  ? join(repoRoot, ".corpus-data", "analysis-gold-v1")
  : join(repoRoot, "../ws-an-h-gold/.corpus-data/analysis-gold-v1"));
const goldMode = goldFlag === "skip" ? "skip" : "run";
const goldDir = goldMode === "skip" ? null : resolve(goldFlag);
const DECODE_RATE = 8000;

for (const dir of ["audio", "msaf-in", "midi"]) mkdirSync(join(workDir, dir), { recursive: true });

// ---------------------------------------------------------------------------
// Library bundle
// ---------------------------------------------------------------------------
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `structure-tournament-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./structure-tournament-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file://${bundlePath.replace(/\\/g, "/")}`);
process.on("exit", () => { rm(bundlePath, { force: true }).catch(() => {}); });

const r2 = (v) => Number(v.toFixed(2));
const r3 = (v) => Number(v.toFixed(3));
const sha = (input) => createHash("sha256").update(input).digest("hex");

// ---------------------------------------------------------------------------
// Audio helpers (ffmpeg, exactly as the analyzer decodes)
// ---------------------------------------------------------------------------
function decodeMono8k(path) {
  const pcm = execFileSync("ffmpeg", ["-v", "error", "-i", path, "-ac", "1", "-ar", String(DECODE_RATE), "-f", "f32le", "pipe:1"], { maxBuffer: 512 * 1024 * 1024 });
  return new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
}
function toMsafWav(path, target) {
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path, "-ac", "1", "-ar", "22050", "-sample_fmt", "s16", target]);
}
function durationOf(path) {
  const out = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path]).toString().trim();
  return Number(out);
}
/** The analyzer's full-duration energy overview (200 Hz RMS in <= 1280 bins), from the decoded buffer. */
function energyOverview(samples, durationSeconds) {
  const bins = Math.max(24, Math.min(1280, Math.ceil(durationSeconds / 2)));
  const sums = new Array(bins).fill(0);
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < samples.length; i += 1) {
    const bin = Math.min(bins - 1, Math.floor((i / samples.length) * bins));
    sums[bin] += samples[i] * samples[i];
    counts[bin] += 1;
  }
  const raw = sums.map((s, i) => Math.sqrt(s / Math.max(1, counts[i])));
  const max = Math.max(...raw, 0.0001);
  return raw.map((v) => Number(Math.min(1, v / max).toFixed(3)));
}

// ---------------------------------------------------------------------------
// Candidates - every one reads the same 8 kHz buffer
// ---------------------------------------------------------------------------
function ssmCandidate(samples) {
  const result = lib.analyseAudioStructure(samples, DECODE_RATE);
  if (!result) return { provider: lib.LOCAL_SSM_STRUCTURE_PROVIDER, reading: null, note: "nothing to segment" };
  return {
    provider: lib.LOCAL_SSM_STRUCTURE_PROVIDER,
    reading: {
      provider: lib.LOCAL_SSM_STRUCTURE_PROVIDER,
      boundaries: result.boundaries.map((b) => b.time),
      sections: result.sections.map((s) => ({ start: s.start, end: s.end, label: s.base })),
      confidence: result.confidence,
    },
    formString: result.formString,
    confidence: result.confidence,
  };
}
function energyCandidate(samples, durationSeconds) {
  const tempo = lib.detectTempoEvidence(samples, DECODE_RATE);
  if (!tempo) return { provider: lib.LOCAL_STRUCTURE_PROVIDER, reading: null, note: "no tempo evidence, so no bars and no sections (the production fallback would also produce none)" };
  const local = lib.deriveLocalStructure({ energy: energyOverview(samples, durationSeconds), durationSeconds, bpm: tempo.bpm });
  if (!local) return { provider: lib.LOCAL_STRUCTURE_PROVIDER, reading: null, note: "local structure returned null" };
  const barSeconds = (60 / local.bpm) * 4;
  const sections = local.sections.map((s) => ({ start: r3((s.startBar - 1) * barSeconds), end: r3(s.endBar * barSeconds), label: s.name.replace(/\s\d+$/, "") }));
  return {
    provider: lib.LOCAL_STRUCTURE_PROVIDER,
    reading: { provider: lib.LOCAL_STRUCTURE_PROVIDER, boundaries: sections.slice(1).map((s) => s.start), sections, confidence: local.confidence },
    formString: local.sections.map((s) => s.name).join(" | "),
    bpm: local.bpm,
    tempoConfidence: tempo.confidence,
    confidence: local.confidence,
  };
}
/** MSAF's last "boundary" is the audio end and its first is 0: interior only, and the last section closes at the duration. */
function msafCandidates(entry, durationSeconds) {
  if (!entry) return [];
  const edge = 0.75;
  return Object.entries(entry.readings).map(([provider, r]) => {
    if (r.error) return { provider, reading: null, note: r.error };
    const boundaries = r.boundaries.map(r3).filter((t) => t > edge && t < durationSeconds - edge);
    const sections = [];
    for (const s of r.sections) {
      const start = r3(Math.max(0, s.start));
      const end = r3(s.end >= durationSeconds - edge ? durationSeconds : s.end);
      if (end - start < 1e-3) continue;
      const previous = sections.at(-1);
      // A sliver at the edge merges into its neighbour rather than becoming a section.
      if (previous && (start <= edge || previous.end >= durationSeconds - edge)) { previous.end = end; continue; }
      sections.push({ start, end, label: s.label });
    }
    return {
      provider,
      reading: { provider, boundaries, sections, confidence: 0.6 },
      formString: sections.map((s) => s.label).join(" "),
      seconds: r.seconds,
      algorithm: r.algorithm,
    };
  });
}
/** Readings that enter reconciliation: independent methods only (one MSAF arm). */
const RECONCILED_PROVIDERS = new Set(["LOCAL_SSM_STRUCTURE_V1", "LOCAL_SIGNAL_ANALYZER_V1", "MSAF"]);

function analysePiece(samples, durationSeconds, msafEntry) {
  const candidates = [ssmCandidate(samples), energyCandidate(samples, durationSeconds), ...msafCandidates(msafEntry, durationSeconds)];
  const readings = candidates.filter((c) => c.reading && RECONCILED_PROVIDERS.has(c.provider)).map((c) => c.reading);
  const audible = candidates.find((c) => c.provider === lib.LOCAL_SSM_STRUCTURE_PROVIDER && c.reading);
  const reconciliation = lib.reconcileStructures(readings, {
    start: 0,
    end: r3(durationSeconds),
  });
  return { candidates, reconciliation, audibleSpan: audible ? [audible.reading.sections[0].start, audible.reading.sections.at(-1).end] : null };
}

// ---------------------------------------------------------------------------
// SYNTHETIC_EXACT: forms assembled from real multitrack sections
// ---------------------------------------------------------------------------
const PATTERNS = ["A B A B", "A A B A", "A B C B", "A B A C A", "A B B A", "A A B B C", "A B A B C B", "A B C A"];
const MATERIAL_MIN_BARS = 8;
const MATERIAL_MAX_BARS = 16;

async function enumerateCandidates() {
  const csvPath = join(pdmxDir, "PDMX.csv");
  if (!existsSync(csvPath)) throw new Error(`PDMX.csv not found under ${pdmxDir}`);
  const lines = createInterface({ input: createReadStream(csvPath, { encoding: "utf8" }), crlfDelay: Infinity });
  let index = null;
  const rows = [];
  for await (const line of lines) {
    if (index === null) { index = lib.csvHeaderIndex(line); continue; }
    const cells = lib.parseCsvLine(line);
    const row = lib.csvRowToMetadataRow(cells, index);
    if (!row || lib.pdmxRefusalReason(row)) continue;
    const nTracks = Number(cells[index.get("n_tracks")]);
    const bars = Number(cells[index.get("song_length.bars")]);
    if (!(nTracks >= 3) || !(bars >= 24 && bars <= 240)) continue;
    rows.push({ id: row.id, midiPath: row.midiPath, nTracks, bars, license: row.license });
    if (rows.length >= scanLimit) break;
  }
  // Deterministic order independent of the CSV's: by hash of the id.
  return rows.sort((a, b) => sha(a.id).localeCompare(sha(b.id)));
}

function materialsOf(gridMidi) {
  const input = lib.formInputFromMidi(gridMidi, { maxBars: 512 });
  if (input.barStarts.length < 24 || input.tracks.length < 3) return null;
  const form = lib.segmentForm(input);
  const byBase = new Map();
  for (const section of form.sections) {
    if (byBase.has(section.base)) continue;
    if (section.bars < MATERIAL_MIN_BARS || section.activeTracks < 2) continue;
    byBase.set(section.base, section);
  }
  const materials = [...byBase.values()].slice(0, 3);
  if (materials.length < 2) return null;
  return { input, form, materials };
}

function buildPiece(work, gridMidi, materials, pattern, pieceIndex) {
  const tpq = gridMidi.ticksPerQuarter;
  const perBarTicks = 4 * tpq;
  const bpmSource = gridMidi.tempos[0]?.bpm;
  const bpm = bpmSource >= 60 && bpmSource <= 180 ? Math.round(bpmSource) : 110;
  const barSeconds = (60 / bpm) * 4;
  const letters = pattern.split(" ");
  const usedLetters = [...new Set(letters)];
  const materialByLetter = new Map(usedLetters.map((letter, i) => [letter, materials[i % materials.length]]));
  const pitchedTracks = [...new Set(gridMidi.notes.filter((n) => !n.isPercussion).map((n) => n.track))].sort((a, b) => a - b);
  const notes = [];
  const blocks = [];
  let barCursor = 0;
  const seen = new Map();
  for (const letter of letters) {
    const material = materialByLetter.get(letter);
    const bars = Math.min(MATERIAL_MAX_BARS, material.bars);
    const fromTick = material.startBar * perBarTicks;
    const toTick = fromTick + bars * perBarTicks;
    const shift = barCursor * perBarTicks - fromTick;
    const occurrence = (seen.get(letter) ?? 0) + 1;
    seen.set(letter, occurrence);
    // Every third occurrence is a variant: the highest pitched track drops out.
    const variant = occurrence % 3 === 0 && pitchedTracks.length >= 2;
    const dropped = variant ? pitchedTracks[pitchedTracks.length - 1] : null;
    for (const note of gridMidi.notes) {
      if (note.startTick < fromTick || note.startTick >= toTick) continue;
      if (dropped !== null && note.track === dropped) continue;
      notes.push({ ...note, startTick: note.startTick + shift, endTick: Math.min(toTick, note.endTick) + shift });
    }
    blocks.push({ label: letter, startBar: barCursor, endBar: barCursor + bars, start: r3(barCursor * barSeconds), end: r3((barCursor + bars) * barSeconds), variant, sourceBars: [material.startBar, material.startBar + bars] });
    barCursor += bars;
  }
  const midi = {
    ticksPerQuarter: tpq,
    format: 1,
    trackCount: gridMidi.trackCount,
    notes: notes.sort((a, b) => a.startTick - b.startTick || a.track - b.track || a.pitch - b.pitch),
    tempos: [{ tick: 0, usPerQuarter: Math.round(60_000_000 / bpm), bpm }],
    timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }],
    endTick: barCursor * perBarTicks,
  };
  const id = `sx-${String(pieceIndex + 1).padStart(2, "0")}-${work.id.slice(0, 8)}`;
  return {
    id, work, pattern, bpm, barSeconds: r3(barSeconds), bars: barCursor, midi, blocks,
    truth: {
      provider: "CONSTRUCTION",
      boundaries: blocks.slice(1).map((b) => b.start),
      sections: blocks.map((b) => ({ start: b.start, end: b.end, label: b.label })),
    },
  };
}

async function buildSyntheticTier() {
  const started = Date.now();
  const rows = await enumerateCandidates();
  console.log(`[synthetic] ${rows.length} admitted multitrack rows scanned; assembling ${worksWanted} pieces`);
  const pieces = [];
  const refusals = { parseFailed: 0, metreChanges: 0, notFourFour: 0, noMaterials: 0, tooManyTracks: 0 };
  let pieceIndex = 0;
  for (const row of rows) {
    if (pieces.length >= worksWanted) break;
    const file = join(pdmxDir, "mid", row.midiPath.replace(/^\.\//, ""));
    if (!existsSync(file)) continue;
    let midi;
    try { midi = lib.parseMidiFile(readFileSync(file)); } catch { refusals.parseFailed += 1; continue; }
    const grid = lib.dominantGridMidi(midi);
    if (grid.metreChanges > 0) { refusals.metreChanges += 1; continue; }
    const sig = grid.midi.timeSignatures[0];
    if (sig.numerator !== 4 || sig.denominator !== 4) { refusals.notFourFour += 1; continue; }
    const material = materialsOf(grid.midi);
    if (!material) { refusals.noMaterials += 1; continue; }
    const pattern = PATTERNS[pieceIndex % PATTERNS.length];
    const piece = buildPiece(row, grid.midi, material.materials, pattern, pieceIndex);
    if (piece.midi.notes.length < 200) { refusals.noMaterials += 1; continue; }
    pieceIndex += 1;
    const midiBytes = lib.writeMidiFile(piece.midi);
    writeFileSync(join(workDir, "midi", `${piece.id}.mid`), midiBytes);
    const render = lib.renderStereoMix(lib.parseMidiFile(midiBytes), { candidateGain: 1 });
    const wav = lib.encodeWavPcm16Stereo(render.left, render.right, render.sampleRate);
    const wavPath = join(workDir, "audio", `${piece.id}.wav`);
    writeFileSync(wavPath, wav);
    toMsafWav(wavPath, join(workDir, "msaf-in", `${piece.id}.wav`));
    piece.audio = { path: wavPath, sha256: sha(wav), durationSeconds: r3(render.durationSeconds), sourceForm: material.form.formString, sourceSections: material.form.sections.length };
    pieces.push(piece);
    console.log(`[synthetic] ${piece.id}  ${pattern}  ${piece.bars} bars @ ${piece.bpm} BPM  ${piece.audio.durationSeconds}s  (source form ${material.form.formString})`);
  }
  return { pieces, refusals, scanned: rows.length, seconds: r2((Date.now() - started) / 1000) };
}

// ---------------------------------------------------------------------------
// MSAF worker
// ---------------------------------------------------------------------------
function runMsaf() {
  const output = join(workDir, "msaf-out.json");
  if (msafMode === "skip") return { report: null, note: "skipped by --msaf skip" };
  if (msafMode === "run") {
    const started = Date.now();
    console.log("[msaf] modal run ...");
    execFileSync("py", ["-m", "modal", "run", join(repoRoot, "services/msaf-structure-worker/modal_app.py"), "--input-dir", join(workDir, "msaf-in"), "--output", output], {
      stdio: "inherit", env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" }, timeout: 3_600_000,
    });
    console.log(`[msaf] done in ${r2((Date.now() - started) / 1000)} s`);
  }
  if (!existsSync(output)) return { report: null, note: `no MSAF output at ${output}` };
  const report = JSON.parse(readFileSync(output, "utf8"));
  return { report, byName: new Map(report.results.map((r) => [r.name, r])) };
}

// ---------------------------------------------------------------------------
// ANALYSIS_GOLD_V1: Stream H's composed pieces with sections known by construction
// ---------------------------------------------------------------------------
function loadGoldTier() {
  if (goldMode === "skip") return { pieces: [], skipped: [], note: "skipped by --gold skip" };
  if (!existsSync(goldDir)) return { pieces: [], skipped: [], note: `no ANALYSIS_GOLD_V1 corpus at ${goldDir}` };
  const pieces = [];
  const skipped = [];
  for (const name of readdirSync(goldDir).sort()) {
    const dir = join(goldDir, name);
    const truthPath = join(dir, "truth.json");
    const mix = join(dir, "mix.wav");
    if (!existsSync(truthPath) || !existsSync(mix)) continue;
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    const sections = (truth.sections ?? []).map((s) => ({ start: r3(s.start), end: r3(s.end), label: String(s.label) }));
    if (sections.length < 2) { skipped.push(name); continue; }
    const id = `gold-${name}`;
    toMsafWav(mix, join(workDir, "msaf-in", `${id}.wav`));
    const bytes = readFileSync(mix);
    pieces.push({
      id,
      audioPath: mix,
      durationSeconds: r3(durationOf(mix)),
      sha256: sha(bytes),
      truth: { provider: "ANALYSIS_GOLD_V1", boundaries: sections.slice(1).map((s) => s.start), sections },
      truthReport: {
        boundaries: sections.slice(1).map((s) => s.start),
        labels: sections.map((s) => s.label).join(" "),
        metre: truth.metre ? `${truth.metre.numerator}/${truth.metre.denominator}${truth.metre.changes?.length > 1 ? " (changes)" : ""}` : null,
        tempoBpm: truth.tempo?.bpm ?? null,
        traps: truth.tempo?.traps ?? [],
      },
      report: { gold: name, truthSha: JSON.parse(readFileSync(join(dir, "render.json"), "utf8")).truthSha ?? null },
    });
    console.log(`[gold] ${id}  ${sections.map((s) => s.label).join(" ")}  ${pieces.at(-1).durationSeconds}s`);
  }
  return { pieces, skipped, dir: goldDir };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const synthetic = await buildSyntheticTier();
const gold = loadGoldTier();

const real = [];
for (const input of realInputs) {
  if (!existsSync(input.path)) { console.warn(`[real] missing ${input.path}`); continue; }
  const name = `real-${sha(input.label).slice(0, 10)}`;
  toMsafWav(input.path, join(workDir, "msaf-in", `${name}.wav`));
  real.push({ ...input, name, durationSeconds: r3(durationOf(input.path)) });
}

const msaf = runMsaf();

const tolerances = ["0.5", "3"];

/**
 * Score one SYNTHETIC_EXACT arm: every candidate and both reconciliations
 * against each piece's exact truth. Arms are never pooled.
 */
function scoreArm(armName, pieces) {
  const scoresByProvider = new Map();
  const perPiece = [];
  for (const piece of pieces) {
    const samples = decodeMono8k(piece.audioPath);
    const { candidates, reconciliation } = analysePiece(samples, piece.durationSeconds, msaf.byName?.get(piece.id));
    const scored = [];
    for (const candidate of candidates) {
      if (!candidate.reading) { scored.push({ provider: candidate.provider, absent: candidate.note }); continue; }
      const score = lib.scoreReading(piece.truth, candidate.reading);
      scored.push(score);
      if (!scoresByProvider.has(candidate.provider)) scoresByProvider.set(candidate.provider, []);
      scoresByProvider.get(candidate.provider).push(score);
    }
    for (const variant of ["all", "corroborated"]) {
      const reading = lib.reconciliationAsReading(reconciliation, variant);
      const score = lib.scoreReading(piece.truth, reading);
      scored.push(score);
      if (!scoresByProvider.has(reading.provider)) scoresByProvider.set(reading.provider, []);
      scoresByProvider.get(reading.provider).push(score);
    }
    perPiece.push({
      id: piece.id,
      ...piece.report,
      durationSeconds: piece.durationSeconds,
      audioSha256: piece.sha256,
      truth: piece.truthReport,
      readings: Object.fromEntries(candidates.map((c) => [c.provider, c.reading
        ? { boundaries: c.reading.boundaries.map(r2), form: c.formString, ...(c.bpm ? { bpm: c.bpm } : {}), ...(c.seconds ? { seconds: c.seconds } : {}) }
        : { absent: c.note }])),
      reconciled: {
        status: reconciliation.status,
        boundaries: reconciliation.boundaries.map((b) => ({ time: r2(b.time), status: b.status, providers: b.providers })),
        form: reconciliation.sections.map((s) => s.label + (s.labelStatus === "contested" ? "?" : "")).join(" "),
        contested: reconciliation.contested.length,
        message: reconciliation.message,
      },
      scores: Object.fromEntries(scored.map((s) => [s.provider, s.absent ? { absent: s.absent } : {
        f1: Object.fromEntries(tolerances.map((t) => [t, s.boundaries[t].f1])),
        hits3: s.boundaries["3"].hits, spurious3: s.boundaries["3"].spurious, missed3: s.boundaries["3"].missed,
        pairwiseF: s.pairwise.f, ratio: s.segmentationRatio,
      }])),
    });
    console.log(`[score:${armName}] ${piece.id}  ${Object.entries(perPiece.at(-1).scores).map(([p, s]) => `${p}=${s.f1 ? s.f1["3"] : "-"}`).join("  ")}`);
  }

  const aggregate = Object.fromEntries([...scoresByProvider].map(([provider, scores]) => [provider, lib.aggregateScores(scores)]));
  const singleCandidates = [...scoresByProvider.keys()].filter((p) => !p.startsWith("RECONCILED"));
  const versusBest = { metric: "boundary F1 at ±3 s", pieces: perPiece.length, better: 0, equal: 0, worse: 0, bestSingleByPiece: {}, detail: [] };
  for (const piece of perPiece) {
    const singles = singleCandidates.map((p) => [p, piece.scores[p]?.f1?.["3"] ?? null]).filter(([, v]) => v !== null);
    if (!singles.length) continue;
    const best = singles.reduce((a, b) => (b[1] > a[1] ? b : a));
    const reconciled = piece.scores.RECONCILED?.f1?.["3"] ?? 0;
    versusBest.bestSingleByPiece[best[0]] = (versusBest.bestSingleByPiece[best[0]] ?? 0) + 1;
    if (reconciled > best[1] + 1e-9) versusBest.better += 1; else if (Math.abs(reconciled - best[1]) <= 1e-9) versusBest.equal += 1; else versusBest.worse += 1;
    versusBest.detail.push({ piece: piece.id, bestSingle: best[0], bestF1: best[1], reconciledF1: reconciled, corroboratedF1: piece.scores.RECONCILED_CORROBORATED?.f1?.["3"] ?? null });
  }
  // Oracle comparison: the best single candidate per piece is chosen with the truth in hand, which no runtime has.
  const meanOf = (xs) => (xs.length ? r3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  versusBest.meanBestSingleF1 = meanOf(versusBest.detail.map((d) => d.bestF1));
  versusBest.meanReconciledF1 = meanOf(versusBest.detail.map((d) => d.reconciledF1));
  versusBest.meanCorroboratedF1 = meanOf(versusBest.detail.map((d) => d.corroboratedF1).filter((v) => v !== null));
  return { aggregate, reconciliationVersusBestSingle: versusBest, perPiece };
}

const pdmxArm = scoreArm("PDMX_ASSEMBLED", synthetic.pieces.map((piece) => ({
  id: piece.id,
  audioPath: piece.audio.path,
  durationSeconds: piece.audio.durationSeconds,
  sha256: piece.audio.sha256,
  truth: piece.truth,
  truthReport: { boundaries: piece.truth.boundaries, labels: piece.truth.sections.map((s) => s.label).join(" "), variants: piece.blocks.filter((b) => b.variant).map((b) => b.startBar) },
  report: {
    source: { pdmxId: piece.work.id, license: piece.work.license, nTracks: piece.work.nTracks, sourceForm: piece.audio.sourceForm },
    pattern: piece.pattern,
    bpm: piece.bpm,
    bars: piece.bars,
  },
})));
const goldArm = gold.pieces.length ? scoreArm("ANALYSIS_GOLD_V1", gold.pieces) : null;

const realReports = [];
for (const item of real) {
  const samples = decodeMono8k(item.path);
  const { candidates, reconciliation } = analysePiece(samples, item.durationSeconds, msaf.byName?.get(item.name));
  realReports.push({
    label: item.label,
    durationSeconds: item.durationSeconds,
    audioSha256: sha(readFileSync(item.path)),
    ...(item.note ? { inputNote: item.note } : {}),
    readings: Object.fromEntries(candidates.map((c) => [c.provider, c.reading
      ? { boundaries: c.reading.boundaries.map(r2), sections: c.reading.sections.map((s) => `${s.label}@${r2(s.start)}`).join(" "), ...(c.bpm ? { bpm: c.bpm } : {}), confidence: c.confidence ?? null }
      : { absent: c.note }])),
    reconciled: {
      status: reconciliation.status,
      message: reconciliation.message,
      boundaries: reconciliation.boundaries.map((b) => ({ time: r2(b.time), status: b.status, providers: b.providers, score: b.score })),
      sections: reconciliation.sections.map((s) => ({ start: r2(s.start), end: r2(s.end), label: s.label, labelStatus: s.labelStatus, confidence: s.confidence })),
      corroboratedForm: reconciliation.corroboratedSections.map((s) => s.label + (s.labelStatus === "contested" ? "?" : "")).join(" "),
      contested: reconciliation.contested.map((c) => ({ start: r2(c.start), end: r2(c.end), kind: c.kind, candidates: c.candidates })),
    },
  });
  console.log(`[real] ${item.label}: ${reconciliation.status} - ${reconciliation.message}`);
}

const report = {
  id: "structure-tournament-live",
  pr: "PR-87",
  version: lib.STRUCTURE_TOURNAMENT_VERSION,
  recordedAt: new Date().toISOString(),
  question: "Which structure candidate, and which reconciliation of them, gives boundaries and section labels we can prove on real audio - and where do they disagree on the owner's songs?",
  candidates: {
    ALL_IN_ONE: { status: "absent", note: "no ALL_IN_ONE_API_URL is configured on this machine and no All-In-One worker is deployed; the live-provider arm of the tournament is empty (Stream A audits providers)" },
    SONGFORMER: { status: "absent", note: "services/songformer-worker is BLOCKED_LICENSE (MusicFM / MuQ checkpoints); not run" },
    LOCAL_SSM_STRUCTURE_V1: { status: "ran", note: "src/lib/audioStructure.ts - chroma + MFCC SSM, checkerboard novelty, repetition labels; CPU, deterministic, unlearned" },
    LOCAL_SIGNAL_ANALYZER_V1: { status: "ran", note: "the production fallback: deriveLocalStructure on the bar-energy curve with the onset-autocorrelation tempo (localStructureAnalysis.ts)" },
    MSAF: { status: msaf.report ? "ran" : "absent", note: "services/msaf-structure-worker (Modal, CPU, pinned msaf 0.1.80): sf boundaries + fmc2d labels; MSAF_FOOTE and MSAF_SCLUSTER are reported as arms but only MSAF enters reconciliation (same features, not independent)" },
    reconciled: "reconcileStructures over LOCAL_SSM_STRUCTURE_V1 + LOCAL_SIGNAL_ANALYZER_V1 + MSAF with providerReliability weights; RECONCILED keeps corroborated and lone boundaries, RECONCILED_CORROBORATED keeps only boundaries two readings agree on (±3 s)",
  },
  decode: { tool: "ffmpeg", channels: 1, sampleRate: DECODE_RATE, format: "f32le", note: "the same decode the analyzer uses; every candidate reads this one buffer, MSAF reads the same audio at 22.05 kHz mono" },
  metrics: {
    boundaries: "interior boundaries, maximum bipartite matching within ±0.5 s and ±3 s (precision / recall / F1, spurious = unmatched estimates, missed = unmatched references)",
    segmentation: "estimated / reference section count per piece; a piece is over-segmented above 1.25 and under-segmented below 0.75",
    labels: "pairwise frame-label F (Levy & Sandler) on a 0.25 s grid: a candidate's letters are scored only through which frames it joins into one section",
    versusBestSingle: "the best single candidate per piece is chosen with the truth in hand (an oracle no runtime has); the reconciliations are compared with it piece by piece",
  },
  tiers: {
    SYNTHETIC_EXACT: {
      note: "two arms with exact truth, scored separately and never pooled: forms assembled from real PDMX multitrack sections, and Stream H's ANALYSIS_GOLD_V1 composed pieces",
      arms: {
        PDMX_ASSEMBLED: {
          truth: "by construction: sections are real PDMX multitrack score slices (no_license_conflict rows, n_tracks >= 3, 4/4 dominant grid, 8-16 whole bars each, first occurrence of each formSegmentation base letter), assembled in a fixed pattern; every third repeat drops the top pitched track (a variant, same label). Boundaries are exact bar lines in seconds; labels are the construction letters.",
          renderer: "LISTENING_SYNTH_V2 stereo, candidateGain 1, 44.1 kHz",
          pieces: pdmxArm.perPiece.length,
          construction: { patterns: PATTERNS, materialBars: [MATERIAL_MIN_BARS, MATERIAL_MAX_BARS], scanned: synthetic.scanned, refusals: synthetic.refusals, buildSeconds: synthetic.seconds },
          aggregate: pdmxArm.aggregate,
          reconciliationVersusBestSingle: pdmxArm.reconciliationVersusBestSingle,
          perPiece: pdmxArm.perPiece,
        },
        ANALYSIS_GOLD_V1: goldArm ? {
          truth: "Stream H's ANALYSIS_GOLD_V1 composed pieces: sections known by construction in truth.json (named verse / chorus / bridge ... by the composer), rendered mixes (mix.wav) scored as-is. The PDMX-derived gold pieces carry no section truth and are not scored here.",
          dir: gold.dir,
          pieces: goldArm.perPiece.length,
          withoutSectionTruth: gold.skipped.length,
          aggregate: goldArm.aggregate,
          reconciliationVersusBestSingle: goldArm.reconciliationVersusBestSingle,
          perPiece: goldArm.perPiece,
        } : { pieces: 0, note: gold.note ?? "no gold pieces with section truth" },
      },
    },
    PROFESSIONAL_REAL_WORLD: {
      truth: "none - outputs and disagreement only",
      pieces: realReports,
    },
  },
  modal: msaf.report ? {
    app: msaf.report.app, files: msaf.report.files, wallSeconds: msaf.report.wallSeconds, resources: msaf.report.resources,
    algorithms: msaf.report.algorithms,
    runtime: msaf.report.results[0]?.runtime ?? null,
    perFileSeconds: msaf.report.results.map((r) => r.runtime?.seconds ?? null),
    errors: msaf.report.results.flatMap((r) => Object.entries(r.readings).filter(([, v]) => v.error).map(([p, v]) => `${r.name}/${p}: ${v.error}`)),
  } : { note: msaf.note },
  limits: [
    "SYNTHETIC_EXACT (both arms) is rendered symbolic music with hard cuts between sections: no transitions, no fills, no production; it measures whether a candidate hears a change in harmony/timbre/energy at a bar line, not whether it hears pop structure",
    "the ANALYSIS_GOLD_V1 arm is short (36-78 s, 3-5 sections of 8-20 s) and includes 3/4, 6/8, metre-change and tempo-trap pieces; the local segmenter's 6 s minimum section and 8 s kernel are close to its section lengths",
    "labels in truth are construction letters (PDMX arm) or composer names (gold arm); a candidate's letters are scored only through the pairwise same/different relation",
    "the live provider arm is empty: ALL_IN_ONE is not configured, SONGFORMER is licence-blocked; a provider-grade candidate has not been measured here",
    "PROFESSIONAL_REAL_WORLD has no truth; the owner's two recordings show candidate outputs and disagreement, nothing about correctness",
    "the ±3 s window for corroboration and the reliability weights are design choices; Stream I's disagreement engine is where they get calibrated",
  ],
};
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(`\nwrote ${outPath}`);
for (const [armName, arm] of [["PDMX_ASSEMBLED", pdmxArm], ["ANALYSIS_GOLD_V1", goldArm]]) {
  if (!arm) continue;
  console.log(`\n== ${armName} (${arm.perPiece.length} pieces)`);
  for (const [provider, agg] of Object.entries(arm.aggregate)) {
    if (!agg) continue;
    console.log(`${provider.padEnd(26)} n=${agg.pieces}  F1@0.5=${agg.boundaryF1["0.5"]}  F1@3=${agg.boundaryF1["3"]}  pairF=${agg.pairwiseF}  ratio=${agg.meanSegmentationRatio}  over=${agg.overSegmentedPieces} under=${agg.underSegmentedPieces}`);
  }
  const vb = arm.reconciliationVersusBestSingle;
  console.log(`reconciled vs best single (F1@3): better ${vb.better}, equal ${vb.equal}, worse ${vb.worse}; mean best-single ${vb.meanBestSingleF1} vs reconciled ${vb.meanReconciledF1} vs corroborated-only ${vb.meanCorroboratedF1}`);
}
