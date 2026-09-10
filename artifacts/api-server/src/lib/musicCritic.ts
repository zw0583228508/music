/**
 * Music Critic V1 (PR-11).
 *
 * A deep musical critique that sits on top of the existing reliability ranking
 * (`candidateRanking.ts`, which checks silence / clipping / playability /
 * timing / section coverage / lineage). This module judges the *music*:
 *
 *   Hard-Rule gate  → harmony → groove → voice leading → lead compatibility →
 *   orchestration → section development → motif coherence → contrast →
 *   transitions → playability → performance potential
 *
 * RETIRED FROM RANKING (Brain B-05c, D5 — not yet enforced).
 *
 * All eleven dimensions below are `demoted` in B-08's merged positive-control
 * ledger (`docs/evidence/positive-control-ledger.json`); only
 * `musicCritic.overall` gates anything, on one corruption family. R-1a P0-3
 * measured what that costs: through the production path a same-rhythm
 * random-pitch composer is *selected* on six of the nine benchmark cases.
 *
 * When `critics/rank.ts` is wired into the compose loop (B-13) and the repair
 * stage (B-06), the ranking must stop reading these dimensions. This module
 * stays, and stays called, as `initialCritique` — the before/after pair the
 * drift metric needs. Nothing here is deleted and nothing here is changed by
 * B-05c; this note is the record of the decision.
 *
 * Deterministic and pure. When track models (notes) are supplied it grades
 * them; otherwise it grades the arrangement plan's intent at lower confidence.
 */
import type {
  ArrangementCritique,
  ArrangementPlan,
  CritiqueDimension,
  CritiqueDimensionScore,
  CritiqueFinding,
  CritiqueRecommendedRepair,
  SongModelData,
  SongModelMusicalMap,
  TrackModel,
} from "@workspace/db";
import { checkArrangementConstraints } from "./musicalConstraints";
import { deriveMusicalMap, isMusicalMapStale } from "./songMusicalMap";

export const MUSIC_CRITIC_VERSION = "1.0" as const;
const METHOD = "music-critic/v1";

const clamp100 = (v: number): number => Math.max(0, Math.min(100, Math.round(v)));
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mean = (values: number[]): number =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
const stddev = (values: number[]): number => {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
};

const DIMENSION_WEIGHT: Record<CritiqueDimension, number> = {
  harmony: 0.15,
  groove: 0.12,
  voiceLeading: 0.08,
  leadCompatibility: 0.14,
  orchestration: 0.12,
  sectionDevelopment: 0.12,
  motifCoherence: 0.06,
  contrast: 0.07,
  transitions: 0.08,
  playability: 0.04,
  performancePotential: 0.02,
};

/**
 * Brain B-00 (confidence honesty): which dimensions read the composed notes at
 * all. The other eight judge the plan or the source Song Model; their
 * confidence is capped so a plan-only judgement never reports itself as
 * better-founded than a note-level one. The critic rebuild (B-05) replaces
 * the dimensions themselves; this only stops the literals from overstating.
 */
const READS_NOTES: Record<CritiqueDimension, boolean> = {
  harmony: false,
  groove: true,
  voiceLeading: true,
  leadCompatibility: false,
  orchestration: false,
  sectionDevelopment: false,
  motifCoherence: false,
  contrast: false,
  transitions: false,
  playability: true,
  performancePotential: false,
};
/** Ceiling on the confidence of a dimension that never saw a note. */
export const PLAN_ONLY_CONFIDENCE_CAP = 0.4;

/** Sum of the weights of dimensions that read notes — the share of the score the notes can move. */
export const NOTE_EVIDENCE_WEIGHT = Number(
  (Object.keys(READS_NOTES) as CritiqueDimension[])
    .filter((d) => READS_NOTES[d])
    .reduce((sum, d) => sum + DIMENSION_WEIGHT[d], 0)
    .toFixed(4),
);

