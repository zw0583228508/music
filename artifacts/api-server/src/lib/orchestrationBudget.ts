/**
 * Orchestration Budget Engine (PR-06) + Register Plan (Arrangement Brain B-03).
 *
 * Teaches the arranger not to play too much at once. For every planning window
 * it produces density / melodic / rhythmic / harmonic / register / spectral /
 * attention budgets driven by how much the lead is holding the listener, and
 * — since B-03 — a **register plan on pitch bands over time**: per window and
 * per band (low < C3, low_mid C3–B3, mid C4–B4, upper_mid C5–B5, high ≥ C6) the
 * voices each instrument's profile puts there for its role, the collisions
 * between independent close voicings, the low-mid accumulation, and the
 * concrete bounds each instrument must compose within. Before B-03 the
 * occupancy was a count of *families* per band: it could not know that a
 * piano voicing at C4–G4 and a string pad at C4–G4 collide while a piano at
 * C3 and strings at C5 do not — and the composer never read the result. The
 * plan is exposed as pure functions (`deriveRegisterPlan`, `registerBoundsFor`)
 * for the composer to call; the composer does not call them yet (B-02).
 *
 * Deterministic and pure. Reads the section/phrase plan (PR-05), the vocal
 * arrangement-space map (PR-03) and the instrument profiles (B-03).
 */
import { createHash } from "node:crypto";
import type {
  InstrumentArrangementRole,
  InstrumentProfile,
  InstrumentResolution,
  InstrumentRoleAssignment,
  OrchestrationBudgetPlan,
  OrchestrationBudgetWindow,
  OrchestrationInstrumentAdjustment,
  RegisterBand,
  RegisterBandBounds,
  RegisterOccupancySpan,
  RegisterPlan,
  RegisterPlanCollision,
  RegisterPlanDesk,
  RegisterPlanEntry,
  RegisterPlanWindow,
  SectionPhrasePlan,
  SongModelData,
  SongModelMusicalMap,
} from "@workspace/db";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";
import { INSTRUMENT_PROFILES, resolveInstrumentProfile, roleRegisterFor } from "./instrumentProfile";

export const ORCHESTRATION_BUDGET_VERSION = "1.1" as const;
const METHOD = "orchestration-budget-engine/v1.1";
export const REGISTER_PLAN_METHOD = "register-plan/v1";

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const round2 = (v: number): number => Math.round(v * 100) / 100;

export const REGISTER_ORDER: RegisterBand[] = ["low", "low_mid", "mid", "upper_mid", "high"];

/**
 * Concert MIDI band boundaries. low < C3 (48, 131 Hz): the bass region;
 * low_mid C3–B3 (131–247 Hz): where close voicings turn to mud; mid C4–B4;
 * upper_mid C5–B5; high ≥ C6 (84, 1047 Hz). Source: platform convention on
 * the octave boundaries (the mix-engineering "mud" band is ~150–300 Hz).
 */
export const REGISTER_BAND_BOUNDS: RegisterBandBounds = {
  low: [0, 47], low_mid: [48, 59], mid: [60, 71], upper_mid: [72, 83], high: [84, 127],
};

export function bandOf(pitch: number): RegisterBand {
  if (pitch < 48) return "low";
  if (pitch < 60) return "low_mid";
  if (pitch < 72) return "mid";
  if (pitch < 84) return "upper_mid";
  return "high";
}

export function bandsCovered(lo: number, hi: number): RegisterBand[] {
  return REGISTER_ORDER.filter((band) => {
    const [blo, bhi] = REGISTER_BAND_BOUNDS[band];
    return hi >= blo && lo <= bhi;
  });
}

// ---------------------------------------------------------------------------
// Budget windows
// ---------------------------------------------------------------------------

type WindowSeed = {
  id: string;
  startBar: number;
  endBar: number;
  vocalAttention: number;
  counterMelodyBudget: number;
  fillBudget: number;
  padBudget: number;
};

function seedWindows(
  map: SongModelMusicalMap,
  plan: SectionPhrasePlan,
): WindowSeed[] {
  if (map.arrangementSpace.status !== "not_available" && map.arrangementSpace.windows.length) {
    return map.arrangementSpace.windows.map((window, index) => {
      const activity = map.vocals.phrases.find(
        (phrase) => phrase.start < window.end && phrase.end > window.start,
      )?.activity ?? 0;
      const vocalAttention =
        window.vocalDensity === "none"
          ? 0.1
          : window.vocalDensity === "low"
            ? 0.4
            : window.vocalDensity === "medium"
              ? 0.7
              : Math.max(0.75, activity);
      return {
        id: window.id || `budget-${index + 1}`,
        startBar: window.bars[0] ?? 1,
        endBar: window.bars[window.bars.length - 1] ?? window.bars[0] ?? 1,
        vocalAttention: round3(clamp01(vocalAttention)),
        counterMelodyBudget: window.counterMelodyBudget,
        fillBudget: window.fillBudget,
        padBudget: window.padBudget,
      };
    });
  }
  // No verified vocal space: fall back to phrase windows with a neutral
  // attention level from the section's melodic activity.
  return plan.phrases.map((phrase, index) => {
    const section = plan.sections.find((s) => s.sectionName === phrase.sectionName);
    const vocalAttention = section
      ? clamp01(0.3 + section.melodicActivity * 0.5)
      : 0.5;
    return {
      id: phrase.id || `budget-${index + 1}`,
      startBar: phrase.startBar,
      endBar: phrase.endBar,
      vocalAttention: round3(vocalAttention),
      counterMelodyBudget: round3(clamp01(0.3 * (1 - vocalAttention))),
      fillBudget: round3(clamp01(0.2 * (1 - vocalAttention))),
      padBudget: 0.5,
    };
  });
}

