/**
 * The harmony engine on one real upload (PR-85, stream E).
 *
 *   node scripts/harmony-real-upload.mjs --providers <providers.json> --stem <wav stem>
 *        [--key-observations <json>] [--out docs/evidence/harmony-real-upload-live.json]
 *
 * `providers.json` is what `services/harmony-acr-worker` `::batch` wrote for a
 * directory holding the upload's decoded WAV. `--key-observations` is a JSON
 * list of `{ provider, key, confidence, note }` taken from the platform's own
 * Song Model for the same source, so the engine reconciles the *same* split
 * the producer saw, plus what the worker heard. No audio, no lease token and
 * no secret is written to the evidence; the file is named by its source id.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `harmony-real-upload-${process.pid}.mjs`);
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
const providersPath = resolve(repoRoot, flag("providers", ".tmp-harmony/real/providers.json"));
const stem = flag("stem", null);
const keyObservationsPath = flag("key-observations", null);
const outPath = resolve(repoRoot, flag("out", "docs/evidence/harmony-real-upload-live.json"));
if (!stem) throw new Error("--stem is required");
if (!existsSync(providersPath)) throw new Error(`no provider evidence at ${providersPath}`);

const evidence = JSON.parse(readFileSync(providersPath, "utf8"))[stem];
if (!evidence) throw new Error(`no evidence for ${stem}`);
const platformKeyObservations = keyObservationsPath
  ? JSON.parse(readFileSync(resolve(repoRoot, keyObservationsPath), "utf8"))
  : [];

/** Duration-weighted pitch-class weights implied by a chord sequence. */
function chordWeights(spans) {
  const weights = new Array(12).fill(0);
  for (const span of spans) {
    const tones = lib.chordPitchClassesOf(span.symbol);
    if (!tones) continue;
    const length = span.end - span.start;
    for (const tone of tones) weights[tone] += length;
    weights[tones[0]] += length * 0.5;
  }
  return weights;
}

const keyObservations = [...platformKeyObservations];
if (evidence.KEY_KRUMHANSL) {
  keyObservations.push({
    provider: "CHROMA",
    key: `${evidence.KEY_KRUMHANSL.key} ${evidence.KEY_KRUMHANSL.scale}`,
    confidence: evidence.KEY_KRUMHANSL.confidence,
    pitchClassEvidence: evidence.KEY_KRUMHANSL.hpcp,
    note: "Krumhansl-Kessler over librosa CQT chroma of the whole upload (harmony-acr-worker)",
  });
}
const btcSpans = evidence.BTC_LARGE_VOCA ?? [];
const btcKey = btcSpans.length ? lib.estimateWindowKey(chordWeights(btcSpans)) : null;
if (btcKey) {
  keyObservations.push({
    provider: "SHEETSAGE",
    key: btcKey.key,
    confidence: btcKey.confidence,
    note: "Krumhansl-Kessler over BTC's own large-vocabulary chord sequence",
  });
}

const input = {
  durationSeconds: evidence.durationSeconds,
  beats: evidence.BEATS?.beats ?? [],
  chroma: evidence.CHROMA_CQT ? [{ provider: "CHROMA", frames: evidence.CHROMA_CQT }] : [],
  bass: (evidence.BASS_PYIN ?? []).map((note) => ({ ...note, provider: "BASS" })),
  chordSources: [
    { provider: "CHROMA", events: evidence.BTC_MAJMIN ?? [], confidence: 0.85 },
    { provider: "SHEETSAGE", events: btcSpans, confidence: 0.9 },
  ],
  keyObservations,
};
const result = lib.runHarmonyEngine(input);

const secondsBySymbol = new Map();
for (const chord of result.chords) {
  secondsBySymbol.set(chord.symbol, (secondsBySymbol.get(chord.symbol) ?? 0) + (chord.end - chord.start));
}
const topChords = [...secondsBySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([symbol, seconds]) => ({ symbol, seconds: Number(seconds.toFixed(2)) }));
const rawTop = (spans) => {
  const map = new Map();
  for (const span of spans) {
    if (!span.symbol || span.symbol === "N") continue;
    map.set(span.symbol, (map.get(span.symbol) ?? 0) + (span.end - span.start));
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([symbol, seconds]) => ({ symbol, seconds: Number(seconds.toFixed(2)) }));
};

/** How the two contested keys fare against the engine's own timeline. */
const timelineSecondsByKey = new Map();
for (const segment of result.key.segments) {
  timelineSecondsByKey.set(segment.key, (timelineSecondsByKey.get(segment.key) ?? 0) + (segment.end - segment.start));
}
const timelineShare = [...timelineSecondsByKey.entries()].sort((a, b) => b[1] - a[1])
  .map(([key, seconds]) => ({ key, seconds: Number(seconds.toFixed(2)), share: Number((seconds / evidence.durationSeconds).toFixed(3)) }));

