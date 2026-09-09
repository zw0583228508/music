/**
 * The rhythm tournament: build the condition-labelled corpus, render it, run
 * every live tracker on it, score them, and reconcile them.
 *
 *   node rhythm-tournament.test.mjs build     # corpus + renders, offline
 *   node rhythm-tournament.test.mjs run       # calls the Modal worker
 *   node rhythm-tournament.test.mjs report    # scores + evidence JSON
 *
 * Split into phases on purpose: rendering forty clips takes minutes and a
 * worker timeout in the middle of it should not cost that work.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parseMidiFile } from "../src/lib/midiFile";
import { encodeWavPcm, renderStem } from "../src/lib/referenceRenderWorker";
import {
  CONDITION_SPECS,
  RHYTHM_CONDITIONS,
  accompanimentNotes,
  buildRhythmCase,
  eligibleFor,
  metricalGrid,
  profileSource,
  type RhythmCase,
  type RhythmCondition,
} from "../src/lib/rhythmCorpus";
import {
  reconcileRhythm,
  tempoOnlyObservation,
  type ProviderRhythmObservation,
  type ReconciledField,
} from "../src/lib/rhythmEngine";
import { compareMeter, meanTempoOf, scoreRhythm } from "../src/lib/rhythmMetrics";

const PDMX_ROOT = process.env.PDMX_ROOT ??
  resolve("../../../AI-Music-Production-Platform-main/.pdmx-data");
const OUT = process.env.RHYTHM_OUT ?? resolve("../../.tmp-rhythm");
const CASES_PER_CONDITION = Number(process.env.RHYTHM_CASES_PER_CONDITION ?? 4);
const TARGET_SECONDS = Number(process.env.RHYTHM_CLIP_SECONDS ?? 30);
const MAX_SCANNED = Number(process.env.RHYTHM_MAX_SCANNED ?? 30000);
const SAMPLE_RATE = 44100;

const ensure = (path: string) => { if (!existsSync(path)) mkdirSync(path, { recursive: true }); };

// ---------------------------------------------------------------------------
// Phase 1: corpus
// ---------------------------------------------------------------------------

/** The admitted rights subset, as PDMX itself publishes it. */
function admittedIds(): Set<string> {
  const file = join(PDMX_ROOT, "subset_paths", "no_license_conflict.txt");
  const ids = new Set<string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /([^/\\]+)\.(?:json|mid|mxl|pdf)\s*$/.exec(line.trim());
    if (match) ids.add(match[1]);
  }
  return ids;
}

function* walkMidi(root: string): Generator<string> {
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.name.endsWith(".mid")) yield path;
    }
  }
}

type Candidate = { id: string; path: string; profile: ReturnType<typeof profileSource> };

function buildCorpus(): RhythmCase[] {
  const admitted = admittedIds();
  console.log(`[corpus] admitted rights subset: ${admitted.size} works`);
  const midiRoot = existsSync(join(PDMX_ROOT, "mid", "mid"))
    ? join(PDMX_ROOT, "mid", "mid")
    : join(PDMX_ROOT, "mid");

  const buckets = new Map<RhythmCondition, Candidate[]>(
    RHYTHM_CONDITIONS.map((condition) => [condition, []]),
  );
  const quota = CASES_PER_CONDITION;
  let scanned = 0;
  let parsed = 0;
  let refusedRights = 0;

  for (const path of walkMidi(midiRoot)) {
    if (scanned >= MAX_SCANNED) break;
    if ([...buckets.values()].every((list) => list.length >= quota)) break;
    scanned += 1;
    const id = path.replace(/^.*[/\\]/, "").replace(/\.mid$/, "");
    if (!admitted.has(id)) { refusedRights += 1; continue; }
    let profile;
    try {
      const midi = parseMidiFile(readFileSync(path));
      if (midi.notes.length < 16) continue;
      profile = profileSource(midi);
      parsed += 1;
    } catch { continue; }
    if (profile.beatCount < 24) continue;
    for (const condition of RHYTHM_CONDITIONS) {
      const bucket = buckets.get(condition)!;
      if (bucket.length >= quota) continue;
      if (!eligibleFor(condition, profile)) continue;
      // One source per condition per work: the same piece appearing twice in a
      // condition would make four cases look like four independent measurements.
      if (bucket.some((entry) => entry.id === id)) continue;
      bucket.push({ id, path, profile });
      break;
    }
  }
  console.log(
    `[corpus] scanned ${scanned} files, ${refusedRights} outside the admitted subset, ${parsed} parsed`,
  );

  const cases: RhythmCase[] = [];
  for (const condition of RHYTHM_CONDITIONS) {
    const spec = { condition, ...CONDITION_SPECS[condition] };
    for (const [index, candidate] of buckets.get(condition)!.entries()) {
      const midi = parseMidiFile(readFileSync(candidate.path));
      const grid = metricalGrid(midi);
      const beatCount = Math.max(16, Math.round((TARGET_SECONDS * spec.baseBpm) / 60));
      // The pickup condition is manufactured, not found: start the clip one beat
      // before a bar line, so the first downbeat sits one beat in and a tracker
      // that assumes bar one starts at time zero is wrong about every bar.
      let startBeat = 0;
      if (condition === "pickup") {
        const secondDownbeat = grid.downbeatQuarters[1];
        const index2 = grid.beatQuarters.findIndex((q) => Math.abs(q - secondDownbeat) < 1e-9);
        startBeat = Math.max(1, index2 - 1);
      }
      try {
        cases.push(buildRhythmCase({
          id: `${condition}-${index + 1}`,
          sourceId: candidate.id,
          midi,
          spec: { ...spec, seed: 1000 + cases.length },
          beatCount,
          startBeat,
          selection: { ...candidate.profile },
        }));
      } catch (error) {
        console.log(`[corpus] ${condition}/${candidate.id} skipped: ${(error as Error).message}`);
      }
    }
  }
  return cases;
}