function sectionForBars(plan: SectionPhrasePlan, startBar: number, endBar: number) {
  return plan.sections.find((s) => s.startBar <= startBar && s.endBar >= endBar)
    ?? plan.sections.find((s) => s.endBar >= startBar && s.startBar <= endBar);
}

function budgetWindow(
  seed: WindowSeed,
  plan: SectionPhrasePlan,
  registerWindow: RegisterPlanWindow | undefined,
): OrchestrationBudgetWindow {
  const va = seed.vocalAttention;
  const meanOccupancy = registerWindow ? meanBandLoad(registerWindow) : 0;

  const budgets = {
    totalDensity: round3(clamp01(1 - 0.5 * va)),
    melodic: round3(clamp01(seed.counterMelodyBudget || (1 - va) * 0.4)),
    rhythmic: round3(clamp01(0.7 - 0.3 * va)),
    harmonic: round3(clamp01(0.65 - 0.15 * va)),
    register: round3(clamp01(1 - meanOccupancy)),
    spectral: round3(clamp01(1 - meanOccupancy * 0.8 - va * 0.15)),
    attention: round3(clamp01(1 - va)),
  };

  const section = sectionForBars(plan, seed.startBar, seed.endBar);
  const roles = section
    ? plan.roleAssignments.filter((r) => r.sectionName === section.sectionName)
    : [];

  const instrumentAdjustments: OrchestrationInstrumentAdjustment[] = roles.map((role) => {
    let densityMultiplier = 1;
    let note = "unchanged";
    if (role.role === "LEAD") {
      densityMultiplier = 1;
      note = "lead — unchanged";
    } else if (["HARMONIC_BED", "RHYTHMIC_HARMONY", "PAD", "OSTINATO"].includes(role.role)) {
      densityMultiplier = round3(clamp01(1 - 0.45 * va));
      note = va > 0.5 ? "duck under the vocal" : "hold";
    } else if (["COUNTER_MELODY", "FILL", "CALL_RESPONSE", "ACCENT"].includes(role.role)) {
      densityMultiplier = round3(clamp01(0.25 + 1.1 * (1 - va)));
      note = va < 0.3 ? "open up in the vocal gap" : "stay out of the way";
    } else if (role.role === "CLIMAX_LAYER") {
      densityMultiplier = round3(clamp01(0.9 + 0.2 * (1 - va)));
      note = "climax layer";
    } else {
      note = "foundation — unchanged";
    }
    // B-03: the register shift is the pitch-band plan's decision for this
    // instrument in this window, not a family-count heuristic.
    const entry = registerWindow?.entries.find((e) => e.instrument === role.instrument && e.role === role.role);
    const registerShift = entry?.registerShift ?? 0;
    if (entry && entry.action !== "keep") note = `${note}; register plan: ${entry.action} (${entry.reason})`;
    return { instrument: role.instrument, densityMultiplier, registerShift, note };
  });

  return {
    id: seed.id,
    startBar: seed.startBar,
    endBar: seed.endBar,
    vocalAttention: va,
    budgets,
    instrumentAdjustments,
  };
}

// ---------------------------------------------------------------------------
// Register plan
// ---------------------------------------------------------------------------

type Role = InstrumentArrangementRole;
type Bounds = { lo: number; hi: number };

/** Foundation-first precedence: the earlier tier keeps its register, the later one yields. */
function tierOf(profile: InstrumentProfile): number {
  if (profile.id === "drum_kit") return 0;
  if (profile.definitionId === "bass") return 1;
  if (profile.family === "keys" || profile.family === "guitar") return 2;
  if (profile.id === "hand_percussion") return 3;
  if (profile.family === "strings" || profile.family === "synth") return 4;
  if (profile.family === "brass" || profile.family === "winds") return 5;
  return 6;
}

