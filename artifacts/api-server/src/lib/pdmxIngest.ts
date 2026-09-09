/**
 * PDMX ingestion (Wave Q, Q-00 and Q-05 Tier A).
 *
 * PDMX is a public-domain symbolic corpus. Its own authors found licence
 * discrepancies inside it and recommend the `no_license_conflict` subset —
 * the rows where the public-facing copyright data and the file's internal
 * metadata agree. This module admits **only** those rows, and records the
 * basis per work rather than per dataset, because a dataset's licence is not
 * proof of rights in the works inside it.
 *
 * What PDMX can and cannot be:
 *
 *  - It **is** the training backbone (Q-05 Tier A) and the `midi` slice of the
 *    benchmark corpus (Q-00).
 *  - It is **not** the recorded-audio slices of Q-00. PDMX holds scores, not
 *    recordings; a full-song, piano-vocal or vocal-only benchmark entry needs
 *    audio, and no amount of symbolic data substitutes for it.
 *
 * The module reads metadata rows and never touches audio: fetching the archive
 * is a separate, deliberate step.
 */
import type {
  CorpusEntry,
  CorpusDensity,
  CorpusEnsemble,
  CorpusHarmony,
  CorpusIdiom,
  CorpusRightsBasis,
  CorpusTempoBand,
} from "./benchmarkCorpusPlan";

export const PDMX_SOURCE = {
  name: "PDMX",
  record: "https://zenodo.org/records/15571083",
  repository: "https://github.com/pnlong/PDMX",
  /** The only subset this platform admits. */
  subset: "no_license_conflict",
} as const;

/**
 * One metadata row as PDMX publishes it. Only the fields this platform reads
 * are declared; anything else in the table is ignored rather than trusted.
 */
export type PdmxMetadataRow = {
  id: string;
  title?: string;
  /** PDMX's own flag. Anything other than an explicit `false`/0 is a conflict. */
  license_conflict?: boolean | string | number;
  license?: string;
  /** Where the work's licence statement can be checked. */
  url?: string;
  tempo?: number;
  time_signature?: string;
  n_tracks?: number;
  /** Distinct pitch classes or a similar published complexity proxy, when present. */
  n_pitch_classes?: number;
  notes_per_bar?: number;
  genres?: string[] | string;
};

const isNoConflict = (value: PdmxMetadataRow["license_conflict"]): boolean =>
  value === false || value === 0 || value === "False" || value === "false" || value === "0";

/** Public-domain claims this platform accepts from PDMX metadata. */
const PUBLIC_DOMAIN = /^(public\s*domain|pd|cc0|creativecommons\.org\/publicdomain)/i;

/** Why this row may not become a corpus entry, or null when it may. */
export function pdmxRefusalReason(row: PdmxMetadataRow): string | null {
  if (!row.id?.trim()) return "row has no id";
  if (!isNoConflict(row.license_conflict)) {
    // The authors' own warning: outside `no_license_conflict` the public
    // copyright data and the file's internal metadata disagree.
    return `${row.id} is outside the ${PDMX_SOURCE.subset} subset`;
  }
  if (!row.license || !PUBLIC_DOMAIN.test(row.license.trim())) {
    return `${row.id} claims "${row.license ?? "no licence"}", which is not a public-domain statement`;
  }
  if (!row.url?.trim()) return `${row.id} has no URL to check its licence statement against`;
  return null;
}

const tempoBand = (bpm: number | undefined): CorpusTempoBand =>
  bpm === undefined ? "medium" : bpm < 76 ? "slow" : bpm > 132 ? "fast" : "medium";

const harmony = (pitchClasses: number | undefined): CorpusHarmony =>
  pitchClasses === undefined ? "moderate" : pitchClasses <= 7 ? "simple" : pitchClasses <= 9 ? "moderate" : "complex";

