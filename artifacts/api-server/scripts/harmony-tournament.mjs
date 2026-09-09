/**
 * The harmony tournament (PR-85, ANALYSIS ENGINE wave, stream E).
 *
 *   node scripts/harmony-tournament.mjs [--works 12] [--scan 2500] [--seconds 90]
 *        [--target .pdmx-data] [--split test|dev] [--work-dir .tmp-harmony] [--skip-modal]
 *        [--root-provider-weight 0.85] [--out docs/evidence/harmony-tournament-live.json]
 *
 * `--split dev` draws a second, disjoint set of works by the same rule; engine
 * constants are chosen there (`--root-provider-weight` sweeps one) and the test
 * split is scored once, with the engine's defaults, for the record.
 *
 * What it does, in order:
 *
 *  1. Draws PDMX works admitted by *both* our rights gate and the authors'
 *     `no_license_conflict` subset, and keeps the ones whose harmony is stated
 *     in sustained block chords — because only those give an **exact** chord,
 *     inversion and key reference (`harmonyGold.ts`). That selection is a bias
 *     and the report says so.
 *  2. Renders each work to audio with `referenceRenderWorker` (no samples, no
 *     GPU, deterministic).
 *  3. Runs every provider arm live on Modal (`services/harmony-acr-worker`):
 *     BTC major/minor, BTC large-vocabulary, librosa CQT chroma, a
 *     Krumhansl key over that chroma, and pYIN over the bass band.
 *  4. Scores each arm, and the ensemble, with `harmonyMetrics` — root,
 *     maj/min, full symbol, inversion-bass, boundary F1, key strict and the
 *     MIREX-weighted key credit reported separately.
 *  5. Writes `docs/evidence/harmony-tournament-live.json`.
 *
 * The Modal step is the only thing that costs money and it is the only thing
 * that cannot be re-run offline; `--skip-modal` reuses the provider JSON from
 * a previous run so the scoring can be iterated for free.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `harmony-tournament-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./harmony-tournament-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const worksWanted = Number(flag("works", "12"));
const scanLimit = Number(flag("scan", "2500"));
const clipSeconds = Number(flag("seconds", "90"));
const target = resolve(repoRoot, flag("target", "../AI-Music-Production-Platform-main/.pdmx-data"));
/**
 * `test` is the split every number in the tracker is quoted on; `dev` is a
 * disjoint draw from the same pool, chosen by the same rule, on which engine
 * constants may be picked. Nothing is ever chosen on `test`.
 */
const split = flag("split", "test");
if (split !== "test" && split !== "dev") throw new Error(`--split must be test or dev, not ${split}`);
const workDir = resolve(repoRoot, flag("work-dir", split === "dev" ? ".tmp-harmony/dev" : ".tmp-harmony"));
const outPath = resolve(repoRoot, flag("out", split === "dev"
  ? ".tmp-harmony/dev/harmony-tournament-dev.json"
  : "docs/evidence/harmony-tournament-live.json"));
const skipModal = has("skip-modal");
/** Engine constants under study; absent means the engine's own defaults. */
const engineOptions = {};
if (flag("root-provider-weight", null) !== null) {
  engineOptions.rootProviderWeight = Number(flag("root-provider-weight", null));
}

const audioDir = join(workDir, "audio");
const providersPath = join(workDir, "providers.json");

// ---------------------------------------------------------------------------
// 1. Corpus
// ---------------------------------------------------------------------------

console.log("reading the rights basis…");
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8")
    .split(/\r?\n/).map((path) => lib.pdmxIdFromPath(path.trim())).filter(Boolean),
);