// ---------------------------------------------------------------------------
// Phase 1b: render
// ---------------------------------------------------------------------------

/** Sum per-family stems into one mono mix, then normalise to −3 dBFS peak. */
function renderCase(
  item: RhythmCase,
  options: { withoutAccompaniment?: boolean } = {},
): { wav: Buffer; sha256: string; seconds: number } {
  // `withoutAccompaniment` exists for the bare-pickup probe: the main corpus
  // puts a kick on every ground-truth downbeat, which makes the anacrusis
  // trivially findable and was measured doing exactly that (every tracker
  // scored downbeat F = 1.000 on the `pickup` condition). Removing the kit
  // leaves the bar line implied by melody and harmony alone, which is the
  // situation the reconciler's pickup resolver was actually written for.
  const accompaniment = options.withoutAccompaniment
    ? []
    : accompanimentNotes(item.truth, item.spec, item.id);
  const melodic = item.notes.filter((note) => note.channel !== 9);
  const percussive = [...item.notes.filter((note) => note.channel === 9),
    ...accompaniment.filter((note) => note.channel === 9)];
  const bass = accompaniment.filter((note) => note.channel !== 9);
  const duration = item.truth.durationSeconds + 0.5;

  const tracks = [
    { id: `${item.id}-lead`, instrument: item.spec.condition === "classical" ? "strings" : "keys", notes: melodic },
    { id: `${item.id}-kit`, instrument: "drum kit", notes: percussive },
    { id: `${item.id}-bass`, instrument: "bass", notes: bass },
  ].filter((track) => track.notes.length > 0);

  let mix: Float32Array | null = null;
  for (const track of tracks) {
    const { samples } = renderStem(track, { sampleRate: SAMPLE_RATE, durationSeconds: duration });
    if (!mix) mix = new Float32Array(samples.length);
    const length = Math.min(mix.length, samples.length);
    for (let i = 0; i < length; i += 1) mix[i] += samples[i];
  }
  if (!mix) throw new Error(`${item.id}: nothing to render`);
  let peak = 0;
  for (const sample of mix) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? 0.708 / peak : 1;
  for (let i = 0; i < mix.length; i += 1) mix[i] *= gain;
  const wav = encodeWavPcm(mix, SAMPLE_RATE, 24);
  return { wav, sha256: createHash("sha256").update(wav).digest("hex"), seconds: duration };
}

// ---------------------------------------------------------------------------
// Phase 2: the worker
// ---------------------------------------------------------------------------

type WorkerProvider = {
  provider: string;
  available: boolean;
  reason?: string;
  beats: number[];
  downbeats: number[] | null;
  tempoBpm: number | null;
  meter: string | null;
  runtimeSeconds?: number;
};

type WorkerResponse = {
  durationSeconds: number;
  providers: WorkerProvider[];
  onsetEnvelope: { frameRateHz: number; strengths: number[]; startSeconds?: number };
  /** Digest of the files that decide what the image contains; see modal_config.py. */
  imageEvidence?: string | null;
};