const density = (notesPerBar: number | undefined): CorpusDensity =>
  notesPerBar === undefined ? "moderate" : notesPerBar < 6 ? "sparse" : notesPerBar > 16 ? "dense" : "moderate";

const ensemble = (tracks: number | undefined): CorpusEnsemble =>
  tracks === undefined ? "small" : tracks <= 1 ? "solo" : tracks <= 5 ? "small" : "large";

/** 6/8, 9/8 and 12/8 are compound; 3/4 and 6/4 are not swung, they are triple. */
const feel = (meter: string): "straight" | "compound" =>
  /^(6|9|12)\/8$/.test(meter) ? "compound" : "straight";

const NON_WESTERN = /(klezmer|mizrahi|arab|indian|raga|turkish|balkan|persian|chinese|japanese|gamelan|african)/i;

const idiom = (genres: PdmxMetadataRow["genres"]): CorpusIdiom => {
  const text = Array.isArray(genres) ? genres.join(" ") : genres ?? "";
  return NON_WESTERN.test(text) ? "non_western" : "western";
};

export function pdmxRightsBasis(row: PdmxMetadataRow, clearedAt: string): CorpusRightsBasis {
  return {
    kind: "public_domain",
    // The work's own licence statement, not PDMX's record page: the dataset's
    // licence is not proof of rights in the works inside it.
    reference: row.url!,
    work: `${row.title?.trim() || row.id} (${PDMX_SOURCE.name} ${row.id}, ${PDMX_SOURCE.subset})`,
    clearedAt,
    commercialUse: true,
  };
}

/**
 * Metadata rows to corpus entries. Every refusal is returned with its reason:
 * a corpus that silently drops rows cannot be audited.
 */
export function pdmxToCorpusEntries(
  rows: readonly PdmxMetadataRow[],
  options: { clearedAt?: string } = {},
): { entries: CorpusEntry[]; refused: Array<{ id: string; reason: string }> } {
  const clearedAt = options.clearedAt ?? new Date().toISOString();
  const entries: CorpusEntry[] = [];
  const refused: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    const reason = pdmxRefusalReason(row);
    if (reason) {
      refused.push({ id: row.id ?? "(no id)", reason });
      continue;
    }
    const meter = row.time_signature?.trim() || "4/4";
    entries.push({
      id: `pdmx-${row.id}`,
      title: row.title?.trim() || `PDMX ${row.id}`,
      // PDMX holds scores. It fills the corpus's MIDI slice and nothing else.
      inputType: "midi",
      rights: pdmxRightsBasis(row, clearedAt),
      attributes: {
        tempoBand: tempoBand(row.tempo),
        meter,
        feel: feel(meter),
        harmony: harmony(row.n_pitch_classes),
        density: density(row.notes_per_bar),
        ensemble: ensemble(row.n_tracks),
        idiom: idiom(row.genres),
        // A score carries no production: calling it acoustic would be a guess.
        production: "acoustic",
      },
    });
  }
  return { entries, refused };
}

/**
 * Pick a spread rather than the first N rows. Selection walks the attribute
 * combinations round-robin, so a corpus drawn from PDMX is not 90 % 4/4 piano
 * scores just because the dataset is.
 */
export function selectSpread(entries: readonly CorpusEntry[], limit: number): CorpusEntry[] {
  const buckets = new Map<string, CorpusEntry[]>();
  for (const entry of entries) {
    const a = entry.attributes;
    const key = [a.meter, a.tempoBand, a.harmony, a.density, a.ensemble, a.idiom].join("|");
    buckets.set(key, [...(buckets.get(key) ?? []), entry]);
  }
  const ordered = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, list]) => list);
  const picked: CorpusEntry[] = [];
  for (let round = 0; picked.length < limit; round += 1) {
    let tookOne = false;
    for (const list of ordered) {
      if (round >= list.length) continue;
      picked.push(list[round]);
      tookOne = true;
      if (picked.length === limit) break;
    }
    if (!tookOne) break;
  }
  return picked;
}
