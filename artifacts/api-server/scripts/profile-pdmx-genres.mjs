/**
 * What PDMX actually contains outside classical (Wave Q — Model Discovery, global tournament).
 *
 *   node scripts/profile-pdmx-genres.mjs [--target .pdmx-data] [--out docs/evidence/pdmx-genre-profile.json]
 *        [--no-parse] [--parse-classical-sample 300]
 *
 * Reads the real PDMX.csv, admits works exactly as the tournament does (our
 * rights gate ∩ the authors' no_license_conflict subset), classifies every
 * admitted row with `classifyPdmxGenre`, and counts per genre family — all
 * works, multitrack works (n_tracks ≥ 3), label source — plus instrument
 * availability. The table's `tracks` column carries GM programs but does not
 * mark the drum kit (a kit is a channel-10 fact inside the MIDI), so drum
 * availability comes from parsing the MIDIs of the labelled non-classical
 * multitrack works, all of them, and a fixed-size sample of the classical ones.
 *
 * The script counts; it never fetches anything and never copies a file.
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");

const esbuild = await import("esbuild");
const bundlePath = join(tmpdir(), `pdmx-genre-profile-${process.pid}.mjs`);
await esbuild.build({
  entryPoints: [resolve(here, "./tournament-entry.ts")],
  outfile: bundlePath, bundle: true, platform: "node", format: "esm", logLevel: "error",
  alias: { "@workspace/db": resolve(here, "../src/lib/musicProviders.testDbStub.ts") },
});
await esbuild.stop?.();
const lib = await import(`file:///${bundlePath.replace(/\\/g, "/")}`);
await rm(bundlePath, { force: true });

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const target = resolve(repoRoot, flag("target", ".pdmx-data"));
const outPath = resolve(repoRoot, flag("out", "docs/evidence/pdmx-genre-profile.json"));
const parseMidi = !args.includes("--no-parse");
const classicalSample = Number(flag("parse-classical-sample", "300"));
const MULTITRACK_MIN = 3;

// --- 1. the table, admitted rows only -----------------------------------------
console.log("reading PDMX.csv…");
const authorsAdmitted = new Set(
  readFileSync(join(target, "subset_paths/no_license_conflict.txt"), "utf8").split(/\r?\n/)
    .map((p) => lib.pdmxIdFromPath(p.trim())).filter(Boolean),
);
const rows = new Map(); // id → { genre, nTracks, programs, midiPath }
let total = 0;
let index = null;
const csv = createInterface({ input: createReadStream(join(target, "PDMX.csv"), { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of csv) {
  if (index === null) { index = lib.csvHeaderIndex(line); continue; }
  if (!line.trim()) continue;
  total += 1;
  const row = lib.csvRowToMetadataRow(lib.parseCsvLine(line), index);
  if (!row || lib.pdmxRefusalReason(row) !== null || !authorsAdmitted.has(row.id)) continue;
  rows.set(row.id, {
    genre: lib.classifyPdmxGenre({ genres: row.genres, tags: row.tags, groups: row.groups }),
    nTracks: row.n_tracks ?? 0,
    programs: row.trackPrograms ?? [],
    midiPath: row.midiPath,
  });
}
console.log(` ${total} rows, ${rows.size} admitted`);

// --- 2. counts per family -------------------------------------------------------
const families = lib.GENRE_FAMILIES;
const zero = () => Object.fromEntries(families.map((f) => [f, 0]));
const counts = {
  worksAnyFamily: zero(), worksPrimary: zero(),
  multitrackAnyFamily: zero(), multitrackPrimary: zero(),
};
const labelSource = { all: { genres: 0, tags: 0, none: 0 }, multitrack: { genres: 0, tags: 0, none: 0 } };
const rawGenreCells = new Map();
const CSV_INSTRUMENT_FAMILIES = ["keys", "organ", "guitar", "bass", "strings", "ensemble", "brass", "reed", "pipe", "synth"];
const csvInstrument = {}; // primary family → instrument family → multitrack works having ≥1 such track
for (const f of families) csvInstrument[f] = Object.fromEntries(CSV_INSTRUMENT_FAMILIES.map((i) => [i, 0]));
let multitrack = 0;
for (const { genre, nTracks, programs } of rows.values()) {
  labelSource.all[genre.source] += 1;
  counts.worksPrimary[genre.primary] += 1;
  for (const f of genre.families) counts.worksAnyFamily[f] += 1;
  if (nTracks < MULTITRACK_MIN) continue;
  multitrack += 1;
  labelSource.multitrack[genre.source] += 1;
  counts.multitrackPrimary[genre.primary] += 1;
  for (const f of genre.families) counts.multitrackAnyFamily[f] += 1;
  if (genre.genres) rawGenreCells.set(genre.genres, (rawGenreCells.get(genre.genres) ?? 0) + 1);
  const present = new Set(programs.map((p) => lib.familyOf({ program: p, isPercussion: false })));
  for (const i of CSV_INSTRUMENT_FAMILIES) if (present.has(i)) csvInstrument[genre.primary][i] += 1;
}

// --- 3. instrument availability from the MIDIs themselves ------------------------
const MIDI_FAMILIES = ["drums", "bass", "guitar", "keys", "synth", "organ", "strings", "brass", "reed", "pipe", "ensemble"];
let parsed = null;
if (parseMidi) {
  console.log("indexing MIDI files…");
  const fileById = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".mid")) fileById.set(lib.pdmxIdFromPath(full), full);
    }
  };
  walk(join(target, "mid"));
  const nonClassical = [];
  const classical = [];
  for (const [id, r] of rows) {
    if (r.nTracks < MULTITRACK_MIN || !fileById.has(id)) continue;
    const isClassical = r.genre.families.includes("classical");
    if (r.genre.primary === "unlabelled") continue;
    (isClassical ? classical : nonClassical).push({ id, ...r, file: fileById.get(id) });
  }
  // Deterministic classical sample: every k-th in id order.
  classical.sort((a, b) => a.id.localeCompare(b.id));
  const step = Math.max(1, Math.floor(classical.length / classicalSample));
  const classicalPicked = classical.filter((_, i) => i % step === 0).slice(0, classicalSample);
  const toParse = [...nonClassical, ...classicalPicked];
  console.log(` parsing ${nonClassical.length} labelled non-classical multitrack works + ${classicalPicked.length} of ${classical.length} classical…`);
  parsed = { perFamily: {}, unparseable: 0, nonClassicalWorks: nonClassical.length, classicalSampled: classicalPicked.length, classicalMultitrack: classical.length };
  for (const f of families) parsed.perFamily[f] = { works: 0, threePlusPrograms: 0, ...Object.fromEntries(MIDI_FAMILIES.map((i) => [i, 0])) };
  let done = 0;
  for (const work of toParse) {
    let midi;
    try { midi = lib.parseMidiFile(readFileSync(work.file)); } catch { parsed.unparseable += 1; continue; }
    const programs = new Set(midi.notes.map((n) => (n.isPercussion ? lib.DRUMS_PROGRAM : n.program)));
    const present = new Set([...programs].map((p) => (p === lib.DRUMS_PROGRAM ? "drums" : lib.familyOf({ program: p, isPercussion: false }))));
    const bucket = parsed.perFamily[work.genre.primary];
    bucket.works += 1;
    if (programs.size >= 3) bucket.threePlusPrograms += 1;
    for (const i of MIDI_FAMILIES) if (present.has(i)) bucket[i] += 1;
    done += 1;
    if (done % 1000 === 0) console.log(`  ${done}/${toParse.length}`);
  }
}

// --- 4. what is missing, and where it could come from (recorded, not fetched) ----
const missing = families
  .filter((f) => f !== "classical" && f !== "unlabelled")
  .map((f) => ({ family: f, multitrackPrimary: counts.multitrackPrimary[f], multitrackAnyFamily: counts.multitrackAnyFamily[f] }))
  .filter((f) => f.multitrackPrimary < 30);

const evidence = {
  title: "PDMX genre profile — what the cleared corpus contains outside classical (Wave Q — Model Discovery, global tournament)",
  ranAt: new Date().toISOString(),
  source: { csv: "PDMX.csv", subset: "no_license_conflict ∩ our gate", rows: total, admittedWorks: rows.size, multitrackMinTracks: MULTITRACK_MIN, multitrackWorks: multitrack },
  method: {
    classifier: "classifyPdmxGenre (pdmxGenre.ts): the `genres` column decides the primary family; `tags` and `groups` add families by exact token match and are the only source for latin and musical theatre; a row with no known token is `unlabelled`, never guessed.",
    familyOrder: families,
    slugMap: lib.GENRE_SLUG_FAMILY,
    csvInstrumentNote: "The table's `tracks` column lists GM programs but does not mark the drum kit; drum availability is only in `midiParsed`.",
  },
  labelSource,
  counts,
  rawGenreCellsMultitrack: Object.fromEntries([...rawGenreCells.entries()].sort((a, b) => b[1] - a[1])),
  csvInstrumentAvailability: { note: "multitrack works whose `tracks` column lists ≥ 1 program of that family, by primary genre family", perPrimaryFamily: csvInstrument },
  midiParsed: parsed,
  thinOrMissingFamilies: missing,
  candidateAdditionalSources: [
    { family: "pop / rock / metal (multitrack with drums)", source: "Lakh MIDI Dataset (LMD)", licence: "no per-work rights; scraped MIDI of copyrighted songs", verdict: "REFUSED — not commercially clearable; also the provenance taint named in the decision report" },
    { family: "pop / rock / electronic", source: "MetaMIDI / MMD", licence: "same class as Lakh", verdict: "REFUSED" },
    { family: "pop / rock / jazz / folk", source: "MuseScore.com works outside PDMX's no_license_conflict subset", licence: "mixed; the authors excluded them because public licence and file metadata disagree", verdict: "REFUSED — the same gate that admits PDMX must refuse them" },
    { family: "latin / world_traditional / folk", source: "IMSLP / CPDL public-domain arrangements with explicit PD or CC0 statements", licence: "per-work PD/CC0 where stated", verdict: "POSSIBLE — needs a per-work rights record before any download; mostly single-part or vocal, so multitrack yield unknown" },
    { family: "jazz / musical_theatre (lead sheets)", source: "Wikifonia-derived lead-sheet corpora", licence: "withdrawn; copyrighted songs", verdict: "REFUSED" },
    { family: "electronic / synth / drums", source: "Groove MIDI Dataset (Magenta, drums only)", licence: "CC BY 4.0", verdict: "POSSIBLE for drum-only targets; contains no harmonic context, so it cannot make a tournament task by itself" },
    { family: "electronic / pop (multitrack)", source: "Slakh2100 (Lakh-derived)", licence: "CC BY 4.0 on the renders, but the MIDI is Lakh", verdict: "REFUSED — inherits Lakh's rights problem" },
    { family: "world_traditional / folk (melody + chords)", source: "Nottingham Music Database / ABC folk corpora", licence: "PD tunes; ABC files variously PD or unstated", verdict: "POSSIBLE — melody + chord symbols only, needs an arrangement step to become multitrack; record per-file rights first" },
    { family: "pop / rock (commercially licensed stems as MIDI)", source: "Operator-licensed sample/MIDI packs (Splice-class)", licence: "commercial licence to the operator; redistribution prohibited", verdict: "POSSIBLE for private benchmark tasks only; never for a published evidence directory" },
  ],
  honestLimits: [
    "Genre labels are MuseScore uploaders' own; `pop` on MuseScore is often a piano-vocal transcription of a pop song, not a band arrangement. The instrument availability tables say what the files hold.",
    "Tag tokens are matched exactly; a tag the map does not know leaves a work unlabelled. Recall on latin and musical theatre is therefore a floor, not a count.",
    "`n_tracks ≥ 3` from the table is not the tournament's `≥ 3 distinct GM programs` rule; `midiParsed.threePlusPrograms` is the number that rule admits.",
  ],
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);

console.log("\nmultitrack works by primary family (any-family count in brackets):");
for (const f of families) console.log(`  ${f.padEnd(20)} ${String(counts.multitrackPrimary[f]).padStart(6)}  [${counts.multitrackAnyFamily[f]}]`);
if (parsed) {
  console.log("\nMIDI-parsed availability (works with ≥1 track of the family), by primary genre:");
  console.log(`  ${"family".padEnd(20)} ${["works", "3+prog", ...MIDI_FAMILIES].map((h) => h.padStart(7)).join("")}`);
  for (const f of families) {
    const b = parsed.perFamily[f];
    if (!b.works) continue;
    console.log(`  ${f.padEnd(20)} ${[b.works, b.threePlusPrograms, ...MIDI_FAMILIES.map((i) => b[i])].map((v) => String(v).padStart(7)).join("")}`);
  }
}
console.log(`\nprofile → ${outPath}`);
