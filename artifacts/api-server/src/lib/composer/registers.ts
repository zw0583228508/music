/**
 * Register arithmetic for the reference composer (Brain B-00 split; Brain
 * B-21 gives it the instrument profile's own answer).
 *
 * Before B-21 this module invented the part's register from two numbers that
 * do not describe the part:
 *
 *   - `constraints.comfortableRange` is the *family's* comfortable range (36-96
 *     for a piano, 60-86 for a string section), not the range a piano plays a
 *     harmonic bed in;
 *   - `registerOf()` returns the argmax of `section.registerDistribution`,
 *     which `sectionPhrasePlanner` builds as a **histogram of every active
 *     family's band** (plus the singer's). Using a section-wide histogram to
 *     shift *this* part moved the bass, the keys and the strings up together
 *     whenever the section as a whole leaned high - measured on the owner's
 *     song: Chorus 3's majority band is `upper_mid`, so every part's ceiling
 *     rose 6 semitones, the keys wrote to MIDI 89 and the strings to 92, and
 *     the register critic reported `top_line_above_comfortable_ceiling` four
 *     times and `climax_all_treble` once ("the climax is the shrillest
 *     section of the song", R-1b P0-4).
 *
 * The ceiling the critic measures against is `roleRegisterFor(profile, role)`
 * in `instrumentProfile.ts` - a sourced, per-role concert-pitch register
 * (piano HARMONIC_BED 48-67, violin section PAD 60-79, CLIMAX_LAYER 67-91,
 * electric bass BASS 28-55). This module now reads *that* table, so the
 * writers and the critic share one source of truth (the charter's rule: if a
 * rule exists elsewhere, import it - never copy it, never invent a second).
 *
 * The section histogram no longer moves notes. The one per-part register
 * *decision* the arc actually makes - the `raise_register` development
 * operator, restricted to `REGISTER_SHIFTABLE_FAMILIES` - is realised inside
 * the part's own window by lifting its **floor**, never by writing above the
 * role's ceiling. `registerOf` is kept (it still describes the section) and is
 * reported by `registerWindowFor` as evidence, not as an instruction.
 */
import type { InstrumentArrangementRole } from "@workspace/db";
import { canonicalFamily, REGISTER_SHIFTABLE_FAMILIES } from "../arrangementArc";
import { profileForDefinition, roleRegisterFor } from "../instrumentProfile";
import { getInstrumentDefinition } from "../musicEngines";
import type { PartGenerationRequest } from "../partComposer";

/** Nearest pitch of `pitchClass` to `target`, clamped into [lo, hi]. */
export function voiceNear(pitchClass: number, target: number, lo: number, hi: number): number {
  let pitch = pitchClass + 12 * Math.round((target - pitchClass) / 12);
  while (pitch < lo) pitch += 12;
  while (pitch > hi) pitch -= 12;
  return Math.max(lo, Math.min(hi, pitch));
}

/** A window narrower than this is not a register, it is a note; the wider band is kept and the reason says so. */
export const MIN_REGISTER_WINDOW = 12;
/**
 * Semitones `raise_register` lifts a shiftable family's floor inside its own
 * window. Seven - a fifth - is as far as a piano harmonic bed can move up
 * without leaving less than an octave of the register its own profile gives it.
 */
export const RAISE_REGISTER_SEMITONES = 7;

export type RegisterWindow = {
  lo: number;
  hi: number;
  /** Where the window came from. */
  source: "role_register" | "profile_comfortable" | "constraints_comfortable";
  /** The instrument profile that answered, when one did. */
  profileId: string | null;
  /** Semitones the arc's `raise_register` operator lifted the floor inside the window (0 otherwise). */
  raisedFloor: number;
  /** The section's own register histogram argmax - evidence about the section, never applied to this part (B-21). */
  sectionBand: string;
  reason: string;
};

/**
 * The role register this instrument's profile gives it, read exactly as
 * `critics/dimensions/register.comfortableCeilingFor` reads it: the definition
 * the orchestrator builds the track with, that definition's profile, and the
 * profile's register for the role the part holds.
 */
