/**
 * PR-93 (SOUND-2) - assemble `docs/evidence/open-licence-sound-assets-live.json`
 * from what Modal produced: the per-asset provisioning records, the
 * attestation re-run against the Volume, the SoundFont audition and the
 * survey, plus the rendered phrases pulled from the Volume (measured here
 * with the repo's BS.1770-4 meter, the one `masteringEngine.ts` masters by).
 *
 * Nothing is invented: every field is read from a record or computed from a
 * WAV; assets without a record are listed as not provisioned.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { measureLoudness, measureTruePeakDbtp } from "../src/lib/loudness";
import {
  assetAdmissibility,
  deriveSfizzInstrumentMap,
  estimatedSpend,
  familyCoverage,
  providerAssetModel,
  worldInstruments,
  type OpenLicenceCatalogue,
  type ProvisionRecord,
} from "../src/lib/openLicenceSoundAssets";

type Args = { provision: string[]; previous: string[]; attest?: string; audition?: string; survey?: string; renders?: string; out: string; catalogue: string; extraUsd: number; branch?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { provision: [], previous: [], out: "", catalogue: "", extraUsd: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--provision") { args.provision.push(value); i += 1; }
    else if (flag === "--previous") { args.previous.push(value); i += 1; }
    else if (flag === "--attest") { args.attest = value; i += 1; }
    else if (flag === "--audition") { args.audition = value; i += 1; }
    else if (flag === "--survey") { args.survey = value; i += 1; }
    else if (flag === "--renders") { args.renders = value; i += 1; }
    else if (flag === "--out") { args.out = value; i += 1; }
    else if (flag === "--catalogue") { args.catalogue = value; i += 1; }
    else if (flag === "--extra-usd") { args.extraUsd = Number(value); i += 1; }
    else if (flag === "--branch") { args.branch = value; i += 1; }
  }
  if (!args.out || !args.catalogue || !args.provision.length) throw new Error("usage: --catalogue <json> --provision <json>... [--attest <json>] [--audition <json>] [--survey <json>] [--renders <dir>] --out <json>");
  return args;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** PCM 16-bit RIFF/WAVE (what the operator writes) -> interleaved stereo Float32 + sample rate. */
export function decodePcm16Wav(buffer: Buffer): { stereo: Float32Array; sampleRate: number; channels: number; frames: number } {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") throw new Error("not a RIFF/WAVE file");
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = buffer.subarray(offset + 8, offset + 8 + size);
    if (id === "fmt ") {
      const format = body.readUInt16LE(0);
      channels = body.readUInt16LE(2);
      sampleRate = body.readUInt32LE(4);
      bits = body.readUInt16LE(14);
      if (format !== 1 || bits !== 16) throw new Error(`unsupported WAV format ${format}/${bits}-bit`);
    } else if (id === "data") {
      data = body;
    }
    offset += 8 + size + (size % 2);
  }
  if (!data || !channels || !sampleRate) throw new Error("WAV without fmt/data");
  const frames = Math.floor(data.length / (2 * channels));
  const stereo = new Float32Array(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const left = data.readInt16LE(frame * channels * 2) / 32768;
    const right = channels > 1 ? data.readInt16LE(frame * channels * 2 + 2) / 32768 : left;
    stereo[frame * 2] = left;
    stereo[frame * 2 + 1] = right;
  }
  return { stereo, sampleRate, channels, frames };
}

export function measureWav(path: string): { bytes: number; sha256: string; sampleRate: number; channels: number; seconds: number; integratedLufs: number | null; truePeakDbtp: number | null; peak: number } {
  const buffer = readFileSync(path);
  const { stereo, sampleRate, channels, frames } = decodePcm16Wav(buffer);
  const loudness = measureLoudness(stereo, sampleRate, 2);
  const truePeak = measureTruePeakDbtp(stereo, 2);
  let peak = 0;
  for (const sample of stereo) peak = Math.max(peak, Math.abs(sample));
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    sampleRate,
    channels,
    seconds: Math.round((frames / sampleRate) * 1000) / 1000,
    integratedLufs: Number.isFinite(loudness.integratedLufs) ? Math.round(loudness.integratedLufs * 100) / 100 : null,
    truePeakDbtp: Number.isFinite(truePeak) ? Math.round(truePeak * 100) / 100 : null,
    peak: Math.round(peak * 1e6) / 1e6,
  };
}

