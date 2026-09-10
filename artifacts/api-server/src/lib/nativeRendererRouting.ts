/**
 * Native renderer routing (PR-92, SOUND-1).
 *
 * Which attested native renderer may play a track, in what order, and - when
 * none may - the reason the export records on the stem. The decision is pure
 * and mirrors the worker's own `sfizz_instrument_map.py`: the SFIZZ_VSCO2_CE
 * worker publishes its ordered instrument map on `/health`, the platform
 * resolves each track against it here before any request leaves, and the
 * worker resolves again before any native process runs. A family the map
 * does not serve falls back to the preview synth *with that reason*; it is
 * never sent to an instrument it was not mapped to.
 */
import type { TrackModel } from "@workspace/db";

export const PLATFORM_FAMILIES = ["keys", "strings", "brass", "drums", "guitar", "voice", "synth"] as const;
export type PlatformFamily = (typeof PLATFORM_FAMILIES)[number];

export type SfizzInstrumentMapEntry = {
  /** Exactly one of these; the worker refuses a map that says otherwise. */
  match: { nameKeyword?: string; instrumentId?: string; family?: string };
  sfz: string;
  instrument: string;
  /** Present when the platform family is not the instrument the library has. */
  standIn?: string;
  keyRange?: [number, number];
};

export type SfizzInstrumentMap = {
  version?: number;
  library?: string;
  entries: SfizzInstrumentMapEntry[];
  unserved?: Record<string, string>;
};

export type SfizzResolution =
  | { served: true; sfz: string; instrument: string; matchedBy: SfizzInstrumentMapEntry["match"]; standIn?: string }
  | { served: false; reason: string };

type RoutableTrack = Pick<TrackModel, "instrument"> & {
  instrumentDefinition: Pick<TrackModel["instrumentDefinition"], "id" | "family">;
};

/** Families the map serves whole (a `family` entry), in platform order. */
export function sfizzServedFamilies(map: SfizzInstrumentMap): PlatformFamily[] {
  const byFamily = new Set(map.entries.flatMap((entry) => entry.match.family ? [entry.match.family.trim().toLowerCase()] : []));
  return PLATFORM_FAMILIES.filter((family) => byFamily.has(family));
}

/**
 * The first entry, in map order, whose single match holds - the same rule the
 * worker applies, so both sides name the same SFZ or both refuse.
 */
export function resolveSfizzInstrument(map: SfizzInstrumentMap, track: RoutableTrack): SfizzResolution {
  const name = (track.instrument ?? "").trim().toLowerCase();
  const instrumentId = track.instrumentDefinition.id?.toLowerCase() ?? null;
  const family = track.instrumentDefinition.family?.toLowerCase() ?? null;
  for (const entry of map.entries) {
    const [key, raw] = Object.entries(entry.match)[0] ?? [];
    if (!key || typeof raw !== "string") continue;
    const expected = raw.trim().toLowerCase();
    const matched =
      (key === "nameKeyword" && name.length > 0 && name.includes(expected)) ||
      (key === "instrumentId" && instrumentId === expected) ||
      (key === "family" && family === expected);
    if (matched) {
      return {
        served: true,
        sfz: entry.sfz,
        instrument: entry.instrument,
        matchedBy: { [key]: raw },
        ...(entry.standIn ? { standIn: entry.standIn } : {}),
      };
    }
  }
  const served = sfizzServedFamilies(map);
  const why = family && map.unserved?.[family] ? ` ${map.unserved[family]}` : "";
  return {
    served: false,
    reason: `SFIZZ_VSCO2_CE has no approved instrument for family '${family ?? "unknown"}' (instrument '${name || "?"}', id '${instrumentId ?? "?"}'); served families: ${served.join(", ") || "none"}.${why}`,
  };
}

export type SfizzWorkerState =
  | { configured: false }
  | { configured: true; healthy: false; reason: string }
  | { configured: true; healthy: true; map: SfizzInstrumentMap | null };

