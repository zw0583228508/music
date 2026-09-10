/**
 * Library entry for `scripts/sound-ab.mjs` (PR-92, SOUND-1): measure a
 * rendered WAV with the platform's own BS.1770 meter, and register an A/B pair
 * of masters on a project so the owner can play it blind in the Listening
 * Room. Bundled with the real `@workspace/db`, so DATABASE_URL must be set.
 */
import { createHash, randomUUID } from "node:crypto";
import type { BlindListeningPair, BlindListeningSides } from "@workspace/db";
import { measureLoudness, measureTruePeakDbtp, linearToDb } from "../src/lib/loudness";
import { encodeWav } from "../src/lib/exportEngine";
import { MASTERING_ENGINE_VERSION, masterAudio, masteringProfile, type MasteringReport } from "../src/lib/masteringEngine";

// The platform's own render path, for `scripts/prove-sfizz-live.mjs`: a real
// TrackModel through `SfzRenderer.renderAttested` -> `renderRemoteInstrument`.
export { SfzRenderer, sfizzWorkerConfig, clearRendererHealthCache, performedMaterialSha256 } from "../src/lib/musicEngines";
export { decideNativeRoute, resolveSfizzInstrument, sfizzFamilyCoverage } from "../src/lib/nativeRendererRouting";

export const sha256Hex = (data: Buffer | string): string => createHash("sha256").update(data).digest("hex");

export type WavMeasurement = {
  sampleRate: number;
  channels: number;
  frames: number;
  durationSeconds: number;
  integratedLufs: number | null;
  loudnessRangeLu: number;
  truePeakDbtp: number;
  samplePeakDbfs: number;
  sha256: string;
  bytes: number;
  method: "BS.1770-4";
};

function decodePcm16(buffer: Buffer): { sampleRate: number; channels: number; samples: Float32Array } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bits = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(buffer.length, body + size));
    }
    offset = body + size + (size % 2);
  }
  if (!data || bits !== 16 || !sampleRate || !channels) throw new Error("unsupported WAV (expected PCM 16-bit)");
  const samples = new Float32Array(Math.floor(data.length / 2));
  for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768;
  return { sampleRate, channels, samples };
}

/** Integrated loudness, true peak, sample peak, duration and digest of a PCM-16 WAV. */
export function measureWav(buffer: Buffer): WavMeasurement {
  const { sampleRate, channels, samples } = decodePcm16(buffer);
  const stereo = channels === 2 ? samples : (() => {
    const out = new Float32Array(samples.length * 2);
    for (let i = 0; i < samples.length; i += 1) { out[i * 2] = samples[i]; out[i * 2 + 1] = samples[i]; }
    return out;
  })();
  const loudness = measureLoudness(stereo, sampleRate, 2);
  let peak = 0;
  for (let i = 0; i < stereo.length; i += 1) peak = Math.max(peak, Math.abs(stereo[i]));
  const frames = stereo.length / 2;
  const round = (value: number, places = 2) => Number(value.toFixed(places));
  return {
    sampleRate,
    channels,
    frames,
    durationSeconds: round(frames / sampleRate, 3),
    integratedLufs: Number.isFinite(loudness.integratedLufs) ? round(loudness.integratedLufs) : null,
    loudnessRangeLu: round(loudness.loudnessRangeLu),
    truePeakDbtp: round(measureTruePeakDbtp(stereo, 2)),
    samplePeakDbfs: round(linearToDb(peak)),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length,
    method: "BS.1770-4",
  };
}

/**
 * The A/B pair is built from each export's premaster mix (`mix/full_mix.wav`),
 * not from `mix/master.wav`: the export's master is, by design, the exact WAV
 * the producer approved (exportJobs substitutes it), so it is identical on
 * both sides and says nothing about the stems. Each premaster goes through the
 * platform's own mastering engine with the same profile, so the listener
 * compares instruments at the same integrated loudness, not two levels.
 */
export function masterPremaster(premasterWav: Buffer, profileId = "STREAMING"): {
  wav: Buffer; report: MasteringReport; engineVersion: string; raw: WavMeasurement; mastered: WavMeasurement;
} {
  const { sampleRate, channels, samples } = decodePcm16(premasterWav);
  if (sampleRate !== 44100 || channels !== 2) throw new Error(`premaster must be 44.1 kHz stereo (got ${sampleRate} Hz, ${channels} ch)`);
  const { master, report } = masterAudio(samples, masteringProfile(profileId), { sampleRate });
  const wav = encodeWav(master);
  return { wav, report, engineVersion: MASTERING_ENGINE_VERSION, raw: measureWav(premasterWav), mastered: measureWav(wav) };
}

export type SoundAbSide = {
  /** The system under test, e.g. LOCAL_EXPRESSIVE_SYNTH or SFIZZ_VSCO2_CE. */
  label: string;
  masterWav: Buffer;
  measurement: WavMeasurement;
  description: string;
  technicalMetadata: Record<string, string | number | boolean | null>;
};

