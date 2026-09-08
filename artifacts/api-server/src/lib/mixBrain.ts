/**
 * Mix Brain V1 (PR-25).
 *
 * The studio's mix was a set of sliders the user had to move; the reference
 * mix graph panned tracks by their *index*. This decides a mix per musical
 * role — level, pan, bus, high-pass, compression, saturation, reverb send —
 * and lets it evolve across the song's sections: beds tuck under dense
 * passages, foreground lifts with energy, reverb opens in sparse ones, the
 * climax lets the beds open up. Every value carries its reason.
 *
 * Three sources, in order: role + family knowledge; the notes themselves
 * (register masking between two parts in the same range is resolved by
 * panning them apart and tucking the less important one); and the
 * StyleProfile's mix dimensions (stereo aesthetic, room size, saturation,
 * dynamics), each recorded with provenance.
 *
 * The plan becomes ordinary mix/master controls (`mixPlanToControls`), so it
 * is auditioned, approved and exported through the revision path that
 * already exists — the brain proposes, the user still decides.
 */
import { createHash } from "node:crypto";
import type {
  InstrumentSoundProfile,
  MixControlAutomationSegment,
  MixMasterControls,
  MixMasterTrackControl,
  MixPlan,
  MixPlanConflict,
  MixPlanTrack,
  MusicalNote,
  StyleProfile,
} from "@workspace/db";
import { secondsPerBar } from "./musicEngines";

export const MIX_BRAIN_METHOD = "mix-brain/v1";

export type MixBrainTrack = {
  trackId: string;
  instrument: string;
  role: string;
  family: string;
  notes: readonly MusicalNote[];
};

export type MixBrainSection = {
  name: string;
  energy: number;
  density: number;
  startBar?: number;
  endBar?: number;
};

export type MixBrainInput = {
  arrangementId?: string | null;
  tracks: MixBrainTrack[];
  sections: MixBrainSection[];
  bpm: number;
  meter?: string;
  durationSeconds: number;
  styleProfile?: StyleProfile | null;
  /** PR-24 sound profiles, when available: width and space refine pan and send. */
  soundProfiles?: InstrumentSoundProfile[];
  now?: Date;
};

// ---------------------------------------------------------------------------
// Role knowledge
// ---------------------------------------------------------------------------

type Side = "center" | "side" | "wide";

type RoleMix = {
  levelDb: number;
  side: Side;
  bus: MixMasterTrackControl["bus"];
  highPassHz: number;
  compressorRatio: number;
  saturation: number;
  sendDb: number;
  /** 1 = foreground … 5 = deepest background. */
  priority: number;
  why: string;
};

