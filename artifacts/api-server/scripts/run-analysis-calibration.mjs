/**
 * Confidence calibration of the disagreement engine (Analysis Engine wave,
 * Stream I - PR-89).
 *
 *   node scripts/run-analysis-calibration.mjs [--per-family 12] [--sample-rate 22050] [--held-out 0.4]
 *        [--gold-root ../ws-an-h-gold] [--gold-manifest <gold-root>/docs/evidence/analysis-gold-v1-manifest.json]
 *        [--no-gold] [--out docs/evidence/analysis-calibration-live.json]
 *
 * Two corpora, one tier (SYNTHETIC_EXACT), never mixed with real audio:
 *
 *  - SYNTHETIC_EXACT_I (`analysisCalibrationCorpus.ts`): eight families, each
 *    clear or ambiguous by construction in one named way, rendered here with
 *    LISTENING_SYNTH_V2. Split train / held-out by a hash of the item id. The
 *    thresholds and weights are tuned on the train split only.
 *  - ANALYSIS_GOLD_V1 (Stream H), SYNTHETIC_EXACT items only: an untouched
 *    check set. Nothing is tuned on it; every item has one truth (its traps
 *    are hard cases, not ambiguities).
 *
 * For every item the platform's local analysers run on the rendered mix
 * (`LOCAL_SIGNAL_ANALYZER_V1`: onset-envelope tempo, spectral key, assumed
 * 4/4, energy sections) beside note-based observers over the score's own
 * notes (a transcription at its upper bound: `keyFromNotes` under the
 * production label TRANSCRIPTION_KEY_V1; calibration-only NOTE_ONSET_TEMPO_V0,
 * NOTE_ONSET_METER_V0, NOTE_NOVELTY_SECTIONS_V0, NOTE_CHORDS_V0). The engine
 * judges each domain; outcomes are scored against what the truth accepts.
 *
 * Nothing here is trained; nothing leaves the machine.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const perFamily = Number(flag("per-family", "12"));
const sampleRate = Number(flag("sample-rate", "22050"));
const heldOutShare = Number(flag("held-out", "0.4"));
const goldRoot = resolve(repoRoot, flag("gold-root", "../ws-an-h-gold"));
const goldManifestPath = resolve(repoRoot, flag("gold-manifest", join(goldRoot, "docs/evidence/analysis-gold-v1-manifest.json")));
const useGold = !has("no-gold") && existsSync(goldManifestPath);
const outPath = resolve(repoRoot, flag("out", "docs/evidence/analysis-calibration-live.json"));

const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const round = (value, places = 4) => (value === null || value === undefined ? null : Number(Number(value).toFixed(places)));

// --- bundle the TS once -----------------------------------------------------
const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `analysis-calibration-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./analysis-calibration-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(pathToFileURL(bundlePath).href);
await rm(bundlePath, { force: true });

const LOCAL = lib.LOCAL_STRUCTURE_PROVIDER;
const NOTE_CHORDS_PROVIDER = "NOTE_CHORDS_V0";
const DOMAINS = ["tempo", "meter", "key", "sections", "chords"];
const PROVIDERS_OF = {
  tempo: [LOCAL, lib.NOTE_ONSET_TEMPO_PROVIDER],
  meter: [LOCAL, lib.NOTE_ONSET_METER_PROVIDER],
  key: [LOCAL, lib.ORACLE_TRANSCRIPTION_KEY_PROVIDER],
  sections: [LOCAL, lib.NOTE_NOVELTY_SECTIONS_PROVIDER],
  chords: [NOTE_CHORDS_PROVIDER],
};

// --- observers ----------------------------------------------------------------

function monoOf(left, right) {
  const mono = new Float32Array(left.length);
  for (let i = 0; i < mono.length; i += 1) mono[i] = (left[i] + right[i]) / 2;
  return mono;
}

const nearestBar = (bars, time) => {
  let best = bars[0]; let distance = Infinity;
  for (const bar of bars) {
    const d = Math.abs(bar.start - time);
    if (d < distance) { distance = d; best = bar; }
  }
  return best ? best.bar : 1;
};

/**
 * Run every observer over one rendered item. `notes` are the score's own
 * notes ({ start, end, pitch, velocity, percussion }); `bars` the true bar
 * spans (needed to express section cuts and chords per bar).
 */