type Partial3 = { score: number; confidence: number; findings: string[] };

const NOTE_ROOTS: Record<string, number> = {
  C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6,
  G: 7, "G#": 8, AB: 8, A: 9, "A#": 10, BB: 10, B: 11,
};
function pitchClassOf(symbol: string): number | null {
  const m = /^([A-Ga-g])([#b]?)/.exec(symbol.replace("♯", "#").replace("♭", "b").trim());
  if (!m) return null;
  const v = NOTE_ROOTS[`${m[1].toUpperCase()}${m[2].toUpperCase()}`];
  return v === undefined ? null : v;
}
function chordTones(chord: SongModelData["chords"][number]): Set<number> {
  const root = pitchClassOf(chord.root ?? chord.symbol);
  if (root === null) return new Set();
  const q = (chord.quality ?? chord.symbol.replace(/^[A-Ga-g][#b]?/, "")).toLowerCase();
  const intervals = q.includes("dim") ? [0, 3, 6]
    : q.includes("aug") ? [0, 4, 8]
    : q.startsWith("m") && !q.startsWith("maj") ? [0, 3, 7]
    : [0, 4, 7];
  if (/7|9|11|13/.test(q)) intervals.push(q.includes("maj7") ? 11 : 10);
  return new Set(intervals.map((i) => (root + i) % 12));
}

// ---------------------------------------------------------------------------
// Hard-Rule gate
// ---------------------------------------------------------------------------

function hardRule(
  songModel: SongModelData,
  plan: ArrangementPlan,
  trackModels: TrackModel[] | undefined,
): { feasible: boolean; findings: CritiqueFinding[] } {
  const findings: CritiqueFinding[] = [];
  const global = plan.globalPlan;

  // Section coverage must be contiguous from bar 1.
  if (global && global.sectionTargets.length) {
    const sorted = [...global.sectionTargets].sort((a, b) => a.startBar - b.startBar);
    if (sorted[0].startBar !== 1) {
      findings.push({ dimension: "hardRule", severity: "error", startBar: 1,
        message: "The arrangement does not start at bar 1." });
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i].startBar !== sorted[i - 1].endBar + 1) {
        findings.push({ dimension: "hardRule", severity: "error",
          sectionName: sorted[i].sectionName, startBar: sorted[i].startBar,
          message: `Section "${sorted[i].sectionName}" leaves a gap after "${sorted[i - 1].sectionName}".` });
      }
    }
    for (const target of sorted) {
      if ((target.role === "chorus" || target.role === "verse") && target.energy > 0.15) {
        const roles = plan.sectionPlan?.roleAssignments.filter((r) => r.sectionName === target.sectionName) ?? [];
        if (plan.sectionPlan && roles.length === 0) {
          findings.push({ dimension: "hardRule", severity: "error", sectionName: target.sectionName,
            message: `Mandatory section "${target.sectionName}" has no instruments assigned.` });
        }
      }
    }
  }
  if (!songModel.meterMap || songModel.meterMap.length === 0) {
    findings.push({ dimension: "hardRule", severity: "error", message: "No meter is established." });
  }

  // Physical playability of any supplied notes.
  if (trackModels && trackModels.length) {
    const report = checkArrangementConstraints(
      trackModels.map((t) => ({
        id: t.id, instrument: t.instrument, role: t.role,
        instrumentDefinition: t.instrumentDefinition,
        notes: t.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch, velocity: n.velocity })),
        articulations: t.articulations,
      })),
      { tempoBpm: songModel.tempoMap?.[0]?.bpm ?? 120 },
    );
    for (const track of report.byTrack) {
      for (const violation of track.violations.filter((v) => v.severity === "error")) {
        findings.push({ dimension: "hardRule", severity: "error",
          instrument: track.instrument,
          startBar: undefined,
          message: `${track.instrument}: ${violation.message}` });
      }
    }
  }

  return { feasible: findings.every((f) => f.severity !== "error"), findings };
}

