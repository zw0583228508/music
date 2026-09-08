/**
 * Sound Selection Brain (PR-24).
 *
 * PR-22 let an operator say "bass goes to Retrologue". This decides, for
 * musical reasons, what each track's sound should be — and only then which
 * attested instrument fits it best. Two layers, kept apart on purpose:
 *
 *   1. `deriveSoundTarget` — role, family and the notes themselves give a
 *      catalogue-independent target (register, attack, sustain, brightness,
 *      width, space, saturation, dynamics response, character words). The
 *      StyleProfile's sound dimensions override, each with its provenance, so
 *      the profile can later explain why the pad is wide and warm.
 *   2. `selectTrackSound` — scores every attested catalogue entry against the
 *      target. Deterministic (score, then id). Never an instrument whose
 *      declared families exclude the track, never one the producer excluded,
 *      and a refusal with the reason rather than a guess when nothing fits.
 *
 * `resolveTrackAsset` sets the precedence against the operator's table: an
 * explicit operator rule wins; otherwise the brain; then the table default;
 * then the worker's own default. A rule naming an unattested asset refuses,
 * exactly as PR-22 decided.
 */
import { createHash } from "node:crypto";
import type {
  InstrumentSoundProfile,
  MusicalNote,
  SoundCatalogueEntry,
  SoundSelectionCandidate,
  SoundTarget,
  SoundTargetProvenance,
  StyleProfile,
} from "@workspace/db";
import { routePremiumInstrument, type PremiumRoutingTable } from "./premiumInstrumentRouting";

export const SOUND_SELECTION_METHOD = "sound-selection-brain/v1";

export type SoundTrack = {
  trackId: string;
  instrument: string;
  role: string;
  family: string;
  notes?: readonly MusicalNote[];
};

// ---------------------------------------------------------------------------
// Musical knowledge: what a role and a family ask of a sound
// ---------------------------------------------------------------------------

const DEFAULT_TARGET: SoundTarget = {
  register: "mid", attack: "medium", sustain: "medium", brightness: "neutral",
  width: "natural", space: "small", saturation: "clean", dynamicsResponse: "moderate", character: [],
};

const FAMILY_TARGETS: Record<string, Partial<SoundTarget>> = {
  drums: { attack: "sharp", sustain: "short", space: "small", dynamicsResponse: "wide" },
  keys: { attack: "medium", sustain: "medium", width: "natural", space: "small" },
  strings: { attack: "soft", sustain: "long", width: "wide", space: "medium" },
  brass: { attack: "medium", sustain: "medium", brightness: "bright", space: "medium" },
  winds: { attack: "soft", sustain: "medium", width: "narrow", space: "medium" },
  guitar: { attack: "sharp", sustain: "medium", width: "narrow", space: "small" },
  voice: { attack: "soft", sustain: "medium", width: "narrow", space: "medium" },
  synth: { attack: "medium", sustain: "medium", width: "wide", space: "dry", saturation: "clean" },
};

const ROLE_TARGETS: Record<string, Partial<SoundTarget>> = {
  BASS: { register: "low", width: "mono", attack: "medium", sustain: "medium", brightness: "dark" },
  FOUNDATION: { register: "low", width: "narrow", attack: "soft", sustain: "long" },
  GROOVE: { attack: "sharp", sustain: "short", width: "natural", dynamicsResponse: "wide" },
  FILL: { attack: "sharp", sustain: "short", dynamicsResponse: "wide" },
  PAD: { attack: "soft", sustain: "long", width: "wide", brightness: "dark" },
  HARMONIC_BED: { attack: "soft", sustain: "long", width: "wide" },
  RHYTHMIC_HARMONY: { attack: "medium", sustain: "short", width: "natural" },
  OSTINATO: { attack: "sharp", sustain: "short", width: "narrow" },
  LEAD: { register: "high", attack: "medium", sustain: "medium", width: "narrow", brightness: "bright", dynamicsResponse: "wide" },
  COUNTER_MELODY: { register: "mid", attack: "medium", width: "narrow" },
  CALL_RESPONSE: { register: "mid", attack: "medium", width: "natural" },
  ACCENT: { attack: "sharp", sustain: "short", brightness: "bright" },
  TRANSITION: { attack: "soft", sustain: "long", width: "wide" },
  CLIMAX_LAYER: { sustain: "long", width: "wide", brightness: "bright", dynamicsResponse: "wide" },
};