const roman = new Map();
for (const chord of result.chords) {
  if (!chord.romanNumeral) continue;
  roman.set(chord.romanNumeral, (roman.get(chord.romanNumeral) ?? 0) + (chord.end - chord.start));
}

const out = {
  title: "Harmony engine on the owner's real upload (PR-85, ANALYSIS ENGINE wave, stream E)",
  ranAt: new Date().toISOString(),
  source: {
    stem,
    durationSeconds: evidence.durationSeconds,
    sampleRate: evidence.sampleRate,
    decodedAs: "mono 22.05 kHz 16-bit WAV from the platform's analysis proxy (FLAC)",
  },
  providerEvidence: {
    path: providersPath.replace(repoRoot, "").replace(/\\/g, "/"),
    recordedAt: statSync(providersPath).mtime.toISOString(),
    versions: evidence.versions ?? null,
    timings: evidence.timings ?? null,
    errors: evidence.errors ?? null,
    counts: {
      btcMajMin: (evidence.BTC_MAJMIN ?? []).length,
      btcLargeVoca: btcSpans.length,
      chromaFrames: (evidence.CHROMA_CQT ?? []).length,
      bassNotes: (evidence.BASS_PYIN ?? []).length,
      beats: (evidence.BEATS?.beats ?? []).length,
      tempoBpm: evidence.BEATS?.tempoBpm ?? null,
    },
    rawTopChords: { BTC_MAJMIN: rawTop(evidence.BTC_MAJMIN ?? []), BTC_LARGE_VOCA: rawTop(btcSpans) },
    workerKey: evidence.KEY_KRUMHANSL
      ? { key: evidence.KEY_KRUMHANSL.key, scale: evidence.KEY_KRUMHANSL.scale, confidence: evidence.KEY_KRUMHANSL.confidence, margin: evidence.KEY_KRUMHANSL.margin }
      : null,
    btcDerivedKey: btcKey ? { key: btcKey.key, confidence: btcKey.confidence, margin: btcKey.margin } : null,
  },
  keyObservationsGiven: keyObservations.map((item) => ({ provider: item.provider, key: item.key, confidence: item.confidence, note: item.note ?? null })),
  engine: {
    version: result.version,
    providersUsed: result.providersUsed,
    coverage: result.coverage,
    chords: result.chords.length,
    abstained: result.abstainedSegments.length,
    smoothing: result.smoothing,
    topChords,
    romanNumerals: [...roman.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([numeral, seconds]) => ({ numeral, seconds: Number(seconds.toFixed(2)) })),
    inversions: {
      chordsWithSlash: result.chords.filter((chord) => chord.inversion !== 0).length,
      secondsWithSlash: Number(result.chords.filter((chord) => chord.inversion !== 0)
        .reduce((sum, chord) => sum + (chord.end - chord.start), 0).toFixed(2)),
      bassUnknownSeconds: Number(result.chords.filter((chord) => chord.evidence.bassUnknown)
        .reduce((sum, chord) => sum + (chord.end - chord.start), 0).toFixed(2)),
    },
    key: {
      global: result.key.global,
      window: result.key.window,
      timelineShare,
      segments: result.key.segments.map((segment) => ({
        start: segment.start, end: segment.end, key: segment.key, confidence: segment.confidence, margin: segment.margin, runnerUp: segment.runnerUp,
      })),
      changes: result.key.changes,
    },
    firstChords: result.chords.slice(0, 16).map((chord) => ({
      start: chord.start, end: chord.end, symbol: chord.symbol, confidence: chord.confidence, margin: chord.margin,
      romanNumeral: chord.romanNumeral, supporting: chord.evidence.supportingProviders,
    })),
    abstentionReasons: (() => {
      const counts = new Map();
      for (const item of result.abstainedSegments) {
        const kind = item.reason.replace(/[\d.]+/g, "N").replace(/^root [A-G][#b]? \(as [^)]*\) beat root [A-G][#b]?/, "root X (as …) beat root Y");
        const entry = counts.get(kind) ?? { count: 0, seconds: 0 };
        entry.count += 1;
        entry.seconds += item.end - item.start;
        counts.set(kind, entry);
      }
      return [...counts.entries()].map(([reason, entry]) => ({ reason, count: entry.count, seconds: Number(entry.seconds.toFixed(2)) }))
        .sort((a, b) => b.seconds - a.seconds);
    })(),
  },
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, "utf8");
console.log(`wrote ${outPath}`);
console.log(JSON.stringify({ key: out.engine.key.global.status, message: out.engine.key.global.message, timelineShare, topChords: topChords.slice(0, 6), coverage: result.coverage }, null, 1));
