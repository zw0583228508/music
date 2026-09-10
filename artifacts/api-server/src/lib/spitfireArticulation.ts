/**
 * Spitfire articulation adapter (PR-97, stream SPITFIRE-1).
 *
 * The Performance Engine decides *what* is played: per-phrase articulation
 * events (`legato`, `staccato`, `bow_change`, ...), CC1 dynamics and CC11
 * expression. A Spitfire Audio instrument decides how to *receive* that: its
 * own keyswitch table per preset and, when a preset is locked to UACC, a CC32
 * value from Spitfire's published UACC table. This module is the pure
 * translation between the two - no I/O, deterministic, idempotent - so the
 * platform can re-derive the exact TrackModel the worker rendered and verify
 * the worker's echoed digest against it.
 *
 * What was measured on the owner's Abbey Road One (Selections) before this was
 * written (`docs/evidence/spitfire-local-render-live.json`):
 *   - the plugin's default articulation mode is KEYSWITCH, not UACC: CC32
 *     values 1/40/56 leave the render byte-identical; MIDI notes 0..5 switch
 *     the six articulations of the loaded preset;
 *   - CC1 = 0 is ignored (renders as full dynamics), CC1 1..127 spans ~12 dB;
 *     with no CC1 at all the instrument sits at full dynamics;
 *   - CC11 = 0 is silence; long articulations ignore velocity, shorts follow it.
 * Every default below follows from one of those measurements.
 */
import type { ArticulationEvent, ControlEvent, TrackModel } from "@workspace/db";

export const SPITFIRE_ARTICULATION_ADAPTER = "spitfire-articulation/v1";

// ---------------------------------------------------------------------------
// UACC v2 - Spitfire's Universal Articulation Controller Channel (CC32)
// ---------------------------------------------------------------------------

/** How well a UACC value is attested by a published Spitfire source. */
export type UaccConfidence = "published" | "inferred";

export type UaccEntry = { value: number; name: string; confidence: UaccConfidence; source: string };

const PUBLISHED_HELP = "Spitfire Audio Help Centre, 'What is UACC and how do I use it?' (examples 1 Long, 26 Legato - Muted, 52 Short - Marcato)";
const PUBLISHED_TABLE = "UACC v2 table as reproduced from Spitfire manuals (values 1-20 verbatim, 56 Plucked/pizz)";
const INFERRED = "inferred from the UACC v2 group layout (long 1-19, legato 20-39, short 40-55) - not read from a published row";

const LONG_VARIANTS = [
  "Long", "Long (alternative)", "Long (octave)", "Long (octave muted)", "Long (small 1/2)", "Long (small muted)",
  "Long (muted)", "Long (soft: flautando/hollow)", "Long (hard: cuivre/overblown)", "Long (harmonic)",
  "Long (tremolo/flutter)", "Long (tremolo muted)", "Long (tremolo soft/low)", "Long (tremolo hard/high)",
  "Long (tremolo muted low)", "Long (vibrato: molto vib)", "Long (higher: sul tasto/bells up)", "Long (lower: sul pont)",
  "Long (lower muted)",
];

function buildUaccTable(): ReadonlyMap<number, UaccEntry> {
  const table = new Map<number, UaccEntry>();
  LONG_VARIANTS.forEach((name, index) => table.set(index + 1, { value: index + 1, name, confidence: "published", source: PUBLISHED_TABLE }));
  // Legato 20..38 mirrors the long group (20 = Legato generic is published; 26 = Legato - Muted is published, which is
  // exactly the long-group offset 7 - 1 = 6 added to 20).
  LONG_VARIANTS.forEach((name, index) => {
    const value = 20 + index;
    const legatoName = name.replace(/^Long/, "Legato");
    const published = value === 20 || value === 26;
    table.set(value, { value, name: legatoName, confidence: published ? "published" : "inferred", source: published ? (value === 20 ? PUBLISHED_TABLE : PUBLISHED_HELP) : INFERRED });
  });
  const shorts: Array<[number, string, UaccConfidence]> = [
    [40, "Short", "inferred"], [41, "Short (alternative)", "inferred"], [42, "Short (octave)", "inferred"],
    [43, "Short (octave muted)", "inferred"], [44, "Short (small 1/2)", "inferred"], [45, "Short (small muted)", "inferred"],
    [46, "Short (muted)", "inferred"], [47, "Short (soft)", "inferred"], [48, "Short (hard)", "inferred"],
    [49, "Short (harmonic)", "inferred"], [50, "Short (tenuto)", "inferred"], [51, "Short (tenuto muted)", "inferred"],
    [52, "Short (marcato)", "published"], [53, "Short (marcato muted)", "inferred"], [54, "Short (staccatissimo)", "inferred"],
    [55, "Short (staccatissimo muted)", "inferred"],
    [56, "Plucked (pizzicato)", "published"], [57, "Plucked (muted)", "inferred"], [58, "Plucked (hard: Bartok)", "inferred"],
    [59, "Plucked (soft)", "inferred"], [60, "Col legno", "inferred"],
    [70, "Trill (minor 2nd)", "inferred"], [71, "Trill (major 2nd)", "inferred"], [72, "Trill (minor 3rd)", "inferred"],
    [73, "Trill (major 3rd)", "inferred"], [74, "Trill (perfect 4th)", "inferred"],
  ];
  for (const [value, name, confidence] of shorts) {
    table.set(value, { value, name, confidence, source: confidence === "published" ? (value === 56 ? PUBLISHED_TABLE : PUBLISHED_HELP) : INFERRED });
  }
  return table;
}