/**
 * Words a free-text sound aesthetic may carry, and what each asks of the
 * target. Open vocabulary in, fixed target fields out; the word itself is kept
 * as a character word so the catalogue can match it too.
 */
const AESTHETIC_WORDS: Array<{ words: string[]; apply: Partial<SoundTarget> }> = [
  { words: ["warm", "vintage", "analog", "analogue", "tape", "retro"], apply: { saturation: "warm" } },
  { words: ["bright", "crisp", "airy", "sparkling", "shiny"], apply: { brightness: "bright" } },
  { words: ["dark", "moody", "brooding", "muted"], apply: { brightness: "dark" } },
  { words: ["lo-fi", "lofi", "lo_fi", "dusty", "grainy"], apply: { saturation: "lo_fi" } },
  { words: ["gritty", "driven", "distorted", "dirty", "saturated"], apply: { saturation: "driven" } },
  { words: ["clean", "modern", "polished", "pristine", "hi-fi"], apply: { saturation: "clean" } },
  { words: ["cinematic", "epic", "huge", "massive", "orchestral"], apply: { space: "large", width: "wide" } },
  { words: ["intimate", "close", "acoustic", "small", "chamber"], apply: { space: "small", width: "narrow" } },
  { words: ["dry", "tight"], apply: { space: "dry" } },
  { words: ["wide", "spacious", "ambient", "atmospheric"], apply: { width: "wide" } },
  { words: ["hall", "cathedral", "reverberant"], apply: { space: "hall" } },
];

/**
 * What an operator's character word on an instrument says about its fit. A
 * word that fits the target earns a point; a word that contradicts it costs
 * one only when the contradicted field was *asked for* by the style — a
 * default is not an intent, and an analog synth is not wrong for a bass
 * nobody described.
 */
const CHARACTER_AFFINITIES: Array<{ words: string[]; fields: Array<keyof SoundTarget>; fits: (t: SoundTarget) => boolean; note: string }> = [
  { words: ["warm", "analog", "analogue", "vintage", "tape"], fields: ["saturation"], fits: (t) => t.saturation === "warm", note: "warm saturation" },
  { words: ["bright", "crisp", "airy"], fields: ["brightness"], fits: (t) => t.brightness === "bright", note: "bright" },
  { words: ["dark", "mellow", "muted"], fields: ["brightness"], fits: (t) => t.brightness === "dark", note: "dark" },
  { words: ["pad", "granular", "ambient", "evolving", "texture"], fields: ["sustain", "width"], fits: (t) => t.sustain === "long" && t.width === "wide", note: "long, wide sustain" },
  { words: ["percussive", "drum", "kit", "hit"], fields: ["attack", "sustain"], fits: (t) => t.attack === "sharp" && t.sustain === "short", note: "sharp, short" },
  { words: ["mono", "sub"], fields: ["width", "register"], fits: (t) => t.width === "mono" || t.register === "low", note: "mono / low register" },
  { words: ["lo-fi", "lofi", "dusty"], fields: ["saturation"], fits: (t) => t.saturation === "lo_fi", note: "lo-fi" },
  { words: ["driven", "gritty", "distorted"], fields: ["saturation"], fits: (t) => t.saturation === "driven", note: "driven" },
  { words: ["clean", "digital", "pristine", "hi-fi"], fields: ["saturation"], fits: (t) => t.saturation === "clean", note: "clean" },
  { words: ["acoustic", "natural", "sampled"], fields: ["space", "saturation"], fits: (t) => t.space !== "dry" && t.saturation !== "driven", note: "acoustic" },
  { words: ["wide", "stereo", "spacious"], fields: ["width"], fits: (t) => t.width === "wide", note: "wide" },
];