const candidates = [];
let totalRows = 0;
let ourAdmitted = 0;
{
  const lines = createInterface({
    input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let index = null;
  for await (const line of lines) {
    if (index === null) { index = lib.csvHeaderIndex(line); continue; }
    if (!line.trim()) continue;
    totalRows += 1;
    const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
    if (!row || lib.pdmxRefusalReason(row) !== null) continue;
    ourAdmitted += 1;
    if (!authorsAdmitted.has(row.id)) continue;
    if (!row.midiPath) continue;
    if (!(row.n_tracks >= 2)) continue;
    candidates.push({
      id: row.id,
      title: row.title ?? null,
      midiPath: row.midiPath,
      genres: Array.isArray(row.genres) ? row.genres : (row.genres ? [String(row.genres)] : []),
    });
  }
}
console.log(` ${totalRows} rows; ${ourAdmitted} admitted by our gate; ${candidates.length} also in the authors' subset with n_tracks >= 2`);

// Deterministic shuffle — the same corpus every run.
let seed = 0x8a5d3f11;
const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0xffffffff; };
candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
for (let i = candidates.length - 1; i > 0; i -= 1) {
  const j = Math.floor(random() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}

console.log(`scanning up to ${scanLimit} works for an exact harmony reference…`);
const scored = [];
let scanned = 0;
let parseFailed = 0;
let missing = 0;
for (const candidate of candidates) {
  if (scanned >= scanLimit) break;
  const file = join(target, "mid", candidate.midiPath.replace(/^\.\//, ""));
  if (!existsSync(file)) { missing += 1; continue; }
  scanned += 1;
  let bytes;
  let midi;
  try {
    bytes = readFileSync(file);
    midi = lib.parseMidiFile(bytes);
  } catch { parseFailed += 1; continue; }
  let gold;
  try { gold = lib.buildHarmonyGold(midi, bytes, { subdivisionsPerBar: 2 }); } catch { continue; }
  if (!gold.globalKey) continue;
  if (gold.durationSeconds < 40 || gold.durationSeconds > 300) continue;
  if (gold.chords.length < 12) continue;
  if (gold.scoredShare < 0.45) continue;
  scored.push({ ...candidate, file, gold, midi, bytes });
  if (scored.length >= worksWanted * 4) break;
}
scored.sort((a, b) => b.gold.scoredShare - a.gold.scoredShare);

// Spread the sample over genres rather than taking the twelve easiest works.
const chooseWorks = (pool) => {
  const picked = [];
  const genreCounts = new Map();
  for (const pass of [2, 99]) {
    for (const work of pool) {
      if (picked.length >= worksWanted) break;
      if (picked.includes(work)) continue;
      const genre = work.genres[0] ?? "unlabelled";
      if ((genreCounts.get(genre) ?? 0) >= pass) continue;
      genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
      picked.push(work);
    }
  }
  return picked;
};
// The test split is always drawn first, so the dev split is disjoint from it
// whatever else changes, and the test split is the same whether or not a dev
// split was ever drawn.
const testWorks = chooseWorks(scored);
const chosen = split === "test"
  ? testWorks
  : chooseWorks(scored.filter((work) => !testWorks.includes(work)));
console.log(` scanned ${scanned}; ${scored.length} carry an exact reference; ${chosen.length} chosen for the ${split} split`);
if (!chosen.length) throw new Error("no work produced an exact harmony reference");

// ---------------------------------------------------------------------------
// 2. Render
// ---------------------------------------------------------------------------

const GM_FAMILY = (program, isPercussion) => {
  if (isPercussion) return "drums";
  if (program <= 7) return "keys";
  if (program <= 23) return "keys";
  if (program <= 31) return "guitar";
  if (program <= 39) return "bass";
  if (program <= 51) return "strings";
  if (program <= 55) return "voice";
  if (program <= 71) return "brass";
  if (program <= 79) return "winds";
  if (program <= 95) return "synth";
  return "keys";
};

/** Sum a work's per-family stems into one mono mix and write a 16-bit WAV. */
function renderWork(work) {
  const grid = lib.gridFromMidi(work.midi);
  const toSeconds = (() => {
    // gridFromMidi already resolved the tempo map; reuse the bar grid for a
    // linear tick→second map good enough for note times.
    const tempos = work.midi.tempos.length ? work.midi.tempos : [{ tick: 0, usPerQuarter: 500000 }];
    const sorted = [...tempos].sort((a, b) => a.tick - b.tick);
    if (sorted[0].tick > 0) sorted.unshift({ tick: 0, usPerQuarter: 500000 });
    const marks = [];
    let seconds = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      if (i > 0) {
        seconds += ((sorted[i].tick - sorted[i - 1].tick) / work.midi.ticksPerQuarter) *
          (sorted[i - 1].usPerQuarter / 1e6);
      }
      marks.push({ tick: sorted[i].tick, seconds, usPerQuarter: sorted[i].usPerQuarter });
    }
    return (tick) => {
      let mark = marks[0];
      for (const candidate of marks) { if (candidate.tick <= tick) mark = candidate; else break; }
      return mark.seconds + ((tick - mark.tick) / work.midi.ticksPerQuarter) * (mark.usPerQuarter / 1e6);
    };
  })();

  const byFamily = new Map();
  for (const note of work.midi.notes) {
    const family = GM_FAMILY(note.program, note.isPercussion);
    const start = toSeconds(note.startTick);
    const end = toSeconds(note.endTick);
    if (!(end > start) || start > clipSeconds) continue;
    const list = byFamily.get(family) ?? [];
    list.push({
      id: `${note.track}-${note.startTick}-${note.pitch}`,
      start,
      duration: Math.min(end, clipSeconds + 1) - start,
      pitch: note.pitch,
      velocity: note.velocity,
    });
    byFamily.set(family, list);
  }
  const duration = Math.min(clipSeconds, grid.durationSeconds);
  const sampleRate = 22050;
  let mix = null;
  for (const [family, notes] of byFamily) {
    if (!notes.length) continue;
    const stem = lib.renderStem(
      { id: family, instrument: family, role: family, notes },
      { sampleRate, bitDepth: 16, durationSeconds: duration },
    );
    if (!mix) mix = new Float32Array(stem.samples.length);
    const length = Math.min(mix.length, stem.samples.length);
    for (let i = 0; i < length; i += 1) mix[i] += stem.samples[i];
  }
  if (!mix) return null;
  // Headroom: a summed mix clips, and a clipped mix is a different test.
  let peak = 0;
  for (const value of mix) peak = Math.max(peak, Math.abs(value));
  if (peak > 0.89) for (let i = 0; i < mix.length; i += 1) mix[i] *= 0.89 / peak;
  return { wav: lib.encodeWavPcm(mix, sampleRate, 16), duration, grid };
}

rmSync(audioDir, { recursive: true, force: true });
mkdirSync(audioDir, { recursive: true });
const clips = [];
for (const work of chosen) {
  const rendered = renderWork(work);
  if (!rendered) { console.log(` ${work.id}: nothing rendered, skipped`); continue; }
  const stem = work.id.slice(0, 24);
  writeFileSync(join(audioDir, `${stem}.wav`), rendered.wav);
  // The reference is clipped to the same window the audio covers.
  const gold = {
    ...work.gold,
    chords: work.gold.chords
      .filter((chord) => chord.start < rendered.duration)
      .map((chord) => ({ ...chord, end: Math.min(chord.end, rendered.duration) }))
      .filter((chord) => chord.end > chord.start),
    bars: work.gold.bars.filter((bar) => bar.start < rendered.duration),
    beats: work.gold.beats.filter((beat) => beat <= rendered.duration),
  };
  clips.push({
    stem,
    id: work.id,
    title: work.title,
    genres: work.genres,
    durationSeconds: Number(rendered.duration.toFixed(3)),
    gold,
  });
  console.log(` rendered ${stem} (${rendered.duration.toFixed(1)}s, ${gold.chords.length} exact chords, key ${gold.globalKey})`);
}

// ---------------------------------------------------------------------------
// 3. Providers, live
// ---------------------------------------------------------------------------

if (!skipModal) {
  console.log("running the provider arms on Modal…");
  const started = Date.now();
  const result = spawnSync(
    process.platform === "win32" ? "python" : "python3",
    ["-m", "modal", "run", "services/harmony-acr-worker/modal_app.py::batch",
      "--input-dir", audioDir, "--output", providersPath],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: { ...process.env, MODAL_PROFILE: "music-platform", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    },
  );
  if (result.status !== 0) throw new Error(`modal run failed with status ${result.status}`);
  console.log(` providers finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
if (!existsSync(providersPath)) throw new Error(`no provider evidence at ${providersPath}`);
const providerEvidence = JSON.parse(readFileSync(providersPath, "utf8"));

// ---------------------------------------------------------------------------
// 4. Arms and scoring
// ---------------------------------------------------------------------------

/** Duration-weighted pitch-class weights implied by a chord sequence. */
function chordWeights(spans) {
  const weights = new Array(12).fill(0);
  for (const span of spans) {
    const tones = lib.chordPitchClassesOf(span.symbol);
    if (!tones) continue;
    const length = span.end - span.start;
    for (const tone of tones) weights[tone] += length;
    // The root is stated, not merely present.
    weights[tones[0]] += length * 0.5;
  }
  return weights;
}

const engineInputFor = (clip, evidence, arm) => {
  const chroma = evidence.CHROMA_CQT
    ? [{ provider: "CHROMA", frames: evidence.CHROMA_CQT }]
    : [];
  const bass = (evidence.BASS_PYIN ?? []).map((note) => ({ ...note, provider: "BASS" }));
  const beats = evidence.BEATS?.beats ?? clip.gold.beats;
  const keyObservations = [];
  if (evidence.KEY_KRUMHANSL) {
    keyObservations.push({
      provider: "CHROMA",
      key: `${evidence.KEY_KRUMHANSL.key} ${evidence.KEY_KRUMHANSL.scale}`,
      confidence: evidence.KEY_KRUMHANSL.confidence,
      pitchClassEvidence: evidence.KEY_KRUMHANSL.hpcp,
      note: "Krumhansl-Kessler over librosa CQT chroma",
    });
  }
  const btcSpans = evidence.BTC_LARGE_VOCA ?? [];
  if (btcSpans.length) {
    const estimate = lib.estimateWindowKey(chordWeights(btcSpans));
    if (estimate) {
      keyObservations.push({
        provider: "SHEETSAGE",
        key: estimate.key,
        confidence: estimate.confidence,
        note: "Krumhansl-Kessler over BTC's own large-vocabulary chord sequence",
      });
    }
  }
  const base = {
    durationSeconds: clip.durationSeconds,
    bars: clip.gold.bars,
    beats,
    keyObservations,
  };
  if (arm === "CHROMA_ONLY") return { ...base, chroma, keyObservations };
  if (arm === "CHROMA_PLUS_BASS") return { ...base, chroma, bass };
  if (arm === "BTC_MAJMIN") {
    return { ...base, chordSources: [{ provider: "CHROMA", events: evidence.BTC_MAJMIN ?? [] }] };
  }
  if (arm === "BTC_LARGE_VOCA") {
    return { ...base, chordSources: [{ provider: "SHEETSAGE", events: btcSpans }] };
  }
  // The ensemble: every source at once.
  return {
    ...base,
    chroma,
    bass,
    chordSources: [
      { provider: "CHROMA", events: evidence.BTC_MAJMIN ?? [], confidence: 0.85 },
      { provider: "SHEETSAGE", events: btcSpans, confidence: 0.9 },
    ],
  };
};

/** A provider arm scored directly, with no engine in the way. */
const rawArms = {
  BTC_MAJMIN_RAW: (evidence) => evidence.BTC_MAJMIN ?? [],
  BTC_LARGE_VOCA_RAW: (evidence) => evidence.BTC_LARGE_VOCA ?? [],
};
const engineArms = ["CHROMA_ONLY", "CHROMA_PLUS_BASS", "BTC_MAJMIN", "BTC_LARGE_VOCA", "ENSEMBLE"];

const perClip = [];
for (const clip of clips) {
  const evidence = providerEvidence[clip.stem];
  if (!evidence) { console.log(` ${clip.stem}: no provider evidence, skipped`); continue; }
  const reference = clip.gold.chords.map((chord) => ({ start: chord.start, end: chord.end, symbol: chord.symbol }));
  const arms = {};

  for (const [name, take] of Object.entries(rawArms)) {
    const spans = take(evidence).filter((span) => span.symbol && span.symbol !== "N");
    arms[name] = {
      kind: "raw_provider",
      chords: spans.length,
      chord: lib.chordAccuracy(reference, spans),
      boundary: lib.boundaryAccuracy(reference, spans, 0.25),
      key: null,
    };
  }

  let ensembleResult = null;
  for (const arm of engineArms) {
    const input = engineInputFor(clip, evidence, arm);
    const result = lib.runHarmonyEngine(input, engineOptions);
    if (arm === "ENSEMBLE") ensembleResult = result;
    const spans = result.chords.map((chord) => ({ start: chord.start, end: chord.end, symbol: chord.symbol }));
    arms[arm] = {
      kind: "engine",
      chords: spans.length,
      chord: lib.chordAccuracy(reference, spans),
      boundary: lib.boundaryAccuracy(reference, spans, 0.25),
      abstained: result.abstainedSegments.length,
      coverage: result.coverage,
      smoothing: result.smoothing,
      key: {
        status: result.key.global.status,
        value: result.key.global.status === "agreed" ? result.key.global.key : null,
        candidates: result.key.global.candidates.map((candidate) => ({
          key: candidate.key, score: candidate.score,
          supporters: candidate.supporters.map((item) => item.provider),
        })),
        relation: result.key.global.relation ?? null,
        message: result.key.global.message,
        segments: result.key.segments.length,
        changes: result.key.changes.map((change) => ({
          at: change.at, from: change.from, to: change.to, kind: change.kind, bars: change.bars,
        })),
      },
    };
  }

  // Is the ensemble's abstention *informative*? Score the best single provider
  // separately over the time the ensemble spoke and the time it refused. If the
  // provider is markedly worse where the ensemble refused, the refusal is
  // carrying information rather than merely losing coverage.
  const clipSpans = (spans, windows) => {
    const out = [];
    for (const span of spans) {
      for (const window of windows) {
        const start = Math.max(span.start, window.start);
        const end = Math.min(span.end, window.end);
        if (end > start) out.push({ ...span, start, end });
      }
    }
    return out;
  };
  const spoke = ensembleResult ? ensembleResult.chords.map((c) => ({ start: c.start, end: c.end })) : [];
  const refused = ensembleResult ? ensembleResult.abstainedSegments.map((a) => ({ start: a.start, end: a.end })) : [];
  const btcSpansForSplit = (evidence.BTC_LARGE_VOCA ?? []).filter((s) => s.symbol && s.symbol !== "N");
  const abstentionValue = {
    ensembleSpokeSeconds: Number(spoke.reduce((sum, w) => sum + (w.end - w.start), 0).toFixed(3)),
    ensembleRefusedSeconds: Number(refused.reduce((sum, w) => sum + (w.end - w.start), 0).toFixed(3)),
    providerRootWhereEnsembleSpoke: lib.chordAccuracy(clipSpans(reference, spoke), btcSpansForSplit).root.onReference,
    providerRootWhereEnsembleRefused: lib.chordAccuracy(clipSpans(reference, refused), btcSpansForSplit).root.onReference,
  };

  // Two diagnostics that say *why* the ensemble lands where it lands, rather
  // than only where. Neither is a score; both are read against the exact
  // reference, so they belong to the record and not to the tuning loop.
  //
  // (1) Provider agreement: over the reference time, how often do the two BTC
  //     vocabularies name the same root, and how accurate is each arm on the
  //     unanimous and the split time separately. If the models agree on most
  //     of the time and are right there, an ensemble can only add on the rest.
  // (2) Bass tracker: over the reference time a pYIN note covers, does the
  //     heaviest tracked pitch class equal the reference *bass* (the lowest
  //     sounding note in the file)? Inversions can be no better than this.
  const rootOfSpans = (spans) => spans.map((span) => {
    const parsed = lib.parseChordSymbol(span.symbol);
    return parsed ? { start: span.start, end: span.end, root: parsed.root, bass: parsed.bass } : null;
  }).filter(Boolean);
  const overlapOf = (a, b) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const majminRoots = rootOfSpans(evidence.BTC_MAJMIN ?? []);
  const largeRoots = rootOfSpans(evidence.BTC_LARGE_VOCA ?? []);
  const ensembleRoots = rootOfSpans(ensembleResult ? ensembleResult.chords : []);
  const goldSpans = rootOfSpans(reference);
  const agreement = {
    unanimousSeconds: 0, splitSeconds: 0, uncoveredSeconds: 0,
    unanimous: { majminRight: 0, largeRight: 0, ensembleRight: 0, ensembleCovered: 0 },
    split: { majminRight: 0, largeRight: 0, ensembleRight: 0, ensembleCovered: 0 },
  };
  const bassDiagnostic = {
    referenceSeconds: 0, trackedSeconds: 0, bassRightSeconds: 0, rootHeardSeconds: 0,
    invertedReferenceSeconds: 0, invertedTrackedSeconds: 0, invertedBassRightSeconds: 0, invertedRootHeardSeconds: 0,
  };
  const step = 0.05;
  for (const gold of goldSpans) {
    for (let t = gold.start; t < gold.end - 1e-9; t += step) {
      const slice = { start: t, end: Math.min(gold.end, t + step) };
      const width = slice.end - slice.start;
      const pick = (list) => {
        let best = null;
        for (const item of list) {
          const shared = overlapOf(slice, item);
          if (shared > 0 && (!best || shared > best.shared)) best = { ...item, shared };
        }
        return best;
      };
      const majmin = pick(majminRoots);
      const large = pick(largeRoots);
      const ensemble = pick(ensembleRoots);
      if (!majmin || !large) {
        agreement.uncoveredSeconds += width;
      } else {
        const bucket = majmin.root === large.root ? agreement.unanimous : agreement.split;
        if (majmin.root === large.root) agreement.unanimousSeconds += width; else agreement.splitSeconds += width;
        if (majmin.root === gold.root) bucket.majminRight += width;
        if (large.root === gold.root) bucket.largeRight += width;
        if (ensemble) {
          bucket.ensembleCovered += width;
          if (ensemble.root === gold.root) bucket.ensembleRight += width;
        }
      }
      // Bass tracker against the reference bass.
      const inverted = gold.bass !== gold.root;
      bassDiagnostic.referenceSeconds += width;
      if (inverted) bassDiagnostic.invertedReferenceSeconds += width;
      const weights = new Array(12).fill(0);
      for (const note of evidence.BASS_PYIN ?? []) {
        const shared = overlapOf(slice, note);
        if (shared > 0) weights[lib.pc(note.pitch)] += shared * (note.confidence ?? 0.8);
      }
      const total = weights.reduce((sum, value) => sum + value, 0);
      if (total > 0) {
        const heaviest = weights.indexOf(Math.max(...weights));
        bassDiagnostic.trackedSeconds += width;
        if (heaviest === gold.bass) bassDiagnostic.bassRightSeconds += width;
        if (heaviest === gold.root) bassDiagnostic.rootHeardSeconds += width;
        if (inverted) {
          bassDiagnostic.invertedTrackedSeconds += width;
          if (heaviest === gold.bass) bassDiagnostic.invertedBassRightSeconds += width;
          if (heaviest === gold.root) bassDiagnostic.invertedRootHeardSeconds += width;
        }
      }
    }
  }
  const r4 = (value) => Number(value.toFixed(4));
  const share = (value, over) => (over > 0 ? r4(value / over) : null);
  const providerAgreement = {
    unanimousShare: share(agreement.unanimousSeconds, agreement.unanimousSeconds + agreement.splitSeconds),
    unanimousSeconds: r4(agreement.unanimousSeconds),
    splitSeconds: r4(agreement.splitSeconds),
    uncoveredSeconds: r4(agreement.uncoveredSeconds),
    onUnanimous: {
      majminRoot: share(agreement.unanimous.majminRight, agreement.unanimousSeconds),
      largeVocaRoot: share(agreement.unanimous.largeRight, agreement.unanimousSeconds),
      ensembleRoot: share(agreement.unanimous.ensembleRight, agreement.unanimousSeconds),
      ensembleCoverage: share(agreement.unanimous.ensembleCovered, agreement.unanimousSeconds),
    },
    onSplit: {
      majminRoot: share(agreement.split.majminRight, agreement.splitSeconds),
      largeVocaRoot: share(agreement.split.largeRight, agreement.splitSeconds),
      ensembleRoot: share(agreement.split.ensembleRight, agreement.splitSeconds),
      ensembleCoverage: share(agreement.split.ensembleCovered, agreement.splitSeconds),
    },
  };
  const bassTracker = {
    referenceSeconds: r4(bassDiagnostic.referenceSeconds),
    trackedShare: share(bassDiagnostic.trackedSeconds, bassDiagnostic.referenceSeconds),
    bassRightOnTracked: share(bassDiagnostic.bassRightSeconds, bassDiagnostic.trackedSeconds),
    rootHeardOnTracked: share(bassDiagnostic.rootHeardSeconds, bassDiagnostic.trackedSeconds),
    inverted: {
      referenceSeconds: r4(bassDiagnostic.invertedReferenceSeconds),
      trackedShare: share(bassDiagnostic.invertedTrackedSeconds, bassDiagnostic.invertedReferenceSeconds),
      bassRightOnTracked: share(bassDiagnostic.invertedBassRightSeconds, bassDiagnostic.invertedTrackedSeconds),
      rootHeardOnTracked: share(bassDiagnostic.invertedRootHeardSeconds, bassDiagnostic.invertedTrackedSeconds),
    },
  };

  // Key, per arm, against the file's own key signature.
  const keyComparisons = {};
  for (const arm of engineArms) {
    keyComparisons[arm] = lib.keyAccuracy([
      { reference: clip.gold.globalKey, estimate: arms[arm].key?.value ?? null },
    ]);
  }
  const chromaKey = evidence.KEY_KRUMHANSL
    ? `${evidence.KEY_KRUMHANSL.key} ${evidence.KEY_KRUMHANSL.scale}` : null;
  keyComparisons.CHROMA_KRUMHANSL_RAW = lib.keyAccuracy([
    { reference: clip.gold.globalKey, estimate: chromaKey },
  ]);

  perClip.push({
    id: clip.id,
    stem: clip.stem,
    title: clip.title,
    genres: clip.genres,
    durationSeconds: clip.durationSeconds,
    reference: {
      exactChords: clip.gold.chords.length,
      scoredShare: clip.gold.scoredShare,
      invertedSeconds: Number(clip.gold.chords
        .filter((chord) => chord.inversion !== 0)
        .reduce((sum, chord) => sum + (chord.end - chord.start), 0).toFixed(3)),
      key: clip.gold.globalKey,
      spans: reference,
    },
    abstentionValue,
    providerAgreement,
    bassTracker,
    providerTimings: evidence.timings ?? null,
    providerErrors: evidence.errors ?? null,
    arms,
    key: keyComparisons,
    ensembleSample: ensembleResult
      ? ensembleResult.chords.slice(0, 8).map((chord) => ({
          start: chord.start, end: chord.end, symbol: chord.symbol,
          inversion: chord.inversion, confidence: chord.confidence,
          romanNumeral: chord.romanNumeral,
          supporting: chord.evidence.supportingProviders,
        }))
      : null,
  });
  console.log(` scored ${clip.stem}`);
}

// ---------------------------------------------------------------------------
// 5. Aggregate and write
// ---------------------------------------------------------------------------

const weightedMean = (rows, pick, weight) => {
  let total = 0;
  let mass = 0;
  for (const row of rows) {
    const w = weight(row);
    const v = pick(row);
    if (!Number.isFinite(v) || !Number.isFinite(w) || w <= 0) continue;
    total += v * w;
    mass += w;
  }
  return mass > 0 ? Number((total / mass).toFixed(4)) : 0;
};

const armNames = [...new Set(perClip.flatMap((clip) => Object.keys(clip.arms)))];
const summary = {};
for (const arm of armNames) {
  const rows = perClip.filter((clip) => clip.arms[arm]);
  const seconds = (row) => row.arms[arm].chord.referenceSeconds;
  summary[arm] = {
    clips: rows.length,
    kind: rows[0]?.arms[arm].kind ?? "unknown",
    coverage: weightedMean(rows, (row) => row.arms[arm].chord.coverage, seconds),
    rootOnReference: weightedMean(rows, (row) => row.arms[arm].chord.root.onReference, seconds),
    rootOnCovered: weightedMean(rows, (row) => row.arms[arm].chord.root.onCovered, seconds),
    majMinOnReference: weightedMean(rows, (row) => row.arms[arm].chord.majMin.onReference, seconds),
    fullSymbolOnReference: weightedMean(rows, (row) => row.arms[arm].chord.fullSymbol.onReference, seconds),
    inversionBassOnReference: weightedMean(
      rows.filter((row) => row.arms[arm].chord.inversionBass.invertedReferenceSeconds > 0),
      (row) => row.arms[arm].chord.inversionBass.onReference,
      (row) => row.arms[arm].chord.inversionBass.invertedReferenceSeconds,
    ),
    falseInversionSeconds: Number(rows.reduce(
      (sum, row) => sum + row.arms[arm].chord.inversionBass.falseInversionSeconds, 0).toFixed(3)),
    boundaryF1: weightedMean(rows, (row) => row.arms[arm].boundary.f1, seconds),
    boundaryPrecision: weightedMean(rows, (row) => row.arms[arm].boundary.precision, seconds),
    boundaryRecall: weightedMean(rows, (row) => row.arms[arm].boundary.recall, seconds),
    keyStrict: rows.length && rows[0].key[arm]
      ? Number((rows.reduce((sum, row) => sum + (row.key[arm]?.strict ?? 0), 0) / rows.length).toFixed(4))
      : null,
    keyMirexWeighted: rows.length && rows[0].key[arm]
      ? Number((rows.reduce((sum, row) => sum + (row.key[arm]?.mirexWeighted ?? 0), 0) / rows.length).toFixed(4))
      : null,
    keyStatuses: rows.reduce((counts, row) => {
      const status = row.arms[arm].key?.status ?? "n/a";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {}),
  };
}
summary.CHROMA_KRUMHANSL_RAW = {
  clips: perClip.length,
  kind: "raw_provider_key_only",
  keyStrict: Number((perClip.reduce((sum, row) => sum + row.key.CHROMA_KRUMHANSL_RAW.strict, 0) / Math.max(1, perClip.length)).toFixed(4)),
  keyMirexWeighted: Number((perClip.reduce((sum, row) => sum + row.key.CHROMA_KRUMHANSL_RAW.mirexWeighted, 0) / Math.max(1, perClip.length)).toFixed(4)),
};

const abstentionValue = {
  ensembleSpokeSeconds: Number(perClip.reduce((sum, clip) => sum + clip.abstentionValue.ensembleSpokeSeconds, 0).toFixed(2)),
  ensembleRefusedSeconds: Number(perClip.reduce((sum, clip) => sum + clip.abstentionValue.ensembleRefusedSeconds, 0).toFixed(2)),
  providerRootWhereEnsembleSpoke: weightedMean(perClip, (clip) => clip.abstentionValue.providerRootWhereEnsembleSpoke, (clip) => clip.abstentionValue.ensembleSpokeSeconds),
  providerRootWhereEnsembleRefused: weightedMean(perClip, (clip) => clip.abstentionValue.providerRootWhereEnsembleRefused, (clip) => clip.abstentionValue.ensembleRefusedSeconds),
};

/** Seconds-weighted roll-up of the two diagnostics. */
const rollUp = (pick, weight) => weightedMean(perClip, pick, weight);
const providerAgreement = {
  unanimousShare: rollUp((clip) => clip.providerAgreement.unanimousShare,
    (clip) => clip.providerAgreement.unanimousSeconds + clip.providerAgreement.splitSeconds),
  unanimousSeconds: Number(perClip.reduce((sum, clip) => sum + clip.providerAgreement.unanimousSeconds, 0).toFixed(2)),
  splitSeconds: Number(perClip.reduce((sum, clip) => sum + clip.providerAgreement.splitSeconds, 0).toFixed(2)),
  onUnanimous: Object.fromEntries(["majminRoot", "largeVocaRoot", "ensembleRoot", "ensembleCoverage"].map((metric) => [
    metric, rollUp((clip) => clip.providerAgreement.onUnanimous[metric], (clip) => clip.providerAgreement.unanimousSeconds),
  ])),
  onSplit: Object.fromEntries(["majminRoot", "largeVocaRoot", "ensembleRoot", "ensembleCoverage"].map((metric) => [
    metric, rollUp((clip) => clip.providerAgreement.onSplit[metric], (clip) => clip.providerAgreement.splitSeconds),
  ])),
};
const bassTracker = {
  trackedShare: rollUp((clip) => clip.bassTracker.trackedShare, (clip) => clip.bassTracker.referenceSeconds),
  bassRightOnTracked: rollUp((clip) => clip.bassTracker.bassRightOnTracked,
    (clip) => clip.bassTracker.referenceSeconds * (clip.bassTracker.trackedShare ?? 0)),
  rootHeardOnTracked: rollUp((clip) => clip.bassTracker.rootHeardOnTracked,
    (clip) => clip.bassTracker.referenceSeconds * (clip.bassTracker.trackedShare ?? 0)),
  inverted: {
    referenceSeconds: Number(perClip.reduce((sum, clip) => sum + clip.bassTracker.inverted.referenceSeconds, 0).toFixed(2)),
    trackedShare: rollUp((clip) => clip.bassTracker.inverted.trackedShare, (clip) => clip.bassTracker.inverted.referenceSeconds),
    bassRightOnTracked: rollUp((clip) => clip.bassTracker.inverted.bassRightOnTracked,
      (clip) => clip.bassTracker.inverted.referenceSeconds * (clip.bassTracker.inverted.trackedShare ?? 0)),
    rootHeardOnTracked: rollUp((clip) => clip.bassTracker.inverted.rootHeardOnTracked,
      (clip) => clip.bassTracker.inverted.referenceSeconds * (clip.bassTracker.inverted.trackedShare ?? 0)),
  },
};

const byGenre = {};
for (const clip of perClip) {
  const genre = clip.genres[0] ?? "unlabelled";
  byGenre[genre] ??= { clips: 0, arms: {} };
  byGenre[genre].clips += 1;
  for (const arm of armNames) {
    if (!clip.arms[arm]) continue;
    byGenre[genre].arms[arm] ??= { rootOnReference: [], fullSymbolOnReference: [], keyStrict: [] };
    byGenre[genre].arms[arm].rootOnReference.push(clip.arms[arm].chord.root.onReference);
    byGenre[genre].arms[arm].fullSymbolOnReference.push(clip.arms[arm].chord.fullSymbol.onReference);
    byGenre[genre].arms[arm].keyStrict.push(clip.key[arm]?.strict ?? 0);
  }
}
for (const genre of Object.values(byGenre)) {
  for (const [arm, values] of Object.entries(genre.arms)) {
    genre.arms[arm] = Object.fromEntries(Object.entries(values).map(([metric, list]) => [
      metric,
      list.length ? Number((list.reduce((sum, value) => sum + value, 0) / list.length).toFixed(4)) : 0,
    ]));
  }
}

const bestSingle = armNames
  .filter((arm) => arm !== "ENSEMBLE")
  .reduce((best, arm) => (summary[arm].rootOnReference > (summary[best]?.rootOnReference ?? -1) ? arm : best),
    armNames.find((arm) => arm !== "ENSEMBLE"));

const evidenceOut = {
  title: "Harmony tournament — chord and key recognition, live (PR-85, ANALYSIS ENGINE wave, stream E)",
  ranAt: new Date().toISOString(),
  split,
  /** When the dev split is scored, the ids it was kept apart from. */
  heldOutTestIds: split === "dev" ? testWorks.map((work) => work.id) : null,
  engineOptions,
  providerEvidence: {
    path: providersPath.replace(repoRoot, "").replace(/\\/g, "/"),
    recordedAt: statSync(providersPath).mtime.toISOString(),
    reusedFromEarlierRun: skipModal,
  },
  corpus: {
    source: "PDMX",
    subset: "no_license_conflict ∩ our rights gate, n_tracks ≥ 2",
    csvRows: totalRows,
    ourAdmitted,
    subsetCandidates: candidates.length,
    scanned,
    parseFailed,
    missingFiles: missing,
    withExactReference: scored.length,
    chosen: clips.length,
    clipSeconds,
    selectionBias:
      "Works were kept only when their harmony is stated in sustained block chords, because that is " +
      "the only way the chord, its inversion and the key are exact rather than inferred. That excludes " +
      "arpeggiated, contrapuntal and heavily ornamented writing, which is harder for every system here. " +
      "The absolute numbers are therefore optimistic; the comparisons between arms are not.",
  },
  audio: {
    renderer: "REFERENCE_SYNTH_V1",
    sampleRate: 22050,
    bitDepth: 16,
    caveat:
      "Rendered audio: band-limited oscillators, one voice per note, no room, no mastering, no singer, " +
      "no distorted guitar. Every arm scores better here than it would on a record, and the gap is not small. " +
      "Read these as relative results on an easy corpus, not as accuracies to quote for real uploads.",
  },
  reference: {
    builder: "harmonyGold.ts / SYNTHETIC_EXACT/1.0",
    rule:
      "Per half-bar: the notes sounding through ≥50% of the span give a pitch-class set and a lowest pitch. " +
      "The span is admitted only when that set is exactly one chord template's tone set, and — when two " +
      "rotations spell the same set (C6 and Am7) — only when exactly one of them has its root in the bass. " +
      "Everything else is excluded, never guessed. Key comes from the MIDI key-signature meta event.",
  },
  arms: {
    BTC_MAJMIN_RAW: "BTC (ISMIR 2019), 25-class major/minor vocabulary, scored exactly as it answers.",
    BTC_LARGE_VOCA_RAW: "BTC, 170-class large vocabulary (sevenths, sixths, sus, dim, aug and slash bass).",
    CHROMA_ONLY: "The engine with librosa CQT chroma and nothing else — what a chroma class alone can say.",
    CHROMA_PLUS_BASS: "Chroma plus the pYIN bass track: the inversion question becomes answerable.",
    BTC_MAJMIN: "The engine over BTC major/minor candidates only.",
    BTC_LARGE_VOCA: "The engine over BTC large-vocabulary candidates only.",
    ENSEMBLE: "Everything fused: both BTC vocabularies, chroma, bass, and the key context.",
  },
  summary,
  bestSingleArm: bestSingle,
  ensembleGain: bestSingle ? {
    over: bestSingle,
    rootOnReference: Number((summary.ENSEMBLE.rootOnReference - summary[bestSingle].rootOnReference).toFixed(4)),
    majMinOnReference: Number((summary.ENSEMBLE.majMinOnReference - summary[bestSingle].majMinOnReference).toFixed(4)),
    fullSymbolOnReference: Number((summary.ENSEMBLE.fullSymbolOnReference - summary[bestSingle].fullSymbolOnReference).toFixed(4)),
    inversionBassOnReference: Number((summary.ENSEMBLE.inversionBassOnReference - summary[bestSingle].inversionBassOnReference).toFixed(4)),
    boundaryF1: Number((summary.ENSEMBLE.boundaryF1 - summary[bestSingle].boundaryF1).toFixed(4)),
  } : null,
  abstentionValue,
  providerAgreement,
  bassTracker,
  byGenre,
  clips: perClip,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidenceOut, null, 2)}\n`, "utf8");
console.log(`\nwrote ${outPath}`);
console.log(JSON.stringify(summary, null, 1));