const LINE_ROLES: Role[] = ["LEAD", "COUNTER_MELODY", "CALL_RESPONSE", "BASS", "FOUNDATION", "FILL"];
const TYPICAL_VOICES: Partial<Record<Role, number>> = {
  HARMONIC_BED: 3, PAD: 4, RHYTHMIC_HARMONY: 3, OSTINATO: 2, CLIMAX_LAYER: 4, ACCENT: 3, TRANSITION: 3, GROOVE: 2,
};
const MIN_WIDTH = { close: 10, open: 7, line: 7 } as const;
/** Two voicings overlapping by less than a fourth are adjacent, not colliding. */
const MIN_OVERLAP = 5;
/** A three-voice keyboard bed plus the bass line's upper notes is the ordinary layout; more than four voices, or two close voicings, is mud. */
const LOW_MID_VOICE_LIMIT = 4;

function voicingFor(profile: InstrumentProfile, role: Role): RegisterPlanEntry["voicing"] {
  if (profile.family === "drums") return "unpitched";
  const maxVoices = profile.polyphony.value.maxVoices;
  if (LINE_ROLES.includes(role) || maxVoices === 1) return "line";
  if (maxVoices === 2) return "open";
  return "close";
}

function voicesFor(profile: InstrumentProfile, role: Role, voicing: RegisterPlanEntry["voicing"]): number {
  if (voicing === "line") return 1;
  if (voicing === "open") return 2;
  return Math.min(profile.polyphony.value.maxVoices, TYPICAL_VOICES[role] ?? 3);
}

const width = (b: Bounds) => b.hi - b.lo + 1;
const center = (b: Bounds) => (b.lo + b.hi) / 2;
const overlap = (a: Bounds, b: Bounds): number => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) + 1;

type Placed = {
  entry: RegisterPlanEntry;
  /** The zone another close voicing must not share; null for lines / unpitched. */
  closeZone: Bounds | null;
  isBass: boolean;
  profile: InstrumentProfile | null;
};

function closeZoneOf(entry: RegisterPlanEntry): Bounds | null {
  if (!entry.bounds) return null;
  if (entry.desks) {
    const closeDesk = entry.desks.find((d) => d.voicing === "close");
    return closeDesk ? { lo: closeDesk.lo, hi: closeDesk.hi } : null;
  }
  return entry.voicing === "close" ? entry.bounds : null;
}

/**
 * Two close voicings collide when they sit on top of each other. Two
 * *sustained* beds (or anything against the singer) collide as soon as they
 * share a fourth or more: the same chord tones in the same octave. A comping
 * part against a bed collides only when the voicings are also centred within
 * a fifth of each other — a piano an octave above a strummed guitar shares a
 * few notes and is the ordinary layout.
 */
type Owner = { zone: Bounds; name: string; strict: boolean };

function collides(zone: Bounds, owner: Owner): boolean {
  if (overlap(zone, owner.zone) < MIN_OVERLAP) return false;
  return owner.strict || Math.abs(center(zone) - center(owner.zone)) < 7;
}

/**
 * Move `zone` off `owner`: trim the shared part when what remains is wide
 * enough, else shift by an octave away from the owner, else give up (null).
 */
function yieldZone(
  zone: Bounds,
  owner: Owner,
  limits: Bounds,
  minWidth: number,
  others: Owner[],
): { bounds: Bounds; action: RegisterPlanEntry["action"]; shift: number } | null {
  const up = center(zone) >= center(owner.zone);
  const trimmed: Bounds = up ? { lo: owner.zone.hi + 1, hi: zone.hi } : { lo: zone.lo, hi: owner.zone.lo - 1 };
  if (width(trimmed) >= minWidth && trimmed.lo >= limits.lo && trimmed.hi <= limits.hi && !others.some((o) => collides(trimmed, o))) {
    return { bounds: trimmed, action: "trim", shift: 0 };
  }
  for (const shift of up ? [12, -12] : [-12, 12]) {
    const moved: Bounds = { lo: zone.lo + shift, hi: zone.hi + shift };
    if (moved.lo < limits.lo || moved.hi > limits.hi) continue;
    if (collides(moved, owner)) continue;
    if (others.some((o) => collides(moved, o))) continue;
    return { bounds: moved, action: shift > 0 ? "octave_up" : "octave_down", shift };
  }
  return null;
}

const SUSTAINED_ROLES: Role[] = ["HARMONIC_BED", "PAD", "CLIMAX_LAYER", "TRANSITION"];

export type RegisterPlanInput = {
  sectionPlan: SectionPhrasePlan;
  windows: Array<{ id: string; startBar: number; endBar: number }>;
  /** The vocal map's register per bar span, when detected; null/undefined = not available. */
  vocalRegister?: Array<{ startBar: number; endBar: number; register: RegisterBand }> | null;
  resolve?: (instrument: string, role: string) => InstrumentResolution;
};

/**
 * The palette word "strings" is one track (the violin desk) for rendering,
 * but the section for planning: the plan lays out all four desks and hands
 * the composer the violins' bounds as the track's (see the labelled alias in
 * instrumentProfile.ts).
 */