/** CC32 value -> articulation, with the confidence of each row. */
export const UACC_V2: ReadonlyMap<number, UaccEntry> = buildUaccTable();

export function uaccEntry(value: number): UaccEntry | undefined {
  return UACC_V2.get(value);
}

// ---------------------------------------------------------------------------
// Technique intent: what the Performance Engine's names mean to a Spitfire patch
// ---------------------------------------------------------------------------

export type SpitfireTechnique =
  | "long" | "legato" | "short" | "marcato" | "pizzicato" | "tremolo" | "trill" | "harmonic" | "muted";

/** The UACC value the adapter sends for each technique (CC32). */
export const TECHNIQUE_UACC: Record<SpitfireTechnique, number> = {
  long: 1, legato: 20, short: 40, marcato: 52, pizzicato: 56, tremolo: 11, trill: 70, harmonic: 10, muted: 7,
};

/**
 * Performance Engine / InstrumentDefinition articulation names -> technique.
 * Names that are not techniques (`fall`, `doit`, `shake`, drum limbs) map to
 * nothing and leave the current technique in force.
 */
const INTENT_BY_NAME: Record<string, SpitfireTechnique> = {
  legato: "legato", vibrato: "legato", finger: "legato",
  sustain: "long", long: "long", attack: "long", bow_change: "long", normal: "long", soft: "long", hard: "long", pad: "long",
  staccato: "short", spiccato: "short", short: "short", pick: "short", pluck: "short", palm_mute: "short",
  marcato: "marcato", accent: "marcato",
  pizzicato: "pizzicato", pizz: "pizzicato",
  tremolo: "tremolo", flutter: "tremolo",
  trill: "trill",
  harmonic: "harmonic",
  mute: "muted", con_sord: "muted",
};

export function techniqueForArticulation(name: string): SpitfireTechnique | null {
  return INTENT_BY_NAME[name.trim().toLowerCase()] ?? null;
}

// ---------------------------------------------------------------------------
// Per-library profile: what a Spitfire asset can do on this workstation
// ---------------------------------------------------------------------------

/**
 * Hints the worker passes through from the private manifest for a Spitfire
 * asset (`asset_public_fields`). Every field is optional; the built-in
 * knowledge for a known library fills the rest, and the manifest wins.
 */
export type SpitfireAssetHints = {
  id: string;
  name?: string;
  manufacturer?: string;
  families?: string[];
  character?: string[];
  patches?: string[];
  gainTrimDb?: number;
  articulation?: {
    /** "keyswitch" (Spitfire's default) or "uacc" (preset locked to UACC in the plugin UI). */
    protocol?: "keyswitch" | "uacc";
    /** Preset keyswitch table: technique or preset articulation name -> MIDI note. */
    keyswitches?: Record<string, number>;
    keyswitchLeadSeconds?: number;
    defaultCc1?: number;
    defaultCc11?: number;
  };
};

export type SpitfireLibraryProfile = {
  assetId: string;
  library: string;
  /** Presets/patches installed for this plugin (content folder), as far as is known. */
  patches: string[];
  /** Platform families this asset may play; anything else is refused with a reason. */
  servedFamilies: string[];
  /** InstrumentDefinition ids refused even inside a served family (a string section is not a bass). */
  refusedInstrumentIds: string[];
  protocol: "keyswitch" | "uacc";
  /** Technique -> MIDI keyswitch note for the loaded preset. */
  keyswitches: Partial<Record<SpitfireTechnique, number>>;
  /** Preset articulation labels behind the keyswitch table, for the record. */
  keyswitchLabels: Record<string, number>;
  keyswitchLeadSeconds: number;
  defaultCc1: number;
  defaultCc11: number;
  gainTrimDb: number;
  /** Why this profile says what it says. */
  basis: string;
};