// ---------------------------------------------------------------------------
// Dimension critics
// ---------------------------------------------------------------------------

function critiqueHarmony(songModel: SongModelData, map: SongModelMusicalMap): Partial3 {
  const findings: string[] = [];
  if (map.harmony.status === "not_available") {
    return { score: 50, confidence: 0.3, findings: ["No harmony evidence to judge."] };
  }
  let score = 70;
  let confidence = 0.6;

  const chords = songModel.chords ?? [];
  const meanConf = mean(chords.map((c) => c.confidence ?? 0));
  score += (meanConf - 0.6) * 40;

  // Non-chord-tone rate for confident melody notes.
  const melody = (songModel.melody ?? []).filter((n) => (n.confidence ?? 0) >= 0.6);
  let compared = 0;
  let clashes = 0;
  for (const note of melody) {
    const chord = chords.find((c) => c.start < note.end && c.end > note.start && (c.confidence ?? 0) >= 0.6);
    if (!chord) continue;
    const tones = chordTones(chord);
    if (tones.size === 0) continue;
    compared += 1;
    if (!tones.has(note.pitch % 12)) clashes += 1;
  }
  if (compared >= 4) {
    confidence = 0.75;
    const rate = clashes / compared;
    if (rate > 0.45) { score -= 25; findings.push(`${Math.round(rate * 100)}% of melody notes clash with the harmony.`); }
    else if (rate > 0.3) { score -= 10; findings.push("Some melody notes sit outside the chord."); }
    else findings.push("Melody and harmony agree.");
  }

  // Cadences near section boundaries.
  const boundaries = new Set((songModel.sections ?? []).map((s) => s.startBar));
  const cadencesAtBoundary = map.harmony.cadences.filter((c) => boundaries.has(c.atBar) || boundaries.has(c.atBar + 1));
  if (map.harmony.cadences.length > 0) {
    if (cadencesAtBoundary.length >= Math.max(1, boundaries.size - 2)) {
      score += 8; findings.push("Cadences land at the section boundaries.");
    } else {
      score -= 6; findings.push("Section boundaries are not harmonically prepared.");
    }
  }

  // Tension should breathe, not flat-line.
  const tensions = map.harmony.tensionMap.map((t) => t.tension);
  if (tensions.length >= 3 && stddev(tensions) < 0.05) {
    score -= 6; findings.push("Harmonic tension barely moves across the song.");
  }

  return { score: clamp100(score), confidence, findings };
}

function critiqueGroove(
  map: SongModelMusicalMap,
  plan: ArrangementPlan,
  trackModels: TrackModel[] | undefined,
): Partial3 {
  const findings: string[] = [];
  if (map.rhythm.status === "not_available") {
    return { score: 55, confidence: 0.3, findings: ["No rhythm evidence to judge."] };
  }
  let score = 70;
  let confidence = 0.55;

  const syncByBar = map.rhythm.syncopation.map((s) => s.syncopation);
  if (syncByBar.length >= 3 && stddev(syncByBar) > 0.3) {
    score -= 8; findings.push("Syncopation is inconsistent bar to bar.");
  } else {
    findings.push("Groove feel is coherent.");
  }
  if (map.rhythm.grooveProfile.subdivision === "mixed" && plan.globalPlan?.grooveStrategy !== "rubato") {
    score -= 6; findings.push("The subdivision keeps changing without a clear feel.");
  }

  // Fill placement — the transition plan should place fills near section ends.
  const fillBoundaries = (plan.transitionPlan?.transitions ?? []).filter(
    (t) => t.devices.some((d) => d.device === "drum_fill"),
  ).length;
  const buildBoundaries = (plan.transitionPlan?.transitions ?? []).filter((t) => t.kind === "build").length;
  if (buildBoundaries > 0) {
    if (fillBoundaries >= Math.ceil(buildBoundaries * 0.6)) { score += 6; findings.push("Fills mark the lifts."); }
    else { score -= 8; findings.push("Some energy lifts have no fill to carry them."); }
  }

  // Kick / bass lock, if notes exist.
  const drums = trackModels?.find((t) => /drum/i.test(t.role) || t.instrumentDefinition.family === "drums");
  const bass = trackModels?.find((t) => /bass/i.test(t.role) || t.instrument === "bass");
  if (drums && bass) {
    confidence = 0.8;
    const kicks = drums.notes.filter((n) => n.pitch === 36 || n.pitch === 35).map((n) => n.start);
    const bassOnsets = bass.notes.map((n) => n.start);
    if (kicks.length && bassOnsets.length) {
      const locked = kicks.filter((k) => bassOnsets.some((b) => Math.abs(b - k) < 0.035)).length / kicks.length;
      if (locked > 0.6) { score += 10; findings.push("Kick and bass lock tightly."); }
      else { score -= 12; findings.push("Kick and bass are not locked."); }
    }
  }

  return { score: clamp100(score), confidence, findings };
}