const words = (text: string): string[] =>
  text.toLowerCase().split(/[^a-z0-9_\-]+/).filter(Boolean);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([l], [r]) => (l < r ? -1 : l > r ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Layer 1: the target
// ---------------------------------------------------------------------------

export function deriveSoundTarget(
  track: SoundTrack,
  styleProfile?: StyleProfile | null,
): { target: SoundTarget; provenance: SoundTargetProvenance[] } {
  const target: SoundTarget = { ...DEFAULT_TARGET, character: [] };
  const provenance: SoundTargetProvenance[] = [];
  const set = <K extends keyof SoundTarget>(field: K, value: SoundTarget[K], source: SoundTargetProvenance["source"], detail: string) => {
    target[field] = value;
    provenance.push({ field, source, detail });
  };
  const apply = (partial: Partial<SoundTarget>, source: SoundTargetProvenance["source"], detail: string) => {
    for (const [field, value] of Object.entries(partial) as Array<[keyof SoundTarget, SoundTarget[keyof SoundTarget]]>) {
      if (field === "character" || value === undefined) continue;
      set(field, value as never, source, detail);
    }
  };

  const family = track.family.toLowerCase();
  const role = track.role.toUpperCase();
  apply(FAMILY_TARGETS[family] ?? {}, "family", `${family} family`);
  apply(ROLE_TARGETS[role] ?? {}, "role", `${role} role`);

  // The notes are the truth about register and sustain: a LEAD written in the
  // tenor register is a mid-register sound however the role is labelled.
  const notes = track.notes ?? [];
  if (notes.length && family !== "drums") {
    const pitches = notes.map((n) => n.pitch);
    const mean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
    const span = Math.max(...pitches) - Math.min(...pitches);
    const register: SoundTarget["register"] = span > 30 ? "wide" : mean < 48 ? "low" : mean > 72 ? "high" : "mid";
    set("register", register, "notes", `mean pitch ${mean.toFixed(1)}, span ${span} semitones`);
    const durations = notes.map((n) => n.duration).sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)];
    if (median < 0.2) set("sustain", "short", "notes", `median note ${median.toFixed(2)}s`);
    else if (median > 1.0) set("sustain", "long", "notes", `median note ${median.toFixed(2)}s`);
  }

  // The style overrides, dimension by dimension, each carrying its provenance.
  const dims = styleProfile?.dimensions;
  if (dims) {
    const via = (name: string, provenanceOf: string) => `style ${name} (${provenanceOf})`;
    if (dims.soundAesthetic?.value) {
      const aesthetic = String(dims.soundAesthetic.value);
      for (const word of words(aesthetic)) {
        const rule = AESTHETIC_WORDS.find((r) => r.words.includes(word));
        if (!target.character.includes(word)) target.character.push(word);
        if (rule) apply(rule.apply, "style", via(`soundAesthetic "${word}"`, dims.soundAesthetic.provenance));
      }
      if (target.character.length) provenance.push({ field: "character", source: "style", detail: via(`soundAesthetic "${aesthetic}"`, dims.soundAesthetic.provenance) });
    }
    if (dims.saturation?.value) set("saturation", dims.saturation.value, "style", via("saturation", dims.saturation.provenance));
    if (dims.roomSize?.value) set("space", dims.roomSize.value, "style", via("roomSize", dims.roomSize.provenance));
    if (dims.stereoAesthetic?.value && role !== "BASS") set("width", dims.stereoAesthetic.value, "style", via("stereoAesthetic", dims.stereoAesthetic.provenance));
    if (dims.dynamics?.value) set("dynamicsResponse", dims.dynamics.value, "style", via("dynamics", dims.dynamics.provenance));
    if (dims.registerTendencies?.value && !notes.length) {
      set("register", dims.registerTendencies.value, "style", via("registerTendencies", dims.registerTendencies.provenance));
    }
    if (dims.era?.value) {
      const era = String(dims.era.value);
      const year = Number((era.match(/\d{4}/) ?? [])[0]);
      if (year && year < 2000 && !target.character.includes("vintage")) {
        target.character.push("vintage");
        provenance.push({ field: "character", source: "style", detail: via(`era "${era}"`, dims.era.provenance) });
      }
    }
  }
  return { target, provenance };
}

// ---------------------------------------------------------------------------
// Layer 2: the catalogue
// ---------------------------------------------------------------------------

