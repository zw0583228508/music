/**
 * Open-licence sound assets in the cloud (PR-93, SOUND-2).
 *
 * The platform-side mirror of `services/music-ai-worker/open_licence_assets.py`:
 * the catalogue shape, the admissibility rule (no captured licence text, no
 * asset; no activation through the worker's own lifecycle, no asset; no
 * audible render, no family), the family-coverage table the evidence and the
 * production-floor doc print, and the instrument map an asset root would
 * publish in the shape SOUND-1's `SfizzInstrumentMap` reads (PR-92) - the
 * merge point between the two streams. Pure functions, no I/O.
 */

export const PLATFORM_FAMILIES = ["keys", "strings", "brass", "drums", "guitar", "voice", "synth"] as const;
export type PlatformFamily = (typeof PLATFORM_FAMILIES)[number];
export const AUDITION_FAMILIES = ["piano", "strings", "world", "bass", "guitar", "drums"] as const;
export type AuditionFamily = (typeof AUDITION_FAMILIES)[number];

export type OpenLicenceInstrument = {
  sfz: string;
  instrument: string;
  family: PlatformFamily;
  auditionFamily: AuditionFamily;
  keyRange: [number, number];
  /** Present when the platform family is not the instrument the library has. */
  standIn?: string;
  /** The owner's world / Middle-Eastern idiom: named, never inferred. */
  world?: boolean;
  drumKeys?: Record<string, number>;
};

export type OpenLicenceAsset = {
  assetId: string;
  identity: string;
  licenseOwner: string;
  source: { kind: "git" | "archive" | "soundfont"; repository?: string; branch?: string; commit?: string; url?: string; note?: string };
  licence: { spdx: string; file: string; attribution?: string };
  smokeInstrument: string;
  instruments: OpenLicenceInstrument[];
};

export type OpenLicenceCatalogue = {
  version: number;
  assets: OpenLicenceAsset[];
  soundfontAuditions?: Array<{ id: string; identity: string; url: string; licenceClaimed: string; spdx: string; format: string }>;
  excluded?: Array<{ id: string; identity: string; source?: string; reason: string }>;
};

/** What `modal_open_licence_assets.provision_asset` writes per asset root (`provision-evidence.json`). */
export type ProvisionRecord = {
  assetId: string;
  identity?: string;
  refused?: string;
  error?: string;
  licence?: { spdx: string; file: string; sha256: string; bytes?: number; firstLine?: string; markersFound?: string[]; attribution?: string | null };
  activated?: boolean;
  warnings?: string[];
  steps?: {
    source?: { commit?: string; repository?: string; fullTree?: { sha256: string | null; fileCount: number; bytes: number; mode?: string } };
    subset?: { sha256: string; fileCount: number; bytes: number; missing?: string[] };
    operator?: { exit: number; seconds: number };
  };
  operator?: {
    host?: { identity: string; sha256: string; sfizzRenderSha256?: string };
    stage?: { candidate?: { candidateId?: string; sha256?: string; rendererSha256?: string; status?: string }; smoke?: { audible?: boolean; canonicalSensitivity?: boolean; outputSha256?: string; pitchVariantSha256?: string; expressionVariantSha256?: string; peak?: number } };
    activate?: { status?: string; sha256?: string; activatedAt?: string };
    health?: { healthy?: boolean; asset?: { id?: string; sha256?: string; rendererSha256?: string }; reason?: string };
    renders?: Record<string, { audible?: boolean; peak?: number; outputSha256?: string; wav?: string; wavSha256?: string; renderMs?: number; error?: string; durationSeconds?: number; family?: string; auditionFamily?: string; instrument?: string }>;
  };
  cost?: { containerWallSeconds?: number; costUsd?: number };
};

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * The platform's rule, evaluated only on evidence the worker produced:
 * captured licence text of the claimed licence, staged + activated through
 * `_stage_asset_candidate` / `_activate_asset_candidate` (one tree hash all
 * the way through), healthy attestation, and at least one audible render.
 * Every failing clause is a reason; none is inferred from the catalogue.
 */