function planningProfileFor(instrument: string, role: string, resolve: NonNullable<RegisterPlanInput["resolve"]>): { resolution: InstrumentResolution; profile: InstrumentProfile | null } {
  const resolution = resolve(instrument, role);
  if (resolution.status === "unknown") return { resolution, profile: null };
  const profile = INSTRUMENT_PROFILES[resolution.profileId];
  if (profile.id === "violin_section" && resolution.matchedBy === "alias" && /strings/.test(instrument.toLowerCase())) {
    return { resolution, profile: INSTRUMENT_PROFILES.string_section };
  }
  return { resolution, profile };
}

function desksFor(profile: InstrumentProfile, role: Role, bassPresent: boolean): RegisterPlanDesk[] | undefined {
  if (!profile.desks) return undefined;
  const line = LINE_ROLES.includes(role);
  return profile.desks
    .filter((desk) => !(desk.desk === "basses" && bassPresent))
    .map((desk) => {
      const range = desk.roleRanges[role] ?? desk.defaultRange;
      // A line role: the section plays one line, whichever desk carries it.
      return { desk: desk.desk, profileId: desk.profileId, lo: range[0], hi: range[1], voices: line ? 1 : desk.voices, voicing: line ? "line" : desk.voicing };
    });
}

function planWindow(
  window: { id: string; startBar: number; endBar: number },
  plan: SectionPhrasePlan,
  vocalBand: RegisterBand | null,
  resolve: NonNullable<RegisterPlanInput["resolve"]>,
  unresolved: RegisterPlan["unresolved"],
): RegisterPlanWindow {
  const section = sectionForBars(plan, window.startBar, window.endBar);
  const assignments = section ? plan.roleAssignments.filter((r) => r.sectionName === section.sectionName) : [];
  const resolved = assignments
    .map((assignment, index) => ({ assignment, index, ...planningProfileFor(assignment.instrument, assignment.role, resolve) }))
    .filter((r) => {
      if (r.profile) return true;
      const reason = r.resolution.status === "unknown" ? r.resolution.reason : "unresolved";
      if (!unresolved.some((u) => u.instrument === r.assignment.instrument && u.role === r.assignment.role)) {
        unresolved.push({ instrument: r.assignment.instrument, role: r.assignment.role, reason });
      }
      return false;
    }) as Array<{ assignment: InstrumentRoleAssignment; index: number; resolution: InstrumentResolution; profile: InstrumentProfile }>;
  // Foundation first; within a tier, the order the planner listed them (the
  // earlier-listed instrument keeps its register, the later one yields).
  resolved.sort((a, b) => tierOf(a.profile) - tierOf(b.profile) || a.index - b.index);
  const bassPresent = resolved.some((r) => r.profile.definitionId === "bass" && ["BASS", "FOUNDATION"].includes(r.assignment.role));

  const placed: Placed[] = [];
  const collisions: RegisterPlanCollision[] = [];
  const vocalZone: Bounds | null = vocalBand ? { lo: REGISTER_BAND_BOUNDS[vocalBand][0], hi: REGISTER_BAND_BOUNDS[vocalBand][1] } : null;
  let lead: RegisterPlanWindow["lead"] = { instrument: null, bounds: null };

  for (const { assignment, profile } of resolved) {
    const role = assignment.role;
    const target = roleRegisterFor(profile, role);
    const voicing = voicingFor(profile, role);
    const voices = voicesFor(profile, role, voicing);
    const limits: Bounds = { lo: profile.range.absolute.value[0], hi: profile.range.absolute.value[1] };
    const entry: RegisterPlanEntry = {
      instrument: assignment.instrument,
      profileId: profile.id,
      role,
      voicing,
      voices,
      target: { lo: target.lo, hi: target.hi },
      bounds: { lo: target.lo, hi: target.hi },
      registerShift: 0,
      action: "keep",
      bands: bandsCovered(target.lo, target.hi),
      reason: target.fromRole ? `${profile.id} ${role} register: ${target.note}` : target.note,
    };
    const desks = desksFor(profile, role, bassPresent);
    if (desks) entry.desks = desks;

    if (voicing === "unpitched") {
      entry.bands = [];
      entry.reason = `${profile.id} is unpitched; it claims no pitch band`;
      placed.push({ entry, closeZone: null, isBass: false, profile });
      continue;
    }
    if (role === "LEAD") lead = { instrument: assignment.instrument, bounds: { ...entry.bounds! } };

    // What this entry must not share: its close zone (for a desked section,
    // the violins). Lines and open desks coexist with anything.
    let zone = closeZoneOf(entry);
    if (zone) {
      const sustained = SUSTAINED_ROLES.includes(role);
      const owners: Owner[] = [];
      if (vocalZone) owners.push({ zone: vocalZone, name: "vocal", strict: true });
      // With a bass playing, no close voicing sits in the bass's octave.
      if (bassPresent) owners.push({ zone: REGISTER_BAND_BOUNDS_B.low, name: "the bass's low band", strict: true });
      for (const p of placed) {
        if (p.closeZone) owners.push({ zone: p.closeZone, name: p.entry.instrument, strict: sustained && SUSTAINED_ROLES.includes(p.entry.role) });
      }
      for (const owner of owners) {
        if (!zone || !collides(zone, owner)) continue;
        const shared: [number, number] = [Math.max(zone.lo, owner.zone.lo), Math.min(zone.hi, owner.zone.hi)];
        const band = bandOf(Math.round((shared[0] + shared[1]) / 2));
        const otherZones = owners.filter((o) => o !== owner);
        const moved = yieldZone(zone, owner, limits, MIN_WIDTH.close, otherZones);
        if (moved) {
          zone = moved.bounds;
          entry.action = moved.action;
          entry.registerShift = moved.shift;
          entry.reason = `${entry.action === "trim" ? "trimmed" : "moved an octave"} off ${owner.name} (${owner.zone.lo}–${owner.zone.hi}) in the ${band} band; ${profile.id} yields as the later-entering (tier ${tierOf(profile)}) voicing`;
          collisions.push({ band, between: [owner.name, assignment.instrument], overlap: shared, resolution: `${assignment.instrument}: ${entry.action} → ${zone.lo}–${zone.hi}` });
        } else {
          entry.action = "tacet";
          entry.bounds = null;
          entry.registerShift = 0;
          entry.reason = `tacet: no band left for a ${profile.id} close voicing between ${owner.name} (${owner.zone.lo}–${owner.zone.hi}) and the other voicings; silence is the decision, not a stacked chord`;
          collisions.push({ band, between: [owner.name, assignment.instrument], overlap: shared, resolution: `${assignment.instrument}: tacet` });
          zone = null;
          break;
        }
      }
      if (entry.bounds && zone) {
        if (entry.desks) {
          const closeDesk = entry.desks.find((d) => d.voicing === "close")!;
          closeDesk.lo = zone.lo; closeDesk.hi = zone.hi;
          const lo = Math.min(...entry.desks.map((d) => d.lo));
          const hi = Math.max(...entry.desks.map((d) => d.hi));
          entry.bounds = { lo, hi };
        } else {
          entry.bounds = { ...zone };
        }
      }
      if (entry.action === "tacet" && entry.desks) entry.desks = entry.desks.map((d) => d.voicing === "close" ? { ...d, lo: 0, hi: -1 } : d).filter((d) => d.hi >= d.lo);
    }
    // A bass line below another bass line: the later one is silence.
    if (LINE_ROLES.includes(role) && ["BASS", "FOUNDATION"].includes(role) && entry.bounds) {
      const otherBass = placed.find((p) => p.isBass && p.entry.bounds && overlap(p.entry.bounds, entry.bounds!) >= MIN_OVERLAP);
      if (otherBass) {
        entry.action = "tacet"; entry.bounds = null;
        entry.reason = `tacet: ${otherBass.entry.instrument} already holds the low band; two bass lines in one octave are mud`;
        collisions.push({ band: "low", between: [otherBass.entry.instrument, assignment.instrument], overlap: [entry.target.lo, entry.target.hi], resolution: `${assignment.instrument}: tacet` });
      }
    }
    entry.bands = entry.bounds ? bandsCovered(entry.bounds.lo, entry.bounds.hi) : [];
    placed.push({ entry, closeZone: closeZoneOf(entry), isBass: ["BASS", "FOUNDATION"].includes(role) && profile.definitionId === "bass", profile });
  }

  // Low-mid accumulation: independent voices piling into C3–B3.
  const lowMidLoad = () => {
    let voices = 0; let closeVoicings = 0;
    for (const p of placed) {
      for (const part of partsOf(p.entry)) {
        const ov = overlap(part, REGISTER_BAND_BOUNDS_B.low_mid);
        if (ov <= 0) continue;
        voices += part.voices * (ov / width(part));
        if (part.voicing === "close" && ov >= MIN_OVERLAP) closeVoicings += 1;
      }
    }
    return { voices: round2(voices), closeVoicings };
  };
  let lm = lowMidLoad();
  let lowMidNote = "within tolerance";
  if (lm.closeVoicings >= 2 || lm.voices > LOW_MID_VOICE_LIMIT) {
    // Raise the most flexible, latest-tier close voicing out of the band.
    const candidates = placed
      .filter((p) => p.closeZone && overlap(p.closeZone, REGISTER_BAND_BOUNDS_B.low_mid) >= MIN_OVERLAP && p.profile)
      .sort((a, b) => tierOf(b.profile!) - tierOf(a.profile!) || b.profile!.registerFlexibility.value - a.profile!.registerFlexibility.value);
    const mover = candidates[0];
    if (mover && mover.entry.bounds) {
      const limits: Bounds = { lo: mover.profile!.range.absolute.value[0], hi: mover.profile!.range.absolute.value[1] };
      const others: Owner[] = placed.filter((p) => p !== mover && p.closeZone).map((p) => ({ zone: p.closeZone!, name: p.entry.instrument, strict: false }));
      if (vocalZone) others.push({ zone: vocalZone, name: "vocal", strict: true });
      const moved = yieldZone(mover.closeZone!, { zone: { lo: 0, hi: 59 }, name: "low-mid", strict: true }, limits, MIN_WIDTH.close, others);
      if (moved) {
        applyZone(mover.entry, moved.bounds);
        mover.entry.action = moved.action; mover.entry.registerShift = moved.shift;
        mover.entry.reason = `low-mid accumulation (${lm.voices} voices, ${lm.closeVoicings} close voicings in C3–B3): ${mover.entry.instrument} ${moved.action === "trim" ? "trimmed above B3" : "raised an octave"}`;
        mover.closeZone = closeZoneOf(mover.entry);
        mover.entry.bands = mover.entry.bounds ? bandsCovered(mover.entry.bounds.lo, mover.entry.bounds.hi) : [];
        collisions.push({ band: "low_mid", between: [placed.filter((p) => p !== mover && p.entry.bands.includes("low_mid")).map((p) => p.entry.instrument).join("+") || "bass", mover.entry.instrument], overlap: [48, 59], resolution: `${mover.entry.instrument}: ${moved.action}` });
        lowMidNote = `resolved by ${mover.entry.instrument} (${moved.action})`;
        lm = lowMidLoad();
      } else {
        lowMidNote = `flagged, unresolved: ${mover.entry.instrument} has nowhere to go; B-02 should thin its voicing here`;
        collisions.push({ band: "low_mid", between: ["low_mid", mover.entry.instrument], overlap: [48, 59], resolution: `${mover.entry.instrument}: thin voicing (unresolved)` });
      }
    } else {
      lowMidNote = "flagged: only open voices / lines pile up here (bass + cellos + LH); acceptable as doublings";
    }
  }
  const flagged = lm.closeVoicings >= 2 || lm.voices > LOW_MID_VOICE_LIMIT;

  const occupancy = {} as Record<RegisterBand, number>;
  const closeVoicingsPerBand = {} as Record<RegisterBand, number>;
  for (const band of REGISTER_ORDER) {
    let voices = 0; let close = 0;
    for (const p of placed) {
      for (const part of partsOf(p.entry)) {
        const ov = overlap(part, REGISTER_BAND_BOUNDS_B[band]);
        if (ov <= 0) continue;
        voices += part.voices * (ov / width(part));
        if (part.voicing === "close" && ov >= MIN_OVERLAP) close += 1;
      }
    }
    occupancy[band] = round2(voices);
    closeVoicingsPerBand[band] = close;
  }

  return {
    id: window.id,
    sectionName: section?.sectionName ?? "",
    startBar: window.startBar,
    endBar: window.endBar,
    vocal: vocalBand
      ? { status: "detected", band: vocalBand, range: [...REGISTER_BAND_BOUNDS[vocalBand]] as [number, number] }
      : { status: "not_available", band: null, range: null },
    lead,
    occupancy,
    closeVoicingsPerBand,
    collisions,
    lowMid: { voices: lm.voices, closeVoicings: lm.closeVoicings, flagged, note: lowMidNote },
    entries: placed.map((p) => p.entry),
  };
}