function critiqueVoiceLeading(
  plan: ArrangementPlan,
  trackModels: TrackModel[] | undefined,
): Partial3 {
  const harmonic = (trackModels ?? []).filter((t) =>
    /harmony|keys|guitar|string|pad/i.test(t.role) || ["keys", "strings", "guitar", "synth"].includes(t.instrumentDefinition.family));
  if (harmonic.length === 0) {
    const consistent = plan.sectionPlan?.roleAssignments.every(
      (r) => r.voicingStrategy !== undefined,
    ) ?? false;
    return {
      score: consistent ? 70 : 60, confidence: 0.4,
      findings: ["Judged from the plan's voicing strategy — no note-level voicing yet."],
    };
  }
  const findings: string[] = [];
  let score = 72;
  for (const track of harmonic) {
    const chordsAt = new Map<number, number[]>();
    for (const note of track.notes) {
      const key = Math.round(note.start * 4);
      chordsAt.set(key, [...(chordsAt.get(key) ?? []), note.pitch]);
    }
    const voicings = [...chordsAt.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p.sort((x, y) => x - y));
    let motion = 0;
    let count = 0;
    for (let i = 1; i < voicings.length; i += 1) {
      const a = voicings[i - 1];
      const b = voicings[i];
      const len = Math.min(a.length, b.length);
      for (let v = 0; v < len; v += 1) { motion += Math.abs(a[v] - b[v]); count += 1; }
    }
    const meanMotion = count ? motion / count : 0;
    if (meanMotion > 6) { score -= 12; findings.push(`${track.instrument}: voices leap between chords (avg ${meanMotion.toFixed(1)} semitones).`); }
    else if (meanMotion > 0) findings.push(`${track.instrument}: smooth voice leading.`);
  }
  return { score: clamp100(score), confidence: 0.75, findings };
}