export type NativeRouteCandidate =
  | { renderer: "PEDALBOARD_VST3" }
  | { renderer: "SFIZZ_VSCO2_CE"; sfz: string; instrument: string; matchedBy: SfizzInstrumentMapEntry["match"]; standIn?: string };

export type NativeRouteDecision = {
  /** Renderers to try, in order; the first attested render wins. */
  candidates: NativeRouteCandidate[];
  /** Why no candidate exists (or why sfizz was skipped when only pedalboard remains). */
  reason: string | null;
  /**
   * Every renderer that was *not* made a candidate, with its reason - even
   * when another renderer is. If every candidate then fails, the stem's
   * fallback must still say why the others never applied.
   */
  skipped: string[];
};

/**
 * PEDALBOARD_VST3 keeps its place first (the operator's own instruments, when
 * that worker is configured for the family); SFIZZ_VSCO2_CE follows only for a
 * track its published map serves. With neither, the reason says which.
 */
export function decideNativeRoute(input: {
  track: RoutableTrack;
  pedalboardConfigured: boolean;
  pedalboardFamilies: readonly string[];
  sfizz: SfizzWorkerState;
}): NativeRouteDecision {
  const candidates: NativeRouteCandidate[] = [];
  const reasons: string[] = [];
  const family = input.track.instrumentDefinition.family;
  if (input.pedalboardConfigured && input.pedalboardFamilies.includes(family)) {
    candidates.push({ renderer: "PEDALBOARD_VST3" });
  }
  if (!input.sfizz.configured) {
    reasons.push("SFIZZ_VSCO2_CE is not configured (MUSIC_AI_WORKER_URL / SFIZZ_RENDER_API_URL).");
  } else if (!input.sfizz.healthy) {
    reasons.push(`SFIZZ_VSCO2_CE is not healthy: ${input.sfizz.reason}`);
  } else if (!input.sfizz.map) {
    reasons.push("SFIZZ_VSCO2_CE published no instrument map, so no family can be routed to it.");
  } else {
    const resolved = resolveSfizzInstrument(input.sfizz.map, input.track);
    if (resolved.served) {
      candidates.push({
        renderer: "SFIZZ_VSCO2_CE",
        sfz: resolved.sfz,
        instrument: resolved.instrument,
        matchedBy: resolved.matchedBy,
        ...(resolved.standIn ? { standIn: resolved.standIn } : {}),
      });
    } else {
      reasons.push(resolved.reason);
    }
  }
  if (!candidates.length && !input.pedalboardConfigured) {
    reasons.unshift("No PEDALBOARD_VST3 worker is configured.");
  } else if (!candidates.length) {
    reasons.unshift(`The configured PEDALBOARD_VST3 worker does not list family '${family}'.`);
  }
  return { candidates, reason: candidates.length ? null : reasons.join(" "), skipped: reasons };
}

/** The family coverage table the evidence and the production-floor doc print. */
export function sfizzFamilyCoverage(map: SfizzInstrumentMap): Array<{
  family: PlatformFamily;
  served: boolean;
  instruments: Array<{ match: SfizzInstrumentMapEntry["match"]; sfz: string; instrument: string; standIn?: string }>;
  reason: string | null;
}> {
  return PLATFORM_FAMILIES.map((family) => {
    const instruments = map.entries
      .filter((entry) => {
        if (entry.match.family) return entry.match.family.toLowerCase() === family;
        // Keyword and id entries belong to the family their platform definition carries.
        const id = entry.match.instrumentId?.toLowerCase() ?? entry.match.nameKeyword?.toLowerCase() ?? "";
        if (family === "strings") return ["bass", "cello", "strings", "violin"].includes(id);
        if (family === "brass") return ["brass", "trumpet", "trombone", "horn"].includes(id);
        if (family === "keys") return ["piano", "keys"].includes(id);
        return false;
      })
      .map((entry) => ({ match: entry.match, sfz: entry.sfz, instrument: entry.instrument, ...(entry.standIn ? { standIn: entry.standIn } : {}) }));
    const served = instruments.some((entry) => entry.match.family);
    return { family, served, instruments, reason: served ? null : map.unserved?.[family] ?? "not mapped" };
  });
}