const REGISTER_BAND_BOUNDS_B: Record<RegisterBand, Bounds> = Object.fromEntries(
  REGISTER_ORDER.map((band) => [band, { lo: REGISTER_BAND_BOUNDS[band][0], hi: REGISTER_BAND_BOUNDS[band][1] }]),
) as Record<RegisterBand, Bounds>;

type Part = Bounds & { voices: number; voicing: RegisterPlanEntry["voicing"] | RegisterPlanDesk["voicing"] };
function partsOf(entry: RegisterPlanEntry): Part[] {
  if (!entry.bounds || entry.voicing === "unpitched") return [];
  if (entry.desks?.length) return entry.desks.map((d) => ({ lo: d.lo, hi: d.hi, voices: d.voices, voicing: d.voicing }));
  return [{ lo: entry.bounds.lo, hi: entry.bounds.hi, voices: entry.voices, voicing: entry.voicing }];
}

function applyZone(entry: RegisterPlanEntry, zone: Bounds): void {
  if (entry.desks) {
    const closeDesk = entry.desks.find((d) => d.voicing === "close");
    if (closeDesk) { closeDesk.lo = zone.lo; closeDesk.hi = zone.hi; }
    entry.bounds = { lo: Math.min(...entry.desks.map((d) => d.lo)), hi: Math.max(...entry.desks.map((d) => d.hi)) };
  } else {
    entry.bounds = { ...zone };
  }
}