function excludedBy(entry: SoundCatalogueEntry, styleProfile?: StyleProfile | null): string | null {
  for (const exclusion of styleProfile?.exclusions ?? []) {
    const banned = words(exclusion.value);
    if (!banned.length) continue;
    const haystack = [
      ...(entry.character ?? []), ...(entry.families ?? []), ...words(entry.name ?? ""),
    ].map((w) => w.toLowerCase());
    const hit = banned.find((b) => haystack.includes(b) || haystack.includes(`${b}s`) || haystack.some((h) => h.length > 3 && b.startsWith(h)));
    if (hit) return `the producer excluded "${exclusion.value}"`;
  }
  return null;
}

export function scoreCatalogueEntry(
  track: SoundTrack,
  target: SoundTarget,
  entry: SoundCatalogueEntry,
  styleProfile?: StyleProfile | null,
  /** Target fields the style asked for explicitly; contradictions there cost. */
  styledFields: ReadonlySet<keyof SoundTarget> = new Set(),
): SoundSelectionCandidate | { assetId: string; rejected: string } {
  const family = track.family.toLowerCase();
  const role = track.role.toUpperCase();
  const excluded = excludedBy(entry, styleProfile);
  if (excluded) return { assetId: entry.assetId, rejected: excluded };

  const families = (entry.families ?? []).map((f) => f.toLowerCase());
  const roles = (entry.roles ?? []).map((r) => r.toUpperCase());
  const reasons: string[] = [];
  let score = 0;

  // A bass is written in the strings definition family; an instrument that
  // declares itself for "bass" serves the BASS role wherever the definition
  // files it. Anything else with declared families must name this one.
  const familyOk = !families.length || families.includes(family) || (role === "BASS" && families.includes("bass"));
  if (!familyOk) return { assetId: entry.assetId, rejected: `declared for ${families.join("/")}, not ${family}` };
  if (!families.length) { score += 1; reasons.push("universal instrument (no families declared)"); }
  else { score += 4; reasons.push(`declared for family ${family}`); }

  if (roles.length) {
    // An instrument that names its roles is *for* those roles: a pad
    // instrument offered a bass is a worse fit than one that claims nothing.
    if (roles.includes(role)) { score += 3; reasons.push(`declared for role ${role}`); }
    else { score -= 4; reasons.push(`declared for ${roles.join("/")}, not ${role}`); }
  }

  const character = (entry.character ?? []).map((c) => c.toLowerCase());
  const nameWords = words(`${entry.name ?? ""} ${entry.manufacturer ?? ""}`);
  for (const word of target.character) {
    if (character.includes(word) || nameWords.includes(word)) { score += 2; reasons.push(`character "${word}" matches`); }
  }
  for (const affinity of CHARACTER_AFFINITIES) {
    const word = affinity.words.find((w) => character.includes(w));
    if (!word) continue;
    if (affinity.fits(target)) { score += 1; reasons.push(`"${word}" fits ${affinity.note}`); }
    else if (affinity.fields.some((f) => styledFields.has(f))) { score -= 1; reasons.push(`"${word}" contradicts the style's ${affinity.fields.filter((f) => styledFields.has(f)).join("/")}`); }
  }
  return { assetId: entry.assetId, score, reasons };
}

export function selectTrackSound(
  track: SoundTrack,
  catalogue: readonly SoundCatalogueEntry[],
  styleProfile?: StyleProfile | null,
): InstrumentSoundProfile {
  const { target, provenance } = deriveSoundTarget(track, styleProfile);
  const styledFields = new Set(provenance.filter((p) => p.source === "style").map((p) => p.field));
  const candidates: SoundSelectionCandidate[] = [];
  const rejected: Array<{ assetId: string; reason: string }> = [];
  for (const entry of catalogue) {
    const scored = scoreCatalogueEntry(track, target, entry, styleProfile, styledFields);
    if ("rejected" in scored) rejected.push({ assetId: scored.assetId, reason: scored.rejected });
    else candidates.push(scored);
  }
  candidates.sort((a, b) => b.score - a.score || (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));
  const best = candidates[0];
  const selection: InstrumentSoundProfile["selection"] = best
    ? {
        assetId: best.assetId,
        reason: `${best.assetId} (score ${best.score}): ${best.reasons.join("; ")}` +
          (candidates.length > 1 ? ` — over ${candidates.slice(1).map((c) => `${c.assetId} (${c.score})`).join(", ")}` : ""),
        candidates, rejected,
      }
    : {
        assetId: null,
        reason: catalogue.length
          ? `no attested instrument fits ${track.instrument} (${track.role}, ${track.family}): ${rejected.map((r) => `${r.assetId} ${r.reason}`).join("; ")}`
          : "the renderer offers no attested instruments",
        candidates, rejected,
      };
  const inputsDigestSha256 = createHash("sha256").update(stableJson({
    method: SOUND_SELECTION_METHOD,
    track: { instrument: track.instrument, role: track.role, family: track.family, noteCount: track.notes?.length ?? 0 },
    target,
    catalogue: catalogue.map((c) => c.assetId).sort(),
    exclusions: (styleProfile?.exclusions ?? []).map((e) => e.value),
  })).digest("hex");
  return {
    version: "1.0", method: SOUND_SELECTION_METHOD,
    trackId: track.trackId, instrument: track.instrument, role: track.role, family: track.family,
    target, provenance, selection, inputsDigestSha256,
  };
}