function critiqueLeadCompatibility(
  map: SongModelMusicalMap,
  plan: ArrangementPlan,
): Partial3 {
  const findings: string[] = [];
  if (map.vocals.status === "not_available") {
    return { score: 65, confidence: 0.35, findings: ["No verified vocal to protect."] };
  }
  let score = 74;
  const budget = plan.orchestrationBudget;
  if (budget) {
    const sung = budget.windows.filter((w) => w.vocalAttention >= 0.6);
    // B-00: the original predicate was `[...].some(() => a.densityMultiplier > 0.9) && a.densityMultiplier > 1`,
    // whose callback ignored the role list, so it collapsed to `> 1` — a value only
    // CLIMAX_LAYER can reach — and the +12 bonus was handed out by default. The
    // intended rule: a foreground role (counter-melody, fill, call/response) is
    // over-playing under the singer above 0.9; any role is above 1.
    const FOREGROUND_ROLES = new Set(["COUNTER_MELODY", "FILL", "CALL_RESPONSE"]);
    const roleOf = (instrument: string, window: { startBar: number; endBar: number }): string | null =>
      plan.sectionPlan?.roleAssignments.find((r) =>
        r.instrument === instrument && r.entryBar <= window.endBar && r.exitBar >= window.startBar)?.role ?? null;
    const overPlaying = sung.filter((w) =>
      w.instrumentAdjustments.some((a) => {
        const role = roleOf(a.instrument, w);
        return (role !== null && FOREGROUND_ROLES.has(role) && a.densityMultiplier > 0.9) ||
          a.densityMultiplier > 1;
      }),
    ).length;
    if (sung.length) {
      if (overPlaying === 0) { score += 12; findings.push("Support instruments make room for the singer."); }
      else { score -= 15; findings.push(`${overPlaying} sung window(s) have instruments playing over the vocal.`); }
    }
  }
  // Answers in the gaps.
  const gaps = (plan.orchestrationBudget?.windows ?? []).filter((w) => w.vocalAttention < 0.2);
  const answered = gaps.filter((w) => w.instrumentAdjustments.some((a) => a.densityMultiplier > 0.6)).length;
  if (gaps.length) {
    if (answered >= Math.ceil(gaps.length * 0.5)) { score += 8; findings.push("The vocal gaps are answered."); }
    else { score -= 6; findings.push("Vocal gaps are left empty — a chance for a counter-melody."); }
  }
  return { score: clamp100(score), confidence: 0.65, findings };
}

function critiqueOrchestration(
  map: SongModelMusicalMap,
  plan: ArrangementPlan,
): Partial3 {
  const findings: string[] = [];
  let score = 72;
  const budget = plan.orchestrationBudget;
  if (budget) {
    const unresolved = budget.registerOccupancy.filter(
      (s) => s.overcrowdedBands.length > 0 && s.resolutions.length < s.overcrowdedBands.length,
    ).length;
    if (unresolved > 0) { score -= Math.min(20, unresolved * 6); findings.push(`${unresolved} register-overcrowding span(s) without a fix.`); }
    else findings.push("Register space is managed.");
  }
  // Family count should track the energy curve.
  if (plan.sectionPlan && plan.globalPlan) {
    const pairs = plan.sectionPlan.sections.map((s) => {
      const target = plan.globalPlan!.sectionTargets.find((t) => t.sectionName === s.sectionName);
      return { energy: target?.energy ?? s.energy, families: s.activeInstrumentFamilies.length };
    });
    if (pairs.length >= 3) {
      const loud = pairs.filter((p) => p.energy >= 0.6);
      const quiet = pairs.filter((p) => p.energy < 0.4);
      if (loud.length && quiet.length && mean(loud.map((p) => p.families)) <= mean(quiet.map((p) => p.families))) {
        score -= 12; findings.push("Loud sections are not fuller than quiet ones.");
      } else findings.push("Orchestration density follows the energy curve.");
    }
  }
  // Palette actually used.
  if (plan.globalPlan && plan.sectionPlan) {
    const used = new Set(plan.sectionPlan.roleAssignments.map((r) => r.instrument));
    const highPriority = plan.globalPlan.instrumentPalette.filter((p) => p.priority <= 3).map((p) => p.role);
    const missing = highPriority.filter((role) => !used.has(role));
    if (missing.length) { score -= missing.length * 4; findings.push(`Planned instrument(s) never used: ${missing.join(", ")}.`); }
  }
  return { score: clamp100(score), confidence: 0.6, findings };
}