function meanBandLoad(window: RegisterPlanWindow): number {
  const loads = REGISTER_ORDER.map((band) => clamp01(window.occupancy[band] / 4));
  return loads.reduce((a, b) => a + b, 0) / loads.length;
}

function vocalBandFor(
  spans: RegisterPlanInput["vocalRegister"],
  startBar: number,
  endBar: number,
): RegisterBand | null {
  if (!spans?.length) return null;
  const counts = new Map<RegisterBand, number>();
  for (const span of spans) {
    const from = Math.max(span.startBar, startBar);
    const to = Math.min(span.endBar, endBar);
    if (to < from) continue;
    counts.set(span.register, (counts.get(span.register) ?? 0) + (to - from + 1));
  }
  let best: RegisterBand | null = null; let bestCount = 0;
  for (const band of REGISTER_ORDER) {
    const c = counts.get(band) ?? 0;
    if (c > bestCount) { best = band; bestCount = c; }
  }
  return best;
}

/** The pitch-band register plan: pure, deterministic, profile-driven. */
export function deriveRegisterPlan(input: RegisterPlanInput): RegisterPlan {
  const resolve = input.resolve ?? resolveInstrumentProfile;
  const unresolved: RegisterPlan["unresolved"] = [];
  const windows = input.windows.map((window) =>
    planWindow(window, input.sectionPlan, vocalBandFor(input.vocalRegister, window.startBar, window.endBar), resolve, unresolved),
  );
  return { version: "1.0", method: REGISTER_PLAN_METHOD, bandBounds: { ...REGISTER_BAND_BOUNDS }, windows, unresolved };
}

