/**
 * Build ANALYSIS_GOLD_V1 (ANALYSIS ENGINE wave, Stream H, PR-81).
 *
 *   node scripts/build-analysis-gold-v1.mjs [--pdmx <dir>] [--out .corpus-data/analysis-gold-v1]
 *        [--manifest docs/evidence/analysis-gold-v1-manifest.json] [--pdmx-works 28] [--per-family 3]
 *        [--composed-only] [--skip-render]
 *
 * Renders the SYNTHETIC_EXACT tier (composed works + PDMX works) to
 * git-ignored stems and mixes, and writes the committed manifest with every
 * item's truth inline. The REAL_AUDIO and PROFESSIONAL_REAL_WORLD tiers are
 * registered with empty truth and an annotation template — nothing in them
 * is invented here.
 */
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const outDir = resolve(repoRoot, flag("out", ".corpus-data/analysis-gold-v1"));
const manifestPath = resolve(repoRoot, flag("manifest", "docs/evidence/analysis-gold-v1-manifest.json"));
const pdmxWorks = Number(flag("pdmx-works", "28"));
const perFamily = Number(flag("per-family", "3"));
const skipRender = has("skip-render");
const composedOnly = has("composed-only");
const pdmxRootFlag = flag("pdmx", null);
const pdmxRoot = pdmxRootFlag
  ? resolve(repoRoot, pdmxRootFlag)
  : [resolve(repoRoot, ".pdmx-data"), resolve(repoRoot, "../AI-Music-Production-Platform-main/.pdmx-data")].find((p) => existsSync(join(p, "PDMX.csv"))) ?? null;