function critiqueSectionDevelopment(plan: ArrangementPlan): Partial3 {
  const findings: string[] = [];
  const global = plan.globalPlan;
  if (!global || global.sectionTargets.length < 2) {
    return { score: 55, confidence: 0.3, findings: ["Not enough sections to judge development."] };
  }
  let score = 70;
  // Repeated sections must evolve.
  const byName = new Map<string, string[]>();
  for (const section of plan.sectionPlan?.sections ?? []) {
    const base = section.sectionName.replace(/\d+/g, "").trim().toLowerCase();
    byName.set(base, [...(byName.get(base) ?? []), section.sectionName]);
  }
  for (const [base, names] of byName) {
    if (names.length < 2) continue;
    const familySets = names.map((name) =>
      JSON.stringify([...(plan.sectionPlan?.sections.find((s) => s.sectionName === name)?.activeInstrumentFamilies ?? [])].sort()));
    if (new Set(familySets).size === 1) {
      score -= 15; findings.push(`Repeats of "${base}" are identical — no added layer.`);
    } else {
      score += 6; findings.push(`"${base}" develops across its repeats.`);
    }
  }
  // Novelty at the right places.
  const meanNovelty = mean(global.sectionTargets.slice(1).map((t) => t.noveltyVsPrevious));
  if (meanNovelty < 0.2) { score -= 12; findings.push("Sections barely differ from one another."); }
  else if (meanNovelty > 0.5) findings.push("Each section is a clear change.");
  // Climax placement.
  if (global.climax) {
    const climaxSection = global.sectionTargets.find((t) => t.sectionName === global.climax!.sectionName);
    const isLate = climaxSection && climaxSection.startBar / (global.sectionTargets.at(-1)?.endBar ?? 1) > 0.45;
    if (isLate) { score += 6; findings.push("The climax lands in the back half."); }
    else { score -= 4; findings.push("The climax arrives early — check the energy arc."); }
  }
  return { score: clamp100(score), confidence: 0.6, findings };
}

function critiqueMotif(map: SongModelMusicalMap, plan: ArrangementPlan): Partial3 {
  if (map.melody.status === "not_available") {
    return { score: 60, confidence: 0.3, findings: ["No melody to trace a motif through."] };
  }
  const motifs = map.melody.motifs;
  const style = plan.globalPlan?.style ?? "unknown";
  if (motifs.length === 0) {
    const wantsHook = ["pop", "rock", "dance"].includes(style);
    return {
      score: wantsHook ? 52 : 66, confidence: 0.55,
      findings: [wantsHook ? "No recurring motif — a pop arrangement usually wants a hook." : "Through-composed melody; no single motif."],
    };
  }
  let score = 74;
  const findings: string[] = [];
  const developed = motifs.some((m) => m.occurrences.some((o) => o.variation === "developed"));
  const transposed = motifs.some((m) => m.occurrences.some((o) => o.variation === "transposed"));
  if (developed) { score += 10; findings.push("A motif is developed, not just repeated."); }
  if (transposed) { score += 4; findings.push("A motif returns transposed."); }
  const maxOcc = Math.max(...motifs.map((m) => m.occurrences.length));
  if (maxOcc >= 3) { score += 4; findings.push(`The main motif recurs ${maxOcc} times.`); }
  return { score: clamp100(score), confidence: 0.6, findings };
}

function critiqueContrast(map: SongModelMusicalMap): Partial3 {
  const sc = map.styleFingerprint.sectionContrast;
  if (sc === null) return { score: 62, confidence: 0.3, findings: ["No section-contrast measure."] };
  let score = 60 + sc * 60;
  const findings: string[] = [];
  if (sc < 0.15) findings.push("Sections feel samey — little dynamic or textural contrast.");
  else if (sc > 0.5) findings.push("Strong contrast between sections.");
  else findings.push("Moderate section contrast.");
  const registers = new Set(map.vocals.registerMap.map((r) => r.register)).size;
  if (registers >= 3) { score += 6; findings.push("The vocal covers a wide register."); }
  return { score: clamp100(score), confidence: 0.5, findings };
}