/**
 * Built-in knowledge per library. The Abbey Road One entry is what the owner's
 * install *actually* holds: the free "Selections" woodwind ensembles (content
 * folder `Patches/Mysterious Reeds`, `Patches/Vibrant Reeds`), not Orchestral
 * Foundations - so strings and brass are refused, not approximated with reeds.
 */
const KNOWN_LIBRARIES: Array<{
  match: (asset: SpitfireAssetHints) => boolean;
  library: string;
  patches: string[];
  servedFamilies: string[];
  refusedInstrumentIds: string[];
  keyswitches: Partial<Record<SpitfireTechnique, number>>;
  keyswitchLabels: Record<string, number>;
  basis: string;
}> = [
  {
    match: (asset) => /abbey road one/i.test(asset.name ?? "") || /abbey-road-one/i.test(asset.id),
    library: "Abbey Road One (Selections: Mysterious Reeds, Vibrant Reeds)",
    patches: ["Mysterious Reeds", "Vibrant Reeds"],
    servedFamilies: ["winds"],
    refusedInstrumentIds: [],
    // Measured 2026-09-10 on the plugin's default preset (Mysterious Reeds), keyswitch mode:
    // note 0 Legato, 1 Long, 2 Short Staccato, 3 Legato (8ve), 4 Long (8ve), 5 Short Staccato (8ve).
    // The Legato patch (note 0) is not usable offline: through the worker it rendered
    // non-deterministically and, once the opening keyswitch is primed, fully silent
    // (`switching-measurement` in the evidence) - so `legato` intent plays the Long
    // patch, which is deterministic and audible, until a realtime-safe legato is proven.
    keyswitches: { legato: 1, long: 1, short: 2, marcato: 2, tremolo: 1, trill: 1, harmonic: 1, muted: 1, pizzicato: 2 },
    keyswitchLabels: { "Legato": 0, "Long": 1, "Short Staccato": 2, "Legato (8ve)": 3, "Long (8ve)": 4, "Short Staccato (8ve)": 5 },
    basis: "plugin state XML (SPITFIREAUDIO_ABBEY_ROAD_ONE/ARTICS, t_keyswitch 0..5, p_articLock 0) + render measurement: CC32 inert, notes 0..5 switch",
  },
  {
    match: (asset) => /bbc symphony orchestra/i.test(asset.name ?? "") || /bbcso/i.test(asset.id),
    library: "BBC Symphony Orchestra",
    patches: [],
    servedFamilies: ["strings", "brass", "winds"],
    refusedInstrumentIds: ["bass"],
    keyswitches: {},
    keyswitchLabels: {},
    basis: "library coverage from the product; keyswitch table must come from the manifest (read from the loaded preset's state) - not yet measured on this workstation",
  },
  {
    match: (asset) => /hans zimmer strings/i.test(asset.name ?? "") || /hzs|hans-zimmer/i.test(asset.id),
    library: "Hans Zimmer Strings",
    patches: [],
    servedFamilies: ["strings"],
    refusedInstrumentIds: ["bass"],
    keyswitches: {},
    keyswitchLabels: {},
    basis: "library coverage from the product; keyswitch table must come from the manifest - not yet measured on this workstation",
  },
  {
    match: (asset) => /abbey road orchestra/i.test(asset.name ?? "") || /abbey-road-orchestra/i.test(asset.id),
    library: "Abbey Road Orchestra (section product)",
    patches: [],
    servedFamilies: ["strings"],
    refusedInstrumentIds: ["bass"],
    keyswitches: {},
    keyswitchLabels: {},
    basis: "cellos/violas products serve the strings family only; keyswitch table from the manifest",
  },
];

export function isSpitfireAsset(asset: { manufacturer?: string; character?: string[]; name?: string }): boolean {
  return /spitfire/i.test(asset.manufacturer ?? "") || /spitfire/i.test(asset.name ?? "") || (asset.character ?? []).some((word) => /^(spitfire|uacc)$/i.test(word));
}