mkdirSync(outDir, { recursive: true });
const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");
const rel = (p) => relative(repoRoot, p).replace(/\\/g, "/");
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`.replace(/\r\n/g, "\n"));

// --- bundle the TS once -----------------------------------------------------
const esbuild = await import("esbuild");
const bundlePath = join(outDir, "analysis-gold-bundle.mjs");
await esbuild.build({
  entryPoints: [resolve(here, "./analysis-gold-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(pathToFileURL(bundlePath).href);

const builtAt = new Date().toISOString();
const items = [];
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

/** Render a work, write its files, return the item's audio block. */
function materialise(id, work) {
  const dir = join(outDir, id);
  mkdirSync(join(dir, "stems"), { recursive: true });
  const truthJson = `${JSON.stringify(work.truth, null, 2)}\n`;
  writeFileSync(join(dir, "truth.json"), truthJson);
  if (skipRender) return null;
  // Rendering is deterministic and slow (~25 s a work): a finished render of the
  // same truth is reused, so an interrupted build resumes where it stopped.
  const truthSha = sha256(truthJson);
  const cachePath = join(dir, "render.json");
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"));
    const filesIntact = cached.truthSha === truthSha && [cached.audio.mix, ...cached.audio.stems].every((f) => existsSync(resolve(repoRoot, f.path)) && sha256(readFileSync(resolve(repoRoot, f.path))) === f.sha256);
    if (filesIntact) { log(`  reused ${id} (render.json matches the truth and the files)`); return cached.audio; }
  }
  const started = performance.now();
  const rendered = lib.renderGoldWork(work);
  const mixPath = join(dir, "mix.wav");
  writeFileSync(mixPath, rendered.mix);
  const stems = rendered.stems.map((stem) => {
    const path = join(dir, "stems", `${stem.role.replace(/[^A-Za-z0-9_-]+/g, "_")}.wav`);
    writeFileSync(path, stem.wav);
    return { role: stem.role, family: stem.family, path: rel(path), sha256: stem.sha256, bytes: stem.wav.length };
  });
  log(`  rendered ${id}: ${rendered.durationSeconds}s, ${stems.length} stems, gain ${rendered.gainDb} dB, ${((performance.now() - started) / 1000).toFixed(1)}s`);
  const audio = {
    mix: { path: rel(mixPath), sha256: rendered.mixSha256, bytes: rendered.mix.length },
    stems,
    sampleRate: rendered.sampleRate,
    channels: rendered.channels,
    durationSeconds: rendered.durationSeconds,
    renderer: rendered.renderer,
  };
  writeJson(cachePath, { truthSha, gainDb: rendered.gainDb, audio });
  return audio;
}

// --- 1. composed works --------------------------------------------------------
log(`composing ${lib.COMPOSED_SPECS.length} works…`);
for (const spec of lib.COMPOSED_SPECS) {
  const work = lib.composeWork(spec);
  const audio = materialise(spec.id, work);
  items.push({
    id: spec.id,
    tier: "SYNTHETIC_EXACT",
    title: spec.title,
    genreFamily: spec.genreFamily,
    source: { kind: "composed", generator: "analysisGoldSynthetic.composeWork", spec: spec.id },
    audio,
    truth: work.truth,
    coverage: lib.coverageOf(work.truth),
    notes: `${spec.notes} Seed ${spec.seed}; tracks: ${work.tracks.map((t) => `${t.role} (${t.notes.length})`).join(", ")}.`,
  });
}

// --- 2. PDMX works --------------------------------------------------------------
const FAMILY_ORDER = ["pop", "rock", "folk", "jazz", "classical", "film_game", "electronic", "hiphop", "rnb_funk_soul", "country", "world_traditional", "religious_worship", "latin", "metal", "reggae_ska", "blues", "musical_theatre", "wind_band_marching"];
const pdmxSelection = { root: pdmxRoot ? rel(pdmxRoot) : null, csvRows: 0, candidates: 0, tried: 0, refusedByPdmxGold: 0, parseFailed: 0, chosen: 0, byFamily: {} };

if (!composedOnly && pdmxRoot) {
  log(`reading PDMX.csv from ${pdmxRoot}…`);
  const byFamily = new Map();
  const rl = createInterface({ input: createReadStream(join(pdmxRoot, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
  let index = null;
  for await (const line of rl) {
    if (index === null) { index = lib.csvHeaderIndex(line); continue; }
    pdmxSelection.csvRows += 1;
    const fields = lib.parseCsvLine(line);
    const row = lib.csvRowToMetadataRow(fields, index);
    if (!row || lib.pdmxRefusalReason(row) !== null) continue;
    const at = (column) => { const i = index.get(column); return i === undefined ? undefined : fields[i]; };
    const nTracks = Number(at("n_tracks"));
    const seconds = Number(at("song_length.seconds"));
    if (!(nTracks >= 3) || !(seconds >= 30 && seconds <= 150)) continue;
    const genre = lib.classifyPdmxGenre({ genres: at("genres"), tags: at("tags"), groups: at("groups") });
    if (genre.source !== "genres" || genre.primary === "unlabelled") continue;
    const list = byFamily.get(genre.primary) ?? [];
    list.push({ id: row.id, midiPath: row.midiPath, title: row.title, composer: row.composer, license: row.license, seconds, nTracks, family: genre.primary });
    byFamily.set(genre.primary, list);
    pdmxSelection.candidates += 1;
  }
  for (const list of byFamily.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  const families = FAMILY_ORDER.filter((f) => byFamily.has(f));
  const cursors = new Map(families.map((f) => [f, 0]));
  const taken = new Map(families.map((f) => [f, 0]));
  let chosen = 0;
  let progress = true;
  while (chosen < pdmxWorks && progress) {
    progress = false;
    for (const family of families) {
      if (chosen >= pdmxWorks) break;
      if (taken.get(family) >= perFamily) continue;
      const list = byFamily.get(family);
      while (cursors.get(family) < list.length) {
        const candidate = list[cursors.get(family)];
        cursors.set(family, cursors.get(family) + 1);
        pdmxSelection.tried += 1;
        const midiFile = join(pdmxRoot, "mid", candidate.midiPath.replace(/^\.\//, ""));
        if (!existsSync(midiFile)) continue;
        const bytes = readFileSync(midiFile);
        let midi;
        try { midi = lib.parseMidiFile(bytes); } catch { pdmxSelection.parseFailed += 1; continue; }
        const result = lib.pdmxGold(midi, { maxSeconds: 90, minSeconds: 30 });
        if (!result) { pdmxSelection.refusedByPdmxGold += 1; continue; }
        const id = `pdmx-${family}-${candidate.id.slice(0, 12)}`;
        const audio = materialise(id, result);
        items.push({
          id,
          tier: "SYNTHETIC_EXACT",
          title: candidate.title ?? candidate.id,
          genreFamily: family,
          source: {
            kind: "pdmx", pdmxId: candidate.id, midiPath: candidate.midiPath, title: candidate.title, composer: candidate.composer, license: candidate.license,
            windowSeconds: result.endSeconds, trimmed: result.trimmed, fullEndSeconds: result.fullEndSeconds, midiSha256: sha256(bytes),
            written: result.written,
          },
          audio,
          truth: result.truth,
          coverage: lib.coverageOf(result.truth),
          notes: `Human-written score from PDMX (${family}); notes, tempo map, written metre, beats and downbeats are exact from the file. Key signature ${result.keySignatureFifths === null ? "absent or changing" : `${result.keySignatureFifths} fifths`} with no trustworthy mode; no chord symbols, no markers.${result.trimmed ? ` Trimmed at a downbeat to ${result.endSeconds}s of ${result.fullEndSeconds}s.` : ""}`,
        });
        taken.set(family, taken.get(family) + 1);
        chosen += 1;
        progress = true;
        break;
      }
    }
  }
  pdmxSelection.chosen = chosen;
  for (const [f, n] of taken) if (n) pdmxSelection.byFamily[f] = n;
  log(`PDMX: ${chosen} works chosen of ${pdmxSelection.tried} tried (${pdmxSelection.refusedByPdmxGold} refused by pdmxGold, ${pdmxSelection.parseFailed} parse failures)`);
} else if (!composedOnly) {
  log("no PDMX corpus found; the PDMX half of the synthetic tier is empty");
}

// --- 3. REAL_AUDIO: the platform's own fixture, truth UNKNOWN until a person verifies it ----
const fixturePath = resolve(repoRoot, "services/beat-this-worker/fixtures/real-audio-source.mp3");
if (existsSync(fixturePath)) {
  const bytes = readFileSync(fixturePath);
  items.push({
    id: "real-pr46-fixture",
    tier: "REAL_AUDIO",
    title: "PR-46 real-audio fixture (services/beat-this-worker/fixtures/real-audio-source.mp3)",
    genreFamily: "UNKNOWN",
    source: {
      kind: "repo_fixture", path: rel(fixturePath), bytes: bytes.length, sha256: sha256(bytes),
      licenceNote: "The repository records no provenance or licence for this recording beyond 'a real recording already in the repository' (PR-46). It is used here only as an in-repo evaluation fixture, exactly as the beat-this isolation tests use it; it is not redistributed by this manifest.",
    },
    audio: null,
    truth: lib.EMPTY_TRUTH,
    coverage: lib.coverageOf(lib.EMPTY_TRUTH),
    notes: "212.457 s, 44.1 kHz stereo MP3 (PR-46 evidence). No rights-clear real-audio-with-annotations source is on disk: docs/evidence/data-source-registry.json (PR-76) lists MUSDB18, MoisesDB, MedleyDB and MAESTRO as BLOCKED_LICENSE and MIRTracks / ccMixter / Cambridge-MT as LEGAL_REVIEW_REQUIRED, all NOT_FETCHED. Every field below is UNKNOWN until a person fills it; the platform's own estimates are listed only so the annotator knows what to check.",
    annotationTemplate: {
      instructions: "Fill each field by listening and measuring (a tap-tempo or a DAW grid, a chord chart per bar). Set status to HUMAN_VERIFIED only for what you checked; leave everything else UNKNOWN. Never copy the platform estimate into the value.",
      fields: {
        tempoBpm: { value: null, status: "UNKNOWN", platformEstimate: 60.6, how: "LOCAL_SIGNAL_ANALYZER_V1 onset autocorrelation (PR-46); half/double ambiguity unresolved" },
        metre: { value: null, status: "UNKNOWN", platformEstimate: "4/4", how: "assumed, not measured (ASSUMED_METER, confidence 0.3)" },
        key: { value: null, status: "UNKNOWN", platformEstimate: "A minor", how: "TRANSCRIPTION_KEY_V1 from 1,876 Basic Pitch events, confidence 0.473" },
        sections: { value: null, status: "UNKNOWN", platformEstimate: "7 sections over 53 bars", how: "energy-novelty sketch on an assumed 4/4 grid" },
        chordSheetPerBar: { value: null, status: "UNKNOWN", platformEstimate: null, how: "no chord provider ran; chords: 0 in PR-46" },
        beatsCount: { value: null, status: "UNKNOWN", platformEstimate: 215, how: "derived from the local tempo, not tracked" },
      },
    },
  });
}

// --- 4. PROFESSIONAL_REAL_WORLD: the owner's uploads, empty truth ------------------------
// Registry facts below were read on 2026-09-10 from the dev database (Neon host in
// .env.local, reachable from this machine) with read-only SELECTs on
// `music_project_sources` and `music_song_models`; nothing was written. The store
// keeps no checksum column and the uploaded objects are not on this machine, so
// every sha256 is UNKNOWN. The platform estimates are quoted from the latest
// `ready` song model of each source so the annotator knows what to check; they
// are not truth, and neither is anything the owner said without measuring.
const ownerProject = "d519492a-e299-4401-9cb4-f8618902fc0a";
const ownerRegistry = "read-only SELECT on music_project_sources and music_song_models, 2026-09-10";
const ownerTemplate = (extra) => ({
  instructions: "For the owner (or a musician the owner trusts): tempo (BPM, and whether it changes), metre, key (name both candidates if it modulates), section boundaries with timestamps and labels, and a chord sheet per bar with slash basses. Mark each field HUMAN_VERIFIED only once checked against the recording (a tap tempo or a DAW grid, a chord chart per bar); leave the rest UNKNOWN. Never copy a platform estimate or an owner claim into the value.",
  fields: {
    tempoBpm: { value: null, status: "UNKNOWN", ...(extra.tempo ?? {}) },
    metre: { value: null, status: "UNKNOWN", ...(extra.metre ?? {}) },
    key: { value: null, status: "UNKNOWN", ...(extra.key ?? {}) },
    sections: { value: null, status: "UNKNOWN", ...(extra.sections ?? {}) },
    chordSheetPerBar: { value: null, status: "UNKNOWN", platformEstimate: null, how: "no harmony provider returned chord events (chords: 0 in the song model)" },
    beatsCount: { value: null, status: "UNKNOWN", ...(extra.beats ?? {}) },
  },
});
items.push({
  id: "owner-shmulik-sukkot-beota-hashaa",
  tier: "PROFESSIONAL_REAL_WORLD",
  title: "שמוליק סוכות - באותה השעה.mp3",
  genreFamily: "UNKNOWN",
  source: {
    kind: "owner_upload", projectId: ownerProject, fileName: "שמוליק סוכות - באותה השעה.mp3",
    sourceId: "22c9d6c1-03ab-4551-912f-ea717fa61a94",
    duplicateSourceIds: ["c0e96a0c-f635-4a9a-9d14-a27266571a02", "3c31603f-4a56-4a4e-8a6b-b8a1ac77c8ee"],
    bytes: 9537791, durationSeconds: 230.1791, sampleRate: 44100, channels: 2, sha256: "UNKNOWN",
    songModelId: "3b7c1a01-e148-4dd1-9cc8-e9eba8695031", registeredFrom: ownerRegistry,
  },
  audio: null,
  truth: lib.EMPTY_TRUTH,
  coverage: lib.coverageOf(lib.EMPTY_TRUTH),
  notes: "Owner upload in the dev database (project d519492a…): the same 9,537,791-byte MP3 was uploaded four times (three rows `ready`, one `failed` with 'Key analysis is required'); the earliest ready row is the source id and the other two are listed as duplicates. Every ready row's song model reached the same estimates (confidence 0.474). Truth is empty by design: the owner fills the template.",
  annotationTemplate: ownerTemplate({
    tempo: { platformEstimate: 78.1, how: "LOCAL_SIGNAL_ANALYZER_V1 onset envelope, confidence 0.36, no provider corroborated it; half/double unresolved" },
    metre: { platformEstimate: "4/4", how: "assumed, not measured (confidence 0.3)" },
    key: { platformEstimate: "Eb minor", how: "TRANSCRIPTION_KEY_V1 from 1,802 Basic Pitch events on the full mix (correlation 0.8204, margin 0.1887), confidence 0.365; one provider only" },
    sections: { platformEstimate: "6 sections over 74 bars (Intro 1, Verse 15, Chorus 20, Verse 2 40, Chorus 2 53, Outro 72)", how: "bar-energy sketch on an assumed 4/4 grid at 78.1 BPM, confidence 0.35" },
    beats: { platformEstimate: 300, how: "a grid derived from the local tempo, not tracked" },
  }),
});
items.push({
  id: "owner-mendy-weiss-uleorer-libi",
  tier: "PROFESSIONAL_REAL_WORLD",
  title: "מענדי וויס, חיים פולק, מקהלת מלכות - ולעורר ליבי.mp3",
  genreFamily: "UNKNOWN",
  source: {
    kind: "owner_upload", projectId: ownerProject, fileName: "מענדי וויס, חיים פולק, מקהלת מלכות - ולעורר ליבי.mp3",
    sourceId: "3108652e-975d-44fd-9bd6-16ac77357922",
    duplicateSourceIds: ["ff73845c-955e-4807-b297-bec5d914e06c", "50e8dbbe-cf45-49d5-96e1-570f533b6b6f"],
    bytes: 10531610, durationSeconds: 259.719796, sampleRate: 44100, channels: 2, sha256: "UNKNOWN",
    songModelId: "3db1196c-aa3c-4899-a7c6-aee94305208b", registeredFrom: ownerRegistry,
  },
  audio: null,
  truth: lib.EMPTY_TRUTH,
  coverage: lib.coverageOf(lib.EMPTY_TRUTH),
  notes: "Owner upload in the dev database: three rows of the same 10,531,610-byte MP3, one `ready` (the source id; its song model is version 4 after two failed attempts) and two `failed` ('Key analysis is required'), listed as duplicates. The key is CONTESTED between two platform analyses (PR-86); neither is truth. The owner has said the tempo is around 115 BPM — recorded as an UNVERIFIED owner claim on the tempo field, not as truth. The owner settles both by listening.",
  annotationTemplate: ownerTemplate({
    key: { platformEstimate: ["Eb major (TRANSCRIPTION_KEY_V1, 0.345; from 1,769 Basic Pitch events, correlation 0.765, margin 0.1555)", "G minor (LOCAL_SIGNAL_ANALYZER_V1, 0.32)"], how: "two independent analyses disagree (PR-86, fieldStatus.key = contested); Eb major and G minor share Eb, G and Bb — the recording may sit in either, or modulate" },
    tempo: {
      platformEstimate: 64.8,
      how: "LOCAL_SIGNAL_ANALYZER_V1 onset envelope, confidence 0.374, no provider corroborated it; half/double unresolved",
      ownerClaim: {
        value: 115,
        status: "UNVERIFIED_OWNER_CLAIM",
        statedOn: "2026-09-10",
        note: "The owner says the song is 'around 115 BPM'. How the figure was arrived at (by ear, from a chart, or measured) is not recorded, so it is a claim to check against the recording, not truth. 115 / 64.8 = 1.775, which is neither 1 nor 2: if the owner is right, the local analyser is not merely half-tempo here — it is wrong (its ±4 % windows would be 57.5–62.3 for half and 110.4–119.6 for exact).",
      },
    },
    metre: { platformEstimate: "4/4", how: "assumed, not measured (confidence 0.3)" },
    sections: { platformEstimate: "6 sections over 70 bars (Intro 1, Chorus 5, Verse 11, Chorus 2 19, Verse 2 38, Outro 68)", how: "bar-energy sketch on an assumed 4/4 grid at 64.8 BPM, confidence 0.35" },
    beats: { platformEstimate: 281, how: "a grid derived from the local tempo, not tracked" },
  }),
});

// --- 5. manifest ----------------------------------------------------------------
const manifest = {
  version: lib.ANALYSIS_GOLD_VERSION,
  builtAt,
  builder: "artifacts/api-server/scripts/build-analysis-gold-v1.mjs",
  renderer: items.find((i) => i.audio)?.audio.renderer ?? (skipRender ? "not rendered (--skip-render)" : "n/a"),
  audioRoot: rel(outDir),
  audioNote: "Audio lives under .corpus-data/analysis-gold-v1/ (git-ignored); paths are repo-relative; every WAV is stereo 16-bit 44.1 kHz and each mix is the exact sum of its stems (one shared gain).",
  truthNote: "truth.notes.tracks[].notes are [start s, duration s, MIDI pitch, velocity]. Coverage per domain: EXACT (by construction, synthetic only), PARTIAL (a written key signature without its mode), HUMAN_VERIFIED (real tiers, a person checked it), UNKNOWN (no truth; the scorer refuses the domain).",
  pdmx: pdmxSelection,
  tiers: {},
  items,
};
for (const tier of lib.GOLD_TIERS) {
  const tierItems = items.filter((i) => i.tier === tier);
  manifest.tiers[tier] = {
    count: tierItems.length,
    genreFamilies: Object.fromEntries([...new Set(tierItems.map((i) => i.genreFamily))].map((f) => [f, tierItems.filter((i) => i.genreFamily === f).length])),
    totalAudioSeconds: Number(tierItems.reduce((s, i) => s + (i.audio?.durationSeconds ?? 0), 0).toFixed(1)),
    coverage: lib.coverageTable(manifest, tier),
  };
}
const problems = lib.validateManifest(manifest);
if (problems.length) {
  console.error("manifest is not well-formed:\n  " + problems.join("\n  "));
  process.exit(1);
}
mkdirSync(dirname(manifestPath), { recursive: true });
writeJson(manifestPath, manifest);
log(`manifest written: ${rel(manifestPath)} (${items.length} items; ${Object.entries(manifest.tiers).map(([t, v]) => `${t}=${v.count}`).join(", ")})`);