function critiqueTransitions(plan: ArrangementPlan): Partial3 {
  const transitions = plan.transitionPlan?.transitions ?? [];
  if (transitions.length === 0) {
    return { score: 55, confidence: 0.3, findings: ["No transition plan."] };
  }
  let score = 74;
  const findings: string[] = [];
  const flat = transitions.filter((t) => t.strength > 0.5 && t.devices.length === 0);
  if (flat.length) { score -= flat.length * 10; findings.push(`${flat.length} strong boundary(ies) have no transition device.`); }
  const buildsOk = transitions.filter((t) => t.kind === "build").every((t) =>
    t.devices.some((d) => ["drum_fill", "riser", "build_up", "cymbal_swell", "string_run"].includes(d.device)));
  const dropsOk = transitions.filter((t) => t.kind === "drop").every((t) =>
    t.devices.some((d) => ["break", "cymbal_choke", "breakdown", "stop"].includes(d.device)));
  if (buildsOk && dropsOk) { score += 8; findings.push("Builds lift and drops clear space."); }
  else findings.push("Some builds/drops lack the expected gesture.");
  const lastKind = plan.globalPlan?.sectionTargets.at(-1)?.role;
  if (lastKind === "outro" && !transitions.some((t) => t.toSection.toLowerCase().includes("outro") && t.devices.some((d) => d.device === "ending_hit"))) {
    score -= 6; findings.push("No clear ending gesture.");
  }
  return { score: clamp100(score), confidence: 0.65, findings };
}

function critiquePlayability(
  songModel: SongModelData,
  trackModels: TrackModel[] | undefined,
): Partial3 {
  if (!trackModels || trackModels.length === 0) {
    return { score: 75, confidence: 0.3, findings: ["No notes yet — playability judged at generation time."] };
  }
  const report = checkArrangementConstraints(
    trackModels.map((t) => ({
      id: t.id, instrument: t.instrument, role: t.role,
      instrumentDefinition: t.instrumentDefinition,
      notes: t.notes.map((n) => ({ id: n.id, start: n.start, duration: n.duration, pitch: n.pitch })),
      articulations: t.articulations,
    })),
    { tempoBpm: songModel.tempoMap?.[0]?.bpm ?? 120 },
  );
  const score = 100 - report.errorCount * 25 - report.warningCount * 6;
  const findings = report.errorCount || report.warningCount
    ? [`${report.errorCount} playability error(s), ${report.warningCount} warning(s).`]
    : ["Every part is physically playable."];
  return { score: clamp100(score), confidence: 0.85, findings };
}