async function callWorker(url: string, token: string, wav: Buffer, name: string): Promise<WorkerResponse> {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), `${name}.wav`);
  const response = await fetch(`${url.replace(/\/$/, "")}/analyze`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  if (!response.ok) {
    throw new Error(`worker ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()) as WorkerResponse;
}

// ---------------------------------------------------------------------------
// Phase 3: scoring
// ---------------------------------------------------------------------------

type CaseResult = {
  id: string;
  condition: RhythmCondition;
  tier: "synthetic";
  sourceId: string;
  audioSha256: string;
  durationSeconds: number;
  referenceTempoBpm: number | null;
  referenceMeter: string;
  pickupBeats: number;
  providers: Array<{
    provider: string;
    available: boolean;
    reason?: string;
    runtimeSeconds?: number;
    score: ReturnType<typeof scoreRhythm> | null;
  }>;
  reconciled: ReturnType<typeof reconcileRhythm>;
  reconciledScore: ReturnType<typeof scoreRhythm> | null;
};

function scoreCase(item: RhythmCase, audioSha256: string, worker: WorkerResponse): CaseResult {
  const reference = {
    beats: item.truth.beats,
    downbeats: item.truth.downbeats,
    meter: item.truth.meterMap[0]?.meter ?? "4/4",
  };
  const providers = worker.providers.map((provider) => ({
    provider: provider.provider,
    available: provider.available,
    reason: provider.reason,
    runtimeSeconds: provider.runtimeSeconds,
    score: provider.available
      ? scoreRhythm(reference, {
          beats: provider.beats,
          downbeats: provider.downbeats,
          tempoBpm: provider.tempoBpm,
          meter: provider.meter,
        })
      : null,
  }));
  const observations: ProviderRhythmObservation[] = worker.providers
    .filter((provider) => provider.available && provider.beats.length >= 2)
    .map((provider) => ({
      provider: provider.provider,
      beats: provider.beats,
      downbeats: provider.downbeats,
      tempoBpm: provider.tempoBpm,
      meter: provider.meter,
    }));
  const reconciled = reconcileRhythm({
    observations,
    onsetEnvelope: worker.onsetEnvelope,
    durationSeconds: worker.durationSeconds,
  });
  return {
    id: item.id,
    condition: item.condition,
    tier: item.tier,
    sourceId: item.sourceId,
    audioSha256,
    durationSeconds: item.truth.durationSeconds,
    referenceTempoBpm: meanTempoOf(item.truth.beats),
    referenceMeter: reference.meter,
    pickupBeats: item.truth.pickupBeats,
    providers,
    reconciled,
    reconciledScore: reconciled.beatGrid.value
      ? scoreRhythm(reference, {
          beats: reconciled.beatGrid.value,
          downbeats: reconciled.downbeats.value,
          tempoBpm: reconciled.tempo.value,
          meter: reconciled.meter.value,
        })
      : null,
  };
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const mean = (values: number[]): number | null =>
  values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(4)) : null;

function aggregate(results: CaseResult[]) {
  const names = [...new Set(results.flatMap((r) => r.providers.map((p) => p.provider)))].sort();
  const table: Record<string, Record<string, unknown>> = {};
  for (const condition of RHYTHM_CONDITIONS) {
    const inCondition = results.filter((r) => r.condition === condition);
    if (!inCondition.length) continue;
    const row: Record<string, unknown> = { cases: inCondition.length };
    for (const name of [...names, "RECONCILED"]) {
      const scores = inCondition
        .map((r) => name === "RECONCILED"
          ? r.reconciledScore
          : r.providers.find((p) => p.provider === name)?.score)
        .filter((s): s is NonNullable<typeof s> => Boolean(s));
      if (!scores.length) { row[name] = { available: 0 }; continue; }
      row[name] = {
        available: scores.length,
        beatF: mean(scores.map((s) => s.beat.fMeasure)),
        downbeatF: mean(scores.filter((s) => s.downbeat).map((s) => s.downbeat!.fMeasure)),
        downbeatReported: scores.filter((s) => s.downbeat).length,
        tempoAbsError: mean(scores.map((s) => s.tempo.absoluteRelativeError).filter((v): v is number => v !== null)),
        tempoOctaveError: mean(scores.map((s) => s.tempo.octaveTolerantError).filter((v): v is number => v !== null)),
        octaveConfusions: scores.filter((s) => s.tempo.octaveConfusion).length,
        meterExact: mean(scores.filter((s) => s.meter).map((s) => (s.meter!.exact ? 1 : 0))),
        driftSeconds: mean(scores.map((s) => s.drift.driftSeconds).filter((v): v is number => v !== null)),
        walksOff: scores.filter((s) => s.drift.walksOff).length,
        // A non-zero rotation: the bar lines are a whole beat out, which is a
        // different failure from having lost the beat and a different repair.
        pickupPhaseErrors: scores.filter((s) => Boolean(s.downbeatPhaseOffset)).length,
      };
    }
    table[condition] = row;
  }
  return { providers: names, table };
}

/**
 * One row per provider over every case, the way the final report reads it:
 * tempo accuracy with and without octave credit, beat F, downbeat F, metre
 * accuracy, and the half/double error rate. Means are over the cases the
 * provider actually answered; `available` says how many that was.
 */
function providerSummary(results: CaseResult[], tempoTolerance = 0.04) {
  const names = [...new Set(results.flatMap((r) => r.providers.map((p) => p.provider)))].sort();
  const summary: Record<string, Record<string, number | null>> = {};
  for (const name of [...names, "RECONCILED"]) {
    const scores = results
      .map((r) => name === "RECONCILED" ? r.reconciledScore : r.providers.find((p) => p.provider === name)?.score)
      .filter((s): s is NonNullable<typeof s> => Boolean(s));
    if (!scores.length) { summary[name] = { available: 0, cases: results.length }; continue; }
    const withTempo = scores.filter((s) => s.tempo.estimateBpm !== null);
    const withMeter = scores.filter((s) => s.meter);
    const withDownbeat = scores.filter((s) => s.downbeat);
    summary[name] = {
      cases: results.length,
      available: scores.length,
      beatF: mean(scores.map((s) => s.beat.fMeasure)),
      downbeatF: mean(withDownbeat.map((s) => s.downbeat!.fMeasure)),
      downbeatReported: withDownbeat.length,
      /** Share of answered cases whose tempo is within `tempoTolerance` of the truth, no octave credit. */
      tempoExactRate: withTempo.length
        ? Number((withTempo.filter((s) => (s.tempo.absoluteRelativeError ?? 1) <= tempoTolerance).length / withTempo.length).toFixed(4))
        : null,
      /** The same, allowing 2×, ½×, 3×, ⅓×, 3/2× and ⅔×. */
      tempoOctaveRate: withTempo.length
        ? Number((withTempo.filter((s) => (s.tempo.octaveTolerantError ?? 1) <= tempoTolerance).length / withTempo.length).toFixed(4))
        : null,
      tempoTolerance,
      /** Share of answered cases where the tempo was right only at another metrical level. */
      halfDoubleErrorRate: withTempo.length
        ? Number((withTempo.filter((s) => s.tempo.octaveConfusion).length / withTempo.length).toFixed(4))
        : null,
      octaveConfusions: withTempo.filter((s) => s.tempo.octaveConfusion).length,
      meterExactRate: withMeter.length
        ? Number((withMeter.filter((s) => s.meter!.exact).length / withMeter.length).toFixed(4))
        : null,
      meterReported: withMeter.length,
      walksOff: scores.filter((s) => s.drift.walksOff).length,
      pickupPhaseErrors: scores.filter((s) => Boolean(s.downbeatPhaseOffset)).length,
      meanRuntimeSeconds: mean(results.flatMap((r) =>
        r.providers.filter((p) => p.provider === name && typeof p.runtimeSeconds === "number")
          .map((p) => p.runtimeSeconds as number))),
    };
  }
  return summary;
}

/**
 * Providers that may be measured but not shipped.
 *
 * madmom's models are CC BY-NC-SA 4.0 (its own LICENSE splits code from data),
 * so it can lead a condition on accuracy and still not be routable. Kept here
 * as a licence fact, separate from any score.
 */
const LICENCE_BLOCKED = new Set(["MADMOM"]);

/** Which provider leads each condition, and by how much over the runner-up. */
function routing(results: CaseResult[], table: Record<string, Record<string, unknown>>) {
  const recommendations: Array<Record<string, unknown>> = [];
  for (const [condition, row] of Object.entries(table)) {
    const ranked = Object.entries(row)
      .filter(([name, value]) =>
        name !== "cases" && name !== "RECONCILED" &&
        typeof value === "object" && value !== null && "beatF" in (value as object))
      .map(([name, value]) => ({ provider: name, ...(value as Record<string, number | null>) }))
      .filter((entry) => entry.beatF !== null)
      // Beat F first; downbeat F breaks a tie, because a tracker that finds the
      // pulse and loses the bar is not equal to one that finds both.
      .sort((a, b) => (b.beatF! - a.beatF!) || ((b.downbeatF ?? -1) - (a.downbeatF ?? -1)));
    if (!ranked.length) continue;
    const [leader, runnerUp] = ranked;
    // The best provider we are actually allowed to ship, which is not always
    // the best provider.
    const routable = ranked.find((entry) => !LICENCE_BLOCKED.has(entry.provider)) ?? leader;
    recommendations.push({
      condition,
      measuredLeader: leader.provider,
      measuredLeaderBeatF: leader.beatF,
      measuredLeaderDownbeatF: leader.downbeatF,
      routableLeader: routable.provider,
      routableLeaderBeatF: routable.beatF,
      routableLeaderDownbeatF: routable.downbeatF,
      licenceCostBeatF: Number(((leader.beatF ?? 0) - (routable.beatF ?? 0)).toFixed(4)),
      runnerUp: runnerUp?.provider ?? null,
      runnerUpBeatF: runnerUp?.beatF ?? null,
      margin: runnerUp ? Number((leader.beatF! - runnerUp.beatF!).toFixed(4)) : null,
      // Four cases per condition cannot separate providers below ~0.05 F.
      decisive: Boolean(runnerUp) && leader.beatF! - runnerUp.beatF! >= 0.05,
      cases: row.cases as number,
      reconciledBeatF: (row.RECONCILED as { beatF?: number | null })?.beatF ?? null,
    });
  }
  const measured = new Set(recommendations.map((r) => r.measuredLeader as string));
  const routableLeaders = new Set(recommendations.map((r) => r.routableLeader as string));
  return {
    recommendations,
    singleMeasuredWinner: measured.size === 1 ? [...measured][0] : null,
    singleRoutableWinner: routableLeaders.size === 1 ? [...routableLeaders][0] : null,
    note: routableLeaders.size === 1
      ? `${[...routableLeaders][0]} is the best routable provider on every condition measured; ` +
        `a per-condition routing table would always return the same name.`
      : `Different routable providers lead different conditions; routing earns its complexity.`,
    licenceNote:
      "MADMOM may be measured and may not be routed to: its model files are CC BY-NC-SA 4.0 " +
      "and commercial use needs written permission from the authors.",
  };
}

/** The routing table as a TypeScript literal, for `src/lib/rhythmRouting.ts`. */
function routingLiteral(recommendations: Array<Record<string, unknown>>): string {
  const rows = recommendations.map((r) => `  {
    condition: ${JSON.stringify(r.condition)},
    measuredLeader: ${JSON.stringify(r.measuredLeader)},
    measuredLeaderBeatF: ${r.measuredLeaderBeatF},
    measuredLeaderDownbeatF: ${r.measuredLeaderDownbeatF ?? null},
    routableLeader: ${JSON.stringify(r.routableLeader)},
    routableLeaderBeatF: ${r.routableLeaderBeatF},
    routableLeaderDownbeatF: ${r.routableLeaderDownbeatF ?? null},
    runnerUp: ${JSON.stringify(r.runnerUp)},
    runnerUpBeatF: ${r.runnerUpBeatF ?? null},
    margin: ${r.margin ?? null},
    decisive: ${r.decisive},
    cases: ${r.cases},
    note: ${JSON.stringify(
      `${r.measuredLeader} leads at ${r.measuredLeaderBeatF} beat F over ` +
      `${r.runnerUp ?? "no runner-up"} at ${r.runnerUpBeatF ?? "n/a"}; ` +
      `the reconciled reading scored ${r.reconciledBeatF ?? "n/a"}.`,
    )},
  },`);
  return `export const RHYTHM_ROUTING: readonly RhythmRoutingRow[] = [\n${rows.join("\n")}\n];\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Real audio, no ground truth
// ---------------------------------------------------------------------------

type RealAudioEntry = {
  id: string;
  /** Relative to OUT. */
  path: string;
  label: string;
  projectId?: string;
  sourceId?: string;
  songModelVersion?: number;
  /** What people and the platform said about the file. Claims, not references. */
  claims: Record<string, unknown>;
};

const realManifestPath = join(OUT, "real", "manifest.json");
const realResponsesPath = join(OUT, "real", "responses.json");

/** The metrical relation between a reading and a claim, if there is one. */
function relationToClaim(estimateBpm: number | null, claimBpm: number | null): {
  ratio: number | null;
  relativeError: number | null;
  octaveTolerantError: number | null;
  relation: "same_level" | "half" | "double" | "third" | "triple" | "none" | null;
} {
  if (estimateBpm === null || claimBpm === null || !(claimBpm > 0)) {
    return { ratio: null, relativeError: null, octaveTolerantError: null, relation: null };
  }
  const ratio = estimateBpm / claimBpm;
  const relativeError = Math.abs(estimateBpm - claimBpm) / claimBpm;
  const levels: Array<[number, "same_level" | "half" | "double" | "third" | "triple"]> =
    [[1, "same_level"], [1 / 2, "half"], [2, "double"], [1 / 3, "third"], [3, "triple"]];
  let best: { error: number; relation: "same_level" | "half" | "double" | "third" | "triple" | "none" } =
    { error: Infinity, relation: "none" };
  for (const [level, relation] of levels) {
    const error = Math.abs(estimateBpm - claimBpm * level) / (claimBpm * level);
    if (error < best.error) best = { error, relation };
  }
  return {
    ratio: Number(ratio.toFixed(4)),
    relativeError: Number(relativeError.toFixed(4)),
    octaveTolerantError: Number(best.error.toFixed(4)),
    // 8 % is generous on purpose: a claim made from memory is not a reference.
    relation: best.error <= 0.08 ? best.relation : "none",
  };
}

function realAudioProbes() {
  if (!existsSync(realManifestPath) || !existsSync(realResponsesPath)) return null;
  const manifest = JSON.parse(readFileSync(realManifestPath, "utf8")) as RealAudioEntry[];
  const responses = JSON.parse(readFileSync(realResponsesPath, "utf8")) as Record<string, WorkerResponse>;
  const probes = manifest.filter((entry) => responses[entry.id]).map((entry) => {
    const response = responses[entry.id];
    const bytes = readFileSync(join(OUT, entry.path));
    const claimBpm = typeof entry.claims.ownerStatedTempoBpm === "number"
      ? (entry.claims.ownerStatedTempoBpm as number) : null;
    const providers = response.providers.map((provider) => {
      const gridTempo = provider.available && provider.beats.length >= 2
        ? meanTempoOf(provider.beats) : null;
      return {
        provider: provider.provider,
        available: provider.available,
        reason: provider.reason,
        runtimeSeconds: provider.runtimeSeconds,
        tempoBpm: provider.tempoBpm === null ? null : Number(provider.tempoBpm.toFixed(2)),
        /** Whole-file mean, as opposed to the worker's median inter-beat reading. */
        meanTempoBpm: gridTempo === null ? null : Number(gridTempo.toFixed(2)),
        beatCount: provider.beats.length,
        downbeatCount: provider.downbeats?.length ?? null,
        meter: provider.meter,
        firstBeats: provider.beats.slice(0, 8),
        firstDownbeats: provider.downbeats?.slice(0, 4) ?? null,
        againstOwnerClaim: relationToClaim(provider.tempoBpm, claimBpm),
      };
    });
    const observations: ProviderRhythmObservation[] = response.providers
      .filter((provider) => provider.available && provider.beats.length >= 2)
      .map((provider) => ({
        provider: provider.provider,
        beats: provider.beats,
        downbeats: provider.downbeats,
        tempoBpm: provider.tempoBpm,
        meter: provider.meter,
      }));
    // The platform's own reading enters as what it is: a tempo with no beat
    // grid. It can name a metrical level and nothing else.
    const platform = (entry.claims.platformLocalEstimate ?? null) as
      { provider?: string; tempoBpm?: number; confidence?: number } | null;
    if (platform && typeof platform.tempoBpm === "number") {
      observations.push(tempoOnlyObservation(
        platform.provider ?? "LOCAL_SIGNAL_ANALYZER_V1", platform.tempoBpm, platform.confidence));
    }
    const reconciled = reconcileRhythm({
      observations,
      onsetEnvelope: response.onsetEnvelope,
      durationSeconds: response.durationSeconds,
    });
    const compact = <T>(field: ReconciledField<T>, summarise: (value: T) => unknown) => ({
      value: field.value === null ? null : summarise(field.value),
      status: field.status,
      providers: field.providers,
      dissenting: field.dissenting,
      rationale: field.rationale,
      ...(field.candidates ? { candidates: field.candidates } : {}),
    });
    return {
      id: entry.id,
      label: entry.label,
      tier: "real",
      projectId: entry.projectId ?? null,
      sourceId: entry.sourceId ?? null,
      songModelVersion: entry.songModelVersion ?? null,
      audioSha256: createHash("sha256").update(bytes).digest("hex"),
      audioBytes: bytes.length,
      durationSeconds: response.durationSeconds,
      groundTruth: null,
      claims: entry.claims,
      providers,
      platformLocalEstimateAgainstOwnerClaim: relationToClaim(platform?.tempoBpm ?? null, claimBpm),
      reconciled: {
        version: reconciled.version,
        selectedProvider: reconciled.selectedProvider,
        usedAudioEvidence: reconciled.usedAudioEvidence,
        contestedFields: reconciled.contestedFields,
        tempo: compact<number>(reconciled.tempo, (value) => value),
        beatGrid: compact<number[]>(reconciled.beatGrid, (value) =>
          ({ count: value.length, first: value.slice(0, 8), last: value.slice(-2) })),
        downbeats: compact<number[]>(reconciled.downbeats, (value) =>
          ({ count: value.length, first: value.slice(0, 4) })),
        meter: compact<string>(reconciled.meter, (value) => value),
        tempoMapPoints: reconciled.tempoMap.value?.length ?? 0,
        disagreements: reconciled.disagreements,
      },
      whatTheEngineWouldCarry: reconciled.tempo.candidates
        ? `CONTESTED tempo with ${reconciled.tempo.candidates.length} candidates: ` +
          reconciled.tempo.candidates.map((c) => `${c.value} BPM (${c.providers.join("/")})`).join(" vs ") +
          "; no pick, no average."
        : `${reconciled.tempo.status} tempo ${reconciled.tempo.value} BPM from ${reconciled.tempo.providers.join("/")}.`,
    };
  });
  return probes.length ? {
    why:
      "The synthetic tier has exact ground truth and a synthetic timbre; a real mix has neither. These " +
      "files are not scored. They show what every tracker says on a real recording and what the engine " +
      "carries when the trackers disagree, next to what the platform's own local estimator had said and " +
      "what the owner says the tempo is.",
    caseCount: probes.length,
    cases: probes,
  } : null;
}

async function main(): Promise<void> {
  const phase = process.argv[2] ?? "all";
  ensure(OUT);
  const corpusPath = join(OUT, "corpus.json");
  const workerPath = join(OUT, "worker-responses.json");

  if (phase === "build" || phase === "all") {
    const cases = buildCorpus();
    const rendered = cases.map((item) => {
      const { wav, sha256 } = renderCase(item);
      ensure(join(OUT, "audio"));
      writeFileSync(join(OUT, "audio", `${item.id}.wav`), wav);
      return { ...item, audioSha256: sha256, audioBytes: wav.length };
    });
    writeFileSync(corpusPath, JSON.stringify(rendered, null, 2));
    console.log(`[build] ${rendered.length} cases rendered into ${OUT}`);
    const counts = new Map<string, number>();
    for (const item of rendered) counts.set(item.condition, (counts.get(item.condition) ?? 0) + 1);
    for (const condition of RHYTHM_CONDITIONS) {
      console.log(`  ${condition}: ${counts.get(condition) ?? 0}`);
    }
  }

  if (phase === "run" || phase === "all") {
    const url = process.env.RHYTHM_WORKER_URL;
    const token = process.env.MUSIC_AI_WORKER_TOKEN;
    if (!url || !token) throw new Error("RHYTHM_WORKER_URL and MUSIC_AI_WORKER_TOKEN are required");
    const cases = JSON.parse(readFileSync(corpusPath, "utf8")) as Array<RhythmCase & { audioSha256: string }>;
    const responses: Record<string, WorkerResponse> = existsSync(workerPath)
      ? JSON.parse(readFileSync(workerPath, "utf8"))
      : {};
    for (const item of cases) {
      if (responses[item.id]) { console.log(`[run] ${item.id}: cached`); continue; }
      const wav = readFileSync(join(OUT, "audio", `${item.id}.wav`));
      const started = Date.now();
      try {
        responses[item.id] = await callWorker(url, token, wav, item.id);
        const live = responses[item.id].providers.filter((p) => p.available).map((p) => p.provider);
        console.log(`[run] ${item.id}: ${((Date.now() - started) / 1000).toFixed(1)}s — ${live.join(", ")}`);
      } catch (error) {
        console.log(`[run] ${item.id}: FAILED ${(error as Error).message}`);
      }
      writeFileSync(workerPath, JSON.stringify(responses));
    }
  }

  // A supplementary probe, not a condition: the same four pickup clips rendered
  // with no drum kit at all. The main corpus marks every true downbeat with a
  // kick, so the `pickup` condition measured how well a tracker follows a kick
  // rather than how well it finds an anacrusis. This is the harder question.
  if (phase === "probe-pickup") {
    const url = process.env.RHYTHM_WORKER_URL;
    const token = process.env.MUSIC_AI_WORKER_TOKEN;
    if (!url || !token) throw new Error("RHYTHM_WORKER_URL and MUSIC_AI_WORKER_TOKEN are required");
    const cases = (JSON.parse(readFileSync(corpusPath, "utf8")) as RhythmCase[])
      .filter((item) => item.condition === "pickup");
    const probePath = join(OUT, "pickup-bare-responses.json");
    const responses: Record<string, WorkerResponse> = existsSync(probePath)
      ? JSON.parse(readFileSync(probePath, "utf8"))
      : {};
    ensure(join(OUT, "audio-bare"));
    for (const item of cases) {
      if (responses[item.id]) continue;
      const { wav } = renderCase(item, { withoutAccompaniment: true });
      writeFileSync(join(OUT, "audio-bare", `${item.id}.wav`), wav);
      try {
        responses[item.id] = await callWorker(url, token, wav, `${item.id}-bare`);
        console.log(`[probe] ${item.id}: ok`);
      } catch (error) {
        console.log(`[probe] ${item.id}: FAILED ${(error as Error).message}`);
      }
      writeFileSync(probePath, JSON.stringify(responses));
    }
  }

  // Real recordings, with no ground truth. What a producer or the platform
  // itself *claims* about the file is recorded as a claim, never as a
  // reference: nothing here is scored, and the point is to show what each
  // tracker says on a real mix and what the engine carries when they disagree.
  if (phase === "probe-real") {
    const url = process.env.RHYTHM_WORKER_URL;
    const token = process.env.MUSIC_AI_WORKER_TOKEN;
    if (!url || !token) throw new Error("RHYTHM_WORKER_URL and MUSIC_AI_WORKER_TOKEN are required");
    const manifest = JSON.parse(readFileSync(realManifestPath, "utf8")) as RealAudioEntry[];
    const responses: Record<string, WorkerResponse> = existsSync(realResponsesPath)
      ? JSON.parse(readFileSync(realResponsesPath, "utf8"))
      : {};
    for (const entry of manifest) {
      if (responses[entry.id]) { console.log(`[real] ${entry.id}: cached`); continue; }
      const bytes = readFileSync(join(OUT, entry.path));
      const started = Date.now();
      try {
        responses[entry.id] = await callWorker(url, token, bytes, entry.id);
        const live = responses[entry.id].providers.filter((p) => p.available)
          .map((p) => `${p.provider}=${p.tempoBpm === null ? "-" : p.tempoBpm.toFixed(1)}`);
        console.log(`[real] ${entry.id}: ${((Date.now() - started) / 1000).toFixed(1)}s — ${live.join(", ")}`);
      } catch (error) {
        console.log(`[real] ${entry.id}: FAILED ${(error as Error).message}`);
      }
      writeFileSync(realResponsesPath, JSON.stringify(responses));
    }
  }

  if (phase === "report" || phase === "all") {
    const cases = JSON.parse(readFileSync(corpusPath, "utf8")) as Array<RhythmCase & { audioSha256: string }>;
    const responses = JSON.parse(readFileSync(workerPath, "utf8")) as Record<string, WorkerResponse>;
    const results = cases
      .filter((item) => responses[item.id])
      .map((item) => scoreCase(item, item.audioSha256, responses[item.id]));
    const { providers, table } = aggregate(results);
    const routingReport = routing(results, table);
    writeFileSync(join(OUT, "rhythm-routing.literal.ts"),
      routingLiteral(routingReport.recommendations));
    const evidence = {
      version: "1.0",
      ranAt: new Date().toISOString(),
      tier: "synthetic",
      tierNote:
        "Every case is a PDMX score (admitted rights subset) rendered through REFERENCE_SYNTH_V1 with an " +
        "authored performance. Beats, downbeats, tempo and metre are exact by construction, not annotated. " +
        "This tier is never averaged with a real-audio tier; no real-audio tier had been cleared when this ran.",
      toleranceSeconds: 0.07,
      trimSeconds: 0,
      worker: process.env.RHYTHM_WORKER_URL ?? null,
      // Every case must have run on one image, or the columns are not
      // comparable. More than one digest here means the run straddled a
      // redeploy and should be thrown away rather than reported.
      workerImageEvidence: [...new Set(
        cases.map((item) => responses[item.id]?.imageEvidence).filter(Boolean),
      )],
      providers,
      caseCount: results.length,
      providerSummary: providerSummary(results),
      conditionTable: table,
      supplementaryProbes: (() => {
        const probePath = join(OUT, "pickup-bare-responses.json");
        if (!existsSync(probePath)) return null;
        const probeResponses = JSON.parse(readFileSync(probePath, "utf8")) as Record<string, WorkerResponse>;
        const probeResults = cases
          .filter((item) => probeResponses[item.id])
          .map((item) => scoreCase(item, item.audioSha256, probeResponses[item.id]));
        return {
          pickupWithoutKit: {
            why:
              "In the main corpus every ground-truth downbeat carries a kick, and every tracker " +
              "scored downbeat F = 1.000 on the `pickup` condition — it measured kick-following, " +
              "not anacrusis-finding. These are the same four clips with the kit removed, so the " +
              "bar line is implied by melody and harmony only.",
            caseCount: probeResults.length,
            ...aggregate(probeResults),
            reconciliation: {
              disagreementFamilies: probeResults.reduce((counts: Record<string, number>, result) => {
                for (const item of result.reconciled.disagreements) {
                  counts[item.family] = (counts[item.family] ?? 0) + 1;
                }
                return counts;
              }, {}),
              downbeatStatuses: probeResults.map((r) => r.reconciled.downbeats.status),
            },
            cases: probeResults,
          },
        };
      })(),
      realAudioProbes: realAudioProbes(),
      routing: routingReport,
      reconciliation: {
        contestedFieldCounts: results.reduce((counts: Record<string, number>, result) => {
          for (const field of result.reconciled.contestedFields) {
            counts[field] = (counts[field] ?? 0) + 1;
          }
          return counts;
        }, {}),
        disagreementFamilies: results.reduce((counts: Record<string, number>, result) => {
          for (const item of result.reconciled.disagreements) {
            counts[item.family] = (counts[item.family] ?? 0) + 1;
          }
          return counts;
        }, {}),
        resolvedShare: (() => {
          const all = results.flatMap((r) => r.reconciled.disagreements);
          return all.length ? Number((all.filter((d) => d.resolved).length / all.length).toFixed(4)) : null;
        })(),
      },
      cases: results,
    };
    ensure(resolve("../../docs/evidence"));
    const path = resolve("../../docs/evidence/rhythm-tournament-live.json");
    writeFileSync(path, JSON.stringify(evidence, null, 2));
    console.log(`[report] ${results.length} cases -> ${path}`);
    for (const [condition, row] of Object.entries(table)) {
      const cells = Object.entries(row)
        .filter(([name]) => name !== "cases")
        .map(([name, value]) => {
          const v = value as { beatF?: number | null; downbeatF?: number | null };
          return `${name}=${v.beatF ?? "-"}/${v.downbeatF ?? "-"}`;
        });
      console.log(`  ${condition.padEnd(15)} ${cells.join("  ")}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
