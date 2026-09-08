/**
 * Premium instrument routing (PR-22).
 *
 * Decides which of the operator's attested VST3 instruments realizes a track.
 * The worker offers a set of attested assets; this module chooses one per
 * track from an operator-supplied table, deterministically, and refuses (with a
 * reason) rather than guessing when the table names an asset the worker has
 * not attested. Sound *selection* — choosing a sound for musical reasons — is
 * PR-24's job; this is the plumbing that makes such a choice reach the renderer.
 */
import { readFileSync } from "node:fs";

export type PremiumRoutingTable = {
  /** Asset id used when nothing more specific matches. */
  default?: string;
  /** instrumentDefinition.family -> asset id (drums, keys, strings, ...). */
  byFamily?: Record<string, string>;
  /** Arrangement role -> asset id (GROOVE, BASS, PAD, ...). Case-insensitive. */
  byRole?: Record<string, string>;
  /** Track instrument name -> asset id. Case-insensitive. */
  byInstrument?: Record<string, string>;
};

export type PremiumRoute = {
  assetId: string | null;
  /** Which rule matched, or why no asset could be chosen. */
  reason: string;
  /** The rule that matched (attested or not); absent when no rule applied. */
  rule?: string;
};

export type RoutableTrack = {
  instrument: string;
  role: string;
  family: string;
};

function lookup(table: Record<string, string> | undefined, key: string): string | undefined {
  if (!table) return undefined;
  const wanted = key.trim().toLowerCase();
  for (const [candidate, assetId] of Object.entries(table)) {
    if (candidate.trim().toLowerCase() === wanted) return assetId;
  }
  return undefined;
}

/**
 * Precedence: instrument > role > family > default. The most specific rule
 * wins; an operator who names an instrument means that instrument.
 */
export function routePremiumInstrument(
  track: RoutableTrack,
  table: PremiumRoutingTable,
  attestedAssetIds: readonly string[],
): PremiumRoute {
  const attested = new Set(attestedAssetIds);
  const candidates: Array<[string, string | undefined]> = [
    [`instrument "${track.instrument}"`, lookup(table.byInstrument, track.instrument)],
    [`role ${track.role}`, lookup(table.byRole, track.role)],
    [`family ${track.family}`, lookup(table.byFamily, track.family)],
    ["default", table.default],
  ];
  for (const [rule, assetId] of candidates) {
    if (!assetId) continue;
    if (attested.has(assetId)) return { assetId, reason: `routed by ${rule} -> ${assetId}`, rule };
    // The table names an asset the worker has not attested. Say so and stop:
    // falling through to a less specific rule would silently substitute a
    // different instrument for the one the operator asked for.
    return {
      assetId: null,
      reason: `${rule} names asset ${assetId}, which the renderer has not attested (attested: ${[...attested].join(", ") || "none"})`,
      rule,
    };
  }
  return { assetId: null, reason: `no routing rule matches instrument "${track.instrument}", role ${track.role}, family ${track.family}, and the table has no default` };
}

function isStringMap(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((v) => typeof v === "string");
}

export function parsePremiumRoutingTable(raw: unknown): PremiumRoutingTable {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("premium instrument routing table must be a JSON object");
  }
  const table = raw as Record<string, unknown>;
  const out: PremiumRoutingTable = {};
  if (table.default !== undefined) {
    if (typeof table.default !== "string") throw new Error("routing table: default must be an asset id string");
    out.default = table.default;
  }
  for (const key of ["byFamily", "byRole", "byInstrument"] as const) {
    if (table[key] === undefined) continue;
    if (!isStringMap(table[key])) throw new Error(`routing table: ${key} must map names to asset id strings`);
    out[key] = table[key] as Record<string, string>;
  }
  return out;
}

/**
 * Operator configuration: PREMIUM_INSTRUMENT_ROUTING (inline JSON) or
 * PREMIUM_INSTRUMENT_ROUTING_PATH (a JSON file, kept out of Git like the asset
 * manifest). Returns null when neither is set, which means "use the worker's
 * default asset for every track", exactly as before PR-22.
 */
export function loadPremiumRoutingTable(env: NodeJS.ProcessEnv = process.env): PremiumRoutingTable | null {
  const inline = env.PREMIUM_INSTRUMENT_ROUTING?.trim();
  const path = env.PREMIUM_INSTRUMENT_ROUTING_PATH?.trim();
  if (!inline && !path) return null;
  const text = inline || readFileSync(path!, "utf8");
  return parsePremiumRoutingTable(JSON.parse(text));
}