function critiquePerformancePotential(
  map: SongModelMusicalMap,
  plan: ArrangementPlan,
): Partial3 {
  let score = 68;
  const findings: string[] = [];
  const energies = (plan.globalPlan?.sectionTargets ?? []).map((t) => t.energy);
  if (energies.length >= 2) {
    const spread = Math.max(...energies) - Math.min(...energies);
    if (spread > 0.4) { score += 12; findings.push("Wide dynamic range leaves room for a real performance."); }
    else { score -= 6; findings.push("Narrow dynamic range — the performance will feel flat."); }
  }
  const phraseCadences = map.vocals.status !== "not_available"
    ? map.vocals.phrases.filter((p) => p.cadence !== "unknown").length
    : 0;
  if (phraseCadences >= 2) { score += 6; findings.push("Phrase endings are shaped, not just cut off."); }
  return { score: clamp100(score), confidence: 0.4, findings };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

export function critiqueArrangement(input: {
  songModel: SongModelData;
  plan: ArrangementPlan;
  trackModels?: TrackModel[];
}): ArrangementCritique {
  const { songModel, plan, trackModels } = input;
  const map: SongModelMusicalMap =
    songModel.musicalMap && !isMusicalMapStale(songModel)
      ? songModel.musicalMap
      : deriveMusicalMap(songModel);

  const gate = hardRule(songModel, plan, trackModels);

  const parts: Record<CritiqueDimension, Partial3> = {
    harmony: critiqueHarmony(songModel, map),
    groove: critiqueGroove(map, plan, trackModels),
    voiceLeading: critiqueVoiceLeading(plan, trackModels),
    leadCompatibility: critiqueLeadCompatibility(map, plan),
    orchestration: critiqueOrchestration(map, plan),
    sectionDevelopment: critiqueSectionDevelopment(plan),
    motifCoherence: critiqueMotif(map, plan),
    contrast: critiqueContrast(map),
    transitions: critiqueTransitions(plan),
    playability: critiquePlayability(songModel, trackModels),
    performancePotential: critiquePerformancePotential(map, plan),
  };

  const evaluatedNotes = Boolean(trackModels && trackModels.length);
  const dimensions: CritiqueDimensionScore[] = (Object.keys(parts) as CritiqueDimension[]).map((dimension) => {
    const notesConsulted = evaluatedNotes && READS_NOTES[dimension];
    return {
      dimension,
      score: parts[dimension].score,
      weight: DIMENSION_WEIGHT[dimension],
      // B-00: a dimension that never saw a note may not report more confidence
      // than a plan-level judgement supports.
      confidence: clamp01(notesConsulted
        ? parts[dimension].confidence
        : Math.min(parts[dimension].confidence, PLAN_ONLY_CONFIDENCE_CAP)),
      findings: parts[dimension].findings,
      notesConsulted,
    };
  });

  const overallScore = gate.feasible
    ? clamp100(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0))
    : Math.min(40, clamp100(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)));

  const strengths = dimensions.filter((d) => d.score >= 80).map((d) => `${d.dimension}: ${d.findings[0] ?? "strong"}`);
  const weaknesses = dimensions.filter((d) => d.score <= 58).map((d) => `${d.dimension}: ${d.findings[0] ?? "weak"}`);

  const recommendedRepairs: CritiqueRecommendedRepair[] = dimensions
    .filter((d) => d.score <= 62)
    .map((d) => repairFor(d.dimension, d.findings[0] ?? "", plan));

  return {
    version: MUSIC_CRITIC_VERSION,
    method: METHOD,
    evaluatedNotes,
    noteEvidenceWeight: evaluatedNotes ? NOTE_EVIDENCE_WEIGHT : 0,
    feasible: gate.feasible,
    hardRuleFindings: gate.findings,
    overallScore,
    dimensions,
    strengths,
    weaknesses,
    recommendedRepairs,
  };
}

function repairFor(
  dimension: CritiqueDimension,
  finding: string,
  plan: ArrangementPlan,
): CritiqueRecommendedRepair {
  const firstChorus = plan.globalPlan?.sectionTargets.find((t) => t.role === "chorus")?.sectionName;
  const base: Record<CritiqueDimension, Omit<CritiqueRecommendedRepair, "dimension">> = {
    harmony: { action: "reharmonise or re-voice the clashing bars", reason: finding },
    groove: { action: "tighten the kick/bass lock and add fills at the lifts", reason: finding },
    voiceLeading: { action: "re-voice the chords for stepwise motion", reason: finding },
    leadCompatibility: { action: "duck supporting parts and move answers into the vocal gaps", reason: finding, sectionName: firstChorus },
    orchestration: { action: "resolve register overcrowding (drop/raise an octave) and thin quiet sections", reason: finding },
    sectionDevelopment: { action: "add a layer to each repeated section (upper strings / countermelody / extra percussion)", reason: finding, sectionName: firstChorus },
    motifCoherence: { action: "state a motif in the intro and develop it in the bridge", reason: finding },
    contrast: { action: "widen the dynamic and textural gap between verse and chorus", reason: finding },
    transitions: { action: "add a fill/riser into strong boundaries and a clear ending gesture", reason: finding },
    playability: { action: "fix the flagged unplayable notes per the constraint suggestions", reason: finding },
    performancePotential: { action: "open up the dynamic range across sections", reason: finding },
  };
  return { dimension, ...base[dimension] };
}
