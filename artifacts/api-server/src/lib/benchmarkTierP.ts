/**
 * Tier P of the benchmark corpus (Brain B-08, audit §7.2): the operator's own
 * produced songs, rights `owned_by_operator`, each with a confirmed Song Model.
 *
 * Tier P is the only produced-genre anchor the benchmark has — PDMX holds
 * scores, and the synthetic corpus holds specifications — and it is small by
 * nature. Its numbers are therefore **reported per song and never aggregated
 * with Tier H or Tier S**: `runArrangementBenchmark` refuses to mix tiers in
 * one run, and the CLI writes a Tier P run to its own file.
 */
import type { SongModelData } from "@workspace/db";
import { rachemNaSongModel } from "./__fixtures__/rachemNaSongModelV3";
import type { BenchmarkSong } from "./arrangementBenchmark";
import type { CorpusEntry } from "./benchmarkCorpusPlan";
import { canonicalizeSongModelCoordinates } from "./songModelValidation";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

export const TIER_P_VERSION = "1.0" as const;

/** The corpus-plan entry for the owner's song, so coverage and rights are reported in one place. */
export const TIER_P_ENTRIES: CorpusEntry[] = [
  {
    id: "owner-rachem-na",
    title: "רחם נא (the operator's own song)",
    inputType: "full_song",
    rights: {
      kind: "owned_by_operator",
      reference: "operator-owned master; Song Model v3 trusted_automatically (PR-98)",
      work: "רחם נא — written, recorded and produced by the operator",
      clearedAt: "2026-09-10T00:00:00.000Z",
      commercialUse: true,
    },
    attributes: {
      // Measured from the stored Song Model: 130.43 BPM, 4/4, C minor, 92 chords over 141 bars, one MIX stem.
      tempoBand: "medium",
      meter: "4/4",
      feel: "straight",
      harmony: "moderate",
      density: "moderate",
      ensemble: "small",
      idiom: "non_western",
      production: "hybrid",
      tradition: "Israeli / Mizrahi-influenced popular song (operator's description)",
    },
  },
];

/**
 * The Song Model behind a Tier P entry, canonicalised and with its musical
 * map derived exactly as the synthetic corpus derives its own, so the
 * orchestrator sees the same contract it sees in production.
 */
export function tierPSongModel(entryId: string): SongModelData | null {
  if (entryId !== "owner-rachem-na") return null;
  const canonical = canonicalizeSongModelCoordinates(rachemNaSongModel());
  // The stored map (energy from the recording, harmony from the analysis) is
  // kept while its digest still matches; otherwise it is derived as the
  // synthetic corpus derives its own. Either way the critic sees a current map.
  if (!canonical.musicalMap || isMusicalMapStale(canonical)) {
    canonical.musicalMap = deriveMusicalMap(canonical, { now: new Date(0) });
  }
  return canonicalizeSongModelCoordinates(canonical);
}

/** The Tier P songs a benchmark run takes. */
export function tierPSongs(): BenchmarkSong[] {
  return TIER_P_ENTRIES.flatMap((entry) => {
    const songModel = tierPSongModel(entry.id);
    return songModel ? [{ id: entry.id, genre: "owner_song", inputType: entry.inputType, songModel }] : [];
  });
}