export function assetAdmissibility(asset: OpenLicenceAsset, record: ProvisionRecord | undefined): { admissible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!record) return { admissible: false, reasons: ["no provisioning record: the asset was never fetched"] };
  if (record.refused) reasons.push(`licence gate refused it: ${record.refused}`);
  if (record.error) reasons.push(`provisioning failed: ${record.error}`);
  const licence = record.licence;
  if (!licence || !SHA256.test(licence.sha256 ?? "")) reasons.push("no captured licence text (sha256 missing)");
  else if (licence.spdx !== asset.licence.spdx) reasons.push(`captured licence is ${licence.spdx}, catalogue says ${asset.licence.spdx}`);
  else if (!licence.markersFound?.length) reasons.push("captured licence text does not carry the claimed legal code");
  const staged = record.operator?.stage?.candidate?.sha256;
  const activated = record.operator?.activate?.sha256;
  const attested = record.operator?.health?.asset?.sha256;
  if (!record.activated) reasons.push("not activated through the worker lifecycle");
  if (!staged || !SHA256.test(staged)) reasons.push("no staged candidate tree hash");
  if (staged && activated && staged !== activated) reasons.push("activated tree hash differs from the staged candidate");
  if (staged && attested && staged !== attested) reasons.push("health attests a different tree hash than the staged candidate");
  const smoke = record.operator?.stage?.smoke;
  if (!smoke?.audible || !smoke.canonicalSensitivity) reasons.push("three-render canonical smoke evidence is missing or not sensitive");
  if (record.operator?.health?.healthy !== true) reasons.push(`renderer_health is not healthy${record.operator?.health?.reason ? `: ${record.operator.health.reason}` : ""}`);
  const renders = Object.values(record.operator?.renders ?? {});
  if (!renders.some((render) => render.audible === true)) reasons.push("no instrument rendered an audible phrase");
  return { admissible: reasons.length === 0, reasons };
}

export type FamilyCoverageRow = {
  family: PlatformFamily;
  sampled: boolean;
  instruments: Array<{ assetId: string; sfz: string; instrument: string; standIn?: string; world?: boolean; renderMs?: number; peak?: number }>;
  /** Instruments mapped to the family whose phrase did not render audibly, or whose asset is not admissible. */
  notCounted: Array<{ assetId: string; sfz: string; why: string }>;
  fallback: string | null;
};

/** A family counts only when an admissible asset's instrument for it rendered audibly - the Python rule, verbatim. */
export function familyCoverage(catalogue: OpenLicenceCatalogue, records: Record<string, ProvisionRecord | undefined>): FamilyCoverageRow[] {
  const rows = new Map<PlatformFamily, FamilyCoverageRow>(
    PLATFORM_FAMILIES.map((family) => [family, { family, sampled: false, instruments: [], notCounted: [], fallback: null }]),
  );
  for (const asset of catalogue.assets) {
    const record = records[asset.assetId];
    const { admissible, reasons } = assetAdmissibility(asset, record);
    for (const instrument of asset.instruments) {
      const row = rows.get(instrument.family)!;
      const render = record?.operator?.renders?.[instrument.sfz];
      if (admissible && render?.audible === true) {
        row.sampled = true;
        row.instruments.push({
          assetId: asset.assetId, sfz: instrument.sfz, instrument: instrument.instrument,
          ...(instrument.standIn ? { standIn: instrument.standIn } : {}),
          ...(instrument.world ? { world: true } : {}),
          ...(typeof render.renderMs === "number" ? { renderMs: render.renderMs } : {}),
          ...(typeof render.peak === "number" ? { peak: render.peak } : {}),
        });
      } else {
        row.notCounted.push({
          assetId: asset.assetId, sfz: instrument.sfz,
          why: !admissible ? reasons[0] ?? "asset not admissible" : render?.error ? `render failed: ${render.error}` : render ? "rendered silence" : "not rendered",
        });
      }
    }
  }
  for (const row of rows.values()) {
    row.fallback = row.sampled ? null : "LOCAL_EXPRESSIVE_SYNTH (no attested sampled instrument for this family in the cloud)";
  }
  return [...rows.values()];
}

export function worldInstruments(catalogue: OpenLicenceCatalogue): Array<{ assetId: string; sfz: string; instrument: string; family: PlatformFamily; standIn?: string }> {
  return catalogue.assets.flatMap((asset) =>
    asset.instruments.filter((instrument) => instrument.world).map((instrument) => ({
      assetId: asset.assetId, sfz: instrument.sfz, instrument: instrument.instrument, family: instrument.family,
      ...(instrument.standIn ? { standIn: instrument.standIn } : {}),
    })),
  );
}

/** The routing keyword an instrument name would have to contain: the sfz stem up to the first articulation separator. */
export function instrumentKeyword(sfz: string): string {
  const stem = sfz.split("/").pop()!.replace(/\.sfz$/i, "");
  return stem.split(/\s+-\s+|,/)[0].replace(/_/g, " ").trim().toLowerCase();
}

