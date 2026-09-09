/**
 * Task selection for the tournament (Wave Q — Model Discovery, global tournament).
 *
 * The first live tournament picked tasks round-robin over the *target family*
 * only, and every one of its twelve tasks was a classical score — because
 * that is what a uniform draw from PDMX's multitrack share is. A benchmark
 * meant to represent the wider musical world has to draw round-robin over
 * **genre family first, target family second**, one task per work, so that
 * neither classical nor keys can fill the sample.
 *
 * This is a pure function over already-built candidates: deterministic, and
 * the same whether the caller found 40 candidates or 4,000.
 */

export type SelectionCandidate = {
  workId: string;
  /** The task's target family (`bass`, `drums`, …). */
  family: string;
  /** The work's primary genre family; absent when the caller does not care. */
  genre?: string;
};

export type SelectionOptions = {
  sampleSize: number;
  /** Families in the order they are tried inside each genre. Families absent from the list are never chosen. */
  familyOrder: readonly string[];
  /** Genres in the order they are cycled. Genres absent from the list are still cycled, after these, alphabetically. */
  genreOrder?: readonly string[];
  /** At most this many tasks per genre family. */
  maxPerGenre?: number;
  /**
   * `per-genre` (default): each genre keeps its own family cursor, so every
   * genre's first pick is the first family it has — even coverage *within* a
   * genre. `shared`: one cursor across genres, so a small sample spread over
   * many genres still spreads over instruments instead of every genre
   * contributing its drums.
   */
  familyCursor?: "per-genre" | "shared";
};

/**
 * Round-robin over genre, then over family within each genre — each genre keeps
 * its own family cursor, so a genre that has no drums still cycles its own
 * families evenly. One task per work. The result's order is the pick order.
 */
export function selectRoundRobin<C extends SelectionCandidate>(candidates: readonly C[], options: SelectionOptions): C[] {
  const pools = new Map<string, Map<string, C[]>>();
  for (const candidate of candidates) {
    if (!options.familyOrder.includes(candidate.family)) continue;
    const genre = candidate.genre ?? "any";
    const byFamily = pools.get(genre) ?? new Map<string, C[]>();
    byFamily.set(candidate.family, [...(byFamily.get(candidate.family) ?? []), candidate]);
    pools.set(genre, byFamily);
  }
  const preferred = (options.genreOrder ?? []).filter((g) => pools.has(g));
  const rest = [...pools.keys()].filter((g) => !preferred.includes(g)).sort((a, b) => a.localeCompare(b));
  const genres = [...preferred, ...rest];

  const chosen: C[] = [];
  const usedWorks = new Set<string>();
  const perGenre = new Map<string, number>();
  const cursor = new Map<string, number>();
  const maxPerGenre = options.maxPerGenre ?? Infinity;

  const cursorKey = (genre: string) => (options.familyCursor === "shared" ? "*" : genre);
  const takeFrom = (genre: string): C | null => {
    const byFamily = pools.get(genre)!;
    const start = cursor.get(cursorKey(genre)) ?? 0;
    for (let step = 0; step < options.familyOrder.length; step += 1) {
      const index = (start + step) % options.familyOrder.length;
      const pool = byFamily.get(options.familyOrder[index]) ?? [];
      const next = pool.find((c) => !usedWorks.has(c.workId));
      if (next) {
        cursor.set(cursorKey(genre), index + 1);
        return next;
      }
    }
    return null;
  };

  for (let round = 0; chosen.length < options.sampleSize && round < 1_000; round += 1) {
    let any = false;
    for (const genre of genres) {
      if (chosen.length >= options.sampleSize) break;
      if ((perGenre.get(genre) ?? 0) >= maxPerGenre) continue;
      const next = takeFrom(genre);
      if (!next) continue;
      chosen.push(next);
      usedWorks.add(next.workId);
      perGenre.set(genre, (perGenre.get(genre) ?? 0) + 1);
      any = true;
    }
    if (!any) break;
  }
  return chosen;
}

/** Counts per (genre, family) — what the sample actually contains, for the record. */
export function selectionProfile(candidates: readonly SelectionCandidate[]): Record<string, Record<string, number>> {
  const profile: Record<string, Record<string, number>> = {};
  for (const c of candidates) {
    const genre = c.genre ?? "any";
    profile[genre] = profile[genre] ?? {};
    profile[genre][c.family] = (profile[genre][c.family] ?? 0) + 1;
  }
  return profile;
}