const ROLE_MIX: Record<string, RoleMix> = {
  LEAD:             { levelDb: 1,    side: "center", bus: "MUSIC", highPassHz: 120, compressorRatio: 2.5, saturation: 0.05, sendDb: -18, priority: 1, why: "the line the listener follows sits in front, centred, lightly controlled" },
  BASS:             { levelDb: 0,    side: "center", bus: "MUSIC", highPassHz: 30,  compressorRatio: 4,   saturation: 0.15, sendDb: -80, priority: 2, why: "low end stays centred, even and dry" },
  FOUNDATION:       { levelDb: -1,   side: "center", bus: "MUSIC", highPassHz: 35,  compressorRatio: 3,   saturation: 0.1,  sendDb: -80, priority: 2, why: "a foundation is felt, not placed: centred and dry" },
  GROOVE:           { levelDb: -1,   side: "center", bus: "DRUMS", highPassHz: 40,  compressorRatio: 3,   saturation: 0.1,  sendDb: -24, priority: 2, why: "the kit anchors the centre with a little glue and a short room" },
  FILL:             { levelDb: -2,   side: "side",   bus: "DRUMS", highPassHz: 60,  compressorRatio: 3,   saturation: 0.1,  sendDb: -20, priority: 3, why: "fills sit just off-centre under the kit" },
  COUNTER_MELODY:   { levelDb: -2,   side: "side",   bus: "MUSIC", highPassHz: 150, compressorRatio: 2,   saturation: 0.05, sendDb: -16, priority: 3, why: "a counter-line answers from the side, a step behind the lead" },
  CALL_RESPONSE:    { levelDb: -2.5, side: "side",   bus: "MUSIC", highPassHz: 140, compressorRatio: 2,   saturation: 0.05, sendDb: -16, priority: 3, why: "responses come from the side so the call stays in front" },
  RHYTHMIC_HARMONY: { levelDb: -3,   side: "side",   bus: "MUSIC", highPassHz: 100, compressorRatio: 2.5, saturation: 0.05, sendDb: -18, priority: 3, why: "rhythmic harmony fills the sides without crowding the centre" },
  OSTINATO:         { levelDb: -3,   side: "side",   bus: "MUSIC", highPassHz: 100, compressorRatio: 2.5, saturation: 0.05, sendDb: -20, priority: 3, why: "an ostinato is texture: off-centre and steady" },
  ACCENT:           { levelDb: -3,   side: "wide",   bus: "MUSIC", highPassHz: 90,  compressorRatio: 2,   saturation: 0,    sendDb: -14, priority: 4, why: "accents flash wide with a little space" },
  HARMONIC_BED:     { levelDb: -5,   side: "wide",   bus: "MUSIC", highPassHz: 110, compressorRatio: 1.8, saturation: 0,    sendDb: -12, priority: 4, why: "a bed is wide, high-passed away from the bass, and sits behind" },
  TRANSITION:       { levelDb: -4,   side: "wide",   bus: "MUSIC", highPassHz: 120, compressorRatio: 1.5, saturation: 0,    sendDb: -10, priority: 4, why: "transitions are wide and wet so they lead the ear, not the level" },
  CLIMAX_LAYER:     { levelDb: -4,   side: "wide",   bus: "MUSIC", highPassHz: 150, compressorRatio: 1.5, saturation: 0,    sendDb: -12, priority: 4, why: "a climax layer is wide and thinned so it adds size, not mud" },
  PAD:              { levelDb: -6,   side: "wide",   bus: "MUSIC", highPassHz: 140, compressorRatio: 1.5, saturation: 0,    sendDb: -10, priority: 5, why: "pads are the deepest layer: wide, high-passed, wet, well under everything" },
};
const DEFAULT_ROLE_MIX: RoleMix = { levelDb: -3, side: "side", bus: "MIX", highPassHz: 80, compressorRatio: 2, saturation: 0, sendDb: -20, priority: 3, why: "an unknown role is treated as mid-ground" };

const SIDE_PAN: Record<Side, number> = { center: 0, side: 0.3, wide: 0.5 };
const RAMP_LIMITS = {
  levelDb: [-60, 12], pan: [-1, 1], sendDb: [-80, 6], highPassHz: [20, 20000], compressorRatio: [1, 20], saturation: [0, 1],
  targetLufs: [-24, -6], truePeakDbtp: [-6, -0.1], stereoWidth: [0, 2], offset: [-24, 12],
} as const;

const clamp = (value: number, [min, max]: readonly [number, number]) => Math.max(min, Math.min(max, value));
// `+ 0` turns -0 into 0 so a mono pan serializes as 0, not -0.
const round1 = (value: number) => Math.round(value * 10) / 10 + 0;
const round2 = (value: number) => Math.round(value * 100) / 100 + 0;

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

function registerOf(notes: readonly MusicalNote[]): { mean: number; min: number; max: number } | null {
  if (!notes.length) return null;
  const pitches = notes.map((n) => n.pitch);
  return { mean: pitches.reduce((a, b) => a + b, 0) / pitches.length, min: Math.min(...pitches), max: Math.max(...pitches) };
}

// ---------------------------------------------------------------------------

