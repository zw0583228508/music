/**
 * Reading the real PDMX table (Wave Q, Q-05 Tier A).
 *
 * `PDMX.csv` is 225 MB and 62 columns wide. This maps one of its rows onto the
 * `PdmxMetadataRow` the rights gate in `pdmxIngest.ts` reads, and does nothing
 * else — admission stays in one place.
 *
 * Two things the table does not contain, and which are therefore not invented
 * here:
 *
 *  - **No time signature.** Meter lives in the MIDI files, not the table. A row
 *    read from the CSV alone carries no meter, and the corpus entry says
 *    `unknown` rather than the 4/4 that would be true of most of the dataset
 *    and false for the entries that matter most.
 *  - **No pitch-class count.** The table publishes `pitch_class_entropy`
 *    instead. Its perplexity, `2 ** entropy`, is the effective number of pitch
 *    classes in use — a real quantity, and the honest translation of the one
 *    the table actually measured.
 *
 * Tempo is derived, not read: `beats / seconds × 60`. That is arithmetic on two
 * published fields, not an estimate.
 */
import type { PdmxMetadataRow } from "./pdmxIngest";

/** A tempo outside this band is a data artefact, not a pulse. */
export const MIN_PLAUSIBLE_BPM = 30;
export const MAX_PLAUSIBLE_BPM = 300;

/** The columns this platform reads. The other 40-odd are ignored, not trusted. */
export const PDMX_CSV_COLUMNS = [
  "path", "mid", "license", "license_url", "license_conflict",
  "subset:no_license_conflict", "genres", "song_name", "title", "composer_name",
  "n_tracks", "song_length.seconds", "song_length.bars", "song_length.beats",
  "notes_per_bar", "pitch_class_entropy",
] as const;

/**
 * One CSV line into fields, honouring quoted fields that contain commas.
 *
 * PDMX song titles contain commas and quotes, and splitting on "," turns a row
 * into garbage that still parses — which is worse than failing.
 */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const character = line[i];
    if (quoted) {
      if (character === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') { current += '"'; i += 1; }
        else quoted = false;
      } else current += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") { fields.push(current); current = ""; }
    else current += character;
  }
  fields.push(current);
  return fields;
}

/** Column name to index, from the header line. */
export function csvHeaderIndex(headerLine: string): Map<string, number> {
  const index = new Map<string, number>();
  parseCsvLine(headerLine).forEach((name, position) => index.set(name.trim(), position));
  return index;
}

/** Why this header cannot be read, or null when it can. */
export function headerRefusalReason(index: Map<string, number>): string | null {
  const missing = PDMX_CSV_COLUMNS.filter((column) => !index.has(column));
  return missing.length
    ? `PDMX.csv is missing the column(s) this pipeline reads: ${missing.join(", ")}`
    : null;
}

const number = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NA" || trimmed === "nan") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const text = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed !== "NA" ? trimmed : undefined;
};

/**
 * A stable id for a work, taken from the content-addressed path PDMX itself
 * uses. Deriving it from the row's own identifier keeps a corpus entry
 * traceable back to the exact file.
 */
export function pdmxIdFromPath(path: string | undefined): string | undefined {
  const match = /([A-Za-z0-9]{20,})\.(?:mid|mxl|json|pdf)$/.exec(path ?? "");
  return match ? match[1] : undefined;
}

export type PdmxCsvRow = PdmxMetadataRow & {
  /** Path to the MIDI inside mid.tar.gz, relative to its root. */
  midiPath?: string;
  /** The authors' own subset membership, kept separate from our reading of it. */
  inNoLicenseConflictSubset?: boolean;
  composer?: string;
  /** MuseScore's "artist" field as published: a composer, a category ("Misc Traditional") or the uploader's handle. Read when the column exists, never required. */
  artist?: string;
  /** Uploader tags and community groups, hyphen-joined as published; read when the column exists, never required. */
  tags?: string;
  groups?: string;
  /** GM programs per track as published (`0-25-33`); the table does not mark the drum kit. */
  trackPrograms?: number[];
};

/**
 * One CSV row as the rights gate reads it.
 *
 * Returns null for a row with no usable identifier: a work this pipeline cannot
 * point at is a work it cannot cite, and an uncitable entry has no place in a
 * rights-cleared corpus.
 */
export function csvRowToMetadataRow(
  fields: string[],
  index: Map<string, number>,
): PdmxCsvRow | null {
  const at = (column: string): string | undefined => {
    const position = index.get(column);
    return position === undefined ? undefined : fields[position];
  };

  const midiPath = text(at("mid"));
  const id = pdmxIdFromPath(midiPath) ?? pdmxIdFromPath(text(at("path")));
  if (!id) return null;

  const seconds = number(at("song_length.seconds"));
  const beats = number(at("song_length.beats"));
  const derived = seconds && beats && seconds > 0 ? (beats / seconds) * 60 : undefined;
  // The published beat count and duration do not agree on a tempo for every
  // row: real entries in this table divide out to 396 and 640 BPM. Whatever
  // "beats" counts there, it is not the notated pulse. A number outside what a
  // human plays is not a tempo, and passing it on would band the corpus by an
  // artefact — so it is dropped rather than trusted.
  const tempo = derived !== undefined && derived >= MIN_PLAUSIBLE_BPM && derived <= MAX_PLAUSIBLE_BPM
    ? derived
    : undefined;

  const entropy = number(at("pitch_class_entropy"));
  // Perplexity of the pitch-class distribution: the effective number of pitch
  // classes actually in use. The table measures entropy; this is its honest
  // translation into the count the corpus attributes are defined over.
  const effectivePitchClasses = entropy === undefined ? undefined : 2 ** entropy;

  const genres = text(at("genres"));

  return {
    id,
    title: text(at("song_name")) ?? text(at("title")),
    license: text(at("license")),
    url: text(at("license_url")),
    license_conflict: text(at("license_conflict")),
    // Deliberately absent: the table carries no time signature. See the module
    // comment — a default of 4/4 here would be a fabrication.
    time_signature: undefined,
    tempo,
    n_tracks: number(at("n_tracks")),
    n_pitch_classes: effectivePitchClasses,
    notes_per_bar: number(at("notes_per_bar")),
    genres,
    midiPath,
    inNoLicenseConflictSubset: text(at("subset:no_license_conflict"))?.toLowerCase() === "true",
    composer: text(at("composer_name")),
    artist: text(at("artist_name")),
    tags: text(at("tags")),
    groups: text(at("groups")),
    trackPrograms: text(at("tracks"))?.split("-").map(Number).filter((n) => Number.isInteger(n) && n >= 0),
  };
}

/**
 * Whether our own rights reading agrees with the authors' subset flag.
 *
 * They are computed independently — ours from `license_conflict` plus the
 * licence statement, theirs from `subset:no_license_conflict` — and a
 * disagreement is worth surfacing rather than silently trusting either. A row
 * we admit that their subset excludes is the dangerous direction.
 */
export function subsetAgreement(
  row: PdmxCsvRow,
  admittedByOurGate: boolean,
): "agree" | "we_admit_they_exclude" | "we_exclude_they_admit" {
  const theirs = row.inNoLicenseConflictSubset === true;
  if (admittedByOurGate === theirs) return "agree";
  return admittedByOurGate ? "we_admit_they_exclude" : "we_exclude_they_admit";
}
