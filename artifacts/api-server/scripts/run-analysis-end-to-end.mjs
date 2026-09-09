/**
 * The Analysis Engine end to end on real songs (Analysis Engine wave, Stream J
 * - PR-90).
 *
 *   node scripts/run-analysis-end-to-end.mjs api     [--base http://localhost:5009]
 *   node scripts/run-analysis-end-to-end.mjs rhythm  [--worker-url <url>]   (token: MUSIC_AI_WORKER_TOKEN or RHYTHM_TOKEN_FILE)
 *   node scripts/run-analysis-end-to-end.mjs harmony                        (decodes WAVs, then `modal run` the PR-85 batch)
 *   node scripts/run-analysis-end-to-end.mjs report  [--out docs/evidence/analysis-end-to-end-live.json]
 *                                                    [--manifest-out docs/evidence/analysis-real-eval-manifest.json]
 *
 * Common flags: --corpus <json> (default .corpus-data/analysis-real-eval/corpus.json),
 *               --work <dir>    (default .tmp-an-j: per-phase raw outputs, git-ignored)
 *
 * `api` pushes every corpus file through the platform's real path - a
 * dedicated dev project per song, the upload reservation, `POST
 * /projects/:id/sources`, the analyzer (Basic Pitch on Modal via the lease
 * surface + local analysers + PR-86/89 reconciliation) - and reads the Song
 * Model back. `rhythm` sends the same bytes to PR-84's rhythm-tournament-worker
 * (multipart, no lease). `harmony` runs PR-85's harmony-acr-worker batch on a
 * mono 22.05 kHz decode. `report` reads all three, builds the REAL_AUDIO /
 * PROFESSIONAL_REAL_WORLD manifest with the truth the public annotations
 * supply (and nothing else), evaluates every song on both paths, aggregates,
 * scores one tier at a time, and writes the evidence with LF bytes.
 *
 * Nothing here trains, promotes or changes a weight. Audio stays git-ignored.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const phase = args[0] && !args[0].startsWith("--") ? args[0] : "report";
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const corpusPath = resolve(repoRoot, flag("corpus", ".corpus-data/analysis-real-eval/corpus.json"));
const corpusDir = dirname(corpusPath);
const work = resolve(repoRoot, flag("work", ".tmp-an-j"));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);
const ensure = (dir) => { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); return dir; };
const writeLf = (path, value) => writeFileSync(path, JSON.stringify(value, null, 1).replace(/\r\n/g, "\n") + "\n", "utf8");
const round = (value, places = 3) => (value === null || value === undefined || !Number.isFinite(value) ? null : Number(Number(value).toFixed(places)));

const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const items = corpus.items.filter((item) => item.sha256 && !item.error);

// ---------------------------------------------------------------------------
// Phase: api - the platform's real path
// ---------------------------------------------------------------------------
async function phaseApi() {
  const base = flag("base", process.env.BASE ?? "http://localhost:5009");
  const out = ensure(join(work, "api"));
  let cookie = "";
  const call = async (method, path, body, raw) => {
    const headers = { cookie };
    if (raw) { headers["content-type"] = raw.contentType; headers["content-length"] = String(raw.bytes.length); }
    else if (body) headers["content-type"] = "application/json";
    const response = await fetch(base + path, { method, headers, body: raw ? raw.bytes : body ? JSON.stringify(body) : undefined });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await response.text();
    let json = null; try { json = JSON.parse(text); } catch { }
    return { status: response.status, json, text };
  };
  const login = await call("POST", "/api/dev-login", {});
  if (login.status !== 200) throw new Error(`dev-login ${login.status} ${login.text.slice(0, 200)}`);
  log("signed in as", login.json.user.id, "at", base);
  for (const item of items) {
    const outPath = join(out, `${item.id}.json`);
    if (existsSync(outPath) && !has("force")) { log("skip (done)", item.id); continue; }
    const bytes = readFileSync(join(corpusDir, item.file));
    const t0 = Date.now();
    const record = { itemId: item.id, sha256: item.sha256, startedAt: new Date().toISOString(), timings: {} };
    try {
      const project = await call("POST", "/api/projects", { name: `AN-J E2E ${item.id}`, sourceType: "FULL_SONG", sourceName: item.file });
      if (project.status !== 201) throw new Error(`create project ${project.status} ${project.text.slice(0, 200)}`);
      record.projectId = project.json.id;
      const reservation = await call("POST", "/api/storage/uploads/request-url", { projectId: record.projectId, name: item.file, size: bytes.length, contentType: "audio/mpeg" });
      if (reservation.status !== 200) throw new Error(`request-url ${reservation.status} ${reservation.text.slice(0, 200)}`);
      const t1 = Date.now();
      const put = await call("PUT", reservation.json.uploadURL, null, { bytes, contentType: "audio/mpeg" });
      if (put.status !== 204) throw new Error(`put ${put.status} ${put.text.slice(0, 200)}`);
      record.timings.uploadMs = Date.now() - t1;
      const t2 = Date.now();
      const source = await call("POST", `/api/projects/${record.projectId}/sources`, { objectPath: reservation.json.objectPath, name: item.file, size: bytes.length, contentType: "audio/mpeg", sourceType: "FULL_SONG" });
      if (source.status !== 202) throw new Error(`register ${source.status} ${source.text.slice(0, 200)}`);
      record.sourceId = source.json.id;
      let status = source.json.status; let last = source.json;
      const deadline = Date.now() + 20 * 60 * 1000;
      while (!["ready", "failed"].includes(status) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        const list = await call("GET", `/api/projects/${record.projectId}/sources`);
        const row = (list.json?.sources ?? list.json ?? []).find?.((s) => s.id === record.sourceId) ?? null;
        if (row) { last = row; status = row.status; }
      }
      record.timings.analysisMs = Date.now() - t2;
      record.source = {
        status: last.status, progress: last.progress, error: last.error, durationSeconds: last.durationSeconds, sampleRate: last.sampleRate, channels: last.channels,
        attempts: (last.attempts ?? []).map((a) => ({ attemptNumber: a.attemptNumber, status: a.status, stage: a.stage, error: a.error, startedAt: a.startedAt, completedAt: a.completedAt })),
      };
      const model = await call("GET", `/api/projects/${record.projectId}/song-model`);
      record.songModelStatus = model.status;
      record.songModel = model.status === 200 ? model.json : null;
      if (model.status !== 200) record.songModelError = model.text.slice(0, 300);
    } catch (error) {
      record.error = String(error.message ?? error);
    }
    record.timings.totalMs = Date.now() - t0;
    record.finishedAt = new Date().toISOString();
    writeFileSync(outPath, JSON.stringify(record));
    const tr = record.songModel?.trustReport;
    log(item.id, record.source?.status ?? record.error, `${(record.timings.totalMs / 1000).toFixed(0)}s`,
      tr ? `${tr.verdict} tempo=${tr.domains.tempo.status} key=${tr.domains.key.status}` : (record.source?.error ?? ""));
  }
}

// ---------------------------------------------------------------------------
// Phase: rhythm - PR-84's worker, multipart, two at a time
// ---------------------------------------------------------------------------
async function phaseRhythm() {
  const url = flag("worker-url", process.env.RHYTHM_WORKER_URL ?? "https://windot100--rhythm-tournament-worker-endpoint.modal.run");
  const token = process.env.MUSIC_AI_WORKER_TOKEN ?? (process.env.RHYTHM_TOKEN_FILE ? readFileSync(process.env.RHYTHM_TOKEN_FILE, "utf8").trim() : null);
  if (!token) throw new Error("MUSIC_AI_WORKER_TOKEN or RHYTHM_TOKEN_FILE is required (the rhythm worker's dedicated token; never committed)");
  const out = ensure(join(work, "rhythm"));
  const queue = items.filter((item) => !existsSync(join(out, `${item.id}.json`)) || has("force"));
  log("queued", queue.length, "for", url);
  const one = async (item) => {
    const bytes = readFileSync(join(corpusDir, item.file));
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(bytes)], { type: "audio/mpeg" }), `${item.id}.mp3`);
    const t0 = Date.now();
    const record = { itemId: item.id, sha256: item.sha256, startedAt: new Date().toISOString() };
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/analyze`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
      record.httpStatus = response.status;
      if (!response.ok) record.error = (await response.text()).slice(0, 400);
      else record.response = await response.json();
    } catch (error) { record.error = String(error.message ?? error); }
    record.wallMs = Date.now() - t0;
    writeFileSync(join(out, `${item.id}.json`), JSON.stringify(record));
    const p = record.response?.providers ?? [];
    log(item.id, record.httpStatus ?? record.error, `${(record.wallMs / 1000).toFixed(0)}s`, p.map((x) => `${x.provider}=${x.available ? round(x.tempoBpm, 1) : "n/a"}`).join(" "));
  };
  const workers = Array.from({ length: Number(flag("concurrency", "2")) }, async () => { while (queue.length) await one(queue.shift()); });
  await Promise.all(workers);
}

// ---------------------------------------------------------------------------
// Phase: harmony - decode, then PR-85's Modal batch
// ---------------------------------------------------------------------------
function phaseHarmony() {
  const input = ensure(join(work, "harmony-in"));
  for (const item of items) {
    const target = join(input, `${item.id}.wav`);
    if (existsSync(target)) continue;
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(corpusDir, item.file), "-ac", "1", "-ar", "22050", "-sample_fmt", "s16", target]);
    log("decoded", item.id);
  }
  const output = join(ensure(join(work, "harmony")), "providers.json");
  if (existsSync(output) && !has("force")) { log("harmony providers already recorded at", output); return; }
  log("modal run harmony-acr-worker::batch on", items.length, "clips");
  const result = spawnSync(process.env.PYTHON ?? "python", ["-m", "modal", "run", "services/harmony-acr-worker/modal_app.py::batch", "--input-dir", input, "--output", output],
    { cwd: repoRoot, stdio: "inherit", env: { ...process.env, MODAL_PROFILE: process.env.MODAL_PROFILE ?? "music-platform", PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } });
  if (result.status !== 0) throw new Error(`modal run exited ${result.status}`);
}

// ---------------------------------------------------------------------------
// Phase: report
// ---------------------------------------------------------------------------
async function phaseReport() {
  const esbuild = await import("esbuild");
  const bundlePath = join(tmpdir(), `analysis-end-to-end-${process.pid}.mjs`);
  await esbuild.build({
    entryPoints: [resolve(here, "./analysis-end-to-end-entry.ts")],
    outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
    alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
  });
  await esbuild.stop?.();
  const lib = await import(pathToFileURL(bundlePath).href);
  await rm(bundlePath, { force: true });

  const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null);
  const apiDir = join(work, "api");
  const rhythmDir = join(work, "rhythm");
  const harmony = readJson(join(work, "harmony", "providers.json")) ?? {};

  // --- the manifest: truth only where a public annotation exists ------------
  const manifestItems = [];
  const annotatorAgreements = {};
  for (const item of corpus.items) {
    if (!item.sha256 || item.error) continue;
    const truth = { ...lib.EMPTY_TRUTH };
    const truthSources = {};
    const templateFields = {};
    if (item.truthRefs?.key?.value) {
      const key = lib.parseKey(item.truthRefs.key.value);
      if (key) { truth.key = key; truthSources.key = { source: item.truthRefs.key.source, how: item.truthRefs.key.how }; templateFields.key = { value: item.truthRefs.key.value, status: "HUMAN_VERIFIED", how: item.truthRefs.key.how }; }
    }
    if (typeof item.truthRefs?.tempo?.value === "number") {
      const bpm = item.truthRefs.tempo.value;
      truth.tempo = { bpm, quarterBpm: bpm, map: [{ time: 0, bpm }], constant: true, durationSeconds: item.durationSeconds };
      truthSources.tempo = { source: item.truthRefs.tempo.source, how: item.truthRefs.tempo.how };
      templateFields.tempo = { value: bpm, status: "HUMAN_VERIFIED", how: item.truthRefs.tempo.how };
    }
    if (item.truthRefs?.sections?.annotator1File) {
      const a1 = lib.parseSalamiFunctions(readFileSync(join(corpusDir, item.truthRefs.sections.annotator1File), "utf8"));
      if (a1.length >= 2) {
        truth.sections = a1;
        truthSources.sections = { source: item.truthRefs.sections.source, how: `${item.truthRefs.sections.how}; annotator 1 is the reference, annotator 2 the human ceiling` };
        templateFields.sections = { value: a1.map((s) => ({ start: round(s.start, 3), end: round(s.end, 3), label: s.label })), status: "HUMAN_VERIFIED", how: item.truthRefs.sections.how };
        if (item.truthRefs.sections.annotator2File) {
          const a2 = lib.parseSalamiFunctions(readFileSync(join(corpusDir, item.truthRefs.sections.annotator2File), "utf8"));
          annotatorAgreements[item.id] = { ...lib.annotatorAgreement(a1, a2), annotator1Sections: a1.length, annotator2Sections: a2.length, annotator2Boundaries: a2.map((s) => round(s.start, 3)) };
        }
      }
    }
    for (const domain of lib.GOLD_DOMAINS) if (!templateFields[domain]) templateFields[domain] = { value: null, status: "UNKNOWN" };
    if (item.id === "owner-veorer-libi") {
      templateFields.tempo.ownerClaim = { value: 115, status: "UNVERIFIED_OWNER_CLAIM", statedOn: "2026-09-09", note: "the owner says the song is around 115 BPM (recorded by PR-81 and PR-84); not verified against the recording" };
    }
    manifestItems.push({
      id: item.id, tier: item.tier, title: item.title, genreFamily: item.genreFamily,
      source: {
        kind: "public_recording", dataset: item.dataset, url: item.resolvedUrl ?? item.url ?? null, licence: item.licence,
        path: item.file, bytes: item.bytes, sha256: item.sha256, durationSeconds: item.durationSeconds, sampleRate: item.sampleRate, channels: item.channels,
        truthSources, ...(item.ownerProjectId ? { ownerProjectId: item.ownerProjectId, ownerSourceId: item.ownerSourceId } : {}),
      },
      audio: null,
      truth,
      coverage: lib.coverageOf(truth, "HUMAN_VERIFIED"),
      notes: item.dataset === "GIANTSTEPS_KEY_TEMPO" ? "Two-minute Beatport preview; key from the GiantSteps key set, tempo from the GiantSteps tempo set (annotations_v2); metre, beats, chords, sections UNKNOWN."
        : item.dataset === "SALAMI_IA" ? "Live recording from the Internet Archive; sections from SALAMI annotator 1 (functions layer); everything else UNKNOWN."
          : item.dataset === "CCMIXTER_CC_BY" ? "CC BY mix from ccMixter; no public annotation: every domain UNKNOWN, so this song measures agreement, contest rate, coverage, latency and cost only."
            : "The owner's own upload re-run through the platform in a dedicated dev project; no verified truth.",
      annotationTemplate: { instructions: "Fill a field only after checking it against the recording; a platform estimate or an owner claim is never truth.", fields: templateFields },
    });
  }
  const manifest = { version: lib.ANALYSIS_GOLD_VERSION, builtAt: new Date().toISOString(), items: manifestItems };
  const problems = lib.validateManifest(manifest);
  if (problems.length) throw new Error(`manifest invalid:\n${problems.join("\n")}`);

  // --- per-song evaluation ---------------------------------------------------
  const rows = [];
  const traces = {};
  const perProvider = { tempo: {}, key: {}, sections: {} };
  const rhythmImages = new Set();
  const harmonyVersions = new Set();
  for (const item of corpus.items) {
    if (!item.sha256 || item.error) continue;
    const api = readJson(join(apiDir, `${item.id}.json`));
    const rhythm = readJson(join(rhythmDir, `${item.id}.json`));
    const harmonyEvidence = harmony[item.id] ?? null;
    const failures = [];
    const model = api?.songModel ?? null;
    if (!api) failures.push("api: not run");
    else if (!model) failures.push(`api: ${api.source?.error ?? api.error ?? "no Song Model"}`);
    if (!rhythm) failures.push("rhythm: not run");
    else if (!rhythm.response) failures.push(`rhythm: ${rhythm.error ?? rhythm.httpStatus}`);
    if (!harmonyEvidence) failures.push("harmony: not run");
    else for (const [arm, error] of Object.entries(harmonyEvidence.errors ?? {})) failures.push(`harmony ${arm}: ${String(error).slice(0, 120)}`);
    if (rhythm?.response?.imageEvidence) rhythmImages.add(rhythm.response.imageEvidence);
    if (harmonyEvidence?.versions) harmonyVersions.add(JSON.stringify(harmonyEvidence.versions));

    const platform = model ? {
      fieldStatus: model.fieldStatus ?? null,
      reconciliation: model.reconciliation ?? null,
      trustReport: model.trustReport ?? null,
      tempoMap: model.tempoMap ?? [], meterMap: model.meterMap ?? [], keyMap: model.keyMap ?? [],
      sections: (model.sections ?? []).map((s) => ({ name: s.name, startBar: s.startBar, endBar: s.endBar, startSeconds: s.coordinates?.start?.seconds ?? null })),
      bars: (model.bars ?? []).map((b) => ({ bar: b.bar, start: b.start, end: b.end })),
      melodyCount: (model.melody ?? []).length, bassCount: (model.bass ?? []).length, chordCount: (model.chords ?? []).length,
      loudness: model.loudness ?? null,
      providerProvenance: model.providerProvenance ?? [],
      analysisStartSeconds: model.analysisStartSeconds ?? 0, analysisDurationSeconds: model.analysisDurationSeconds ?? item.durationSeconds,
      validationStatus: model.validation?.status ?? null, validationIssues: (model.validation?.issues ?? []).map((i) => i.code),
    } : null;
    const input = {
      id: item.id, tier: item.tier, dataset: item.dataset, genreFamily: item.genreFamily, title: item.title,
      sha256: item.sha256, bytes: item.bytes, durationSeconds: item.durationSeconds, licence: item.licence,
      truthCoverage: lib.coverageOfItem(manifest, item.id),
      platform,
      rhythm: rhythm?.response ?? null,
      harmony: harmonyEvidence,
      latency: {
        platformAnalysisMs: api?.timings?.analysisMs ?? null,
        rhythmWorkerMs: rhythm?.wallMs ?? null,
        harmonyWorkerMs: harmonyEvidence?.timings?.total ? Math.round(harmonyEvidence.timings.total * 1000) : null,
      },
      failures,
    };
    const { row, trace } = lib.evaluateSong(input);
    row.platformSource = api ? { projectId: api.projectId ?? null, sourceId: api.sourceId ?? null, status: api.source?.status ?? null, error: api.source?.error ?? api.error ?? null, songModelVersion: model?.version ?? null, validation: platform?.validationStatus ?? null, issues: platform?.validationIssues ?? [] } : null;
    rows.push(row);
    traces[item.id] = trace;

    // single-witness arms, for the accuracy table
    for (const p of rhythm?.response?.providers ?? []) if (p.available && typeof p.tempoBpm === "number") (perProvider.tempo[p.provider] ??= {})[item.id] = { tempo: p.tempoBpm };
    for (const o of lib.platformObservations(platform?.reconciliation ?? null, "tempo")) (perProvider.tempo[o.provider] ??= {})[item.id] = { tempo: o.value };
    for (const o of lib.platformObservations(platform?.reconciliation ?? null, "key")) (perProvider.key[o.provider] ??= {})[item.id] = { key: o.value };
    const chroma = harmonyEvidence?.KEY_KRUMHANSL;
    if (chroma?.key) (perProvider.key.CHROMA ??= {})[item.id] = { key: `${chroma.key} ${chroma.scale}` };
    const chordKey = trace.keyObservations.find((o) => o.provider === "BTC_CHORD_KEY");
    if (chordKey) (perProvider.key.BTC_CHORD_KEY ??= {})[item.id] = { key: chordKey.value };
    const localSections = (platform?.sections ?? []).map((s) => s.startSeconds).filter((t) => typeof t === "number");
    if (localSections.length) (perProvider.sections.LOCAL_SIGNAL_ANALYZER_V1 ??= {})[item.id] = { sections: localSections };
    if (annotatorAgreements[item.id]) (perProvider.sections.HUMAN_ANNOTATOR_2 ??= {})[item.id] = { sections: annotatorAgreements[item.id].annotator2Boundaries };
  }

  const aggregate = lib.aggregateEndToEnd(rows);

  // --- accuracy, one tier at a time --------------------------------------------
  const arms = [
    { name: "platform path (resolved values only)", path: "platform", domains: ["tempo", "key"] },
    { name: "engine path (resolved values only)", path: "engine", domains: ["tempo", "key"] },
  ];
  const accuracy = {};
  for (const tier of lib.END_TO_END_TIERS) {
    const tierRows = rows.filter((row) => row.tier === tier);
    const tierIds = new Set(tierRows.map((row) => row.id));
    const extra = {};
    for (const [domain, byProvider] of Object.entries(perProvider)) {
      for (const [provider, predictions] of Object.entries(byProvider)) {
        const mine = Object.fromEntries(Object.entries(predictions).filter(([id]) => tierIds.has(id)));
        if (Object.keys(mine).length) extra[`${provider} alone (${domain})`] = { predictor: provider, items: mine };
      }
    }
    accuracy[tier] = lib.scoreTierRows(manifest, tierRows, tier, arms, extra);
    // Only the headline the arm was built for is meaningful for a single-witness arm.
    for (const arm of accuracy[tier].arms) {
      const match = /\((tempo|key|sections)\)$/.exec(arm.predictor);
      if (match) for (const domain of lib.GOLD_DOMAINS) if (domain !== match[1]) delete arm.domains[domain];
      delete arm.perItem;
    }
  }

  // --- spend and workers -------------------------------------------------------
  const spend = {
    model: { ...lib.MODAL_LIST_PRICES, shapes: lib.WORKER_SHAPES, note: "list-price estimate from container-seconds; Basic Pitch's seconds are bounded above by the API's analysis wall time; the Modal dashboard is the metered figure and other streams' workers ran on the same account during this run" },
    containerSeconds: aggregate.spend.containerSeconds,
    estimatedUsd: aggregate.spend.totalUsd,
    medianUsdPerSong: aggregate.spend.medianUsdPerSong,
    cap: 15,
  };

  const evidence = {
    id: "analysis-end-to-end-live",
    pr: "PR-90",
    title: "The Analysis Engine end to end on real songs (Analysis Engine wave, Stream J)",
    ranAt: new Date().toISOString(),
    version: lib.END_TO_END_VERSION,
    question: "What does the whole engine - Basic Pitch, the rhythm trackers, the harmony worker, the local analysers, the reconciliation and disagreement engine, the trust report - say per domain on real songs, and what still prevents it from being trusted automatically by the Arrangement Brain?",
    method: {
      paths: {
        platform: "POST /projects/:id/sources on a worktree API (PORT 5009, ANALYSIS_ASSET_PORT 5019 behind a quick tunnel), one dedicated dev project per song; Song Model read back with its trustReport. Basic Pitch on Modal (music-ai-worker) + LOCAL_SIGNAL_ANALYZER_V1 + TRANSCRIPTION_KEY_V1 + PR-86/89 reconciliation.",
        engine: "the same bytes through PR-84's rhythm-tournament-worker (BEAT_THIS, MADMOM, BEATNET, LIBROSA + onset envelope) and PR-85's harmony-acr-worker (BTC major/minor, BTC large vocabulary, chroma Krumhansl key, librosa beats), plus the platform's own observations read back from the stored reconciliation, judged by the shipped disagreement engine (judgeDomain / judgeChordBars / judgeSections, default thresholds and reliability) and PR-84's reconcileRhythm; trust report from the resulting field statuses.",
      },
      truth: "ANALYSIS_GOLD_V1 manifest (docs/evidence/analysis-real-eval-manifest.json): key + tempo from the GiantSteps datasets, sections from SALAMI annotator 1; every other domain and every ccMixter / owner song UNKNOWN. Tiers scored separately; contested and unknown songs make no prediction and are counted as such.",
      observationsReadBack: "platform observations are reconstructed from the stored reconciliation: exact for contested and single-source fields, an approximation (stored confidence per provider) for corroborated ones.",
      chordContest: "BTC symbols reduced to root + triad quality (maj/min/dim/aug/sus) per bar, longest-sounding chord per bar per vocabulary, bars from the rhythm engine's adopted downbeats; PR-85's labels: majmin -> CHROMA (0.85), large vocabulary -> SHEETSAGE (0.9); the chord-derived key witness BTC_CHORD_KEY carries the default reliability 0.35.",
      analysisWindow: "the platform analyses at most 300 s from the middle of a file; every song here is 120-294 s, so the window is the whole song.",
      workers: {
        rhythmTournamentWorker: { app: "rhythm-tournament-worker (deployed by PR-84, reused, still deployed)", imageEvidence: [...rhythmImages] },
        harmonyAcrWorker: { app: "harmony-acr-worker, ephemeral `modal run ::batch` (stopped when the run ended)", versions: [...harmonyVersions].map((v) => JSON.parse(v)) },
        basicPitch: { app: "music-ai-worker (deployed, reused)" },
      },
    },
    corpus: {
      songs: rows.length,
      byTier: aggregate.byTier,
      byDataset: aggregate.byDataset,
      audioLocation: ".corpus-data/analysis-real-eval/ (git-ignored); sha256 per song in `rows`",
      licences: Object.fromEntries(Object.entries(Object.groupBy(rows, (row) => row.dataset)).map(([dataset, group]) => [dataset, group[0].licence])),
      truthCoverage: Object.fromEntries(lib.END_TO_END_TIERS.map((tier) => [tier, lib.coverageTable(manifest, tier)])),
      annotatorAgreement: annotatorAgreements,
    },
    aggregate,
    accuracy,
    rows,
    engineTraces: traces,
    spend,
  };
  const outPath = resolve(repoRoot, flag("out", "docs/evidence/analysis-end-to-end-live.json"));
  const manifestOut = resolve(repoRoot, flag("manifest-out", "docs/evidence/analysis-real-eval-manifest.json"));
  writeLf(outPath, evidence);
  writeLf(manifestOut, manifest);
  log("wrote", outPath.replace(repoRoot, "").replace(/\\/g, "/"), "and", manifestOut.replace(repoRoot, "").replace(/\\/g, "/"));

  // --- the tables --------------------------------------------------------------
  const table = [];
  table.push(`songs ${rows.length}: ${JSON.stringify(aggregate.byDataset)}`);
  for (const path of lib.END_TO_END_PATHS) {
    table.push(`\n## ${path} path`);
    table.push("| domain | detected | low_confidence | contested | unknown | coverage | contest relations | providers |");
    table.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const domain of lib.END_TO_END_DOMAINS) {
      const d = aggregate.paths[path].domains[domain];
      table.push(`| ${domain} | ${d.counts.detected} | ${d.counts.low_confidence} | ${d.counts.contested} | ${d.counts.unknown} | ${d.coverage} | ${Object.entries(d.relations).map(([k, v]) => `${k} ${v}`).join(", ") || "-"} | ${Object.entries(d.providers).map(([k, v]) => `${k} ${v}`).join(", ") || "-"} |`);
    }
    table.push(`verdicts: ${JSON.stringify(aggregate.paths[path].verdicts)}`);
    table.push(`fields to confirm: ${JSON.stringify(aggregate.paths[path].fieldsToConfirm)}`);
    table.push(`top reasons: ${aggregate.paths[path].topReasons.slice(0, 12).map((r) => `${r.reason} (${r.songs})`).join("; ")}`);
  }
  table.push(`\nverdicts by dataset: ${JSON.stringify(aggregate.verdictsByDataset)}`);
  table.push(`rhythm engine: ${JSON.stringify(aggregate.rhythmEngine)}`);
  table.push(`latency ms: ${JSON.stringify(aggregate.latencyMs)}`);
  table.push(`spend: ${JSON.stringify(spend.containerSeconds)} => $${spend.estimatedUsd} (median $${spend.medianUsdPerSong}/song)`);
  table.push(`failures: ${JSON.stringify(aggregate.failures)}`);
  for (const tier of lib.END_TO_END_TIERS) {
    table.push(`\n## accuracy ${tier}`);
    if (!accuracy[tier].arms.some((arm) => Object.values(arm.domains).some((agg) => agg.itemsWithTruth))) table.push("- no human-verified truth on this tier: nothing is scored (agreement, contest rate, coverage, latency and cost only)");
    for (const arm of accuracy[tier].arms) {
      const parts = [];
      for (const [domain, agg] of Object.entries(arm.domains)) {
        if (!agg.itemsWithTruth) continue;
        parts.push(`${domain}: ${agg.mean} (${agg.itemsScored}/${agg.itemsWithTruth} scored${arm.contestedWithTruth[domain] ? `, ${arm.contestedWithTruth[domain]} contested` : ""}${arm.unknownWithTruth[domain] ? `, ${arm.unknownWithTruth[domain]} unknown` : ""}; ${Object.entries(agg.means).map(([k, v]) => `${k} ${v}`).join(", ")})`);
      }
      if (parts.length) table.push(`- ${arm.predictor}: ${parts.join(" | ")}`);
    }
  }
  const text = table.join("\n");
  writeFileSync(join(ensure(work), "report-tables.md"), text + "\n", "utf8");
  console.log(text);
}

const phases = { api: phaseApi, rhythm: phaseRhythm, harmony: phaseHarmony, report: phaseReport };
if (!phases[phase]) { console.error(`unknown phase ${phase}; one of ${Object.keys(phases).join(", ")}`); process.exit(2); }
await phases[phase]();