// ---------------------------------------------------------------------------
// Precedence against the operator's table
// ---------------------------------------------------------------------------

export type ResolvedTrackAsset = {
  assetId: string | null;
  source: "operator" | "brain" | "operator-default" | "worker-default" | "refused";
  reason: string;
  soundProfile: InstrumentSoundProfile | null;
};

export function resolveTrackAsset(input: {
  track: SoundTrack;
  table: PremiumRoutingTable | null;
  catalogue: readonly SoundCatalogueEntry[];
  styleProfile?: StyleProfile | null;
}): ResolvedTrackAsset {
  const attested = input.catalogue.map((c) => c.assetId);
  const routable = { instrument: input.track.instrument, role: input.track.role, family: input.track.family };
  if (input.table) {
    // Explicit rules first, without the default: the default is a fallback
    // the brain outranks, an explicit rule is an instruction it obeys.
    const { default: tableDefault, ...explicit } = input.table;
    const route = routePremiumInstrument(routable, explicit, attested);
    if (route.assetId) return { assetId: route.assetId, source: "operator", reason: route.reason, soundProfile: null };
    if (route.rule) return { assetId: null, source: "refused", reason: route.reason, soundProfile: null };
    const profile = input.catalogue.length ? selectTrackSound(input.track, input.catalogue, input.styleProfile) : null;
    if (profile?.selection.assetId) {
      return { assetId: profile.selection.assetId, source: "brain", reason: profile.selection.reason, soundProfile: profile };
    }
    if (tableDefault) {
      const fallback = routePremiumInstrument(routable, { default: tableDefault }, attested);
      return fallback.assetId
        ? { assetId: fallback.assetId, source: "operator-default", reason: fallback.reason, soundProfile: profile }
        : { assetId: null, source: "refused", reason: fallback.reason, soundProfile: profile };
    }
    return { assetId: null, source: "worker-default", reason: profile?.selection.reason ?? "no routing rule and no attested catalogue; the worker's default asset renders", soundProfile: profile };
  }
  if (!input.catalogue.length) {
    return { assetId: null, source: "worker-default", reason: "the renderer lists no attested instruments; its default asset renders", soundProfile: null };
  }
  const profile = selectTrackSound(input.track, input.catalogue, input.styleProfile);
  return profile.selection.assetId
    ? { assetId: profile.selection.assetId, source: "brain", reason: profile.selection.reason, soundProfile: profile }
    : { assetId: null, source: "worker-default", reason: profile.selection.reason, soundProfile: profile };
}

/** The renderer's attested asset list, as the brain reads it. */
export function toSoundCatalogue(assets: ReadonlyArray<{
  id: string; name?: string; manufacturer?: string; families?: string[]; roles?: string[]; character?: string[];
}>): SoundCatalogueEntry[] {
  return assets.map((a) => ({
    assetId: a.id,
    ...(a.name ? { name: a.name } : {}),
    ...(a.manufacturer ? { manufacturer: a.manufacturer } : {}),
    ...(a.families?.length ? { families: a.families } : {}),
    ...(a.roles?.length ? { roles: a.roles } : {}),
    ...(a.character?.length ? { character: a.character } : {}),
  }));
}