export function main(argv: string[]): void {
  const args = parseArgs(argv);
  const catalogueText = readFileSync(args.catalogue, "utf8");
  const catalogue = JSON.parse(catalogueText) as OpenLicenceCatalogue;
  const records: Record<string, ProvisionRecord | undefined> = {};
  // Earlier runs of the same asset are kept, never overwritten: a first-run
  // refusal (VCSL's missing LICENSE on the sfz branch) or a git-mode failure
  // is part of the story, and the spend adds up over every run.
  const earlierRuns: Record<string, Array<{ file: string; summary: Record<string, unknown> }>> = {};
  const allRunsForSpend: Array<ProvisionRecord | undefined> = [];
  const summarise = (record: ProvisionRecord): Record<string, unknown> => ({
    fetchMode: record.fetchMode ?? "git",
    refused: record.refused ?? null,
    error: record.error ?? null,
    activated: record.activated === true,
    stageError: record.operator?.stage?.error ?? null,
    sourceSeconds: record.steps?.source?.seconds ?? null,
    subsetMissing: record.steps?.subset?.missing?.length ?? null,
    cost: record.cost ?? null,
  });
  for (const file of args.previous) {
    const batch = readJson<Record<string, ProvisionRecord>>(file);
    for (const [assetId, record] of Object.entries(batch)) {
      (earlierRuns[assetId] ??= []).push({ file: file.split(/[\\/]/).pop()!, summary: summarise(record) });
      allRunsForSpend.push(record);
    }
  }
  for (const file of args.provision) {
    const batch = readJson<Record<string, ProvisionRecord>>(file);
    for (const [assetId, record] of Object.entries(batch)) {
      if (records[assetId]) {
        (earlierRuns[assetId] ??= []).push({ file: "superseded", summary: summarise(records[assetId]!) });
        allRunsForSpend.push(records[assetId]);
      }
      records[assetId] = record;
    }
  }
  const attest = args.attest && existsSync(args.attest) ? readJson<{ attestedAt: string; volume: string; mount: string; assets: Record<string, unknown>; cost?: { costUsd?: number; containerWallSeconds?: number } }>(args.attest) : null;
  const audition = args.audition && existsSync(args.audition) ? readJson<{ artifacts: Record<string, unknown>; cost?: { costUsd?: number; containerWallSeconds?: number } }>(args.audition) : null;
  const survey = args.survey && existsSync(args.survey) ? readJson<{ containerDisk?: unknown; repos?: Record<string, unknown>; releases?: Record<string, unknown> }>(args.survey) : null;

  const assets = catalogue.assets.map((asset) => {
    const record = records[asset.assetId];
    const { admissible, reasons } = assetAdmissibility(asset, record);
    const renders = asset.instruments.map((instrument) => {
      const lifecycle = record?.operator?.renders?.[instrument.sfz];
      const direct = record?.operator?.directRenders?.[instrument.sfz];
      const render = lifecycle ?? (direct ? { ...direct, viaLifecycle: false } : undefined);
      let local: ReturnType<typeof measureWav> | { error: string } | null = null;
      if (render?.wav && args.renders) {
        const path = join(args.renders, asset.assetId, "renders", render.wav);
        if (existsSync(path)) {
          try {
            local = measureWav(path);
            if (render.wavSha256 && local.sha256 !== render.wavSha256) local = { ...local, error: `local WAV sha256 ${local.sha256} differs from the worker's ${render.wavSha256}` } as never;
          } catch (error) {
            local = { error: error instanceof Error ? error.message : String(error) };
          }
        }
      }
      return {
        sfz: instrument.sfz,
        instrument: instrument.instrument,
        family: instrument.family,
        auditionFamily: instrument.auditionFamily,
        ...(instrument.world ? { world: true } : {}),
        ...(instrument.standIn ? { standIn: instrument.standIn } : {}),
        viaLifecycle: lifecycle ? true : direct ? false : null,
        rendered: render ?? null,
        local,
      };
    });
    return {
      assetId: asset.assetId,
      identity: asset.identity,
      licenseOwner: asset.licenseOwner,
      fetchMode: record?.fetchMode ?? (record ? "git" : null),
      source: { ...asset.source, ...(record?.steps?.source ?? {}) },
      licence: { claimed: asset.licence, captured: record?.licence ?? null },
      subset: record?.steps?.subset ? { sha256: record.steps.subset.sha256, fileCount: record.steps.subset.fileCount, bytes: record.steps.subset.bytes, missing: record.steps.subset.missing ?? [], undefinedVariables: record.steps.subset.undefinedVariables ?? [] } : null,
      host: record?.operator?.host ?? null,
      preflight: record?.operator?.preflight ?? null,
      stage: record?.operator?.stage ?? null,
      activate: record?.operator?.activate ?? null,
      health: record?.operator?.health ?? null,
      refused: record?.refused ?? null,
      error: (record as { error?: string } | undefined)?.error ?? null,
      warnings: record?.warnings ?? [],
      activated: record?.activated === true,
      admissible,
      reasons,
      renders,
      attestedFromVolume: attest?.assets?.[asset.assetId] ?? null,
      cost: record?.cost ?? null,
      earlierRuns: earlierRuns[asset.assetId] ?? [],
      derivedInstrumentMap: deriveSfizzInstrumentMap(asset),
    };
  });

  const coverage = familyCoverage(catalogue, records);
  const auditionRenders: Record<string, unknown> = {};
  for (const family of ["piano", "strings", "world", "bass", "guitar", "drums"]) {
    const pick = (viaLifecycle: boolean) => {
      const candidates = assets
        .filter((asset) => (viaLifecycle ? asset.admissible : true))
        .flatMap((asset) => asset.renders
          .filter((render) => render.auditionFamily === family && render.rendered?.audible === true && render.viaLifecycle === viaLifecycle)
          .map((render) => ({ asset, render })));
      // An instrument that IS the family (no stand-in) comes before a declared stand-in; measured WAVs before unmeasured.
      const ordered = [...candidates].sort((a, b) => Number(Boolean(a.render.standIn)) - Number(Boolean(b.render.standIn)));
      const measured = ordered.find((candidate) => candidate.render.local && !("error" in candidate.render.local)) ?? ordered[0];
      return measured
        ? {
            assetId: measured.asset.assetId, sfz: measured.render.sfz, instrument: measured.render.instrument, viaLifecycle,
            ...(measured.render.standIn ? { standIn: measured.render.standIn } : {}),
            renderMs: measured.render.rendered?.renderMs ?? null, peak: measured.render.rendered?.peak ?? null, outputSha256: measured.render.rendered?.outputSha256 ?? null,
            wav: measured.render.rendered?.wav ?? null, local: measured.render.local,
            alternatives: candidates.length - 1,
          }
        : null;
    };
    const attested = pick(true);
    const direct = pick(false);
    auditionRenders[family] = attested
      ? { ...attested, ...(direct ? { directAuditionAlso: { assetId: direct.assetId, sfz: direct.sfz } } : {}) }
      : direct
        ? { ...direct, note: "no admissible asset rendered this family through the attested lifecycle; this WAV is the operator's direct sfizz_render audition of a refused asset and does not count as coverage" }
        : { none: `no asset rendered an audible '${family}' phrase, attested or direct` };
  }

  const spend = estimatedSpend([...Object.values(records), ...allRunsForSpend, attest ?? undefined, audition ?? undefined], args.extraUsd);
  const notSampled = coverage.filter((row) => !row.sampled).map((row) => row.family);
  const evidence = {
    pr: "PR-93",
    slug: "open-licence-sound-assets-cloud",
    stream: "SOUND-2",
    generatedAt: new Date().toISOString(),
    gitBranch: args.branch ?? null,
    modal: {
      app: "music-ai-sound-assets",
      volume: attest?.volume ?? "music-ai-sound-assets-v1",
      mount: attest?.mount ?? "/var/lib/music-ai/assets",
      cpuOnly: true,
      gpu: null,
      trained: false,
      promoted: false,
      containerDisk: survey?.containerDisk ?? null,
    },
    catalogue: { path: "services/music-ai-worker/open_licence_assets.json", sha256: sha256(Buffer.from(catalogueText, "utf8")), version: catalogue.version, assetCount: catalogue.assets.length },
    hostIdentity: assets.find((asset) => asset.host)?.host?.identity ?? null,
    assets,
    soundfontAuditions: (catalogue.soundfontAuditions ?? []).map((entry) => ({ ...entry, outcome: audition?.artifacts?.[entry.id] ?? audition?.artifacts?.[entry.id.split("-")[2]] ?? null })),
    excluded: catalogue.excluded ?? [],
    familyCoverage: coverage,
    worldInstruments: worldInstruments(catalogue).map((instrument) => {
      const render = assets.find((asset) => asset.assetId === instrument.assetId)?.renders.find((entry) => entry.sfz === instrument.sfz);
      return {
        ...instrument,
        renderedAudibly: render?.viaLifecycle === true && render.rendered?.audible === true,
        directAuditionAudible: render?.viaLifecycle === false && render.rendered?.audible === true,
        ...(render?.local && !("error" in render.local) ? { integratedLufs: render.local.integratedLufs, truePeakDbtp: render.local.truePeakDbtp } : {}),
      };
    }),
    providerAssetModel: providerAssetModel(catalogue, records),
    auditionRenders,
    attestation: attest ? { attestedAt: attest.attestedAt, volume: attest.volume, mount: attest.mount, cost: attest.cost ?? null } : null,
    survey: survey ? { repos: survey.repos ?? null, releases: survey.releases ?? null } : null,
    spend: {
      ...spend,
      capUsd: 15,
      basis: "Modal list price for CPU cores and memory per container-second, summed over every provisioning run recorded here (superseded runs included), the Volume attestation and the SoundFont audition; the workspace dashboard is authoritative",
      extraUsd: args.extraUsd,
      extraCovers: "the repository survey from Modal (four clones, ~31 min at 2 CPU / 4 GiB), the Musical Artifacts reachability probe, and the first image build of the app - estimated, not metered",
      gpu: null,
    },
    honestLimits: [
      ...(notSampled.length ? [`Families with no attested sampled instrument in the cloud after this PR: ${notSampled.join(", ")} (they keep LOCAL_EXPRESSIVE_SYNTH).`] : []),
      "Each asset is its own asset root with its own manifest: a worker process serves one library at a time (see providerAssetModel.why). Nothing here changes which asset the deployed music-ai-worker serves.",
      "Renders are one 6-second Performance-MIDI phrase per instrument on default controllers; no round-robin, mic-mix or keyswitch decisions were tuned. LUFS values are of those phrases, not of a mix.",
      "Licence evidence is the legal-code file at the pinned commit plus its hash; this is provenance, not a legal opinion. CC-BY assets carry their attribution string in the attestation; CC-BY-SA renders inherit ShareAlike.",
      "Musical Artifacts #940 could not be fetched by any non-browser client (Cloudflare 403 from the owner's PC and from Modal); its licence was therefore not read from inside the file and nothing of it was staged or auditioned. #941 is refused on its 'various' licence field regardless.",
      "Nobody has listened: the phrases exist as WAVs with digests; the production-floor benchmark (same Performance MIDI through LOCAL_EXPRESSIVE_SYNTH vs these assets, blind, in the Listening Room) is not run here.",
    ],
  };
  writeFileSync(resolve(args.out), JSON.stringify(evidence, null, 2) + "\n");
  const summary = assets.map((asset) => `${asset.admissible ? "OK " : "-- "} ${asset.assetId}: ${asset.renders.filter((render) => render.rendered?.audible).length}/${asset.renders.length} audible${asset.reasons.length ? ` (${asset.reasons[0]})` : ""}`);
  console.log(summary.join("\n"));
  console.log(`families sampled: ${coverage.filter((row) => row.sampled).map((row) => row.family).join(", ") || "none"}; estimated spend $${spend.estimatedUsd}`);
  if (args.renders) {
    const pulled = existsSync(args.renders) ? readdirSync(args.renders).length : 0;
    console.log(`renders directory ${args.renders}: ${pulled} asset folder(s)`);
  }
}