export function deriveMixPlan(input: MixBrainInput): MixPlan {
  const now = input.now ?? new Date();
  const dims = input.styleProfile?.dimensions;
  const styleInputs: MixPlan["styleInputs"] = [];
  const useDim = <T extends string | number>(name: string, value: T | undefined, provenance: string | undefined): T | undefined => {
    if (value === undefined || value === null) return undefined;
    styleInputs.push({ dimension: name, value, provenance: provenance ?? "unknown" });
    return value;
  };
  const stereo = useDim("stereoAesthetic", dims?.stereoAesthetic?.value, dims?.stereoAesthetic?.provenance);
  const room = useDim("roomSize", dims?.roomSize?.value, dims?.roomSize?.provenance);
  const saturationStyle = useDim("saturation", dims?.saturation?.value, dims?.saturation?.provenance);
  const dynamics = useDim("dynamics", dims?.dynamics?.value, dims?.dynamics?.provenance);
  const hierarchy = useDim("instrumentationHierarchy", dims?.instrumentationHierarchy?.value?.join(",") , dims?.instrumentationHierarchy?.provenance);

  const panScale = stereo === "mono" ? 0 : stereo === "narrow" ? 0.5 : stereo === "wide" ? 1.3 : 1;
  const roomSendDb = room === "dry" ? -6 : room === "small" ? -3 : room === "large" ? 3 : room === "hall" ? 5 : 0;
  const saturationBoost = saturationStyle === "warm" ? 0.1 : saturationStyle === "driven" ? 0.25 : saturationStyle === "lo_fi" ? 0.2 : 0;
  const leadFamilies = hierarchy ? hierarchy.split(",").map((f) => f.trim().toLowerCase()).filter(Boolean) : [];

  // --- static mix per role ------------------------------------------------
  const soundByTrack = new Map((input.soundProfiles ?? []).map((p) => [p.trackId, p]));
  const seeds = input.tracks.map((track) => {
    const role = track.role.toUpperCase();
    const base = ROLE_MIX[role] ?? DEFAULT_ROLE_MIX;
    const rationale = [`${role}: ${base.why}`];
    let bus = base.bus;
    if (track.family === "voice") { bus = "VOCALS"; rationale.push("voice family rides the VOCALS bus"); }
    if (track.family === "drums" && bus !== "DRUMS") { bus = "DRUMS"; rationale.push("drums family rides the DRUMS bus"); }
    let levelDb = base.levelDb;
    const rank = leadFamilies.indexOf(track.family);
    if (rank === 0) { levelDb += 1.5; rationale.push(`style puts ${track.family} first in the instrumentation hierarchy: +1.5 dB`); }
    else if (rank > 0) { levelDb += 0.5; rationale.push(`style ranks ${track.family} #${rank + 1}: +0.5 dB`); }
    let sendDb = base.sendDb;
    if (sendDb > -80) {
      if (roomSendDb) { sendDb += roomSendDb; rationale.push(`style room ${room}: send ${roomSendDb > 0 ? "+" : ""}${roomSendDb} dB`); }
    } else rationale.push("no reverb send: low end stays dry");
    let saturation = base.saturation;
    if (saturationBoost && bus !== "DRUMS") { saturation += saturationBoost; rationale.push(`style saturation ${saturationStyle}: +${saturationBoost}`); }
    let side: Side = base.side;
    const sound = soundByTrack.get(track.trackId);
    if (sound) {
      if (sound.target.width === "mono") { side = "center"; rationale.push("sound target is mono: centred"); }
      else if (sound.target.width === "wide" && side === "side") { side = "wide"; rationale.push("sound target is wide: pushed to the wide slot"); }
      if (sound.target.space === "dry" && sendDb > -80) { sendDb -= 4; rationale.push("sound target is dry: send -4 dB"); }
      else if ((sound.target.space === "large" || sound.target.space === "hall") && sendDb > -80) { sendDb += 2; rationale.push(`sound target space ${sound.target.space}: send +2 dB`); }
    }
    return { track, role, base, bus, levelDb, sendDb, saturation, side, highPassHz: base.highPassHz, compressorRatio: base.compressorRatio, priority: base.priority, pan: 0, rationale };
  });

  // --- panning: alternate sides by priority, duplicates of a role opposite -
  const conflicts: MixPlanConflict[] = [];
  const ordered = [...seeds].sort((a, b) => a.priority - b.priority || (a.track.trackId < b.track.trackId ? -1 : 1));
  let nextSign = 1;
  const roleSides = new Map<string, number>();
  for (const seed of ordered) {
    if (seed.side === "center") continue;
    let sign = nextSign;
    const previous = roleSides.get(seed.role);
    if (previous !== undefined) {
      sign = -previous;
      const twin = ordered.find((s) => s.role === seed.role && s !== seed)!;
      conflicts.push({ trackIds: [twin.track.trackId, seed.track.trackId], kind: "role_duplicate", resolution: `two ${seed.role} parts are panned opposite` });
      seed.rationale.push(`second ${seed.role}: panned opposite its twin`);
    } else {
      nextSign = -nextSign;
    }
    roleSides.set(seed.role, sign);
    seed.pan = sign * SIDE_PAN[seed.side];
  }

  // --- register masking: two parts in one range fight; resolve it ---------
  const registers = new Map(seeds.map((s) => [s.track.trackId, registerOf(s.track.notes)]));
  for (let i = 0; i < seeds.length; i += 1) {
    for (let j = i + 1; j < seeds.length; j += 1) {
      const a = seeds[i]; const b = seeds[j];
      if (a.track.family === "drums" || b.track.family === "drums") continue;
      const ra = registers.get(a.track.trackId); const rb = registers.get(b.track.trackId);
      if (!ra || !rb) continue;
      // Inclusive: two parts that meet on one pitch already share it.
      const overlap = Math.min(ra.max, rb.max) - Math.max(ra.min, rb.min);
      if (Math.abs(ra.mean - rb.mean) >= 7 || overlap < 0) continue;
      const [front, back] = a.priority <= b.priority ? [a, b] : [b, a];
      if (front.priority <= 2 && back.priority >= 3) {
        back.levelDb -= 1.5;
        back.rationale.push(`shares the ${Math.round(rb.mean)}-ish register with ${front.role}: -1.5 dB under it`);
        conflicts.push({ trackIds: [front.track.trackId, back.track.trackId], kind: "register_masking", resolution: `${back.role} tucked 1.5 dB under ${front.role}` });
      } else if (front.priority >= 3 && back.priority >= 3) {
        if (Math.sign(front.pan) === Math.sign(back.pan) && front.pan !== 0) { back.pan = -back.pan; back.rationale.push(`flipped opposite ${front.role} to separate a shared register`); }
        else if (front.pan === 0 && back.pan === 0) { front.pan = SIDE_PAN.side; back.pan = -SIDE_PAN.side; back.rationale.push(`split left/right from ${front.role}: same register`); }
        back.highPassHz += 40;
        back.levelDb -= 1;
        back.rationale.push(`shares a register with ${front.role}: high-pass +40 Hz, -1 dB`);
        conflicts.push({ trackIds: [front.track.trackId, back.track.trackId], kind: "register_masking", resolution: `${back.role} panned away from ${front.role}, high-passed 40 Hz higher, -1 dB` });
      }
    }
  }

  // --- sections: the mix moves with the song -------------------------------
  const barSeconds = secondsPerBar(input.bpm, input.meter);
  const duration = Math.max(0.001, input.durationSeconds);
  const sectionSpans = input.sections.map((section, index) => {
    const hasBars = section.startBar !== undefined && section.endBar !== undefined;
    const start = hasBars ? (section.startBar! - 1) * barSeconds : (index / Math.max(1, input.sections.length)) * duration;
    const end = hasBars ? section.endBar! * barSeconds : ((index + 1) / Math.max(1, input.sections.length)) * duration;
    return { section, start: Math.max(0, Math.min(duration, start)), end: Math.max(0, Math.min(duration, end)) };
  }).filter((span) => span.end > span.start);
  const peakEnergy = Math.max(0, ...sectionSpans.map((s) => s.section.energy));
  const climaxName = sectionSpans.find((s) => s.section.energy === peakEnergy && peakEnergy > 0)?.section.name ?? null;

  const planSections: MixPlan["sections"] = [];
  const perTrackSections = new Map<string, MixPlanTrack["sections"]>();
  for (const { section, start, end } of sectionSpans) {
    const active = seeds.filter((s) => s.track.notes.some((n) => n.start < end && n.start + n.duration > start));
    const topPriority = Math.min(...active.map((s) => s.priority), 99);
    planSections.push({
      sectionName: section.name, startSeconds: round2(start), endSeconds: round2(end),
      energy: section.energy, density: section.density,
      focusTrackIds: active.filter((s) => s.priority === topPriority).map((s) => s.track.trackId),
    });
    const dense = Math.max(0, section.density - 0.6);
    const sparse = section.density < 0.4;
    const quiet = section.energy < 0.35;
    for (const seed of active) {
      let level = 0; let send = 0; const reasons: string[] = [];
      if (seed.priority <= 2) {
        level += 1.5 * (section.energy - 0.5);
        reasons.push(`foreground follows energy ${section.energy.toFixed(2)}`);
      } else if (seed.priority === 3) {
        if (dense) { level -= 2 * dense; reasons.push(`mid-ground tucked for density ${section.density.toFixed(2)}`); }
        if (sparse && seed.sendDb > -80) { send += 2; reasons.push("sparse: a little more room"); }
      } else {
        if (dense) { level -= 4 * dense; reasons.push(`bed tucked for density ${section.density.toFixed(2)}`); }
        if (quiet) { level -= 1; reasons.push("quiet section: bed a step further back"); }
        if (seed.sendDb > -80) {
          if (sparse) { send += 3; reasons.push("sparse: reverb opens"); }
          else if (section.density > 0.7) { send -= 3; reasons.push("dense: reverb closes"); }
        }
      }
      if (section.name === climaxName) {
        if (seed.priority >= 4) { level += 1.5; reasons.push("climax: beds open up"); }
        else if (seed.priority === 1) { level += 0.5; reasons.push("climax: lead a touch forward"); }
      }
      const list = perTrackSections.get(seed.track.trackId) ?? [];
      list.push({
        sectionName: section.name, startSeconds: round2(start), endSeconds: round2(end),
        levelOffsetDb: round1(clamp(level, RAMP_LIMITS.offset)), sendOffsetDb: round1(clamp(send, RAMP_LIMITS.offset)),
        reason: reasons.length ? reasons.join("; ") : "steady",
      });
      perTrackSections.set(seed.track.trackId, list);
    }
  }

  // --- master ---------------------------------------------------------------
  const masterRationale: string[] = [];
  const targetLufs = dynamics === "wide" ? -16 : dynamics === "narrow" ? -11 : -14;
  masterRationale.push(dynamics ? `style dynamics ${dynamics}: target ${targetLufs} LUFS` : "streaming default: -14 LUFS integrated");
  const stereoWidth = stereo === "mono" ? 0 : stereo === "narrow" ? 0.7 : stereo === "wide" ? 1.3 : 1;
  masterRationale.push(stereo ? `style stereo aesthetic ${stereo}: width ${stereoWidth}` : "natural stereo width");
  masterRationale.push("true-peak ceiling -1 dBTP with the limiter engaged, so codecs do not over");

  const tracks: MixPlanTrack[] = seeds.map((seed) => ({
    trackId: seed.track.trackId, instrument: seed.track.instrument, role: seed.role, family: seed.track.family,
    bus: seed.bus,
    levelDb: round1(clamp(seed.levelDb, RAMP_LIMITS.levelDb)),
    pan: round2(clamp(seed.pan * panScale, RAMP_LIMITS.pan)),
    sendDb: round1(clamp(seed.sendDb, RAMP_LIMITS.sendDb)),
    processing: {
      highPassHz: Math.round(clamp(seed.highPassHz, RAMP_LIMITS.highPassHz)),
      compressorRatio: round1(clamp(seed.compressorRatio, RAMP_LIMITS.compressorRatio)),
      saturation: round2(clamp(seed.saturation, RAMP_LIMITS.saturation)),
    },
    priority: seed.priority,
    rationale: panScale !== 1 && seed.pan !== 0 ? [...seed.rationale, `style stereo aesthetic ${stereo}: pan scaled ×${panScale}`] : seed.rationale,
    sections: perTrackSections.get(seed.track.trackId) ?? [],
  }));

  const inputsDigestSha256 = createHash("sha256").update(stableJson({
    method: MIX_BRAIN_METHOD,
    tracks: input.tracks.map((t) => ({ id: t.trackId, role: t.role, family: t.family, register: registerOf(t.notes) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    sections: input.sections, bpm: input.bpm, meter: input.meter ?? "4/4", durationSeconds: input.durationSeconds,
    styleInputs,
    sound: [...soundByTrack.values()].map((p) => [p.trackId, p.target.width, p.target.space] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  })).digest("hex");

  return {
    version: "1.0", method: MIX_BRAIN_METHOD, derivedAt: now.toISOString(), inputsDigestSha256,
    arrangementId: input.arrangementId ?? null,
    tracks,
    master: { targetLufs, truePeakDbtp: -1, processing: { limiter: true, stereoWidth }, rationale: masterRationale },
    sections: planSections, conflicts, styleInputs,
  };
}

/** The plan as the controls the mix/master revision route accepts. */
export function mixPlanToControls(plan: MixPlan): MixMasterControls {
  const tracks: MixMasterControls["tracks"] = {};
  for (const track of plan.tracks) {
    const automation: MixControlAutomationSegment[] = track.sections
      .filter((s) => s.levelOffsetDb !== 0 || s.sendOffsetDb !== 0)
      .map((s) => ({ startSeconds: s.startSeconds, endSeconds: s.endSeconds, levelOffsetDb: s.levelOffsetDb, sendOffsetDb: s.sendOffsetDb, label: s.sectionName }));
    tracks[track.trackId] = {
      levelDb: track.levelDb, pan: track.pan, bus: track.bus, sendDb: track.sendDb,
      processing: { ...track.processing },
      ...(automation.length ? { automation } : {}),
    };
  }
  return {
    tracks,
    master: { targetLufs: plan.master.targetLufs, truePeakDbtp: plan.master.truePeakDbtp, processing: { ...plan.master.processing } },
  };
}