function observe({ mono, rate, durationSeconds, notes, bars }) {
  const pitched = notes.filter((note) => !note.percussion && Number.isFinite(note.pitch));
  const localTempo = lib.detectTempoEvidence(mono, rate);
  const noteTempo = lib.tempoFromOnsets(notes.map((note) => note.start));
  const localKey = lib.detectKeyEvidence(mono, rate);
  const noteKey = pitched.length ? lib.keyFromNotes(pitched.map((note) => ({ start: note.start, end: note.end, pitch: note.pitch }))) : null;
  const noteMeter = lib.meterFromOnsets(notes);
  const localStructure = localTempo ? lib.deriveLocalStructure({ energy: lib.energyCurveOf(mono), durationSeconds, bpm: localTempo.bpm }) : null;
  // Local sections are cut on the local analyser's own grid (its tempo, an
  // assumed 4/4); each cut is placed in time and then on the true bar grid.
  const localSections = localStructure
    ? [...new Set(localStructure.sections.map((section) => {
        const localBar = localStructure.bars[Math.max(0, Math.min(localStructure.bars.length - 1, section.startBar - 1))];
        return nearestBar(bars, localBar ? localBar.start : 0);
      }))].sort((a, b) => a - b)
    : null;
  const noteSections = lib.sectionsFromNotes(notes, bars);
  const noteChords = pitched.length ? lib.estimateChords(pitched.map((note) => ({ start: note.start, end: note.end, pitch: note.pitch })), bars) : [];
  return {
    tempo: [
      localTempo ? { provider: LOCAL, value: localTempo.bpm, confidence: localTempo.confidence } : null,
      noteTempo ? { provider: lib.NOTE_ONSET_TEMPO_PROVIDER, value: noteTempo.bpm, confidence: noteTempo.confidence } : null,
    ].filter(Boolean),
    meter: [
      { provider: LOCAL, value: lib.ASSUMED_METER, confidence: lib.ASSUMED_METER_CONFIDENCE },
      noteMeter ? { provider: lib.NOTE_ONSET_METER_PROVIDER, value: noteMeter.meter, confidence: noteMeter.confidence } : null,
    ].filter(Boolean),
    key: [
      localKey ? { provider: LOCAL, value: localKey.key, confidence: localKey.confidence } : null,
      noteKey ? { provider: lib.ORACLE_TRANSCRIPTION_KEY_PROVIDER, value: noteKey.key, confidence: noteKey.confidence } : null,
    ].filter(Boolean),
    sections: [
      localSections ? { provider: LOCAL, boundaries: localSections, confidence: localStructure.confidence } : null,
      { provider: lib.NOTE_NOVELTY_SECTIONS_PROVIDER, boundaries: noteSections.boundaries, confidence: noteSections.confidence },
    ].filter(Boolean),
    chords: noteChords.map((chord) => ({ bar: chord.bar, observations: [{ provider: NOTE_CHORDS_PROVIDER, value: chord.symbol, confidence: chord.confidence }] })),
    raw: { localTempo, noteTempo, localKey, noteKey, noteMeter, noteSectionsNovelty: noteSections.novelty },
  };
}

const chordMatches = (a, b) => {
  const left = lib.parseChordLabel(String(a));
  const right = lib.parseChordLabel(String(b));
  return !!left && !!right && left.root === right.root && left.quality === right.quality;
};

// --- SYNTHETIC_EXACT_I ----------------------------------------------------------

