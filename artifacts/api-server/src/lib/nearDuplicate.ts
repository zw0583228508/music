/**
 * Near-duplicate detection for training corpora (Wave Q, Q-05 — data factory).
 *
 * PDMX carries many uploads of the same piece: re-exports, small edits, the
 * same hymn typeset by three users. A work-level train/val/test split keeps
 * one *work* out of two splits, but two uploads of the same score are two
 * works to the split and one piece to the model — the test set would then be
 * scored on material the model saw in training. This module finds those
 * groups so the dataset builders can put a whole group on one side.
 *
 * Method — bar-shingle MinHash with LSH banding:
 *
 *  1. **Content hash.** SHA-256 over the grid note stream (family, start step,
 *     pitch, duration steps) plus the metre. Velocity and tempo are excluded:
 *     a re-export that only touched dynamics is the same score. Equal hashes
 *     are *exact* duplicates.
 *  2. **Shingles.** Each bar becomes a string of `(family, onset at eighth-note
 *     resolution, pitch class)` triples; consecutive bar pairs (bigrams) are the
 *     shingles, so the *sequence* counts, not just the bag of bars. A bigram
 *     of two empty bars is dropped — every sparse piece has those, and they
 *     would tie unrelated works together.
 *  3. **MinHash.** `SIGNATURE_SIZE` independent 32-bit hashes of the shingle
 *     set; the share of agreeing positions between two signatures is an
 *     unbiased estimate of the Jaccard similarity of the shingle sets.
 *  4. **LSH.** Signatures are cut into `LSH_BANDS` bands of `LSH_ROWS` rows;
 *     two works whose signatures agree on any whole band become a candidate
 *     pair, and only candidate pairs are compared. With 16 × 4 a pair at
 *     Jaccard 0.7 is found with p ≈ 0.99, at 0.5 with p ≈ 0.64, at 0.3 with
 *     p ≈ 0.12 — so the threshold the caller chooses should sit at or above
 *     0.5 for the recall to mean anything.
 *  5. **Groups.** Union-find over exact-hash equality and candidate pairs at
 *     or above the threshold. A group is a set of work ids that must share a
 *     split.
 *
 * Pitch is exact, so a transposed arrangement is *not* a near-duplicate here.
 * That is a stated limit, not an oversight: the validation against PDMX's own
 * version groups (see the corpus profile) measures what this misses.
 */
import { createHash } from "node:crypto";
import type { ParsedMidi } from "./midiFile";
import { STEPS_PER_QUARTER, toGridNotes } from "./arrangerRemi";

export const FINGERPRINT_VERSION = "NEAR_DUP_FP_v1" as const;

/** MinHash signature length. 64 gives a Jaccard estimate with s.d. ≈ 0.06 at 0.5. */
export const SIGNATURE_SIZE = 64;
export const LSH_BANDS = 16;
export const LSH_ROWS = 4;
/** Below this many shingles a signature is noise; such works only match by exact hash. */
export const MIN_SHINGLES = 4;
/** Default similarity at which two works are one piece. Chosen from the corpus validation. */
export const DEFAULT_THRESHOLD = 0.5;