const token = (seed: string) => createHash("sha256").update(seed).digest("hex").slice(0, 8);

/**
 * Store both masters as private export objects, register them as MASTER
 * artifacts on the project (the storage route serves an object only through a
 * registered artifact of the owner's project), and open a one-pair blind
 * listening session whose audio is those two objects. Returns what the owner
 * needs: the artifact ids, the rater path and the token -> system key.
 */
export async function registerSoundAb(input: {
  projectId: string;
  ownerId: string;
  title: string;
  runId: string;
  evidenceFile: string;
  a: SoundAbSide;
  b: SoundAbSide;
  /** PR-97: which production-floor comparison this pair is (default: PR-92's synth vs sfizz). */
  comparison?: string;
  createdBy?: string;
}): Promise<{
  artifactIds: { a: string; b: string };
  urls: { a: string; b: string };
  sessionId: string;
  raterPath: string;
  keyBySide: Record<string, string>;
}> {
  // Loaded here, not at module top: `measureWav` must work without a database.
  const { db, musicArtifactsTable, musicBlindListeningSessionsTable } = await import("@workspace/db");
  const { saveExportObject } = await import("../src/lib/objectStorage");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const urls = { a: "", b: "" };
  const artifactIds = { a: "", b: "" };
  for (const [key, side] of [["a", input.a], ["b", input.b]] as const) {
    const url = await saveExportObject(`sound-ab/${input.runId}/${stamp}-${key}-${side.label.toLowerCase()}-master.wav`, side.masterWav, "audio/wav");
    urls[key] = url;
    const id = `sound-ab-${input.runId}-${key}-${randomUUID().slice(0, 8)}`;
    artifactIds[key] = id;
    await db.insert(musicArtifactsTable).values({
      id,
      projectId: input.projectId,
      type: "MASTER",
      label: `${input.title} · ${key.toUpperCase()} · ${side.label}`,
      version: 1,
      size: `${(side.masterWav.length / 1024 / 1024).toFixed(1)} MB`,
      format: "WAV",
      url,
      storageUri: url,
      state: "ready",
      checksum: side.measurement.sha256,
      hash: side.measurement.sha256,
      parentIds: [],
      createdBy: input.createdBy ?? "sound-ab (PR-92)",
      modelVersion: `${side.label}@production-floor-ab`,
      provider: side.label,
      parameters: { runId: input.runId, side: key, description: side.description },
      technicalMetadata: {
        integratedLufs: side.measurement.integratedLufs,
        truePeakDbtp: side.measurement.truePeakDbtp,
        samplePeakDbfs: side.measurement.samplePeakDbfs,
        durationSeconds: side.measurement.durationSeconds,
        sampleRate: side.measurement.sampleRate,
        sha256: side.measurement.sha256,
        ...side.technicalMetadata,
      },
      immutable: true,
    });
  }
  const sessionId = randomUUID();
  const pairId = `${sessionId}:1`;
  const left = token(`${pairId}:L`);
  const right = token(`${pairId}:R`);
  const question = "Which rendering would you rather release?";
  const pairs: BlindListeningPair[] = [{
    pairId,
    caseId: "The same arrangement, two renderers",
    left: { token: left, systemUnderTest: input.a.label },
    right: { token: right, systemUnderTest: input.b.label },
    questions: [question, "Which one sounds more like real instruments?", "Which one would you keep working on?"],
    meta: { comparison: input.comparison ?? "production-floor:synth-vs-sfizz", taskId: input.runId, seed: 0, family: "mixed" },
  }];
  const keyBySide = { [left]: input.a.label, [right]: input.b.label };
  const sides: BlindListeningSides = {
    kind: "tournament",
    challenger: "right",
    left: { label: input.a.label, generationJobId: "sound-ab", candidateId: `sound-ab:${input.runId}:a`, candidateLabel: input.a.description, pick: "explicit", audioUrl: urls.a },
    right: { label: input.b.label, generationJobId: "sound-ab", candidateId: `sound-ab:${input.runId}:b`, candidateLabel: input.b.description, pick: "explicit", audioUrl: urls.b },
    audioByToken: { [left]: urls.a, [right]: urls.b },
    tournament: {
      runId: input.runId,
      evidenceFile: input.evidenceFile,
      primaryQuestion: question,
      secondaryQuestions: ["Which one sounds more like real instruments?", "Which one would you keep working on?"],
      comparisons: [{ id: input.comparison ?? "production-floor:synth-vs-sfizz", a: input.a.label, b: input.b.label, pairs: 1 }],
      entryByToken: { [left]: `${input.runId}:${input.a.label}`, [right]: `${input.runId}:${input.b.label}` },
    },
  };
  await db.insert(musicBlindListeningSessionsTable).values({
    id: sessionId,
    projectId: input.projectId,
    ownerId: input.ownerId,
    title: input.title,
    sides,
    pairs,
    keyBySide,
    status: "open",
  });
  return { artifactIds, urls, sessionId, raterPath: `/listen/${sessionId}`, keyBySide };
}