export type RegisterBoundsDecision = {
  source: "register-plan" | "profile-default";
  windowId: string | null;
  /** True when the plan decided this instrument is silent in the window; lo/hi then carry the profile default for callers that cannot rest. */
  tacet: boolean;
  lo: number;
  hi: number;
  desks?: RegisterPlanDesk[];
  registerShift: number;
  action: RegisterPlanEntry["action"] | "none";
  reason: string;
};

/**
 * What the composer must use for this instrument, role and window. Looks the
 * entry up by instrument name when given (the palette word the plan was
 * built from), else by profile and role; falls back to the profile's role
 * register *and says so*. The composer (B-02) is the intended caller; today
 * nothing on the production path calls it.
 */
export function registerBoundsFor(input: {
  profile: InstrumentProfile;
  role: InstrumentArrangementRole;
  window: { startBar: number; endBar: number } | { bar: number } | { id: string };
  plan: RegisterPlan | null | undefined;
  instrument?: string;
}): RegisterBoundsDecision {
  const fallback = roleRegisterFor(input.profile, input.role);
  const base: RegisterBoundsDecision = {
    source: "profile-default", windowId: null, tacet: false, lo: fallback.lo, hi: fallback.hi,
    registerShift: 0, action: "none", reason: `no register-plan entry; ${fallback.note}`,
  };
  if (!input.plan) return { ...base, reason: `no register plan; ${fallback.note}` };
  const w = input.window;
  const window = input.plan.windows.find((candidate) =>
    "id" in w ? candidate.id === w.id
      : "bar" in w ? candidate.startBar <= w.bar && candidate.endBar >= w.bar
        : candidate.startBar <= w.endBar && candidate.endBar >= w.startBar);
  if (!window) return base;
  const entry = window.entries.find((e) =>
    (input.instrument ? e.instrument === input.instrument : true) && e.role === input.role &&
    (e.profileId === input.profile.id || e.desks?.some((d) => d.profileId === input.profile.id) ||
      (input.profile.id === "violin_section" && e.profileId === "string_section")))
    ?? window.entries.find((e) => input.instrument && e.instrument === input.instrument);
  if (!entry) return { ...base, windowId: window.id };
  if (!entry.bounds) {
    return { source: "register-plan", windowId: window.id, tacet: true, lo: fallback.lo, hi: fallback.hi, registerShift: 0, action: "tacet", reason: entry.reason };
  }
  // A desked section: the caller's own desk when it is one, else the close
  // (top) desk — the bounds a single "strings" track must respect.
  const desk = entry.desks?.find((d) => d.profileId === input.profile.id) ?? entry.desks?.find((d) => d.voicing === "close") ?? entry.desks?.[0];
  const lo = desk ? desk.lo : entry.bounds.lo;
  const hi = desk ? desk.hi : entry.bounds.hi;
  return {
    source: "register-plan", windowId: window.id, tacet: false, lo, hi,
    ...(entry.desks ? { desks: entry.desks } : {}),
    registerShift: entry.registerShift, action: entry.action, reason: entry.reason,
  };
}

// ---------------------------------------------------------------------------
// Register occupancy (the PR-06 span shape, now derived from the plan)
// ---------------------------------------------------------------------------