/** The profile for a Spitfire asset, or null for any other instrument. */
export function spitfireProfileForAsset(asset: SpitfireAssetHints): SpitfireLibraryProfile | null {
  if (!isSpitfireAsset(asset)) return null;
  const known = KNOWN_LIBRARIES.find((entry) => entry.match(asset));
  const hinted = asset.articulation ?? {};
  const keyswitches: Partial<Record<SpitfireTechnique, number>> = { ...(known?.keyswitches ?? {}) };
  const labels: Record<string, number> = { ...(known?.keyswitchLabels ?? {}) };
  for (const [name, note] of Object.entries(hinted.keyswitches ?? {})) {
    if (!Number.isInteger(note) || note < 0 || note > 127) continue;
    const technique = techniqueForArticulation(name);
    if (technique) keyswitches[technique] = note;
    labels[name] = note;
  }
  const servedFamilies = known ? known.servedFamilies : (asset.families ?? []).map((f) => f.toLowerCase());
  return {
    assetId: asset.id,
    library: known?.library ?? (asset.name ?? asset.id),
    patches: asset.patches?.length ? asset.patches : known?.patches ?? [],
    servedFamilies,
    refusedInstrumentIds: known?.refusedInstrumentIds ?? ["bass"],
    protocol: hinted.protocol ?? "keyswitch",
    keyswitches,
    keyswitchLabels: labels,
    keyswitchLeadSeconds: clampNumber(hinted.keyswitchLeadSeconds, 0.05, 1, 0.25),
    defaultCc1: clampNumber(hinted.defaultCc1, 1, 127, 96),
    defaultCc11: clampNumber(hinted.defaultCc11, 1, 127, 112),
    gainTrimDb: clampNumber(asset.gainTrimDb, -24, 24, 0),
    basis: known?.basis ?? "no built-in knowledge for this library; served families are the manifest's declaration",
  };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

// ---------------------------------------------------------------------------
// Refusal: never play a family the library does not hold
// ---------------------------------------------------------------------------

type RoutableTrack = Pick<TrackModel, "instrument"> & {
  instrumentDefinition: Pick<TrackModel["instrumentDefinition"], "id" | "family">;
};

/** The reason this asset must not play this track, or null when it may. */
export function spitfireRefusal(track: RoutableTrack, profile: SpitfireLibraryProfile): string | null {
  const family = track.instrumentDefinition.family;
  const id = track.instrumentDefinition.id;
  if (!profile.servedFamilies.includes(family)) {
    return `${profile.library} holds no ${family} content (installed: ${profile.patches.join(", ") || "unknown"}; serves: ${profile.servedFamilies.join(", ") || "nothing yet"}) - '${track.instrument}' is not sent to it`;
  }
  if (profile.refusedInstrumentIds.includes(id)) {
    return `${profile.library} is a section library and does not play the '${id}' instrument ('${track.instrument}') - a section is not a stand-in for it`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export type SpitfireAdaptationReport = {
  adapter: typeof SPITFIRE_ARTICULATION_ADAPTER;
  assetId: string;
  protocol: "keyswitch" | "uacc";
  /** What the worker is told to play keyswitches ahead by (`parameters.keyswitchLeadSeconds`). */
  keyswitchLeadSeconds: number;
  /** Technique changes, in time order, with what was sent for each. */
  techniqueChanges: Array<{ time: number; technique: SpitfireTechnique; from: string; uacc: number; keyswitch: number | null }>;
  cc32Events: number;
  keyswitchesRewritten: number;
  keyswitchesDropped: number;
  cc1Inserted: boolean;
  cc11Inserted: boolean;
  cc1Clamped: number;
  cc11Clamped: number;
  unmappedArticulations: string[];
};

function round(value: number): number {
  return Number(value.toFixed(4));
}

/**
 * Translate a performed TrackModel into what a Spitfire instrument expects.
 *
 * - every articulation event becomes a technique; the technique's keyswitch
 *   from the preset table is written on the event (the worker's bridge plays
 *   it as a short note `keyswitchLeadSeconds` ahead - the lead crosses the wire
 *   as a render parameter, the event keeps its canonical time), and the
 *   technique's UACC value is emitted on CC32 at that lead (inert in keyswitch
 *   mode, authoritative when the preset is locked to UACC);
 * - an event the preset cannot switch (no keyswitch) keeps its name for the
 *   record but sends no keyswitch, so the generic `24 + index` note the
 *   Performance Engine assumed is never played into a Spitfire patch;
 * - a track without CC1 gets `defaultCc1` at t = 0; CC1 is clamped to >= 1
 *   (AR1 ignores 0) and CC11 to >= 1 (0 is silence);
 * - notes, automation and every other field are untouched.
 *
 * Idempotent: adapting the output again yields the same TrackModel.
 */
export function adaptTrackForSpitfire(track: TrackModel, profile: SpitfireLibraryProfile): { track: TrackModel; report: SpitfireAdaptationReport } {
  const lead = profile.keyswitchLeadSeconds;
  const report: SpitfireAdaptationReport = {
    adapter: SPITFIRE_ARTICULATION_ADAPTER,
    assetId: profile.assetId,
    protocol: profile.protocol,
    keyswitchLeadSeconds: lead,
    techniqueChanges: [],
    cc32Events: 0,
    keyswitchesRewritten: 0,
    keyswitchesDropped: 0,
    cc1Inserted: false,
    cc11Inserted: false,
    cc1Clamped: 0,
    cc11Clamped: 0,
    unmappedArticulations: [],
  };

  // Articulations -> techniques. The engine may already have placed the event
  // `lead` seconds early on a previous pass; the technique and the original
  // name are what matters, so the pass is stable.
  const sorted = [...track.articulations].sort((a, b) => a.time - b.time);
  const articulations: ArticulationEvent[] = [];
  let current: SpitfireTechnique | null = null;
  const firstNote = track.notes.length ? Math.min(...track.notes.map((note) => note.start)) : 0;
  for (const event of sorted) {
    const technique = techniqueForArticulation(event.name);
    if (!technique) {
      if (!report.unmappedArticulations.includes(event.name)) report.unmappedArticulations.push(event.name);
      // Not a technique: keep the event but never a generic keyswitch note.
      const { keyswitch, ...rest } = event;
      if (keyswitch !== undefined) report.keyswitchesDropped += 1;
      articulations.push(rest);
      continue;
    }
    const keyswitch = profile.keyswitches[technique];
    // The event keeps the Performance Engine's time (the truth about when the
    // technique applies); the worker plays the keyswitch `lead` seconds earlier
    // (`parameters.keyswitchLeadSeconds`), and CC32 goes out at that same lead.
    const time = round(event.time);
    if (technique !== current) {
      report.techniqueChanges.push({ time, technique, from: event.name, uacc: TECHNIQUE_UACC[technique], keyswitch: keyswitch ?? null });
      current = technique;
    }
    if (event.keyswitch !== undefined && event.keyswitch !== keyswitch) report.keyswitchesRewritten += 1;
    const { keyswitch: _old, ...rest } = event;
    articulations.push(keyswitch === undefined ? { ...rest, time } : { ...rest, time, keyswitch });
  }
  // A track with notes but no technique at all starts on the long articulation,
  // explicitly, so the render never depends on whatever the preset last held.
  if (!report.techniqueChanges.length && track.notes.length) {
    const technique: SpitfireTechnique = "long";
    const keyswitch = profile.keyswitches[technique];
    const time = round(firstNote);
    report.techniqueChanges.push({ time, technique, from: "(default)", uacc: TECHNIQUE_UACC[technique], keyswitch: keyswitch ?? null });
    articulations.push(keyswitch === undefined ? { time, name: "long", intensity: 0.5 } : { time, name: "long", keyswitch, intensity: 0.5 });
  }
  articulations.sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));

  // Controllers: CC32 regenerated from the technique changes; CC1/CC11 clamped
  // and defaulted.
  const cc: ControlEvent[] = [];
  let sawCc1 = false;
  let sawCc11 = false;
  for (const event of track.cc) {
    if (event.controller === 32) continue; // regenerated below
    if (event.controller === 1) {
      sawCc1 = true;
      if (event.value < 1) { report.cc1Clamped += 1; cc.push({ ...event, value: 1 }); continue; }
    }
    if (event.controller === 11) {
      sawCc11 = true;
      if (event.value < 1) { report.cc11Clamped += 1; cc.push({ ...event, value: 1 }); continue; }
    }
    cc.push({ ...event });
  }
  for (const change of report.techniqueChanges) {
    cc.push({ controller: 32, time: round(Math.max(0, change.time - lead)), value: change.uacc });
    report.cc32Events += 1;
  }
  if (!sawCc1 && track.notes.length) { cc.push({ controller: 1, time: 0, value: profile.defaultCc1 }); report.cc1Inserted = true; }
  if (!sawCc11 && track.notes.length) { cc.push({ controller: 11, time: 0, value: profile.defaultCc11 }); report.cc11Inserted = true; }
  cc.sort((a, b) => a.time - b.time || a.controller - b.controller || a.value - b.value);

  return { track: { ...track, cc, articulations }, report };
}

/** Linear gain for a profile's measured trim (applied to the rendered stem by the export, never inside the attestation). */
export function spitfireGainTrimLinear(profile: SpitfireLibraryProfile): number {
  return 10 ** (profile.gainTrimDb / 20);
}