export function roleRegisterOf(instrument: string, role: string): {
  lo: number; hi: number; fromRole: boolean; profileId: string; note: string;
} | null {
  try {
    const definition = getInstrumentDefinition(instrument, role);
    const profile = profileForDefinition(definition);
    if (!profile) return null;
    const register = roleRegisterFor(profile, role as InstrumentArrangementRole);
    return { lo: register.lo, hi: register.hi, fromRole: register.fromRole, profileId: profile.id, note: register.note };
  } catch {
    return null;
  }
}

/** The register window this part writes in, with the reason for every bound. */
export function registerWindowFor(request: PartGenerationRequest): RegisterWindow {
  const playable = request.constraints.playableRange;
  const comfortable = request.constraints.comfortableRange;
  const sectionBand = registerOf(request);
  let lo = Math.max(playable.min, comfortable.min);
  let hi = Math.min(playable.max, comfortable.max);
  let source: RegisterWindow["source"] = "constraints_comfortable";
  let profileId: string | null = null;
  const reasons: string[] = [];

  const role = roleRegisterOf(request.instrument, request.role);
  if (role) {
    profileId = role.profileId;
    const candidateLo = Math.max(lo, role.lo);
    const candidateHi = Math.min(hi, role.hi);
    if (candidateHi - candidateLo >= MIN_REGISTER_WINDOW) {
      lo = candidateLo;
      hi = candidateHi;
      source = role.fromRole ? "role_register" : "profile_comfortable";
      reasons.push(role.fromRole
        ? `${role.profileId} plays ${request.role} in ${role.lo}-${role.hi} (instrumentProfile roleRegisters.${request.role}); the register critic reads the same ceiling`
        : `${role.profileId} has no ${request.role} register; its comfortable range ${role.lo}-${role.hi} stands`);
    } else {
      reasons.push(`${role.profileId} ${request.role} register ${role.lo}-${role.hi} intersects this part's playable+comfortable range in ${Math.max(0, candidateHi - candidateLo)} semitones, under the ${MIN_REGISTER_WINDOW}-semitone minimum: the wider ${lo}-${hi} stands`);
    }
  } else {
    reasons.push(`no instrument profile for "${request.instrument}": the family's comfortable range ${lo}-${hi} stands`);
  }

  // The one per-part register decision the arc makes. `raise_register` lifts
  // the *floor* so the part sits high in its own register; the ceiling is the
  // instrument's and does not move, because "brighter" is not "above the top
  // of the instrument's role".
  let raisedFloor = 0;
  const shiftable = REGISTER_SHIFTABLE_FAMILIES.has(canonicalFamily(request.instrument));
  if (request.formMemory?.developmentOperator === "raise_register" && shiftable) {
    const room = Math.max(0, Math.min(RAISE_REGISTER_SEMITONES, hi - lo - MIN_REGISTER_WINDOW));
    if (room > 0) {
      lo += room;
      raisedFloor = room;
      reasons.push(`raise_register: the floor lifts ${room} semitone(s) inside the window (the ceiling is the instrument's)`);
    } else {
      reasons.push("raise_register: no room to lift the floor without leaving less than an octave; the window stands");
    }
  }
  reasons.push(`section register histogram "${sectionBand}" is a description of the section, not of this part (B-21)`);

  return { lo, hi, source, profileId, raisedFloor, sectionBand, reason: reasons.join("; ") };
}

export function registerBounds(request: PartGenerationRequest): { lo: number; hi: number } {
  const window = registerWindowFor(request);
  return { lo: window.lo, hi: window.hi };
}

/**
 * The argmax band of `section.registerDistribution`. That distribution is a
 * histogram over the section's *active families* (`sectionPhrasePlanner`), so
 * this is a statement about the section, not about any one part; B-21 stopped
 * shifting parts by it. Kept because the section's own band is still evidence.
 */
export function registerOf(request: PartGenerationRequest): string {
  const assignment = request.section.registerDistribution;
  const entries = Object.entries(assignment ?? {});
  if (!entries.length) return "mid";
  return entries.sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0][0];
}