function coalesce(perBar: RegisterOccupancySpan[]): RegisterOccupancySpan[] {
  const out: RegisterOccupancySpan[] = [];
  for (const span of perBar) {
    const previous = out[out.length - 1];
    const key = (s: RegisterOccupancySpan) => JSON.stringify([s.occupancy, s.overcrowdedBands, s.resolutions]);
    if (previous && previous.endBar + 1 === span.startBar && key(previous) === key(span)) {
      previous.endBar = span.endBar;
      continue;
    }
    out.push({ ...span });
  }
  return out;
}

const ACTION_TO_RESOLUTION: Record<string, RegisterOccupancySpan["resolutions"][number]["action"]> = {
  trim: "simplify", octave_up: "raise_octave", octave_down: "drop_octave", tacet: "thin_voicing",
};

function occupancySpans(plan: SectionPhrasePlan, registerPlan: RegisterPlan): RegisterOccupancySpan[] {
  const perBar: RegisterOccupancySpan[] = [];
  const lastBar = Math.max(0, ...plan.sections.map((s) => s.endBar));
  for (let bar = 1; bar <= lastBar; bar += 1) {
    const window = registerPlan.windows.find((w) => w.startBar <= bar && w.endBar >= bar);
    if (!window) continue;
    const occupancy: Partial<Record<RegisterBand, number>> = {};
    for (const band of REGISTER_ORDER) {
      if (window.occupancy[band] > 0) occupancy[band] = round3(clamp01(window.occupancy[band] / 4));
    }
    const resolutions: RegisterOccupancySpan["resolutions"] = [];
    const overcrowded = new Set<RegisterBand>();
    for (const collision of window.collisions) {
      overcrowded.add(collision.band);
      const instrument = collision.between[1];
      const entry = window.entries.find((e) => e.instrument === instrument);
      const action = ACTION_TO_RESOLUTION[entry?.action ?? "tacet"] ?? "thin_voicing";
      if (!resolutions.some((r) => r.instrument === instrument && r.band === collision.band)) {
        resolutions.push({ instrument, action, band: collision.band });
      }
    }
    if (window.lowMid.flagged) overcrowded.add("low_mid");
    if (window.lowMid.flagged && !resolutions.some((r) => r.band === "low_mid")) {
      const mover = window.entries.find((e) => e.bands.includes("low_mid") && e.voicing === "close") ?? window.entries.find((e) => e.bands.includes("low_mid"));
      if (mover) resolutions.push({ instrument: mover.instrument, action: "thin_voicing", band: "low_mid" });
    }
    perBar.push({
      startBar: bar, endBar: bar, occupancy,
      overcrowdedBands: REGISTER_ORDER.filter((b) => overcrowded.has(b)),
      resolutions,
    });
  }
  return coalesce(perBar);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function orchestrationBudgetInputsDigest(
  songModel: SongModelData,
  plan: SectionPhrasePlan,
): string {
  return createHash("sha256")
    .update(JSON.stringify({
      sectionPlanDigest: plan.inputsDigestSha256,
      arrangementSpace: songModel.musicalMap?.arrangementSpace.windows ?? null,
      vocals: songModel.musicalMap?.vocals.phrases.map((p) => [p.phraseId, p.activity]) ?? null,
      registerPlan: REGISTER_PLAN_METHOD,
    }))
    .digest("hex");
}

export function deriveOrchestrationBudget(
  songModel: SongModelData,
  sectionPlan: SectionPhrasePlan,
  options: { now?: Date } = {},
): OrchestrationBudgetPlan {
  const map: SongModelMusicalMap =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel, options);

  const seeds = seedWindows(map, sectionPlan);
  const registerPlan = deriveRegisterPlan({
    sectionPlan,
    windows: seeds.map((s) => ({ id: s.id, startBar: s.startBar, endBar: s.endBar })),
    vocalRegister: map.vocals.status === "detected"
      ? map.vocals.registerMap.map((span) => ({ startBar: span.startBar, endBar: span.endBar, register: span.register }))
      : null,
  });
  const windows = seeds.map((seed) =>
    budgetWindow(seed, sectionPlan, registerPlan.windows.find((w) => w.id === seed.id)),
  );

  return {
    version: ORCHESTRATION_BUDGET_VERSION,
    derivedAt: (options.now ?? new Date()).toISOString(),
    inputsDigestSha256: orchestrationBudgetInputsDigest(songModel, sectionPlan),
    method: METHOD,
    windows,
    registerOccupancy: occupancySpans(sectionPlan, registerPlan),
    registerPlan,
  };
}

export function isOrchestrationBudgetStale(
  songModel: SongModelData,
  sectionPlan: SectionPhrasePlan | undefined,
  budget: OrchestrationBudgetPlan | undefined,
): boolean {
  if (!budget || budget.version !== ORCHESTRATION_BUDGET_VERSION || !sectionPlan) return true;
  return budget.inputsDigestSha256 !== orchestrationBudgetInputsDigest(songModel, sectionPlan);
}