/**
 * The instrument map an asset root publishes, in the shape PR-92's worker
 * and `nativeRendererRouting.ts` read: keyword entries per instrument, then
 * one `family` entry per family the asset serves (an instrument without a
 * stand-in wins), and a reason for every family it does not. Marked as
 * derived: a human reviews it before a worker routes by it.
 */
export function deriveSfizzInstrumentMap(asset: OpenLicenceAsset): {
  version: 1;
  library: string;
  derivedFrom: string;
  entries: Array<{ match: { nameKeyword?: string; family?: string }; sfz: string; instrument: string; keyRange: [number, number]; standIn?: string }>;
  unserved: Record<string, string>;
} {
  const entries: ReturnType<typeof deriveSfizzInstrumentMap>["entries"] = [];
  const seenKeywords = new Set<string>();
  for (const instrument of asset.instruments) {
    const keyword = instrumentKeyword(instrument.sfz);
    if (!keyword || seenKeywords.has(keyword)) continue;
    seenKeywords.add(keyword);
    entries.push({ match: { nameKeyword: keyword }, sfz: instrument.sfz, instrument: instrument.instrument, keyRange: instrument.keyRange, ...(instrument.standIn ? { standIn: instrument.standIn } : {}) });
  }
  const unserved: Record<string, string> = {};
  for (const family of PLATFORM_FAMILIES) {
    const candidates = asset.instruments.filter((instrument) => instrument.family === family);
    const chosen = candidates.find((instrument) => !instrument.standIn) ?? candidates[0];
    if (chosen) {
      entries.push({ match: { family }, sfz: chosen.sfz, instrument: chosen.instrument, keyRange: chosen.keyRange, ...(chosen.standIn ? { standIn: chosen.standIn } : {}) });
    } else {
      unserved[family] = `${asset.identity} maps no instrument to '${family}'; the stem keeps the preview synth (or another asset root) rather than a wrong instrument.`;
    }
  }
  return {
    version: 1,
    library: asset.identity,
    derivedFrom: "open_licence_assets.json (PR-93); review before a worker routes by it",
    entries,
    unserved,
  };
}

/**
 * Why the cloud holds one asset root per library although the provider id
 * stays `SFIZZ_VSCO2_CE`: the worker manifest is one active `sfz` entry, so
 * one worker process serves one library; many libraries are many roots
 * (each with its own manifest, state and attestation) that a deployment
 * selects with `MUSIC_AI_ASSET_ROOT` / `MUSIC_AI_ASSET_MANIFEST`.
 */
export function providerAssetModel(catalogue: OpenLicenceCatalogue, records: Record<string, ProvisionRecord | undefined>, assetRoot = "/var/lib/music-ai/assets"): {
  providerId: "SFIZZ_VSCO2_CE";
  activeAssetsPerWorkerProcess: 1;
  assetRoots: Array<{ assetId: string; manifest: string; sha256: string | null; admissible: boolean }>;
  why: string;
} {
  return {
    providerId: "SFIZZ_VSCO2_CE",
    activeAssetsPerWorkerProcess: 1,
    assetRoots: catalogue.assets.map((asset) => {
      const record = records[asset.assetId];
      return {
        assetId: asset.assetId,
        manifest: `${assetRoot}/${asset.assetId}/licensed_assets.json`,
        sha256: record?.operator?.activate?.sha256 ?? null,
        admissible: assetAdmissibility(asset, record).admissible,
      };
    }),
    why: "app.py keeps exactly one active `sfz` entry per manifest (`_licensed_asset('sfz')`, `_activate_asset_candidate` replaces it atomically) and `renderer_health('SFIZZ_VSCO2_CE')` attests that one entry; there is no multi-asset manifest yet. So the provider id is one, a worker process serves one library, and each library is its own asset root on the Volume. Serving several at once means several worker deployments (one env per root) or a manifest with a list of sfz entries - the follow-up that also merges PR-92's instrument map with these roots.",
  };
}

export function estimatedSpend(records: Array<{ cost?: { costUsd?: number; containerWallSeconds?: number } } | undefined>, extraUsd = 0): { estimatedUsd: number; containerWallSeconds: number } {
  let usd = extraUsd;
  let seconds = 0;
  for (const record of records) {
    usd += record?.cost?.costUsd ?? 0;
    seconds += record?.cost?.containerWallSeconds ?? 0;
  }
  return { estimatedUsd: Math.round(usd * 10000) / 10000, containerWallSeconds: Math.round(seconds) };
}