export type WorkFingerprint = {
  version: typeof FINGERPRINT_VERSION;
  workId: string;
  /** SHA-256 of the exact grid note stream; equal → exact duplicate. */
  contentHash: string;
  /** Number of distinct bar-bigram shingles. */
  shingleCount: number;
  /** MinHash signature, `SIGNATURE_SIZE` unsigned 32-bit values. Empty when too short. */
  signature: number[];
  barCount: number;
  noteCount: number;
};

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** FNV-1a over a string, 32-bit. */
export function fnv1a(text: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A 32-bit mix (murmur3 finaliser) of a hash with a seed — one MinHash function per seed. */
function mix(hash: number, seed: number): number {
  let h = (hash ^ Math.imul(seed + 1, 0x9e37_79b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85eb_ca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2_ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** MinHash signature of a set of shingle strings. */
export function minhashSignature(shingles: Iterable<string>, size = SIGNATURE_SIZE): number[] {
  const signature = new Array<number>(size).fill(0xffff_ffff);
  let any = false;
  for (const shingle of shingles) {
    any = true;
    const base = fnv1a(shingle);
    for (let i = 0; i < size; i += 1) {
      const h = mix(base, i);
      if (h < signature[i]) signature[i] = h;
    }
  }
  return any ? signature : [];
}

/** Share of agreeing signature positions — an estimate of Jaccard similarity. */
export function estimateJaccard(a: readonly number[], b: readonly number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let agree = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] === b[i]) agree += 1;
  return agree / a.length;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/** Bar shingles of a score on the tokenizer grid, in bar order. */
export function barShingles(midi: ParsedMidi, options: { maxBars?: number } = {}): { bars: string[]; barCount: number; noteCount: number; contentHash: string } {
  const grid = toGridNotes(midi, options);
  const perBar = grid.stepsPerBarValue;
  // Eighth-note onset resolution: a re-export that nudged a grace note by a
  // step is the same bar; a different rhythm is not.
  const eighth = STEPS_PER_QUARTER / 2;
  const cells = new Map<number, string[]>();
  const streamLines: string[] = [];
  for (const note of grid.notes) {
    const bar = Math.floor(note.startStep / perBar);
    const onset = Math.floor((note.startStep - bar * perBar) / eighth);
    const list = cells.get(bar) ?? [];
    list.push(`${note.family}:${onset}:${note.pitch % 12}`);
    cells.set(bar, list);
    streamLines.push(`${note.family}:${note.startStep}:${note.pitch}:${note.durationSteps}`);
  }
  const bars: string[] = [];
  for (let bar = 0; bar < grid.barCount; bar += 1) {
    const list = cells.get(bar);
    bars.push(list ? [...new Set(list)].sort().join(",") : "");
  }
  streamLines.sort();
  const contentHash = createHash("sha256")
    .update(`${grid.timeSig.numerator}/${grid.timeSig.denominator}\n`)
    .update(streamLines.join("\n"))
    .digest("hex");
  return { bars, barCount: grid.barCount, noteCount: grid.notes.length, contentHash };
}

/** Bar-bigram shingles; a bigram of two empty bars is dropped. */
export function shinglesFromBars(bars: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < bars.length; i += 1) {
    if (!bars[i] && !bars[i + 1]) continue;
    out.add(`${bars[i]}||${bars[i + 1]}`);
  }
  // A one-bar piece still has one shingle: its bar alone.
  if (bars.length === 1 && bars[0]) out.add(`${bars[0]}||`);
  return out;
}

/** The fingerprint of one parsed score. Deterministic. */
export function fingerprintMidi(midi: ParsedMidi, workId: string, options: { maxBars?: number } = {}): WorkFingerprint {
  const { bars, barCount, noteCount, contentHash } = barShingles(midi, options);
  const shingles = shinglesFromBars(bars);
  return {
    version: FINGERPRINT_VERSION,
    workId,
    contentHash,
    shingleCount: shingles.size,
    signature: shingles.size >= MIN_SHINGLES ? minhashSignature(shingles) : [],
    barCount,
    noteCount,
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    let root = i;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[i] !== root) {
      const next = this.parent[i];
      this.parent[i] = root;
      i = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

export type NearDuplicateResult = {
  threshold: number;
  works: number;
  /** Works whose signature was long enough to enter LSH. */
  worksIndexed: number;
  exactDuplicateGroups: number;
  /** Works that share their content hash with at least one other work. */
  worksInExactGroups: number;
  candidatePairs: number;
  /** Candidate pairs at or above the threshold (exact-hash pairs not included). */
  nearPairs: number;
  /** Groups of size ≥ 2 (exact or near), each sorted by work id. */
  groups: string[][];
  /** Works that belong to some group of size ≥ 2. */
  worksInGroups: number;
  /** Works after collapsing every group to one representative. */
  distinctWorks: number;
  groupSizeHistogram: Record<string, number>;
};

/**
 * Group fingerprints into duplicate clusters. Exact-hash equality always
 * groups; LSH candidates group when their estimated Jaccard ≥ `threshold`.
 * Union-find makes the relation transitive — A~B and B~C put A, B, C together,
 * which is the right behaviour for a split (any leak path is a leak).
 */
export function nearDuplicateGroups(
  fingerprints: readonly WorkFingerprint[],
  options: { threshold?: number } = {},
): NearDuplicateResult {
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const n = fingerprints.length;
  const uf = new UnionFind(n);

  // 1. exact
  const byHash = new Map<string, number[]>();
  fingerprints.forEach((fp, i) => {
    const list = byHash.get(fp.contentHash) ?? [];
    list.push(i);
    byHash.set(fp.contentHash, list);
  });
  let exactGroups = 0;
  let worksInExact = 0;
  for (const members of byHash.values()) {
    if (members.length < 2) continue;
    exactGroups += 1;
    worksInExact += members.length;
    for (let k = 1; k < members.length; k += 1) uf.union(members[0], members[k]);
  }

  // 2. LSH candidates
  const buckets = new Map<string, number[]>();
  let indexed = 0;
  fingerprints.forEach((fp, i) => {
    if (fp.signature.length !== SIGNATURE_SIZE) return;
    indexed += 1;
    for (let band = 0; band < LSH_BANDS; band += 1) {
      const key = `${band}:${fp.signature.slice(band * LSH_ROWS, (band + 1) * LSH_ROWS).join(",")}`;
      const list = buckets.get(key) ?? [];
      list.push(i);
      buckets.set(key, list);
    }
  });
  const seen = new Set<string>();
  let candidatePairs = 0;
  let nearPairs = 0;
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    for (let a = 0; a < members.length; a += 1) {
      for (let b = a + 1; b < members.length; b += 1) {
        const i = members[a];
        const j = members[b];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidatePairs += 1;
        if (fingerprints[i].contentHash === fingerprints[j].contentHash) continue;
        if (estimateJaccard(fingerprints[i].signature, fingerprints[j].signature) >= threshold) {
          nearPairs += 1;
          uf.union(i, j);
        }
      }
    }
  }

  // 3. groups
  const byRoot = new Map<number, string[]>();
  fingerprints.forEach((fp, i) => {
    const root = uf.find(i);
    const list = byRoot.get(root) ?? [];
    list.push(fp.workId);
    byRoot.set(root, list);
  });
  const groups = [...byRoot.values()]
    .filter((g) => g.length >= 2)
    .map((g) => [...g].sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
  const histogram: Record<string, number> = {};
  let worksInGroups = 0;
  for (const g of groups) {
    worksInGroups += g.length;
    const bucket = g.length >= 10 ? "10+" : String(g.length);
    histogram[bucket] = (histogram[bucket] ?? 0) + 1;
  }
  return {
    threshold,
    works: n,
    worksIndexed: indexed,
    exactDuplicateGroups: exactGroups,
    worksInExactGroups: worksInExact,
    candidatePairs,
    nearPairs,
    groups,
    worksInGroups,
    distinctWorks: n - worksInGroups + groups.length,
    groupSizeHistogram: histogram,
  };
}

// ---------------------------------------------------------------------------
// Split discipline
// ---------------------------------------------------------------------------

export type Split = "train" | "val" | "test";

/**
 * The work-level split rule the task extraction script uses: a hash of the
 * work id, 90/5/5. Kept here so every dataset builder computes the same split.
 */
export function hashSplit(workId: string): Split {
  const h = parseInt(createHash("sha256").update(workId).digest("hex").slice(0, 8), 16) % 100;
  return h < 90 ? "train" : h < 95 ? "val" : "test";
}

/**
 * Assign every work a split such that **a duplicate group lands on one side**.
 * The group's split is the split of its lexicographically smallest member —
 * deterministic, and independent of the order fingerprints were seen in.
 * Works in no group keep their own hash split.
 */
export function assignSplitsWithGroups(
  workIds: readonly string[],
  groups: readonly (readonly string[])[],
  splitOf: (workId: string) => Split = hashSplit,
): { splits: Map<string, Split>; movedByGroup: number } {
  const groupAnchor = new Map<string, string>();
  for (const group of groups) {
    const anchor = [...group].sort()[0];
    for (const member of group) groupAnchor.set(member, anchor);
  }
  const splits = new Map<string, Split>();
  let moved = 0;
  for (const workId of workIds) {
    const own = splitOf(workId);
    const anchor = groupAnchor.get(workId);
    const assigned = anchor ? splitOf(anchor) : own;
    if (assigned !== own) moved += 1;
    splits.set(workId, assigned);
  }
  return { splits, movedByGroup: moved };
}