log(`rendering SYNTHETIC_EXACT_I (${perFamily} items per family, ${sampleRate} Hz)...`);
const synthetic = [];
{
  const corpus = lib.buildCorpus(perFamily);
  const started = performance.now();
  for (const item of corpus) {
    const mix = lib.renderStereoMix(item.midi, { sampleRate });
    const mono = monoOf(mix.left, mix.right);
    const observed = observe({ mono, rate: sampleRate, durationSeconds: mix.durationSeconds, notes: item.truth.notes, bars: item.truth.bars });
    synthetic.push({
      id: item.id, family: item.family, corpus: "SYNTHETIC_EXACT_I",
      truth: {
        tempo: { acceptable: item.acceptable.tempo, ambiguousByConstruction: item.ambiguous.tempo },
        meter: { acceptable: item.acceptable.meter, ambiguousByConstruction: item.ambiguous.meter },
        key: { acceptable: item.acceptable.key, ambiguousByConstruction: item.ambiguous.key },
        sections: { acceptable: [item.truth.sectionStartBars.join(",")], ambiguousByConstruction: item.ambiguous.sections },
        chords: item.truth.chords,
      },
      observed,
    });
  }
  log(` ${synthetic.length} items in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

// --- ANALYSIS_GOLD_V1 (SYNTHETIC_EXACT tier only) ---------------------------------

const gold = [];
let goldMeta = null;
if (useGold) {
  const manifest = JSON.parse(readFileSync(goldManifestPath, "utf8"));
  const items = manifest.items.filter((item) => item.tier === "SYNTHETIC_EXACT" && item.audio?.mix?.path);
  goldMeta = { version: manifest.version, builtAt: manifest.builtAt, renderer: manifest.renderer, manifest: goldManifestPath.replace(/\\/g, "/"), itemsInTier: items.length };
  log(`reading ${manifest.version}: ${items.length} SYNTHETIC_EXACT items from ${goldRoot}`);
  const started = performance.now();
  for (const item of items) {
    const mixPath = resolve(goldRoot, item.audio.mix.path);
    const truthPath = join(dirname(mixPath), "truth.json");
    if (!existsSync(mixPath) || !existsSync(truthPath)) { log(`  skip ${item.id}: files missing`); continue; }
    const truth = JSON.parse(readFileSync(truthPath, "utf8"));
    const wav = lib.decodeWavPcm16(readFileSync(mixPath));
    const mono = monoOf(wav.left, wav.right);
    const durationSeconds = mono.length / wav.sampleRate;
    const downbeats = Array.isArray(truth.downbeats) ? truth.downbeats : [];
    const bars = downbeats.map((start, index) => ({ bar: index + 1, start, end: downbeats[index + 1] ?? durationSeconds }));
    const notes = (truth.notes?.tracks ?? []).flatMap((track) => track.notes.map(([start, duration, pitch, velocity]) => ({
      start, end: start + duration, pitch, velocity, percussion: !!track.percussion,
    })));
    const coverage = item.coverage ?? {};
    const observed = bars.length ? observe({ mono, rate: wav.sampleRate, durationSeconds, notes, bars }) : null;
    const tempoTruth = coverage.tempo === "EXACT" && truth.tempo?.constant && truth.tempo.bpm
      ? { acceptable: lib.acceptableTempos({ bpm: truth.tempo.bpm, quarterBpm: truth.tempo.quarterBpm }), ambiguousByConstruction: false } : null;
    const meterTruth = coverage.metre === "EXACT" && truth.metre && (truth.metre.changes?.length ?? 1) <= 1
      ? { acceptable: [`${truth.metre.numerator}/${truth.metre.denominator}`], ambiguousByConstruction: false } : null;
    const keyTruth = coverage.key === "EXACT" && truth.key?.tonic
      ? { acceptable: [`${truth.key.tonic} ${truth.key.mode}`], ambiguousByConstruction: false } : null;
    const sectionsTruth = coverage.sections === "EXACT" && Array.isArray(truth.sections) && truth.sections.length && bars.length
      ? { acceptable: [[...new Set(truth.sections.map((section) => nearestBar(bars, section.start)))].sort((a, b) => a - b).join(",")], ambiguousByConstruction: false } : null;
    const chordsTruth = coverage.chords === "EXACT" && Array.isArray(truth.chords) && bars.length
      ? bars.map((bar) => {
          let best = null; let overlap = 0;
          for (const chord of truth.chords) {
            const o = Math.min(bar.end, chord.end) - Math.max(bar.start, chord.start);
            if (o > overlap) { overlap = o; best = chord; }
          }
          return best && best.root ? { bar: bar.bar, symbol: `${best.root}${best.quality === "min" ? "m" : best.quality === "maj" ? "" : best.quality}` } : null;
        }).filter(Boolean)
      : null;
    gold.push({
      id: item.id, family: item.genreFamily, corpus: "ANALYSIS_GOLD_V1", traps: truth.tempo?.traps ?? [],
      truth: { tempo: tempoTruth, meter: meterTruth, key: keyTruth, sections: sectionsTruth, chords: chordsTruth },
      observed,
    });
  }
  log(` ${gold.length} gold items read in ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

// --- calibration items per domain ----------------------------------------------

function calibrationItems(records, domain) {
  const out = [];
  for (const record of records) {
    if (!record.observed) continue;
    const truth = record.truth[domain];
    if (!truth) continue;
    if (domain === "chords") {
      const byBar = new Map(record.observed.chords.map((bar) => [bar.bar, bar.observations]));
      for (const chord of truth) {
        const observations = byBar.get(chord.bar);
        if (!observations?.length) continue;
        out.push({ id: `${record.id}#${chord.bar}`, itemId: record.id, family: record.family, domain: "chords", observations, truth: { acceptable: [chord.symbol], ambiguousByConstruction: false } });
      }
      continue;
    }
    if (domain === "sections") {
      out.push({ id: record.id, itemId: record.id, family: record.family, domain, observations: [], sectionObservations: record.observed.sections, truth });
      continue;
    }
    out.push({ id: record.id, itemId: record.id, family: record.family, domain, observations: record.observed[domain], truth });
  }
  return out;
}

const matches = (domain, value, truth) => (domain === "chords" ? chordMatches(value, truth.acceptable[0]) : lib.readingMatches(domain, value, truth));

const outcomeOf = (domain, verdict, truth) => {
  if (verdict.status === "unknown") return "unknown";
  if (verdict.status === "contested") return "contested";
  return verdict.value !== null && matches(domain, verdict.value, truth) ? "resolved_correct" : "resolved_wrong";
};

function evaluate(items, point) {
  const scored = items.map((item) => {
    const verdict = lib.judgeItem(item, point);
    return { id: item.id, itemId: item.itemId, family: item.family, outcome: outcomeOf(item.domain, verdict, item.truth), ambiguousByConstruction: item.truth.ambiguousByConstruction, verdict };
  });
  return { metrics: lib.scoreEngine(scored), scored };
}

/** Grid search on the train split with the chord-aware outcome above (same tie rules as `tuneEngine`). */
function tune(trainItems, grid, defaults) {
  const providers = Object.keys(grid.weights);
  const combos = [[]];
  for (const list of [grid.contestFloor, grid.contestRatio, ...providers.map((provider) => grid.weights[provider])]) {
    const next = [];
    for (const prefix of combos) for (const value of list) next.push([...prefix, value]);
    combos.length = 0; combos.push(...next);
  }
  const defaultUtility = evaluate(trainItems, defaults).metrics.utility;
  const distance = (point) => Math.abs(point.thresholds.contestFloor - defaults.thresholds.contestFloor) + Math.abs(point.thresholds.contestRatio - defaults.thresholds.contestRatio) +
    providers.reduce((sum, provider) => sum + Math.abs((point.weights[provider] ?? 0) - (defaults.weights[provider] ?? 0)), 0);
  const changed = (point) => (point.thresholds.contestFloor !== defaults.thresholds.contestFloor ? 1 : 0) + (point.thresholds.contestRatio !== defaults.thresholds.contestRatio ? 1 : 0) +
    providers.filter((provider) => point.weights[provider] !== defaults.weights[provider]).length;
  let best = defaults; let bestUtility = defaultUtility; let ties = 1;
  for (const combo of combos) {
    const [contestFloor, contestRatio, ...weightValues] = combo;
    const point = { thresholds: { ...defaults.thresholds, contestFloor, contestRatio }, weights: Object.fromEntries(providers.map((provider, index) => [provider, weightValues[index]])) };
    const utility = evaluate(trainItems, point).metrics.utility;
    if (utility > bestUtility + 1e-9) { best = point; bestUtility = utility; ties = 1; }
    else if (Math.abs(utility - bestUtility) <= 1e-9) {
      ties += 1;
      if (changed(point) < changed(best) || (changed(point) === changed(best) && distance(point) < distance(best))) best = point;
    }
  }
  return { best, bestUtility: round(bestUtility), defaultUtility: round(defaultUtility), trials: combos.length, ties, improved: bestUtility > defaultUtility + 1e-9 };
}

const providerDiagram = (items, provider, domain) => {
  const samples = [];
  for (const item of items) {
    const observations = domain === "sections" ? item.sectionObservations : item.observations;
    for (const observation of observations ?? []) {
      if (observation.provider !== provider || !Number.isFinite(observation.confidence)) continue;
      const value = domain === "sections" ? observation.boundaries.join(",") : observation.value;
      samples.push({ confidence: observation.confidence, correct: matches(domain, value, item.truth) });
    }
  }
  return { ...lib.reliabilityDiagram(samples, 10), bins: lib.reliabilityDiagram(samples, 10).bins.filter((bin) => bin.count) };
};

const engineDiagram = (scored) => {
  const samples = scored
    .filter((entry) => entry.verdict.status === "detected" || entry.verdict.status === "low_confidence")
    .map((entry) => ({ confidence: entry.verdict.confidence ?? 0, correct: entry.outcome === "resolved_correct" }));
  const diagram = lib.reliabilityDiagram(samples, 10);
  return { ...diagram, bins: diagram.bins.filter((bin) => bin.count) };
};

const byFamily = (scored) => {
  const families = {};
  for (const entry of scored) {
    const family = families[entry.family] ??= { items: 0, resolved_correct: 0, resolved_wrong: 0, contested: 0, unknown: 0 };
    family.items += 1; family[entry.outcome] += 1;
  }
  return families;
};

const halfDoubleShare = (items, provider) => {
  let related = 0; let total = 0;
  for (const item of items) {
    const observation = item.observations.find((entry) => entry.provider === provider);
    if (!observation) continue;
    total += 1;
    if (!matches("tempo", observation.value, item.truth) && lib.metricallyRelated(Number(observation.value), item.truth.acceptable.map(Number))) related += 1;
  }
  return { total, metricallyRelatedButWrong: related, share: total ? round(related / total) : null };
};

// --- run --------------------------------------------------------------------------

const split = lib.splitByHash(synthetic.map((item) => item.id), heldOutShare, lib.CORPUS_VERSION);
const trainIds = new Set(split.train);
const grid = {
  contestFloor: [0.1, 0.15, 0.2, 0.25, 0.3],
  contestRatio: [0.3, 0.4, 0.5, 0.6, 0.7],
  weightValues: [0.2, 0.35, 0.5, 0.65, 0.8],
};
const report = { domains: {} };
const contestExamples = {};

for (const domain of DOMAINS) {
  const providers = PROVIDERS_OF[domain];
  const all = calibrationItems(synthetic, domain);
  const train = all.filter((item) => trainIds.has(item.itemId));
  const heldOut = all.filter((item) => !trainIds.has(item.itemId));
  const check = calibrationItems(gold, domain);
  const defaults = lib.DEFAULT_ENGINE_POINT(domain, providers);
  const before = { train: evaluate(train, defaults), heldOut: evaluate(heldOut, defaults), gold: evaluate(check, defaults) };
  const tuning = tune(train, { contestFloor: grid.contestFloor, contestRatio: grid.contestRatio, weights: Object.fromEntries(providers.map((provider) => [provider, grid.weightValues])) }, defaults);
  const after = { train: evaluate(train, tuning.best), heldOut: evaluate(heldOut, tuning.best), gold: evaluate(check, tuning.best) };
  contestExamples[domain] = before.heldOut.scored.concat(before.gold.scored)
    .filter((entry) => entry.outcome === "contested")
    .slice(0, 6)
    .map((entry) => ({ id: entry.id, family: entry.family, ambiguousByConstruction: entry.ambiguousByConstruction, candidates: entry.verdict.candidates.map((candidate) => ({ value: candidate.value, score: candidate.score, providers: candidate.providers, relationToLeader: candidate.relationToLeader })), relation: entry.verdict.relation, whatWouldSettleIt: entry.verdict.whatWouldSettleIt }));
  report.domains[domain] = {
    providers,
    items: { train: train.length, heldOut: heldOut.length, gold: check.length },
    defaults: { point: defaults, train: before.train.metrics, heldOut: before.heldOut.metrics, gold: before.gold.metrics },
    tuning: { grid: { contestFloor: grid.contestFloor, contestRatio: grid.contestRatio, weights: grid.weightValues, fixed: { corroborationMargin: defaults.thresholds.corroborationMargin, singleObservationFloor: defaults.thresholds.singleObservationFloor } }, ...tuning },
    tuned: { train: after.train.metrics, heldOut: after.heldOut.metrics, gold: after.gold.metrics },
    reliability: {
      observers: Object.fromEntries(providers.map((provider) => [provider, providerDiagram(all.concat(check), provider, domain)])),
      engineDefaultsHeldOut: engineDiagram(before.heldOut.scored),
      engineTunedHeldOut: engineDiagram(after.heldOut.scored),
      engineDefaultsGold: engineDiagram(before.gold.scored),
      engineTunedGold: engineDiagram(after.gold.scored),
    },
    byFamily: { defaultsHeldOut: byFamily(before.heldOut.scored), tunedHeldOut: byFamily(after.heldOut.scored), defaultsGold: byFamily(before.gold.scored), tunedGold: byFamily(after.gold.scored) },
    ...(domain === "tempo" ? { halfDouble: Object.fromEntries(providers.map((provider) => [provider, { synthetic: halfDoubleShare(all, provider), gold: halfDoubleShare(check, provider) }])) } : {}),
  };
  const m = (metrics) => `wrong ${metrics.resolvedWrong}/${metrics.items} contest amb ${metrics.contestRateOnAmbiguous ?? "-"} clear ${metrics.contestRateOnClear ?? "-"} util ${metrics.utility}`;
  log(`${domain.padEnd(8)} held-out before: ${m(before.heldOut.metrics)} | after: ${m(after.heldOut.metrics)} | gold before: ${m(before.gold.metrics)} | after: ${m(after.gold.metrics)} | tuned ${JSON.stringify(tuning.best)} improved=${tuning.improved} ties=${tuning.ties}`);
}

// --- per-item rows (compact) -------------------------------------------------------

const rows = [...synthetic, ...gold].map((record) => ({
  id: record.id, corpus: record.corpus, family: record.family, split: record.corpus === "SYNTHETIC_EXACT_I" ? (trainIds.has(record.id) ? "train" : "heldOut") : "check",
  ...(record.traps?.length ? { traps: record.traps } : {}),
  truth: Object.fromEntries(DOMAINS.filter((domain) => domain !== "chords").map((domain) => [domain, record.truth[domain]?.acceptable ?? null])),
  observations: record.observed ? Object.fromEntries(DOMAINS.filter((domain) => domain !== "chords").map((domain) => [domain, record.observed[domain].map((entry) => ({ provider: entry.provider, value: entry.boundaries ? entry.boundaries.join(",") : entry.value, confidence: entry.confidence }))])) : null,
  chordBars: record.observed ? record.observed.chords.length : 0,
  verdictsUnderDefaults: record.observed ? Object.fromEntries(DOMAINS.filter((domain) => domain !== "chords" && record.truth[domain]).map((domain) => {
    const item = calibrationItems([record], domain)[0];
    const verdict = lib.judgeItem(item, lib.DEFAULT_ENGINE_POINT(domain, PROVIDERS_OF[domain]));
    return [domain, { status: verdict.status, value: verdict.value, confidence: verdict.confidence, relation: verdict.relation, outcome: outcomeOf(domain, verdict, item.truth) }];
  })) : null,
}));

const evidence = {
  id: "analysis-calibration-live",
  pr: "PR-89",
  recordedAt: new Date().toISOString(),
  question: "Are the analysers' confidences honest, does the disagreement engine contest what is ambiguous and not what is clear, and which thresholds and weights does the train split ask for - out of sample?",
  engine: { version: lib.DISAGREEMENT_ENGINE_VERSION, defaults: lib.DEFAULT_DISAGREEMENT_THRESHOLDS, utility: { resolvedCorrect: 1, resolvedWrong: -3, contestedAmbiguous: 1, contestedClear: -0.5, unknown: 0 } },
  corpora: {
    synthetic: { version: lib.CORPUS_VERSION, tier: "SYNTHETIC_EXACT", families: lib.CORPUS_FAMILIES, perFamily, items: synthetic.length, barsPerItem: lib.BARS_PER_ITEM, renderer: `${lib.LISTENING_RENDERER_V2}@${lib.LISTENING_RENDERER_V2_VERSION}`, sampleRate, split: { salt: lib.CORPUS_VERSION, heldOutShare, train: split.train.length, heldOut: split.heldOut.length } },
    gold: goldMeta ? { ...goldMeta, tier: "SYNTHETIC_EXACT", itemsRead: gold.length, role: "check set: nothing tuned on it; every item has one truth", audioRoot: goldRoot.replace(/\\/g, "/") } : null,
  },
  observers: {
    [LOCAL]: "production: onset-envelope tempo (60-180), Goertzel spectral key, assumed 4/4 at 0.3, energy-curve sections - all over the rendered mix",
    [lib.ORACLE_TRANSCRIPTION_KEY_PROVIDER]: "production label, oracle input: keyFromNotes over the score's own notes (a transcription at its upper bound, not Basic Pitch output)",
    [lib.NOTE_ONSET_TEMPO_PROVIDER]: "calibration-only: dominant inter-onset interval of the score's notes, folded to 60-180",
    [lib.NOTE_ONSET_METER_PROVIDER]: "calibration-only: bar length from the accent autocorrelation of velocity-weighted onsets on the tatum grid",
    [lib.NOTE_NOVELTY_SECTIONS_PROVIDER]: "calibration-only: cuts where bar-level density / velocity / pitch-class features move",
    [NOTE_CHORDS_PROVIDER]: "calibration-only: estimateChords over the score's notes per true bar (one observer: the chord contest cannot be measured here)",
  },
  domains: report.domains,
  contestExamples,
  items: rows,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`.replace(/\r\n/g, "\n"));
log(`wrote ${outPath}`);
